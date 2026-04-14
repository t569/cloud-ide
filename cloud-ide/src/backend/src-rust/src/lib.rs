// backend/src-rust/src/lib.rs

#![deny(clippy::all)]

pub mod engine;

use dashmap::DashMap;
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::OnceLock;

use crate::engine::opensandbox::OpenSandboxProvider;
use crate::engine::SandboxEngine;

// ==========================================
// THE DYNAMIC ENGINE INJECTOR
// ==========================================
fn get_active_engine() -> Box<dyn SandboxEngine> {
    // TODO: we need to add a .env file to dynamically select the type of sandbox we are using
    // Default to open sandbox
    let engine_type = std::env::var("ENGINE_TYPE").unwrap_or_else(|_| "opensandbox".to_string());
    
    match engine_type.as_str() {
        "opensandbox" => {
            let api_url = std::env::var("OPENSANDBOX_API_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
            let api_key = std::env::var("OPENSANDBOX_API_KEY").ok();
            let execd_access_token = std::env::var("OPENSANDBOX_EXECD_ACCESS_TOKEN").ok();
            Box::new(OpenSandboxProvider::new(api_url, api_key, execd_access_token))
        },
        _ => panic!("Unknown ENGINE_TYPE specified in environment"),
    }
}


static ACTIVE_SANDBOXES: OnceLock<DashMap<String, String>> = OnceLock::new();

fn get_state() -> &'static DashMap<String, String> {
    ACTIVE_SANDBOXES.get_or_init(DashMap::new)
}

// ==========================================
// NAPI DATA STRUCTURES (Mirrors sandbox.ts)
// ==========================================
#[derive(Debug, Clone)]
#[napi(object)]
pub struct JsVolumeMount {
    pub name: String,
    pub kind: String,
    pub mount_path: String,
    pub host_path: Option<String>,
    pub sub_path: Option<String>,
    pub read_only: Option<bool>,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct JsNetworkPolicySpec {
    pub allow_outbound_domains: Vec<String>,
    pub block_all_oter_traffic: bool, // Matching the typo in your TS file to prevent parsing errors
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct JsResourceLimits {
    pub cpu_count: Option<f64>,
    pub memory_mb: Option<f64>,
}

// Maps perfectly to SandboxSpec
#[derive(Debug, Clone)]
#[napi(object)]
pub struct JsSandboxSpec {
    pub image_tag: String,
    pub env_vars: Option<HashMap<String, String>>,
    pub volumes: Option<Vec<JsVolumeMount>>,
    pub resource_limits: Option<JsResourceLimits>,
    pub network_policy: Option<JsNetworkPolicySpec>,
    pub exposed_ports: Option<Vec<u32>>,
}

// Maps perfectly to SandboxStatus
#[derive(Debug, Clone)]
#[napi(object)]
pub struct JsSandboxStatus {
    pub sandbox_id: String,
    pub state: String,
    pub ip_address: Option<String>,
    pub execd_port: Option<u32>,
    pub message: Option<String>,
    pub preview_urls: Option<HashMap<String, String>>,
}

#[derive(Debug)]
#[napi(object)]
pub struct JsSandboxExecRequest {
    pub command: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct JsSandboxExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone)]
#[napi(object)]
pub struct JsExecConnection {
    pub base_url: String,
    pub access_token: Option<String>,
}


// ==========================================
// EXPORTED RUST CONTROLLERS
// ==========================================

#[napi]
pub async fn boot_sandbox(spec: JsSandboxSpec) -> napi::Result<JsSandboxStatus> {
    let engine = get_active_engine(); 
    
    let status = engine.boot(&spec).await
        .map_err(|e| napi::Error::from_reason(e))?;

    // Store internal IP for routing if it exists
    if let Some(ip) = &status.ip_address {
        get_state().insert(status.sandbox_id.clone(), ip.clone());
    }

    Ok(status)
}

#[napi]
pub async fn get_sandbox_status(sandbox_id: String) -> napi::Result<JsSandboxStatus> {
    let engine = get_active_engine();
    let status = engine
        .get_status(&sandbox_id)
        .await
        .map_err(|e| napi::Error::from_reason(e))?;

    if let Some(ip) = &status.ip_address {
        get_state().insert(status.sandbox_id.clone(), ip.clone());
    }

    Ok(status)
}

#[napi]
pub async fn exec_command(
    sandbox_id: String,
    payload: JsSandboxExecRequest,
) -> napi::Result<JsSandboxExecResult> {
    let engine = get_active_engine();
    engine
        .exec(&sandbox_id, &payload)
        .await
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub async fn pause_sandbox(sandbox_id: String) -> napi::Result<bool> {
    let engine = get_active_engine();
    engine.pause(&sandbox_id).await.map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub async fn resume_sandbox(sandbox_id: String) -> napi::Result<bool> {
    let engine = get_active_engine();
    engine.resume(&sandbox_id).await.map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub async fn destroy_sandbox(sandbox_id: String) -> napi::Result<bool> {
    let engine = get_active_engine();
    let success = engine.destroy(&sandbox_id).await.map_err(|e| napi::Error::from_reason(e))?;


    if success {
        get_state().remove(&sandbox_id);
    }
    Ok(success)
}

#[napi]
pub fn get_sandbox_ip(sandbox_id: String) -> napi::Result<Option<String>> {
    Ok(get_state().get(&sandbox_id).map(|ip| ip.clone()))
}

#[napi]
pub async fn resolve_exec_connection(sandbox_id: String) -> napi::Result<JsExecConnection> {
    let engine = get_active_engine();
    engine
        .resolve_exec_connection(&sandbox_id)
        .await
        .map_err(|e| napi::Error::from_reason(e))
}