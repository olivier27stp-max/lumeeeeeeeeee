/* ═══════════════════════════════════════════════════════════════
   Lume Agent — outils de RÉGLAGES (messages, modèles de courriel,
   automatisations, taxes, catalogue, objectifs, rapports planifiés,
   notifications)
   ─────────────────────────────────────────────────────────────
   Complète tools.ts / tools-etendus.ts avec les actions que Lumi ne
   savait pas EXÉCUTER : tout ce que l'utilisateur fait à la main dans
   Réglages, Automatisations, Insights et la cloche de notifications.
   Mêmes règles que le reste du registre :

   • Une écriture = `kind: 'write'`, `needsIdentity: true`, handler
     enveloppé dans `executerIdempotent` (empreinte, dédoublonnage,
     erreurs traduites en mots d'exploitant).
   • Quand une ROUTE existe en POST, on l'emprunte via `appelInterne`
     (mêmes validations Zod, même contrôle admin/owner, même cache).
     Pour les routes PUT/PATCH/DELETE (que `appelInterne` ne sait pas
     appeler), on reproduit la logique de la route directement avec
     `ctx.client` — à l'identité de l'utilisateur, donc sous RLS — et
     TOUJOURS filtré par `org_id = ctx.orgId`.
   • Les résultats restent petits : un identifiant, quelques champs
     lisibles, et une `note` en français que l'assistant peut relayer.
   • Aucune erreur brute de la base ne remonte au modèle (lectures :
     message générique ; écritures : traduction par executerIdempotent).
   • Exclus volontairement : connexion OAuth d'une boîte courriel,
     provisionnement SMS/A2P, facturation de l'abonnement, intégrations
     OAuth — des parcours qui exigent l'écran.
   ═══════════════════════════════════════════════════════════════ */

import type { PermissionKey } from '../../../src/lib/permissions';
import { getServiceClient, isOrgAdminOrOwner, companyOrgIds } from '../supabase';
import type { IdTopic } from '../lumi/topics';
import type { AgentTool, ToolContext } from './tools';
import { executerIdempotent, champRequis, appelInterne, traduireStatut, AppelInterneIncertain } from './tools-etendus';
import { etatCredits } from '../lumi/budget';
import {
  COLONNES_REGLE_LUE, etapesDeLaRegle, aUnParcours, messagesDeLaRegle, actionsDepuisEtapes, resumeDeLaRegle,
  declencheurEnClair, avisSegments, regleAtteintLeClient, type RegleLue,
} from '../automations-etapes';
import { messageCorbeille } from '../automations-corbeille';
import { ecrireRegle, type ChangementsRegle } from '../automations-ecriture';
import { langueDuTour } from '../lumi/contexte-appel';
import { porteeALActivation } from '../lumi/panneau-automatisation';
import { trouverDeclencheur, estPrereglageRetire } from '../../../src/lib/automationCatalogue';
import { localizeAutomationName } from '../../../src/lib/automationNames';
import { textesDExemple } from '../../../src/lib/publicationAutomatisation';
import { VARIABLES_CONNUES, variablesInconnues, variableLisible, texteVersHtml } from '../../../src/lib/emailBodyText';

/* ── Petits utilitaires locaux ─────────────────────────────────── */

const clamp = (n: any, def: number, max: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
};

/** Même politique que tools.ts : jamais d'erreur brute vers le modèle (lectures). */
function erreurLecture(scope: string, err: any): { error: string } {
  console.error(`[agent-tool:${scope}]`, err?.message || err);
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l’utilisateur et propose de réessayer.' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identifiant destiné à un CHEMIN de route interne (`/email-templates/:id/…`) :
 * on exige un vrai UUID, sinon un « id » fantaisiste pourrait réécrire le chemin.
 */
function idPourChemin(v: any, nomLisible: string): string {
  const s = champRequis(v, nomLisible);
  if (!UUID.test(s)) throw new Error(`${nomLisible} n'est pas un identifiant valide.`);
  return s;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function dateYmd(v: any, nomLisible: string): string {
  const s = champRequis(v, nomLisible);
  if (!YMD.test(s)) throw new Error(`${nomLisible} doit être une date au format AAAA-MM-JJ.`);
  return s;
}

/**
 * Une écriture directe (ctx.client) filtrée par la RLS peut « réussir » avec
 * 0 ligne : on exige `.select()` et on vérifie qu'une ligne a bien été touchée,
 * sinon l'assistant annoncerait un faux succès (leçon de automationRulesApi).
 */
function ligneTouchee<T>(rows: T[] | null | undefined, quoi: string): T {
  if (!rows || rows.length === 0) throw new Error(`${quoi} introuvable — vérifie qu'il existe encore et que ton rôle permet de le modifier.`);
  return rows[0];
}

/** Traduit une réponse non-ok d'une route interne en phrase d'exploitant. */
function refusRoute(status: number, json: any, parDefaut: string, particuliers: Record<number, string> = {}): Error {
  if (particuliers[status]) return new Error(particuliers[status]);
  if (status === 403) return new Error('Seuls le propriétaire ou un administrateur peuvent faire ça.');
  if (status === 404) return new Error('Élément introuvable — il a peut-être déjà été supprimé.');
  const detail = typeof json?.error === 'string' ? json.error.slice(0, 160) : '';
  return new Error(detail ? `${parDefaut} (${detail})` : parDefaut);
}

/* ── Dictionnaires (libellés français) ─────────────────────────── */

const TYPES_MODELE = ['invoice_sent', 'invoice_reminder', 'quote_sent', 'quote_accepted', 'quote_declined', 'job_confirmation', 'job_reminder', 'job_completed', 'review_request', 'generic'] as const;
const LIBELLE_TYPE_MODELE: Record<string, string> = {
  invoice_sent: 'envoi de facture',
  invoice_reminder: 'rappel de facture',
  quote_sent: 'envoi de devis',
  quote_accepted: 'devis accepté',
  quote_declined: 'devis refusé',
  job_confirmation: 'confirmation de job',
  job_reminder: 'rappel de job',
  job_completed: 'job terminée',
  review_request: 'demande d’avis',
  generic: 'générique',
};

const LIBELLE_FREQUENCE: Record<string, string> = { daily: 'quotidien', weekly: 'hebdomadaire', monthly: 'mensuel' };
const LIBELLE_METRIQUE: Record<string, string> = { revenue: 'revenus', jobs: 'jobs', leads: 'prospects' };
const LIBELLE_PERIODE: Record<string, string> = { weekly: 'hebdomadaire', monthly: 'mensuel', quarterly: 'trimestriel', yearly: 'annuel' };
const LIBELLE_UNITE: Record<string, string> = { flat: 'forfait', linear_ft: 'pied linéaire', sq_ft: 'pied carré' };
const LIBELLE_ARTICLE: Record<string, string> = { service: 'service', product: 'produit' };

/* ════════════════════════════════════════════════════════════════
   MESSAGES
   ════════════════════════════════════════════════════════════════ */

const markConversationRead: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'mark_conversation_read',
    description: 'Mark an SMS conversation as read (unread count back to zero). Use the conversation id from get_conversations.',
    parameters: {
      type: 'object',
      properties: { conversation_id: { type: 'string', description: 'Conversation id.' } },
      required: ['conversation_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'mark_conversation_read', args, async () => {
      const id = champRequis(args.conversation_id, 'La conversation');
      const { data, error } = await ctx.client
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .select('id, client_name');
      if (error) throw error;
      const row = ligneTouchee(data, 'La conversation');
      return { marked_read: true, client_name: row.client_name ?? null, note: 'Conversation marquée comme lue.' };
    }),
};

/* ════════════════════════════════════════════════════════════════
   MODÈLES DE COURRIEL
   ════════════════════════════════════════════════════════════════ */

const listEmailTemplates: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_email_templates',
    description: 'List the org email templates: name, type (invoice_sent, quote_sent, review_request...), subject, active, default. Optionally filter by type.',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string', enum: [...TYPES_MODELE], description: 'Only templates of this type.' } },
    },
  },
  handler: async (args, ctx) => {
    let q = ctx.client
      .from('email_templates')
      .select('id, name, type, subject, is_active, is_default, updated_at')
      .eq('org_id', ctx.orgId)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true })
      .limit(50);
    if (args.type) q = q.eq('type', String(args.type));
    const { data, error } = await q;
    if (error) return erreurLecture('email_templates', error);
    return {
      count: data?.length || 0,
      templates: (data || []).map((t: any) => ({
        template_id: t.id,
        name: t.name,
        type: t.type,
        type_libelle: traduireStatut(t.type, LIBELLE_TYPE_MODELE),
        subject: t.subject,
        actif: !!t.is_active,
        par_defaut: !!t.is_default,
        modifie_le: t.updated_at,
      })),
      note: data?.length ? 'Modèles de courriel de l’entreprise.' : 'Aucun modèle de courriel enregistré : les envois utilisent le texte standard de Lume.',
    };
  },
};

const createEmailTemplate: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_email_template',
    description: 'Create an email template for the org. Show the user the subject and body first. Variables like {{client_name}} are kept as-is.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Template name shown in the app.' },
        type: { type: 'string', enum: [...TYPES_MODELE], description: 'What the template is for.' },
        subject: { type: 'string', description: 'Email subject.' },
        body: { type: 'string', description: 'Email body (text or HTML).' },
        variables: { type: 'array', items: { type: 'string' }, description: 'Variable names used in the body (optional).' },
        is_active: { type: 'boolean', description: 'Active (default true).' },
        is_default: { type: 'boolean', description: 'Make it the default for its type (default false).' },
      },
      required: ['name', 'type', 'subject', 'body'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_email_template', args, async () => {
      const corps = {
        name: champRequis(args.name, 'Le nom du modèle').slice(0, 120),
        type: champRequis(args.type, 'Le type de modèle'),
        subject: champRequis(args.subject, 'L’objet').slice(0, 300),
        body: champRequis(args.body, 'Le corps du courriel').slice(0, 20000),
        variables: Array.isArray(args.variables) ? args.variables.map(String) : [],
        is_active: args.is_active !== false,
        is_default: args.is_default === true,
      };
      const { ok, status, json } = await appelInterne(ctx, '/email-templates', corps);
      if (!ok) throw refusRoute(status, json, 'La création du modèle a été refusée.');
      return {
        created: true,
        template_id: json?.id ?? null,
        name: corps.name,
        type_libelle: traduireStatut(corps.type, LIBELLE_TYPE_MODELE),
        note: corps.is_default ? 'Modèle de courriel créé et défini par défaut pour son type.' : 'Modèle de courriel créé.',
      };
    }),
};

