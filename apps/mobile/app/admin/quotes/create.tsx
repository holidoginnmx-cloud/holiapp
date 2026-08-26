import { COLORS } from "@/constants/colors";
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTimeField } from "@/components/DateTimeField";
import { SwitchRow } from "@/components/SwitchRow";
import { LevelSelector } from "@/components/LevelSelector";
import { ErrorState } from "@/components/ErrorState";
import { getAllPets, createQuote, type PetWithOwner } from "@/lib/api";
import {
  formatName,
  formatFullName,
  formatWeekdayDayShort,
  formatCurrency,
} from "@/lib/format";
import { useQuotePreview } from "@/hooks/useQuotePreview";
import type { QuotePreviewInput } from "@holidoginn/shared";

export { ScreenErrorBoundary as ErrorBoundary } from "@/components/ScreenErrorBoundary";

type ServiceType = "STAY" | "BATH" | "DAYCARE";
/** A quién se le cotiza: alguien con cuenta o alguien que apenas preguntó. */
type Destinatario = "CLIENTE" | "PROSPECTO";

/** Perro capturado a mano para un prospecto (no existe en `pets`). */
type PerroLibre = { key: string; name: string; weight: string; breed: string };

// ─── Fechas ──────────────────────────────────────────────────
// El formulario trabaja con Date (lo que entrega el picker) pero manda
// "YYYY-MM-DD" a la API. La conversión usa los componentes LOCALES: un
// `toISOString().slice(0,10)` a las 19:00 en Hermosillo (UTC-7) devuelve el día
// siguiente y la cotización cobraría una noche de más.
function toYMD(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function toHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fromHHmm(hhmm: string, base: Date): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

function formatDate(d: Date | null): string {
  return d ? formatWeekdayDayShort(d) : "Seleccionar";
}

const hoy = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export default function AdminCreateQuote() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [serviceType, setServiceType] = useState<ServiceType>("STAY");
  const [destinatario, setDestinatario] = useState<Destinatario>("CLIENTE");

  // Cliente con cuenta
  const [clientSearch, setClientSearch] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [petIds, setPetIds] = useState<string[]>([]);

  // Prospecto sin cuenta: NO se crea User ni Pet — solo se guarda el snapshot.
  const [prospectName, setProspectName] = useState("");
  const [prospectPhone, setProspectPhone] = useState("");
  const [perrosLibres, setPerrosLibres] = useState<PerroLibre[]>([
    { key: "p0", name: "", weight: "", breed: "" },
  ]);

  // Fechas y horas
  const [checkIn, setCheckIn] = useState<Date | null>(null);
  const [checkOut, setCheckOut] = useState<Date | null>(null);
  const [fechaServicio, setFechaServicio] = useState<Date | null>(null);
  const [dcInTime, setDcInTime] = useState("09:00");
  const [dcOutTime, setDcOutTime] = useState("13:00");
  // Para cotizar "unas cinco noches en diciembre", sin fechas cerradas.
  const [sinFechas, setSinFechas] = useState(false);
  const [noches, setNoches] = useState("");

  // Servicios
  const [conBano, setConBano] = useState(false);
  const [deslanado, setDeslanado] = useState(false);
  const [corte, setCorte] = useState(false);
  const [desparasitante, setDesparasitante] = useState(false);
  const [probarf, setProbarf] = useState(false);
  const [medicamento, setMedicamento] = useState(false);

  // Cortesías, descuento y precio
  const [banoCortesia, setBanoCortesia] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [totalOverride, setTotalOverride] = useState("");
  const [depositSuggested, setDepositSuggested] = useState("");

  // Presentación
  const [notas, setNotas] = useState("");
  const [notasInternas, setNotasInternas] = useState("");
  const [vigencia, setVigencia] = useState<Date | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const {
    data: pets,
    isLoading,
    isError,
    refetch,
  } = useQuery<PetWithOwner[]>({ queryKey: ["all-pets"], queryFn: getAllPets });

  // ── Clientes derivados de las mascotas activas (mismo criterio que la
  // pantalla de crear reservación: se busca por nombre de cliente O de perro).
  const owners = useMemo(() => {
    type OwnerEntry = {
      id: string;
      name: string;
      phone: string | null;
      photoUrl: string | null;
      pets: { id: string; name: string; photoUrl: string | null }[];
    };
    const map = new Map<string, OwnerEntry>();
    for (const p of pets ?? []) {
      if (!p.owner) continue;
      let entry = map.get(p.owner.id);
      if (!entry) {
        entry = {
          id: p.owner.id,
          name: formatFullName(p.owner.firstName, p.owner.lastName),
          phone: (p.owner as { phone?: string | null }).phone ?? null,
          photoUrl: null,
          pets: [],
        };
        map.set(p.owner.id, entry);
      }
      entry.pets.push({ id: p.id, name: formatName(p.name), photoUrl: p.photoUrl ?? null });
      if (!entry.photoUrl && p.photoUrl) entry.photoUrl = p.photoUrl;
    }
    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const q = norm(clientSearch.trim());
    if (!q) return list.map((o) => ({ ...o, matchedPet: null as OwnerEntry["pets"][number] | null }));
    return list.flatMap((o) => {
      const matchedPet = o.pets.find((p) => norm(p.name).includes(q)) ?? null;
      if (!norm(o.name).includes(q) && !matchedPet) return [];
      return [{ ...o, matchedPet }];
    });
  }, [pets, clientSearch]);

  const ownerPets = useMemo(
    () => (pets ?? []).filter((p) => p.owner?.id === ownerId),
    [pets, ownerId],
  );

  const selectedOwner = useMemo(
    () => owners.find((o) => o.id === ownerId) ?? null,
    [owners, ownerId],
  );

  const selectOwner = useCallback((id: string, petId?: string) => {
    setOwnerId(id);
    setPetIds(petId ? [petId] : []);
    setClientSearch("");
  }, []);

  const togglePet = useCallback((id: string) => {
    setPetIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }, []);

  // ── Mascotas a cotizar, en la forma que espera la API ──────────────────────
  const petsPayload = useMemo(() => {
    if (destinatario === "CLIENTE") {
      return petIds
        .map((id) => (pets ?? []).find((p) => p.id === id))
        .filter((p): p is PetWithOwner => Boolean(p))
        .map((p) => ({
          petId: p.id,
          name: formatName(p.name),
          weightKg: p.weight ?? null,
          size: p.size ?? null,
          breed: p.breed ?? null,
          hasMedication: medicamento,
        }));
    }
    return perrosLibres
      .filter((p) => p.name.trim().length > 0)
      .map((p) => ({
        name: p.name.trim(),
        weightKg: p.weight.trim() ? Number(p.weight) : null,
        breed: p.breed.trim() || null,
        hasMedication: medicamento,
      }));
  }, [destinatario, petIds, pets, perrosLibres, medicamento]);

  // ── Total en vivo: SIEMPRE lo calcula el servidor ──────────────────────────
  // La pantalla no suma nada. El input se manda a POST /quotes/preview con
  // debounce; si está incompleto, se manda null y no se pide nada.
  const previewInput: QuotePreviewInput | null = useMemo(() => {
    if (petsPayload.length === 0) return null;
    if (serviceType === "STAY" && !sinFechas && (!checkIn || !checkOut)) return null;
    if (serviceType === "STAY" && sinFechas && !noches.trim()) return null;

    return {
      serviceType,
      pets: petsPayload,
      checkIn: serviceType === "STAY" && !sinFechas && checkIn ? toYMD(checkIn) : null,
      checkOut: serviceType === "STAY" && !sinFechas && checkOut ? toYMD(checkOut) : null,
      date: serviceType !== "STAY" && fechaServicio ? toYMD(fechaServicio) : null,
      checkInTime: serviceType === "DAYCARE" ? dcInTime : null,
      checkOutTime: serviceType === "DAYCARE" ? dcOutTime : null,
      nightsOverride: serviceType === "STAY" && sinFechas ? Number(noches) || null : null,
      bath: conBano || serviceType === "BATH" ? { deslanado, corte } : null,
      deworming: desparasitante,
      probarf: serviceType === "STAY" ? probarf : false,
      courtesy: banoCortesia ? ["BATH" as const] : [],
      discountCode: discountCode.trim() || null,
      totalOverride: totalOverride.trim() ? Number(totalOverride) : null,
    } as QuotePreviewInput;
  }, [
    serviceType, petsPayload, sinFechas, checkIn, checkOut, noches, fechaServicio,
    dcInTime, dcOutTime, conBano, deslanado, corte, desparasitante, probarf,
    banoCortesia, discountCode, totalOverride,
  ]);

  const { result: preview, error: previewError, loading: previewLoading } =
    useQuotePreview(previewInput);

  const breakdown = preview?.breakdown ?? null;

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!previewInput) {
      Alert.alert("Faltan datos", "Completa el servicio y las mascotas.");
      return;
    }
    if (!breakdown) {
      Alert.alert(
        "No se pudo calcular el total",
        previewError ?? "Revisa los datos e intenta de nuevo.",
      );
      return;
    }

    const nombre =
      destinatario === "CLIENTE" ? (selectedOwner?.name ?? "") : prospectName.trim();
    if (!nombre) {
      Alert.alert("Falta el cliente", "Indica a quién se le cotiza.");
      return;
    }

    setSubmitting(true);
    try {
      const detalle = await createQuote({
        ...previewInput,
        ownerId: destinatario === "CLIENTE" ? ownerId : null,
        clientName: nombre,
        clientPhone:
          destinatario === "CLIENTE" ? (selectedOwner?.phone ?? null) : prospectPhone.trim() || null,
        notes: notas.trim() || null,
        internalNotes: notasInternas.trim() || null,
        validUntil: vigencia ? toYMD(vigencia) : undefined,
        depositSuggested: depositSuggested.trim() ? Number(depositSuggested) : null,
        source: "APP_ADMIN",
      });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      // replace y no push: volver "atrás" desde el detalle debe llevar a la
      // lista, no al formulario que acaba de guardarse.
      router.replace(`/admin/quotes/${detalle.quote.id}`);
    } catch (err) {
      Alert.alert(
        "No se pudo guardar",
        err instanceof Error ? err.message : "Intenta de nuevo.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    previewInput, breakdown, previewError, destinatario, selectedOwner, prospectName,
    prospectPhone, ownerId, notas, notasInternas, vigencia, depositSuggested,
    queryClient, router,
  ]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }
  if (isError) {
    return <ErrorState message="No se pudieron cargar los clientes" onRetry={refetch} />;
  }

  const listoParaCotizar = petsPayload.length > 0;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <LevelSelector
          label="Servicio a cotizar"
          options={[
            { key: "STAY", label: "Hospedaje" },
            { key: "BATH", label: "Estética" },
            { key: "DAYCARE", label: "Guardería" },
          ]}
          selected={serviceType}
          onSelect={(k) => setServiceType(k as ServiceType)}
        />

        <LevelSelector
          label="¿A quién se le cotiza?"
          options={[
            { key: "CLIENTE", label: "Cliente registrado" },
            { key: "PROSPECTO", label: "Prospecto" },
          ]}
          selected={destinatario}
          onSelect={(k) => setDestinatario(k as Destinatario)}
        />

        {/* ── Cliente registrado ── */}
        {destinatario === "CLIENTE" && (
          <>
            <Text style={styles.label}>Cliente</Text>
            {ownerId && !clientSearch.trim() ? (
              <TouchableOpacity
                style={styles.selectedRow}
                onPress={() => setOwnerId(null)}
                activeOpacity={0.7}
              >
                <Ionicons name="person-circle" size={20} color={COLORS.primary} />
                <Text style={styles.selectedText}>{selectedOwner?.name ?? ""}</Text>
                <Text style={styles.changeText}>Cambiar</Text>
              </TouchableOpacity>
            ) : (
              <>
                <View style={styles.searchContainer}>
                  <Ionicons name="search" size={16} color={COLORS.textDisabled} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Buscar cliente o mascota..."
                    placeholderTextColor={COLORS.textDisabled}
                    value={clientSearch}
                    onChangeText={setClientSearch}
                    autoCorrect={false}
                  />
                  {clientSearch.length > 0 && (
                    <Ionicons
                      name="close-circle"
                      size={16}
                      color={COLORS.textDisabled}
                      onPress={() => setClientSearch("")}
                    />
                  )}
                </View>
                {clientSearch.trim().length > 0 && (
                  <View style={styles.listBox}>
                    {owners.length === 0 ? (
                      <Text style={styles.emptyText}>Sin coincidencias</Text>
                    ) : (
                      owners.map((o) => {
                        const avatarUrl = o.matchedPet?.photoUrl ?? o.photoUrl;
                        return (
                          <TouchableOpacity
                            key={o.id}
                            style={[styles.row, ownerId === o.id && styles.rowSelected]}
                            onPress={() => selectOwner(o.id, o.matchedPet?.id)}
                            activeOpacity={0.7}
                          >
                            {avatarUrl ? (
                              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
                            ) : (
                              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                                <Ionicons name="paw" size={14} color={COLORS.textTertiary} />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.rowText,
                                  ownerId === o.id && styles.rowTextSelected,
                                ]}
                              >
                                {o.name}
                              </Text>
                              {o.matchedPet && (
                                <Text style={styles.rowSubText}>🐾 {o.matchedPet.name}</Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                )}
              </>
            )}

            {ownerId && (
              <>
                <Text style={styles.label}>
                  Mascotas{petIds.length > 1 ? ` (${petIds.length})` : ""}
                </Text>
                <View style={styles.listBox}>
                  {ownerPets.length === 0 ? (
                    <Text style={styles.emptyText}>Este cliente no tiene mascotas</Text>
                  ) : (
                    ownerPets.map((p) => {
                      const isSelected = petIds.includes(p.id);
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={[styles.row, isSelected && styles.rowSelected]}
                          onPress={() => togglePet(p.id)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>
                            {formatName(p.name)} ({p.weight ?? 0} kg)
                          </Text>
                          <Ionicons
                            name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                            size={18}
                            color={isSelected ? COLORS.primary : COLORS.borderLight}
                          />
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              </>
            )}
          </>
        )}

        {/* ── Prospecto sin cuenta ── */}
        {destinatario === "PROSPECTO" && (
          <>
            <Text style={styles.hint}>
              Para quien apenas pregunta. No se crea cuenta ni expediente: solo se
              guardan estos datos en la cotización.
            </Text>

            <Text style={styles.label}>Nombre</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="Nombre de quien pregunta"
              placeholderTextColor={COLORS.textDisabled}
              value={prospectName}
              onChangeText={setProspectName}
            />

            <Text style={styles.label}>WhatsApp</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="662 123 4567"
              placeholderTextColor={COLORS.textDisabled}
              value={prospectPhone}
              onChangeText={setProspectPhone}
              keyboardType="phone-pad"
            />
            <Text style={styles.hint}>
              Es a este número al que se le va a mandar la cotización.
            </Text>

            <Text style={styles.label}>Perros</Text>
            {perrosLibres.map((perro, i) => (
              <View key={perro.key} style={styles.perroCard}>
                <View style={styles.perroHead}>
                  <Text style={styles.perroTitulo}>Perro {i + 1}</Text>
                  {perrosLibres.length > 1 && (
                    <TouchableOpacity
                      onPress={() =>
                        setPerrosLibres((prev) => prev.filter((p) => p.key !== perro.key))
                      }
                      hitSlop={8}
                    >
                      <Ionicons name="trash-outline" size={16} color={COLORS.errorText} />
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  style={styles.amountInput}
                  placeholder="Nombre"
                  placeholderTextColor={COLORS.textDisabled}
                  value={perro.name}
                  onChangeText={(v) =>
                    setPerrosLibres((prev) =>
                      prev.map((p) => (p.key === perro.key ? { ...p, name: v } : p)),
                    )
                  }
                />
                <View style={styles.dateRow}>
                  <View style={styles.dateCol}>
                    <TextInput
                      style={styles.amountInput}
                      placeholder="Peso (kg)"
                      placeholderTextColor={COLORS.textDisabled}
                      value={perro.weight}
                      onChangeText={(v) =>
                        setPerrosLibres((prev) =>
                          prev.map((p) => (p.key === perro.key ? { ...p, weight: v } : p)),
                        )
                      }
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.dateCol}>
                    <TextInput
                      style={styles.amountInput}
                      placeholder="Raza (opcional)"
                      placeholderTextColor={COLORS.textDisabled}
                      value={perro.breed}
                      onChangeText={(v) =>
                        setPerrosLibres((prev) =>
                          prev.map((p) => (p.key === perro.key ? { ...p, breed: v } : p)),
                        )
                      }
                    />
                  </View>
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() =>
                setPerrosLibres((prev) => [
                  ...prev,
                  { key: `p${Date.now()}`, name: "", weight: "", breed: "" },
                ])
              }
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={16} color={COLORS.primary} />
              <Text style={styles.addBtnText}>Agregar otro perro</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>
              El peso define la tarifa. Sin peso se cotiza como perro chico.
            </Text>
          </>
        )}

        {/* ── Fechas ── */}
        {listoParaCotizar && serviceType === "STAY" && (
          <>
            <SwitchRow
              label="Todavía sin fechas"
              hint="Cotizar por número de noches"
              value={sinFechas}
              onValueChange={setSinFechas}
            />
            {sinFechas ? (
              <>
                <Text style={styles.label}>Noches</Text>
                <TextInput
                  style={styles.amountInput}
                  placeholder="5"
                  placeholderTextColor={COLORS.textDisabled}
                  value={noches}
                  onChangeText={setNoches}
                  keyboardType="numeric"
                />
              </>
            ) : (
              <View style={styles.dateRow}>
                <View style={styles.dateCol}>
                  <DateTimeField
                    label="Entrada"
                    text={formatDate(checkIn)}
                    empty={!checkIn}
                    mode="date"
                    pickerValue={checkIn ?? hoy()}
                    minimumDate={hoy()}
                    onChange={setCheckIn}
                  />
                </View>
                <View style={styles.dateCol}>
                  <DateTimeField
                    label="Salida"
                    text={formatDate(checkOut)}
                    empty={!checkOut}
                    mode="date"
                    pickerValue={checkOut ?? checkIn ?? hoy()}
                    minimumDate={checkIn ?? hoy()}
                    onChange={setCheckOut}
                  />
                </View>
              </View>
            )}
          </>
        )}

        {listoParaCotizar && serviceType !== "STAY" && (
          <View style={styles.dateRow}>
            <View style={styles.dateCol}>
              <DateTimeField
                label={serviceType === "BATH" ? "Día de la cita" : "Día"}
                text={formatDate(fechaServicio)}
                empty={!fechaServicio}
                mode="date"
                pickerValue={fechaServicio ?? hoy()}
                minimumDate={hoy()}
                onChange={setFechaServicio}
                onClear={() => setFechaServicio(null)}
              />
            </View>
          </View>
        )}

        {listoParaCotizar && serviceType === "DAYCARE" && (
          <View style={styles.dateRow}>
            <View style={styles.dateCol}>
              <DateTimeField
                label="Entrada"
                text={dcInTime}
                mode="time"
                pickerValue={fromHHmm(dcInTime, new Date())}
                onChange={(d) => setDcInTime(toHHmm(d))}
              />
            </View>
            <View style={styles.dateCol}>
              <DateTimeField
                label="Salida"
                text={dcOutTime}
                mode="time"
                pickerValue={fromHHmm(dcOutTime, new Date())}
                onChange={(d) => setDcOutTime(toHHmm(d))}
              />
            </View>
          </View>
        )}

        {/* ── Servicios ── */}
        {listoParaCotizar && (
          <>
            <Text style={styles.label}>Servicios</Text>
            {serviceType !== "BATH" && (
              <SwitchRow label="Incluir baño" value={conBano} onValueChange={setConBano} />
            )}
            {(conBano || serviceType === "BATH") && (
              <>
                <SwitchRow label="Deslanado" value={deslanado} onValueChange={setDeslanado} nested />
                <SwitchRow label="Corte" value={corte} onValueChange={setCorte} nested />
                <SwitchRow
                  label="Baño de cortesía"
                  hint="Se muestra con su precio tachado y no suma al total"
                  value={banoCortesia}
                  onValueChange={setBanoCortesia}
                  nested
                />
              </>
            )}
            <SwitchRow
              label="Desparasitante"
              value={desparasitante}
              onValueChange={setDesparasitante}
            />
            {serviceType === "STAY" && (
              <>
                <SwitchRow label="Dieta ProBarf" value={probarf} onValueChange={setProbarf} />
                <SwitchRow
                  label="Administrar medicamento"
                  hint="Suma un recargo sobre el hospedaje"
                  value={medicamento}
                  onValueChange={setMedicamento}
                />
              </>
            )}
          </>
        )}

        {/* ── Desglose calculado por el servidor ── */}
        {listoParaCotizar && (
          <>
            <Text style={styles.label}>Desglose</Text>
            {previewLoading && !breakdown && (
              <View style={styles.previewBox}>
                <ActivityIndicator color={COLORS.primary} />
              </View>
            )}
            {previewError && (
              <View style={[styles.previewBox, styles.previewError]}>
                <Ionicons name="alert-circle" size={16} color={COLORS.errorText} />
                <Text style={styles.previewErrorText}>{previewError}</Text>
              </View>
            )}
            {breakdown && (
              <View style={styles.previewBox}>
                {breakdown.pets.map((p) => (
                  <View key={p.key} style={styles.previewPet}>
                    <Text style={styles.previewPetName}>{p.name}</Text>
                    {p.lines.map((l, i) => (
                      <View key={`${p.key}-${i}`} style={styles.previewLine}>
                        <Text style={styles.previewLabel} numberOfLines={1}>
                          {l.label}
                        </Text>
                        <Text
                          style={[styles.previewAmount, l.isCourtesy && styles.previewGift]}
                        >
                          {l.isCourtesy ? "Cortesía" : formatCurrency(l.amount)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
                {breakdown.lines
                  .filter((l) => l.petKey === null)
                  .map((l, i) => (
                    <View key={`g-${i}`} style={styles.previewLine}>
                      <Text style={styles.previewLabel} numberOfLines={1}>
                        {l.label}
                      </Text>
                      <Text style={styles.previewAmount}>{formatCurrency(l.amount)}</Text>
                    </View>
                  ))}
                {breakdown.warnings.map((w, i) => (
                  <Text key={`w-${i}`} style={styles.previewWarn}>
                    {w}
                  </Text>
                ))}
              </View>
            )}
            {preview?.discountError && (
              <Text style={styles.previewWarn}>{preview.discountError}</Text>
            )}
          </>
        )}

        {/* ── Precio ── */}
        {listoParaCotizar && (
          <>
            <Text style={styles.label}>Código de descuento (opcional)</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="PROMO10"
              placeholderTextColor={COLORS.textDisabled}
              value={discountCode}
              onChangeText={setDiscountCode}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <Text style={styles.label}>Precio pactado (opcional)</Text>
            <TextInput
              style={styles.amountInput}
              placeholder={breakdown ? String(breakdown.subtotal) : "Total pactado"}
              placeholderTextColor={COLORS.textDisabled}
              value={totalOverride}
              onChangeText={setTotalOverride}
              keyboardType="numeric"
            />
            <Text style={styles.hint}>
              Reemplaza el total calculado. El servicio a domicilio se suma aparte.
            </Text>

            <Text style={styles.label}>Anticipo sugerido (opcional)</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor={COLORS.textDisabled}
              value={depositSuggested}
              onChangeText={setDepositSuggested}
              keyboardType="numeric"
            />
            <Text style={styles.hint}>
              Lo que se le pide para apartar. Sale en la cotización.
            </Text>
          </>
        )}

        {/* ── Vigencia y notas ── */}
        {listoParaCotizar && (
          <>
            <DateTimeField
              label="Vigente hasta"
              text={vigencia ? formatDate(vigencia) : "7 días (predeterminado)"}
              empty={!vigencia}
              mode="date"
              pickerValue={vigencia ?? hoy()}
              minimumDate={hoy()}
              onChange={setVigencia}
              onClear={() => setVigencia(null)}
            />

            <Text style={styles.label}>Nota para el cliente (opcional)</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="La ve el cliente en la cotización..."
              placeholderTextColor={COLORS.textDisabled}
              value={notas}
              onChangeText={setNotas}
              multiline
            />

            <Text style={styles.label}>Nota interna (opcional)</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="Solo la ve el equipo, nunca el cliente..."
              placeholderTextColor={COLORS.textDisabled}
              value={notasInternas}
              onChangeText={setNotasInternas}
              multiline
            />
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) + 12 }]}>
        {breakdown && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatCurrency(breakdown.total)}</Text>
          </View>
        )}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            (submitting || !breakdown) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={submitting || !breakdown}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.submitText}>Guardar cotización</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgPage },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  content: { padding: 16, paddingBottom: 32 },
  label: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginTop: 6,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    gap: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
    padding: 0,
  },
  selectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  selectedText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  changeText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
  },
  listBox: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: "hidden",
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  rowSelected: { backgroundColor: COLORS.bgSection },
  rowText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
  },
  rowSubText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  rowTextSelected: { fontFamily: "PlusJakartaSans_700Bold", color: COLORS.primary },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 10,
    backgroundColor: COLORS.bgSection,
  },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  emptyText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    padding: 14,
    textAlign: "center",
  },
  dateRow: { flexDirection: "row", gap: 10, marginBottom: 6, alignItems: "flex-start" },
  dateCol: { flex: 1 },
  hint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 4,
    marginBottom: 2,
  },
  // Perro capturado a mano (prospecto).
  perroCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 12,
    marginBottom: 8,
  },
  perroHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  perroTitulo: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textSecondary,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.primary,
    marginBottom: 6,
  },
  addBtnText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.primary,
  },
  // Desglose devuelto por el servidor.
  previewBox: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    padding: 12,
    marginBottom: 6,
  },
  previewError: { flexDirection: "row", alignItems: "center", gap: 8 },
  previewErrorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.errorText,
  },
  previewPet: { marginBottom: 8 },
  previewPetName: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
    marginBottom: 2,
  },
  previewLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 3,
    gap: 12,
  },
  previewLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textSecondary,
  },
  previewAmount: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  previewGift: { color: COLORS.successText },
  previewWarn: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.warningText,
    marginTop: 6,
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
    marginBottom: 8,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.primaryLight,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  totalLabel: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  totalValue: {
    fontSize: 18,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: {
    color: COLORS.white,
    fontSize: 16,
    fontFamily: "PlusJakartaSans_700Bold",
  },
});
