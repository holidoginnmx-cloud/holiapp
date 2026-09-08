import { COLORS } from "@/constants/colors";
import { View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";

import { getMyClaimRequest } from "@/lib/api/users";
import { buildWhatsappUrl } from "@/constants/business";

/**
 * "¿En qué va mi solicitud de vinculación?"
 *
 * El cliente de toda la vida cuya ficha no tiene contacto pide que el equipo se
 * la vincule a mano... y ahí se acababa todo para él: la pantalla "¿Ya eres
 * cliente?" se muestra UNA sola vez por cuenta, así que no podía volver ni
 * siquiera a ver su "Solicitud enviada ✓". Dos días de espera y "todavía no la
 * revisan" era indistinguible de "no le llegó a nadie" — y lo natural entonces
 * es registrar al perro otra vez, que es justo lo que queremos evitar.
 *
 * Por eso el aviso vive en la lista de MASCOTAS y no en el onboarding: es donde
 * el cliente va a estar mirando, y sigue visible aunque ya haya registrado a su
 * perro (ese es el caso más común, no la excepción).
 */
export function ClaimStatusBanner() {
  const { data } = useQuery({
    queryKey: ["claim-request-mine"],
    queryFn: getMyClaimRequest,
    staleTime: 60_000,
  });

  const solicitud = data?.request;
  if (!solicitud) return null;

  const pendiente = solicitud.status === "PENDING";
  const fecha = new Date(solicitud.createdAt).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
  });

  return (
    <View
      style={[styles.card, !pendiente && styles.cardRechazada]}
      testID="claim-status-banner"
    >
      <View style={styles.row}>
        <Ionicons
          name={pendiente ? "time-outline" : "alert-circle-outline"}
          size={20}
          color={pendiente ? COLORS.primary : COLORS.errorText}
        />
        <Text style={styles.titulo}>
          {pendiente
            ? "Estamos buscando tu ficha"
            : "No pudimos vincular tu ficha"}
        </Text>
      </View>

      <Text style={styles.texto}>
        {pendiente
          ? `Pediste el ${fecha} que vinculáramos tus mascotas de siempre. En cuanto lo hagamos, aparecen aquí con todo su historial y te avisamos.`
          : "Escríbenos y lo resolvemos contigo: puede que tu ficha esté a otro nombre o con otro teléfono."}
      </Text>

      <TouchableOpacity
        style={styles.enlace}
        onPress={() =>
          Linking.openURL(
            buildWhatsappUrl(
              pendiente
                ? "Hola 👋 Pedí en la app que vincularan mis mascotas a mi cuenta y quiero saber cómo va."
                : "Hola 👋 Quiero vincular mis mascotas de siempre a mi cuenta de la app.",
            ),
          )
        }
        activeOpacity={0.7}
        testID="claim-status-whatsapp"
      >
        <Ionicons name="logo-whatsapp" size={16} color={COLORS.primary} />
        <Text style={styles.enlaceTexto}>
          {pendiente ? "Preguntar por WhatsApp" : "Escríbenos por WhatsApp"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 8,
  },
  cardRechazada: { backgroundColor: COLORS.errorBgLight },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  titulo: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: COLORS.textPrimary,
    flex: 1,
  },
  texto: {
    fontFamily: "PlusJakartaSans_400Regular",
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textSecondary,
  },
  enlace: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  enlaceTexto: {
    fontFamily: "PlusJakartaSans_600SemiBold",
    fontSize: 13,
    color: COLORS.primary,
  },
});
