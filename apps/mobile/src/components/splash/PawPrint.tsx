import Svg, { Ellipse, Path, G } from "react-native-svg";

interface Props {
  size?: number;
  color?: string;
}

/**
 * Huella de perro (paw print) recreada como vector.
 * Cumple el rol de la "o" de «dog» en el logotipo de Holidog Inn.
 *
 * Dibujada en un viewBox 0 0 100 100 con relleno sólido, de modo que escala
 * nítida a cualquier tamaño. El color es configurable (naranja de marca por
 * defecto). No anima por sí misma: el bounce vive en <AnimatedSplash />.
 */
export function PawPrint({ size = 64, color = "#E89A2C" }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Almohadilla principal */}
      <Path
        d="M50 47c14.2 0 25 11 25 25 0 11.6-11 18.5-25 18.5S25 83.6 25 72c0-14 10.8-25 25-25Z"
        fill={color}
      />
      {/* Dedos (de izquierda a derecha) */}
      <G rotation={-24} originX={20} originY={45}>
        <Ellipse cx={20} cy={45} rx={8.4} ry={11.8} fill={color} />
      </G>
      <G rotation={-9} originX={40} originY={28}>
        <Ellipse cx={40} cy={28} rx={9} ry={13} fill={color} />
      </G>
      <G rotation={9} originX={60} originY={28}>
        <Ellipse cx={60} cy={28} rx={9} ry={13} fill={color} />
      </G>
      <G rotation={24} originX={80} originY={45}>
        <Ellipse cx={80} cy={45} rx={8.4} ry={11.8} fill={color} />
      </G>
    </Svg>
  );
}
