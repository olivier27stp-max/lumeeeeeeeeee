/* ═══════════════════════════════════════════════════════════════
   Agent F — baseline du coût de Lumi sur des scénarios d'AUTOMATISATIONS.

   Vrai modèle, pile locale, API locale (port 3496). Chaque élément est joué
   UNE fois. Après chaque appel, le script relit ce que la base a écrit
   (`ai_usage`, `lumi_traces`) : c'est la base qui fait foi, pas le flux.

     node D:/lume-final/outils/serveurs.mjs D:/lume-final/wt-f 3496 5496 --lumi   (en arrière-plan)
     QA_AUTO_SUFFIXE=f npx tsx --env-file=.env.local scripts/qa/finale/f/mesurer.mts [--seul unitaires|conv-clavardage|conv-panneau]

   Le jeu :
   - 8 demandes unitaires par le clavardage de Lumi (/api/lumi/chat, puis
     Confirmer quand une carte est proposée) ;
   - les 5 d'entre elles qui existent dans le panneau « Construire avec Lumi »
     de l'éditeur (/api/automations/rules/generer) — activer, mettre en pause
     et renommer y sont des boutons, sans modèle ;
   - 2 conversations de 6 tours sur une même automatisation, une par chemin.

   Sortie : D:/lume-final/sorties/f-mesures.json (brut) et, à l'écran, les
   tableaux Markdown repris dans notes/F-mesures.md.
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import {
  preparer, clavarder, deciderCarte, genererPanneau, repere, releve, assembler, creditsVus, tableau, SORTIES,
  type Mesure, type Session, type Echange, type Atelier, type LigneUsage, type LigneTrace,
} from './commun.mts';

const seul = (() => { const i = process.argv.indexOf('--seul'); return i > -1 ? process.argv[i + 1] : null; })();
const FICHIER = `${SORTIES}/f-mesures.json`;
const atelier: Atelier = await preparer();
const { admin, orgA } = atelier;
const s: Session = { jeton: atelier.jetonA, orgId: orgA };

type Etape = Record<string, unknown>;
const NOMS = {
  relance: 'Relance de soumission F',
  rappel: 'Rappel de facture F',
  suiviChat: 'Suivi après visite F',
  suiviPanneau: 'Suivi après visite F (éditeur)',
};
const sms = (id: string, body: string, suivant: string | null): Etape => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });
const courriel = (id: string, subject: string, body: string, suivant: string | null): Etape => ({ id, type: 'action', action: { type: 'send_email', config: { subject, body } }, suivant });
const attendre = (id: string, jours: number, suivant: string): Etape => ({ id, type: 'attendre', delai_secondes: jours * 86_400, suivant });

const SEMIS: Array<{ name: string; trigger_event: string; steps: Etape[] }> = [
  {
    name: NOMS.relance, trigger_event: 'quote.sent',
    steps: [
      attendre('e1', 3, 'e2'),
      sms('e2', 'Bonjour [client_first_name], avez-vous eu le temps de regarder votre soumission ? La voici : [quote_link]. [company_name]', 'e3'),
      attendre('e3', 2, 'e4'),
      courriel('e4', 'Votre soumission [quote_number]', '<p>Bonjour [client_first_name],</p><p>Votre soumission est toujours disponible : [quote_link]. Répondez à ce courriel si vous avez des questions.</p><p>[company_name]</p>', null),
    ],
  },
  {
    name: NOMS.rappel, trigger_event: 'invoice.overdue',
    steps: [
      attendre('e1', 7, 'e2'),
      sms('e2', 'Bonjour [client_first_name], votre facture [invoice_number] de [invoice_total] est en retard. Vous pouvez la régler ici : [invoice_link]. Merci, [company_name]', null),
    ],
  },
  {
    name: NOMS.suiviChat, trigger_event: 'job.completed',
    steps: [sms('e1', 'Bonjour [client_first_name], merci d’avoir fait confiance à [company_name]. Tout s’est bien passé lors de notre visite ? Répondez à ce texto si vous avez un commentaire.', null)],
  },
  {
    name: NOMS.suiviPanneau, trigger_event: 'job.completed',
    steps: [sms('e1', 'Bonjour [client_first_name], merci d’avoir fait confiance à [company_name]. Tout s’est bien passé lors de notre visite ? Répondez à ce texto si vous avez un commentaire.', null)],
  },
];

/** Remet le bureau dans l'état de départ : les quatre automatisations du jeu, en pause, et rien d'autre de créé par une passe précédente. */
async function semer(): Promise<Record<string, string>> {
  const { data: existantes } = await admin.from('automation_rules').select('id, name, is_preset').eq('org_id', orgA).is('deleted_at', null);
  const maintenant = new Date().toISOString();
  for (const r of (existantes ?? []) as Array<{ id: string; name: string; is_preset: boolean }>) {
    if (r.is_preset) continue;
    // Créées par une passe précédente (ou par ce jeu) : à la corbeille, pour que les noms restent uniques.
    await admin.from('automation_rules').update({ deleted_at: maintenant, is_active: false }).eq('id', r.id).eq('org_id', orgA);
  }
  const ids: Record<string, string> = {};
  for (const semis of SEMIS) {
    const { data, error } = await admin.from('automation_rules').insert({
      org_id: orgA, name: semis.name, description: '', trigger_event: semis.trigger_event, conditions: {}, delay_seconds: 0,
      actions: [], steps: semis.steps, is_active: false,
    }).select('id').single();
    if (error) throw new Error(`semis ${semis.name} : ${error.message}`);
    ids[semis.name] = data.id as string;
  }
  return ids;
}

