import { COLORS } from "@/constants/colors";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  acceptLegalDocument,
  getLegalDocuments,
  type LegalDocType,
} from "@/lib/api";


import { alertaDeError } from "@/lib/errorAlert";

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

  // Si el documento cabe completo en pantalla (iPad, iPhone grande, texto
  // corto) `onScroll` no dispara NUNCA y el botón se quedaba en "Desplaza
  // hasta el final" para siempre — con la autorización veterinaria obligatoria
  // el cliente no podía salir del onboarding. Por eso también se comparan
  // alturas: sin nada que desplazar, ya se "leyó hasta el final". Se reevalúa
  // en cada cambio de tamaño (rotación de iPad, contenido que termina de cargar).
  const layoutHeightRef = useRef(0);
  const contentHeightRef = useRef(0);

  const evaluateFit = useCallback(() => {
    const layoutHeight = layoutHeightRef.current;
    const contentHeight = contentHeightRef.current;
    if (layoutHeight > 0 && contentHeight > 0 && contentHeight <= layoutHeight + 1) {
      setScrollDone(true);
    }
  }, []);

  // Al cambiar de documento (misma pantalla reutilizada) vuelve a exigirse la
  // lectura; si sigue cabiendo, la comparación de alturas lo libera de nuevo.
  useEffect(() => {
    setScrollDone(false);
    evaluateFit();
  }, [documentType, evaluateFit]);

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
      alertaDeError(err);
    },
  });

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onLayout={({ nativeEvent }) => {
          layoutHeightRef.current = nativeEvent.layout.height;
          evaluateFit();
        }}
        onContentSizeChange={(_width, height) => {
          contentHeightRef.current = height;
          evaluateFit();
        }}
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
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 12,
  },
  versionLabel: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginBottom: 16,
    fontFamily: "monospace",
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
    fontFamily: "PlusJakartaSans_700Bold",
  },
  rejectLabel: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontFamily: "PlusJakartaSans_600SemiBold",
  },
});
