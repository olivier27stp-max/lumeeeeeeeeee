/* ═══════════════════════════════════════════════════════════════
   Lume Agent — outils « prospects, demandes et dossier client »
   ─────────────────────────────────────────────────────────────
   Complète tools-etendus.ts : tout ce que l'utilisateur fait dans
   Lume sur ses prospects (leads), son pipeline, les demandes
   entrantes du formulaire web, les adresses (propriétés), les notes
   et les champs personnalisés d'un client — et que Lumi ne pouvait
   pas exécuter.

   Mêmes règles que le reste du registre :
   • un lead EST une ligne de `clients` (status = 'lead', entonnoir
     dans `lead_status`) — comme leadsApi.ts ;
   • chaque écriture passe par executerIdempotent (empreinte posée
     avant d'agir, jamais de doublon) ;
   • quand une ROUTE de l'application fait le travail (cascades,
     événements, webhooks), on la rappelle via appelInterne au lieu
     d'en maintenir une copie ;
   • tout accès base est filtré par org_id = ctx.orgId ;
   • les suppressions sont douces (deleted_at) — sauf specific_notes,
     qui n'a pas de colonne deleted_at : le geste de l'app (hard
     delete) est reproduit et déclaré irréversible ;
   • aucun texte d'erreur Postgres ne remonte au modèle.
   ═══════════════════════════════════════════════════════════════ */

import type { PermissionKey } from '../../../src/lib/permissions';
import type { IdTopic } from '../lumi/topics';
import type { AgentTool, ToolContext } from './tools';
import {
  executerIdempotent, champRequis, appelInterne, AppelInterneIncertain,
  traduireStatut, STATUT_LEAD, STATUT_CLIENT,
} from './tools-etendus';

/* ── Vocabulaire ──────────────────────────────────────────────── */

/** Étapes CANONIQUES de l'entonnoir (clients.lead_status = pipeline_deals.stage). */
const ETAPES = ['new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost'] as const;
type Etape = (typeof ETAPES)[number];

/** Statuts de prospect traduits — complète STATUT_LEAD avec les étapes du pipeline. */
export const STATUT_PROSPECT: Record<string, string> = {
  ...STATUT_LEAD,
  new_prospect: 'nouveau prospect', no_response: 'sans réponse', quote_sent: 'devis envoyé',
  closed_won: 'gagné', closed_lost: 'perdu',
  new: 'nouveau prospect', follow_up_1: 'sans réponse', follow_up_2: 'devis envoyé',
  follow_up_3: 'devis envoyé', closed: 'gagné', lost: 'perdu',
};

const ALIAS_ETAPE: Record<string, Etape> = {
  new_prospect: 'new_prospect', new: 'new_prospect', nouveau: 'new_prospect', nouveau_prospect: 'new_prospect',
  prospect: 'new_prospect', lead: 'new_prospect', qualified: 'new_prospect', qualifie: 'new_prospect',
  no_response: 'no_response', sans_reponse: 'no_response', contacted: 'no_response', contacte: 'no_response',
  follow_up: 'no_response', follow_up_1: 'no_response', relance: 'no_response', proposal: 'no_response',
  quote_sent: 'quote_sent', devis_envoye: 'quote_sent', soumission_envoyee: 'quote_sent', estimate_sent: 'quote_sent',
  follow_up_2: 'quote_sent', follow_up_3: 'quote_sent', negotiation: 'quote_sent',
  closed_won: 'closed_won', won: 'closed_won', closed: 'closed_won', gagne: 'closed_won', converti: 'closed_won',
  closed_lost: 'closed_lost', lost: 'closed_lost', perdu: 'closed_lost', archived: 'closed_lost',
};

/** Accepte le slug canonique, les anciens slugs, l'anglais ou le français de l'écran. */
export function versEtape(valeur: unknown): Etape {
  const v = String(valeur ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/[\s-]+/g, '_');
  const etape = ALIAS_ETAPE[v];
  if (!etape) {
    throw new Error(
      'Étape inconnue — choisis parmi : nouveau prospect, sans réponse, devis envoyé, gagné, perdu '
      + '(new_prospect, no_response, quote_sent, closed_won, closed_lost).',
    );
  }
  return etape;
}

/* ── Helpers locaux ───────────────────────────────────────────── */

const clamp = (n: any, def: number, max: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
};

function nomAffiche(r: any): string {
  if (!r) return '';
  if (r.display_as_company && r.company) return String(r.company);
  return `${r.first_name || ''} ${r.last_name || ''}`.trim() || String(r.company || '');
}

const texteOuNull = (v: unknown) => {
  const s = v == null ? '' : String(v).trim();
  return s || null;
};

/**
 * Lecture ratée : le texte brut (table, colonne, policy) reste dans les logs ;
 * le modèle reçoit une phrase d'exploitant.
 */
function erreurLecture(scope: string, err: any): { error: string } {
  console.error(`[agent-tool:leads:${scope}]`, err?.code || '', err?.message || err);
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l’utilisateur et propose de réessayer.' };
}

/** Écriture ratée en base : on journalise le brut, on lève une phrase humaine. */
function echecEcriture(action: string, err: any): never {
  console.error(`[agent-tool:leads] ${action}`, err?.code || '', err?.message || err);
  throw new Error(`Impossible de ${action}. Dis-le simplement à l’utilisateur et propose de réessayer.`);
}

/**
 * Réponse non-OK d'une route de l'app. Les routes passent par sendSafeError
 * (jamais de texte Postgres) ; on ne relaie que les messages de validation
 * (400/409), le reste est traduit en une phrase.
 */
function echecRoute(action: string, status: number, json: any): never {
  if (status === 401) throw new Error(`Impossible de ${action} : la session Lume a expiré — reconnecte-toi.`);
  if (status === 403) throw new Error(`Impossible de ${action} : les accès Lume de cette personne ne le permettent pas (réservé au propriétaire ou à l’administrateur).`);
  if (status === 404) throw new Error(`Impossible de ${action} : introuvable — peut-être déjà supprimé.`);
  if ((status === 400 || status === 409) && json?.error) throw new Error(`Impossible de ${action} : ${String(json.error).slice(0, 160)}`);
  throw new Error(`Impossible de ${action} (réponse ${status}). Dis-le simplement et propose de réessayer.`);
}

/**
 * La requête est partie, la réponse n'est jamais revenue : l'effet est
 * INCERTAIN. On RENVOIE (au lieu de lever) pour que l'empreinte
 * d'idempotence soit conservée — une retentative aveugle créerait un
 * doublon (deuxième prospect, deuxième job).
 */