const mesures: Mesure[] = existsSync(FICHIER) && seul ? (JSON.parse(readFileSync(FICHIER, 'utf8')).mesures as Mesure[]) : [];
const conversations: Record<string, string> = existsSync(FICHIER) && seul ? (JSON.parse(readFileSync(FICHIER, 'utf8')).conversations ?? {}) : {};
const garder = (m: Mesure) => {
  const i = mesures.findIndex((x) => x.id === m.id);
  if (i > -1) mesures[i] = m; else mesures.push(m);
  console.log(`  ${m.id.padEnd(22)} ${String(m.cout_cents.toFixed(3)).padStart(7)} ¢  ${String(m.credits.toFixed(3)).padStart(6)} cr.  entrée ${m.entree} · lu ${m.cache_lu} · écrit ${m.cache_ecrit} · sortie ${m.sortie}  cache ${m.taux_cache ?? '—'} %  ${m.latence_ms} ms  [${m.modeles.join(', ') || 'aucun modèle'}]${m.carte ? `  carte ${m.carte}` : ''}`);
  if (m.notes.length) console.log(`      ${m.notes.join(' | ')}`);
};

/**
 * Une demande par le clavardage : le message, puis — s'il y a une carte — le
 * clic sur Confirmer. Les deux appels sont comptés ensemble : c'est ce que la
 * demande coûte à l'entreprise.
 */
async function demandeClavardage(id: string, message: string, conversationId: string | null = null): Promise<{ mesure: Mesure; conversationId: string | null; carte: string | null }> {
  const depuis = await repere(admin, orgA);
  const notes: string[] = [];
  const r = await clavarder(s, message, conversationId);
  let latence = r.latence_ms;
  let texte = r.texte;
  const outils = [...r.outils];
  if (r.statut !== 200) notes.push(`HTTP ${r.statut} : ${JSON.stringify(r.erreur).slice(0, 200)}`);
  if (r.erreur && r.statut === 200) notes.push(`erreur du flux : ${JSON.stringify(r.erreur).slice(0, 160)}`);
  const conv = r.conversation_id ?? conversationId;
  let carte: string | null = null;
  if (r.proposition && conv) {
    carte = r.proposition.groupe?.length ? r.proposition.groupe.map((g) => g.tool).join(' + ') : r.proposition.tool;
    const e = await deciderCarte(s, conv, r.proposition.tool_use_id, 'confirm');
    latence += e.latence_ms;
    texte += ` ⟶ [Confirmer] ${e.texte}`;
    if (e.statut !== 200) notes.push(`Confirmer : HTTP ${e.statut} ${JSON.stringify(e.erreur).slice(0, 200)}`);
    if (e.executes.some((x) => !x.ok)) notes.push('Confirmer : l’exécution a échoué');
  }
  const { usage, traces } = await releve(admin, orgA, depuis);
  const mesure = assembler({ id, chemin: 'clavardage', demande: message, reponse: texte, latence_ms: latence, premier_texte_ms: r.premier_texte_ms, usage, traces, carte, outilsVus: outils, etage: r.etage, notes });
  verifierTraces(mesure, usage, traces);
  garder(mesure);
  return { mesure, conversationId: conv, carte };
}

