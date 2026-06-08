# RUNBOOK — DB unificada de Holidog Inn en Supabase

> Construir la **única** DB PostgreSQL del sistema **reusando el proyecto Supabase existente de la web admin** (`SUPABASE_PROJECT_ID`, con datos reales + bucket `fotos-perros`). Prisma pasa a poseer el esquema; sus tablas inglesas se crean **junto** a las legacy en español, se siembran catálogos, se importan/verifican los datos, se aplican vistas/RLS, se repunta la API de Railway y, al final, se desechan las legacy y la DB de Railway.

Este runbook ya incorpora las correcciones de una verificación adversarial (gaps de pérdida de datos, colisión de vistas, conteos, recovery de migraciones, credenciales). Léelo completo y revisa **PUNTOS DE NO RETORNO** antes de ejecutar.

## Estado de partida (verificado)
- **App móvil**: monorepo Turbo; API Fastify + Prisma desplegado en **Railway** (su DB Postgres está **vacía**, pre-lanzamiento). `railway.json` ya corre `npx prisma@6.19.2 migrate deploy` en el arranque.
- **Web admin**: Next.js + `@supabase/supabase-js` (service role) contra un proyecto **Supabase** con los datos reales y el bucket `fotos-perros`.
- `packages/db/schema.prisma`: datasource **solo** tiene `url` (sin `directUrl`). **26 migraciones** existentes; **0** usan extensiones/`gen_random_uuid` (ids `cuid()` de app).
- Ya creados en este repo: `packages/db/sql/dashboard_views.sql` (vistas/RLS/triggers/buckets, con DROP idempotente de las 6 vistas) y `packages/db/scripts/import-legacy.ts` (import idempotente + `verify()` con conteos por id, comparación apples-to-apples y reporte de huérfanos).

---

## TABLA DE ENV VARS

| Nombre | Forma | Dónde va | Origen |
|---|---|---|---|
| `DATABASE_URL` (runtime API) | `postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:6543/postgres?pgbouncer=true&connection_limit=8&sslmode=require` | **Railway** (API) | Botón **Connect → Transaction pooler** |
| `DIRECT_URL` (migraciones/CLI) | `postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require` | **Railway** (API) + **local** | Botón **Connect → Session pooler** |
| `DATABASE_URL` (Docker shadow, FASE C) | `postgresql://postgres:postgres@localhost:5433/holidog` | **local** (solo FASE C) | Docker local |
| `SUPABASE_PROJECT_ID` (`<REF>`) | `vywghpkeagfkbwdfiwod` *(confírmalo)* | **Vercel** (admin) — ya existe | `.env.local` del admin |
| `SUPABASE_ACCESS_TOKEN` | `sbp_...` | **local/CI** del admin | supabase.com → **Account → Access Tokens** |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | (sin cambio) | **Vercel** (admin) | ya existen |
| Clerk del admin: `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_*` | (sin cambio) | **Vercel** (admin) | ya existen — **no se tocan** |

**Reglas de oro de conexión** (verificadas contra docs Supabase/Prisma 2026):
- **NUNCA** uses la *Direct connection* `db.<REF>.supabase.co:5432` desde Railway: es **IPv6-only** y Railway no rutea IPv6 → `ENETUNREACH`. Usa el **session pooler** (`...pooler.supabase.com:5432`, IPv4) para `DIRECT_URL`.
- `?pgbouncer=true` va **solo** en `DATABASE_URL` (6543, transaction mode). **Nunca** en `DIRECT_URL` (5432) — rompe migraciones.
- Usuario del pooler lleva **punto**: `postgres.<REF>`. Confundirlo con `postgres` da `Tenant or user not found`.
- **Copia las cadenas COMPLETAS** del botón Connect; lo único que añades a mano es el query string. El prefijo de host (`aws-0`/`aws-1`/región) varía por proyecto.
- `connection_limit=8` (no 1) para una instancia Fastify **persistente** detrás del pooler. `=1` es para serverless y causaría `P2024` bajo concurrencia. Mantén `(instancias × connection_limit) ≪ pool del pooler` (~15 en tiers chicos).
- Mantén el **pin `prisma@6.19.2`** en todos los comandos. **No** uses `prisma@latest`: Prisma 7 elimina `directUrl` del datasource y rompería el schema.

---

