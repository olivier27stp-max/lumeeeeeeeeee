/* ═══════════════════════════════════════════════════════════════
   Agent F — essais comparés sur l'appel de « Construire avec Lumi ».

   But : chiffrer, AVEC une mesure de qualité, les pistes d'économie sur
   `server/lib/lumi/generer-parcours.ts`, sans toucher à ce fichier. Le script
   refait le même appel que lui (même prompt `consignes()`, mêmes messages
   `construireMessages()`, même lecture `extraireJson` + `normaliserEtapes`,
   même validation `sequenceEtapes`) et ne change qu'UN paramètre par variante.

     npx tsx --env-file=.env.local scripts/qa/finale/f/ab-generer.mts [--variantes actuel,effort-bas] [--passes 2]

   Variantes :
   - actuel        : l'appel d'aujourd'hui (Sonnet 5, 4 000 tokens de sortie, ni
                     `thinking` ni `effort` précisés) ;
   - effort-bas    : le même, `thinking: adaptive` + `effort: low` ;
   - effort-moyen  : le même, `effort: medium` ;
   - haiku         : `claude-haiku-4-5`, sur les seules demandes sans rédaction ;
   - sans-etapes   : l'appel d'aujourd'hui, mais une QUESTION ne fait plus
                     réécrire le parcours (« steps »: null) — sur les seules
                     questions.

   Rien n'est écrit en base ; aucun crédit d'aucun bureau n'est débité (les
   appels partent du script, pas de l'API). Le coût réel est calculé avec
   `coutEnCents`. Sortie : D:/lume-final/sorties/f-ab-generer.json.
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';
import { clientAnthropic } from '../../../../server/lib/lumi/llm';
import { consignes, construireMessages, extraireJson, normaliserEtapes } from '../../../../server/lib/lumi/generer-parcours';
import { sequenceEtapes } from '../../../../server/lib/validation';
import { trouverDeclencheur } from '../../../../src/lib/automationCatalogue';
import { variablesInconnues } from '../../../../src/lib/emailBodyText';
import { coutEnCents, TARIFS } from '../../../../server/lib/lumi/tarifs';
import { parcoursDe, tableau, SORTIES } from './commun.mts';

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY manquante (.env.local)'); process.exit(1); }
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : ''; };
const PASSES = Math.max(1, Number(arg('--passes') || 1));
const c = clientAnthropic();

type Etape = Record<string, any>;
type Parcours = { trigger_event: string; steps: Etape[] };

const RELANCE: Parcours = {
  trigger_event: 'quote.sent',
  steps: [
    { id: 'e1', type: 'attendre', delai_secondes: 259_200, suivant: 'e2' },
    { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], avez-vous eu le temps de regarder votre soumission ? Nous restons disponibles si vous avez des questions sur les travaux. La voici : [quote_link]. [company_name]' } }, suivant: 'e3' },
    { id: 'e3', type: 'attendre', delai_secondes: 172_800, suivant: 'e4' },
    { id: 'e4', type: 'action', action: { type: 'send_email', config: { subject: 'Votre soumission [quote_number]', body: '<p>Bonjour [client_first_name],</p><p>Votre soumission est toujours disponible : [quote_link]. Répondez à ce courriel si vous avez des questions.</p><p>[company_name]</p>' } } },
  ],
};
const RAPPEL: Parcours = {
  trigger_event: 'invoice.overdue',
  steps: [
    { id: 'e1', type: 'attendre', delai_secondes: 604_800, suivant: 'e2' },
    { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], votre facture [invoice_number] de [invoice_total] est en retard. Vous pouvez la régler ici : [invoice_link]. Merci, [company_name]' } } },
  ],
};
const QUINZE = parcoursDe(15) as Parcours;
/**
 * Le parcours tel que la validation le rend (elle complète certains réglages par défaut d'une action).
 * Les contrôles « intact » comparent ce que le modèle a rendu, validé, à la référence validée de la même façon :
 * comparer au parcours brut faisait échouer à tort un parcours rendu mot pour mot (première passe, écartée).
 */
const norme = (p: Parcours): Parcours => ({ trigger_event: p.trigger_event, steps: sequenceEtapes.parse(normaliserEtapes(p.steps)) as Etape[] });
const RELANCE_N = norme(RELANCE);
const RAPPEL_N = norme(RAPPEL);
const QUINZE_N = norme(QUINZE);

