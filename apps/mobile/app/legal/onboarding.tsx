import { COLORS } from "@/constants/colors";
import { getMyLegalStatus, type LegalDocType } from "@/lib/api";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type DocMeta = {
  type: LegalDocType;
  title: string;
  subtitle: string;
  route: "/legal/tos" | "/legal/privacy" | "/legal/vet-authorization" | "/legal/image-consent";
};

const DOC_META: Record<LegalDocType, DocMeta> = {
  TOS: {
    type: "TOS",
    title: "Términos y condiciones",
    subtitle: "Reglas del servicio.",
    route: "/legal/tos",
  },
  PRIVACY: {
    type: "PRIVACY",
    title: "Aviso de privacidad",
    subtitle: "Cómo cuidamos tus datos.",
    route: "/legal/privacy",
  },
  VET_AUTH: {
    type: "VET_AUTH",
    title: "Autorización veterinaria",
    subtitle: "Qué hacemos en una emergencia.",
    route: "/legal/vet-authorization",
  },
  IMAGE_USE: {
    type: "IMAGE_USE",
    title: "Uso de imagen (opcional)",
    subtitle: "Puedes omitirlo — reservar no depende de esto.",
    route: "/legal/image-consent",
  },
};

const REQUIRED_ORDER: LegalDocType[] = ["TOS", "PRIVACY", "VET_AUTH"];

export default function LegalOnboardingScreen() {
  const router = useRouter();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["legal-status"],
    queryFn: getMyLegalStatus,
  });

  // Cerrar automáticamente cuando ya no falte nada requerido.
  // Usamos replace a home porque a /legal/onboarding se llega via replace
  // desde ClerkTokenSync — no hay historial al que regresar con back().
  useEffect(() => {
    if (data?.canBook) {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)/home");
      }
    }
  }, [data?.canBook]);

  if (isLoading || !data) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  const missing = new Set(data.missing);
  const items = REQUIRED_ORDER.map((t) => DOC_META[t]);

  return (
    <>
      <Stack.Screen options={{ title: "Consentimientos" }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.header}>Antes de tu primera reserva</Text>
        <Text style={styles.sub}>
          Necesitamos que revises y aceptes estos documentos. Es rápido y solo
          se hace una vez por versión.
        </Text>

        {items.map((item) => {
          const pending = missing.has(item.type);
          return (
            <TouchableOpacity
              key={item.type}
              style={[styles.row, !pending && styles.rowDone]}
              activeOpacity={0.7}
              onPress={() => {
                router.push(item.route);
                // Refetch al volver — por si invalidate no llegó a tiempo
                setTimeout(refetch, 200);
              }}
            >
              <View
                style={[
                  styles.iconWrap,
                  pending ? styles.iconPending : styles.iconDone,
                ]}
              >
                <Ionicons
                  name={pending ? "document-text-outline" : "checkmark"}
                  size={22}
                  color={pending ? COLORS.primary : COLORS.successText}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.subtitle}>
                  {pending ? item.subtitle : "Aceptado ✓"}
                </Text>
              </View>
              {pending ? (
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={COLORS.textTertiary}
                />
              ) : null}
            </TouchableOpacity>
          );
        })}

        <View style={styles.divider} />

        <Text style={styles.optionalHeader}>Opcional</Text>
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.7}
          onPress={() => router.push(DOC_META.IMAGE_USE.route)}
        >
          <View style={[styles.iconWrap, styles.iconOptional]}>
            <Ionicons name="camera-outline" size={22} color="#92400E" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{DOC_META.IMAGE_USE.title}</Text>
            <Text style={styles.subtitle}>{DOC_META.IMAGE_USE.subtitle}</Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={COLORS.textTertiary}
          />
        </TouchableOpacity>

        {data.canBook ? (
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/home");
            }}
          >
            <Text style={styles.continueLabel}>Continuar</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 32 },
  header: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  sub: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginBottom: 20,
    lineHeight: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.white,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  rowDone: {
    opacity: 0.7,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  iconPending: { backgroundColor: COLORS.primaryLight },
  iconDone: { backgroundColor: COLORS.successBg },
  iconOptional: { backgroundColor: "#FEF3C7" },
  title: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.borderLight,
    marginVertical: 16,
  },
  optionalHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  continueBtn: {
    marginTop: 24,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  continueLabel: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
  },
});
