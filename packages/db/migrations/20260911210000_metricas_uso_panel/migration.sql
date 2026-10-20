-- ============================================================================
-- metricas_uso — contrato de uso para el panel "pasta stats"
-- ============================================================================
-- El panel del despacho mide cuánto se usa cada app cliente para saber a
-- cambio de qué se cobra. Esta vista es su ÚNICO punto de contacto con esta
-- base: no lee ninguna tabla de la app. Si mañana cambia el esquema, se ajusta
-- aquí y el panel ni se entera.
--
-- REGLA (la de este repo para toda vista): cualquier cambio = NUEVA migración
-- copiando el bloque completo, nunca editar esta. Y como el panel guarda una
-- copia en supabase/externas/holidog-app/metricas_uso.sql, si tocas una toca
-- la otra.
--
-- Tres reglas del contrato:
--   1. CONTEOS, nunca pesos. El dinero ya tiene su fuente en el panel; un
--      monto aquí sería una segunda fuente de verdad para el mismo peso.
--   2. El uso se mide por fecha de creación —cuándo alguien USÓ la app—, no
--      por las fechas de negocio (checkIn y compañía), que se capturan hacia
--      atrás y pintarían uso en meses en que nadie abrió nada.
--   3. FLUJO y STOCK no se mezclan: solo el FLUJO sirve de denominador para
--      "$ por unidad". Dividir dinero entre "mascotas activas" no es un precio
--      por uso, es otra pregunta.
--
-- Cuidados propios de esta base:
--
--  a. Prisma guarda casi todas las fechas como `timestamp` SIN zona, en UTC.
--     `"createdAt" at time zone 'America/Hermosillo'` sobre esa columna hace
--     la conversión AL REVÉS —la toma como hora local— y corre el corte de mes
--     14 horas, sin dar ningún error. Por eso cada fuente se normaliza una
--     sola vez con `timezone('UTC', ...)`. `quotes` ya es timestamptz.
--
--  b. Lo migrado del Excel histórico NO es uso: 405 de las 511 reservaciones
--     de junio de 2026 se cargaron el 1 y el 3 de ese mes. Fuera
--     `originLegacy` en reservaciones y clientes, y fuera las mascotas creadas
--     el mismo día que su dueño importado (no tienen marca propia). Sin esto
--     junio pinta un pico cuatro veces mayor que cualquier mes real.
--
--  c. "Clientes nuevos" cuenta solo role OWNER: el personal no es uso.
--
--  d. `orders.channel` separa la tienda (ONLINE) del mostrador del panel
--     (COUNTER). Las reservaciones no traen canal: no se sabe si entraron por
--     la app o por la tienda.
--
-- La vista se deja SIN security_invoker a propósito: corre con permisos de su
-- dueño (postgres), así el rol lector no necesita permiso sobre ninguna tabla.
-- El advisor de Supabase la marcará; es esperado — no está otorgada ni a anon
-- ni a authenticated.
--
-- Idempotente y con los grants protegidos, así que corre igual en producción
-- que en la shadow DB de Prisma, donde los roles de Supabase no existen.
-- Probada como SELECT contra producción el 11 sep 2026: reservaciones reales
-- 106 · 120 · 148 · 48 de junio a septiembre.
-- ============================================================================

drop view if exists public.metricas_uso;

