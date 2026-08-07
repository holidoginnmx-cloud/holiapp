/**
 * Verificación del motor de agenda de estética. No toca la base de datos: solo
 * ejercita la aritmética de `lib/bathAvailability`.
 *
 *   npx tsx src/scripts/verify-bath-agenda.ts
 *
 * Los casos salen del reporte que originó el cambio: "agendo uno a las cuatro y
 * el otro a las cinco, pero ni de chiste va a terminar uno en una hora… si le
 * va a tomar dos horas terminar al de las cuatro, va a estar empezando con el
 * otro perro a las seis de la tarde, y a esa hora sale ella".
 */

import {
  BathScheduleCfg,
  BusyInterval,
  buildStartCandidates,
  chainStarts,
  conflictsWith,
  endOf,
  evaluateStart,
  formatDuration,
  localMinutesOfDay,
  localYMD,
  ymdAtLocalMinutes,
} from "../lib/bathAvailability";

const DIA = "2026-08-10";
// Un "ahora" fijo antes del día de prueba, para que nada caiga en el pasado.
const AHORA = ymdAtLocalMinutes("2026-08-09", 12 * 60);

const cfg: BathScheduleCfg = {
  openHour: 9,
  closeHour: 18, // Nancy sale a las 6
  slotStepMinutes: 30,
  defaultBathDurationMinutes: 60,
  lastStartHour: null,
  bufferMinutes: 0,
  maxConcurrentBaths: 1,
  isActive: true,
};

let fallos = 0;
let pasadas = 0;

function check(nombre: string, condicion: boolean, detalle = "") {
  if (condicion) {
    pasadas++;
    console.log(`  ✅ ${nombre}`);
  } else {
    fallos++;
    console.log(`  ❌ ${nombre}${detalle ? `\n       ${detalle}` : ""}`);
  }
}

