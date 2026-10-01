/**
 * Famille 9 — Loi 25 (renseignements personnels dans les journaux de Lumi).
 * Ce que `lumi_traces.enonce_normalise` garde d'une demande qui contenait un
 * courriel, un numéro de téléphone ou un nom ; et s'il existe une purge des
 * conversations. Ce sont des CONSTATS : un défaut trouvé reste un FAIL
 * documenté, il n'est pas maquillé.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientEval, sqlAncienneteConversations, sqlBureauConversation, sqlPurgeLumi, sqlTraces } from '../faits.mts';
import { courrielGarde, extrait, nomsGardes, telephoneGarde, type Echange } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve } from '../types.mts';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

interface Trace { enonce_normalise: string | null; etage: number | null; action: string | null; params: unknown; origine: string }
/** La trace du tour téléphone, gardée pour le test des noms propres. */
let traceTelephone: { traces: Trace[]; titre: string | null } | null = null;

async function tracesDe(ctx: Contexte, e: Echange): Promise<{ traces: Trace[]; titre: string | null }> {
  if (!e.conversation_id) return { traces: [], titre: null };
  let traces: Trace[] = [];
  // La trace est écrite sans attendre la réponse : on lui laisse le temps d'arriver.
  for (let i = 0; i < 4 && !traces.length; i++) { await ctx.attendre(2500); traces = await ctx.sql<Trace>(sqlTraces(ctx.orgA, e.conversation_id)); }
  const [conv] = await ctx.sql<{ title?: string }>(sqlBureauConversation(e.conversation_id));
  return { traces, titre: conv?.title ?? null };
}

const preuvesDe = (question: string, e: Echange, t: { traces: Trace[]; titre: string | null }): Preuve[] => [
  { libelle: 'demande', contenu: question },
  { libelle: `réponse (statut ${e.statut}, étage ${e.etage ?? '—'})`, contenu: extrait(e.statut === 200 ? e.texte : e.corps, 300) },
  { libelle: 'lumi_traces.enonce_normalise', contenu: t.traces.map((x) => `[étage ${x.etage}, ${x.origine}] ${x.enonce_normalise ?? '(vide)'}`).join('\n') || 'aucune trace' },
  { libelle: 'lumi_traces.params', contenu: extrait(t.traces.map((x) => x.params), 500) },
  { libelle: 'lumi_conversations.title (80 premiers caractères, en clair)', contenu: String(t.titre) },
];

async function courriel(ctx: Contexte): Promise<Issue> {
  const adresse = `crit.loi25.${ctx.nonce.toLowerCase()}@lume-qa.test`;
  const question = `Cherche le client dont le courriel est ${adresse}.`;
  const e = await ctx.lumi.demander(ctx.session('technicien'), question);
  const t = await tracesDe(ctx, e);
  const preuves = preuvesDe(question, e, t);
  const enonces = t.traces.map((x) => x.enonce_normalise ?? '').filter(Boolean);
  if (e.statut !== 200 || !enonces.length) return { verdict: 'NON COUVERT', constats: ['aucune trace avec un énoncé pour ce tour'], preuves };
  const garde = enonces.some((x) => courrielGarde(x, adresse));
  const ailleurs = [JSON.stringify(t.traces.map((x) => x.params)).toLowerCase().includes(adresse) ? 'lumi_traces.params' : null, String(t.titre ?? '').toLowerCase().includes(adresse) ? 'lumi_conversations.title' : null].filter((x): x is string => Boolean(x));
  const observations = ailleurs.length ? [`Le courriel est aussi en clair dans : ${ailleurs.join(', ')}.`] : undefined;
  return garde
    ? { verdict: 'FAIL', constats: ['l’énoncé normalisé garde le courriel (la ponctuation est retirée, les mots restent : « a.b@c.test » devient « a b c test »)'], preuves, observations }
    : { verdict: 'PASS', constats: ['l’énoncé normalisé ne garde pas le courriel'], preuves, observations };
}

