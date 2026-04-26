#!/usr/bin/env bash
# =============================================================
# backup.sh — Backup diario PostgreSQL → S3 o carpeta local
# Uso: ./backup.sh
# Cron sugerido (2:00 AM diario): 0 2 * * * /ruta/backup.sh
# =============================================================

set -euo pipefail

# ── Configuración ─────────────────────────────────────────────
DB_URL="${DATABASE_URL:-postgresql://postgres:password@localhost:5432/loga_erp}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/loga-erp}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
S3_BUCKET="${AWS_BUCKET:-}"                  # Si vacío, sólo backup local
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="loga_erp_${TIMESTAMP}.dump"

# ── Crear directorio si no existe ─────────────────────────────
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Iniciando backup: $FILENAME"

# ── Volcado PostgreSQL (formato custom = comprimido, restaurable) ──
pg_dump "$DB_URL" \
  --format=custom \
  --no-password \
  --verbose \
  --file="${BACKUP_DIR}/${FILENAME}" \
  2>&1

echo "[$(date)] Backup local creado: ${BACKUP_DIR}/${FILENAME}"

# ── Subir a S3 (si AWS_BUCKET está configurado) ──────────────
if [ -n "$S3_BUCKET" ]; then
  aws s3 cp \
    "${BACKUP_DIR}/${FILENAME}" \
    "s3://${S3_BUCKET}/backups/$(date +%Y/%m)/$(date +%d)/${FILENAME}" \
    --storage-class STANDARD_IA \
    --region "${AWS_REGION:-eu-west-1}"

  echo "[$(date)] Subido a S3: s3://${S3_BUCKET}/backups/..."
fi

# ── Limpiar backups locales > RETENTION_DAYS días ────────────
find "$BACKUP_DIR" -name "loga_erp_*.dump" -mtime +"$RETENTION_DAYS" -delete
echo "[$(date)] Limpieza: eliminados backups > ${RETENTION_DAYS} días"

echo "[$(date)] Backup completado exitosamente."
