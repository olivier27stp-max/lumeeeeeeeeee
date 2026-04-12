import React, { useState } from 'react';

const BG = ['#dbeafe','#fef3c7','#d1fae5','#f1f5f9','#e5e7eb','#ccfbf1','#ffedd5','#f1f5f9'];
const FG = ['#1e40af','#92400e','#065f46','#374151','#374151','#115e59','#9a3412','#334155'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

function avatarUrl(seed: string, size: number) {
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&size=${size * 2}&backgroundColor=f5f5f5&radius=50`;
}

interface UnifiedAvatarProps {
  /** Stable unique id — same id = same avatar everywhere */
  id: string;
  /** Display name for initials fallback */
  name: string;
  /** Pixel size (default 40) */
  size?: number;
}

export default function UnifiedAvatar({ id, name, size = 40 }: UnifiedAvatarProps) {
  const [ok, setOk] = useState(false);
  const [fail, setFail] = useState(false);
  const seed = id || name || 'x';
  const idx = hash(seed) % BG.length;
  const initials = name.split(' ').map(w => w?.[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

  return (
    <div className="relative rounded-full shrink-0 overflow-hidden" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full flex items-center justify-center font-bold"
        style={{ fontSize: size * 0.35, backgroundColor: BG[idx], color: FG[idx] }}>
        {initials}
      </div>
      {!fail && (
        <img
          src={avatarUrl(seed, size)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          className="absolute inset-0 rounded-full"
          style={{ width: size, height: size, opacity: ok ? 1 : 0, transition: 'opacity 0.15s' }}
          onLoad={() => setOk(true)}
          onError={() => setFail(true)}
        />
      )}
    </div>
  );
}
