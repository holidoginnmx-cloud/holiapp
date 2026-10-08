import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { MONTH_NAMES, WEEKDAYS } from "./CalendarView";
import { formatTimeHHmm } from "@/lib/format";
import { clearRiskyOpen, markRiskyOpen } from "@/lib/crashBreadcrumb";

/**
 * Campo de fecha u hora: un cuadro con la etiqueta y el valor YA FORMATEADO
 * dentro, que abre el selector por encima en lugar de empujarlo debajo.
 *
 * En iOS el selector es PROPIO (JS), no el `UIDatePicker` nativo. Dos razones:
 *
 *  1. El nativo inline ocupa su espacio bajo el campo y pinta la fecha en
 *     inglés ("Aug 6, 2026"), así que el valor real quedaba fuera del cuadro y
 *     en otro idioma. Por eso existe este componente.
 *  2. El 2026-10-01 el nativo, montado dentro de la hoja, le CERRÓ la app tres
 *     veces a alguien del equipo (dos en la hora, una en la fecha) en un
 *     teléfono concreto, sin que el código hubiera cambiado en un mes. Un
 *     cierre nativo no se puede atrapar ni arreglar por OTA; un selector en JS
 *     sí, y no depende de qué versión de iOS traiga cada quien.
 *
 * Las FECHAS se eligen en un calendario del mes, no en ruedas: ver "el 5 de
 * septiembre" entre sus días vecinos es justo lo que hace falta al agendar.
 * Las HORAS van en dos columnas (hora y minutos de 5 en 5).
 *
 * En Android el componente nativo ya es un diálogo del sistema, así que se
 * monta sólo mientras está abierto.
 */

type Props = {
  label: string;
  /** Texto a mostrar dentro del cuadro (ya formateado en español). */
  text: string;
  /** true cuando no hay valor elegido: atenúa el texto. */
  empty?: boolean;
  mode: "date" | "time";
  /** Valor que muestra el selector al abrirse (el actual, o un default). */
  pickerValue: Date;
  minimumDate?: Date;
  onChange: (value: Date) => void;
  /** Si se pasa, el sheet ofrece borrar el valor (campos opcionales). */
  onClear?: () => void;
  title?: string;
  testID?: string;
};

