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
 * Jamais : l'approbation (client) ni l'import final / rollback (admin).
 * Chaque décision : migration_audit_logs, acteur 'assistant', et le rapport
 * de la passe dans data_migrations.bot_dernier_rapport.
 * Le modèle ne reçoit que des en-têtes et des échantillons MASQUÉS
 * (migration_file_columns.samples_masked), jamais une valeur source.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { logMigrationAudit, touchMigrationActivity } from './audit';
import { analyzeMigrationFile } from './pipeline';
import { FIELD_CATALOG, entityForCategory, normalizeHeader } from './mapping';
import { canTransition } from './state-machine';
import { lancerImportTest, demanderApprobation, type ActeurMigration } from './execution';
import type { MigrationRow, MigrationCategory, TargetEntity, DryRunReport, FieldDef } from './types';
import { coutEnCents } from '../lumi/tarifs';
import { journaliserTrace } from '../lumi/traces';
import { logger } from '../logger';

export const SEUIL_CONFIRMATION = 0.9;
export const SEUIL_GABARIT = 0.8;
export const MAX_PASSES = 6;
export const TYPE_QUESTION_COLONNE = 'bot_colonne';
export const TYPE_QUESTION_DOUBLON = 'bot_doublon';
export const OPTION_IGNORER = 'Ignorer cette colonne';
const MODELE = process.env.LUMI_MODEL_MIGRATION || 'claude-sonnet-5';

export interface DecisionBot {
  etape: string;
  cible: string;
  decision: string;
  detail?: string;
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
});
export type VerdictColonne = z.infer<typeof verdictColonneSchema>;

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
      ...v,
      field: v.field && connus.has(v.field) ? v.field : null,
      confidence: v.field && connus.has(v.field) ? v.confidence : 0,
      candidats: v.candidats.filter((c) => connus.has(c)).slice(0, 3),
    });
  }
  return out;
}

/** Règle de doublon : courriel ou téléphone identique → fusion ; nom seul → demander ; faible → nouvelle fiche. */
export function deciderDoublon(d: { score: number; decision: string; match_reasons: string | string[] | null }): 'merge' | 'create_new' | 'demander' | null {
  if (d.decision !== 'pending' && d.decision !== 'review') return null;
  const raisons = Array.isArray(d.match_reasons) ? d.match_reasons : String(d.match_reasons ?? '').split(/[,\s]+/).filter(Boolean);
  if (d.decision === 'review' || d.score < 90) return 'create_new';
  if (raisons.some((r) => /email|courriel|phone|tel/i.test(r))) return 'merge';
  return 'demander';
}

