import { COLORS } from "@/constants/colors";
import { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
  ListRenderItemInfo,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";

const { width } = Dimensions.get("window");

export const TOUR_SEEN_KEY = "welcome-tour-seen";

type Slide = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

const SLIDES: Slide[] = [
  {
    icon: "calendar-outline",
    title: "Reserva en segundos",
    body: "Elige fechas, mascota y servicios. Hotel o baño, todo desde la app.",
  },
  {
    icon: "document-attach-outline",
    title: "Sube la cartilla",
    body: "Necesitamos las vacunas al día para cuidar a todos los peludos. Súbela una vez y listo.",
  },
  {
    icon: "paw-outline",
    title: "Trae a tu peludo",
    body: "Trae su comida etiquetada por día, juguete favorito y manta. Nosotros nos encargamos del resto.",
  },
  {
    icon: "chatbubbles-outline",
    title: "Recibe seguimiento",
    body: "Fotos, videos y reportes diarios para que nunca pierdas el rastro de cómo le va.",
  },
];

export default function WelcomeTourScreen() {
  const router = useRouter();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);

  const finish = async () => {
    await SecureStore.setItemAsync(TOUR_SEEN_KEY, "1").catch(() => {});
    router.replace("/(tabs)/home" as any);
  };

  const next = () => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      finish();
    }
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  const renderSlide = ({ item }: ListRenderItemInfo<Slide>) => (
    <View style={styles.slide}>
      <View style={styles.iconWrap}>
        <Ionicons name={item.icon} size={64} color={COLORS.primary} />
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.body}>{item.body}</Text>
    </View>
  );

  return (
    <View style={styles.container} testID="welcome-tour-screen">
      <TouchableOpacity onPress={finish} style={styles.skip} hitSlop={12}>
        <Text style={styles.skipText}>Saltar</Text>
      </TouchableOpacity>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.title}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      />

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>

      <TouchableOpacity style={styles.nextButton} onPress={next} activeOpacity={0.85}>
        <Text style={styles.nextButtonText}>
          {index < SLIDES.length - 1 ? "Siguiente" : "Empezar"}
        </Text>
        <Ionicons
          name={index < SLIDES.length - 1 ? "arrow-forward" : "checkmark"}
          size={18}
          color={COLORS.white}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPage,
  },
  skip: {
    position: "absolute",
    top: 60,
    right: 24,
    zIndex: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  skipText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  slide: {
    width,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: COLORS.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.textPrimary,
    textAlign: "center",
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 320,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.borderLight,
  },
  dotActive: {
    backgroundColor: COLORS.primary,
    width: 22,
  },
  nextButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    marginHorizontal: 24,
    marginBottom: 40,
    borderRadius: 12,
  },
  nextButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
});
