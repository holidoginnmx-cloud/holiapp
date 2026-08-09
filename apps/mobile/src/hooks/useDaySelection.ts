import { useMemo, useState } from "react";

/** Fecha local → "YYYY-MM-DD" (sin saltos de día por UTC). */
export function toYMD(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

type UseDaySelectionOptions = {
  /** Días desde hoy para la fecha inicial y mínima (0 = hoy, 1 = mañana). */
  minOffsetDays?: number;
  /** Días desde hoy para la fecha máxima seleccionable. */
  maxOffsetDays?: number;
};

/**
 * Selección de UN día para los wizards de servicios por fecha (guardería,
 * baño): fecha elegida, visibilidad del DateTimePicker, ventana min/max
 * anclada a hoy y la fecha en formato YMD lista para la API.
 *
 * `pickerValue` acota la fecha al rango para el picker de iOS, que truena si
 * `value` queda fuera de [minimumDate, maximumDate].
 */
export function useDaySelection({
  minOffsetDays = 0,
  maxOffsetDays = 30,
}: UseDaySelectionOptions = {}) {
  const [date, setDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + minOffsetDays);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);

  const { minDate, maxDate } = useMemo(() => {
    const min = new Date();
    min.setDate(min.getDate() + minOffsetDays);
    min.setHours(0, 0, 0, 0);
    const max = new Date();
    max.setDate(max.getDate() + maxOffsetDays);
    max.setHours(23, 59, 59, 999);
    return { minDate: min, maxDate: max };
    // Ventana fija al montar (igual que el useMemo con [] de los wizards).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateYMD = useMemo(() => toYMD(date), [date]);

  const pickerValue = date < minDate ? minDate : date > maxDate ? maxDate : date;

  return {
    date,
    setDate,
    showDatePicker,
    setShowDatePicker,
    dateYMD,
    minDate,
    maxDate,
    pickerValue,
  };
}
