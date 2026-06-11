import Svg, { Ellipse, Path, Circle, G } from "react-native-svg";

interface Props {
  width?: number;
  height?: number;
  color?: string;
  /** Grosor del trazo en unidades del viewBox (ancho 200). */
  strokeWidth?: number;
}

/** Huellita decorativa diminuta sobre el borde de la cama. */
function MiniPaw({
  x,
  y,
  s,
  color,
}: {
  x: number;
  y: number;
  s: number;
  color: string;
}) {
  return (
    <G translateX={x} translateY={y}>
      <Ellipse cx={0} cy={2.4 * s} rx={2.7 * s} ry={2.2 * s} fill={color} />
      <Circle cx={-2.5 * s} cy={0.2 * s} r={1.2 * s} fill={color} />
      <Circle cx={-0.9 * s} cy={-1.3 * s} r={1.2 * s} fill={color} />
      <Circle cx={0.9 * s} cy={-1.3 * s} r={1.2 * s} fill={color} />
      <Circle cx={2.5 * s} cy={0.2 * s} r={1.2 * s} fill={color} />
    </G>
  );
}

/**
 * Cama para perro (pet bed) recreada como vector, solo contorno (outline).
 * Es la pieza que se "llena" de abajo hacia arriba en el splash: el efecto de
 * fill se logra recortando este SVG con una ventana animada en
 * <AnimatedSplash />, así que aquí solo describimos la forma final.
 *
 * viewBox 0 0 200 130 — borde ovalado + cuenco + huellitas decorativas.
 */
export function DogBed({
  width = 150,
  height = 96,
  color = "#E89A2C",
  strokeWidth = 5,
}: Props) {
  return (
    <Svg width={width} height={height} viewBox="0 0 200 130">
      {/* Cuerpo/cuenco (paredes + base) */}
      <Path
        d="M6 44 C6 82 30 112 100 112 C170 112 194 82 194 44"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Borde exterior */}
      <Ellipse
        cx={100}
        cy={42}
        rx={94}
        ry={26}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
      />
      {/* Abertura interior (grosor del borde) */}
      <Ellipse
        cx={100}
        cy={47}
        rx={66}
        ry={15}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
      />
      {/* Huellitas decorativas sobre el frente */}
      <MiniPaw x={56} y={84} s={2.1} color={color} />
      <MiniPaw x={100} y={92} s={2.1} color={color} />
      <MiniPaw x={144} y={84} s={2.1} color={color} />
    </Svg>
  );
}
