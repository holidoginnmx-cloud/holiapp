import { LegalDocScreen } from "@/components/LegalDocScreen";
import { Text, StyleSheet } from "react-native";
import { COLORS } from "@/constants/colors";

export default function VetAuthorizationScreen() {
  return (
    <LegalDocScreen
      documentType="VET_AUTH"
      title="Autorización veterinaria"
      subtitle="Carta responsiva en caso de emergencia médica durante la estancia."
      body={
        <>
          <Text style={styles.h2}>Objeto [REEMPLAZAR CON VERSIÓN REVISADA POR ABOGADO]</Text>
          <Text style={styles.p}>
            Al aceptar, autorizas expresamente a HolidogInn a tomar las medidas
            razonables para la salud de tu mascota durante su estancia, incluyendo
            el traslado a un médico veterinario en caso de emergencia.
          </Text>

          <Text style={styles.h2}>Alcance de la autorización</Text>
          <Text style={styles.p}>
            • HolidogInn intentará contactarte primero al teléfono registrado y a
            tu contacto de emergencia secundario.{"\n"}
            • Si no hay respuesta y la urgencia lo requiere, HolidogInn podrá
            trasladar a tu mascota al veterinario de cabecera registrado en el
            perfil, o al veterinario de emergencia más cercano si aquel no está
            disponible.{"\n"}
            • Autorizas procedimientos de estabilización y diagnóstico hasta un
            monto máximo que te comprometes a cubrir.
          </Text>

          <Text style={styles.h2}>Costo</Text>
          <Text style={styles.p}>
            Los honorarios del veterinario y medicamentos son a tu cargo. HolidogInn
            adelantará el pago en caso necesario y lo cobrará contra tu tarjeta en
            archivo o al check-out.
          </Text>

          <Text style={styles.h2}>Información que ya registraste en la app</Text>
          <Text style={styles.p}>
            • Veterinario de cabecera y teléfono.{"\n"}
            • Contacto de emergencia secundario.{"\n"}
            Verifica en el perfil de cada mascota que estos datos estén vigentes.
          </Text>

          <Text style={styles.h2}>Deslinde</Text>
          <Text style={styles.p}>
            HolidogInn aplicará criterio razonable. El cliente entiende que no
            puede haber garantías médicas y que actuar de buena fe en una
            emergencia es lo que autoriza este documento.
          </Text>

          <Text style={styles.foot}>
            [REEMPLAZAR TODO EL TEXTO ANTERIOR CON LA CARTA RESPONSIVA REDACTADA
            POR TU ABOGADO — DEBE INCLUIR MONTO MÁXIMO AUTORIZADO, DATOS DE
            IDENTIFICACIÓN DEL TITULAR Y FECHA DE ACEPTACIÓN]
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
