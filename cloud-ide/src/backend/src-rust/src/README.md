# Cloud IDE Rust Sandbox Engine (Kernel)

## Overview
This directory contains the core execution engine for the Cloud IDE. Operating as a highly performant, memory-safe middleware, it bridges the Node.js API Gateway (User Space) and the underlying container hypervisors (Kernel Space). 

By leveraging Rust and Node-API (N-API), we bypass the standard Node.js single-threaded event loop bottlenecks. The engine handles complex container orchestration, internal routing state, and high-throughput execution streams with bare-metal efficiency.

## Architectural Diagram & FFI Boundary

    [ Node.js API Gateway ]
              |  (N-API / FFI Boundary)
              v
    [ Rust `lib.rs` (Exported Controllers) ]
              |  (Dynamic Engine Injector)
              v
    [ `SandboxEngine` Trait (`mod.rs`) ]
              |  (Polymorphic Dispatch)
              v
    [ Concrete Provider (e.g., `opensandbox.rs`) ]
              |  (HTTP / SSE Protocols)
              v
    [ Container Daemon / Hardware ]


## Directory Structure & File Roles

### 1. `lib.rs` (The Syscall Interface)
This is the Foreign Function Interface (FFI) boundary. It exposes strictly typed Rust functions to TypeScript.
* **Data Transfer Objects (DTOs):** Structs like `JsSandboxSpec` and `JsSandboxExecResult` enforce strict type safety across the language barrier.
* **The Global State Cache:** Uses a thread-safe `OnceLock<DashMap<String, String>>` to cache the internal IP addresses of running sandboxes. This prevents the engine from constantly querying the Docker daemon during rapid, high-frequency execution requests.
* **Dynamic Engine Injector:** Reads the `ENGINE_TYPE` environment variable to determine which hypervisor to boot, allowing seamless switching between local Docker, Kubernetes, or cloud-native VMs without altering the Node.js layer.

### 2. `mod.rs` (The Hardware Abstraction Layer)
This file defines the `SandboxEngine` async trait. It acts as our architectural contract.
* **Why an Interface?** By defining a standard set of methods (`boot`, `pause`, `resume`, `exec`, `destroy`), the system is completely decoupled from any single container technology. 
* **Future-Proofing:** If the infrastructure transitions from Docker to AWS Firecracker microVMs or a custom agent sandbox, the Node.js Gateway requires zero modifications. A new Rust struct simply needs to implement this trait.

### 3. `opensandbox.rs` (The Concrete Implementation)
This is the specific implementation of the `SandboxEngine` trait for Alibaba's OpenSandbox API. It translates our standardized trait commands into the specific REST and Server-Sent Events (SSE) payloads required by the OpenSandbox daemons. 
*(See `OPENSANDBOX_IMPLEMENTATION.md` for deep-dive mechanics on this specific provider).*

## Implementing a New Engine

To add a new compute provider (e.g., `KubernetesEngine`):
1. Create a new file: `src/engine/kubernetes.rs`.
2. Define your struct: `pub struct KubernetesEngine { ... }`.
3. Implement the contract: `#[async_trait] impl SandboxEngine for KubernetesEngine { ... }`.
4. Update `get_active_engine()` in `lib.rs` to initialize your new struct when the corresponding `.env` flag is detected.