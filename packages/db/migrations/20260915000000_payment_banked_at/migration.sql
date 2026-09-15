-- ============================================================================
-- payments."bankedAt" — el día en que el dinero CAE AL BANCO
-- ============================================================================
-- PROBLEMA: un cobro de Stripe se registraba con la fecha en que el cliente
-- pagó (`paidAt`), pero ese dinero no está en la cuenta ese día: Stripe lo
-- libera después y lo deposita por SPEI uno o dos días hábiles más tarde. El
-- estado de cuenta del banco y los ingresos del panel nunca cuadraban, y un
-- anticipo cobrado el 31 aparecía en un mes en el que el banco no vio un peso.
--
-- `paidAt` NO se toca: es la fecha del cobro, la que ve el cliente en su recibo
-- y la que ordena el ledger de una reserva. Lo que se agrega es la OTRA fecha,
-- la contable: cuándo entró el dinero a la cuenta.
--
-- Precedencia (la implementa `calcular_banked_at`):
--   1. `stripe_payouts."arrivalDate"` del depósito ya conciliado — la fecha
--      EXACTA del SPEI, la misma que el dueño ve en Santander.
--   2. `payments."stripeAvailableOn"` — el estimado que Stripe publica al
--      cobrar (balance_transaction.available_on), mientras el depósito no
--      existe todavía.
--   3. `paidAt` — efectivo, transferencia y terminal: el dinero ya está.
--
-- Se mantiene sola con triggers y NO se escribe desde la aplicación: hay tres
-- repos y una decena de caminos que insertan pagos (API Fastify, panel web vía
-- Supabase, RPC de venta de mostrador…), y el que se olvidara de llenarla
-- dejaría un ingreso fuera del mes. Mismo criterio que `set_updated_at_camel`.
--
-- ANCLA DE DÍA A MEDIODÍA UTC: `bankedAt` es un DÍA, no un instante. Las fechas
-- de Stripe vienen ancladas a las 00:00Z y leerlas en hora del hotel (UTC-7)
-- las corría al día anterior. Guardarlas a las 12:00Z (= 5 am en Hermosillo)
-- hace que el día sea el mismo se lea en UTC o en hora del hotel, que es la
-- convención que ya usan el panel (`timestampDeFecha`) y la API.
-- ============================================================================

ALTER TABLE "payments" ADD COLUMN "bankedAt" TIMESTAMP(3);

-- Los agregados de ingresos filtran por estado y rango de fecha bancaria
-- (vistas del dashboard, /admin/revenue, Movimientos del panel).
CREATE INDEX "payments_status_bankedAt_idx" ON "payments"("status", "bankedAt");


-- --- La regla, en un solo lugar --------------------------------------------
-- Recibe los datos del pago en vez de leerlos: los triggers BEFORE la llaman
-- con los valores que están por escribirse (NEW), que todavía no están en la
-- tabla.
create or replace function calcular_banked_at(
  p_payment_id text,
  p_paid_at    timestamp,
  p_available  timestamp
) returns timestamp
language plpgsql
stable
as $$
declare
  v_arrival timestamp;
  v_dia     date;
begin
  -- MIN: normalmente hay 0 o 1 línea por pago. Si hubiera más (un ajuste
  -- posterior sobre el mismo cobro), el dinero cayó en el PRIMER depósito.
  -- Un payout fallido o cancelado no llegó al banco: Stripe devuelve el saldo
  -- y lo manda en otro depósito, así que esas líneas no cuentan.
  select min(po."arrivalDate")
    into v_arrival
    from stripe_payout_lines l
    join stripe_payouts po on po.id = l."payoutId"
   where l."paymentId" = p_payment_id
     and po.status not in ('failed', 'canceled');

  if v_arrival is not null then
    -- Fecha de Stripe: es un DÍA anclado en UTC, se lee en UTC.
    v_dia := v_arrival::date;
  elsif p_available is not null then
    v_dia := p_available::date;
  elsif p_paid_at = date_trunc('day', p_paid_at) then
    -- ANCLA DE DÍA: el panel guardó durante meses "YYYY-MM-DD" a secas, que en
    -- la base son las 00:00:00.000Z EXACTAS — un día SIN hora. Leerlo en hora
    -- del hotel lo correría al día anterior. Un cobro real jamás cae en la
    -- medianoche exacta al milisegundo, así que ese valor se reconoce como día
    -- y se lee en UTC. Misma regla que `fechaDeCobro` en el panel
    -- (lib/reservacion.ts): sin ella, esos cobros viejos se moverían un día al
    -- rellenar el histórico.
    v_dia := p_paid_at::date;
  elsif p_paid_at is not null then
    -- `paidAt` con hora real: su día es el del HOTEL (un cobro en efectivo de
    -- las 6 pm es del día siguiente en UTC).
    v_dia := (p_paid_at at time zone 'UTC' at time zone 'America/Hermosillo')::date;
  else
    return null;
  end if;

  return v_dia + time '12:00';