## ORDEN GLOBAL
**B** (schema+commit) → **C** (migrate dev local → commit → migrate deploy Supabase) → **C-seeds** (rooms/services/vaccines) → **E** (import legacy + verify al centavo) → **D** (vistas/RLS/storage) → **F** (Railway → Supabase) → **G** (tipos + repuntar admin) → **H** (drop legacy + eliminar Railway).

> Nota de orden: **E (import) va ANTES de D (vistas)** a propósito. Las vistas del dashboard se recrean sobre las tablas inglesas; si se hicieran antes del import mostrarían **$0** mientras se llenan. Haciendo el import primero, al recrear las vistas ya tienen datos y el dashboard del admin nunca muestra ceros (las tablas legacy y sus vistas siguen sirviendo al admin hasta el paso D).

---

## FASE A — Preparar Supabase y RESPALDAR

**A.1** Confirma el proyecto: `grep SUPABASE_PROJECT_ID /Users/user/Desktop/HolidogInn/HolidogInn-web_app/.env.local`.

**A.2** En el dashboard del proyecto → botón **Connect**: copia **Transaction pooler** (6543) y **Session pooler** (5432). Añade los query strings de la tabla de arriba.

**A.3** Anota la **versión mayor de Postgres** del proyecto (Settings → Infrastructure) para igualar la imagen Docker en FASE C.

**A.4 — RESPALDO (antes de tocar nada).** El `pg_dump` local debe ser **>=** la versión del server (gate duro, no informativo):
```bash
export DIRECT_URL='postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require'
pg_dump --version            # si es < versión del server (A.3): DETENTE y actualiza (brew upgrade libpq)
pg_dump "$DIRECT_URL" -Fc -b -v -f ~/holidog_supabase_PREUNIFY_$(date +%Y%m%d).dump
pg_restore --list ~/holidog_supabase_PREUNIFY_$(date +%Y%m%d).dump | head   # debe listar sin error
```
Además, toma un **snapshot** en Database → Backups si tu plan lo permite.

**A.5 — Verifica que Supabase está LIMPIO de Prisma** (vía SQL Editor):
```sql
select to_regclass('_prisma_migrations');   -- debe ser NULL. Si no, hay un intento previo: resolver con migrate resolve antes de C.
```

**✅ Done A:** ambas strings verificadas, versión Postgres anotada, `.dump` que pasa `pg_restore --list`, `_prisma_migrations` = NULL.

---

## FASE B — Configurar Prisma para Supabase

**B.1** Edita `packages/db/schema.prisma`, bloque `datasource db`:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled 6543 (pgbouncer=true) -> runtime app
  directUrl = env("DIRECT_URL")     // session 5432 -> prisma migrate/deploy/introspect
}
```
**B.2** (Recomendado) Fija `@prisma/client` y `prisma` a **6.19.2** exacto en `packages/db/package.json`; luego `npm install` desde la raíz.

**B.3** Commitea **antes** del cutover de Railway (si no, el `migrate deploy` del arranque migraría por el pooler y fallaría):
```bash
git -C /Users/user/Desktop/HolidogInn/HolidogInn_App add packages/db/schema.prisma packages/db/package.json package-lock.json
git -C /Users/user/Desktop/HolidogInn/HolidogInn_App commit -m "feat(db): directUrl + pin prisma 6.19.2 para cutover a Supabase"
```
**B.4** **No** sobrescribas `packages/db/.env` (apunta a `localhost` a propósito; `cleanup-for-testing.ts` aborta si `DATABASE_URL` no es localhost — red de seguridad). Las URLs de Supabase se pasan **inline** por comando. El inline gana sobre dotenv (dotenv no sobreescribe `process.env`), y el script `import-legacy.ts` imprime el **host enmascarado** al arrancar para que confirmes visualmente.

**✅ Done B:** `grep -n directUrl packages/db/schema.prisma` muestra la línea; commiteado; Prisma alineado a 6.19.2.

---

## FASE C — Generar y aplicar la migración del esquema nuevo

Los modelos nuevos (Expense, Sponsor, HotelConfig; enums PaymentKind/CostType; DAYCARE; nullables/flags legacy; ProBARF/daycare en LodgingPricing) están en el schema pero **no migrados**. **No** corras `migrate dev` contra Supabase (necesita shadow DB y falla). Genera contra un **Postgres local**, luego `migrate deploy` a Supabase.

**C.0 Prechecks:** `docker info` (Docker corriendo); si el puerto 5433 está ocupado usa otro. (No se requieren extensiones: confirmado 0 usos de `CREATE EXTENSION`/`gen_random_uuid`.)

**C.1** Postgres local desechable (iguala versión mayor a A.3, ej. 16):
```bash
docker run --name holidog-shadow -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=holidog -p 5433:5432 -d postgres:16
```
**C.2** Genera la migración contra el local:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/holidog" \
DIRECT_URL="postgresql://postgres:postgres@localhost:5433/holidog" \
npx prisma@6.19.2 migrate dev --name unify_financials_daycare \
  --schema=/Users/user/Desktop/HolidogInn/HolidogInn_App/packages/db/schema.prisma
```
**C.3** Revisa y commitea la carpeta nueva de migración:
```bash
ls -1d /Users/user/Desktop/HolidogInn/HolidogInn_App/packages/db/migrations/*/ | tail -2
git -C /Users/user/Desktop/HolidogInn/HolidogInn_App add packages/db/migrations/
git -C /Users/user/Desktop/HolidogInn/HolidogInn_App commit -m "feat(db): migración unify_financials_daycare"
```
**C.4** Aplica TODO el historial a Supabase (session pooler 5432; sin shadow):
```bash
DATABASE_URL='postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require' \
DIRECT_URL='postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require' \
npx prisma@6.19.2 migrate deploy --schema=/Users/user/Desktop/HolidogInn/HolidogInn_App/packages/db/schema.prisma
```
**C.5 Verifica** (SQL Editor): el conteo de `_prisma_migrations` debe igualar el número de carpetas de migración (no un número mágico):
```bash
# en local:
ls -1d packages/db/migrations/*/ | wc -l        # = 27 tras la nueva (26 + 1)
```
```sql
select count(*) from _prisma_migrations;        -- debe coincidir con el número de carpetas
-- tablas inglesas:
select table_name from information_schema.tables where table_schema='public'
 and table_name in ('users','pets','reservations','payments','expenses','sponsors','hotel_config','lodging_pricing','rooms');
-- coexisten las legacy:
select table_name from information_schema.tables where table_schema='public'
 and table_name in ('clientes','perros','reservaciones','pagos','egresos','config','patrocinios','tarifas');
```

