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
import { getUsers, updateUser } from "@/lib/api";
import { formatFullName } from "@/lib/format";
import { alertaDeError } from "@/lib/errorAlert";

/**
 * Corregir el nombre de un cliente. Quien se registra por su cuenta en el
 * sitio queda con el nombre que sale de su correo («albert_azuar»), y antes
 * solo se podía arreglar desde el panel web.
 */
export default function AdminClientName() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useLocalSearchParams<{ userId: string }>();

  // La lista ya está en caché: viene de la pestaña Clientes.
  const { data: users, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: getUsers,
  });
  const cliente = users?.find((u) => u.id === userId);
  // "—" es el apellido de relleno de las fichas viejas: no se le enseña a nadie.
  const apellidoActual = cliente?.lastName?.trim() === "—" ? "" : (cliente?.lastName ?? "");

  const [nombre, setNombre] = useState<string | null>(null);
  const [apellido, setApellido] = useState<string | null>(null);
  const nombreLimpio = (nombre ?? cliente?.firstName ?? "").trim();
  const apellidoLimpio = (apellido ?? apellidoActual).trim();
  const cambio =
    nombreLimpio !== (cliente?.firstName ?? "").trim() ||
    apellidoLimpio !== apellidoActual.trim();
  // El API exige apellido de al menos una letra si viaja: vacío no se manda y
  // se queda el que tenía.
  const puedeGuardar = nombreLimpio.length > 0 && cambio;

  const mutation = useMutation({
    mutationFn: () =>
      updateUser(userId!, {
        firstName: nombreLimpio,
        ...(apellidoLimpio ? { lastName: apellidoLimpio } : {}),
      }),
    onSuccess: () => {
      // Clientes arma sus tarjetas desde la lista de mascotas (con su dueño).
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "pets"] });
      Alert.alert("Nombre guardado", formatFullName(nombreLimpio, apellidoLimpio), [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (e: Error) => alertaDeError(e, { titulo: "No se pudo guardar" }),
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
          <Ionicons name="person" size={20} color={COLORS.primary} />
          <Text style={styles.introText}>
            Así lo verá el equipo en reservas, cobros y avisos. Su correo y su
            acceso a la app no cambian.
          </Text>
        </View>

        <Text style={styles.label}>Nombre</Text>
        <TextInput
          style={[styles.input, nombreLimpio.length === 0 && styles.inputError]}
          placeholder="Nombre"
          placeholderTextColor={COLORS.textDisabled}
          value={nombre ?? cliente.firstName ?? ""}
          onChangeText={setNombre}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
          returnKeyType="next"
          testID="client-name-first"
        />
        {nombreLimpio.length === 0 && (
          <Text style={styles.fieldError}>El nombre no puede quedar vacío.</Text>
        )}

        <Text style={styles.label}>Apellidos</Text>
        <TextInput
          style={styles.input}
          placeholder="Apellidos"
          placeholderTextColor={COLORS.textDisabled}
          value={apellido ?? apellidoActual}
          onChangeText={setApellido}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          testID="client-name-last"
        />

        <TouchableOpacity
          style={[
            styles.submitBtn,
            (!puedeGuardar || mutation.isPending) && styles.submitBtnDisabled,
          ]}
          onPress={() => mutation.mutate()}
          disabled={!puedeGuardar || mutation.isPending}
          activeOpacity={0.8}
          testID="client-name-submit"
        >
          {mutation.isPending ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color={COLORS.white} />
              <Text style={styles.submitBtnText}>Guardar nombre</Text>
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
