#!/usr/bin/env bash
# Empaqueta @holidoginn/shared y lo deja como tarball versionado en los repos
# hermanos (admin web y sitio), que lo instalan con `file:vendor/...`.
#
# Por qué un tarball y no un registry: los tres proyectos son repos separados,
# npm no instala subcarpetas de un repo git y GitHub Packages exige token
# incluso para leer. Con el tarball dentro de cada repo, Vercel instala sin
# credenciales y las copias a mano de tallas/precios/constantes desaparecen.
#
# Uso (desde la raíz del monorepo):  ./scripts/sync-shared.sh
# Después: commit en cada repo hermano (vendor/*.tgz + package.json + lockfile).
# Para publicar cambios de shared: subir "version" en packages/shared/package.json
# y volver a correr este script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHARED="$ROOT/packages/shared"
VERSION="$(node -p "require('$SHARED/package.json').version")"
TGZ="holidoginn-shared-$VERSION.tgz"
TARGETS=("$ROOT/../HolidogInn-web_app" "$ROOT/../HolidogInn-site")

echo "→ build @holidoginn/shared $VERSION"
(cd "$SHARED" && npm run build --silent && npm test --silent)
TMP="$(mktemp -d)"
(cd "$SHARED" && npm pack --pack-destination "$TMP" --silent)

for T in "${TARGETS[@]}"; do
  [ -d "$T" ] || { echo "   (no existe $T, se omite)"; continue; }
  mkdir -p "$T/vendor"
  rm -f "$T"/vendor/holidoginn-shared-*.tgz
  cp "$TMP/$TGZ" "$T/vendor/$TGZ"
  echo "→ $T: npm install ./vendor/$TGZ"
  (cd "$T" && npm install "./vendor/$TGZ" --silent)
done
rm -rf "$TMP"
echo "Listo. Commitea vendor/$TGZ, package.json y package-lock.json en cada repo."
