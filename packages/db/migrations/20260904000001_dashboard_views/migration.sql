-- ============================================================================
-- Vistas del dashboard, funciones RPC y trigger updated_at — AHORA EN PRISMA
-- ============================================================================
-- Hasta hoy estos objetos vivían SOLO en packages/db/sql/dashboard_views.sql y
-- había que correrlo a mano después de cada deploy: Railway solo ejecuta
-- `prisma migrate deploy`, así que cuando una entrega tocaba una vista y nadie
-- corría el archivo, los números del panel dejaban de cuadrar en silencio.
--
-- Desde esta migración las vistas, las funciones RPC y el trigger viajan como
-- migración Prisma y se aplican solos al desplegar. REGLA: cualquier cambio a
-- una vista o función = NUEVA migración (copiar el bloque completo, con su
-- `drop view if exists` + `create or replace`), nunca editar esta.
--
-- Idempotente a propósito: corre igual en prod (donde las vistas y funciones
-- YA existen, creadas a mano) que en una base vacía (shadow DB / local):
--   - vistas: drop view if exists + create or replace
--   - funciones: create or replace
--   - trigger: drop trigger if exists + create, solo en tablas que existan
--   - grants: solo si el rol `service_role` existe (Supabase)
--
-- Se quedan FUERA, y siguen siendo manuales (ver sql/dashboard_views.sql):
-- RLS (`to authenticated`) y Storage (buckets/policies), porque esos roles y
-- el esquema `storage` no existen fuera de Supabase.
--
-- Contenido: secciones 1 (trigger), 2 (vistas) y 3 (funciones) de
-- sql/dashboard_views.sql tal como estaban el 2026-09-02.
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
-- a los efectivamente cobrados: status PAID o PARTIAL — el anticipo de una
-- reserva hecha desde la app nace PARTIAL y nunca transiciona a PAID; al
-- liquidar se crea otro Payment RESTANTE/PAID); los egresos de `expenses`.
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
-- Incluye TODO lo cobrado: hospedaje, estética, guardería y las ventas de
-- tienda (mostrador y en línea). No hace join a `reservations`, así que los
-- pagos de pedido —que tienen "reservationId" NULL— entran solos.
-- El mes se agrupa en HORA DEL HOTEL (America/Hermosillo): `paidAt` es un
-- timestamp UTC y un cobro de las 18:00 del día 31 caía en el mes siguiente.
-- Los REEMBOLSOS (status REFUNDED, monto positivo) se RESTAN en el mes en que
-- se emitieron, igual que hace el admin móvil (admin.ts /admin/revenue): antes
-- la web los ignoraba y una reserva cancelada con reembolso seguía contando
-- como ingreso, así que la app y el panel daban cifras distintas del mismo mes.
create or replace view vw_ingresos_mensuales as
with base as (
  select
    extract(year  from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
    -- Neto real: se resta la comisión que absorbe el negocio — Stripe
    -- (stripeFeeAmount, pagos de la app) y terminal Getnet (cardFeeAmount, cobros
    -- con tarjeta). En efectivo/transferencia ambas son NULL → 0.
    case when p.status = 'REFUNDED'
         then -(p.amount)
         else (p.amount - coalesce(p."stripeFeeAmount", 0) - coalesce(p."cardFeeAmount", 0))
    end as amount,
    p.status
  from payments p
  where p.status in ('PAID', 'PARTIAL', 'REFUNDED')
)
select
  anio,
  mes_num,
  to_char(make_date(anio, mes_num, 1), 'TMMonth') as mes_nombre,
  sum(amount)::numeric(12, 2) as total_ingresos,
  count(*) filter (where status <> 'REFUNDED') as cantidad_pagos
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
  -- Una CORTESÍA conserva el precio de catálogo en unitPrice pero NUNCA entró
  -- a totalAmount: si se restara del hospedaje, un baño regalado reclasificaría
  -- ingresos de HOTEL como ESTETICA.
  where st.code = 'BATH' and a."paidWith" = 'BOOKING'
    and coalesce(a."isCourtesy", false) = false
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
    and coalesce(a."isCourtesy", false) = false
  group by a."reservationId"
),
reembolsos as (
  -- Reembolsos (REFUNDED, monto positivo) restados en el mes de emisión, en la
  -- banda del servicio de la reserva (o TIENDA si cuelgan de un pedido). Sin
  -- esto la web sumaba lo cobrado de una reserva cancelada y devuelta.
  select
    extract(year  from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
    case r."reservationType"
      when 'STAY'    then 'HOTEL'
      when 'BATH'    then 'ESTETICA'
      when 'DAYCARE' then 'GUARDERIA'
      else 'TIENDA'
    end as servicio,
    -(p.amount) as total
  from payments p
  left join reservations r on r.id = p."reservationId"
  where p.status = 'REFUNDED'
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
    extract(year  from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
    r."reservationType" as tipo,
    -- Neto real: se resta la comisión que absorbe el negocio (Stripe + terminal;
    -- NULL → 0 en efectivo/transferencia).
    (p.amount - coalesce(p."stripeFeeAmount", 0) - coalesce(p."cardFeeAmount", 0)) as monto,
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
    -- punto del "waterfall" en el que entra este pago. También en neto para que
    -- las bandas del waterfall cuadren con `monto`.
    coalesce(sum(p.amount - coalesce(p."stripeFeeAmount", 0) - coalesce(p."cardFeeAmount", 0)) over (
      partition by p."reservationId"
      order by coalesce(p."paidAt", p."createdAt"), p."createdAt", p.id
      rows between unbounded preceding and 1 preceding
    ), 0) as running_before
  from payments p
  join reservations r on r.id = p."reservationId"
  left join bano_por_reserva    b  on b.rid  = r.id
  left join deworm_por_reserva  d  on d.rid  = r.id
  left join extra_por_reserva   ex on ex.rid = r.id
  where p.status in ('PAID', 'PARTIAL')
),
pagos_tienda as (
  -- Ingresos que NO cuelgan de una reservación. Hoy son exclusivamente ventas de
  -- tienda: pedido en línea confirmado por el webhook de Stripe, o venta de
  -- mostrador capturada desde Movimientos (ver crear_venta_mostrador abajo).
  --
  -- Hace falta un CTE aparte porque `pagos` hace INNER JOIN a reservations y los
  -- descartaría: la suma de las bandas no cuadraría contra vw_ingresos_mensuales,
  -- que sí los cuenta. Tampoco se pueden meter en `pagos` con un LEFT JOIN: su
  -- window function particiona por "reservationId", y con NULLs todas las ventas
  -- caerían en una sola partición y el waterfall de baño/desparasitante correría
  -- entre bolsas de croquetas.
  --
  -- El predicado es "sin reservación" y no "con orderId" a propósito: así el
  -- invariante SUM(vw_ingresos_por_servicio.total) = total_ingresos se sostiene
  -- estructuralmente aunque mañana aparezca otro ingreso sin reserva.
  --
  -- No hay waterfall aquí (no hay add-ons que repartir): el monto neto entero es
  -- la banda.
  select
    extract(year  from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
    (p.amount - coalesce(p."stripeFeeAmount", 0) - coalesce(p."cardFeeAmount", 0)) as monto
  from payments p
  where p.status in ('PAID', 'PARTIAL')
    and p."reservationId" is null
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
  union all
  -- Ventas de tienda (mostrador y en línea) → banda TIENDA.
  select anio, mes_num, 'TIENDA' as servicio, monto as total
  from pagos_tienda
  union all
  -- Reembolsos → restan en su banda.
  select anio, mes_num, servicio, total
  from reembolsos
)
select
  anio,
  mes_num,
  servicio,
  sum(total)::numeric(12, 2) as total,
  count(*) filter (where total > 0) as cantidad_pagos
from desglosado
where total <> 0
group by 1, 2, 3;

-- --- Ingresos del mes por perro (Top 10 facturado) -------------------------
-- OJO: el INNER JOIN a reservations descarta A PROPÓSITO los pagos de tienda
-- (un pedido de croquetas no es de ningún perro en particular). Por eso la suma
-- de este Top NO cuadra con vw_ingresos_mensuales, y está bien.
create or replace view vw_ingresos_por_perro as
select
  extract(year  from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
  extract(month from (coalesce(p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
  pe.id                         as perro_id,
  pe.name                       as perro_nombre,
  -- Neto real (Stripe + terminal), consistente con las demás vistas de ingresos;
  -- los reembolsos restan.
  sum(case when p.status = 'REFUNDED'
           then -(p.amount)
           else p.amount - coalesce(p."stripeFeeAmount", 0) - coalesce(p."cardFeeAmount", 0)
      end)::numeric(12, 2) as total
from payments p
join reservations r on r.id = p."reservationId"
join pets pe        on pe.id = r."petId"
where p.status in ('PAID', 'PARTIAL', 'REFUNDED')
group by 1, 2, pe.id, pe.name;

-- --- Ocupación actual del hotel --------------------------------------------
-- Incluye STAY y DAYCARE para el día de hoy (la guardería ocupa cupo ese día).
create or replace view vw_ocupacion_hoy as
select
  r.id,
  pe.name                  as perro,
  (u."firstName" || ' ' || u."lastName") as cliente,
  -- DAYCARE no tiene checkIn/checkOut: su día vive en appointmentAt.
  coalesce(r."checkIn", r."appointmentAt")::date  as fecha_inicio,
  coalesce(r."checkOut", r."appointmentAt")::date as fecha_fin,
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
  and current_date between coalesce(r."checkIn", r."appointmentAt")::date
                       and coalesce(r."checkOut", r."appointmentAt", current_date)::date;


-- ============================================================================
-- 3) FUNCIONES RPC  (las llama el admin web con supabase.rpc())
-- ============================================================================
-- Prisma no gestiona funciones; viven aquí por la misma razón que las vistas.
-- Precedente en el admin web: aplicar_migracion_legacy(payload jsonb).

-- --- Venta de mostrador -----------------------------------------------------
-- PROBLEMA: registrar una venta presencial toca CUATRO tablas —orders,
-- order_items, inventory y payments— y @supabase/supabase-js no tiene
-- transacciones multi-sentencia. Hacerlo por pasos deja, en la mitad de los
-- fallos, una orden sin ingreso o stock descontado sin venta. El cuerpo de una
-- función plpgsql corre en UNA transacción: si algo revienta, no queda nada.
--
-- Contrato del payload:
--   { fecha: "YYYY-MM-DD", metodo_pago: "CASH"|"CARD"|..., email?, notas?,
--     card_brand?, card_fee_pct?, card_fee_amount?, total_esperado,
--     lineas: [ {tipo:"VARIANTE", variante_id, cantidad}
--             | {tipo:"LIBRE",    concepto, monto, cantidad} ] }
--
-- El PRECIO de una línea de catálogo NO viaja en el payload: se lee de
-- product_variants, así que el cliente nunca fija precios. `total_esperado` es
-- el total con el que la Server Action calculó la comisión de tarjeta; si no
-- coincide con el que sale de la base (alguien cambió un precio entremedias),
-- la función aborta en vez de guardar una comisión inconsistente.
--
-- El recargo de tarjeta sí viaja ya calculado: la tasa vigente la resuelve
-- snapshotComisionPago() en el servidor de Next (lib/comision-tarjeta-server.ts)
-- y no vale la pena duplicar esa lógica en SQL.
--
-- El stock NUNCA bloquea la venta: la venta ya ocurrió, y negarse a registrarla
-- porque el conteo está desfasado es peor que registrarla. Se descuenta con el
-- mismo SQL atómico que handleStoreOrderPaid (piso en 0) y se devuelven las
-- variantes que quedaron en 0 para que la UI avise.

create or replace function crear_venta_mostrador(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order_id     text          := gen_random_uuid()::text;
  v_payment_id   text          := gen_random_uuid()::text;
  v_order_number int;
  v_paid_at      timestamp     := (payload->>'fecha')::timestamp;
  v_email        text          := nullif(btrim(payload->>'email'), '');
  v_notas        text          := nullif(btrim(payload->>'notas'), '');
  v_metodo       text          := payload->>'metodo_pago';
  v_esperado     numeric(10,2) := nullif(payload->>'total_esperado', '')::numeric;
  v_total        numeric(10,2) := 0;
  v_agotadas     jsonb         := '[]'::jsonb;
  l              jsonb;
  v_qty          int;
  v_unit         numeric(10,2);
  v_name         text;
  v_var_title    text;
  v_var_id       text;
  v_left         int;
begin
  if jsonb_typeof(payload->'lineas') <> 'array'
     or jsonb_array_length(payload->'lineas') = 0 then
    raise exception 'La venta necesita al menos una línea';
  end if;

  insert into orders (id, email, status, "fulfillmentType", channel,
                      subtotal, "discountTotal", "shippingTotal", total,
                      notes, "paidAt", "createdAt", "updatedAt")
  values (v_order_id, v_email, 'PAID', 'PICKUP', 'COUNTER',
          0, 0, 0, 0, v_notas, v_paid_at, now(), now())
  returning "orderNumber" into v_order_number;

  for l in select * from jsonb_array_elements(payload->'lineas')
  loop
    v_qty := greatest(coalesce((l->>'cantidad')::int, 1), 1);

    if (l->>'tipo') = 'VARIANTE' then
      v_var_id := l->>'variante_id';
      select v.title, v.price, p.name
        into v_var_title, v_unit, v_name
        from product_variants v
        join products p on p.id = v."productId"
       where v.id = v_var_id;
      if not found then
        raise exception 'La variante % ya no existe', v_var_id;
      end if;

      -- Decremento atómico con piso en 0, igual que handleStoreOrderPaid.
      update inventory
         set quantity = greatest(quantity - v_qty, 0), "updatedAt" = now()
       where "variantId" = v_var_id and "trackInventory" = true
      returning quantity into v_left;

      -- `found` es false si la variante no lleva control de inventario (en ese
      -- caso v_left ni siquiera se asigna).
      if found and v_left = 0 then
        v_agotadas := v_agotadas || jsonb_build_array(v_name);
      end if;
    else
      v_var_id    := null;
      v_var_title := null;
      v_name      := coalesce(nullif(btrim(l->>'concepto'), ''), 'Venta de mostrador');
      v_unit      := round(coalesce((l->>'monto')::numeric, 0), 2);
      if v_unit <= 0 then
        raise exception 'La línea "%" necesita un monto mayor a 0', v_name;
      end if;
    end if;

    insert into order_items (id, "productNameSnapshot", "variantTitleSnapshot",
                             "unitPrice", quantity, "lineTotal", "orderId", "variantId")
    values (gen_random_uuid()::text, v_name, v_var_title,
            v_unit, v_qty, v_unit * v_qty, v_order_id, v_var_id);

    v_total := v_total + v_unit * v_qty;
  end loop;

  if v_total <= 0 then
    raise exception 'El total de la venta debe ser mayor a 0';
  end if;

  -- La comisión de tarjeta se calculó contra `total_esperado`; si el total real
  -- difiere, la comisión guardada estaría mal. Mejor abortar que mentir.
  if v_esperado is not null and abs(v_total - v_esperado) > 0.01 then
    raise exception 'El total cambió (esperado %, calculado %). Vuelve a intentar.',
      v_esperado, v_total;
  end if;

  update orders set subtotal = v_total, total = v_total, "updatedAt" = now()
   where id = v_order_id;

  insert into payments (id, amount, kind, method, status,
                        "reservationId", "orderId", "userId", "paidAt", notes,
                        "cardBrand", "cardFeePct", "cardFeeAmount", "createdAt")
  values (v_payment_id, v_total, 'FULL', v_metodo::"PaymentMethod", 'PAID',
          null, v_order_id, null, v_paid_at,
          coalesce(v_notas, 'Venta de mostrador #' || v_order_number),
          nullif(payload->>'card_brand', ''),
          nullif(payload->>'card_fee_pct', '')::numeric,
          nullif(payload->>'card_fee_amount', '')::numeric,
          now());

  return jsonb_build_object(
    'order_id',     v_order_id,
    'order_number', v_order_number,
    'payment_id',   v_payment_id,
    'total',        v_total,
    'agotadas',     v_agotadas
  );
end;
$$;

-- --- Deshacer una venta de mostrador ----------------------------------------
-- Contraparte honesta del alta: borrar solo el pago dejaría un pedido pagado sin
-- ingreso y el stock descontado. Restaura inventario, borra pago y pedido (los
-- items caen por CASCADE). Solo funciona sobre channel = 'COUNTER': un pedido de
-- la tienda web se cancela o se reembolsa, no se borra.
create or replace function eliminar_venta_mostrador(p_order_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_channel text;
  it        record;
begin
  select channel::text into v_channel from orders where id = p_order_id;
  if v_channel is null then
    raise exception 'El pedido no existe';
  end if;
  if v_channel <> 'COUNTER' then
    raise exception 'Solo se pueden borrar ventas de mostrador';
  end if;

  for it in
    select "variantId", quantity from order_items
     where "orderId" = p_order_id and "variantId" is not null
  loop
    update inventory
       set quantity = quantity + it.quantity, "updatedAt" = now()
     where "variantId" = it."variantId" and "trackInventory" = true;
  end loop;

  delete from payments where "orderId" = p_order_id;
  delete from orders   where id = p_order_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- El rol `service_role` solo existe en Supabase: en una base local vacía (o en
-- la shadow DB de `prisma migrate diff`) el GRANT reventaría la migración.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function crear_venta_mostrador(jsonb)   to service_role;
    grant execute on function eliminar_venta_mostrador(text) to service_role;
  end if;
end $$;
