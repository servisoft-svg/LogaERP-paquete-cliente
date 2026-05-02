#!/usr/bin/env bash
# =============================================================
# ERP Loga — Desinstalar arranque automático
# =============================================================
# Quita el agente launchd. NO borra nada del proyecto, ni la
# base de datos, ni node_modules. Solo el auto-arranque.
# =============================================================

PLIST="$HOME/Library/LaunchAgents/com.loga.erp.plist"

if [[ -f "$PLIST" ]]; then
  echo "Descargando y eliminando agente launchd..."
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ Auto-arranque eliminado"
else
  echo "No había agente instalado"
fi

# Matar procesos vivos
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:4173 | xargs kill -9 2>/dev/null || true

echo
echo "El ERP ya no se arrancará al iniciar el Mac."
echo "Para volver a activarlo: ./install.sh"
echo
echo "Para borrar la base de datos:    dropdb loga_erp"
echo "Para borrar el proyecto entero:  rm -rf $(pwd)"
