import { Ionicons } from "@expo/vector-icons";

// Novedades que ve el EQUIPO (admin/staff) al entrar a la app después de una
// actualización. El cliente (OWNER) nunca ve este modal.
//
// Cómo publicar una entrega nueva: agrega un release AL INICIO del arreglo con
// un id mayor (YYYY-MM-DD; si hay dos el mismo día, sufijo "-b"). Cada usuario
// ve solo el release más reciente, una vez: el último id visto se guarda por
// usuario en SecureStore (src/lib/whatsNewSeen.ts).

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
