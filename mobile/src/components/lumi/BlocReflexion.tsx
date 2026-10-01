/**
 * « Lumi réfléchit… » — le bloc repliable qui montre ce que Lumi consulte,
 * porté du web (le `<details class="lumi-think">` de src/pages/Lumi.tsx).
 *
 * Il sert à deux choses : rassurer pendant l'attente, et rendre le travail
 * VÉRIFIABLE après coup (quels outils, combien de temps, combien ça a coûté).
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { DisqueLumi, TexteAnime, useAnimationsReduites } from './AnimationsLumi';

import type { UsageLumi } from '@/lib/api/lumi';
import { fmtTokens, libelleOutil, nomModele } from '@/lib/lumi/libelles';
import { useThemeLumi } from '@/lib/lumi/theme';
import { IconeLumi } from './IconeLumi';

export function BlocReflexion({
  reflechit,
  etapes,
  actifs,
  secondes,
  usage,
  interne,
  fr,
}: {
  reflechit: boolean;
  /** Outils déjà finis + ceux en cours, dans l'ordre. */
  etapes: string[];
  actifs: string[];
  secondes: number | null;
  usage?: UsageLumi;
  /** Compte interne (@lume-test.ca) : voit le modèle et les tokens. Un client ne voit que le coût. */
  interne: boolean;
  fr: boolean;
}) {
  const { c } = useThemeLumi();
  const reduit = useAnimationsReduites();
  // Ouvert pendant la réflexion, replié ensuite — comme au web.
  const [ouvertManuel, setOuvertManuel] = useState<boolean | null>(null);
  const ouvert = ouvertManuel ?? reflechit;

  return (
    <View style={{ marginBottom: 8 }}>
      <Pressable
        onPress={() => etapes.length > 0 && setOuvertManuel(!ouvert)}
        disabled={etapes.length === 0}
        accessibilityRole="button"
        accessibilityState={{ expanded: ouvert }}
        accessibilityLabel={reflechit ? (fr ? 'Lumi réfléchit' : 'Lumi is thinking') : fr ? 'Détail de la réflexion' : 'Thinking details'}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 }}
      >
        <DisqueLumi actif={reflechit} couleur={c.lumi} reduit={reduit} />
        <TexteAnime actif={reflechit} reduit={reduit} style={{ fontSize: 12.5, fontWeight: '500', color: reflechit ? c.lumi : c.texteDoux }}>
          {reflechit ? (fr ? 'Lumi réfléchit…' : 'Lumi is thinking…') : `${fr ? 'Réflexion' : 'Thinking'}${secondes ? ` · ${secondes} s` : ''}`}
        </TexteAnime>
        {/* Aucun montant d'IA au client (2026-09-30) : le détail technique ne
            s'affiche que sur un compte interne, et sans coût. L'usage du client
            se lit dans le compteur de crédits, en haut de l'écran. */}
        {!reflechit && !!usage && interne && (
          <Text style={{ fontSize: 11, color: c.texteTenu }}>
            {`· ${nomModele(usage.model)} · ${fmtTokens(usage.input_tokens, fr)} → ${fmtTokens(usage.output_tokens, fr)} tokens`}
          </Text>
        )}
        {etapes.length > 0 && (
          <IconeLumi nom={ouvert ? 'chevronHaut' : 'chevronBas'} couleur={c.texteTenu} taille={11} />
        )}
      </Pressable>

      {ouvert && etapes.length > 0 && (
        <View style={{ marginLeft: 6, marginTop: 6, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: c.bordure, gap: 3 }}>
          {etapes.map((n) => (
            <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {actifs.includes(n) && <ActivityIndicator size="small" color={c.texteTenu} />}
              <Text style={{ fontSize: 12.5, color: c.texteTenu }}>{libelleOutil(n, fr)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