const corpsSms = (p: Parcours | null) => (p?.steps ?? []).filter((e) => e.type === 'action' && e.action?.type === 'send_sms').map((e) => String(e.action.config?.body ?? ''));
const courriels = (p: Parcours | null) => (p?.steps ?? []).filter((e) => e.type === 'action' && e.action?.type === 'send_email').map((e) => JSON.stringify(e.action.config));
const attentes = (p: Parcours | null) => (p?.steps ?? []).filter((e) => e.type === 'attendre');
const conditions = (p: Parcours | null) => (p?.steps ?? []).filter((e) => e.type === 'si');
/** Le parcours sans ses identifiants ni ses renvois : deux parcours renumérotés mais identiques se comparent égaux. */
const fond = (p: Parcours | null) => JSON.stringify((p?.steps ?? []).map((e) => ({ type: e.type, action: e.action, delai: e.delai_secondes, mode: e.mode, conditions: e.conditions })));

interface Cas {
  id: string;
  genre: 'creation' | 'redaction' | 'structure' | 'question';
  demande: string;
  avant: Parcours | null;
  /** Contrôles propres au cas : nom → vrai si réussi. `apres` est le parcours rendu (ou `avant` si la variante n'en renvoie pas). */
  controles: Record<string, (x: { apres: Parcours | null; resume: string; modifie: unknown; stepsRendus: boolean }) => boolean>;
}

