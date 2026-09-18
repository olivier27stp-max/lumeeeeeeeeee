/**
 * Bot de migration — fait avancer une migration assistée « lorsque demandé ».
 * ─────────────────────────────────────────────────────────────────────
 * Le transfert et la vérification sont déjà déterministes (analyzer, mapping,
 * normalize, duplicates, importer). Ce bot remplace les DÉCISIONS humaines
 * répétitives de la console admin, dans l'ordre de la machine à états :
 *
 *   files_uploaded / parsing → analyser les fichiers en attente → mapping
 *   mapping / human_review / waiting_for_client
 *     1. appliquer les réponses du client aux questions du bot
 *     2. gabarit du même CRM source s'il couvre ≥ 80 % des colonnes (0 modèle)
 *     3. UN appel modèle par fichier pour les colonnes encore « à vérifier » :
 *        confiance ≥ 0,90 → confirmée ; sinon → question au client avec les
 *        candidats (jamais un champ inventé : le catalogue valide)
 *     4. plus rien à vérifier → import test (dry-run) ; sinon → questions
 *        regroupées dans le portail, statut waiting_for_client, arrêt
 *   test_review
 *     5. doublons : même courriel OU même téléphone → fusion ; nom seul →
 *        question au client ; score faible → nouvelle fiche
 *     6. lignes rejetées (orphelines / invalides) → constats pour l'admin
 *     7. 0 erreur bloquante, 0 doublon en attente, 0 question ouverte →
 *        demande d'approbation + message au client ; sinon → questions, arrêt
 *
 * Mode (data_migrations.bot_mode) :
 *   'autonome' (défaut) — le client n'a RIEN à faire : aucune question dans le
 *     portail. Colonne incertaine → conservée dans les notes (rejected, valeurs
 *     gardées par _unmapped) ; doublon sur le nom seul → nouvelle fiche
 *     (fusionnable plus tard) ; ce qui bloque quand même → l'admin Lume est
 *     prévenu (notification), jamais le client. Quand l'import test est propre,
 *     l'admin est prévenu pour approuver au nom du client (route admin
 *     approve-on-behalf — jamais le bot).
 *   'client' — questions regroupées dans le portail, statut waiting_for_client.
 *
 * Jamais : l'approbation (client ou admin) ni l'import final / rollback (admin).
 * Chaque décision : migration_audit_logs, acteur 'assistant', et le rapport
 * de la passe dans data_migrations.bot_dernier_rapport.
 * Le modèle ne reçoit que des en-têtes et des échantillons MASQUÉS
 * (migration_file_columns.samples_masked), jamais une valeur source.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { clientAnthropic } from '../lumi/llm';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { logMigrationAudit, touchMigrationActivity } from './audit';
import { analyzeMigrationFile } from './pipeline';
import { FIELD_CATALOG, entityForCategory, normalizeHeader } from './mapping';
import { REGLES_LUME, semantiquePour } from './connaissances-bot';
import { appliquerGardes, type AlerteBot } from './gardes-bot';
import { canTransition } from './state-machine';
import { lancerImportTest, demanderApprobation, type ActeurMigration } from './execution';
import type { MigrationRow, MigrationCategory, TargetEntity, DryRunReport, FieldDef } from './types';
import { coutEnCents } from '../lumi/tarifs';
import { journaliserTrace } from '../lumi/traces';
import { verifierPlafond, ajouterDepense, compterRefus } from '../lumi/plafond-journalier';
import { logger } from '../logger';
import { platformAdminIds } from '../config';
import { isSlackConfigured, canalSupport, envoyerMessageSlack, echapperSlack } from '../slack';

export const SEUIL_CONFIRMATION = 0.9;
export const SEUIL_GABARIT = 0.8;
export const MAX_PASSES = 6;
export const TYPE_QUESTION_COLONNE = 'bot_colonne';
export const TYPE_QUESTION_DOUBLON = 'bot_doublon';
/** Préfixe de `reason` d'une proposition du moteur que le bot a relue sans oser trancher : relistée dans l'audit, jamais re-soumise au modèle. */
export const PREFIXE_A_VERIFIER = 'bot (à vérifier) : ';
export const OPTION_IGNORER = 'Ignorer cette colonne';
export type ModeBot = 'client' | 'autonome';
/** En mode autonome, l'admin est (re)prévenu au plus une fois par ce délai. */
export const RAPPEL_ADMIN_HEURES = 72;
export const TYPE_NOTIFICATION_ADMIN = 'migration_bot';
/** Le modèle le plus proche de Claude Code (Fable 5.1), puis repli si le compte n'y a pas accès (400/404). Surcharge : LUMI_MODEL_MIGRATION. */
/** Profondeur de raisonnement par fichier (≈ 50 s et 25 ¢ par fichier en « high » sur Fable 5.1). Surcharge : LUMI_EFFORT_MIGRATION. */
const EFFORT_BOT = (['low', 'medium', 'high', 'xhigh', 'max'] as const).find((e) => e === process.env.LUMI_EFFORT_MIGRATION) ?? 'high';
export const MODELES_BOT: string[] = [...new Set([process.env.LUMI_MODEL_MIGRATION || 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5'])];

export interface DecisionBot {
  etape: string;
  cible: string;
  decision: string;
  detail?: string;
}
/** Donnée utile pour laquelle Lume n'a aucun champ : à construire (par Claude Code). */
export interface ManqueBot {
  fichier: string;
  colonne: string;
  entite: string;
  /** Nom de champ proposé (snake_case) ou catégorie à importer. */
  proposition: string;
  /** Ce que l'importeur devrait en faire. */
  besoin: string;
}
export interface CorrectionBot { fichier: string; colonne: string; avant: string | null; apres: string | null; pourquoi: string }
export interface AVerifierBot { fichier: string; colonne: string; actuel: string | null; candidats: string[]; pourquoi: string }
/** Audit d'une passe : ce qui a été corrigé, ce qui reste à un humain, ce qui manque à Lume — et le texte à coller à Claude Code. */
export interface AuditBot {
  fichiers: Array<{ nom: string; entite: string | null; nature: string | null }>;
  corrections: CorrectionBot[];
  alertes: AlerteBot[];
  a_verifier: AVerifierBot[];
  manques: ManqueBot[];
  modele: string | null;
  texte_pour_claude: string;
}
export interface RapportBot {
  migration_id: string;
  declencheur: 'manuel' | 'cron';
  debut: string;
  fin: string;
  statut_avant: string;
  statut_apres: string;
  decisions: DecisionBot[];
  questions_posees: number;
  arret: string;
  cout_cents: number | null;
  audit: AuditBot;
  /** Suivi en direct (la console lit bot_dernier_rapport toutes les 3 s pendant la passe). */
  en_cours?: boolean;
  etape_courante?: string | null;
  progression?: { fichiers_faits: number; fichiers_total: number } | null;
}
export function auditVide(): AuditBot {
  return { fichiers: [], corrections: [], alertes: [], a_verifier: [], manques: [], modele: null, texte_pour_claude: '' };
}

type Admin = SupabaseClient;

// ── Fonctions pures (testées) ─────────────────────────────────────

/** Part des colonnes d'un fichier couvertes par un gabarit (0..1). */
export function couvertureGabarit(headers: string[], headersMap: Record<string, string> | undefined): number {
  if (!headers.length || !headersMap) return 0;
  const n = headers.filter((h) => headersMap[normalizeHeader(h)]).length;
  return n / headers.length;
}

// Tolérant sur la forme (une raison trop longue est coupée, un 4e candidat ignoré),
// strict sur le fond (position, champ, confiance) : un verdict mal formé est jeté
// individuellement, les autres colonnes du fichier ne sont pas perdues.
export const verdictColonneSchema = z.object({
  position: z.number().int().min(0),
  field: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  raison: z.string().optional().default('').transform((s) => s.slice(0, 200)),
  candidats: z.array(z.string()).optional().default([]).transform((a) => a.slice(0, 3)),
  alerte: z.string().nullable().optional().transform((v) => (v ? v.slice(0, 240) : undefined)),
});
export interface VerdictColonne {
  position: number;
  field: string | null;
  confidence: number;
  raison: string;
  candidats: string[];
  /** Pourquoi la correspondance serait dangereuse (garde ou modèle) : la colonne va aux notes. */
  alerte?: string;
}

const manqueSchema = z.object({
  colonne: z.string().min(1).max(120),
  proposition: z.string().min(1).max(80),
  besoin: z.string().min(1).max(400),
});
/** Manques déclarés par le modèle (colonnes utiles sans champ Lume) — forme validée, jamais un champ inventé dans « field ». */
export function validerManques(brut: unknown, fichier: string, entite: string): ManqueBot[] {
  const liste = (brut as any)?.manques;
  if (!Array.isArray(liste)) return [];
  const out: ManqueBot[] = [];
  for (const item of liste.slice(0, 20)) {
    const r = manqueSchema.safeParse(item);
    if (r.success) out.push({ fichier, entite, colonne: r.data.colonne, proposition: r.data.proposition, besoin: r.data.besoin });
  }
  return out;
}

/** Nature du fichier déclarée par le modèle (ex. « rapport d'utilisation, pas un catalogue »), courte. */
export function validerNature(brut: unknown): string | null {
  const n = (brut as any)?.nature_fichier;
  return typeof n === 'string' && n.trim() ? n.trim().slice(0, 200) : null;
}

export type ChoixColonne = 'confirmer' | 'corriger' | 'conserver' | 'demander' | 'laisser';
/**
 * Décision pour UNE colonne à partir du verdict (après gardes) et de l'état
 * actuel de la correspondance :
 *  - alerte sans champ (garde ou modèle) → conserver dans les notes, jamais demandé au client ;
 *  - ≥ 0,90 → confirmer si c'est déjà le champ proposé, sinon corriger ;
 *  - moteur et modèle d'accord (≥ 0,70) sur une colonne « suggested » → confirmer ;
 *  - incertain : « needs_review » → conserver (autonome) ou demander (client) ;
 *    « suggested » → laisser la proposition du moteur, à vérifier par un humain.
 */
export function deciderColonne(p: { statut: string; actuel: string | null; verdict: VerdictColonne; mode: ModeBot }): ChoixColonne {
  const v = p.verdict;
  // Alerte SANS champ = correspondance refusée (garde ou modèle) → notes. Une alerte avec un champ est informative (ex. « en-tête au pluriel ») : la colonne est importée, l'audit la signale.
  if (v.alerte && !v.field) return 'conserver';
  if (v.field && v.confidence >= SEUIL_CONFIRMATION) return v.field === p.actuel ? 'confirmer' : 'corriger';
  if (v.field && v.field === p.actuel && p.statut === 'suggested' && v.confidence >= 0.7) return 'confirmer';
  if (p.statut === 'suggested') return 'laisser';
  return p.mode === 'autonome' ? 'conserver' : 'demander';
}

/** Valide les verdicts du modèle contre le catalogue : un champ inconnu devient null, confiance 0. */
export function validerVerdicts(brut: unknown, champs: FieldDef[]): VerdictColonne[] {
  let liste = (brut as any)?.colonnes;
  // Vu en direct : le modèle renvoie parfois le tableau SÉRIALISÉ en chaîne (« "colonnes": "{\"colonnes\": [...]}" »).
  if (typeof liste === 'string') {
    try { const p = JSON.parse(liste); liste = Array.isArray(p) ? p : p?.colonnes; } catch { return []; }
  }
  if (!Array.isArray(liste)) return [];
  const connus = new Set(champs.map((c) => c.field));
  const out: VerdictColonne[] = [];
  for (const item of liste.slice(0, 200)) {
    const r = verdictColonneSchema.safeParse(item);
    if (!r.success) continue;
    const v = r.data;
    out.push({
      position: v.position,
      field: v.field && connus.has(v.field) ? v.field : null,
      confidence: v.field && connus.has(v.field) ? v.confidence : 0,
      raison: v.raison,
      candidats: v.candidats.filter((c) => connus.has(c)).slice(0, 3),
      ...(v.alerte ? { alerte: v.alerte } : {}),
    });
  }
  return out;
}

/** Mode du bot pour une migration : autonome par défaut (le client n'a rien à faire). */
export function modeBot(m: Pick<MigrationRow, 'bot_mode'>): ModeBot {
  return m.bot_mode === 'client' ? 'client' : 'autonome';
}

/**
 * Règle de doublon : courriel ou téléphone identique → fusion ; nom seul →
 * demander (mode client) ou nouvelle fiche (mode autonome : rien n'est perdu,
 * deux fiches se fusionnent plus tard dans Lume) ; faible → nouvelle fiche.
 */
export function deciderDoublon(d: { score: number; decision: string; match_reasons: string | string[] | null }, mode: ModeBot = 'client'): 'merge' | 'create_new' | 'demander' | null {
  if (d.decision !== 'pending' && d.decision !== 'review') return null;
  const raisons = Array.isArray(d.match_reasons) ? d.match_reasons : String(d.match_reasons ?? '').split(/[,\s]+/).filter(Boolean);
  if (d.decision === 'review' || d.score < 90) return 'create_new';
  if (raisons.some((r) => /email|courriel|phone|tel/i.test(r))) return 'merge';
  return mode === 'autonome' ? 'create_new' : 'demander';
}

/**
 * Décision de mapping à partir d'un verdict validé : confirmer à ≥ 0,90 ;
 * sinon demander au client (mode client) ou conserver la colonne dans les
 * notes (mode autonome : la valeur reste lisible sur la fiche, l'admin peut
 * corriger la correspondance avant l'import).
 */
export function deciderMapping(v: VerdictColonne, mode: ModeBot = 'client'): 'confirmer' | 'demander' | 'conserver' {
  if (v.field && v.confidence >= SEUIL_CONFIRMATION) return 'confirmer';
  return mode === 'autonome' ? 'conserver' : 'demander';
}

/** Constats lisibles à partir des lignes rejetées, par entité et raison. */
export function constatsRejets(compte: Array<{ entity_type: string; status: string; n: number }>): string[] {
  const nomEntite: Record<string, string> = { client: 'clients', property: 'propriétés', service: 'services', quote: 'devis', job: 'jobs', visit: 'visites', invoice: 'factures', payment: 'paiements' };
  const out: string[] = [];
  for (const c of compte) {
    if (c.n <= 0) continue;
    const e = nomEntite[c.entity_type] ?? c.entity_type;
    if (c.status === 'orphan') out.push(`${c.n} ${e} sans client ou job correspondant dans les fichiers (lignes orphelines : elles ne seront pas importées).`);
    else if (c.status === 'error') out.push(`${c.n} ${e} avec une valeur illisible (date, montant ou identifiant) : voir les rejets.`);
  }
  return out;
}

/** Applique une réponse du client à une question de colonne : champ choisi, ignorer, ou rien. */
export function interpreterReponseColonne(reponse: string, candidats: Array<{ field: string; label: string }>): { field: string | null; ignorer: boolean } | null {
  const r = reponse.trim().toLowerCase();
  if (!r) return null;
  if (r.includes('ignorer') || r === 'ignore' || r === 'non') return { field: null, ignorer: true };
  // Correspondance exacte d'abord, puis le libellé le plus long contenu dans la réponse
  // (« Téléphone secondaire » ne doit pas se lire « Téléphone »).
  for (const c of candidats) if (r === c.field.toLowerCase() || r === c.label.toLowerCase()) return { field: c.field, ignorer: false };
  const contenu = [...candidats].sort((a, b) => b.label.length - a.label.length).find((c) => r.includes(c.label.toLowerCase()));
  return contenu ? { field: contenu.field, ignorer: false } : null;
}

// ── Modèle : un appel par fichier ─────────────────────────────────

export interface ColonneModele {
  position: number;
  header: string;
  detected_type: string | null;
  samples: unknown[];
  /** État actuel : « à décider », « proposé : <champ> », « fixé par un humain : <champ> », « ignoré ». */
  etat: string;
  aDecider: boolean;
}

const OUTIL_PROPOSER = 'proposer';

function outilProposer(): Anthropic.Messages.Tool {
  return {
    name: OUTIL_PROPOSER,
    description: 'Les correspondances proposées, une par colonne à décider, plus la nature du fichier et les manques de Lume.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        nature_fichier: { type: 'string', description: 'Une phrase : ce que contient réellement ce fichier (catalogue, rapport d\'utilisation, export de fiches…).' },
        colonnes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              position: { type: 'integer' },
              field: { type: ['string', 'null'], description: 'Un champ du catalogue, ou null pour « ne pas importer ».' },
              confidence: { type: 'number' },
              raison: { type: 'string' },
              candidats: { type: 'array', items: { type: 'string' } },
              alerte: { type: ['string', 'null'], description: 'Pourquoi la correspondance proposée par le moteur serait dangereuse (écrasement, type, TTC…) ; null sinon.' },
            },
            required: ['position', 'field', 'confidence', 'raison', 'candidats', 'alerte'],
            additionalProperties: false,
          },
        },
        manques: {
          type: 'array',
          description: 'Colonnes utiles pour lesquelles Lume n\'a aucun champ.',
          items: {
            type: 'object',
            properties: {
              colonne: { type: 'string' },
              proposition: { type: 'string', description: 'Nom de champ proposé (snake_case) ou catégorie à importer.' },
              besoin: { type: 'string', description: 'Ce que l\'importeur devrait en faire.' },
            },
            required: ['colonne', 'proposition', 'besoin'],
            additionalProperties: false,
          },
        },
      },
      required: ['nature_fichier', 'colonnes', 'manques'],
      additionalProperties: false,
    },
  };
}

