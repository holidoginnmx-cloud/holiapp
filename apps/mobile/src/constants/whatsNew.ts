import { Ionicons } from "@expo/vector-icons";

// Novedades que ve el EQUIPO (admin/staff) al entrar a la app después de una
// actualización. El cliente (OWNER) nunca ve este modal.
//
// Cómo publicar una entrega nueva: agrega un release AL INICIO del arreglo con
// un id mayor (YYYY-MM-DD; si hay dos el mismo día, sufijo "-b"). El id se
// compara como string, así que el formato importa.
//
// El modal muestra el HISTORIAL completo: las entregas que el usuario todavía
// no ha visto salen desplegadas, y las anteriores plegadas con su fecha. El
// último id visto se guarda por usuario en SecureStore
// (src/lib/whatsNewSeen.ts) y al cerrar se marca con el MÁS reciente.
//
// Nada se borra de este arreglo: es el historial que ve el equipo.

export type TeamRole = "ADMIN" | "STAFF";

export type WhatsNewItem = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** Pantalla a la que lleva el botón "Probarlo". */
  route?: string;
  roles: TeamRole[];
};

export type WhatsNewRelease = {
  /** YYYY-MM-DD — se compara como string para saber cuál es más nuevo. */
  id: string;
  title: string;
  items: WhatsNewItem[];
};

export const WHATS_NEW: WhatsNewRelease[] = [
  {
    id: "2026-08-12-b",
    title: "Novedades para el equipo",
    items: [
      {
        icon: "business-outline",
        title: "De qué reservas viene cada depósito del banco",
        body:
          "Cuando Stripe te transfiere, junta los cobros de varios clientes en " +
          "un solo depósito y el banco no dice de quién es. Ahora entras a " +
          "Ajustes → Depósitos al banco, tecleas el monto que te llegó (por " +
          "ejemplo 663.80) y ves el desglose: qué cliente, qué mascota, qué " +
          "servicio, cuánto cobró Stripe de comisión y cuánto quedó neto. La " +
          "suma cuadra exacto con lo que entró a la cuenta.",
        route: "/admin/payouts",
        roles: ["ADMIN"],
      },
      {
        icon: "notifications-outline",
        title: "Aviso en cuanto sale un depósito",
        body:
          "Ya no hay que estar revisando el banco: en cuanto Stripe emite la " +
          "transferencia te llega un aviso con el monto y de qué mascotas era. " +
          "Si el banco la rechaza, también te avisa.",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-12",
    title: "Novedades para el equipo",
    items: [
      {
        icon: "sync-outline",
        title: "Lo que cambia uno, lo ven todos",
        body:
          "Si un compañero crea o edita una reservación desde su teléfono, ya " +
          "no hay que cerrar la app para verlo: la lista se actualiza sola al " +
          "volver a la pantalla, al reabrir la app y en cuanto llega el aviso " +
          "de la reserva nueva.",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "pricetag-outline",
        title: "Corregir el precio de una reserva",
        body:
          "Toca el Total en el detalle de la reservación y escribe el monto " +
          "correcto, con un motivo (ej. «descuento olvidado»). Funciona incluso " +
          "si la reserva ya está finalizada. Si el total baja, al dueño le " +
          "llega el aviso; si ya había pagado de más, la app te dice cuánto " +
          "quedó a favor.",
        route: "/(admin)/reservations",
        roles: ["ADMIN"],
      },
      {
        icon: "gift-outline",
        title: "Baño de cortesía",
        body:
          "En el detalle de la reserva, «Agregar» servicio y activa Cortesía: " +
          "el baño entra a la agenda y se hace normal, pero no se cobra ni suma " +
          "al total. Aparece con la etiqueta «Cortesía» y el precio tachado, " +
          "para que nadie lo cobre por inercia al entregarlo.",
        route: "/(admin)/reservations",
        roles: ["ADMIN"],
      },
      {
        icon: "lock-closed-outline",
        title: "Notas internas, separadas de las del cliente",
        body:
          "Ahora hay dos notas: la interna, que solo ve el equipo, y la del " +
          "cliente. Antes eran la misma y el dueño alcanzaba a leer lo que " +
          "escribíamos entre nosotros. La nota interna se puede agregar y " +
          "editar en cualquier momento.",
        roles: ["ADMIN"],
      },
      {
        icon: "chatbubble-ellipses-outline",
        title: "Instrucciones pegadas al servicio",
        body:
          "Cada baño puede llevar su propia nota (ej. «usar shampoo " +
          "hipoalergénico»). Te aparece en la agenda del día, junto a la cita, " +
          "para que no haya que preguntarla.",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "sparkles-outline",
        title: "Este aviso se puede volver a abrir",
        body:
          "Si lo cierras sin leerlo, no se pierde: está en Ajustes → Novedades " +
          "(y en Más → Novedades si eres staff).",
        roles: ["ADMIN", "STAFF"],
      },
    ],
  },
  {
    id: "2026-08-11",
    title: "Novedades para el equipo",
    items: [
      {
        icon: "document-text-outline",
        title: "Cartillas: aprueba con observaciones",
        body:
          "Al aprobar una cartilla ahora puedes mandarle una nota al cliente " +
          "(ej. «solo falta la desparasitación»), sin salir de la app. El chip " +
          "“Falta desparasitación” arma el mensaje con el precio según el peso; " +
          "el cliente lo recibe por notificación y lo ve en el perfil de su mascota.",
        route: "/admin/cartillas",
        roles: ["ADMIN"],
      },
      {
        icon: "notifications-outline",
        title: "Campana de avisos en Inicio",
        body:
          "Nueva campana con contador de no leídos en el Inicio para ver tus " +
          "avisos sin cambiar de pantalla; el contador también aparece en la " +
          "pestaña Ajustes.",
        route: "/admin/notifications",
        roles: ["ADMIN"],
      },
      {
        icon: "paw-outline",
        title: "Aviso de cada reserva nueva",
        body:
          "Toda reserva nueva —hospedaje, baño o guardería, venga de la app del " +
          "cliente, del sitio o capturada por un compañero— ahora le avisa a " +
          "todo el equipo. Si la llegada es HOY, el aviso llega con prioridad. " +
          "Y se acabaron los avisos dobles por baños.",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "time-outline",
        title: "La guardería abre a las 9:00",
        body:
          "La ventana de guardería cambió de 8:00–18:00 a 9:00–18:00. La app " +
          "del cliente y el sitio ya no aceptan entradas antes de las 9.",
        roles: ["ADMIN", "STAFF"],
      },
    ],
  },
];