const CAS: Cas[] = [
  {
    id: 'creer-simple', genre: 'creation', avant: null,
    demande: 'Quand un devis est envoyé, attends 3 jours puis envoie un texto de relance au client.',
    controles: {
      declencheur_devis_envoye: ({ apres }) => apres?.trigger_event === 'quote.sent',
      attente_de_3_jours: ({ apres }) => attentes(apres).some((e) => e.delai_secondes === 259_200),
      un_texto: ({ apres }) => corpsSms(apres).length === 1,
      texto_avec_lien_du_devis: ({ apres }) => corpsSms(apres).some((t) => t.includes('[quote_link]')),
    },
  },
  {
    id: 'creer-gros', genre: 'creation', avant: null,
    demande: 'Pour les factures en retard : si la facture dépasse 500 $, attends 3 jours et envoie un texto de rappel ; attends encore 4 jours et, si elle est toujours impayée, envoie un courriel de rappel avec le lien de paiement ; attends 7 jours de plus puis crée une tâche pour que j’appelle le client.',
    controles: {
      declencheur_facture_en_retard: ({ apres }) => apres?.trigger_event === 'invoice.overdue',
      filtre_montant_500: ({ apres }) => conditions(apres).some((e) => [e.conditions?.montant?.gt, e.conditions?.montant?.gte].includes(500)),
      condition_toujours_impayee: ({ apres }) => conditions(apres).some((e) => e.conditions?.status?.eq === 'unpaid'),
      trois_attentes_3_4_7_jours: ({ apres }) => JSON.stringify(attentes(apres).map((e) => e.delai_secondes)) === JSON.stringify([259_200, 345_600, 604_800]),
      texto_puis_courriel_puis_tache: ({ apres }) => (apres?.steps ?? []).filter((e) => e.type === 'action').map((e) => e.action?.type).join(',') === 'send_sms,send_email,create_task',
      courriel_avec_lien_de_paiement: ({ apres }) => courriels(apres).some((t) => t.includes('[invoice_link]')),
    },
  },
  {
    id: 'rappel-rdv-veille', genre: 'creation', avant: null,
    demande: 'Envoie un texto de rappel au client la veille de son rendez-vous.',
    controles: {
      declencheur_rendez_vous: ({ apres }) => apres?.trigger_event === 'appointment.created',
      attente_avant_la_date_24h: ({ apres }) => attentes(apres).some((e) => e.mode === 'avant_date' && e.secondes_avant === 86_400),
      attente_avant_le_texto: ({ apres }) => { const t = (apres?.steps ?? []).map((e) => e.type); return t.indexOf('attendre') > -1 && t.indexOf('attendre') < t.indexOf('action'); },
    },
  },
  {
    id: 'plus-court', genre: 'redaction', avant: RELANCE,
    demande: 'Le texto est trop long, fais-le plus court.',
    controles: {
      texto_change: ({ apres }) => corpsSms(apres)[0] !== corpsSms(RELANCE_N)[0],
      texto_plus_court: ({ apres }) => (corpsSms(apres)[0] ?? '').length > 20 && (corpsSms(apres)[0] ?? '').length < corpsSms(RELANCE_N)[0].length,
      ouverture_gardee: ({ apres }) => /^Bonjour \[client_first_name\]/.test(corpsSms(apres)[0] ?? ''),
      lien_garde: ({ apres }) => (corpsSms(apres)[0] ?? '').includes('[quote_link]'),
      courriel_intact: ({ apres }) => courriels(apres).join('|') === courriels(RELANCE_N).join('|'),
      delais_intacts: ({ apres }) => JSON.stringify(attentes(apres).map((e) => e.delai_secondes)) === JSON.stringify([259_200, 172_800]),
    },
  },
  {
    id: 'changer-delai', genre: 'structure', avant: RELANCE,
    demande: 'Change le premier délai à 5 jours.',
    controles: {
      premier_delai_5_jours: ({ apres }) => attentes(apres)[0]?.delai_secondes === 432_000,
      second_delai_intact: ({ apres }) => attentes(apres)[1]?.delai_secondes === 172_800,
      textes_intacts: ({ apres }) => corpsSms(apres).join('|') === corpsSms(RELANCE_N).join('|') && courriels(apres).join('|') === courriels(RELANCE_N).join('|'),
      quatre_etapes: ({ apres }) => (apres?.steps ?? []).length === 4,
    },
  },
  {
    id: 'ajouter-filtre', genre: 'structure', avant: RAPPEL,
    demande: 'Seulement pour les factures de plus de 1 000 $.',
    controles: {
      filtre_montant_1000: ({ apres }) => conditions(apres).some((e) => [e.conditions?.montant?.gt, e.conditions?.montant?.gte].includes(1000)),
      filtre_avant_le_texto: ({ apres }) => { const t = (apres?.steps ?? []).map((e) => (e.type === 'action' ? e.action?.type : e.type)); return t.indexOf('si') > -1 && t.indexOf('si') < t.indexOf('send_sms'); },
      texto_intact: ({ apres }) => corpsSms(apres).join('|') === corpsSms(RAPPEL_N).join('|'),
      delai_intact: ({ apres }) => attentes(apres).some((e) => e.delai_secondes === 604_800),
    },
  },
  {
    id: 'expliquer-4-etapes', genre: 'question', avant: RELANCE,
    demande: 'Explique-moi ce que fait cette automatisation.',
    controles: {
      parcours_inchange: ({ apres }) => fond(apres) === fond(RELANCE_N),
      modifie_faux: ({ modifie }) => modifie === false,
      explique_les_3_jours: ({ resume }) => /3 jours|trois jours/i.test(resume),
      explique_texto_et_courriel: ({ resume }) => /texto/i.test(resume) && /courriel/i.test(resume),
      sans_jargon: ({ resume }) => !/json|steps|trigger|e\d\b|delai_secondes|send_sms/i.test(resume),
    },
  },
  {
    id: 'expliquer-15-etapes', genre: 'question', avant: QUINZE,
    demande: 'Ça part quand, le premier message ?',
    controles: {
      parcours_inchange: ({ apres }) => fond(apres) === fond(QUINZE_N),
      modifie_faux: ({ modifie }) => modifie === false,
      reponse_assez_longue: ({ resume }) => resume.length >= 40,
      sans_jargon: ({ resume }) => !/json|steps|trigger|\be\d+\b|delai_secondes|send_sms/i.test(resume),
    },
  },
];

interface Variante {
  id: string;
  modele: string;
  parametres: Record<string, unknown>;
  systeme: (base: string) => string;
  genres: Cas['genre'][];
}
const CONSIGNE_QUESTION = /- Une QUESTION sur le parcours[\s\S]*?phrases simples\./;
const VARIANTES: Variante[] = [
  { id: 'actuel', modele: 'claude-sonnet-5', parametres: {}, systeme: (b) => b, genres: ['creation', 'redaction', 'structure', 'question'] },
  { id: 'effort-bas', modele: 'claude-sonnet-5', parametres: { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }, systeme: (b) => b, genres: ['creation', 'redaction', 'structure', 'question'] },
  { id: 'effort-moyen', modele: 'claude-sonnet-5', parametres: { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } }, systeme: (b) => b, genres: ['creation', 'redaction', 'structure', 'question'] },
  { id: 'haiku', modele: 'claude-haiku-4-5', parametres: {}, systeme: (b) => b, genres: ['structure', 'question'] },
  {
    id: 'sans-etapes', modele: 'claude-sonnet-5', parametres: {}, genres: ['question'],
    systeme: (b) => {
      if (!CONSIGNE_QUESTION.test(b)) throw new Error('la consigne « Une QUESTION sur le parcours » a changé : adapter la variante sans-etapes');
      return b.replace(CONSIGNE_QUESTION, [
        '- Une QUESTION sur le parcours (« explique-moi ce que ça fait », « ça part',
        '  quand ? ») : NE RÉÉCRIS PAS le parcours. Mets exactement "steps": null et',
        '  "modifie": false — l’application garde le parcours à l’écran tel quel — et',
        '  réponds dans "resume" en deux ou trois phrases simples.',
      ].join('\n'));
    },
  },
];
const choisies = (arg('--variantes') || VARIANTES.map((v) => v.id).join(',')).split(',');

