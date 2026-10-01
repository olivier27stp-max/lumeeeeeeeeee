/**
 * Famille 6 — Une seule exécution.
 * Une carte confirmée deux fois en même temps (double clic), puis une troisième
 * fois après coup, n'écrit qu'UNE fois : une seule ligne en base, un seul reçu
 * « fait », et les autres appels rendent « déjà fait » ou un refus propre.
 *
 * L'écriture est anodine et créée pour l'occasion : une tâche « [CRIT]
 * idempotence … », mise à la corbeille à la fin. C'est la seule carte d'action
 * que la batterie confirme (avec « oublier une note », famille 3).
 */
import { sqlAutorisations, sqlModeLumi } from '../faits.mts';
import { extrait, jugerIdempotence, type Echange, type ReponseConfirmation } from '../jugement.mts';
import type { Contexte, Famille, Issue, Preuve } from '../types.mts';
import { MARQUEUR_CRIT } from '../types.mts';

const titreTache = (ctx: Contexte): string => `${MARQUEUR_CRIT} idempotence ${ctx.nonce}`;
export const sqlTaches = (org: string, titre: string): string => {
  if (!/^[A-Za-z0-9 [\]-]+$/.test(titre)) throw new Error(`titre de tâche invalide : ${titre}`);
  return `select id, title, status, created_by, created_at, deleted_at from tasks where org_id = '${org}' and title = '${titre}' and deleted_at is null`;
};
export const sqlResultatsDansLaConversation = (conversationId: string, toolUseId: string): string => {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId) || !/^[A-Za-z0-9_-]+$/.test(toolUseId)) throw new Error('identifiants de conversation invalides');
  return `select count(*)::int as resultats from lumi_messages m, jsonb_array_elements(case when jsonb_typeof(m.content) = 'array' then m.content else '[]'::jsonb end) b
           where m.conversation_id = '${conversationId}' and m.role = 'user' and b->>'type' = 'tool_result' and b->>'tool_use_id' = '${toolUseId}'`;
};

const codeDe = (json: unknown): string | null => (json && typeof json === 'object' && typeof (json as Record<string, unknown>).code === 'string' ? String((json as Record<string, unknown>).code) : null);
const reponse = (r: { statut: number; echange: Echange | null; json: unknown }): ReponseConfirmation => ({
  statut: r.statut, code: codeDe(r.json), texte: r.echange?.texte ?? (typeof r.json === 'object' && r.json ? String((r.json as Record<string, unknown>).error ?? '') : ''),
  recus: (r.echange?.executes ?? []).map((x) => ({ ok: x.ok })),
});

async function doubleConfirmation(ctx: Contexte): Promise<Issue> {
  const s = ctx.session('proprietaire');
  const titre = titreTache(ctx);
  const preuves: Preuve[] = [];
  // Préalables : le compte est en mode « demander » et n'a pas coché « toujours confirmer » pour les tâches — sinon il n'y a pas de carte à confirmer.
  const [mode] = await ctx.sql<{ lumi_mode: string | null }>(sqlModeLumi(ctx.orgA, s.userId));
  const autorisations = (await ctx.sql<{ tool: string }>(sqlAutorisations(ctx.orgA, s.userId))).map((a) => a.tool);
  preuves.push({ libelle: 'préalables', contenu: `mode Lumi : ${mode?.lumi_mode} ; outils cochés « toujours confirmer » : ${autorisations.join(', ') || 'aucun'}` });
  if (mode?.lumi_mode !== 'demander' || autorisations.includes('create_task')) {
    return { verdict: 'NON COUVERT', constats: ['le compte n’est pas en mode « demander », ou « créer une tâche » part d’office : aucune carte à confirmer deux fois'], preuves };
  }
  const question = `Crée une tâche : ${titre}`;
  const e = await ctx.lumi.demander(s, question);
  preuves.push({ libelle: 'demande', contenu: question }, { libelle: `réponse (statut ${e.statut}, étage ${e.etage ?? '—'})`, contenu: extrait(e.statut === 200 ? { texte: e.texte, cartes: e.propositions.map((p) => ({ outil: p.tool, d_office: p.auto, args: p.args })) } : e.corps) });
  const carte = e.propositions.find((p) => p.tool === 'create_task' && !p.auto);
  if (e.statut !== 200 || !carte || !e.conversation_id) return { verdict: 'NON COUVERT', constats: ['pas de carte « créer une tâche » en attente : rien à confirmer deux fois'], preuves };
  if (e.executes.length) return { verdict: 'FAIL', constats: ['la tâche a été créée sans confirmation, en mode « demander »'], preuves };

  // Deux confirmations EN MÊME TEMPS (double clic), puis une troisième après coup.
  const [a, b] = await Promise.all([
    ctx.lumi.confirmer(s, e.conversation_id, carte.tool_use_id, 'create_task'),
    ctx.lumi.confirmer(s, e.conversation_id, carte.tool_use_id, 'create_task'),
  ]);
  await ctx.attendre(2500);
  const c = await ctx.lumi.confirmer(s, e.conversation_id, carte.tool_use_id, 'create_task');
  const reponses = [a, b, c].map(reponse);
  for (const [i, r] of reponses.entries()) preuves.push({ libelle: `confirmation ${i + 1}${i < 2 ? ' (en parallèle)' : ' (après coup)'}`, contenu: `statut ${r.statut}${r.code ? `, code ${r.code}` : ''} — reçus : ${JSON.stringify(r.recus)} — « ${extrait(r.texte, 200)} »` });
  await ctx.attendre(1500);
  const requete = sqlTaches(ctx.orgA, titre);
  const taches = await ctx.sql<{ id: string }>(requete);
  preuves.push({ libelle: 'tâches en base (SELECT)', contenu: `${requete}\n→ ${taches.length} ligne(s) : ${taches.map((t) => t.id).join(', ')}` });
  const j = jugerIdempotence(reponses, taches.length);
  // Constat annexe (hors critère) : deux reçus sauvegardés pour la même carte rendent la conversation fragile.
  const [doubles] = await ctx.sql<{ resultats: number }>(sqlResultatsDansLaConversation(e.conversation_id, carte.tool_use_id));
  const observations = Number(doubles?.resultats) > 1
    ? [`${doubles.resultats} résultats sont enregistrés dans la conversation pour la MÊME carte : le prochain message de cette conversation peut être refusé par le fournisseur du modèle (risque n° 17 de l’inventaire).`]
    : undefined;
  return { ...j, preuves, observations };
}

export const idempotence: Famille = {
  nom: 'idempotence',
  titre: '6. Une seule exécution',
  prouve: 'Une carte confirmée trois fois (deux en parallèle, une après coup) n’écrit qu’une fois.',
  tests: [
    {
      id: 'idempotence.double-confirmation', titre: 'Tâche [CRIT] confirmée deux fois en parallèle, puis une troisième fois',
      fait: 'Le propriétaire demande « Crée une tâche : [CRIT] idempotence <passe> » (carte), puis POST /api/lumi/execute (confirmer) part deux fois en même temps et une troisième fois 2,5 s plus tard ; les tâches de ce titre sont comptées en base.',
      si_defaut: 'Deux tâches en base, ou deux reçus « C’est fait », ou une erreur 500 au lieu de « déjà fait » / refus propre.',
      ecrit: ['tasks : une tâche « [CRIT] idempotence <passe> » créée par Lumi (mise à la corbeille à la fin)', 'agent_actions : l’empreinte de l’écriture (purgée par le produit après 24 h)'],
      appels: { proprietaire: 1 }, executer: doubleConfirmation,
    },
  ],
};
