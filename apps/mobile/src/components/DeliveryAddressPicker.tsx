import { COLORS } from "@/constants/colors";
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import {
  deliveryAutocomplete,
  deliveryPlaceDetails,
  type PlacePrediction,
} from "@/lib/api";

export type SelectedAddress = {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
};

type Props = {
  value: SelectedAddress | null;
  onChange: (addr: SelectedAddress | null) => void;
  /** Texto del placeholder del input de búsqueda. */
  placeholder?: string;
};

/**
 * Captura de dirección con autocompletado de Google Places (vía proxy backend;
 * la API key nunca sale del servidor). Usa debounce + session token para
 * agrupar el autocomplete + details de una misma búsqueda (mejor facturación).
 */
export function DeliveryAddressPicker({
  value,
  onChange,
  placeholder = "Escribe tu dirección…",
}: Props) {
  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  // Session token: vive mientras dura una búsqueda; se regenera al elegir.
  const sessionToken = useRef<string>(Crypto.randomUUID());

  // Debounce de la búsqueda (350ms). Solo busca con 3+ caracteres y sin
  // dirección ya seleccionada.
  useEffect(() => {
    if (value) return;
    const q = query.trim();
    if (q.length < 3) {
      setPredictions([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await deliveryAutocomplete(q, sessionToken.current);
        if (!cancelled) setPredictions(res.predictions);
      } catch {
        if (!cancelled) setPredictions([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, value]);

  async function handleSelect(p: PlacePrediction) {
    setLoadingDetails(true);
    try {
      const details = await deliveryPlaceDetails(p.placeId, sessionToken.current);
      onChange({
        address: details.address || p.description,
        lat: details.lat,
        lng: details.lng,
        placeId: p.placeId,
      });
      setPredictions([]);
      setQuery("");
      // Nueva sesión para la próxima búsqueda.
      sessionToken.current = Crypto.randomUUID();
    } catch {
      // Dejamos las predicciones para que el usuario reintente.
    } finally {
      setLoadingDetails(false);
    }
  }

  function handleClear() {
    onChange(null);
    setQuery("");
    setPredictions([]);
    sessionToken.current = Crypto.randomUUID();
  }

  // Estado: dirección ya seleccionada.
  if (value) {
    return (
      <View style={styles.selectedCard} testID="delivery-address-selected">
        <Ionicons name="location" size={18} color={COLORS.primary} />
        <Text style={styles.selectedText} numberOfLines={2}>
          {value.address}
        </Text>
        <TouchableOpacity
          onPress={handleClear}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="delivery-address-clear"
        >
          <Ionicons name="close-circle" size={20} color={COLORS.textTertiary} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.inputRow}>
        <Ionicons name="search" size={18} color={COLORS.textTertiary} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textDisabled}
          autoCorrect={false}
          testID="delivery-address-input"
        />
        {(searching || loadingDetails) && (
          <ActivityIndicator size="small" color={COLORS.primary} />
        )}
      </View>
      {predictions.length > 0 && (
        <View style={styles.dropdown}>
          {predictions.map((p) => (
            <TouchableOpacity
              key={p.placeId}
              style={styles.predictionRow}
              onPress={() => handleSelect(p)}
              disabled={loadingDetails}
              testID={`delivery-prediction-${p.placeId}`}
            >
              <Ionicons
                name="location-outline"
                size={16}
                color={COLORS.textTertiary}
              />
              <Text style={styles.predictionText} numberOfLines={2}>
                {p.description}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textPrimary,
    padding: 0,
  },
  dropdown: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    overflow: "hidden",
  },
  predictionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.bgSection,
  },
  predictionText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  selectedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.primaryLight,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectedText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
});
