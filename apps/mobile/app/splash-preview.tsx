import { SplashPreview } from "@/components/splash/SplashPreview";

/**
 * Ruta de desarrollo para previsualizar y afinar el splash de forma AISLADA.
 *
 * Cómo abrirla:
 *   • Simulador iOS:  npx uri-scheme open "holidoginn://splash-preview" --ios
 *   • Emulador Android: npx uri-scheme open "holidoginn://splash-preview" --android
 *   • Navegador (web): npx expo start --web  →  http://localhost:8081/splash-preview
 *
 * Borrar este archivo (y SplashPreview.tsx) antes de publicar si no quieres
 * que la ruta exista en producción.
 */
export default function SplashPreviewRoute() {
  return <SplashPreview />;
}
