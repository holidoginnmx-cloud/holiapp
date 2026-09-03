import { useEffect, useRef, useState } from "react";
import type { QuotePreviewInput } from "@holidoginn/shared";
import { previewQuote, type QuotePreviewResult } from "@/lib/api";

/**
 * Total en vivo de una cotización, calculado SIEMPRE por el servidor.
 *
 * La pantalla no suma nada por su cuenta: así el número que ve el operador
 * mientras captura es exactamente el que se va a guardar y a prometerle al
 * cliente. (La pantalla de crear reservación del equipo estima en local, pero
 * con las tarifas de GET /admin/lodging-pricing: sin números quemados.)
 *
 * El debounce evita una petición por tecla. Las respuestas viejas se descartan
 * por número de secuencia: sin eso, una petición lenta puede pisar el resultado
 * de otra más reciente y mostrar un total que ya no corresponde a la captura.
 */
export function useQuotePreview(input: QuotePreviewInput | null, delayMs = 450) {
  const [result, setResult] = useState<QuotePreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  // El input es un objeto nuevo en cada render; se compara por su forma
  // serializada para no disparar peticiones sin cambios reales.
  const key = input ? JSON.stringify(input) : null;

  useEffect(() => {
    if (!key) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await previewQuote(JSON.parse(key) as QuotePreviewInput);
        if (mine !== seq.current) return; // llegó tarde: ya hay una más nueva
        setResult(data);
        setError(null);
      } catch (err) {
        if (mine !== seq.current) return;
        setResult(null);
        setError(err instanceof Error ? err.message : "No se pudo calcular el total");
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, delayMs);

    return () => clearTimeout(timer);
  }, [key, delayMs]);

  return { result, error, loading };
}