> ⚠️ **PUNTO DE NO RETORNO #1:** `migrate deploy` escribe en la Supabase real (aditivo, no borra legacy). Vuelta atrás = `.dump` de A.4.

**Recovery si `migrate deploy` falla a mitad (P3009):** las migraciones se aplican una por una; no van en una transacción global. Si falla la N:
1. `select * from _prisma_migrations where finished_at is null;` y lee el error.
2. Corrige la causa. Las tablas inglesas a medias **no** afectan las legacy (datos reales intactos).
3. `npx prisma@6.19.2 migrate resolve --rolled-back <nombre_migracion>` (o `--applied` si realmente quedó aplicada), luego reintenta `migrate deploy`.
4. Rollback total siempre disponible: restaurar el `.dump` de A.4.

Limpia el contenedor al terminar: `docker rm -f holidog-shadow`.

---

## FASE C-seeds — Sembrar catálogos de referencia

Sin esto, Room/ServiceType/ServiceVariant/VaccineCatalog quedan vacíos y la API/vistas no tienen catálogo:
```bash
export DIRECT_URL='postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require'
DATABASE_URL="$DIRECT_URL" npm --workspace=@holidoginn/db run db:seed:rooms
DATABASE_URL="$DIRECT_URL" npm --workspace=@holidoginn/db run db:seed:services
DATABASE_URL="$DIRECT_URL" npm --workspace=@holidoginn/db run db:seed:vaccine-catalog
```
> Los precios de **hospedaje** de la tabla legacy `tarifas` (HOTEL/ProBARF) los porta `import-legacy.ts` a `LodgingPricing` (FASE E). Las de **estética** se siembran con `db:seed:services` (matriz deslanado/corte). Así nada de `tarifas` se pierde al DROPearla en H.

**✅ Done C-seeds:** `select count(*) from rooms`, `service_variants`, `vaccine_catalog` > 0.

---

## FASE E — Importar y verificar datos históricos

**E.0 Pre-reconciliación** (diagnóstico de huérfanos, SQL Editor). Si algo da > 0, decide qué hacer **antes** de importar:
```sql
select count(*), coalesce(sum(monto),0) from pagos where reservacion_id is null;             -- ingresos sueltos
select count(*) from reservaciones r left join perros p on p.id=r.perro_id where p.id is null; -- reservas huérfanas (esperado 0: FK cascade)
select count(*) from perros pe left join clientes c on c.id=pe.cliente_id where c.id is null;   -- perros huérfanos (esperado 0)
```

