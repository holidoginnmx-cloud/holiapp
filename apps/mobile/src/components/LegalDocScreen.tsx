import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  acceptLegalDocument,
  getLegalDocuments,
  type LegalDocType,
} from "@/lib/api";

type Props = {
  documentType: LegalDocType;
  title: string;
  subtitle?: string;
  body: React.ReactNode;
  /** Texto del botón principal. Default: "Acepto" */
  acceptLabel?: string;
  /** Si true, muestra también un "Rechazar" (útil para IMAGE_USE opt-in) */
  showReject?: boolean;
};

export function LegalDocScreen({
  documentType,
  title,
  subtitle,
  body,
  acceptLabel = "Acepto",
  showReject = false,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [scrollDone, setScrollDone] = useState(false);

  const { data: docs } = useQuery({
    queryKey: ["legal-documents"],
    queryFn: getLegalDocuments,
  });
  const version = docs?.find((d) => d.type === documentType)?.version;

  const accept = useMutation({
    mutationFn: () => {
      if (!version) throw new Error("Versión no cargada");
      return acceptLegalDocument(documentType, version);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["legal-status"] }),
        queryClient.invalidateQueries({ queryKey: ["legal-acceptances"] }),
      ]);
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/legal/onboarding");
      }
    },
    onError: (err: Error) => {
      Alert.alert("Error", err.message);
    },
  });

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (
            layoutMeasurement.height + contentOffset.y >=
            contentSize.height - 20
          ) {
            setScrollDone(true);
          }
        }}
        scrollEventThrottle={200}
      >
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {version ? (
          <Text style={styles.versionLabel}>Versión vigente: {version}</Text>
        ) : null}

        <View style={styles.placeholderBanner}>
          <Text style={styles.placeholderBannerTitle}>⚠️ Texto pendiente de revisión legal</Text>
          <Text style={styles.placeholderBannerBody}>
            El contenido de abajo es un marcador. Antes del lanzamiento, reemplázalo
            con la versión revisada por tu abogado y sube la versión en
            <Text style={{ fontWeight: "700" }}>{" packages/api/src/lib/legal.ts"}</Text>.
          </Text>
        </View>

        <View style={styles.bodyWrap}>{body}</View>
      </ScrollView>

      <View style={styles.footer}>
        {showReject ? (
          <TouchableOpacity
            style={[styles.button, styles.rejectButton]}
            onPress={() => router.back()}
          >
            <Text style={styles.rejectLabel}>Ahora no</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[
            styles.button,
            styles.acceptButton,
            (!scrollDone || accept.isPending || !version) && styles.buttonDisabled,
          ]}
          disabled={!scrollDone || accept.isPending || !version}
          onPress={() => accept.mutate()}
        >
          {accept.isPending ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.acceptLabel}>
              {scrollDone ? acceptLabel : "Desplaza hasta el final"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginBottom: 12,
  },
  versionLabel: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginBottom: 16,
    fontFamily: "monospace",
  },
  placeholderBanner: {
    backgroundColor: "#FEF3C7",
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: "#D97706",
  },
  placeholderBannerTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#92400E",
    marginBottom: 4,
  },
  placeholderBannerBody: {
    fontSize: 12,
    color: "#78350F",
    lineHeight: 18,
  },
  bodyWrap: { gap: 10 },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButton: {
    backgroundColor: COLORS.primary,
  },
  rejectButton: {
    backgroundColor: COLORS.bgSection,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  acceptLabel: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
  },
  rejectLabel: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: "600",
  },
});
