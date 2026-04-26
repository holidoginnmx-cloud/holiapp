import { COLORS } from "@/constants/colors";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Share,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useClerk } from "@clerk/clerk-expo";
import { useAuthStore } from "@/store/authStore";
import { deleteMyAccount, exportMyData } from "@/lib/api";

export default function AccountScreen() {
  const router = useRouter();
  const { signOut } = useClerk();
  const logout = useAuthStore((s) => s.logout);
  const email = useAuthStore((s) => s.email);
  const firstName = useAuthStore((s) => s.firstName);
  const lastName = useAuthStore((s) => s.lastName);

  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  function confirmSignOut() {
    Alert.alert(
      "Cerrar sesión",
      "¿Quieres cerrar tu sesión? Tendrás que volver a iniciar sesión para acceder a tu cuenta.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Cerrar sesión", style: "destructive", onPress: runSignOut },
      ],
    );
  }

  async function runSignOut() {
    try {
      setSigningOut(true);
      await signOut();
      logout();
      router.replace("/(auth)/login");
    } catch (err) {
      setSigningOut(false);
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "No se pudo cerrar sesión.",
      );
    }
  }

  async function handleExport() {
    try {
      setExporting(true);
      const data = await exportMyData();
      const json = JSON.stringify(data, null, 2);
      await Share.share({
        title: "HolidogInn — mis datos",
        message: json,
      });
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "No se pudo exportar tus datos.",
      );
    } finally {
      setExporting(false);
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Eliminar cuenta",
      "Esta acción es permanente. Se eliminarán tus datos personales, mascotas y no podrás volver a iniciar sesión con esta cuenta. Los registros de pagos y reservaciones pasadas se conservan por obligación fiscal (5 años) pero se desvinculan de tu identidad.\n\n¿Deseas continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar cuenta",
          style: "destructive",
          onPress: runDelete,
        },
      ],
    );
  }

  async function runDelete() {
    try {
      setDeleting(true);
      await deleteMyAccount();
      await signOut();
      logout();
      router.replace("/(auth)/login");
    } catch (err) {
      setDeleting(false);
      const message =
        err instanceof Error ? err.message : "No se pudo eliminar tu cuenta.";
      if (message.includes("ACTIVE_RESERVATION")) {
        Alert.alert(
          "Tienes una reservación activa",
          "Debes cancelar tus reservaciones activas o próximas antes de poder eliminar tu cuenta.",
        );
      } else {
        Alert.alert("Error", message);
      }
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="account-screen"
    >
      <View style={styles.identityCard}>
        <Ionicons name="person-circle" size={48} color={COLORS.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>
            {firstName} {lastName}
          </Text>
          <Text style={styles.email}>{email}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Cuenta</Text>

      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push("/profile/edit" as any)}
        testID="account-edit-button"
      >
        <Ionicons name="person-outline" size={22} color={COLORS.textPrimary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Editar perfil</Text>
          <Text style={styles.rowSubtitle}>Nombre, apellido y teléfono.</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textDisabled} />
      </TouchableOpacity>

      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Privacidad y datos</Text>

      <TouchableOpacity
        style={styles.row}
        onPress={handleExport}
        disabled={exporting}
        testID="account-export-button"
      >
        <Ionicons name="download-outline" size={22} color={COLORS.textPrimary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Exportar mis datos</Text>
          <Text style={styles.rowSubtitle}>
            Descarga un archivo con toda tu información personal.
          </Text>
        </View>
        {exporting ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color={COLORS.textDisabled} />
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push("/legal/privacy")}
        testID="account-privacy-button"
      >
        <Ionicons name="shield-outline" size={22} color={COLORS.textPrimary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Aviso de privacidad</Text>
          <Text style={styles.rowSubtitle}>
            Cómo tratamos tus datos (LFPDPPP).
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textDisabled} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push("/legal/tos")}
        testID="account-tos-button"
      >
        <Ionicons name="document-text-outline" size={22} color={COLORS.textPrimary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Términos y condiciones</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textDisabled} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push("/help/refund-policy" as any)}
        testID="account-refund-policy-button"
      >
        <Ionicons name="cash-outline" size={22} color={COLORS.textPrimary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Política de reembolsos y cambios</Text>
          <Text style={styles.rowSubtitle}>
            Modificaciones, cancelaciones, saldo a favor y reembolsos.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.textDisabled} />
      </TouchableOpacity>

      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Sesión</Text>

      <TouchableOpacity
        style={styles.row}
        onPress={confirmSignOut}
        disabled={signingOut}
        testID="account-signout-button"
      >
        <Ionicons name="log-out-outline" size={22} color={COLORS.textPrimary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Cerrar sesión</Text>
          <Text style={styles.rowSubtitle}>
            Saldrás de tu cuenta en este dispositivo.
          </Text>
        </View>
        {signingOut ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color={COLORS.textDisabled} />
        )}
      </TouchableOpacity>

      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Zona peligrosa</Text>

      <TouchableOpacity
        style={[styles.row, styles.dangerRow]}
        onPress={confirmDelete}
        disabled={deleting}
        testID="account-delete-button"
      >
        <Ionicons name="trash-outline" size={22} color={COLORS.dangerText} />
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, { color: COLORS.dangerText }]}>
            Eliminar mi cuenta
          </Text>
          <Text style={styles.rowSubtitle}>
            Borra tus datos y cierra tu cuenta permanentemente.
          </Text>
        </View>
        {deleting ? (
          <ActivityIndicator color={COLORS.dangerText} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color={COLORS.dangerText} />
        )}
      </TouchableOpacity>
    </ScrollView>
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
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    gap: 12,
    marginBottom: 24,
  },
  name: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  email: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    gap: 12,
    marginBottom: 8,
  },
  dangerRow: {
    backgroundColor: COLORS.errorBgLight,
    borderWidth: 1,
    borderColor: COLORS.errorBorder,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  rowSubtitle: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
});
