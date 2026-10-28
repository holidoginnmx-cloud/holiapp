import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { getUsers, setUserEmail } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import { displayEmail, formatFullName, formatName } from "@/lib/format";
import { alertaDeError } from "@/lib/errorAlert";

/**
 * Asignar el correo de un cliente que todavía no usa la app. El cliente se lo
 * pasa al equipo por WhatsApp; con el correo en su ficha, cuando se registra en
 * la app con ESE correo la ficha se le vincula sola (mascotas, historial y
 * saldo), sin pasar por "¿Ya eres cliente?".
 */
export default function AdminClientEmail() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  // La lista ya está en caché: viene de la pestaña Clientes.
  const { data: users, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });
  const cliente = users?.find((u) => u.id === userId);
  const actual = displayEmail(cliente?.email);

  const [email, setEmail] = useState<string | null>(null);
  const valor = email ?? actual;
  const limpio = valor.trim().toLowerCase();
  const pareceValido = /^\S+@\S+\.\S+$/.test(limpio);
  const cambio = limpio !== actual.toLowerCase();

  const mutation = useMutation({
    mutationFn: () => setUserEmail(userId!, limpio),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "pets"] });
      Alert.alert(
        "Correo guardado",
        `Cuando ${formatName(cliente?.firstName) || "el cliente"} se registre en la app con ${limpio}, verá a sus mascotas sin hacer nada más.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    },
    onError: (e: Error) => {
      // El cliente ya se registró por su cuenta con ese correo: son dos
      // registros de la misma persona y lo que procede es juntarlos.
      if (e instanceof ApiError && e.code === "CORREO_OCUPADO" && e.body?.ocupante?.tieneApp) {
        Alert.alert("Ese correo ya tiene cuenta", e.message, [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Juntar fichas",
            onPress: () => router.replace(`/admin/pets/merge-owner?ownerId=${userId}` as any),
          },
        ]);
        return;
      }
      alertaDeError(e, { titulo: "No se pudo guardar" });
    },
  });

  if (isLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!cliente) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.introText}>No encontramos a este cliente.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.name}>
          {formatFullName(cliente.firstName, cliente.lastName)}
        </Text>

        <View style={styles.introCard}>
          <Ionicons name="mail" size={20} color={COLORS.primary} />
          <Text style={styles.introText}>
            Escribe el correo que te pasó el cliente. Cuando se registre en la
            app con ese mismo correo, verá a sus mascotas y su historial
            automáticamente.
          </Text>
        </View>

        <Text style={styles.label}>Correo</Text>
        <TextInput
          style={[styles.input, limpio.length > 0 && !pareceValido && styles.inputError]}
          placeholder="cliente@correo.com"
          placeholderTextColor={COLORS.textDisabled}
          value={valor}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="done"
          testID="client-email-input"
        />
        {limpio.length > 0 && !pareceValido ? (
          <Text style={styles.fieldError}>Ese correo no se ve válido.</Text>
        ) : (
          <Text style={styles.fieldHint}>
            Revísalo con el cliente: tiene que ser exactamente el que va a usar
            para registrarse.
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.submitBtn,
            (!pareceValido || !cambio || mutation.isPending) && styles.submitBtnDisabled,
          ]}
          onPress={() => mutation.mutate()}
          disabled={!pareceValido || !cambio || mutation.isPending}
          activeOpacity={0.8}
          testID="client-email-submit"
        >
          {mutation.isPending ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color={COLORS.white} />
              <Text style={styles.submitBtnText}>Guardar correo</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  name: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  introCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
  },
  introText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  inputError: {
    borderColor: COLORS.errorText,
  },
  fieldError: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.errorText,
    marginTop: -6,
    marginBottom: 12,
  },
  fieldHint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: -6,
    marginBottom: 12,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});