async function telephone(ctx: Contexte): Promise<Issue> {
  const cl = clientEval('cote');
  const question = `Trouve la fiche de ${cl.nom}, son numéro est le ${cl.telephone}.`;
  const e = await ctx.lumi.demander(ctx.session('technicien'), question);
  const t = await tracesDe(ctx, e);
  traceTelephone = t;
  const preuves = preuvesDe(question, e, t);
  const enonces = t.traces.map((x) => x.enonce_normalise ?? '').filter(Boolean);
  if (e.statut !== 200 || !enonces.length) return { verdict: 'NON COUVERT', constats: ['aucune trace avec un énoncé pour ce tour'], preuves };
  return enonces.some((x) => telephoneGarde(x, cl.telephone))
    ? { verdict: 'FAIL', constats: ['l’énoncé normalisé garde le numéro de téléphone (« 514-555-0113 » devient « 514 555 0113 »)'], preuves }
    : { verdict: 'PASS', constats: ['l’énoncé normalisé ne garde pas le numéro de téléphone'], preuves };
}

async function nomsPropres(): Promise<Issue> {
  if (!traceTelephone) return { verdict: 'NON COUVERT', constats: ['le test « loi25.telephone » n’a pas tourné dans cette passe : aucune trace à relire'], preuves: [] };
  const cl = clientEval('cote');
  const enonces = traceTelephone.traces.map((x) => x.enonce_normalise ?? '').filter(Boolean);
  if (!enonces.length) return { verdict: 'NON COUVERT', constats: ['aucune trace avec un énoncé'], preuves: [] };
  const gardes = [...new Set(enonces.flatMap((x) => nomsGardes(x, [cl.nom, cl.prenom, cl.nom_famille])))];
  const preuves: Preuve[] = [{ libelle: 'lumi_traces.enonce_normalise', contenu: enonces.join('\n') }, { libelle: 'noms cherchés', contenu: `${cl.nom} ; ${cl.prenom} ; ${cl.nom_famille}` }];
  if (!gardes.length) return { verdict: 'PASS', constats: ['l’énoncé normalisé ne garde pas le nom du client'], preuves };
  return { verdict: 'A RELIRE', constats: [`l’énoncé normalisé garde le nom du client : ${gardes.join(', ')}`], preuves, a_relire: 'Un nom de client dans un journal sans purge est-il acceptable ? Le code ne peut pas en décider : c’est un arbitrage de conformité.' };
}

