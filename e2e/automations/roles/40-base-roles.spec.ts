/**
 * Accès DIRECT à la base, par rôle — la matrice rôle × table (carte §4.2).
 *
 * Le navigateur parle à PostgREST avec le jeton de l'utilisateur : tout ce que
 * la RLS laisse passer est faisable sans l'interface et sans le serveur Express.
 * Pour chacune des six tables des automatisations, chaque rôle tente — avec un
 * client supabase-js soumis à la RLS — de LIRE une ligne du bureau A, d'en
 * INSÉRER une, d'en MODIFIER une et d'en SUPPRIMER une. Le résultat est relu par
 * le service : ce qui compte est l'état réel de la ligne, pas le message.
 *
 * Attendu :
 *   · lecture  = `automations.read` (propriétaire, admin, membre read, membre read+update) ;
 *   · écriture = `automations.update`, et seulement sur les tables que l'app écrit
 *     depuis le navigateur ou par le client de l'utilisateur (règles, dossiers,
 *     adresses d'appel) ; les files, journaux et reçus sont en lecture seule pour tous ;
 *   · vendeur, technicien : rien ; propriétaire d'un AUTRE bureau : rien, jamais.
 * La suppression DURE d'une règle et les colonnes protégées par le serveur sont
 * traitées à part (S-04, fichier 50).
 *
 * La matrice observée est écrite dans `sorties/roles/matrice-base.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { clientDe } from '../_outils/banc';
import { test, expect, TOUS_LES_ROLES, LIBELLE, SORTIES_LOT, type Role } from './_roles';
import type { Outils } from './_routes';

const FICHIER = `${SORTIES_LOT}/matrice-base.json`;
const LECTEURS: readonly Role[] = ['proprioA', 'adminA', 'editeurA', 'lecteurA'];
const EDITEURS: readonly Role[] = ['proprioA', 'adminA', 'editeurA'];
const PERSONNE: readonly Role[] = [];

type Operation = 'lecture' | 'insertion' | 'modification' | 'suppression';

interface Table {
  id: string;
  table: string;
  /** Colonnes lisibles (la clé d'une adresse d'appel ne l'est pour personne). */
  colonnes: string;
  attendu: Record<Operation, readonly Role[]>;
  /** Crée une ligne du bureau A par le service ; rend son id. */
  creer: (o: Outils, s: string) => Promise<string>;
  /** La ligne qu'un utilisateur tente d'insérer DANS LE BUREAU A. */
  aInserer: (o: Outils, s: string, aide: { regle: string; webhook: string }) => Record<string, unknown>;
  /** Où retrouver la ligne insérée (relue par le service) : colonne et valeur. */
  temoinInsertion: { colonne: string; valeur: (o: Outils, s: string) => string };
  /** Modification inoffensive + sa relecture. */
  modif: (s: string) => Record<string, unknown>;
  modifiee: (ligne: Record<string, unknown>, s: string) => boolean;
  colonneModif: string;
}