const updateEmailTemplate: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_email_template',
    description: 'Change one or more fields of an existing email template (name, subject, body, type, variables, active). Only the fields given are changed.',
    parameters: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template id.' },
        name: { type: 'string' },
        type: { type: 'string', enum: [...TYPES_MODELE] },
        subject: { type: 'string' },
        body: { type: 'string' },
        variables: { type: 'array', items: { type: 'string' } },
        is_active: { type: 'boolean' },
      },
      required: ['template_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_email_template', args, async () => {
      const id = champRequis(args.template_id, 'Le modèle');
      const maj: Record<string, any> = { updated_at: new Date().toISOString() };
      if (args.name !== undefined) maj.name = champRequis(args.name, 'Le nom du modèle').slice(0, 120);
      if (args.type !== undefined) maj.type = String(args.type);
      if (args.subject !== undefined) maj.subject = champRequis(args.subject, 'L’objet').slice(0, 300);
      if (args.body !== undefined) maj.body = champRequis(args.body, 'Le corps du courriel').slice(0, 20000);
      if (args.variables !== undefined) maj.variables = Array.isArray(args.variables) ? args.variables.map(String) : [];
      if (args.is_active !== undefined) maj.is_active = !!args.is_active;
      if (Object.keys(maj).length === 1) throw new Error('Rien à modifier : précise au moins un champ (nom, objet, corps…).');
      const { data, error } = await ctx.client
        .from('email_templates')
        .update(maj)
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .select('id, name');
      if (error) throw error;
      const row = ligneTouchee(data, 'Le modèle de courriel');
      return { updated: true, template_id: row.id, name: row.name, note: 'Modèle de courriel mis à jour.' };
    }),
};

const setDefaultEmailTemplate: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_default_email_template',
    description: 'Make a template the default one for its type (the previous default of that type is unset).',
    parameters: {
      type: 'object',
      properties: { template_id: { type: 'string', description: 'Template id.' } },
      required: ['template_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_default_email_template', args, async () => {
      const id = idPourChemin(args.template_id, 'Le modèle');
      const { ok, status, json } = await appelInterne(ctx, `/email-templates/${id}/set-default`, {});
      if (!ok) throw refusRoute(status, json, 'Le changement de modèle par défaut a été refusé.', { 404: 'Modèle de courriel introuvable.' });
      return { updated: true, template_id: id, name: json?.name ?? null, note: 'Ce modèle est maintenant celui utilisé par défaut pour son type.' };
    }),
};

const deleteEmailTemplate: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_email_template',
    description: 'Permanently delete an email template. Cannot be undone: confirm with the user first.',
    parameters: {
      type: 'object',
      properties: { template_id: { type: 'string', description: 'Template id.' } },
      required: ['template_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_email_template', args, async () => {
      const id = champRequis(args.template_id, 'Le modèle');
      const { data, error } = await ctx.client
        .from('email_templates')
        .delete()
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .select('id, name');
      if (error) throw error;
      const row = ligneTouchee(data, 'Le modèle de courriel');
      return { deleted: true, template_id: row.id, name: row.name, note: 'Modèle de courriel supprimé définitivement.' };
    }),
};

const duplicateEmailTemplate: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'duplicate_email_template',
    description: 'Duplicate an email template as a new inactive-default copy named "... (Copy)", to edit it without touching the original.',
    parameters: {
      type: 'object',
      properties: { template_id: { type: 'string', description: 'Template id to copy.' } },
      required: ['template_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'duplicate_email_template', args, async () => {
      const id = idPourChemin(args.template_id, 'Le modèle');
      const { ok, status, json } = await appelInterne(ctx, `/email-templates/${id}/duplicate`, {});
      if (!ok) throw refusRoute(status, json, 'La duplication du modèle a été refusée.', { 404: 'Modèle de courriel introuvable.' });
      return { created: true, template_id: json?.id ?? null, name: json?.name ?? null, note: 'Copie du modèle créée — elle n’est pas le modèle par défaut.' };
    }),
};

/* ════════════════════════════════════════════════════════════════
   AUTOMATISATIONS

   Mission finale (2026-10-02), règle commune à tous les outils ci-dessous :
   une écriture RELIT la ligne après avoir écrit et rend l'état relu (nom,
   publiée ou non, déclencheur en clair, étapes, messages tels qu'enregistrés).
   Lumi cite ce résultat — jamais ce qu'il avait l'intention d'écrire.
   Lecture des étapes : un seul accès, `automations-etapes.ts`.
   ════════════════════════════════════════════════════════════════ */

type RegleEnBase = RegleLue & { id: string; name: string; trigger_event: string; modele_id?: string | null };

/** Une automatisation du bureau (jamais une règle supprimée définitivement). */
async function lireAutomatisation(ctx: ToolContext, id: string): Promise<RegleEnBase> {
  const { data, error } = await ctx.client
    .from('automation_rules')
    .select(`${COLONNES_REGLE_LUE}, modele_id`)
    .eq('id', id).eq('org_id', ctx.orgId).is('purged_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Automatisation introuvable dans cette entreprise — elle a peut-être été supprimée.');
  return data as unknown as RegleEnBase;
}

/** Aucune écriture sur une automatisation à la corbeille : on la restaure d'abord (comme l'éditeur, 409). */
function refuserCorbeille(regle: RegleLue): void {
  if (regle.deleted_at) throw new Error(`${messageCorbeille(langueDuTour() === 'fr')} Rien n’a été modifié.`);
}

/** Variables utiles à un déclencheur : le client et l'entreprise, toujours ; puis celles de la fiche qui déclenche. */
const VARIABLES_TOUJOURS = ['client_first_name', 'client_name', 'company_name', 'company_phone'];
const VARIABLES_PAR_FICHE: Record<string, string[]> = {
  quote: ['quote_number', 'quote_total', 'quote_link', 'quote_valid_until'],
  invoice: ['invoice_number', 'invoice_total', 'invoice_due_date', 'invoice_link'],
  appointment: ['appointment_date', 'appointment_time', 'appointment_address', 'job_name'],
  job: ['job_name', 'review_link'],
  agreement: ['contract_link', 'signed_contract_link', 'deposit_amount'],
  deal: ['deal_stage', 'deal_source'],
  lead: [],
};
export function variablesPourDeclencheur(cle: string | null | undefined): string[] {
  const fiche = (cle ? trouverDeclencheur(cle)?.entite : undefined) ?? '';
  return [...VARIABLES_TOUJOURS, ...(VARIABLES_PAR_FICHE[fiche] ?? [])].filter((v) => VARIABLES_CONNUES.includes(v));
}

/**
 * Refuse un message qui partirait TROUÉ (A-06). Le moteur remplace une
 * variable inconnue par du vide : « Bonjour {{client_prenom}}, payez ici :
 * {{lien_paiement}} » arrive « Bonjour , payez ici : . » — vu 3 fois sur 5
 * réécritures libres du clavardage. Même contrôle que « Construire avec Lumi »
 * (`variablesInconnues`), plus les crochets qui ne sont pas des variables
 * (« [lien de paiement] » partirait tel quel).
 */
