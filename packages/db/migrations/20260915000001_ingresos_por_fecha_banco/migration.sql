-- ============================================================================
-- Los ingresos se reportan por la fecha en que el dinero CAE AL BANCO
-- ============================================================================
-- Hasta hoy las vistas agrupaban por `paidAt`, la fecha en que el cliente pagó.
-- En efectivo da igual, pero un cobro de Stripe no está en la cuenta ese día:
-- se deposita por SPEI uno o dos días hábiles después. El mes del panel nunca
-- cuadraba contra el estado de cuenta, y un anticipo del 31 se reportaba en un
-- mes en el que el banco no vio ese dinero.
--
-- El cambio es sólo de FECHA DE CORTE: se agrupa por `payments."bankedAt"`
-- (migración 20260915000000), que es la fecha del depósito real de Stripe —o
-- su estimado mientras el depósito no existe, o `paidAt` en efectivo,
-- transferencia y terminal, donde el dinero ya está—. Los montos, el neto de
-- comisiones, el waterfall de estética y los reembolsos no se tocan.
--
-- `paidAt` se queda como fallback por si algún pago no alcanzó a llenar la
-- columna (no debería: la llena un trigger), y como ancla del ORDEN del
-- waterfall dentro de una reserva, que es la cronología en que el cliente pagó
-- y no la de los depósitos.
--
-- `bankedAt` viene anclado a mediodía UTC, así que la conversión a hora del
-- hotel que ya hacían las vistas lo deja en el mismo día; se conserva para que
-- el fallback a `paidAt` (un instante real) siga cortando bien el mes.
--
-- REGLA (ver 20260904000001): un cambio a una vista = migración NUEVA con el
-- bloque completo. Aquí basta `create or replace` porque ninguna vista cambia
-- de columnas; el `drop ... cascade` de la migración original era para cuando
-- sí cambiaban.
-- ============================================================================

-- --- Resumen mensual de ingresos -------------------------------------------
-- Incluye TODO lo cobrado: hospedaje, estética, guardería y las ventas de
-- tienda (mostrador y en línea). No hace join a `reservations`, así que los
-- pagos de pedido —que tienen "reservationId" NULL— entran solos.
-- El mes se agrupa por `bankedAt` (el día del depósito) y en HORA DEL HOTEL
-- (America/Hermosillo), que es lo que necesita el fallback a `paidAt`: ése sí
-- es un timestamp UTC y un cobro de las 18:00 del día 31 caía en el mes
-- siguiente.
-- Los REEMBOLSOS (status REFUNDED, monto positivo) se RESTAN en el mes en que
-- se emitieron, igual que hace el admin móvil (admin.ts /admin/revenue): antes
-- la web los ignoraba y una reserva cancelada con reembolso seguía contando
-- como ingreso, así que la app y el panel daban cifras distintas del mismo mes.
create or replace view vw_ingresos_mensuales as
with base as (
  select
    extract(year  from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
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
    extract(year  from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
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
    extract(year  from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
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
    -- Ordena por `paidAt` A PROPÓSITO, no por `bankedAt`: el orden en que se
    -- cubre el hospedaje y luego el baño es el orden en que el CLIENTE pagó
    -- (anticipo y luego saldo), no el de los depósitos de Stripe, que pueden
    -- llegar juntos el mismo día y volver ambiguo cuál iba primero.
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
    extract(year  from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
    extract(month from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
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
  extract(year  from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as anio,
  extract(month from (coalesce(p."bankedAt", p."paidAt", p."createdAt") at time zone 'UTC' at time zone 'America/Hermosillo'))::int as mes_num,
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
