-- ============================================================================
-- Holidog Inn — Supabase Storage: bucket 'productos'
-- Imágenes de la tienda en línea (catálogo de productos), migradas desde Shopify.
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
--
-- Mismo patrón que el bucket 'fotos-perros': lectura pública (las imágenes se
-- sirven por URL pública) y escritura desde service role / usuarios autenticados.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do nothing;

-- Lectura pública de los objetos del bucket.
drop policy if exists "productos_public_read" on storage.objects;
create policy "productos_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'productos');

-- El admin y el script de migración suben con SERVICE_ROLE_KEY (ignora RLS).
-- Estas policies permiten además escritura desde un usuario autenticado.
drop policy if exists "productos_auth_insert" on storage.objects;
create policy "productos_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'productos');

drop policy if exists "productos_auth_update" on storage.objects;
create policy "productos_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'productos');

drop policy if exists "productos_auth_delete" on storage.objects;
create policy "productos_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'productos');
