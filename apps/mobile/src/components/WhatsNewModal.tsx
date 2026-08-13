import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { COLORS } from "@/constants/colors";
import { useAuthStore } from "@/store/authStore";
import {
  WHATS_NEW,
  type TeamRole,
  type WhatsNewItem,
} from "@/constants/whatsNew";
import { readWhatsNewSeen, writeWhatsNewSeen } from "@/lib/whatsNewSeen";

type Props = {
  role: TeamRole;
  /**
   * Abre el modal a demanda desde el botón "Novedades" de Ajustes (admin) o
   * Más (staff). Sin esta prop el componente conserva su comportamiento
   * automático: aparece solo, una vez por release y por usuario.
   *
   * Hace falta porque el aviso se lee de corrido y se cierra: sin una forma de
   * volver a abrirlo, quien lo despacha sin leer pierde la información para
   * siempre.
   */
  open?: boolean;
  /** Requerido cuando se usa `open`: el padre controla el cierre. */
  onClose?: () => void;
};

/**
 * "Qué hay de nuevo" para el equipo. Se monta en el dashboard de admin y en el
 * de staff; muestra el release más reciente (filtrado por rol) una sola vez
 * por usuario. Se marca visto al cerrarlo o al saltar a probar una función.
 */
export function WhatsNewModal({ role, open, onClose }: Props) {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const [autoVisible, setAutoVisible] = useState(false);

  const release = WHATS_NEW[0];
  const items = release?.items.filter((i) => i.roles.includes(role)) ?? [];
  // `open` mandado por el padre gana; si no viene, manda el automático.
  const controlado = open !== undefined;
  const visible = controlado ? open : autoVisible;

  useEffect(() => {
    // En modo controlado no se auto-abre: el padre decide cuándo.
    if (controlado) return;
    if (!userId || !release || items.length === 0) return;
    let cancelled = false;
    readWhatsNewSeen(userId).then((seen) => {
      if (!cancelled && seen !== release.id) setAutoVisible(true);
    });
    return () => {
      cancelled = true;
    };
    // items se deriva de release+role; con release.id alcanza como dependencia.
  }, [controlado, userId, release?.id, role]);

  if (!visible || !release || items.length === 0) return null;

  const dismiss = () => {
    setAutoVisible(false);
    onClose?.();
    if (userId) writeWhatsNewSeen(userId, release.id);
  };

  const tryItem = (item: WhatsNewItem) => {
    dismiss();
    if (item.route) router.push(item.route as never);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.sparkle}>✨</Text>
            <Text style={styles.title}>{release.title}</Text>
            <Text style={styles.subtitle}>
              Esto es lo nuevo que ya puedes usar:
            </Text>
          </View>

          <ScrollView
            style={styles.itemsScroll}
            contentContainerStyle={styles.itemsContent}
            showsVerticalScrollIndicator={false}
          >
            {items.map((item) => (
              <View key={item.title} style={styles.item}>
                <View style={styles.itemIconWrap}>
                  <Ionicons name={item.icon} size={20} color={COLORS.primary} />
                </View>
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemText}>{item.body}</Text>
                  {item.route && (
                    <TouchableOpacity
                      onPress={() => tryItem(item)}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={styles.itemTryLink}>Probarlo →</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={styles.okBtn}
            onPress={dismiss}
            accessibilityRole="button"
          >
            <Text style={styles.okBtnText}>¡Entendido!</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
    maxHeight: "85%",
  },
  header: { alignItems: "center", gap: 4, marginBottom: 12 },
  sparkle: { fontSize: 28 },
  title: {
    fontSize: 20,
    fontFamily: "Outfit_600SemiBold",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
  },
  itemsScroll: { flexGrow: 0 },
  itemsContent: { gap: 14, paddingVertical: 4 },
  item: { flexDirection: "row", gap: 12 },
  itemIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.bgSection,
    alignItems: "center",
    justifyContent: "center",
  },
  itemBody: { flex: 1, gap: 2 },
  itemTitle: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  itemText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  itemTryLink: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
    marginTop: 4,
  },
  okBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  okBtnText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});
