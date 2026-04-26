#!/bin/bash
# ============================================================
# BACKUP CIFRADO — Colas Loga ERP
# ============================================================
# Backup cifrado AES-256 + subida a Google Drive via rclone
#
# Clave: Loga2026 (cambiala abajo)
# Setup Drive: rclone config → crear remote "gdrive"
#
# Automatico: cron cada noche a las 3:00
# ============================================================

set -e

DB_NAME="loga_erp"
BACKUP_DIR="/Users/adrianmartinlopez/Documents/Loga/backups"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="loga_${DATE}.sql.gz.enc"
BACKUP_FILE="$BACKUP_DIR/$FILENAME"
PASS="Loga2026"
DRIVE_REMOTE="y:Loga-Backups"

mkdir -p "$BACKUP_DIR"

# 1. Dump + comprimir + cifrar
pg_dump "$DB_NAME" | gzip | openssl enc -aes-256-cbc -salt -pbkdf2 -pass "pass:$PASS" -out "$BACKUP_FILE"
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "$(date): Backup local: $FILENAME ($SIZE)"

# 2. Subir a Google Drive (si rclone esta configurado)
if command -v rclone &> /dev/null && rclone listremotes 2>/dev/null | grep -q "gdrive:"; then
  rclone copy "$BACKUP_FILE" "$DRIVE_REMOTE" --quiet
  echo "$(date): Subido a Google Drive"

  # Mantener ultimos 10 en Drive
  rclone ls "$DRIVE_REMOTE" 2>/dev/null | sort -k2 -r | tail -n +11 | awk '{print $2}' | while read f; do
    rclone deletefile "$DRIVE_REMOTE/$f" --quiet 2>/dev/null
  done
else
  echo "$(date): AVISO — rclone no configurado, backup solo local"
fi

# 3. Mantener ultimos 30 en local
ls -t "$BACKUP_DIR"/loga_*.sql.gz.enc 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null

echo "$(date): Backup completado."

# ============================================================
# RESTAURAR:
# openssl enc -aes-256-cbc -d -salt -pbkdf2 -pass "pass:Loga2026" \
#   -in backups/loga_FECHA.sql.gz.enc | gunzip | psql loga_erp
#
# DESCARGAR DE DRIVE:
# rclone copy y:Loga-Backups/loga_FECHA.sql.gz.enc .
# ============================================================
