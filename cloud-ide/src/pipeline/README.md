# ⚙️ Pipeline Engine Internals

Welcome to the core build engine. This directory contains the business logic responsible for transforming a validated `EnvironmentConfig` (JSON) into a production-ready, highly optimized string `Dockerfile`.

This system is completely decoupled from our API controllers, control plane, and local file system. It acts as a pure, side-effect-free data transformation pipeline.

## 📁 Directory Structure

```text
pipeline/
├── types/
│   └── stage.ts                # Interfaces for DockerStages and Artifact Transfers
├── middleware/
│   ├── types.ts                # The 'PipelineInjector' interface contract
│   ├── MiddlewareEngine.ts     # The runner that executes registered plugins
│   └── injectors/
│       ├── OpenSandboxInjector.ts # Injects execd daemon & networking overrides
│       └── SecurityUserInjector.ts# Handles non-root user setup
├── assembler/
│   └── DockerfileAssembler.ts  # Compiles the final text and maps BuildKit caches
├── StageOrchestrator.ts        # Splits linear steps into Builder vs Runtime stages
└── ContextManager.ts           # Tracks WORKDIR, ENV, and User state during compilation
```

---

## 🔄 The Data Flow Lifecycle

When the `GeneratorService` passes data into this directory, it goes through a strict chronological transformation:

### 1. Orchestration (`StageOrchestrator.ts`)
* **Input:** `EnvironmentConfig` (Linear array of build steps)
* **Action:** It analyzes the steps using the "System Dependency Paradox" logic. It routes heavy compilation steps (like scoped `npm` or `cargo` installs) to a **Builder Stage**, and global tools (like `apt` or `curl`) to a **Runtime Stage**.
* **Output:** `PipelineManifest` (A multi-stage blueprint containing `ArtifactTransfer` maps).

### 2. Middleware Mutation (`middleware/MiddlewareEngine.ts`)
* **Input:** `PipelineManifest`
* **Action:** The manifest is passed sequentially through an array of plugins (`Injectors`). This is where we inject custom, environment-specific infrastructure logic (like OpenSandbox daemons or security policies) without polluting the core parser.
* **Output:** A mutated `PipelineManifest`.

### 3. State-Aware Assembly (`assembler/DockerfileAssembler.ts` & `ContextManager.ts`)
* **Input:** Mutated `PipelineManifest`
* **Action:** The Assembler iterates through the stages. It communicates with the `ContextManager` to track the current directory (`WORKDIR`) and prevent redundant shell commands. It looks up the correct bash syntax from `PackageManagerRules` and applies Docker BuildKit `--mount=type=cache` directives.
* **Output:** The final `Dockerfile` string.

---

## 🧩 Extending the Pipeline

This architecture follows the **Open-Closed Principle**: it is open for extension, but closed for modification. 

### Adding a New Backend Sandbox Provider
If we migrate away from OpenSandbox or need to support a secondary cloud provider, **do not touch the orchestrator or the assembler.**

1. Create a new file: `pipeline/middleware/injectors/NewBackendInjector.ts`.
2. Implement the `PipelineInjector` interface.
3. Use the `.inject()` method to push your custom daemons, `CMD` overrides, or environment variables into the `runtime` stage of the manifest.
4. Register it in the `MiddlewareEngine` inside the `GeneratorService`.

```typescript
// Example Implementation
export class DatadogTracingInjector implements PipelineInjector {
  name = 'DatadogTracing';
  description = 'Injects the DD tracing agent into the final runtime.';

  inject(manifest: PipelineManifest): PipelineManifest {
    const runtime = manifest.stages.find(s => s.role === 'runtime');
    
    // Inject the installation step at the end of the runtime build
    runtime.steps.push({
      name: 'Install Datadog Agent',
      type: 'shell',
      command: 'curl -L https://datadoghq.com/install.sh | bash'
    });

    return manifest;
  }
}
```

### Fixing Redundant `cd` Commands
If the output Dockerfile is producing unnecessary directory hopping, check the `ContextManager.ts` implementation inside `DockerfileAssembler.buildStage()`. The Context Manager is responsible for ensuring `WORKDIR` is only injected when the `targetPath` explicitly changes from the previous step.

---

## 🛡️ Key Architectural Guarantees
* **Layer Flattening:** The Assembler automatically groups stage environment variables into a single `ENV` line with `\` breaks to minimize Docker layer metadata.
* **Zero-Waste:** If the Orchestrator detects a payload with no compilation steps (e.g., only `apt` packages), it bypasses the multi-stage logic and generates a single-stage runtime image to save build time.
* **BuildKit First:** All output enforces `# syntax=docker/dockerfile:1.4` to ensure modern caching mechanisms work flawlessly.