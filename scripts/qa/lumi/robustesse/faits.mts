/**
 * Robustesse des conversations de Lumi — LES FAITS : les bureaux, la fiche des faits, et les SELECT à nous.
 * ─────────────────────────────────────────────────────────────────────────
 * L'identité des fiches (noms, téléphones, courriels) vient de la fiche des faits du bureau
 * (`evals/lumi/fixture-eval3.json`, relue dans la base par le seed) ; les identifiants sont dérivés de la clé et du
 * bureau (`idEval`) ; les montants sont relus dans la base AU MOMENT du test, par les requêtes de ce fichier —
 * jamais par le code de Lumi.
 *
 * Les fonctions `sql…` sont pures (elles rendent le texte de la requête) ; un test vérifie que chacune est un
 * SELECT seul.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { idEval } from '../jeu-eval.mts';
import { UUID } from '../critiques/jugement.mts';
import type { Cible, MessageHistorique } from './jugement.mts';
import type { Compte } from './types.mts';

/* ── Les bureaux de test que la batterie connaît ───────────────────────── */

export interface Bureau { cle: string; org: string; fixture: string; comptes: Record<Compte, string> }
const comptesDe = (prefixe: string): Record<Compte, string> => ({
  proprio1: `${prefixe}.proprio1@lume-qa.test`, proprio2: `${prefixe}.proprio2@lume-qa.test`, proprio3: `${prefixe}.proprio3@lume-qa.test`,
  proprio4: `${prefixe}.proprio4@lume-qa.test`, technicien: `${prefixe}.tech@lume-qa.test`,
});
/** « [TEST] QA Lumi éval 3 — ne pas utiliser » : la cible par défaut. */
export const ORG_DEFAUT = '7f859087-0f5e-4604-8a20-315be43be4c3';
export const BUREAUX: readonly Bureau[] = [
  { cle: 'eval3', org: ORG_DEFAUT, fixture: 'fixture-eval3.json', comptes: comptesDe('eval3') },
  { cle: 'eval2', org: '5930d318-b207-40f3-9e14-f8898a02e240', fixture: 'fixture-eval2.json', comptes: comptesDe('eval2') },
];
export const bureauDe = (org: string): Bureau | null => BUREAUX.find((b) => b.org === org.toLowerCase()) ?? null;

/* ── La fiche des faits ────────────────────────────────────────────────── */

export interface ClientDuJeu { cle: string; id: string; nom: string; prenom: string; nom_famille: string; entreprise: string | null; courriel: string | null; telephone: string; ville: string }
export interface FactureDuJeu { cle: string; id: string; numero: string | null; client: string; total_cents: number; solde_cents: number; statut: string }

export interface Faits {
  org: string;
  nom_org: string;
  client(cle: string): ClientDuJeu;
  clients(): ClientDuJeu[];
  facture(cle: string): FactureDuJeu;
  /** Identifiant d'une fiche du jeu dans CE bureau (`client:bergeron`, `facture:en_retard`, `paiement:paiement_levesque`…). */
  id(cle: string): string;
  /** La cible « ce client » : téléphone, courriel et nom de famille (pour reconnaître une réponse ou une carte). */
  cibleClient(cle: string): Cible;
}

interface FichierFaits {
  etat: string; org: { id: string; nom: string };
  clients: Record<string, { id: string; nom: string; prenom: string; nom_famille: string; entreprise: string | null; courriel: string | null; telephone: string; ville: string }>;
  factures: Record<string, { numero: string | null; client: string; total_cents: number; solde_cents: number; statut: string }>;
}

