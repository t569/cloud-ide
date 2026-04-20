# OpenSandbox Provider Implementation Details


## Overview
The `opensandbox.rs` file contains the concrete implementation of the `SandboxEngine` trait, specifically engineered to interface with Alibaba's OpenSandbox architecture. 

OpenSandbox utilizes a dual-daemon architecture:
1. **The Python Lifecycle Daemon (Port 8080):** Handles provisioning, pausing, and destroying containers.
2. **The Go Execd Daemon (Internal Port 44772):** Runs *inside* the container namespace, executing raw commands and streaming output.

This file acts as a custom protocol bridge, translating our Cloud IDE's execution requests into the exact specifications required by these daemons.

## Core Engineering Mechanics

### 1. Separation of Concerns
The implementation is split into two internal clients to handle the dual-daemon architecture safely:
* `OpenSandboxLifecycleClient`: Manages state mutations (Boot, Pause, Resume) via standard REST payloads.
* `OpenSandboxExecResolver`: Handles the complex network topology required to tunnel into the container's execution context.

### 2. The Command Array Stitching (The Go Execd Boundary)
A critical feature of this implementation is the type coercion at the `execd` boundary. While the Node.js layer and the Rust FFI boundary correctly define the execution command as a `Vec<String>` (e.g., `["echo", "hello"]`), the internal Go daemon requires a flattened string. 
* **Implementation:** The Rust engine intercepts the vector and applies `.join(" ")` before transmitting the JSON payload. This prevents catastrophic unmarshal panics inside the container's Go runtime.

### 3. Dynamic Proxy Resolution (Docker-on-Windows Routing)
Native Docker container IP addresses (e.g., `10.0.x.x`) are often unroutable from a Windows host machine without complex bridge configurations. 
* **Implementation:** The `normalize_execd_base_url` function acts as a smart parser. When OpenSandbox spins up a local proxy path (e.g., `127.0.0.1:45792/proxy/44772`), this function ensures the proxy paths are not mangled by naive URL parsers that attempt to blindly append ports.

### 4. SSE Stream Parsing
Unlike traditional HTTP requests that wait for a process to finish, the Go `execd` daemon streams real-time output using Server-Sent Events (SSE). This is conceptually similar to parsing a custom client-server protocol.
* **Implementation:** The `parse_execd_stream` function buffers the raw HTTP body, splits it by lines, strips the `data: ` prefix, and deserializes the JSON chunks. It then maps these discrete events into our standardized `JsSandboxExecResult` containing consolidated `stdout`, `stderr`, and the final `exit_code`.

### 5. Centralized Timeout Management
To prevent zombie network connections or hanging execution threads from bleeding host resources, the provider reads `RUST_CONNECT_TIMEOUT` and `RUST_READ_TIMEOUT` directly from the environment. This ensures the `reqwest` client is aggressively tuned for a high-performance orchestration environment.