import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Modal,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { COLORS } from "@/constants/colors";
import { formatCurrency } from "@/lib/format";
import { getEstadoMensualidad, type EstadoMensualidad } from "@/lib/api";

/**
 * Recordatorio de pago de la mensualidad de las apps, solo para ADMIN.
 *
 * Desde el día de cobro (15) y hasta que el pago se registre en Pasta, sale
 * cada vez que abren la app: al arrancar, y al volver de segundo plano si ya
 * pasaron 30 min desde la última vez (sin ese margen saldría cada vez que
 * contestan un WhatsApp). Se cierra con "Entendido": nunca bloquea la app.
 *
 * Solo aparece con el dashboard enfocado, y `enabled` lo apaga mientras
 * Novedades está en pantalla: dos Modal nativos encimados en iOS dejan
 * colgado lo que se presente después (ver usePaymentCheckout).
 *
 * El estado de la mensualidad lo da la API (que le pregunta a Pasta). Si la
 * API no sabe, contesta "al corriente" y aquí no pasa nada.
 */

const COOLDOWN_MS = 30 * 60 * 1000;

/** Vive en el módulo, no en disco: un arranque en frío vuelve a mostrarlo. */
let ultimaVez = 0;

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-10-01" → "octubre". Se parte el string: un Date lo correría de día. */
function mesDe(ymd: string): string {
  return MESES[Number(ymd.slice(5, 7)) - 1] ?? ymd;
}

/** "2026-10-15" → "15 de octubre". */
function diaDe(ymd: string): string {
  return `${Number(ymd.slice(8, 10))} de ${mesDe(ymd)}`;
}

export function MensualidadModal({ enabled }: { enabled: boolean }) {
  const [visible, setVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, [])
  );

  const { data, refetch } = useQuery({
    queryKey: ["admin", "mensualidad"],
    queryFn: getEstadoMensualidad,
    staleTime: 60_000,
    retry: false,
  });

  const puedeMostrar = enabled && isFocused;
  const puedeMostrarRef = useRef(puedeMostrar);
  puedeMostrarRef.current = puedeMostrar;

  const mostrarSiToca = useCallback((estado?: EstadoMensualidad) => {
    if (!puedeMostrarRef.current || !estado?.pendiente) return;
    if (Date.now() - ultimaVez < COOLDOWN_MS) return;
    ultimaVez = Date.now();
    setVisible(true);
  }, []);

  useEffect(() => {
    if (puedeMostrar) mostrarSiToca(data);
  }, [puedeMostrar, data, mostrarSiToca]);

  // Al volver de segundo plano se relee: si ya pagaron, que no salga.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active" || Date.now() - ultimaVez < COOLDOWN_MS) return;
      refetch().then((r) => mostrarSiToca(r.data));
    });
    return () => sub.remove();
  }, [refetch, mostrarSiToca]);

  if (!visible || !data?.pendiente) return null;

  const cerrar = () => setVisible(false);
  const total = data.cobros.reduce((s, c) => s + c.saldo, 0);
  const meses = data.cobros.map((c) => mesDe(c.periodo ?? c.fechaVencimiento));
  const masViejo = data.cobros[0];
  const dp = data.datosPago;

  const compartir = () => {
    if (!dp) return;
    // Se muestra agrupada para leerla; se copia sin espacios para pegarla en el banco.
    Share.share({ message: dp.clabe.replace(/\s/g, "") }).catch(() => {});
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cerrar}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Ionicons name="calendar-outline" size={26} color={COLORS.warningText} />
            </View>
            <Text style={styles.title}>Recordatorio de pago</Text>
            <Text style={styles.subtitle}>
              {meses.length === 1
                ? `La mensualidad de ${meses[0]} de las apps de Holidog Inn venció el ${diaDe(masViejo.fechaVencimiento)}.`
                : `Hay ${meses.length} mensualidades de las apps pendientes (${meses.join(", ")}).`}
            </Text>
          </View>

          <View style={styles.montoBox}>
            <Text style={styles.montoLabel}>Monto pendiente</Text>
            <Text style={styles.monto}>{formatCurrency(total)} MXN</Text>
          </View>

          {dp && (
            <View style={styles.datos}>
              <Fila label="Banco" valor={dp.banco} />
              <Fila label="Titular" valor={dp.titular} />
              <Fila label="CLABE" valor={dp.clabe} destacado />
              <TouchableOpacity
                style={styles.compartirBtn}
                onPress={compartir}
                accessibilityRole="button"
                hitSlop={6}
              >
                <Ionicons name="share-outline" size={16} color={COLORS.primary} />
                <Text style={styles.compartirText}>Copiar o compartir CLABE</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.nota}>
            Si ya pagaste, puede tardar un rato en reflejarse. ¡Gracias!
          </Text>

          <TouchableOpacity style={styles.okBtn} onPress={cerrar} accessibilityRole="button">
            <Text style={styles.okBtnText}>Entendido</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Fila({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <View style={styles.fila}>
      <Text style={styles.filaLabel}>{label}</Text>
      <Text style={[styles.filaValor, destacado && styles.filaValorDestacado]} selectable>
        {valor}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 20,
    width: "100%",
    maxWidth: 440,
  },
  header: { alignItems: "center", gap: 6, marginBottom: 14 },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.warningBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  title: {
    fontSize: 20,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  montoBox: {
    backgroundColor: COLORS.bgSection,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    gap: 2,
  },
  montoLabel: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  monto: {
    fontSize: 22,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
  },
  datos: {
    marginTop: 14,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingTop: 12,
  },
  fila: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  filaLabel: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  filaValor: {
    flexShrink: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
    textAlign: "right",
  },
  filaValorDestacado: {
    fontFamily: "PlusJakartaSans_700Bold",
    fontSize: 14,
    letterSpacing: 0.5,
  },
  compartirBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
  },
  compartirText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  nota: {
    marginTop: 10,
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
  },
  okBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 14,
  },
  okBtnText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});
