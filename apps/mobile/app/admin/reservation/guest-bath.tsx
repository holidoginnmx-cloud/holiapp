import { COLORS } from "@/constants/colors";
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTimeField } from "@/components/DateTimeField";
import { SwitchRow } from "@/components/SwitchRow";
import { LevelSelector } from "@/components/LevelSelector";
import { ImagePickerButton } from "@/components/ImagePickerButton";
import { KeyboardDoneBar, KEYBOARD_DONE_ID } from "@/components/KeyboardDoneBar";
import {
  getBathVariants,
  getBathSlots,
  createWalkInBath,
  registerManualPayment,
  type WalkInBathBody,
  type WalkInOwnerCandidate,
} from "@/lib/api";
import { formatWeekdayDayShort, formatTime, formatPhoneInput } from "@/lib/format";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import { alertaDeError } from "@/lib/errorAlert";
import { ApiError } from "@/lib/api/client";
import {
  useBathConflict,
  localDayKey,
  formatDurationMin,
} from "@/hooks/useBathConflict";
import { SIZE_RANGES_KG, sizeRangeLabel, bathSizeKey } from "@holidoginn/shared/src/pricing";

/**
 * BAÑO DE INVITADO — el perro ya está en recepción y no sabemos de quién es.
 *
 * Tocaron el timbre, pidieron un baño y lo aceptamos. No hay expediente y no
 * hay tiempo de llenarlo con el perro en la correa: hasta ahora eso significaba
 * abandonar la captura, y con ella el ingreso.
 *
 * Es una pantalla APARTE de `create.tsx` a propósito. Aquélla tiene 1745 líneas
 * y trece gates colgados de `petIds.length > 0`; meterle un modo invitado serían
 * veinte puntos de regresión en la pantalla que captura todos los ingresos. Y
 * quien usa ésta es recepción, con prisa y una mano: aquí no hay un solo campo
 * que no aplique, y se llena de arriba abajo sin decidir nada.
 *
 * Diferencias deliberadas con `create.tsx`:
 *  · El botón SÍ se deshabilita, y dice qué falta. Allá nunca se bloquea y todo
 *    se descubre con un Alert DESPUÉS de tocarlo.
 *  · La fecha arranca en "ahora": el perro ya está aquí, no se está apartando
 *    nada para la semana que entra.
 *  · Se pide la talla. Ver el comentario de TALLAS más abajo.
 */

const TALLAS = ["S", "M", "L", "XL"] as const;
type Talla = (typeof TALLAS)[number];

const NOMBRE_TALLA: Record<Talla, string> = {
  S: "Chico",
  M: "Mediano",
  L: "Grande",
  XL: "Extra grande",
};

