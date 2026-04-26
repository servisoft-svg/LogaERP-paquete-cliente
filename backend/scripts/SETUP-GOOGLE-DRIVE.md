# Conectar backups con Google Drive

## Paso a paso (15 minutos)

### 1. Crear proyecto en Google Cloud Console

1. Ve a https://console.cloud.google.com
2. Crea un proyecto nuevo: "Loga ERP Backups"
3. Ve a **APIs y servicios > Biblioteca**
4. Busca "Google Drive API" y activa

### 2. Crear Service Account (cuenta de servicio)

1. Ve a **APIs y servicios > Credenciales**
2. Click "Crear credenciales" > "Cuenta de servicio"
3. Nombre: "loga-backup"
4. Click "Crear y continuar" (salta los permisos opcionales)
5. Click en la cuenta de servicio creada
6. Pestaña "Claves" > "Agregar clave" > "Crear nueva clave" > JSON
7. Se descarga un fichero .json — abrelo

### 3. Copiar datos al .env

Del fichero JSON descargado, copia estos dos valores al `.env` del backend:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=loga-backup@tu-proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...(todo el bloque)...\n-----END PRIVATE KEY-----\n"
```

### 4. Crear carpeta en Google Drive y compartir

1. Ve a https://drive.google.com
2. Crea una carpeta: "Loga Backups"
3. Click derecho > "Compartir"
4. Añade el email de la service account (el GOOGLE_SERVICE_ACCOUNT_EMAIL)
5. Dale permiso de "Editor"
6. Copia el ID de la carpeta de la URL:
   `https://drive.google.com/drive/folders/1ABcDeFgHiJkLmNoPqRsTuVwXyZ`
   El ID es: `1ABcDeFgHiJkLmNoPqRsTuVwXyZ`

7. Añade al `.env`:
```
GOOGLE_DRIVE_FOLDER_ID=1ABcDeFgHiJkLmNoPqRsTuVwXyZ
```

### 5. Probar

Reinicia el backend y pulsa "Hacer backup" en Configuracion.
Debe decir: `drive: true`

Los backups cifrados aparecen en tu carpeta de Google Drive.
Nadie puede leerlos sin la clave `Loga2026`.

### 6. Automatico

El cron ya esta configurado para las 3:00 de la noche.
El backup se sube a Drive automaticamente cada dia.

### Resumen de lo que va al .env

```
BACKUP_PASSWORD=Loga2026
GOOGLE_SERVICE_ACCOUNT_EMAIL=loga-backup@tu-proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_FOLDER_ID=1ABcDeFgHiJkLmNoPqRsTuVwXyZ
```
