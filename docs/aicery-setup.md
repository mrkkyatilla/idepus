# Aicery setup

## Development (Docker)

```bash
# Terminal 1
npm run tauri dev

# Terminal 2
./scripts/aicery-up.sh
./scripts/aicery-smoke.sh
```

Requires Aicery cloned at `../aicery` (or set `AICERY_ROOT`).

## Production (bundled sidecar)

Release builds include an Aicery binary via Tauri `externalBin` and mount `idepus-plugin/` as bundle resources.

Default runtime URL: `http://127.0.0.1:8000` (Settings → Aicery).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLUGIN_PATHS` | bundled `idepus-plugin` | Agent YAML/Python plugins |
| `IDEPUS_BRIDGE_URL` | `http://127.0.0.1:17373` | Host tool bridge |
| `API_KEY` | `dev` | Sidecar auth |
