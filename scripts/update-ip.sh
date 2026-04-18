#!/bin/bash
# Detecta la IP local actual y actualiza BASE_URL en apps/mobile/src/constants/api.ts

set -e

# Obtener IP local (en0 = WiFi en macOS)
IP=$(ipconfig getifaddr en0 2>/dev/null || true)

if [ -z "$IP" ]; then
  echo "❌ No se pudo detectar la IP local. ¿Estás conectado a WiFi?"
  exit 1
fi

FILE="$(dirname "$0")/../apps/mobile/src/constants/api.ts"

if [ ! -f "$FILE" ]; then
  echo "❌ No se encontró $FILE"
  exit 1
fi

# Reemplazar la IP en BASE_URL
sed -i '' "s|http://[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}\.[0-9]\{1,3\}:3000|http://${IP}:3000|g" "$FILE"

echo "✅ IP actualizada a $IP en api.ts"
grep "BASE_URL" "$FILE"
