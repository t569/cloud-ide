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

#[async_trait]
pub trait SandboxEngine: Send + Sync {
    async fn boot(&self, spec: &JsSandboxSpec) -> Result<JsSandboxStatus, String>;
    async fn get_status(&self, sandbox_id: &str) -> Result<JsSandboxStatus, String>;
    async fn pause(&self, sandbox_id: &str) -> Result<bool, String>;
    async fn resume(&self, sandbox_id: &str) -> Result<bool, String>;
    async fn destroy(&self, sandbox_id: &str) -> Result<bool, String>;
    async fn exec(
        &self,
        sandbox_id: &str,
        payload: &JsSandboxExecRequest,
    ) -> Result<JsSandboxExecResult, String>;
    async fn resolve_exec_connection(&self, sandbox_id: &str) -> Result<JsExecConnection, String>;
}