/** Bâtit les faits à partir du contenu de la fiche (pur). Refuse une fiche d'un autre bureau, ou prévisionnelle. */
export function faitsDepuis(fichier: FichierFaits, org: string): Faits {
  if (fichier.org?.id !== org) throw new Error(`la fiche des faits est celle du bureau ${fichier.org?.id}, pas de ${org}`);
  if (fichier.etat !== 'reel') throw new Error(`la fiche des faits est « ${fichier.etat} » : relancer le seed avec --fixture-seulement pour la relire dans la base`);
  const client = (cle: string): ClientDuJeu => {
    const c = fichier.clients[cle];
    if (!c) throw new Error(`client inconnu du jeu : ${cle}`);
    return { cle, id: c.id, nom: c.nom, prenom: c.prenom, nom_famille: c.nom_famille, entreprise: c.entreprise, courriel: c.courriel, telephone: c.telephone, ville: c.ville };
  };
  const id = (cle: string): string => idEval(cle, org);
  return {
    org, nom_org: fichier.org.nom, client, id,
    clients: () => Object.keys(fichier.clients).map(client),
    facture: (cle) => {
      const f = fichier.factures[cle];
      if (!f) throw new Error(`facture inconnue du jeu : ${cle}`);
      return { cle, id: id(`facture:${cle}`), numero: f.numero, client: f.client, total_cents: f.total_cents, solde_cents: f.solde_cents, statut: f.statut };
    },
    cibleClient: (cle) => { const c = client(cle); return { libelle: `${c.nom} (${c.ville})`, telephones: [c.telephone], courriels: c.courriel ? [c.courriel] : [] }; },
  };
}

export function chargerFaits(racine: string, org: string): Faits {
  const b = bureauDe(org);
  if (!b) throw new Error(`bureau inconnu de la batterie : ${org} (connus : ${BUREAUX.map((x) => `${x.cle} ${x.org}`).join(', ')})`);
  return faitsDepuis(JSON.parse(readFileSync(join(racine, 'evals', 'lumi', b.fixture), 'utf8')) as FichierFaits, b.org);
}

/* ── Les SELECT ────────────────────────────────────────────────────────── */

const u = (id: string): string => { if (!UUID.test(id)) throw new Error(`identifiant invalide : ${id}`); return `'${id.toLowerCase()}'`; };
const t = (s: string): string => `'${String(s).replace(/'/g, "''")}'`;
const instant = (iso: string): string => { if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(iso)) throw new Error(`instant invalide : ${iso}`); return `'${iso}'::timestamptz`; };

export const sqlBureau = (org: string): string =>
  `select o.id, o.name, (select s.mode from orgs_envois_simules s where s.org_id = o.id) as bac from orgs o where o.id = ${u(org)}`;

export const sqlFuseau = (org: string): string =>
  `select coalesce(nullif(trim(timezone), ''), 'America/Toronto') as fuseau from company_settings where org_id = ${u(org)}`;

/** Le jeu [EVAL] est-il là ? Les 12 clients et les 7 factures, par leurs identifiants dérivés. */
export const sqlJeuPresent = (org: string, clients: string[], factures: string[]): string =>
  `select (select count(*) from clients where org_id = ${u(org)} and deleted_at is null and id in (${clients.map(u).join(', ')}))::int as clients,
          (select count(*) from invoices where org_id = ${u(org)} and deleted_at is null and id in (${factures.map(u).join(', ')}))::int as factures`;

export const sqlMembre = (org: string, userId: string): string => `select lumi_mode, role, status from memberships where org_id = ${u(org)} and user_id = ${u(userId)}`;
export const sqlAutorisations = (org: string, userId: string): string => `select tool from lumi_autorisations where org_id = ${u(org)} and user_id = ${u(userId)}`;

/** Tours de Lumi d'une personne dans l'heure écoulée (une trace par tour ; un refus 400 ou 429 n'en laisse pas). */
export const sqlToursDansLHeure = (org: string, userId: string): string =>
  `select count(*)::int as tours from lumi_traces
    where org_id = ${u(org)} and user_id = ${u(userId)} and canal = 'lumi' and origine not in ('carte', 'api') and created_at > now() - interval '60 minutes'`;

