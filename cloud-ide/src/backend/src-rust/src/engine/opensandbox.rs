use super::SandboxEngine;
use crate::{
    JsExecConnection,
    JsSandboxExecRequest,
    JsSandboxExecResult,
    JsSandboxSpec,
    JsSandboxStatus,
    JsVolumeMount,
};
use async_trait::async_trait;
use reqwest::{Client, Method, RequestBuilder};
use serde_json::{json, Value};
use std::time::Duration; 

#[derive(Clone, Debug)]
struct OpenSandboxConfig {
    api_base_url: String,
    api_key: Option<String>,
    execd_access_token: Option<String>,
    execd_port: u16,
}

impl OpenSandboxConfig {
    fn new(api_url: String, api_key: Option<String>, execd_access_token: Option<String>) -> Self {
        Self {
            api_base_url: normalize_lifecycle_base_url(&api_url),
            api_key: api_key.filter(|value| !value.trim().is_empty()),
            execd_access_token: execd_access_token.filter(|value| !value.trim().is_empty()),
            execd_port: 44772,
        }
    }
}

#[derive(Clone)]
struct OpenSandboxLifecycleClient {
    config: OpenSandboxConfig,
    client: Client,
}

impl OpenSandboxLifecycleClient {
    fn new(config: OpenSandboxConfig, client: Client) -> Self {
        Self { config, client }
    }

    fn request(&self, method: Method, url: String) -> RequestBuilder {
        let builder = self.client.request(method, url);
        match &self.config.api_key {
            Some(api_key) => builder.header("OPEN-SANDBOX-API-KEY", api_key),
            None => builder,
        }
    }

    async fn boot(&self, spec: &JsSandboxSpec) -> Result<JsSandboxStatus, String> {
        let cpu = spec
            .resource_limits
            .as_ref()
            .and_then(|limits| limits.cpu_count)
            .unwrap_or(1.0);
        let mem = spec
            .resource_limits
            .as_ref()
            .and_then(|limits| limits.memory_mb)
            .unwrap_or(512.0);
        let env_vars = spec.env_vars.clone().unwrap_or_default();
        let volumes = spec
            .volumes
            .clone()
            .unwrap_or_default()
            .iter()
            .map(map_volume_mount)
            .collect::<Vec<_>>();

        let mut payload = json!({
            "image": { "uri": &spec.image_tag, "pullPolicy": "IfNotPresent" },
            "timeout": 3600,
            "resourceLimits": { "cpuCount": cpu.to_string(), "memoryMb": mem.to_string() },
            "env": env_vars,
            "volumes": volumes,
            "entrypoint": ["sleep", "infinity"]
        });

        if let Some(exposed_ports) = &spec.exposed_ports {
            payload["exposedPorts"] = json!(exposed_ports);
        }

        let response = self
            .request(
                Method::POST,
                format!("{}/sandboxes", self.config.api_base_url),
            )
            .json(&payload)
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Engine rejected boot: {}", response.status()));
        }

        let data: Value = response.json().await.map_err(|error| error.to_string())?;
        Ok(map_status(&data, None, self.config.execd_port))
    }

    async fn get_status(&self, sandbox_id: &str) -> Result<JsSandboxStatus, String> {
        let response = self
            .request(
                Method::GET,
                format!("{}/sandboxes/{}", self.config.api_base_url, sandbox_id),
            )
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Failed to fetch status: {}", response.status()));
        }

        let data: Value = response.json().await.map_err(|error| error.to_string())?;
        Ok(map_status(&data, Some(sandbox_id), self.config.execd_port))
    }

    async fn pause(&self, sandbox_id: &str) -> Result<bool, String> {
        let response = self
            .request(
                Method::POST,
                format!("{}/sandboxes/{}/pause", self.config.api_base_url, sandbox_id),
            )
            .send()
            .await
            .map_err(|error| error.to_string())?;

        Ok(response.status().is_success())
    }

    async fn resume(&self, sandbox_id: &str) -> Result<bool, String> {
        let response = self
            .request(
                Method::POST,
                format!("{}/sandboxes/{}/resume", self.config.api_base_url, sandbox_id),
            )
            .send()
            .await
            .map_err(|error| error.to_string())?;

        Ok(response.status().is_success())
    }

    async fn destroy(&self, sandbox_id: &str) -> Result<bool, String> {
        let response = self
            .request(
                Method::DELETE,
                format!("{}/sandboxes/{}", self.config.api_base_url, sandbox_id),
            )
            .send()
            .await
            .map_err(|error| error.to_string())?;

        Ok(response.status().is_success() || response.status().as_u16() == 404)
    }

    async fn resolve_exec_endpoint(&self, sandbox_id: &str) -> Result<String, String> {
        let response = self
            .request(
                Method::GET,
                format!(
                    "{}/sandboxes/{}/endpoints/{}",
                    self.config.api_base_url, sandbox_id, self.config.execd_port
                ),
            )
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if response.status().is_success() {
            let data: Value = response.json().await.map_err(|error| error.to_string())?;
            if let Some(endpoint) = extract_endpoint(&data) {
                return Ok(normalize_execd_base_url(&endpoint, self.config.execd_port));
            }
        }

        let status = self.get_status(sandbox_id).await?;
        if let Some(ip_address) = status.ip_address {
            return Ok(format!("http://{}:{}", ip_address, self.config.execd_port));
        }

        Err("Unable to resolve exec endpoint for sandbox".to_string())
    }
}