interface Essai {
  variante: string; cas: string; genre: string; passe: number;
  modele: string; stop_reason: string | null; latence_ms: number;
  entree: number; cache_lu: number; cache_ecrit: number; sortie: number;
  /** Tokens du texte visible (comptés) : la différence avec `sortie` est la réflexion. */
  sortie_visible: number; reflexion_estimee: number;
  cout_reel_cents: number;
  /** Coût à cache chaud : tout le prompt système lu en cache, quel que soit l'ordre des essais. */
  cout_a_chaud_cents: number;
  json_lisible: boolean; valide_moteur: boolean; variables_inventees: string[]; textos_de_plus_de_160: number;
  controles: Record<string, boolean>;
  reussi: boolean;
  resume: string;
  /** La réponse brute du modèle : un contrôle se rejuge sans repayer l'appel. */
  texte: string;
}

const zeroTokens = (await c.messages.countTokens({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }] })).input_tokens;
const tokensDe = async (t: string) => (t ? (await c.messages.countTokens({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: t }] })).input_tokens - zeroTokens + 1 : 0);

async function essayer(v: Variante, cas: Cas, passe: number): Promise<Essai> {
  const systeme = v.systeme(consignes(true));
  const messages = construireMessages(cas.demande, [], cas.avant);
  const debut = Date.now();
  const rep = await c.messages.create({
    model: v.modele, max_tokens: 4_000,
    system: [{ type: 'text', text: systeme, cache_control: { type: 'ephemeral' } }],
    messages,
    ...(v.parametres as object),
  } as never) as any;
  const latence = Date.now() - debut;
  const u = rep.usage;
  const texte = (rep.content as Array<{ type: string; text?: string }>).map((b) => (b.type === 'text' ? b.text : '')).join('');
  const visible = await tokensDe(texte);
  const t = TARIFS[v.modele];
  const prefixe = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const aChaud = ((u.input_tokens * t.input + prefixe * t.cacheRead + u.output_tokens * t.output) / 1_000_000) * 100;

  let brut: any = null; let lisible = true;
  try { brut = extraireJson(texte); } catch { lisible = false; }
  const stepsRendus = Array.isArray(brut?.steps) && brut.steps.length > 0;
  let apres: Parcours | null = null;
  let valide = false;
  if (lisible && stepsRendus) {
    const etapes = normaliserEtapes(brut.steps);
    const verdict = sequenceEtapes.safeParse(etapes);
    valide = verdict.success && !!trouverDeclencheur(String(brut.trigger_event ?? cas.avant?.trigger_event ?? ''));
    apres = { trigger_event: String(brut.trigger_event ?? cas.avant?.trigger_event ?? ''), steps: (verdict.success ? verdict.data : etapes) as Etape[] };
  } else if (lisible && cas.genre === 'question' && brut && (brut.steps === null || brut.steps === undefined || brut.steps.length === 0)) {
    // Variante « sans-etapes » : le serveur garderait le parcours à l'écran.
    apres = cas.avant ? norme(cas.avant) : null; valide = true;
  }
  const textes = (apres?.steps ?? []).filter((e) => e.type === 'action').map((e) => `${e.action?.config?.subject ?? ''}\n${e.action?.config?.body ?? ''}`).join('\n');
  const inventees = apres ? variablesInconnues(textes) : [];
  const longs = corpsSms(apres).filter((x) => x.length > 160).length;
  const resume = String(brut?.resume ?? '');
  const controles: Record<string, boolean> = {};
  for (const [nom, f] of Object.entries(cas.controles)) {
    try { controles[nom] = !!f({ apres, resume, modifie: brut?.modifie, stepsRendus }); } catch { controles[nom] = false; }
  }
  const reussi = lisible && valide && inventees.length === 0 && rep.stop_reason !== 'max_tokens' && Object.values(controles).every(Boolean);
  return {
    variante: v.id, cas: cas.id, genre: cas.genre, passe, modele: rep.model ?? v.modele, stop_reason: rep.stop_reason ?? null, latence_ms: latence,
    entree: u.input_tokens, cache_lu: u.cache_read_input_tokens ?? 0, cache_ecrit: u.cache_creation_input_tokens ?? 0, sortie: u.output_tokens,
    sortie_visible: visible, reflexion_estimee: typeof u.output_tokens_details?.thinking_tokens === 'number' ? u.output_tokens_details.thinking_tokens : Math.max(0, u.output_tokens - visible),
    cout_reel_cents: coutEnCents(v.modele, u), cout_a_chaud_cents: Math.round(aChaud * 10_000) / 10_000,
    json_lisible: lisible, valide_moteur: valide, variables_inventees: inventees, textos_de_plus_de_160: longs,
    controles, reussi, resume: resume.slice(0, 300), texte,
  };
}

