/* ═══════════════════════════════════════════════════════════════
   L'historique des MODIFICATIONS d'une automatisation : qui a changé quoi,
   et quand — un utilisateur, ou Lumi à sa demande.

   Avant (constat D-20) : la seule trace d'une modification était
   `automation_rules.updated_at`. Si un message partait avec un mauvais
   texte, personne ne pouvait dire qui l'avait changé ni ce qu'il disait
   avant.

   · `journaliserModification()` compare l'avant et l'après, écrit UNE ligne
     dans `automation_rule_modifications` (rôle de service : aucune session
     d'utilisateur n'écrit dans cette table), avec un résumé lisible en
     français et en anglais et les seuls champs changés.
   · `lireModifications()` lit avec le client de l'UTILISATEUR : la RLS
     (`automations.read` + bureau actif) décide de ce qu'il voit.

   Elle ne LÈVE jamais : une trace perdue ne doit pas faire échouer
   l'enregistrement de l'automatisation. L'échec est journalisé.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from './supabase';
import { logger } from './logger';
import { trouverAction, trouverDeclencheur } from '../../src/lib/automationCatalogue';

export type OrigineModification = 'utilisateur' | 'lumi' | 'systeme';
export type ActionModification =
  | 'creation' | 'modification' | 'publication' | 'depublication' | 'corbeille' | 'restauration' | 'duplication';

/** Les champs d'une automatisation dont on garde l'histoire. */
export const CHAMPS_SUIVIS = [
  'name', 'trigger_event', 'conditions', 'delay_seconds', 'actions', 'steps', 'settings', 'is_active', 'folder_id', 'deleted_at',
] as const;
export type ChampSuivi = (typeof CHAMPS_SUIVIS)[number];

/** Une automatisation, ou la partie qu'on en connaît. */
export type InstantaneRegle = Partial<Record<ChampSuivi, unknown>> & Record<string, unknown>;

export interface DescriptionModification {
  action: ActionModification;
  champs: ChampSuivi[];
  resume_fr: string;
  resume_en: string;
  /** Les seuls champs changés, avant et après. */
  avant: Record<string, unknown> | null;
  apres: Record<string, unknown> | null;
}

// ── Comparer ────────────────────────────────────────────────

/** JSON à clés triées : deux objets égaux donnent le même texte, quel que soit l'ordre des clés. */
function stable(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Vide = pareil : `{}`, `[]`, `null` et « absent » ne font pas une modification. */
function normal(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v) && v.length === 0) return null;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) return null;
  return v;
}

const pareil = (a: unknown, b: unknown) => stable(normal(a)) === stable(normal(b));

// ── Dire, en clair ──────────────────────────────────────────

type Bilingue = { fr: string; en: string };
const deux = (fr: string, en: string): Bilingue => ({ fr, en });

function duree(secondes: unknown): Bilingue {
  const s = Math.abs(Number(secondes) || 0);
  if (s === 0) return deux('0 minute', '0 minutes');
  const unite = (n: number, fr: string, en: string): Bilingue => deux(`${n} ${fr}${n > 1 ? 's' : ''}`, `${n} ${en}${n > 1 ? 's' : ''}`);
  if (s % 86_400 === 0) return unite(s / 86_400, 'jour', 'day');
  if (s % 3_600 === 0) return unite(s / 3_600, 'heure', 'hour');
  if (s % 60 === 0) return unite(s / 60, 'minute', 'minute');
  return unite(s, 'seconde', 'second');
}

interface ActionSimple { type?: string; config?: Record<string, unknown> }

function nomAction(type: string | undefined): Bilingue {
  const court: Record<string, Bilingue> = {
    send_sms: deux('texto', 'text'),
    send_email: deux('courriel', 'email'),
    request_review: deux('demande d’avis', 'review request'),
    create_task: deux('tâche', 'task'),
    create_notification: deux('notification', 'notification'),
  };
  if (type && court[type]) return court[type];
  const a = type ? trouverAction(type) : undefined;
  return a ? deux(a.fr.toLowerCase(), a.en.toLowerCase()) : deux('action', 'action');
}

function nomDeclencheur(cle: unknown): Bilingue {
  const d = typeof cle === 'string' ? trouverDeclencheur(cle) : undefined;
  return d ? deux(d.fr, d.en) : deux('déclencheur inconnu', 'unknown trigger');
}

