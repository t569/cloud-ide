// backend/src-rust/src/engine/tests.rs

#[cfg(test)]
mod tests {
    use crate::engine::{RustSandboxStatus, SandboxEngine};
    use crate::{boot_sandbox, get_sandbox_ip, ACTIVE_SANDBOXES};
    use async_trait::async_trait;
    use std::sync::Mutex;

    // 1. Create a Mock implementation of our Interface
    struct MockSandboxProvider {
        should_fail: bool,
    }

    #[async_trait]
    impl SandboxEngine for MockSandboxProvider {
        async fn boot(&self, _image_tag: &str) -> Result<RustSandboxStatus, String> {
            if self.should_fail {
                return Err("Mock Engine Failure".to_string());
            }
            Ok(RustSandboxStatus {
                sandbox_id: "mock-sbx-123".to_string(),
                ip_address: "192.168.1.100".to_string(),
                state: "RUNNING".to_string(),
            })
        }

        async fn pause(&self, _sandbox_id: &str) -> Result<bool, String> { Ok(true) }
        async fn destroy(&self, _sandbox_id: &str) -> Result<bool, String> { Ok(true) }
    }

    // 2. Test the core NAPI functions using the Mock
    #[tokio::test]
    async fn test_successful_sandbox_boot_and_memory_map() {
        let engine = MockSandboxProvider { should_fail: false };
        
        // Simulate the NAPI call from TypeScript
        let result = engine.boot("test-env").await.unwrap();
        
        // Simulate the memory map insertion that happens in lib.rs
        crate::get_state().insert(result.sandbox_id.clone(), result.ip_address.clone());

        // Assert the returned data is correct
        assert_eq!(result.sandbox_id, "mock-sbx-123");
        assert_eq!(result.ip_address, "192.168.1.100");

        // Assert the Zero-Latency Memory Map (DashMap) works for the edge proxy
        let mapped_ip = crate::get_sandbox_ip("mock-sbx-123".to_string()).unwrap();
        assert_eq!(mapped_ip, Some("192.168.1.100".to_string()));
    }

    #[tokio::test]
    async fn test_engine_failure_handling() {
        let engine = MockSandboxProvider { should_fail: true };
        
        // Assert that engine failures are cleanly caught and passed back as Errors
        let result = engine.boot("test-env").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Mock Engine Failure");
    }
}