**E.1 Verificación en seco** (solo lectura; confirma que conecta y lee legacy):
```bash
DATABASE_URL='postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require' \
npm --workspace=@holidoginn/db run db:import:verify
```
**E.2 Importar** (session pooler 5432, muchos upserts secuenciales):
```bash
DATABASE_URL='postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require' \
npm --workspace=@holidoginn/db run db:import:legacy
```
El script imprime el **host objetivo** (verifícalo), importa en orden FK-safe, y al final corre `verify()`.

**E.3 Verificar** — `verify()` ahora compara:
- **Conteos por id**: clientes→users, perros→pets, reservaciones→reservations, pagos(c/reserva)→payments, egresos→expenses. **Deben ser iguales** (detecta pérdida silenciosa).
- **Totales $** apples-to-apples: ingresos (solo pagos con reserva) y egresos al centavo.
- **Huérfanos**: reporta pagos sin reservación que se omiten (decide su destino antes de H).
```bash
DATABASE_URL='postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require' \
npm --workspace=@holidoginn/db run db:import:verify
```

**✅ Done E:** `verify()` muestra todos los conteos ✅ y totales ✅; los huérfanos (si hay) tienen un plan explícito. El import es idempotente (re-ejecutable sin duplicar).

---

## FASE D — Vistas / RLS / triggers / Storage

`dashboard_views.sql` ya **DROPea explícitamente** las 6 vistas legacy antes de recrearlas sobre tablas inglesas (necesario: `create or replace view` falla al cambiar columnas).
```bash
export DIRECT_URL='postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require'
DATABASE_URL="$DIRECT_URL" npm --workspace=@holidoginn/db run db:sql:views
```
**Fallback** si `prisma db execute` falla con los bloques `DO $$` (dollar-quoting): aplica vía psql o el SQL Editor:
```bash
psql "$DIRECT_URL" -f packages/db/sql/dashboard_views.sql
```
**Verificaciones:**
```sql
select count(*) from vw_ingresos_mensuales;                          -- > 0 (datos importados en E)
select count(*) from storage.objects where bucket_id='fotos-perros'; -- > 0 (fotos reales preservadas)
```
Y haz spot-check de que una `pets."photoUrl"` importada resuelve por su URL pública.

**✅ Done D:** vistas leen de tablas inglesas con datos; trigger `set_updated_at_camel` existe; RLS habilitado; bucket intacto.

---

## FASE F — Repuntar la API de Railway a Supabase

**F.0 Pre-check + respaldo de la DB de Railway** (usa **`DATABASE_PUBLIC_URL`** del plugin Postgres — la externa; la `DATABASE_URL` del plugin es interna y no resuelve desde tu máquina):
```bash
export RAILWAY_DB='<DATABASE_PUBLIC_URL del plugin Postgres de Railway>'
# Tablas Prisma con @@map en minúsculas:
psql "$RAILWAY_DB" -c "select 'users' t,count(*) from users union all select 'pets',count(*) from pets union all select 'reservations',count(*) from reservations union all select 'payments',count(*) from payments;"
pg_dump --version   # gate: >= versión del server Railway (puede diferir de Supabase)
pg_dump "$RAILWAY_DB" -Fc -b -v -f ~/railway_mobile_$(date +%Y%m%d).dump
```
Confirma que los conteos de negocio son **0** (pre-lanzamiento).

**F.1** En Railway → servicio **API** → **Variables**: **borra** la referencia `DATABASE_URL=${{Postgres.DATABASE_URL}}` (la referencia del plugin puede ganar si solo añades) y define valores **literales**:
```
DATABASE_URL=postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:6543/postgres?pgbouncer=true&connection_limit=8&sslmode=require
DIRECT_URL=postgresql://postgres.<REF>:<PW>@<HOST_POOLER>:5432/postgres?sslmode=require
```
Guardar → redeploy. El `startCommand` corre `migrate deploy` (usando `DIRECT_URL`, será no-op porque C ya aplicó todo) y arranca Fastify con `DATABASE_URL` pooled.

**F.2 Verifica** (logs Railway: `No pending migrations`, API en `0.0.0.0:PORT`) y smoke test de **lectura y escritura** (la escritura detecta bloqueos por RLS):
```bash
curl -fsS https://<dominio-railway>/health || echo FALLO
# + una ruta autenticada que haga SELECT y un POST que escriba en DB.
```

