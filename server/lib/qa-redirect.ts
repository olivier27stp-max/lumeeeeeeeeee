/**
 * Mode QA — redirection des envois réels vers un destinataire de test.
 *
 * POURQUOI CE FICHIER EXISTE
 * Le robot de recette (voir le plan « Le robot testeur de Lume ») déclenche de
 * vraies automatisations, y compris en production. Or le destinataire d'un SMS
 * ou d'un courriel est toujours dérivé de la donnée réelle (`clients.phone`,
 * `clients.email` via `resolveEntityVariables`). Sans garde-fou, tester une
 * relance de devis enverrait un message au vrai client.
 *
 * CE QUE FAIT LE MODE QA
 * Quand `QA_REDIRECT_TO` (SMS) ou `QA_REDIRECT_EMAIL` (courriel) est défini,
 * TOUT message part vers ce destinataire, quel que soit celui prévu. Le
 * destinataire d'origine est écrit en tête du message :
 *
 *     [QA → +15145550123] Bonjour Marc, votre rendez-vous est confirmé…
 *
 * On voit donc exactement ce qu'un client aurait reçu, sans qu'aucun client ne
 * reçoive quoi que ce soit.
 *
 * OÙ IL S'APPLIQUE
 * Les SMS sortent par 8 sites d'appel `.messages.create` dispersés (actions,
 * routes devis/contrats/messages/demandes de paiement, MFA…). Plutôt que de
 * patcher huit endroits — et d'en oublier un le jour où un neuvième apparaît —
 * on enveloppe le client Twilio lui-même dans `config.ts`, à l'unique endroit
 * où il est instancié. Les courriels ont déjà un point de passage unique :
 * `sendEmail` dans `mailer.ts`.
 *
 * SÉCURITÉ
 * Le mode est INACTIF par défaut : sans les variables, ces fonctions sont des
 * passe-plats. Les variables vivent dans `.env.local` (jamais commité) et dans
 * les variables d'environnement Railway pour la production.
 */

/** Numéro de test pour les SMS. Vide = mode inactif. */
function cibleSms(): string {
  return (process.env.QA_REDIRECT_TO || '').trim();
}

/** Adresse de test pour les courriels. Vide = mode inactif. */
function cibleEmail(): string {
  return (process.env.QA_REDIRECT_EMAIL || '').trim();
}

/** Le mode QA est-il actif pour au moins un canal ? */
export function qaRedirectActif(): boolean {
  return Boolean(cibleSms() || cibleEmail());
}

/** Résumé lisible, pour la bannière de démarrage du serveur. */
export function qaRedirectResume(): string {
  const sms = cibleSms();
  const mail = cibleEmail();
  const bouts: string[] = [];
  if (sms) bouts.push(`SMS → ${sms}`);
  if (mail) bouts.push(`courriel → ${mail}`);
  return bouts.join(', ');
}

/**
 * Masque partiellement un destinataire : on garde de quoi le reconnaître sans
 * réécrire le numéro complet d'un client dans un message qui, lui, part
 * vraiment. `+15145550123` → `+1514…0123`.
 */
function masquer(valeur: string): string {
  const v = String(valeur || '');
  if (v.includes('@')) {
    const [nom, domaine] = v.split('@');
    const debut = nom.slice(0, 2);
    return `${debut}${nom.length > 2 ? '…' : ''}@${domaine}`;
  }
  if (v.length <= 8) return v;
  return `${v.slice(0, 5)}…${v.slice(-4)}`;
}

export interface RedirectionSms {
  /** Destinataire à utiliser réellement. */
  to: string;
  /** Corps à utiliser réellement (préfixé si redirigé). */
  body: string;
  /** Vrai si la redirection s'est appliquée. */
  redirige: boolean;
  /** Destinataire d'origine, pour la journalisation. */
  destinataireOrigine: string;
}

/**
 * Applique la redirection à un SMS. Passe-plat si le mode est inactif.
 */
export function redirigerSms(to: string, body: string): RedirectionSms {
  const cible = cibleSms();
  if (!cible) {
    return { to, body, redirige: false, destinataireOrigine: to };
  }
  // Déjà destiné à la cible : ne pas empiler les préfixes.
  if (to === cible) {
    return { to, body, redirige: false, destinataireOrigine: to };
  }
  return {
    to: cible,
    body: `[QA → ${masquer(to)}] ${body}`,
    redirige: true,
    destinataireOrigine: to,
  };
}

export interface RedirectionEmail {
  to: string | string[];
  subject: string;
  redirige: boolean;
  destinataireOrigine: string;
}

/**
 * Applique la redirection à un courriel. Le destinataire d'origine va dans
 * l'objet, où il reste visible dans la liste des messages reçus.
 */
export function redirigerEmail(
  to: string | string[],
  subject: string,
): RedirectionEmail {
  const cible = cibleEmail();
  const origine = Array.isArray(to) ? to.join(', ') : String(to || '');
  if (!cible) {
    return { to, subject, redirige: false, destinataireOrigine: origine };
  }
  if (origine === cible) {
    return { to, subject, redirige: false, destinataireOrigine: origine };
  }
  return {
    to: cible,
    subject: `[QA → ${masquer(origine)}] ${subject}`,
    redirige: true,
    destinataireOrigine: origine,
  };
}

/**
 * Enveloppe un client Twilio pour rediriger tout `messages.create`.
 *
 * Renvoie le client tel quel si le mode est inactif — aucun surcoût en
 * fonctionnement normal.
 */
export function envelopperTwilio<T extends { messages: { create: (opts: any) => any } }>(
  client: T | null,
): T | null {
  if (!client) return null;
  if (!cibleSms()) return client;

  const creationOrigine = client.messages.create.bind(client.messages);

  const creationRedirigee = async (opts: any) => {
    const { to, body, ...reste } = opts || {};
    const r = redirigerSms(String(to || ''), String(body || ''));
    if (r.redirige) {
      console.warn(`[qa] SMS redirigé : ${r.destinataireOrigine} → ${r.to}`);
    }
    return creationOrigine({ ...reste, to: r.to, body: r.body });
  };

  // On ne remplace que `messages.create` : le reste du client (lookups,
  // numéros, sous-comptes) doit continuer de fonctionner à l'identique.
  return new Proxy(client, {
    get(cible, prop, recepteur) {
      if (prop !== 'messages') return Reflect.get(cible, prop, recepteur);
      const messages = Reflect.get(cible, prop, recepteur);
      return new Proxy(messages, {
        get(m, p, r) {
          if (p === 'create') return creationRedirigee;
          const v = Reflect.get(m, p, r);
          return typeof v === 'function' ? v.bind(m) : v;
        },
      });
    },
  }) as T;
}
