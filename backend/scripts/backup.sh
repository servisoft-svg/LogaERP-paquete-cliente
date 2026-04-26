#!/bin/bash
# Backup diario de la base de datos Loga ERP
BACKUP_DIR="/Users/adrianmartinlopez/Documents/Loga/backups"
DB_NAME="loga_erp"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/loga_erp_$DATE.sql.gz"

mkdir -p "$BACKUP_DIR"

# Dump y comprimir
pg_dump "$DB_NAME" | gzip > "$BACKUP_FILE"

# Mantener solo los ultimos 30 backups
ls -t "$BACKUP_DIR"/loga_erp_*.sql.gz | tail -n +31 | xargs rm -f 2>/dev/null

echo "Backup completado: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
