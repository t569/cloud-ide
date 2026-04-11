// backend/src-rust/src/engine/opensandbox.rs


/**
 * Implement our sanbox engine API for open sandbox
 */

use super::SandboxEngine;
use crate::{ExecPayload, JsSandboxSpec, JsSandboxStatus};
use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;

pub struct OpenSandboxProvider {
    api_url: String,
    client: Client,
}

impl OpenSandboxProvider {
    pub fn new(api_url: String) -> Self {
        Self { api_url, client: Client::new() }
    }
}

#[async_trait]
impl SandboxEngine for OpenSandboxProvider {

    // DEFAULT BOOT FUNCTIONS
    async fn boot(&self, spec: &JsSandboxSpec) -> Result<JsSandboxStatus, String> {
        // Extract dynamically provided limits or fall back to defaults
        let cpu = spec.resource_limits.as_ref().and_then(|r| r.cpu_count).unwrap_or(1.0);
        let mem = spec.resource_limits.as_ref().and_then(|r| r.memory_mb).unwrap_or(512.0);

        // Map environment variables
        let env_vars = spec.env_vars.clone().unwrap_or_default();

        let payload = json!({
            "image": { "uri": &spec.image_tag, "pullPolicy": "IfNotPresent" },
            "timeout": 3600,
            "resourceLimits": { "cpuCount": cpu.to_string(), "memoryMb": mem.to_string() },
            "env": env_vars,
            "entrypoint": ["sleep", "infinity"]
        });

        let res = self.client.post(format!("{}/sandboxes", self.api_url))
            .json(&payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("Engine rejected boot: {}", res.status()));
        }

        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        
        Ok(JsSandboxStatus {
            sandbox_id: data["id"].as_str().unwrap_or_default().to_string(),
            state: "RUNNING".to_string(), // Mapped to SandboxState in TS
            ip_address: data["status"]["ip"].as_str().map(|s| s.to_string()),
            execd_port: Some(44772), 
            message: Some("Provisioned successfully via OpenSandbox".to_string()),
            preview_urls: None,
        })
    }


    // GET GET_STATUS/ http://opensandbox_url/sandboxes/sandbox_id
    async fn get_status(&self, sandbox_id: &str) -> Result<JsSandboxStatus, String> {
        let res = self.client.get(format!("{}/sandboxes/{}", self.api_url, sandbox_id))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("Failed to fetch status: {}", res.status()));
        }

        let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        
        // Map OpenSandbox's internal state to our strict TypeScript SandboxState schema
        let raw_status = data["status"]["phase"].as_str().unwrap_or("UNKNOWN");
        let mapped_state = match raw_status {
            "Running" => "RUNNING",
            "Pending" => "PROVISIONING",
            "Paused"  => "PAUSED",
            "Stopped" => "STOPPED",
            _         => "ERROR",
        };

        Ok(JsSandboxStatus {
            sandbox_id: sandbox_id.to_string(),
            state: mapped_state.to_string(),
            ip_address: data["status"]["ip"].as_str().map(|s| s.to_string()),
            execd_port: Some(44772),
            message: Some("Status retrieved successfully".to_string()),
            preview_urls: None, // Can be populated dynamically if OpenSandbox exposes routes
        })
    }


    // POST PAUSE/ http://opensandbox_url/sandboxes/sandbox_id/pause
    async fn pause(&self, sandbox_id: &str) -> Result<bool, String> {
        let res = self.client.post(format!("{}/sandboxes/{}/pause", self.api_url, sandbox_id))
            .send()
            .await
            .map_err(|e| e.to_string())?;
            
        Ok(res.status().is_success())
    }


    // DELETE DESTROY/ https://opensandbox_url/sandboxes/sandbox_id
    async fn destroy(&self, sandbox_id: &str) -> Result<bool, String> {
        let res = self.client.delete(format!("{}/sandboxes/{}", self.api_url, sandbox_id))
            .send()
            .await
            .map_err(|e| e.to_string())?;
            
        // We consider a 404 (Not Found) as a successful destroy since the container is already gone
        Ok(res.status().is_success() || res.status().as_u16() == 404)
    }


    // POST EXEC/ https://opensandbox_url:44772/exec
    async fn exec(&self, internal_ip: &str, payload: &crate::ExecPayload) -> Result<String, String> {
        // Route directly to the container's internal execd daemon bypassing the main API
        let execd_url = format!("http://{}:44772/exec", internal_ip);
        
        let req_body = serde_json::json!({
            "cmd": ["bash", "-c", &payload.command],
            "cwd": &payload.cwd,
            "env": {} 
        });

        let res = self.client.post(&execd_url)
            .json(&req_body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            return Err(format!("Execd daemon failed with status: {}", res.status()));
        }

        // Return the raw stdout/stderr text stream back across the FFI boundary
        let output = res.text().await.map_err(|e| e.to_string())?;
        Ok(output)
    }
}