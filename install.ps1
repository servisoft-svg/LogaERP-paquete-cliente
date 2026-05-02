# =============================================================
# ERP Loga - Instalador todo-en-uno para Windows 10/11
# =============================================================
# Uso:  doble-clic en install.bat  o desde PowerShell:
#       .\install.ps1
#
# Hace:
#   1. Verifica winget (preinstalado en Win 10 1709+ y Win 11)
#   2. Instala Node.js 20 LTS y PostgreSQL 16 (silent)
#   3. Crea base de datos loga_erp
#   4. Aplica todas las migraciones SQL
#   5. Instala dependencias backend + frontend
#   6. Genera backend\.env con secretos aleatorios
#   7. Compila backend (TypeScript) y frontend (Vite)
#   8. Crea tarea en Programador de tareas: arranca al iniciar sesion
#   9. Arranca el servicio inmediatamente
# =============================================================

$ErrorActionPreference = "Stop"

# Forzar UTF-8 en la consola para que los acentos/dashes salgan bien
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 | Out-Null
} catch { }

function Write-Step($msg)  { Write-Host "[*] $msg" -ForegroundColor Blue }
function Write-Ok($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[X] $msg" -ForegroundColor Red }

# Directorio del proyecto — usar PSCommandPath si existe (más fiable)
if ($PSCommandPath) {
    $ProjectDir = Split-Path -Parent $PSCommandPath
} elseif ($MyInvocation.MyCommand.Path) {
    $ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    $ProjectDir = (Get-Location).Path
}
Set-Location $ProjectDir

# Wrapper try/catch para que cualquier error quede VISIBLE en la ventana
try {

$DbName = "loga_erp"
# Usuario de aplicación (igual que en macOS) — se crea sobre el superuser postgres
$AppUser = "loga"
$AppPass = "loga123"
# Superuser postgres (lo crea Windows al instalar). Password se le pide al usuario
# o se lee de .postgres_password.txt si ya existe.
$PgUser = "postgres"
$PgPass = $null  # se rellena más abajo

Write-Host ""
Write-Host "==========================================================="
Write-Host "   ERP Loga - Instalacion automatica (Windows)"
Write-Host "   Directorio: $ProjectDir"
Write-Host "==========================================================="
Write-Host ""

# -------------------------------------------------------------
# 0. Verificar permisos y winget
# -------------------------------------------------------------
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    Write-Warn "Se recomienda ejecutar como Administrador para que winget no pida permisos en cada paso."
    Write-Host "  Sigue así y se pedirán confirmaciones, o cierra y vuelve a abrir como admin."
    Start-Sleep -Seconds 3
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Err "winget no encontrado. Necesitas Windows 10 versión 1709 o Windows 11."
    Write-Host "  Instala 'App Installer' desde Microsoft Store y reintenta."
    exit 1
}
Write-Ok "winget disponible"

# -------------------------------------------------------------
# 1. Node.js 20 LTS
# -------------------------------------------------------------
$nodeVer = $null
try { $nodeVer = (node -v 2>$null) } catch {}
if (-not $nodeVer -or [int](($nodeVer -replace 'v','').Split('.')[0]) -lt 20) {
    Write-Step "Instalando Node.js 20 LTS..."
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    # Refrescar PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Ok "Node.js instalado"
} else {
    Write-Ok "Node.js ya instalado ($nodeVer)"
}

# -------------------------------------------------------------
# 2. PostgreSQL 16
# -------------------------------------------------------------
$pgPath = $null
foreach ($v in 17,16,15,14) {
    $candidate = "C:\Program Files\PostgreSQL\$v\bin"
    if (Test-Path "$candidate\psql.exe") { $pgPath = $candidate; break }
}

if (-not $pgPath) {
    Write-Step "Instalando PostgreSQL 16 (puede tardar varios minutos)..."
    Write-Host "  IMPORTANTE: el instalador de PostgreSQL puede abrir una ventana"
    Write-Host "  y pedirte un password para el usuario 'postgres'." -ForegroundColor Yellow
    Write-Host "  Pon el que quieras (recomendado: postgres123) y RECUERDALO." -ForegroundColor Yellow
    Write-Host ""
    winget install -e --id PostgreSQL.PostgreSQL.16 --accept-source-agreements --accept-package-agreements
    $pgPath = "C:\Program Files\PostgreSQL\16\bin"
    if (-not (Test-Path "$pgPath\psql.exe")) {
        throw "PostgreSQL no se instalo correctamente. Reintenta o instala manual desde postgresql.org/download/windows"
    }
    Write-Ok "PostgreSQL instalado"
} else {
    Write-Ok "PostgreSQL ya instalado en $pgPath"
}

# Recuperar/pedir password del superuser postgres
if (Test-Path "$ProjectDir\.postgres_password.txt") {
    $PgPass = (Get-Content "$ProjectDir\.postgres_password.txt").Trim()
    Write-Ok "Password de 'postgres' leido de .postgres_password.txt"
} else {
    Write-Host ""
    Write-Host "Necesito el password del usuario 'postgres' (superuser PostgreSQL)." -ForegroundColor Yellow
    Write-Host "Es el que acabas de poner durante la instalacion (NO el del usuario loga)." -ForegroundColor Yellow
    $secure = Read-Host "Password de 'postgres'" -AsSecureString
    $PgPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    # Guardar para futuras ejecuciones
    $PgPass | Out-File -Encoding ASCII "$ProjectDir\.postgres_password.txt"
    Write-Ok "Password guardado en .postgres_password.txt"
}

$psql = Join-Path $pgPath "psql.exe"
$createdb = Join-Path $pgPath "createdb.exe"

# -------------------------------------------------------------
# 3. Verificar conexión como postgres
# -------------------------------------------------------------
Write-Step "Verificando conexion a PostgreSQL..."
$env:PGPASSWORD = $PgPass
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    & $psql -U $PgUser -d postgres -c "\q" 2>$null
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $ok) {
    Write-Err "No se conecta a PostgreSQL como '$PgUser'. Posibles causas:"
    Write-Host "  - Password incorrecto. Borra .postgres_password.txt y reintenta."
    Write-Host "  - Servicio parado: Start-Service postgresql-16"
    throw "Conexion a PostgreSQL fallida"
}
Write-Ok "PostgreSQL responde"

