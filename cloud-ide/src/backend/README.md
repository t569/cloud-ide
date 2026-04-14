# 📁 BACKEND WORKSPACE: ./backend/README.md

## Cloud IDE - Backend & Engine

This directory contains the brains of the Cloud IDE. It is a hybrid architecture consisting of a Node.js (Express) API Gateway and a highly optimized Rust N-API execution engine that interfaces with Alibaba's OpenSandbox.

## 🏗️ Architecture

*   **API Gateway (`src/server.ts`):** Handles HTTP routing, REST endpoints, streaming SSE connections to the frontend, and system-wide orchestration.
*   **Rust Engine (`src-rust/`):** Compiled into a native `index.node` dynamic library. This handles all direct communication, polling, and FFI binding with the underlying Docker containers via the OpenSandbox Daemon.

> [!CAUTION]
> ### ⚠️ Critical Setup: The Rust Toolchain
> The backend relies on `napi-rs` to bridge Node.js and Rust. This compilation is extremely strict. If you are developing on Windows, you **MUST** ensure you are using the Microsoft MSVC toolchain, otherwise Node.js will throw a `Module did not self-register` error.

#### Verify your setup:

1.  **Ensure your Node.js is 64-bit:** `node -p "process.arch"` should output `x64`.
2.  **Set your Rust compiler to MSVC:**

```bash
rustup default stable-x86_64-pc-windows-msvc
```

## 🚀 Running the Server
The backend has a dedicated, unified development script that prevents "ghost binary" caching issues.

```bash
# From the /backend directory
npm run dev
```

**What this script does:**

*   **Triggers `npm run clean:rust`:** Deletes any corrupted or locked `index.node` files.
*   **Triggers `napi build`:** Compiles the Rust engine into a fresh `.node` binary.
*   **Triggers `ts-node src/server.ts`:** Starts the Express gateway.

## 🧪 Running Tests
The backend includes an end-to-end API test that validates the full Node -> Rust -> Docker pipeline.

```bash
# 1. Start the server in Terminal A
npm run dev

# 2. Run the integration test in Terminal B
npx ts-node src/__tests__/test-api.ts
```

## 📦 Managing Dependencies

Use the workspace flag from the root, or install directly if you are within the folder.

### Adding Node modules:
```bash
# Example for installing within the /backend directory
npm install <package-name>
```

```bash
# from the root directory
npm install multer -w backend
```

### Adding Rust Crates:

To add Rust dependencies, navigate into the `src-rust` folder and use Cargo:

```bash
cd src-rust
cargo add serde_json
```