export async function proposerMappings(admin: Admin, migration: MigrationRow, p: {
  fileName: string; entity: TargetEntity; sourceCrm: string;
  colonnes: ColonneModele[];
}): Promise<{ verdicts: VerdictColonne[]; manques: ManqueBot[]; nature: string | null; modele: string | null; cost_cents: number | null }> {
  const champs = FIELD_CATALOG[p.entity] ?? [];
  const vide = { verdicts: [] as VerdictColonne[], manques: [] as ManqueBot[], nature: null, modele: null, cost_cents: null };
  if (!process.env.ANTHROPIC_API_KEY || champs.length === 0 || !p.colonnes.some((c) => c.aDecider)) return vide;
  const catalogue = champs.map((c) => `- ${c.field} (${c.labelFr}; types : ${c.types.join('/')})`).join('\n');
  const colonnes = p.colonnes.map((c) => `#${c.position} « ${c.header} » type=${c.detected_type ?? '?'} exemples=${JSON.stringify(c.samples.slice(0, 5))} · ${c.etat}`).join('\n');
  const aDecider = p.colonnes.filter((c) => c.aDecider).map((c) => `#${c.position}`).join(', ');
  const debut = Date.now();
  // Le prompt système est STABLE (cache 1 h) : règles + sémantique de l'entité + catalogue. Rien de variable avant le point de cache.
  const systeme = `Tu es le bot de migration de Lume CRM (entreprises de services au Québec). Tu fais correspondre les colonnes d'un export CSV d'un ancien CRM aux champs de Lume, avec la rigueur d'un développeur qui connaît l'importeur. Les exemples sont MASQUÉS (formes, pas les valeurs).

${REGLES_LUME}

SÉMANTIQUE DE L'ENTITÉ CIBLE (${p.entity})
${semantiquePour(p.entity)}

CATALOGUE (seuls champs permis dans « field ») :
${catalogue}

RÉPONSE : appelle l'outil « ${OUTIL_PROPOSER} » exactement une fois, avec un verdict par colonne « à décider » (les colonnes fixées par un humain sont montrées pour le contexte : ne les redonne pas, mais tiens-en compte pour ne pas viser un champ déjà pris). Une même cible ne va jamais à deux colonnes. Quand la proposition actuelle du moteur est dangereuse, mets field=null et explique dans « alerte ». Déclare les « manques ». Pas de texte hors de l'outil.`;
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: `Fichier « ${p.fileName} » (CRM source : ${p.sourceCrm}). Colonnes à décider : ${aDecider}.\nToutes les colonnes du fichier, dans l'ordre :\n${colonnes}` }];
  let derniereErreur: string | null = null;
  // Plafond journalier d'exploitation : le bot tourne sur cron (10 min, jusqu'à
  // MAX_PASSES par migration) et c'est le canal le plus cher au tour (0,24 $
  // mesuré le 2026-09-17). Sans borne, une migration qui boucle dépense seule.
  if (!verifierPlafond('migration').autorise) {
    compterRefus('migration');
    throw new Error('plafond de dépense journalier atteint (migration) — reprise demain');
  }
  for (const modele of MODELES_BOT) {
    try {
      const res = await clientAnthropic().beta.messages.create({
        model: modele,
        max_tokens: 16000,
        // Refus de sécurité côté serveur → repli automatique sur un autre modèle dans le même appel.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: EFFORT_BOT },
        system: [{ type: 'text', cache_control: { type: 'ephemeral', ttl: '1h' }, text: systeme }],
        tools: [outilProposer() as Anthropic.Beta.Messages.BetaTool],
        tool_choice: { type: 'auto' },
        messages: messages as Anthropic.Beta.Messages.BetaMessageParam[],
      });
      if (res.stop_reason === 'refusal') { derniereErreur = `refus du modèle ${modele}`; continue; }
      const appel = res.content.find((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use' && b.name === OUTIL_PROPOSER);
      const brut = appel?.input ?? null;
      const verdicts = validerVerdicts(brut, champs);
      if (!verdicts.length) logger.warn('[migration-bot] verdicts refusés par le schéma', { migrationId: migration.id, fichier: p.fileName, modele, brut: JSON.stringify(brut).slice(0, 600) });
      const cout = coutEnCents(res.model, res.usage as any);
      ajouterDepense('migration', cout);
      void journaliserTrace(admin, {
        orgId: migration.org_id, userId: null, canal: 'migration', origine: 'api', enonce: `mapping ${p.fileName}`, etage: 6,
        action: 'bot_mapping', params: { fichier: p.fileName, entite: p.entity, colonnes: p.colonnes.length }, outils: [], resultat: verdicts.length ? 'ok' : 'erreur',
        model: res.model, usage: { input_tokens: res.usage.input_tokens, cache_5m: 0, cache_1h: res.usage.cache_creation_input_tokens ?? 0, cache_lu: res.usage.cache_read_input_tokens ?? 0, output_tokens: res.usage.output_tokens },
        costCents: cout, dureeMs: Date.now() - debut,
      });
      return { verdicts, manques: validerManques(brut, p.fileName, p.entity), nature: validerNature(brut), modele: res.model, cost_cents: cout };
    } catch (err: any) {
      derniereErreur = err?.message || String(err);
      const statut = Number(err?.status ?? 0);
      // Modèle non disponible pour ce compte (400 rétention/accès, 404 inconnu) → modèle suivant ; toute autre erreur = arrêt.
      if (statut === 400 || statut === 404) { logger.warn('[migration-bot] modèle indisponible, repli', { modele, statut, error: derniereErreur }); continue; }
      break;
    }
  }
  logger.error('[migration-bot] proposition de mappings ratée', { error: derniereErreur, migrationId: migration.id, fichier: p.fileName });
  return vide;
}

// ── Audit : texte à coller à Claude Code ──────────────────────────

/**
 * Le rapport d'une passe, en markdown prêt à coller dans Claude Code :
 * Claude y lit ce que le bot a fait, ce qu'un humain doit trancher, et ce
 * qui manque à Lume (champs / catégories à construire). Pur, sans PII :
 * seuls des en-têtes de colonnes, des noms de fichiers et des libellés.
 */
export function construireTextePourClaude(r: RapportBot, m: Pick<MigrationRow, 'id' | 'source_crm' | 'org_id'>): string {
  const a = r.audit;
  const L: string[] = [];
  L.push(`# Audit du bot de migration — ${m.source_crm} — migration ${m.id}`);
  L.push(`Passe du ${r.fin.slice(0, 16).replace('T', ' ')} (${r.declencheur}), modèle ${a.modele ?? 'aucun appel'}, statut ${r.statut_avant} → ${r.statut_apres}. Arrêt : ${r.arret || '—'}.`);
  L.push('');
  L.push('## 1. Fichiers');
  if (!a.fichiers.length) L.push('Aucun fichier examiné dans cette passe.');
  for (const f of a.fichiers) L.push(`- ${f.nom} → entité ${f.entite ?? 'aucune'}${f.nature ? ` — ${f.nature}` : ''}`);
  L.push('');
  L.push('## 2. Corrections appliquées par le bot (déjà faites dans Correspondances)');
  if (!a.corrections.length) L.push('Aucune.');
  for (const c of a.corrections) L.push(`- ${c.fichier} · « ${c.colonne} » : ${c.avant ?? 'rien'} → ${c.apres ?? 'ne pas importer'} — ${c.pourquoi}`);
  L.push('');
  L.push('## 3. Alertes des gardes (mises à « ne pas importer », valeur conservée dans les notes)');
  if (!a.alertes.length) L.push('Aucune.');
  for (const al of a.alertes) L.push(`- ${al.fichier} · « ${al.colonne} » : ${al.message} → ${al.action}`);
  L.push('');
  L.push('## 4. À trancher par un humain (laissées telles quelles)');
  if (!a.a_verifier.length) L.push('Rien.');
  for (const v of a.a_verifier) L.push(`- ${v.fichier} · « ${v.colonne} » : actuellement ${v.actuel ?? 'ne pas importer'}${v.candidats.length ? ` ; candidats : ${v.candidats.join(' / ')}` : ''} — ${v.pourquoi}`);
  L.push('');
  L.push('## 5. Manques dans Lume (à construire dans l\'importeur)');
  if (!a.manques.length) L.push('Aucun.');
  for (const mq of a.manques) L.push(`- ${mq.fichier} · « ${mq.colonne} » (entité ${mq.entite}) : proposer « ${mq.proposition} » — ${mq.besoin}`);
  L.push('');
  L.push('## 6. Comment procéder');
  L.push('1. Dans /admin/migrations › Correspondances, vérifier les lignes de la section 4 et confirmer ou corriger.');
  L.push('2. Coller ce texte à Claude Code avec : « applique l\'audit ». Pour chaque manque de la section 5, Claude ajoute le champ au catalogue (server/lib/migration/mapping.ts), la normalisation (normalize.ts), l\'écriture dans buildEntityRow (importer.ts), les synonymes de détection et les tests, puis pousse sur main.');
  L.push('3. Une fois déployé, relancer « Confier au bot » : les nouveaux champs sont proposés automatiquement, puis l\'import test.');
  return L.join('\n');
}

// ── Le bot ────────────────────────────────────────────────────────

async function lireMigration(admin: Admin, id: string): Promise<MigrationRow | null> {
  const { data } = await admin.from('data_migrations').select('*').eq('id', id).is('deleted_at', null).maybeSingle<MigrationRow>();
  return data ?? null;
}

/**
 * Suivi en direct : le rapport partiel est écrit dans data_migrations.bot_dernier_rapport
 * (au plus une fois par 1,5 s, sauf `force`), la console l'affiche pendant la passe.
 * Ne lève jamais ; bot_derniere_execution n'est posé qu'à la fin (attendreFinBot).
 */
const dernierePublication = new Map<string, number>();
async function publierProgression(admin: Admin, rapport: RapportBot, etape: string | null, force = false): Promise<void> {
  if (etape !== null) rapport.etape_courante = etape;
  const t = Date.now();
  if (!force && t - (dernierePublication.get(rapport.migration_id) ?? 0) < 1500) return;
  dernierePublication.set(rapport.migration_id, t);
  const { error } = await admin.from('data_migrations').update({ bot_dernier_rapport: { ...rapport, en_cours: true } as unknown as Record<string, unknown> }).eq('id', rapport.migration_id);
  if (error) logger.error('[migration-bot] progression non publiée', { error: error.message, migrationId: rapport.migration_id });
}

async function poserStatut(admin: Admin, m: MigrationRow, to: string, rapport: RapportBot): Promise<boolean> {
  if (m.status === to) return true;
  if (!canTransition(m.status, to as any)) return false;
  const { error } = await admin.from('data_migrations').update({ status: to }).eq('id', m.id).eq('status', m.status);
  if (error) return false;
  rapport.decisions.push({ etape: 'statut', cible: m.id, decision: `${m.status} → ${to}` });
  m.status = to as any;
  return true;
}

async function messagePortail(admin: Admin, m: MigrationRow, acteur: ActeurMigration, body: string): Promise<void> {
  const author = acteur.id ?? m.assigned_admin ?? m.created_by;
  if (!author) return;
  const { error } = await admin.from('migration_messages').insert({ migration_id: m.id, author_id: author, author_kind: 'assistant', body });
  if (error) logger.error('[migration-bot] message portail non envoyé', { error: error.message, migrationId: m.id });
}

async function audit(admin: Admin, m: MigrationRow, acteur: ActeurMigration, action: string, target: string | null, meta: Record<string, unknown>, rapport: RapportBot, decision: DecisionBot): Promise<void> {
  rapport.decisions.push(decision);
  await logMigrationAudit(admin, { migrationId: m.id, action, actorId: acteur.id, actorRole: 'assistant', target, meta });
  await publierProgression(admin, rapport, null);
}

/** Étape 1 : réponses du client aux questions du bot (colonnes, doublons). */
async function appliquerReponses(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot): Promise<number> {
  const { data: issues } = await admin
    .from('migration_issues')
    .select('id, type, details_masked, client_answer, options')
    .eq('migration_id', m.id).in('type', [TYPE_QUESTION_COLONNE, TYPE_QUESTION_DOUBLON])
    .not('client_answer', 'is', null).is('resolved_at', null);
  let n = 0;
  for (const iss of issues ?? []) {
    const d = (iss.details_masked ?? {}) as Record<string, any>;
    if (iss.type === TYPE_QUESTION_COLONNE && d.mapping_id) {
      const candidats: Array<{ field: string; label: string }> = Array.isArray(d.candidats) ? d.candidats : [];
      const r = interpreterReponseColonne(String(iss.client_answer), candidats);
      if (!r) continue;
      await admin.from('migration_field_mappings')
        .update({ status: r.ignorer ? 'rejected' : 'corrected', target_field: r.field, decided_by: null, decided_role: 'client', decided_at: new Date().toISOString() })
        .eq('id', d.mapping_id).eq('migration_id', m.id);
      await admin.from('migration_issues').update({ resolution: r.ignorer ? 'colonne ignorée (réponse client)' : `champ ${r.field} (réponse client)`, resolved_at: new Date().toISOString() }).eq('id', iss.id);
      await audit(admin, m, acteur, 'bot.reponse.colonne', `mapping:${d.mapping_id}`, { field: r.field, ignorer: r.ignorer }, rapport, { etape: 'réponses', cible: `colonne ${d.header ?? ''}`, decision: r.ignorer ? 'ignorée' : `→ ${r.field}` });
      n += 1;
    } else if (iss.type === TYPE_QUESTION_DOUBLON && d.dup_id) {
      const a = String(iss.client_answer).toLowerCase();
      const decision = /fusion|même|meme|same|merge/.test(a) ? 'merge' : /diff|créer|creer|nouveau|new/.test(a) ? 'create_new' : null;
      if (!decision) continue;
      await admin.from('migration_duplicate_candidates').update({ decision, decided_by: null, decided_at: new Date().toISOString() }).eq('id', d.dup_id).eq('migration_id', m.id);
      await admin.from('migration_issues').update({ resolution: `${decision} (réponse client)`, resolved_at: new Date().toISOString() }).eq('id', iss.id);
      await audit(admin, m, acteur, 'bot.reponse.doublon', `duplicate:${d.dup_id}`, { decision }, rapport, { etape: 'réponses', cible: 'doublon', decision });
      n += 1;
    }
  }
  return n;
}

/** Étape 2 : gabarit du même CRM source. */
async function appliquerGabarits(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot): Promise<number> {
  const { data: gabarits } = await admin.from('migration_mapping_templates').select('id, name, headers_map').eq('source_crm', m.source_crm);
  if (!gabarits?.length) return 0;
  const { data: files } = await admin.from('migration_files').select('id, original_name, category_detected').eq('migration_id', m.id).eq('kind', 'data').is('deleted_at', null).eq('parse_status', 'parsed');
  let applique = 0;
  for (const f of files ?? []) {
    const { data: cols } = await admin.from('migration_file_columns').select('id, header').eq('file_id', f.id);
    const { data: maps } = await admin.from('migration_field_mappings').select('id, column_id, status').eq('file_id', f.id).eq('status', 'needs_review');
    if (!cols?.length || !maps?.length) continue;
    const cat = f.category_detected as MigrationCategory | null;
    if (!cat) continue;
    let meilleur: { id: string; name: string; map: Record<string, string>; couverture: number } | null = null;
    for (const g of gabarits) {
      const map = (g.headers_map as Record<string, Record<string, string>> | null)?.[cat];
      const c = couvertureGabarit(cols.map((x) => x.header), map);
      if (c >= SEUIL_GABARIT && (!meilleur || c > meilleur.couverture)) meilleur = { id: g.id, name: g.name, map: map!, couverture: c };
    }
    if (!meilleur) continue;
    const entity = entityForCategory(cat);
    for (const mp of maps) {
      const col = cols.find((c) => c.id === mp.column_id);
      const field = col ? meilleur.map[normalizeHeader(col.header)] : undefined;
      if (!field) continue;
      await admin.from('migration_field_mappings').update({ target_entity: entity, target_field: field, status: 'confirmed', confidence: 100, reason: `gabarit ${meilleur.name}`, decided_by: null, decided_role: 'template', decided_at: new Date().toISOString() }).eq('id', mp.id);
      applique += 1;
    }
    await audit(admin, m, acteur, 'bot.gabarit', `file:${f.id}`, { template_id: meilleur.id, couverture: meilleur.couverture, applique }, rapport, { etape: 'gabarit', cible: f.original_name, decision: `gabarit « ${meilleur.name} » (${Math.round(meilleur.couverture * 100)} % des colonnes)` });
  }
  return applique;
}

/**
 * Étape 3 : un appel modèle par fichier, sur TOUTES les colonnes non tranchées
 * par un humain (« suggested » comme « needs_review ») — le moteur se trompe
 * aussi à 85 %. Le modèle voit le fichier entier (colonnes fixées incluses)
 * pour repérer les doublons de cible ; les gardes tranchent ce qui est
 * toujours faux ; l'audit garde la trace de chaque changement.
 */
async function proposerParModele(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot, mode: ModeBot): Promise<{ confirmees: number; questions: number; conservees: number; changements: number }> {
  const { data: files } = await admin.from('migration_files').select('id, original_name, category_detected').eq('migration_id', m.id).eq('kind', 'data').is('deleted_at', null).eq('parse_status', 'parsed');
  let confirmees = 0, questions = 0, conservees = 0, changements = 0; // changements = ce qui modifie le résultat d'un import (corrections, colonnes retirées, colonnes « à vérifier » enfin tranchées)
  const { data: ouvertes } = await admin.from('migration_issues').select('details_masked').eq('migration_id', m.id).eq('type', TYPE_QUESTION_COLONNE).is('resolved_at', null);
  const dejaDemandes = new Set((ouvertes ?? []).map((i: any) => String(i.details_masked?.mapping_id ?? '')));
  const total = (files ?? []).length;
  rapport.progression = { fichiers_faits: 0, fichiers_total: total };
  for (const [index, f] of (files ?? []).entries()) {
    rapport.progression = { fichiers_faits: index, fichiers_total: total };
    await publierProgression(admin, rapport, `Correspondances : lecture de « ${f.original_name} » (${index + 1}/${total})`, true);
    const cat = f.category_detected as MigrationCategory | null;
    const entity = entityForCategory(cat);
    const { data: maps } = await admin.from('migration_field_mappings').select('id, column_id, status, confidence, target_field, decided_role, reason').eq('file_id', f.id);
    const { data: cols } = await admin.from('migration_file_columns').select('id, position, header, detected_type, samples_masked').eq('file_id', f.id).order('position', { ascending: true });
    if (!entity) {
      // Catégorie sans entité cible (lignes, paiements, notes…) : rien à mapper, mais un manque à déclarer.
      rapport.audit.fichiers.push({ nom: f.original_name, entite: null, nature: 'catégorie non importée en v1' });
      rapport.audit.manques.push({ fichier: f.original_name, colonne: '(fichier entier)', entite: cat ?? 'inconnue', proposition: `import de la catégorie « ${cat ?? '?'} »`, besoin: 'Ce fichier est classé mais aucune entité Lume ne le reçoit : à construire dans l\'importeur (IMPORT_ORDER + TABLE_BY_ENTITY + buildEntityRow).' });
      continue;
    }
    const champs = FIELD_CATALOG[entity] ?? [];
    const libelle = (field: string | null | undefined) => (field ? champs.find((c) => c.field === field)?.labelFr ?? field : null);
    const dejaRelues = (maps ?? []).filter((mp) => mp.status === 'suggested' && String(mp.reason ?? '').startsWith(PREFIXE_A_VERIFIER));
    for (const mp of dejaRelues) {
      const col: any = cols?.find((c: any) => c.id === mp.column_id);
      if (col) rapport.audit.a_verifier.push({ fichier: f.original_name, colonne: col.header, actuel: libelle(mp.target_field as string | null), candidats: [], pourquoi: String(mp.reason).slice(PREFIXE_A_VERIFIER.length) });
    }
    const aTraiter = (maps ?? []).filter((mp) => (mp.status === 'needs_review' || mp.status === 'suggested') && !dejaDemandes.has(mp.id) && !dejaRelues.includes(mp));
    if (!aTraiter.length || !cols?.length) continue;
    const mapParCol = new Map((maps ?? []).map((mp) => [mp.column_id, mp]));
    const colonnes: ColonneModele[] = cols.map((c: any) => {
      const mp = mapParCol.get(c.id);
      const decider = !!mp && aTraiter.some((x) => x.id === mp.id);
      const etat = !mp ? 'ignoré' : decider
        ? (mp.target_field ? `à décider (le moteur propose : ${mp.target_field}, ${mp.confidence} %)` : 'à décider (le moteur ne propose rien)')
        : mp.status === 'rejected' ? 'fixé : ne pas importer' : `fixé par un humain : ${mp.target_field ?? '—'}`;
      return { position: c.position, header: c.header, detected_type: c.detected_type, samples: Array.isArray(c.samples_masked) ? c.samples_masked : [], etat, aDecider: decider };
    });
    const fixes = cols.flatMap((c: any) => {
      const mp = mapParCol.get(c.id);
      return mp && mp.target_field && (mp.status === 'confirmed' || mp.status === 'corrected') ? [{ position: c.position as number, field: mp.target_field as string }] : [];
    });
    await publierProgression(admin, rapport, `Correspondances : « ${f.original_name} » (${index + 1}/${total}) — ${colonnes.filter((c) => c.aDecider).length} colonne(s) soumises au modèle, réponse en cours (≈ 1 min)`, true);
    const { verdicts: bruts, manques, nature, modele, cost_cents } = await proposerMappings(admin, m, { fileName: f.original_name, entity, sourceCrm: m.source_crm, colonnes });
    await publierProgression(admin, rapport, `Correspondances : « ${f.original_name} » (${index + 1}/${total}) — verdicts reçus, application des gardes et des décisions`, true);
    if (cost_cents !== null) rapport.cout_cents = (rapport.cout_cents ?? 0) + cost_cents;
    if (modele) rapport.audit.modele = modele;
    const gardes = appliquerGardes({ fichier: f.original_name, entity, colonnes, verdicts: bruts, champs, fixes });
    const { alertes, nature: natureGarde } = gardes;
    const verdicts: VerdictColonne[] = gardes.verdicts.map((v) => ({ position: v.position, field: v.field, confidence: v.confidence, raison: v.raison ?? '', candidats: v.candidats ?? [], ...(v.alerte ? { alerte: v.alerte } : {}) }));
    rapport.audit.fichiers.push({ nom: f.original_name, entite: entity, nature: natureGarde ?? nature });
    rapport.audit.alertes.push(...alertes);
    rapport.audit.manques.push(...manques);
    for (const v of verdicts) {
      const col: any = cols.find((c: any) => c.position === v.position);
      const mp = col ? aTraiter.find((x) => x.column_id === col.id) : null;
      if (!col || !mp) continue;
      const actuel = (mp.target_field as string | null) ?? null;
      const choix = deciderColonne({ statut: mp.status, actuel, verdict: v, mode });
      const cible = `${f.original_name} · ${col.header}`;
      if (choix === 'confirmer' || choix === 'corriger') {
        await admin.from('migration_field_mappings').update({ target_entity: entity, target_field: v.field, status: choix === 'corriger' ? 'corrected' : 'confirmed', confidence: Math.round(v.confidence * 100), reason: `bot : ${v.raison}`.slice(0, 200), decided_by: null, decided_role: 'assistant', decided_at: new Date().toISOString() }).eq('id', mp.id);
        await audit(admin, m, acteur, choix === 'corriger' ? 'bot.mapping.corrige' : 'bot.mapping.confirme', `mapping:${mp.id}`, { field: v.field, avant: actuel, confidence: v.confidence }, rapport, { etape: 'correspondances', cible, decision: `${choix === 'corriger' ? `${libelle(actuel) ?? '—'} → ` : '→ '}${libelle(v.field)} (${Math.round(v.confidence * 100)} %)`, detail: v.raison });
        if (choix === 'corriger') rapport.audit.corrections.push({ fichier: f.original_name, colonne: col.header, avant: libelle(actuel), apres: libelle(v.field), pourquoi: v.alerte ?? v.raison });
        else if (v.alerte) rapport.audit.alertes.push({ fichier: f.original_name, colonne: col.header, message: v.alerte, action: `importée vers « ${libelle(v.field)} » quand même : à surveiller au dry-run` });
        if (choix === 'corriger' || mp.status === 'needs_review') changements += 1;
        confirmees += 1;
        continue;
      }
      const candidats = [...(v.field ? [v.field] : []), ...v.candidats].filter((x, i, a) => a.indexOf(x) === i).slice(0, 3)
        .map((field) => ({ field, label: libelle(field) ?? field }));
      if (choix === 'laisser') {
        const pourquoi = v.raison || 'le modèle n\'est pas assez sûr pour trancher';
        // Marquée relue : relistée à chaque audit sans nouvel appel modèle ; la proposition du moteur reste active.
        await admin.from('migration_field_mappings').update({ reason: `${PREFIXE_A_VERIFIER}${pourquoi}`.slice(0, 200) }).eq('id', mp.id);
        rapport.audit.a_verifier.push({ fichier: f.original_name, colonne: col.header, actuel: libelle(actuel), candidats: candidats.map((c) => c.label), pourquoi });
        continue;
      }
      if (choix === 'conserver') {
        const pourquoi = v.alerte ?? v.raison;
        await conserverColonne(admin, m, acteur, rapport, { mappingId: mp.id, columnId: col.id, header: col.header, fichier: f.original_name, candidats, exemples: (col.samples_masked ?? []).slice(0, 3), raison: pourquoi, confidence: v.confidence });
        if (actuel) rapport.audit.corrections.push({ fichier: f.original_name, colonne: col.header, avant: libelle(actuel), apres: null, pourquoi });
        if (actuel || mp.status === 'needs_review') changements += 1;
        conservees += 1;
        continue;
      }
      const options = [...candidats.map((c) => c.label), OPTION_IGNORER];
      const { data: issue } = await admin.from('migration_issues').insert({
        migration_id: m.id, type: TYPE_QUESTION_COLONNE, severity: 'warning', column_id: col.id, client_visible: true,
        title: `Que contient la colonne « ${col.header} » du fichier ${f.original_name} ?`,
        details_masked: { mapping_id: mp.id, column_id: col.id, header: col.header, candidats, exemples: (col.samples_masked ?? []).slice(0, 3) },
        options,
      }).select('id').single();
      await audit(admin, m, acteur, 'bot.mapping.question', `mapping:${mp.id}`, { candidats: candidats.map((c) => c.field), confidence: v.confidence }, rapport, { etape: 'correspondances', cible, decision: 'question au client', detail: candidats.map((c) => c.label).join(' / ') || 'aucun candidat' });
      if (issue) questions += 1;
    }
  }
  rapport.progression = { fichiers_faits: total, fichiers_total: total };
  return { confirmees, questions, conservees, changements };
}

/**
 * Mode autonome : une colonne incertaine n'est pas demandée au client, elle est
 * conservée dans les notes de la fiche (mapping `rejected` → `_unmapped` → bloc
 * « Champs non importés (ancien CRM) »). Rien n'est perdu ; l'admin voit le
 * constat et peut corriger la correspondance avant l'import final.
 */
async function conserverColonne(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot, c: { mappingId: string; columnId: string | null; header: string; fichier: string; candidats: Array<{ field: string; label: string }>; exemples: unknown[]; raison: string; confidence: number }): Promise<void> {
  const maintenant = new Date().toISOString();
  await admin.from('migration_field_mappings')
    .update({ target_field: null, status: 'rejected', confidence: Math.round(Math.max(0, Math.min(1, c.confidence)) * 100), reason: `bot autonome : conservée dans les notes (${c.raison})`.slice(0, 200), decided_by: null, decided_role: 'assistant', decided_at: maintenant })
    .eq('id', c.mappingId).eq('migration_id', m.id);
  await admin.from('migration_issues').insert({
    migration_id: m.id, type: TYPE_QUESTION_COLONNE, severity: 'info', column_id: c.columnId, client_visible: false,
    title: `Colonne « ${c.header} » du fichier ${c.fichier} conservée dans les notes (mode autonome)${c.candidats.length ? ` — candidats : ${c.candidats.map((x) => x.label).join(' / ')}` : ''}.`,
    details_masked: { mapping_id: c.mappingId, column_id: c.columnId, header: c.header, candidats: c.candidats, exemples: c.exemples, mode: 'autonome' },
    options: [], resolved_at: maintenant, resolution: 'conservée dans les notes (mode autonome)',
  });
  await audit(admin, m, acteur, 'bot.mapping.conserve', `mapping:${c.mappingId}`, { candidats: c.candidats.map((x) => x.field), confidence: c.confidence }, rapport, { etape: 'correspondances', cible: `${c.fichier} · ${c.header}`, decision: 'conservée dans les notes (mode autonome)', detail: c.candidats.map((x) => x.label).join(' / ') || 'aucun candidat' });
}

/**
 * Mode autonome : les questions encore ouvertes au client (posées en mode
 * client, ou avant la bascule) reçoivent le défaut sûr — colonne → notes,
 * doublon → nouvelle fiche — et sortent du portail. Les réponses déjà données
 * ont été appliquées avant (appliquerReponses).
 */
async function resoudreQuestionsAutonome(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot): Promise<number> {
  const { data: issues } = await admin.from('migration_issues').select('id, type, details_masked')
    .eq('migration_id', m.id).in('type', [TYPE_QUESTION_COLONNE, TYPE_QUESTION_DOUBLON]).eq('client_visible', true).is('client_answer', null).is('resolved_at', null);
  let n = 0;
  for (const iss of issues ?? []) {
    const d = (iss.details_masked ?? {}) as Record<string, any>;
    const maintenant = new Date().toISOString();
    if (iss.type === TYPE_QUESTION_COLONNE && d.mapping_id) {
      await admin.from('migration_field_mappings')
        .update({ target_field: null, status: 'rejected', reason: 'bot autonome : conservée dans les notes (question sans réponse)', decided_by: null, decided_role: 'assistant', decided_at: maintenant })
        .eq('id', d.mapping_id).eq('migration_id', m.id);
      await admin.from('migration_issues').update({ client_visible: false, resolved_at: maintenant, resolution: 'conservée dans les notes (mode autonome, sans réponse du client)' }).eq('id', iss.id);
      await audit(admin, m, acteur, 'bot.question.autonome', `mapping:${d.mapping_id}`, { defaut: 'notes' }, rapport, { etape: 'réponses', cible: `colonne ${d.header ?? ''}`, decision: 'conservée dans les notes (mode autonome)' });
      n += 1;
    } else if (iss.type === TYPE_QUESTION_DOUBLON && d.dup_id) {
      await admin.from('migration_duplicate_candidates').update({ decision: 'create_new', decided_by: null, decided_at: maintenant }).eq('id', d.dup_id).eq('migration_id', m.id);
      await admin.from('migration_issues').update({ client_visible: false, resolved_at: maintenant, resolution: 'nouvelle fiche (mode autonome, sans réponse du client)' }).eq('id', iss.id);
      await audit(admin, m, acteur, 'bot.question.autonome', `duplicate:${d.dup_id}`, { defaut: 'create_new' }, rapport, { etape: 'réponses', cible: 'doublon', decision: 'nouvelle fiche (mode autonome)' });
      n += 1;
    }
  }
  return n;
}

/**
 * Mode autonome : prévenir l'admin Lume (jamais le client) — notification dans
 * SON workspace (les notifications se lisent par org), au plus une par
 * (migration, motif) par RAPPEL_ADMIN_HEURES. Ne lève jamais.
 */
async function alerterAdmin(admin: Admin, m: MigrationRow, acteur: ActeurMigration, motif: 'approbation' | 'bloque', detail: string, rapport: RapportBot): Promise<number> {
  const cibles = new Set<string>([...platformAdminIds, ...(m.assigned_admin ? [m.assigned_admin] : [])]);
  const lien = `/creator-space/migrations#${m.id}`;
  const depuis = new Date(Date.now() - RAPPEL_ADMIN_HEURES * 3600 * 1000).toISOString();
  const titre = motif === 'approbation' ? 'Migration prête : approbation au nom du client' : 'Migration bloquée : le bot a besoin de vous';
  let envoyees = 0;
  try {
    // Le même canal que le support humain (Slack) : une alerte par (migration, motif) par délai de rappel, l'audit fait foi.
    if (isSlackConfigured()) {
      const { data: dejaSlack } = await admin.from('migration_audit_logs').select('id').eq('migration_id', m.id).eq('action', 'bot.admin.alerte').eq('meta->>motif', motif).gte('created_at', depuis).limit(1).maybeSingle();
      if (!dejaSlack) {
        await envoyerMessageSlack({ channel: canalSupport(), text: `🤖 *${echapperSlack(titre)}*\n${echapperSlack(detail)}\nConsole : ${lien}` });
        envoyees += 1;
      }
    }
    for (const userId of cibles) {
      const { data: deja } = await admin.from('notifications').select('id').eq('user_id', userId).eq('type', TYPE_NOTIFICATION_ADMIN).eq('link', lien).eq('icon', motif).gte('created_at', depuis).limit(1).maybeSingle();
      if (deja) continue;
      const { data: membre } = await admin.from('memberships').select('org_id').eq('user_id', userId).eq('status', 'active').order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!membre?.org_id) continue;
      const { error } = await admin.from('notifications').insert({ org_id: membre.org_id, user_id: userId, type: TYPE_NOTIFICATION_ADMIN, category: 'migration', title: titre, body: detail.length > 180 ? `${detail.slice(0, 177)}…` : detail, link: lien, icon: motif });
      if (error) throw error;
      envoyees += 1;
    }
    if (envoyees) await audit(admin, m, acteur, 'bot.admin.alerte', null, { motif, destinataires: envoyees }, rapport, { etape: 'admin', cible: 'notification', decision: `${envoyees} admin prévenu${envoyees > 1 ? 's' : ''} (${motif})`, detail });
  } catch (err: any) {
    logger.error('[migration-bot] alerte admin non envoyée', { error: err?.message || String(err), migrationId: m.id, motif });
  }
  return envoyees;
}

