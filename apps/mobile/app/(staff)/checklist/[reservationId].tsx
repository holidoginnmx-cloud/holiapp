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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getChecklists, createDailyChecklist, getStaffStayById } from "@/lib/api";
import { LevelSelector } from "@/components/LevelSelector";
import type { EnergyLevel, SocializationLevel, RestQuality, MoodLevel } from "@holidoginn/shared";

const ENERGY_OPTIONS = [
  { key: "LOW", label: "Baja" },
  { key: "MEDIUM", label: "Media" },
  { key: "HIGH", label: "Alta" },
];

const SOCIALIZATION_OPTIONS = [
  { key: "ISOLATED", label: "Aislado" },
  { key: "SELECTIVE", label: "Selectivo" },
  { key: "SOCIAL", label: "Social" },
];

const REST_OPTIONS = [
  { key: "POOR", label: "Malo" },
  { key: "FAIR", label: "Regular" },
  { key: "GOOD", label: "Bueno" },
];

const MOOD_OPTIONS = [
  { key: "SAD", label: "Triste" },
  { key: "NEUTRAL", label: "Neutral" },
  { key: "HAPPY", label: "Feliz" },
  { key: "EXCITED", label: "Emocionado" },
];

const FEEDING_TEMPLATES = [
  "Comió todo su alimento sin problema",
  "Comió la mitad de su porción",
  "No quiso comer",
  "Se le cambió el alimento por indicación",
];

const BEHAVIOR_TEMPLATES = [
  "Se adaptó bien, sin signos de estrés",
  "Mostró ansiedad leve al inicio",
  "Muy sociable con los demás perros",
  "Prefiere estar solo, se pone nervioso en grupo",
];