#[derive(Clone)]
struct OpenSandboxExecResolver {
    config: OpenSandboxConfig,
    client: Client,
}

impl OpenSandboxExecResolver {
    fn new(config: OpenSandboxConfig, client: Client) -> Self {
        Self { config, client }
    }

    async fn resolve_connection(
        &self,
        lifecycle: &OpenSandboxLifecycleClient,
        sandbox_id: &str,
    ) -> Result<JsExecConnection, String> {
        let base_url = lifecycle.resolve_exec_endpoint(sandbox_id).await?;
        Ok(JsExecConnection {
            base_url,
            access_token: self.config.execd_access_token.clone(),
        })
    }

    async fn exec_buffered(
        &self,
        lifecycle: &OpenSandboxLifecycleClient,
        sandbox_id: &str,
        payload: &JsSandboxExecRequest,
    ) -> Result<JsSandboxExecResult, String> {
        let connection = self.resolve_connection(lifecycle, sandbox_id).await?;
        let mut request = self
            .client
            .post(format!("{}/command", connection.base_url.trim_end_matches('/')))
            .header("Accept", "text/event-stream")
            .json(&json!({
                "command": payload.command.join(" "), // Stitched into a single string: so our go execd can understand
                "cwd": payload.cwd.clone().unwrap_or_else(|| "/workspace".to_string()),
                "env": payload.env.clone().unwrap_or_default(),
            }));


        if let Some(token) = connection.access_token {
            request = request.header("X-EXECD-ACCESS-TOKEN", token);
        }

        let response = request.send().await.map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Execd daemon failed with status {}: {}", status, body));
        }

        let body = response.text().await.map_err(|error| error.to_string())?;
        Ok(parse_execd_stream(&body))
    }
}

pub struct OpenSandboxProvider {
    lifecycle: OpenSandboxLifecycleClient,
    exec: OpenSandboxExecResolver,
}

impl OpenSandboxProvider {
    pub fn new(
        api_url: String,
        api_key: Option<String>,
        execd_access_token: Option<String>,
    ) -> Self {
        let config = OpenSandboxConfig::new(api_url, api_key, execd_access_token);

        // NEW: Centralized Timeout Configuration
        let connect_timeout = std::env::var("RUST_CONNECT_TIMEOUT")
            .unwrap_or_else(|_| "10".to_string())
            .parse::<u64>()
            .unwrap_or(10);

        let read_timeout = std::env::var("RUST_READ_TIMEOUT")
            .unwrap_or_else(|_| "120".to_string())
            .parse::<u64>()
            .unwrap_or(120);

        // Build the client with custom timeouts
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(connect_timeout))
            .timeout(Duration::from_secs(read_timeout))
            .build()
            .unwrap_or_else(|_| Client::new()); // Fallback to default if builder fails

        Self {
            lifecycle: OpenSandboxLifecycleClient::new(config.clone(), client.clone()),
            exec: OpenSandboxExecResolver::new(config, client),
        }
    }
}

#[async_trait]
impl SandboxEngine for OpenSandboxProvider {
    async fn boot(&self, spec: &JsSandboxSpec) -> Result<JsSandboxStatus, String> {
        self.lifecycle.boot(spec).await
    }

    async fn get_status(&self, sandbox_id: &str) -> Result<JsSandboxStatus, String> {
        self.lifecycle.get_status(sandbox_id).await
    }

    async fn pause(&self, sandbox_id: &str) -> Result<bool, String> {
        self.lifecycle.pause(sandbox_id).await
    }

    async fn resume(&self, sandbox_id: &str) -> Result<bool, String> {
        self.lifecycle.resume(sandbox_id).await
    }

    async fn destroy(&self, sandbox_id: &str) -> Result<bool, String> {
        self.lifecycle.destroy(sandbox_id).await
    }

    async fn exec(
        &self,
        sandbox_id: &str,
        payload: &JsSandboxExecRequest,
    ) -> Result<JsSandboxExecResult, String> {
        self.exec
            .exec_buffered(&self.lifecycle, sandbox_id, payload)
            .await
    }

