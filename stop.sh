#!/usr/bin/env bash
# =============================================================
# ERP Loga — Parar el servicio
# =============================================================
# Descarga el agente de launchd (deja de relanzar al morir)
# y mata los procesos en marcha. Vuelve a arrancar con:
#   launchctl load ~/Library/LaunchAgents/com.loga.erp.plist
# o con `./start.sh` (sin auto-arranque).
# =============================================================

PLIST="$HOME/Library/LaunchAgents/com.loga.erp.plist"

if [[ -f "$PLIST" ]]; then
  echo "Descargando agente launchd..."
  launchctl unload "$PLIST" 2>/dev/null || true
fi

# Matar por puerto (más fiable que por PID guardado)
echo "Cerrando procesos en :3001 y :4173..."
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:4173 | xargs kill -9 2>/dev/null || true

echo "ERP Loga parado. Para volver a arrancarlo:"
echo "  launchctl load $PLIST     (con auto-arranque al reiniciar)"
echo "  ./start.sh                (sin auto-arranque)"