# -------------------------------------------------------------
# 4. Crear usuario de aplicación 'loga' (igual que en macOS)
# -------------------------------------------------------------
$userExists = & $psql -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$AppUser'"
if ($userExists.Trim() -eq "1") {
    Write-Ok "Usuario '$AppUser' ya existe"
} else {
    Write-Step "Creando usuario '$AppUser' con CREATEDB..."
    & $psql -U $PgUser -d postgres -c "CREATE USER $AppUser WITH PASSWORD '$AppPass' CREATEDB;" | Out-Null
    Write-Ok "Usuario '$AppUser' creado"
}

# -------------------------------------------------------------
# 5. Crear base de datos (propietario = loga)
# -------------------------------------------------------------
$dbExists = & $psql -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
if ($dbExists.Trim() -eq "1") {
    Write-Ok "Base de datos '$DbName' ya existe"
} else {
    Write-Step "Creando base de datos '$DbName' (propietario: $AppUser)..."
    & $createdb -U $PgUser -O $AppUser $DbName
    Write-Ok "Base de datos creada"
}

# -------------------------------------------------------------
# 6. Aplicar migraciones (como usuario loga)
# -------------------------------------------------------------
Write-Step "Aplicando migraciones SQL..."
$env:PGPASSWORD = $AppPass
$applied = 0
Get-ChildItem "$ProjectDir\backend\database\migrations\*.sql" | Sort-Object Name | ForEach-Object {
    & $psql -U $AppUser -d $DbName -f $_.FullName 2>&1 | Out-Null
    $applied++
}
Write-Ok "Procesadas $applied migraciones"

# -------------------------------------------------------------
# 6. Generar backend\.env
# -------------------------------------------------------------
$envFile = "$ProjectDir\backend\.env"
if (-not (Test-Path $envFile)) {
    Write-Step "Generando backend\.env con secretos aleatorios..."
    $jwt = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $bkp = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $whk = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    @"
# Generado automaticamente por install.ps1 - $(Get-Date)
DATABASE_URL=postgresql://${AppUser}:${AppPass}@localhost:5432/$DbName
JWT_SECRET=$jwt
BACKUP_PASSWORD=$bkp
WEBHOOK_TOKEN=$whk
CORS_ORIGIN=http://localhost:4173
PORT=3001
NODE_ENV=production
LOG_LEVEL=info
"@ | Out-File -Encoding ASCII $envFile
    Write-Ok "backend\.env creado"
} else {
    Write-Ok "backend\.env ya existe (no se sobrescribe)"
}

