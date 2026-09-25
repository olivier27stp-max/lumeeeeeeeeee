/**
 * Juge Haiku sur le TRAFIC RÉEL — lecture seule, Batch API (2026-09-22).
 *   npm run qa:juge [-- --prod] [-- --jours 7] [-- --taux 0.3] [-- --envoyer]
 *
 * Pourquoi celui-ci, alors qu'il existe déjà `evaluer-support-qualite.mts` :
 * ce dernier note des cas SYNTHÉTIQUES dont on connaît la bonne réponse.
 * Utile, mais il ne dit rien de ce que les gens demandent vraiment. Ici on
 * échantillonne les VRAIS échanges de prod, où il n'y a aucune vérité de
 * référence — le juge ne peut donc pas noter « juste ou faux », et prétendre
 * le contraire produirait un chiffre faux.
 *
 * Ce qu'il note, ce sont trois défauts VÉRIFIABLES sans connaître la vérité :
 *   - répond-il à la question posée, ou à côté ?
 *   - avance-t-il des chiffres/noms sans qu'un outil les ait fournis ?
 *     (`verifier-chiffres.ts` le fait déjà pour les montants, de façon
 *      déterministe ; le juge couvre les noms, dates et affirmations)
 *   - est-ce exploitable, ou noyé/évasif ?
 *
 * PREMIÈRE PASSE, ET LA LEÇON QUI VA AVEC (2026-09-22, 10 échanges, 0,43 ¢).
 * Le juge a signalé deux « inventions » sur la même réponse : un délai de
 * grâce de 7 jours et l'activation automatique du 2FA, avancés sans aucun
 * appel d'outil. Vérification faite dans le code : `JOURS_DE_GRACE = 7`
 * (server/lib/subscription-email.ts) et l'article 2FA de
 * `supportArticles.ts` dit mot pour mot ce que Lumi a répondu. Les deux
 * étaient EXACTS — c'est le juge qui avait tort.
 *
 * D'où la règle du critère 2 ci-dessous : « aucun outil appelé » n'est un
 * défaut que pour une donnée propre au CLIENT. Le mode d'emploi et les
 * règles du produit, Lumi les connaît par son prompt ; les compter comme
 * des hallucinations rendrait le juge bruyant, et un détecteur bruyant finit
 * ignoré.
 *
 * Coût : Haiku 4.5 via Batch API = 50 % du tarif, aucune urgence. Sur
 * l'échantillon par défaut (30 % de 7 jours), c'est quelques cents.
 * Par défaut le script n'ENVOIE RIEN : il montre l'échantillon et le coût
 * estimé. `--envoyer` déclenche l'appel.
 *
 * Aucune écriture : ni en base, ni sur les conversations.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const envoyer = args.includes('--envoyer');
const jours = Number(args[args.indexOf('--jours') + 1]) || 7;
const taux = Math.min(Math.max(Number(args[args.indexOf('--taux') + 1]) || 0.3, 0.01), 1);

const MODELE_JUGE = 'claude-haiku-4-5';
/** Haiku 4.5 : 1 $/MTok entrée, 5 $/MTok sortie — Batch API = moitié. */
const TARIF_ENTREE = 1 / 1e6 / 2;
const TARIF_SORTIE = 5 / 1e6 / 2;

const url = prod ? process.env.SUPABASE_URL_PROD : process.env.VITE_SUPABASE_URL;
const cle = prod ? process.env.SUPABASE_SERVICE_ROLE_KEY_PROD : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !cle) throw new Error(prod ? 'SUPABASE_URL_PROD / SUPABASE_SERVICE_ROLE_KEY_PROD manquants' : 'VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
const admin: SupabaseClient = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });

const depuis = new Date(Date.now() - jours * 86_400_000).toISOString();

type Msg = { id: string; conversation_id: string; role: string; content: unknown; created_at: string };

/** Le texte lisible d'un message, tous blocs `text` mis bout à bout. */
function texteDe(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
}

/** Les outils appelés dans un message assistant — pour savoir si la réponse est sourcée. */
function outilsDe(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b: any) => b?.type === 'tool_use' && typeof b.name === 'string').map((b: any) => b.name);
}

const messages: Msg[] = [];
for (let page = 0; page < 20; page++) {
  const { data, error } = await admin.from('lumi_messages')
    .select('id, conversation_id, role, content, created_at')
    .gte('created_at', depuis).order('created_at', { ascending: true })
    .range(page * 1000, page * 1000 + 999);
  if (error) throw new Error(`lumi_messages: ${error.message}`);
  if (!data?.length) break;
  messages.push(...(data as Msg[]));
  if (data.length < 1000) break;
}

