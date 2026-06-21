# Changelog

## 1.0.0 — 2026-06-16

### Added

- GitHub Actions CI: Rust fmt/clippy/test, frontend build/vitest, Aicery smoke, drift check
- Session crash recovery (`~/.config/idepus/session.json`): chat history, patch queue, stale run banner
- Bundled Aicery sidecar (`externalBin`) with lifecycle manager; dev mode still uses Docker
- dylib extension host (`libloading`) and `idepus-plugin-gitignore` example (`@gitignore` mentions)
- Criterion benchmarks (idepus-diff, shadow prepare) and perf scripts
- Opt-in telemetry (Settings → Privacy; local `telemetry.log` sink)
- Documentation: architecture, Aicery setup, AI workflow, team context, plugins
- GitHub Release workflow for Linux and macOS

### Changed

- Version bumped to 1.0.0 across package, Tauri, and Cargo manifests