/** Étape 5 : doublons. */
async function traiterDoublons(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot, mode: ModeBot): Promise<{ decides: number; questions: number }> {
  const { data: dups } = await admin.from('migration_duplicate_candidates').select('id, staging_record_id, score, decision, match_reasons').eq('migration_id', m.id).in('decision', ['pending', 'review']);
  let decides = 0, questions = 0;
  const { data: ouvertes } = await admin.from('migration_issues').select('details_masked').eq('migration_id', m.id).eq('type', TYPE_QUESTION_DOUBLON).is('resolved_at', null);
  const dejaDemandes = new Set((ouvertes ?? []).map((i: any) => String(i.details_masked?.dup_id ?? '')));
  for (const d of dups ?? []) {
    const decision = deciderDoublon(d as any, mode);
    if (!decision) continue;
    if (decision === 'demander') {
      if (dejaDemandes.has(d.id)) continue;
      await admin.from('migration_issues').insert({
        migration_id: m.id, type: TYPE_QUESTION_DOUBLON, severity: 'warning', client_visible: true, staging_record_id: d.staging_record_id,
        title: 'Une fiche importée ressemble à un client déjà dans Lume (même nom). Est-ce la même personne ?',
        details_masked: { dup_id: d.id, score: d.score, raisons: d.match_reasons }, options: ['Même client — fusionner', 'Client différent — créer'],
      });
      await audit(admin, m, acteur, 'bot.doublon.question', `duplicate:${d.id}`, { score: d.score }, rapport, { etape: 'doublons', cible: `doublon ${d.score} %`, decision: 'question au client' });
      questions += 1;
      continue;
    }
    await admin.from('migration_duplicate_candidates').update({ decision, decided_by: null, decided_at: new Date().toISOString() }).eq('id', d.id);
    await audit(admin, m, acteur, 'bot.doublon.decide', `duplicate:${d.id}`, { decision, score: d.score, raisons: d.match_reasons }, rapport, { etape: 'doublons', cible: `doublon ${d.score} %`, decision: decision === 'merge' ? 'fusion (courriel ou téléphone identique)' : d.score >= 90 && d.decision === 'pending' ? 'nouvelle fiche (même nom seulement — fusionnable plus tard, mode autonome)' : 'nouvelle fiche (ressemblance faible)' });
    decides += 1;
  }
  return { decides, questions };
}

