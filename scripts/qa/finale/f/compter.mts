/* ═══════════════════════════════════════════════════════════════
   Agent F — tailles en tokens de ce qui part au modèle pour les automatisations.

   Aucune inférence : seulement l'API de comptage (`messages.countTokens`),
   gratuite. Il n'écrit dans aucune base ; il LIT les parcours de la base
   locale (copie de la prod : pack de base et préréglages) pour mesurer de
   vrais parcours, et seulement si l'adresse Supabase est locale.

     npx tsx --env-file=.env.local scripts/qa/finale/f/compter.mts

   Ce qu'il mesure :
   1. le prompt système de « Construire avec Lumi » (`consignes()`), en français
      et en anglais — c'est le seul bloc mis en cache sur ce chemin ;
   2. un parcours de 5, 15 et 30 étapes TEL QU'IL EST ENVOYÉ (le message
      « Voici le parcours ACTUEL… », coupé à 6 000 caractères par le code), et
      ce que pèserait la réponse (le parcours entier réécrit en JSON indenté) ;
   3. les outils d'automatisation de Lumi : taille de chaque définition, et le
      jeu d'outils chargé avec le sujet « rapports » (celui des automatisations).

   Sortie : D:/lume-final/sorties/f-tailles.json + un résumé à l'écran.
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';
import { clientAnthropic } from '../../../../server/lib/lumi/llm';
import { consignes, construireMessages } from '../../../../server/lib/lumi/generer-parcours';
import { outilsClaude, promptSystemeLumi } from '../../../../server/lib/lumi/orchestrateur';
import { focusDuSousAgent } from '../../../../server/lib/lumi/sous-agents';
import { sequenceEtapes } from '../../../../server/lib/validation';
import { parcoursDe, SORTIES } from './commun.mts';

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY manquante (.env.local)'); process.exit(1); }
const MODELE = 'claude-sonnet-5';
const c = clientAnthropic();

async function compter(p: { system?: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }>; tools?: unknown[] }): Promise<number> {
  const r = await c.messages.countTokens({
    model: MODELE,
    messages: p.messages ?? [{ role: 'user', content: 'x' }],
    ...(p.system ? { system: p.system } : {}),
    ...(p.tools?.length ? { tools: p.tools as never } : {}),
  });
  return r.input_tokens;
}
const zero = await compter({});
const texte = async (t: string) => (await compter({ messages: [{ role: 'user', content: t }] })) - zero + 1;

/* ── 1. Prompt système de « Construire avec Lumi » ── */
const systemeFr = consignes(true);
const systemeEn = consignes(false);
const prompt = {
  fr: { caracteres: systemeFr.length, tokens: (await compter({ system: systemeFr })) - zero },
  en: { caracteres: systemeEn.length, tokens: (await compter({ system: systemeEn })) - zero },
  identiques: systemeFr === systemeEn,
};

/* ── 2. Parcours de 5, 15, 30 étapes tel qu'il est envoyé ── */
const parcours: Array<Record<string, unknown>> = [];
for (const total of [5, 15, 30]) {
  const p = parcoursDe(total);
  const valide = sequenceEtapes.safeParse(p.steps);
  const complet = JSON.stringify(p);
  const messages = construireMessages('Raccourcis le premier texto.', [], p);
  const envoye = messages[0].content;
  // Le JSON envoyé est-il encore lisible ? (le code coupe la chaîne à 6 000 caractères)
  const jsonEnvoye = envoye.slice(envoye.indexOf('{'));
  let lisible = true;
  let etapesVues = 0;
  try { etapesVues = (JSON.parse(jsonEnvoye) as { steps: unknown[] }).steps.length; } catch { lisible = false; etapesVues = (jsonEnvoye.match(/"id":"e\d+"/g) ?? []).length; }
  // La réponse attendue : le parcours ENTIER réécrit, en JSON indenté (le prompt l'exige, même pour une question).
  const reponse = JSON.stringify({ nom: 'Relance de soumission', trigger_event: p.trigger_event, resume: 'J’ai raccourci le premier texto.', modifie: true, steps: p.steps, autre: null }, null, 2);
  parcours.push({
    etapes: total,
    valide_pour_le_moteur: valide.success,
    caracteres_complets: complet.length,
    caracteres_envoyes: jsonEnvoye.length,
    coupe: complet.length > 6_000,
    json_envoye_lisible: lisible,
    etapes_visibles_dans_l_envoi: etapesVues,
    tokens_message_envoye: await texte(envoye),
    tokens_parcours_complet: await texte(complet),
    tokens_reponse_indentee: await texte(reponse),
    depasse_max_tokens_4000: (await texte(reponse)) > 4_000,
  });
}