/** Ce que la trace dit, comparé à ce que le grand livre a débité : tout écart est noté. */
function verifierTraces(m: Mesure, usage: LigneUsage[], traces: LigneTrace[]): void {
  const sansConversation = usage.filter((l) => !l.conversation_id);
  if (sansConversation.length) m.notes.push(`${sansConversation.length} ligne(s) du grand livre SANS conversation (source ${[...new Set(sansConversation.map((l) => l.source))].join(', ')}, ${sansConversation.reduce((x, l) => x + Number(l.cost_cents), 0).toFixed(3)} ¢)`);
  const coutTraces = traces.reduce((x, t) => x + Number(t.cost_cents ?? 0), 0);
  const ecart = Math.round((m.cout_cents - coutTraces) * 1000) / 1000;
  if (usage.length && Math.abs(ecart) > 0.0005) m.notes.push(`coût des traces ${coutTraces.toFixed(3)} ¢ ≠ grand livre ${m.cout_cents.toFixed(3)} ¢ (écart ${ecart} ¢)`);
  if (usage.length && !traces.length) m.notes.push('AUCUNE ligne dans lumi_traces pour cet appel');
}

async function demandePanneau(id: string, demande: string, contexte: { echanges?: Echange[]; parcours?: { trigger_event?: string; steps?: unknown[] } | null; ruleId?: string | null } = {}): Promise<{ mesure: Mesure; corps: Record<string, any> | null; statut: number }> {
  const depuis = await repere(admin, orgA);
  const r = await genererPanneau(s, demande, { echanges: contexte.echanges, parcoursActuel: contexte.parcours ?? null, ruleId: contexte.ruleId ?? null });
  const notes: string[] = [];
  if (r.statut !== 200) notes.push(`HTTP ${r.statut} : ${String(r.corps?.error ?? r.brut).slice(0, 220)}`);
  const { usage, traces } = await releve(admin, orgA, depuis, false);
  const reponse = r.statut === 200 ? `${r.corps?.resume ?? ''} [${(r.corps?.steps ?? []).length} étapes]` : String(r.corps?.error ?? '');
  const mesure = assembler({ id, chemin: 'panneau', demande, reponse, latence_ms: r.latence_ms, usage, traces, notes });
  verifierTraces(mesure, usage, traces);
  garder(mesure);
  return { mesure, corps: r.corps, statut: r.statut };
}

const creditsAvant = await creditsVus(s);
console.log(`Bureau A (f) ${orgA} — crédits au départ : ${JSON.stringify(creditsAvant)}`);