/** Ce qui a changé DANS une action : son texte, son objet, ou « autre chose ». */
function changementsAction(avant: ActionSimple, apres: ActionSimple, ou: Bilingue): Bilingue[] {
  const n = nomAction(apres.type);
  if (avant.type !== apres.type) {
    const a = nomAction(avant.type);
    return [deux(`a remplacé ${ou.fr} (${a.fr} → ${n.fr})`, `replaced ${ou.en} (${a.en} → ${n.en})`)];
  }
  const ca = avant.config ?? {};
  const cb = apres.config ?? {};
  const phrases: Bilingue[] = [];
  const cles = [...new Set([...Object.keys(ca), ...Object.keys(cb)])].filter((k) => !pareil(ca[k], cb[k]));
  const reste: string[] = [];
  for (const k of cles) {
    if (k === 'body' || k === 'message') phrases.push(deux(`a changé le texte du ${n.fr} de ${ou.fr}`, `changed the ${n.en} message of ${ou.en}`));
    else if (k === 'subject') phrases.push(deux(`a changé l’objet du ${n.fr} de ${ou.fr}`, `changed the ${n.en} subject of ${ou.en}`));
    else if (k === 'title') phrases.push(deux(`a changé le titre de ${ou.fr}`, `changed the title of ${ou.en}`));
    else reste.push(k);
  }
  if (reste.length) phrases.push(deux(`a changé les réglages de ${ou.fr} (${n.fr})`, `changed the settings of ${ou.en} (${n.en})`));
  return phrases;
}

interface EtapeSimple {
  id?: string;
  type?: string;
  action?: ActionSimple;
  delai_secondes?: unknown;
  [cle: string]: unknown;
}

function nomEtape(e: EtapeSimple): Bilingue {
  if (e.type === 'action') return nomAction(e.action?.type);
  if (e.type === 'attendre') return deux('attente', 'wait');
  if (e.type === 'si') return deux('condition', 'condition');
  if (e.type === 'arreter') return deux('arrêt', 'stop');
  return deux('étape', 'step');
}

function changementsEtapes(avant: unknown, apres: unknown): Bilingue[] {
  const a = (Array.isArray(avant) ? avant : []) as EtapeSimple[];
  const b = (Array.isArray(apres) ? apres : []) as EtapeSimple[];
  const phrases: Bilingue[] = [];
  const parIdAvant = new Map(a.filter((e) => e?.id).map((e, i) => [String(e.id), { e, position: i + 1 }]));
  const idsApres = new Set(b.filter((e) => e?.id).map((e) => String(e.id)));

  b.forEach((e, i) => {
    const position = i + 1;
    const ou = deux(`l’étape ${position}`, `step ${position}`);
    const ancien = e?.id ? parIdAvant.get(String(e.id)) : undefined;
    if (!ancien) {
      const n = nomEtape(e);
      phrases.push(deux(`a ajouté l’étape ${position} (${n.fr})`, `added step ${position} (${n.en})`));
      return;
    }
    if (pareil(ancien.e, e)) return;
    if (e.type === 'action' && ancien.e.type === 'action') {
      const dans = changementsAction(ancien.e.action ?? {}, e.action ?? {}, ou);
      // Un enchaînement modifié (« suivant ») sans autre changement n'est pas une modification de l'étape.
      const { suivant: _s1, ...sansSuiteAvant } = ancien.e;
      const { suivant: _s2, ...sansSuiteApres } = e;
      if (dans.length) phrases.push(...dans);
      else if (!pareil(sansSuiteAvant, sansSuiteApres)) phrases.push(deux(`a modifié ${ou.fr}`, `edited ${ou.en}`));
      return;
    }
    if (e.type === 'attendre' && ancien.e.type === 'attendre' && !pareil(ancien.e.delai_secondes, e.delai_secondes)) {
      const d1 = duree(ancien.e.delai_secondes);
      const d2 = duree(e.delai_secondes);
      phrases.push(deux(`a changé le délai de ${ou.fr} de ${d1.fr} à ${d2.fr}`, `changed the delay of ${ou.en} from ${d1.en} to ${d2.en}`));
      return;
    }
    const { suivant: _s1, alors: _a1, sinon: _n1, ...coeurAvant } = ancien.e;
    const { suivant: _s2, alors: _a2, sinon: _n2, ...coeurApres } = e;
    if (!pareil(coeurAvant, coeurApres)) phrases.push(deux(`a modifié ${ou.fr} (${nomEtape(e).fr})`, `edited ${ou.en} (${nomEtape(e).en})`));
  });

  for (const [id, { e, position }] of parIdAvant) {
    if (idsApres.has(id)) continue;
    const n = nomEtape(e);
    phrases.push(deux(`a retiré l’étape ${position} (${n.fr})`, `removed step ${position} (${n.en})`));
  }
  if (!phrases.length && !pareil(avant, apres)) phrases.push(deux('a réorganisé le parcours', 'rearranged the workflow'));
  return phrases;
}

