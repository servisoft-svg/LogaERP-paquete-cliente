# =============================================================
# ERP Loga - Instalador todo-en-uno para Windows 10/11
# =============================================================
# 100% automatico, sin prompts. Usa password fijo conocido para
# que la instalacion sea reproducible en cualquier maquina.
# =============================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # winget va mas rapido sin progress bar

# Forzar UTF-8 en consola
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 | Out-Null
} catch { }

function Write-Step($msg)  { Write-Host "[*] $msg" -ForegroundColor Blue }
function Write-Ok($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[X] $msg" -ForegroundColor Red }

# Refrescar PATH desde el registro (necesario tras instalar Node, PG, etc)
function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
}

# Descarga rapida con WebClient (mucho mas rapido que Invoke-WebRequest para >100MB)
function Download-File($url, $dest) {
    $wc = New-Object System.Net.WebClient
    try {
        $wc.DownloadFile($url, $dest)
    } finally {
        $wc.Dispose()
    }
    if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 1024) {
        throw "Descarga fallida: $url"
    }
}

# Localizar PSScriptRoot de forma fiable
if ($PSCommandPath) {
    $ProjectDir = Split-Path -Parent $PSCommandPath
} elseif ($MyInvocation.MyCommand.Path) {
    $ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    $ProjectDir = (Get-Location).Path
}
Set-Location $ProjectDir

try {

# =============================================================
# CONSTANTES
# =============================================================
$DbName  = "loga_erp"
$AppUser = "loga"          # usuario de aplicacion (igual que macOS)
$AppPass = "loga123"
$PgUser  = "postgres"      # superuser PostgreSQL
$PgPass  = "Loga_postgres_2024!"   # password fijo - instalado por este script
$PgVersion = "16"
$PgPort  = "5432"

Write-Host ""
Write-Host "==========================================================="
Write-Host "   ERP Loga - Instalador automatico Windows"
Write-Host "   $ProjectDir"
Write-Host "==========================================================="
Write-Host ""

# =============================================================
# 0. Verificar admin
# =============================================================
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    throw "Este script requiere permisos de administrador. Cierra y abre install.bat con clic derecho > Ejecutar como administrador."
}
Write-Ok "Ejecutando como administrador"

# Forzar TLS 1.2 para descargas (Win10 antiguo a veces solo trae TLS 1.0)
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# =============================================================
# 1. Node.js 20 LTS - descarga directa MSI
# =============================================================
$nodeVer = $null
try { $nodeVer = (& node -v 2>$null) } catch { }
if (-not $nodeVer -or [int](($nodeVer -replace 'v','').Split('.')[0]) -lt 20) {
    Write-Step "Descargando Node.js 20 LTS (~30MB)..."
    $nodeUrl = "https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi"
    $nodeMsi = "$env:TEMP\node-v20-x64.msi"
    Download-File $nodeUrl $nodeMsi
    Write-Ok "Descarga completa ($([math]::Round((Get-Item $nodeMsi).Length/1MB)) MB)"
    Write-Step "Instalando Node.js (silencioso, ~1 min)..."
    $proc = Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn /norestart" -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "Instalacion Node.js fallida (exit=$($proc.ExitCode))"
    }
    Remove-Item $nodeMsi -ErrorAction SilentlyContinue
    Refresh-Path
    Start-Sleep -Seconds 2
    $nodeVer = (& node -v 2>$null)
    if (-not $nodeVer) {
        throw "Node.js instalado pero 'node -v' no responde. Reinicia la sesion y relanza el script."
    }
    Write-Ok "Node.js instalado ($nodeVer)"
} else {
    Write-Ok "Node.js ya instalado ($nodeVer)"
}

# =============================================================
# 2. PostgreSQL 16 - descarga directa EDB, install unattended
# =============================================================
$pgPath = $null
foreach ($v in 17,16,15,14) {
    $candidate = "C:\Program Files\PostgreSQL\$v\bin"
    if (Test-Path "$candidate\psql.exe") { $pgPath = $candidate; break }
}