export function problemeDeVariables(textes: Array<string | undefined>, declencheur: string | null | undefined): string | null {
  const texte = textes.filter((t): t is string => typeof t === 'string').join('\n');
  const inconnues = variablesInconnues(texte).map(variableLisible);
  const fauxCrochets = [...texte.matchAll(/\[([^\]\n]{1,60})\]|\{\{?([^{}\n]{1,60})\}?\}/g)]
    .map((m) => ({ tout: m[0], dedans: String(m[1] ?? m[2] ?? '').trim() }))
    // « [lien de paiement] », « [prénom] », « {{lien paiement}} » : des mots en minuscules — un essai de variable.
    // (« [URGENT] » ou une référence « [A-12] » restent du texte : on ne refuse pas ce qui n'y ressemble pas.)
    .filter((c) => !/^\w+$/.test(c.dedans) && !/^[a-z]+\.[a-z][a-z0-9_]*$/.test(c.dedans))
    .filter((c) => c.tout.startsWith('{') || /^[a-zà-ÿ_ ’']+$/.test(c.dedans))
    .map((c) => c.tout);
  const fautives = [...new Set([...inconnues, ...fauxCrochets])];
  if (!fautives.length) return null;
  const valides = variablesPourDeclencheur(declencheur).map((v) => `[${v}]`).join(', ');
  return `Message refusé, rien n’a été enregistré : ${fautives.join(', ')} ${fautives.length > 1 ? 'ne sont pas des variables' : 'n’est pas une variable'} de Lume — le client recevrait un trou à la place. `
    + `Variables valides pour « ${declencheurEnClair(declencheur, true)} » : ${valides}.`;
}
function refuserVariablesInconnues(textes: Array<string | undefined>, declencheur: string | null | undefined): void {
  const probleme = problemeDeVariables(textes, declencheur);
  if (probleme) throw new Error(probleme);
}

/** Le corps d'un courriel au format ENREGISTRÉ par l'éditeur (HTML) : un texte brut y partait en un seul bloc (A-21). */
function corpsCourriel(corps: string): string {
  return /<[a-z][^>]*>/i.test(corps) ? corps : texteVersHtml(corps);
}

/** L'état RELU d'une automatisation, sous la forme compacte que Lumi cite. */
function etatRelu(regle: RegleLue, langue: 'fr' | 'en'): Record<string, unknown> {
  const r = resumeDeLaRegle(regle, langue, { maxMessage: 1_500 });
  return {
    nom: r.nom,
    etat: r.etat,
    declencheur: r.declencheur,
    ...(r.filtres.length ? { filtres: r.filtres } : {}),
    etapes: r.etapes,
    ...(r.reglages.length ? { reglages: r.reglages } : {}),
  };
}

/** Ce que fait l'automatisation, en une ou deux lignes — pour le reçu affiché après « Confirmer ». */
function etapesPourRecu(regle: RegleLue, langue: 'fr' | 'en'): string {
  const r = resumeDeLaRegle(regle, langue, { maxMessage: 600 });
  return r.etapes.length ? r.etapes.join('\n') : (langue === 'fr' ? '(aucune étape)' : '(no step)');
}

const toggleAutomationRule: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'toggle_automation_rule',
    description:
      'Publish (enable) or pause an automation. Pausing is immediate and never refused. '
      + 'To enable: call this tool right away, without writing a summary yourself. The app writes above the card exactly what will run (the trigger, each message word for word, who is reached at activation), and the card asks for the OK. '
      + 'Refused when a step still carries the editor sample text or when the journey is incomplete: say why, never "done".',
    parameters: {
      type: 'object',
      properties: {
        rule_id: { type: 'string', description: 'Automation rule id (from get_automation or list_automations).' },
        is_active: { type: 'boolean', description: 'true = publish, false = pause.' },
      },
      required: ['rule_id', 'is_active'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'toggle_automation_rule', args, async () => {
      const id = champRequis(args.rule_id, 'L’automatisation');
      if (typeof args.is_active !== 'boolean') throw new Error('Précise si l’automatisation doit être activée (true) ou mise en pause (false).');
      const actif = args.is_active;
      const langue = langueDuTour();
      const fr = langue === 'fr';
      if (actif) {
        // Un texte d'EXEMPLE de l'éditeur ne part jamais à un client. L'écran demande
        // une confirmation avant de publier ; Lumi, lui, ne publie pas : il le dit.
        const avant = await lireAutomatisation(ctx, id);
        const exemples = textesDExemple({ ...avant, fr });
        if (!avant.deleted_at && exemples.length) {
          const cites = messagesDeLaRegle(avant).filter((m) => exemples.some((p) => p.etapeId === m.etape)).map((m) => `« ${m.texte.slice(0, 120)} »`);
          throw new Error(fr
            ? `Je ne l’ai PAS activée : ${exemples.length > 1 ? 'des étapes portent' : 'une étape porte'} encore le texte d’exemple de l’éditeur${cites.length ? ` (${cites.join(', ')})` : ''}, qui partirait tel quel aux clients. Écris d’abord le vrai message (dis-moi quoi écrire), puis demande l’activation.`
            : `I did NOT enable it: ${exemples.length > 1 ? 'some steps still carry' : 'a step still carries'} the editor’s sample text${cites.length ? ` (${cites.join(', ')})` : ''}, which would go to clients as is. Write the real message first, then ask to enable it.`);
        }
      }
      // Le même chemin que l'interface (audit M8) : un parcours cassé n'est
      // pas publié, et Lumi reçoit la liste des problèmes à expliquer.
      const { changerPublication } = await import('../automations-publication');
      const r = await changerPublication(ctx.client, ctx.orgId, id, actif, fr);
      if (!r.ok) throw new Error(`${r.erreur} ${fr ? 'Rien n’a changé.' : 'Nothing changed.'}`);
      // RELU en base (A-05) : la réponse dit l'état d'aujourd'hui, pas la valeur demandée.
      const relue = await lireAutomatisation(ctx, id);
      if ((relue.is_active === true) !== actif) {
        throw new Error(fr ? 'La modification n’a pas été appliquée : l’automatisation n’a pas changé d’état. Réessaie.' : 'The change was not applied: the automation did not change state. Try again.');
      }
      const portee = actif ? await porteeALActivation(getServiceClient(), ctx.orgId, relue, langue) : null;
      return {
        updated: true,
        rule_id: relue.id,
        name: relue.name,
        is_active: relue.is_active === true,
        automatisation: etatRelu(relue, langue),
        ...(portee ? { portee } : {}),
        recu: actif
          ? (fr
            ? `Elle est maintenant publiée. Déclencheur : ${declencheurEnClair(relue.trigger_event, true)}. Ce qui part :\n${etapesPourRecu(relue, 'fr')}\n${portee}`
            : `It is now published. Trigger: ${declencheurEnClair(relue.trigger_event, false)}. What runs:\n${etapesPourRecu(relue, 'en')}\n${portee}`)
          : (fr ? 'Elle est maintenant en brouillon : plus rien ne part tant qu’elle n’est pas republiée.' : 'It is now a draft: nothing is sent until it is published again.'),
        note: actif ? 'Automatisation publiée : elle partira dès son prochain déclenchement.' : 'Automatisation mise en pause : plus rien ne partira jusqu’à sa réactivation.',
      };
    }),
};

/**
 * Créer une automatisation à partir d'une phrase.
 *
 * POURQUOI CET OUTIL
 * Lumi savait activer, renommer et réécrire une automatisation, jamais en
 * créer une. La création vivait dans un module séparé (`generer-parcours`),
 * atteignable seulement par un assistant à questions successives — qui
 * oblige à redire ce qu'on a déjà dit et ne permet pas de se corriger.
 * Ici, la demande arrive en une phrase dans la conversation.
 *
 * LE COÛT
 * On réutilise `genererParcours` tel quel plutôt que de faire raisonner
 * l'orchestrateur : un aller-retour Haiku, catalogue en cache, budget réservé
 * AVANT l'appel. Mesuré en production le 2026-09-25 : 0,32 ¢ pour un parcours
 * à deux étapes. Faire construire le JSON par l'orchestrateur (240 outils,
 * historique complet) coûterait plusieurs fois ce prix pour un résultat moins
 * fiable — le catalogue ne serait pas sous les yeux du modèle.
 *
 * CE QU'IL N'EST PAS
 * Une écriture directe. L'outil PROPOSE ; l'automatisation naît **en pause**
 * (`is_active: false`), comme toute règle créée dans l'app : personne ne doit
 * déclencher des envois aux clients en fermant un formulaire. L'utilisateur
 * l'active ensuite avec `toggle_automation_rule`, ce qui lui redemande
 * confirmation.
 */
const createAutomationFromText: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_automation_from_text',
    description:
      'Create a NEW automation from a plain-language description (e.g. "after a quote is sent, wait 3 days then text a follow-up, then 2 more days and text again"). '
      + 'The rule is created PAUSED: tell the user it will not send anything until they enable it. '
      + 'Use this only to create; to enable, rename or reword an existing one use toggle_automation_rule / update_automation_message.',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'The automation in one or two sentences, in the user\'s own words. Include every delay and every message they asked for.',
        },
      },
      required: ['description'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_automation_from_text', args, async () => {
      const demande = champRequis(args.description, 'La description de l\'automatisation');
      if (demande.trim().length < 10) {
        throw new Error('Décris l\'automatisation en une phrase : le déclencheur, les délais et les messages.');
      }

      const { genererParcours } = await import('../lumi/generer-parcours');
      const { sequenceEtapes } = await import('../validation');
      const { trouverDeclencheur } = await import('../../../src/lib/automationCatalogue');
      const { refAutomatisationInventee } = await import('../automations-publication');
      const admin = getServiceClient();

      // Les messages partent aux clients dans la langue des automatisations
      // de l'entreprise (celle que règle set_automation_language). Elle était
      // forcée à 'fr' : une entreprise anglophone recevait des textes français.
      const { data: reglages } = await ctx.client
        .from('company_settings').select('default_language').eq('org_id', ctx.orgId).maybeSingle();
      const langue: 'fr' | 'en' = reglages?.default_language === 'en' ? 'en' : 'fr';

      const resultat = await genererParcours({
        admin,
        orgId: ctx.orgId,
        userId: ctx.userId ?? null,
        demande: demande.trim(),
        langue,
      });
      if (!resultat.parcours) {
        throw new Error(resultat.erreur ?? 'Je n\'ai pas réussi à construire ce parcours. Reformule-le.');
      }

      // Les MÊMES garde-fous que la route « Construire avec Lumi »
      // (POST /automations/rules/generer) : ce qui ne passerait pas le moteur
      // n'est jamais enregistré. Sans eux, un déclencheur inventé (aucun CHECK
      // en base) ou une étape « démarrer » vers une règle inexistante
      // dormaient en base sans jamais pouvoir partir.
      const verdict = sequenceEtapes.safeParse(resultat.parcours.steps);
      // Comme la route : le motif exact du refus reste dans les journaux (1 fois
      // sur ~40 sur la batterie I, invisible sans cette trace).
      if (!verdict.success) {
        console.error('[create_automation_from_text] parcours invalide', ctx.orgId, JSON.stringify(verdict.error.issues.slice(0, 3)));
        throw new Error('Le parcours proposé ne pourrait pas tourner. Reformule ta demande, ou construis-le avec le « + » dans Automatisations.');
      }
      if (!trouverDeclencheur(resultat.parcours.trigger_event)) {
        throw new Error('Lumi a choisi un déclencheur qui n’existe pas. Reformule ta demande.');
      }
      // Déclencheur en rodage, pas offert à cette entreprise : son événement
      // n'est jamais émis — la règle dormirait en base.
      const { declencheurOffertA, refusDeclencheurNonOffert } = await import('../automations-drapeaux');
      if (!(await declencheurOffertA(ctx.client, ctx.orgId, resultat.parcours.trigger_event))) {
        throw new Error(refusDeclencheurNonOffert(resultat.parcours.trigger_event));
      }
      if (await refAutomatisationInventee(ctx.client, ctx.orgId, verdict.data)) {
        throw new Error('Lumi a voulu relier une automatisation qui n’existe pas. Redemande-le autrement.');
      }
      // La 2e automatisation (autre déclencheur, ex. « quand le client
      // répond ») passe les mêmes gardes ; invalide, elle est laissée de côté
      // sans faire perdre la première — comme dans l'éditeur.
      const a = resultat.parcours.autre;
      const verdictAutre = a ? sequenceEtapes.safeParse(a.steps) : null;
      const autre = a && verdictAutre?.success && trouverDeclencheur(a.trigger_event)
        && await declencheurOffertA(ctx.client, ctx.orgId, a.trigger_event)
        && !(await refAutomatisationInventee(ctx.client, ctx.orgId, verdictAutre.data))
        ? { ...a, steps: verdictAutre.data }
        : null;

      const { data, error } = await ctx.client
        .from('automation_rules')
        .insert({
          org_id: ctx.orgId,
          name: resultat.parcours.nom,
          description: resultat.parcours.resume,
          trigger_event: resultat.parcours.trigger_event,
          conditions: {},
          delay_seconds: 0,
          actions: [],
          steps: verdict.data,
          // En pause à la naissance : voir l'en-tête de l'outil.
          is_active: false,
        })
        .select('id, name, trigger_event, is_active');
      if (error) throw error;
      const row = ligneTouchee(data, 'L\'automatisation');

      // La DEUXIÈME automatisation (autre déclencheur, ex. « quand le client
      // répond »), en pause elle aussi, avec sa limite « une fois par client
      // tous les N jours » (sans elle, une réponse automatique sur « le client
      // répond » repartirait à chaque texto). Elle était jetée en silence :
      // Lumi annonçait la réaction, rien ne la portait. Elle a passé les mêmes
      // gardes que la première (`autre`, plus haut) ; sinon on DIT ce qui manque.
      let seconde: Record<string, unknown> | null = null;
      if (a) {
        if (typeof a.manque === 'string' && a.manque.trim()) {
          seconde = { creee: false, name: a.nom, manque: a.manque };
        } else if (!autre) {
          seconde = { creee: false, name: a.nom, manque: 'un parcours valide (à construire dans Automatisations)' };
        } else {
          const { data: d2, error: e2 } = await ctx.client
            .from('automation_rules')
            .insert({
              org_id: ctx.orgId,
              name: autre.nom,
              description: autre.resume,
              trigger_event: autre.trigger_event,
              conditions: {},
              delay_seconds: 0,
              actions: [],
              steps: autre.steps,
              settings: autre.une_fois_par_client_jours ? { delai_entre_passages_jours: autre.une_fois_par_client_jours } : null,
              is_active: false,
            })
            .select('id, name, trigger_event');
          // La 1re est déjà en base : on le dit plutôt que de lever (l'empreinte
          // d'idempotence resterait libérée et une retentative la doublerait).
          if (e2 || !d2?.length) {
            console.error('[create_automation_from_text] 2e automatisation non créée', ctx.orgId, e2?.message ?? 'aucune ligne');
            seconde = { creee: false, name: autre.nom, manque: 'l’enregistrement a échoué — à créer dans Automatisations' };
          } else {
            seconde = { creee: true, rule_id: d2[0].id, name: d2[0].name, trigger_event: d2[0].trigger_event };
          }
        }
      }

      return {
        created: true,
        rule_id: row.id,
        name: row.name,
        trigger_event: row.trigger_event,
        etapes: verdict.data.length,
        resume: resultat.parcours.resume,
        is_active: false,
        ...(seconde ? { deuxieme_automatisation: seconde } : {}),
        ...(seconde && !seconde.creee ? { warning: `La deuxième automatisation (« ${String(seconde.name)} ») n’a PAS été créée : il manque ${String(seconde.manque)}.` } : {}),
        note: 'Créée EN PAUSE : rien ne partira tant qu\'elle n\'est pas activée. Elle est visible dans Automatisations, où le parcours peut être ajusté. Un filtre sur le déclencheur (montant, type de job…) ne se crée pas d\'ici : il s\'ajoute dans l\'éditeur.',
      };
    }, {
      // « Déjà fait » ne vaut que si l'automatisation créée existe encore :
      // supprimée (corbeille, suppression définitive) puis redemandée, elle
      // est recréée. Lecture service_role bornée à l'entreprise : la corbeille
      // peut être masquée au client de l'utilisateur.
      encoreValable: async (resultat) => {
        const id = typeof resultat.rule_id === 'string' ? resultat.rule_id : '';
        if (!id) return true;
        const { data, error } = await getServiceClient()
          .from('automation_rules')
          .select('id, deleted_at, purged_at')
          .eq('org_id', ctx.orgId).eq('id', id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const regle = data as { deleted_at?: string | null; purged_at?: string | null } | null;
        return !!regle && !regle.deleted_at && !regle.purged_at;
      },
    }),
};

