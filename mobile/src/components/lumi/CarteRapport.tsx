/**
 * Carte d'un rapport composé par Lumi (outil build_report) — titre, période,
 * chiffres clés, et le PDF.
 *
 * Le web rend le PDF avec jsPDF ; sur mobile on passe par `expo-print`, déjà
 * utilisé par `lib/pdf.ts` pour les devis et les factures. Le CONTENU vient du
 * serveur dans les deux cas (sections, KPI, tableaux) : c'est la mise en page
 * qui change de moteur, pas les chiffres.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import type { RapportLumi } from '@/lib/api/lumi';
import { useThemeLumi } from '@/lib/lumi/theme';
import { shareHtmlAsPdf } from '@/lib/pdf';
import { IconeLumi } from './IconeLumi';

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Le rapport en HTML, rendu ensuite en PDF par le moteur d'impression du système. */
function rapportEnHtml(r: RapportLumi): string {
  const sections = r.sections
    .map((s) => {
      const kpis = s.kpis?.length
        ? `<div class="kpis">${s.kpis
            .map(
              (k) =>
                `<div class="kpi"><div class="kl">${echapper(k.label)}</div><div class="kv">${echapper(k.valeur)}</div>${
                  k.detail ? `<div class="kd">${echapper(k.detail)}</div>` : ''
                }</div>`,
            )
            .join('')}</div>`
        : '';
      const tableau =
        s.tableau && s.tableau.lignes.length
          ? `<table><thead><tr>${s.tableau.colonnes
              .map((col, i) => `<th class="${s.tableau!.alignements?.[i] === 'd' ? 'd' : 'g'}">${echapper(col)}</th>`)
              .join('')}</tr></thead><tbody>${s.tableau.lignes
              .map(
                (ligne) =>
                  `<tr>${ligne
                    .map((cell, i) => `<td class="${s.tableau!.alignements?.[i] === 'd' ? 'd' : 'g'}">${echapper(cell)}</td>`)
                    .join('')}</tr>`,
              )
              .join('')}</tbody></table>`
          : '';
      const note = s.note ? `<p class="note">${echapper(s.note)}</p>` : '';
      return `<section><h2>${echapper(s.titre)}</h2>${kpis}${tableau}${note}</section>`;
    })
    .join('');

  const periode = r.periode ? `${r.periode.du} → ${r.periode.au}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: -apple-system, "Helvetica Neue", Roboto, sans-serif; color:#111; margin:32px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:#888; font-size:13px; margin:0; }
  .meta { color:#aaa; font-size:11px; margin:4px 0 24px; }
  section { margin-bottom:26px; page-break-inside:avoid; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:#888; border-bottom:1px solid #eee; padding-bottom:6px; margin:0 0 12px; }
  .kpis { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px; }
  .kpi { background:#f5f5f5; border-radius:8px; padding:10px 12px; min-width:130px; }
  .kl { font-size:10px; color:#888; } .kv { font-size:16px; font-weight:700; } .kd { font-size:10px; color:#aaa; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; color:#888; font-size:10px; text-transform:uppercase; letter-spacing:.05em; border-bottom:1px solid #e5e5e5; padding:6px 8px 6px 0; }
  td { border-bottom:1px solid #f2f2f2; padding:7px 8px 7px 0; }
  .d { text-align:right; } .note { font-size:11px; color:#888; margin-top:8px; }
</style></head><body>
<h1>${echapper(r.titre)}</h1><p class="sub">${echapper(r.sous_titre)}</p>
<p class="meta">${echapper(periode)}${periode ? ' · ' : ''}${echapper(r.genere_le)}</p>
${sections}</body></html>`;
}

export function CarteRapport({ rapport, fr }: { rapport: RapportLumi; fr: boolean }) {
  const { c } = useThemeLumi();
  const [enCours, setEnCours] = useState(false);
  const kpis = rapport.sections.flatMap((s) => s.kpis ?? []).slice(0, 6);
  const nbTableaux = rapport.sections.filter((s) => s.tableau && s.tableau.lignes.length > 0).length;

  async function telecharger() {
    setEnCours(true);
    try {
      await shareHtmlAsPdf(rapportEnHtml(rapport), rapport.titre);
    } catch (e) {
      console.error('[lumi] PDF du rapport', e);
      Alert.alert(fr ? 'Le PDF n’a pas pu être généré.' : 'The PDF could not be generated.');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <View style={{ marginTop: 10, borderRadius: 16, borderWidth: 1, borderColor: c.bordure, backgroundColor: c.carte, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: `${c.lumi}1F`, alignItems: 'center', justifyContent: 'center' }}>
          <IconeLumi nom="document" couleur={c.lumi} taille={17} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: c.texte }} numberOfLines={2}>
            {rapport.titre}
          </Text>
          <Text style={{ fontSize: 12, color: c.texteTenu, marginTop: 2 }}>{rapport.sous_titre}</Text>
        </View>
      </View>

      {kpis.length > 0 && (
        <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {kpis.map((k) => (
            <View key={k.label} style={{ flexGrow: 1, minWidth: '45%', borderRadius: 10, backgroundColor: c.creux, paddingHorizontal: 10, paddingVertical: 8 }}>
              <Text style={{ fontSize: 11, color: c.texteTenu }} numberOfLines={1}>
                {k.label}
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '600', color: c.texte, fontVariant: ['tabular-nums'] }}>{k.valeur}</Text>
              {!!k.detail && (
                <Text style={{ fontSize: 10.5, color: c.texteTenu }} numberOfLines={1}>
                  {k.detail}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable
          onPress={telecharger}
          disabled={enCours}
          accessibilityRole="button"
          accessibilityLabel={fr ? 'Télécharger le PDF du rapport' : 'Download the report PDF'}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 10,
            backgroundColor: c.action,
            paddingHorizontal: 14,
            minHeight: 44,
            opacity: enCours ? 0.5 : 1,
          }}
        >
          {enCours ? (
            <ActivityIndicator size="small" color={c.texteSurAction} />
          ) : (
            <IconeLumi nom="telecharger" couleur={c.texteSurAction} taille={13} />
          )}
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: c.texteSurAction }}>{fr ? 'Télécharger le PDF' : 'Download PDF'}</Text>
        </Pressable>
        <Text style={{ flex: 1, fontSize: 11.5, color: c.texteTenu }}>
          {rapport.sections.length} sections{nbTableaux ? ` · ${nbTableaux} ${fr ? 'tableaux' : 'tables'}` : ''}
        </Text>
      </View>
    </View>
  );
}