# Frontend .env
$feEnv = "$ProjectDir\frontend\.env"
if (-not (Test-Path $feEnv)) {
    "VITE_API_URL=http://localhost:3001" | Out-File -Encoding ASCII $feEnv
    Write-Ok "frontend\.env creado"
}

# -------------------------------------------------------------
# 7. npm install + build
# -------------------------------------------------------------
Write-Step "Instalando dependencias backend..."
Push-Location "$ProjectDir\backend"
npm install --silent
Pop-Location
Write-Ok "Backend deps OK"

Write-Step "Instalando dependencias frontend..."
Push-Location "$ProjectDir\frontend"
npm install --silent
Pop-Location
Write-Ok "Frontend deps OK"

Write-Step "Compilando backend (TypeScript)..."
Push-Location "$ProjectDir\backend"
npm run build
Pop-Location
Write-Ok "Backend compilado"

Write-Step "Compilando frontend (Vite)..."
Push-Location "$ProjectDir\frontend"
npm run build
Pop-Location
Write-Ok "Frontend compilado"

# Carpetas runtime
New-Item -ItemType Directory -Force -Path "$ProjectDir\backend\uploads" | Out-Null
New-Item -ItemType Directory -Force -Path "$ProjectDir\backend\backups" | Out-Null
New-Item -ItemType Directory -Force -Path "$ProjectDir\logs" | Out-Null

# -------------------------------------------------------------
# 8. Tarea programada — arranque al iniciar sesión
# -------------------------------------------------------------
Write-Step "Configurando arranque automático (Programador de tareas)..."

$TaskName = "ERPLoga"
$StartScript = "$ProjectDir\start.ps1"

# Borrar tarea previa si existe
schtasks /query /tn $TaskName 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    schtasks /delete /tn $TaskName /f | Out-Null
}

# Crear nueva tarea: trigger AtLogon, ocultas ventanas
$action = "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`""
schtasks /create /tn $TaskName /tr $action /sc onlogon /rl highest /f | Out-Null
Write-Ok "Tarea '$TaskName' creada — arrancará al iniciar sesión"

# -------------------------------------------------------------
# 9. Arrancar ahora
# -------------------------------------------------------------
Write-Step "Arrancando ERP..."
Start-Process powershell -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`""
Start-Sleep -Seconds 3
Write-Ok "ERP arrancando en segundo plano"

# -------------------------------------------------------------
# Resumen
# -------------------------------------------------------------
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  Instalacion completada" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Backend:   http://localhost:3001"
Write-Host "  Frontend:  http://localhost:4173"
Write-Host ""
Write-Host "  Login admin (cambiar tras primer acceso):"
Write-Host "    Email:    admin@loga.es"
Write-Host "    Password: admin123"
Write-Host ""
Write-Host "  Comandos utiles:"
Write-Host "    .\start.bat        - arrancar manual"
Write-Host "    .\stop.bat         - parar todo"
Write-Host "    .\uninstall.bat    - desinstalar arranque automatico"
Write-Host "    Get-Content logs\backend.log -Tail 30 -Wait"
Write-Host ""
Write-Host "  Se arrancara solo cada vez que inicies sesion en Windows."
Write-Host "==========================================================="

} catch {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host " ERROR durante la instalacion" -ForegroundColor Red
    Write-Host "==========================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Mensaje:" -ForegroundColor Yellow
    Write-Host "  $($_.Exception.Message)" -ForegroundColor White
    Write-Host ""
    Write-Host "Linea: $($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor Yellow
    Write-Host "Comando que fallo:" -ForegroundColor Yellow
    Write-Host "  $($_.InvocationInfo.Line.Trim())" -ForegroundColor White
    Write-Host ""
    Write-Host "Stack trace:" -ForegroundColor DarkGray
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Pulsa Enter para cerrar..." -ForegroundColor Yellow
    Read-Host
    exit 1
}
