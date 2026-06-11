#!/usr/bin/env bash
set -e

echo "=== Iniciando despliegue de CargaExpress Backend ==="
cd /app/build

# ── Instalar dependencias de producción ───────────────────────────
echo "Instalando dependencias de producción..."
npm ci --omit=dev
echo "✓ Dependencias instaladas"

# ── Firebase credentials ──────────────────────────────────────────
if [ -n "$FIREBASE_CREDENTIALS_JSON" ]; then
  echo "Configurando Firebase desde FIREBASE_CREDENTIALS_JSON..."
  echo "$FIREBASE_CREDENTIALS_JSON" > ./firebase-credentials.json
  export FIREBASE_CREDENTIALS_PATH=./firebase-credentials.json
  echo "✓ Firebase credentials escritas"
fi

# ── Google Service Account (backups) ──────────────────────────────
if [ -n "$GOOGLE_SERVICE_ACCOUNT_KEY" ]; then
  echo "Configurando Google Service Account..."
  echo "$GOOGLE_SERVICE_ACCOUNT_KEY" > ./google-service-account.json
  export GOOGLE_SERVICE_ACCOUNT_KEY=./google-service-account.json
  echo "✓ Google Service Account escrita"
fi

# ── Migraciones ───────────────────────────────────────────────────
echo "Ejecutando migraciones..."
node ace migration:run --force
echo "✓ Migraciones ejecutadas"

# ── Iniciar servidor ──────────────────────────────────────────────
echo "=== Iniciando servidor en modo producción ==="
exec node bin/server.js