/** Étape 6 : constats sur les lignes rejetées (pour l'admin, pas le client). */
async function constaterRejets(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot): Promise<void> {
  const { data: rows } = await admin.from('migration_staging_records').select('entity_type, status').eq('migration_id', m.id).in('status', ['orphan', 'error']).limit(20000);
  const compte = new Map<string, number>();
  for (const r of rows ?? []) compte.set(`${r.entity_type}|${r.status}`, (compte.get(`${r.entity_type}|${r.status}`) ?? 0) + 1);
  const constats = constatsRejets([...compte.entries()].map(([k, n]) => { const [entity_type, status] = k.split('|'); return { entity_type, status, n }; }));
  for (const titre of constats) {
    const { data: existe } = await admin.from('migration_issues').select('id').eq('migration_id', m.id).eq('type', 'bot_constat').eq('title', titre).is('resolved_at', null).limit(1).maybeSingle();
    if (existe) continue;
    await admin.from('migration_issues').insert({ migration_id: m.id, type: 'bot_constat', severity: 'warning', client_visible: false, title: titre });
    await audit(admin, m, acteur, 'bot.constat', null, { titre }, rapport, { etape: 'rejets', cible: 'lignes', decision: titre });
  }
}

async function questionsOuvertes(admin: Admin, m: MigrationRow): Promise<Array<{ id: string; title: string; options: string[] }>> {
  const { data } = await admin.from('migration_issues').select('id, title, options').eq('migration_id', m.id).eq('client_visible', true).is('client_answer', null).is('resolved_at', null);
  return (data ?? []).map((i: any) => ({ id: i.id, title: i.title, options: Array.isArray(i.options) ? i.options : [] }));
}

