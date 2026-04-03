# 🐳 Cloud IDE Docker Generation Engine

Welcome to the core build engine for the **Cloud IDE**.

This repository houses a **Declarative, Multi-Stage Dockerfile Generation Pipeline**. It is designed to translate simple JSON configurations from the frontend into highly optimized, BuildKit-native, secure Docker containers ready for sandbox execution.

Unlike linear script scaffolding, this engine uses an **enterprise-grade middleware architecture** to safely handle dependency graphing, security checks, and custom daemon injections without creating spaghetti code.

---

## 🏗️ Architecture Overview
The generation pipeline is strictly divided into 5 decoupled phases, managed by the `DockerGeneratorService`.

### The 5-Phase Lifecycle
1.  **Phase 1: Parsing & Validation** (`Validator.ts`)
2.  **Phase 2: Multi-Stage Orchestration** (`StageOrchestrator.ts`)
3.  **Phase 3: Middleware Injection** (`MiddlewareEngine.ts`)
4.  **Phase 4: Step Translation** (`PackageManagerRules.ts`)
5.  **Phase 5: The Assembler** (`DockerfileAssembler.ts`)

---

## 🔍 Core Components Deep-Dive

### 1. Validation & Security (`shared/utils/Validator.ts`)
Before any string manipulation occurs, the incoming JSON payload is heavily scrutinized:
*   **Shell Injection Protection:** Scans package names for illegal characters (`;`, `|`, `&&`).
*   **Dependency Graphing:** Ensures execution order is chronological (e.g., prevents `npm install` if `nodejs` isn't installed).
*   **Reserved Path Protection:** Blocks mounting workspaces into critical directories (`/bin`, `/etc`).
*   **Redundancy Checks:** Prevents reinstalling packages already provided by the base image.

### 2. Multi-Stage Orchestration (`pipeline/StageOrchestrator.ts`)
Optimizes image size and startup speed:
*   **Builder Stage:** Routes heavy managers (`npm`, `cargo`, `pip`) and compilers to a temporary image.
*   **Runtime Stage:** Routes global dependencies (`apt`) here.
*   **The Bridge:** Generates `ArtifactTransfer` maps to seamlessly `COPY --from=builder` compiled assets into the slim final image.

### 3. The Middleware Engine (`pipeline/middleware/`)
The heart of extensibility. The manifest passes through an array of **Injectors**:
*   **SecurityUserInjector:** Drops root privileges for a restricted sandbox-user.
*   **OpenSandboxInjector:** Downloads the `execd` daemon and hijacks the boot sequence for control plane communication.
*   *Note: To support new backends (e.g., AWS Firecracker), simply write a new Injector class.*

### 4. Translation & Assembly (`pipeline/assembler/`)
Compiles the mutated manifest into raw Docker syntax:
*   **BuildKit Native:** Injects `# syntax=docker/dockerfile:1.4` and utilizes `--mount=type=cache` for lightning-fast builds.
*   **Context-Aware:** Uses `PipelineContext` to inject `WORKDIR` only when paths change.
*   **Layer Flattening:** Chains `ENV` variables to reduce metadata bloat.

---

## 🚀 Infrastructure & Deployment Services
*   **`ExecutorService.ts`**: Pipes the Dockerfile string to the local daemon and streams build logs to the frontend via events.
*   **`RegistryService.ts`**: Handles tagging and pushing successful builds to remote registries (ECR, Docker Hub).
*   **`GarbageCollector.ts`**: A nightly Cron job (2:00 AM) that runs `docker prune` to clear stale images and caches.

---

## 🛠️ How to Extend the Engine

### Adding a New Package Manager (e.g., Ruby/Gems)
1.  Add the type to `InstallStepType` in `shared/types/env.ts`.
2.  Add translation logic and BuildKit cache points to `PackageManagerRules.ts`.
3.  Define dependency rules in `Validator.ts` (e.g., require `ruby` before `gem`).

### Adding a Custom Integration (e.g., Datadog Tracing)
1.  Create a new file in `pipeline/middleware/injectors/` implementing `PipelineInjector`.
2.  Push environment variables and commands into the manifest via the injector.
3.  Register it with `.use(new YourCustomInjector())` in `GeneratorService.ts`.

---

## 💻 Example Usage

```typescript
import { DockerGeneratorService } from './services/GeneratorService';
import { ExecutorService } from './services/ExecutorService';

const userJsonPayload = `{
  "id": "my-env",
  "baseImage": "ubuntu:22.04",
  "buildSteps": [
    { "name": "System", "type": "apt", "packages": ["curl", "python3", "python3-pip"] },
    { "name": "API", "type": "pip", "targetPath": "/workspace/api", "packages": ["fastapi", "uvicorn"] }
  ]
}`;

// 1. Generate the Dockerfile String
const dockerfileStr = DockerGeneratorService.generateDockerfile(userJsonPayload);

// 2. Build the Image and Stream Logs to Client
const logStream = ExecutorService.streamBuild(userJsonPayload, 'my-env:latest');

logStream.on('data', (chunk) => console.log(chunk));
logStream.on('success', (msg) => {
    // 3. Push to Registry on success
    RegistryService.pushImage('my-env:latest', 'registry.mycloudide.com');
});
```

## 📂 Deep Dive: The Core Pipeline
While this root directory contains the API and server configurations, the actual "brain" of the Docker generator lives inside the `/pipeline` directory. 

If you are looking to:
* Understand how JSON becomes a Dockerfile.
* Add a new Sandbox Integration (like AWS Firecracker).
* Modify how Multi-Stage routing works.
* Update BuildKit compilation syntax.

👉 **[Read the Pipeline Engine Documentation here](./pipeline/README.md)**