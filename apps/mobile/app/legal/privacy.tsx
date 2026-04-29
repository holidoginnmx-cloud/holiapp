import { LegalDocScreen } from "@/components/LegalDocScreen";
import { Text, StyleSheet } from "react-native";
import { COLORS } from "@/constants/colors";

export default function PrivacyScreen() {
  return (
    <LegalDocScreen
      documentType="PRIVACY"
      title="Aviso de privacidad"
      subtitle="LFPDPPP — Ley Federal de Protección de Datos Personales en Posesión de los Particulares."
      body={
        <>
          <Text style={styles.h2}>1. Responsable</Text>
          <Text style={styles.p}>
            HolidogInn, con domicilio en Hermosillo, Sonora, es responsable del
            tratamiento de tus datos personales. Para dudas sobre privacidad escribe
            a holidoginnmx@gmail.com.
          </Text>

          <Text style={styles.h2}>2. Datos que recabamos</Text>
          <Text style={styles.p}>
            Recabamos nombre, correo, teléfono, datos de tu(s) mascota(s) (nombre,
            raza, peso, salud, vacunas), y datos de tarjeta (procesados por
            nuestros proveedores de pago, no almacenados por nosotros).
          </Text>

          <Text style={styles.h2}>3. Finalidades</Text>
          <Text style={styles.p}>
            • Gestionar reservaciones y la estancia de tu mascota.{"\n"}
            • Procesar pagos y emitir comprobantes.{"\n"}
            • Comunicarte actualizaciones de la estancia.{"\n"}
            • Cumplir obligaciones legales y fiscales.{"\n"}
            • Finalidades secundarias (opcionales, puedes negarte): enviar
            promociones y mejorar el servicio con analítica agregada.
          </Text>

          <Text style={styles.h2}>4. Transferencias a terceros</Text>
          <Text style={styles.p}>
            Tus datos pueden ser transferidos a: Clerk (autenticación), Stripe
            (procesamiento de pagos), Cloudinary (almacenamiento de imágenes),
            Expo (envío de push notifications) y Resend (correo transaccional).
            Todos con políticas de privacidad compatibles con la LFPDPPP.
          </Text>

          <Text style={styles.h2}>5. Derechos ARCO</Text>
          <Text style={styles.p}>
            Puedes ejercer tus derechos de Acceso, Rectificación, Cancelación y
            Oposición escribiendo a holidoginnmx@gmail.com. Responderemos en un
            plazo máximo de 20 días hábiles.
          </Text>

          <Text style={styles.h2}>6. Retención</Text>
          <Text style={styles.p}>
            Conservamos tus datos mientras tengas cuenta activa y hasta 5 años
            después por obligaciones fiscales. Luego se anonimizan o eliminan.
          </Text>

          <Text style={styles.h2}>7. Cambios al aviso</Text>
          <Text style={styles.p}>
            Te notificaremos cualquier cambio material en la app y por correo.
            Deberás aceptar la nueva versión antes de seguir usando el servicio.
          </Text>

          <Text style={styles.foot}>
            Última actualización: abril 2026. Versión preliminar. Para dudas
            específicas sobre el tratamiento de tus datos, escribe a
            holidoginnmx@gmail.com.
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