const essais: Essai[] = [];
for (const v of VARIANTES.filter((x) => choisies.includes(x.id))) {
  for (let passe = 1; passe <= PASSES; passe++) {
    for (const cas of CAS.filter((x) => v.genres.includes(x.genre))) {
      try {
        const e = await essayer(v, cas, passe);
        essais.push(e);
        const rates = Object.entries(e.controles).filter(([, ok]) => !ok).map(([k]) => k);
        console.log(`${v.id.padEnd(13)} ${cas.id.padEnd(20)} #${passe} ${e.reussi ? 'OK   ' : 'ÉCHEC'} ${e.cout_a_chaud_cents.toFixed(3)} ¢ à chaud · sortie ${e.sortie} (visible ${e.sortie_visible}, réflexion ≈ ${e.reflexion_estimee}) · ${e.latence_ms} ms · ${e.stop_reason}${rates.length ? ` · ratés : ${rates.join(', ')}` : ''}${e.json_lisible ? '' : ' · JSON illisible'}${e.valide_moteur ? '' : ' · refusé par la validation'}`);
      } catch (err) {
        console.log(`${v.id.padEnd(13)} ${cas.id.padEnd(20)} #${passe} ERREUR ${(err as Error).message.slice(0, 200)}`);
      }
    }
  }
}

/* ── Synthèse par variante, sur les cas communs à la variante « actuel » ── */
const moy = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const lignes = [...new Set(essais.map((e) => e.variante))].map((id) => {
  const es = essais.filter((e) => e.variante === id);
  const ref = essais.filter((e) => e.variante === 'actuel' && es.some((x) => x.cas === e.cas));
  return [
    id, es.length, `${es.filter((e) => e.reussi).length}/${es.length}`,
    `${ref.filter((e) => e.reussi).length}/${ref.length}`,
    moy(es.map((e) => e.cout_a_chaud_cents)).toFixed(3), moy(ref.map((e) => e.cout_a_chaud_cents)).toFixed(3),
    Math.round(moy(es.map((e) => e.sortie))), Math.round(moy(es.map((e) => e.reflexion_estimee))), (moy(es.map((e) => e.latence_ms)) / 1000).toFixed(1), (moy(ref.map((e) => e.latence_ms)) / 1000).toFixed(1),
  ];
});
console.log('\n' + tableau(['Variante', 'Essais', 'Réussis', 'Réussis « actuel », mêmes cas', 'Coût à chaud (¢)', '« actuel », mêmes cas (¢)', 'Sortie moy.', 'dont réflexion', 'Latence (s)', '« actuel » (s)'], lignes));
const total = essais.reduce((x, e) => x + e.cout_reel_cents, 0);
console.log(`\nCoût réel de cette passe : ${total.toFixed(2)} ¢ US (${essais.length} appels).`);
const fichier = `${SORTIES}/f-ab-generer${arg('--variantes') ? `-${choisies.join('+')}` : ''}.json`;
writeFileSync(fichier, JSON.stringify({ quand: new Date().toISOString(), passes: PASSES, total_cents: total, essais }, null, 1));
console.log(`→ ${fichier}`);
process.exit(0);
