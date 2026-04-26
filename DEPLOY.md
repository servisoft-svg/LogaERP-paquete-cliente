# Despliegue en Produccion — ERP Colas Loga

## Requisitos
- Node.js 18+
- PostgreSQL 14+
- PM2 (npm install -g pm2)

## Primer despliegue

### 1. Base de datos
```bash
createdb loga_erp
psql loga_erp < backend/database/migrations/001_schema.sql
psql loga_erp < backend/database/migrations/002_seed.sql
```

### 2. Backend
```bash
cd backend
cp .env.example .env  # editar con datos reales
npm install
```

### 3. Frontend
```bash
cd frontend
npm install
npm run build
```

### 4. Arrancar
```bash
# Desde la raiz del proyecto:
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # auto-arranque al reiniciar

# Frontend (servir build estatico):
npx serve frontend/dist -s -l 5173 &
```

### 5. Verificar
```bash
curl http://localhost:3001/api/health
```

## Actualizaciones
```bash
git pull
cd frontend && npm run build
pm2 restart loga-backend
```

## Logs
```bash
pm2 logs loga-backend
tail -f logs/backend-out.log
```

## Backup
Automatico cada noche a las 3:00. Manual:
```bash
cd backend && bash scripts/backup-seguro.sh
```

## Usuarios por defecto
- Admin: admin@loga.es / admin123
- Operario: operario@loga.es / operario123
