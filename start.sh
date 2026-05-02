#!/usr/bin/env bash
# =============================================================
# ERP Loga — Arranque (backend Node + frontend serve)
# =============================================================
# Mantiene ambos procesos vivos. Si uno muere, lanza el script.
# Diseñado para ser invocado por launchd (KeepAlive=true) — si
# este script termina, launchd lo relanza.
# =============================================================

set -e

PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$PROJECT_DIR"

mkdir -p logs

# Cargar nvm si existe (por si Node está ahí)
[[ -s "$HOME/.nvm/nvm.sh" ]] && . "$HOME/.nvm/nvm.sh"

# Asegurar PATH con brew
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Asegurar que PostgreSQL está corriendo
if ! pg_isready -q 2>/dev/null; then
  echo "[start] PostgreSQL no responde, intentando arrancar..."
  brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
  sleep 5
fi

# Función limpieza al recibir señal
cleanup() {
  echo "[start] Recibida señal, parando procesos..."
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  exit 0
}
trap cleanup SIGTERM SIGINT

# Backend ----------------------------------------------------
echo "[start] Lanzando backend..."
cd "$PROJECT_DIR/backend"
node dist/index.js >> "$PROJECT_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo "[start] Backend PID=$BACKEND_PID"

# Frontend ---------------------------------------------------
echo "[start] Lanzando frontend (serve en :4173)..."
cd "$PROJECT_DIR/frontend"
npx serve -s dist -l 4173 --no-clipboard >> "$PROJECT_DIR/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "[start] Frontend PID=$FRONTEND_PID"

cd "$PROJECT_DIR"
echo "[start] ERP Loga arrancado. Backend :3001 | Frontend :4173"
echo "[start] Logs: logs/backend.log  logs/frontend.log"

# Esperar a que cualquier proceso muera — si pasa, este script termina
# y launchd lo relanza (KeepAlive=true)
wait -n "$BACKEND_PID" "$FRONTEND_PID"
EXIT_CODE=$?
echo "[start] Un proceso murió (exit=$EXIT_CODE). Saliendo para que launchd relance."

# Matar el otro
[[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
[[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true

exit $EXIT_CODE