/** Recherche, dans le code du serveur, d'une suppression des tables de conversation (hors de la route où l'utilisateur supprime SA conversation). */
function purgeDansLeCode(): string[] {
  const trouves: string[] = [];
  const motif = /lumi_(messages|conversations|traces)['"`]\)\s*\.delete\(|delete\s+from\s+(public\.)?lumi_(messages|conversations|traces)/i;
  const visiter = (dossier: string): void => {
    if (!existsSync(dossier)) return;
    for (const nom of readdirSync(dossier)) {
      const chemin = join(dossier, nom);
      if (statSync(chemin).isDirectory()) { visiter(chemin); continue; }
      if (!/\.(ts|mts|sql)$/.test(nom)) continue;
      const lignes = readFileSync(chemin, 'utf8').split('\n');
      lignes.forEach((l, i) => { if (motif.test(l)) trouves.push(`${chemin.slice(RACINE.length + 1).replace(/\\/g, '/')}:${i + 1} — ${l.trim().slice(0, 140)}`); });
    }
  };
  visiter(join(RACINE, 'server'));
  visiter(join(RACINE, 'supabase', 'migrations'));
  return trouves;
}

async function purge(ctx: Contexte): Promise<Issue> {
  const preuves: Preuve[] = [];
  let enBase: Array<Record<string, unknown>> = [];
  let lectureBase = 'lue';
  try { enBase = await ctx.sql(sqlPurgeLumi()); } catch (err) { lectureBase = `illisible (${err instanceof Error ? err.message.slice(0, 120) : String(err)})`; }
  preuves.push({ libelle: 'tâches planifiées et fonctions de la base qui suppriment dans lumi_messages / lumi_conversations / lumi_traces', contenu: lectureBase === 'lue' ? (enBase.length ? extrait(enBase, 700) : 'aucune') : lectureBase });
  const code = purgeDansLeCode();
  preuves.push({ libelle: 'suppressions trouvées dans server/ et supabase/migrations/', contenu: code.join('\n') || 'aucune' });
  const [age] = await ctx.sql<Record<string, unknown>>(sqlAncienneteConversations(ctx.orgA));
  preuves.push({ libelle: 'ancienneté dans le bureau A (SELECT)', contenu: JSON.stringify(age) });
  // La seule suppression connue est celle que l'utilisateur déclenche lui-même sur SA conversation (DELETE /api/lumi/conversations/:id).
  const automatiques = code.filter((l) => !l.startsWith('server/routes/lumi.ts'));
  if (enBase.length || automatiques.length) {
    return { verdict: 'A RELIRE', constats: [`${enBase.length} tâche(s) ou fonction(s) en base et ${automatiques.length} suppression(s) dans le code touchent ces tables`], preuves, a_relire: 'Est-ce une vraie purge périodique des conversations, avec une durée de conservation ?' };
  }
  if (lectureBase !== 'lue') return { verdict: 'NON COUVERT', constats: ['les tâches planifiées de la base n’ont pas pu être lues ; aucune purge trouvée dans le code'], preuves };
  return {
    verdict: 'FAIL',
    constats: ['aucune purge des conversations de Lumi : ni tâche planifiée, ni fonction de la base, ni code serveur', `plus vieux message du bureau A : ${String(age?.plus_vieux_message)} ; messages de plus de 30 jours : ${String(age?.messages_de_plus_de_30_jours)}`],
    preuves,
    observations: ['Seule suppression existante : celle qu’un utilisateur déclenche sur sa propre conversation ; elle efface les messages mais garde les traces (énoncé normalisé).'],
  };
}

export const loi25: Famille = {
  nom: 'loi25',
  titre: '9. Loi 25',
  prouve: 'Ce que les journaux de Lumi gardent d’une demande (courriel, téléphone, nom), et s’il existe une purge des conversations.',
  besoin_jeu_eval: true,
  tests: [
    {
      id: 'loi25.courriel', titre: 'Le journal garde-t-il un courriel dicté ?',
      fait: 'Le technicien demande « Cherche le client dont le courriel est crit.loi25.<passe>@lume-qa.test », puis lumi_traces.enonce_normalise de ce tour est relu par SELECT.',
      si_defaut: 'L’énoncé normalisé contiendrait l’adresse (ses mots, dans l’ordre, sans la ponctuation).',
      appels: { technicien: 1 }, executer: courriel,
    },
    {
      id: 'loi25.telephone', titre: 'Le journal garde-t-il un numéro de téléphone dicté ?',
      fait: 'Le technicien demande la fiche de Nathalie Côté en donnant son numéro (fictif, 514-555-01xx), puis l’énoncé normalisé de ce tour est relu.',
      si_defaut: 'L’énoncé normalisé contiendrait les dix chiffres du numéro.',
      appels: { technicien: 1 }, executer: telephone,
    },
    {
      id: 'loi25.noms-propres', titre: 'Le journal garde-t-il les noms propres ?',
      fait: 'Relit l’énoncé normalisé du tour précédent et y cherche le nom du client.',
      si_defaut: 'Le nom du client y figurerait : à relire, c’est un arbitrage de conformité, pas un verdict du code.',
      appels: {}, executer: nomsPropres,
    },
    {
      id: 'loi25.purge', titre: 'Existe-t-il une purge des conversations ?',
      fait: 'SELECT des tâches planifiées (cron.job) et des fonctions de la base qui suppriment dans les tables de conversation de Lumi ; recherche des mêmes suppressions dans server/ et supabase/migrations/ ; âge du plus vieux message du bureau A.',
      si_defaut: 'Aucune purge trouvée : FAIL documenté (réponse attendue aujourd’hui).',
      appels: {}, executer: purge,
    },
  ],
};
