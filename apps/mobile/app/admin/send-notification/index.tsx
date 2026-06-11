import { COLORS } from "@/constants/colors";
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
  Keyboard,
  Platform,
  TouchableWithoutFeedback,
} from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getUsers, sendAdminNotification } from "@/lib/api";
import { formatName } from "@/lib/format";

type AudienceRole = "OWNER" | "STAFF" | "ADMIN";
const ROLE_OPTIONS: { key: AudienceRole; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "OWNER", label: "Clientes", icon: "people" },
  { key: "STAFF", label: "Staff", icon: "construct" },
  { key: "ADMIN", label: "Admins", icon: "shield-checkmark" },
];

export default function SendNotificationScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"audience" | "select">("audience");
  const [roles, setRoles] = useState<AudienceRole[]>(["OWNER"]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const toggleRole = (role: AudienceRole) =>
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );

  const { data: users } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });

  const owners = users?.filter((u) => u.role === "OWNER" && u.isActive) ?? [];
  const visibleOwners = (() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((u) =>
      `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase().includes(q),
    );
  })();

  const mutation = useMutation({
    mutationFn: sendAdminNotification,
    onSuccess: (data) => {
      Keyboard.dismiss();
      Alert.alert(
        "Enviada",
        `${data.pushed} recibieron push (tienen la app) de ${data.sent} destinatario${data.sent !== 1 ? "s" : ""}.`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    },
    onError: (err: Error) => {
      Keyboard.dismiss();
      Alert.alert("Error", err.message ?? "No se pudo enviar la notificacion");
    },
  });

  const handleSend = () => {
    Keyboard.dismiss();
    if (!title.trim()) {
      Alert.alert("Error", "Ingresa un titulo");
      return;
    }
    if (!body.trim()) {
      Alert.alert("Error", "Ingresa un mensaje");
      return;
    }
    if (mode === "select" && !selectedUserId) {
      Alert.alert("Error", "Selecciona un usuario");
      return;
    }
    if (mode === "audience" && roles.length === 0) {
      Alert.alert("Error", "Selecciona al menos un grupo");
      return;
    }

    const payload =
      mode === "audience"
        ? { roles }
        : { userIds: [selectedUserId!] };
    const targetLabel =
      mode === "audience"
        ? roles
            .map((r) => ROLE_OPTIONS.find((o) => o.key === r)?.label ?? r)
            .join(", ")
        : owners.find((u) => u.id === selectedUserId)?.firstName ?? "el usuario";

    Alert.alert(
      "Confirmar envio",
      `¿Enviar notificacion a ${targetLabel}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Enviar",
          onPress: () =>
            mutation.mutate({ ...payload, title: title.trim(), body: body.trim() }),
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
      <Text style={styles.title}>Enviar notificacion</Text>

      {/* Mode selector */}
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeButton, mode === "audience" && styles.modeButtonActive]}
          onPress={() => {
            setMode("audience");
            setSelectedUserId(null);
          }}
        >
          <Ionicons
            name="people"
            size={18}
            color={mode === "audience" ? COLORS.white : COLORS.textTertiary}
          />
          <Text
            style={[
              styles.modeText,
              mode === "audience" && styles.modeTextActive,
            ]}
          >
            Por grupo
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.modeButton,
            mode === "select" && styles.modeButtonActive,
          ]}
          onPress={() => setMode("select")}
        >
          <Ionicons
            name="person"
            size={18}
            color={mode === "select" ? COLORS.white : COLORS.textTertiary}
          />
          <Text
            style={[
              styles.modeText,
              mode === "select" && styles.modeTextActive,
            ]}
          >
            Seleccionar
          </Text>
        </TouchableOpacity>
      </View>

      {/* Audience role chips */}
      {mode === "audience" && (
        <View style={styles.roleChipsRow}>
          {ROLE_OPTIONS.map((opt) => {
            const on = roles.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.roleChip, on && styles.roleChipOn]}
                onPress={() => toggleRole(opt.key)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={opt.icon}
                  size={15}
                  color={on ? COLORS.white : COLORS.textTertiary}
                />
                <Text style={[styles.roleChipText, on && styles.roleChipTextOn]}>
                  {opt.label}
                </Text>
                {on && (
                  <Ionicons name="checkmark" size={14} color={COLORS.white} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* User selector */}
      {mode === "select" && (
        <>
          <View style={styles.clientSearchWrap}>
            <Ionicons name="search" size={18} color={COLORS.textTertiary} />
            <TextInput
              style={styles.clientSearchInput}
              placeholder="Buscar cliente por nombre"
              placeholderTextColor={COLORS.textDisabled}
              value={clientSearch}
              onChangeText={setClientSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {clientSearch.length > 0 && (
              <TouchableOpacity onPress={() => setClientSearch("")} hitSlop={8}>
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={COLORS.textDisabled}
                />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.userList}>
            {visibleOwners.map((user) => {
            const isSelected = selectedUserId === user.id;
            return (
              <TouchableOpacity
                key={user.id}
                style={[
                  styles.userItem,
                  isSelected && styles.userItemSelected,
                ]}
                onPress={() => setSelectedUserId(user.id)}
              >
                <Text
                  style={[
                    styles.userItemText,
                    isSelected && styles.userItemTextSelected,
                  ]}
                >
                  {formatName(user.firstName)} {formatName(user.lastName)}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark" size={18} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            );
          })}
            {visibleOwners.length === 0 && (
              <Text style={styles.emptyText}>
                {owners.length === 0
                  ? "No hay clientes activos"
                  : "Sin resultados para tu búsqueda"}
              </Text>
            )}
          </View>
        </>
      )}

      {/* Message fields */}
      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Titulo</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej: Recordatorio de vacunas"
            placeholderTextColor={COLORS.textDisabled}
            value={title}
            onChangeText={setTitle}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Mensaje</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Escribe el mensaje..."
            placeholderTextColor={COLORS.textDisabled}
            value={body}
            onChangeText={setBody}
            multiline
            numberOfLines={4}
          />
        </View>

        <TouchableOpacity
          style={[styles.sendButton, mutation.isPending && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={mutation.isPending}
          activeOpacity={0.8}
        >
          {mutation.isPending ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="send" size={18} color={COLORS.white} />
              <Text style={styles.sendButtonText}>Enviar</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 12,
  },
  backText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: "600",
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 20,
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  roleChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: COLORS.bgSection,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  roleChipOn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  roleChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textTertiary,
  },
  roleChipTextOn: {
    color: COLORS.white,
  },
  modeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.bgSection,
  },
  modeButtonActive: {
    backgroundColor: COLORS.primary,
  },
  modeText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  modeTextActive: {
    color: COLORS.white,
  },
  clientSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  clientSearchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    padding: 0,
  },
  userList: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    marginBottom: 16,
    overflow: "hidden",
  },
  userItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgSection,
  },
  userItemSelected: {
    backgroundColor: COLORS.primaryLight,
  },
  userItemText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  userItemTextSelected: {
    color: COLORS.primary,
    fontWeight: "600",
  },
  emptyText: {
    padding: 16,
    textAlign: "center",
    color: COLORS.textDisabled,
    fontSize: 14,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  multiline: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 8,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
});
