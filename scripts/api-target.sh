#!/bin/bash
# Alterna el target del API que usa la app móvil entre Railway (producción)
# y un API local (corriendo en tu Mac con `cd packages/api && npm run dev`).
#
# El API local sigue usando la DB de Railway, así que pruebas cambios al
# backend con datos reales sin tener que pushear ni desplegar.
#
# Uso:
#   ./scripts/api-target.sh local      # mobile -> http://<tu-IP>:4000
#   ./scripts/api-target.sh railway    # mobile -> https://api-production-36cd.up.railway.app
#   ./scripts/api-target.sh status     # muestra a qué apunta hoy
#   ./scripts/api-target.sh            # (sin args) muestra status

set -e

ENV_FILE="$(dirname "$0")/../apps/mobile/.env"
RAILWAY_URL="https://api-production-36cd.up.railway.app"
LOCAL_PORT="4000"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ No existe $ENV_FILE"
  exit 1
fi

current_url() {
  grep -E "^EXPO_PUBLIC_API_URL=" "$ENV_FILE" | head -1 | cut -d'=' -f2-
}

set_url() {
  local NEW_URL="$1"
  # macOS sed -i requiere sufijo (ahí va el "")
  sed -i '' -E "s|^EXPO_PUBLIC_API_URL=.*|EXPO_PUBLIC_API_URL=${NEW_URL}|" "$ENV_FILE"
}

show_status() {
  local URL
  URL=$(current_url)
  echo "📍 Mobile apunta a: $URL"
  if [[ "$URL" == "$RAILWAY_URL" ]]; then
    echo "   Modo: 🚂 Railway (producción)"
  elif [[ "$URL" == http://*:${LOCAL_PORT} ]]; then
    echo "   Modo: 💻 Local (necesitas correr 'cd packages/api && npm run dev')"
  else
    echo "   Modo: ❓ Desconocido"
  fi
}

cmd="${1:-status}"

case "$cmd" in
  local)
    IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
    if [ -z "$IP" ]; then
      echo "❌ No se pudo detectar IP local (en0/en1). ¿WiFi conectado?"
      exit 1
    fi
    NEW_URL="http://${IP}:${LOCAL_PORT}"
    set_url "$NEW_URL"
    echo "✅ Mobile -> $NEW_URL"
    echo ""
    echo "Próximos pasos:"
    echo "  1. Asegúrate que el API local esté corriendo:"
    echo "     cd packages/api && npm run dev"
    echo "  2. Reinicia Expo con cache limpio:"
    echo "     cd apps/mobile && npx expo start -c"
    echo "  3. Tu Mac ($IP) y el dispositivo deben estar en la misma red WiFi."
    ;;
  railway)
    set_url "$RAILWAY_URL"
    echo "✅ Mobile -> $RAILWAY_URL"
    echo ""
    echo "Reinicia Expo con cache limpio:"
    echo "  cd apps/mobile && npx expo start -c"
    ;;
  status|"")
    show_status
    ;;
  *)
    echo "Uso: $0 {local|railway|status}"
    exit 1
    ;;
esac