if (-not $pgPath) {
    Write-Step "Descargando PostgreSQL $PgVersion (~325MB, puede tardar 1-3 min)..."
    $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64.exe"
    $pgExe = "$env:TEMP\postgresql-installer.exe"
    Download-File $pgUrl $pgExe
    Write-Ok "Descarga completa ($([math]::Round((Get-Item $pgExe).Length/1MB)) MB)"

    Write-Step "Instalando PostgreSQL en modo unattended (3-7 min, sin prompts)..."
    # NetworkService no necesita password (cuenta del sistema). Usar
    # --servicepassword con NetworkService confunde al instalador.
    $pgInstallArgs = @(
        "--mode","unattended",
        "--unattendedmodeui","none",
        "--superpassword","$PgPass",
        "--servicename","postgresql-x64-$PgVersion",
        "--serviceaccount","NetworkService",
        "--serverport",$PgPort,
        "--disable-components","stackbuilder,pgAdmin"
    )
    $proc = Start-Process $pgExe -ArgumentList $pgInstallArgs -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "Instalacion PostgreSQL fallida (exit=$($proc.ExitCode)). Log: $env:TEMP\install-postgresql.log"
    }
    Remove-Item $pgExe -ErrorAction SilentlyContinue

    $pgPath = "C:\Program Files\PostgreSQL\$PgVersion\bin"
    if (-not (Test-Path "$pgPath\psql.exe")) {
        throw "PostgreSQL instalado pero psql.exe no encontrado en $pgPath"
    }
    Write-Ok "PostgreSQL instalado en $pgPath"

    $PgPass | Out-File -Encoding ASCII "$ProjectDir\.postgres_password.txt"
} else {
    Write-Ok "PostgreSQL ya instalado en $pgPath"

    if (Test-Path "$ProjectDir\.postgres_password.txt") {
        $PgPass = (Get-Content "$ProjectDir\.postgres_password.txt").Trim()
        Write-Ok "Password leido de .postgres_password.txt"
    } else {
        Write-Warn "PG pre-existente sin .postgres_password.txt — probare passwords comunes automaticamente."
        # NO guardar todavia; lo haremos cuando uno funcione
    }
}

$psql = Join-Path $pgPath "psql.exe"
$createdb = Join-Path $pgPath "createdb.exe"

# =============================================================
# 3. Conexion como postgres - intentar varios passwords si hace falta
# =============================================================
Write-Step "Verificando conexion a PostgreSQL..."

function Test-PgConnection($pass) {
    $env:PGPASSWORD = $pass
    & $psql -U $PgUser -d postgres -c "\q" 2>$null
    return ($LASTEXITCODE -eq 0)
}

# Esperar al servicio (recien instalado tarda en arrancar)
$svc = Get-Service "postgresql-x64-$PgVersion" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne "Running") {
    Write-Host "  Iniciando servicio postgresql-x64-$PgVersion..." -ForegroundColor DarkGray
    Start-Service "postgresql-x64-$PgVersion"
    Start-Sleep -Seconds 8
}

$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    if (Test-PgConnection $PgPass) { $ok = $true; break }
    Start-Sleep -Seconds 2
}

if (-not $ok) {
    # Probar passwords comunes por si PG estaba pre-instalado
    Write-Warn "Password '$PgPass' no funciono. Probando alternativas..."
    foreach ($try in @("postgres","postgres123","admin","loga123","Admin123")) {
        if (Test-PgConnection $try) {
            $PgPass = $try
            $PgPass | Out-File -Encoding ASCII "$ProjectDir\.postgres_password.txt"
            $ok = $true
            Write-Ok "Conectado con password '$try' (guardado)"
            break
        }
    }
}

if (-not $ok) {
    throw "No se conecta a PostgreSQL. Verifica el servicio: Get-Service postgresql-x64-$PgVersion. Si el password es distinto, escribelo en .postgres_password.txt y relanza."
}
Write-Ok "PostgreSQL responde"

# =============================================================
# 4. Crear usuario loga
# =============================================================
$env:PGPASSWORD = $PgPass
$userExists = & $psql -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$AppUser'" 2>$null
if ($userExists -and $userExists.Trim() -eq "1") {
    Write-Ok "Usuario '$AppUser' ya existe"
} else {
    Write-Step "Creando usuario '$AppUser'..."
    & $psql -U $PgUser -d postgres -c "CREATE USER $AppUser WITH PASSWORD '$AppPass' CREATEDB SUPERUSER;" | Out-Null
    Write-Ok "Usuario '$AppUser' creado (con CREATEDB y SUPERUSER)"
}

