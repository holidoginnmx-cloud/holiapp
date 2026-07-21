import React, { useState } from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { COLORS } from "@/constants/colors";
import { styles } from "@/styles/cartillasStyles";
import { type VaccineCatalogEntry } from "@/lib/api";
import {
  addDays,
  clampDate,
  endOfToday,
  formatShort,
  type VaccineRow,
} from "@/components/cartilla/helpers";

type VaccineCaptureProps = {
  rows: VaccineRow[];
  onChange: (rows: VaccineRow[]) => void;
  catalog: VaccineCatalogEntry[];
  onRequestCatalogPicker: (rowIndex: number) => void;
};

export function VaccineCapture({
  rows,
  onChange,
  catalog,
  onRequestCatalogPicker,
}: VaccineCaptureProps) {
  const [appliedPickerForRow, setAppliedPickerForRow] = useState<number | null>(
    null
  );
  const [expiresPickerForRow, setExpiresPickerForRow] = useState<number | null>(
    null
  );

  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  const addRow = () => {
    const today = new Date();
    onChange([
      ...rows,
      { catalogId: null, appliedAt: today, expiresAt: addDays(today, 365) },
    ]);
  };

  const removeRow = (index: number) =>
    onChange(rows.filter((_, i) => i !== index));

  const updateRowApplied = (index: number, appliedAt: Date) => {
    onChange(
      rows.map((r, i) => {
        if (i !== index) return r;
        const cat = r.catalogId ? catalogById.get(r.catalogId) : undefined;
        const expires = cat ? addDays(appliedAt, cat.defaultDurationDays) : r.expiresAt;
        return { ...r, appliedAt, expiresAt: expires };
      })
    );
  };

  const updateRowExpires = (index: number, expiresAt: Date) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, expiresAt } : r)));
  };

  return (
    <>
      <Text style={styles.captureTitle}>Capturar vacunas</Text>
      <Text style={styles.captureHint}>
        Agrega las vacunas visibles en la cartilla. Solo la fecha es
        obligatoria; el tipo es opcional (déjalo "Sin especificar" si no está
        claro). La fecha de vencimiento se calcula automáticamente, pero la
        puedes editar si la cartilla muestra otra.
      </Text>

      {rows.map((row, idx) => {
        const cat = row.catalogId ? catalogById.get(row.catalogId) : null;
        return (
          <View key={idx} style={styles.vaccineRow}>
            <View style={styles.vaccineRowHeader}>
              <Text style={styles.vaccineRowTitle}>Vacuna {idx + 1}</Text>
              <TouchableOpacity onPress={() => removeRow(idx)}>
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={COLORS.errorText}
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>
              Tipo <Text style={styles.labelHint}>· opcional</Text>
            </Text>
            <TouchableOpacity
              style={styles.selectRow}
              onPress={() => onRequestCatalogPicker(idx)}
            >
              <Text
                style={[
                  styles.selectText,
                  !cat && { color: COLORS.textDisabled },
                ]}
              >
                {cat?.displayName ?? "Sin especificar"}
              </Text>
              <Ionicons
                name="chevron-down"
                size={18}
                color={COLORS.textTertiary}
              />
            </TouchableOpacity>

            <Text style={styles.label}>Fecha aplicada</Text>
            <TouchableOpacity
              style={styles.selectRow}
              onPress={() => setAppliedPickerForRow(idx)}
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
              Vence{" "}
              {cat && (
                <Text style={styles.labelHint}>
                  · sugerido +{cat.defaultDurationDays} días
                </Text>
              )}
            </Text>
            <TouchableOpacity
              style={styles.selectRow}
              onPress={() => setExpiresPickerForRow(idx)}
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

            {/* DatePicker aplicada */}
            {appliedPickerForRow === idx && (() => {
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
                    setAppliedPickerForRow(
                      Platform.OS === "ios" ? idx : null
                    );
                    if (d) updateRowApplied(idx, d);
                  }}
                />
              );
            })()}
            {Platform.OS === "ios" && appliedPickerForRow === idx && (
              <TouchableOpacity
                style={styles.pickerDone}
                onPress={() => setAppliedPickerForRow(null)}
              >
                <Text style={styles.pickerDoneText}>Listo</Text>
              </TouchableOpacity>
            )}

            {/* DatePicker vence */}
            {expiresPickerForRow === idx && (
              <DateTimePicker
                value={clampDate(row.expiresAt, row.appliedAt)}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant="light"
                textColor={COLORS.textPrimary}
                minimumDate={row.appliedAt}
                onChange={(_, d) => {
                  setExpiresPickerForRow(
                    Platform.OS === "ios" ? idx : null
                  );
                  if (d) updateRowExpires(idx, d);
                }}
              />
            )}
            {Platform.OS === "ios" && expiresPickerForRow === idx && (
              <TouchableOpacity
                style={styles.pickerDone}
                onPress={() => setExpiresPickerForRow(null)}
              >
                <Text style={styles.pickerDoneText}>Listo</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <TouchableOpacity style={styles.addRowBtn} onPress={addRow}>
        <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
        <Text style={styles.addRowText}>Agregar vacuna</Text>
      </TouchableOpacity>
    </>
  );
}
