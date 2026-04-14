# Prerequisites

## 🛠️ System Prerequisites
Before installing, ensure your development environment meets the strict architectural requirements for the Native FFI (Foreign Function Interface) engine:

*   **Node.js (v24.x 64-bit):** You must be running the x64 architecture of Node.js. 32-bit (ia32) will fail to bind to the Rust binaries. Verify with:
    ```bash
    node -p "process.arch"
    ```
*   **Rust Toolchain:** Install Rust via [rustup](https://rustup.rs).
*   **Microsoft C++ Build Tools (Windows Only):** The Rust compiler must use the MSVC toolchain to successfully inject the N-API Node.js handshake.
    *   **Run:** `rustup default stable-x86_64-pc-windows-msvc`
*   **Docker Desktop:** Required for the local OpenSandbox daemon.

## 🚀 Installation

Because this is a monorepo, you only ever run `npm install` at the root. Do not navigate into the individual folders to install baseline packages.

```bash
# From the root /cloud-ide/src directory
npm install
```

**What this does:** NPM will parse all three `package.json` files, download all dependencies, hoist shared libraries to the root `node_modules` to save space, and automatically symlink the `@cloud-ide/shared` package into both the frontend and backend.

## 🏃‍♂️ Running the Stack
You can boot the entire infrastructure (compiling the Rust engine, starting the Express Gateway, and launching the Vite frontend) with a single command:

```bash
# From the root directory
npm run dev
```

### Alternative Individual Commands:

*   `npm run dev:frontend` — Starts only the React UI.
*   `npm run dev:backend` — Cleans, rebuilds the Rust engine, and starts the API Gateway.

## 📦 Installing New Dependencies
To keep the monorepo clean, always use the `-w` (workspace) flag when installing new packages. This registers the package to the correct sub-folder while physically installing it at the root.

### Adding to the Frontend:

```bash
npm install date-fns -w frontend
npm install @types/date-fns -w frontend --save-dev
```

### Adding to the Backend:

```bash
npm install pg -w backend
```

### Adding to the Shared:
```bash
npm install zod -w shared
```