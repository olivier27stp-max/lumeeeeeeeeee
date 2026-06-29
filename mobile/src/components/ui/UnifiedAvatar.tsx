import { useState } from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';

// Mirror of the web component (src/components/ui/UnifiedAvatar.tsx) so the same
// `id` produces the same "petit bonhomme" everywhere — web and mobile share the
// DiceBear "notionists" universe. Web renders the SVG endpoint; RN can't render
// remote SVG without react-native-svg, so we use DiceBear's PNG endpoint via
// expo-image. Same seed → same character. Falls back to colored initials.

const BG = ['#dbeafe', '#fef3c7', '#d1fae5', '#f1f5f9', '#e5e7eb', '#ccfbf1', '#ffedd5', '#f1f5f9'];
const FG = ['#1e40af', '#92400e', '#065f46', '#374151', '#374151', '#115e59', '#9a3412', '#334155'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function avatarUrl(seed: string, size: number): string {
  return `https://api.dicebear.com/9.x/notionists/png?seed=${encodeURIComponent(
    seed,
  )}&size=${Math.min(256, Math.round(size * 2))}&backgroundColor=f5f5f5&radius=50`;
}

interface UnifiedAvatarProps {
  /** Stable unique id — same id = same avatar everywhere */
  id: string;
  /** Display name for initials fallback */
  name: string;
  /** Pixel size (default 40) */
  size?: number;
  /** Real uploaded photo URL — overrides the generated DiceBear avatar when set. */
  url?: string | null;
}

export default function UnifiedAvatar({ id, name, size = 40, url }: UnifiedAvatarProps) {
  const [failed, setFailed] = useState(false);
  const seed = id || name || 'x';
  const src = url && url.length > 0 ? url : avatarUrl(seed, size);
  const idx = hash(seed) % BG.length;
  const initials =
    name
      ?.split(' ')
      .map((w) => w?.[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';

  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}
      className="shrink-0"
    >
      {/* Initials sit underneath as the fallback while the image loads / on error */}
      <View
        style={{ backgroundColor: BG[idx] }}
        className="absolute inset-0 items-center justify-center"
      >
        <Text style={{ fontSize: size * 0.35, color: FG[idx] }} className="font-bold">
          {initials}
        </Text>
      </View>
      {!failed ? (
        <Image
          source={{ uri: src }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(true)}
          cachePolicy="memory-disk"
        />
      ) : null}
    </View>
  );
}
