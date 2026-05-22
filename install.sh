#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash -s -- --server
#   curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash -s -- --update
#   curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash -s -- --uninstall
#   curl -fsSL https://raw.githubusercontent.com/tiepduong7c9/ccremote/main/install.sh | bash -s -- --server --uninstall
#   ./install.sh [--server] [--update|--uninstall]

REPO_TARBALL="${CCREMOTE_TARBALL:-https://github.com/tiepduong7c9/ccremote/archive/refs/heads/main.tar.gz}"
INSTALL_DIR="${CCREMOTE_DIR:-$HOME/.local/share/ccremote}"

MODE="agentnode"
UNINSTALL=false
for arg in "$@"; do
  case "$arg" in
    --server)    MODE="server" ;;
    --update)    MODE="update" ;;
    --uninstall) UNINSTALL=true ;;
  esac
done

if ! command -v node &>/dev/null; then
  echo "Error: node not found. Install Node.js >= 18 first." >&2
  exit 1
fi

# Use local repo if running from inside one, otherwise download tarball
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-}")" 2>/dev/null && pwd || pwd)"
if [[ -f "$SCRIPT_DIR/server/index.js" ]]; then
  ROOT="$SCRIPT_DIR"
else
  echo "Downloading ccremote to $INSTALL_DIR..."
  mkdir -p "$INSTALL_DIR"
  curl -fsSL "$REPO_TARBALL" | tar -xz -C "$INSTALL_DIR" --strip-components=1
  ROOT="$INSTALL_DIR"
fi

confirm() {
  read -r -p "$1 [y/N] " ans
  [[ "${ans,,}" == "y" ]]
}

# ── uninstall ─────────────────────────────────────────────────────────────────
if $UNINSTALL && [[ "$MODE" == "agentnode" ]]; then
  echo "Uninstalling ccremote agentnode..."
  # Stop daemon
  PID_FILE="$HOME/.ccremote/daemon.pid"
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE")"
    kill -0 "$PID" 2>/dev/null && kill "$PID" && echo "Daemon stopped."
  fi
  # Remove global CLI symlink
  if command -v ccremote &>/dev/null; then
    cd "$ROOT/agentnode" && npm unlink && echo "'ccremote' unlinked."
  fi
  # Prompt for runtime data
  if [[ -d "$HOME/.ccremote" ]]; then
    confirm "Remove session data (~/.ccremote)?" && rm -rf "$HOME/.ccremote" && echo "Removed ~/.ccremote"
  fi
  # Prompt for source files (skip if this is a dev repo)
  if [[ ! -d "$ROOT/.git" ]] && [[ -d "$ROOT" ]]; then
    confirm "Remove source files ($ROOT)?" && rm -rf "$ROOT" && echo "Removed $ROOT"
  fi
  echo "Done."
  exit 0
fi

if $UNINSTALL && [[ "$MODE" == "server" ]]; then
  echo "Uninstalling ccremote server..."
  # Stop and disable systemd service
  SERVICE="$HOME/.config/systemd/user/ccremote-server.service"
  if systemctl --user is-active --quiet ccremote-server 2>/dev/null; then
    systemctl --user disable --now ccremote-server && echo "Service stopped and disabled."
  fi
  [[ -f "$SERVICE" ]] && rm "$SERVICE" && systemctl --user daemon-reload && echo "Service file removed."
  # Prompt for config
  ENV_FILE="$HOME/.config/ccremote/server.env"
  if [[ -f "$ENV_FILE" ]]; then
    confirm "Remove server config ($ENV_FILE)?" && rm "$ENV_FILE" && echo "Removed $ENV_FILE"
  fi
  # Prompt for server data (agentnode registry, cookie secret)
  SERVER_DATA="$ROOT/server/data"
  if [[ -d "$SERVER_DATA" ]]; then
    confirm "Remove server data ($SERVER_DATA)?" && rm -rf "$SERVER_DATA" && echo "Removed $SERVER_DATA"
  fi
  # Prompt for source files (skip if dev repo)
  if [[ ! -d "$ROOT/.git" ]] && [[ -d "$ROOT" ]]; then
    confirm "Remove source files ($ROOT)?" && rm -rf "$ROOT" && echo "Removed $ROOT"
  fi
  echo "Done."
  exit 0
fi

# ── update ────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "update" ]]; then
  echo "Updating ccremote..."
  if [[ -d "$ROOT/.git" ]]; then
    git -C "$ROOT" pull
  else
    curl -fsSL "$REPO_TARBALL" | tar -xz -C "$ROOT" --strip-components=1
  fi
  # Reinstall deps + rebuild frontend
  cd "$ROOT" && npm install
  npm run build
  # Restart server service if running
  if systemctl --user is-active --quiet ccremote-server 2>/dev/null; then
    echo "Restarting ccremote-server..."
    systemctl --user restart ccremote-server
  fi
  # Bounce daemon so it picks up new code on next use
  PID_FILE="$HOME/.ccremote/daemon.pid"
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE")"
    kill -0 "$PID" 2>/dev/null && kill "$PID" && echo "ccremote daemon stopped (will auto-restart on next use)"
  fi
  echo "Done."
  exit 0
fi

# ── agentnode ─────────────────────────────────────────────────────────────────
if [[ "$MODE" == "agentnode" ]]; then
  echo "Installing ccremote agentnode..."
  cd "$ROOT/agentnode"
  npm install
  npm link
  echo "Done. Run 'ccremote new' to create your first session."
  exit 0
fi

# ── server ────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "server" ]]; then
  echo "Installing ccremote server..."
  cd "$ROOT"
  npm install
  npm run build

  ENV_FILE="$HOME/.config/ccremote/server.env"
  SERVICE="$HOME/.config/systemd/user/ccremote-server.service"

  mkdir -p "$(dirname "$ENV_FILE")"
  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -z "${CCREMOTE_WEB_PASSWORD:-}" ]]; then
      read -r -s -p "Web UI password: " CCREMOTE_WEB_PASSWORD; echo
      [[ -z "$CCREMOTE_WEB_PASSWORD" ]] && { echo "Password cannot be empty." >&2; exit 1; }
    fi
    printf 'CCREMOTE_WEB_PASSWORD=%s\nCCREMOTE_PORT=%s\nCCREMOTE_HOST=%s\n' \
      "$CCREMOTE_WEB_PASSWORD" "${CCREMOTE_PORT:-8080}" "${CCREMOTE_HOST:-0.0.0.0}" > "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi

  mkdir -p "$(dirname "$SERVICE")"
  cat > "$SERVICE" <<EOF
[Unit]
Description=ccremote server
After=network.target

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$(which node) $ROOT/server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now ccremote-server
  PORT="$(grep '^CCREMOTE_PORT=' "$ENV_FILE" | cut -d= -f2)"
  echo "Done. Server running at http://localhost:${PORT:-8080}"
  exit 0
fi
