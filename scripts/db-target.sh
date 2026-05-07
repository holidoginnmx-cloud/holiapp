#!/bin/bash
# Alterna la DB que usa el API local (packages/api/.env) entre la DB de
# Railway (datos reales) y la DB local de Homebrew Postgres (sandbox).
#
# Pareado con api-target.sh: el ciclo típico de desarrollo es:
#   1. ./scripts/api-target.sh local     -> mobile habla con API local
#   2. ./scripts/db-target.sh local      -> API local escribe en DB local
#
# Uso:
#   ./scripts/db-target.sh local      # API -> postgres local (holidoginn_dev)
#   ./scripts/db-target.sh railway    # API -> Railway Postgres (producción)
#   ./scripts/db-target.sh status     # muestra a qué DB apunta hoy
#   ./scripts/db-target.sh            # (sin args) muestra status

set -e

ROOT="$(dirname "$0")/.."
# Tanto el API (en runtime) como Prisma CLI (cuando corres comandos en
# packages/db) leen DATABASE_URL desde su propio .env. Mantenemos los dos
# en sync para evitar surprises tipo "migrate deploy" pegándole a Railway
# cuando creías estar en local.
ENV_FILES=(
  "$ROOT/packages/api/.env"
  "$ROOT/packages/db/.env"
)
RAILWAY_URL="postgresql://postgres:jZwdcdfgpMreXRakHCAbktiVeJYBZsfN@roundhouse.proxy.rlwy.net:56529/railway"
LOCAL_USER="${USER}"
LOCAL_URL="postgresql://${LOCAL_USER}@localhost:5432/holidoginn_dev"

for f in "${ENV_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "❌ No existe $f"
    exit 1
  fi
done

current_url() {
  grep -E "^DATABASE_URL=" "${ENV_FILES[0]}" | head -1 | cut -d'=' -f2-
}

set_url() {
  local NEW_URL="$1"
  for f in "${ENV_FILES[@]}"; do
    sed -i '' -E "s|^DATABASE_URL=.*|DATABASE_URL=${NEW_URL}|" "$f"
  done
}

show_status() {
  local URL
  URL=$(current_url)
  echo "📍 API local apunta a DB: $URL"
  if [[ "$URL" == "$RAILWAY_URL" ]]; then
    echo "   Modo: 🚂 Railway (producción) — cuidado con tocar datos reales"
  elif [[ "$URL" == postgresql://${LOCAL_USER}@localhost:* ]]; then
    echo "   Modo: 💻 Local (Homebrew Postgres / holidoginn_dev)"
  else
    echo "   Modo: ❓ Desconocido"
  fi
}

cmd="${1:-status}"

case "$cmd" in
  local)
    # Verificar que Postgres local esté corriendo y la DB exista
    if ! lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "❌ Postgres local no está escuchando en 5432."
      echo "   Arráncalo con: brew services start postgresql@17"
      exit 1
    fi
    if ! psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw holidoginn_dev; then
      echo "❌ La DB 'holidoginn_dev' no existe."
      echo "   Créala con: createdb holidoginn_dev"
      echo "   Y aplica el schema con: cd packages/db && npx prisma migrate deploy"
      exit 1
    fi
    set_url "$LOCAL_URL"
    echo "✅ DATABASE_URL -> $LOCAL_URL"
    echo ""
    echo "Próximos pasos:"
    echo "  1. (Si es la primera vez) aplica el schema actual:"
    echo "     cd packages/db && npx prisma migrate deploy"
    echo "  2. Reinicia el API local para que tome el cambio:"
    echo "     cd packages/api && npm run dev"
    echo ""
    echo "💡 Tip: si quieres datos de prueba, importa un dump de Railway:"
    echo "   pg_dump '$RAILWAY_URL' --no-owner --no-acl | psql holidoginn_dev"
    ;;
  railway)
    set_url "$RAILWAY_URL"
    echo "✅ DATABASE_URL -> Railway (producción)"
    echo ""
    echo "Reinicia el API local:"
    echo "  cd packages/api && npm run dev"
    ;;
  status|"")
    show_status
    ;;
  *)
    echo "Uso: $0 {local|railway|status}"
    exit 1
    ;;
esac
