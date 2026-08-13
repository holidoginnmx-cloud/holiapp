import { useEffect, useMemo, useState } from "react";
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
  type WhatsNewRelease,
} from "@/constants/whatsNew";
import { readWhatsNewSeen, writeWhatsNewSeen } from "@/lib/whatsNewSeen";

type Props = {
  role: TeamRole;
  /**
   * Abre el modal a demanda desde el botón "Novedades" de Ajustes (admin) o
   * Más (staff). Sin esta prop el componente conserva su comportamiento
   * automático: aparece solo cuando hay entregas sin ver.
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
 * "Qué hay de nuevo" para el equipo, con HISTORIAL.
 *
 * Antes solo se veía la entrega más reciente, así que cada release nuevo
 * enterraba al anterior: quien no hubiera abierto la app en unos días perdía
 * para siempre lo del medio. Ahora se listan todas: las que aún no has visto
 * salen abiertas, y las anteriores quedan plegadas con su fecha, a un toque de
 * distancia.
 */
export function WhatsNewModal({ role, open, onClose }: Props) {
  const router = useRouter();
  const userId = useAuthStore((s) => s.userId);
  const [autoVisible, setAutoVisible] = useState(false);
  /** `undefined` = todavía leyendo SecureStore; `null` = nunca vio ninguna. */
  const [seenId, setSeenId] = useState<string | null | undefined>(undefined);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  // Entregas que le tocan a este rol. Una entrega sin items para el rol no se
  // muestra: al staff no le sirve leer el encabezado de algo que es solo de
  // admin.
  const releases = useMemo(
    () =>
      WHATS_NEW.map((r) => ({
        ...r,
        items: r.items.filter((i) => i.roles.includes(role)),
      })).filter((r) => r.items.length > 0),
    [role]
  );

  const ultimo = releases[0];
  const controlado = open !== undefined;
  const visible = controlado ? open : autoVisible;

  // Sin ver = más nueva que la última marcada. Los ids son YYYY-MM-DD (con
  // sufijo -b si hubo dos el mismo día), así que comparar como string ordena
  // bien.
  const sinVer = useMemo(
    () => (seenId === undefined ? [] : releases.filter((r) => !seenId || r.id > seenId)),
    [releases, seenId]
  );

  useEffect(() => {
    // Sin usuario no hay nada que leer, pero NO dejamos `seenId` colgado en
    // `undefined`: el guard de abajo bloquearía el render y el botón de
    // "Novedades" de Ajustes no abriría nada.
    if (!userId) {
      setSeenId(null);
      return;
    }
    let cancelled = false;
    readWhatsNewSeen(userId).then((seen) => {
      if (cancelled) return;
      setSeenId(seen);
      // Misma definición de "sin ver" que usa `sinVer`. Comparar contra
      // `ultimo.id` con !== abría el modal sin nada nuevo cuando el id guardado
      // era MÁS nuevo que la última entrega visible para el rol — pasa de
      // verdad al degradar un ADMIN a STAFF, porque la última entrega es
      // ADMIN-only y el id guardado sobrevive al cambio de rol.
      if (!controlado && releases.some((r) => !seen || r.id > seen)) {
        setAutoVisible(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [controlado, userId, ultimo?.id]);

  // La instancia CONTROLADA (Ajustes/Más) y la automática (dashboard) coexisten
  // montadas: las tabs nativas no desmontan las pantallas. Cada una cachea su
  // propio `seenId` al montar, así que la de Ajustes no se entera de lo que
  // escribió la del dashboard y mostraría como "Nuevo" algo ya leído. Se relee
  // al abrirse.
  //
  // Solo en modo controlado: en el automático, `visible` cae a false al cerrar,
  // lo que re-dispararía la lectura antes de que el write async termine y el
  // modal se reabriría solo.
  useEffect(() => {
    if (!controlado || !open || !userId) return;
    let cancelled = false;
    readWhatsNewSeen(userId).then((seen) => {
      if (!cancelled) setSeenId(seen);
    });
    return () => {
      cancelled = true;
    };
  }, [controlado, open, userId]);

  // Qué queda abierto al mostrarse: lo que no has visto. Si ya viste todo
  // (entraste desde el botón de Ajustes), se abre la entrega más reciente para
  // que el modal nunca aparezca completamente plegado.
  useEffect(() => {
    if (!visible || seenId === undefined) return;
    setExpandidos(
      new Set(sinVer.length > 0 ? sinVer.map((r) => r.id) : ultimo ? [ultimo.id] : [])
    );
  }, [visible, seenId, sinVer.length, ultimo?.id]);

  if (!visible || releases.length === 0 || seenId === undefined) return null;

  const dismiss = () => {
    setAutoVisible(false);
    onClose?.();
    // Se marca con la MÁS reciente: todo lo anterior queda visto de una vez.
    // Nunca se retrocede el puntero: si el guardado ya era mayor (p.ej. venías
    // de ADMIN y ahora eres STAFF, que no ve la última entrega), se conserva.
    if (userId && ultimo) {
      const marca = seenId && seenId > ultimo.id ? seenId : ultimo.id;
      setSeenId(marca);
      writeWhatsNewSeen(userId, marca);
    }
  };

  const tryItem = (item: WhatsNewItem) => {
    dismiss();
    if (item.route) router.push(item.route as never);
  };

  const toggle = (id: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hayNuevas = sinVer.length > 0;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.sparkle}>✨</Text>
            <Text style={styles.title}>Novedades</Text>
            <Text style={styles.subtitle}>
              {hayNuevas
                ? "Esto es lo nuevo que ya puedes usar:"
                : "Todo lo que se ha ido agregando:"}
            </Text>
          </View>

          <ScrollView
            style={styles.itemsScroll}
            contentContainerStyle={styles.itemsContent}
            showsVerticalScrollIndicator={false}
          >
            {releases.map((release) => (
              <ReleaseSection
                key={release.id}
                release={release}
                abierto={expandidos.has(release.id)}
                esNuevo={sinVer.some((r) => r.id === release.id)}
                onToggle={() => toggle(release.id)}
                onTry={tryItem}
              />
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

/**
 * "12 ago 2026" a partir del id `YYYY-MM-DD` (con o sin sufijo `-b`).
 *
 * No hace falta numerar las entregas del mismo día: quien las distingue es el
 * tema de cada una, que va arriba de la fecha.
 */
export function fechaDeRelease(id: string): string {
  const d = new Date(`${id.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return id;
  // Medianoche LOCAL, no UTC: con `new Date("2026-08-12")` la fecha se pintaría
  // un día antes en Hermosillo.
  return d.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ReleaseSection({
  release,
  abierto,
  esNuevo,
  onToggle,
  onTry,
}: {
  release: WhatsNewRelease;
  abierto: boolean;
  esNuevo: boolean;
  onToggle: () => void;
  onTry: (item: WhatsNewItem) => void;
}) {
  const n = release.items.length;

  return (
    <View style={styles.release}>
      <TouchableOpacity
        style={styles.releaseHeader}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: abierto }}
        hitSlop={6}
      >
        <Ionicons
          name={abierto ? "chevron-down" : "chevron-forward"}
          size={16}
          color={COLORS.textTertiary}
        />
        {/* El TEMA manda y la fecha va debajo: una lista de puras fechas no
            deja encontrar nada, que es justo para lo que sirve el historial. */}
        <View style={styles.releaseTextGroup}>
          <Text style={styles.releaseTitulo} numberOfLines={2}>
            {release.title}
          </Text>
          <Text style={styles.releaseFecha}>
            {fechaDeRelease(release.id)} · {n} {n === 1 ? "novedad" : "novedades"}
          </Text>
        </View>
        {esNuevo && (
          <View style={styles.nuevoChip}>
            <Text style={styles.nuevoChipText}>Nuevo</Text>
          </View>
        )}
      </TouchableOpacity>

      {abierto && (
        <View style={styles.releaseItems}>
          {release.items.map((item) => (
            <View key={item.title} style={styles.item}>
              <View style={styles.itemIconWrap}>
                <Ionicons name={item.icon} size={20} color={COLORS.primary} />
              </View>
              <View style={styles.itemBody}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemText}>{item.body}</Text>
                {item.route && (
                  <TouchableOpacity
                    onPress={() => onTry(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={styles.itemTryLink}>Probarlo →</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
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
  itemsContent: { gap: 8, paddingVertical: 4 },
  // Entrega
  release: {
    borderTopWidth: 1,
    borderTopColor: COLORS.bgSection,
    paddingTop: 8,
  },
  releaseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
  releaseTextGroup: { flex: 1, gap: 1 },
  releaseTitulo: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  releaseFecha: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textTertiary,
  },
  nuevoChip: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  nuevoChipText: {
    fontSize: 10,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  releaseItems: { gap: 14, paddingTop: 6, paddingBottom: 6 },
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