/** Tours de Lumi récents dans le bureau, hors des conversations de cette batterie : une autre batterie tourne-t-elle ? */
export const sqlActiviteRecente = (org: string, minutes: number, horsConversations: string[] = []): string =>
  `select count(*)::int as traces, max(created_at) as derniere from lumi_traces
    where org_id = ${u(org)} and origine <> 'api' and created_at > now() - interval '${Math.trunc(minutes)} minutes'${horsConversations.length ? ` and (conversation_id is null or conversation_id not in (${horsConversations.map(u).join(', ')}))` : ''}`;

/** Les traces d'une conversation, dans l'ordre, sans les décisions de carte : une ligne par tour. */
export const sqlTours = (org: string, conversationId: string): string =>
  `select etage, action, resultat, model, cost_cents::float8 as cost_cents, origine, created_at,
          params->'mesure'->>'stop_reason' as stop, (params->'mesure'->>'appels_modele')::int as appels_modele
     from lumi_traces where org_id = ${u(org)} and conversation_id = ${u(conversationId)} and origine <> 'carte' order by created_at, id`;

/** Compteurs d'un compte depuis un instant : tours tracés, conversations ouvertes, écritures de Lumi enregistrées. */
export const sqlCompteursDepuis = (org: string, userId: string, depuisIso: string): string =>
  `select (select count(*) from lumi_traces where org_id = ${u(org)} and user_id = ${u(userId)} and canal = 'lumi' and origine not in ('carte', 'api') and created_at >= ${instant(depuisIso)})::int as tours,
          (select count(*) from lumi_conversations where org_id = ${u(org)} and user_id = ${u(userId)} and created_at >= ${instant(depuisIso)})::int as conversations,
          (select count(*) from agent_actions where org_id = ${u(org)} and user_id = ${u(userId)} and created_at >= ${instant(depuisIso)})::int as ecritures`;

/** La structure d'une conversation enregistrée : rôle, type et identifiant de chaque bloc, sans le contenu (voir jugement : etatHistorique). */
export const sqlMessages = (conversationId: string): string =>
  `select m.role, m.created_at, jsonb_typeof(m.content) as genre,
          case when jsonb_typeof(m.content) = 'string' then length(m.content #>> '{}') else null end as n,
          case when jsonb_typeof(m.content) = 'array' then (
            select coalesce(jsonb_agg(jsonb_build_object(
                     't', b->>'type', 'id', coalesce(b->>'id', b->>'tool_use_id'), 'nom', b->>'name', 'n', length(coalesce(b->>'text', '')),
                     'extrait', left(case when b->>'type' = 'tool_result' then coalesce(b->>'content', '') when b->>'type' = 'text' then coalesce(b->>'text', '') else '' end, 160)
                   ) order by o), '[]'::jsonb)
              from jsonb_array_elements(m.content) with ordinality as x(b, o))
          else '[]'::jsonb end as blocs
     from lumi_messages m where m.conversation_id = ${u(conversationId)} order by m.created_at, m.id`;

export const lignesMessages = (lignes: Array<Record<string, unknown>>): MessageHistorique[] => lignes.map((l) => ({
  role: String(l.role), genre: String(l.genre), n: l.n === null || l.n === undefined ? null : Number(l.n),
  blocs: Array.isArray(l.blocs) ? (l.blocs as MessageHistorique['blocs']) : [], created_at: l.created_at ? String(l.created_at) : undefined,
}));

/** Résultats enregistrés pour UNE carte dans sa conversation : il en faut un seul. */
export const sqlResultatsPourLaCarte = (conversationId: string, toolUseId: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(toolUseId)) throw new Error('identifiant de carte invalide');
  return `select count(*)::int as resultats from lumi_messages m, jsonb_array_elements(case when jsonb_typeof(m.content) = 'array' then m.content else '[]'::jsonb end) b
           where m.conversation_id = ${u(conversationId)} and m.role = 'user' and b->>'type' = 'tool_result' and b->>'tool_use_id' = '${toolUseId}'`;
};

