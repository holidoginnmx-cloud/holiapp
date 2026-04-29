import { LegalDocScreen } from "@/components/LegalDocScreen";
import { Text, StyleSheet } from "react-native";
import { COLORS } from "@/constants/colors";

export default function TosScreen() {
  return (
    <LegalDocScreen
      documentType="TOS"
      title="Términos y condiciones"
      subtitle="Las reglas del servicio de hospedaje y estética canina HolidogInn."
      body={
        <>
          <Text style={styles.h2}>1. Objeto</Text>
          <Text style={styles.p}>
            HolidogInn presta servicios de hospedaje, cuidado y estética canina en sus
            instalaciones en Hermosillo, Sonora. Estos términos regulan la relación
            entre HolidogInn y el cliente (tú).
          </Text>

          <Text style={styles.h2}>2. Requisitos para reservar</Text>
          <Text style={styles.p}>
            El cliente declara que su mascota cuenta con vacunación vigente y que ha
            subido la cartilla al perfil correspondiente. Las mascotas con cartilla
            pendiente de revisión no pueden iniciar estancia.
          </Text>

          <Text style={styles.h2}>3. Pagos, depósitos y cancelación</Text>
          <Text style={styles.p}>
            Las tarifas se calculan según peso, duración y servicios adicionales. El
            cliente puede pagar el total o un anticipo del 20% si la estancia es de
            2+ noches y faltan 3+ días para el check-in. La política completa de
            cancelación y reembolsos está disponible en Mi cuenta.
          </Text>

          <Text style={styles.h2}>4. Comportamiento de la mascota</Text>
          <Text style={styles.p}>
            El cliente se obliga a declarar con honestidad el perfil conductual,
            alergias, medicación y condiciones de salud de la mascota. HolidogInn
            se reserva el derecho de no admitir o dar de alta anticipadamente a
            una mascota que represente riesgo para el resto.
          </Text>

          <Text style={styles.h2}>5. Limitación de responsabilidad</Text>
          <Text style={styles.p}>
            HolidogInn aplica protocolos de cuidado razonables. El cliente entiende
            que la convivencia entre animales implica un riesgo inherente que no
            puede eliminarse por completo.
          </Text>

          <Text style={styles.h2}>6. Vigencia y modificaciones</Text>
          <Text style={styles.p}>
            HolidogInn puede modificar estos términos. Los cambios materiales
            generan una nueva versión que el cliente deberá aceptar antes de
            reservar nuevamente.
          </Text>

          <Text style={styles.foot}>
            Última actualización: abril 2026. Versión preliminar. Jurisdicción
            aplicable: Hermosillo, Sonora, México.
          </Text>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  h2: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginTop: 14,
    marginBottom: 4,
  },
  p: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
  },
  foot: {
    marginTop: 20,
    fontSize: 12,
    color: "#92400E",
    fontStyle: "italic",
    fontWeight: "600",
  },
});
