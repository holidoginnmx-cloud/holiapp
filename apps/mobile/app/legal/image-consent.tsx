import { LegalDocScreen } from "@/components/LegalDocScreen";
import { Text, StyleSheet } from "react-native";
import { COLORS } from "@/constants/colors";

export default function ImageConsentScreen() {
  return (
    <LegalDocScreen
      documentType="IMAGE_USE"
      title="Consentimiento de uso de imagen"
      subtitle="Opcional — puedes reservar sin aceptar esto."
      acceptLabel="Doy mi consentimiento"
      showReject
      body={
        <>
          <Text style={styles.h2}>¿Por qué te lo pedimos? [REEMPLAZAR CON VERSIÓN REVISADA POR ABOGADO]</Text>
          <Text style={styles.p}>
            Durante la estancia tomamos fotos y videos para que los disfrutes
            en vivo. También nos gustaría (con tu permiso) publicar algunos en
            nuestra galería interna y redes sociales. Tu consentimiento es
            totalmente opcional — reservar no depende de esto.
          </Text>

          <Text style={styles.h2}>Qué autorizas al aceptar</Text>
          <Text style={styles.p}>
            • Uso de la imagen de tu mascota en las redes sociales de HolidogInn
            (Instagram, Facebook, TikTok).{"\n"}
            • Uso en materiales de marketing (folletos, sitio web, WhatsApp).{"\n"}
            • Uso en la galería pública de la app si la habilitamos en el futuro.
          </Text>

          <Text style={styles.h2}>Qué NO autorizas</Text>
          <Text style={styles.p}>
            • Venta de imágenes a terceros.{"\n"}
            • Publicación de datos personales tuyos (nombre, dirección, etc.).{"\n"}
            • Uso de imágenes de tu mascota fuera de los canales de HolidogInn.
          </Text>

          <Text style={styles.h2}>Puedes revocar en cualquier momento</Text>
          <Text style={styles.p}>
            Escríbenos a holidoginnmx@gmail.com y retiraremos las imágenes
            publicadas en un plazo máximo de 10 días hábiles.
          </Text>

          <Text style={styles.foot}>
            [REEMPLAZAR TODO EL TEXTO ANTERIOR CON EL CONSENTIMIENTO DE USO DE
            IMAGEN REDACTADO POR TU ABOGADO]
          </Text>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 16, fontWeight: "700", color: COLORS.textPrimary, marginTop: 14, marginBottom: 4 },
  p: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 22 },
  foot: { marginTop: 20, fontSize: 12, color: "#92400E", fontStyle: "italic", fontWeight: "600" },
});
