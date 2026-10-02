/* ═══════════════════════════════════════════════════════════════
   ÉCRIRE le contenu d'une automatisation — une seule fonction.

   Les outils de Lumi écrivaient chacun à leur façon dans `automation_rules`
   (un `insert` ici, trois `update` là), chacun avec ses contrôles — ou sans.
   Une autre session a montré qu'un membre peut écrire le contenu d'une
   automatisation directement en base, sans aucun contrôle du serveur :
   déclencheur hors catalogue, texto de 5 000 caractères, texto vidé sur une
   règle publiée. La base va donc se fermer : seul le serveur écrira, après le
   contrôle de droit et la validation.

   `ecrireRegle` est ce point de passage, pour tout ce qui n'est PAS la
   publication (`is_active` passe par `automations-publication.ts`) :

     1. la règle appartient au bureau et n'est pas à la corbeille ;
     2. le contenu passe les contrôles des routes : le schéma de modification
        (`automationRuleUpdateSchema` — donc `sequenceEtapes` pour le parcours,
        le déclencheur du catalogue), `verifierCoherence` de la route, le
        déclencheur offert à cette entreprise, aucune automatisation citée
        qui n'existe pas, aucune variable inconnue de plus qu'avant, et une
        automatisation PUBLIÉE que la modification casserait reste intacte ;
     3. `steps` est écrit, et `actions` remis en accord (re-dérivé du
        parcours) dans la MÊME écriture ;
     4. la ligne est RELUE et rendue : l'appelant cite ce qui est enregistré.

   AUJOURD'HUI l'écriture part avec le client reçu (celui de l'utilisateur :
   la RLS prouve son droit). Le jour où la base refuse cette écriture à une
   session d'utilisateur, c'est ICI — et seulement ici — qu'elle bascule sur
   le rôle de service, après une preuve de droit (voir `changerPublication`).
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { automationRuleUpdateSchema } from './validation';
import { actionsDepuisEtapes, aUnParcours, COLONNES_REGLE_LUE, type RegleLue } from './automations-etapes';
import { declencheurOffertA, refusDeclencheurNonOffert } from './automations-drapeaux';
import { messageCorbeille } from './automations-corbeille';
import { messagePublieeCassee, problemesBloquants, refAutomatisationInventee } from './automations-publication';
import { conditionsApresChangement, trouverDeclencheur } from '../../src/lib/automationCatalogue';
import { variableLisible, variablesInconnues } from '../../src/lib/emailBodyText';
import { logger } from './logger';

/** Ce qu'on peut changer dans une automatisation, hors publication. */
export interface ChangementsRegle {
  name?: string;
  description?: string | null;
  trigger_event?: string;
  conditions?: Record<string, unknown> | null;
  /** Le parcours. `actions` en est re-dérivé : ne pas le fournir avec. */
  steps?: unknown[];
  /** Seulement pour une règle au format d'origine (sans parcours) : c'est alors ce que le moteur exécute. */
  actions?: unknown[];
  settings?: Record<string, unknown> | null;
}

export type RegleEcrite = RegleLue & { id: string; name: string; trigger_event: string; modele_id?: string | null };

export type ResultatEcriture =
  | { ok: true; regle: RegleEcrite; creee: boolean }
  | { ok: false; code: 'introuvable' | 'corbeille' | 'invalide' | 'publiee_cassee' | 'droit' | 'erreur'; erreur: string };

const COLONNES = `${COLONNES_REGLE_LUE}, modele_id`;

/** Tous les textes (objet, corps) des messages d'un parcours ou d'une liste d'actions. */
function textesDe(valeur: unknown): string[] {
  if (Array.isArray(valeur)) return valeur.flatMap(textesDe);
  if (!valeur || typeof valeur !== 'object') return [];
  return Object.entries(valeur as Record<string, unknown>).flatMap(([cle, v]) =>
    ((cle === 'body' || cle === 'subject') && typeof v === 'string' ? [v] : textesDe(v)));
}

const refus = (code: Exclude<ResultatEcriture, { ok: true }>['code'], erreur: string): ResultatEcriture => ({ ok: false, code, erreur });

