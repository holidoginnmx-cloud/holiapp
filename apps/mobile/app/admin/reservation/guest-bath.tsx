import { COLORS } from "@/constants/colors";
import {
  CARD_BRAND_OPTIONS,
  MANUAL_METHOD_OPTIONS,
  type CardBrand,
  type ManualPaymentMethod,
} from "@/lib/paymentMethod";
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
  DeliveryAddressPicker,
  type SelectedAddress,
} from "@/components/DeliveryAddressPicker";
import {
  VIAJES_DOMICILIO,
  VIAJE_HINT_EQUIPO,
  viajeSufijo,
} from "@/constants/delivery";
import {
  getBathVariants,
  getBathSlots,
  createWalkInBath,
  registerManualPayment,
  getDeliveryStatus,
  deliveryQuote,
  type DeliveryTrip,
  type WalkInBathBody,
  type WalkInOwnerCandidate,
} from "@/lib/api";
import {
  formatWeekdayDayShort,
  formatTime,
  formatPhoneInput,
  phoneNationalDigits,
} from "@/lib/format";
import { invalidateReservationScope } from "@/lib/invalidateReservations";
import { alertaDeError } from "@/lib/errorAlert";
import { ApiError } from "@/lib/api/client";
import {
  useBathConflict,
  localDayKey,
  formatDurationMin,
} from "@/hooks/useBathConflict";
import { BathConflictNotice } from "@/components/BathConflictNotice";
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
  // Servicio a domicilio: mismos tres datos que en crear reservación.
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryTrip, setDeliveryTrip] = useState<DeliveryTrip>("PICKUP");
  const [deliveryAddress, setDeliveryAddress] = useState<SelectedAddress | null>(null);
  const [totalOverride, setTotalOverride] = useState("");
  const [cobro, setCobro] = useState("");
  const [metodo, setMetodo] = useState<ManualPaymentMethod>("CASH");
  const [cardBrand, setCardBrand] = useState<CardBrand | null>(null);
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
  const loadBathSlots = (dateYMD: string) =>
    getBathSlots(dateYMD, { petSize: size || undefined, deslanado, corte });
  const { data: bathSlots } = useQuery({
    queryKey: ["admin", "bath-slots-walkin", dayKey, size, deslanado, corte],
    queryFn: () => loadBathSlots(dayKey),
    enabled: !!size,
  });
  const bathConflict = useBathConflict(bathSlots, appointmentAt);

  // Domicilio: gate por config + cotización del servidor (vista previa; al
  // guardar la vuelve a calcular él). Mismas query keys que create.tsx: es la
  // misma pregunta con la misma respuesta.
  const { data: deliveryStatus } = useQuery({
    queryKey: ["delivery-status"],
    queryFn: getDeliveryStatus,
    staleTime: 1000 * 60 * 10,
  });
  const deliveryServiceActive = deliveryStatus?.active === true;
  // Si el servicio se apaga con el switch ya prendido, el switch desaparece de
  // la pantalla: sin esto se seguiría mandando un domicilio que nadie ve.
  const conDomicilio = deliveryEnabled && deliveryServiceActive;
  const {
    data: deliveryQuoteData,
    isFetching: deliveryQuoting,
    isError: deliveryQuoteFailed,
  } = useQuery({
    // El viaje entra en la key: cambiar de sencillo a redondo cambia la tarifa.
    queryKey: ["delivery-quote", deliveryAddress?.lat, deliveryAddress?.lng, deliveryTrip],
    queryFn: () => deliveryQuote(deliveryAddress!.lat, deliveryAddress!.lng, deliveryTrip),
    enabled: conDomicilio && !!deliveryAddress,
  });
  const deliveryFee =
    conDomicilio && deliveryAddress && deliveryQuoteData?.active ? deliveryQuoteData.fee : null;

  // Qué falta, en el orden en que se llena la pantalla. El botón lo dice en voz
  // alta en vez de esperar a que lo toquen para reclamar.
  const faltantes = useMemo(() => {
    const f: string[] = [];
    if (petName.trim().length < 2) f.push("el nombre del perrito");
    if (!size) f.push("la talla");
    if (ownerName.trim().length < 2) f.push("el nombre del cliente");
    // `phoneNationalDigits` y no un `replace(/\D/g, "")` a secas: el campo se
    // pinta con `formatPhoneInput`, o sea "+52 (662) 123 4567". Contando esos
    // dígitos pelones, un teléfono COMPLETO daba 12 y el botón se quedaba
    // trabado en "falta el teléfono"; uno de 8 dígitos daba 10 y pasaba.
    if (phoneNationalDigits(phone).length !== 10) f.push("el teléfono (10 dígitos)");
    if (bathConflict && !forceSchedule) f.push("resolver el horario");
    // Sin tarifa no se manda: el servidor rechazaría el baño entero, y aquí se
    // puede decir de antemano en vez de después de tocar el botón.
    if (conDomicilio && !deliveryAddress) f.push("la dirección del domicilio");
    else if (conDomicilio && deliveryFee == null) f.push("la tarifa del domicilio");
    // Sin variante Y sin precio a mano no hay nada que cobrar. A diferencia de
    // create.tsx, aquí basta con escribir el total: el perro ya está enfrente y
    // el precio se pacta de viva voz.
    if (bathEstimate == null && !totalOverride.trim()) f.push("el total a cobrar");
    // Con tarjeta, la comisión depende del tipo: hay que preguntarlo.
    if (cobro.trim() && metodo === "CARD" && !cardBrand) f.push("el tipo de tarjeta");
    return f;
  }, [
    cobro,
    metodo,
    cardBrand,
    petName,
    size,
    ownerName,
    phone,
    bathConflict,
    forceSchedule,
    conDomicilio,
    deliveryAddress,
    deliveryFee,
    bathEstimate,
    totalOverride,
  ]);

  const canSubmit = faltantes.length === 0 && !submitting;

  const totalNum = totalOverride.trim() ? Number(totalOverride) : null;
  const cobroNum = cobro.trim() ? Number(cobro) : null;

  // Lo que va a quedar en la reserva: el baño (pactado a mano o de la talla)
  // MÁS el domicilio. Sólo se pinta con domicilio; sin él, el total es el campo.
  const banoNum =
    totalNum != null && Number.isFinite(totalNum) && totalNum >= 0 ? totalNum : bathEstimate;
  const totalConDomicilio =
    deliveryFee != null && banoNum != null
      ? Math.round((banoNum + deliveryFee) * 100) / 100
      : null;

  const armarBody = (extra: Partial<WalkInBathBody> = {}): WalkInBathBody => ({
    owner: { name: ownerName.trim(), phone: phoneNationalDigits(phone) },
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
    ...(conDomicilio && deliveryAddress
      ? {
          homeDelivery: {
            address: deliveryAddress.address,
            lat: deliveryAddress.lat,
            lng: deliveryAddress.lng,
            placeId: deliveryAddress.placeId,
            trip: deliveryTrip,
          },
        }
      : {}),
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
            ...(metodo === "CARD" && cardBrand ? { cardBrand } : {}),
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

      // Un servidor que todavía no conoce el campo lo descarta sin avisar y el
      // baño nace sin el viaje. Mejor decirlo que dejar a recepción creyendo
      // que la camioneta ya está apuntada.
      const pidioDomicilio = conDomicilio && !!deliveryAddress;
      const avisoDomicilio =
        pidioDomicilio && res.pricing.deliveryFee == null
          ? ["OJO: el domicilio NO se guardó. Agrégalo desde el detalle del baño."]
          : [];

      const avisos = [...res.warnings, ...res.agendaWarnings, ...avisoDomicilio, ...avisoCobro];
      Alert.alert(
        "Baño registrado",
        [
          `${res.pet.name} · ${formatTime(appointmentAt)}`,
          `Total $${res.pricing.amount}`,
          res.pricing.deliveryFee
            ? `Incluye $${res.pricing.deliveryFee} de domicilio.`
            : null,
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
          <BathConflictNotice
            conflict={bathConflict}
            appointmentAt={appointmentAt}
            force={forceSchedule}
            onForceChange={setForceSchedule}
            onPick={(d) => {
              setAppointmentAt(d);
              setForceSchedule(false);
            }}
            loadSlots={loadBathSlots}
            queryKey={["admin", "bath-slots-walkin", size, deslanado, corte]}
          />
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

        {/* ── Servicio a domicilio (opcional) ── */}
        {deliveryServiceActive && (
          <>
            <SwitchRow
              label="Servicio a domicilio"
              value={deliveryEnabled}
              onValueChange={setDeliveryEnabled}
            />
            {deliveryEnabled && (
              <>
                <LevelSelector
                  label="Viaje"
                  options={VIAJES_DOMICILIO}
                  selected={deliveryTrip}
                  onSelect={(k) => setDeliveryTrip(k as DeliveryTrip)}
                />
                <Text style={styles.hint}>{VIAJE_HINT_EQUIPO[deliveryTrip]}</Text>
                <View style={styles.addressBox}>
                  <DeliveryAddressPicker
                    value={deliveryAddress}
                    onChange={setDeliveryAddress}
                    placeholder="Dirección de entrega/recolección"
                  />
                </View>
                {deliveryFee != null ? (
                  <Text style={styles.estimate}>
                    Tarifa domicilio: ${deliveryFee} ({deliveryQuoteData!.distanceKm} km){" "}
                    {viajeSufijo(deliveryTrip)}
                  </Text>
                ) : deliveryAddress && deliveryQuoting ? (
                  <Text style={styles.hint}>Calculando la tarifa…</Text>
                ) : deliveryAddress && (deliveryQuoteFailed || deliveryQuoteData?.active === false) ? (
                  <Text style={styles.estimateWarn}>
                    No se pudo calcular la tarifa de esa dirección. Elige otra, o
                    apaga el domicilio y agrégalo después desde el detalle del baño.
                  </Text>
                ) : null}
              </>
            )}
          </>
        )}

        <Text style={styles.label}>{conDomicilio ? "Total del baño" : "Total a cobrar"}</Text>
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
          {conDomicilio ? " El domicilio se suma aparte." : ""}
        </Text>
        {totalConDomicilio != null && (
          <Text style={styles.estimate}>
            Total a cobrar: ${totalConDomicilio} (baño ${banoNum} + domicilio ${deliveryFee})
          </Text>
        )}

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
            options={MANUAL_METHOD_OPTIONS}
            selected={metodo}
            onSelect={(k) => setMetodo(k as ManualPaymentMethod)}
          />
        )}
        {cobro.trim() !== "" && metodo === "CARD" && (
          <LevelSelector
            label="Tipo de tarjeta (pregúntale al cliente)"
            options={CARD_BRAND_OPTIONS}
            selected={cardBrand ?? ""}
            onSelect={(k) => setCardBrand(k as CardBrand)}
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
  addressBox: { marginTop: 8 },
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
