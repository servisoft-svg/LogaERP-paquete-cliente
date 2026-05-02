# =============================================================
# ERP Loga - Instalador todo-en-uno para Windows 10/11
# =============================================================
# 100% automatico, sin prompts. Usa password fijo conocido para
# que la instalacion sea reproducible en cualquier maquina.
#
# Parametros:
#   -Fresh    Borra y recrea la base de datos desde cero (perdida
#             total de datos). Util para empezar limpio.
# =============================================================

param(
    [switch]$Fresh
)

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

# Reset password de postgres editando pg_hba.conf temporalmente a 'trust'.
# Necesario cuando hay PostgreSQL pre-instalado con password desconocido.
function Reset-PostgresPassword($pgVersion, $newPass, $serviceName) {
    $dataDir = "C:\Program Files\PostgreSQL\$pgVersion\data"
    $pgHba = "$dataDir\pg_hba.conf"
    $psqlExe = "C:\Program Files\PostgreSQL\$pgVersion\bin\psql.exe"

    if (-not (Test-Path $pgHba)) {
        throw "pg_hba.conf no encontrado en $pgHba"
    }

    Write-Step "Reseteando password de postgres via pg_hba.conf (trust temporal)..."

    # 1. Backup
    Copy-Item $pgHba "$pgHba.backup" -Force

    # 2. Reescribir TODAS las lineas host/local con metodo trust
    $original = Get-Content $pgHba
    $modified = $original | ForEach-Object {
        if ($_ -match '^\s*#' -or $_ -match '^\s*$') {
            $_  # comentarios y blancos sin tocar
        } elseif ($_ -match '^\s*(host|hostssl|hostnossl|local)\s+') {
            # Cambiar el ultimo campo (metodo) por trust
            $parts = $_ -split '\s+'
            $parts[-1] = 'trust'
            ($parts -join ' ')
        } else {
            $_
        }
    }
    $modified | Set-Content $pgHba -Encoding ASCII

    # 3. Reload del servicio (reload basta, no hace falta restart)
    Restart-Service $serviceName -Force
    Start-Sleep -Seconds 6

    # 4. Cambiar password con trust
    $env:PGPASSWORD = ""
    & $psqlExe -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD '$newPass';" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Copy-Item "$pgHba.backup" $pgHba -Force
        Restart-Service $serviceName -Force
        throw "ALTER USER fallo. pg_hba restaurado."
    }

    # 5. Restaurar pg_hba con autenticacion normal
    Copy-Item "$pgHba.backup" $pgHba -Force
    Remove-Item "$pgHba.backup" -Force
    Restart-Service $serviceName -Force
    Start-Sleep -Seconds 6

    Write-Ok "Password de postgres reseteado a '$newPass'"
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
# Instancia PostgreSQL DEDICADA a Loga (no toca ninguna existente):
#   - Servicio Windows:  postgresql-loga
#   - Puerto:            5433  (5432 es el estandar, lo dejamos libre)
#   - Carpeta:           C:\LogaERP\postgresql
#   - Password postgres: Loga_postgres_2024! (fijo, conocido)
$DbName    = "loga_erp"
$AppUser   = "loga"
$AppPass   = "loga123"
$PgUser    = "postgres"
$PgPass    = "Loga_postgres_2024!"
$PgVersion = "16"
$PgPort    = "5433"
$PgServiceName = "postgresql-loga"
$PgInstallDir  = "C:\LogaERP\postgresql"
$PgDataDir     = "C:\LogaERP\pgdata"

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
# 2. PostgreSQL DEDICADO para Loga (instancia aislada)
# =============================================================
# Usamos el ZIP portable de binarios (no el instalador EDB) + initdb +
# pg_ctl register. El instalador EDB detecta versiones previas en
# C:\Program Files\PostgreSQL\ y las "actualiza" ignorando --prefix,
# rompiendo el aislamiento. El zip portable garantiza instancia
# verdaderamente dedicada en C:\LogaERP\postgresql.
$pgPath = "$PgInstallDir\bin"
$psql = "$pgPath\psql.exe"
$createdb = "$pgPath\createdb.exe"

$pgInstalled = (Test-Path $psql) -and (Get-Service $PgServiceName -ErrorAction SilentlyContinue)

