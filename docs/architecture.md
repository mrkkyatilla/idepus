# Architecture

idepus is a Tauri desktop app: TypeScript UI + Rust host + Aicery agent sidecar.

## Crates

| Crate | Role |
|-------|------|
| `src-tauri` (idepus) | Tauri shell, bridge HTTP server, shadow workspace, plugins |
| `idepus-llm` | LLM providers, streaming, keyring credentials |
| `idepus-diff` | SEARCH/REPLACE patch parse/apply |
| `idepus-plugin-api` | dylib plugin traits and ABI |
| `idepus-plugin-gitignore` | Example `@gitignore` context source |

## Runtime flow

1. UI invokes Tauri commands (files, diff, LLM, agent).
2. Bridge server on `:17373` serves tools to Aicery (`read_file`, `apply_patch`, `shadow_verify`, …).
3. Aicery sidecar on `:8000` runs agent graphs from `idepus-plugin/`.
4. SSE events flow back to the UI via `aicery_sse_event`.

## Sidecar lifecycle

- **Dev** (`debug_assertions`): connect to Docker via `./scripts/aicery-up.sh`.
- **Release**: bundled `externalBin` spawned at startup; health polled on `127.0.0.1:8000`.

## Session persist

Debounced snapshot to `~/.config/idepus/session.json` (chat, patch queue, last run id).