end;
$$;


-- --- Trigger en `payments` --------------------------------------------------
-- Se recalcula en cada escritura: así lo llena cualquier camino (Prisma,
-- Supabase, la RPC de mostrador) sin tener que acordarse de la columna, y
-- corregir a mano la fecha de un cobro en efectivo mueve también su ingreso.
create or replace function set_payment_banked_at()
returns trigger as $$
begin
  -- `coalesce(paidAt, createdAt)`: un pago sin fecha de cobro (los hay en el
  -- histórico del Excel) cuenta en el día en que se capturó, igual que hacen
  -- las vistas de ingresos. Así la columna nunca queda nula y ningún ingreso se
  -- cae de los rangos que la filtran.
  new."bankedAt" := calcular_banked_at(
    new.id,
    coalesce(new."paidAt", new."createdAt"),
    new."stripeAvailableOn"
  );
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_payments_banked_at on payments;
create trigger trg_payments_banked_at
  before insert or update on payments
  for each row execute function set_payment_banked_at();


-- --- Triggers en la conciliación de depósitos -------------------------------
-- Cuando el depósito real aparece (o Stripe le mueve la fecha de llegada), los
-- pagos que viajaron en él tienen que repasar su fecha bancaria: es el momento
-- en que el estimado se vuelve dato duro. Sin esto, el ingreso se quedaría en
-- el día que Stripe había prometido y no en el que el banco lo recibió.
create or replace function refrescar_banked_at_de_linea()
returns trigger as $$
begin
  if tg_op <> 'INSERT' and old."paymentId" is not null then
    update payments
       set "bankedAt" = calcular_banked_at(id, coalesce("paidAt", "createdAt"), "stripeAvailableOn")
     where id = old."paymentId";
  end if;
  if tg_op <> 'DELETE' and new."paymentId" is not null then
    update payments
       set "bankedAt" = calcular_banked_at(id, coalesce("paidAt", "createdAt"), "stripeAvailableOn")
     where id = new."paymentId";
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_payout_lines_banked_at on stripe_payout_lines;
create trigger trg_payout_lines_banked_at
  after insert or update or delete on stripe_payout_lines
  for each row execute function refrescar_banked_at_de_linea();

create or replace function refrescar_banked_at_de_payout()
returns trigger as $$
begin
  update payments p
     set "bankedAt" = calcular_banked_at(p.id, coalesce(p."paidAt", p."createdAt"), p."stripeAvailableOn")
   where p.id in (
     select l."paymentId" from stripe_payout_lines l
      where l."payoutId" = new.id and l."paymentId" is not null
   );
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_payouts_banked_at on stripe_payouts;
create trigger trg_payouts_banked_at
  after update of "arrivalDate", status on stripe_payouts
  for each row execute function refrescar_banked_at_de_payout();


-- --- Relleno del histórico --------------------------------------------------
-- Todos los pagos que ya existen: los de Stripe conciliados toman la fecha del
-- depósito, los demás su estimado o su fecha de cobro. El UPDATE dispara el
-- trigger de arriba, pero se escribe el cálculo explícito para que la
-- migración diga lo que hace aunque el trigger cambie después.
UPDATE "payments"
   SET "bankedAt" = calcular_banked_at(id, coalesce("paidAt", "createdAt"), "stripeAvailableOn");
