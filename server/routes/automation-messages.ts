/* ═══════════════════════════════════════════════════════════════
   Route — écrire UN message d'une automatisation

   PATCH /api/automations/rules/:id/messages

   POURQUOI UNE ROUTE. La liste, l'éditeur de courriel et les Réglages
   (Messagerie, Avis) écrivaient le texte d'un message DIRECTEMENT dans la table
   `automation_rules`, depuis le navigateur (PostgREST). Aucun contrôle du
   serveur ne s'appliquait : on enregistrait un texto de 5 000 caractères, on
   vidait le texto d'une règle publiée, et — faute de savoir LEQUEL des deux
   textos d'une règle on modifiait — on recopiait le texte du premier dans le
   second (triage « modèles » du 2026-10-01, MSG-010 et MSG-036). Le contenu
   d'une automatisation ne s'écrit plus que par le serveur.

   CE QUE FAIT LA ROUTE.
     1. Mêmes gardes que les autres écritures d'automatisations : session,
        droit `automations.update`, client de l'UTILISATEUR (la RLS reste la
        garde de fond, jamais le rôle de service).
     2. Elle valide : texte non vide, 1 600 caractères pour un texto, 200 pour
        un objet et 10 000 pour un courriel (les bornes du catalogue).
     3. Elle refuse une règle à la corbeille (409), un message qui a changé
        ailleurs depuis l'ouverture de l'écran (409), et une désignation
        ambiguë (deux textos, aucun désigné : 400).
     4. Elle écrit UN SEUL message — celui visé. Parcours : `steps` ET le reflet
        `actions`, dans la même écriture. Règle à plat : `actions` seul.
     5. Elle RELIT la ligne et rend l'état enregistré, avec les variables que le
        serveur ne saura pas remplir (signalées, pas refusées — comme l'éditeur).

   LE CORPS.
     canal          'send_sms' | 'send_email'
     etape_id       parcours : l'étape visée
     index_action   règle à plat : l'index de l'action dans `actions`
     rang           à défaut : le rang parmi les messages de ce canal (0 = le premier)
     corps_lu, objet_lu   le texte français et l'objet lus à l'ouverture de l'écran
     langue         'fr' (défaut) | 'en' — la version écrite par `texte` / `objet`
     texte, objet   le texte ; l'objet pour un courriel (un champ absent reste tel quel)
     version_en     { texte, objet } : la version anglaise, écrite avec le français
                    dans la même écriture (avec `langue: 'fr'` seulement)
   Une version anglaise VIDE est retirée (le français part alors à tout le
   monde) ; le français, lui, ne se vide pas.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient } from '../lib/supabase';
import { getUserContext, hasPermission, corpsRefusPermission } from '../lib/rbac';
import { validate } from '../lib/validation';
import { logger } from '../lib/logger';
import { langueDe } from '../lib/automations-langue';
import { messageCorbeille, STATUT_CORBEILLE } from '../lib/automations-corbeille';
import { problemesBloquants, messagePublieeCassee } from '../lib/automations-publication';
import { propagerAuxCopies } from '../lib/automatisations-bureaux';
import { variablesInconnues } from '../../src/lib/emailBodyText';
import {
  messagesDeRegle, messageVise, ecritureDeRegle, configApres, texteVisible,
  TEXTO_MAX, OBJET_MAX, COURRIEL_MAX,
  type Ecriture, type Cible, type Config,
} from '../lib/automation-messages';

const router = Router();

/** Colonnes renvoyées au navigateur — les mêmes que `GET /api/automations/rules`. */
const COLONNES = 'id, name, description, trigger_event, conditions, delay_seconds, actions, steps, settings, is_active, is_preset, preset_key, folder_id, modele_id, deleted_at, created_at, updated_at, lumi_conversation';

/* La FORME du corps. Les bornes de longueur d'ici ne sont que des garde-fous
   (rien d'absurde n'entre) : les vraies limites, dites en mots, sont vérifiées
   plus bas, contre le message visé. */
const TEXTE_BRUT_MAX = 200_000;
const texteBrut = z.string().max(TEXTE_BRUT_MAX);
const objetBrut = z.string().max(2_000);
export const corpsMessageSchema = z.object({
  canal: z.enum(['send_sms', 'send_email']),
  etape_id: z.string().trim().min(1).max(64).optional(),
  index_action: z.number().int().min(0).max(199).optional(),
  rang: z.number().int().min(0).max(199).optional(),
  corps_lu: texteBrut.optional(),
  objet_lu: objetBrut.optional(),
  langue: z.enum(['fr', 'en']).default('fr'),
  // Un champ absent reste tel quel (corriger l'objet sans renvoyer le corps).
  texte: texteBrut.optional(),
  objet: objetBrut.optional(),
  version_en: z.object({ texte: texteBrut.optional(), objet: objetBrut.optional() }).strict().optional(),
}).strict().refine(
  (c) => [c.texte, c.objet, c.version_en?.texte, c.version_en?.objet].some((v) => v !== undefined),
  { message: 'Rien à écrire : donnez un texte ou un objet.' },
);