// Paires question → réponse, dans l'ordre d'une même conversation.
type Paire = { question: string; reponse: string; outils: string[]; quand: string };
const paires: Paire[] = [];
const parConv = new Map<string, Msg[]>();
for (const m of messages) {
  const l = parConv.get(m.conversation_id) ?? [];
  l.push(m);
  parConv.set(m.conversation_id, l);
}
for (const liste of parConv.values()) {
  for (let i = 0; i < liste.length - 1; i++) {
    if (liste[i].role !== 'user') continue;
    const question = texteDe(liste[i].content);
    if (!question) continue;
    // La réponse = les blocs texte de l'assistant jusqu'au prochain tour utilisateur.
    let reponse = '';
    const outils: string[] = [];
    for (let j = i + 1; j < liste.length && liste[j].role !== 'user'; j++) {
      const t = texteDe(liste[j].content);
      if (t) reponse += (reponse ? '\n' : '') + t;
      outils.push(...outilsDe(liste[j].content));
    }
    if (reponse) paires.push({ question, reponse, outils, quand: liste[i].created_at });
  }
}

console.log(`\n═══ Juge Lumi · ${prod ? 'PRODUCTION' : 'staging'} · ${jours} j ═══\n`);
console.log(`${paires.length} échange(s) complet(s) trouvé(s).`);

// Échantillon déterministe : même commande = même échantillon, donc deux
// passes se comparent. On prend un élément sur N plutôt qu'au hasard.
const pas = Math.max(1, Math.round(1 / taux));
const echantillon = paires.filter((_, i) => i % pas === 0);
console.log(`échantillon : ${echantillon.length} (1 sur ${pas}, soit ${Math.round(taux * 100)} %)\n`);

const SYSTEME = `Tu contrôles la qualité des réponses de Lumi, l'assistant intégré au CRM Lume (entreprises de services : lavage de vitres, gouttières, déneigement, paysagement).

Tu n'as PAS accès aux données de l'entreprise. Tu ne peux donc pas dire si un chiffre est exact — ne l'essaie jamais. Tu juges seulement ce qui est vérifiable en lisant l'échange :

1. repond_a_la_question : la réponse traite-t-elle ce qui a été demandé ? (non = elle répond à côté, ou élude)
2. chiffres_sources : la réponse cite-t-elle des DONNÉES DE L'ENTREPRISE (montants de factures, noms de clients, dates de jobs, totaux) sans qu'aucun outil ne les ait fournies ? Si oui → "non".
   Attention, ceci n'est PAS un défaut et vaut "sans_objet" :
   - un mode d'emploi (« Paramètres → Forfait », « clique le portail de facturation ») ;
   - une règle du produit Lume (délai de grâce, fonctionnement du 2FA, contenu d'un forfait) — Lumi connaît le produit sans appeler d'outil, c'est normal ;
   - un chiffre qui décrit le produit et non le client.
   Ne réponds "non" que pour une donnée propre à CE client, qu'aucun outil n'a pu fournir. Dans le doute, "sans_objet".
3. exploitable : l'utilisateur peut-il agir à partir de cette réponse, ou est-ce noyé, évasif, ou trop long pour rien ?

Réponds UNIQUEMENT en JSON, sans balise de code :
{"repond_a_la_question":"oui"|"non","chiffres_sources":"oui"|"non"|"sans_objet","exploitable":"oui"|"non","probleme":"une phrase de 20 mots max, vide si tout va bien"}`;

function invite(p: Paire): string {
  return `Outils appelés par Lumi pour ce tour : ${p.outils.length ? p.outils.join(', ') : 'AUCUN'}

Question de l'utilisateur :
« ${p.question.slice(0, 1200)} »

Réponse de Lumi :
« ${p.reponse.slice(0, 3000)} »`;
}

// Estimation avant de dépenser quoi que ce soit.
const approx = (s: string) => Math.round(s.length / 3.5);
const entreeEstimee = echantillon.reduce((s, p) => s + approx(SYSTEME) + approx(invite(p)), 0);
const sortieEstimee = echantillon.length * 60;
const coutEstime = entreeEstimee * TARIF_ENTREE + sortieEstimee * TARIF_SORTIE;
console.log(`coût estimé (Batch, 50 %) : ${(coutEstime * 100).toFixed(2)} ¢  (~${entreeEstimee} tokens d'entrée)`);