/* ── 2 bis. Les VRAIS parcours de la base locale (copie de la prod : pack de base, préréglages) ── */
const parcoursReels: Array<Record<string, unknown>> = [];
let plusGros: { trigger_event: string; steps: Array<Record<string, unknown>> } | null = null;
if (/localhost|127\.0\.0\.1/.test(process.env.VITE_SUPABASE_URL ?? '')) {
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from('automation_rules').select('name, trigger_event, steps').not('steps', 'is', null).is('deleted_at', null).limit(500);
  if (error) throw new Error(`automation_rules : ${error.message}`);
  const vus = new Set<string>();
  const distincts = ((data ?? []) as Array<{ name: string; trigger_event: string; steps: Array<Record<string, unknown>> }>)
    .filter((r) => Array.isArray(r.steps) && r.steps.length > 0)
    .filter((r) => { const cle = JSON.stringify(r.steps); if (vus.has(cle)) return false; vus.add(cle); return true; })
    .sort((a, b) => a.steps.length - b.steps.length);
  for (const r of distincts) {
    const p = { trigger_event: r.trigger_event, steps: r.steps };
    const complet = JSON.stringify(p);
    const envoye = construireMessages('Raccourcis le premier texto.', [], p)[0].content;
    const jsonEnvoye = envoye.slice(envoye.indexOf('{')).split('\n\nÉTAPE')[0];
    let lisible = true;
    try { JSON.parse(jsonEnvoye); } catch { lisible = false; }
    const idsVus = new Set((jsonEnvoye.match(/"id":"[^"]+"/g) ?? []));
    const reponse = JSON.stringify({ nom: r.name, trigger_event: r.trigger_event, resume: 'J’ai raccourci le premier texto.', modifie: true, steps: r.steps, autre: null }, null, 2);
    const tokensReponse = await texte(reponse);
    parcoursReels.push({
      nom: r.name, etapes: r.steps.length, caracteres_complets: complet.length, coupe_a_6000: complet.length > 6_000,
      json_envoye_lisible: lisible, etapes_visibles_dans_l_envoi: Math.min(r.steps.length, idsVus.size),
      tokens_message_envoye: await texte(envoye), tokens_parcours_complet: await texte(complet),
      tokens_reponse_indentee: tokensReponse, depasse_max_tokens_4000: tokensReponse > 4_000,
    });
    if (!plusGros || r.steps.length > plusGros.steps.length) plusGros = p;
  }
  // Un parcours de 30 étapes (le maximum accepté), bâti sur le plus gros parcours réel : ses propres messages, répétés.
  if (plusGros && plusGros.steps.length < 30) {
    const base = plusGros.steps;
    const ajouts = base.filter((e) => e.type === 'action' || e.type === 'attendre').slice(0, 30 - base.length)
      .map((e, i) => ({ ...e, id: `x${i + 1}`, suivant: null, si_reponse: undefined, si_depasse: undefined }));
    const trente = { trigger_event: plusGros.trigger_event, steps: [...base, ...ajouts] };
    const complet = JSON.stringify(trente);
    const reponse = JSON.stringify({ nom: 'Parcours de 30 étapes', trigger_event: trente.trigger_event, resume: 'Fait.', modifie: true, steps: trente.steps, autre: null }, null, 2);
    const tokensReponse = await texte(reponse);
    parcoursReels.push({
      nom: '(30 étapes : le plus gros parcours réel, prolongé avec ses propres messages)', etapes: trente.steps.length, caracteres_complets: complet.length, coupe_a_6000: complet.length > 6_000,
      json_envoye_lisible: false, etapes_visibles_dans_l_envoi: new Set(complet.slice(0, 6_000).match(/"id":"[^"]+"/g) ?? []).size,
      tokens_message_envoye: await texte(construireMessages('Raccourcis le premier texto.', [], trente)[0].content), tokens_parcours_complet: await texte(complet),
      tokens_reponse_indentee: tokensReponse, depasse_max_tokens_4000: tokensReponse > 4_000,
    });
  }
}

/* ── 3. Outils d'automatisation ── */
type Outil = { name: string; description?: string; input_schema?: unknown; defer_loading?: boolean; cache_control?: unknown; type?: string };
const nu = ({ defer_loading: _d, cache_control: _c, ...reste }: Outil) => reste;
const tous = (outilsClaude(null) as Outil[]).filter((t) => !t.type);
const auto = tous.filter((t) => /automation/.test(t.name));
const outils: Array<{ nom: string; tokens: number; charge_avec_rapports: boolean; charge_au_jeu_de_base: boolean }> = [];
const chargesRapports = (outilsClaude('rapports') as Outil[]).filter((t) => !t.type && !t.defer_loading);
const chargesBase = tous.filter((t) => !t.defer_loading);
// Le premier outil porte un surcoût fixe (l'en-tête du bloc d'outils) : on le mesure à part.
const unOutil = await compter({ tools: [nu(auto[0])] });
const deuxOutils = await compter({ tools: [nu(auto[0]), nu(auto[1])] });
const enTete = unOutil - zero - (deuxOutils - unOutil);
for (const t of auto) {
  const seul = (await compter({ tools: [nu(t)] })) - zero;
  outils.push({
    nom: t.name, tokens: Math.max(0, seul - enTete),
    charge_avec_rapports: chargesRapports.some((x) => x.name === t.name),
    charge_au_jeu_de_base: chargesBase.some((x) => x.name === t.name),
  });
}
const tokensRapports = (await compter({ tools: chargesRapports.map(nu) })) - zero;
const tokensBase = (await compter({ tools: chargesBase.map(nu) })) - zero;
const tokensAuto = (await compter({ tools: auto.map(nu) })) - zero;

// Le prompt système de l'agent, pour comparer avec celui du panneau.
const blocs = promptSystemeLumi({ companyName: 'Nettoyage Test A', userName: 'QA Proprio A', language: 'fr', todayIso: '2026-10-01', focus: focusDuSousAgent('rapports', 'fr') });
const stable = (await compter({ system: blocs[0].text })) - zero;
const variable = (await compter({ system: blocs[1].text })) - zero;

const sortie = {
  quand: new Date().toISOString(),
  modele_de_comptage: MODELE,
  prompt_construire_avec_lumi: prompt,
  parcours_synthetiques: parcours,
  parcours_reels: parcoursReels,
  outils_automatisation: {
    nombre: auto.length,
    tokens_des_13_ensemble: tokensAuto,
    surcout_fixe_du_bloc_d_outils: enTete,
    detail: outils.sort((a, b) => b.tokens - a.tokens),
  },
  jeu_rapports: { outils_charges: chargesRapports.length, tokens: tokensRapports, noms: chargesRapports.map((t) => t.name) },
  jeu_de_base: { outils_charges: chargesBase.length, tokens: tokensBase },
  prompt_agent: { bloc_stable_tokens: stable, bloc_variable_tokens_avec_sujet_rapports: variable },
  outils_au_total: tous.length,
};
writeFileSync(`${SORTIES}/f-tailles.json`, JSON.stringify(sortie, null, 1));
console.log(JSON.stringify(sortie, null, 1));
process.exit(0);