if (-not $pgInstalled) {
    # 2a. Visual C++ Redistributable x64 (PostgreSQL portable lo necesita)
    Write-Step "Instalando Visual C++ Redistributable x64..."
    $vcUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    $vcExe = "$env:TEMP\vc_redist.x64.exe"
    Download-File $vcUrl $vcExe
    $vcProc = Start-Process $vcExe -ArgumentList "/install","/quiet","/norestart" -Wait -PassThru
    # 0 = OK, 1638 = ya instalado version mas nueva, 3010 = OK pero pide reinicio (ignorable)
    if ($vcProc.ExitCode -notin 0, 1638, 3010) {
        throw "Instalacion VC++ Redistributable fallida (exit=$($vcProc.ExitCode))"
    }
    Remove-Item $vcExe -ErrorAction SilentlyContinue
    Write-Ok "VC++ Redistributable OK"

    # 2b. Limpiar restos de intentos previos
    if (Get-Service $PgServiceName -ErrorAction SilentlyContinue) {
        Stop-Service $PgServiceName -Force -ErrorAction SilentlyContinue
        & sc.exe delete $PgServiceName | Out-Null
        Start-Sleep -Seconds 2
    }
    if (Test-Path $PgInstallDir) {
        Write-Warn "Limpiando $PgInstallDir previo..."
        Remove-Item $PgInstallDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $PgDataDir) {
        Remove-Item $PgDataDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path "C:\LogaERP" | Out-Null

    # 2c. Descargar zip portable
    Write-Step "Descargando PostgreSQL $PgVersion portable (~200MB, paciencia 1-2 min)..."
    $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64-binaries.zip"
    $pgZip = "$env:TEMP\postgresql-portable.zip"
    Download-File $pgUrl $pgZip
    Write-Ok "Descarga completa ($([math]::Round((Get-Item $pgZip).Length/1MB)) MB)"

    # 2d. Extraer (el zip contiene una carpeta raiz "pgsql\")
    Write-Step "Extrayendo PostgreSQL en $PgInstallDir..."
    $pgTmp = "$env:TEMP\pg-extract"
    if (Test-Path $pgTmp) { Remove-Item $pgTmp -Recurse -Force }
    Expand-Archive -Path $pgZip -DestinationPath $pgTmp -Force
    Move-Item "$pgTmp\pgsql" $PgInstallDir
    Remove-Item $pgTmp -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $pgZip -ErrorAction SilentlyContinue
    if (-not (Test-Path $psql)) {
        throw "Extraccion fallida: $psql no existe"
    }

    # 2e. initdb (crea cluster con superuser=postgres y password fijo)
    Write-Step "Inicializando cluster en $PgDataDir..."
    $pwFile = "$env:TEMP\pgpw.txt"
    [System.IO.File]::WriteAllText($pwFile, $PgPass, [System.Text.Encoding]::ASCII)
    $initdb = "$pgPath\initdb.exe"
    & $initdb -D $PgDataDir -U $PgUser --pwfile=$pwFile -E UTF8 --locale=C --auth-host=scram-sha-256 --auth-local=scram-sha-256 | Out-Null
    Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) {
        throw "initdb fallo (exit=$LASTEXITCODE)"
    }

    # 2f. Configurar puerto y listen
    Add-Content "$PgDataDir\postgresql.conf" "`nport = $PgPort`nlisten_addresses = 'localhost'`n"

    # 2g. Permisos: NetworkService debe poder leer/escribir el data dir
    & icacls $PgDataDir /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /T /Q | Out-Null
    & icacls $PgInstallDir /grant "NT AUTHORITY\NetworkService:(OI)(CI)RX" /T /Q | Out-Null

    # 2h. Registrar servicio Windows con pg_ctl
    Write-Step "Registrando servicio Windows '$PgServiceName' en puerto $PgPort..."
    $pgCtl = "$pgPath\pg_ctl.exe"
    & $pgCtl register -N $PgServiceName -U "NT AUTHORITY\NetworkService" -D $PgDataDir -S auto | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "pg_ctl register fallo (exit=$LASTEXITCODE)"
    }

    # 2i. Iniciar servicio
    Start-Service $PgServiceName
    Start-Sleep -Seconds 5

    Write-Ok "PostgreSQL DEDICADO instalado en $PgInstallDir (servicio $PgServiceName, puerto $PgPort)"
} else {
    Write-Ok "PostgreSQL DEDICADO ya instalado en $PgInstallDir (servicio $PgServiceName)"
}

# Guardar password
$PgPass | Out-File -Encoding ASCII "$ProjectDir\.postgres_password.txt"

# =============================================================
# 3. Conexion como postgres - intentar varios passwords si hace falta
# =============================================================
Write-Step "Verificando conexion a PostgreSQL..."

function Test-PgConnection($pass) {
    $env:PGPASSWORD = $pass
    & $psql -h localhost -p $PgPort -U $PgUser -d postgres -c "\q" 2>$null
    return ($LASTEXITCODE -eq 0)
}