/**
 * Réécrit le corps (et l'objet, pour un courriel) d'UN message d'envoi d'une
 * règle — lecture-modification-écriture, le reste est intact.
 *
 * Audit 2026-09-30 : un parcours (`steps` non vide) est ce que le moteur
 * exécute ; `actions` n'y sert plus. Avant, l'outil réécrivait `actions` :
 * « c'est fait », et les clients recevaient l'ANCIEN texte. Il réécrivait aussi
 * TOUS les messages du même type avec le même texte. Maintenant : la bonne
 * liste, un seul message, et s'il y en a plusieurs, on demande lequel.
 */
async function reecrireMessageAutomation(
  ctx: ToolContext,
  ruleId: string,
  actionType: 'send_sms' | 'send_email',
  body: string,
  subject?: string,
  numero?: number,
): Promise<Record<string, any>> {
  const { data: regle, error: lireErr } = await ctx.client
    .from('automation_rules')
    .select('id, name, actions, steps')
    .eq('id', ruleId)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (lireErr) throw lireErr;
  if (!regle) throw new Error('Automatisation introuvable.');
  const quoi = actionType === 'send_sms' ? 'texto' : 'courriel';
  const nouvelleConfig = (config: Record<string, any> | undefined) => ({
    ...(config || {}), body, ...(actionType === 'send_email' && subject !== undefined ? { subject } : {}),
  });

  // Une automatisation à ÉTAPES : le moteur exécute `steps` et ignore `actions`,
  // qui n'en est qu'un reflet (constaté en prod le 2026-09-30, #799 ; audit des
  // outils). On réécrit l'étape visée ; plusieurs messages du même type → Lumi
  // demande lequel (message_number) au lieu de tout réécrire ou de refuser.
  const etapes: any[] = Array.isArray(regle.steps) ? regle.steps : [];
  const actions: any[] = Array.isArray(regle.actions) ? regle.actions : [];
  const parcours = etapes.length > 0;
  // Les messages de ce type, dans l'ordre du parcours (ou de la liste d'actions).
  const cibles: Array<{ index: number; texte: string; nom: string | null }> = parcours
    ? etapes.flatMap((e, index) => (e?.type === 'action' && e.action?.type === actionType
      ? [{ index, texte: String(e.action?.config?.body ?? ''), nom: e.nom ?? null }] : []))
    : actions.flatMap((a: any, index: number) => (a?.type === actionType
      ? [{ index, texte: String(a?.config?.body ?? ''), nom: null }] : []));
  if (!cibles.length) throw new Error(`Cette automatisation n’envoie pas de ${quoi} : rien à réécrire.`);
  if (cibles.length > 1 && !numero) {
    const liste = cibles.map((c, i) => `${i + 1}. ${c.nom ? `${c.nom} — ` : ''}« ${c.texte.slice(0, 60)}${c.texte.length > 60 ? '…' : ''} »`).join(' ; ');
    throw new Error(`Cette automatisation envoie ${cibles.length} ${quoi}s. Lequel réécrire ? ${liste}`);
  }
  const cible = cibles[(numero ?? 1) - 1];
  if (!cible) throw new Error(`Il n’y a que ${cibles.length} ${quoi}(s) dans cette automatisation.`);

  // Reflet `actions` tenu à jour quand il n'y a qu'un message de ce type (sans ambiguïté).
  const refletUnique = parcours && cibles.length === 1 && actions.filter((a) => a?.type === actionType).length === 1;
  const maj = parcours
    ? {
      steps: etapes.map((e, i) => (i === cible.index ? { ...e, action: { ...e.action, config: nouvelleConfig(e.action?.config) } } : e)),
      ...(refletUnique ? { actions: actions.map((a) => (a?.type === actionType ? { ...a, config: nouvelleConfig(a.config) } : a)) } : {}),
    }
    : { actions: actions.map((a, i) => (i === cible.index ? { ...a, config: nouvelleConfig(a.config) } : a)) };
  const { data, error } = await ctx.client
    .from('automation_rules')
    .update({ ...maj, updated_at: new Date().toISOString() })
    .eq('id', ruleId)
    .eq('org_id', ctx.orgId)
    .select('id');
  if (error) throw error;
  ligneTouchee(data, 'L’automatisation');
  return {
    updated: true,
    rule_id: regle.id,
    name: regle.name,
    action_type: actionType,
    ancien_texte: cible.texte,
    note: actionType === 'send_sms' ? 'Texte du texto de l’automatisation mis à jour.' : 'Texte du courriel de l’automatisation mis à jour.',
  };
}

const updateAutomationMessage: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_automation_message',
    description: 'Rewrite the text a rule sends to clients (SMS body, or email body and subject). Show the user the new text first. Other actions of the rule are untouched.',
    parameters: {
      type: 'object',
      properties: {
        rule_id: { type: 'string', description: 'Automation rule id.' },
        action_type: { type: 'string', enum: ['send_sms', 'send_email'], description: 'Which message to rewrite.' },
        body: { type: 'string', description: 'New message text.' },
        subject: { type: 'string', description: 'New subject (emails only).' },
        message_number: { type: 'integer', description: 'When the rule sends several messages of this type: which one (1 = first in the flow). Ask the user if unsure.' },
      },
      required: ['rule_id', 'action_type', 'body'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_automation_message', args, async () => {
      const id = champRequis(args.rule_id, 'L’automatisation');
      const type = args.action_type === 'send_email' ? 'send_email' : 'send_sms';
      const body = champRequis(args.body, 'Le texte du message').slice(0, 5000);
      const subject = args.subject === undefined || args.subject === null ? undefined : String(args.subject).slice(0, 300);
      const numero = Number.isInteger(args.message_number) && Number(args.message_number) > 0 ? Number(args.message_number) : undefined;
      return reecrireMessageAutomation(ctx, id, type, body, subject, numero);
    }),
};

const updateAutomationSmsBody: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_automation_sms_body',
    description: 'Rewrite only the SMS text of an automation rule. Shortcut for update_automation_message with action_type send_sms.',
    parameters: {
      type: 'object',
      properties: {
        rule_id: { type: 'string', description: 'Automation rule id.' },
        body: { type: 'string', description: 'New SMS text.' },
        message_number: { type: 'integer', description: 'When the rule sends several SMS: which one (1 = first in the flow).' },
      },
      required: ['rule_id', 'body'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_automation_sms_body', args, async () => {
      const id = champRequis(args.rule_id, 'L’automatisation');
      const body = champRequis(args.body, 'Le texte du texto').slice(0, 1600);
      const numero = Number.isInteger(args.message_number) && Number(args.message_number) > 0 ? Number(args.message_number) : undefined;
      return reecrireMessageAutomation(ctx, id, 'send_sms', body, undefined, numero);
    }),
};

const setAutomationLanguage: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_automation_language',
    description: 'Set the language (fr or en) of the automatic SMS and emails the org sends to clients. Owner/admin only.',
    parameters: {
      type: 'object',
      properties: { language: { type: 'string', enum: ['fr', 'en'], description: 'fr or en.' } },
      required: ['language'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_automation_language', args, async () => {
      const langue = args.language === 'en' ? 'en' : args.language === 'fr' ? 'fr' : null;
      if (!langue) throw new Error('La langue doit être « fr » ou « en ».');
      const { data, error } = await ctx.client
        .from('company_settings')
        .update({ default_language: langue })
        .eq('org_id', ctx.orgId)
        .select('org_id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Seuls le propriétaire ou un administrateur peuvent changer la langue des automatisations.');
      return { updated: true, language: langue, note: langue === 'fr' ? 'Les messages automatiques partiront désormais en français.' : 'Les messages automatiques partiront désormais en anglais.' };
    }),
};

