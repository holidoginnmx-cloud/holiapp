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
  FlatList,
} from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getUsers, sendAdminNotification } from "@/lib/api";

export default function SendNotificationScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"all" | "select">("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const { data: users } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });

  const owners = users?.filter((u) => u.role === "OWNER" && u.isActive) ?? [];

  const mutation = useMutation({
    mutationFn: sendAdminNotification,
    onSuccess: (data) => {
      Alert.alert(
        "Enviada",
        `Notificacion enviada a ${data.sent} usuario${data.sent !== 1 ? "s" : ""}`,
        [{ text: "OK", onPress: () => router.back() }]
      );
    },
    onError: (err: Error) => {
      Alert.alert("Error", err.message);
    },
  });

  const handleSend = () => {
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

    const userIds = mode === "all" ? ("all" as const) : [selectedUserId!];
    const targetLabel =
      mode === "all"
        ? "todos los clientes"
        : owners.find((u) => u.id === selectedUserId)?.firstName ?? "el usuario";

    Alert.alert(
      "Confirmar envio",
      `¿Enviar notificacion a ${targetLabel}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Enviar",
          onPress: () =>
            mutation.mutate({ userIds, title: title.trim(), body: body.trim() }),
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Enviar notificacion</Text>

      {/* Mode selector */}
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeButton, mode === "all" && styles.modeButtonActive]}
          onPress={() => {
            setMode("all");
            setSelectedUserId(null);
          }}
        >
          <Ionicons
            name="people"
            size={18}
            color={mode === "all" ? COLORS.white : COLORS.textTertiary}
          />
          <Text
            style={[
              styles.modeText,
              mode === "all" && styles.modeTextActive,
            ]}
          >
            Todos los clientes
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

      {/* User selector */}
      {mode === "select" && (
        <View style={styles.userList}>
          {owners.map((user) => {
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
                  {user.firstName} {user.lastName}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark" size={18} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            );
          })}
          {owners.length === 0 && (
            <Text style={styles.emptyText}>No hay clientes activos</Text>
          )}
        </View>
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
  userList: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    marginBottom: 16,
    maxHeight: 200,
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
