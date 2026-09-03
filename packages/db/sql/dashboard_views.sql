-- ============================================================================
-- Holidog Inn — RLS y Storage de Supabase (lo que sigue siendo MANUAL)
-- ============================================================================
-- ⚠️ Las VISTAS del dashboard, las FUNCIONES RPC (crear_venta_mostrador,
-- eliminar_venta_mostrador) y el trigger `set_updated_at_camel` YA NO viven
-- aquí: desde el 2026-09-02 son una migración Prisma
-- (packages/db/migrations/20260904000001_dashboard_views) y Railway las aplica
-- solo con `prisma migrate deploy`.
--
-- REGLA: cualquier cambio a una vista o función = NUEVA migración en
-- packages/db/migrations (copiar el bloque completo con su `drop view if
-- exists` + `create or replace`, que es lo que lo hace idempotente). No editar
-- la migración ya aplicada ni volver a poner vistas en este archivo.
--
-- Lo que queda aquí NO puede ir en una migración porque depende de Supabase:
-- los roles `authenticated`/`service_role` y el esquema `storage` no existen
-- en una base local ni en la shadow DB de `prisma migrate diff`. Se aplica a
-- mano (SQL Editor / `npm run db:sql:rls`) y es idempotente.
--
-- NOTA DE CASING: Prisma crea columnas camelCase sensibles a mayúsculas
-- (p.ej. "paidAt", "reservationType", "checkIn"). Por eso van entre comillas
-- dobles en cualquier `.select()` de Supabase del lado del admin.
-- ============================================================================


-- ============================================================================
-- 1) ROW LEVEL SECURITY  (permisiva para `authenticated`, por hábito)
-- ============================================================================
-- El acceso real lo gobiernan: la API Fastify (conexión directa Postgres) y el
-- admin (SERVICE_ROLE_KEY) — ambos ignoran RLS. Estas policies permiten además
-- acceso autenticado por si el cliente Supabase se usa directamente.

do $$
declare
  t text;
  tables text[] := array[
    'users', 'pets', 'reservations', 'payments', 'expenses',
    'sponsors', 'hotel_config', 'lodging_pricing', 'rooms',
    'service_types', 'service_variants', 'vaccines', 'dewormings'
  ];
begin
  foreach t in array tables loop
    if to_regclass(t) is not null then
      execute format('alter table %I enable row level security', t);
      execute format('drop policy if exists allow_all_authenticated on %I', t);
      execute format(
        'create policy allow_all_authenticated on %I
           for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;


-- ============================================================================
-- 2) STORAGE  (buckets + policies unificados en Supabase Storage)
-- ============================================================================
-- `fotos-perros`: fotos de perros y cartillas (reutilizado de la web, público).
-- `stay-updates`: evidencias de estancia (fotos/videos), público para servirse
-- por URL. Subidas vía signed upload URL generadas por la API Fastify.

insert into storage.buckets (id, name, public)
values
  ('fotos-perros', 'fotos-perros', true),
  ('stay-updates', 'stay-updates', true)
on conflict (id) do nothing;

-- Lectura pública
drop policy if exists "storage_public_read" on storage.objects;
create policy "storage_public_read"
  on storage.objects for select
  to public
  using (bucket_id in ('fotos-perros', 'stay-updates'));

-- Escritura por usuario autenticado (la API también sube vía service role)
drop policy if exists "storage_auth_insert" on storage.objects;
create policy "storage_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id in ('fotos-perros', 'stay-updates'));

drop policy if exists "storage_auth_update" on storage.objects;
create policy "storage_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id in ('fotos-perros', 'stay-updates'));

drop policy if exists "storage_auth_delete" on storage.objects;
create policy "storage_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id in ('fotos-perros', 'stay-updates'));
