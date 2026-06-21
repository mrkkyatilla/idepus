#!/usr/bin/env bash
#
# idepus — one-shot Linux dev setup (system deps + Aicery Docker + Tauri app)
#
# Usage (recommended):
#   git clone <idepus-repo-url> idepus && cd idepus && ./setup.sh
#
# Options:
#   --install-only     Install deps and build; do not start services
#   --skip-system      Skip apt/dnf system packages (Rust/Node/Docker still checked)
#   --skip-aicery      Skip Docker / Aicery stack
#   --skip-smoke       Skip aicery-smoke.sh after Aicery starts
#   --no-tauri         Leave Aicery up but do not launch `npm run tauri dev`
#   --clone-aicery URL Override Aicery git URL
#   -h, --help         Show help
#
# Environment:
#   AICERY_ROOT        Path to existing Aicery clone (default: ../aicery)
#   AICERY_REPO        Git URL if Aicery must be cloned
#   NODE_MAJOR         Node.js major version (default: 20)
#   USE_MOCK_PROVIDER  Passed to aicery-up (default: true when no API keys)
#
set -euo pipefail

IDEPUS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AICERY_REPO="${AICERY_REPO:-https://github.com/mrkkyatilla/aicery.git}"
AICERY_ROOT="${AICERY_ROOT:-$(dirname "$IDEPUS_ROOT")/aicery}"
NODE_MAJOR="${NODE_MAJOR:-20}"

INSTALL_ONLY=false
SKIP_SYSTEM=false
SKIP_AICERY=false
SKIP_SMOKE=false
NO_TAURI=false

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!>\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-only) INSTALL_ONLY=true ;;
    --skip-system)  SKIP_SYSTEM=true ;;
    --skip-aicery)  SKIP_AICERY=true ;;
    --skip-smoke)   SKIP_SMOKE=true ;;
    --no-tauri)     NO_TAURI=true ;;
    --clone-aicery)
      shift
      AICERY_REPO="${1:?--clone-aicery requires URL}"
      ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

require_linux() {
  case "$(uname -s)" in
    Linux) ;;
    *) die "This script supports Linux only. Detected: $(uname -s)" ;;
  esac
}

detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo apt
  elif command -v dnf >/dev/null 2>&1; then
    echo dnf
  elif command -v pacman >/dev/null 2>&1; then
    echo pacman
  else
    echo unknown
  fi
}

install_system_deps() {
  if $SKIP_SYSTEM; then
    log "Skipping system package install (--skip-system)"
    return
  fi

  local pm
  pm="$(detect_pkg_manager)"
  log "Installing system dependencies via $pm (sudo may prompt)"

  case "$pm" in
    apt)
      sudo apt-get update -qq
      sudo apt-get install -y --no-install-recommends \
        ca-certificates curl wget git file \
        build-essential pkg-config \
        libssl-dev \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libxdo-dev \
        libdbus-1-dev \
        python3 python3-pip python3-venv \
        docker.io docker-compose-plugin
      ;;
    dnf)
      sudo dnf install -y \
        ca-certificates curl wget git file \
        gcc gcc-c++ make pkg-config \
        openssl-devel \
        webkit2gtk4.1-devel \
        gtk3-devel \
        libappindicator-gtk3-devel \
        librsvg2-devel \
        libXtst-devel \
        dbus-devel \
        python3 python3-pip \
        docker docker-compose
      ;;
    pacman)
      sudo pacman -Sy --needed --noconfirm \
        base-devel curl wget git file \
        openssl pkg-config \
        webkit2gtk-4.1 \
        gtk3 \
        libappindicator-gtk3 \
        librsvg \
        libxdo \
        dbus \
        python python-pip \
        docker docker-compose
      ;;
    *)
      warn "Unknown package manager — install manually: git, curl, docker, build-essential,"
      warn "webkit2gtk 4.1, gtk3, SSL, Python 3, then re-run with --skip-system"
      ;;
  esac
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    die "Docker not found after system install. Install Docker and re-run."
  fi

  if docker info >/dev/null 2>&1; then
    log "Docker daemon reachable"
    return
  fi

  log "Starting Docker service"
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable --now docker 2>/dev/null || true
  fi

  if docker info >/dev/null 2>&1; then
    return
  fi

  if groups "$USER" | grep -q '\bdocker\b'; then
    die "Docker installed but daemon not reachable. Try: sudo systemctl start docker"
  fi

  warn "Adding $USER to docker group (you may need to log out/in for group changes)"
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  if docker info >/dev/null 2>&1; then
    return
  fi
  die "Docker not usable. Log out and back in, or run: newgrp docker — then re-run ./setup.sh"
}

ensure_rust() {
  if command -v cargo >/dev/null 2>&1 && rustc --version >/dev/null 2>&1; then
    log "Rust already installed: $(rustc --version)"
    return
  fi

  log "Installing Rust via rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
  # shellcheck source=/dev/null
  source "${HOME}/.cargo/env"
  log "Rust installed: $(rustc --version)"
}

