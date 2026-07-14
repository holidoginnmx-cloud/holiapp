import { COLORS } from "@/constants/colors";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import { getPetById, createPet, updatePet } from "@/lib/api";
import { ImagePickerButton } from "@/components/ImagePickerButton";
import { ErrorState } from "@/components/ErrorState";
import { BreedAutocomplete } from "@/components/BreedAutocomplete";
import { formatName, formatPhoneInput, formatDayLongYear } from "@/lib/format";
import { sizeFromWeight } from "@holidoginn/shared/src/pricing";
import DateTimePicker from "@react-native-community/datetimepicker";

function sizeLabel(size: string): string {
  switch (size) {
    case "S": return "Perro Chico (1-5kg)";
    case "M": return "Perro Mediano (6-15kg)";
    case "L": return "Perro Grande (16-24kg)";
    case "XL": return "Perro Extra Grande (+24kg)";
    default: return "";
  }
}

export default function CreatePetScreen() {
  const router = useRouter();
  const { editId, focus, ownerId: ownerIdParam, ownerName } =
    useLocalSearchParams<{
      editId?: string;
      focus?: string;
      ownerId?: string;
      ownerName?: string;
    }>();
  const userId = useAuthStore((s) => s.userId);
  const syncUser = useAuthStore((s) => s.syncUser);
  const queryClient = useQueryClient();
  const isEditing = !!editId;
  // Alta hecha por un admin para otro dueño (paso 2 del "+" de Mascotas). El
  // backend solo respeta un ownerId ajeno si el rol es ADMIN.
  const isAdminCreate = !isEditing && !!ownerIdParam;

  const scrollRef = useRef<ScrollView>(null);
  const cartillaYRef = useRef<number | null>(null);
  const didScrollToCartillaRef = useRef(false);
  // Última carga enviada, para poder reintentar forzando duplicado si el
  // backend responde 409 DUPLICATE_PET.
  const lastSubmitRef = useRef<Record<string, unknown> | null>(null);

  const formReadyRef = useRef(false);
  const maybeScrollToCartilla = useCallback(() => {
    if (didScrollToCartillaRef.current) return;
    if (focus !== "cartilla") return;
    if (cartillaYRef.current == null) return;
    if (!formReadyRef.current) return;
    didScrollToCartillaRef.current = true;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, cartillaYRef.current! - 12),
        animated: true,
      });
    });
  }, [focus]);

  // Form state
  const [name, setName] = useState("");
  const [breed, setBreed] = useState("");
  const [weight, setWeight] = useState("");
  const size = weight ? sizeFromWeight(parseFloat(weight) || 0) : "";
  const [birthDate, setBirthDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [sex, setSex] = useState<string | null>(null);
  const [behavior, setBehavior] = useState<string[]>([]);
  const [walkPreference, setWalkPreference] = useState<string[]>([]);
  const [healthIssues, setHealthIssues] = useState("");
  const [isNeutered, setIsNeutered] = useState(false);
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [emergencyContactRelation, setEmergencyContactRelation] = useState("");
  const [vetName, setVetName] = useState("");
  const [vetPhone, setVetPhone] = useState("");
  const [vetEmergency24h, setVetEmergency24h] = useState(false);
  const [feedingSchedule, setFeedingSchedule] = useState("");
  const [feedingAmount, setFeedingAmount] = useState("");
  const [foodType, setFoodType] = useState("");
  const [feedingInstructions, setFeedingInstructions] = useState("");
  const [personality, setPersonality] = useState("");
  const [cartillaPhotos, setCartillaPhotos] = useState<string[]>([]);
  const [cartillaStatus, setCartillaStatus] = useState<
    "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | null
  >(null);
  const [cartillaRejectionReason, setCartillaRejectionReason] = useState<
    string | null
  >(null);

  // Load existing pet for editing
  const {
    data: existingPet,
    isLoading: loadingPet,
    isError: petError,
    error: petErrorObj,
    refetch: refetchPet,
  } = useQuery({
    queryKey: ["pet", editId],
    queryFn: () => getPetById(editId!),
    enabled: isEditing,
  });

  useEffect(() => {
    if (existingPet) {
      setName(existingPet.name);
      setBreed(existingPet.breed || "");
      // size is derived from weight automatically
      setWeight(existingPet.weight?.toString() || "");
      setBirthDate(existingPet.birthDate ? new Date(existingPet.birthDate) : null);
      setPhotoUrl(existingPet.photoUrl || "");
      setNotes(existingPet.notes || "");
      setSex((existingPet as any).sex || null);
      setBehavior((existingPet as any).behavior ? (existingPet as any).behavior.split(",") : []);
      setWalkPreference((existingPet as any).walkPreference ? (existingPet as any).walkPreference.split(",") : []);
      setHealthIssues((existingPet as any).healthIssues || "");
      setIsNeutered((existingPet as any).isNeutered || false);
      setEmergencyContactName((existingPet as any).emergencyContactName || "");
      setEmergencyContactPhone(formatPhoneInput((existingPet as any).emergencyContactPhone));
      setEmergencyContactRelation((existingPet as any).emergencyContactRelation || "");
      setVetName((existingPet as any).vetName || "");
      setVetPhone(formatPhoneInput((existingPet as any).vetPhone));
      setVetEmergency24h((existingPet as any).vetEmergency24h || false);
      setFeedingSchedule((existingPet as any).feedingSchedule || "");
      setFeedingAmount((existingPet as any).feedingAmount || "");
      setFoodType((existingPet as any).foodType || "");
      setFeedingInstructions((existingPet as any).feedingInstructions || "");
      setPersonality((existingPet as any).personality || "");
      const existingPhotos = (existingPet as any).cartillaPhotos as
        | string[]
        | undefined;
      const legacyUrl = (existingPet as any).cartillaUrl as string | null;
      setCartillaPhotos(
        existingPhotos && existingPhotos.length > 0
          ? existingPhotos
          : legacyUrl
            ? [legacyUrl]
            : [],
      );
      setCartillaStatus((existingPet as any).cartillaStatus ?? null);
      setCartillaRejectionReason((existingPet as any).cartillaRejectionReason ?? null);
      formReadyRef.current = true;
      maybeScrollToCartilla();
    }
  }, [existingPet, maybeScrollToCartilla]);

  useEffect(() => {
    if (!isEditing) {
      formReadyRef.current = true;
      maybeScrollToCartilla();
    }
  }, [isEditing, maybeScrollToCartilla]);

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      isEditing ? updatePet(editId!, data) : createPet(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pets"] });
      if (isEditing) {
        queryClient.invalidateQueries({ queryKey: ["pet", editId] });
      }
      if (isAdminCreate) {
        // La pestaña Mascotas del admin agrupa por dueño con su propia query.
        queryClient.invalidateQueries({ queryKey: ["admin", "pets"] });
        queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
        Alert.alert(
          "Mascota registrada",
          ownerName
            ? `Quedó registrada a nombre de ${ownerName}.`
            : "Quedó registrada a nombre del cliente.",
          [
            {
              text: "OK",
              // Cerramos el flujo entero (selector de dueño incluido) en vez de
              // apilar la pestaña otra vez: `replace` montaría un segundo tab
              // navigator y dejaría el selector debajo, atrapado en el back.
              onPress: () => {
                try {
                  router.dismissTo("/(admin)/clients" as any);
                } catch {
                  router.replace("/(admin)/clients" as any);
                }
              },
            },
          ],
        );
        return;
      }
      Alert.alert(
        isEditing ? "Mascota actualizada" : "Mascota registrada",
        isEditing
          ? "Los datos se actualizaron correctamente"
          : "Tu mascota fue registrada exitosamente",
        [{ text: "OK", onPress: () => router.back() }]
      );
    },
    onError: (e: Error) => {
      const err = e as Error & {
        status?: number;
        body?: { error?: string; petId?: string; message?: string };
      };
      // El dueño ya tiene una mascota con ese nombre: avisamos en vez de
      // duplicar. Puede ver el perfil existente o forzar la creación (dos
      // perros que de verdad se llaman igual).
      if (err.status === 409 && err.body?.error === "DUPLICATE_PET") {
        const petId = err.body.petId;
        // El mensaje del servidor le habla al dueño ("Ya tienes registrado
        // a X"), así que en el alta desde admin lo reescribimos en tercera
        // persona: quien está capturando no es el dueño.
        const duplicateMsg = isAdminCreate
          ? `${ownerName ?? "Ese cliente"} ya tiene una mascota registrada con ese nombre.`
          : err.body.message ?? "Ya tienes una mascota registrada con ese nombre.";
        Alert.alert(
          "Mascota ya registrada",
          duplicateMsg,
          [
            {
              text: "Ver perfil",
              onPress: () => {
                if (petId) router.replace(`/pet/${petId}` as any);
              },
            },
            {
              text: "Crear de todos modos",
              style: "destructive",
              onPress: () => {
                const data = lastSubmitRef.current;
                if (data) {
                  mutation.mutate({ ...data, allowDuplicateName: true });
                }
              },
            },
            { text: "Cancelar", style: "cancel" },
          ],
        );
        return;
      }
      Alert.alert("Error", e.message);
    },
  });

  // Al editar, la cartilla se persiste apenas se sube — no espera al
  // botón Guardar. Optimistic update con revert si falla la API.
  const cartillaMutation = useMutation({
    mutationFn: (photos: string[]) =>
      updatePet(editId!, {
        cartillaPhotos: photos,
        // mantenemos cartillaUrl sincronizado al primer slot por compat con
        // queries/clients viejos que aún lo lean.
        cartillaUrl: photos[0] ?? null,
      }),
    onMutate: (photos) => {
      const previous = {
        photos: cartillaPhotos,
        status: cartillaStatus,
        reason: cartillaRejectionReason,
      };
      setCartillaPhotos(photos);
      const existing = (existingPet as any)?.cartillaPhotos as
        | string[]
        | undefined;
      const changed = JSON.stringify(photos) !== JSON.stringify(existing ?? []);
      if (changed) {
        setCartillaStatus(photos.length > 0 ? "PENDING" : null);
        setCartillaRejectionReason(null);
      }
      return previous;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pets"] });
      queryClient.invalidateQueries({ queryKey: ["pet", editId] });
    },
    onError: (_e: Error, _photos, ctx) => {
      if (ctx) {
        setCartillaPhotos(ctx.photos);
        setCartillaStatus(ctx.status);
        setCartillaRejectionReason(ctx.reason);
      }
      Alert.alert(
        "Error",
        "No pudimos enviar la cartilla. Inténtalo de nuevo.",
      );
    },
  });

  const handleSave = async () => {
    if (!name.trim()) {
      return Alert.alert("Error", "El nombre es obligatorio");
    }
    if (!weight || !parseFloat(weight)) {
      return Alert.alert("Error", "Ingresa el peso de tu mascota");
    }
    if (walkPreference.length === 0) {
      return Alert.alert("Error", "Selecciona al menos una preferencia de paseo");
    }
    if (!emergencyContactName.trim()) {
      return Alert.alert("Error", "Ingresa el nombre del contacto de emergencia");
    }
    if (!emergencyContactPhone.trim()) {
      return Alert.alert("Error", "Ingresa el teléfono del contacto de emergencia");
    }

    // El id de la BD (userId) puede faltar un instante por una carrera con
    // /users/me tras el login. Lo resolvemos antes de enviar: así no viaja un
    // ownerId nulo y, al volver, la lista de mascotas (keyed por userId) se
    // refresca. El servidor deriva el dueño del token de todos modos.
    let ownerId = ownerIdParam ?? userId;
    if (!isEditing && !ownerId) {
      ownerId = await syncUser();
    }

    const data: Record<string, unknown> = {
      name: formatName(name),
      breed: breed.trim() || null,
      size,
      weight: weight ? parseFloat(weight) : null,
      birthDate: birthDate?.toISOString() || null,
      photoUrl: photoUrl.trim() || null,
      notes: notes.trim() || null,
      sex: sex || null,
      behavior: behavior.length > 0 ? behavior.join(",") : null,
      walkPreference: walkPreference.length > 0 ? walkPreference.join(",") : null,
      healthIssues: healthIssues.trim() || null,
      isNeutered,
      emergencyContactName: formatName(emergencyContactName) || null,
      emergencyContactPhone: emergencyContactPhone.trim() || null,
      emergencyContactRelation: emergencyContactRelation.trim() || null,
      vetName: formatName(vetName) || null,
      vetPhone: vetPhone.trim() || null,
      vetEmergency24h,
      feedingSchedule: feedingSchedule.trim() || null,
      feedingAmount: feedingAmount.trim() || null,
      foodType: foodType.trim() || null,
      feedingInstructions: feedingInstructions.trim() || null,
      personality: personality.trim() || null,
      cartillaPhotos,
      cartillaUrl: cartillaPhotos[0] ?? null,
    };

    if (!isEditing && ownerId) {
      data.ownerId = ownerId;
    }

    lastSubmitRef.current = data;
    mutation.mutate(data);
  };

  if (isEditing && petError) {
    return <ErrorState error={petErrorObj} onRetry={refetchPet} />;
  }

  if (isEditing && loadingPet) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <Text style={styles.title}>
        {isEditing ? "Editar mascota" : "Nueva mascota"}
      </Text>
      {isAdminCreate && ownerName ? (
        <Text style={styles.ownerHint}>Dueño: {ownerName}</Text>
      ) : null}

      {/* Foto */}
      <View style={styles.photoSection}>
        <ImagePickerButton
          imageUrl={photoUrl || null}
          onImageUploaded={setPhotoUrl}
          folder="pets"
          size={120}
          icon="paw-outline"
          label="Foto de mascota"
        />
      </View>

      {/* Datos básicos */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Información del huésped</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nombre *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Nombre de tu mascota"
            placeholderTextColor={COLORS.textDisabled}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Raza</Text>
          <BreedAutocomplete
            value={breed}
            onChange={setBreed}
            placeholder="Ej: Golden Retriever"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Peso (kg) *</Text>
          <TextInput
            style={styles.input}
            value={weight}
            onChangeText={setWeight}
            placeholder="Ej: 12.5"
            placeholderTextColor={COLORS.textDisabled}
            keyboardType="decimal-pad"
          />
          {size ? (
            <View style={styles.sizeTag}>
              <Ionicons name="resize-outline" size={14} color={COLORS.primary} />
              <Text style={styles.sizeTagText}>{sizeLabel(size)}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Fecha de nacimiento</Text>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => setShowDatePicker(true)}
          >
            <Ionicons name="calendar-outline" size={20} color={COLORS.textTertiary} />
            <Text style={[styles.dateText, !birthDate && { color: COLORS.textDisabled }]}>
              {birthDate
                ? formatDayLongYear(birthDate)
                : "Seleccionar fecha"}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (() => {
            const birthMax = new Date();
            birthMax.setHours(23, 59, 59, 999);
            const birthValue =
              birthDate && birthDate <= birthMax ? birthDate : birthMax;
            return (
              <DateTimePicker
                value={birthValue}
                mode="date"
                maximumDate={birthMax}
                themeVariant="light"
                textColor={COLORS.textPrimary}
                onChange={(_, date) => {
                  setShowDatePicker(Platform.OS === "ios");
                  if (date) setBirthDate(date);
                }}
              />
            );
          })()}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Sexo</Text>
          <View style={styles.chipRow}>
            {[{ key: "F", label: "Hembra" }, { key: "M", label: "Macho" }].map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, sex === opt.key && styles.chipSelected]}
                onPress={() => setSex(sex === opt.key ? null : opt.key)}
              >
                <Text style={[styles.chipText, sex === opt.key && styles.chipTextSelected]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Comportamiento habitual</Text>
          <View style={styles.chipRow}>
            {["Amigable", "Nervioso", "Agresivo"].map((opt) => {
              const selected = behavior.includes(opt.toLowerCase());
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() =>
                    setBehavior(selected
                      ? behavior.filter((b) => b !== opt.toLowerCase())
                      : [...behavior, opt.toLowerCase()]
                    )
                  }
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Paseos *</Text>
          <View style={styles.chipRow}>
            {[{ key: "aire_libre", label: "Al aire libre" }, { key: "instalaciones", label: "Dentro de instalaciones" }].map((opt) => {
              const selected = walkPreference.includes(opt.key);
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() =>
                    setWalkPreference(selected
                      ? walkPreference.filter((w) => w !== opt.key)
                      : [...walkPreference, opt.key]
                    )
                  }
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Personalidad</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={personality}
            onChangeText={setPersonality}
            placeholder="Describe cómo es tu perro: juguetón, tímido, sociable..."
            placeholderTextColor={COLORS.textDisabled}
            multiline
            numberOfLines={3}
          />
        </View>
      </View>

      {/* Salud */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Salud</Text>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Esterilizado/a</Text>
          <Switch
            value={isNeutered}
            onValueChange={setIsNeutered}
            trackColor={{ false: COLORS.border, true: COLORS.reviewToggle }}
            thumbColor={isNeutered ? COLORS.primary : "#f4f3f4"}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>¿Tiene algún problema de salud o condición especial?</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={healthIssues}
            onChangeText={setHealthIssues}
            placeholder="Alergias, condiciones médicas, medicamentos..."
            placeholderTextColor={COLORS.textDisabled}
            multiline
            numberOfLines={3}
          />
        </View>
      </View>

      {/* Cartilla de vacunación */}
      <View
        style={styles.section}
        onLayout={(e) => {
          cartillaYRef.current = e.nativeEvent.layout.y;
          maybeScrollToCartilla();
        }}
      >
        <Text style={styles.sectionTitle}>Cartilla de vacunación</Text>
        <Text style={styles.cartillaHelp}>
          Sube una o varias fotos de la cartilla (anverso, reverso, páginas
          internas). Un miembro del equipo HDI las revisará antes de que puedas
          reservar.
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cartillaPhotosRow}
        >
          {cartillaPhotos.map((url, idx) => (
            <View key={`${url}-${idx}`} style={styles.cartillaThumbWrap}>
              <Image source={{ uri: url }} style={styles.cartillaThumb} />
              <TouchableOpacity
                style={styles.cartillaThumbRemove}
                onPress={() => {
                  const next = cartillaPhotos.filter((_, i) => i !== idx);
                  if (isEditing) {
                    cartillaMutation.mutate(next);
                  } else {
                    setCartillaPhotos(next);
                  }
                }}
                hitSlop={8}
                disabled={isEditing && cartillaMutation.isPending}
                testID={`cartilla-remove-${idx}`}
              >
                <Ionicons name="close" size={14} color={COLORS.white} />
              </TouchableOpacity>
            </View>
          ))}
          <ImagePickerButton
            imageUrl={null}
            onImageUploaded={(url) => {
              const next = [...cartillaPhotos, url];
              if (isEditing) {
                cartillaMutation.mutate(next);
              } else {
                setCartillaPhotos(next);
                setCartillaStatus("PENDING");
                setCartillaRejectionReason(null);
              }
            }}
            folder="cartillas"
            size={110}
            icon={
              cartillaPhotos.length === 0
                ? "shield-checkmark-outline"
                : "add-circle-outline"
            }
            label={cartillaPhotos.length === 0 ? "Cartilla" : "Agregar más"}
            allowsEditing={false}
            disabled={isEditing && cartillaMutation.isPending}
          />
        </ScrollView>

        {cartillaPhotos.length === 0 && (
          <Text style={styles.cartillaStatusMuted}>
            Sube la cartilla para poder reservar.
          </Text>
        )}
        {cartillaPhotos.length > 0 && cartillaStatus === "PENDING" && (
          <View style={[styles.cartillaBadge, { backgroundColor: COLORS.warningBg }]}>
            <Ionicons name="time-outline" size={16} color={COLORS.warningText} />
            <Text style={[styles.cartillaBadgeText, { color: COLORS.warningText }]}>
              En revisión — te avisaremos cuando se apruebe.
            </Text>
          </View>
        )}
        {cartillaPhotos.length > 0 && cartillaStatus === "APPROVED" && (
          <View style={[styles.cartillaBadge, { backgroundColor: COLORS.successBg }]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.successText} />
            <Text style={[styles.cartillaBadgeText, { color: COLORS.successText }]}>
              Cartilla aprobada.
            </Text>
          </View>
        )}
        {cartillaPhotos.length > 0 && cartillaStatus === "REJECTED" && (
          <View style={[styles.cartillaBadge, { backgroundColor: COLORS.errorBg }]}>
            <Ionicons name="close-circle-outline" size={16} color={COLORS.errorText} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cartillaBadgeText, { color: COLORS.errorText }]}>
                Cartilla rechazada
                {cartillaRejectionReason ? `: ${cartillaRejectionReason}` : "."}
              </Text>
              <Text style={[styles.cartillaBadgeSubtext, { color: COLORS.errorText }]}>
                Sube una nueva para revisarla.
              </Text>
            </View>
          </View>
        )}
        {cartillaPhotos.length > 0 && cartillaStatus === "EXPIRED" && (
          <View style={[styles.cartillaBadge, { backgroundColor: COLORS.errorBg }]}>
            <Ionicons name="alarm-outline" size={16} color={COLORS.errorText} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cartillaBadgeText, { color: COLORS.errorText }]}>
                Cartilla vencida
              </Text>
              <Text style={[styles.cartillaBadgeSubtext, { color: COLORS.errorText }]}>
                Sube la cartilla actualizada para volver a reservar.
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Alimentación */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alimentación</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Horario(s) de comida</Text>
          <TextInput
            style={styles.input}
            value={feedingSchedule}
            onChangeText={setFeedingSchedule}
            placeholder="Ej: 8:00 AM y 6:00 PM"
            placeholderTextColor={COLORS.textDisabled}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Cantidad por comida</Text>
          <TextInput
            style={styles.input}
            value={feedingAmount}
            onChangeText={setFeedingAmount}
            placeholder="Ej: 1 taza, 200 gramos"
            placeholderTextColor={COLORS.textDisabled}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Tipo de alimento</Text>
          <TextInput
            style={styles.input}
            value={foodType}
            onChangeText={setFoodType}
            placeholder="Ej: Royal Canin Medium Adult"
            placeholderTextColor={COLORS.textDisabled}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Instrucciones especiales</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={feedingInstructions}
            onChangeText={setFeedingInstructions}
            placeholder="Medicación, suplementos, mezcla..."
            placeholderTextColor={COLORS.textDisabled}
            multiline
            numberOfLines={3}
          />
        </View>
      </View>

      {/* Información veterinaria */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Información veterinaria</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nombre de la clínica / veterinario</Text>
          <TextInput
            style={styles.input}
            value={vetName}
            onChangeText={setVetName}
            placeholder="Nombre del veterinario o clínica"
            placeholderTextColor={COLORS.textDisabled}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Teléfono</Text>
          <TextInput
            style={styles.input}
            value={vetPhone}
            onChangeText={(v) => setVetPhone(formatPhoneInput(v))}
            placeholder="+52 (662) 429 6727"
            placeholderTextColor={COLORS.textDisabled}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>¿Atiende emergencias 24h?</Text>
          <Switch
            value={vetEmergency24h}
            onValueChange={setVetEmergency24h}
            trackColor={{ false: COLORS.border, true: COLORS.reviewToggle }}
            thumbColor={vetEmergency24h ? COLORS.primary : "#f4f3f4"}
          />
        </View>
      </View>

      {/* Contacto de emergencia */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contacto de emergencia</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Nombre completo *</Text>
          <TextInput
            style={styles.input}
            value={emergencyContactName}
            onChangeText={setEmergencyContactName}
            placeholder="Nombre del contacto"
            placeholderTextColor={COLORS.textDisabled}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Teléfono *</Text>
          <TextInput
            style={styles.input}
            value={emergencyContactPhone}
            onChangeText={(v) => setEmergencyContactPhone(formatPhoneInput(v))}
            placeholder="+52 (662) 429 6727"
            placeholderTextColor={COLORS.textDisabled}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Relación con el propietario</Text>
          <TextInput
            style={styles.input}
            value={emergencyContactRelation}
            onChangeText={setEmergencyContactRelation}
            placeholder="Ej: Familiar, amigo, vecino"
            placeholderTextColor={COLORS.textDisabled}
          />
        </View>
      </View>

      {/* Notas adicionales */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notas adicionales</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Cualquier otra indicación importante..."
          placeholderTextColor={COLORS.textDisabled}
          multiline
          numberOfLines={4}
        />
      </View>

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitButton, mutation.isPending && { opacity: 0.6 }]}
        onPress={handleSave}
        disabled={mutation.isPending}
        activeOpacity={0.8}
      >
        {mutation.isPending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <>
            <Ionicons
              name={isEditing ? "checkmark-circle" : "paw"}
              size={22}
              color={COLORS.white}
            />
            <Text style={styles.submitText}>
              {isEditing ? "Guardar cambios" : "Registrar mascota"}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.bgPage,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.textPrimary,
    marginBottom: 20,
  },
  ownerHint: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
    marginTop: -14,
    marginBottom: 20,
  },
  photoSection: {
    alignItems: "center",
    marginBottom: 20,
  },
  section: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    gap: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.bgPage,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  chipTextSelected: {
    color: COLORS.white,
  },
  sizeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.bgPage,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
  },
  sizeTagText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
  },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dateText: {
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 8,
  },
  submitText: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.white,
  },
  // Cartilla
  cartillaHelp: {
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 18,
    marginTop: -8,
  },
  cartillaPhotosRow: {
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  cartillaThumbWrap: {
    position: "relative",
    width: 110,
    height: 110,
  },
  cartillaThumb: {
    width: 110,
    height: 110,
    borderRadius: 14,
    backgroundColor: COLORS.bgSection,
  },
  cartillaThumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.errorText,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  cartillaStatusMuted: {
    fontSize: 13,
    color: COLORS.textDisabled,
    textAlign: "center",
    marginTop: 4,
  },
  cartillaBadge: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  cartillaBadgeText: {
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
    lineHeight: 18,
  },
  cartillaBadgeSubtext: {
    fontSize: 12,
    opacity: 0.85,
    marginTop: 2,
  },
});
