#!/usr/bin/env bash
set -e

echo "=== Iniciando despliegue de CargaExpress Backend ==="
cd /app

# ── Create required directories ──────────────────────────────────
mkdir -p /app/build/storage/logs

# ── Firebase credentials ──────────────────────────────────────────
if [ -n "$FIREBASE_CREDENTIALS_JSON" ]; then
  echo "Configurando Firebase desde FIREBASE_CREDENTIALS_JSON..."
  mkdir -p /app/build
  printf '%s\n' "$FIREBASE_CREDENTIALS_JSON" > /app/build/firebase-credentials.json
  export FIREBASE_CREDENTIALS_PATH=/app/build/firebase-credentials.json
  echo "✓ Firebase credentials escritas en $FIREBASE_CREDENTIALS_PATH"
fi

# ── Migraciones ───────────────────────────────────────────────────
echo "Ejecutando migraciones..."
node build/ace.js migration:run --force
echo "✓ Migraciones ejecutadas"

# ── Iniciar servidor ──────────────────────────────────────────────
echo "=== Iniciando servidor en modo producción ==="
exec node build/bin/server.js