/* ════════════════════════════════════════════════════════════════
   TAXES — sensible : touche toutes les prochaines factures
   ════════════════════════════════════════════════════════════════ */

/** Les routes de taxes exigent owner/admin : même barrière ici pour les écritures directes. */
async function exigerAdminTaxes(ctx: ToolContext): Promise<void> {
  const ok = await isOrgAdminOrOwner(getServiceClient(), ctx.userId, ctx.orgId);
  if (!ok) throw new Error('Seuls le propriétaire ou un administrateur peuvent modifier les taxes.');
}

const getTaxConfig: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_tax_config',
    description: 'The org tax setup: each tax (name, rate, active, registration number) and the tax groups, with which one is the default applied to quotes and invoices.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const [taxesRes, groupesRes] = await Promise.all([
      ctx.client.from('tax_configs').select('id, name, rate, type, is_active, is_compound, registration_number, sort_order').eq('org_id', ctx.orgId).order('sort_order', { ascending: true }).limit(50),
      ctx.client.from('tax_groups').select('id, name, region, is_default, is_active').eq('org_id', ctx.orgId).order('created_at', { ascending: true }).limit(20),
    ]);
    if (taxesRes.error) return erreurLecture('tax_configs', taxesRes.error);
    if (groupesRes.error) return erreurLecture('tax_groups', groupesRes.error);
    const groupes = groupesRes.data || [];
    const ids = groupes.map((g: any) => g.id);
    let items: any[] = [];
    if (ids.length) {
      const { data, error } = await ctx.client.from('tax_group_items').select('tax_group_id, tax_config_id, sort_order').in('tax_group_id', ids).order('sort_order', { ascending: true }).limit(200);
      if (error) return erreurLecture('tax_group_items', error);
      items = data || [];
    }
    const nomTaxe = new Map((taxesRes.data || []).map((t: any) => [t.id, `${t.name} ${Number(t.rate)} %`]));
    const parDefaut = groupes.find((g: any) => g.is_default) || null;
    return {
      taxes: (taxesRes.data || []).map((t: any) => ({
        tax_id: t.id,
        name: t.name,
        rate: Number(t.rate),
        active: !!t.is_active,
        compound: !!t.is_compound,
        registration_number: t.registration_number || null,
      })),
      groups: groupes.map((g: any) => ({
        group_id: g.id,
        name: g.name,
        region: g.region || null,
        default: !!g.is_default,
        active: !!g.is_active,
        taxes: items.filter((i) => i.tax_group_id === g.id).map((i) => nomTaxe.get(i.tax_config_id) || '?'),
      })),
      default_group: parDefaut ? parDefaut.name : null,
      note: parDefaut
        ? `Le groupe « ${parDefaut.name} » s’applique par défaut aux devis et factures.`
        : 'Aucun groupe de taxes par défaut : les devis et factures partent sans taxe tant que ce n’est pas configuré.',
    };
  },
};

const setupTaxes: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'setup_taxes',
    description: 'Set up the org taxes from a regional preset (QC = TPS+TVQ, ON = HST, BC = GST+PST, US-CA, US-TX, UK, FR...). Affects every future invoice: confirm with the user. Owner/admin only.',
    parameters: {
      type: 'object',
      properties: {
        preset_key: { type: 'string', description: 'Region code, e.g. QC, ON, BC, AB, US-NY, UK, FR.' },
        make_default: { type: 'boolean', description: 'Apply this group by default (default true).' },
      },
      required: ['preset_key'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'setup_taxes', args, async () => {
      const preset = champRequis(args.preset_key, 'Le code de région').toUpperCase().slice(0, 20);
      const make_default = args.make_default !== false;
      const { ok, status, json } = await appelInterne(ctx, '/taxes/setup', { preset_key: preset, make_default });
      if (!ok) {
        throw refusRoute(status, json, 'La configuration des taxes a été refusée.', {
          400: `Code de région inconnu : « ${preset} ».`,
          409: 'Cette région est déjà configurée — rien à refaire.',
        });
      }
      return {
        configured: true,
        region: preset,
        group_name: json?.group?.name ?? null,
        tax_count: Number(json?.config_count) || 0,
        note: make_default ? 'Taxes configurées et appliquées par défaut aux prochains devis et factures.' : 'Taxes configurées (groupe créé, sans le mettre par défaut).',
      };
    }),
};

const createTaxConfig: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_tax_config',
    description: 'Add a custom tax rate (name + percentage) to the default tax group, so it applies to future invoices. Owner/admin only.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tax name, e.g. TVQ.' },
        rate: { type: 'number', description: 'Percentage, 0 to 100 (9.975 for TVQ).' },
        is_compound: { type: 'boolean', description: 'Applied on top of the other taxes (default false).' },
        region: { type: 'string', description: 'Region code (optional).' },
        country: { type: 'string', description: 'Country code (default CA).' },
      },
      required: ['name', 'rate'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_tax_config', args, async () => {
      const name = champRequis(args.name, 'Le nom de la taxe').slice(0, 120);
      const rate = Number(args.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Le taux doit être un pourcentage entre 0 et 100.');
      // Audit 2026-09-30 : une taxe active de même nom (ou même taux) existe déjà
      // → une deuxième TVQ doublait la taxe sur tous les documents.
      const { data: existantes, error: errEx } = await ctx.client.from('tax_configs')
        .select('name, rate').eq('org_id', ctx.orgId).eq('is_active', true);
      if (errEx) throw errEx;
      const pareille = (existantes || []).find((t: any) => String(t.name).trim().toLowerCase() === name.trim().toLowerCase()
        || (Number(t.rate) === rate && !args.region));
      if (pareille) {
        throw new Error(`Une taxe active « ${pareille.name} » (${String(pareille.rate).replace('.', ',')} %) existe déjà : l’ajouter encore la compterait deux fois. Modifie-la plutôt.`);
      }
      const corps: Record<string, any> = { name, rate, type: 'percentage', is_compound: args.is_compound === true };
      if (args.region) corps.region = String(args.region).slice(0, 20);
      if (args.country) corps.country = String(args.country).slice(0, 5);
      const { ok, status, json } = await appelInterne(ctx, '/taxes/config', corps);
      if (!ok) throw refusRoute(status, json, 'L’ajout de la taxe a été refusé.');
      return { created: true, tax_id: json?.config?.id ?? null, name, rate, note: 'Taxe ajoutée au groupe par défaut : elle s’appliquera aux prochains devis et factures.' };
    }),
};

const updateTaxConfig: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_tax_config',
    description: 'Change a tax: name, rate, active or registration number (tax number printed on invoices). Affects future invoices only. Owner/admin only.',
    parameters: {
      type: 'object',
      properties: {
        tax_id: { type: 'string', description: 'Tax id (from get_tax_config).' },
        name: { type: 'string' },
        rate: { type: 'number', description: 'Percentage, 0 to 100.' },
        is_active: { type: 'boolean' },
        registration_number: { type: 'string', description: 'Registration number; empty string clears it.' },
      },
      required: ['tax_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_tax_config', args, async () => {
      await exigerAdminTaxes(ctx);
      const id = champRequis(args.tax_id, 'La taxe');
      const maj: Record<string, any> = { updated_at: new Date().toISOString() };
      if (args.name !== undefined) maj.name = champRequis(args.name, 'Le nom de la taxe').slice(0, 120);
      if (args.rate !== undefined) {
        const rate = Number(args.rate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Le taux doit être un pourcentage entre 0 et 100.');
        maj.rate = rate;
      }
      if (args.is_active !== undefined) maj.is_active = !!args.is_active;
      if (args.registration_number !== undefined) maj.registration_number = String(args.registration_number).trim().slice(0, 60) || null;
      if (Object.keys(maj).length === 1) throw new Error('Rien à modifier : précise au moins un champ (nom, taux, actif, numéro).');
      const { data, error } = await ctx.client
        .from('tax_configs')
        .update(maj)
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .select('id, name, rate, is_active');
      if (error) throw error;
      const row = ligneTouchee(data, 'La taxe');
      return { updated: true, tax_id: row.id, name: row.name, rate: Number(row.rate), active: !!row.is_active, note: 'Taxe mise à jour : les prochains devis et factures l’utiliseront.' };
    }),
};

const deleteTaxConfig: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_tax_config',
    description: 'Remove a tax rate from the org. Past invoices keep their amounts; future ones will not include it. Cannot be undone: confirm with the user. Owner/admin only.',
    parameters: {
      type: 'object',
      properties: { tax_id: { type: 'string', description: 'Tax id.' } },
      required: ['tax_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_tax_config', args, async () => {
      await exigerAdminTaxes(ctx);
      const id = champRequis(args.tax_id, 'La taxe');
      const { data, error } = await ctx.client
        .from('tax_configs')
        .delete()
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .select('id, name');
      if (error) throw error;
      const row = ligneTouchee(data, 'La taxe');
      return { deleted: true, tax_id: row.id, name: row.name, note: 'Taxe supprimée : elle ne sera plus appliquée aux prochains devis et factures.' };
    }),
};

const setDefaultTaxGroup: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_default_tax_group',
    description: 'Choose which tax group applies by default to quotes and invoices (only one default at a time). Owner/admin only.',
    parameters: {
      type: 'object',
      properties: { group_id: { type: 'string', description: 'Tax group id (from get_tax_config).' } },
      required: ['group_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_default_tax_group', args, async () => {
      await exigerAdminTaxes(ctx);
      const id = champRequis(args.group_id, 'Le groupe de taxes');
      // Le groupe doit appartenir à l'org AVANT de démarquer les autres.
      const { data: groupe, error: lireErr } = await ctx.client.from('tax_groups').select('id, name').eq('id', id).eq('org_id', ctx.orgId).maybeSingle();
      if (lireErr) throw lireErr;
      if (!groupe) throw new Error('Groupe de taxes introuvable.');
      const { error: clearErr } = await ctx.client.from('tax_groups').update({ is_default: false }).eq('org_id', ctx.orgId).eq('is_default', true);
      if (clearErr) throw clearErr;
      const { data, error } = await ctx.client.from('tax_groups').update({ is_default: true }).eq('id', id).eq('org_id', ctx.orgId).select('id, name');
      if (error) throw error;
      const row = ligneTouchee(data, 'Le groupe de taxes');
      const { error: settingsErr } = await ctx.client.from('company_settings').update({ default_tax_group_id: row.id }).eq('org_id', ctx.orgId);
      if (settingsErr) throw settingsErr;
      return { updated: true, group_id: row.id, name: row.name, note: `Le groupe « ${row.name} » s’applique maintenant par défaut aux devis et factures.` };
    }),
};

/* ════════════════════════════════════════════════════════════════
   CATALOGUE DE SERVICES
   ════════════════════════════════════════════════════════════════ */

const createService: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_service',
    description: 'Add a service or product to the org catalog with its usual price (in cents). Check list_services first to avoid duplicates.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Service name.' },
        price_cents: { type: 'integer', description: 'Usual price in cents (12500 = $125.00).' },
        description: { type: 'string' },
        category: { type: 'string' },
        duration_minutes: { type: 'integer', description: 'Usual duration in minutes.' },
        item_type: { type: 'string', enum: ['service', 'product'], description: 'Default service.' },
        pricing_unit: { type: 'string', enum: ['flat', 'linear_ft', 'sq_ft'], description: 'Default flat (fixed price).' },
        cost_cents: { type: 'integer', description: 'Internal cost in cents (for margins).' },
        taxable: { type: 'boolean', description: 'Default true.' },
      },
      required: ['name', 'price_cents'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_service', args, async () => {
      const name = champRequis(args.name, 'Le nom du service').slice(0, 200);
      const prix = Math.round(Number(args.price_cents));
      if (!Number.isFinite(prix) || prix < 0) throw new Error('Le prix doit être un montant en cents, positif ou nul.');
      const duree = args.duration_minutes === undefined ? null : Math.max(0, Math.round(Number(args.duration_minutes)) || 0) || null;
      const cout = args.cost_cents === undefined || args.cost_cents === null ? null : Math.round(Number(args.cost_cents));
      const { data, error } = await ctx.client
        .from('predefined_services')
        .insert({
          org_id: ctx.orgId,
          name,
          description: args.description ? String(args.description).slice(0, 2000) : null,
          default_price_cents: prix,
          category: args.category ? String(args.category).slice(0, 100) : null,
          default_duration_minutes: duree,
          pricing_unit: args.pricing_unit || 'flat',
          measure_default: false,
          item_type: args.item_type || 'service',
          default_cost_cents: Number.isFinite(cout as number) ? cout : null,
          taxable: args.taxable !== false,
        })
        .select('id, name, default_price_cents')
        .single();
      if (error) throw error;
      return { created: true, service_id: data.id, name: data.name, price_cents: data.default_price_cents, note: 'Service ajouté au catalogue.' };
    }),
};

