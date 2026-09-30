// EXACT copies of the web app's entity identity icons (lucide-react 0.546).
// The web renders these through EntityHubHeader on every detail page:
// job → Briefcase, quote → FileText, client → Users; invoice takes the
// main nav's Finances glyph (Wallet) rather than the detail page's.
// Paths lifted verbatim from node_modules/lucide-react/dist/esm/icons/*.js —
// same viewBox, same commands. Do not "improve" them: parity with the web is
// the point. Lucide defaults are stroke-width 2, round caps and joins.

import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

type P = { color: string; size?: number };

const BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Jobs — lucide `briefcase` */
export function IconJob({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <Rect width={20} height={14} x={2} y={6} rx={2} />
    </Svg>
  );
}

/** Clients — lucide `users` */
export function IconClient({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <Path d="M16 3.128a4 4 0 0 1 0 7.744" />
      <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <Circle cx={9} cy={7} r={4} />
    </Svg>
  );
}

/** Quotes — lucide `file-text` */
export function IconQuote({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <Path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <Path d="M10 9H8" />
      <Path d="M16 13H8" />
      <Path d="M16 17H8" />
    </Svg>
  );
}

/** Invoices — lucide `wallet`, the Finances entry in the web's main nav
 *  (App.tsx: { id: 'finances', icon: Wallet }). Chosen over `receipt-text`
 *  because the sidebar is what the user actually reads every day. */
export function IconInvoice({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <Path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </Svg>
  );
}

// ── Remaining search entities ────────────────────────────────────────────
// The web's global search labels every result type with its own glyph
// (GlobalSearch.tsx ENTITY_ICONS). Same lucide names, same paths.

/** Properties — lucide `map-pin` */
export function IconProperty({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <Circle cx={12} cy={10} r={3} />
    </Svg>
  );
}

/** Agreements — lucide `file-signature` (an alias of `file-pen-line`) */
export function IconAgreement({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Path d="m18 5-2.414-2.414A2 2 0 0 0 14.172 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2" />
      <Path d="M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
      <Path d="M8 18h1" />
    </Svg>
  );
}

/** Payments — lucide `credit-card` */
export function IconPayment({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Rect width={20} height={14} x={2} y={5} rx={2} />
      <Line x1={2} x2={22} y1={10} y2={10} />
    </Svg>
  );
}

/** Leads — lucide `contact` */
export function IconLead({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Path d="M16 2v2" />
      <Path d="M7 22v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
      <Path d="M8 2v2" />
      <Circle cx={12} cy={11} r={3} />
      <Rect x={3} y={4} width={18} height={18} rx={2} />
    </Svg>
  );
}

/** Requests — lucide `inbox` */
export function IconRequest({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <Path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </Svg>
  );
}

/** Teams — lucide `users-round` */
export function IconTeam({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Path d="M18 21a8 8 0 0 0-16 0" />
      <Circle cx={10} cy={8} r={5} />
      <Path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
    </Svg>
  );
}

/** Calendar events — lucide `calendar` */
export function IconEvent({ color, size = 18 }: P) {
  return (
    <Svg width={size} height={size} stroke={color} {...BASE}>
      <Path d="M8 2v4" />
      <Path d="M16 2v4" />
      <Rect width={18} height={18} x={3} y={4} rx={2} />
      <Path d="M3 10h18" />
    </Svg>
  );
}
