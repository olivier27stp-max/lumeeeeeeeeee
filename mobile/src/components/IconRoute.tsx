// EXACT copy of the icon the DESKTOP route panel uses — lucide-react's <Route>
// (src/components/schedule/AgendaRoutePanel.tsx line 217 on main). Same viewBox,
// same nodes, same stroke width; only the colour and size are injected.
// Do not redraw it: sharing the desktop's glyph is the point.

import Svg, { Circle, Path } from 'react-native-svg';

export function IconRoute({ color, size = 17 }: { color: string; size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Circle cx={6} cy={19} r={3} />
      <Path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <Circle cx={18} cy={5} r={3} />
    </Svg>
  );
}
