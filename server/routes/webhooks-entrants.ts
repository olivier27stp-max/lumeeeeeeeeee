/* ═══════════════════════════════════════════════════════════════
   WEBHOOKS ENTRANTS — l'extérieur déclenche une automatisation.

   POST /api/hooks/:cle

   Les automatisations ne partaient que d'événements NÉS dans Lume. Un
   formulaire sur le site de l'entreprise, Zapier, Facebook Leads, un
   fournisseur d'appels : rien ne pouvait rien déclencher. À la question
   « est-ce que ça se branche à mon site ? », la réponse était non.

   CETTE ROUTE EST PUBLIQUE — elle est donc écrite pour être attaquée :

   · la clé (256 bits) est le SEUL secret ; pas de session, pas de
     cookie, donc rien à voler dans un navigateur ;
   · le corps est BORNÉ (64 Ko) : un seul POST ne doit pas pouvoir
     remplir la base ;
   · limiteur de débit par clé : un appelant qui boucle ne peut pas
     noyer le moteur d'automatisations ni la table de journal ;
   · la réponse est la MÊME (404) pour « clé inconnue » et « webhook
     désactivé » — autrement, on confirmerait à un curieux qu'une clé
     existe ;
   · on écrit avec le client service_role, jamais celui de
     l'utilisateur : il n'y a pas d'utilisateur ici.

   CE QU'ELLE NE FAIT PAS. Elle n'écrit aucune donnée CRM : elle émet un
   événement. Une automatisation décide ensuite quoi en faire (créer un
   lead, envoyer un courriel, assigner une tâche). C'est délibéré — une
   route publique qui écrirait des clients serait une porte bien plus
   large, et le mandat interdit d'ouvrir plus que nécessaire.
   ═══════════════════════════════════════════════════════════════ */

import { Router, raw } from 'express';
import { getServiceClient } from '../lib/supabase';
import { eventBus } from '../lib/eventBus';
import { logger } from '../lib/logger';
import { messageTropDeDemandes } from '../lib/message-429';

const router = Router();

/** 64 Ko : large pour un formulaire, trop petit pour servir de dépotoir. */
const TAILLE_MAX = 64 * 1024;

/**
 * Débit par clé. Un formulaire de site fait quelques appels par heure ;
 * 60 par minute laisse toute la marge utile et arrête une boucle.
 */
const FENETRE_MS = 60_000;
const MAX_PAR_FENETRE = 60;
const compteurs = new Map<string, { n: number; finFenetre: number }>();

function tropDeDemandes(cle: string): number | null {
  const maintenant = Date.now();
  const e = compteurs.get(cle);
  if (!e || maintenant > e.finFenetre) {
    compteurs.set(cle, { n: 1, finFenetre: maintenant + FENETRE_MS });
    return null;
  }
  if (e.n >= MAX_PAR_FENETRE) return Math.ceil((e.finFenetre - maintenant) / 1000);
  e.n++;
  return null;
}

/*
 * Ménage : sans ça, une clé appelée une seule fois resterait en mémoire
 * pour toujours. Un processus qui tourne des mois finirait par garder
 * une entrée par clé jamais réutilisée.
 */
setInterval(() => {
  const maintenant = Date.now();
  for (const [cle, e] of compteurs) if (maintenant > e.finFenetre) compteurs.delete(cle);
}, 5 * FENETRE_MS).unref();

/**
 * Le corps est lu en BRUT, pas par `express.json()`.
 *
 * Deux raisons : on veut refuser sur la TAILLE avant de dépenser le
 * temps d'analyse, et un JSON invalide doit produire un message clair
 * plutôt que l'erreur générique du middleware, qui remonterait telle
 * quelle à un intégrateur.
 */
