import { COLORS } from "@/constants/colors";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

function Section({
  icon,
  title,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>
          <Ionicons name={icon} size={18} color={COLORS.primary} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

function Strong({ children }: { children: React.ReactNode }) {
  return <Text style={styles.strong}>{children}</Text>;
}

export default function RefundPolicyScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        En HolidogInn buscamos darte máxima flexibilidad sin comprometer la
        calidad del servicio. Aquí encuentras todo sobre cambios, cancelaciones
        y reembolsos.
      </Text>

      <Section icon="calendar-outline" title="Modificación de fechas">
        <P>
          Puedes modificar las fechas de tu reservación desde el detalle ("Modificar fechas") cuando está en estado{" "}
          <Strong>Pendiente</Strong>, <Strong>Confirmada</Strong> o{" "}
          <Strong>Activa</Strong> (durante la estancia).
        </P>
        <Bullet>
          La fecha de entrada no se puede cambiar una vez que hiciste check-in.
        </Bullet>
        <Bullet>
          No se puede recortar a una fecha anterior al día actual si ya estás en estancia.
        </Bullet>
      </Section>

      <Section icon="arrow-forward-circle-outline" title="Extender la estadía">
        <Bullet>
          Requiere <Strong>aprobación del administrador</Strong> porque depende de la disponibilidad del cuarto.
        </Bullet>
        <Bullet>
          Al aprobarse, queda un saldo pendiente por los días agregados. Lo pagas con tu tarjeta desde el detalle de la reservación usando el botón "Liquidar saldo".
        </Bullet>
        <Bullet>
          No aplica el recargo por reserva de último día al cobrar la diferencia.
        </Bullet>
      </Section>

      <Section icon="arrow-back-circle-outline" title="Recortar la estadía">
        <Bullet>
          Se aplica <Strong>de inmediato</Strong>, sin necesidad de aprobación.
        </Bullet>
        <P>Eliges cómo recibir la diferencia:</P>
        <Bullet>
          <Strong>Reembolso a tarjeta</Strong> — 5 a 10 días hábiles. Solo disponible si el pago original fue con tarjeta.
        </Bullet>
        <Bullet>
          <Strong>Saldo a favor</Strong> — se aplica automáticamente en tu próxima reservación.
        </Bullet>
      </Section>

      <Section icon="close-circle-outline" title="Cancelación total">
        <P>
          Puedes cancelar una reservación en estado <Strong>Pendiente</Strong> o <Strong>Confirmada</Strong> desde el detalle. No se requiere aprobación.
        </P>
        <Bullet>Se te reembolsa el monto total pagado.</Bullet>
        <Bullet>
          Eliges entre reembolso a tarjeta o saldo a favor, igual que en los recortes.
        </Bullet>
        <Bullet>
          No se pueden cancelar reservaciones que ya hicieron check-in; para esos casos recorta la estadía.
        </Bullet>
      </Section>

      <Section icon="wallet-outline" title="Saldo a favor">
        <P>
          Tu saldo a favor se acumula cuando eliges esa opción en un recorte o cancelación.
        </P>
        <Bullet>
          Siempre visible en el header (ícono de wallet con el monto) cuando es mayor a $0.
        </Bullet>
        <Bullet>
          Se aplica <Strong>automáticamente</Strong> al crear una nueva reservación: verás el total original tachado y el precio con el descuento.
        </Bullet>
        <Bullet>
          Si el saldo cubre el total, no se cobra nada a tu tarjeta.
        </Bullet>
        <Bullet>
          Puedes consultar el historial completo tocando el indicador de saldo.
        </Bullet>
      </Section>

      <Section icon="time-outline" title="Reservación con anticipo (20%)">
        <P>Si elegiste anticipo:</P>
        <Bullet>
          Debes liquidar el saldo restante <Strong>al menos 48 horas antes</Strong> del check-in.
        </Bullet>
        <Bullet>
          Si no liquidas a tiempo, la reservación se cancela automáticamente y pierdes el anticipo.
        </Bullet>
        <Bullet>
          Las modificaciones de fechas requieren tener el saldo liquidado al 100%.
        </Bullet>
        <Bullet>
          El anticipo <Strong>no está disponible</Strong> en estancias de una sola noche ni con menos de 3 días de anticipación al check-in.
        </Bullet>
      </Section>

      <Section icon="cash-outline" title="Pagos en efectivo o transferencia">
        <P>
          Si tu reservación se pagó en efectivo o transferencia (no por tarjeta), los reembolsos se acreditan <Strong>siempre como saldo a favor</Strong> en tu cuenta. No es posible reembolsar a una tarjeta que no se usó.
        </P>
      </Section>

      <Section icon="chatbubbles-outline" title="Contacto">
        <P>
          Si tienes dudas sobre tu caso específico, escríbenos por WhatsApp desde la pantalla de inicio. Estamos para ayudarte.
        </P>
      </Section>

      <Text style={styles.footer}>
        Esta política puede actualizarse sin previo aviso. Última revisión: abril 2026.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 32 },
  lead: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 21,
    marginBottom: 20,
  },
  section: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.reviewBg,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textPrimary,
  },
  sectionBody: { gap: 6 },
  paragraph: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 4,
  },
  bulletDot: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "800",
    lineHeight: 20,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  strong: {
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  footer: {
    fontSize: 12,
    color: COLORS.textDisabled,
    textAlign: "center",
    marginTop: 16,
    fontStyle: "italic",
  },
});
