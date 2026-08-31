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
    id: "2026-08-31",
    title: "Los depósitos de Stripe dejaron de atorarse",
    items: [
      {
        icon: "business-outline",
        title: "Los depósitos ahora entran solos",
        body:
          "Depósitos se había quedado callada desde el 18 de agosto: dependía por " +
          "completo de que Stripe nos avisara en el momento exacto, y si ese aviso " +
          "no llegaba, ese depósito no entraba nunca y nada lo advertía. Ahora se " +
          "revisa solo todos los días a las 8:30 a.m., y además tienes «Actualizar " +
          "desde Stripe» arriba de la lista (o jala hacia abajo) para traerlos al " +
          "momento. Si alguno no cuadra con su desglose, te avisa.",
        route: "/admin/payouts",
        roles: ["ADMIN"],
      },
      {
        icon: "add-circle-outline",
        title: "Los cobros que Stripe cobró pero nadie registró, con un botón",
        body:
          "Dentro de cada depósito, el bloque «Cobros sin registrar» ya no es solo " +
          "un aviso: cada uno trae «Registrar como pago de la reserva». Ese dinero " +
          "entró al banco pero la reserva seguía apareciendo como si debiera. Se " +
          "registra con el monto correcto —el bruto que pagó el cliente— y la " +
          "comisión de Stripe guardada aparte, que es como los ingresos la saben " +
          "restar. Tocarlo dos veces no duplica nada.",
        route: "/admin/payouts",
        roles: ["ADMIN"],
      },
      {
        icon: "cash-outline",
        title: "En los pagos ya ves cuánto te quedó a ti",
        body:
          "En el detalle de una reservación, un pago hecho por la app mostraba en " +
          "grande lo que pagó el cliente, y lo que de verdad te quedó después de la " +
          "comisión iba en letra chica. Ahora es al revés: el número grande es el " +
          "neto que recibió Holidog Inn, y debajo dice cuánto pagó el cliente y " +
          "cuánto se llevó Stripe. Los pagos en efectivo o transferencia no cambian: " +
          "ahí no hay comisión que descontar.",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-27",
    title: "Ya puedes cotizar antes de reservar",
    items: [
      {
        icon: "document-text-outline",
        title: "Cotizaciones con link para WhatsApp",
        body:
          "Cuando alguien preguntaba «¿cuánto sale dejar a mi perro cinco días " +
          "con baño?», había que sacar el número a mano y escribirlo en un " +
          "mensaje: no quedaba registro de qué se cotizó ni a qué precio, y si " +
          "el cliente decía que sí tres días después, había que capturar todo " +
          "otra vez. Ahora el «+» de Reservaciones ofrece «Cotización»: eliges " +
          "el servicio, las mascotas y las fechas, y el total lo calcula el " +
          "sistema con las tarifas de verdad. " +
          "Se puede cotizar a un cliente registrado O a un prospecto que apenas " +
          "pregunta (solo nombre, WhatsApp y los datos del perro — no se crea " +
          "cuenta ni expediente). Al guardar sale un link con la cotización " +
          "hecha página, con la marca del hotel, y el botón de WhatsApp la manda " +
          "al cliente con el mensaje ya escrito. Él la abre desde el celular y " +
          "la puede guardar como PDF. " +
          "Si acepta, «Convertir en reservación» abre el formulario de siempre " +
          "ya lleno: solo eliges cuarto u hora y listo, cobrando el precio que " +
          "se prometió aunque las tarifas hayan subido. Cotizar NO aparta cuarto " +
          "ni horario, y el historial te dice cuántas veces abrió el cliente su " +
          "cotización — buena señal para saber a quién vale la pena marcarle.",
        route: "/admin/quotes/create",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-26-d",
    title: "Deshacer un check-out equivocado",
    items: [
      {
        icon: "refresh-circle-outline",
        title: "Reabrir una reserva finalizada",
        body:
          "Pasaba y no tenía salida: le hacías check-out a la reserva que no " +
          "era (o querías cancelarla) y quedaba «Finalizada» sin ningún botón " +
          "para corregirlo. Ahora, en el detalle de una reserva finalizada, " +
          "abajo aparece «Reabrir reserva»: eliges si regresa a Confirmada " +
          "(el perro no había entrado) o a Hospedado/En guardería (sigue " +
          "aquí). No se avisa al cliente ni se mueve ningún pago — solo " +
          "regresa el estado, y desde ahí cancelas o continúas normal. Solo " +
          "para admins.",
        route: "/(admin)/reservations",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-26-c",
    title: "El detalle de una estancia ya explica el total",
    items: [
      {
        icon: "receipt-outline",
        title: "Desglose del cobro en la reserva",
        body:
          "El cliente sí veía su desglose al reservar (hospedaje por noches, " +
          "medicamento, el 20% por reservar el mismo día…), pero a ustedes " +
          "solo les llegaba el total y no había forma de saber de dónde " +
          "salió. Ahora el detalle de la reserva muestra «Desglose del " +
          "cobro»: hospedaje con su tarifa por noche, medicamento (+10%), " +
          "servicios (baño, desparasitante, horas extra), descuento, recargo " +
          "por reserva del mismo día (+20%) y domicilio. Si el total se " +
          "editó a mano después, la diferencia sale como «Otros ajustes». " +
          "Aplica a las estancias reservadas de hoy en adelante.",
        route: "/(admin)/reservations",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-26-b",
    title: "Arreglo en la revisión de cartillas",
    items: [
      {
        icon: "chatbox-ellipses-outline",
        title: "El teclado ya no tapa las observaciones",
        body:
          "Al revisar una cartilla y tocar el cuadro de «Observaciones para " +
          "el cliente» (o el motivo de rechazo), el teclado se abría encima " +
          "del cuadro y no se veía lo que ibas escribiendo. Ahora la pantalla " +
          "se recorre sola y el texto queda siempre a la vista.",
        route: "/admin/cartillas",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-26",
    title: "Las ventas de la tienda ya están en los ingresos",
    items: [
      {
        icon: "bag-handle-outline",
        title: "Lo que vende la tienda ya cuenta como ingreso",
        body:
          "Vender un producto no tenía dónde registrarse: el dinero entraba " +
          "a la caja y no aparecía por ningún lado. Ahora las ventas de " +
          "mostrador se capturan desde el panel web, en Movimientos, y " +
          "entran a los ingresos como cualquier otro cobro — las vas a ver " +
          "aquí, en el desglose, bajo una categoría nueva: Tienda. " +
          "Lo mismo va a pasar cuando alguien compre por la página: ese " +
          "pedido tampoco habría contado, y ya quedó resuelto. " +
          "Ninguna cifra de meses pasados cambia.",
        route: "/admin/revenue",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-25-c",
    title: "Las horas extra ya se cobran desde la app",
    items: [
      {
        icon: "hourglass-outline",
        title: "Agregar horas extra a una estancia o baño",
        body:
          "El caso de siempre: el perro ya iba de salida y el dueño avisa que " +
          "pasa por él horas después. El baño y el desparasitante ya se " +
          "podían agregar desde «Agregar servicio»; ahora ahí mismo está " +
          "«Horas extra»: pones cuántas horas fueron y la app calcula el " +
          "monto con la tarifa de Config → Tarifas y lo suma al saldo. " +
          "Funciona para admin y staff (regalarlo o cambiar el precio sigue " +
          "siendo del admin). En guardería no aparece a propósito: ahí las " +
          "horas de más se cobran solas al hacer el check-out.",
        route: "/(staff)/dashboard",
        roles: ["ADMIN", "STAFF"],
      },
    ],
  },
  {
    id: "2026-08-25-b",
    title: "Lo que de verdad entra de cada pago por Stripe",
    items: [
      {
        icon: "card-outline",
        title: "Comisión, neto y cuándo cae al banco",
        body:
          "Cuando un cliente paga con tarjeta desde su app, Stripe se queda " +
          "una comisión antes de depositar, pero el detalle de la reserva " +
          "mostraba el monto completo como si todo entrara. Ahora, en los " +
          "Pagos de cualquier reserva —hospedaje, baño o guardería—, cada " +
          "pago por Stripe muestra su comisión, el neto que entra al negocio " +
          "y cuándo cae ese dinero al banco: la fecha exacta del depósito si " +
          "ya salió, o el día estimado si viene en camino. Ojo: lo que el " +
          "cliente debe se sigue calculando con lo que él pagó; la comisión " +
          "es costo del negocio, no deuda de él.",
        route: "/(admin)/reservations",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-25",
    title: "Las evidencias se ven de corrido",
    items: [
      {
        icon: "images-outline",
        title: "Desliza entre las fotos y videos de toda la estancia",
        body:
          "Antes el visor se quedaba encerrado en el día que abriste: para " +
          "ver las evidencias de otro día había que cerrar, buscar el reporte " +
          "y volver a abrir. Y si el día mezclaba fotos con videos, el video " +
          "ni siquiera entraba al carrusel. Ahora abres cualquiera y deslizas " +
          "por todas las de la estancia, fotos y videos revueltos, de un día " +
          "al siguiente; arriba se ve de qué día es cada una y en cuál vas " +
          "(«4 de 12»). Los videos arrancan solos al llegar a ellos y se " +
          "pausan al pasar al siguiente.",
        roles: ["ADMIN", "STAFF"],
      },
    ],
  },
  {
    id: "2026-08-21",
    title: "Cambiar el horario de una guardería",
    items: [
      {
        icon: "time-outline",
        title: "«Me lo recogen hasta las 7» ya se puede",
        body:
          "El detalle de guardería no mostraba ni el día ni el horario, así " +
          "que cuando el cliente cambiaba la hora no había dónde corregirlo. " +
          "Ahora el día y las horas salen arriba: tócalos y muévelos, incluso " +
          "con el perro ya adentro. Sirve también para pasarlo a otro día (te " +
          "avisa si ese día ya está lleno) y para horarios fuera de 9 a 6.",
        route: "/(staff)/daycares",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "cash-outline",
        title: "El total se ajusta solo con las horas",
        body:
          "Como la guardería se cobra por hora, al cambiar el horario el " +
          "total sube o baja por la diferencia, y se ve al momento cuánto " +
          "falta cobrar (o cuánto se pagó de más). Si el precio fue pactado a " +
          "mano, apaga «Actualizar el total» y se queda como está. Y al " +
          "recoger ya no salen horas extra que en realidad no fueron.",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "notifications-outline",
        title: "El dueño se entera solito",
        body:
          "Al guardar, al dueño le llega el aviso con el día y el horario " +
          "nuevos (y el total, si cambió), y su recordatorio de un día antes " +
          "se reprograma con la información correcta.",
        roles: ["ADMIN", "STAFF"],
      },
    ],
  },
  {
    id: "2026-08-19",
    title: "El equipo ya puede registrar lo que llega",
    items: [
      {
        icon: "calendar-outline",
        title: "Registrar un perro que llegó ayer",
        body:
          "El calendario no dejaba elegir una fecha pasada, así que cuando un " +
          "perro llegaba sin avisar y nadie alcanzaba a capturarlo, la salida " +
          "era inventarle fechas y pedir que alguien las corrigiera después. " +
          "Ahora, en hospedaje y guardería, se puede poner la fecha real: sale " +
          "el aviso de que ya pasó y se activa «Registrar de todos modos». " +
          "Igual que ya funcionaba con las citas de baño.",
        route: "/admin/reservation/create",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "add-circle-outline",
        title: "Registrar reservas, clientes y mascotas desde Más",
        body:
          "Hasta ahora esto era solo del admin: si llegaba alguien preguntando " +
          "y no había un admin cerca, el perro se quedaba adentro sin existir " +
          "en el sistema. En «Más» hay una sección nueva, Registrar, con Nueva " +
          "reserva, Nuevo cliente y Nueva mascota. Es el mismo formulario del " +
          "admin; lo único que no aparece es asignar responsable, porque el " +
          "check-in ya no depende de eso.",
        route: "/(staff)/more",
        roles: ["STAFF"],
      },
      {
        icon: "water-outline",
        title: "Agregarle un baño a un perro que ya está aquí",
        body:
          "El caso de todos los días: el perro entra a guardería y en el " +
          "mostrador piden el baño. Antes había que buscar a un admin. Ahora, " +
          "en el detalle de la guardería o de la estancia, toca «Agregar " +
          "servicio» y elige el baño o el desparasitante; el precio sale del " +
          "catálogo y se suma al saldo. Regalarlo (cortesía) o cambiarle el " +
          "precio sigue siendo del admin.",
        route: "/(staff)/daycares",
        roles: ["STAFF"],
      },
      {
        icon: "camera-outline",
        title: "La foto del perro, también en guardería y baño",
        body:
          "En la estancia ya se podía subir; en guardería salía un icono " +
          "genérico y en baño no se podía cambiar. Ahora en las tres pantallas " +
          "el tap sobre la foto abre la cámara. Además, en el Panel los perros " +
          "sin foto traen una marca de cámara: sin foto, la única forma de " +
          "saber quién es quién es agacharse a leerle la placa.",
        route: "/(staff)/dashboard",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "chatbubble-ellipses-outline",
        title: "Manda tu comentario desde la app",
        body:
          "Lo que antes era «cuando lo uses, anótalo y me lo pasas». En «Más» " +
          "(o en Ajustes, si eres admin) hay «Enviar un comentario»: escribe " +
          "qué te falta, qué te estorba o qué te confundió y le llega al " +
          "equipo a sus Avisos. Entre más concreto, más rápido se arregla.",
        roles: ["ADMIN", "STAFF"],
      },
    ],
  },
  {
    id: "2026-08-17-b",
    title: "La etiqueta de Google Ads ya está puesta",
    items: [
      {
        icon: "megaphone-outline",
        title: "Ya se puede medir la campaña de Google",
        body:
          "La etiqueta que dio Google Ads (cuenta AW-18392201884) ya quedó " +
          "instalada en holidoginn.com.mx, en todas las páginas. Desde ahora " +
          "Google puede ver qué hace la gente que llega por la pauta: cuántos " +
          "entran, a qué páginas pasan y cuáles terminan reservando. En Google " +
          "Ads puede tardar unas horas en marcarse como «etiqueta activa», y " +
          "no hay que pegar el código otra vez ni instalar nada más. También " +
          "se cubrió un detalle que el código de Google no trae: como la " +
          "página no se recarga al pasar de una sección a otra, Google solo " +
          "habría contado la primera pantalla de cada visita; ya cuenta todas. " +
          "Si además de las visitas quieres medir una acción concreta como " +
          "conversión (una reserva terminada o un clic al WhatsApp), avísanos " +
          "cuál y se conecta.",
        roles: ["ADMIN"],
      },
      {
        icon: "image-outline",
        title: "Las fotos de Hospedaje ya se ven cuadradas",
        body:
          "En la página de reservar, las fotos salían con un marco borroso a " +
          "los lados. Ahora llenan el cuadro completo, bien centradas, y las " +
          "que se suban después tampoco necesitan medida especial.",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-17",
    title: "Un perro puede estar en dos cuentas",
    items: [
      {
        icon: "people-outline",
        title: "Co-dueños: la pareja ya no tiene que registrar al perro otra vez",
        body:
          "Pasaba seguido: uno de los dos registra al perro y el otro baja la " +
          "app y no ve nada, solo la pantalla de «registra a tu peludito». La " +
          "salida era registrarlo de nuevo, y quedaban dos perros, dos " +
          "cartillas por revisar y el historial partido. Ahora, desde la ficha " +
          "del perro (botón «Dueños»), se agrega a la otra persona como " +
          "co-dueña: ve la ficha, la cartilla, los reportes y todo el " +
          "historial, puede reservar y pagar, y le llegan los mismos avisos. " +
          "Se elige de la lista de clientes, así que la persona ya debe tener " +
          "su cuenta. Ojo con el dinero: el saldo a favor sigue siendo de cada " +
          "quien y cada reserva queda a nombre de quien la hizo y la pagó.",
        route: "/(admin)/clients",
        roles: ["ADMIN"],
      },
      {
        icon: "paw-outline",
        title: "Si ves un perro repetido, avísale a quien lo pueda vincular",
        body:
          "Cuando un cliente diga que no ve a su perro en la app, lo más " +
          "probable es que esté registrado con su pareja. En vez de " +
          "capturarlo otra vez, un admin lo comparte desde la ficha del perro " +
          "y le aparece solo.",
        roles: ["STAFF"],
      },
      {
        icon: "logo-whatsapp",
        title: "Van a llegar mensajes de «mi perro ya está con mi pareja»",
        body:
          "La app ahora se los sugiere: cuando alguien instala la app y no " +
          "encuentra a su perro, ve un aviso que dice «¿Tu perro ya lo " +
          "registró alguien de tu familia? Escríbenos y lo vinculamos», con " +
          "el WhatsApp del negocio. Sale en dos lugares: al buscar su cuenta " +
          "al instalar la app y en Mis Mascotas cuando está vacía. Cuando " +
          "llegue uno de esos mensajes, la respuesta es vincularlo desde la " +
          "ficha del perro (botón «Dueños»), NO capturar al perro otra vez.",
        roles: ["ADMIN", "STAFF"],
      },
    ],
  },
  {
    id: "2026-08-14-b",
    title: "Check-in del equipo y reportes de guardería",
    items: [
      {
        icon: "log-in-outline",
        title: "El check-in ya no depende de quién sea el responsable",
        body:
          "Si la estancia tenía a otro compañero como responsable, el botón " +
          "de check-in no aparecía por ningún lado y quien recibía al perro " +
          "no podía registrarlo. Ahora cualquiera del equipo puede hacer el " +
          "check-in (y cobrar el saldo) desde el detalle de la estancia; " +
          "abajo del botón se ve quién es el responsable, para no perder de " +
          "vista a quién le toca la estancia.",
        route: "/(staff)/dashboard",
        roles: ["STAFF"],
      },
      {
        icon: "grid-outline",
        title: "El tablero muestra todo el hotel, no solo lo tuyo",
        body:
          "Antes el Panel y las listas de hoy solo mostraban las estancias " +
          "asignadas a ti: si nadie te asignaba nada, veías «No hay " +
          "estancias activas» con el hotel lleno, y las llegadas del día no " +
          "te aparecían. Ahora ves los perros hospedados, las llegadas y las " +
          "salidas de todos.",
        route: "/(staff)/dashboard",
        roles: ["STAFF"],
      },
      {
        icon: "sunny-outline",
        title: "Reportes y fotos para los perros de guardería",
        body:
          "La guardería no tenía dónde registrar el día: solo se podía hacer " +
          "check-in, check-out y cobrar. Ahora, mientras el perro está aquí, " +
          "el detalle de la guardería tiene «Llenar reporte» —el mismo del " +
          "hospedaje: ánimo, comió, paseó, sanitario, notas y fotos— y un " +
          "botón para subir una foto suelta. El dueño recibe el aviso y las " +
          "ve en su reservación, igual que en hospedaje.",
        route: "/(staff)/daycares",
        roles: ["STAFF"],
      },
      {
        icon: "create-outline",
        title: "Llenar el reporte del día desde el detalle de la reserva",
        body:
          "Desde admin solo se podían VER los reportes; para llenar uno " +
          "había que entrar por el flujo del staff. Ahora, en cualquier " +
          "reserva con el perro adentro —hospedaje o guardería— aparece " +
          "«Llenar el reporte de hoy» junto al historial.",
        route: "/(admin)/reservations",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    id: "2026-08-14",
    title: "Domicilio y cierre de baños",
    items: [
      {
        icon: "car-outline",
        title: "Agrega el domicilio a una reserva ya hecha",
        body:
          "Antes el servicio a domicilio solo se podía elegir al momento de " +
          "reservar: si el cliente lo pedía después, no había dónde anotarlo. " +
          "Ahora, en el detalle de la reserva toca «Servicio a domicilio» para " +
          "agregarlo, cambiar la dirección o quitarlo. La tarifa se calcula " +
          "sola por distancia y se suma al saldo (los pagos no se ajustan " +
          "solos: se cobra al recoger). También puedes marcarlo como cortesía " +
          "si va por cuenta de la casa.",
        route: "/(admin)/reservations",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "phone-portrait-outline",
        title: "El cliente también puede pedirlo desde su app",
        body:
          "Si el dueño lo agrega o lo quita desde su teléfono antes del " +
          "check-in, a ustedes les llega el aviso con el nuevo total, para que " +
          "nadie se entere del viaje hasta el día de la entrega.",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "water-outline",
        title: "Se distingue el baño hecho que falta cobrar",
        body:
          "Un baño ya terminado pero sin liquidar ya no se ve igual que uno " +
          "pendiente: sale con la etiqueta ámbar «Baño listo · por cobrar» en " +
          "las listas y en el detalle. La reserva sigue abierta hasta que se " +
          "cobre —igual que siempre— pero ahora se ve de lejos a quién hay que " +
          "cobrarle cuando pasen por su perro.",
        route: "/(staff)/baths",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "camera-outline",
        title: "Completar un baño sin foto, si no hubo tiempo",
        body:
          "La foto sigue siendo lo ideal (al cliente le encanta recibirla), " +
          "pero ya no bloquea: en el menú de completar hay «Completar sin " +
          "foto», que pide confirmación. Así nadie tiene que subir una foto " +
          "cualquiera con tal de cerrar la cita. Queda registrado quién " +
          "completó el baño y a qué hora, y el aviso al dueño sale igual.",
        roles: ["ADMIN", "STAFF"],
      },
    ],
  },
  {
    id: "2026-08-13",
    title: "Reagendar citas de baño",
    items: [
      {
        icon: "calendar-outline",
        title: "Mueve una cita de baño sin cancelarla",
        body:
          "Si el cliente pide cambiar su hora (ej. «¿me lo recorres 30 " +
          "minutos?»), ya no hay que cancelar y volver a capturar: toca la " +
          "fecha en el detalle del baño, elige la hora nueva y listo. La app " +
          "te avisa si se encima con otra cita o si no alcanza antes del " +
          "cierre, y aun así puedes forzarla con «Agendar de todos modos».",
        route: "/(admin)/reservations",
        roles: ["ADMIN", "STAFF"],
      },
      {
        icon: "notifications-outline",
        title: "El cliente se entera solito",
        body:
          "Al mover la cita, al dueño le llega el aviso con la hora nueva al " +
          "instante, y sus recordatorios (el de un día antes y el de 90 " +
          "minutos) se reprograman solos con el horario correcto. Antes, si " +
          "ya se le había recordado, nadie le avisaba del cambio.",
        roles: ["ADMIN", "STAFF"],
      },
    ],
  },
  {
    id: "2026-08-12-b",
    title: "Depósitos de Stripe",
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
    title: "Correcciones de reserva y sincronización",
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
    title: "Cartillas, avisos y guardería",
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