function changementsActions(avant: unknown, apres: unknown): Bilingue[] {
  const a = (Array.isArray(avant) ? avant : []) as ActionSimple[];
  const b = (Array.isArray(apres) ? apres : []) as ActionSimple[];
  const phrases: Bilingue[] = [];
  const seule = Math.max(a.length, b.length) <= 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ou = seule ? deux('l’action', 'the action') : deux(`l’action ${i + 1}`, `action ${i + 1}`);
    if (i >= a.length) {
      const n = nomAction(b[i]?.type);
      phrases.push(deux(`a ajouté une action (${n.fr})`, `added an action (${n.en})`));
    } else if (i >= b.length) {
      const n = nomAction(a[i]?.type);
      phrases.push(deux(`a retiré ${ou.fr} (${n.fr})`, `removed ${ou.en} (${n.en})`));
    } else if (!pareil(a[i], b[i])) {
      const dans = changementsAction(a[i] ?? {}, b[i] ?? {}, ou);
      phrases.push(...(dans.length ? dans : [deux(`a modifié ${ou.fr}`, `edited ${ou.en}`)]));
    }
  }
  return phrases;
}

/** Au plus cinq phrases : au-delà, on dit combien il en reste plutôt que d'écrire un roman. */
function assembler(phrases: Bilingue[]): Bilingue {
  const MAX = 5;
  const garde = phrases.slice(0, MAX);
  const reste = phrases.length - garde.length;
  const fr = garde.map((p) => p.fr).join(' ; ') + (reste > 0 ? ` ; et ${reste} autre${reste > 1 ? 's' : ''} changement${reste > 1 ? 's' : ''}` : '');
  const en = garde.map((p) => p.en).join('; ') + (reste > 0 ? `; and ${reste} more change${reste > 1 ? 's' : ''}` : '');
  return { fr, en };
}

/**
 * Compare l'avant et l'après d'une automatisation. Pure.
 * Rend `null` s'il n'y a rien à dire (aucun champ suivi n'a changé).
 * `action` : imposée par l'appelant (duplication, corbeille…), sinon déduite.
 */
export function decrireModification(
  avant: InstantaneRegle | null | undefined,
  apres: InstantaneRegle | null | undefined,
  action?: ActionModification,
): DescriptionModification | null {
  const a = avant ?? null;
  const b = apres ?? null;

  if (!a && b) {
    const nom = typeof b.name === 'string' ? b.name : '';
    const dupliquee = action === 'duplication';
    return {
      action: dupliquee ? 'duplication' : 'creation',
      champs: CHAMPS_SUIVIS.filter((c) => normal(b[c]) !== null),
      resume_fr: dupliquee ? `a créé l’automatisation « ${nom} » par duplication` : `a créé l’automatisation « ${nom} »`,
      resume_en: dupliquee ? `created the automation “${nom}” by duplicating another` : `created the automation “${nom}”`,
      avant: null,
      apres: Object.fromEntries(CHAMPS_SUIVIS.filter((c) => normal(b[c]) !== null).map((c) => [c, b[c]])),
    };
  }
  if (!a || !b) return null;

  // Seuls les champs présents des DEUX côtés se comparent : un PATCH partiel ne « retire » rien.
  const champs = CHAMPS_SUIVIS.filter((c) => c in a && c in b && !pareil(a[c], b[c]));
  if (!champs.length) return null;

  const phrases: Bilingue[] = [];
  let deduite: ActionModification = 'modification';

  if (champs.includes('deleted_at')) {
    if (normal(b.deleted_at) !== null) { deduite = 'corbeille'; phrases.push(deux('a mis l’automatisation à la corbeille', 'moved the automation to the bin')); }
    else { deduite = 'restauration'; phrases.push(deux('a restauré l’automatisation', 'restored the automation')); }
  }
  if (champs.includes('is_active')) {
    const publie = b.is_active === true;
    phrases.push(publie ? deux('a publié', 'published') : deux('a remis en brouillon', 'set back to draft'));
    if (champs.length === 1) deduite = publie ? 'publication' : 'depublication';
  }
  if (champs.includes('name')) phrases.push(deux(`a renommé « ${String(a.name ?? '')} » en « ${String(b.name ?? '')} »`, `renamed “${String(a.name ?? '')}” to “${String(b.name ?? '')}”`));
  if (champs.includes('trigger_event')) {
    const d1 = nomDeclencheur(a.trigger_event);
    const d2 = nomDeclencheur(b.trigger_event);
    phrases.push(deux(`a changé le déclencheur (${d1.fr} → ${d2.fr})`, `changed the trigger (${d1.en} → ${d2.en})`));
  }
  if (champs.includes('conditions')) phrases.push(deux('a changé les conditions', 'changed the conditions'));
  if (champs.includes('delay_seconds')) {
    const d1 = duree(a.delay_seconds);
    const d2 = duree(b.delay_seconds);
    phrases.push(deux(`a changé le délai de ${d1.fr} à ${d2.fr}`, `changed the delay from ${d1.en} to ${d2.en}`));
  }
  if (champs.includes('steps')) phrases.push(...changementsEtapes(a.steps, b.steps));
  if (champs.includes('actions')) {
    // Un parcours garde une copie de ses actions dans `actions` : on ne le dit pas deux fois.
    const parcours = Array.isArray(b.steps) && b.steps.length > 0;
    if (!parcours || !champs.includes('steps')) phrases.push(...changementsActions(a.actions, b.actions));
  }
  if (champs.includes('settings')) phrases.push(deux('a changé les réglages (heures d’envoi, repassage…)', 'changed the settings (sending hours, re-entry…)'));
  if (champs.includes('folder_id')) phrases.push(deux('a changé de dossier', 'moved it to another folder'));
  if (!phrases.length) phrases.push(deux('a modifié l’automatisation', 'edited the automation'));

  const resume = assembler(phrases);
  return {
    action: action ?? deduite,
    champs,
    resume_fr: resume.fr,
    resume_en: resume.en,
    avant: Object.fromEntries(champs.map((c) => [c, a[c] ?? null])),
    apres: Object.fromEntries(champs.map((c) => [c, b[c] ?? null])),
  };
}

