# idepus

AI IDE — Tauri + Rust + TypeScript + CodeMirror 6. **v1.0.0**

## Linux one-shot setup

On a fresh Linux machine, a single script installs system dependencies, clones/builds Aicery, starts the Docker sidecar, and launches the Tauri app:

```bash
git clone https://github.com/mrkkyatilla/idepus.git idepus   # use your fork URL if needed
cd idepus
./setup.sh
```

What `./setup.sh` does:

1. Installs OS packages (Tauri/WebKit, build tools, Docker, Python) — **apt**, **dnf**, or **pacman**
2. Ensures **Rust** (rustup), **Node 20+** (fnm), and a working **Docker** daemon
3. Clones [Aicery](https://github.com/mrkkyatilla/aicery) to `../aicery` if missing
4. Builds `@aicery/sdk` (required local dependency)
5. Runs `npm ci` in idepus and prefetches Rust crates
6. Starts Aicery via [`scripts/aicery-up.sh`](scripts/aicery-up.sh) (idepus-plugin mounted)
7. Runs [`scripts/aicery-smoke.sh`](scripts/aicery-smoke.sh)
8. Launches `npm run tauri dev`

Useful flags:

| Flag | Purpose |
|------|---------|
| `--install-only` | Install and build only; do not start Docker or Tauri |
| `--skip-system` | Skip apt/dnf/pacman (Rust/Node/Docker checks still run) |
| `--skip-aicery` | Skip Docker stack (e.g. Aicery already running) |
| `--no-tauri` | Start Aicery but print manual steps instead of opening the app |
| `--help` | Full option list |

Environment variables: `AICERY_ROOT`, `AICERY_REPO`, `NODE_MAJOR`. See [`setup.sh`](setup.sh) for details.

After setup: open a workspace folder → **Tasks** or `Cmd+I` chat → **Run**.

## Setup notes & quick fixes

### Extra steps you may still need

| Step | When |
|------|------|
| **Log out / `newgrp docker`** | Docker installed but `permission denied` on `docker ps` |
| **Real LLM keys** | Mock responses are not enough — create `~/.config/idepus/aicery-provider.env` with `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`, then run `./scripts/aicery-reload-provider.sh` |
| **Restart Aicery after graph changes** | You edited `idepus-plugin/agents/graph.py` — `./scripts/aicery-reload-provider.sh` or re-run `./scripts/aicery-up.sh` |
| **Restart idepus after frontend/Rust changes** | Stop Tauri and run `npm run tauri dev` again |
| **First Tauri build** | Can take several minutes; this is normal |
| **Manual two-terminal dev** | Terminal 1: `npm run tauri dev` · Terminal 2: `./scripts/aicery-up.sh` |

### Common problems

| Symptom | Likely cause | Fix |
|--------|----------------|-----|
| `deploy-api-1 exited (3)` + `PLUGIN_PATHS entry is not a directory` | Host path passed to Docker | Use `./scripts/aicery-up.sh`, not raw `make up` with a host `PLUGIN_PATHS` |
| Tasks **Run** does nothing / “Aicery offline” banner | Sidecar not reachable | `curl http://localhost:8000/health` — if fail, `./scripts/aicery-up.sh` |
| `code-editor` / `multi-file-editor` agent not found | Plugin not mounted or API stale | Re-run `./scripts/aicery-up.sh`; `docker logs deploy-api-1` |
| `explore-planner graph not loaded` | API started before plugin graphs registered | Re-run `./scripts/aicery-up.sh` |
| Tool bridge unreachable / patch apply fails | idepus not running or no workspace open | Start `npm run tauri dev`, open a folder, retry |
| Agent stops after ~2 files | Old API step limit (fixed in current graph) | `./scripts/aicery-reload-provider.sh` after pulling latest |
| `Connection refused` on port 8000 | Docker stack down | `./scripts/aicery-up.sh` |
| `npm ci` fails on `@aicery/sdk` | SDK not built | `cd ../aicery/sdk/typescript && npm ci && npm run build` |
| Tauri build fails on Linux (WebKit/GTK) | Missing dev packages | Re-run `./setup.sh` without `--skip-system`, or install `libwebkit2gtk-4.1-dev` + GTK3 dev packages manually |
| Mock LLM / no real edits | No API key configured | Expected in dev; add keys or keep `USE_MOCK_PROVIDER=true` for smoke tests |

Docs: [`docs/architecture.md`](docs/architecture.md) · [`docs/aicery-setup.md`](docs/aicery-setup.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Manual quick start (~15 min)

If you prefer not to use `setup.sh`:

1. Install Rust (stable), Node 20+, Docker.
2. Clone this repo and [Aicery](https://github.com/mrkkyatilla/aicery) as `../aicery`.
3. `cd ../aicery/sdk/typescript && npm install && npm run build`
4. `cd idepus && npm ci && npm run tauri dev`
5. `./scripts/aicery-up.sh && ./scripts/aicery-smoke.sh`
6. Open a folder → **Tasks** or `Cmd+I` chat.

## Privacy

- Session snapshots (`~/.config/idepus/session.json`) store chat text and patch queue locally — **no API keys**.
- LLM keys use the system keyring (`idepus-llm`).
- Telemetry is **opt-in** (Settings → Privacy). When enabled, anonymous events (`app_start`, `feature_used`) append to `~/.config/idepus/telemetry.log`. Source code is never sent.

## v1.0 highlights

- CI on every push (Rust, frontend, Aicery smoke, drift check)
- Crash recovery for chat + patch queue
- Bundled Aicery sidecar for release builds
- dylib plugins (`@gitignore` example)
- Criterion benchmarks + perf scripts

## Integrated terminal (Faz 07)

- **Toggle:** `Ctrl+`` opens the terminal panel at the bottom of the editor.
- **Session:** A PTY starts automatically when you open a workspace (cwd = workspace root).
- **Fix with Agent:** When build/linter errors are detected in terminal output, a **Fix with Agent** button appears in the status bar. It launches the `lint-fix` agent with the last 50 lines of output and parsed file references, then uses the existing HITL diff review flow.

Requires Aicery running with `idepus-plugin` (`./scripts/aicery-up.sh`).

## Shadow workspace (Faz 08)

Before a patch reaches diff review, idepus tests it in a **shadow copy** of the workspace (symlink tree under `/tmp/idepus-shadow/`).

- **Pre-HITL gate:** When the agent requests `apply_patch`, shadow runs `cargo check` (or `npm test`) in the shadow copy. Failed tests reject the patch without opening the diff UI.
- **Agent graph:** `shadow_verify` tool step appears in the task tracker before HITL.
- **Settings:** Configure shadow test command, args, and timeout (default: auto-detect, 120s).

## Chat & multi-file agent (Faz 09)

- **Toggle:** `Cmd+I` opens the chat panel (right rail).
- **Agent:** Chat uses `multi-file-editor` — plans and patches multiple files with per-file HITL diff review.
- **Patch queue:** Files appear in the queue sidebar (pending / accepted / rejected / shadow failed). Rejecting one file does not block others.
- **Team context:** Optional `.idepus-context` at workspace root injects architecture rules into agent runs.
- **Routing:** Optional `ai-workflow.yaml` overrides agent/provider; falls back to Aicery `/v1/route`.
- **Rollback:** Per-file snapshot before apply; use Rollback in the patch queue.
- **Examples:** See `examples/.idepus-context` and `examples/ai-workflow.yaml`.

## Development

```bash
npm install
npm run tauri dev
```

## Aicery agent runtime (Faz 06)

1. Clone [Aicery](https://github.com/mrkkyatilla/aicery) beside this repo (`../aicery`).

2. Build TypeScript SDK (first time):

```bash
cd ../aicery/sdk/typescript && npm install && npm run build
```

3. Start Aicery **with idepus-plugin mounted** (do not use a host path like `/home/.../idepus-plugin` in `PLUGIN_PATHS` — Docker cannot see it):

```bash
./scripts/aicery-up.sh
```

This runs `make up` equivalent with `deploy/aicery.compose.override.yml`, mounting `idepus-plugin` at `/idepus-plugin` inside the API container.

Optional env before `aicery-up.sh`:

```bash
export USE_MOCK_PROVIDER=true   # default; no Gemini key needed
export HITL_ENABLED=true
export API_KEY=dev
```

4. In idepus: open a workspace → sidebar **Tasks** → enter a task → **Run**.

5. Smoke test:

```bash
./scripts/aicery-smoke.sh
```

See [`aicery.yaml.example`](aicery.yaml.example) and [`to-do/aicery-integration.md`](to-do/aicery-integration.md).

For more fixes, see **Setup notes & quick fixes** at the top of this README.