function effetIncertain(quoi: string): Record<string, any> {
  return {
    incertain: true,
    note: `Je n’ai pas eu la confirmation que ${quoi} — c’est PEUT-ÊTRE fait. Vérifie dans Lume avant de recommencer.`,
  };
}

async function routeOuIncertain(
  ctx: ToolContext, chemin: string, corps: Record<string, any>, quoi: string,
): Promise<{ ok: boolean; status: number; json: any } | { incertain: Record<string, any> }> {
  try {
    return await appelInterne(ctx, chemin, corps);
  } catch (e) {
    if (e instanceof AppelInterneIncertain) return { incertain: effetIncertain(quoi) };
    throw e;
  }
}

/**
 * Signale un événement métier à l'app (même route que l'interface) pour que
 * les automatisations tournent. L'écriture est déjà faite : un raté devient
 * un avertissement, jamais une erreur (sinon retentative = doublon).
 */
async function signaler(ctx: ToolContext, chemin: string, corps: Record<string, any>): Promise<string | null> {
  try {
    const { ok, status, json } = await appelInterne(ctx, chemin, corps);
    if (!ok) return `automatisations non déclenchées (${json?.error || status}) — le changement est fait, mais les règles n’ont pas tourné.`;
    return null;
  } catch (err: any) {
    return `automatisations non déclenchées (${err?.message || 'session absente'}) — le changement est fait, mais les règles n’ont pas tourné.`;
  }
}

/** Le prospect existe-t-il DANS CETTE ORG ? (les routes de suppression ne filtrent pas par org). */
async function prospectDeLOrg(ctx: ToolContext, leadId: string): Promise<{ id: string; name: string; lead_status: string | null }> {
  const { data, error } = await ctx.client
    .from('clients')
    .select('id, first_name, last_name, company, display_as_company, status, lead_status')
    .eq('org_id', ctx.orgId).eq('id', leadId).eq('status', 'lead')
    .is('deleted_at', null)
    .maybeSingle();
  if (error) echecEcriture('retrouver le prospect', error);
  if (!data) throw new Error('Prospect introuvable — il a peut-être déjà été converti en client ou supprimé. Refais une recherche de prospects.');
  return { id: data.id, name: nomAffiche(data), lead_status: data.lead_status };
}

/* ═══════════════════════════════════════════════════════════════
   PROSPECTS (leads)
   ═══════════════════════════════════════════════════════════════ */

const createLead: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_lead',
    description:
      'Create a lead (prospect) — same as the "New lead" form in Lume: the lead lands in the pipeline at the '
      + '"New Prospect" stage and a linked client record is created. If a client or lead with that name already '
      + 'exists, ask the user which one before creating.',
    parameters: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name (or the company name when there is no person).' },
        last_name: { type: 'string', description: 'Last name (optional).' },
        company: { type: 'string', description: 'Company / deal title shown on the pipeline card (optional).' },
        email: { type: 'string', description: 'Email (optional).' },
        phone: { type: 'string', description: 'Phone (optional).' },
        address: { type: 'string', description: 'Service address (optional).' },
        estimated_value: { type: 'number', description: 'Estimated deal value in DOLLARS (e.g. 350 for 350 $). Optional, default 0.' },
        notes: { type: 'string', description: 'Free-text notes about the request (optional).' },
      },
      required: ['first_name'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_lead', args, async () => {
      const prenom = champRequis(args.first_name, 'Le nom du prospect');
      const nom = texteOuNull(args.last_name);
      const fullName = `${prenom} ${nom || ''}`.trim();
      const email = texteOuNull(args.email);
      if (email && !/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(email)) throw new Error('Adresse courriel invalide.');
      const valeur = Number(args.estimated_value ?? 0);
      if (!Number.isFinite(valeur) || valeur < 0) throw new Error('La valeur estimée doit être un montant positif, en dollars.');
      // Même route que createLeadScoped / createLeadQuick (leadsApi) : client
      // lié, carte de pipeline, événement lead.created, webhooks.
      const r = await routeOuIncertain(ctx, '/leads/create', {
        full_name: fullName,
        email,
        phone: texteOuNull(args.phone),
        address: texteOuNull(args.address),
        title: texteOuNull(args.company),
        value: valeur,
        notes: texteOuNull(args.notes),
        orgId: ctx.orgId,
      }, 'le prospect a été créé');
      if ('incertain' in r) return r.incertain;
      if (!r.ok) echecRoute('créer le prospect', r.status, r.json);
      const ligne = r.json?.lead || {};
      return {
        created: true,
        lead: { id: r.json?.lead_id || ligne.id, name: nomAffiche(ligne) || fullName },
        statut: traduireStatut('new_prospect', STATUT_PROSPECT),
        note: 'Prospect créé et placé dans le pipeline à l’étape « Nouveau prospect ».',
      };
    }),
};

const updateLead: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_lead',
    description:
      "Correct a lead's (prospect's) details: name, company, contact info, address, source, notes or estimated value. "
      + 'Only the provided fields change. Get the lead id from a lead search. To change the pipeline stage use '
      + 'update_lead_status; for an active client use update_client.',
    parameters: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'Lead id (from a lead search).' },
        first_name: { type: 'string' }, last_name: { type: 'string' },
        company: { type: 'string', description: 'Company / deal title.' },
        email: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' },
        source: { type: 'string', description: 'Where the lead came from (e.g. référence, Google, porte-à-porte).' },
        notes: { type: 'string', description: 'Replaces the lead notes.' },
        estimated_value: { type: 'number', description: 'Estimated deal value in DOLLARS.' },
      },
      required: ['lead_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_lead', args, async () => {
      const leadId = champRequis(args.lead_id, 'Le prospect');
      // Miroir de updateLeadScoped (leadsApi) : champs explicites, trim, null si vide.
      const patch: Record<string, any> = {};
      if (args.email !== undefined) {
        const email = texteOuNull(args.email);
        if (email && !/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(email)) throw new Error('Adresse courriel invalide.');
        patch.email = email;
      }
      for (const champ of ['first_name', 'last_name', 'phone', 'address', 'source', 'notes'] as const) {
        if (args[champ] !== undefined) patch[champ] = texteOuNull(args[champ]);
      }
      if (args.company !== undefined) { patch.company = texteOuNull(args.company); patch.title = patch.company; }
      if (args.estimated_value !== undefined) {
        const v = Number(args.estimated_value);
        if (!Number.isFinite(v) || v < 0) throw new Error('La valeur estimée doit être un montant positif, en dollars.');
        patch.value = v;
      }
      if (!Object.keys(patch).length) throw new Error('Aucun champ à modifier.');
      patch.updated_at = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('clients')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', leadId).eq('status', 'lead')
        .is('deleted_at', null)
        .select('id, first_name, last_name, company, display_as_company, email, phone, address, lead_status')
        .maybeSingle();
      if (error) echecEcriture('modifier le prospect', error);
      if (!data) throw new Error('Prospect introuvable — il a peut-être déjà été converti en client (utilise update_client) ou supprimé.');
      return {
        updated: true,
        lead: { name: nomAffiche(data), email: data.email, phone: data.phone, address: data.address },
        statut: traduireStatut(data.lead_status, STATUT_PROSPECT),
        note: 'Fiche du prospect mise à jour.',
      };
    }),
};