ensure_node() {
  export PATH="${HOME}/.local/share/fnm:${HOME}/.fnm:${PATH}"
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --shell bash 2>/dev/null)" || true
  fi
  if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "${HOME}/.nvm/nvm.sh"
  fi

  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$major" -ge "$NODE_MAJOR" ]]; then
      log "Node already installed: $(node --version)"
      return
    fi
    warn "Node $(node --version) is older than required ${NODE_MAJOR}+; installing fnm + Node ${NODE_MAJOR}"
  fi

  if ! command -v fnm >/dev/null 2>&1; then
    log "Installing fnm (Fast Node Manager)"
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
    export PATH="${HOME}/.local/share/fnm:${PATH}"
    eval "$(fnm env --shell bash)"
  fi

  fnm install "$NODE_MAJOR"
  fnm use "$NODE_MAJOR"
  fnm default "$NODE_MAJOR"
  log "Node installed: $(node --version)"
}

ensure_aicery_repo() {
  if [[ -d "$AICERY_ROOT/deploy" ]]; then
    log "Aicery found at $AICERY_ROOT"
    return
  fi

  log "Cloning Aicery beside idepus → $AICERY_ROOT"
  git clone --depth 1 "$AICERY_REPO" "$AICERY_ROOT"
}

build_aicery_sdk() {
  local sdk="$AICERY_ROOT/sdk/typescript"
  [[ -d "$sdk" ]] || die "Missing Aicery TypeScript SDK at $sdk"

  log "Building @aicery/sdk (required by idepus package.json)"
  (
    cd "$sdk"
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
    npm run build
  )
}

setup_idepus() {
  [[ -f "$IDEPUS_ROOT/package.json" ]] || die "Not an idepus checkout: $IDEPUS_ROOT"
  [[ -d "$IDEPUS_ROOT/idepus-plugin" ]] || die "Missing idepus-plugin/ in $IDEPUS_ROOT"

  log "Installing idepus npm dependencies"
  (
    cd "$IDEPUS_ROOT"
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  )

  log "Prefetching Rust crates (first Tauri build will still compile)"
  (
    cd "$IDEPUS_ROOT/src-tauri"
    cargo fetch
  ) || warn "cargo fetch failed — Tauri will download crates on first dev run"
}

start_aicery() {
  export AICERY_ROOT
  log "Starting Aicery Docker stack (idepus-plugin mounted)"
  "$IDEPUS_ROOT/scripts/aicery-up.sh"
}

run_smoke() {
  if $SKIP_SMOKE; then
    return
  fi
  log "Running Aicery smoke test"
  "$IDEPUS_ROOT/scripts/aicery-smoke.sh"
}

start_tauri() {
  log "Launching idepus (Vite + Tauri) — first compile may take several minutes"
  log "Keep this terminal open. Aicery runs in Docker on http://localhost:8000"
  log "In the app: open a folder → Tasks / Cmd+I chat → Run"
  cd "$IDEPUS_ROOT"
  exec npm run tauri dev
}

print_done() {
  cat <<EOF

================================================================================
  idepus dev environment is ready
================================================================================
  idepus:  $IDEPUS_ROOT
  aicery:  $AICERY_ROOT
  API:     http://localhost:8000  (API_KEY=dev)

  Start manually:
    Terminal 1:  cd "$IDEPUS_ROOT" && npm run tauri dev
    Terminal 2:  cd "$IDEPUS_ROOT" && ./scripts/aicery-up.sh   (if not running)

  Optional LLM keys (~/.config/idepus/aicery-provider.env):
    export OPENAI_API_KEY=sk-...
    ./scripts/aicery-reload-provider.sh

  Mock LLM (no keys): USE_MOCK_PROVIDER=true (default in aicery-up.sh)
================================================================================
EOF
}

main() {
  require_linux
  [[ -f "$IDEPUS_ROOT/package.json" ]] || die "Run this script from the idepus repo root (git clone … && cd idepus && ./setup.sh)"

  log "idepus Linux setup — $IDEPUS_ROOT"
  install_system_deps
  ensure_docker
  ensure_rust
  ensure_node
  ensure_aicery_repo
  build_aicery_sdk
  setup_idepus

  if $INSTALL_ONLY; then
    print_done
    log "Install complete (--install-only). Start with: ./setup.sh --no-tauri is not needed; just ./scripts/aicery-up.sh && npm run tauri dev"
    exit 0
  fi

  if ! $SKIP_AICERY; then
    start_aicery
    run_smoke
  else
    warn "Skipped Aicery (--skip-aicery)"
  fi

  if $NO_TAURI; then
    print_done
    exit 0
  fi

  start_tauri
}

main "$@"
