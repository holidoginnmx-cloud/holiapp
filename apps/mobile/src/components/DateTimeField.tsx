import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";

/**
 * Campo de fecha u hora: un cuadro con la etiqueta y el valor YA FORMATEADO
 * dentro, que abre el selector nativo por encima en lugar de empujarlo debajo.
 *
 * El `DateTimePicker` inline de iOS ocupa su propio espacio bajo el campo y
 * pinta la fecha en inglés ("Aug 6, 2026"), así que el valor real quedaba fuera
 * del cuadro y en otro idioma. Aquí el cuadro muestra el texto en español y el
 * selector vive en un bottom sheet; en Android el componente ya es un diálogo
 * nativo, así que se monta sólo mientras está abierto.
 */

type Props = {
  label: string;
  /** Texto a mostrar dentro del cuadro (ya formateado en español). */
  text: string;
  /** true cuando no hay valor elegido: atenúa el texto. */
  empty?: boolean;
  mode: "date" | "time";
  /** Valor que muestra el selector al abrirse (el actual, o un default). */
  pickerValue: Date;
  minimumDate?: Date;
  onChange: (value: Date) => void;
  /** Si se pasa, el sheet ofrece borrar el valor (campos opcionales). */
  onClear?: () => void;
  title?: string;
  testID?: string;
};

export function DateTimeField({
  label,
  text,
  empty,
  mode,
  pickerValue,
  minimumDate,
  onChange,
  onClear,
  title,
  testID,
}: Props) {
  const [open, setOpen] = useState(false);
  // Valor que se está girando en el spinner de iOS. Se confirma al cerrar el
  // sheet (por "Listo" o tocando fuera), para que abrir y cerrar sin girar
  // igual fije la fecha que se estaba mostrando.
  const [draft, setDraft] = useState<Date | null>(null);

  const abrir = () => {
    setDraft(null);
    setOpen(true);
  };

  const confirmar = () => {
    setOpen(false);
    onChange(draft ?? pickerValue);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.field}
        onPress={abrir}
        activeOpacity={0.7}
        testID={testID}
      >
        <View style={styles.fieldTextCol}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={[styles.fieldValue, empty && styles.fieldValueEmpty]}>
            {text}
          </Text>
        </View>
        {/* Borrar va DENTRO del cuadro: en Android el selector es un diálogo
            del sistema y no puede alojar un botón propio. */}
        {onClear && !empty && (
          <TouchableOpacity
            onPress={onClear}
            hitSlop={10}
            accessibilityLabel={`Quitar ${label.toLowerCase()}`}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={COLORS.textTertiary}
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* Android: el picker ES el diálogo, se monta sólo al abrir. */}
      {Platform.OS === "android" && open && (
        <DateTimePicker
          value={pickerValue}
          mode={mode}
          minimumDate={minimumDate}
          onChange={(event, date) => {
            setOpen(false);
            if (event.type === "set" && date) onChange(date);
          }}
        />
      )}

      {/* iOS: sheet propio para que el spinner no empuje el layout. */}
      {Platform.OS === "ios" && (
        <Modal
          visible={open}
          transparent
          animationType="slide"
          onRequestClose={confirmar}
        >
          <TouchableOpacity
            style={styles.overlay}
            activeOpacity={1}
            onPress={confirmar}
          >
            <TouchableOpacity
              style={styles.sheet}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.header}>
                <Text style={styles.title}>{title ?? label}</Text>
                <TouchableOpacity onPress={confirmar} hitSlop={12}>
                  <Text style={styles.done}>Listo</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={draft ?? pickerValue}
                mode={mode}
                display="spinner"
                minimumDate={minimumDate}
                themeVariant="light"
                textColor={COLORS.textPrimary}
                onChange={(_, date) => {
                  if (date) setDraft(date);
                }}
              />
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  fieldTextCol: { flex: 1 },
  fieldLabel: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  fieldValueEmpty: { color: COLORS.textTertiary },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  done: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
});
