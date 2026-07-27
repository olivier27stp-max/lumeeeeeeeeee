// EXACT copies of the web D2D toolbar's inline SVGs (map-container.tsx
// 1802-1905 on main). Same viewBox, paths, stroke widths — only the color is
// injected. Do not "improve" these: pixel parity with the web is the point.

import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';

type P = { color: string; size?: number };

/** Box 1 — add a pin */
export function IconPin({ color, size = 19 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <Circle cx={12} cy={10} r={3} />
    </Svg>
  );
}

/** Box 2 — filter funnel */
export function IconFunnel({ color, size = 19 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </Svg>
  );
}

/** Box 3 — search loupe */
export function IconSearch({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={11} cy={11} r={7} />
      <Line x1={21} y1={21} x2={16.65} y2={16.65} />
    </Svg>
  );
}

/** Box 4 — drawing hand (zone creation) */
export function IconDrawHand({ color, size = 19 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 5.5c1-2 4-3.2 6-2.7" strokeDasharray="1 2.6" />
      <Path d="M22 14a8 8 0 0 1-8 8" />
      <Path d="M18 11v-1a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
      <Path d="M14 10V9a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1" />
      <Path d="M10 9.5V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v10" />
      <Path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </Svg>
  );
}

/** Box 5 — dashed selection rectangle */
export function IconSelectRect({ color, size = 19 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 3a2 2 0 0 0-2 2" />
      <Path d="M19 3a2 2 0 0 1 2 2" />
      <Path d="M21 19a2 2 0 0 1-2 2" />
      <Path d="M5 21a2 2 0 0 1-2-2" />
      <Path d="M9 3h1" />
      <Path d="M9 21h1" />
      <Path d="M14 3h1" />
      <Path d="M14 21h1" />
      <Path d="M3 9v1" />
      <Path d="M3 14v1" />
      <Path d="M21 9v1" />
      <Path d="M21 14v1" />
    </Svg>
  );
}

/** Box 6 — folded map (plan / satellite toggle) */
export function IconFoldedMap({ color, size = 19 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <Path d="M15 5.764v15" />
      <Path d="M9 3.236v15" />
    </Svg>
  );
}

/** Box 7 — compass rose: ring + ticks + red north needle. Rotate via the
 * parent's transform with the map bearing, like the web. */
export function IconCompass({ color, size = 27 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9.5} fill="none" stroke={color} strokeWidth={1.4} />
      <Path d="M12 3.6v1.5M12 18.9v1.5M3.6 12h1.5M18.9 12h1.5" stroke={color} strokeWidth={1.1} strokeLinecap="round" />
      <Path d="M12 5.6l2.1 6.4H9.9z" fill="#dc2626" />
      <Path d="M12 18.4L9.9 12h4.2z" fill={color} />
      <Circle cx={12} cy={12} r={1.1} fill="white" stroke={color} strokeWidth={0.7} />
    </Svg>
  );
}
