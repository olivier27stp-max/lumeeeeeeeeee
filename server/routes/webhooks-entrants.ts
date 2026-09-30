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

import { randomUUID } from 'node:crypto';
import { Router, raw } from 'express';
import { getServiceClient } from '../lib/supabase';
import { eventBus } from '../lib/eventBus';
import { logger } from '../lib/logger';
import { messageTropDeDemandes } from '../lib/message-429';
import { extractIP } from '../lib/security';
import { horsForfaitPourOrg } from '../lib/feature-guard';

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

/**
 * Débit des ÉCHECS par adresse IP (audit V2, C22).
 *
 * Le limiteur par clé ne voit rien d'un curieux qui essaie une clé
 * DIFFÉRENTE à chaque appel : 80 clés au hasard = 80 × 404 et 80 requêtes
 * SQL, sans aucun 429 (la route est montée avant le limiteur global). On
 * compte donc les 404 par IP : au-delà de 20 par minute, 429 sans toucher
 * la base. Seuls les ÉCHECS comptent — Zapier appelle depuis des IP
 * partagées par tous ses clients, une vraie clé ne doit jamais être freinée
 * par le trafic des autres.
 */
const MAX_ECHECS_PAR_IP = 20;
const echecsParIp = new Map<string, { n: number; finFenetre: number }>();

function ipBloquee(ip: string): number | null {
  const e = echecsParIp.get(ip);
  if (!e || Date.now() > e.finFenetre) return null;
  return e.n >= MAX_ECHECS_PAR_IP ? Math.ceil((e.finFenetre - Date.now()) / 1000) : null;
}

function noterEchec(ip: string): void {
  const maintenant = Date.now();
  const e = echecsParIp.get(ip);
  if (!e || maintenant > e.finFenetre) echecsParIp.set(ip, { n: 1, finFenetre: maintenant + FENETRE_MS });
  else e.n++;
}

/** Pour les tests : repartir d'une mémoire vide. */
export function oublierCompteursWebhooks(): void {
  compteurs.clear();
  echecsParIp.clear();
}

/*
 * Ménage : sans ça, une clé appelée une seule fois resterait en mémoire
 * pour toujours. Un processus qui tourne des mois finirait par garder
 * une entrée par clé jamais réutilisée.
 */
setInterval(() => {
  const maintenant = Date.now();
  for (const [cle, e] of compteurs) if (maintenant > e.finFenetre) compteurs.delete(cle);
  for (const [ip, e] of echecsParIp) if (maintenant > e.finFenetre) echecsParIp.delete(ip);
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
  const ip = extractIP(req);

  const bloquee = ipBloquee(ip);
  if (bloquee !== null) {
    res.set('Retry-After', String(bloquee));
    return res.status(429).json({ error: messageTropDeDemandes(bloquee) });
  }

  // Forme attendue : 64 caractères hexadécimaux. On écarte tout le reste
  // sans toucher la base — un scanner d'URL ne doit pas nous coûter une
  // requête SQL par essai.
  if (!/^[0-9a-f]{64}$/.test(cle)) {
    noterEchec(ip);
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
    noterEchec(ip);
    return res.status(404).json({ error: 'Webhook introuvable.' });
  }

  // Garde de forfait (audit V2, C33) : le middleware ne voit pas cette route
  // (pas d'utilisateur) ; la clé désigne le bureau, dont le forfait doit
  // inclure les automatisations. Même mode que partout (FEATURE_GUARD).
  if (await horsForfaitPourOrg(hook.org_id, 'includes_automations', { contexte: 'POST /api/hooks' })) {
    return res.status(403).json({
      error: 'feature_not_in_plan',
      feature: 'includes_automations',
      message: 'Le forfait de cette entreprise n’inclut pas les automatisations. / This business’s plan does not include automations.',
    });
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
   * La trace d'abord : son id devient l'ENTITÉ de l'événement.
   *
   * L'entité était l'id du WEBHOOK, le même pour tous les appels : deux
   * prospects arrivés à moins de 2 minutes d'écart (Zapier, Facebook)
   * partageaient la clé anti-doublon « règle + entité », et le 2e était
   * reçu, consigné… et jamais traité (audit V2, D-02). Chaque appel reçu
   * est une occurrence distincte ; un vrai rejeu du MÊME appel reste
   * arrêté par l'outbox.
   */
  const { data: trace, error: erreurTrace } = await admin.from('automation_webhook_receipts').insert({
    webhook_id: hook.id, org_id: hook.org_id, statut: 'accepte', corps: corps as object | null,
  }).select('id').single();
  if (erreurTrace) {
    // La trace a échoué : l'événement part quand même, avec un id propre à
    // cet appel. On ne fait pas échouer l'appelant, qui réessaierait — ce
    // qui déclencherait l'automatisation deux fois.
    logger.error('[webhooks-entrants] trace non écrite', { message: erreurTrace.message });
  }
  const occurrence = (trace as { id?: string } | null)?.id ?? randomUUID();

  await eventBus.emit('webhook.received', {
    orgId: hook.org_id,
    entityType: 'automation_webhook_receipt',
    entityId: occurrence,
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
     * `corps` reste disponible entier, et nos champs sont posés APRÈS : un
     * JSON qui porterait « recu_le » ne peut pas écraser l'heure que nous
     * avons constatée.
     */
    metadata: {
      ...champsFiltrables(corps),
      corps,
      // Le corps reçu, rangé à part (launch 2026-09-28).
      webhook: corps,
      webhook_id: hook.id,
      recu_le: new Date().toISOString(),
    },
  });

  return res.json({ ok: true });
});

/**
 * Les champs du JSON reçu, étalés au premier niveau pour que les FILTRES
 * marchent (« source = facebook », voir plus haut) — SANS aucun champ de
 * contrôle du moteur. Launch 2026-09-28 : un JSON portant `chaine` ou
 * `suppress_immediate` pilotait l'anti-boucle ou supprimait des
 * confirmations ; un appel extérieur ne décide jamais de ça.
 */
export const CHAMPS_RESERVES_MOTEUR = new Set([
  'chaine', 'suppress_immediate', 'evenement_base_id', 'origine', 'outboxId', 'reglesTraitees',
  'rejoueDepuis', 'dejaEnvoyeDepuis', 'corps', 'webhook', 'recu_le', 'webhook_id', 'passage',
]);
export function champsFiltrables(corps: unknown): Record<string, unknown> {
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps)) return {};
  return Object.fromEntries(Object.entries(corps as Record<string, unknown>).filter(([cle]) => !CHAMPS_RESERVES_MOTEUR.has(cle)));
}

export default router;
