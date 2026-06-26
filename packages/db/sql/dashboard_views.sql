-- ============================================================================
-- Holidog Inn — Vistas de dashboard, triggers updated_at, RLS y Storage
-- ============================================================================
-- Esquema unificado: las tablas/columnas las posee Prisma (camelCase, inglés).
-- Prisma NO gestiona vistas, triggers de DB, RLS ni buckets de Storage, así que
-- esos objetos viven aquí.
--
-- ORDEN DE APLICACIÓN:
--   1) `prisma migrate deploy`  (crea/actualiza tablas: payments, expenses,
--      sponsors, hotel_config, reservations, pets, users, ...)
--   2) Este archivo  (psql / supabase db execute / SQL Editor)
--
-- Es IDEMPOTENTE: se puede re-ejecutar sin efectos colaterales.
--
-- NOTA DE CASING: Prisma crea columnas camelCase sensibles a mayúsculas
-- (p.ej. "paidAt", "reservationType", "checkIn"). Por eso van entre comillas
-- dobles aquí y en cualquier `.select()` de Supabase del lado del admin.
-- ============================================================================


-- ============================================================================
-- 1) TRIGGER updated_at  (red de seguridad para escrituras vía Supabase)
-- ============================================================================
-- Prisma actualiza "updatedAt" a nivel de aplicación (@updatedAt), pero SOLO
-- cuando la escritura pasa por el cliente Prisma. El admin escribe vía
-- @supabase/supabase-js (no Prisma), así que necesitamos un trigger en DB que
-- mantenga "updatedAt" fresco para esas tablas. La función usa el identificador
-- camelCase de Prisma.

create or replace function set_updated_at_camel()
returns trigger as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$ language plpgsql;

-- Adjuntar el trigger a las tablas con columna "updatedAt" que el admin muta
-- directamente vía Supabase. Idempotente (drop + create).
do $$
declare
  t text;
  tables text[] := array[
    'users', 'pets', 'reservations', 'rooms',
    'sponsors', 'hotel_config', 'lodging_pricing', 'bath_config'
  ];
begin
  foreach t in array tables loop
    if to_regclass(t) is not null then
      execute format('drop trigger if exists trg_%I_updated_at on %I', t, t);
      execute format(
        'create trigger trg_%I_updated_at before update on %I
           for each row execute function set_updated_at_camel()', t, t);
    end if;
  end loop;
end $$;


-- ============================================================================
-- 2) VISTAS DEL DASHBOARD  (re-apuntadas a las tablas inglesas de Prisma)
-- ============================================================================
-- El admin (apps/admin) consume estas vistas por su nombre original en español
-- para mantener continuidad del UI. Los ingresos salen de `payments` (filtrando
-- a los efectivamente cobrados, status = 'PAID'); los egresos de `expenses`.
-- El servicio/estado se mapean de vuelta a las etiquetas en español que el
-- dashboard ya conoce (HOTEL/ESTETICA/GUARDERIA, RESERVADA/EN_CURSO/...).

-- IMPORTANTE: estas mismas vistas ya existen en el proyecto Supabase, creadas
-- por el esquema legacy de la web sobre las tablas EN ESPAÑOL, con columnas de
-- tipos/nombres distintos. `create or replace view` NO permite cambiar columnas
-- existentes (falla con "cannot change name of view column"), así que primero
-- las DROPeamos explícitamente. Esto hace el script verdaderamente idempotente.
drop view if exists vw_ingresos_mensuales    cascade;
drop view if exists vw_egresos_mensuales     cascade;
drop view if exists vw_egresos_por_categoria cascade;
drop view if exists vw_ingresos_por_servicio cascade;
drop view if exists vw_ingresos_por_perro    cascade;
drop view if exists vw_ocupacion_hoy         cascade;

-- --- Resumen mensual de ingresos -------------------------------------------
create or replace view vw_ingresos_mensuales as
with base as (
  select
    extract(year  from coalesce(p."paidAt", p."createdAt"))::int as anio,
    extract(month from coalesce(p."paidAt", p."createdAt"))::int as mes_num,
    p.amount
  from payments p
  where p.status = 'PAID'
)
select
  anio,
  mes_num,
  to_char(make_date(anio, mes_num, 1), 'TMMonth') as mes_nombre,
  sum(amount)::numeric(12, 2) as total_ingresos,
  count(*)                    as cantidad_pagos
from base
group by anio, mes_num
order by anio, mes_num;

