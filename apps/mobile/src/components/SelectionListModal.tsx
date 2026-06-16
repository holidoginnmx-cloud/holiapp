import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type SelectionListModalStyles = {
  overlay: any;
  content: any;
  header: any;
  title: any;
  subtitle?: any;
  list?: any;
  listMaxHeight?: number;
  empty: any;
};

export type SelectionListModalProps<T> = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  data: T[] | undefined; // undefined => cargando
  emptyText: string; // si data.length === 0
  keyExtractor: (item: T) => string;
  isItemSelected?: (item: T) => boolean;
  isItemPending?: (item: T) => boolean;
  renderItem: (
    item: T,
    state: { selected: boolean; pending: boolean }
  ) => React.ReactNode;
  variant?: "view" | "pressable"; // 'view' (default) = NO cierra al tocar fuera (admin); 'pressable' = cierra (staff)
  styles: SelectionListModalStyles;
};

export function SelectionListModal<T>(props: SelectionListModalProps<T>) {
  const {
    visible,
    onClose,
    title,
    subtitle,
    data,
    emptyText,
    keyExtractor,
    isItemSelected,
    isItemPending,
    renderItem,
    variant = "view",
    styles,
  } = props;

  const body =
    data === undefined ? (
      <View style={{ paddingVertical: 24, alignItems: "center" }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    ) : data.length === 0 ? (
      <View style={{ paddingVertical: 24, alignItems: "center" }}>
        <Text style={styles.empty}>{emptyText}</Text>
      </View>
    ) : styles.listMaxHeight !== undefined ? (
      <ScrollView
        style={{ maxHeight: styles.listMaxHeight }}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {data.map((it) => (
          <React.Fragment key={keyExtractor(it)}>
            {renderItem(it, {
              selected: isItemSelected?.(it) ?? false,
              pending: isItemPending?.(it) ?? false,
            })}
          </React.Fragment>
        ))}
      </ScrollView>
    ) : (
      <View style={styles.list}>
        {data.map((it) => (
          <React.Fragment key={keyExtractor(it)}>
            {renderItem(it, {
              selected: isItemSelected?.(it) ?? false,
              pending: isItemPending?.(it) ?? false,
            })}
          </React.Fragment>
        ))}
      </View>
    );

  const inner = (
    <>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={22} color={COLORS.textTertiary} />
        </TouchableOpacity>
      </View>
      {subtitle !== undefined ? (
        <Text style={styles.subtitle}>{subtitle}</Text>
      ) : null}
      {body}
    </>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {variant === "pressable" ? (
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable
            style={styles.content}
            onPress={(e) => e.stopPropagation()}
          >
            {inner}
          </Pressable>
        </Pressable>
      ) : (
        <View style={styles.overlay}>
          <View style={styles.content}>{inner}</View>
        </View>
      )}
    </Modal>
  );
}