// ── Écrire ──────────────────────────────────────────────────

export interface ParametresModification {
  orgId: string;
  ruleId: string;
  /** L'utilisateur qui a fait le geste (ou demandé à Lumi de le faire). `null` : le système. */
  auteurId: string | null;
  origine: OrigineModification;
  /** Imposée (duplication, corbeille…) ; sinon déduite de ce qui a changé. */
  action?: ActionModification;
  /** L'automatisation AVANT le geste (`null` pour une création). */
  avant: InstantaneRegle | null;
  /** L'automatisation APRÈS le geste, relue en base. */
  apres: InstantaneRegle | null;
}

export interface LigneModification {
  id: string;
  org_id: string;
  rule_id: string;
  auteur_id: string | null;
  auteur_nom: string | null;
  origine: OrigineModification;
  action: ActionModification;
  champs: string[];
  resume_fr: string;
  resume_en: string;
  avant: Record<string, unknown> | null;
  apres: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Écrit une ligne d'historique si quelque chose a changé.
 * @returns la ligne écrite, ou `null` (rien n'a changé, ou l'écriture a échoué — journalisé).
 */
export async function journaliserModification(
  p: ParametresModification,
  service: SupabaseClient = getServiceClient(),
): Promise<LigneModification | null> {
  try {
    const description = decrireModification(p.avant, p.apres, p.action);
    if (!description) return null;

    let auteurNom: string | null = null;
    if (p.auteurId) {
      const { data: profil, error: errProfil } = await service.from('profiles').select('full_name').eq('id', p.auteurId).maybeSingle();
      if (errProfil) logger.error('[automations-modifications] nom de l’auteur illisible', { rule_id: p.ruleId, message: errProfil.message });
      auteurNom = (profil as { full_name?: string | null } | null)?.full_name?.trim() || null;
    }

    const { data, error } = await service.from('automation_rule_modifications').insert({
      org_id: p.orgId,
      rule_id: p.ruleId,
      auteur_id: p.auteurId,
      auteur_nom: auteurNom,
      origine: p.origine,
      action: description.action,
      champs: description.champs,
      resume_fr: description.resume_fr,
      resume_en: description.resume_en,
      avant: description.avant,
      apres: description.apres,
    }).select('*').maybeSingle();
    if (error) {
      logger.error('[automations-modifications] modification non journalisée', { rule_id: p.ruleId, org_id: p.orgId, message: error.message });
      return null;
    }
    return (data as LigneModification | null) ?? null;
  } catch (e: unknown) {
    logger.error('[automations-modifications] modification non journalisée', {
      rule_id: p.ruleId, org_id: p.orgId, message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ── Lire ────────────────────────────────────────────────────

export interface PageModifications {
  total: number;
  page: number;
  par_page: number;
  lignes: LigneModification[];
}

/** Les modifications d'une automatisation, la plus récente d'abord. Client de l'UTILISATEUR (RLS). */
export async function lireModifications(
  client: SupabaseClient,
  orgId: string,
  ruleId: string,
  options: { page?: number; parPage?: number } = {},
): Promise<PageModifications> {
  const parPage = Math.min(100, Math.max(1, Math.floor(options.parPage ?? 25)));
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const de = (page - 1) * parPage;
  const { data, error, count } = await client
    .from('automation_rule_modifications')
    .select('id, org_id, rule_id, auteur_id, auteur_nom, origine, action, champs, resume_fr, resume_en, avant, apres, created_at', { count: 'exact' })
    .eq('org_id', orgId)
    .eq('rule_id', ruleId)
    .order('created_at', { ascending: false })
    .range(de, de + parPage - 1);
  if (error) throw new Error(error.message);
  return { total: count ?? 0, page, par_page: parPage, lignes: (data ?? []) as LigneModification[] };
}