type CorpsMessage = z.infer<typeof corpsMessageSchema>;

/** Les nombres, écrits comme on les lit : « 1 600 » en français, « 1,600 » en anglais. */
const nombre = (n: number, fr: boolean) => n.toLocaleString(fr ? 'fr-CA' : 'en-CA').replace(/ | /g, ' ');

router.patch('/automations/rules/:id/messages', validate(corpsMessageSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const fr = langueDe(req) === 'fr';
  const dire = (francais: string, anglais: string) => (fr ? francais : anglais);

  // Le droit de modifier les automatisations — vérifié ici aussi, que la table
  // des routes (route-permissions.ts) l'ait déjà fait ou non.
  const ctx = req.userContext ?? await getUserContext(auth.client, auth.user.id, auth.orgId);
  if (!ctx) return res.status(403).json({ error: 'No active membership found.' });
  if (!hasPermission(ctx, 'automations.update')) return res.status(403).json(corpsRefusPermission('automations.update'));

  const corps = req.body as CorpsMessage;
  const courriel = corps.canal === 'send_email';
  if (corps.version_en && corps.langue === 'en') {
    return res.status(400).json({
      error: dire('`version_en` accompagne le texte français : elle ne s’emploie pas avec `langue: "en"`.', '`version_en` goes with the French text: it cannot be used with `langue: "en"`.'),
      code: 'corps_invalide',
    });
  }
  const objetDe = (o: string | undefined) => (courriel ? o : undefined);
  const ecriture: Ecriture = corps.langue === 'en'
    ? { body_en: corps.texte, subject_en: objetDe(corps.objet) }
    : {
      body: corps.texte,
      subject: objetDe(corps.objet),
      ...(corps.version_en ? { body_en: corps.version_en.texte, subject_en: objetDe(corps.version_en.objet) } : {}),
    };

  const { data: regle, error: eLecture } = await auth.client
    .from('automation_rules')
    .select('id, is_active, is_preset, trigger_event, conditions, steps, actions, modele_id, deleted_at')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .is('purged_at', null)
    .maybeSingle();
  if (eLecture) {
    logger.error('[automation-messages] lecture avant modification échouée', { message: eLecture.message });
    return res.status(500).json({ error: dire('Impossible de lire l’automatisation.', 'Could not read the automation.') });
  }
  if (!regle) return res.status(404).json({ error: dire('Automatisation introuvable.', 'Automation not found.') });
  // À la corbeille : on restaure d'abord (même refus que la modification d'une règle).
  if (regle.deleted_at) return res.status(STATUT_CORBEILLE).json({ error: messageCorbeille(fr), code: 'corbeille' });

  const cible: Cible = {
    etapeId: corps.etape_id, indexAction: corps.index_action, rang: corps.rang,
    corpsLu: corps.corps_lu, objetLu: objetDe(corps.objet_lu),
  };
  const messages = messagesDeRegle(regle, corps.canal);
  const trouve = messageVise(messages, cible);
  if ('raison' in trouve) {
    if (trouve.raison === 'aucun') {
      return res.status(404).json({
        error: dire('Cette automatisation n’envoie aucun message de ce type. Rien n’a été enregistré.', 'This automation sends no message of this kind. Nothing was saved.'),
        code: 'message_introuvable',
      });
    }
    if (trouve.raison === 'plusieurs') {
      return res.status(400).json({
        error: dire(
          `Cette automatisation envoie ${trouve.nombre} messages de ce type : modifiez celui que vous voulez dans Automatisations.`,
          `This automation sends ${trouve.nombre} messages of this kind: edit the one you want in Automations.`,
        ),
        code: 'message_ambigu',
      });
    }
    return res.status(409).json({
      error: dire(
        'Ce message a été modifié ailleurs depuis l’ouverture de cet écran. Rechargez la page avant de le modifier — rien n’a été enregistré.',
        'This message was changed elsewhere since this screen was opened. Reload the page before editing it — nothing was saved.',
      ),
      code: 'modifiee_ailleurs',
    });
  }
  const vise = trouve.message;
  const avant = vise.config as Config;
  const apres = configApres(avant, corps.canal, ecriture);
  const texteDe = (c: Config, cle: string) => (typeof c[cle] === 'string' ? (c[cle] as string) : '');

  // Le message qui part quand il n'y a pas d'autre version ne se vide jamais.
  if (!texteVisible(texteDe(apres, 'body'))) {
    return res.status(400).json({ error: dire('Le message ne peut pas être vide.', 'The message cannot be empty.'), code: 'message_vide' });
  }
  if (courriel && !texteDe(apres, 'subject').trim()) {
    return res.status(400).json({ error: dire('L’objet du courriel ne peut pas être vide.', 'The email subject cannot be empty.'), code: 'objet_vide' });
  }
  /* Les longueurs — sur ce que CETTE écriture change : un texte déjà trop long
     en base (d'avant la garde) n'empêche pas de corriger l'objet à côté. */
  for (const cle of ['body', 'body_en'] as const) {
    const texte = texteDe(apres, cle);
    if (texte === texteDe(avant, cle)) continue;
    if (!courriel && texte.length > TEXTO_MAX) {
      return res.status(400).json({
        error: dire(
          `Un texto fait ${nombre(TEXTO_MAX, true)} caractères au plus (celui-ci : ${nombre(texte.length, true)}). Raccourcissez-le — rien n’a été enregistré.`,
          `A text is ${nombre(TEXTO_MAX, false)} characters at most (this one: ${nombre(texte.length, false)}). Shorten it — nothing was saved.`,
        ),
        code: 'texto_trop_long',
      });
    }
    if (courriel && texte.length > COURRIEL_MAX) {
      return res.status(400).json({
        error: dire(
          `Un courriel fait ${nombre(COURRIEL_MAX, true)} caractères au plus, mise en forme comprise (celui-ci : ${nombre(texte.length, true)}). Raccourcissez-le — rien n’a été enregistré.`,
          `An email is ${nombre(COURRIEL_MAX, false)} characters at most, formatting included (this one: ${nombre(texte.length, false)}). Shorten it — nothing was saved.`,
        ),
        code: 'courriel_trop_long',
      });
    }
  }
  if (courriel) {
    for (const cle of ['subject', 'subject_en'] as const) {
      const objet = texteDe(apres, cle);
      if (objet === texteDe(avant, cle) || objet.length <= OBJET_MAX) continue;
      return res.status(400).json({
        error: dire(
          `L’objet d’un courriel fait ${OBJET_MAX} caractères au plus (celui-ci : ${objet.length}). Raccourcissez-le — rien n’a été enregistré.`,
          `An email subject is ${OBJET_MAX} characters at most (this one: ${objet.length}). Shorten it — nothing was saved.`,
        ),
        code: 'objet_trop_long',
      });
    }
  }

  const contenu = ecritureDeRegle(regle, vise, ecriture);

  // Une automatisation PUBLIÉE ne se casse pas en silence : mêmes contrôles
  // que la modification d'une règle, sur l'état final.
  if (regle.is_active) {
    const deja = new Set(problemesBloquants(regle, fr));
    const nouveaux = problemesBloquants({ ...regle, ...contenu }, fr).filter((p) => !deja.has(p));
    if (nouveaux.length) {
      return res.status(422).json({ error: messagePublieeCassee(nouveaux, fr), code: 'publiee_cassee', problemes: nouveaux });
    }
  }

  const { data: ecrites, error: eEcriture } = await auth.client
    .from('automation_rules')
    // Modifier une copie liée la détache de son modèle, comme toute modification de contenu.
    .update({ ...contenu, ...(regle.modele_id ? { modele_id: null } : {}), updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .select('id');
  if (eEcriture) {
    if (eEcriture.code === '42501') {
      return res.status(403).json({ error: dire('Votre rôle ne permet pas de modifier une automatisation.', 'Your role does not allow editing an automation.') });
    }
    logger.error('[automation-messages] écriture du message échouée', { rule_id: req.params.id, message: eEcriture.message, code: eEcriture.code });
    return res.status(500).json({
      error: dire('Enregistrement impossible pour le moment : rien n’a été modifié. Réessayez dans un instant.', 'Could not save right now: nothing was changed. Try again in a moment.'),
    });
  }
  // Zéro ligne touchée : la RLS a filtré l'écriture. Ce n'est pas un succès.
  if (!ecrites || ecrites.length === 0) {
    return res.status(403).json({
      error: dire('Modification refusée — vous n’avez pas accès à cette automatisation.', 'Change refused — you do not have access to this automation.'),
      code: 'ecriture_refusee',
    });
  }

  // L'état ENREGISTRÉ, relu : c'est lui que l'écran affiche, pas ce qu'il a envoyé.
  const { data: relue, error: eRelecture } = await auth.client
    .from('automation_rules')
    .select(COLONNES)
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();
  if (eRelecture || !relue) {
    logger.error('[automation-messages] relecture après écriture échouée', { rule_id: req.params.id, message: eRelecture?.message });
    return res.status(500).json({
      error: dire('Le message est enregistré, mais sa relecture a échoué — rechargez la page.', 'The message is saved, but reading it back failed — reload the page.'),
      code: 'relecture_echouee',
    });
  }

  // Modèle partagé : ses copies des autres bureaux suivent, comme pour toute modification de contenu.
  try {
    await propagerAuxCopies(req.header('authorization') as string, auth.user.id, auth.orgId, req.params.id);
  } catch (err: unknown) {
    logger.error('[automation-messages] propagation aux copies échouée', { rule_id: req.params.id, message: err instanceof Error ? err.message : String(err) });
  }

  /* Les variables que le serveur ne saura pas remplir : elles partiraient
     VIDES (« Bonjour , »). Signalées — l'enregistrement, lui, est fait : une
     entreprise peut avoir une raison d'écrire un crochet. */
  const ecrits = [ecriture.body, ecriture.subject, ecriture.body_en, ecriture.subject_en].filter((t): t is string => typeof t === 'string');
  return res.json({ regle: relue, variables_inconnues: variablesInconnues(ecrits.join(' ')) });
});

export default router;
