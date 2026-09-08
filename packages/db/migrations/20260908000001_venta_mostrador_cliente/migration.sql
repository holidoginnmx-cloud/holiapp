-- ============================================================================
-- Venta de mostrador: a qué cliente se le vendió (OPCIONAL)
-- ============================================================================
-- Hasta ahora una venta presencial no tenía a quién atribuirse: el único rastro
-- del cliente era el correo (que casi nadie da) o su nombre tecleado en las
-- notas, que no liga con nada. `orders."userId"` y `payments."userId"` ya
-- existían y se insertaban en NULL; esta versión los llena cuando el payload
-- trae `cliente_id`.
--
-- Sigue siendo OPCIONAL a propósito: la venta de mostrador típica es alguien que
-- pasa por una bolsa de croquetas, y exigir identificarlo volvería lento el caso
-- común. Sin `cliente_id` el comportamiento es idéntico al anterior.
--
-- El correo NO se copia del cliente: 302 de 360 fichas traen un correo
-- placeholder (@holidoginn.local) y guardarlo en el pedido sería ensuciarlo con
-- una dirección que no existe. El vínculo real es `userId`.
--
-- Ver packages/db/migrations/20260904000001_dashboard_views para la versión
-- anterior de esta función (esa NO se edita: aquí va la copia completa con el
-- cambio, que es lo que hace idempotente el `create or replace`).

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
  v_cliente      text          := nullif(btrim(payload->>'cliente_id'), '');
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

  -- La FK ya lo impediría, pero su mensaje no le dice nada a quien está en el
  -- mostrador. El caso real: la ficha se borró mientras el formulario estaba
  -- abierto.
  if v_cliente is not null and not exists (select 1 from users where id = v_cliente) then
    raise exception 'El cliente seleccionado ya no existe';
  end if;

  insert into orders (id, email, status, "fulfillmentType", channel,
                      subtotal, "discountTotal", "shippingTotal", total,
                      notes, "userId", "paidAt", "createdAt", "updatedAt")
  values (v_order_id, v_email, 'PAID', 'PICKUP', 'COUNTER',
          0, 0, 0, 0, v_notas, v_cliente, v_paid_at, now(), now())
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

  -- El pago también cuelga del cliente: así la venta suma en su historial de
  -- pagos, no sólo en el pedido.
  insert into payments (id, amount, kind, method, status,
                        "reservationId", "orderId", "userId", "paidAt", notes,
                        "cardBrand", "cardFeePct", "cardFeeAmount", "createdAt")
  values (v_payment_id, v_total, 'FULL', v_metodo::"PaymentMethod", 'PAID',
          null, v_order_id, v_cliente, v_paid_at,
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

-- `create or replace` conserva los privilegios, pero el GRANT va igual por si la
-- función se recrea en una base donde nunca se otorgaron. El rol `service_role`
-- sólo existe en Supabase: sin el guard, la migración revienta en local y en la
-- shadow DB de `prisma migrate diff`.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function crear_venta_mostrador(jsonb) to service_role;
  end if;
end $$;
