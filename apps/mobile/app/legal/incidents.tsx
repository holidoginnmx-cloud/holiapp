import { LegalDocScreen } from "@/components/LegalDocScreen";
import { Text, StyleSheet } from "react-native";
import { COLORS } from "@/constants/colors";

export default function IncidentPolicyScreen() {
  return (
    <LegalDocScreen
      documentType="INCIDENT_POLICY"
      title="Política de incidentes"
      subtitle="Cómo actuamos si algo le sucede a tu mascota durante la estancia."
      body={
        <>
          <Text style={styles.p}>
            En HolidogInn tu mascota es parte de la familia HDI. Cuidamos con
            estructura, rutina, comunicación constante y evidencia. Aun así,
            convivir con animales implica riesgos que no podemos eliminar por
            completo. Esta política te explica cómo actuamos ante un incidente
            y cuál es el alcance de nuestra responsabilidad.
          </Text>

          <Text style={styles.h2}>1. Qué consideramos un incidente</Text>
          <Text style={styles.p}>
            Un incidente es cualquier situación que afecte la salud, seguridad
            o bienestar de la mascota durante su estancia, incluyendo:
          </Text>
          <Text style={styles.li}>• Lesiones (heridas, golpes, raspones, cojera).</Text>
          <Text style={styles.li}>
            • Enfermedad o síntomas (vómito, diarrea, falta de apetito, fiebre,
            apatía).
          </Text>
          <Text style={styles.li}>• Reacciones alérgicas o respiratorias.</Text>
          <Text style={styles.li}>• Peleas o fricciones con otras mascotas.</Text>
          <Text style={styles.li}>• Daños materiales causados por la mascota.</Text>
          <Text style={styles.li}>• Fuga o intento de fuga.</Text>
          <Text style={styles.li}>• Cualquier emergencia veterinaria.</Text>

          <Text style={styles.h2}>2. Cómo actuamos ante un incidente</Text>
          <Text style={styles.p}>
            Nuestro protocolo es el mismo siempre, sin importar la gravedad:
          </Text>
          <Text style={styles.li}>
            <Text style={styles.b}>1. Atención inmediata.</Text> El staff activa
            el protocolo de primeros auxilios y aísla a la mascota si es
            necesario.
          </Text>
          <Text style={styles.li}>
            <Text style={styles.b}>2. Notificación al dueño.</Text> Te
            contactamos por WhatsApp o llamada dentro de los primeros 30 minutos.
            Si no respondes, escalamos al segundo contacto registrado en tu
            perfil.
          </Text>
          <Text style={styles.li}>
            <Text style={styles.b}>3. Documentación.</Text> Tomamos fotos/video
            del incidente y registramos la hora, el staff involucrado y las
            acciones tomadas.
          </Text>
          <Text style={styles.li}>
            <Text style={styles.b}>4. Decisión médica.</Text> Si el incidente
            requiere atención veterinaria, acudimos al veterinario que indicaste
            en tu autorización médica. Si no especificaste, acudimos a nuestro
            veterinario de cabecera.
          </Text>
          <Text style={styles.li}>
            <Text style={styles.b}>5. Reporte final.</Text> Al finalizar la
            estancia recibes un reporte con lo ocurrido, las acciones tomadas,
            la evidencia recolectada y, si aplica, el expediente veterinario.
          </Text>

          <Text style={styles.h2}>3. Costos veterinarios</Text>
          <Text style={styles.p}>
            Los costos de atención veterinaria derivados de un incidente son
            responsabilidad del dueño, salvo que el incidente haya ocurrido por
            negligencia demostrable del staff de HolidogInn.
          </Text>
          <Text style={styles.p}>
            HolidogInn puede adelantar el pago al veterinario para garantizar
            atención inmediata; el monto se reembolsa antes del check-out. Tu
            autorización de atención veterinaria firmada al crear la cuenta nos
            permite actuar sin demora ante una emergencia.
          </Text>

          <Text style={styles.h2}>4. Condiciones preexistentes</Text>
          <Text style={styles.p}>
            Como dueño, te comprometes a declarar al momento del check-in
            cualquier condición preexistente relevante (enfermedades crónicas,
            medicamentos, alergias, historial quirúrgico, ansiedad severa).
            HolidogInn no es responsable por complicaciones derivadas de
            condiciones no declaradas.
          </Text>

          <Text style={styles.h2}>5. Convivencia con otras mascotas</Text>
          <Text style={styles.p}>
            Antes de permitir interacción con otros perros evaluamos
            temperamento con base en la información que proporcionaste y la
            observación del staff. Si identificamos riesgo (dominancia,
            agresividad, miedo severo), mantenemos a la mascota en convivencia
            individual. Pequeños roces (gruñidos, marcaje) son parte natural
            de la convivencia canina y no se consideran incidentes reportables
            salvo que resulten en lesión.
          </Text>

          <Text style={styles.h2}>6. Daños materiales</Text>
          <Text style={styles.p}>
            Si tu mascota causa daños al mobiliario, juguetes o áreas comunes,
            el costo de reparación o reposición se cobra al dueño al momento
            del check-out, previa evidencia fotográfica y cotización.
          </Text>

          <Text style={styles.h2}>7. Límites de responsabilidad</Text>
          <Text style={styles.p}>HolidogInn no es responsable por:</Text>
          <Text style={styles.li}>
            • Empeoramiento de condiciones médicas preexistentes no declaradas.
          </Text>
          <Text style={styles.li}>
            • Reacciones idiosincráticas de la mascota a alimentos, olores o
            estímulos fuera del control razonable del staff.
          </Text>
          <Text style={styles.li}>
            • Pérdida, rotura o deterioro de objetos personales traídos por el
            dueño (collares con piedras, ropa, juguetes sentimentales).
          </Text>
          <Text style={styles.li}>
            • Decisiones veterinarias tomadas por el profesional tratante.
          </Text>

          <Text style={styles.p}>HolidogInn sí es responsable por:</Text>
          <Text style={styles.li}>
            • Negligencia demostrable del staff (ej. olvido de administrar
            medicamento indicado, descuido en el manejo que cause lesión
            directa).
          </Text>
          <Text style={styles.li}>
            • Pérdida o fuga atribuible a fallas operativas del hotel.
          </Text>

          <Text style={styles.h2}>8. Contacto ante incidentes</Text>
          <Text style={styles.p}>
            Para emergencias o dudas posteriores a la estancia relacionadas con
            el servicio, contáctanos por los canales de atención de HolidogInn
            dentro de las 48 horas siguientes al check-out.
          </Text>

          <Text style={styles.h2}>9. Aceptación</Text>
          <Text style={styles.p}>
            Al aceptar esta política, confirmas que leíste y entiendes las
            condiciones bajo las cuales HolidogInn cuida a tu mascota,
            incluyendo el protocolo de respuesta, la responsabilidad sobre
            costos veterinarios y los límites de responsabilidad descritos.
          </Text>

          <Text style={styles.foot}>
            Última actualización: abril 2026. Para reportar un incidente o
            consultar su seguimiento, escríbenos a holidoginnmx@gmail.com.
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
    marginBottom: 4,
  },
  li: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginLeft: 8,
    marginBottom: 2,
  },
  b: {
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  foot: {
    marginTop: 20,
    fontSize: 12,
    color: "#92400E",
    fontStyle: "italic",
    fontWeight: "600",
  },
});