const updateLeadStatus: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_lead_status',
    description:
      "Move a lead (prospect) to another pipeline stage — same as dragging its card in Lume's pipeline: "
      + 'new prospect, no response, quote sent, won, lost. Marking it WON turns it into an active client. '
      + 'Get the lead id from a lead search.',
    parameters: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'Lead id (from a lead search).' },
        status: {
          type: 'string',
          description: "Target stage: 'new_prospect', 'no_response', 'quote_sent', 'closed_won' or 'closed_lost' (French labels like « devis envoyé » are accepted).",
        },
      },
      required: ['lead_id', 'status'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_lead_status', args, async () => {
      const leadId = champRequis(args.lead_id, 'Le prospect');
      const etape = versEtape(champRequis(args.status, 'L’étape'));
      // Même route que l'écran : statut + promotion du client si gagné + carte
      // de pipeline synchronisée + événement lead.status_changed.
      const r = await routeOuIncertain(ctx, '/leads/update-status', { leadId, status: etape, orgId: ctx.orgId }, 'le statut a été changé');
      if ('incertain' in r) return r.incertain;
      if (!r.ok) echecRoute('changer le statut du prospect', r.status, r.json);
      const statut = traduireStatut(etape, STATUT_PROSPECT);
      return {
        updated: true,
        changed: r.json?.changed !== false,
        statut,
        note: r.json?.changed === false
          ? `Le prospect était déjà « ${statut} » — rien à changer.`
          : etape === 'closed_won'
            ? 'Prospect marqué gagné : il est maintenant un client actif.'
            : `Prospect déplacé à l’étape « ${statut} ».`,
      };
    }),
};

const deleteLead: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_lead',
    description:
      'Delete a lead (prospect) — it disappears from the leads list and the pipeline, along with its pipeline card '
      + 'and linked quotes. Soft delete, like in Lume, but the user cannot undo it: confirm with them first. '
      + 'Get the lead id from a lead search.',
    parameters: {
      type: 'object',
      properties: { lead_id: { type: 'string', description: 'Lead id (from a lead search).' } },
      required: ['lead_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_lead', args, async () => {
      const leadId = champRequis(args.lead_id, 'Le prospect');
      // La route ne filtre pas par org (elle vérifie l'appartenance) : on
      // s'assure d'abord, sous RLS, que le prospect est bien dans CETTE org.
      const prospect = await prospectDeLOrg(ctx, leadId);
      const r = await routeOuIncertain(ctx, '/leads/soft-delete', { leadId, orgId: ctx.orgId }, 'le prospect a été supprimé');
      if ('incertain' in r) return r.incertain;
      if (!r.ok) echecRoute('supprimer le prospect', r.status, r.json);
      return { deleted: true, lead: { name: prospect.name }, note: 'Prospect supprimé, avec sa carte de pipeline et ses devis liés.' };
    }),
};