// Pas de `process.exit()` ici : couper la boucle d'événements pendant que le
// client Supabase garde des handles ouverts fait planter Node sous Windows
// (« Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ») APRÈS
// l'affichage — le rapport est correct mais le script sort en 127 et passe
// pour cassé. On laisse simplement Node se terminer seul.
if (!envoyer) {
  console.log('\nRien n\'a été envoyé. Ajoute --envoyer pour lancer le lot.\n');
  console.log('Aperçu des 3 premiers échanges retenus :');
  for (const p of echantillon.slice(0, 3)) {
    console.log(`  ${p.quand.slice(5, 16)} outils=[${p.outils.join(',') || '—'}]`);
    console.log(`     Q « ${p.question.replace(/\s+/g, ' ').slice(0, 80)} »`);
    console.log(`     R « ${p.reponse.replace(/\s+/g, ' ').slice(0, 80)} »`);
  }
  console.log('');
} else {

if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquante');
const anthropic = new Anthropic();

const lot = await anthropic.messages.batches.create({
  requests: echantillon.map((p, i) => ({
    custom_id: `paire-${i}`,
    params: {
      model: MODELE_JUGE,
      max_tokens: 200,
      system: SYSTEME,
      messages: [{ role: 'user' as const, content: invite(p) }],
    },
  })),
});
console.log(`\nlot envoyé : ${lot.id} — attente…`);

let etat = lot;
while (etat.processing_status !== 'ended') {
  await new Promise((r) => setTimeout(r, 10_000));
  etat = await anthropic.messages.batches.retrieve(lot.id);
  process.stdout.write('.');
}
console.log('\n');

const compte = { repond: { oui: 0, non: 0 }, sources: { oui: 0, non: 0, sans_objet: 0 }, exploitable: { oui: 0, non: 0 }, illisible: 0 };
const problemes: string[] = [];
let entree = 0, sortie = 0;

for await (const res of await anthropic.messages.batches.results(lot.id)) {
  if (res.result.type !== 'succeeded') { compte.illisible++; continue; }
  const msg = res.result.message;
  entree += msg.usage.input_tokens;
  sortie += msg.usage.output_tokens;
  const texte = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  try {
    const j = JSON.parse(texte.trim().replace(/^```(?:json)?|```$/g, '')) as Record<string, string>;
    if (j.repond_a_la_question === 'oui' || j.repond_a_la_question === 'non') compte.repond[j.repond_a_la_question]++;
    if (j.chiffres_sources === 'oui' || j.chiffres_sources === 'non' || j.chiffres_sources === 'sans_objet') compte.sources[j.chiffres_sources]++;
    if (j.exploitable === 'oui' || j.exploitable === 'non') compte.exploitable[j.exploitable]++;
    const i = Number(res.custom_id.replace('paire-', ''));
    if (j.probleme && Number.isFinite(i) && echantillon[i]) {
      problemes.push(`${echantillon[i].quand.slice(5, 16)} « ${echantillon[i].question.replace(/\s+/g, ' ').slice(0, 45)} » → ${j.probleme}`);
    }
  } catch { compte.illisible++; }
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : '—');
const jugees = compte.repond.oui + compte.repond.non;
console.log('RÉSULTATS');
console.log(`  répond à la question : ${compte.repond.oui}/${jugees} (${pct(compte.repond.oui, jugees)})`);
const avecDonnees = compte.sources.oui + compte.sources.non;
console.log(`  données sourcées     : ${compte.sources.oui}/${avecDonnees} (${pct(compte.sources.oui, avecDonnees)}) — ${compte.sources.sans_objet} sans donnée précise`);
const expl = compte.exploitable.oui + compte.exploitable.non;
console.log(`  exploitable          : ${compte.exploitable.oui}/${expl} (${pct(compte.exploitable.oui, expl)})`);
if (compte.illisible) console.log(`  illisibles           : ${compte.illisible}`);

if (problemes.length) {
  console.log('\nPROBLÈMES SIGNALÉS');
  for (const p of problemes.slice(0, 15)) console.log(`  ${p}`);
}

const coutReel = entree * TARIF_ENTREE + sortie * TARIF_SORTIE;
console.log(`\ncoût réel : ${(coutReel * 100).toFixed(2)} ¢ (${entree} entrée, ${sortie} sortie, Batch 50 %)\n`);

}
