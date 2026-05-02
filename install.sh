#!/usr/bin/env bash
# =============================================================
# ERP Loga — Instalador todo-en-uno para macOS / Linux
# =============================================================
# (Si estás en Windows: usa install.bat — esto saldrá con error)
# Uso:  ./install.sh
#
# Hace:
#   1. Instala Homebrew si falta
#   2. Instala Node.js 20, PostgreSQL 16
#   3. Inicia PostgreSQL como servicio
#   4. Crea base de datos `loga_erp`
#   5. Aplica todas las migraciones SQL
#   6. Instala dependencias backend + frontend
#   7. Genera backend/.env con secretos aleatorios (si no existe)
#   8. Compila backend (TypeScript) y frontend (Vite)
#   9. Instala launchd plist para arranque automático al inicio del Mac
#  10. Arranca el servicio
#
# Idempotente: si ya está instalado algo, lo respeta.
# =============================================================

set -euo pipefail

# Detectar plataforma
case "$(uname -s)" in
  Darwin*) PLATFORM="mac" ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "Detectado Windows. Usa install.bat:"
    echo "  Doble-clic en install.bat  o desde CMD:  install.bat"
    exit 1
    ;;
  Linux*)
    echo "Linux no soportado oficialmente todavía."
    echo "Instala manualmente: node 20, postgresql 16, npm install, build, systemd."
    echo "Detalles en REQUIREMENTS.md"
    exit 1
    ;;
  *) echo "Plataforma no soportada: $(uname -s)"; exit 1 ;;
esac

# Colores
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; N='\033[0m'

log()  { echo -e "${B}▶${N} $*"; }
ok()   { echo -e "${G}✓${N} $*"; }
warn() { echo -e "${Y}⚠${N} $*"; }
err()  { echo -e "${R}✗${N} $*" >&2; }

# Directorio del proyecto (donde está este script)
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$PROJECT_DIR"

DB_NAME="loga_erp"
DB_USER="$(whoami)"

echo
echo "═══════════════════════════════════════════════════════════"
echo "   ERP Loga — Instalación automática"
echo "   Directorio: $PROJECT_DIR"
echo "═══════════════════════════════════════════════════════════"
echo

