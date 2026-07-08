# 🐋 `services/docker` — unified docker CLI

One argv-based (never shell) entry point for every backend docker invocation, so
they share one spawn, one error convention, and one config knob. Replaces the old
mix of `spawn` (in `DockerBuilder`) and `exec` (shell, in `GarbageCollector`).

## API — `DockerCli`

```ts
const docker = new DockerCli();          // or new DockerCli('podman' | '/abs/path')

await docker.run(['tag', src, dst]);      // one-shot; REJECTS on non-zero exit
await docker.succeeds(['image','inspect', tag]); // boolean; never throws (probe)
const proc = docker.stream(['build', '--progress=plain', '-t', tag, '-'], {
  stdin: dockerfile,          // fed to the child, then closed
  banner: 'Building...\n',    // emitted as 'data' before start
  timeoutMs: 300_000,         // SIGTERM the child after N ms, then settle 'failed'
  timeoutMessage: 'Build timed out',
  onExit: (code) => code === 0 ? { ok: true, message: 'done' } : { ok: false, message: `exit ${code}` },
  onSpawnError: (err) => `docker missing? ${err.message}`,
  cancelMessage: 'Build cancelled',
});
proc.on('data', console.log);
proc.on('succeeded', console.log);        // NOT 'error' — that's a Node footgun
proc.on('failed', console.error);
proc.cancel();                            // SIGTERM + settles 'failed'
```

| Method | Shape | Use for |
|---|---|---|
| `run(args)` | `Promise<{stdout,stderr}>`, rejects on non-zero | `tag`, `prune` |
| `succeeds(args)` | `Promise<boolean>`, never throws | `image inspect` (cache probe) |
| `stream(args, opts)` | `DockerProcess` (`data`/`succeeded`/`failed` + `cancel()`) | `build` |

## Why a class, not an interface

`DockerCli` is concrete and injectable (`new DockerBuilder(new DockerCli(...))`,
default in prod). The binary name is the only real knob. A second CLI *backend*
with different arg grammar would justify an `IDockerCli` interface — not before.

`DockerCli.test.ts` runs the whole contract against `node` as a stand-in binary,
so it needs no Docker installed.

## 🗺️ Roadmap

- [x] **`stream()` timeout.** `timeoutMs`/`timeoutMessage` SIGTERM the child after N
  ms, then settle `failed`. `DockerBuilder.build` wires `EnvironmentConfig.timeout`
  through, so a build hang can't starve the queue.
- [x] **Resource limits.** Landed as a *buildx-builder* seam, not per-build flags:
  `DockerBuilder` passes `--builder $DOCKER_BUILDER` when set, so ops provision one
  capped builder (`buildx create --driver-opt memory=..,cpus=..`) and every build is
  capped natively with BuildKit caching intact. Per-build `--memory`/`--cpus` were
  dropped — BuildKit ignores them.

Nothing open. Next work items live with the builder, not here.