# Asegurar que el servicio esta corriendo
$svc = Get-Service $PgServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    throw "Servicio $PgServiceName no existe. Reinstala con install-fresh.bat"
}
if ($svc.Status -ne "Running") {
    Write-Host "  Iniciando servicio $PgServiceName..." -ForegroundColor DarkGray
    Start-Service $PgServiceName
    Start-Sleep -Seconds 8
}

# Esperar conexion - hasta 60 reintentos de 2s = 120s
$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    if (Test-PgConnection $PgPass) { $ok = $true; break }
    Start-Sleep -Seconds 2
}

if (-not $ok) {
    throw "PostgreSQL DEDICADO no responde en puerto $PgPort. Verifica: Get-Service $PgServiceName"
}
Write-Ok "PostgreSQL responde en puerto $PgPort"

# =============================================================
# 4. Crear usuario loga
# =============================================================
$env:PGPASSWORD = $PgPass
$userExists = & $psql -h localhost -p $PgPort -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$AppUser'" 2>$null
if ($userExists -and $userExists.Trim() -eq "1") {
    Write-Ok "Usuario '$AppUser' ya existe"
} else {
    Write-Step "Creando usuario '$AppUser'..."
    & $psql -h localhost -p $PgPort -U $PgUser -d postgres -c "CREATE USER $AppUser WITH PASSWORD '$AppPass' CREATEDB SUPERUSER;" | Out-Null
    Write-Ok "Usuario '$AppUser' creado (con CREATEDB y SUPERUSER)"
}

# =============================================================
# 5. Crear base de datos
# =============================================================
$dbExists = & $psql -h localhost -p $PgPort -U $PgUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null
if ($dbExists -and $dbExists.Trim() -eq "1") {
    if ($Fresh) {
        Write-Step "Modo -Fresh: borrando base de datos '$DbName' existente..."
        & $psql -h localhost -p $PgPort -U $PgUser -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DbName' AND pid<>pg_backend_pid();" 2>$null | Out-Null
        & $psql -h localhost -p $PgPort -U $PgUser -d postgres -c "DROP DATABASE IF EXISTS $DbName;" 2>$null | Out-Null
        Write-Ok "Base de datos anterior eliminada"
        Write-Step "Creando base de datos '$DbName' limpia..."
        & $createdb -h localhost -p $PgPort -U $PgUser -O $AppUser $DbName
        Write-Ok "Base de datos creada"
    } else {
        Write-Ok "Base de datos '$DbName' ya existe (usa -Fresh para recrear desde 0)"
    }
} else {
    Write-Step "Creando base de datos '$DbName'..."
    & $createdb -h localhost -p $PgPort -U $PgUser -O $AppUser $DbName
    Write-Ok "Base de datos creada"
}

# =============================================================
# 6. Aplicar migraciones
# =============================================================
# NOTA: NO usamos 2>&1 porque PowerShell 5.1 envuelve cada linea de
# stderr como ErrorRecord y, con ErrorActionPreference=Stop, eleva
# excepcion aunque psql devuelva exit 0 (los NOTICE de "IF NOT EXISTS"
# salen por stderr y se confundirian con errores).
# Usamos -v ON_ERROR_STOP=1 para que psql salga con exit!=0 SOLO en
# ERRORs reales y verificamos $LASTEXITCODE.
Write-Step "Aplicando migraciones SQL..."
$env:PGPASSWORD = $AppPass
$applied = 0
Get-ChildItem "$ProjectDir\backend\database\migrations\*.sql" | Sort-Object Name | ForEach-Object {
    $name = $_.Name
    & $psql -h localhost -p $PgPort -U $AppUser -d $DbName -v ON_ERROR_STOP=1 -q -f $_.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Migracion fallida: $name (exit=$LASTEXITCODE). Revisa los mensajes psql arriba."
    }
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
# PostgreSQL DEDICADO en puerto $PgPort (servicio $PgServiceName)
DATABASE_URL=postgresql://${AppUser}:${AppPass}@localhost:${PgPort}/$DbName
JWT_SECRET=$jwt
BACKUP_PASSWORD=$bkp
WEBHOOK_TOKEN=$whk
CORS_ORIGIN=http://localhost:4173
PORT=3001
NODE_ENV=production
LOG_LEVEL=info
"@ | Out-File -Encoding ASCII $envFile
    Write-Ok "backend\.env creado (DATABASE_URL apunta a localhost:$PgPort)"
} else {
    Write-Warn "backend\.env ya existe — verifica que DATABASE_URL apunte a localhost:$PgPort"
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
Write-Host "  PostgreSQL DEDICADO (instancia aislada de Loga):"
Write-Host "    Servicio:  $PgServiceName"
Write-Host "    Puerto:    $PgPort  (5432 sigue libre para otras BDs)"
Write-Host "    Carpeta:   $PgInstallDir"
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