# -------------------------------------------------------------
# 1. Homebrew
# -------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  log "Instalando Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Añadir al PATH
  if [[ -d /opt/homebrew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -d /usr/local/Homebrew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  ok "Homebrew instalado"
else
  ok "Homebrew ya instalado ($(brew --version | head -1))"
fi

# -------------------------------------------------------------
# 2. Node.js 20+
# -------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]]; then
  log "Instalando Node.js 20..."
  brew install node@20
  brew link --overwrite --force node@20 2>/dev/null || true
  ok "Node.js instalado"
else
  ok "Node.js ya instalado ($(node -v))"
fi

# -------------------------------------------------------------
# 3. PostgreSQL 16
# -------------------------------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  log "Instalando PostgreSQL 16..."
  brew install postgresql@16
  brew link --overwrite --force postgresql@16 2>/dev/null || true
  ok "PostgreSQL instalado"
else
  ok "PostgreSQL ya instalado ($(psql --version))"
fi

# Iniciar PostgreSQL como servicio
if ! brew services list | grep -E "postgresql.*started" >/dev/null 2>&1; then
  log "Arrancando PostgreSQL como servicio..."
  brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
  sleep 3
  ok "PostgreSQL arrancado"
else
  ok "PostgreSQL ya está corriendo"
fi

# Esperar que postgres responda
log "Esperando a PostgreSQL..."
for i in {1..15}; do
  if psql -d postgres -c '\q' 2>/dev/null; then break; fi
  sleep 1
done

# -------------------------------------------------------------
# 4. Crear base de datos
# -------------------------------------------------------------
if psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw "$DB_NAME"; then
  ok "Base de datos '$DB_NAME' ya existe"
else
  log "Creando base de datos '$DB_NAME'..."
  createdb "$DB_NAME"
  ok "Base de datos creada"
fi

# -------------------------------------------------------------
# 5. Aplicar migraciones en orden
# -------------------------------------------------------------
log "Aplicando migraciones SQL..."
MIGRATIONS_DIR="$PROJECT_DIR/backend/database/migrations"
APPLIED=0
for sql in "$MIGRATIONS_DIR"/*.sql; do
  fname=$(basename "$sql")
  if psql -d "$DB_NAME" -f "$sql" >/dev/null 2>&1; then
    APPLIED=$((APPLIED+1))
  else
    warn "Migración $fname devolvió error (puede ser normal si ya estaba aplicada)"
  fi
done
ok "Procesadas $APPLIED migraciones"

# -------------------------------------------------------------
# 6. Generar backend/.env si falta
# -------------------------------------------------------------
ENV_FILE="$PROJECT_DIR/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Generando backend/.env con secretos aleatorios..."
  JWT=$(openssl rand -hex 32)
  BKP=$(openssl rand -hex 16)
  WHK=$(openssl rand -hex 24)
  cat > "$ENV_FILE" <<EOF
# Generado automáticamente por install.sh — $(date)
DATABASE_URL=postgresql://$DB_USER@localhost:5432/$DB_NAME
JWT_SECRET=$JWT
BACKUP_PASSWORD=$BKP
WEBHOOK_TOKEN=$WHK
CORS_ORIGIN=http://localhost:4173
PORT=3001
NODE_ENV=production
LOG_LEVEL=info
EOF
  chmod 600 "$ENV_FILE"
  ok "backend/.env creado (secretos seguros generados)"
else
  ok "backend/.env ya existe (no se sobrescribe)"
fi

# -------------------------------------------------------------
# 7. Frontend .env (URL del API)
# -------------------------------------------------------------
FE_ENV="$PROJECT_DIR/frontend/.env"
if [[ ! -f "$FE_ENV" ]]; then
  echo "VITE_API_URL=http://localhost:3001" > "$FE_ENV"
  ok "frontend/.env creado"
fi

# -------------------------------------------------------------
# 8. npm install
# -------------------------------------------------------------
log "Instalando dependencias backend..."
(cd backend && npm install --silent)
ok "Backend deps OK"

log "Instalando dependencias frontend..."
(cd frontend && npm install --silent)
ok "Frontend deps OK"

# -------------------------------------------------------------
# 9. Compilar
# -------------------------------------------------------------
log "Compilando backend (TypeScript)..."
(cd backend && npm run build)
ok "Backend compilado"

log "Compilando frontend (Vite)..."
(cd frontend && npm run build)
ok "Frontend compilado"

# Crear carpetas runtime
mkdir -p "$PROJECT_DIR/backend/uploads" "$PROJECT_DIR/backend/backups" "$PROJECT_DIR/logs"

# -------------------------------------------------------------
# 10. Instalar launchd plist para arranque automático
# -------------------------------------------------------------
PLIST_NAME="com.loga.erp"
PLIST_FILE="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_NAME</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PROJECT_DIR/start.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$PROJECT_DIR/logs/erp.out.log</string>
  <key>StandardErrorPath</key>
  <string>$PROJECT_DIR/logs/erp.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF
ok "launchd plist instalado en $PLIST_FILE"

# Cargar / recargar el servicio
launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load "$PLIST_FILE"
ok "Servicio cargado en launchd — se arrancará automáticamente al iniciar el Mac"

# -------------------------------------------------------------
# Resumen final
# -------------------------------------------------------------
echo
echo "═══════════════════════════════════════════════════════════"
echo -e "  ${G}Instalación completada${N}"
echo "═══════════════════════════════════════════════════════════"
echo
echo "  Backend:   http://localhost:3001"
echo "  Frontend:  http://localhost:4173"
echo
echo "  Login admin (cambiar tras primer acceso):"
echo "    Email:    admin@loga.es"
echo "    Password: admin123"
echo
echo "  Comandos útiles:"
echo "    ./start.sh         — arrancar manual (si está parado)"
echo "    ./stop.sh          — parar todo"
echo "    ./uninstall.sh     — desinstalar el arranque automático"
echo "    tail -f logs/erp.out.log   — ver logs"
echo
echo "  El ERP arrancará solo cada vez que inicies el Mac."
echo "═══════════════════════════════════════════════════════════"