/** Décision de mapping à partir d'un verdict validé. */
export function deciderMapping(v: VerdictColonne): 'confirmer' | 'demander' {
  return v.field && v.confidence >= SEUIL_CONFIRMATION ? 'confirmer' : 'demander';
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

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function proposerMappings(admin: Admin, migration: MigrationRow, p: {
  fileName: string; entity: TargetEntity; sourceCrm: string;
  colonnes: Array<{ position: number; header: string; detected_type: string | null; samples: unknown[] }>;
}): Promise<{ verdicts: VerdictColonne[]; cost_cents: number | null }> {
  const champs = FIELD_CATALOG[p.entity] ?? [];
  if (!process.env.ANTHROPIC_API_KEY || champs.length === 0 || p.colonnes.length === 0) return { verdicts: [], cost_cents: null };
  const catalogue = champs.map((c) => `- ${c.field} (${c.labelFr}; types : ${c.types.join('/')})`).join('\n');
  const colonnes = p.colonnes.map((c) => `#${c.position} « ${c.header} » type=${c.detected_type ?? '?'} exemples=${JSON.stringify(c.samples.slice(0, 5))}`).join('\n');
  const debut = Date.now();
  try {
    const res = await anthropic().messages.create({
      model: MODELE,
      max_tokens: 2000,
      system: [{
        type: 'text',
        cache_control: { type: 'ephemeral', ttl: '1h' },
        text: `Tu fais correspondre les colonnes d'un export CSV d'un ancien CRM (entreprise de services au Québec) aux champs de Lume. Les exemples sont MASQUÉS (formes, pas les valeurs). Règles : un champ du catalogue ou null, jamais un champ inventé ; confidence honnête entre 0 et 1 (0,9+ seulement si l'en-tête ET les exemples concordent) ; en cas de doute, null avec jusqu'à 3 candidats du catalogue ; une même cible ne va pas à deux colonnes sauf champs répétables (phone / phone_secondary, address / city). Entité cible : ${p.entity}. CRM source : ${p.sourceCrm}.\n\nCatalogue :\n${catalogue}`,
      }],
      tools: [{
        name: 'proposer',
        description: 'Les correspondances proposées, une par colonne.',
        input_schema: {
          type: 'object',
          properties: {
            colonnes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  position: { type: 'integer' },
                  field: { type: ['string', 'null'] },
                  confidence: { type: 'number' },
                  raison: { type: 'string' },
                  candidats: { type: 'array', items: { type: 'string' } },
                },
                required: ['position', 'field', 'confidence'],
                additionalProperties: false,
              },
            },
          },
          required: ['colonnes'],
          additionalProperties: false,
        },
      }],
      tool_choice: { type: 'tool', name: 'proposer' },
      messages: [{ role: 'user', content: `Fichier « ${p.fileName} ». Colonnes :\n${colonnes}` }],
    });
    const appel = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
    const verdicts = validerVerdicts(appel?.input ?? null, champs);
    // Un verdict qui ne passe pas le schéma est jeté (jamais une action devinée) ; on garde une trace pour comprendre.
    if (!verdicts.length) logger.warn('[migration-bot] verdicts refusés par le schéma', { migrationId: migration.id, fichier: p.fileName, brut: JSON.stringify(appel?.input ?? null).slice(0, 600) });
    const cout = coutEnCents(res.model, res.usage as any);
    void journaliserTrace(admin, {
      orgId: migration.org_id, userId: null, canal: 'migration', origine: 'api', enonce: `mapping ${p.fileName}`, etage: 6,
      action: 'bot_mapping', params: { fichier: p.fileName, entite: p.entity, colonnes: p.colonnes.length }, outils: [], resultat: verdicts.length ? 'ok' : 'erreur',
      model: res.model, usage: { input_tokens: res.usage.input_tokens, cache_5m: 0, cache_1h: res.usage.cache_creation_input_tokens ?? 0, cache_lu: res.usage.cache_read_input_tokens ?? 0, output_tokens: res.usage.output_tokens },
      costCents: cout, dureeMs: Date.now() - debut,
    });
    return { verdicts, cost_cents: cout };
  } catch (err: any) {
    logger.error('[migration-bot] proposition de mappings ratée', { error: err?.message || String(err), migrationId: migration.id });
    return { verdicts: [], cost_cents: null };
  }
}

// ── Le bot ────────────────────────────────────────────────────────