> ⚠️ **PUNTO DE NO RETORNO #2:** la API deja de usar Railway. Reversible **solo** mientras no haya escrituras de clientes reales en Supabase. **Reversión:** re-crear `DATABASE_URL=${{Postgres.DATABASE_URL}}`, confirmar que el plugin Postgres sigue con su esquema (no borrarlo hasta H.2), redeploy.

**Gotcha F:** si el `migrate deploy` del arranque intenta usar el 6543, el `directUrl` de B no llegó al deploy → revisa el commit en la rama que Railway despliega.

---

## FASE G — Tipos del admin y repunte al esquema inglés

El admin **no cambia su conexión** (sigue en el mismo proyecto Supabase); cambian las tablas que consulta (inglesas camelCase).

**G.1 Regenerar tipos** (desde `HolidogInn-web_app`):
```bash
SUPABASE_ACCESS_TOKEN='<sbp_...>' npm run db:types   # db:types usa --project-id → SIEMPRE requiere token/login
```
**G.2 Inventariar y reescribir** las consultas del admin a tablas inglesas (las columnas camelCase van **entre comillas**: `"paidAt"`, `"reservationType"`, `"checkIn"`):
```bash
grep -rnE "from\('(clientes|perros|pagos|reservaciones|egresos|config|patrocinios|tarifas)'\)" /Users/user/Desktop/HolidogInn/HolidogInn-web_app/{app,lib,components}
```
> La opción "vistas-shim" **solo** sirve para el dashboard (las `vw_*` son agregaciones de solo lectura). El CRUD del admin (`.from('clientes').insert/update/delete`) **debe** reescribirse a `users/pets/reservations/payments/expenses` antes de H.1, o crear vistas-puente *updatable* con `INSTEAD OF` triggers (trabajo extra no trivial).

**G.3** `npm run build` (admin) y desplegar a Vercel. Clerk y las keys de Supabase **ya están** en Vercel; no se tocan.

**✅ Done G:** `lib/supabase/types.ts` refleja el esquema inglés; el admin compila y opera (lectura+escritura) contra tablas inglesas con datos reales.

---

## FASE H — Cutover y limpieza (IRREVERSIBLE)

No ejecutes hasta tener **todos** estos checks en verde:
- [ ] C: `_prisma_migrations` = nº de carpetas; tablas inglesas presentes.
- [ ] C-seeds: rooms/service_variants/vaccine_catalog poblados.
- [ ] E: `db:import:verify` con **conteos ✅ y totales ✅**; huérfanos con plan.
- [ ] D: vistas sobre tablas inglesas con datos; bucket `fotos-perros` intacto.
- [ ] F: API en Railway→Supabase respondiendo (lectura+escritura); DB Railway vacía + `.dump` válido.
- [ ] G: admin operando contra el esquema inglés en producción.
- [ ] `.dump` válidos: Supabase pre-unify (A.4) + Railway (F.0).

**H.1 Eliminar legacy en español** (SQL Editor):
```sql
drop view  if exists vw_ingresos_mensuales, vw_egresos_mensuales, vw_egresos_por_categoria,
                     vw_ingresos_por_servicio, vw_ingresos_por_perro, vw_ocupacion_hoy cascade; -- si quedaran legacy
drop table if exists pagos, egresos, reservaciones, patrocinios, perros, clientes, tarifas, config cascade;
```
> ⚠️ **PUNTO DE NO RETORNO #3:** borrar legacy es **irreversible** (solo recuperable desde el `.dump` de A.4).

**H.2 Decomisionar la DB de Railway**: Railway → plugin Postgres → Settings → Delete. Conserva el `.dump` de F.0 unos días.

**H.3 Limpieza opcional**: dropear policies de Storage legacy duplicadas (`fotos_perros_*`) si consolidas en las nuevas (`storage_*`); retirar vistas-shim que ya no uses.

**✅ Done H:** en Supabase solo quedan tablas inglesas (+ vistas/triggers/RLS/bucket); Railway eliminado; API y admin contra la **única** DB unificada.

---

## PUNTOS DE NO RETORNO
1. **C — `migrate deploy`**: aditivo, reversible vía `.dump` A.4.
2. **F — borrar referencia del plugin Railway**: reversible solo hasta que haya escrituras reales en Supabase.
3. **H — `DROP TABLE` legacy + borrar plugin Railway**: **irreversible** (solo `.dump`).