export async function ecrireRegle(o: {
  /** Le client qui écrit — aujourd'hui celui de l'utilisateur (RLS). */
  client: SupabaseClient;
  orgId: string;
  /** `null` = créer une automatisation (elle naît TOUJOURS en brouillon). */
  ruleId: string | null;
  changements: ChangementsRegle;
  /** Qui écrit, et par où : pour l'historique des modifications. */
  auteurId: string | null;
  origine: 'lumi' | 'editeur';
  /** Langue des refus (français par défaut). */
  fr?: boolean;
}): Promise<ResultatEcriture> {
  const fr = o.fr !== false;
  try {
    // ── 1. La règle : dans ce bureau, pas à la corbeille ──
    let existante: (RegleEcrite & { purged_at?: string | null }) | null = null;
    if (o.ruleId) {
      const { data, error } = await o.client
        .from('automation_rules').select(COLONNES)
        .eq('id', o.ruleId).eq('org_id', o.orgId).is('purged_at', null)
        .maybeSingle();
      if (error) {
        logger.error('[automations-ecriture] lecture échouée', { rule_id: o.ruleId, message: error.message });
        return refus('erreur', fr ? 'Impossible de lire l’automatisation.' : 'Unable to read the automation.');
      }
      if (!data) return refus('introuvable', fr ? 'Automatisation introuvable dans cette entreprise — elle a peut-être été supprimée.' : 'Automation not found in this company — it may have been deleted.');
      existante = data as unknown as RegleEcrite;
      if (existante.deleted_at) return refus('corbeille', messageCorbeille(fr));
    }

    // ── 2. Le contenu : les contrôles des routes ──
    const c = o.changements;
    if (c.steps !== undefined && c.actions !== undefined) return refus('invalide', 'Écrire `steps` OU `actions`, jamais les deux : `actions` est re-dérivé du parcours.');
    const brut: Record<string, unknown> = {};
    for (const cle of ['name', 'description', 'trigger_event', 'conditions', 'steps', 'settings'] as const) {
      if (c[cle] !== undefined) brut[cle] = c[cle];
    }
    /*
     * `actions` (format d'origine) ne passe PAS par le schéma du catalogue : les
     * automatisations fournies y portent des écritures internes du moteur
     * (`log_activity`, une demande d'avis sans texte) que le catalogue ne
     * connaît pas — les valider les rendrait impossibles à réécrire. On
     * contrôle ce qu'un humain (ou Lumi) y écrit : les messages aux clients.
     */
    let actionsOrigine: Array<Record<string, unknown>> | null = null;
    if (c.actions !== undefined) {
      if (existante && aUnParcours(existante)) return refus('invalide', 'Cette automatisation a un parcours : c’est `steps` qu’on écrit, `actions` en est re-dérivé.');
      if (!Array.isArray(c.actions) || c.actions.length === 0 || c.actions.length > 20) return refus('invalide', fr ? 'La liste d’actions est invalide.' : 'The action list is invalid.');
      for (const a of c.actions as Array<{ type?: unknown; config?: Record<string, unknown> }>) {
        if (!a || typeof a !== 'object' || typeof a.type !== 'string' || !a.type) return refus('invalide', fr ? 'Une action n’a pas de type.' : 'An action has no type.');
        const corps = a.config?.body;
        if (a.type === 'send_sms' && (typeof corps !== 'string' || !corps.trim() || corps.length > 1600)) {
          return refus('invalide', fr ? 'Le texte d’un texto est obligatoire, et ne dépasse pas 1 600 caractères.' : 'A text message needs a body of at most 1,600 characters.');
        }
        if (a.type === 'send_email') {
          const objet = a.config?.subject;
          if (typeof objet !== 'string' || !objet.trim() || objet.length > 300) return refus('invalide', fr ? 'L’objet d’un courriel est obligatoire (300 caractères au plus).' : 'An email needs a subject (at most 300 characters).');
          if (typeof corps !== 'string' || !corps.trim() || corps.length > 20_000) return refus('invalide', fr ? 'Le corps d’un courriel est obligatoire (20 000 caractères au plus).' : 'An email needs a body (at most 20,000 characters).');
        }
      }
      actionsOrigine = c.actions as Array<Record<string, unknown>>;
    }
    if (Object.keys(brut).length === 0 && !actionsOrigine) return refus('invalide', fr ? 'Rien à modifier.' : 'Nothing to change.');
    if (!o.ruleId) {
      if (typeof c.name !== 'string' || !c.name.trim()) return refus('invalide', fr ? 'Il manque le nom de l’automatisation.' : 'The automation needs a name.');
      if (!c.trigger_event) return refus('invalide', fr ? 'Il manque le déclencheur de l’automatisation.' : 'The automation needs a trigger.');
      if (!Array.isArray(c.steps) || c.steps.length === 0) return refus('invalide', fr ? 'Il manque les étapes de l’automatisation.' : 'The automation needs steps.');
    }
    let patch: Record<string, unknown> = {};
    if (Object.keys(brut).length > 0) {
      const verdict = automationRuleUpdateSchema.safeParse(brut);
      if (!verdict.success) {
        logger.warn('[automations-ecriture] contenu refusé', { rule_id: o.ruleId, origine: o.origine, motifs: verdict.error.issues.slice(0, 3).map((i) => i.message) });
        return refus('invalide', verdict.error.issues[0]?.message ?? (fr ? 'Ce contenu ne pourrait pas être exécuté.' : 'This content could not run.'));
      }
      patch = verdict.data as Record<string, unknown>;
    }
    if (actionsOrigine) patch.actions = actionsOrigine;

    const declencheurAvant = existante?.trigger_event ?? null;
    const declencheur = String(patch.trigger_event ?? declencheurAvant ?? '');
    const declencheurChange = !!existante && typeof patch.trigger_event === 'string' && patch.trigger_event !== declencheurAvant;
    // Le catalogue juge le déclencheur qu'on ÉCRIT. Une automatisation ancienne dont le déclencheur
    // n'y est plus reste modifiable (réécrire son texto ne doit pas échouer pour ça).
    if ((declencheurChange || !existante) && !trouverDeclencheur(declencheur)) return refus('invalide', fr ? 'Ce déclencheur n’existe pas.' : 'This trigger does not exist.');
    if (declencheurChange && existante?.is_preset) {
      return refus('invalide', fr
        ? 'Le déclencheur d’une automatisation fournie ne se change pas. Dupliquez-la pour en faire une à vous.'
        : 'The trigger of a built-in automation cannot be changed. Duplicate it to make your own.');
    }
    if ((declencheurChange || !existante) && !(await declencheurOffertA(o.client, o.orgId, declencheur))) {
      return refus('invalide', refusDeclencheurNonOffert(declencheur, fr));
    }
    // Changer de déclencheur sans dire quoi faire des conditions : celles de l'ancien ne restent pas.
    if (declencheurChange && !('conditions' in patch)) {
      patch.conditions = conditionsApresChangement(String(declencheurAvant), declencheur, (existante?.conditions ?? {}) as Record<string, unknown>);
    }
    // Les gardes de la route qui ont besoin du catalogue (délai négatif, « date atteinte », deux actions identiques).
    const { verifierCoherence } = await import('../routes/automation-rules');
    const incoherence = verifierCoherence({
      trigger_event: declencheur,
      delay_seconds: Number(existante?.delay_seconds ?? 0),
      actions: Array.isArray(patch.actions) ? patch.actions as Array<{ type: string }> : undefined,
      conditions: 'conditions' in patch ? (patch.conditions as Record<string, unknown> | null) : undefined,
    }, fr);
    if (incoherence) return refus('invalide', incoherence);

    const etapes = Array.isArray(patch.steps) ? patch.steps as unknown[] : null;
    if (etapes) {
      const inventee = await refAutomatisationInventee(o.client, o.orgId, etapes);
      if (inventee) return refus('invalide', fr ? 'Une étape vise une automatisation qui n’existe pas dans cette entreprise.' : 'A step targets an automation that does not exist in this company.');
    }
    // Aucune variable inconnue DE PLUS qu'avant : le client recevrait un trou. (Une règle qui en
    // portait déjà une reste modifiable — on ne bloque pas la correction d'un autre message.)
    const avant = new Set(variablesInconnues(textesDe([existante?.steps, existante?.actions]).join('\n')));
    const nouvelles = variablesInconnues(textesDe([patch.steps, patch.actions]).join('\n')).filter((v) => !avant.has(v));
    if (nouvelles.length) {
      return refus('invalide', fr
        ? `Message refusé : ${nouvelles.map(variableLisible).join(', ')} ${nouvelles.length > 1 ? 'ne sont pas des variables' : 'n’est pas une variable'} de Lume — le client recevrait un trou à la place.`
        : `Message refused: ${nouvelles.map(variableLisible).join(', ')} ${nouvelles.length > 1 ? 'are not Lume variables' : 'is not a Lume variable'} — the client would get a blank instead.`);
    }

    // ── 3. `actions` redit le parcours, dans la même écriture ──
    const ecriture: Record<string, unknown> = { ...patch };
    if (etapes) ecriture.actions = etapes.length ? actionsDepuisEtapes(etapes) : (existante?.actions ?? []);

    // Une automatisation PUBLIÉE ne se casse pas en silence : on refuse ce qui AJOUTE un problème bloquant.
    if (existante?.is_active) {
      const dejaLa = new Set(problemesBloquants(existante as Parameters<typeof problemesBloquants>[0], fr));
      const ajoutes = problemesBloquants({ ...existante, ...ecriture } as Parameters<typeof problemesBloquants>[0], fr).filter((p) => !dejaLa.has(p));
      if (ajoutes.length) return refus('publiee_cassee', messagePublieeCassee(ajoutes, fr));
    }

    let id = o.ruleId;
    if (existante && id) {
      // Modifier une copie liée la détache de son modèle : sinon la prochaine modification du modèle écraserait celle-ci.
      if (existante.modele_id) ecriture.modele_id = null;
      const { data, error } = await o.client
        .from('automation_rules')
        .update({ ...ecriture, updated_at: new Date().toISOString() })
        .eq('id', id).eq('org_id', o.orgId).is('deleted_at', null)
        .select('id');
      if (error) {
        if (error.code === '42501') return refus('droit', fr ? 'Votre rôle ne permet pas de modifier les automatisations.' : 'Your role cannot edit automations.');
        logger.error('[automations-ecriture] écriture échouée', { rule_id: id, message: error.message, code: error.code });
        return refus('erreur', fr ? 'Impossible d’enregistrer l’automatisation.' : 'Unable to save the automation.');
      }
      // Une ligne filtrée par la RLS « réussit » avec 0 ligne : ce n'est pas un succès.
      if (!data || data.length === 0) return refus('droit', fr ? 'Automatisation introuvable, ou votre rôle ne permet pas de la modifier.' : 'Automation not found, or your role cannot edit it.');
    } else {
      const { data, error } = await o.client
        .from('automation_rules')
        .insert({
          org_id: o.orgId,
          name: patch.name,
          description: patch.description ?? '',
          trigger_event: declencheur,
          conditions: patch.conditions ?? {},
          delay_seconds: 0,
          actions: ecriture.actions ?? [],
          steps: etapes,
          settings: patch.settings ?? null,
          // Une automatisation naît en brouillon : publier passe par `changerPublication`.
          is_active: false,
          is_preset: false,
          preset_key: null,
        })
        .select('id');
      if (error) {
        if (error.code === '42501') return refus('droit', fr ? 'Votre rôle ne permet pas de créer une automatisation.' : 'Your role cannot create an automation.');
        logger.error('[automations-ecriture] création échouée', { message: error.message, code: error.code });
        return refus('erreur', fr ? 'Impossible de créer l’automatisation.' : 'Unable to create the automation.');
      }
      id = (data?.[0] as { id?: string } | undefined)?.id ?? null;
      if (!id) return refus('droit', fr ? 'Votre rôle ne permet pas de créer une automatisation.' : 'Your role cannot create an automation.');
    }

    // ── 4. RELUE : c'est cette ligne que l'appelant cite ──
    const { data: relue, error: eRelue } = await o.client
      .from('automation_rules').select(COLONNES)
      .eq('id', id).eq('org_id', o.orgId).maybeSingle();
    if (eRelue || !relue) {
      logger.error('[automations-ecriture] relecture échouée', { rule_id: id, message: eRelue?.message ?? 'ligne absente' });
      return refus('erreur', fr ? 'L’automatisation est enregistrée, mais je n’ai pas pu la relire : vérifie-la dans Lume.' : 'The automation was saved, but could not be read back: check it in Lume.');
    }
    logger.info('[automations-ecriture] automatisation écrite', { rule_id: id, origine: o.origine, auteur: o.auteurId, creee: !existante, champs: Object.keys(ecriture) });
    return { ok: true, regle: relue as unknown as RegleEcrite, creee: !existante };
  } catch (e: unknown) {
    logger.error('[automations-ecriture] exception', { rule_id: o.ruleId, message: e instanceof Error ? e.message : String(e) });
    return refus('erreur', fr ? 'Impossible d’enregistrer l’automatisation.' : 'Unable to save the automation.');
  }
}

/** La règle a-t-elle un parcours (c'est alors `steps` qu'on écrit) ? Ré-exporté pour les appelants de `ecrireRegle`. */
export { aUnParcours };
