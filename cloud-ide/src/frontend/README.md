# Cloud IDE - Frontend

This is the client-facing application for the Cloud IDE, built for high-performance rendering and real-time interaction using Vite, React, Monaco Editor, and Xterm.js.

## 💻 Tech Stack

*   **Build Tool:** Vite
*   **UI Framework:** React 19 + Tailwind CSS v4
*   **Code Editor:** `@monaco-editor/react`
*   **Terminal Emulator:** `xterm` + WebGL addons
*   **API Communication:** Standard HTTP/SSE (Server-Sent Events)

## 🚀 Running the Development Server
While you can run this via the root `npm run dev` command, you can also run the frontend in isolation if you are strictly working on UI changes.

```bash
# From the /frontend directory
npm run dev
```

```bash
# From the root directory (Recommended)
npm install lucide-react -w frontend

# OR from the frontend directory
npm install lucide-react
```

### TypeScript and the @cloud-ide/shared Package

The frontend naturally consumes types from our sibling shared workspace. If you see "Module not found" errors in VS Code regarding `@cloud-ide/shared`, simply restart your TypeScript server:

1.  Press **Ctrl + Shift + P** (or **Cmd + Shift + P**)
2.  Select **TypeScript: Restart TS server**
