import { COLORS } from "@/constants/colors";
import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { getChecklists, createDailyChecklist, getStaffStayById } from "@/lib/api";
import { uploadToCloudinary } from "@/lib/cloudinary";
import type { MoodLevel } from "@holidoginn/shared";

const MOOD_OPTIONS: { key: MoodLevel; emoji: string; label: string }[] = [
  { key: "SAD", emoji: "😢", label: "Triste" },
  { key: "NEUTRAL", emoji: "😐", label: "Neutral" },
  { key: "HAPPY", emoji: "😊", label: "Feliz" },
  { key: "EXCITED", emoji: "🤩", label: "Emocionado" },
];

export default function ChecklistForm() {
  const { reservationId } = useLocalSearchParams<{ reservationId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Form state — campos visibles
  const [mood, setMood] = useState<MoodLevel>("HAPPY");
  const [mealsCompleted, setMealsCompleted] = useState(true);
  const [walksCompleted, setWalksCompleted] = useState(true);
  const [bathroomBreaks, setBathroomBreaks] = useState(true);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [handoffNotes, setHandoffNotes] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const { data: stay } = useQuery({
    queryKey: ["staff", "stay", reservationId],
    queryFn: () => getStaffStayById(reservationId!),
    enabled: !!reservationId,
  });

  const { data: checklists, isLoading } = useQuery({
    queryKey: ["staff", "checklists", reservationId],
    queryFn: () => getChecklists(reservationId!),
    enabled: !!reservationId,
  });

  const todayStr = new Date().toDateString();
  const existing = checklists?.find(
    (c) => new Date(c.date).toDateString() === todayStr
  );

  useEffect(() => {
    if (existing) {
      setMood(existing.mood as MoodLevel);
      setMealsCompleted(existing.mealsCompleted);
      setWalksCompleted(existing.walksCompleted);
      setBathroomBreaks(existing.bathroomBreaks);
      const notes = existing.additionalNotes ?? "";
      const handoffMatch = notes.match(/\[HANDOFF\] ([\s\S]*)/);
      if (handoffMatch) {
        setAdditionalNotes(notes.replace(/\n?\[HANDOFF\] [\s\S]*/, ""));
        setHandoffNotes(handoffMatch[1]);
      } else {
        setAdditionalNotes(notes);
        setHandoffNotes("");
      }
    }
  }, [existing?.id]);

  async function pickPhoto(source: "camera" | "library") {
    if (source === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permiso requerido", "Necesitamos acceso a la cámara.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled) return;
      setPhotoUri(result.assets[0].uri);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tus fotos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled) return;
    setPhotoUri(result.assets[0].uri);
  }

  function promptPhoto() {
    Alert.alert("Foto del día", "¿Cómo quieres subir la foto?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Tomar foto", onPress: () => pickPhoto("camera") },
      { text: "Elegir foto", onPress: () => pickPhoto("library") },
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!photoUri) throw new Error("Falta la foto del día");
      const cloud = await uploadToCloudinary(photoUri, "checklists");
      // UTC midnight de la fecha LOCAL del staff. Así el server (en cualquier TZ)
      // y Postgres @db.Date guardan el día correcto sin shifts.
      const now = new Date();
      const localDayUTC = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
      );
      return createDailyChecklist({
        date: localDayUTC,
        // Defaults para los campos del schema que ya no se preguntan
        energy: "MEDIUM",
        socialization: "SOCIAL",
        rest: "GOOD",
        mood,
        mealsCompleted,
        mealsNotes: null,
        walksCompleted,
        bathroomBreaks,
        playtime: true,
        socializationDone: true,
        feedingNotes: null,
        behaviorNotes: null,
        additionalNotes:
          [
            additionalNotes,
            handoffNotes ? `[HANDOFF] ${handoffNotes}` : "",
          ]
            .filter(Boolean)
            .join("\n") || null,
        reservationId: reservationId!,
        mediaUrl: cloud.secure_url,
      });
    },
    onSuccess: async () => {
      // Refetch explícito (no sólo invalidate) — garantiza que el detalle
      // y la lista tengan la nueva foto antes de regresar.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["staff", "stay", reservationId] }),
        queryClient.refetchQueries({ queryKey: ["staff", "checklists", reservationId] }),
      ]);
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      Alert.alert("Reporte guardado", "Se notificó al dueño", [
        {
          text: "OK",
          onPress: () =>
            router.replace(`/(staff)/stay/${reservationId}` as any),
        },
      ]);
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const canSubmit = !!photoUri && !saveMutation.isPending;

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            Reporte diario — {stay?.pet.name ?? ""}
          </Text>
          <Text style={styles.subtitle}>
            {new Date().toLocaleDateString("es-MX", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </Text>
        </View>
      </View>

      {!existing && (
        <TouchableOpacity
          style={styles.normalDayButton}
          onPress={() => {
            setMood("HAPPY");
            setMealsCompleted(true);
            setWalksCompleted(true);
            setBathroomBreaks(true);
            Alert.alert("Listo", "Día normal aplicado. Sólo falta la foto.");
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="sunny-outline" size={18} color={COLORS.primary} />
          <Text style={styles.normalDayText}>Llenar como día normal</Text>
        </TouchableOpacity>
      )}

      {/* Mood */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>¿Cómo se siente hoy?</Text>
        <View style={styles.moodRow}>
          {MOOD_OPTIONS.map((opt) => {
            const active = mood === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.moodPill, active && styles.moodPillActive]}
                onPress={() => setMood(opt.key)}
                activeOpacity={0.7}
              >
                <Text style={styles.moodEmoji}>{opt.emoji}</Text>
                <Text
                  style={[
                    styles.moodLabel,
                    active && styles.moodLabelActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Checklist */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Necesidades básicas</Text>
        <ChecklistSwitch
          label="Comió"
          value={mealsCompleted}
          onValueChange={setMealsCompleted}
        />
        <ChecklistSwitch
          label="Paseó"
          value={walksCompleted}
          onValueChange={setWalksCompleted}
        />
        <ChecklistSwitch
          label="Sanitario"
          value={bathroomBreaks}
          onValueChange={setBathroomBreaks}
        />
      </View>

      {/* Notas */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notas del día</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Algo importante que el dueño deba saber (opcional)"
          placeholderTextColor={COLORS.textDisabled}
          value={additionalNotes}
          onChangeText={setAdditionalNotes}
          multiline
        />
      </View>

      {/* Handoff */}
      <View style={styles.card}>
        <View style={styles.handoffHeader}>
          <Ionicons name="swap-horizontal" size={18} color={COLORS.infoText} />
          <Text style={styles.cardTitle}>Notas para el siguiente turno</Text>
        </View>
        <TextInput
          style={styles.textArea}
          placeholder="Indicaciones internas (medicación, perros incompatibles…)"
          placeholderTextColor={COLORS.textDisabled}
          value={handoffNotes}
          onChangeText={setHandoffNotes}
          multiline
        />
      </View>

      {/* Photo */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Foto del día <Text style={styles.required}>*</Text>
        </Text>
        {photoUri ? (
          <View>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            <TouchableOpacity
              style={styles.photoChangeButton}
              onPress={promptPhoto}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={16} color={COLORS.primary} />
              <Text style={styles.photoChangeText}>Cambiar foto</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.photoButton}
            onPress={promptPhoto}
            activeOpacity={0.85}
          >
            <Ionicons name="camera" size={28} color={COLORS.primary} />
            <Text style={styles.photoButtonText}>Tomar o elegir foto</Text>
            <Text style={styles.photoHint}>
              El dueño la verá en su reservación
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitButton, !canSubmit && { opacity: 0.5 }]}
        onPress={() => saveMutation.mutate()}
        disabled={!canSubmit}
      >
        {saveMutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.white} />
            <Text style={styles.submitButtonText}>
              {existing ? "Actualizar reporte" : "Guardar reporte"}
            </Text>
          </>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function ChecklistSwitch({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: COLORS.borderLight, true: COLORS.reviewToggle }}
        thumbColor={value ? COLORS.primary : COLORS.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
    textTransform: "capitalize",
  },
  card: {
    backgroundColor: COLORS.white,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 14,
  },
  required: {
    color: COLORS.errorText,
  },
  moodRow: {
    flexDirection: "row",
    gap: 8,
  },
  moodPill: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.white,
    alignItems: "center",
    gap: 4,
  },
  moodPillActive: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  moodEmoji: {
    fontSize: 28,
  },
  moodLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  moodLabelActive: {
    color: COLORS.primary,
    fontWeight: "700",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  switchLabel: {
    fontSize: 15,
    color: COLORS.textPrimary,
    fontWeight: "600",
  },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    minHeight: 70,
    textAlignVertical: "top",
  },
  photoButton: {
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    gap: 6,
  },
  photoButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.primary,
    marginTop: 4,
  },
  photoHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  photoPreview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: COLORS.bgSection,
  },
  photoChangeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
  },
  photoChangeText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    marginHorizontal: 16,
    marginTop: 20,
    padding: 16,
    borderRadius: 14,
  },
  submitButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
  normalDayButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
  },
  normalDayText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
  },
  handoffHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
});
