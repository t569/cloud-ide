import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path';

// ==========================================
// SECURITY HEADERS (finding #4)
// ==========================================
// Headers that never break anything — applied in BOTH dev and prod-preview.
const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY', // clickjacking; header form works where meta can't
};

// Content-Security-Policy — applied to the built artifact (`vite preview`) only,
// NOT to `vite dev` (dev needs inline scripts + an HMR websocket that a strict
// policy would block). This is the single highest-leverage mitigation: it caps
// where any script can send data, backstopping XSS and the REPL worker.
//
// PRODUCTION: set this same policy as a real response header at the edge/backend
// (and add `Strict-Transport-Security` there — HSTS only works as a header).
// Tighten `script-src` to per-request nonces/hashes when you control the edge.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // 'unsafe-eval': required by the JS REPL worker (repl/jsWorker.js) and Monaco.
  // 'unsafe-inline': Vite's prod bundle emits a small inline module-preload
  // script. Replace both with nonces/hashes at a real edge to harden further.
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "worker-src 'self' blob:",
  // Egress allowlist — the high-value directive. Iconify fetches icons from
  // these CDNs. Add your API/WS origin here if it is not same-origin ('self').
  "connect-src 'self' https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com",
].join('; ');

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@frontend': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Dev: safe headers only. No CSP here — it would break HMR.
    headers: BASE_SECURITY_HEADERS,
  },
  preview: {
    // Prod-preview: safe headers + the full CSP.
    headers: { ...BASE_SECURITY_HEADERS, 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
  },
})
