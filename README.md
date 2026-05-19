# ERP Loga — Paquete de Instalación

Sistema de gestión ERP para fábrica de adhesivos: productos, recetas, lotes,
producción, calidad, pedidos, finanzas. Backend Node + frontend React ya compilado.

## Requisitos

- Windows 10/11
- Node.js 18+
- PostgreSQL 16 (puerto 5433)

Si no los tienes, `install.bat` lo instala todo automáticamente.

## Primera instalación

1. Descomprime el ZIP en `C:\LogaERP`.
2. Renombra `backend\.env.example` a `backend\.env` y rellena los valores
   marcados como `CAMBIAR_*`. Genera secrets aleatorios con:
   ```
   openssl rand -hex 32
   ```
3. Doble-click `install.bat` (instala Node + PostgreSQL si faltan).
4. Doble-click `crear-acceso-directo.bat` (crea icono en Escritorio).
5. Doble-click en el icono **"Loga ERP"** del Escritorio.
6. El navegador se abre solo en `http://localhost:5173`.
7. Login: `admin@loga.es` / `Admin123!` → cámbialo al primer acceso.

## Migración desde versión anterior

Si el PC ya tiene una versión vieja del ERP con datos:

1. Cierra la versión vieja.
2. Descomprime ESTE ZIP sobre `C:\LogaERP` (NO toques `C:\LogaERP\pgdata`).
3. Doble-click `migrar-cliente.bat` → backup automático + migraciones nuevas
   sobre los datos existentes.
4. Espera al mensaje `[migrations] OK`. Cierra.
5. Doble-click en el icono "Loga ERP".

## Uso diario

Doble-click en **"Loga ERP"** del escritorio. Para arranque automático al
encender el PC: copia ese acceso directo a `shell:startup` (`Win+R`).

## Backups

Se hacen automáticos cada noche (locales + Google Drive si está configurado).

Manual: dentro del ERP → Configuración → Backup → "Crear Backup Ahora".

⚠ La `BACKUP_PASSWORD` en `backend/.env` cifra los backups. **Anótala fuera del
ERP**. Sin ella no se pueden restaurar.

## Estructura

- `backend/` — código del servidor (Node + TypeScript)
- `frontend/dist/` — frontend ya compilado
- `database/migrations/` — SQL de migraciones (se aplican al arrancar)
- `logaerp-produccion.bat` — arranque del ERP
- `migrar-cliente.bat` — migración desde versión anterior
- `crear-acceso-directo.bat` — crea icono en Escritorio
- `install.bat` — instala Node + PostgreSQL si faltan
- `exportar-db.bat` / `importar-db.bat` — backup/restore manual via pg_dump

## Soporte

Repo: https://github.com/servisoft-svg/LogaERP-paquete-cliente