const convertLeadToJob: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'convert_lead_to_job',
    description:
      'Convert a lead (prospect) into a JOB in one step — same as the "Convert to job" button in Lume: the lead '
      + 'becomes an active client (pipeline card closed-won) and a draft job is created with its address and notes. '
      + 'Reserved to owners/admins. To only promote the lead without a job, use convert_lead_to_client.',
    parameters: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'Lead id (from a lead search).' },
        job_title: { type: 'string', description: 'Optional job title (default: the lead’s title or name).' },
      },
      required: ['lead_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'convert_lead_to_job', args, async () => {
      const leadId = champRequis(args.lead_id, 'Le prospect');
      const corps: Record<string, any> = { leadId, orgId: ctx.orgId };
      const titre = texteOuNull(args.job_title);
      if (titre) corps.jobTitle = titre;
      const r = await routeOuIncertain(ctx, '/leads/convert-to-job', corps, 'le prospect a été converti en job');
      if ('incertain' in r) return r.incertain;
      if (!r.ok) echecRoute('convertir le prospect en job', r.status, r.json);
      return {
        converted: true,
        job: { id: r.json?.job_id, title: r.json?.job_title },
        client: { id: r.json?.client_id },
        statut: traduireStatut('active', STATUT_CLIENT),
        note: 'Prospect converti : client actif et job créé en brouillon — il reste à le planifier.',
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   DEMANDES ENTRANTES (formulaire web)
   ═══════════════════════════════════════════════════════════════ */

function dateIsoOuErreur(v: unknown, label: string): string {
  const s = String(v ?? '').trim();
  if (!s || Number.isNaN(Date.parse(s))) throw new Error(`${label} : date/heure invalide (format ISO attendu, ex. 2026-09-20T09:00:00-04:00).`);
  return new Date(s).toISOString();
}

const processRequestSubmission: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'process_request_submission',
    description:
      'Process an incoming request-form submission — same as the request drawer in Lume: schedule the assessment '
      + '(on-site evaluation) visit with instructions and/or archive the request (or un-archive it). '
      + 'Only the provided fields change. Get the submission id from list_request_submissions.',
    parameters: {
      type: 'object',
      properties: {
        submission_id: { type: 'string', description: 'Submission id (from list_request_submissions).' },
        archived: { type: 'boolean', description: 'true = archive the request (leaves the inbox), false = bring it back.' },
        assessment_start_at: { type: 'string', description: 'ISO datetime of the assessment visit start (optional).' },
        assessment_end_at: { type: 'string', description: 'ISO datetime of the assessment visit end (optional).' },
        assessment_instructions: { type: 'string', description: 'Instructions for whoever does the assessment (optional, max 5000 chars).' },
        assessment_team_id: { type: 'string', description: 'Team id assigned to the assessment (optional, from get_team).' },
        assessment_user_id: { type: 'string', description: 'Member user id assigned to the assessment (optional, from get_team).' },
      },
      required: ['submission_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'process_request_submission', args, async () => {
      const id = champRequis(args.submission_id, 'La demande');
      // Miroir de PATCH /request-forms/submissions/:id (appelInterne ne fait
      // que du POST) : mêmes champs, mêmes règles, filtre org explicite.
      const patch: Record<string, any> = {};
      if (args.assessment_start_at !== undefined) patch.assessment_start_at = dateIsoOuErreur(args.assessment_start_at, 'Début de l’évaluation');
      if (args.assessment_end_at !== undefined) patch.assessment_end_at = dateIsoOuErreur(args.assessment_end_at, 'Fin de l’évaluation');
      if (patch.assessment_start_at && patch.assessment_end_at && patch.assessment_end_at <= patch.assessment_start_at) {
        throw new Error('La fin de l’évaluation doit être après son début.');
      }
      if (args.assessment_instructions !== undefined) patch.assessment_instructions = (texteOuNull(args.assessment_instructions) || '').slice(0, 5000) || null;
      if (args.assessment_team_id !== undefined) patch.assessment_team_id = texteOuNull(args.assessment_team_id);
      if (args.assessment_user_id !== undefined) patch.assessment_user_id = texteOuNull(args.assessment_user_id);
      if (args.archived !== undefined) patch.archived_at = args.archived ? new Date().toISOString() : null;
      if (!Object.keys(patch).length) throw new Error('Rien à modifier — précise une évaluation à planifier ou archived.');

      const { data, error } = await ctx.client
        .from('form_submissions')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select('id, first_name, last_name, company, archived_at, assessment_start_at')
        .maybeSingle();
      if (error) echecEcriture('traiter la demande', error);
      if (!data) throw new Error('Demande introuvable — elle a peut-être été supprimée.');
      const nom = `${data.first_name || ''} ${data.last_name || ''}`.trim() || data.company || '';
      const gestes: string[] = [];
      if (patch.assessment_start_at || patch.assessment_end_at || patch.assessment_instructions !== undefined
        || patch.assessment_team_id !== undefined || patch.assessment_user_id !== undefined) gestes.push('évaluation planifiée');
      if (args.archived === true) gestes.push('demande archivée');
      if (args.archived === false) gestes.push('demande remise dans la boîte de réception');
      return {
        updated: true,
        submission: { name: nom, archived: Boolean(data.archived_at), assessment_start_at: data.assessment_start_at },
        note: `Demande traitée : ${gestes.join(', ')}.`,
      };
    }),
};

const deleteRequestSubmission: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_request_submission',
    description:
      'Delete an incoming request-form submission (soft delete, like in Lume — the user cannot undo it). '
      + 'To simply set it aside, prefer process_request_submission with archived: true. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: { submission_id: { type: 'string', description: 'Submission id (from list_request_submissions).' } },
      required: ['submission_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_request_submission', args, async () => {
      const id = champRequis(args.submission_id, 'La demande');
      // Miroir de DELETE /request-forms/submissions/:id : deleted_at, jamais de hard delete.
      const { data, error } = await ctx.client
        .from('form_submissions')
        .update({ deleted_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select('id, first_name, last_name')
        .maybeSingle();
      if (error) echecEcriture('supprimer la demande', error);
      if (!data) throw new Error('Demande introuvable — elle a peut-être déjà été supprimée.');
      return { deleted: true, submission: { name: `${data.first_name || ''} ${data.last_name || ''}`.trim() }, note: 'Demande supprimée.' };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   CLIENT : suppression
   ═══════════════════════════════════════════════════════════════ */

const deleteClient: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_client',
    description:
      'Delete a client — same as the delete action in Lume: soft delete of the client AND its jobs, quotes, invoices '
      + 'and pipeline cards. The user cannot undo it: name the client and get an explicit OK first. '
      + 'For a prospect use delete_lead.',
    parameters: {
      type: 'object',
      properties: { client_id: { type: 'string', description: 'Client id (from a client search).' } },
      required: ['client_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_client', args, async () => {
      const clientId = champRequis(args.client_id, 'Le client');
      // La route vérifie l'appartenance mais pas l'org courante : on confirme
      // d'abord, sous RLS, que la fiche est dans CETTE org.
      const { data: fiche, error } = await ctx.client
        .from('clients')
        .select('id, first_name, last_name, company, display_as_company')
        .eq('org_id', ctx.orgId).eq('id', clientId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) echecEcriture('retrouver le client', error);
      if (!fiche) throw new Error('Client introuvable — il a peut-être déjà été supprimé. Refais une recherche de clients.');
      const r = await routeOuIncertain(ctx, '/clients/soft-delete', { clientId }, 'le client a été supprimé');
      if ('incertain' in r) return r.incertain;
      if (!r.ok) echecRoute('supprimer le client', r.status, r.json);
      const jobs = Number(r.json?.jobs || 0);
      const autres = Number(r.json?.other_rows || 0);
      return {
        deleted: true,
        client: { name: nomAffiche(fiche) },
        cascade: { jobs, pipeline_deals: Number(r.json?.pipeline_deals || 0), quotes_and_invoices: autres },
        note: `Client supprimé avec ${jobs} job(s) et ${autres} devis/facture(s) liés.`,
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   PROPRIÉTÉS (adresses d'un client)
   ═══════════════════════════════════════════════════════════════ */

const CHAMPS_ADRESSE = ['name', 'address', 'street_number', 'street_name', 'city', 'province', 'postal_code', 'country'] as const;

const listProperties: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_properties',
    description:
      "List a client's properties (service addresses, primary first) and their billing address if it differs. "
      + 'Use it to pick the property id before updating or deleting one, or before scheduling a job at a secondary address.',
    parameters: {
      type: 'object',
      properties: { client_id: { type: 'string', description: 'Client id (from a client search).' } },
      required: ['client_id'],
    },
  },
  handler: async (args, ctx) => {
    const { data, error } = await ctx.client
      .from('properties')
      .select('id, kind, name, address, city, province, postal_code, is_primary')
      .eq('org_id', ctx.orgId).eq('client_id', String(args.client_id || ''))
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) return erreurLecture('properties', error);
    const lignes = data || [];
    const service = lignes.filter((p: any) => p.kind !== 'billing');
    const facturation = lignes.find((p: any) => p.kind === 'billing');
    return {
      count: service.length,
      properties: service.map((p: any) => ({
        id: p.id, name: p.name, address: p.address, city: p.city, province: p.province, postal_code: p.postal_code,
        primary: Boolean(p.is_primary),
      })),
      billing_address: facturation
        ? { id: facturation.id, address: facturation.address, city: facturation.city, postal_code: facturation.postal_code }
        : null,
    };
  },
};

const createProperty: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_property',
    description:
      'Add a property (service address) to a client — same as "Add property" on the client page. The first '
      + 'property of a client becomes its primary address. kind: \'billing\' adds a separate billing address instead '
      + '(one per client; invoices are then billed there).',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client id (from a client search).' },
        name: { type: 'string', description: 'Label shown in Lume (e.g. Chalet, Bureau, Maison).' },
        address: { type: 'string', description: 'Full street address (optional but recommended).' },
        city: { type: 'string' }, province: { type: 'string' }, postal_code: { type: 'string' }, country: { type: 'string' },
        is_primary: { type: 'boolean', description: 'true to make it the main service address (optional).' },
        kind: { type: 'string', enum: ['service', 'billing'], description: "'service' (default) or 'billing'." },
      },
      required: ['client_id', 'name'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_property', args, async () => {
      const clientId = champRequis(args.client_id, 'Le client');
      const nom = champRequis(args.name, 'Le nom de la propriété');
      const kind = args.kind === 'billing' ? 'billing' : 'service';
      const { data: fiche, error: errClient } = await ctx.client
        .from('clients').select('id')
        .eq('org_id', ctx.orgId).eq('id', clientId).is('deleted_at', null)
        .maybeSingle();
      if (errClient) echecEcriture('retrouver le client', errClient);
      if (!fiche) throw new Error('Client introuvable — refais une recherche de clients.');

      // Miroir de createProperty (propertiesApi) : la première adresse de
      // service devient principale ; une adresse de facturation ne l'est jamais.
      let isPrimary = kind === 'billing' ? false : Boolean(args.is_primary);
      if (kind === 'service' && args.is_primary === undefined) {
        const { data: existantes, error: errListe } = await ctx.client
          .from('properties').select('id')
          .eq('org_id', ctx.orgId).eq('client_id', clientId).eq('kind', 'service')
          .is('deleted_at', null);
        if (errListe) echecEcriture('lister les adresses du client', errListe);
        if (!existantes?.length) isPrimary = true;
      }
      if (kind === 'billing') {
        const { data: deja, error: errFact } = await ctx.client
          .from('properties').select('id')
          .eq('org_id', ctx.orgId).eq('client_id', clientId).eq('kind', 'billing')
          .is('deleted_at', null).limit(1).maybeSingle();
        if (errFact) echecEcriture('vérifier l’adresse de facturation', errFact);
        if (deja) throw new Error('Ce client a déjà une adresse de facturation — modifie-la avec update_property.');
      }
      const ligne: Record<string, any> = { org_id: ctx.orgId, client_id: clientId, kind, name: nom, is_primary: isPrimary };
      for (const champ of CHAMPS_ADRESSE) if (champ !== 'name' && args[champ] !== undefined) ligne[champ] = texteOuNull(args[champ]);
      const { data, error } = await ctx.client
        .from('properties')
        .insert(ligne)
        .select('id, name, address, city, is_primary, kind')
        .single();
      if (error) echecEcriture('créer l’adresse', error);
      return {
        created: true,
        property: { id: data.id, name: data.name, address: data.address, city: data.city, primary: Boolean(data.is_primary) },
        note: kind === 'billing'
          ? 'Adresse de facturation ajoutée : les prochaines factures y seront adressées.'
          : data.is_primary ? 'Propriété ajoutée comme adresse principale du client.' : 'Propriété ajoutée au client.',
      };
    }),
};

const updateProperty: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_property',
    description:
      "Correct a client's property (address label, street, city, postal code) or make it the primary service address. "
      + 'Only the provided fields change. Get the property id from list_properties.',
    parameters: {
      type: 'object',
      properties: {
        property_id: { type: 'string', description: 'Property id (from list_properties).' },
        name: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' },
        province: { type: 'string' }, postal_code: { type: 'string' }, country: { type: 'string' },
        is_primary: { type: 'boolean', description: 'true to make it the main service address.' },
      },
      required: ['property_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_property', args, async () => {
      const id = champRequis(args.property_id, 'La propriété');
      const patch: Record<string, any> = {};
      if (args.name !== undefined) patch.name = champRequis(args.name, 'Le nom de la propriété');
      for (const champ of CHAMPS_ADRESSE) if (champ !== 'name' && args[champ] !== undefined) patch[champ] = texteOuNull(args[champ]);
      if (args.is_primary !== undefined) patch.is_primary = Boolean(args.is_primary);
      if (!Object.keys(patch).length) throw new Error('Aucun champ à modifier.');
      const { data, error } = await ctx.client
        .from('properties')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select('id, name, address, city, is_primary')
        .maybeSingle();
      if (error) echecEcriture('modifier l’adresse', error);
      if (!data) throw new Error('Propriété introuvable — elle a peut-être été supprimée. Reliste les adresses du client.');
      return {
        updated: true,
        property: { name: data.name, address: data.address, city: data.city, primary: Boolean(data.is_primary) },
        note: 'Adresse mise à jour.',
      };
    }),
};

const deleteProperty: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_property',
    description:
      "Remove a client's property (soft delete, like in Lume — the user cannot undo it). Jobs already linked to it "
      + 'keep their address. Confirm with the user first. Get the property id from list_properties.',
    parameters: {
      type: 'object',
      properties: { property_id: { type: 'string', description: 'Property id (from list_properties).' } },
      required: ['property_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_property', args, async () => {
      const id = champRequis(args.property_id, 'La propriété');
      const { data, error } = await ctx.client
        .from('properties')
        .update({ deleted_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select('id, name, address, kind')
        .maybeSingle();
      if (error) echecEcriture('supprimer l’adresse', error);
      if (!data) throw new Error('Propriété introuvable — elle a peut-être déjà été supprimée.');
      return {
        deleted: true,
        property: { name: data.name, address: data.address },
        note: data.kind === 'billing' ? 'Adresse de facturation retirée : le client est de nouveau facturé à son adresse de service.' : 'Propriété supprimée.',
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   NOTES (specific_notes — l'onglet Notes d'un client, d'un job, d'un devis)
   ═══════════════════════════════════════════════════════════════ */

const TYPES_NOTE = ['client', 'job', 'quote'] as const;

const listNotes: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_notes',
    description:
      "The notes tab of a client, a job or a quote (text notes with attachments), newest first. "
      + 'Use it to get a note id before update_note / delete_note. Activity-feed notes added with add_note are separate.',
    parameters: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: [...TYPES_NOTE], description: "'client', 'job' or 'quote'." },
        entity_id: { type: 'string', description: 'Client, job or quote id.' },
        limit: { type: 'integer', description: 'Max notes (default 10, max 30).' },
      },
      required: ['entity_type', 'entity_id'],
    },
  },
  handler: async (args, ctx) => {
    const { data, error } = await ctx.client
      .from('specific_notes')
      .select('id, text, tags, files, created_at, updated_at')
      .eq('org_id', ctx.orgId)
      .eq('entity_type', String(args.entity_type))
      .eq('entity_id', String(args.entity_id || ''))
      .order('created_at', { ascending: false })
      .limit(clamp(args.limit, 10, 30));
    if (error) return erreurLecture('notes', error);
    return {
      count: data?.length || 0,
      notes: (data || []).map((n: any) => ({
        id: n.id, text: n.text, tags: n.tags || [], attachments: Array.isArray(n.files) ? n.files.length : 0,
        created_at: n.created_at, updated_at: n.updated_at,
      })),
    };
  },
};

const updateNote: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_note',
    description:
      "Edit the text of a note in the notes tab (client, job or quote). Attachments are kept. "
      + 'Get the note id from list_notes.',
    parameters: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: 'Note id (from list_notes).' },
        text: { type: 'string', description: 'The new full text of the note.' },
      },
      required: ['note_id', 'text'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_note', args, async () => {
      const id = champRequis(args.note_id, 'La note');
      const texte = champRequis(args.text, 'Le texte de la note').slice(0, 4000);
      // Miroir de updateSpecificNote (specificNotesApi), avec le filtre org en plus.
      const { data, error } = await ctx.client
        .from('specific_notes')
        .update({ text: texte })
        .eq('org_id', ctx.orgId).eq('id', id)
        .select('id, updated_at')
        .maybeSingle();
      if (error) echecEcriture('modifier la note', error);
      if (!data) throw new Error('Note introuvable — elle a peut-être été supprimée. Reliste les notes.');
      return { updated: true, at: data.updated_at, note: 'Note modifiée.' };
    }),
};

const deleteNote: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_note',
    description:
      'Delete a note from the notes tab (client, job or quote) — PERMANENT, exactly like the trash icon in Lume: '
      + 'the text and its attachments cannot be recovered. Confirm with the user first. Get the note id from list_notes.',
    parameters: {
      type: 'object',
      properties: { note_id: { type: 'string', description: 'Note id (from list_notes).' } },
      required: ['note_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_note', args, async () => {
      const id = champRequis(args.note_id, 'La note');
      // specific_notes n'a pas de deleted_at : le geste de l'app (deleteSpecificNote)
      // est un vrai DELETE. Filtre org explicite en plus de la RLS.
      const { data, error } = await ctx.client
        .from('specific_notes')
        .delete()
        .eq('org_id', ctx.orgId).eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) echecEcriture('supprimer la note', error);
      if (!data) throw new Error('Note introuvable — elle a peut-être déjà été supprimée.');
      return { deleted: true, note: 'Note supprimée définitivement.' };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   CHAMPS PERSONNALISÉS (custom_columns / custom_column_values)
   ═══════════════════════════════════════════════════════════════ */

const ENTITES_CHAMPS = ['clients', 'jobs', 'invoices'] as const;

function optionsDeColonne(col: any): string[] | null {
  const cfg = col?.config || {};
  if (col?.col_type === 'status') return Array.isArray(cfg.statuses) ? cfg.statuses.map((s: any) => String(s.value)) : [];
  if (col?.col_type === 'dropdown' || col?.col_type === 'label') return Array.isArray(cfg.options) ? cfg.options.map((o: any) => String(o.value)) : [];
  return null;
}

const listCustomFields: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_custom_fields',
    description:
      "The org's custom fields (extra columns the user added to clients, jobs or invoices), with their type and "
      + 'allowed options. With record_id, also returns the current values of that record. Use it before set_custom_field.',
    parameters: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: [...ENTITES_CHAMPS], description: "'clients' (default), 'jobs' or 'invoices'." },
        record_id: { type: 'string', description: 'Optional client/job/invoice id to read its current values.' },
      },
    },
  },
  handler: async (args, ctx) => {
    const entite = (ENTITES_CHAMPS as readonly string[]).includes(String(args.entity)) ? String(args.entity) : 'clients';
    const { data: cols, error } = await ctx.client
      .from('custom_columns')
      .select('id, name, col_type, config, required, visible')
      .eq('org_id', ctx.orgId).eq('entity', entite)
      .is('deleted_at', null)
      .order('position', { ascending: true });
    if (error) return erreurLecture('custom_fields', error);
    const valeurs: Record<string, any> = {};
    if (args.record_id && cols?.length) {
      const { data: vals, error: errVals } = await ctx.client
        .from('custom_column_values')
        .select('column_id, value_text, value_number, value_boolean, value_date, value_json')
        .eq('org_id', ctx.orgId).eq('record_id', String(args.record_id));
      if (errVals) return erreurLecture('custom_values', errVals);
      for (const v of vals || []) valeurs[v.column_id] = v.value_text ?? v.value_number ?? v.value_boolean ?? v.value_date ?? v.value_json ?? null;
    }
    return {
      entity: entite,
      count: cols?.length || 0,
      fields: (cols || []).map((c: any) => ({
        id: c.id, name: c.name, type: c.col_type, required: Boolean(c.required),
        options: optionsDeColonne(c),
        ...(args.record_id ? { value: valeurs[c.id] ?? null } : {}),
      })),
    };
  },
};

