import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuthStore } from "@/store/authStore";
import { getPendingReview } from "@/lib/api";
import { ReviewPromptModal } from "./ReviewPromptModal";

/**
 * El pop-up de calificación que sale al abrir la app, como el de Uber al
 * terminar un viaje.
 *
 * Antes el modal sólo aparecía si el cliente entraba al detalle de su
 * reservación — y casi nadie entra después de recoger a su perro, así que en la
 * práctica no se juntaban reseñas. Ahora el servidor decide qué visita está
 * pendiente (`GET /reviews/pending`, una sola a la vez) y esto la muestra en el
 * Inicio.
 *
 * Se monta en el Inicio del cliente. Fuera del `ScrollView`: es un `Modal`
 * nativo y no debe contar como subvista del scroll.
 */
export function GlobalReviewPrompt() {
  const userId = useAuthStore((s) => s.userId);
  const role = useAuthStore((s) => s.role);
  const [open, setOpen] = useState(false);
  // Una sola aparición por sesión. Cubre dos cosas: que el modal no reaparezca
  // en bucle si el "Más tarde" no alcanzó a guardarse (sin red), y que al
  // enviar una reseña no salte de inmediato la de la visita anterior —
  // encadenar pop-ups es justo lo que hace que la gente desinstale.
  const interacted = useRef(false);

  const { data } = useQuery({
    queryKey: ["reviews", "pending"],
    queryFn: getPendingReview,
    enabled: !!userId && (role === "OWNER" || role == null),
    staleTime: 5 * 60_000,
  });

  const pending = data?.pending ?? null;

  useEffect(() => {
    if (!pending || interacted.current) return;
    setOpen(true);
  }, [pending?.groupKey]);

  if (!pending) return null;

  return (
    <ReviewPromptModal
      visible={open}
      userId={userId}
      target={{
        reservationIds: pending.reservationIds,
        reservationType: pending.reservationType,
        petNames: pending.petNames,
      }}
      onDismiss={() => {
        interacted.current = true;
        setOpen(false);
      }}
    />
  );
}