async function envoyerQuestions(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot): Promise<number> {
  const qs = await questionsOuvertes(admin, m);
  if (!qs.length) return 0;
  // Un seul message par ensemble de questions : on compare avec le dernier envoi.
  const cle = qs.map((q) => q.id).sort().join(',');
  const { data: dernier } = await admin.from('migration_audit_logs').select('meta').eq('migration_id', m.id).eq('action', 'bot.questions.envoyees').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if ((dernier as any)?.meta?.cle === cle) return qs.length;
  const lignes = qs.slice(0, 15).map((q, i) => `${i + 1}. ${q.title}${q.options.length ? ` (${q.options.join(' / ')})` : ''}`);
  const body = `Bonjour ! J'ai avancé votre migration. Il me reste ${qs.length} question${qs.length > 1 ? 's' : ''} pour finir sans rien perdre — vous pouvez répondre directement dans la section « Questions » :\n${lignes.join('\n')}${qs.length > 15 ? `\n… et ${qs.length - 15} autres.` : ''}`;
  await messagePortail(admin, m, acteur, body);
  await logMigrationAudit(admin, { migrationId: m.id, action: 'bot.questions.envoyees', actorId: acteur.id, actorRole: 'assistant', meta: { cle, n: qs.length } });
  rapport.decisions.push({ etape: 'client', cible: 'portail', decision: `${qs.length} question${qs.length > 1 ? 's' : ''} envoyée${qs.length > 1 ? 's' : ''}` });
  return qs.length;
}

