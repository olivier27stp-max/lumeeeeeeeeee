/**
 * Le p'tit robot de Lumi.
 *
 * Dessiné en SVG plutôt que chargé depuis un fichier : le web référence
 * `/agent/lumi-poster.png`, qui **n'existe ni dans le dépôt ni en ligne**
 * (404) — l'avatar de Lumi y est une image cassée que personne n'a vue parce
 * qu'elle porte `alt=""`. Rien à copier, donc.
 *
 * Il suit le reste de l'app : trait monochrome à l'encre `#171717`, bouts
 * arrondis, comme les icônes d'onglets et la mascotte Lume. Il prend la
 * couleur qu'on lui donne, donc il marche aussi en thème sombre.
 *
 * `react-native-svg` est déjà une dépendance : aucun module natif de plus.
 */
import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export function RobotLumi({ couleur, taille = 24 }: { couleur: string; taille?: number }) {
  // Le trait s'affine quand le robot grossit, pour qu'il garde le même poids
  // visuel à 18 px (en-tête) comme à 56 px (état vide).
  const trait = taille >= 44 ? 1.4 : taille >= 28 ? 1.6 : 1.8;
  return (
    <Svg width={taille} height={taille} viewBox="0 0 24 24" fill="none">
      {/* antenne */}
      <Circle cx="12" cy="2.6" r="1.25" fill={couleur} />
      <Path d="M12 3.85V6" stroke={couleur} strokeWidth={trait} strokeLinecap="round" />
      {/* oreilles */}
      <Path d="M3 11.5v2.4M21 11.5v2.4" stroke={couleur} strokeWidth={trait} strokeLinecap="round" />
      {/* tête */}
      <Rect x="5" y="6" width="14" height="12.5" rx="4.2" stroke={couleur} strokeWidth={trait} />
      {/* yeux */}
      <Circle cx="9.4" cy="11.2" r="1.15" fill={couleur} />
      <Circle cx="14.6" cy="11.2" r="1.15" fill={couleur} />
      {/* sourire */}
      <Path d="M9.7 14.6c.7.7 3.9.7 4.6 0" stroke={couleur} strokeWidth={trait} strokeLinecap="round" />
    </Svg>
  );
}
