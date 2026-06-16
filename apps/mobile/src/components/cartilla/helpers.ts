import { formatDayShortYear } from "@/lib/format";
import { type DewormingType } from "@/lib/api";

export function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export function clampDate(value: Date, min?: Date, max?: Date): Date {
  if (max && value > max) return max;
  if (min && value < min) return min;
  return value;
}

export type VaccineRow = {
  catalogId: string | null;
  appliedAt: Date;
  expiresAt: Date;
};

export type DewormingRow = {
  type: DewormingType;
  productName: string;
  appliedAt: Date;
  expiresAt: Date;
  notes: string;
};

export const DEWORMING_TYPES: { key: DewormingType; label: string }[] = [
  { key: "INTERNAL", label: "Interna" },
  { key: "EXTERNAL", label: "Externa" },
  { key: "BOTH", label: "Ambas" },
];

// Próxima dosis sugerida para desparasitantes (común: 3 meses).
export const DEWORMING_DEFAULT_DAYS = 90;

export const addDays = (d: Date, days: number) =>
  new Date(d.getTime() + days * 86_400_000);

export const formatShort = (d: Date) => formatDayShortYear(d);
