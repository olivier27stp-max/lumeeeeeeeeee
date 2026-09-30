/**
 * Rendu du texte de Lumi — le portage exact du renderer du web
 * (`TexteLumi` dans src/pages/Lumi.tsx).
 *
 * Le modèle écrit un peu de Markdown ; l'afficher brut (étoiles, dièses,
 * barres |) fait « brouillon » — un tableau de forfaits ressortait en bouillie
 * de |. On gère donc le même sous-ensemble, sans bibliothèque : gras (**x**),
 * puces (- x), titres (### x) et tableaux Markdown.
 *
 * En plus du web : rien. Les noms qui correspondent à une fiche deviennent
 * cliquables, comme là-bas.
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import type { FicheLumi } from '@/lib/api/lumi';
import { ouvrirFiche, ouvrable } from '@/lib/lumi/deepLinks';
import { useThemeLumi } from '@/lib/lumi/theme';

/** Fiches du message en cours de rendu : les noms qui y correspondent deviennent des liens. */
const FichesCtx = React.createContext<FicheLumi[]>([]);
export const FournisseurFiches = FichesCtx.Provider;

/**
 * Transforme, dans un morceau de texte, les noms qui correspondent à une fiche
 * en liens vers cette fiche. Copié du web (`avecLiensFiches`), avec un filtre
 * en plus : une fiche sans écran mobile ne devient pas un lien mort.
 */
function avecLiensFiches(texte: string, fiches: FicheLumi[], couleurLien: string, cleBase: string): React.ReactNode {
  const utilisables = fiches.filter(ouvrable);
  if (!utilisables.length || !texte) return texte;
  const cles: { cle: string; fiche: FicheLumi }[] = [];
  for (const f of utilisables) {
    const nom = f.label.split(' · ')[0].replace(/^(Devis|Facture|Job #)\s*/i, '').trim();
    if (nom.length >= 3) cles.push({ cle: nom, fiche: f });
    const complet = f.label.split(' · ')[0].trim();
    if (complet !== nom && complet.length >= 3) cles.push({ cle: complet, fiche: f });
  }
  if (!cles.length) return texte;
  const echappe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${cles.map((c) => echappe(c.cle)).sort((x, y) => y.length - x.length).join('|')})`, 'g');
  const parts = texte.split(re);
  if (parts.length === 1) return texte;
  return parts.map((part, i) => {
    const c = cles.find((k) => k.cle === part);
    if (!c) return <React.Fragment key={`${cleBase}-${i}`}>{part}</React.Fragment>;
    return (
      <Text
        key={`${cleBase}-${i}`}
        onPress={() => ouvrirFiche(c.fiche)}
        accessibilityRole="link"
        accessibilityLabel={c.fiche.label}
        style={{ color: couleurLien, textDecorationLine: 'underline' }}
      >
        {part}
      </Text>
    );
  });
}

/** Gras (**x**) + liens de fiches, dans un morceau de ligne. */
function Gras({ texte, cleBase }: { texte: string; cleBase: string }) {
  const { c } = useThemeLumi();
  const fiches = React.useContext(FichesCtx);
  const morceaux = texte.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {morceaux.map((m, i) =>
        i % 2 === 1 ? (
          <Text key={`${cleBase}-g${i}`} style={{ fontWeight: '600' }}>
            {avecLiensFiches(m, fiches, c.lumi, `${cleBase}-g${i}`)}
          </Text>
        ) : (
          <React.Fragment key={`${cleBase}-t${i}`}>{avecLiensFiches(m, fiches, c.lumi, `${cleBase}-t${i}`)}</React.Fragment>
        ),
      )}
    </>
  );
}

/** Découpe une ligne de tableau Markdown en cellules, sans les | de bord. */
function cellulesTableau(ligne: string): string[] {
  return ligne.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
}

/** Une ligne est-elle un séparateur d'en-tête Markdown (|---|:--:|) ? */
function estSeparateurTableau(ligne: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(ligne);
}

/** Un tableau large ne doit jamais faire défiler l'écran : il défile tout seul. */
function TableauLumi({ lignes, cleBase }: { lignes: string[]; cleBase: string }) {
  const { c } = useThemeLumi();
  const entete = cellulesTableau(lignes[0]);
  const corps = lignes.slice(2).map(cellulesTableau);
  const largeur = Math.max(110, Math.round(300 / Math.max(1, entete.length)));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
      <View>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.bordure }}>
          {entete.map((cell, i) => (
            <View key={`${cleBase}-h${i}`} style={{ minWidth: largeur, paddingVertical: 6, paddingRight: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: '500', color: c.texteTenu }}>
                <Gras texte={cell} cleBase={`${cleBase}-h${i}`} />
              </Text>
            </View>
          ))}
        </View>
        {corps.map((rangee, r) => (
          <View key={`${cleBase}-r${r}`} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.bordure }}>
            {rangee.map((cell, i) => (
              <View key={`${cleBase}-r${r}c${i}`} style={{ minWidth: largeur, paddingVertical: 6, paddingRight: 12 }}>
                <Text style={{ fontSize: 13, color: c.texte, fontVariant: ['tabular-nums'] }}>
                  <Gras texte={cell} cleBase={`${cleBase}-r${r}c${i}`} />
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function TexteLumi({ texte }: { texte: string }) {
  const { c } = useThemeLumi();
  const lignes = texte.replace(/\r/g, '').split('\n');
  const blocs: React.ReactNode[] = [];

  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];

    // Tableau Markdown : une rangée | … | suivie d'un séparateur |---|---|.
    const estRangee = /^\s*\|.*\|\s*$/.test(l);
    if (estRangee && i + 1 < lignes.length && estSeparateurTableau(lignes[i + 1])) {
      const debut = i;
      let j = i + 2;
      while (j < lignes.length && /^\s*\|.*\|\s*$/.test(lignes[j])) j++;
      blocs.push(<TableauLumi key={`t${debut}`} lignes={lignes.slice(debut, j)} cleBase={`t${debut}`} />);
      i = j - 1;
      continue;
    }

    const puce = /^\s*[-*•]\s+(.*)$/.exec(l);
    const titre = /^\s*#{1,4}\s+(.*)$/.exec(l);

    if (puce) {
      blocs.push(
        <View key={`p${i}`} style={{ flexDirection: 'row', gap: 8, paddingLeft: 4 }}>
          <Text style={{ fontSize: 14.5, lineHeight: 22, color: c.texte }}>•</Text>
          <Text style={{ flex: 1, fontSize: 14.5, lineHeight: 22, color: c.texte }}>
            <Gras texte={puce[1]} cleBase={`p${i}`} />
          </Text>
        </View>,
      );
    } else if (titre) {
      blocs.push(
        <Text key={`h${i}`} style={{ fontSize: 14.5, lineHeight: 22, fontWeight: '600', color: c.texte, marginTop: 4 }}>
          <Gras texte={titre[1]} cleBase={`h${i}`} />
        </Text>,
      );
    } else if (l.trim() === '') {
      blocs.push(<View key={`v${i}`} style={{ height: 8 }} />);
    } else {
      blocs.push(
        <Text key={`l${i}`} style={{ fontSize: 14.5, lineHeight: 22, color: c.texte }}>
          <Gras texte={l} cleBase={`l${i}`} />
        </Text>,
      );
    }
  }

  return <View>{blocs}</View>;
}