export function DateTimeField({
  label,
  text,
  empty,
  mode,
  pickerValue,
  minimumDate,
  onChange,
  onClear,
  title,
  testID,
}: Props) {
  const [open, setOpen] = useState(false);
  // Lo que se lleva elegido en el selector de iOS. Se confirma al cerrar el
  // sheet (por "Listo" o tocando fuera), para que abrir y cerrar sin tocar nada
  // igual fije la fecha que se estaba mostrando.
  const [draft, setDraft] = useState<Date | null>(null);

  const abrir = () => {
    // Marca para el diagnóstico: si la app muere con el selector abierto, el
    // siguiente arranque lo reporta (ver lib/crashBreadcrumb).
    markRiskyOpen(`picker-${mode}`);
    setDraft(null);
    setOpen(true);
  };

  const confirmar = () => {
    clearRiskyOpen();
    setOpen(false);
    onChange(draft ?? pickerValue);
  };

  const value = draft ?? pickerValue;

  return (
    <>
      <TouchableOpacity
        style={styles.field}
        onPress={abrir}
        activeOpacity={0.7}
        testID={testID}
      >
        <View style={styles.fieldTextCol}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={[styles.fieldValue, empty && styles.fieldValueEmpty]}>
            {text}
          </Text>
        </View>
        {/* Borrar va DENTRO del cuadro: en Android el selector es un diálogo
            del sistema y no puede alojar un botón propio. */}
        {onClear && !empty && (
          <TouchableOpacity
            onPress={onClear}
            hitSlop={10}
            accessibilityLabel={`Quitar ${label.toLowerCase()}`}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={COLORS.textTertiary}
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* Android: el picker ES el diálogo, se monta sólo al abrir. */}
      {Platform.OS === "android" && open && (
        <DateTimePicker
          value={pickerValue}
          mode={mode}
          minimumDate={minimumDate}
          onChange={(event, date) => {
            clearRiskyOpen();
            setOpen(false);
            if (event.type === "set" && date) onChange(date);
          }}
        />
      )}

      {/* iOS: sheet propio con el selector en JS. */}
      {Platform.OS === "ios" && (
        <Modal
          visible={open}
          transparent
          animationType="slide"
          onRequestClose={confirmar}
        >
          {/* Backdrop como Pressable DEBAJO de la hoja, y la hoja como View:
              si la hoja fuera un táctil, competiría con el scroll de las
              columnas de hora por el gesto vertical (ver SelectField). */}
          <View style={styles.overlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={confirmar} />
            <View style={styles.sheet}>
              <View style={styles.header}>
                <Text style={styles.title}>{title ?? label}</Text>
                <TouchableOpacity
                  onPress={confirmar}
                  hitSlop={12}
                  testID={testID ? `${testID}-done` : undefined}
                >
                  <Text style={styles.done}>Listo</Text>
                </TouchableOpacity>
              </View>
              {mode === "date" ? (
                <MonthGrid
                  value={value}
                  minimumDate={minimumDate}
                  onSelect={setDraft}
                />
              ) : (
                <TimeColumns value={value} onSelect={setDraft} />
              )}
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

// ─── Rango de fechas (entrada → salida) ────────────────────────────────────

type RangeProps = {
  start: Date | null;
  end: Date | null;
  /** Texto de cada fecha, ya en español (también el de "sin elegir"). */
  format: (date: Date | null) => string;
  /**
   * Mes que se muestra si todavía no hay fechas, y de donde sale la HORA de
   * las fechas elegidas (los llamadores pasan "hoy a medianoche").
   */
  defaultDate: Date;
  /** Mínimo para la ENTRADA. La salida siempre es posterior a la entrada. */
  minimumDate?: Date;
  onChange: (start: Date | null, end: Date | null) => void;
  startLabel?: string;
  endLabel?: string;
  testID?: string;
};

/**
 * Entrada y salida de una estancia en UNA sola hoja: se toca el día de
 * entrada, la hoja pasa sola a la salida y se toca el segundo día. Antes eran
 * dos `DateTimeField` y había que abrir el calendario dos veces.
 *
 * Los dos cuadros abren la misma hoja; el de salida la abre ya en el paso de
 * salida (para corregir solo esa fecha). En el paso de salida, tocar un día
 * igual o anterior a la entrada se toma como una entrada NUEVA: es lo que uno
 * quiere cuando se equivocó con el primer toque.
 *
 * El calendario es el propio (JS) también en Android: el diálogo del sistema
 * solo sabe elegir una fecha.
 */
export function DateRangeField({
  start,
  end,
  format,
  defaultDate,
  minimumDate,
  onChange,
  startLabel = "Entrada",
  endLabel = "Salida",
  testID,
}: RangeProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"start" | "end">("start");
  const [draft, setDraft] = useState<{ start: Date | null; end: Date | null }>({
    start: null,
    end: null,
  });

  const abrir = (wanted: "start" | "end") => {
    markRiskyOpen("picker-range");
    setDraft({ start, end });
    // Sin entrada no hay contra qué elegir la salida.
    setPhase(start ? wanted : "start");
    setOpen(true);
  };

  const confirmar = () => {
    clearRiskyOpen();
    setOpen(false);
    onChange(draft.start, draft.end);
  };

  const elegir = (date: Date) => {
    if (phase === "end" && draft.start && dayNumber(date) > dayNumber(draft.start)) {
      setDraft({ start: draft.start, end: date });
      return;
    }
    // Entrada nueva: la salida se conserva solo si sigue quedando después.
    const keepEnd = draft.end && dayNumber(draft.end) > dayNumber(date);
    setDraft({ start: date, end: keepEnd ? draft.end : null });
    setPhase("end");
  };

  const noches =
    draft.start && draft.end
      ? Math.round(
          (Date.UTC(
            draft.end.getFullYear(),
            draft.end.getMonth(),
            draft.end.getDate(),
          ) -
            Date.UTC(
              draft.start.getFullYear(),
              draft.start.getMonth(),
              draft.start.getDate(),
            )) /
            86400000,
        )
      : null;

  const campo = (which: "start" | "end") => {
    const date = which === "start" ? start : end;
    return (
      <TouchableOpacity
        style={[styles.field, styles.rangeCol]}
        onPress={() => abrir(which)}
        activeOpacity={0.7}
        testID={testID ? `${testID}-${which}` : undefined}
      >
        <View style={styles.fieldTextCol}>
          <Text style={styles.fieldLabel}>
            {which === "start" ? startLabel : endLabel}
          </Text>
          <Text style={[styles.fieldValue, !date && styles.fieldValueEmpty]}>
            {format(date)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const pestana = (which: "start" | "end") => {
    const date = which === "start" ? draft.start : draft.end;
    const active = phase === which;
    return (
      <TouchableOpacity
        style={[styles.rangeTab, active && styles.rangeTabActive]}
        onPress={() => setPhase(which)}
        // La salida no se puede elegir antes que la entrada.
        disabled={which === "end" && !draft.start}
        activeOpacity={0.7}
        testID={testID ? `${testID}-tab-${which}` : undefined}
      >
        <Text style={styles.fieldLabel}>
          {which === "start" ? startLabel : endLabel}
        </Text>
        <Text style={[styles.fieldValue, !date && styles.fieldValueEmpty]}>
          {format(date)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <View style={styles.rangeRow}>
        {campo("start")}
        {campo("end")}
      </View>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={confirmar}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={confirmar} />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {phase === "start"
                  ? "Elige el día de entrada"
                  : noches != null
                    ? `${noches} ${noches === 1 ? "noche" : "noches"}`
                    : "Ahora el día de salida"}
              </Text>
              <TouchableOpacity
                onPress={confirmar}
                hitSlop={12}
                testID={testID ? `${testID}-done` : undefined}
              >
                <Text style={styles.done}>Listo</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.rangeTabs}>
              {pestana("start")}
              {pestana("end")}
            </View>
            {/* `open &&`: el mes a la vista se fija al montar, así cada
                apertura arranca en el mes de las fechas actuales. */}
            {open && (
              <MonthGrid
                value={draft.start ?? defaultDate}
                // En el paso de salida no se bloquean los días anteriores a la
                // entrada: tocarlos mueve la entrada (ver `elegir`).
                minimumDate={minimumDate}
                range={draft}
                onSelect={elegir}
              />
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Calendario del mes ────────────────────────────────────────────────────

/** Día de calendario LOCAL como número comparable (20261001). */
function dayNumber(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function MonthGrid({
  value,
  minimumDate,
  onSelect,
  range,
}: {
  value: Date;
  minimumDate?: Date;
  onSelect: (date: Date) => void;
  /** Modo rango: marca los dos extremos y sombrea los días de en medio. */
  range?: { start: Date | null; end: Date | null };
}) {
  // El mes a la vista arranca en el del valor; después lo mueve la persona.
  const [year, setYear] = useState(value.getFullYear());
  const [month, setMonth] = useState(value.getMonth());

  const minDay = minimumDate ? dayNumber(minimumDate) : null;
  const selectedDay = dayNumber(value);
  const startDay = range?.start ? dayNumber(range.start) : null;
  const endDay = range?.end ? dayNumber(range.end) : null;
  const todayDay = dayNumber(new Date());

  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = domingo
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Siempre 6 renglones: si el alto dependiera del mes, la hoja brincaría al
  // pasar de uno de 5 semanas a uno de 6.
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);
  // Renglones explícitos de 7 con `flex: 1`, NO una cuadrícula con `flexWrap`
  // y anchos de 14.28%: el redondeo de píxeles hacía que el séptimo día no
  // cupiera y el sábado se cayera al renglón siguiente, corriendo todo el mes.
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // Mes anterior: sin sentido si todos sus días quedan antes del mínimo.
  const lastDayOfPrevMonth = new Date(year, month, 0);
  const canGoBack = minDay == null || dayNumber(lastDayOfPrevMonth) >= minDay;

  const goBack = () => {
    if (!canGoBack) return;
    if (month === 0) {
      setMonth(11);
      setYear(year - 1);
    } else setMonth(month - 1);
  };
  const goForward = () => {
    if (month === 11) {
      setMonth(0);
      setYear(year + 1);
    } else setMonth(month + 1);
  };

  return (
    <View>
      <View style={styles.monthHeader}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={12}
          disabled={!canGoBack}
          accessibilityLabel="Mes anterior"
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color={canGoBack ? COLORS.textPrimary : COLORS.textDisabled}
          />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>
          {MONTH_NAMES[month]} {year}
        </Text>
        <TouchableOpacity
          onPress={goForward}
          hitSlop={12}
          accessibilityLabel="Mes siguiente"
        >
          <Ionicons name="chevron-forward" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={styles.weekText}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((day, di) => {
            if (day === null) return <View key={`e-${di}`} style={styles.dayCell} />;
            const cellDay = year * 10000 + (month + 1) * 100 + day;
            const disabled = minDay != null && cellDay < minDay;
            const selected = range
              ? cellDay === startDay || cellDay === endDay
              : cellDay === selectedDay;
            // Banda del rango: completa en los días de en medio y de medio
            // ancho en los extremos, para que arranque y termine en el círculo.
            const hasRange = startDay != null && endDay != null;
            const inRange = hasRange && cellDay > startDay && cellDay < endDay;
            const bandFromHere = hasRange && cellDay === startDay;
            const bandToHere = hasRange && cellDay === endDay;
            const isToday = cellDay === todayDay;
            return (
              <TouchableOpacity
                key={day}
                style={styles.dayCell}
                disabled={disabled}
                activeOpacity={0.6}
                testID={`day-${day}`}
                onPress={() => {
                  // Solo cambia el DÍA: la hora del valor se conserva, que es
                  // lo que hacía el selector nativo y lo que esperan los
                  // llamadores.
                  const next = new Date(value);
                  next.setFullYear(year, month, day);
                  onSelect(next);
                }}
              >
                {(inRange || bandFromHere || bandToHere) && (
                  <View
                    style={[
                      styles.rangeBand,
                      bandFromHere && styles.rangeBandStart,
                      bandToHere && styles.rangeBandEnd,
                    ]}
                  />
                )}
                <View
                  style={[
                    styles.dayNumber,
                    isToday && styles.todayCircle,
                    selected && styles.selectedCircle,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      isToday && !selected && styles.todayText,
                      disabled && styles.dayTextDisabled,
                      selected && styles.selectedText,
                    ]}
                  >
                    {day}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Columnas de hora ──────────────────────────────────────────────────────

const ROW_HEIGHT = 44;
const VISIBLE_ROWS = 5;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTE_STEP = 5;

function hourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? "am" : "pm"}`;
}

/**
 * Desplazamiento inicial para que el renglón elegido quede a media columna,
 * topado al final de la lista: sin el tope, las últimas horas (10–11 pm) y
 * minutos (:50, :55) abrían con un hueco en blanco abajo.
 */
function initialOffset(index: number, count: number) {
  const max = Math.max(0, (count - VISIBLE_ROWS) * ROW_HEIGHT);
  const centered = (index - Math.floor(VISIBLE_ROWS / 2)) * ROW_HEIGHT;
  return { x: 0, y: Math.min(max, Math.max(0, centered)) };
}

function TimeColumns({
  value,
  onSelect,
}: {
  value: Date;
  onSelect: (date: Date) => void;
}) {
  const hour = value.getHours();
  const minute = value.getMinutes();

  // Las listas y el desplazamiento inicial se fijan AL ABRIR: si se
  // recalcularan con cada toque, `contentOffset` movería la columna sola.
  const [minutes] = useState(() => {
    const list: number[] = [];
    for (let m = 0; m < 60; m += MINUTE_STEP) list.push(m);
    // Una hora ya guardada con un minuto fuera de paso (9:10 → sí; 9:07 → no
    // estaría en la lista): se agrega para no cambiarla sin querer.
    if (!list.includes(minute)) {
      list.push(minute);
      list.sort((a, b) => a - b);
    }
    return list;
  });
  const [hourOffset] = useState(() => initialOffset(hour, HOURS.length));
  const [minuteOffset] = useState(() =>
    initialOffset(minutes.indexOf(minute), minutes.length),
  );

  const pick = (h: number, m: number) => {
    const next = new Date(value);
    next.setHours(h, m, 0, 0);
    onSelect(next);
  };

  const hhmm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  return (
    <View>
      <Text style={styles.timePreview}>{formatTimeHHmm(hhmm)}</Text>
      <View style={styles.timeRow}>
        <ScrollView
          style={styles.timeColumn}
          contentOffset={hourOffset}
          showsVerticalScrollIndicator={false}
        >
          {HOURS.map((h) => {
            const selected = h === hour;
            return (
              <TouchableOpacity
                key={h}
                style={[styles.timeItem, selected && styles.timeItemSelected]}
                onPress={() => pick(h, minute)}
                activeOpacity={0.7}
                testID={`time-hour-${h}`}
              >
                <Text
                  style={[styles.timeText, selected && styles.timeTextSelected]}
                >
                  {hourLabel(h)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <ScrollView
          style={styles.timeColumn}
          contentOffset={minuteOffset}
          showsVerticalScrollIndicator={false}
        >
          {minutes.map((m) => {
            const selected = m === minute;
            return (
              <TouchableOpacity
                key={m}
                style={[styles.timeItem, selected && styles.timeItemSelected]}
                onPress={() => pick(hour, m)}
                activeOpacity={0.7}
                testID={`time-minute-${m}`}
              >
                <Text
                  style={[styles.timeText, selected && styles.timeTextSelected]}
                >
                  :{String(m).padStart(2, "0")}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const DAY_SIZE = 38;

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fieldTextCol: { flex: 1 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  fieldValueEmpty: { color: COLORS.textTertiary },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  done: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  // Rango (entrada → salida)
  rangeRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  rangeCol: { flex: 1 },
  rangeTabs: { flexDirection: "row", gap: 10, marginTop: 12 },
  rangeTab: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.borderLight,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  rangeTabActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  // Calendario
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 4,
  },
  monthTitle: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  weekRow: { flexDirection: "row" },
  weekText: {
    flex: 1,
    textAlign: "center",
    marginBottom: 2,
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 3,
    minHeight: DAY_SIZE + 6,
  },
  dayNumber: {
    width: DAY_SIZE,
    height: DAY_SIZE,
    borderRadius: DAY_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
  },
  dayTextDisabled: { color: COLORS.textDisabled },
  todayCircle: { borderWidth: 2, borderColor: COLORS.primary },
  todayText: { color: COLORS.primary, fontFamily: "PlusJakartaSans_700Bold" },
  selectedCircle: { backgroundColor: COLORS.primary },
  rangeBand: {
    position: "absolute",
    top: 3,
    left: 0,
    right: 0,
    height: DAY_SIZE,
    backgroundColor: COLORS.primaryLight,
  },
  rangeBandStart: { left: "50%" },
  rangeBandEnd: { right: "50%" },
  selectedText: { color: COLORS.white, fontFamily: "PlusJakartaSans_700Bold" },
  // Hora
  timePreview: {
    fontSize: 26,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    textAlign: "center",
    paddingVertical: 10,
  },
  timeRow: { flexDirection: "row", gap: 12 },
  timeColumn: {
    flex: 1,
    height: ROW_HEIGHT * VISIBLE_ROWS,
    borderRadius: 12,
    backgroundColor: COLORS.bgSection,
  },
  timeItem: {
    height: ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  timeItemSelected: { backgroundColor: COLORS.primary },
  timeText: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
  },
  timeTextSelected: { color: COLORS.white },
});