async function ins(o: Outils, table: string, ligne: Record<string, unknown>): Promise<string> {
  const { data, error } = await o.admin.from(table).insert(ligne).select('id').single();
  if (error || !data) throw new Error(`préparation ${table} : ${error?.message}`);
  return (data as { id: string }).id;
}
const regle = (o: Outils, s: string) => ins(o, 'automation_rules', { org_id: o.orgA, name: `${o.marque} ${s}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, actions: [{ type: 'log_activity', config: {} }], is_active: false });
const webhook = (o: Outils, s: string) => ins(o, 'automation_webhooks', { org_id: o.orgA, name: `${o.marque} ${s}`.slice(0, 80) });

const TABLES: readonly Table[] = [
  {
    id: 'RLS-01', table: 'automation_rules', colonnes: 'id, name, is_active',
    // La suppression dure d'une règle n'existe nulle part dans le produit (corbeille + `purged_at`) : voir S-04.
    attendu: { lecture: LECTEURS, insertion: EDITEURS, modification: EDITEURS, suppression: PERSONNE },
    creer: regle,
    aInserer: (o, s) => ({ org_id: o.orgA, name: `${o.marque} insérée ${s}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, actions: [{ type: 'log_activity', config: {} }], is_active: false }),
    temoinInsertion: { colonne: 'name', valeur: (o, s) => `${o.marque} insérée ${s}` },
    modif: (s) => ({ description: `modifiée en direct ${s}` }), colonneModif: 'description', modifiee: (l, s) => l.description === `modifiée en direct ${s}`,
  },
  {
    id: 'RLS-02', table: 'automation_folders', colonnes: 'id, name',
    attendu: { lecture: LECTEURS, insertion: EDITEURS, modification: EDITEURS, suppression: EDITEURS },
    creer: (o, s) => ins(o, 'automation_folders', { org_id: o.orgA, name: `${o.marque} ${s}`.slice(0, 60) }),
    aInserer: (o, s) => ({ org_id: o.orgA, name: `${o.marque} ins ${s}`.slice(0, 60) }),
    temoinInsertion: { colonne: 'name', valeur: (o, s) => `${o.marque} ins ${s}`.slice(0, 60) },
    modif: (s) => ({ position: 7 + s.length }), colonneModif: 'position', modifiee: (l, s) => l.position === 7 + s.length,
  },
  {
    id: 'RLS-03', table: 'automation_scheduled_tasks', colonnes: 'id, status',
    attendu: { lecture: LECTEURS, insertion: PERSONNE, modification: PERSONNE, suppression: PERSONNE },
    creer: async (o, s) => ins(o, 'automation_scheduled_tasks', {
      org_id: o.orgA, automation_rule_id: await regle(o, `file ${s}`), entity_type: 'client', entity_id: o.decor.client,
      execute_at: new Date(Date.now() + 30 * 86400_000).toISOString(), status: 'cancelled', execution_key: `${o.marque}:${s}`,
    }),
    aInserer: (o, s, a) => ({
      org_id: o.orgA, automation_rule_id: a.regle, entity_type: 'client', entity_id: o.decor.client,
      execute_at: new Date(Date.now() + 30 * 86400_000).toISOString(), status: 'cancelled', execution_key: `${o.marque}:ins:${s}`,
    }),
    temoinInsertion: { colonne: 'execution_key', valeur: (o, s) => `${o.marque}:ins:${s}` },
    modif: (s) => ({ last_error: `modifiée ${s}` }), colonneModif: 'last_error', modifiee: (l, s) => l.last_error === `modifiée ${s}`,
  },
  {
    id: 'RLS-04', table: 'automation_execution_logs', colonnes: 'id, action_type',
    attendu: { lecture: LECTEURS, insertion: PERSONNE, modification: PERSONNE, suppression: PERSONNE },
    creer: async (o, s) => ins(o, 'automation_execution_logs', {
      org_id: o.orgA, automation_rule_id: await regle(o, `journal ${s}`), trigger_event: 'lead.created', entity_type: 'client', entity_id: o.decor.client,
      action_type: 'log_activity', result_success: true, execution_key: `${o.marque}:${s}`,
    }),
    aInserer: (o, s, a) => ({
      org_id: o.orgA, automation_rule_id: a.regle, trigger_event: 'lead.created', entity_type: 'client', entity_id: o.decor.client,
      action_type: 'send_sms', result_success: true, execution_key: `${o.marque}:ins:${s}`,
    }),
    temoinInsertion: { colonne: 'execution_key', valeur: (o, s) => `${o.marque}:ins:${s}` },
    modif: (s) => ({ result_error: `modifiée ${s}` }), colonneModif: 'result_error', modifiee: (l, s) => l.result_error === `modifiée ${s}`,
  },
  {
    id: 'RLS-05', table: 'automation_webhooks', colonnes: 'id, name, enabled',
    // Le serveur ne supprime jamais une adresse pour de bon (`deleted_at`) : aucune suppression dure attendue.
    attendu: { lecture: LECTEURS, insertion: EDITEURS, modification: EDITEURS, suppression: PERSONNE },
    creer: webhook,
    aInserer: (o, s) => ({ org_id: o.orgA, name: `${o.marque} ins ${s}`.slice(0, 80) }),
    temoinInsertion: { colonne: 'name', valeur: (o, s) => `${o.marque} ins ${s}`.slice(0, 80) },
    modif: () => ({ enabled: false }), colonneModif: 'enabled', modifiee: (l) => l.enabled === false,
  },
  {
    id: 'RLS-06', table: 'automation_webhook_receipts', colonnes: 'id, statut',
    attendu: { lecture: LECTEURS, insertion: PERSONNE, modification: PERSONNE, suppression: PERSONNE },
    creer: async (o, s) => ins(o, 'automation_webhook_receipts', { org_id: o.orgA, webhook_id: await webhook(o, `reçu ${s}`), statut: 'accepte', corps: { temoin: `${o.marque} ${s}` } }),
    aInserer: (o, s, a) => ({ org_id: o.orgA, webhook_id: a.webhook, statut: 'accepte', motif: `${o.marque} ins ${s}` }),
    temoinInsertion: { colonne: 'motif', valeur: (o, s) => `${o.marque} ins ${s}` },
    modif: (s) => ({ motif: `modifié ${s}` }), colonneModif: 'motif', modifiee: (l, s) => l.motif === `modifié ${s}`,
  },
];

interface Case { role: Role; operation: Operation; attendu: boolean; observe: boolean; detail: string }

function consigner(t: Table, cases: Case[]): void {
  mkdirSync(SORTIES_LOT, { recursive: true });
  const tout: Record<string, unknown> = existsSync(FICHIER) ? JSON.parse(readFileSync(FICHIER, 'utf8')) as Record<string, unknown> : {};
  tout[t.id] = { table: t.table, cases };
  writeFileSync(FICHIER, JSON.stringify(tout, null, 1));
}

