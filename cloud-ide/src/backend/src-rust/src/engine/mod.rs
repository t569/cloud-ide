// backend/src-rust/src/engine/mod.rs

pub mod opensandbox;

// our custom tests
pub mod test;

use async_trait::async_trait;
use crate::{ExecPayload, JsSandboxSpec, JsSandboxStatus};

#[async_trait]
pub trait SandboxEngine: Send + Sync {
    async fn boot(&self, spec: &JsSandboxSpec) -> Result<JsSandboxStatus, String>;
    async fn get_status(&self, sandbox_id: &str) -> Result<JsSandboxStatus, String>;
    async fn pause(&self, sandbox_id: &str) -> Result<bool, String>;
    async fn destroy(&self, sandbox_id: &str) -> Result<bool, String>;
    async fn exec(&self, internal_ip: &str, payload: &ExecPayload) -> Result<String, String>;
}