import { COLORS } from "@/constants/colors";
import React, { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { getAllPets } from "@/lib/api";
import { formatFullName, formatName } from "@/lib/format";
import { coincideBusqueda, filtrarPorBusqueda } from "@/lib/search";

export type PickedClient = { id: string; name: string; petNames: string[] };

/**
 * Buscador de cliente por su nombre o por el de su perro (el equipo se acuerda
 * del perro, no del dueño). Los clientes se derivan de las mascotas, igual que
 * en "Crear reservación" y "Citas recurrentes".
 */
export function ClientSearchPicker({
  value,
  onChange,
  placeholder = "Buscar cliente o mascota...",
}: {
  value: PickedClient | null;
  onChange: (c: PickedClient | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const { data: pets } = useQuery({ queryKey: ["admin", "all-pets"], queryFn: getAllPets });

  const resultados = useMemo(() => {
    if (!q.trim()) return [];
    const map = new Map<string, PickedClient>();
    for (const p of pets ?? []) {
      if (!p.owner) continue;
      let entry = map.get(p.owner.id);
      if (!entry) {
        entry = {
          id: p.owner.id,
          name: formatFullName(p.owner.firstName, p.owner.lastName),
          petNames: [],
        };
        map.set(p.owner.id, entry);
      }
      entry.petNames.push(formatName(p.name));
    }
    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    return filtrarPorBusqueda(list, q, (o) => ({ textos: [o.name, ...o.petNames] })).slice(0, 20);
  }, [pets, q]);

  if (value) {
    return (
      <TouchableOpacity
        style={styles.selectedRow}
        onPress={() => {
          onChange(null);
          setQ("");
        }}
        activeOpacity={0.7}
      >
        <Ionicons name="person-circle" size={20} color={COLORS.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.selectedText}>{value.name}</Text>
          {value.petNames.length > 0 && (
            <Text style={styles.rowSubText}>🐾 {value.petNames.join(", ")}</Text>
          )}
        </View>
        <Text style={styles.changeText}>Cambiar</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={16} color={COLORS.textDisabled} />
        <TextInput
          style={styles.searchInput}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textDisabled}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
        />
      </View>
      {q.trim().length > 0 && (
        <View style={styles.listBox}>
          {resultados.length === 0 ? (
            <Text style={styles.emptyText}>Sin coincidencias</Text>
          ) : (
            resultados.map((o) => {
              const perro = o.petNames.find((n) => coincideBusqueda(q, { textos: [n] }));
              return (
                <TouchableOpacity
                  key={o.id}
                  style={styles.row}
                  onPress={() => onChange(o)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowText}>{o.name}</Text>
                    <Text style={styles.rowSubText}>
                      🐾 {perro ? `${perro} · ` : ""}
                      {o.petNames.filter((n) => n !== perro).join(", ")}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
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
  selectedText: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: COLORS.textPrimary },
  changeText: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: COLORS.primary },
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
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.borderLight,
  },
  rowText: { fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: COLORS.textPrimary },
  rowSubText: {
    fontSize: 12,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    color: COLORS.textTertiary,
    padding: 14,
    textAlign: "center",
  },
});
