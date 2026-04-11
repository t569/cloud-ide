// backend/src-rust/src/lib.rs

#![deny(clippy::all)]

pub mod engine;

use dashmap::DashMap;
use napi_derive::napi;
use std::sync::OnceLock;

use crate::engine::opensandbox::OpenSandboxProvider;
use crate::engine::SandboxEngine;

// ==========================================
// THE DYNAMIC ENGINE INJECTOR
// ==========================================

/// Reads the environment configuration and injects the correct backend.
/// Returning `Box<dyn SandboxEngine>` allows dynamic dispatch at runtime.
fn get_active_engine() -> Box<dyn SandboxEngine> {
    // TODO: we need to add a .env for engine type specifying opensandbox
    let engine_type = std::env::var("ENGINE_TYPE").unwrap_or_else(|_| "opensandbox".to_string());
    
    match engine_type.as_str() {
        "opensandbox" => {
            let api_url = std::env::var("OPENSANDBOX_API_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
            Box::new(OpenSandboxProvider::new(api_url))
        },
        "zig_custom" => {
            // Future implementation!
            // Box::new(ZigRuntimeProvider::new())
            panic!("Zig backend not yet implemented!")
        },
        _ => panic!("Unknown ENGINE_TYPE specified in environment"),
    }
}

// 1. Thread-safe memory map for instant routing (SandboxId -> Internal IP)
static ACTIVE_SANDBOXES: OnceLock<DashMap<String, String>> = OnceLock::new();

fn get_state() -> &'static DashMap<String, String> {
    ACTIVE_SANDBOXES.get_or_init(DashMap::new)
}

// ==========================================
// NAPI DATA STRUCTURES (TypeScript Mappings)
// ==========================================

#[napi(object)]
pub struct ProvisioningPayload {
    pub provider_type: Option<String>, 
    pub repo_url: Option<String>,
    pub branch: Option<String>,
}

#[napi(object)]
pub struct BootResponse {
    pub sandbox_id: String,
    pub state: String,
    pub ip_address: String,
}

#[napi(object)]
pub struct StatusResponse {
    pub sandbox_id: String,
    pub state: String,
    pub message: String,
}

#[napi(object)]
pub struct ExecPayload {
    pub command: String,
    pub cwd: String,
}

// ==========================================
// EXPORTED RUST CONTROLLERS
// ==========================================

/// POST /api/v1/sandboxes
#[napi]
pub async fn boot_sandbox(environment_id: String, _provisioning: Option<ProvisioningPayload>) -> napi::Result<BootResponse> {
    let engine = get_active_engine(); 
    
    let status = engine.boot(&environment_id).await
        .map_err(|e| napi::Error::from_reason(e))?;

    get_state().insert(status.sandbox_id.clone(), status.ip_address.clone());

    Ok(BootResponse {
        sandbox_id: status.sandbox_id,
        state: status.state,
        ip_address: status.ip_address,
    })
}

/// GET /api/v1/sandboxes/:sandboxId/status
#[napi]
pub async fn get_sandbox_status(sandbox_id: String) -> napi::Result<StatusResponse> {
    let engine = get_active_engine();
    
    let status = engine.get_status(&sandbox_id).await
        .map_err(|e| napi::Error::from_reason(e))?;
    
    Ok(StatusResponse {
        sandbox_id: status.sandbox_id,
        state: status.state,
        message: "Status retrieved successfully".to_string(),
    })
}

/// POST /api/v1/sandboxes/:sandboxId/exec
#[napi]
pub async fn exec_command(sandbox_id: String, payload: ExecPayload) -> napi::Result<String> {
    // 1. Zero-latency lookup for the internal IP
    let ip_address = match get_state().get(&sandbox_id) {
        Some(ip) => ip.clone(),
        None => return Err(napi::Error::from_reason("Sandbox not found in active memory map")),
    };

    let engine = get_active_engine();
    
    // 2. Delegate execution to the underlying engine protocol
    let output = engine.exec(&ip_address, &payload).await
        .map_err(|e| napi::Error::from_reason(e))?;

    Ok(output)
}

/// POST /api/v1/sandboxes/:sandboxId/pause
#[napi]
pub async fn pause_sandbox(sandbox_id: String) -> napi::Result<bool> {
    let engine = get_active_engine();
    
    let success = engine.pause(&sandbox_id).await
        .map_err(|e| napi::Error::from_reason(e))?;
    
    Ok(success)
}

/// DELETE /api/v1/sandboxes/:sandboxId
#[napi]
pub async fn destroy_sandbox(sandbox_id: String) -> napi::Result<bool> {
    let engine = get_active_engine();
    
    let success = engine.destroy(&sandbox_id).await
        .map_err(|e| napi::Error::from_reason(e))?;

    if success {
        get_state().remove(&sandbox_id);
    }

    Ok(success)
}

/// Helper: Synchronous IP lookup for Node.js edge proxying
#[napi]
pub fn get_sandbox_ip(sandbox_id: String) -> napi::Result<Option<String>> {
    Ok(get_state().get(&sandbox_id).map(|ip| ip.clone()))
}