/* ═══ 1. Demandes unitaires ═══ */
if (!seul || seul === 'unitaires') {
  const ids = await semer();
  console.log('\n— Demandes unitaires, clavardage —');
  await demandeClavardage('U1-creer-simple', 'Crée une automatisation : quand un devis est envoyé, attends 3 jours puis envoie un texto de relance au client.');
  await demandeClavardage('U2-creer-gros', 'Crée une automatisation pour les factures en retard : si la facture dépasse 500 $, attends 3 jours et envoie un texto de rappel ; attends encore 4 jours et, si elle est toujours impayée, envoie un courriel de rappel avec le lien de paiement ; attends 7 jours de plus puis crée une tâche pour que j’appelle le client.');
  await demandeClavardage('U3-changer-texto', `Change le texto de l’automatisation « ${NOMS.relance} » pour : Bonjour [client_first_name], des questions sur votre soumission ? Elle est ici : [quote_link]. [company_name]`);
  await demandeClavardage('U4-changer-courriel', `Dans l’automatisation « ${NOMS.relance} », change le courriel : objet « Un mot sur votre soumission », et comme texte : Bonjour [client_first_name], votre soumission vous attend ici : [quote_link]. Écrivez-nous pour toute question. [company_name]`);
  await demandeClavardage('U5-activer', `Active l’automatisation ${NOMS.rappel}`);
  await demandeClavardage('U6-mettre-en-pause', `Mets en pause l’automatisation ${NOMS.rappel}`);
  await demandeClavardage('U7-renommer', `Renomme l’automatisation « ${NOMS.rappel} » en « Rappel de facture en retard F ».`);
  await demandeClavardage('U8-expliquer', `Explique-moi ce que fait l’automatisation « ${NOMS.relance} ».`);

  console.log('\n— Demandes unitaires, panneau de l’éditeur —');
  const relance = SEMIS[0];
  await demandePanneau('P1-creer-simple', 'Quand un devis est envoyé, attends 3 jours puis envoie un texto de relance au client.');
  await demandePanneau('P2-creer-gros', 'Pour les factures en retard : si la facture dépasse 500 $, attends 3 jours et envoie un texto de rappel ; attends encore 4 jours et, si elle est toujours impayée, envoie un courriel de rappel avec le lien de paiement ; attends 7 jours de plus puis crée une tâche pour que j’appelle le client.');
  await demandePanneau('P3-changer-texto', 'Change le texto pour : Bonjour [client_first_name], des questions sur votre soumission ? Elle est ici : [quote_link]. [company_name]', { parcours: { trigger_event: relance.trigger_event, steps: relance.steps }, ruleId: ids[NOMS.relance] });
  await demandePanneau('P4-changer-courriel', 'Change le courriel : objet « Un mot sur votre soumission », et comme texte : Bonjour [client_first_name], votre soumission vous attend ici : [quote_link]. Écrivez-nous pour toute question. [company_name]', { parcours: { trigger_event: relance.trigger_event, steps: relance.steps }, ruleId: ids[NOMS.relance] });
  await demandePanneau('P8-expliquer', 'Explique-moi ce que fait cette automatisation.', { parcours: { trigger_event: relance.trigger_event, steps: relance.steps }, ruleId: ids[NOMS.relance] });
  conversations.semis = JSON.stringify(ids);
}

const TOURS = [
  'change le message',
  'plus court',
  'ajoute un délai de 3 jours',
  'seulement pour les clients avec l’étiquette commercial',
  'explique-moi ce qu’elle fait',
  'active-la',
];

/* ═══ 2. Conversation de 6 tours, clavardage ═══ */
if (!seul || seul === 'conv-clavardage') {
  if (seul) await semer();
  console.log('\n— Conversation de 6 tours, clavardage —');
  let conv: string | null = null;
  for (let i = 0; i < TOURS.length; i++) {
    const message = i === 0 ? `Dans l’automatisation « ${NOMS.suiviChat} », ${TOURS[0]} : écris un texto plus chaleureux.` : TOURS[i];
    const r = await demandeClavardage(`C1-tour${i + 1}`, message, conv);
    conv = r.conversationId;
  }
  if (conv) conversations.clavardage = conv;
}