/** Ahora, redondeado al siguiente múltiplo de 15 min. */
function ahoraRedondeado(): Date {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

const soloDigitos = (s: string) => s.replace(/\D/g, "");

export default function AdminGuestBath() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [petName, setPetName] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [size, setSize] = useState<Talla | "">("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [appointmentAt, setAppointmentAt] = useState<Date>(ahoraRedondeado());
  const [deslanado, setDeslanado] = useState(false);
  const [corte, setCorte] = useState(false);
  const [forceSchedule, setForceSchedule] = useState(false);
  const [totalOverride, setTotalOverride] = useState("");
  const [cobro, setCobro] = useState("");
  const [metodo, setMetodo] = useState<"CASH" | "TRANSFER">("CASH");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: bathVariants } = useQuery({
    queryKey: ["admin", "bath-variants"],
    queryFn: getBathVariants,
  });

  // Precio de la variante de ESTA talla. Se pinta en la pastilla para que
  // recepción esté eligiendo lo que va a cobrar, no una etiqueta abstracta.
  const precioDeTalla = (t: Talla): number | null =>
    bathVariants?.find(
      (v) => bathSizeKey(v.petSize) === t && v.deslanado === deslanado && v.corte === corte,
    )?.price ?? null;

  const bathEstimate = size ? precioDeTalla(size) : null;

  // Conflicto de agenda SIN una mascota real: `GET /baths/slots` acepta petSize
  // en vez de petId, así que la duración sale de la variante y no del respaldo
  // genérico de 60 min. queryKey propia para no cruzar caché con create.tsx.
  const dayKey = localDayKey(appointmentAt);
  const { data: bathSlots } = useQuery({
    queryKey: ["admin", "bath-slots-walkin", dayKey, size, deslanado, corte],
    queryFn: () => getBathSlots(dayKey, { petSize: size || undefined, deslanado, corte }),
    enabled: !!size,
  });
  const bathConflict = useBathConflict(bathSlots, appointmentAt);

  // Qué falta, en el orden en que se llena la pantalla. El botón lo dice en voz
  // alta en vez de esperar a que lo toquen para reclamar.
  const faltantes = useMemo(() => {
    const f: string[] = [];
    if (petName.trim().length < 2) f.push("el nombre del perrito");
    if (!size) f.push("la talla");
    if (ownerName.trim().length < 2) f.push("el nombre del cliente");
    if (soloDigitos(phone).length !== 10) f.push("el teléfono (10 dígitos)");
    if (bathConflict && !forceSchedule) f.push("resolver el horario");
    // Sin variante Y sin precio a mano no hay nada que cobrar. A diferencia de
    // create.tsx, aquí basta con escribir el total: el perro ya está enfrente y
    // el precio se pacta de viva voz.
    if (bathEstimate == null && !totalOverride.trim()) f.push("el total a cobrar");
    return f;
  }, [petName, size, ownerName, phone, bathConflict, forceSchedule, bathEstimate, totalOverride]);

  const canSubmit = faltantes.length === 0 && !submitting;

  const totalNum = totalOverride.trim() ? Number(totalOverride) : null;
  const cobroNum = cobro.trim() ? Number(cobro) : null;

  const armarBody = (extra: Partial<WalkInBathBody> = {}): WalkInBathBody => ({
    owner: { name: ownerName.trim(), phone: soloDigitos(phone) },
    pet: {
      name: petName.trim(),
      size: size as Talla,
      ...(photoUrl ? { photoUrl } : {}),
    },
    appointmentAt: appointmentAt.toISOString(),
    deslanado,
    corte,
    ...(notes.trim() ? { internalNotes: notes.trim() } : {}),
    // `>= 0` y no `> 0`: un 0 es como se captura una cortesía.
    ...(totalNum != null && Number.isFinite(totalNum) && totalNum >= 0
      ? { totalAmountOverride: totalNum }
      : {}),
    ...(forceSchedule ? { scheduleOverride: true } : {}),
    ...extra,
  });

  /**
   * Manda la petición y, si el servidor pregunta algo, lo consulta y reintenta
   * con la respuesta. El reintento es explícito a propósito: sin él, el segundo
   * POST no se distinguiría de un doble-tap y nadie podría decir "no, es otra
   * persona".
   *
   * `resueltos` lleva QUÉ preguntas ya se contestaron, y no un simple "ya
   * reintenté": el servidor revisa al perro sólo DESPUÉS de que se confirmó al
   * dueño, así que un cliente que vuelve con el mismo perro genera dos
   * preguntas seguidas. Con un solo flag, la segunda moría en el alert
   * genérico — y ése es justamente el caso más común.
   */
  async function enviar(
    extra: Partial<WalkInBathBody> = {},
    resueltos: ReadonlySet<string> = new Set(),
  ) {
    setSubmitting(true);
    try {
      const res = await createWalkInBath(armarBody(extra));

      // A partir de aquí la reserva YA EXISTE. Si el cobro truena, esto no puede
      // salir por el catch: el operador vería "no se pudo registrar", volvería a
      // mandar, y el segundo intento chocaría contra el 409 de duplicado con una
      // reserva ya creada a sus espaldas. Se avisa y se sigue.
      const avisoCobro: string[] = [];
      if (cobroNum != null && Number.isFinite(cobroNum) && cobroNum > 0) {
        try {
          // Sin reparto proporcional: un invitado es siempre UNA reserva.
          await registerManualPayment({
            reservationId: res.reservation.id,
            amount: cobroNum,
            method: metodo,
          });
        } catch {
          avisoCobro.push(
            "El baño quedó registrado, pero NO se pudo guardar el cobro. Regístralo desde el detalle.",
          );
        }
      }

      invalidateReservationScope(queryClient, res.reservation.id);
      // Sin esto, el invitado que se acaba de crear NO aparece al buscarlo 30
      // segundos después (la lista de create.tsx se deriva de getAllPets) y se
      // captura dos veces.
      queryClient.invalidateQueries({ queryKey: ["admin", "all-pets"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "pets"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["staff", "baths"] });

      const avisos = [...res.warnings, ...res.agendaWarnings, ...avisoCobro];
      Alert.alert(
        "Baño registrado",
        [
          `${res.pet.name} · ${formatTime(appointmentAt)}`,
          `Total $${res.pricing.amount}`,
          res.owner.created ? null : `Se usó la ficha que ya existía de ${res.owner.name}.`,
          res.pet.created ? null : "Se agendó con la ficha del perro que ya existía.",
          ...avisos,
        ]
          .filter(Boolean)
          .join("\n"),
        [
          { text: "Ver el baño", onPress: () => router.replace(`/admin/reservation/${res.reservation.id}`) },
          { text: "Listo", style: "cancel", onPress: () => router.back() },
        ],
      );
      return;
    } catch (err) {
      const api = err instanceof ApiError ? err : null;
      const body = (api?.body ?? {}) as Record<string, unknown>;

      const yaPreguntado = (code: string) => resueltos.has(code);
      const conRespuesta = (code: string) => new Set([...resueltos, code]);

      if (api?.code === "WALKIN_PHONE_EXISTS" && !yaPreguntado(api.code)) {
        const candidatos = (body.candidates ?? []) as WalkInOwnerCandidate[];
        const c = candidatos[0];
        const perros = c?.pets?.map((p) => p.name).join(", ");
        Alert.alert(
          "Ese teléfono ya es de un cliente",
          `${c?.name ?? "Alguien"} ya está registrado con ese número${perros ? ` (${perros})` : ""}. ¿Es la misma persona?`,
          [
            { text: "Cancelar", style: "cancel" },
            {
              text: "Es otra persona",
              onPress: () =>
                void enviar(
                  { ...extra, forceNewOwner: true },
                  conRespuesta("WALKIN_PHONE_EXISTS"),
                ),
            },
            {
              text: "Sí, es la misma",
              onPress: () =>
                void enviar(
                  { ...extra, confirmReuseOwnerId: c.id },
                  conRespuesta("WALKIN_PHONE_EXISTS"),
                ),
            },
          ],
        );
        return;
      }

      if (api?.code === "WALKIN_PET_EXISTS" && !yaPreguntado(api.code)) {
        const p = body.pet as { id: string; name: string } | undefined;
        Alert.alert(
          "Ese cliente ya tiene un perro así",
          `Ya existe una ficha de ${p?.name ?? petName.trim()}. Úsala para no partir su historial en dos.`,
          [
            { text: "Cancelar", style: "cancel" },
            {
              text: "Usar la que existe",
              onPress: () =>
                void enviar(
                  { ...extra, confirmReusePetId: p!.id },
                  conRespuesta("WALKIN_PET_EXISTS"),
                ),
            },
          ],
        );
        return;
      }

      if (api?.code === "AGENDA_CONFLICT" && !yaPreguntado(api.code)) {
        Alert.alert("Ese horario se encima", api.message, [
          { text: "Cambiar la hora", style: "cancel" },
          {
            text: "Agendar de todos modos",
            onPress: () => {
              setForceSchedule(true);
              void enviar(
                { ...extra, scheduleOverride: true },
                conRespuesta("AGENDA_CONFLICT"),
              );
            },
          },
        ]);
        return;
      }

      alertaDeError(err, { titulo: "No se pudo registrar", respaldo: "Error desconocido" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.introCard}>
          <Ionicons name="information-circle-outline" size={18} color={COLORS.primary} />
          <Text style={styles.introText}>
            Para un perro que llegó sin cita y no está en la base. Se guarda lo
            mínimo; el expediente se completa después.
          </Text>
        </View>

        <Text style={styles.label}>Nombre del perrito</Text>
        <TextInput
          style={styles.input}
          value={petName}
          onChangeText={setPetName}
          placeholder="Camila"
          placeholderTextColor={COLORS.textTertiary}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
        />

        <View style={styles.fotoRow}>
          <ImagePickerButton
            imageUrl={photoUrl}
            onImageUploaded={setPhotoUrl}
            folder="pets"
            size={84}
            icon="camera-outline"
            label="Foto (opcional)"
          />
          <Text style={styles.fotoHint}>
            Para reconocerlo cuando lo entreguen. Si no se puede, no pasa nada.
          </Text>
        </View>

        {/*
          La talla se pide, y no es burocracia: de ella salen el precio Y cuánto
          se le aparta a la estilista. Sin ella el sistema asume Chico en
          silencio — un Husky cobrado como Chihuahua, con media hora en vez de
          hora y media. Es el único dato que recepción puede dar sin el dueño:
          está viendo al perro.
        */}
        <LevelSelector
          label="Talla"
          options={TALLAS.map((t) => {
            const precio = precioDeTalla(t);
            return {
              key: t,
              label: precio != null ? `${NOMBRE_TALLA[t]}\n$${precio}` : NOMBRE_TALLA[t],
            };
          })}
          selected={size}
          onSelect={(k) => setSize(k as Talla)}
        />
        <Text style={styles.hint}>
          {/* Rangos desde SIZE_RANGES_KG: quemarlos a mano los dejaría
              desalineados del precio la próxima vez que cambie la tabla. */}
          {SIZE_RANGES_KG.map((r) => `${NOMBRE_TALLA[r.size as Talla]} ${sizeRangeLabel(r.size)}`).join(" · ")}
        </Text>

        <Text style={styles.label}>Nombre del cliente</Text>
        <TextInput
          style={styles.input}
          value={ownerName}
          onChangeText={setOwnerName}
          placeholder="Ana López"
          placeholderTextColor={COLORS.textTertiary}
          autoCapitalize="words"
          autoCorrect={false}
        />

        <Text style={styles.label}>Teléfono</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={(t) => setPhone(formatPhoneInput(t))}
          placeholder="662 123 4567"
          placeholderTextColor={COLORS.textTertiary}
          keyboardType="phone-pad"
          inputAccessoryViewID={KEYBOARD_DONE_ID}
        />
        <Text style={styles.hint}>
          Es con lo que lo vuelves a encontrar, y con lo que él puede reclamar su
          ficha si algún día instala la app.
        </Text>

        <Text style={styles.label}>Fecha y hora de la cita</Text>
        <View style={styles.dateRow}>
          <View style={styles.dateCol}>
            <DateTimeField
              label="Fecha"
              title="Fecha de la cita"
              text={formatWeekdayDayShort(appointmentAt)}
              mode="date"
              pickerValue={appointmentAt}
              // Sin minimumDate, igual que en crear reservación: a veces se
              // captura un baño que ya ocurrió.
              onChange={(date) => {
                const next = new Date(date);
                next.setHours(appointmentAt.getHours(), appointmentAt.getMinutes(), 0, 0);
                setAppointmentAt(next);
              }}
            />
          </View>
          <View style={styles.dateCol}>
            <DateTimeField
              label="Hora"
              title="Hora de la cita"
              text={formatTime(appointmentAt)}
              mode="time"
              pickerValue={appointmentAt}
              onChange={(date) => {
                const next = new Date(appointmentAt);
                next.setHours(date.getHours(), date.getMinutes(), 0, 0);
                setAppointmentAt(next);
              }}
            />
          </View>
        </View>

        <SwitchRow label="Deslanado" value={deslanado} onValueChange={setDeslanado} />
        <SwitchRow label="Corte" value={corte} onValueChange={setCorte} />

        {bathSlots?.durationMinutes != null && (
          <Text style={styles.estimate}>
            Toma {formatDurationMin(bathSlots.durationMinutes)} · termina{" "}
            {formatTime(new Date(appointmentAt.getTime() + bathSlots.durationMinutes * 60000))}
          </Text>
        )}

        {bathConflict && (
          <>
            <Text style={styles.estimateWarn}>{bathConflict}</Text>
            <SwitchRow
              label="Agendar de todos modos"
              value={forceSchedule}
              onValueChange={setForceSchedule}
            />
          </>
        )}

        {bathEstimate != null ? (
          <Text style={styles.estimate}>Precio: ${bathEstimate}</Text>
        ) : size ? (
          <Text style={styles.estimateWarn}>
            No hay precio configurado para talla {NOMBRE_TALLA[size]}
            {corte ? " con corte" : ""}
            {deslanado ? " con deslanado" : ""}. Escribe el total abajo.
          </Text>
        ) : null}

        <Text style={styles.label}>Total a cobrar</Text>
        <TextInput
          style={styles.amountInput}
          value={totalOverride}
          onChangeText={setTotalOverride}
          placeholder={bathEstimate != null ? String(bathEstimate) : "0"}
          placeholderTextColor={COLORS.textTertiary}
          keyboardType="numeric"
          inputAccessoryViewID={KEYBOARD_DONE_ID}
        />
        <Text style={styles.hint}>
          Déjalo vacío para cobrar el precio de la talla. Escribe 0 si es cortesía.
        </Text>

        <Text style={styles.label}>Cobro ahora (opcional)</Text>
        <TextInput
          style={styles.amountInput}
          value={cobro}
          onChangeText={setCobro}
          placeholder="0"
          placeholderTextColor={COLORS.textTertiary}
          keyboardType="numeric"
          inputAccessoryViewID={KEYBOARD_DONE_ID}
        />
        <Text style={styles.hint}>
          Lo que te está pagando en el mostrador. Se registra como pago y baja el saldo.
        </Text>
        {cobro.trim() !== "" && (
          <LevelSelector
            label="Método"
            options={[
              { key: "CASH", label: "Efectivo" },
              { key: "TRANSFER", label: "Transferencia" },
            ]}
            selected={metodo}
            onSelect={(k) => setMetodo(k as "CASH" | "TRANSFER")}
          />
        )}

        <Text style={styles.label}>Nota interna (opcional)</Text>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder="Perro nervioso, lo recoge su hija…"
          placeholderTextColor={COLORS.textTertiary}
          multiline
        />
      </ScrollView>

      <KeyboardDoneBar />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {faltantes.length > 0 && (
          <Text style={styles.faltaText}>Falta {faltantes.join(", ")}.</Text>
        )}
        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          onPress={() => void enviar()}
          disabled={!canSubmit}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.submitText}>Registrar baño</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  content: { padding: 16, paddingBottom: 32 },
  introCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  introText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    lineHeight: 18,
  },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginTop: 6,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  fotoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, marginBottom: 4 },
  fotoHint: {
    flex: 1,
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    lineHeight: 17,
  },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 4,
    marginBottom: 2,
  },
  dateRow: { flexDirection: "row", gap: 10, marginBottom: 6, alignItems: "flex-start" },
  dateCol: { flex: 1 },
  estimate: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
    marginTop: 8,
  },
  estimateWarn: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.errorText,
    marginTop: 8,
  },
  amountInput: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  notesInput: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 12,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    minHeight: 70,
    textAlignVertical: "top",
    marginBottom: 6,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  faltaText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    textAlign: "center",
    marginBottom: 8,
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: COLORS.white, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
});
