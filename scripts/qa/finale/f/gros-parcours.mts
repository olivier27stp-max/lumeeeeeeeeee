/* ═══════════════════════════════════════════════════════════════
   Agent F — « Construire avec Lumi » sur les GROS parcours du pack de base.

   Prend, dans la base locale (copie de la prod), les deux plus gros parcours
   réels — « Relance de facture — 3, 7, 14 et 30 jours » (17 étapes) et
   « Relance de devis — 1, 2, 5, 10 et 30 jours » (23 étapes) — et demande au
   panneau de l'éditeur une modification minuscule : « Change le premier délai
   à 2 jours. ». Vrai modèle, API locale, UN appel par parcours.

     QA_AUTO_SUFFIXE=f npx tsx --env-file=.env.local scripts/qa/finale/f/gros-parcours.mts

   Ce qu'on regarde : la réponse arrive-t-elle, combien d'étapes reviennent
   (17 et 23 attendues), ce qui a été perdu, et ce que l'appel a coûté.
   Sortie : D:/lume-final/sorties/f-gros-parcours.json.
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';
import { preparer, genererPanneau, repere, releve, tableau, SORTIES, n } from './commun.mts';

const atelier = await preparer();
const { admin, orgA } = atelier;
const s = { jeton: atelier.jetonA, orgId: orgA };

const { data, error } = await admin.from('automation_rules').select('name, trigger_event, steps').not('steps', 'is', null).is('deleted_at', null).limit(500);
if (error) throw new Error(error.message);
type Regle = { name: string; trigger_event: string; steps: Array<Record<string, any>> };
const vus = new Set<string>();
const gros = ((data ?? []) as Regle[])
  .filter((r) => Array.isArray(r.steps) && JSON.stringify({ trigger_event: r.trigger_event, steps: r.steps }).length > 6_000)
  .filter((r) => { const cle = JSON.stringify(r.steps); if (vus.has(cle)) return false; vus.add(cle); return true; })
  .sort((a, b) => a.steps.length - b.steps.length);
if (!gros.length) { console.error('Aucun parcours de plus de 6 000 caractères dans la base locale.'); process.exit(1); }

const types = (steps: Array<Record<string, any>>) => steps.map((e) => (e.type === 'action' ? e.action?.type : e.type));
const compte = (xs: string[]) => xs.reduce<Record<string, number>>((o, x) => ({ ...o, [x]: (o[x] ?? 0) + 1 }), {});
const resultats: Array<Record<string, unknown>> = [];
for (const r of gros) {
  const envoye = { trigger_event: r.trigger_event, steps: r.steps };
  const depuis = await repere(admin, orgA);
  const rep = await genererPanneau(s, 'Change le premier délai à 2 jours.', { parcoursActuel: envoye });
  const { usage } = await releve(admin, orgA, depuis, false);
  const rendues = Array.isArray(rep.corps?.steps) ? (rep.corps!.steps as Array<Record<string, any>>) : [];
  const avant = compte(types(r.steps)); const apres = compte(types(rendues));
  const perdu = Object.fromEntries(Object.entries(avant).map(([k, v]) => [k, v - (apres[k] ?? 0)]).filter(([, v]) => (v as number) > 0));
  resultats.push({
    parcours: r.name, etapes_envoyees: r.steps.length, caracteres: JSON.stringify(envoye).length,
    statut_http: rep.statut, erreur: rep.statut === 200 ? null : String(rep.corps?.error ?? rep.brut).slice(0, 300),
    etapes_rendues: rendues.length, etapes_perdues: Math.max(0, r.steps.length - rendues.length), perdu_par_type: perdu,
    resume: String(rep.corps?.resume ?? '').slice(0, 300),
    appels_modele: usage.length, sortie_tokens: usage.reduce((x, l) => x + n(l.output_tokens), 0), entree_tokens: usage.reduce((x, l) => x + n(l.input_tokens), 0),
    cout_cents: Math.round(usage.reduce((x, l) => x + n(l.cost_cents), 0) * 1000) / 1000,
    credits: Math.round(usage.reduce((x, l) => x + n(l.credits_micro), 0) / 1000) / 1000,
    latence_s: Math.round(rep.latence_ms / 100) / 10,
  });
}
writeFileSync(`${SORTIES}/f-gros-parcours.json`, JSON.stringify({ quand: new Date().toISOString(), resultats }, null, 1));
console.log(tableau(['Parcours', 'Étapes envoyées', 'Caractères', 'HTTP', 'Étapes rendues', 'Perdues', 'Sortie (tokens)', 'Coût (¢)', 'Crédits', 'Latence (s)'],
  resultats.map((x) => [String(x.parcours), Number(x.etapes_envoyees), Number(x.caracteres), Number(x.statut_http), Number(x.etapes_rendues), Number(x.etapes_perdues), Number(x.sortie_tokens), Number(x.cout_cents), Number(x.credits), Number(x.latence_s)])));
for (const x of resultats) console.log(`\n${x.parcours}\n  erreur : ${x.erreur ?? '—'}\n  résumé : ${x.resume || '—'}\n  perdu par type : ${JSON.stringify(x.perdu_par_type)}`);
process.exit(0);
