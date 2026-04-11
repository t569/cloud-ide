// backend/src-rust/src/engine/mod.rs

pub mod opensandbox;
mod test;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::ExecPayload;

// The struct we will pass back across the FFI boundary to TypeScript
#[derive(Serialize, Deserialize, Clone)]
pub struct RustSandboxStatus {
    pub sandbox_id: String,
    pub ip_address: String,
    pub state: String,
}

// THE INTERFACE: Any sandbox technology you ever plug in must implement this trait.
#[async_trait]
pub trait SandboxEngine: Send + Sync {
    /// Requests compute resources from the underlying infrastructure
    async fn boot(&self, image_tag: &str) -> Result<RustSandboxStatus, String>;
    
    /// Get the sandbox status
    async fn get_status(&self, sandbox_id: &str) -> Result<RustSandboxStatus, String>;

    /// Freezes the compute container
    async fn pause(&self, sandbox_id: &str) -> Result<bool, String>;
    
    /// Obliterates the container
    async fn destroy(&self, sandbox_id: &str) -> Result<bool, String>;

    /// Exec abstracts how commands run. OpenSandbox uses HTTP, a Zig VM might use raw pipes.
    async fn exec(&self, internal_ip: &str, payload: &ExecPayload) -> Result<String, String>;
}