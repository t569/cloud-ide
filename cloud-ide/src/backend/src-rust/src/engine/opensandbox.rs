// backend/src-rust/src/engine/opensandbox.rs

use super::{SandboxEngine, RustSandboxStatus};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;

pub struct OpenSandboxProvider {
    api_url: String,
    client: Client,
}

impl OpenSandboxProvider {
    pub fn new(api_url: String) -> Self {
        Self {
            api_url,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl SandboxEngine for OpenSandboxProvider {
    async fn boot(&self, image_tag: &str) -> Result<RustSandboxStatus, String> {
        let payload = json!({
            "image": { "uri": image_tag, "pullPolicy": "IfNotPresent" },
            "timeout": 3600,
            "resourceLimits": { "cpuCount": "1", "memoryMb": "512" },
            "entrypoint": ["sleep", "infinity"]
        });

        // Make the HTTP POST to the actual OpenSandbox daemon
        let res = self.client.post(format!("{}/sandboxes", self.api_url))
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("Engine rejected boot: {}", res.status()));
        }

        // Parse the response
        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        
        Ok(RustSandboxStatus {
            sandbox_id: data["id"].as_str().unwrap_or_default().to_string(),
            ip_address: data["status"]["ip"].as_str().unwrap_or_default().to_string(),
            state: "RUNNING".to_string(),
        })
    }

    // TODO: implement this function for our sandbox
    async fn get_status(&self, sandbox_id: &str) -> Result<RustSandboxStatus, String> {
        todo!()
    }

    async fn pause(&self, sandbox_id: &str) -> Result<bool, String> {
        let res = self.client.post(format!("{}/sandboxes/{}/pause", self.api_url, sandbox_id))
            .send()
            .await
            .map_err(|e| e.to_string())?;
            
        Ok(res.status().is_success())
    }

    async fn destroy(&self, sandbox_id: &str) -> Result<bool, String> {
        let res = self.client.delete(format!("{}/sandboxes/{}", self.api_url, sandbox_id))
            .send()
            .await
            .map_err(|e| e.to_string())?;
            
        Ok(res.status().is_success() || res.status().as_u16() == 404)
    }


    // this is for the exec commands we send to the sandbox: different for different backends
    async fn exec(&self, internal_ip: &str, payload: &crate::ExecPayload) -> Result<String, String> {
        
        // TODO: https links are not secure
        let execd_url = format!("http://{}:44772/exec", internal_ip);

        let req_body = serde_json::json!({
            "cmd": ["bash", "-c", payload.command],
            "cwd": payload.cwd,
            "env": {}
        });

        let res = self.client.post(&execd_url)
            .json(&req_body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("Execd daemon failed: {}", res.status()));
        }

        // Parse the raw stream output
        let output = res.text().await.map_err(|e| e.to_string())?;
        Ok(output)
    }
}


