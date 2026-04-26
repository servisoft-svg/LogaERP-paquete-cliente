# Instalar ERP Colas Loga en Windows

## Paso 1: Instalar Docker Desktop (5 minutos)

1. Descargar: https://www.docker.com/products/docker-desktop/
2. Ejecutar el instalador
3. Reiniciar Windows cuando lo pida
4. Abrir Docker Desktop y esperar a que diga "Docker is running"

## Paso 2: Copiar la carpeta del programa

Copiar la carpeta `Loga` completa al ordenador Windows, por ejemplo en `C:\Loga`

## Paso 3: Arrancar (1 comando)

Abrir PowerShell (click derecho en Inicio > Terminal) y ejecutar:

```powershell
cd C:\Loga
docker compose up -d
```

La primera vez tarda 3-5 minutos (descarga imagenes y compila).
Las siguientes veces arranca en 10 segundos.

## Paso 4: Acceder

Abrir el navegador y entrar en:

```
http://localhost
```

Usuarios:
- Admin: admin@loga.es / admin123
- Operario: operario@loga.es / operario123

## Acceder desde el movil

1. Buscar la IP del ordenador: Inicio > cmd > `ipconfig` > buscar "IPv4"
2. En el movil (conectado al mismo WiFi): `http://LA_IP`

## Comandos utiles

```powershell
# Ver estado
docker compose ps

# Ver logs
docker compose logs -f backend

# Parar
docker compose down

# Arrancar
docker compose up -d

# Reiniciar todo
docker compose restart

# Actualizar (despues de recibir archivos nuevos)
docker compose build
docker compose up -d
```

## Backup

Los backups se guardan automaticamente cada noche dentro del contenedor.
Para hacer uno manual:

```powershell
docker compose exec backend bash scripts/backup-seguro.sh
```

Para copiar el backup al escritorio:
```powershell
docker cp loga-backend-1:/backups/ C:\Users\TU_USUARIO\Desktop\backups
```

## Si algo falla

```powershell
# Borrar todo y empezar de cero (BORRA DATOS):
docker compose down -v
docker compose up -d
```

## Requisitos minimos
- Windows 10/11 (64 bits)
- 4 GB RAM
- 2 GB disco
- Docker Desktop instalado
