#!/usr/bin/env bash
# ============================================================
# Genera el paquete final listo para entregar al cliente.
# Ejecuta este script en TU Mac antes de copiar al pendrive/zip.
#
# Hace:
#  1. npm run build del frontend (genera frontend/dist/)
#  2. Genera secrets aleatorios para producción
#  3. Escribe backend/.env.PRODUCCION con esos secrets
#  4. Imprime las credenciales que debes ANOTAR EN PAPEL para
#     entregar al cliente
# ============================================================
set -e

cd "$(dirname "$0")"

echo "════════════════════════════════════════════════════"
echo "  PREPARAR PAQUETE DE PRODUCCION — ERP Loga"
echo "════════════════════════════════════════════════════"

# 1. Build frontend
echo ""
echo "[1/3] Construyendo frontend (npm run build)..."
cd frontend
npm install --silent
npm run build
cd ..
echo "      OK → frontend/dist generado"

# 2. Generar secrets
JWT=$(openssl rand -hex 32)
BACKUP=$(openssl rand -hex 24)
WEBHOOK=$(openssl rand -hex 16)
PG_PASS=$(openssl rand -hex 12)

# 3. Escribir .env.PRODUCCION
ENV_FILE=backend/.env.PRODUCCION
cat > "$ENV_FILE" <<EOF
# === ENV de PRODUCCION generado $(date) ===
# Copia este archivo al cliente como backend/.env

DATABASE_URL=postgresql://loga:${PG_PASS}@localhost:5433/loga_erp
PORT=3001
NODE_ENV=production
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:3001,http://localhost:5173

JWT_SECRET=${JWT}
BACKUP_PASSWORD=${BACKUP}
WEBHOOK_TOKEN=${WEBHOOK}

# Auto-heal admin SOLO el primer arranque (cámbialo a false luego).
AUTO_HEAL_ADMIN=true

# SMTP — pídele al cliente sus credenciales reales:
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=

# MIGRATIONS_FAIL_SOFT=true permite arrancar aunque alguna migración falle
# (útil migrando desde versiones muy antiguas). Quita en operación normal.
MIGRATIONS_FAIL_SOFT=true
EOF

echo ""
echo "════════════════════════════════════════════════════"
echo "  ANOTA ESTO EN PAPEL Y ENTREGALO AL CLIENTE"
echo "════════════════════════════════════════════════════"
echo ""
echo "  Postgres password   : ${PG_PASS}"
echo "  BACKUP_PASSWORD     : ${BACKUP}"
echo "    (sin esto NO se puede restaurar ningun backup)"
echo "  JWT_SECRET (interno): ${JWT}"
echo "  WEBHOOK_TOKEN       : ${WEBHOOK}"
echo ""
echo "  Admin inicial: admin@loga.es / Admin123!"
echo "    -> Pidele al cliente cambiar la clave al primer login"
echo ""
echo "  Archivo .env generado en: $ENV_FILE"
echo "  Renombralo a .env en la maquina del cliente."
echo ""
echo "  GUARDA ESTOS VALORES EN UN SITIO SEGURO (gestor"
echo "  de contraseñas, papel guardado en caja fuerte, etc)"
echo "════════════════════════════════════════════════════"