/** Le catalogue est partagé entre les bureaux d'une compagnie : on cible l'org active et ses bureaux frères, jamais au-delà. */
async function orgsCatalogue(ctx: ToolContext): Promise<string[]> {
  const ids = await companyOrgIds(getServiceClient(), ctx.orgId);
  return ids.includes(ctx.orgId) ? ids : [ctx.orgId, ...ids];
}

const updateService: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_service',
    description: 'Change a catalog service: name, price (cents), description, category, duration, unit, cost, taxable. Only the fields given are changed.',
    parameters: {
      type: 'object',
      properties: {
        service_id: { type: 'string', description: 'Service id (from list_services).' },
        name: { type: 'string' },
        price_cents: { type: 'integer' },
        description: { type: 'string' },
        category: { type: 'string' },
        duration_minutes: { type: 'integer' },
        item_type: { type: 'string', enum: ['service', 'product'] },
        pricing_unit: { type: 'string', enum: ['flat', 'linear_ft', 'sq_ft'] },
        cost_cents: { type: 'integer' },
        taxable: { type: 'boolean' },
      },
      required: ['service_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_service', args, async () => {
      const id = champRequis(args.service_id, 'Le service');
      const maj: Record<string, any> = { updated_at: new Date().toISOString() };
      if (args.name !== undefined) maj.name = champRequis(args.name, 'Le nom du service').slice(0, 200);
      if (args.price_cents !== undefined) {
        const prix = Math.round(Number(args.price_cents));
        if (!Number.isFinite(prix) || prix < 0) throw new Error('Le prix doit être un montant en cents, positif ou nul.');
        maj.default_price_cents = prix;
      }
      if (args.description !== undefined) maj.description = String(args.description).slice(0, 2000) || null;
      if (args.category !== undefined) maj.category = String(args.category).slice(0, 100) || null;
      if (args.duration_minutes !== undefined) maj.default_duration_minutes = Math.max(0, Math.round(Number(args.duration_minutes)) || 0) || null;
      if (args.item_type !== undefined) maj.item_type = String(args.item_type);
      if (args.pricing_unit !== undefined) maj.pricing_unit = String(args.pricing_unit);
      if (args.cost_cents !== undefined) maj.default_cost_cents = args.cost_cents === null ? null : Math.round(Number(args.cost_cents));
      if (args.taxable !== undefined) maj.taxable = !!args.taxable;
      if (Object.keys(maj).length === 1) throw new Error('Rien à modifier : précise au moins un champ (nom, prix, durée…).');
      const { data, error } = await ctx.client
        .from('predefined_services')
        .update(maj)
        .eq('id', id)
        .in('org_id', await orgsCatalogue(ctx))
        .select('id, name, default_price_cents, pricing_unit, item_type');
      if (error) throw error;
      const row = ligneTouchee(data, 'Le service');
      return {
        updated: true,
        service_id: row.id,
        name: row.name,
        price_cents: row.default_price_cents,
        unite: traduireStatut(row.pricing_unit, LIBELLE_UNITE),
        type: traduireStatut(row.item_type, LIBELLE_ARTICLE),
        note: 'Service du catalogue mis à jour.',
      };
    }),
};

const archiveService: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'archive_service',
    description: 'Archive a catalog service: it stops being offered in pickers, existing quotes and jobs keep it. Reversible in the app.',
    parameters: {
      type: 'object',
      properties: { service_id: { type: 'string', description: 'Service id.' } },
      required: ['service_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'archive_service', args, async () => {
      const id = champRequis(args.service_id, 'Le service');
      const { data, error } = await ctx.client
        .from('predefined_services')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .in('org_id', await orgsCatalogue(ctx))
        .select('id, name');
      if (error) throw error;
      const row = ligneTouchee(data, 'Le service');
      return { archived: true, service_id: row.id, name: row.name, note: 'Service archivé : il n’est plus proposé, les devis et jobs existants le gardent.' };
    }),
};

/* ════════════════════════════════════════════════════════════════
   OBJECTIFS (Insights)
   ════════════════════════════════════════════════════════════════ */

const listGoals: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_goals',
    description: 'List the org business goals (revenue in cents, jobs, leads) with their period and dates. Progress is shown on the Insights page.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('goals')
      .select('id, metric, target_value, period, start_date, end_date')
      .eq('org_id', ctx.orgId)
      .order('start_date', { ascending: false })
      .limit(20);
    if (error) return erreurLecture('goals', error);
    return {
      count: data?.length || 0,
      goals: (data || []).map((g: any) => ({
        goal_id: g.id,
        metric: g.metric,
        metrique: traduireStatut(g.metric, LIBELLE_METRIQUE),
        ...(g.metric === 'revenue' ? { target_cents: Number(g.target_value) || 0 } : { target: Number(g.target_value) || 0 }),
        periode: traduireStatut(g.period, LIBELLE_PERIODE),
        du: g.start_date,
        au: g.end_date,
      })),
      note: data?.length ? 'Objectifs de l’entreprise (les revenus sont en cents).' : 'Aucun objectif défini pour l’instant.',
    };
  },
};

const setGoal: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_goal',
    description: 'Create a business goal: metric (revenue in cents, jobs count, leads count), target, period and date range.',
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['revenue', 'jobs', 'leads'], description: 'What to track.' },
        target_value: { type: 'integer', description: 'Target: cents for revenue (5000000 = $50,000), a count otherwise.' },
        period: { type: 'string', enum: ['weekly', 'monthly', 'quarterly', 'yearly'], description: 'Default monthly.' },
        start_date: { type: 'string', description: 'YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'YYYY-MM-DD.' },
      },
      required: ['metric', 'target_value', 'start_date', 'end_date'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_goal', args, async () => {
      const metric = champRequis(args.metric, 'La métrique');
      if (!LIBELLE_METRIQUE[metric]) throw new Error('La métrique doit être revenue, jobs ou leads.');
      const cible = Math.round(Number(args.target_value));
      if (!Number.isFinite(cible) || cible <= 0) throw new Error('La cible doit être un nombre positif.');
      const period = args.period && LIBELLE_PERIODE[String(args.period)] ? String(args.period) : 'monthly';
      const du = dateYmd(args.start_date, 'La date de début');
      const au = dateYmd(args.end_date, 'La date de fin');
      if (au < du) throw new Error('La date de fin doit suivre la date de début.');
      const { data, error } = await ctx.client
        .from('goals')
        .insert({ org_id: ctx.orgId, created_by: ctx.userId, metric, target_value: cible, period, start_date: du, end_date: au })
        .select('id')
        .single();
      if (error) throw error;
      return {
        created: true,
        goal_id: data.id,
        metrique: traduireStatut(metric, LIBELLE_METRIQUE),
        ...(metric === 'revenue' ? { target_cents: cible } : { target: cible }),
        periode: traduireStatut(period, LIBELLE_PERIODE),
        du,
        au,
        note: 'Objectif créé : sa progression s’affiche dans Insights.',
      };
    }),
};

const deleteGoal: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_goal',
    description: 'Delete a business goal. Cannot be undone: confirm with the user.',
    parameters: {
      type: 'object',
      properties: { goal_id: { type: 'string', description: 'Goal id (from list_goals).' } },
      required: ['goal_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_goal', args, async () => {
      const id = champRequis(args.goal_id, 'L’objectif');
      // La table goals n'a pas de policy DELETE : on prouve d'abord, à
      // l'identité de l'utilisateur, que l'objectif est visible dans SON org,
      // puis on supprime comme la route (service, filtré par org_id).
      const { data: vu, error: lireErr } = await ctx.client.from('goals').select('id, metric').eq('id', id).eq('org_id', ctx.orgId).maybeSingle();
      if (lireErr) throw lireErr;
      if (!vu) throw new Error('Objectif introuvable — il a peut-être déjà été supprimé.');
      const { error } = await getServiceClient().from('goals').delete().eq('id', id).eq('org_id', ctx.orgId);
      if (error) throw error;
      return { deleted: true, goal_id: id, metrique: traduireStatut(vu.metric, LIBELLE_METRIQUE), note: 'Objectif supprimé.' };
    }),
};