export default function ChecklistForm() {
  const { reservationId } = useLocalSearchParams<{ reservationId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Form state
  const [energy, setEnergy] = useState<EnergyLevel>("MEDIUM");
  const [socialization, setSocialization] = useState<SocializationLevel>("SOCIAL");
  const [rest, setRest] = useState<RestQuality>("GOOD");
  const [mood, setMood] = useState<MoodLevel>("HAPPY");
  const [mealsCompleted, setMealsCompleted] = useState(true);
  const [mealsNotes, setMealsNotes] = useState("");
  const [walksCompleted, setWalksCompleted] = useState(true);
  const [bathroomBreaks, setBathroomBreaks] = useState(true);
  const [playtime, setPlaytime] = useState(true);
  const [socializationDone, setSocializationDone] = useState(true);
  const [feedingNotes, setFeedingNotes] = useState("");
  const [behaviorNotes, setBehaviorNotes] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [handoffNotes, setHandoffNotes] = useState("");

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

  // Pre-populate if today's checklist exists
  const todayStr = new Date().toDateString();
  const existing = checklists?.find(
    (c) => new Date(c.date).toDateString() === todayStr
  );

  useEffect(() => {
    if (existing) {
      setEnergy(existing.energy as EnergyLevel);
      setSocialization(existing.socialization as SocializationLevel);
      setRest(existing.rest as RestQuality);
      setMood(existing.mood as MoodLevel);
      setMealsCompleted(existing.mealsCompleted);
      setMealsNotes(existing.mealsNotes ?? "");
      setWalksCompleted(existing.walksCompleted);
      setBathroomBreaks(existing.bathroomBreaks);
      setPlaytime(existing.playtime);
      setSocializationDone(existing.socializationDone);
      setFeedingNotes(existing.feedingNotes ?? "");
      setBehaviorNotes(existing.behaviorNotes ?? "");
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

  const saveMutation = useMutation({
    mutationFn: () =>
      createDailyChecklist({
        date: new Date(),
        energy,
        socialization,
        rest,
        mood,
        mealsCompleted,
        mealsNotes: mealsNotes || null,
        walksCompleted,
        bathroomBreaks,
        playtime,
        socializationDone,
        feedingNotes: feedingNotes || null,
        behaviorNotes: behaviorNotes || null,
        additionalNotes: [additionalNotes, handoffNotes ? `[HANDOFF] ${handoffNotes}` : ""].filter(Boolean).join("\n") || null,
        reservationId: reservationId!,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      Alert.alert("Reporte guardado", "Se notificó al dueño", [
        { text: "OK", onPress: () => router.back() },
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

      {/* Quick fill — "Normal day" template */}
      {!existing && (
        <TouchableOpacity
          style={styles.normalDayButton}
          onPress={() => {
            setEnergy("HIGH");
            setSocialization("SOCIAL");
            setRest("GOOD");
            setMood("HAPPY");
            setMealsCompleted(true);
            setWalksCompleted(true);
            setBathroomBreaks(true);
            setPlaytime(true);
            setSocializationDone(true);
            setFeedingNotes("Comió todo su alimento sin problema");
            setBehaviorNotes("Se adaptó bien, sin signos de estrés");
            setAdditionalNotes("");
            Alert.alert("Listo", "Formulario llenado con valores de día normal. Revisa y ajusta si es necesario.");
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="sunny-outline" size={18} color={COLORS.primary} />
          <Text style={styles.normalDayText}>Llenar como día normal</Text>
        </TouchableOpacity>
      )}

      {/* Daily Report Section */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Reporte del día</Text>

        <LevelSelector
          label="Energía"
          options={ENERGY_OPTIONS}
          selected={energy}
          onSelect={(k) => setEnergy(k as EnergyLevel)}
        />
        <LevelSelector
          label="Socialización"
          options={SOCIALIZATION_OPTIONS}
          selected={socialization}
          onSelect={(k) => setSocialization(k as SocializationLevel)}
        />
        <LevelSelector
          label="Descanso"
          options={REST_OPTIONS}
          selected={rest}
          onSelect={(k) => setRest(k as RestQuality)}
        />
        <LevelSelector
          label="Estado de ánimo"
          options={MOOD_OPTIONS}
          selected={mood}
          onSelect={(k) => setMood(k as MoodLevel)}
        />
      </View>

      {/* Checklist Section */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Checklist</Text>

        <ChecklistSwitch
          label="Comidas completadas"
          value={mealsCompleted}
          onValueChange={setMealsCompleted}
        />
        {mealsCompleted && (
          <TextInput
            style={styles.inlineInput}
            placeholder="Notas de comida (opcional)"
            placeholderTextColor={COLORS.textDisabled}
            value={mealsNotes}
            onChangeText={setMealsNotes}
          />
        )}
        <ChecklistSwitch
          label="Paseos realizados"
          value={walksCompleted}
          onValueChange={setWalksCompleted}
        />
        <ChecklistSwitch
          label="Necesidades fisiológicas"
          value={bathroomBreaks}
          onValueChange={setBathroomBreaks}
        />
        <ChecklistSwitch
          label="Tiempo de juego"
          value={playtime}
          onValueChange={setPlaytime}
        />
        <ChecklistSwitch
          label="Socialización con otros perros"
          value={socializationDone}
          onValueChange={setSocializationDone}
        />
      </View>

      {/* Observations */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Observaciones</Text>

        <Text style={styles.inputLabel}>Alimentación</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Notas sobre alimentación..."
          placeholderTextColor={COLORS.textDisabled}
          value={feedingNotes}
          onChangeText={setFeedingNotes}
          multiline
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.templateScroll}>
          {FEEDING_TEMPLATES.map((t) => (
            <TouchableOpacity
              key={t}
              style={styles.templateChip}
              onPress={() => setFeedingNotes(t)}
            >
              <Text style={styles.templateChipText}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.inputLabel, { marginTop: 16 }]}>Comportamiento</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Notas sobre comportamiento..."
          placeholderTextColor={COLORS.textDisabled}
          value={behaviorNotes}
          onChangeText={setBehaviorNotes}
          multiline
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.templateScroll}>
          {BEHAVIOR_TEMPLATES.map((t) => (
            <TouchableOpacity
              key={t}
              style={styles.templateChip}
              onPress={() => setBehaviorNotes(t)}
            >
              <Text style={styles.templateChipText}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.inputLabel, { marginTop: 16 }]}>Notas adicionales</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Cualquier otra observación..."
          placeholderTextColor={COLORS.textDisabled}
          value={additionalNotes}
          onChangeText={setAdditionalNotes}
          multiline
        />
      </View>

      {/* Handoff notes — for next shift */}
      <View style={styles.card}>
        <View style={styles.handoffHeader}>
          <Ionicons name="swap-horizontal" size={18} color={COLORS.infoText} />
          <Text style={styles.cardTitle}>Notas para el siguiente turno</Text>
        </View>
        <TextInput
          style={styles.textArea}
          placeholder="Indicaciones para el staff del siguiente turno (ej: darle medicamento a las 8pm, no juntar con perro del cuarto 3...)"
          placeholderTextColor={COLORS.textDisabled}
          value={handoffNotes}
          onChangeText={setHandoffNotes}
          multiline
        />
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitButton, saveMutation.isPending && { opacity: 0.6 }]}
        onPress={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
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
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  switchLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
  inlineInput: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.textPrimary,
    minHeight: 60,
    textAlignVertical: "top",
  },
  templateScroll: {
    marginTop: 8,
  },
  templateChip: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  templateChipText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: "500",
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