function hhmm(d: Date): string {
  const m = localMinutesOfDay(d);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function cita(horaLocalMin: number, duracion: number, label: string): BusyInterval {
  const start = ymdAtLocalMinutes(DIA, horaLocalMin);
  return {
    startMs: start.getTime(),
    endMs: endOf(start, duracion).getTime(),
    id: label,
    label,
  };
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n1. El último horario depende de cuánto dura el servicio");
// ───────────────────────────────────────────────────────────────────────────
{
  const unaHora = buildStartCandidates(DIA, cfg, 60);
  const dosHoras = buildStartCandidates(DIA, cfg, 120);
  const ultimo = (xs: Date[]) => hhmm(xs[xs.length - 1]);

  check(
    `un baño de 1 h se puede agendar hasta las 17:00 (da ${ultimo(unaHora)})`,
    ultimo(unaHora) === "17:00"
  );
  check(
    `uno de 2 h se corta en las 16:00 (da ${ultimo(dosHoras)})`,
    ultimo(dosHoras) === "16:00",
    "Es justo lo que se pedía a mano: el sistema lo deduce de la duración."
  );
  check(
    "ningún horario ofrecido termina después de que sale la estilista",
    dosHoras.every((s) => localMinutesOfDay(s) + 120 <= cfg.closeHour * 60)
  );
  check(
    `el paso es de 30 min, no de la duración (${hhmm(dosHoras[0])} → ${hhmm(dosHoras[1])})`,
    hhmm(dosHoras[0]) === "09:00" && hhmm(dosHoras[1]) === "09:30"
  );
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n2. El caso exacto reportado: Leo a las 4 y Luna a las 5");
// ───────────────────────────────────────────────────────────────────────────
{
  const leo = cita(16 * 60, 120, "Leo"); // 16:00–18:00
  const luna = ymdAtLocalMinutes(DIA, 17 * 60); // se quiere agendar a las 17:00

  const veredicto = evaluateStart(luna, 60, cfg, [leo], AHORA);
  check(
    "agendar a Luna a las 17:00 sobre un Leo de dos horas se detecta como encime",
    !veredicto.ok && veredicto.reason === "CAPACITY",
    veredicto.ok ? "el motor la dejó pasar" : veredicto.message
  );
  if (!veredicto.ok) console.log(`       mensaje: "${veredicto.message}"`);

  const despues = evaluateStart(ymdAtLocalMinutes(DIA, 18 * 60), 60, cfg, [leo], AHORA);
  check(
    "y a las 18:00 tampoco cabe, porque terminaría a las 19:00",
    !despues.ok && despues.reason === "CLOSES_TOO_LATE",
    despues.ok ? "el motor la dejó pasar" : despues.message
  );

  // Con la agenda vieja, 16:00 y 17:00 eran timestamps distintos → ambas
  // pasaban. Aquí se comprueba que el traslape sí se ve.
  check(
    "17:00 cae dentro del intervalo de Leo",
    conflictsWith(luna, 60, cfg, [leo]).length === 1
  );
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n3. Multi-perro: las citas se encadenan en vez de compartir hora");
// ───────────────────────────────────────────────────────────────────────────
{
  const inicio = ymdAtLocalMinutes(DIA, 14 * 60);
  const starts = chainStarts(inicio, [120, 60], cfg.bufferMinutes);
  check(
    `Leo 14:00 (2 h) → Luna arranca a las ${hhmm(starts[1])}, no a las 14:00`,
    hhmm(starts[0]) === "14:00" && hhmm(starts[1]) === "16:00"
  );

  const conBuffer = chainStarts(inicio, [120, 60], 15);
  check(
    `con 15 min de limpieza, el segundo pasa a las ${hhmm(conBuffer[1])}`,
    hhmm(conBuffer[1]) === "16:15"
  );
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n4. Buffer de limpieza");
// ───────────────────────────────────────────────────────────────────────────
{
  const conBuffer: BathScheduleCfg = { ...cfg, bufferMinutes: 15 };
  const previa = cita(10 * 60, 60, "Rocky"); // 10:00–11:00
  const pegada = ymdAtLocalMinutes(DIA, 11 * 60);

  check(
    "sin buffer, empezar justo al terminar la anterior es válido",
    evaluateStart(pegada, 60, cfg, [previa], AHORA).ok
  );
  check(
    "con 15 min de buffer, ya no",
    !evaluateStart(pegada, 60, conBuffer, [previa], AHORA).ok
  );
  check(
    "pero a las 11:15 sí",
    evaluateStart(ymdAtLocalMinutes(DIA, 11 * 60 + 15), 60, conBuffer, [previa], AHORA).ok
  );
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n5. Citas viejas sin duración registrada");
// ───────────────────────────────────────────────────────────────────────────
{
  // Una cita legacy se trata con la duración de respaldo (60 min): ocupa, pero
  // no infla el bloqueo más de la cuenta.
  const legacy = cita(10 * 60, cfg.defaultBathDurationMinutes, "cita vieja");
  check(
    "una cita legacy de 10:00 bloquea las 10:30",
    !evaluateStart(ymdAtLocalMinutes(DIA, 10 * 60 + 30), 60, cfg, [legacy], AHORA).ok
  );
  check(
    "pero deja libre las 11:00",
    evaluateStart(ymdAtLocalMinutes(DIA, 11 * 60), 60, cfg, [legacy], AHORA).ok
  );

  // Las históricas del admin web quedaron a las 12:00Z = 05:00 local, fuera del
  // horario de atención: no deben estorbar a nadie.
  const historica = cita(5 * 60, 60, "histórica 5 am");
  check(
    "una cita histórica de las 5 am no bloquea la apertura",
    evaluateStart(ymdAtLocalMinutes(DIA, 9 * 60), 60, cfg, [historica], AHORA).ok
  );
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n6. Tope duro de última cita (lastStartHour)");
// ───────────────────────────────────────────────────────────────────────────
{
  const conTope: BathScheduleCfg = { ...cfg, lastStartHour: 16 };
  const candidatos = buildStartCandidates(DIA, conTope, 60);
  check(
    `con tope a las 16:00, el último inicio es ${hhmm(candidatos[candidatos.length - 1])}`,
    hhmm(candidatos[candidatos.length - 1]) === "16:00"
  );
  check(
    "y las 17:00 se rechazan aunque el baño cupiera",
    !evaluateStart(ymdAtLocalMinutes(DIA, 17 * 60), 60, conTope, [], AHORA).ok
  );
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n7. Zona horaria (Hermosillo, UTC-7 fijo)");
// ───────────────────────────────────────────────────────────────────────────
{
  const tarde = ymdAtLocalMinutes(DIA, 17 * 60); // 17:00 local = 00:00Z del día 11
  check(
    "una cita de las 5 pm sigue perteneciendo a su día local",
    localYMD(tarde) === DIA,
    `UTC dice ${tarde.toISOString().slice(0, 10)} — este es el corrimiento que rompía el calendario`
  );
  check("y su hora local se lee bien", hhmm(tarde) === "17:00");
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n8. Formato de duraciones");
// ───────────────────────────────────────────────────────────────────────────
{
  check("90 min → 1 h 30 min", formatDuration(90) === "1 h 30 min");
  check("120 min → 2 h", formatDuration(120) === "2 h");
  check("45 min → 45 min", formatDuration(45) === "45 min");
}

console.log(`\n${fallos === 0 ? "✅" : "❌"} ${pasadas} verificaciones pasaron, ${fallos} fallaron.\n`);
process.exit(fallos === 0 ? 0 : 1);
