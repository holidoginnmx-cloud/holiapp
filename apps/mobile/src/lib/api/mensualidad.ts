import { apiFetch } from "./client";

// ─── Mensualidad de las apps (solo ADMIN) ───────────────
// La lleva Pasta (cobranza del desarrollador); la API solo la reenvía. Ver
// packages/api/src/lib/mensualidad.ts.

export type CobroMensualidad = {
  /** `YYYY-MM-01` del mes que se cobra; null en cobros sueltos. */
  periodo: string | null;
  concepto: string;
  saldo: number;
  /** `YYYY-MM-DD`, día del hotel. */
  fechaVencimiento: string;
};

export type EstadoMensualidad = {
  pendiente: boolean;
  cobros: CobroMensualidad[];
  datosPago: { banco: string; titular: string; clabe: string } | null;
};

export const getEstadoMensualidad = () =>
  apiFetch<EstadoMensualidad>("/admin/mensualidad");