async function lireMigration(admin: Admin, id: string): Promise<MigrationRow | null> {
  const { data } = await admin.from('data_migrations').select('*').eq('id', id).is('deleted_at', null).maybeSingle<MigrationRow>();
  return data ?? null;
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

/** Étape 3 : un appel modèle par fichier pour les colonnes encore à vérifier. */
async function proposerParModele(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot): Promise<{ confirmees: number; questions: number }> {
  const { data: files } = await admin.from('migration_files').select('id, original_name, category_detected').eq('migration_id', m.id).eq('kind', 'data').is('deleted_at', null).eq('parse_status', 'parsed');
  let confirmees = 0, questions = 0;
  for (const f of files ?? []) {
    const { data: maps } = await admin.from('migration_field_mappings').select('id, column_id, status, confidence').eq('file_id', f.id).eq('status', 'needs_review');
    if (!maps?.length) continue;
    // Déjà une question ouverte pour cette colonne → on attend le client, pas de nouvel appel.
    const { data: ouvertes } = await admin.from('migration_issues').select('details_masked').eq('migration_id', m.id).eq('type', TYPE_QUESTION_COLONNE).is('resolved_at', null);
    const dejaDemandes = new Set((ouvertes ?? []).map((i: any) => String(i.details_masked?.mapping_id ?? '')));
    const aTraiter = maps.filter((mp) => !dejaDemandes.has(mp.id));
    if (!aTraiter.length) continue;
    const cat = f.category_detected as MigrationCategory | null;
    const entity = entityForCategory(cat);
    if (!entity) continue;
    const { data: cols } = await admin.from('migration_file_columns').select('id, position, header, detected_type, samples_masked').eq('file_id', f.id);
    const colonnes = aTraiter.map((mp) => cols?.find((c) => c.id === mp.column_id)).filter(Boolean).map((c: any) => ({ position: c.position, header: c.header, detected_type: c.detected_type, samples: Array.isArray(c.samples_masked) ? c.samples_masked : [] }));
    const { verdicts, cost_cents } = await proposerMappings(admin, m, { fileName: f.original_name, entity, sourceCrm: m.source_crm, colonnes });
    if (cost_cents !== null) rapport.cout_cents = (rapport.cout_cents ?? 0) + cost_cents;
    const champs = FIELD_CATALOG[entity] ?? [];
    for (const v of verdicts) {
      const col: any = cols?.find((c) => c.position === v.position);
      const mp = col ? aTraiter.find((x) => x.column_id === col.id) : null;
      if (!col || !mp) continue;
      if (deciderMapping(v) === 'confirmer') {
        await admin.from('migration_field_mappings').update({ target_entity: entity, target_field: v.field, status: 'confirmed', confidence: Math.round(v.confidence * 100), reason: `bot : ${v.raison}`.slice(0, 200), decided_by: null, decided_role: 'assistant', decided_at: new Date().toISOString() }).eq('id', mp.id);
        await audit(admin, m, acteur, 'bot.mapping.confirme', `mapping:${mp.id}`, { field: v.field, confidence: v.confidence }, rapport, { etape: 'correspondances', cible: `${f.original_name} · ${col.header}`, decision: `→ ${v.field} (${Math.round(v.confidence * 100)} %)`, detail: v.raison });
        confirmees += 1;
      } else {
        const candidats = [...(v.field ? [v.field] : []), ...v.candidats].filter((x, i, a) => a.indexOf(x) === i).slice(0, 3)
          .map((field) => ({ field, label: champs.find((c) => c.field === field)?.labelFr ?? field }));
        const options = [...candidats.map((c) => c.label), OPTION_IGNORER];
        const { data: issue } = await admin.from('migration_issues').insert({
          migration_id: m.id, type: TYPE_QUESTION_COLONNE, severity: 'warning', column_id: col.id, client_visible: true,
          title: `Que contient la colonne « ${col.header} » du fichier ${f.original_name} ?`,
          details_masked: { mapping_id: mp.id, column_id: col.id, header: col.header, candidats, exemples: (col.samples_masked ?? []).slice(0, 3) },
          options,
        }).select('id').single();
        await audit(admin, m, acteur, 'bot.mapping.question', `mapping:${mp.id}`, { candidats: candidats.map((c) => c.field), confidence: v.confidence }, rapport, { etape: 'correspondances', cible: `${f.original_name} · ${col.header}`, decision: 'question au client', detail: candidats.map((c) => c.label).join(' / ') || 'aucun candidat' });
        if (issue) questions += 1;
      }
    }
  }
  return { confirmees, questions };
}

/** Étape 5 : doublons. */
async function traiterDoublons(admin: Admin, m: MigrationRow, acteur: ActeurMigration, rapport: RapportBot): Promise<{ decides: number; questions: number }> {
  const { data: dups } = await admin.from('migration_duplicate_candidates').select('id, staging_record_id, score, decision, match_reasons').eq('migration_id', m.id).in('decision', ['pending', 'review']);
  let decides = 0, questions = 0;
  const { data: ouvertes } = await admin.from('migration_issues').select('details_masked').eq('migration_id', m.id).eq('type', TYPE_QUESTION_DOUBLON).is('resolved_at', null);
  const dejaDemandes = new Set((ouvertes ?? []).map((i: any) => String(i.details_masked?.dup_id ?? '')));
  for (const d of dups ?? []) {
    const decision = deciderDoublon(d as any);
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
    await audit(admin, m, acteur, 'bot.doublon.decide', `duplicate:${d.id}`, { decision, score: d.score, raisons: d.match_reasons }, rapport, { etape: 'doublons', cible: `doublon ${d.score} %`, decision: decision === 'merge' ? 'fusion (courriel ou téléphone identique)' : 'nouvelle fiche (ressemblance faible)' });
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
  const rapport: RapportBot = { migration_id: migrationId, declencheur: opts.declencheur, debut, fin: debut, statut_avant: m0?.status ?? 'inconnue', statut_apres: m0?.status ?? 'inconnue', decisions: [], questions_posees: 0, arret: '', cout_cents: null };
  if (!m0) { rapport.arret = 'migration introuvable'; rapport.fin = new Date().toISOString(); return rapport; }
  const m = m0;
  // Doublons tranchés depuis le dernier dry-run : un import test frais s'impose avant d'approuver, une seule fois.
  let doublonsDepuisTest = 0;
  try {
    for (let passe = 0; passe < MAX_PASSES; passe++) {
      const s = m.status;
      if (s === 'files_uploaded' || s === 'parsing') {
        const { data: files } = await admin.from('migration_files').select('id, parse_status').eq('migration_id', m.id).eq('kind', 'data').is('deleted_at', null).neq('security_status', 'rejected');
        const aAnalyser = (files ?? []).filter((f) => f.parse_status === 'pending' || f.parse_status === 'failed');
        if (aAnalyser.length) {
          await poserStatut(admin, m, 'parsing', rapport);
          for (const f of aAnalyser) await analyzeMigrationFile(admin, m, f.id);
          await audit(admin, m, acteur, 'bot.analyse', null, { fichiers: aAnalyser.length }, rapport, { etape: 'analyse', cible: 'fichiers', decision: `${aAnalyser.length} fichier${aAnalyser.length > 1 ? 's' : ''} analysé${aAnalyser.length > 1 ? 's' : ''}` });
        }
        if (!(await poserStatut(admin, m, 'mapping', rapport))) { rapport.arret = `impossible de passer de ${m.status} à mapping`; break; }
        continue;
      }
      if (s === 'mapping' || s === 'human_review' || s === 'waiting_for_client') {
        await appliquerReponses(admin, m, acteur, rapport);
        await appliquerGabarits(admin, m, acteur, rapport);
        const { questions } = await proposerParModele(admin, m, acteur, rapport);
        rapport.questions_posees += questions;
        const ouvertes = await questionsOuvertes(admin, m);
        const { count: aVerifier } = await admin.from('migration_field_mappings').select('id', { count: 'exact', head: true }).eq('migration_id', m.id).eq('status', 'needs_review');
        if ((aVerifier ?? 0) === 0 && ouvertes.length === 0) {
          const r = await lancerImportTest(admin, m, acteur);
          if (!r) { rapport.arret = `import test impossible depuis ${m.status}`; break; }
          rapport.decisions.push({ etape: 'import test', cible: 'dry-run', decision: `${r.report.totals.wouldCreate} à créer, ${r.report.totals.wouldMerge} à fusionner, ${r.report.totals.blockingErrors} erreur${r.report.totals.blockingErrors > 1 ? 's' : ''} bloquante${r.report.totals.blockingErrors > 1 ? 's' : ''}` });
          continue; // → test_review
        }
        await envoyerQuestions(admin, m, acteur, rapport);
        if (m.status !== 'waiting_for_client') { await poserStatut(admin, m, 'human_review', rapport); await poserStatut(admin, m, 'waiting_for_client', rapport); }
        rapport.arret = `${ouvertes.length} question${ouvertes.length > 1 ? 's' : ''} en attente du client, ${aVerifier ?? 0} colonne${(aVerifier ?? 0) > 1 ? 's' : ''} à vérifier`;
        break;
      }
      if (s === 'test_review') {
        await appliquerReponses(admin, m, acteur, rapport);
        const { decides, questions } = await traiterDoublons(admin, m, acteur, rapport);
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
          await messagePortail(admin, m, acteur, `Bonjour ! L'import test est concluant : ${report?.totals.wouldCreate ?? 0} fiches à créer, ${report?.totals.wouldMerge ?? 0} à fusionner avec des fiches existantes, aucune erreur bloquante. Il ne reste qu'à approuver dans la section « Approbation » pour lancer l'import définitif.`);
          rapport.decisions.push({ etape: 'approbation', cible: 'client', decision: 'demandée' });
          rapport.arret = "en attente de l'approbation du client";
          break;
        }
        await envoyerQuestions(admin, m, acteur, rapport);
        if (ouvertes.length) { await poserStatut(admin, m, 'human_review', rapport); await poserStatut(admin, m, 'waiting_for_client', rapport); }
        rapport.arret = `${bloquantes} erreur${bloquantes > 1 ? 's' : ''} bloquante${bloquantes > 1 ? 's' : ''}, ${dupsEnAttente ?? 0} doublon${(dupsEnAttente ?? 0) > 1 ? 's' : ''} à trancher, ${ouvertes.length} question${ouvertes.length > 1 ? 's' : ''} ouverte${ouvertes.length > 1 ? 's' : ''}`;
        break;
      }
      if (s === 'ready_for_test') {
        const r = await lancerImportTest(admin, m, acteur);
        if (!r) { rapport.arret = 'import test impossible'; break; }
        rapport.decisions.push({ etape: 'import test', cible: 'dry-run', decision: `${r.report.totals.wouldCreate} à créer, ${r.report.totals.blockingErrors} erreur(s) bloquante(s)` });
        continue;
      }
      if (s === 'waiting_for_approval') { rapport.arret = "en attente de l'approbation du client (jamais faite par le bot)"; break; }
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
  await admin.from('data_migrations').update({ bot_derniere_execution: rapport.fin, bot_dernier_rapport: rapport as unknown as Record<string, unknown> }).eq('id', migrationId);
  await touchMigrationActivity(admin, migrationId);
  await logMigrationAudit(admin, { migrationId, action: 'bot.passe', actorId: opts.acteurId, actorRole: 'assistant', meta: { declencheur: opts.declencheur, decisions: rapport.decisions.length, arret: rapport.arret, statut: `${rapport.statut_avant} → ${rapport.statut_apres}`, cout_cents: rapport.cout_cents } });
  return rapport;
}

/** Cron : une passe sur chaque migration où le bot est actif et qui a quelque chose à faire. */
export async function passeCronBot(admin: Admin): Promise<number> {
  const { data } = await admin.from('data_migrations').select('id, status').eq('bot_actif', true).is('deleted_at', null)
    .in('status', ['files_uploaded', 'parsing', 'mapping', 'human_review', 'waiting_for_client', 'ready_for_test', 'test_review']);
  let n = 0;
  for (const m of data ?? []) { await executerBotMigration(admin, m.id, { acteurId: null, declencheur: 'cron' }); n += 1; }
  return n;
}