# =============================================================
# 5. Crear base de datos
# =============================================================
$dbExists = & $psql -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null
if ($dbExists -and $dbExists.Trim() -eq "1") {
    Write-Ok "Base de datos '$DbName' ya existe"
} else {
    Write-Step "Creando base de datos '$DbName'..."
    & $createdb -U $PgUser -O $AppUser $DbName
    Write-Ok "Base de datos creada"
}

# =============================================================
# 6. Aplicar migraciones
# =============================================================
Write-Step "Aplicando migraciones SQL..."
$env:PGPASSWORD = $AppPass
$applied = 0
Get-ChildItem "$ProjectDir\backend\database\migrations\*.sql" | Sort-Object Name | ForEach-Object {
    & $psql -U $AppUser -d $DbName -f $_.FullName 2>&1 | Out-Null
    $applied++
}
Write-Ok "Procesadas $applied migraciones"

# =============================================================
# 7. backend/.env y frontend/.env
# =============================================================
$envFile = "$ProjectDir\backend\.env"
if (-not (Test-Path $envFile)) {
    Write-Step "Generando backend\.env..."
    $jwt = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $bkp = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $whk = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    @"
# Generado por install.ps1 - $(Get-Date)
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
    Write-Ok "backend\.env ya existe"
}

$feEnv = "$ProjectDir\frontend\.env"
if (-not (Test-Path $feEnv)) {
    "VITE_API_URL=http://localhost:3001" | Out-File -Encoding ASCII $feEnv
    Write-Ok "frontend\.env creado"
}

# =============================================================
# 8. npm install + build
# =============================================================
Refresh-Path

function Run-Npm($workdir, $cmd, $label) {
    Write-Step "$label..."
    Push-Location $workdir
    try {
        # Redirigir a archivo log para no saturar la consola pero capturar errores
        $logFile = "$ProjectDir\logs\npm-$($label -replace '\s','_').log"
        & npm @cmd 2>&1 | Tee-Object -FilePath $logFile | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Tail del log:" -ForegroundColor Red
            Get-Content $logFile -Tail 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
            throw "$label fallo (exit=$LASTEXITCODE). Log: $logFile"
        }
    } finally {
        Pop-Location
    }
    Write-Ok "$label OK"
}

# Crear logs antes de los npm install que escriben ahi
New-Item -ItemType Directory -Force -Path "$ProjectDir\logs" | Out-Null

Run-Npm "$ProjectDir\backend"  @("install","--no-audit","--no-fund","--loglevel=error") "Backend npm install"
Run-Npm "$ProjectDir\frontend" @("install","--no-audit","--no-fund","--loglevel=error") "Frontend npm install"
Run-Npm "$ProjectDir\backend"  @("run","build") "Backend build"
Run-Npm "$ProjectDir\frontend" @("run","build") "Frontend build"

# Carpetas runtime
New-Item -ItemType Directory -Force -Path "$ProjectDir\backend\uploads" | Out-Null
New-Item -ItemType Directory -Force -Path "$ProjectDir\backend\backups" | Out-Null
New-Item -ItemType Directory -Force -Path "$ProjectDir\logs" | Out-Null

# =============================================================
# 9. Tarea programada (Register-ScheduledTask)
# =============================================================
Write-Step "Configurando arranque automatico..."

$TaskName = "ERPLoga"
$StartScript = "$ProjectDir\start.ps1"

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$psExe = (Get-Command powershell.exe).Source
$action = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`"" `
    -WorkingDirectory $ProjectDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "ERP Loga - arranque automatico al iniciar sesion" `
    -Force | Out-Null

Write-Ok "Tarea '$TaskName' creada (trigger: AtLogOn $env:USERNAME)"

# =============================================================
# 10. Arrancar ahora
# =============================================================
Write-Step "Arrancando ERP..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
Write-Ok "ERP arrancando en segundo plano"

# =============================================================
# Resumen
# =============================================================
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
Write-Host "  Passwords (guardados en .postgres_password.txt):"
Write-Host "    postgres (superuser): $PgPass"
Write-Host "    loga (app):           $AppPass"
Write-Host ""
Write-Host "  Comandos utiles:"
Write-Host "    .\start.bat        - arrancar manual"
Write-Host "    .\stop.bat         - parar todo"
Write-Host "    .\uninstall.bat    - desinstalar arranque automatico"
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
