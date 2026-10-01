/**
 * E — CLASSEMENT DES ERREURS : `isTransientFailure` décide si une tâche en
 * échec est reprise (5 min, 30 min, 2 h) ou abandonnée tout de suite avec
 * une notification. Se tromper coûte dans les deux sens :
 *  · une erreur DÉFINITIVE reprise 4 fois retarde de 2 h 35 la notification
 *    qui dit à l'entrepreneur d'agir, et une demande d'avis reprise crée un
 *    nouveau sondage à chaque essai ;
 *  · une panne PASSAGÈRE (DNS) jugée définitive perd l'envoi.
 *
 * Les messages ci-dessous sont les textes EXACTS rendus par les actions
 * (server/lib/actions/index.ts) et par la garde d'adresse (url-sortante.ts).
 */
import { describe, it, expect } from 'vitest';
import { isTransientFailure } from '../../../server/lib/automationEngine';
import { posterSansSsrf } from '../../../server/lib/url-sortante';

const DEFINITIVES = [
  // Configuration ou données qui ne changeront pas d'elles-mêmes dans les 2 h.
  'No Google or Facebook review link configured. Set one in Settings → Customer reviews.',
  'Review requests are disabled in Settings → Customer reviews.',
  'Client has no email address or phone number.',
  'Client has no email address.',
  'Client has no phone number.',
  'A review request was already sent to this client in the last 7 days.',
  'Table not allowed for update_status: payments',
  'Unknown action type: envoyer_pigeon',
  'No org owner found to own the task',
  'Aucune étiquette à ajouter.',
  'Aucune étiquette à retirer.',
  'Aucun client rattaché à cette entité.',
  'La note est vide.',
  'Aucune automatisation choisie.',
  'Une automatisation ne peut pas se démarrer elle-même.',
  'Automatisation introuvable.',
  '« Relance » est en brouillon : rien à démarrer.',
  '« Relance » n\'a aucune action.',
  'move_deal_stage s\'applique à un deal ou à une soumission (reçu : client).',
  'move_deal_stage : stage_id (ou vers_role) manquant.',
  'Deal introuvable dans cette organisation.',
  'Étape introuvable dans cette organisation.',
  'L\'étape visée appartient à un autre pipeline.',
  'L\'étape « Gagné » est archivée.',
  'Statut inconnu : peut-etre',
  'Valeur invalide : xyz',
  'Rien à modifier : tous les champs sont vides.',
  'Aucun statut choisi.',
  'Aucun lien public pour ce document.',
  // Webhook : le destinataire REFUSE la requête (4xx) — la même requête sera refusée.
  'Le serveur distant a répondu 400.',
  'Le serveur distant a répondu 401.',
  'Le serveur distant a répondu 404.',
  'Le serveur distant a répondu 410.',
  // Déjà définitives avant cette suite (non-régression).
  'Adresse refusée : elle ne pointe pas vers une adresse publique.',
  'Adresse refusée : plus de 3 redirections.',
  'SMTP not configured',
  'Frequency cap reached for +15145550100 (max 3 commercial messages / 24h) — skipped to avoid spamming',
];

const PASSAGERES = [
  'Fournisseur simulé en panne (bac à sable)',
  'Délai dépassé — fournisseur simulé (bac à sable)',
  'move_deal_stage n\'a pas répondu en 5 s — résultat en attente (l’action continue)',
  'send_email n\'a pas répondu en 5 s — résultat en attente (l’action continue)',
  'Service d’envoi de courriels injoignable, nouvel essai automatique / Email service unreachable, retrying automatically (connect ECONNREFUSED 1.2.3.4:587)',
  'Appel impossible : fetch failed',
  'Le serveur distant a répondu 500.',
  'Le serveur distant a répondu 502.',
  'Le serveur distant a répondu 503.',
  // 408 (délai), 425 (trop tôt), 429 (trop de requêtes) : réessayer plus tard est la réponse attendue.
  'Le serveur distant a répondu 408.',
  'Le serveur distant a répondu 429.',
  'Vérification « déjà envoyé » impossible — envoi reporté',
  'Lecture du carnet de clients impossible (erreur technique) — envoi suspendu',
  'Authenticate',
  '',
];

describe('E — isTransientFailure : erreurs définitives', () => {
  for (const m of DEFINITIVES) {
    it(`[E-040] définitive, jamais reprise : « ${m.slice(0, 70)} »`, () => {
      expect(isTransientFailure(m)).toBe(false);
    });
  }
});

describe('E — isTransientFailure : pannes passagères', () => {
  for (const m of PASSAGERES) {
    it(`[E-041] passagère, reprise : « ${m.slice(0, 70) || '(vide)'} »`, () => {
      expect(isTransientFailure(m)).toBe(true);
    });
  }
});

describe('E — une panne DNS passagère n’est pas une « adresse refusée »', () => {
  const panne = (code: string) => async () => { throw Object.assign(new Error(`getaddrinfo ${code} hooks.exemple.com`), { code }); };

  it('[E-042] EAI_AGAIN (résolveur indisponible) → erreur passagère, reprise', async () => {
    const e = await posterSansSsrf('https://hooks.exemple.com/x', {}, { resoudre: panne('EAI_AGAIN') }).catch((x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).not.toMatch(/^Adresse refusée/);
    expect(isTransientFailure(`Appel impossible : ${(e as Error).message}`)).toBe(true);
  });

  it('[E-043] ENOTFOUND (le nom n’existe pas) reste refusé, définitif', async () => {
    const e = await posterSansSsrf('https://hooks.exemple.com/x', {}, { resoudre: panne('ENOTFOUND') }).catch((x: Error) => x);
    expect((e as Error).message).toMatch(/^Adresse refusée/);
    expect(isTransientFailure((e as Error).message)).toBe(false);
  });
});
