/**
 * Crédits Lumi à l'écran (2026-09-30) : le compteur discret de l'onglet Lumi
 * (« 742 / 1 000 crédits Lumi · renouvellement le 12 nov. » + une fine barre)
 * et l'avis à 80 % / 100 %.
 *
 * Règle du propriétaire : AUCUN montant en dollars d'IA au client, nulle part
 * — ni coût par réponse, ni équivalence « 1 crédit = X $ ». Ces composants ne
 * reçoivent que des crédits, et tous leurs libellés viennent de
 * `src/lib/lumi/credits.ts` (mêmes gabarits que le web).
 */
import { Text, View } from 'react-native';

import {
  creditsEpuises,
  libelleAvis,
  libellesCompteur,
  type EtatCredits,
  type LangueCredits,
} from '../../lib/lumi/credits';
import { useThemeLumi } from '../../lib/lumi/theme';
import { IconeLumi } from './IconeLumi';

/**
 * Compteur discret : crédits restants sur le total, date de renouvellement, et
 * une barre fine de ce qui RESTE (pas de ce qui est consommé).
 */
export function CompteurCreditsLumi({ credits, langue }: { credits: EtatCredits; langue: LangueCredits }) {
  const { c } = useThemeLumi();
  const l = libellesCompteur(credits, langue);
  const epuise = creditsEpuises(credits);
  const bas = credits.avertissement === '80';
  const teinte = epuise ? c.danger : bas ? c.attente : c.lumi;

  return (
    <View style={{ minWidth: 190, maxWidth: 260, gap: 3 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <IconeLumi nom="lumi" couleur={teinte} taille={11} />
        <Text
          numberOfLines={1}
          style={{ fontSize: 10.5, color: c.texteTenu, fontVariant: ['tabular-nums'] }}
        >
          <Text style={{ color: epuise ? c.danger : c.texteDoux, fontWeight: '600' }}>{l.compteur}</Text>
          {` · ${l.renouvellement}`}
        </Text>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={l.barLabel}
        accessibilityValue={{ min: 0, max: Math.max(0, Math.floor(credits.total)), now: Math.max(0, Math.floor(credits.restants)), text: l.barValue }}
        style={{ height: 2, borderRadius: 1, backgroundColor: c.creux, overflow: 'hidden' }}
      >
        <View style={{ width: `${l.pctRestant}%`, height: '100%', borderRadius: 1, backgroundColor: teinte }} />
      </View>
    </View>
  );
}

/**
 * Avis de crédits : à 80 % (« Il te reste 150 crédits Lumi jusqu'au 12 nov. »)
 * et à 100 % (épuisé — les actions rapides et le reste de Lume continuent).
 * Rien sous 80 %.
 */
export function AvisCreditsLumi({ credits, langue }: { credits: EtatCredits | null | undefined; langue: LangueCredits }) {
  const { c } = useThemeLumi();
  const texte = libelleAvis(credits, langue);
  if (!texte) return null;
  const epuise = creditsEpuises(credits);

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: epuise ? c.danger : c.attente,
        backgroundColor: epuise ? c.dangerFond : c.attenteFond,
      }}
    >
      <View style={{ marginTop: 1 }}>
        <IconeLumi nom="alerte" couleur={epuise ? c.danger : c.attente} taille={13} />
      </View>
      <Text style={{ flex: 1, fontSize: 12, lineHeight: 17, color: epuise ? c.danger : c.texte }}>{texte}</Text>
    </View>
  );
}
