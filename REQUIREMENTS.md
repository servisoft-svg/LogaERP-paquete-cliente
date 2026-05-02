# ERP Loga — Requisitos del sistema

Todo lo necesario para que el ERP corra. El instalador `install.sh` se encarga
de descargarlo e instalarlo automáticamente — este documento es la referencia.

## Sistema operativo

- **macOS 12** (Monterey) o superior, Apple Silicon o Intel → `./install.sh`
- **Windows 10 1709+** o **Windows 11** → `install.bat` (PowerShell + winget)
- Linux (Ubuntu 22+ / Debian 12+) — manual, sin instalador automatizado

## Software base

### macOS (instalado por `install.sh` vía Homebrew)

| Programa | Versión mínima | Comando manual |
|---|---|---|
| Homebrew | última | el script lo instala si falta |
| Node.js | 20 LTS | `brew install node@20` |
| PostgreSQL | 14+ | `brew install postgresql@16` |
| Redis *(opcional)* | 7+ | `brew install redis` — sin Redis BullMQ cae a modo inline |
| rclone *(opcional)* | última | `brew install rclone` — para backups a Google Drive |

### Windows (instalado por `install.ps1` vía winget)

| Programa | Versión mínima | ID winget |
|---|---|---|
| winget | preinstalado en Win 10 1709+ / Win 11 | (App Installer en Microsoft Store) |
| Node.js | 20 LTS | `OpenJS.NodeJS.LTS` |
| PostgreSQL | 16 | `PostgreSQL.PostgreSQL.16` |
| Redis *(opcional)* | 7+ | `Redis.Redis` |

## Dependencias Node.js

### Backend (`backend/package.json`)

**Producción:**
- express ^4.18.3
- pg ^8.11.5 — driver PostgreSQL
- jsonwebtoken ^9.0.3 — auth JWT
- bcryptjs ^3.0.3 — hash de contraseñas
- helmet ^7.2.0 + express-rate-limit ^8.3.2 + cors ^2.8.5 — seguridad
- express-validator ^7.1.0 — validación
- compression ^1.8.1 — gzip responses
- multer ^2.1.1 — uploads
- dotenv ^16.4.5 — env vars
- nodemailer ^6.9.13 — emails (Gmail, SMTP)
- pdfkit ^0.18.0 — generación PDFs (albaranes)
- bullmq ^5.76.1 + ioredis ^5.10.1 — colas opcionales
- googleapis ^171.4.0 — Google Drive backups
- winston ^3.13.0 — logging

**Dev/build:**
- typescript ^5.4.5, tsx ^4.8.2, vitest ^4.1.4

### Frontend (`frontend/package.json`)

- react ^18.3.1, react-dom ^18.3.1, react-router-dom ^6.23.1
- vite ^5.2.12 + @vitejs/plugin-react ^4.3.0
- tailwindcss ^3.4.4 + postcss ^8.4.38 + autoprefixer ^10.4.19
- framer-motion ^11.2.6 — animaciones
- lucide-react ^0.378.0 — iconos
- axios ^1.7.2 — HTTP client
- date-fns ^3.6.0
- clsx ^2.1.1
- sileo ^0.1.5 — toasts
- serve ^14.2.6 — servidor estático para frontend buildeado

## Variables de entorno (`backend/.env`)

**Obligatorias** (las genera `install.sh` con valores aleatorios seguros):

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Cadena conexión PostgreSQL |
| `JWT_SECRET` | Firma tokens JWT (32+ chars) |
| `BACKUP_PASSWORD` | Cifrado AES-256 de backups |
| `CORS_ORIGIN` | Origen permitido para CORS |

**Opcionales:**

| Variable | Default |
|---|---|
| `PORT` | 3001 |
| `NODE_ENV` | development |
| `LOG_LEVEL` | info |
| `SMTP_HOST/PORT/USER/PASS` | (sin email si no se configura) |
| `EMAIL_FROM` | `ERP Loga <erp@loga.es>` |
| `WEBHOOK_TOKEN` | (sin webhook si vacío) |
| `REDIS_URL` | (colas inline si vacío) |

## Base de datos

PostgreSQL con esquema definido en migraciones:

- `backend/database/migrations/001_schema.sql` — esquema base
- `backend/database/migrations/002_seed.sql` — datos iniciales (admin, productos demo)
- `003_*.sql` … `029_*.sql` — evoluciones incrementales

`install.sh` aplica todas en orden numérico.

**Usuario admin por defecto** (creado por `002_seed.sql`):
- Email: `admin@loga.es`
- Password: `admin123` ⚠️ **cambiar tras la instalación**

## Puertos usados

| Puerto | Servicio |
|---|---|
| 3001 | Backend Node.js |
| 5173 | Frontend (modo dev) |
| 4173 | Frontend (modo preview/serve) |
| 5432 | PostgreSQL |
| 6379 | Redis (si está) |

## Espacio en disco

- ~500 MB código + node_modules
- ~1-5 GB base de datos según uso
- ~varios GB en `backend/uploads/` y `backend/backups/` con el tiempo

## Permisos por plataforma

### macOS
- **Notificaciones** del navegador (opcional)
- `~/Library/LaunchAgents/` → escribir un `.plist` (sin permisos especiales)

### Windows
- **Administrador** durante la instalación (para winget + PostgreSQL service)
- Programador de tareas → trigger `OnLogon` con permiso `highest`
- Firewall puede pedir permiso para Node.js la primera vez → permitir red local

## Mecanismo de auto-arranque

| Plataforma | Mecanismo | Archivo creado |
|---|---|---|
| macOS | launchd Agent | `~/Library/LaunchAgents/com.loga.erp.plist` |
| Windows | Programador de tareas (Task Scheduler) | tarea `ERPLoga` (trigger AtLogon) |

En ambos casos, si el proceso muere, **se relanza automáticamente** (KeepAlive en Mac, watchdog en Windows).
