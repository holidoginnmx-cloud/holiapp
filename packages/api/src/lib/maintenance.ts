import type { PrismaClient } from "@holidoginn/db";
import {
  autoCheckoutOverdueStays,
  cancelOverdueDeposits,
  notifyExpiringVaccines,
} from "./auto-actions";

// Tareas de mantenimiento periódicas: auto-checkout de estancias vencidas,
// cancelación de anticipos vencidos y recordatorios de vacunas por vencer.
//
// Antes corrían de forma síncrona en cada GET /reservations, /admin/stats y
// /staff/stays, añadiendo varios escaneos de tabla por request (la causa
// principal de la lentitud al navegar). Ahora se disparan en segundo plano
// (fire-and-forget) y, gracias al throttle, se ejecutan a lo sumo una vez cada
// MAINTENANCE_INTERVAL_MS sin importar cuántos requests lleguen.
//
// Si en el futuro se prefiere un cron externo (p. ej. Railway cron), basta con
// invocar `runMaintenance(prisma)` desde un endpoint protegido.

const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos

let lastRun = 0;
let running = false;

/**
 * Dispara el mantenimiento si toca (no bloquea: retorna de inmediato).
 * Seguro de llamar en cualquier ruta caliente.
 */
export function triggerMaintenance(prisma: PrismaClient): void {
  const now = Date.now();
  if (running || now - lastRun < MAINTENANCE_INTERVAL_MS) return;
  running = true;
  lastRun = now;
  void runMaintenance(prisma).finally(() => {
    running = false;
  });
}

/** Ejecuta todas las tareas de mantenimiento. Cada una aísla su error. */
export async function runMaintenance(prisma: PrismaClient): Promise<void> {
  try {
    await cancelOverdueDeposits(prisma);
  } catch (err) {
    console.error("[maintenance] cancelOverdueDeposits falló:", err);
  }
  try {
    await autoCheckoutOverdueStays(prisma);
  } catch (err) {
    console.error("[maintenance] autoCheckoutOverdueStays falló:", err);
  }
  try {
    await notifyExpiringVaccines(prisma);
  } catch (err) {
    console.error("[maintenance] notifyExpiringVaccines falló:", err);
  }
}