router.post('/hooks/:cle', raw({ type: '*/*', limit: TAILLE_MAX }), async (req, res) => {
  const cle = String(req.params.cle ?? '');

  // Forme attendue : 64 caractères hexadécimaux. On écarte tout le reste
  // sans toucher la base — un scanner d'URL ne doit pas nous coûter une
  // requête SQL par essai.
  if (!/^[0-9a-f]{64}$/.test(cle)) {
    return res.status(404).json({ error: 'Webhook introuvable.' });
  }

  const attente = tropDeDemandes(cle);
  if (attente !== null) {
    res.set('Retry-After', String(attente));
    return res.status(429).json({ error: messageTropDeDemandes(attente) });
  }

  const admin = getServiceClient();

  const { data: hook, error: erreurLecture } = await admin
    .from('automation_webhooks')
    .select('id, org_id, enabled, deleted_at')
    .eq('api_key', cle)
    .is('deleted_at', null)
    .maybeSingle();

  if (erreurLecture) {
    logger.error('[webhooks-entrants] lecture échouée', { message: erreurLecture.message });
    return res.status(500).json({ error: 'Impossible de traiter l’appel pour le moment.' });
  }

  // Même réponse pour « inconnue » et « désactivé » : sinon on confirme
  // l'existence d'une clé à qui la devine.
  if (!hook || !hook.enabled) {
    return res.status(404).json({ error: 'Webhook introuvable.' });
  }

  // ── Le corps ──────────────────────────────────────────────

  let corps: unknown = null;
  let motifRefus: string | null = null;

  const brut = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (brut.length > TAILLE_MAX) {
    motifRefus = 'corps trop volumineux';
  } else if (brut.length > 0) {
    const texte = brut.toString('utf8');
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    /*
     * JSON OU formulaire. Zapier envoie par défaut en `form-urlencoded`,
     * un formulaire HTML de site aussi : n'accepter que le JSON faisait
     * échouer ces intégrations avec leurs réglages par défaut. Les deux
     * formes produisent le même objet à plat, filtrable pareil.
     */
    if (type.includes('application/x-www-form-urlencoded')) {
      corps = Object.fromEntries(new URLSearchParams(texte));
    } else {
      try {
        corps = JSON.parse(texte);
      } catch {
        motifRefus = 'corps illisible : JSON ou formulaire attendu';
      }
    }
  }

  if (motifRefus) {
    // On journalise même le refus : « mon webhook ne marche pas » se
    // diagnostique en regardant ce qui est arrivé, pas en devinant.
    await admin.from('automation_webhook_receipts').insert({
      webhook_id: hook.id, org_id: hook.org_id, statut: 'refuse', motif: motifRefus, corps: null,
    });
    return res.status(400).json({ error: `Appel refusé : ${motifRefus}.` });
  }

  // ── L'événement ───────────────────────────────────────────

  /*
   * `entityId` = l'id du webhook. Il n'y a pas d'entité CRM derrière un
   * appel extérieur, et le moteur a besoin d'un id stable pour sa clé
   * d'anti-doublon.
   */
  await eventBus.emit('webhook.received', {
    orgId: hook.org_id,
    entityType: 'automation_webhook',
    entityId: hook.id,
    /*
     * Les champs du JSON reçu sont étalés au premier niveau, EN PLUS de
     * `corps`.
     *
     * Sans ça, un filtre « source = facebook » ne trouvait rien : le
     * moteur lit `metadata.source`, et tout était enfoui sous
     * `metadata.corps.source`. On ne pouvait donc filtrer sur RIEN de ce
     * que le service extérieur envoie — constaté le 2026-09-25 en
     * éprouvant les filtres de date.
     *
     * `corps` reste disponible entier, et nos deux champs sont posés
     * APRÈS : un JSON qui porterait « recu_le » ne peut pas écraser
     * l'heure que nous avons constatée.
     */
    metadata: {
      ...(corps !== null && typeof corps === 'object' && !Array.isArray(corps)
        ? (corps as Record<string, unknown>)
        : {}),
      corps,
      recu_le: new Date().toISOString(),
    },
  });

  const { error: erreurTrace } = await admin.from('automation_webhook_receipts').insert({
    webhook_id: hook.id, org_id: hook.org_id, statut: 'accepte', corps: corps as object | null,
  });
  if (erreurTrace) {
    // La trace a échoué mais l'événement est parti : on le dit dans les
    // logs sans faire échouer l'appelant, qui n'y peut rien et
    // réessaierait — ce qui déclencherait l'automatisation deux fois.
    logger.error('[webhooks-entrants] trace non écrite', { message: erreurTrace.message });
  }

  return res.json({ ok: true });
});

export default router;
