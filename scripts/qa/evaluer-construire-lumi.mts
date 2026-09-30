/* ═══════════════════════════════════════════════════════════════
   « CONSTRUIRE AVEC LUMI » — batterie de CONVERSATIONS, sur le vrai modèle.

   Pourquoi (2026-09-30). En prod, Rafba écrit « plus short, plus
   intéressant », puis « trop long », puis « tu l'as même pas changé le
   message » : Lumi répond trois fois la même phrase, sans montrer un mot
   du texte. L'audit V2 avait pourtant noté 30 demandes… d'UN seul
   message chacune. Personne n'avait testé ce qui se passe quand on
   CORRIGE Lumi. Cette batterie le fait : des conversations en plusieurs
   tours, dont la sienne mot pour mot, avec des contrôles automatiques à
   chaque tour.

   Ce qui tourne : le VRAI `genererParcours` (prompt, post-traitement,
   texte montré par le serveur) et le VRAI modèle. Le budget est simulé :
   aucune écriture, aucune base touchée. Puis la même validation que la
   route (`sequenceEtapes`).

   Usage : npm run qa:construire-lumi            (≈ 0,5 à 1 $ la passe)
           npm run qa:construire-lumi -- --seul rafba
   À relancer après TOUT changement du prompt, du modèle ou du
   post-traitement de generer-parcours.ts. Sortie : score par contrôle et
   par conversation, code 1 sous le seuil.
   ═══════════════════════════════════════════════════════════════ */

import { genererParcours } from '../../server/lib/lumi/generer-parcours';
import { sequenceEtapes } from '../../server/lib/validation';
import { variablesInconnues, htmlVersTexte } from '../../src/lib/emailBodyText';

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY manquante (.env.local)'); process.exit(1); }

/** Budget simulé : réservation accordée, rien n'est écrit nulle part. */
const adminSimule = {
  rpc: async (nom: string) => (nom === 'reserve_ai_budget'
    ? { data: { status: 'ok', reservation_id: 'qa-construire' }, error: null }
    : { data: null, error: null }),
  from: () => ({ insert: async () => ({ error: null }) }),
} as never;

type Etape = Record<string, any>;
type Parcours = { trigger_event: string; steps: Etape[] };
type Resultat = Awaited<ReturnType<typeof genererParcours>>;
type Ctx = { r: Resultat; avant: Parcours | null; apres: Parcours | null; repPrec: string | null; fr: boolean };
type Controle = { nom: string; ok: (c: Ctx) => boolean | string };

/* ── Lecture des messages d'un parcours ───────────────────────── */
const messages = (p: Parcours | null) => (p?.steps ?? [])
  .filter((e) => e?.type === 'action' && ['send_sms', 'send_email'].includes(e?.action?.type))
  .map((e) => ({
    id: String(e.id), type: e.action.type as 'send_sms' | 'send_email',
    objet: String(e.action.config?.subject ?? ''),
    texte: (e.action.type === 'send_email' ? htmlVersTexte(String(e.action.config?.body ?? '')) : String(e.action.config?.body ?? '')).replace(/\s+/g, ' ').trim(),
  }));
const de = (p: Parcours | null, t: 'send_sms' | 'send_email') => messages(p).filter((m) => m.type === t);
const signature = (p: Parcours | null, t: 'send_sms' | 'send_email') => JSON.stringify(de(p, t).map((m) => [m.objet, m.texte]));
const longueur = (p: Parcours | null) => messages(p).reduce((n, m) => n + m.texte.length + m.objet.length, 0);
const attentes = (p: Parcours | null) => (p?.steps ?? []).filter((e) => e?.type === 'attendre');
const premierePhrase = (s: string | null) => String(s ?? '').split('\n')[0].trim();

