# ERP Loga — Instalación rápida

## Detección automática de plataforma

| Tu sistema | Ejecuta |
|---|---|
| **macOS** | `./install.sh` (Terminal) |
| **Windows 10/11** | doble-clic en `install.bat` |
| **Linux** | manual (ver `REQUIREMENTS.md`) |

Cada lanzador detecta la plataforma. Si te equivocas (lanzas `install.sh`
en Windows o viceversa), te avisará.

---

## macOS — desde cero

```bash
cd /ruta/donde/esté/Loga
./install.sh
```

El script:

1. Instala Homebrew si falta
2. Instala Node.js 20 y PostgreSQL 16
3. Crea la base de datos `loga_erp`
4. Aplica las 29 migraciones SQL
5. Genera `backend/.env` con secretos aleatorios seguros
6. Instala todas las dependencias npm (backend + frontend)
7. Compila TypeScript del backend y bundle Vite del frontend
8. Instala un agente **launchd** que arranca el ERP **automáticamente al iniciar el Mac**
9. Arranca el servicio inmediatamente

Tarda 5-10 min la primera vez (descarga PostgreSQL + node_modules).

---

## Windows 10/11 — desde cero

1. Doble-clic en **`install.bat`**
2. Acepta el aviso UAC ("¿Permitir cambios?") → **Sí**
3. Espera 10-15 min (PostgreSQL pesa)

El script PowerShell:

1. Verifica `winget` (incluido en Win 10 1709+ / Win 11)
2. Instala Node.js 20 LTS y PostgreSQL 16 (silent install)
3. Crea base de datos `loga_erp` (con password aleatorio guardado en `.postgres_password.txt`)
4. Aplica las 29 migraciones SQL
5. Genera `backend\.env` con secretos aleatorios
6. Instala dependencias npm + compila
7. Crea tarea en **Programador de tareas** ("ERPLoga"), trigger `AtLogon`
8. Arranca el ERP en segundo plano

> Si ya tenías PostgreSQL instalado, te pedirá el password de `postgres`.

---

## Acceso (las dos plataformas)

- ERP web: <http://localhost:4173>
- API: <http://localhost:3001>

Login admin inicial:
- Email: `admin@loga.es`
- Password: `admin123` ⚠️ **cambiar tras el primer acceso**

---

## Comandos diarios

### macOS

| Comando | Qué hace |
|---|---|
| `./start.sh` | Arrancar manual |
| `./stop.sh` | Parar y desactivar auto-arranque |
| `./uninstall.sh` | Quitar auto-arranque |
| `tail -f logs/backend.log` | Ver logs backend |

### Windows

| Comando | Qué hace |
|---|---|
| `start.bat` | Arrancar manual |
| `stop.bat` | Parar todo |
| `uninstall.bat` | Quitar tarea programada |
| `Get-Content logs\backend.log -Tail 30 -Wait` | Ver logs (PowerShell) |
| `schtasks /run /tn ERPLoga` | Disparar la tarea ahora |

---

## Troubleshooting

### "Backend no arranca"

- **macOS**: revisa `logs/backend.log`. Reinicia PostgreSQL: `brew services restart postgresql@16`
- **Windows**: `Get-Content logs\backend.log`. Reinicia PostgreSQL: `Restart-Service postgresql-16`

### "Puerto ocupado"

- 3001 (backend) o 4173 (frontend)
- macOS: `lsof -i:3001` → `kill -9 PID`
- Windows: `netstat -ano | findstr :3001` → `Stop-Process -Id PID -Force`

### "El ERP no arranca al reiniciar"

- macOS: `launchctl list | grep loga`. Si no aparece → `./install.sh` reinstala
- Windows: `schtasks /query /tn ERPLoga`. Si no aparece → `install.bat` reinstala

### "No tengo winget" (Windows)

Win 10 muy antiguo. Instala 'App Installer' desde Microsoft Store o
actualiza a la última versión 22H2 / Win 11.

### "No tengo Homebrew" (macOS)

`install.sh` lo instala automáticamente. Si falla manualmente:
`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

---

## Archivos generados (no commitear)

```
backend/.env                                  # secretos
backend/dist/                                 # build TS
frontend/dist/                                # build Vite
logs/                                         # runtime logs
.postgres_password.txt                        # solo Windows
~/Library/LaunchAgents/com.loga.erp.plist     # solo macOS
Tarea programada "ERPLoga"                    # solo Windows
```

---

## Actualizar a versión nueva

```bash
git pull
./install.sh   # macOS
install.bat    # Windows
```

Los instaladores son **idempotentes**: aplican migraciones nuevas, recompilan y recargan sin tocar lo que ya funciona.

Ver `REQUIREMENTS.md` para detalles técnicos completos.
