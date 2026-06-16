import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { COLORS } from "@/constants/colors";
import { styles } from "@/styles/cartillasStyles";
import {
  addDays,
  clampDate,
  endOfToday,
  formatShort,
  DEWORMING_TYPES,
  DEWORMING_DEFAULT_DAYS,
  type DewormingRow,
} from "@/components/cartilla/helpers";

type DewormingCaptureProps = {
  rows: DewormingRow[];
  onChange: (rows: DewormingRow[]) => void;
};

export function DewormingCapture({ rows, onChange }: DewormingCaptureProps) {
  const [dewormingAppliedPickerForRow, setDewormingAppliedPickerForRow] =
    useState<number | null>(null);
  const [dewormingExpiresPickerForRow, setDewormingExpiresPickerForRow] =
    useState<number | null>(null);

  const addDewormingRow = () => {
    const today = new Date();
    onChange([
      ...rows,
      {
        type: "INTERNAL",
        productName: "",
        appliedAt: today,
        expiresAt: addDays(today, DEWORMING_DEFAULT_DAYS),
        notes: "",
      },
    ]);
  };

  const removeDewormingRow = (index: number) =>
    onChange(rows.filter((_, i) => i !== index));

  const updateDewormingRow = (index: number, patch: Partial<DewormingRow>) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const updateDewormingApplied = (index: number, appliedAt: Date) => {
    onChange(
      rows.map((r, i) =>
        i === index
          ? { ...r, appliedAt, expiresAt: addDays(appliedAt, DEWORMING_DEFAULT_DAYS) }
          : r
      )
    );
  };

  return (
    <>
      <Text style={[styles.captureTitle, { marginTop: 20 }]}>
        Desparasitaciones
      </Text>
      <Text style={styles.captureHint}>
        Registra las desparasitaciones visibles en la cartilla. La próxima
        dosis se sugiere a {DEWORMING_DEFAULT_DAYS} días; puedes editarla.
      </Text>

      {rows.map((row, idx) => (
        <View key={`dw-${idx}`} style={styles.vaccineRow}>
          <View style={styles.vaccineRowHeader}>
            <Text style={styles.vaccineRowTitle}>
              Desparasitación {idx + 1}
            </Text>
            <TouchableOpacity onPress={() => removeDewormingRow(idx)}>
              <Ionicons
                name="trash-outline"
                size={18}
                color={COLORS.errorText}
              />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Tipo</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            {DEWORMING_TYPES.map((opt) => {
              const active = row.type === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.dewormingChip,
                    active && styles.dewormingChipActive,
                  ]}
                  onPress={() => updateDewormingRow(idx, { type: opt.key })}
                >
                  <Text
                    style={[
                      styles.dewormingChipText,
                      active && { color: COLORS.white },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Producto (opcional)</Text>
          <TextInput
            style={styles.dewormingInput}
            value={row.productName}
            onChangeText={(t) => updateDewormingRow(idx, { productName: t })}
            placeholder="Bravecto, Nexgard, Drontal..."
            placeholderTextColor={COLORS.textDisabled}
          />

          <Text style={styles.label}>Fecha aplicada</Text>
          <TouchableOpacity
            style={styles.selectRow}
            onPress={() => setDewormingAppliedPickerForRow(idx)}
          >
            <Ionicons
              name="calendar-outline"
              size={18}
              color={COLORS.primary}
            />
            <Text style={styles.selectText}>
              {formatShort(row.appliedAt)}
            </Text>
          </TouchableOpacity>

          <Text style={styles.label}>
            Próxima dosis{" "}
            <Text style={styles.labelHint}>
              · sugerido +{DEWORMING_DEFAULT_DAYS} días
            </Text>
          </Text>
          <TouchableOpacity
            style={styles.selectRow}
            onPress={() => setDewormingExpiresPickerForRow(idx)}
          >
            <Ionicons
              name="alarm-outline"
              size={18}
              color={COLORS.warningText}
            />
            <Text style={styles.selectText}>
              {formatShort(row.expiresAt)}
            </Text>
          </TouchableOpacity>

          <Text style={styles.label}>Notas (opcional)</Text>
          <TextInput
            style={[styles.dewormingInput, { minHeight: 60 }]}
            value={row.notes}
            onChangeText={(t) => updateDewormingRow(idx, { notes: t })}
            placeholder="Observaciones..."
            placeholderTextColor={COLORS.textDisabled}
            multiline
          />

          {dewormingAppliedPickerForRow === idx && (() => {
            const max = endOfToday();
            return (
              <DateTimePicker
                value={clampDate(row.appliedAt, undefined, max)}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant="light"
                textColor={COLORS.textPrimary}
                maximumDate={max}
                onChange={(_, d) => {
                  setDewormingAppliedPickerForRow(
                    Platform.OS === "ios" ? idx : null
                  );
                  if (d) updateDewormingApplied(idx, d);
                }}
              />
            );
          })()}
          {Platform.OS === "ios" &&
            dewormingAppliedPickerForRow === idx && (
              <TouchableOpacity
                style={styles.pickerDone}
                onPress={() => setDewormingAppliedPickerForRow(null)}
              >
                <Text style={styles.pickerDoneText}>Listo</Text>
              </TouchableOpacity>
            )}

          {dewormingExpiresPickerForRow === idx && (
            <DateTimePicker
              value={clampDate(row.expiresAt, row.appliedAt)}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              themeVariant="light"
              textColor={COLORS.textPrimary}
              minimumDate={row.appliedAt}
              onChange={(_, d) => {
                setDewormingExpiresPickerForRow(
                  Platform.OS === "ios" ? idx : null
                );
                if (d) updateDewormingRow(idx, { expiresAt: d });
              }}
            />
          )}
          {Platform.OS === "ios" &&
            dewormingExpiresPickerForRow === idx && (
              <TouchableOpacity
                style={styles.pickerDone}
                onPress={() => setDewormingExpiresPickerForRow(null)}
              >
                <Text style={styles.pickerDoneText}>Listo</Text>
              </TouchableOpacity>
            )}
        </View>
      ))}

      <TouchableOpacity style={styles.addRowBtn} onPress={addDewormingRow}>
        <Ionicons
          name="add-circle-outline"
          size={20}
          color={COLORS.primary}
        />
        <Text style={styles.addRowText}>Agregar desparasitación</Text>
      </TouchableOpacity>
    </>
  );
}
