# Cloud IDE - OpenSandbox Daemon

This directory manages the local execution engine for the Cloud IDE. 

**Current Engine:** Alibaba's `opensandbox`
We are currently utilizing Alibaba's OpenSandbox as our underlying container orchestration daemon. It provides the isolated, heavily restricted Docker environments required to safely execute user code without compromising the host machine.

### Automated Boot
You do not need to boot this manually. The engine is automatically wired into the root monorepo startup sequence.

When you run `npm run dev` at the project root, the `boot.js` script will:
1. Verify Docker is active on your machine.
2. Create an isolated Python `sandbox-env` (if it doesn't exist).
3. Install dependencies from `requirements.txt`.
4. Boot the server using the `.sandbox.toml` configuration.


### 🛠️ Manual Boot (Using `uv`)

If you need to isolate the daemon for debugging or prefer not to run the full monorepo stack, you can boot the OpenSandbox server manually. We use `uv` for blazing-fast Python dependency management.

### 🛠️ Manual Boot (Using `uv`)

**Prerequisites:** If you only start the environment via the root `npm run dev` command, you **do not** need to install anything manually—our boot script will automatically provision a local copy of `uv` for you. 

However, if you want to boot the sandbox manually or add new Python dependencies to the `requirements.txt`, you should install `uv` globally on your system for the best developer experience:

**macOS / Linux:**
```bash
curl -LsSf [https://astral.sh/uv/install.sh](https://astral.sh/uv/install.sh) | sh
```

**Windows (PowerShell)**
```powershell
powershell -ExecutionPolicy ByPass -c "irm [https://astral.sh/uv/install.ps1](https://astral.sh/uv/install.ps1) | iex"
```

(Note: You may need to restart your terminal after installing).


**1. Create the Virtual Environment:**
Navigate to the `src/opensandbox` directory and use `uv` to create the environment.
```bash
cd src/opensandbox
uv venv sandbox-env
```

**2. Activate the Virtual Environment:**

* **Windows (PowerShell/CMD)**

```bash
sandbox-env\Scripts\activate
```

* **macOS/Linux**

```bash
source sandbox-env/bin/activate
```

**3. Install Dependencies:**

Use `uv pip` to resolve and install the requirements instantly

```bash
uv pip install -re requirements.txtx
```

**Start the Daemon:**
Once installed, boot the server using our specific TOML configuration.

```bash
opensandbox-server --config .sandbox.toml
```




**Requirements:** * Docker Desktop must be running.
* Python 3.8+ must be installed.