const setCustomField: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_custom_field',
    description:
      'Set (or clear) the value of a custom field on a client, job or invoice — same as editing the cell in Lume. '
      + 'Get the field id and its type/options from list_custom_fields. Pass an empty value to clear it.',
    parameters: {
      type: 'object',
      properties: {
        field_id: { type: 'string', description: 'Custom field id (from list_custom_fields).' },
        record_id: { type: 'string', description: 'Client, job or invoice id the value belongs to.' },
        value: { type: 'string', description: "The value as text: number for number/currency/rating, 'true'/'false' for checkbox, YYYY-MM-DD for date, one of the options for status/dropdown. Empty = clear." },
      },
      required: ['field_id', 'record_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_custom_field', args, async () => {
      const colonneId = champRequis(args.field_id, 'Le champ personnalisé');
      const recordId = champRequis(args.record_id, 'La fiche');
      const { data: col, error: errCol } = await ctx.client
        .from('custom_columns')
        .select('id, name, col_type, config')
        .eq('org_id', ctx.orgId).eq('id', colonneId)
        .is('deleted_at', null)
        .maybeSingle();
      if (errCol) echecEcriture('retrouver le champ personnalisé', errCol);
      if (!col) throw new Error('Champ personnalisé introuvable — consulte list_custom_fields.');

      // Miroir de setValue (customFieldsApi) : une seule colonne typée remplie.
      const brut = args.value == null ? '' : String(args.value).trim();
      const ligne: Record<string, any> = {
        org_id: ctx.orgId, column_id: col.id, record_id: recordId,
        value_text: null, value_number: null, value_boolean: null, value_date: null, value_json: null,
      };
      let affiche: any = null;
      if (brut) {
        switch (col.col_type) {
          case 'number': case 'currency': case 'rating': {
            const n = Number(brut.replace(',', '.'));
            if (!Number.isFinite(n)) throw new Error(`« ${col.name} » attend un nombre.`);
            ligne.value_number = n; affiche = n; break;
          }
          case 'checkbox': {
            if (!['true', 'false', 'oui', 'non', 'yes', 'no', '1', '0'].includes(brut.toLowerCase())) throw new Error(`« ${col.name} » attend vrai ou faux.`);
            ligne.value_boolean = ['true', 'oui', 'yes', '1'].includes(brut.toLowerCase()); affiche = ligne.value_boolean; break;
          }
          case 'date': {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(brut) || Number.isNaN(Date.parse(brut))) throw new Error(`« ${col.name} » attend une date AAAA-MM-JJ.`);
            ligne.value_date = brut; affiche = brut; break;
          }
          case 'status': case 'dropdown': case 'label': {
            const options = optionsDeColonne(col) || [];
            const choix = options.find((o) => o.toLowerCase() === brut.toLowerCase());
            if (options.length && !choix) throw new Error(`« ${col.name} » n’accepte que : ${options.join(', ')}.`);
            ligne.value_text = choix ?? brut; affiche = ligne.value_text; break;
          }
          case 'email': {
            if (!/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(brut)) throw new Error(`« ${col.name} » attend une adresse courriel valide.`);
            ligne.value_text = brut; affiche = brut; break;
          }
          case 'text': case 'phone': case 'url': {
            ligne.value_text = brut.slice(0, 2000); affiche = ligne.value_text; break;
          }
          default: {
            ligne.value_json = brut; affiche = brut;
          }
        }
      }
      const { error } = await ctx.client
        .from('custom_column_values')
        .upsert(ligne, { onConflict: 'column_id,record_id' });
      if (error) echecEcriture(`enregistrer « ${col.name} »`, error);
      return {
        updated: true,
        field: col.name,
        value: affiche,
        note: brut ? `« ${col.name} » enregistré.` : `« ${col.name} » vidé.`,
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   PIPELINE (cartes de deals)
   ═══════════════════════════════════════════════════════════════ */

const listDeals: AgentTool = {
  kind: 'read',
  needsIdentity: true, // valeur estimée = un montant
  declaration: {
    name: 'list_deals',
    description:
      'The pipeline board: deal cards with their stage, estimated value and prospect. Filter by stage or search '
      + 'by title/prospect name. Returns total_matching and the deal ids needed by update_deal_stage / delete_deal.',
    parameters: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: "Optional stage filter: 'new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost' (French labels accepted)." },
        query: { type: 'string', description: 'Optional text to match the deal title.' },
        limit: { type: 'integer', description: 'Max results (default 15, max 30).' },
      },
    },
  },
  handler: async (args, ctx) => {
    let q = ctx.client
      .from('pipeline_deals')
      .select('id, title, stage, value, created_at, updated_at, won_at, lost_at, lead:clients!pipeline_deals_lead_id_fkey(first_name, last_name, company, display_as_company)', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(clamp(args.limit, 15, 30));
    if (args.stage) {
      try { q = q.eq('stage', versEtape(args.stage)); } catch (e: any) { return { error: e?.message || 'Étape inconnue.' }; }
    }
    const terme = String(args.query || '').trim().replace(/[%,()]/g, ' ');
    if (terme) q = q.ilike('title', `%${terme}%`);
    const { data, error, count } = await q;
    if (error) return erreurLecture('deals', error);
    const lignes = data || [];
    const total = count ?? lignes.length;
    return {
      total_matching: total,
      shown: lignes.length,
      ...(total > lignes.length ? { note: `Only ${lignes.length} of ${total} are listed below. The exact total is ${total}.` } : {}),
      deals: lignes.map((d: any) => ({
        id: d.id,
        title: d.title,
        prospect: nomAffiche(Array.isArray(d.lead) ? d.lead[0] : d.lead) || null,
        statut: traduireStatut(d.stage, STATUT_PROSPECT),
        value_amount: d.value,
        updated_at: d.updated_at,
      })),
    };
  },
};

const updateDealStage: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_deal_stage',
    description:
      'Move a pipeline card (deal) to another stage — same as dragging it on the board. The stage automations '
      + '(e.g. a job intent when won) run like in the app. Get the deal id from list_deals. If the user talks '
      + 'about the PROSPECT rather than the card, prefer update_lead_status (it keeps both in sync).',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Deal id (from list_deals).' },
        stage: { type: 'string', description: "Target stage: 'new_prospect', 'no_response', 'quote_sent', 'closed_won' or 'closed_lost' (French labels accepted)." },
      },
      required: ['deal_id', 'stage'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_deal_stage', args, async () => {
      const dealId = champRequis(args.deal_id, 'La carte de pipeline');
      const etape = versEtape(champRequis(args.stage, 'L’étape'));
      // Miroir de setPipelineDealStage (pipelineApi) : on lit l'ancienne étape
      // (filtre org), on passe par le RPC de l'app, on signale l'événement.
      const { data: deal, error: errDeal } = await ctx.client
        .from('pipeline_deals')
        .select('id, title, stage, lead_id, job_id')
        .eq('org_id', ctx.orgId).eq('id', dealId)
        .is('deleted_at', null)
        .maybeSingle();
      if (errDeal) echecEcriture('retrouver la carte de pipeline', errDeal);
      if (!deal) throw new Error('Carte de pipeline introuvable — elle a peut-être été supprimée. Consulte list_deals.');
      const statut = traduireStatut(etape, STATUT_PROSPECT);
      if (deal.stage === etape) {
        return { updated: true, changed: false, deal: { title: deal.title }, statut, note: `La carte était déjà à l’étape « ${statut} » — rien à changer.` };
      }
      const { error } = await ctx.client.rpc('set_deal_stage', { p_deal_id: deal.id, p_stage: etape });
      if (error) echecEcriture('déplacer la carte de pipeline', error);
      const avert = await signaler(ctx, '/automations/events/deal-stage-changed', {
        dealId: deal.id,
        ...(deal.lead_id ? { leadId: deal.lead_id } : {}),
        ...(deal.job_id ? { jobId: deal.job_id } : {}),
        oldStage: deal.stage || '',
        newStage: etape,
      });
      return {
        updated: true,
        changed: true,
        deal: { title: deal.title },
        statut,
        note: `Carte déplacée à l’étape « ${statut} ».${avert ? ` Attention : ${avert}` : ''}`,
      };
    }),
};