/** Les tâches de ce titre, corbeille comprise. */
export const sqlTachesParTitre = (org: string, titre: string): string => {
  if (!/^\[ROB\] [\p{L}0-9 .'’-]+$/u.test(titre)) throw new Error(`titre de tâche invalide : ${titre}`);
  return `select id, title, status, created_at, deleted_at from tasks where org_id = ${u(org)} and title = ${t(titre)}`;
};
/** Les tâches vivantes dont le titre contient ce jeton de passe (peu importe comment Lumi a tourné le titre). */
export const sqlTachesDuJeton = (org: string, jeton: string): string => {
  if (!/^[A-Za-z0-9-]{4,40}$/.test(jeton)) throw new Error(`jeton invalide : ${jeton}`);
  return `select id, title, status, created_at from tasks where org_id = ${u(org)} and deleted_at is null and title ilike '%${jeton}%' order by created_at`;
};
export const sqlTache = (org: string, id: string): string => `select id, title, status, completed_at, deleted_at from tasks where org_id = ${u(org)} and id = ${u(id)}`;

/** Envois consignés au bac à sable depuis un instant : aucune carte d'envoi n'est confirmée, il n'en faut aucun. */
export const sqlEnvoisDepuis = (org: string, depuisIso: string): string =>
  `select count(*)::int as envois from envois_simules where org_id = ${u(org)} and created_at >= ${instant(depuisIso)}`;

export const sqlFacture = (org: string, id: string): string =>
  `select id, invoice_number, status, total_cents::bigint as total_cents, balance_cents::bigint as balance_cents, due_date, deleted_at from invoices where org_id = ${u(org)} and id = ${u(id)}`;

/** Solde dû par un client : somme des soldes de ses factures émises (envoyée ou partiellement payée). */
export const sqlSoldeClient = (org: string, clientId: string): string =>
  `select count(*)::int as factures, coalesce(sum(balance_cents), 0)::bigint as solde_cents
     from invoices where org_id = ${u(org)} and client_id = ${u(clientId)} and deleted_at is null and status in ('sent', 'partial') and balance_cents > 0`;

/** Les factures en retard du bureau (règle de l'écran Factures), de la plus ancienne échéance à la plus récente. */
export const sqlFacturesEnRetard = (org: string, fuseau: string): string =>
  `select id, invoice_number, client_id, total_cents::bigint as total_cents, balance_cents::bigint as balance_cents, due_date
     from invoices
    where org_id = ${u(org)} and deleted_at is null and status in ('sent', 'partial') and balance_cents > 0 and due_date < (now() at time zone ${t(fuseau)})::date
    order by due_date, invoice_number`;

/** Notes de mémoire actives écrites depuis un instant : une « convention de conversation » retenue pour toujours fausserait le test du contexte. */
export const sqlMemoireDepuis = (org: string, depuisIso: string): string =>
  `select id, key, left(value, 200) as value from org_knowledge where org_id = ${u(org)} and category = 'assistant' and is_active and updated_at >= ${instant(depuisIso)}`;

/** Les tours d'agent des conversations de la batterie, avec leur mesure (`params.mesure`). */
export const sqlStopReasons = (org: string, conversations: string[]): string =>
  `select conversation_id, created_at, resultat, action, params->'mesure'->>'stop_reason' as stop, (params->'mesure'->>'appels_modele')::int as appels_modele,
          params->'mesure'->>'erreur_modele' as erreur_modele, coalesce((params->'mesure'->>'tronque')::boolean, false) as tronque
     from lumi_traces where org_id = ${u(org)} and etage = 6 and conversation_id in (${conversations.map(u).join(', ')}) order by created_at`;

/** Le dernier texte de Lumi enregistré dans une conversation avant un instant (ce que l'utilisateur a reçu pour ce tour). */
export const sqlDernierTexteAvant = (conversationId: string, avantIso: string): string => {
  if (!/^[0-9T:.+ Z-]{19,40}$/.test(avantIso)) throw new Error(`instant invalide : ${avantIso}`);
  return `select string_agg(b->>'text', ' ' order by o) as texte, m.created_at
            from lumi_messages m, jsonb_array_elements(case when jsonb_typeof(m.content) = 'array' then m.content else '[]'::jsonb end) with ordinality as x(b, o)
           where m.conversation_id = ${u(conversationId)} and m.role = 'assistant' and b->>'type' = 'text' and m.created_at <= '${avantIso}'::timestamptz + interval '2 seconds'
           group by m.id, m.created_at order by m.created_at desc limit 1`;
};

/** Qui a répondu dans ces conversations : une passe jouée en palier dégradé n'a pas éprouvé le modèle habituel. */
export const sqlModeles = (org: string, conversations: string[]): string =>
  `select coalesce(model, 'sans modèle') as modele, etage, count(*)::int as tours, coalesce(sum(cost_cents), 0)::float8 as cout_cents from lumi_traces
    where org_id = ${u(org)} and conversation_id in (${conversations.map(u).join(', ')}) and origine <> 'carte' group by 1, 2 order by 2, 1`;

/** Toutes les requêtes du fichier, avec des valeurs d'exemple : un test vérifie que chacune est un SELECT seul. */
export function toutesLesRequetes(): Array<{ nom: string; requete: string }> {
  const org = ORG_DEFAUT;
  const id = '00000000-0000-4000-8000-000000000001';
  const iso = '2026-10-01T12:00:00.000Z';
  return [
    { nom: 'sqlBureau', requete: sqlBureau(org) }, { nom: 'sqlFuseau', requete: sqlFuseau(org) }, { nom: 'sqlJeuPresent', requete: sqlJeuPresent(org, [id], [id]) },
    { nom: 'sqlMembre', requete: sqlMembre(org, id) }, { nom: 'sqlAutorisations', requete: sqlAutorisations(org, id) }, { nom: 'sqlToursDansLHeure', requete: sqlToursDansLHeure(org, id) },
    { nom: 'sqlActiviteRecente', requete: sqlActiviteRecente(org, 3, [id]) }, { nom: 'sqlTours', requete: sqlTours(org, id) }, { nom: 'sqlCompteursDepuis', requete: sqlCompteursDepuis(org, id, iso) },
    { nom: 'sqlMessages', requete: sqlMessages(id) }, { nom: 'sqlResultatsPourLaCarte', requete: sqlResultatsPourLaCarte(id, 'toolu_01AbC-d_e') },
    { nom: 'sqlTachesParTitre', requete: sqlTachesParTitre(org, "[ROB] panne d'outil A1B2C") }, { nom: 'sqlTachesDuJeton', requete: sqlTachesDuJeton(org, 'A1B2C-rep') }, { nom: 'sqlTache', requete: sqlTache(org, id) },
    { nom: 'sqlEnvoisDepuis', requete: sqlEnvoisDepuis(org, iso) }, { nom: 'sqlFacture', requete: sqlFacture(org, id) }, { nom: 'sqlSoldeClient', requete: sqlSoldeClient(org, id) },
    { nom: 'sqlFacturesEnRetard', requete: sqlFacturesEnRetard(org, 'America/Toronto') }, { nom: 'sqlMemoireDepuis', requete: sqlMemoireDepuis(org, iso) },
    { nom: 'sqlStopReasons', requete: sqlStopReasons(org, [id]) }, { nom: 'sqlDernierTexteAvant', requete: sqlDernierTexteAvant(id, '2026-10-01 12:00:00.123456+00') }, { nom: 'sqlModeles', requete: sqlModeles(org, [id]) },
  ];
}