    async fn resolve_exec_connection(&self, sandbox_id: &str) -> Result<JsExecConnection, String> {
        self.exec.resolve_connection(&self.lifecycle, sandbox_id).await
    }
}

fn normalize_lifecycle_base_url(url: &str) -> String {
    let trimmed = url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{}/v1", trimmed)
    }
}


fn normalize_execd_base_url(endpoint: &str, execd_port: u16) -> String {
    let endpoint = endpoint.trim_end_matches('/');
    
    let with_scheme = if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
        endpoint.to_string()
    } else {
        format!("http://{}", endpoint)
    };

    // Strip the scheme so we can check the raw host and path
    let without_scheme = with_scheme
        .trim_start_matches("http://")
        .trim_start_matches("https://");

    // If the string already contains a colon (a port) or a slash (a proxy path),
    // it is a fully qualified endpoint. Leave it exactly as it is.
    if without_scheme.contains(':') || without_scheme.contains('/') {
        with_scheme
    } else {
        // Only append the port if it's a raw IP like "10.0.0.2"
        format!("{}:{}", with_scheme, execd_port)
    }
}

fn extract_endpoint(data: &Value) -> Option<String> {
    data["endpoint"]
        .as_str()
        .or_else(|| data["url"].as_str())
        .or_else(|| data["address"].as_str())
        .map(|value| value.to_string())
}

fn map_volume_mount(volume: &JsVolumeMount) -> Value {
    let mut payload = json!({
        "name": volume.name,
        "mountPath": volume.mount_path,
        "readOnly": volume.read_only.unwrap_or(false),
    });

    if let Some(host_path) = &volume.host_path {
        payload["host"] = json!({ "path": host_path });
    }

    if let Some(sub_path) = &volume.sub_path {
        payload["subPath"] = json!(sub_path);
    }

    payload
}

fn map_status(data: &Value, fallback_id: Option<&str>, execd_port: u16) -> JsSandboxStatus {
    let raw_state = data["status"]["phase"]
        .as_str()
        .or_else(|| data["status"]["state"].as_str())
        .unwrap_or("UNKNOWN");

    let mapped_state = match raw_state {
        "Running" | "RUNNING" => "RUNNING",
        "Pending" | "PENDING" | "Provisioning" | "PROVISIONING" => "PROVISIONING",
        "Paused" | "PAUSED" => "PAUSED",
        "Stopped" | "STOPPED" => "STOPPED",
        _ => "ERROR",
    };

    JsSandboxStatus {
        sandbox_id: data["id"]
            .as_str()
            .or(fallback_id)
            .unwrap_or_default()
            .to_string(),
        state: mapped_state.to_string(),
        ip_address: data["status"]["ip"].as_str().map(|value| value.to_string()),
        execd_port: Some(execd_port.into()),
        message: data["status"]["message"]
            .as_str()
            .map(|value| value.to_string())
            .or_else(|| Some("OpenSandbox status resolved".to_string())),
        preview_urls: None,
    }
}

fn parse_execd_stream(body: &str) -> JsSandboxExecResult {
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit_code = 0;

    for line in body.lines() {
        let Some(data) = line.strip_prefix("data: ") else {
            continue;
        };

        let Ok(event) = serde_json::from_str::<Value>(data) else {
            continue;
        };

        match event["type"].as_str().unwrap_or_default() {
            "stdout" => stdout.push_str(extract_stream_text(&event)),
            "stderr" => stderr.push_str(extract_stream_text(&event)),
            "result" => {
                exit_code = event["exitCode"]
                    .as_i64()
                    .or_else(|| event["code"].as_i64())
                    .unwrap_or(0) as i32;
            }
            _ => {}
        }
    }

    JsSandboxExecResult {
        stdout,
        stderr,
        exit_code,
    }
}

