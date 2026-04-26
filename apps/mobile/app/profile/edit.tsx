import { COLORS } from "@/constants/colors";
import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, updateMe } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function EditProfileScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const syncUser = useAuthStore((s) => s.syncUser);
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: getMe });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (me) {
      setFirstName(me.firstName ?? "");
      setLastName(me.lastName ?? "");
      setPhone(me.phone ?? "");
    }
  }, [me]);

  const dirty =
    me &&
    (firstName.trim() !== (me.firstName ?? "") ||
      lastName.trim() !== (me.lastName ?? "") ||
      phone.trim() !== (me.phone ?? ""));

  const canSave =
    !saving &&
    !!dirty &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0;

  async function handleSave() {
    if (!canSave || !me) return;
    setSaving(true);
    try {
      const payload: { firstName?: string; lastName?: string; phone?: string | null } = {};
      if (firstName.trim() !== (me.firstName ?? "")) payload.firstName = firstName.trim();
      if (lastName.trim() !== (me.lastName ?? "")) payload.lastName = lastName.trim();
      if (phone.trim() !== (me.phone ?? "")) {
        payload.phone = phone.trim().length > 0 ? phone.trim() : null;
      }
      await updateMe(payload);
      await qc.invalidateQueries({ queryKey: ["me"] });
      await syncUser();
      router.back();
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "No se pudo actualizar tu perfil.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        testID="edit-profile-screen"
      >
        <Text style={styles.label}>Nombre</Text>
        <TextInput
          style={styles.input}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Tu nombre"
          placeholderTextColor={COLORS.textDisabled}
          autoCapitalize="words"
          testID="edit-firstname-input"
        />

        <Text style={styles.label}>Apellido</Text>
        <TextInput
          style={styles.input}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Tu apellido"
          placeholderTextColor={COLORS.textDisabled}
          autoCapitalize="words"
          testID="edit-lastname-input"
        />

        <Text style={styles.label}>Teléfono</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="+52 662 ..."
          placeholderTextColor={COLORS.textDisabled}
          keyboardType="phone-pad"
          testID="edit-phone-input"
        />

        <Text style={styles.hint}>
          Para cambiar tu correo electrónico, contáctanos por WhatsApp.
        </Text>

        <TouchableOpacity
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={!canSave}
          activeOpacity={0.85}
          testID="edit-save-button"
        >
          {saving ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color={COLORS.white} />
              <Text style={styles.saveButtonText}>Guardar cambios</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bgPage,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 16,
    fontStyle: "italic",
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: "700",
  },
});