/** Une passe complète, bornée. Ne lève jamais : le rapport porte l'arrêt. */
export async function executerBotMigration(admin: Admin, migrationId: string, opts: { acteurId: string | null; declencheur: 'manuel' | 'cron' }): Promise<RapportBot> {
  const acteur: ActeurMigration = { id: opts.acteurId, role: 'assistant' };
  const debut = new Date().toISOString();
  const m0 = await lireMigration(admin, migrationId);
  const rapport: RapportBot = { migration_id: migrationId, declencheur: opts.declencheur, debut, fin: debut, statut_avant: m0?.status ?? 'inconnue', statut_apres: m0?.status ?? 'inconnue', decisions: [], questions_posees: 0, arret: '', cout_cents: null, audit: auditVide() };
  if (!m0) { rapport.arret = 'migration introuvable'; rapport.fin = new Date().toISOString(); return rapport; }
  const m = m0;
  const mode = modeBot(m);
  await publierProgression(admin, rapport, `Démarrage de la passe (statut ${m.status}, mode ${mode})`, true);
  // Doublons tranchés depuis le dernier dry-run : un import test frais s'impose avant d'approuver, une seule fois.
  let doublonsDepuisTest = 0;
  try {
    for (let passe = 0; passe < MAX_PASSES; passe++) {
      const s = m.status;
      if (s === 'files_uploaded' || s === 'parsing') {
        const { data: files } = await admin.from('migration_files').select('id, parse_status').eq('migration_id', m.id).eq('kind', 'data').is('deleted_at', null).neq('security_status', 'rejected');
        const aAnalyser = (files ?? []).filter((f) => f.parse_status === 'pending' || f.parse_status === 'failed');
        if (aAnalyser.length) {
          await publierProgression(admin, rapport, `Analyse de ${aAnalyser.length} fichier(s)`, true);
          await poserStatut(admin, m, 'parsing', rapport);
          for (const f of aAnalyser) await analyzeMigrationFile(admin, m, f.id);
          await audit(admin, m, acteur, 'bot.analyse', null, { fichiers: aAnalyser.length }, rapport, { etape: 'analyse', cible: 'fichiers', decision: `${aAnalyser.length} fichier${aAnalyser.length > 1 ? 's' : ''} analysé${aAnalyser.length > 1 ? 's' : ''}` });
        }
        if (!(await poserStatut(admin, m, 'mapping', rapport))) { rapport.arret = `impossible de passer de ${m.status} à mapping`; break; }
        continue;
      }
      if (s === 'mapping' || s === 'human_review' || s === 'waiting_for_client') {
        await appliquerReponses(admin, m, acteur, rapport);
        if (mode === 'autonome') await resoudreQuestionsAutonome(admin, m, acteur, rapport);
        await appliquerGabarits(admin, m, acteur, rapport);
        const { questions } = await proposerParModele(admin, m, acteur, rapport, mode);
        rapport.questions_posees += questions;
        const ouvertes = await questionsOuvertes(admin, m);
        const { count: aVerifier } = await admin.from('migration_field_mappings').select('id', { count: 'exact', head: true }).eq('migration_id', m.id).eq('status', 'needs_review');
        if ((aVerifier ?? 0) === 0 && ouvertes.length === 0) {
          await publierProgression(admin, rapport, 'Import test (dry-run) en cours', true);
          const r = await lancerImportTest(admin, m, acteur);
          if (!r) { rapport.arret = `import test impossible depuis ${m.status}`; break; }
          rapport.decisions.push({ etape: 'import test', cible: 'dry-run', decision: `${r.report.totals.wouldCreate} à créer, ${r.report.totals.wouldMerge} à fusionner, ${r.report.totals.blockingErrors} erreur${r.report.totals.blockingErrors > 1 ? 's' : ''} bloquante${r.report.totals.blockingErrors > 1 ? 's' : ''}` });
          continue; // → test_review
        }
        if (mode === 'autonome') {
          // Jamais waiting_for_client : ce qui reste (fichier sans catégorie, verdict manquant, question posée par l'admin) revient à l'admin.
          rapport.arret = `bloqué sans le client : ${aVerifier ?? 0} colonne${(aVerifier ?? 0) > 1 ? 's' : ''} sans verdict, ${ouvertes.length} question${ouvertes.length > 1 ? 's' : ''} ouverte${ouvertes.length > 1 ? 's' : ''} (admin prévenu)`;
          await alerterAdmin(admin, m, acteur, 'bloque', `Migration ${m.source_crm} : ${rapport.arret}. Ouvrez la console pour trancher.`, rapport);
          break;
        }
        await envoyerQuestions(admin, m, acteur, rapport);
        if (m.status !== 'waiting_for_client') { await poserStatut(admin, m, 'human_review', rapport); await poserStatut(admin, m, 'waiting_for_client', rapport); }
        rapport.arret = `${ouvertes.length} question${ouvertes.length > 1 ? 's' : ''} en attente du client, ${aVerifier ?? 0} colonne${(aVerifier ?? 0) > 1 ? 's' : ''} à vérifier`;
        break;
      }
      if (s === 'test_review') {
        await appliquerReponses(admin, m, acteur, rapport);
        if (mode === 'autonome') await resoudreQuestionsAutonome(admin, m, acteur, rapport);
        // Les correspondances se relisent AUSSI après un import test (le moteur se trompe à 85 %,
        // et le catalogue évolue) : si quelque chose change, le dry-run est refait avant de juger.
        const revue = await proposerParModele(admin, m, acteur, rapport, mode);
        rapport.questions_posees += revue.questions;
        if (revue.changements > 0) {
          rapport.decisions.push({ etape: 'correspondances', cible: 'import test', decision: `${revue.changements} correspondance${revue.changements > 1 ? 's' : ''} changée${revue.changements > 1 ? 's' : ''} : nouvel import test` });
          if (await poserStatut(admin, m, 'ready_for_test', rapport)) continue;
        }
        await publierProgression(admin, rapport, 'Doublons et rejets du dernier import test', true);
        const { decides, questions } = await traiterDoublons(admin, m, acteur, rapport, mode);
        doublonsDepuisTest += decides;
        rapport.questions_posees += questions;
        await constaterRejets(admin, m, acteur, rapport);
        const { data: batch } = await admin.from('migration_import_batches').select('totals').eq('migration_id', m.id).eq('kind', 'test').eq('status', 'completed').order('created_at', { ascending: false }).limit(1).maybeSingle();
        const report = (batch?.totals ?? null) as DryRunReport | null;
        const { count: dupsEnAttente } = await admin.from('migration_duplicate_candidates').select('id', { count: 'exact', head: true }).eq('migration_id', m.id).eq('decision', 'pending');
        const ouvertes = await questionsOuvertes(admin, m);
        const bloquantes = report?.totals.blockingErrors ?? 0;
        if (bloquantes === 0 && (dupsEnAttente ?? 0) === 0 && ouvertes.length === 0) {
          // Les doublons tranchés depuis le dernier dry-run méritent un import test frais avant d'approuver (une fois).
          if (doublonsDepuisTest > 0) { doublonsDepuisTest = 0; await poserStatut(admin, m, 'ready_for_test', rapport); continue; }
          const refus = await demanderApprobation(admin, m, acteur);
          if (refus) { rapport.arret = refus; break; }
          const resume = `${report?.totals.wouldCreate ?? 0} fiches à créer, ${report?.totals.wouldMerge ?? 0} à fusionner avec des fiches existantes, aucune erreur bloquante`;
          if (mode === 'autonome') {
            await messagePortail(admin, m, acteur, `Bonjour ! L'import test est concluant : ${resume}. Vous n'avez rien à faire : l'équipe Lume valide et lance l'import définitif. Écrivez-nous ici si quelque chose vous semble incorrect.`);
            rapport.decisions.push({ etape: 'approbation', cible: 'admin', decision: 'à approuver au nom du client' });
            rapport.arret = "en attente de l'approbation par l'admin au nom du client";
            await alerterAdmin(admin, m, acteur, 'approbation', `Migration ${m.source_crm} : ${resume}. Approuvez au nom du client dans la console, puis lancez l'import final.`, rapport);
            break;
          }
          await messagePortail(admin, m, acteur, `Bonjour ! L'import test est concluant : ${resume}. Il ne reste qu'à approuver dans la section « Approbation » pour lancer l'import définitif.`);
          rapport.decisions.push({ etape: 'approbation', cible: 'client', decision: 'demandée' });
          rapport.arret = "en attente de l'approbation du client";
          break;
        }
        if (mode === 'autonome') {
          rapport.arret = `bloqué sans le client : ${bloquantes} erreur${bloquantes > 1 ? 's' : ''} bloquante${bloquantes > 1 ? 's' : ''}, ${dupsEnAttente ?? 0} doublon${(dupsEnAttente ?? 0) > 1 ? 's' : ''} à trancher, ${ouvertes.length} question${ouvertes.length > 1 ? 's' : ''} ouverte${ouvertes.length > 1 ? 's' : ''} (admin prévenu)`;
          await alerterAdmin(admin, m, acteur, 'bloque', `Migration ${m.source_crm} : ${rapport.arret}. Voir les rejets et les constats dans la console.`, rapport);
          break;
        }
        await envoyerQuestions(admin, m, acteur, rapport);
        if (ouvertes.length) { await poserStatut(admin, m, 'human_review', rapport); await poserStatut(admin, m, 'waiting_for_client', rapport); }
        rapport.arret = `${bloquantes} erreur${bloquantes > 1 ? 's' : ''} bloquante${bloquantes > 1 ? 's' : ''}, ${dupsEnAttente ?? 0} doublon${(dupsEnAttente ?? 0) > 1 ? 's' : ''} à trancher, ${ouvertes.length} question${ouvertes.length > 1 ? 's' : ''} ouverte${ouvertes.length > 1 ? 's' : ''}`;
        break;
      }
      if (s === 'ready_for_test') {
        await publierProgression(admin, rapport, 'Import test (dry-run) en cours', true);
        const r = await lancerImportTest(admin, m, acteur);
        if (!r) { rapport.arret = 'import test impossible'; break; }
        rapport.decisions.push({ etape: 'import test', cible: 'dry-run', decision: `${r.report.totals.wouldCreate} à créer, ${r.report.totals.blockingErrors} erreur(s) bloquante(s)` });
        continue;
      }
      if (s === 'waiting_for_approval') {
        if (mode === 'autonome') {
          await alerterAdmin(admin, m, acteur, 'approbation', `Migration ${m.source_crm} toujours en attente : approuvez au nom du client dans la console, puis lancez l'import final.`, rapport);
          rapport.arret = "en attente de l'approbation par l'admin au nom du client (jamais faite par le bot)";
          break;
        }
        rapport.arret = "en attente de l'approbation du client (jamais faite par le bot)";
        break;
      }
      if (s === 'approved' || s === 'ready_for_final_import') { rapport.arret = "prêt pour l'import final : un humain clique (jamais le bot)"; break; }
      rapport.arret = `rien à faire au statut ${s}`;
      break;
    }
    if (!rapport.arret) rapport.arret = `${MAX_PASSES} passes atteintes`;
  } catch (err: any) {
    logger.error('[migration-bot] passe échouée', { error: err?.message || String(err), migrationId });
    rapport.arret = `erreur interne : ${String(err?.message || err).slice(0, 120)}`;
  }
  rapport.fin = new Date().toISOString();
  rapport.statut_apres = (await lireMigration(admin, migrationId))?.status ?? m.status;
  rapport.audit.texte_pour_claude = construireTextePourClaude(rapport, m);
  rapport.en_cours = false;
  rapport.etape_courante = null;
  dernierePublication.delete(migrationId);
  await admin.from('data_migrations').update({ bot_derniere_execution: rapport.fin, bot_dernier_rapport: rapport as unknown as Record<string, unknown> }).eq('id', migrationId);
  await touchMigrationActivity(admin, migrationId);
  await logMigrationAudit(admin, { migrationId, action: 'bot.passe', actorId: opts.acteurId, actorRole: 'assistant', meta: { declencheur: opts.declencheur, decisions: rapport.decisions.length, arret: rapport.arret, statut: `${rapport.statut_avant} → ${rapport.statut_apres}`, cout_cents: rapport.cout_cents } });
  return rapport;
}

/** Cron : une passe sur chaque migration où le bot est actif et qui a quelque chose à faire. */
export async function passeCronBot(admin: Admin): Promise<number> {
  const { data } = await admin.from('data_migrations').select('id, status, bot_mode, bot_derniere_execution').eq('bot_actif', true).is('deleted_at', null)
    .in('status', ['files_uploaded', 'parsing', 'mapping', 'human_review', 'waiting_for_client', 'ready_for_test', 'test_review', 'waiting_for_approval']);
  const rappel = Date.now() - RAPPEL_ADMIN_HEURES * 3600 * 1000;
  let n = 0;
  for (const m of data ?? []) {
    // En attente d'approbation : seul le mode autonome a quelque chose à faire (rappeler l'admin), et pas plus d'une fois par délai de rappel.
    if (m.status === 'waiting_for_approval') {
      if (modeBot(m) !== 'autonome') continue;
      if (m.bot_derniere_execution && new Date(m.bot_derniere_execution).getTime() > rappel) continue;
    }
    await executerBotMigration(admin, m.id, { acteurId: null, declencheur: 'cron' }); n += 1;
  }
  return n;
}
