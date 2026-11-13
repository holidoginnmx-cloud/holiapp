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
import { getUsers, updateUser, setUserEmail } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import {
  displayEmail,
  formatFullName,
  formatPhoneInput,
  phoneNationalDigits,
} from "@/lib/format";
import { alertaDeError } from "@/lib/errorAlert";

/**
 * Editar la ficha de un cliente: nombre, teléfono y correo en un solo lugar.
 * Antes eran dos pantallas (nombre / correo) y el teléfono no se podía
 * corregir — y es el dato que más se equivoca: quien escribe por WhatsApp
 * muchas veces no es el dueño (nov-2026).
 *
 * Nombre y teléfono van por PATCH /users/:id (que rebota un teléfono que ya
 * es de otra ficha); el correo por PATCH /users/:id/email, con sus reglas
 * (minúsculas, sin pisar cuentas de la app, «Juntar fichas» si ya existe).
 */
export default function AdminClientEdit() {
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
  const telefonoActual = phoneNationalDigits(cliente?.phone);
  // Hay fichas viejas con números de fuera («001…») o incompletos: ésos se
  // enseñan tal cual. Reformatearlos como +52 los truncaría al guardar.
  const digitosCrudos = (cliente?.phone ?? "").replace(/\D/g, "");
  const telefonoNacional =
    digitosCrudos.length === 10 ||
    (digitosCrudos.length === 12 && digitosCrudos.startsWith("52"));
  const telefonoInicial = telefonoNacional
    ? formatPhoneInput(telefonoActual)
    : (cliente?.phone ?? "");
  const correoActual = displayEmail(cliente?.email);
  // Quien ya usa la app entra con su correo: ése no se toca desde aquí.
  const tieneApp = !!cliente?.hasApp;

  const [nombre, setNombre] = useState<string | null>(null);
  const [apellido, setApellido] = useState<string | null>(null);
  const [telefono, setTelefono] = useState<string | null>(null);
  const [correo, setCorreo] = useState<string | null>(null);

  const nombreLimpio = (nombre ?? cliente?.firstName ?? "").trim();
  const apellidoLimpio = (apellido ?? apellidoActual).trim();
  const telefonoDigitos = telefono == null ? telefonoActual : phoneNationalDigits(telefono);
  // Solo cuenta como cambio si se tocó el campo: así un teléfono viejo raro no
  // bloquea corregir el nombre.
  const cambioTelefono = telefono != null && telefono !== telefonoInicial;
  const correoLimpio = (correo ?? correoActual).trim().toLowerCase();

  const cambioNombre =
    nombreLimpio !== (cliente?.firstName ?? "").trim() ||
    apellidoLimpio !== apellidoActual.trim();
  const cambioCorreo = !tieneApp && correoLimpio !== correoActual.toLowerCase();

  const telefonoValido =
    !cambioTelefono || telefonoDigitos.length === 0 || telefonoDigitos.length === 10;
  const correoValido = correoLimpio.length === 0 || /^\S+@\S+\.\S+$/.test(correoLimpio);
  // Un correo no se "borra": la ficha siempre tiene uno (el provisional si no
  // hay real), y el API no acepta vacío.
  const correoBorrado = cambioCorreo && correoLimpio.length === 0;

  const puedeGuardar =
    nombreLimpio.length > 0 &&
    telefonoValido &&
    correoValido &&
    !correoBorrado &&
    (cambioNombre || cambioTelefono || cambioCorreo);

  const mutation = useMutation({
    mutationFn: async () => {
      if (cambioNombre || cambioTelefono) {
        await updateUser(userId!, {
          ...(cambioNombre
            ? {
                firstName: nombreLimpio,
                // El API exige apellido de al menos una letra: sin apellido
                // va el relleno "—" (el mismo del alta), que no se enseña.
                lastName: apellidoLimpio || "—",
              }
            : {}),
          ...(cambioTelefono
            ? { phone: telefonoDigitos ? formatPhoneInput(telefonoDigitos) : null }
            : {}),
        });
      }
      if (cambioCorreo) {
        try {
          await setUserEmail(userId!, correoLimpio);
        } catch (e) {
          // Lo de arriba ya quedó guardado: que la lista lo refleje aunque el
          // correo falle.
          if (cambioNombre || cambioTelefono) {
            queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
          }
          throw e;
        }
      }
    },
    onSuccess: () => {
      // Clientes arma sus tarjetas desde la lista de mascotas (con su dueño).
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "pets"] });
      Alert.alert(
        "Cliente guardado",
        formatFullName(nombreLimpio, apellidoLimpio),
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

        <Text style={styles.label}>Nombre</Text>
        <TextInput
          style={[styles.input, nombreLimpio.length === 0 && styles.inputError]}
          placeholder="Nombre"
          placeholderTextColor={COLORS.textDisabled}
          value={nombre ?? cliente.firstName ?? ""}
          onChangeText={setNombre}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          testID="client-edit-first"
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
          returnKeyType="next"
          testID="client-edit-last"
        />

        <Text style={styles.label}>Teléfono del dueño</Text>
        <TextInput
          style={[styles.input, !telefonoValido && styles.inputError]}
          placeholder="(662) 123-4567"
          placeholderTextColor={COLORS.textDisabled}
          value={telefono ?? telefonoInicial}
          onChangeText={(t) => setTelefono(formatPhoneInput(t))}
          keyboardType="phone-pad"
          testID="client-edit-phone"
        />
        {!telefonoValido ? (
          <Text style={styles.fieldError}>El teléfono debe tener 10 dígitos.</Text>
        ) : (
          <Text style={styles.fieldHint}>
            Pon el número del dueño, aunque te escriba otra persona: a este
            número le llega el código para vincular su cuenta en la app.
          </Text>
        )}

        <Text style={styles.label}>Correo</Text>
        <TextInput
          style={[
            styles.input,
            tieneApp && styles.readOnly,
            (!correoValido || correoBorrado) && styles.inputError,
          ]}
          placeholder="cliente@correo.com"
          placeholderTextColor={COLORS.textDisabled}
          value={tieneApp ? correoActual : (correo ?? correoActual)}
          onChangeText={setCorreo}
          editable={!tieneApp}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          testID="client-edit-email"
        />
        {tieneApp ? (
          <Text style={styles.fieldHint}>
            Ya usa la app y entra con este correo: no se cambia desde aquí.
          </Text>
        ) : correoBorrado ? (
          <Text style={styles.fieldError}>El correo no se puede dejar vacío.</Text>
        ) : !correoValido ? (
          <Text style={styles.fieldError}>Ese correo no se ve válido.</Text>
        ) : (
          <Text style={styles.fieldHint}>
            Si se registra en la app con este mismo correo, verá a sus mascotas
            automáticamente.
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.submitBtn,
            (!puedeGuardar || mutation.isPending) && styles.submitBtnDisabled,
          ]}
          onPress={() => mutation.mutate()}
          disabled={!puedeGuardar || mutation.isPending}
          activeOpacity={0.8}
          testID="client-edit-submit"
        >
          {mutation.isPending ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color={COLORS.white} />
              <Text style={styles.submitBtnText}>Guardar</Text>
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
  readOnly: {
    backgroundColor: COLORS.bgPage,
    color: COLORS.textTertiary,
  },
  submitBtnText: {
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.white,
  },
});