/* ════════════════════════════════════════════════════════════════
   RAPPORTS PLANIFIÉS (courriel Insights)
   ════════════════════════════════════════════════════════════════ */

const listScheduledReports: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_scheduled_reports',
    description: 'List the scheduled Insights reports emailed automatically: recipient, frequency (daily, weekly, monthly), day, enabled, last sent.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('scheduled_reports')
      .select('id, recipient_email, frequency, day_of_week, day_of_month, enabled, last_sent_at')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) return erreurLecture('scheduled_reports', error);
    return {
      count: data?.length || 0,
      reports: (data || []).map((r: any) => ({
        report_id: r.id,
        recipient_email: r.recipient_email,
        frequence: traduireStatut(r.frequency, LIBELLE_FREQUENCE),
        ...(r.frequency === 'weekly' ? { day_of_week: r.day_of_week } : {}),
        ...(r.frequency === 'monthly' ? { day_of_month: r.day_of_month } : {}),
        actif: !!r.enabled,
        dernier_envoi: r.last_sent_at,
      })),
      note: data?.length ? 'Rapports envoyés automatiquement par courriel.' : 'Aucun rapport planifié : rien ne part automatiquement par courriel.',
    };
  },
};

const createScheduledReport: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_scheduled_report',
    description: 'Schedule an Insights report by email: recipient, frequency (daily, weekly, monthly), day of week (0=Sunday..6) or day of month (1..28).',
    parameters: {
      type: 'object',
      properties: {
        recipient_email: { type: 'string', description: 'Recipient email address.' },
        frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'Default weekly.' },
        day_of_week: { type: 'integer', description: '0 (Sunday) to 6 (Saturday); weekly only, default 1.' },
        day_of_month: { type: 'integer', description: '1 to 28; monthly only, default 1.' },
      },
      required: ['recipient_email'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_scheduled_report', args, async () => {
      const courriel = champRequis(args.recipient_email, 'Le destinataire').toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(courriel)) throw new Error('L’adresse courriel du destinataire n’est pas valide.');
      const frequency = args.frequency && LIBELLE_FREQUENCE[String(args.frequency)] ? String(args.frequency) : 'weekly';
      const corps: Record<string, any> = { recipient_email: courriel, frequency };
      if (args.day_of_week !== undefined) {
        const j = Math.round(Number(args.day_of_week));
        if (!Number.isFinite(j) || j < 0 || j > 6) throw new Error('Le jour de la semaine va de 0 (dimanche) à 6 (samedi).');
        corps.day_of_week = j;
      }
      if (args.day_of_month !== undefined) {
        const j = Math.round(Number(args.day_of_month));
        if (!Number.isFinite(j) || j < 1 || j > 28) throw new Error('Le jour du mois va de 1 à 28.');
        corps.day_of_month = j;
      }
      const { ok, status, json } = await appelInterne(ctx, '/scheduled-reports', corps);
      if (!ok) throw refusRoute(status, json, 'La planification du rapport a été refusée.');
      return { created: true, report_id: json?.id ?? null, recipient_email: courriel, frequence: traduireStatut(frequency, LIBELLE_FREQUENCE), note: 'Rapport planifié : il partira par courriel à la fréquence choisie.' };
    }),
};

const updateScheduledReport: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_scheduled_report',
    description: 'Change a scheduled report: recipient, frequency, day, or enable/disable it. Only the fields given are changed.',
    parameters: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'Report id (from list_scheduled_reports).' },
        recipient_email: { type: 'string' },
        frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
        day_of_week: { type: 'integer' },
        day_of_month: { type: 'integer' },
        enabled: { type: 'boolean' },
      },
      required: ['report_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_scheduled_report', args, async () => {
      const id = champRequis(args.report_id, 'Le rapport');
      const maj: Record<string, any> = { updated_at: new Date().toISOString() };
      if (args.recipient_email !== undefined) {
        const courriel = champRequis(args.recipient_email, 'Le destinataire').toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(courriel)) throw new Error('L’adresse courriel du destinataire n’est pas valide.');
        maj.recipient_email = courriel;
      }
      if (args.frequency !== undefined) {
        if (!LIBELLE_FREQUENCE[String(args.frequency)]) throw new Error('La fréquence doit être daily, weekly ou monthly.');
        maj.frequency = String(args.frequency);
      }
      if (args.day_of_week !== undefined) {
        const j = Math.round(Number(args.day_of_week));
        if (!Number.isFinite(j) || j < 0 || j > 6) throw new Error('Le jour de la semaine va de 0 (dimanche) à 6 (samedi).');
        maj.day_of_week = j;
      }
      if (args.day_of_month !== undefined) {
        const j = Math.round(Number(args.day_of_month));
        if (!Number.isFinite(j) || j < 1 || j > 28) throw new Error('Le jour du mois va de 1 à 28.');
        maj.day_of_month = j;
      }
      if (args.enabled !== undefined) maj.enabled = !!args.enabled;
      if (Object.keys(maj).length === 1) throw new Error('Rien à modifier : précise au moins un champ (destinataire, fréquence, jour, actif).');
      const { data, error } = await ctx.client
        .from('scheduled_reports')
        .update(maj)
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .select('id, recipient_email, frequency, enabled');
      if (error) throw error;
      const row = ligneTouchee(data, 'Le rapport planifié');
      return {
        updated: true,
        report_id: row.id,
        recipient_email: row.recipient_email,
        frequence: traduireStatut(row.frequency, LIBELLE_FREQUENCE),
        actif: !!row.enabled,
        note: args.enabled === false ? 'Rapport planifié désactivé : il ne partira plus.' : 'Rapport planifié mis à jour.',
      };
    }),
};

const deleteScheduledReport: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_scheduled_report',
    description: 'Delete a scheduled report (no more automatic emails). Cannot be undone: confirm with the user.',
    parameters: {
      type: 'object',
      properties: { report_id: { type: 'string', description: 'Report id.' } },
      required: ['report_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_scheduled_report', args, async () => {
      const id = champRequis(args.report_id, 'Le rapport');
      const { data, error } = await ctx.client
        .from('scheduled_reports')
        .delete()
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .select('id, recipient_email');
      if (error) throw error;
      const row = ligneTouchee(data, 'Le rapport planifié');
      return { deleted: true, report_id: row.id, recipient_email: row.recipient_email, note: 'Rapport planifié supprimé : plus aucun envoi automatique.' };
    }),
};

const sendScheduledReportNow: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'send_scheduled_report_now',
    description: 'Email a scheduled report right now to its recipient (must be enabled). IT ACTUALLY SENDS: confirm with the user.',
    parameters: {
      type: 'object',
      properties: { report_id: { type: 'string', description: 'Report id.' } },
      required: ['report_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'send_scheduled_report_now', args, async () => {
      const id = idPourChemin(args.report_id, 'Le rapport');
      let res;
      try {
        res = await appelInterne(ctx, `/scheduled-reports/${id}/send-now`, {});
      } catch (e) {
        if (e instanceof AppelInterneIncertain) {
          // Requête partie, réponse jamais revenue : le courriel est PEUT-ÊTRE
          // parti. On renvoie (sans lever) pour garder l'empreinte : une
          // retentative ne doit pas doubler l'envoi.
          return { incertain: true, sent: null, report_id: id, note: 'Je n’ai pas eu la confirmation que le rapport est parti — il a peut-être été envoyé. Vérifie la boîte du destinataire avant de le renvoyer.' };
        }
        throw e;
      }
      const { ok, status, json } = res;
      if (!ok) {
        throw refusRoute(status, json, 'L’envoi du rapport a été refusé.', {
          404: 'Rapport planifié introuvable.',
          500: 'L’envoi n’a pas abouti — le rapport est peut-être désactivé, ou l’envoi de courriels n’est pas configuré.',
        });
      }
      return { sent: true, report_id: id, note: 'Rapport envoyé par courriel à son destinataire.' };
    }),
};

/* ════════════════════════════════════════════════════════════════
   NOTIFICATIONS (la cloche)
   ════════════════════════════════════════════════════════════════ */

const listNotifications: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_notifications',
    description: 'Recent in-app notifications visible to the user (own + org-wide): title, message, when, read or not, link. Use for "what is new", "any alerts".',
    parameters: {
      type: 'object',
      properties: {
        unread_only: { type: 'boolean', description: 'Only unread ones (default false).' },
        limit: { type: 'integer', description: 'Max results (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    let q = ctx.client
      .from('notifications')
      .select('id, type, category, title, message, body, link, created_at, read_at', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .or(`user_id.is.null,user_id.eq.${ctx.userId}`)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(clamp(args.limit, 20, 50));
    if (args.unread_only === true) q = q.is('read_at', null);
    const { data, error, count } = await q;
    if (error) return erreurLecture('notifications', error);
    const rows = data || [];
    const nonLues = rows.filter((n: any) => !n.read_at).length;
    return {
      total_matching: count ?? rows.length,
      shown: rows.length,
      unread_shown: nonLues,
      notifications: rows.map((n: any) => ({
        notification_id: n.id,
        type: n.category || n.type,
        title: n.title || null,
        message: n.message || n.body || null,
        link: n.link || null,
        created_at: n.created_at,
        lue: !!n.read_at,
      })),
      note: rows.length ? (nonLues ? `${nonLues} notification(s) non lue(s) dans cette liste.` : 'Tout est déjà lu.') : 'Aucune notification récente.',
    };
  },
};

const markNotificationsRead: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'mark_notifications_read',
    description: 'Mark notifications as read: specific ids, or ALL of the user unread ones when ids is omitted.',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Notification ids; omit to mark everything read.' } },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'mark_notifications_read', args, async () => {
      const ids = Array.isArray(args.ids) ? args.ids.map(String).filter(Boolean).slice(0, 200) : [];
      const { ok, status, json } = await appelInterne(ctx, '/notifications/read', ids.length ? { ids } : {});
      if (!ok) throw refusRoute(status, json, 'Le marquage des notifications a été refusé.');
      return { marked_read: true, count: ids.length || null, note: ids.length ? `${ids.length} notification(s) marquée(s) comme lue(s).` : 'Toutes tes notifications sont marquées comme lues.' };
    }),
};

