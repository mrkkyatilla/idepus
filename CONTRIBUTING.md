# Contributing to idepus

Thanks for helping improve idepus!

## Development setup

1. Install Rust (stable), Node 20+, and Docker (for Aicery dev sidecar).
2. Clone [Aicery](https://github.com/) beside this repo as `../aicery`.
3. `npm ci && npm run tauri dev`
4. In another terminal: `./scripts/aicery-up.sh`

## Checks before opening a PR

```bash
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
npm run build
npm test
./scripts/aicery-smoke.sh   # requires Docker sidecar
```

## Phase structure

Features are tracked in `to-do/phases/`. Pick an open phase or file an issue first for larger changes.

## Pull requests

- Keep diffs focused; one logical change per PR when possible.
- Update `CHANGELOG.md` for user-visible changes.
- Do not commit secrets (`.env`, API keys).