-- --- Resumen mensual de egresos --------------------------------------------
create or replace view vw_egresos_mensuales as
with base as (
  select
    extract(year  from e.date)::int as anio,
    extract(month from e.date)::int as mes_num,
    e.amount
  from expenses e
)
select
  anio,
  mes_num,
  to_char(make_date(anio, mes_num, 1), 'TMMonth') as mes_nombre,
  sum(amount)::numeric(12, 2) as total_egresos,
  count(*)                    as cantidad_movimientos
from base
group by anio, mes_num
order by anio, mes_num;

-- --- Egresos por categoría (para el % sobre ingresos) ----------------------
create or replace view vw_egresos_por_categoria as
select
  extract(year  from e.date)::int as anio,
  extract(month from e.date)::int as mes_num,
  e.category                      as categoria,
  e."costType"                    as tipo_costo,
  sum(e.amount)::numeric(12, 2)   as total
from expenses e
group by 1, 2, 3, 4
order by 1, 2, 5 desc;

-- --- Ingresos del mes desglosados por servicio -----------------------------
-- El baño incluido en una estancia (HOTEL) se modela como un reservation_addon
-- BOOKING cuyo unitPrice YA está dentro de reservations.totalAmount. Para que el
-- ingreso del baño se reporte como ESTETICA (no HOTEL) aplicamos los pagos de un
-- STAY en CASCADA por orden cronológico: primero cubren el hospedaje
-- (totalAmount − baño) y el excedente cae en la banda de estética.
-- El EXTRA del deslanado/corte (extraPrice) se cobra como un Payment aparte y NO
-- está en totalAmount; extendemos la banda de estética a
-- [hotel_base, hotel_base + bano_base + extra_base] (extra_base = extras ya
-- cobrados) para que ese pago también se reporte como ESTETICA. En ESTETICA pura
-- todo el pago ya es estética por su tipo, así que el extra no necesita banda.
-- El DESPARASITANTE (addon DEWORMING, paidWith=BOOKING, ya en totalAmount) se
-- reporta como ESTETICA SOLO si la estancia tiene baño (bano_base > 0); si no,
-- se queda en HOTEL. Para ello sumamos deworm_estetica a la banda de estética y
-- lo restamos de hotel_base.
create or replace view vw_ingresos_por_servicio as
with bano_por_reserva as (
  select
    a."reservationId"                  as rid,
    sum(a."unitPrice")::numeric(12, 2) as bano_base
  from reservation_addons a
  join service_variants sv on sv.id = a."variantId"
  join service_types    st on st.id = sv."serviceTypeId"
  where st.code = 'BATH' and a."paidWith" = 'BOOKING'
  group by a."reservationId"
),
deworm_por_reserva as (
  -- Desparasitante incluido (paidWith=BOOKING): ya está dentro de totalAmount.
  select
    a."reservationId"                  as rid,
    sum(a."unitPrice")::numeric(12, 2) as deworm_base
  from reservation_addons a
  join service_variants sv on sv.id = a."variantId"
  join service_types    st on st.id = sv."serviceTypeId"
  where st.code = 'DEWORMING' and a."paidWith" = 'BOOKING'
  group by a."reservationId"
),
extra_por_reserva as (
  -- Extra del deslanado/corte ya cobrado (su Payment ya existe).
  select
    a."reservationId"                   as rid,
    sum(a."extraPrice")::numeric(12, 2) as extra_base
  from reservation_addons a
  join service_variants sv on sv.id = a."variantId"
  join service_types    st on st.id = sv."serviceTypeId"
  where st.code = 'BATH' and a."extraPaymentStatus" = 'PAID' and a."extraPrice" is not null
  group by a."reservationId"
),
pagos as (
  select
    extract(year  from coalesce(p."paidAt", p."createdAt"))::int as anio,
    extract(month from coalesce(p."paidAt", p."createdAt"))::int as mes_num,
    r."reservationType" as tipo,
    p.amount            as monto,
    -- Baño incluido, extra y base del hospedaje (solo aplica a estancias STAY).
    case when r."reservationType" = 'STAY'
         then coalesce(b.bano_base, 0) else 0 end as bano_base,
    case when r."reservationType" = 'STAY'
         then coalesce(ex.extra_base, 0) else 0 end as extra_base,
    -- Desparasitante → ESTETICA solo si la estancia tiene baño (bano_base > 0).
    case when r."reservationType" = 'STAY' and coalesce(b.bano_base, 0) > 0
         then coalesce(d.deworm_base, 0) else 0 end as deworm_estetica,
    case when r."reservationType" = 'STAY'
         then greatest(
                coalesce(r."totalAmount", 0)
                - coalesce(b.bano_base, 0)
                - (case when coalesce(b.bano_base, 0) > 0 then coalesce(d.deworm_base, 0) else 0 end),
              0)
         else coalesce(r."totalAmount", 0) end    as hotel_base,
    -- Suma de pagos previos de la MISMA reserva, en orden cronológico. Define el
    -- punto del "waterfall" en el que entra este pago.
    coalesce(sum(p.amount) over (
      partition by p."reservationId"
      order by coalesce(p."paidAt", p."createdAt"), p."createdAt", p.id
      rows between unbounded preceding and 1 preceding
    ), 0) as running_before
  from payments p
  join reservations r on r.id = p."reservationId"
  left join bano_por_reserva    b  on b.rid  = r.id
  left join deworm_por_reserva  d  on d.rid  = r.id
  left join extra_por_reserva   ex on ex.rid = r.id
  where p.status = 'PAID'
),
atribuido as (
  select
    anio, mes_num, tipo, monto, bano_base, deworm_estetica, extra_base, hotel_base,
    running_before,
    running_before + monto as running_after
  from pagos
),
desglosado as (
  -- Porción del servicio base. En estancias con baño/desparasitante/extra, HOTEL
  -- recibe el monto del pago MENOS lo que cae en la banda de estética
  -- [hotel_base, hotel_base + bano_base + deworm_estetica + extra_base] (así
  -- hotel + estética = monto y el total cuadra; el sobrepago queda en HOTEL).
  select
    anio,
    mes_num,
    case tipo
      when 'STAY'    then 'HOTEL'
      when 'BATH'    then 'ESTETICA'
      when 'DAYCARE' then 'GUARDERIA'
    end as servicio,
    case
      when tipo = 'STAY' and (bano_base + deworm_estetica + extra_base) > 0
      then monto - greatest(0, least(running_after, hotel_base + bano_base + deworm_estetica + extra_base) - greatest(running_before, hotel_base))
      else monto
    end as total
  from atribuido
  union all
  -- Baño + desparasitante + extra → ESTETICA: lo que cae en la banda de estética.
  select
    anio,
    mes_num,
    'ESTETICA' as servicio,
    greatest(0, least(running_after, hotel_base + bano_base + deworm_estetica + extra_base) - greatest(running_before, hotel_base)) as total
  from atribuido
  where tipo = 'STAY' and (bano_base + deworm_estetica + extra_base) > 0
)
select
  anio,
  mes_num,
  servicio,
  sum(total)::numeric(12, 2) as total,
  count(*)                   as cantidad_pagos