const deleteNotification: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_notification',
    description: 'Dismiss one notification (it leaves the bell; only the user own or org-wide notifications).',
    parameters: {
      type: 'object',
      properties: { notification_id: { type: 'string', description: 'Notification id.' } },
      required: ['notification_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_notification', args, async () => {
      const id = champRequis(args.notification_id, 'La notification');
      const { data, error } = await ctx.client
        .from('notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .or(`user_id.is.null,user_id.eq.${ctx.userId}`)
        .select('id');
      if (error) throw error;
      ligneTouchee(data, 'La notification');
      return { dismissed: true, notification_id: id, note: 'Notification écartée.' };
    }),
};

/* ════════════════════════════════════════════════════════════════
   EXPORTS
   ════════════════════════════════════════════════════════════════ */

/*
 * « Il me reste combien ? » — les crédits Lumi du bureau (2026-09-30).
 *
 * EN CRÉDITS SEULEMENT : aucun montant en dollars ne sort, jamais (ni coût
 * réel, ni équivalence). Le bureau vient de la session (ctx.orgId) ; la
 * lecture passe par le client de service parce que les fonctions de crédits
 * ne sont pas ouvertes à `authenticated`.
 */
const getLumiCredits: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_lumi_credits',
    description: 'How many Lumi credits the company has left this period, the monthly total, the percentage used and the renewal date. '
      + 'Answer in Lumi credits only: never convert credits to dollars or mention a cost in dollars.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const e = await etatCredits(getServiceClient(), ctx.orgId);
    if (!e.inclus) return { inclus: false, note: 'Lumi n’est pas inclus dans le forfait de l’entreprise (inclus dans Autopilot).' };
    return {
      inclus: true,
      credits_restants: e.restants,
      credits_inclus: e.total,
      credits_utilises: e.utilises,
      pourcentage_utilise: e.pourcentage,
      renouvellement_le: e.renouvellement_le,
      epuise: e.palier === 'epuise',
      note: 'Crédits non utilisés : pas de report. À l’épuisement, l’assistant avancé se met en pause jusqu’au renouvellement ; le reste de Lume fonctionne.',
    };
  },
};

export const OUTILS_REGLAGES: AgentTool[] = [
  // Crédits Lumi (lecture)
  getLumiCredits,
  // Messages
  markConversationRead,
  // Modèles de courriel
  listEmailTemplates, createEmailTemplate, updateEmailTemplate, setDefaultEmailTemplate, deleteEmailTemplate, duplicateEmailTemplate,
  // Automatisations
  createAutomationFromText, toggleAutomationRule, updateAutomationMessage, updateAutomationSmsBody, setAutomationLanguage,
  // Taxes
  getTaxConfig, setupTaxes, createTaxConfig, updateTaxConfig, deleteTaxConfig, setDefaultTaxGroup,
  // Catalogue
  createService, updateService, archiveService,
  // Objectifs
  listGoals, setGoal, deleteGoal,
  // Rapports planifiés
  listScheduledReports, createScheduledReport, updateScheduledReport, deleteScheduledReport, sendScheduledReportNow,
  // Notifications
  listNotifications, markNotificationsRead, deleteNotification,
];

/**
 * Attributs des ÉCRITURES (même sens que registre.ts) :
 * sensible = touche l'argent (taxes), ce que reçoivent les clients
 * (automatisations) ou un geste irréversible ; reversible = se défait dans
 * l'app ; vers_client = l'effet atteint directement un client (aucun ici :
 * les automatisations ne partent qu'à leur déclenchement, le rapport planifié
 * va à un destinataire interne).
 */
export const REGISTRE_REGLAGES: Record<string, { sensible: boolean; reversible: boolean; vers_client: boolean }> = {
  mark_conversation_read:      { sensible: false, reversible: true,  vers_client: false },
  create_email_template:       { sensible: true,  reversible: true,  vers_client: false }, // ce que les clients recevront (audit 2026-09-30)
  update_email_template:       { sensible: true,  reversible: true,  vers_client: false },
  set_default_email_template:  { sensible: true,  reversible: true,  vers_client: false },
  delete_email_template:       { sensible: true,  reversible: false, vers_client: false },
  duplicate_email_template:    { sensible: false, reversible: true,  vers_client: false },
  // Créée en pause : rien n'atteint un client tant qu'elle n'est pas activée,
  // et elle se supprime dans l'app.
  create_automation_from_text: { sensible: true,  reversible: true,  vers_client: false },
  toggle_automation_rule:      { sensible: true,  reversible: true,  vers_client: false },
  update_automation_message:   { sensible: true,  reversible: true,  vers_client: false },
  update_automation_sms_body:  { sensible: true,  reversible: true,  vers_client: false },
  set_automation_language:     { sensible: true,  reversible: true,  vers_client: false },
  setup_taxes:                 { sensible: true,  reversible: true,  vers_client: false },
  create_tax_config:           { sensible: true,  reversible: true,  vers_client: false },
  update_tax_config:           { sensible: true,  reversible: true,  vers_client: false },
  delete_tax_config:           { sensible: true,  reversible: false, vers_client: false },
  set_default_tax_group:       { sensible: true,  reversible: true,  vers_client: false },
  create_service:              { sensible: false, reversible: true,  vers_client: false },
  update_service:              { sensible: false, reversible: true,  vers_client: false },
  archive_service:             { sensible: false, reversible: true,  vers_client: false },
  set_goal:                    { sensible: false, reversible: true,  vers_client: false },
  delete_goal:                 { sensible: true,  reversible: false, vers_client: false },
  create_scheduled_report:     { sensible: false, reversible: true,  vers_client: false },
  update_scheduled_report:     { sensible: false, reversible: true,  vers_client: false },
  delete_scheduled_report:     { sensible: true,  reversible: false, vers_client: false },
  send_scheduled_report_now:   { sensible: true,  reversible: false, vers_client: false },
  mark_notifications_read:     { sensible: false, reversible: true,  vers_client: false },
  delete_notification:         { sensible: false, reversible: true,  vers_client: false },
};

/** Clé de la page Rôles exigée par chaque outil (même format que PERMISSION_PAR_OUTIL). */
export const PERMISSIONS_REGLAGES: Record<string, { cle: PermissionKey; capacite: string }> = {
  get_lumi_credits:            { cle: 'external_agent.use',     capacite: 'la consultation des crédits Lumi' },
  mark_conversation_read:      { cle: 'messages.read',          capacite: 'la lecture des SMS' },
  list_email_templates:        { cle: 'settings.read',          capacite: 'la consultation des modèles de courriel' },
  create_email_template:       { cle: 'settings.update',        capacite: 'la gestion des modèles de courriel' },
  update_email_template:       { cle: 'settings.update',        capacite: 'la gestion des modèles de courriel' },
  set_default_email_template:  { cle: 'settings.update',        capacite: 'la gestion des modèles de courriel' },
  delete_email_template:       { cle: 'settings.update',        capacite: 'la gestion des modèles de courriel' },
  duplicate_email_template:    { cle: 'settings.update',        capacite: 'la gestion des modèles de courriel' },
  create_automation_from_text: { cle: 'automations.update',     capacite: 'la création des automatisations' },
  toggle_automation_rule:      { cle: 'automations.update',     capacite: 'la modification des automatisations' },
  update_automation_message:   { cle: 'automations.update',     capacite: 'la modification des automatisations' },
  update_automation_sms_body:  { cle: 'automations.update',     capacite: 'la modification des automatisations' },
  set_automation_language:     { cle: 'automations.update',     capacite: 'la langue des automatisations' },
  get_tax_config:              { cle: 'settings.read',          capacite: 'la consultation des taxes' },
  setup_taxes:                 { cle: 'settings.update',        capacite: 'la configuration des taxes' },
  create_tax_config:           { cle: 'settings.update',        capacite: 'la configuration des taxes' },
  update_tax_config:           { cle: 'settings.update',        capacite: 'la configuration des taxes' },
  delete_tax_config:           { cle: 'settings.update',        capacite: 'la configuration des taxes' },
  set_default_tax_group:       { cle: 'settings.update',        capacite: 'la configuration des taxes' },
  create_service:              { cle: 'settings.update',        capacite: 'la gestion du catalogue de services' },
  update_service:              { cle: 'settings.update',        capacite: 'la gestion du catalogue de services' },
  archive_service:             { cle: 'settings.update',        capacite: 'la gestion du catalogue de services' },
  list_goals:                  { cle: 'reports.read',           capacite: 'la consultation des objectifs' },
  set_goal:                    { cle: 'reports.read',           capacite: 'la gestion des objectifs' },
  delete_goal:                 { cle: 'reports.read',           capacite: 'la gestion des objectifs' },
  list_scheduled_reports:      { cle: 'financial.view_reports', capacite: 'les rapports planifiés' },
  create_scheduled_report:     { cle: 'financial.view_reports', capacite: 'les rapports planifiés' },
  update_scheduled_report:     { cle: 'financial.view_reports', capacite: 'les rapports planifiés' },
  delete_scheduled_report:     { cle: 'financial.view_reports', capacite: 'les rapports planifiés' },
  send_scheduled_report_now:   { cle: 'financial.view_reports', capacite: 'l’envoi des rapports planifiés' },
  list_notifications:          { cle: 'settings.read',          capacite: 'la consultation des notifications' },
  mark_notifications_read:     { cle: 'settings.read',          capacite: 'la gestion des notifications' },
  delete_notification:         { cle: 'settings.read',          capacite: 'la gestion des notifications' },
};

/** Topic du routeur pour chaque outil (chaque nom exactement une fois). */
export const TOPICS_REGLAGES: Partial<Record<IdTopic, string[]>> = {
  communications: [
    'mark_conversation_read',
    'list_email_templates', 'create_email_template', 'update_email_template', 'set_default_email_template', 'delete_email_template', 'duplicate_email_template',
  ],
  facturation: [
    'get_lumi_credits',
    'get_tax_config', 'setup_taxes', 'create_tax_config', 'update_tax_config', 'delete_tax_config', 'set_default_tax_group',
    'create_service', 'update_service', 'archive_service',
  ],
  rapports: [
    'create_automation_from_text', 'toggle_automation_rule', 'update_automation_message', 'update_automation_sms_body', 'set_automation_language',
    'list_goals', 'set_goal', 'delete_goal',
    'list_scheduled_reports', 'create_scheduled_report', 'update_scheduled_report', 'delete_scheduled_report', 'send_scheduled_report_now',
    'list_notifications', 'mark_notifications_read', 'delete_notification',
  ],
};