fn extract_stream_text(event: &Value) -> &str {
    event["text"]
        .as_str()
        .or_else(|| event["data"].as_str())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{JsResourceLimits, JsVolumeMount};
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn create_dummy_spec() -> JsSandboxSpec {
        JsSandboxSpec {
            image_tag: "zkp-noir-env:latest".to_string(),
            env_vars: None,
            volumes: Some(vec![JsVolumeMount {
                name: "workspace".to_string(),
                kind: "workspace".to_string(),
                mount_path: "/workspace".to_string(),
                host_path: Some("/tmp/workspace".to_string()),
                sub_path: None,
                read_only: Some(false),
            }]),
            resource_limits: Some(JsResourceLimits {
                cpu_count: Some(2.0),
                memory_mb: Some(1024.0),
            }),
            network_policy: None,
            exposed_ports: Some(vec![3000]),
        }
    }

    #[test]
    fn test_normalize_lifecycle_base_url_adds_v1() {
        assert_eq!(
            normalize_lifecycle_base_url("http://127.0.0.1:8080"),
            "http://127.0.0.1:8080/v1"
        );
        assert_eq!(
            normalize_lifecycle_base_url("http://127.0.0.1:8080/v1"),
            "http://127.0.0.1:8080/v1"
        );
    }

    #[tokio::test]
    async fn test_opensandbox_boot_success_with_auth_header() {
        let mock_server = MockServer::start().await;
        let mock_response = json!({
            "id": "sbx-test-8f72",
            "status": {
                "ip": "10.0.0.25",
                "phase": "Running"
            }
        });

        Mock::given(method("POST"))
            .and(path("/v1/sandboxes"))
            .and(header("OPEN-SANDBOX-API-KEY", "lifecycle-key"))
            .respond_with(ResponseTemplate::new(201).set_body_json(&mock_response))
            .mount(&mock_server)
            .await;

        let provider = OpenSandboxProvider::new(
            mock_server.uri(),
            Some("lifecycle-key".to_string()),
            Some("exec-token".to_string()),
        );

        let result = provider.boot(&create_dummy_spec()).await.expect("Boot failed");

        assert_eq!(result.sandbox_id, "sbx-test-8f72");
        assert_eq!(result.ip_address.unwrap(), "10.0.0.25");
        assert_eq!(result.state, "RUNNING");
    }

    #[tokio::test]
    async fn test_opensandbox_get_status_maps_paused_state() {
        let mock_server = MockServer::start().await;
        let mock_response = json!({
            "id": "sbx-test-8f72",
            "status": {
                "ip": "10.0.0.25",
                "phase": "Paused"
            }
        });

        Mock::given(method("GET"))
            .and(path("/v1/sandboxes/sbx-test-8f72"))
            .respond_with(ResponseTemplate::new(200).set_body_json(&mock_response))
            .mount(&mock_server)
            .await;

        let provider = OpenSandboxProvider::new(mock_server.uri(), None, None);
        let result = provider.get_status("sbx-test-8f72").await.unwrap();

        assert_eq!(result.state, "PAUSED");
    }

    #[tokio::test]
    async fn test_resolve_exec_connection_returns_endpoint_and_token() {
        let mock_server = MockServer::start().await;

        Mock::given(method("GET"))
            .and(path("/v1/sandboxes/sbx-test-8f72/endpoints/44772"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({
                    "endpoint": "127.0.0.1:44772"
                })),
            )
            .mount(&mock_server)
            .await;

        let provider = OpenSandboxProvider::new(
            mock_server.uri(),
            None,
            Some("exec-token".to_string()),
        );
        let connection = provider
            .resolve_exec_connection("sbx-test-8f72")
            .await
            .unwrap();

        assert_eq!(connection.base_url, "http://127.0.0.1:44772");
        assert_eq!(connection.access_token.as_deref(), Some("exec-token"));
    }

    #[tokio::test]
    async fn test_exec_buffered_parses_sse_output() {
        let mock_server = MockServer::start().await;
        let endpoint_response = json!({ "endpoint": mock_server.uri() });
        let sse_body = [
            r#"data: {"type":"stdout","text":"hello "}"#,
            r#"data: {"type":"stderr","text":"warn"}"#,
            r#"data: {"type":"stdout","text":"world"}"#,
            r#"data: {"type":"result","exitCode":0}"#,
        ]
        .join("\n");

        Mock::given(method("GET"))
            .and(path("/v1/sandboxes/sbx-test-8f72/endpoints/44772"))
            .respond_with(ResponseTemplate::new(200).set_body_json(endpoint_response))
            .mount(&mock_server)
            .await;

        Mock::given(method("POST"))
            .and(path("/command"))
            .and(header("X-EXECD-ACCESS-TOKEN", "exec-token"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("content-type", "text/event-stream")
                    .set_body_string(sse_body),
            )
            .mount(&mock_server)
            .await;

        let provider = OpenSandboxProvider::new(
            mock_server.uri(),
            None,
            Some("exec-token".to_string()),
        );

        let result = provider
            .exec(
                "sbx-test-8f72",
                &JsSandboxExecRequest {
                    command: vec!["/bin/sh".to_string(), "-c".to_string(), "echo hello".to_string()],
                    cwd: Some("/workspace".to_string()),
                    env: None,
                },
            )
            .await
            .unwrap();

        assert_eq!(result.stdout, "hello world");
        assert_eq!(result.stderr, "warn");
        assert_eq!(result.exit_code, 0);
    }
}