from desglosado
where total > 0
group by 1, 2, 3;

-- --- Ingresos del mes por perro (Top 10 facturado) -------------------------
create or replace view vw_ingresos_por_perro as
select
  extract(year  from coalesce(p."paidAt", p."createdAt"))::int as anio,
  extract(month from coalesce(p."paidAt", p."createdAt"))::int as mes_num,
  pe.id                         as perro_id,
  pe.name                       as perro_nombre,
  sum(p.amount)::numeric(12, 2) as total
from payments p
join reservations r on r.id = p."reservationId"
join pets pe        on pe.id = r."petId"
where p.status = 'PAID'
group by 1, 2, pe.id, pe.name;

-- --- Ocupación actual del hotel --------------------------------------------
-- Incluye STAY y DAYCARE para el día de hoy (la guardería ocupa cupo ese día).
create or replace view vw_ocupacion_hoy as
select
  r.id,
  pe.name                  as perro,
  (u."firstName" || ' ' || u."lastName") as cliente,
  r."checkIn"::date        as fecha_inicio,
  r."checkOut"::date       as fecha_fin,
  case r."reservationType"
    when 'STAY'    then 'HOTEL'
    when 'BATH'    then 'ESTETICA'
    when 'DAYCARE' then 'GUARDERIA'
  end                      as servicio,
  case r.status
    when 'CONFIRMED'   then 'RESERVADA'
    when 'CHECKED_IN'  then 'EN_CURSO'
    when 'CHECKED_OUT' then 'FINALIZADA'
    when 'CANCELLED'   then 'CANCELADA'
  end                      as estado
from reservations r
join pets pe  on pe.id = r."petId"
join users u  on u.id  = r."ownerId"
where r.status in ('CONFIRMED', 'CHECKED_IN')
  and r."reservationType" in ('STAY', 'DAYCARE')
  and current_date between r."checkIn"::date
                       and coalesce(r."checkOut"::date, current_date);


-- ============================================================================
-- 3) ROW LEVEL SECURITY  (permisiva para `authenticated`, por hábito)
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
-- 4) STORAGE  (buckets + policies unificados en Supabase Storage)
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
