# cloud-ide-engine (Rust napi engine)

The compiled `index.node` that the backend loads over the N-API boundary
(`src/services/sandbox/rustClient.ts`). Built as a `cdylib`, not an executable.

## Build

From `src/backend`:

```bash
npm run build:rust     # -> ../scripts/build-rust.mjs
```

Don't call `napi build` by hand — the wrapper picks the right target and verifies
the result (see below).

## The one rule: ABI must match the host Node

A napi `.node` must match the **running Node's ABI**. `napi build` will happily
compile with the wrong toolchain and only fail at load with
`Module did not self-register`. So there is exactly **one correct Rust target per
machine** — the one matching your Node — not "whatever toolchain is handy".

`scripts/build-rust.mjs` enforces this:

1. Maps `process.platform`/`arch` → the correct target. **Windows is forced to
   `-msvc`** because official `node.exe` is MSVC-built. (MSYS2/GNU rust only loads
   into MSYS2's own node.)
2. Checks `cargo` exists and the target is installed (`rustup target list`).
3. Cleans stale `index.node` so a failed build can't leave a ghost that "works".
4. `napi build --target <triple>`.
5. `require()`s the output to prove it loads into *this* Node — an ABI mismatch
   fails here, at build time, not at first sandbox boot.

| Host              | Target                        |
|-------------------|-------------------------------|
| win32 x64         | `x86_64-pc-windows-msvc`      |
| win32 arm64       | `aarch64-pc-windows-msvc`     |
| linux x64         | `x86_64-unknown-linux-gnu`    |
| linux arm64       | `aarch64-unknown-linux-gnu`   |
| darwin x64        | `x86_64-apple-darwin`         |
| darwin arm64      | `aarch64-apple-darwin`        |

## Troubleshooting

- **`cargo not found`** → install Rust: <https://rustup.rs>, then `rustup default stable`.
- **`target ... is not installed`** → run the `rustup target add <triple>` the script prints.
- **Built but won't load** → your default toolchain doesn't match the target;
  `rustup default stable-<triple>` (on Windows: the `-msvc` one).