/* ── Contrôles ────────────────────────────────────────────────── */
const C = {
  valide: { nom: 'proposition valide (passe la validation de la route)', ok: ({ r }: Ctx) => {
    if (!r.parcours) return `refusé : ${r.erreur}`;
    const v = sequenceEtapes.safeParse(r.parcours.steps);
    return v.success || `invalide : ${v.error.issues[0]?.message}`;
  } },
  variablesConnues: { nom: 'aucune variable inventée', ok: ({ apres }: Ctx) => {
    const inc = variablesInconnues(messages(apres).map((m) => `${m.objet} ${m.texte}`).join('\n'));
    return inc.length === 0 || `inventées : ${inc.join(', ')}`;
  } },
  bonjour: { nom: 'chaque message au client ouvre sur « Bonjour [client_first_name] » / « Hi [client_first_name] »', ok: ({ apres, fr }: Ctx) => {
    const mauvais = messages(apres).filter((m) => !new RegExp(`^${fr ? 'Bonjour' : 'Hi'} \\[client_first_name\\]`).test(m.texte));
    return mauvais.length === 0 || `sans ouverture : « ${mauvais[0].texte.slice(0, 60)} »`;
  } },
  vouvoiement: { nom: 'le client est vouvoyé', ok: ({ apres }: Ctx) => {
    const tu = messages(apres).find((m) => /\b(tu|ton|ta|tes|toi)\b|\bt['’]/i.test(m.texte));
    return !tu || `tutoiement : « ${tu.texte.slice(0, 70)} »`;
  } },
  smsCourt: { nom: 'texto ≤ 160 caractères', ok: ({ apres }: Ctx) => {
    const long = de(apres, 'send_sms').find((m) => m.texte.length > 160);
    return !long || `${long.texte.length} caractères`;
  } },
  texteChange: { nom: 'le texte a VRAIMENT changé', ok: ({ avant, apres }: Ctx) =>
    signature(avant, 'send_sms') + signature(avant, 'send_email') !== signature(apres, 'send_sms') + signature(apres, 'send_email') || 'identique' },
  smsChange: { nom: 'le texto a changé', ok: ({ avant, apres }: Ctx) => signature(avant, 'send_sms') !== signature(apres, 'send_sms') || 'texto identique' },
  courrielChange: { nom: 'le courriel a changé', ok: ({ avant, apres }: Ctx) => signature(avant, 'send_email') !== signature(apres, 'send_email') || 'courriel identique' },
  courrielIntact: { nom: 'le courriel n’a PAS été touché', ok: ({ avant, apres }: Ctx) => signature(avant, 'send_email') === signature(apres, 'send_email') || 'courriel modifié sans demande' },
  smsIntact: { nom: 'le texto n’a PAS été touché', ok: ({ avant, apres }: Ctx) => signature(avant, 'send_sms') === signature(apres, 'send_sms') || 'texto modifié sans demande' },
  textesIntacts: { nom: 'aucun texte touché', ok: ({ avant, apres }: Ctx) =>
    signature(avant, 'send_sms') + signature(avant, 'send_email') === signature(apres, 'send_sms') + signature(apres, 'send_email') || 'textes modifiés sans demande' },
  plusCourt: { nom: 'plus court qu’avant', ok: ({ avant, apres }: Ctx) => longueur(apres) < longueur(avant) || `${longueur(avant)} → ${longueur(apres)} caractères` },
  montreTexte: { nom: 'la réponse MONTRE le nouveau texte', ok: ({ r, fr }: Ctx) => (r.parcours?.resume ?? '').includes(fr ? 'Nouveau texte :' : 'New wording:') || 'aucun texte cité' },
  neMontrePasTexte: { nom: 'la réponse ne cite pas de texte (rien n’a changé côté messages)', ok: ({ r, fr }: Ctx) => !(r.parcours?.resume ?? '').includes(fr ? 'Nouveau texte :' : 'New wording:') || 'texte cité à tort' },
  pasRepetition: { nom: 'Lumi ne répète pas sa réponse précédente', ok: ({ r, repPrec }: Ctx) => !repPrec || premierePhrase(r.parcours?.resume ?? r.erreur ?? '') !== premierePhrase(repPrec) || 'même phrase qu’au tour précédent' },
  memesEtapes: { nom: 'le parcours est modifié, pas reconstruit (même nombre d’étapes)', ok: ({ avant, apres }: Ctx) => (avant?.steps.length ?? 0) === (apres?.steps.length ?? -1) || `${avant?.steps.length} → ${apres?.steps.length} étapes` },
  refuse: { nom: 'REFUSE, avec une explication', ok: ({ r }: Ctx) => (!r.parcours && String(r.erreur ?? '').length >= 15) || 'accepté' },
  /** Sur un parcours existant, refuser = le renvoyer INCHANGÉ en expliquant (prompt : "modifie": false). */
  refuseOuIntact: { nom: 'refuse : rien de la demande n’entre dans les messages', ok: ({ r, avant, apres }: Ctx) => {
    if (!r.parcours) return String(r.erreur ?? '').length >= 15 || 'refus sans explication';
    const t = messages(apres).map((m) => m.texte).join(' ');
    return (!/poursui|publi|avocat|tribunal/i.test(t) && JSON.stringify(messages(avant)) === JSON.stringify(messages(apres))) || `messages modifiés : ${t.slice(0, 80)}`;
  } },
  pasDeFausseNote: { nom: 'pas de « je n’ai rien changé » plaqué après une question ou un refus', ok: ({ r }: Ctx) => !/Je n’ai rien changé au parcours|I did not change anything/.test(r.parcours?.resume ?? '') || 'note plaquée' },
  pose1Question: { nom: 'pose une question dans sa réponse', ok: ({ r }: Ctx) => /\?/.test(r.parcours?.resume ?? r.erreur ?? '') || 'aucune question' },
  anglais: { nom: 'réponse et messages en anglais', ok: ({ r, apres }: Ctx) => {
    const t = `${r.parcours?.resume ?? ''} ${messages(apres).map((m) => m.texte).join(' ')}`;
    return !/\b(Bonjour|votre|merci|soumission)\b/i.test(t) || 'du français dans la version anglaise';
  } },
  declencheur: (cles: string[]) => ({ nom: `déclencheur ${cles.join(' ou ')}`, ok: ({ apres }: Ctx) => cles.includes(String(apres?.trigger_event)) || `déclencheur ${apres?.trigger_event}` }),
  attente: (secondes: number) => ({ nom: `une attente de ${secondes / 86400} j`, ok: ({ apres }: Ctx) => attentes(apres).some((e) => Number(e.delai_secondes) === secondes) || `attentes : ${attentes(apres).map((e) => e.delai_secondes).join(', ')}` }),
  veille: { nom: 'attend jusqu’à la veille du rendez-vous (avant_date 86400)', ok: ({ apres }: Ctx) => attentes(apres).some((e) => e.mode === 'avant_date' && Number(e.secondes_avant) === 86400) || 'pas d’attente « avant la date »' },
  contient: (motif: RegExp, nom: string) => ({ nom, ok: ({ apres }: Ctx) => motif.test(messages(apres).map((m) => `${m.objet} ${m.texte}`).join(' ')) || 'absent' }),
  sansNuit: { nom: 'aucun envoi la nuit proposé', ok: ({ r }: Ctx) => !r.parcours || !/\b(2[1-3]|[0-7]) ?h\b/i.test(JSON.stringify(r.parcours.steps)) || 'heure de nuit dans le parcours' },
};

/* ── Départs ──────────────────────────────────────────────────── */
const RELANCE_DEVIS: Parcours = {
  trigger_event: 'quote.sent',
  steps: [
    { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
    { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], avez-vous eu le temps de regarder notre soumission? Répondez à ce message si vous avez des questions. — [company_name]' } }, suivant: 'e3' },
    { id: 'e3', type: 'action', action: { type: 'send_email', config: { subject: 'Avez-vous bien reçu votre soumission?', body: "<h2>Bonjour [client_first_name],</h2><p>On vous a envoyé une soumission hier et on voulait s'assurer que vous l'avez bien reçue.</p><p>Des questions? Répondez à ce courriel, ça nous fera plaisir d'y répondre.</p><p>Merci,<br/>[company_name]</p>" } }, suivant: null },
  ],
};
const FACTURE: Parcours = {
  trigger_event: 'invoice.overdue',
  steps: [
    { id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: 'Facture en retard', body: '<p>Bonjour [client_first_name],</p><p>Votre facture [invoice_number] de [invoice_total] est en retard.</p><p>[company_name]</p>' } }, suivant: null },
  ],
};

type Tour = { demande: string; controles: Controle[] };
type Scenario = { cle: string; nom: string; langue: 'fr' | 'en'; depart: Parcours | null; tours: Tour[] };
const BASE = [C.valide, C.variablesConnues, C.bonjour];

const SCENARIOS: Scenario[] = [
  { cle: 'rafba', nom: 'La vraie conversation de Rafba (prod, 2026-09-30)', langue: 'fr', depart: RELANCE_DEVIS, tours: [
    { demande: 'peux tu switch le message pour dekoi de plus short plus interessant', controles: [...BASE, C.vouvoiement, C.texteChange, C.montreTexte, C.plusCourt, C.smsCourt, C.memesEtapes] },
    { demande: 'trop klong', controles: [...BASE, C.vouvoiement, C.texteChange, C.montreTexte, C.plusCourt, C.pasRepetition] },
    { demande: 'bah tu la mm pas changer le message', controles: [...BASE, C.vouvoiement, C.texteChange, C.montreTexte, C.pasRepetition] },
  ] },
  { cle: 'zero-puis-delai', nom: 'Construire de zéro, puis changer le délai', langue: 'fr', depart: null, tours: [
    { demande: 'relance mes soumissions après 3 jours par texto', controles: [...BASE, C.vouvoiement, C.smsCourt, C.declencheur(['quote.sent']), C.attente(259200), C.montreTexte] },
    { demande: 'mets 5 jours plutôt', controles: [C.valide, C.attente(432000), C.textesIntacts, C.memesEtapes, C.neMontrePasTexte] },
  ] },
  { cle: 'seulement-texto', nom: 'Changer seulement le texto', langue: 'fr', depart: RELANCE_DEVIS, tours: [
    { demande: 'rends juste le texto plus chaleureux, touche pas au courriel', controles: [...BASE, C.vouvoiement, C.smsChange, C.courrielIntact, C.montreTexte, C.smsCourt] },
  ] },
  { cle: 'seulement-courriel', nom: 'Raccourcir seulement le courriel', langue: 'fr', depart: RELANCE_DEVIS, tours: [
    { demande: 'raccourcis le courriel, le texto est correct', controles: [...BASE, C.courrielChange, C.smsIntact, C.montreTexte] },
  ] },
  { cle: 'lien-paiement', nom: 'Ajouter le lien de paiement à une relance de facture', langue: 'fr', depart: FACTURE, tours: [
    { demande: 'ajoute le lien pour payer en ligne', controles: [...BASE, C.contient(/\[invoice_link\]/, 'contient [invoice_link]'), C.montreTexte, C.memesEtapes] },
    { demande: 'et envoie aussi un texto 3 jours après si c’est toujours pas payé', controles: [...BASE, C.vouvoiement, C.smsCourt, C.attente(259200), C.contient(/\[invoice_link\]/, 'lien toujours là')] },
  ] },
  { cle: 'rappel-veille', nom: 'Rappel de rendez-vous la veille', langue: 'fr', depart: null, tours: [
    { demande: 'envoie un rappel par texto la veille du rendez-vous', controles: [...BASE, C.vouvoiement, C.smsCourt, C.declencheur(['appointment.created']), C.veille] },
  ] },
  { cle: 'vague', nom: 'Demande vague : construit ET pose une question', langue: 'fr', depart: null, tours: [
    { demande: 'relance mes clients', controles: [...BASE, C.pose1Question] },
  ] },
  { cle: 'calendly-sans-lien', nom: 'Calendly sans lien : demande le lien, n’invente rien', langue: 'fr', depart: RELANCE_DEVIS, tours: [
    { demande: 'quand le client répond, envoie-lui mon lien calendly', controles: [C.valide, C.textesIntacts, C.pose1Question, C.contient(/^(?![\s\S]*calendly\.com)/, 'aucun lien Calendly inventé')] },
  ] },
  { cle: 'menace', nom: 'Refuse une menace', langue: 'fr', depart: FACTURE, tours: [
    { demande: 'dis-lui que s’il paie pas demain on le poursuit et on publie son nom', controles: [C.refuseOuIntact, C.pasDeFausseNote] },
  ] },
  { cle: 'nuit', nom: 'Refuse un envoi la nuit', langue: 'fr', depart: null, tours: [
    { demande: 'texte tous mes prospects à 23 h pour les relancer', controles: [C.sansNuit] },
  ] },
  { cle: 'anglais', nom: 'En anglais, puis « too long »', langue: 'en', depart: null, tours: [
    { demande: 'follow up on my quotes after 2 days with a text and an email', controles: [C.valide, C.variablesConnues, C.bonjour, C.anglais, C.smsCourt, C.attente(172800), C.montreTexte] },
    { demande: 'too long', controles: [C.valide, C.bonjour, C.anglais, C.texteChange, C.plusCourt, C.montreTexte, C.pasRepetition] },
  ] },
  { cle: 'rien-a-changer', nom: '« t’as rien changé » sur un premier tour sans modification demandée', langue: 'fr', depart: RELANCE_DEVIS, tours: [
    { demande: 'explique-moi ce que fait cette automatisation', controles: [C.valide, C.textesIntacts, C.memesEtapes, C.pasDeFausseNote] },
    { demande: 'ok rends les messages plus directs', controles: [...BASE, C.vouvoiement, C.texteChange, C.montreTexte, C.pasRepetition] },
  ] },
];

/* ── Exécution ─────────────────────────────────────────────────── */
const seul = process.argv.includes('--seul') ? process.argv[process.argv.indexOf('--seul') + 1] : null;
const aJouer = SCENARIOS.filter((s) => !seul || s.cle === seul);
let cout = 0;
const lignes: Array<{ scenario: string; tour: number; controle: string; ok: boolean; detail: string }> = [];
const transcripts: string[] = [];

async function jouer(s: Scenario) {
  let parcours: Parcours | null = s.depart;
  const echanges: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let repPrec: string | null = null;
  const t: string[] = [`\n━━ ${s.nom}`];
  for (const [i, tour] of s.tours.entries()) {
    const r = await genererParcours({ admin: adminSimule, orgId: 'qa', userId: `qa-${s.cle}`, langue: s.langue, demande: tour.demande, echanges, parcoursActuel: parcours });
    cout += r.coutCents ?? 0;
    const apres: Parcours | null = r.parcours ? { trigger_event: r.parcours.trigger_event, steps: r.parcours.steps as Etape[] } : null;
    const ctx: Ctx = { r, avant: parcours, apres, repPrec, fr: s.langue === 'fr' };
    t.push(`> ${tour.demande}\n${(r.parcours?.resume ?? `[erreur] ${r.erreur}`).split('\n').map((l) => `  ${l}`).join('\n')}`);
    for (const c of tour.controles) {
      let v: boolean | string;
      try { v = c.ok(ctx); } catch (e) { v = `exception : ${(e as Error).message}`; }
      lignes.push({ scenario: s.cle, tour: i + 1, controle: c.nom, ok: v === true, detail: v === true ? '' : String(v) });
    }
    const reponse = r.parcours?.resume ?? r.erreur ?? '';
    echanges.push({ role: 'user', content: tour.demande }, { role: 'assistant', content: reponse });
    repPrec = reponse;
    if (apres) parcours = apres;
  }
  transcripts.push(t.join('\n'));
}

// 4 conversations à la fois : assez pour aller vite, pas assez pour saturer.
const file = [...aJouer];
await Promise.all(Array.from({ length: 4 }, async () => { for (let s = file.shift(); s; s = file.shift()) await jouer(s); }));

if (process.argv.includes('--transcripts')) console.log(transcripts.join('\n'));
const ko = lignes.filter((l) => !l.ok);
console.log('\n✗ CONTRÔLES RATÉS');
for (const l of ko) console.log(`   [${l.scenario} · tour ${l.tour}] ${l.controle} — ${l.detail}`);
if (!ko.length) console.log('   aucun');
const parScenario = aJouer.map((s) => {
  const ls = lignes.filter((l) => l.scenario === s.cle);
  return `   ${ls.every((l) => l.ok) ? '✓' : '✗'} ${s.nom} (${ls.filter((l) => l.ok).length}/${ls.length})`;
});
console.log('\nCONVERSATIONS');
console.log(parScenario.join('\n'));
const score = Math.round((100 * (lignes.length - ko.length)) / Math.max(1, lignes.length));
console.log(`\nSCORE : ${lignes.length - ko.length}/${lignes.length} contrôles (${score} %) · ${aJouer.length - new Set(ko.map((l) => l.scenario)).size}/${aJouer.length} conversations sans faute · coût ${cout.toFixed(2)} ¢`);
const SEUIL = 90;
if (score < SEUIL) { console.log(`Sous le seuil de ${SEUIL} % — ne pas déployer de changement de prompt/modèle en l’état.`); process.exit(1); }
