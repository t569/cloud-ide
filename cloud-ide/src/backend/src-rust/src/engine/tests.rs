// backend/src-rust/src/engine/tests.rs

#[cfg(test)]
mod tests {
    use crate::engine::SandboxEngine;
    use crate::{
        JsExecConnection,
        JsSandboxExecRequest,
        JsSandboxExecResult,
        JsSandboxSpec,
        JsSandboxStatus,
    };
    use async_trait::async_trait;

    // 1. Create a Mock implementation of our Interface
    struct MockSandboxProvider {
        should_fail: bool,
    }

    #[async_trait]
    impl SandboxEngine for MockSandboxProvider {
        async fn boot(&self, _spec: &JsSandboxSpec) -> Result<JsSandboxStatus, String> {
            if self.should_fail {
                return Err("Mock Engine Failure".to_string());
            }
            Ok(JsSandboxStatus {
                sandbox_id: "mock-sbx-123".to_string(),
                state: "RUNNING".to_string(),
                ip_address: Some("192.168.1.100".to_string()),
                execd_port: Some(44772),
                message: Some("Provisioned successfully".to_string()),
                preview_urls: None,
            })
        }

        async fn get_status(&self, sandbox_id: &str) -> Result<JsSandboxStatus, String> {
            if self.should_fail {
                return Err("Mock Status Failure".to_string());
            }
            Ok(JsSandboxStatus {
                sandbox_id: sandbox_id.to_string(),
                state: "RUNNING".to_string(),
                ip_address: Some("192.168.1.100".to_string()),
                execd_port: Some(44772),
                message: None,
                preview_urls: None,
            })
        }

        async fn pause(&self, _sandbox_id: &str) -> Result<bool, String> {
            if self.should_fail { return Err("Mock Pause Failure".to_string()); }
            Ok(true)
        }

        async fn resume(&self, _sandbox_id: &str) -> Result<bool, String> {
            if self.should_fail { return Err("Mock Resume Failure".to_string()); }
            Ok(true)
        }

        async fn destroy(&self, _sandbox_id: &str) -> Result<bool, String> {
            if self.should_fail { return Err("Mock Destroy Failure".to_string()); }
            Ok(true)
        }

        async fn exec(
            &self,
            _sandbox_id: &str,
            payload: &JsSandboxExecRequest,
        ) -> Result<JsSandboxExecResult, String> {
            if self.should_fail { return Err("Mock Exec Failure".to_string()); }
            Ok(JsSandboxExecResult {
                stdout: format!("Executed '{:?}' in mock workspace", payload.command),
                stderr: String::new(),
                exit_code: 0,
            })
        }

        async fn resolve_exec_connection(&self, _sandbox_id: &str) -> Result<JsExecConnection, String> {
            if self.should_fail { return Err("Mock Resolve Failure".to_string()); }
            Ok(JsExecConnection {
                base_url: "http://127.0.0.1:44772".to_string(),
                access_token: Some("test-token".to_string()),
            })
        }
    }

    // 2. Helper to generate a valid dummy spec for testing
    fn create_dummy_spec() -> JsSandboxSpec {
        JsSandboxSpec {
            image_tag: "test-env:latest".to_string(),
            env_vars: None,
            volumes: None,
            resource_limits: None,
            network_policy: None,
            exposed_ports: None,
        }
    }

    // 3. Test the core NAPI functions using the Mock
    #[tokio::test]
    async fn test_successful_sandbox_boot_and_memory_map() {
        let engine = MockSandboxProvider { should_fail: false };
        let spec = create_dummy_spec();
        
        // Simulate the engine boot call
        let result = engine.boot(&spec).await.unwrap();
        
        // Simulate the memory map insertion that happens in lib.rs
        if let Some(ref ip) = result.ip_address {
            crate::get_state().insert(result.sandbox_id.clone(), ip.clone());
        }

        // Assert the returned data matches our strict schema requirements
        assert_eq!(result.sandbox_id, "mock-sbx-123");
        assert_eq!(result.ip_address.unwrap(), "192.168.1.100");
        assert_eq!(result.execd_port.unwrap(), 44772);

        // Assert the Zero-Latency Memory Map (DashMap) works for the edge proxy
        let mapped_ip = crate::get_sandbox_ip("mock-sbx-123".to_string()).unwrap();
        assert_eq!(mapped_ip, Some("192.168.1.100".to_string()));
    }

    #[tokio::test]
    async fn test_engine_failure_handling() {
        let engine = MockSandboxProvider { should_fail: true };
        let spec = create_dummy_spec();
        
        // Assert that engine failures are cleanly caught and passed back as Errors
        let result = engine.boot(&spec).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Mock Engine Failure");
    }

    #[tokio::test]
    async fn test_sandbox_exec_pipeline() {
        let engine = MockSandboxProvider { should_fail: false };
        let payload = JsSandboxExecRequest {
            command: vec!["npm".to_string(), "run".to_string(), "build".to_string()],
            cwd: Some("/workspace".to_string()),
            env: None,
        };

        // Ensure the payload passes successfully through the mock execd daemon
        let result = engine.exec("mock-sbx-123", &payload).await.unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("npm"));
    }

    #[tokio::test]
    async fn test_resolve_exec_connection() {
        let engine = MockSandboxProvider { should_fail: false };
        let result = engine.resolve_exec_connection("mock-sbx-123").await.unwrap();

        assert_eq!(result.base_url, "http://127.0.0.1:44772");
        assert_eq!(result.access_token.as_deref(), Some("test-token"));
    }
}
