import { COLORS } from "@/constants/colors";
import { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Campo de selección: un cuadro con el valor elegido que abre la lista de
 * opciones en un bottom sheet, en lugar de desplegarla en línea empujando el
 * resto del formulario. Hermano de DateTimeField — mismo aspecto de campo y
 * mismo sheet, para que fecha, hora y listas se sientan igual.
 */

export type SelectOption = {
  key: string;
  label: string;
  /** Segunda línea opcional (p. ej. "ya con 2 del grupo"). */
  hint?: string;
  /**
   * Se muestra pero no se puede elegir. Preferible a esconder la opción: si
   * algo no aplica, el usuario debe VERLO y saber por qué (usar `hint` para
   * explicarlo), no encontrarse una lista misteriosamente corta.
   */
  disabled?: boolean;
};

type Props = {
  title: string;
  /** Texto del campo cuando no hay nada elegido. */
  placeholder: string;
  options: SelectOption[];
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  /** Mensaje del sheet cuando no hay ninguna opción disponible. */
  emptyText?: string;
  /** Muestra "N disponibles" bajo el título. Útil en listas largas. */
  showCount?: boolean;
  testID?: string;
};

export function SelectField({
  title,
  placeholder,
  options,
  selectedKey,
  onSelect,
  emptyText,
  showCount,
  testID,
}: Props) {
  const [open, setOpen] = useState(false);
  const elegido = options.find((o) => o.key === selectedKey);
  const disponibles = options.filter((o) => !o.disabled).length;

  return (
    <>
      <TouchableOpacity
        style={styles.field}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        testID={testID}
      >
        <Text
          style={[styles.fieldText, !elegido && styles.fieldTextEmpty]}
          numberOfLines={1}
        >
          {elegido ? elegido.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={COLORS.textTertiary} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        {/* El fondo es una capa aparte por DEBAJO del sheet: envolver el sheet
            en un TouchableOpacity le hace competir con el ScrollView por el
            gesto vertical y el arrastre se pierde. */}
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={styles.titleCol}>
                <Text style={styles.title}>{title}</Text>
                {showCount && options.length > 0 && (
                  <Text style={styles.count}>
                    {disponibles} de {options.length} disponible
                    {disponibles === 1 ? "" : "s"}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={COLORS.textTertiary} />
              </TouchableOpacity>
            </View>

            {options.length === 0 ? (
              <Text style={styles.emptyText}>
                {emptyText ?? "No hay opciones disponibles"}
              </Text>
            ) : (
              <ScrollView
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator
              >
                {options.map((o) => {
                  const seleccionado = o.key === selectedKey;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={styles.row}
                      disabled={o.disabled}
                      onPress={() => {
                        onSelect(o.key);
                        setOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.rowTextCol}>
                        <Text
                          style={[
                            styles.rowText,
                            seleccionado && styles.rowTextSelected,
                            o.disabled && styles.rowTextDisabled,
                          ]}
                        >
                          {o.label}
                        </Text>
                        {o.hint && <Text style={styles.rowHint}>{o.hint}</Text>}
                      </View>
                      {seleccionado && !o.disabled && (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={COLORS.primary}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 6,
  },
  fieldText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "PlusJakartaSans_600SemiBold",
    color: COLORS.textPrimary,
  },
  fieldTextEmpty: {
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
  },
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
    maxHeight: "80%",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  titleCol: { flex: 1 },
  title: {
    fontSize: 17,
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.textPrimary,
  },
  count: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  // flexShrink: 1 es lo que permite el scroll. En RN los hijos de un flex NO
  // se encogen por defecto, así que un ScrollView sin altura propia crece al
  // tamaño de su contenido: el maxHeight del sheet lo recortaba visualmente y
  // las opciones de abajo quedaban inalcanzables (se veían 12 de 18 cuartos).
  list: { flexShrink: 1, marginTop: 8 },
  listContent: { paddingBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  rowTextCol: { flex: 1 },
  rowText: {
    fontSize: 15,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textPrimary,
  },
  rowTextSelected: {
    fontFamily: "PlusJakartaSans_700Bold",
    color: COLORS.primary,
  },
  rowTextDisabled: { color: COLORS.textDisabled },
  rowHint: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    paddingVertical: 20,
    textAlign: "center",
  },
});