/* ═══ 3. Conversation de 6 tours, panneau de l'éditeur ═══ */
if (!seul || seul === 'conv-panneau') {
  console.log('\n— Conversation de 6 tours, panneau de l’éditeur —');
  const { data: regle } = await admin.from('automation_rules').select('id, trigger_event, steps').eq('org_id', orgA).eq('name', NOMS.suiviPanneau).is('deleted_at', null).maybeSingle();
  if (!regle) throw new Error(`automatisation « ${NOMS.suiviPanneau} » absente : relancer sans --seul, ou avec --seul unitaires d’abord.`);
  // Ce que fait l'éditeur (src/pages/AutomationBuilderPage.tsx) : il renvoie les 6 derniers échanges et le parcours à l'écran,
  // et remplace le parcours à l'écran par celui que Lumi propose.
  let parcours: { trigger_event?: string; steps?: unknown[] } = { trigger_event: regle.trigger_event as string, steps: regle.steps as unknown[] };
  const echanges: Echange[] = [];
  for (let i = 0; i < TOURS.length; i++) {
    const demande = i === 0 ? `${TOURS[0]} : écris un texto plus chaleureux.` : TOURS[i].length < 10 ? `${TOURS[i]} stp` : TOURS[i];
    const r = await demandePanneau(`C2-tour${i + 1}`, demande, { echanges: echanges.slice(-6), parcours, ruleId: regle.id as string });
    if (r.statut === 200 && r.corps) {
      parcours = { trigger_event: r.corps.trigger_event, steps: r.corps.steps };
      echanges.push({ role: 'user', content: demande }, { role: 'assistant', content: String(r.corps.resume ?? '') });
    } else {
      echanges.push({ role: 'user', content: demande }, { role: 'assistant', content: String(r.corps?.error ?? '') });
    }
  }
  conversations.panneau = String(regle.id);
}

const creditsApres = await creditsVus(s);
const total = mesures.reduce((x, m) => x + m.cout_cents, 0);
writeFileSync(FICHIER, JSON.stringify({ quand: new Date().toISOString(), org: orgA, credits_avant: creditsAvant, credits_apres: creditsApres, total_cents: Math.round(total * 1000) / 1000, conversations, mesures }, null, 1));

/* ── Tableaux ── */
const ligne = (m: Mesure) => [
  m.id, m.chemin, m.cout_cents.toFixed(3), m.credits.toFixed(3), m.entree, m.cache_lu, m.cache_ecrit_5m ?? m.cache_ecrit, m.cache_ecrit_1h ?? '—', m.sortie,
  m.taux_cache === null ? '—' : `${m.taux_cache} %`, (m.latence_ms / 1000).toFixed(1), m.modeles.map((x) => x.replace('claude-', '')).join(' + ') || 'aucun', m.appels_modele, m.outils_charges, m.carte ?? (m.outils_appeles.join(', ') || '—'),
];
const ENTETES = ['Demande', 'Chemin', 'Coût (¢ US)', 'Crédits', 'Entrée', 'Cache lu', 'Écrit 5 min', 'Écrit 1 h', 'Sortie', 'Cache lu / entrée', 'Latence (s)', 'Modèle', 'Appels', 'Outils chargés', 'Outils / carte'];
console.log('\n' + tableau(ENTETES, mesures.map(ligne)));
for (const [nom, prefixe] of [['Conversation clavardage', 'C1-'], ['Conversation panneau', 'C2-']] as const) {
  const tours = mesures.filter((m) => m.id.startsWith(prefixe));
  if (!tours.length) continue;
  const somme = (f: (m: Mesure) => number) => tours.reduce((x, m) => x + f(m), 0);
  const lu = somme((m) => m.cache_lu); const tout = somme((m) => m.entree + m.cache_lu + m.cache_ecrit);
  console.log(`\n${nom} : ${somme((m) => m.cout_cents).toFixed(3)} ¢ · ${somme((m) => m.credits).toFixed(3)} crédits · cache lu ${tout ? Math.round((lu / tout) * 1000) / 10 : 0} % de l’entrée · ${(somme((m) => m.latence_ms) / 1000).toFixed(1)} s`);
}
console.log(`\nTotal de la passe : ${total.toFixed(3)} ¢ US. Crédits vus par l’API après : ${JSON.stringify(creditsApres)}`);
process.exit(0);
