/**
 * Les animations de Lumi — portage des keyframes CSS du web
 * (bloc `LUMI_CSS` dans src/pages/Lumi.tsx) avec react-native-reanimated,
 * déjà une dépendance : aucun module natif de plus.
 *
 *   .lumi-disc.live   → DisqueLumi   : anneau qui tourne, 0,9 s linéaire
 *   .lumi-disc.done   → DisqueLumi   : anneau plein avec un point au centre
 *   .lumi-halo        → HaloLumi     : halo qui enfle et s'efface, 1,4 s
 *   .lumi-shimmer     → TexteAnime   : le libellé qui scintille, 1,6 s
 *
 * Comme le web (`@media (prefers-reduced-motion: reduce)`), tout s'arrête si
 * la personne a demandé de réduire les animations dans les réglages du
 * téléphone — l'état reste lisible, il ne bouge simplement plus.
 */
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** Vrai si la personne a activé « Réduire les animations ». */
export function useAnimationsReduites(): boolean {
  const [reduit, setReduit] = useState(false);
  useEffect(() => {
    let vivant = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (vivant) setReduit(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduit);
    return () => {
      vivant = false;
      sub.remove();
    };
  }, []);
  return reduit;
}

/* ── .lumi-disc : l'anneau de la ligne « Lumi réfléchit » ──────────────── */

export function DisqueLumi({ actif, couleur, reduit }: { actif: boolean; couleur: string; reduit: boolean }) {
  const angle = useSharedValue(0);

  useEffect(() => {
    if (actif && !reduit) {
      angle.value = 0;
      // 0,9 s, linéaire, en boucle — exactement `lumi-spin`.
      angle.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(angle);
      angle.value = 0;
    }
    return () => cancelAnimation(angle);
  }, [actif, reduit, angle]);

  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));

  // Terminé : l'anneau est plein et porte un point au centre (le radial-gradient du web).
  if (!actif) {
    return (
      <View
        style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: couleur, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: couleur }} />
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        {
          width: 14,
          height: 14,
          borderRadius: 7,
          borderWidth: 2,
          // Le quart supérieur est opaque, le reste à 25 % : c'est ce qui donne
          // l'impression de rotation.
          borderColor: `${couleur}40`,
          borderTopColor: couleur,
        },
        anim,
      ]}
    />
  );
}

/* ── .lumi-halo : le halo autour du robot pendant qu'il réfléchit ──────── */

export function HaloLumi({ actif, couleur, taille, reduit, children }: {
  actif: boolean;
  couleur: string;
  /** Diamètre de ce qu'on entoure. */
  taille: number;
  reduit: boolean;
  children: React.ReactNode;
}) {
  const p = useSharedValue(0);

  useEffect(() => {
    if (actif && !reduit) {
      p.value = 0;
      p.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }), -1, false);
    } else {
      cancelAnimation(p);
      p.value = 0;
    }
    return () => cancelAnimation(p);
  }, [actif, reduit, p]);

  // RN n'anime pas l'étalement d'une ombre : on fait enfler un anneau qui
  // s'efface — même lecture que le box-shadow 0 → 9 px du web.
  const anim = useAnimatedStyle(() => ({
    opacity: actif ? 0.55 * (1 - p.value) : 0,
    transform: [{ scale: 1 + p.value * 1.25 }],
  }));

  return (
    <View style={{ width: taille, height: taille, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', width: taille, height: taille, borderRadius: taille / 2, backgroundColor: couleur },
          anim,
        ]}
      />
      {children}
    </View>
  );
}

/* ── .lumi-shimmer : le libellé qui scintille ──────────────────────────── */

export function TexteAnime({ actif, reduit, style, children }: {
  actif: boolean;
  reduit: boolean;
  style?: TextStyle;
  children: React.ReactNode;
}) {
  const o = useSharedValue(1);

  useEffect(() => {
    if (actif && !reduit) {
      o.value = 1;
      o.value = withRepeat(withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      cancelAnimation(o);
      o.value = 1;
    }
    return () => cancelAnimation(o);
  }, [actif, reduit, o]);

  const anim = useAnimatedStyle(() => ({ opacity: o.value }));

  return (
    <Animated.View style={anim}>
      <Text style={style}>{children}</Text>
    </Animated.View>
  );
}
