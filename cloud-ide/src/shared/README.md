# 📁 SHARED WORKSPACE: ./shared/README.md

## Cloud IDE - Shared Types
This is a private, internal NPM package containing the universal Data Transfer Objects (DTOs), interfaces, and type definitions shared exactly between the Rust Data Plane, the Node API Gateway, and the React Frontend.


### 🧠 Philosophy
By keeping our `SandboxSpec`, `SandboxStatus`, and `SandboxExecResult` definitions here, we guarantee full-stack type safety. If the backend changes an API response property, the frontend TypeScript compiler will immediately flag the breaking change.


### 🚀 How it Works
You do not need to build or publish this package.

NPM Workspaces handles this automatically. When you run `npm install` at the project root, NPM creates a symlink in the root `node_modules` pointing directly to this folder.

Any file in the frontend or backend can simply import:

```typescript
import { SandboxSpec } from '@cloud-ide/shared/types';
```

### 📦 Adding Dependencies

Typically, this package should only contain type definitions and zero runtime dependencies. However, if you need a utility library (like `zod` for validation), you can install it via the root workspace:

```bash
# From the root directory
npm install zod -w shared
```