create or replace view public.metricas_uso as
with ahora as (
  select (now() at time zone 'America/Hermosillo')::date                    as hoy,
         date_trunc('month', now() at time zone 'America/Hermosillo')::date as mes_actual
),
eventos_uso as (
  select 'reservaciones'::text as metrica, 'Reservaciones'::text as etiqueta,
         'reservación'::text   as unidad,  true                  as principal,
         timezone('UTC', r."createdAt") as creado
  from public.reservations r
  where not r."originLegacy"
  union all
  select 'mascotas', 'Mascotas nuevas', 'mascota', false, timezone('UTC', p."createdAt")
  from public.pets p
  join public.users u on u.id = p."ownerId"
  where not (u."originLegacy" and p."createdAt"::date = u."createdAt"::date)
  union all
  select 'clientes', 'Clientes nuevos', 'cliente', false, timezone('UTC', u."createdAt")
  from public.users u
  where u.role = 'OWNER' and not u."originLegacy"
  union all
  select 'pedidos_online', 'Pedidos en la tienda', 'pedido', false, timezone('UTC', o."createdAt")
  from public.orders o
  where o.channel = 'ONLINE'
  union all
  select 'ventas_mostrador', 'Ventas de mostrador', 'venta', false, timezone('UTC', o."createdAt")
  from public.orders o
  where o.channel = 'COUNTER'
  union all
  select 'cotizaciones', 'Cotizaciones', 'cotización', false, q."createdAt"
  from public.quotes q
),
por_mes as (
  select e.metrica, e.etiqueta, e.unidad, e.principal,
         date_trunc('month', e.creado at time zone 'America/Hermosillo')::date as periodo,
         count(*)::numeric as valor,
         max(e.creado)     as ultimo_evento
  from eventos_uso e
  where e.creado is not null
  group by 1, 2, 3, 4, 5
),
catalogo as (select distinct metrica, etiqueta, unidad, principal from por_mes),
inicio   as (select metrica, min(periodo) as primer_periodo from por_mes group by 1),
rejilla as (
  select c.metrica, c.etiqueta, c.unidad, c.principal, g.periodo::date as periodo
  from catalogo c
  join inicio i using (metrica)
  cross join ahora a
  cross join lateral generate_series(
    greatest(i.primer_periodo, (a.mes_actual - interval '23 months')::date),
    a.mes_actual, interval '1 month') as g(periodo)
)
select r.periodo, r.metrica, r.etiqueta, 'FLUJO'::text as naturaleza, r.unidad,
       coalesce(m.valor, 0)::numeric as valor, r.principal,
       least(a.hoy, (r.periodo + interval '1 month - 1 day')::date) as medido_hasta,
       m.ultimo_evento
from rejilla r
cross join ahora a
left join por_mes m on m.metrica = r.metrica and m.periodo = r.periodo
union all
select a.mes_actual, 'mascotas_activas'::text, 'Mascotas activas'::text, 'STOCK'::text,
       'mascota'::text,
       (select count(*) from public.pets p where p."isActive")::numeric,
       false, a.hoy,
       (select max(timezone('UTC', p."createdAt")) from public.pets p where p."isActive")
from ahora a
union all
select a.mes_actual, 'clientes_con_cuenta'::text, 'Clientes con cuenta'::text, 'STOCK'::text,
       'cliente'::text,
       (select count(*) from public.users u where u.role = 'OWNER' and u."clerkId" is not null)::numeric,
       false, a.hoy,
       (select max(timezone('UTC', u."createdAt")) from public.users u
         where u.role = 'OWNER' and u."clerkId" is not null)
from ahora a;

comment on view public.metricas_uso is
  'Contrato de uso para el panel pasta stats. Conteos, nunca dinero. FLUJO = '
  'creado en el mes (hora de Hermosillo), sin lo migrado del Excel; STOCK = '
  'foto de hoy. Copia versionada en el panel: supabase/externas/holidog-app/.';

-- ---------------------------------------------------------------- permisos
-- El panel NO entra con service_role: esa llave lee y borra cualquier tabla
-- saltándose RLS y por /auth/v1/admin permite tomar la cuenta de cualquier
-- usuario de esta app. Entra con un rol cuyo privilegio total es leer esta
-- vista. Supabase otorga por default todo lo nuevo de `public` a anon y
-- authenticated; el revoke se lo quita. Los `if exists` son para la shadow DB
-- de Prisma, donde esos roles no existen.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'panel_metricas') then
    create role panel_metricas nologin noinherit;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.metricas_uso from anon, authenticated;
  end if;
  grant usage  on schema public       to panel_metricas;
  grant select on public.metricas_uso to panel_metricas;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant panel_metricas to authenticator;   -- para que PostgREST pueda asumirlo
  end if;
end
$$;

-- BOTÓN DE PÁNICO: corta el acceso del panel al instante y no afecta a nadie
-- más (rotar el JWT secret invalidaría también la anon y la service_role, y
-- tiraría la sesión de todos los usuarios de las tres apps):
--     revoke select on public.metricas_uso from panel_metricas;