async function menage(o: Outils): Promise<void> {
  const { data: w } = await o.admin.from('automation_webhooks').select('id').in('org_id', [o.orgA, o.orgB]).ilike('name', `%${o.marque}%`);
  const idsW = (w ?? []).map((l) => l.id as string);
  if (idsW.length) {
    await o.admin.from('automation_webhook_receipts').delete().in('webhook_id', idsW);
    await o.admin.from('automation_webhooks').delete().in('id', idsW);
  }
  await o.admin.from('automation_folders').delete().in('org_id', [o.orgA, o.orgB]).ilike('name', `%${o.marque}%`);
  // Les règles marquées (et leurs tâches / journaux) sont retirées par le banc.
}

test.describe('Accès direct à la base — chaque table, chaque rôle', () => {
  for (const t of TABLES) {
    // RLS-01 : la suppression dure d'une règle (constat roles-07) est refusée depuis la garde en base de #889
    // (`trg_automation_rules_garde`, 42501 « elle passe par la corbeille ») — vert sur la pile locale le 2026-10-01.
    // RLS-05 : la suppression DURE d'une adresse d'appel reste ouverte à qui a `automations.update`
    // (`grant … delete on automation_webhooks to authenticated`, 20260929090000) alors que le serveur ne fait
    // qu'un effacement doux ; ses reçus partent avec elle (`on delete cascade`) — rouge attendu.
    const defaut = t.id === 'RLS-05' ? ' @defaut' : '';
    test(`[${t.id}]${t.id === 'RLS-01' ? '[S-04]' : ''} ${t.table} — lecture, insertion, modification, suppression par PostgREST pour chaque rôle et pour un autre bureau${defaut}`, async ({ jeton, outils }) => {
      test.setTimeout(900_000);
      const cases: Case[] = [];
      const noter = (role: Role, operation: Operation, observe: boolean, detail: string) => {
        const attendu = t.attendu[operation].includes(role);
        cases.push({ role, operation, attendu, observe, detail: detail.slice(0, 160) });
        expect.soft(observe, `${t.table} · ${operation} · ${LIBELLE[role]} — ${detail.slice(0, 200)}`).toBe(attendu);
      };
      try {
        const aide = { regle: await regle(outils, 'aide'), webhook: await webhook(outils, 'aide') };
        const temoinLecture = await t.creer(outils, 'lecture');

        for (const role of TOUS_LES_ROLES) {
          const sb = clientDe(await jeton(role));

          // ── LECTURE : la ligne du bureau A est-elle rendue ? ──
          const l = await sb.from(t.table).select(t.colonnes).eq('id', temoinLecture);
          noter(role, 'lecture', (l.data ?? []).length === 1, l.error ? `erreur ${l.error.code} ${l.error.message}` : `${(l.data ?? []).length} ligne(s)`);
          // … et, pour l'autre bureau, AUCUNE ligne de A par un balayage sans filtre.
          if (role === 'proprioB') {
            const tout = await sb.from(t.table).select('id, org_id').eq('org_id', outils.orgA).limit(5);
            expect.soft((tout.data ?? []).length, `${t.table} : le propriétaire de B ne lit aucune ligne du bureau A`).toBe(0);
          }

          // ── INSERTION dans le bureau A ──
          const i = await sb.from(t.table).insert(t.aInserer(outils, role, aide));
          const { count: nIns } = await outils.admin.from(t.table).select('id', { count: 'exact', head: true }).eq(t.temoinInsertion.colonne, t.temoinInsertion.valeur(outils, role));
          noter(role, 'insertion', (nIns ?? 0) > 0, i.error ? `erreur ${i.error.code} ${i.error.message}` : 'acceptée');

          // ── MODIFICATION d'une ligne du bureau A ──
          const idM = await t.creer(outils, `modif ${role}`);
          const m = await sb.from(t.table).update(t.modif(role)).eq('id', idM);
          const { data: apresM } = await outils.admin.from(t.table).select(t.colonneModif).eq('id', idM).maybeSingle();
          noter(role, 'modification', t.modifiee((apresM ?? {}) as unknown as Record<string, unknown>, role), m.error ? `erreur ${m.error.code} ${m.error.message}` : 'sans erreur');

          // ── SUPPRESSION d'une ligne du bureau A ──
          const idS = await t.creer(outils, `suppr ${role}`);
          const d = await sb.from(t.table).delete().eq('id', idS);
          const { data: apresS } = await outils.admin.from(t.table).select('id').eq('id', idS).maybeSingle();
          noter(role, 'suppression', apresS === null, d.error ? `erreur ${d.error.code} ${d.error.message}` : 'sans erreur');
        }
      } finally {
        consigner(t, cases);
        // Tâches et journaux insérés par un rôle (s'il y en a eu) : rattachés à la règle « aide », retirée par le banc.
        await menage(outils);
      }
    });
  }
});
