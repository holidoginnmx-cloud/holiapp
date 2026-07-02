import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAdminDiscountCodes,
  createAdminDiscountCode,
  updateAdminDiscountCode,
  deleteAdminDiscountCode,
  type AdminDiscountCode,
} from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

type TypeKey = "PERCENT" | "FIXED";

const EMPTY = {
  code: "",
  type: "PERCENT" as TypeKey,
  value: "",
  isActive: true,
};

export default function AdminDiscountCodes() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "discount-codes"],
    queryFn: getAdminDiscountCodes,
  });

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "discount-codes"] });

  function openNew() {
    setForm(EMPTY);
    setEditingId("new");
  }
  function openEdit(d: AdminDiscountCode) {
    setForm({
      code: d.code,
      type: d.type,
      value: String(d.value),
      isActive: d.isActive,
    });
    setEditingId(d.id);
  }
  function closeForm() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function handleSave() {
    const code = form.code.trim().toUpperCase();
    const value = Number(form.value);
    if (code.length < 2) {
      Alert.alert("Código", "El código debe tener al menos 2 caracteres.");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      Alert.alert("Valor", "El valor debe ser mayor a 0.");
      return;
    }
    if (form.type === "PERCENT" && value > 100) {
      Alert.alert("Valor", "Un porcentaje no puede ser mayor a 100.");
      return;
    }
    setSaving(true);
    try {
      if (editingId === "new") {
        await createAdminDiscountCode({
          code,
          type: form.type,
          value,
          isActive: form.isActive,
        });
      } else if (editingId) {
        await updateAdminDiscountCode(editingId, {
          code,
          type: form.type,
          value,
          isActive: form.isActive,
        });
      }
      invalidate();
      closeForm();
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(d: AdminDiscountCode) {
    try {
      await updateAdminDiscountCode(d.id, { isActive: !d.isActive });
      invalidate();
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "No se pudo actualizar");
    }
  }

  function confirmDelete(d: AdminDiscountCode) {
    Alert.alert("Eliminar código", `¿Eliminar "${d.code}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteAdminDiscountCode(d.id);
            invalidate();
          } catch (err) {
            Alert.alert("Error", err instanceof Error ? err.message : "No se pudo eliminar");
          }
        },
      },
    ]);
  }

  if (isError) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  const codes = data ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Crea códigos para compartir con clientes. Los de alcance “Reservas” o
        “Ambos” se pueden canjear al reservar hotel o baño en la app.
      </Text>

      {editingId ? (
        <View style={styles.card}>
          <Text style={styles.formTitle}>
            {editingId === "new" ? "Nuevo código" : "Editar código"}
          </Text>

          <Text style={styles.label}>Código</Text>
          <TextInput
            style={styles.input}
            value={form.code}
            onChangeText={(t) => setForm({ ...form, code: t })}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="VERANO15"
            placeholderTextColor={COLORS.textTertiary}
          />

          <Text style={styles.label}>Tipo</Text>
          <View style={styles.segmentRow}>
            {(["PERCENT", "FIXED"] as TypeKey[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.segment, form.type === t && styles.segmentOn]}
                onPress={() => setForm({ ...form, type: t })}
              >
                <Text style={[styles.segmentText, form.type === t && styles.segmentTextOn]}>
                  {t === "PERCENT" ? "% Porcentaje" : "$ Fijo"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>
            {form.type === "PERCENT" ? "Porcentaje (%)" : "Monto ($)"}
          </Text>
          <TextInput
            style={styles.input}
            value={form.value}
            onChangeText={(t) => setForm({ ...form, value: t })}
            keyboardType="decimal-pad"
            placeholder={form.type === "PERCENT" ? "15" : "100"}
            placeholderTextColor={COLORS.textTertiary}
          />

          <View style={[styles.rowBetween, { marginTop: 14 }]}>
            <Text style={styles.label}>Activo</Text>
            <Switch
              value={form.isActive}
              onValueChange={(v) => setForm({ ...form, isActive: v })}
              trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
              thumbColor={form.isActive ? COLORS.primary : COLORS.textDisabled}
            />
          </View>

          <View style={styles.formActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={closeForm} disabled={saving}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.saveBtnText}>
                  {editingId === "new" ? "Crear" : "Guardar"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.newBtn} onPress={openNew}>
          <Ionicons name="add" size={20} color={COLORS.white} />
          <Text style={styles.newBtnText}>Nuevo código</Text>
        </TouchableOpacity>
      )}

      {codes.length === 0 && !editingId && (
        <Text style={styles.empty}>Aún no hay códigos de descuento.</Text>
      )}

      {codes.map((d) => (
        <View key={d.id} style={styles.codeCard}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.codeHeader}>
              <Text style={styles.codeText}>{d.code}</Text>
              {!d.isActive && (
                <View style={styles.inactiveBadge}>
                  <Text style={styles.inactiveBadgeText}>Inactivo</Text>
                </View>
              )}
            </View>
            <Text style={styles.codeMeta}>
              {d.type === "PERCENT"
                ? `${d.value}% de descuento`
                : `${formatCurrency(d.value)} de descuento`}
              {d.usesCount > 0 ? ` · usado ${d.usesCount}×` : ""}
            </Text>
          </View>
          <Switch
            value={d.isActive}
            onValueChange={() => toggleActive(d)}
            trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
            thumbColor={d.isActive ? COLORS.primary : COLORS.textDisabled}
          />
          <TouchableOpacity onPress={() => openEdit(d)} style={styles.iconBtn}>
            <Ionicons name="create-outline" size={20} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => confirmDelete(d)} style={styles.iconBtn}>
            <Ionicons name="trash-outline" size={20} color={COLORS.errorText} />
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  intro: { fontSize: 13, color: COLORS.textTertiary, marginBottom: 12, lineHeight: 18 },
  card: { backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginBottom: 12 },
  formTitle: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary, marginBottom: 6 },
  label: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: COLORS.bgSection,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  segmentRow: { flexDirection: "row", gap: 8 },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    backgroundColor: COLORS.white,
  },
  segmentOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  segmentText: { fontSize: 13, fontWeight: "700", color: COLORS.textTertiary },
  segmentTextOn: { color: COLORS.primary },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  formActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: COLORS.bgSection,
  },
  cancelBtnText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 },
  saveBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: COLORS.primary,
  },
  saveBtnDisabled: { backgroundColor: COLORS.textDisabled },
  saveBtnText: { color: COLORS.white, fontWeight: "700", fontSize: 15 },
  newBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    paddingVertical: 13,
    borderRadius: 12,
    marginBottom: 14,
  },
  newBtnText: { color: COLORS.white, fontWeight: "700", fontSize: 15 },
  empty: { textAlign: "center", color: COLORS.textTertiary, marginTop: 24, fontSize: 14 },
  codeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  codeHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  codeText: { fontSize: 16, fontWeight: "800", color: COLORS.textPrimary },
  inactiveBadge: {
    backgroundColor: COLORS.bgSection,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  inactiveBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.textTertiary,
    letterSpacing: 0.3,
  },
  codeMeta: { fontSize: 12, color: COLORS.textTertiary, marginTop: 4 },
  iconBtn: { padding: 4 },
});
