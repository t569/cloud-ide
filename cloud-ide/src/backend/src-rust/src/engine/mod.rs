// backend/src-rust/src/engine/mod.rs

pub mod opensandbox;

// our custom tests
pub mod tests;

use async_trait::async_trait;
use crate::{
    JsExecConnection,
    JsSandboxExecRequest,
    JsSandboxExecResult,
    JsSandboxSpec,
    JsSandboxStatus,
};

/// The core polymorphic contract for the Cloud IDE execution layer.
/// 
/// Any compute provider (Docker, Kubernetes, AWS Firecracker microVMs, agentsandbox etc.) must 
/// implement this trait to be natively controlled by the Node.js API Gateway.

#[async_trait]
pub trait SandboxEngine: Send + Sync {

    /// Provisions a new compute environment based on the provided hardware/software spec.
    async fn boot(&self, spec: &JsSandboxSpec) -> Result<JsSandboxStatus, String>;

    /// Polls the underlying container engine for the current lifecycle state.
    async fn get_status(&self, sandbox_id: &str) -> Result<JsSandboxStatus, String>;

    /// Freezes the container via cgroups to save host CPU cycles.
    async fn pause(&self, sandbox_id: &str) -> Result<bool, String>;

    /// Thaws a frozen container, restoring it to the host CPU scheduler.
    async fn resume(&self, sandbox_id: &str) -> Result<bool, String>;

    /// Forcefully terminates the container and releases all attached volumes/network interfaces.
    async fn destroy(&self, sandbox_id: &str) -> Result<bool, String>;

    /// Executes a command synchronously inside the container and buffers the SSE output 
    /// into standard stdout/stderr strings.
    async fn exec(
        &self,
        sandbox_id: &str,
        payload: &JsSandboxExecRequest,
    ) -> Result<JsSandboxExecResult, String>;

    /// Resolves the internal networking proxy required to stream data to/from the container.
    async fn resolve_exec_connection(&self, sandbox_id: &str) -> Result<JsExecConnection, String>;
}
