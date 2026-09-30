/**
 * Les icônes de Lumi, sur les deux plateformes.
 *
 * ⚠️ Piège d'`expo-symbols` : avec `name="house"` (une chaîne SF Symbol),
 * l'implémentation Android fait `typeof props.name === 'object'` → faux →
 * `name = null` → elle rend `props.fallback`, donc RIEN. Un nom de symbole
 * simple ne dessine un icône que sur iOS.
 *
 * Pour qu'un icône existe sur Android, il faut la forme objet
 * `{ ios: <SF Symbol>, android: <Material Symbol> }`. C'est ce que fait cette
 * table : un nom métier d'un côté, les deux noms de plateforme de l'autre.
 *
 * (Le reste de l'app passe des chaînes simples et n'a donc aucun icône sur
 * Android — c'est antérieur à Lumi et signalé à part.)
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import React from 'react';
import type { ColorValue } from 'react-native';

export type NomIconeLumi =
  | 'lumi' | 'historique' | 'bouclier' | 'nouvelle' | 'bas' | 'haut'
  | 'micro' | 'stop' | 'sonOn' | 'sonOff' | 'onde'
  | 'fermer' | 'annule' | 'poubelle' | 'alerte'
  | 'chevronHaut' | 'chevronBas'
  | 'document' | 'telecharger' | 'envoyer' | 'courriel' | 'texto'
  | 'job' | 'tache' | 'client' | 'crayon' | 'fusion';

const TABLE: Record<NomIconeLumi, { ios: SymbolViewProps['name']; android: string }> = {
  lumi: { ios: 'sparkles', android: 'auto_awesome' },
  historique: { ios: 'clock.arrow.circlepath', android: 'history' },
  bouclier: { ios: 'shield', android: 'shield' },
  nouvelle: { ios: 'square.and.pencil', android: 'edit_square' },
  bas: { ios: 'arrow.down', android: 'arrow_downward' },
  haut: { ios: 'arrow.up', android: 'arrow_upward' },
  micro: { ios: 'mic', android: 'mic' },
  stop: { ios: 'stop.fill', android: 'stop' },
  sonOn: { ios: 'speaker.wave.2', android: 'volume_up' },
  sonOff: { ios: 'speaker.slash', android: 'volume_off' },
  onde: { ios: 'waveform', android: 'graphic_eq' },
  fermer: { ios: 'xmark', android: 'close' },
  annule: { ios: 'xmark.circle', android: 'cancel' },
  poubelle: { ios: 'trash', android: 'delete' },
  alerte: { ios: 'exclamationmark.triangle', android: 'warning' },
  chevronHaut: { ios: 'chevron.up', android: 'keyboard_arrow_up' },
  chevronBas: { ios: 'chevron.down', android: 'keyboard_arrow_down' },
  document: { ios: 'doc.text', android: 'description' },
  telecharger: { ios: 'square.and.arrow.down', android: 'download' },
  envoyer: { ios: 'paperplane', android: 'send' },
  courriel: { ios: 'envelope', android: 'mail' },
  texto: { ios: 'message', android: 'chat' },
  job: { ios: 'briefcase', android: 'work' },
  tache: { ios: 'checkmark.square', android: 'check_box' },
  client: { ios: 'person.badge.plus', android: 'person_add' },
  crayon: { ios: 'pencil', android: 'edit' },
  fusion: { ios: 'arrow.triangle.merge', android: 'merge' },
};

export function IconeLumi({ nom, couleur, taille = 16 }: { nom: NomIconeLumi; couleur: ColorValue; taille?: number }) {
  const n = TABLE[nom];
  return (
    <SymbolView
      name={{ ios: n.ios as never, android: n.android as never }}
      tintColor={couleur}
      size={taille}
      resizeMode="scaleAspectFit"
    />
  );
}