const deleteDeal: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_deal',
    description:
      'Remove a card from the pipeline (soft delete, like in Lume — the user cannot undo it). With also_delete_lead: '
      + 'true the prospect itself is deleted too. Confirm with the user first. Get the deal id from list_deals. '
      + 'A saved payment card (« carte enregistrée », card on file) is NOT a pipeline card → remove_card_on_file / charge_card_on_file.',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Deal id (from list_deals).' },
        also_delete_lead: { type: 'boolean', description: 'true to delete the linked prospect as well (default false).' },
      },
      required: ['deal_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_deal', args, async () => {
      const dealId = champRequis(args.deal_id, 'La carte de pipeline');
      const { data: deal, error: errDeal } = await ctx.client
        .from('pipeline_deals')
        .select('id, title')
        .eq('org_id', ctx.orgId).eq('id', dealId)
        .is('deleted_at', null)
        .maybeSingle();
      if (errDeal) echecEcriture('retrouver la carte de pipeline', errDeal);
      if (!deal) throw new Error('Carte de pipeline introuvable — elle a peut-être déjà été supprimée.');
      const aussiLeLead = Boolean(args.also_delete_lead);
      const r = await routeOuIncertain(ctx, '/deals/soft-delete', { dealId: deal.id, alsoDeleteLead: aussiLeLead }, 'la carte a été supprimée');
      if ('incertain' in r) return r.incertain;
      if (!r.ok) echecRoute('supprimer la carte de pipeline', r.status, r.json);
      return {
        deleted: true,
        deal: { title: deal.title },
        lead_deleted: Boolean(r.json?.lead_deleted),
        note: r.json?.lead_deleted ? 'Carte retirée du pipeline et prospect supprimé.' : 'Carte retirée du pipeline.',
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════ */

export const OUTILS_LEADS: AgentTool[] = [
  // Prospects
  createLead, updateLead, updateLeadStatus, deleteLead, convertLeadToJob,
  // Demandes entrantes
  processRequestSubmission, deleteRequestSubmission,
  // Client
  deleteClient,
  // Propriétés
  listProperties, createProperty, updateProperty, deleteProperty,
  // Notes
  listNotes, updateNote, deleteNote,
  // Champs personnalisés
  listCustomFields, setCustomField,
  // Pipeline
  listDeals, updateDealStage, deleteDeal,
];

/** Une entrée par ÉCRITURE — même vocabulaire que registre.ts (sensible / reversible / vers_client). */
export const REGISTRE_LEADS: Record<string, { sensible: boolean; reversible: boolean; vers_client: boolean }> = {
  create_lead:                { sensible: false, reversible: true,  vers_client: false },
  update_lead:                { sensible: false, reversible: true,  vers_client: false },
  update_lead_status:         { sensible: false, reversible: true,  vers_client: false },
  delete_lead:                { sensible: true,  reversible: false, vers_client: false }, // soft delete, sans retour pour l'utilisateur
  convert_lead_to_job:        { sensible: true,  reversible: true,  vers_client: false }, // crée un job (archivable)
  process_request_submission: { sensible: false, reversible: true,  vers_client: false },
  delete_request_submission:  { sensible: true,  reversible: false, vers_client: false }, // soft delete
  delete_client:              { sensible: true,  reversible: false, vers_client: false }, // soft delete en cascade
  create_property:            { sensible: false, reversible: true,  vers_client: false },
  update_property:            { sensible: false, reversible: true,  vers_client: false },
  delete_property:            { sensible: true,  reversible: false, vers_client: false }, // soft delete
  update_note:                { sensible: false, reversible: true,  vers_client: false },
  delete_note:                { sensible: true,  reversible: false, vers_client: false }, // hard delete (pas de deleted_at)
  set_custom_field:           { sensible: false, reversible: true,  vers_client: false },
  update_deal_stage:          { sensible: false, reversible: true,  vers_client: false },
  delete_deal:                { sensible: true,  reversible: false, vers_client: false }, // soft delete
};

/** Une entrée par outil — même forme que PERMISSION_PAR_OUTIL (garde.ts). */
export const PERMISSIONS_LEADS: Record<string, { cle: PermissionKey; capacite: string }> = {
  create_lead:                { cle: 'leads.create',   capacite: 'la création de prospects' },
  update_lead:                { cle: 'leads.update',   capacite: 'la modification des prospects' },
  update_lead_status:         { cle: 'leads.update',   capacite: 'le changement d’étape des prospects' },
  delete_lead:                { cle: 'leads.delete',   capacite: 'la suppression de prospects' },
  convert_lead_to_job:        { cle: 'jobs.create',    capacite: 'la conversion d’un prospect en job' },
  process_request_submission: { cle: 'leads.update',   capacite: 'le traitement des demandes entrantes' },
  delete_request_submission:  { cle: 'leads.delete',   capacite: 'la suppression des demandes entrantes' },
  delete_client:              { cle: 'clients.delete', capacite: 'la suppression de clients' },
  list_properties:            { cle: 'clients.read',   capacite: 'la consultation des adresses d’un client' },
  create_property:            { cle: 'clients.update', capacite: 'l’ajout d’adresses à un client' },
  update_property:            { cle: 'clients.update', capacite: 'la modification des adresses d’un client' },
  delete_property:            { cle: 'clients.update', capacite: 'la suppression des adresses d’un client' },
  // Notes : même garde que add_note (jobs.read, clé que tout rôle opérationnel possède).
  list_notes:                 { cle: 'jobs.read',      capacite: 'la consultation des notes' },
  update_note:                { cle: 'jobs.read',      capacite: 'la modification des notes' },
  delete_note:                { cle: 'jobs.read',      capacite: 'la suppression des notes' },
  list_custom_fields:         { cle: 'clients.read',   capacite: 'la consultation des champs personnalisés' },
  set_custom_field:           { cle: 'clients.update', capacite: 'la saisie des champs personnalisés' },
  list_deals:                 { cle: 'leads.read',     capacite: 'la consultation du pipeline' },
  update_deal_stage:          { cle: 'leads.update',   capacite: 'le déplacement des cartes du pipeline' },
  delete_deal:                { cle: 'leads.delete',   capacite: 'la suppression des cartes du pipeline' },
};

/** Chaque outil, exactement une fois — à fusionner dans TOPICS (topics.ts). */
export const TOPICS_LEADS: Partial<Record<IdTopic, string[]>> = {
  clients: OUTILS_LEADS.map((t) => t.declaration.name),
};
