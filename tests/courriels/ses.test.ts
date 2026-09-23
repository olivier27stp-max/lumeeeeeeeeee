/**
 * Amazon SES : choix du fournisseur, identifiants SMTP, traduction des
 * notifications SNS. Pur, sans réseau ni base.
 *
 * Le piège que ces tests ferment : un rebond « Transient » (boîte pleine,
 * serveur du client en panne) n'est PAS une adresse morte. Le traiter comme
 * un rebond définitif bannirait un vrai client de toutes ses relances.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hoteSmtpSes, reglagesSmtpSes, sesConfigure, messageIdSes, evenementDepuisSns, deplierMessageSns, urlDeConfirmationSns, REGION_SES_DEFAUT } from '../../server/lib/courriels/ses';
import { fournisseurCourriel } from '../../server/lib/mailer';
import { statutPourEvenement, jetonValide } from '../../server/routes/webhooks-ses';

const AVEC_SES = { SES_SMTP_USER: 'AKIAX', SES_SMTP_PASS: 'secret' } as NodeJS.ProcessEnv;

describe('réglages SES', () => {
  it('l’hôte suit la région ; le Canada par défaut', () => {
    expect(hoteSmtpSes()).toBe(`email-smtp.${REGION_SES_DEFAUT}.amazonaws.com`);
    expect(hoteSmtpSes('us-east-1')).toBe('email-smtp.us-east-1.amazonaws.com');
  });
  it('sans identifiants, SES n’est pas configuré (on ne bascule jamais à moitié)', () => {
    expect(reglagesSmtpSes({} as NodeJS.ProcessEnv)).toBeNull();
    expect(sesConfigure({} as NodeJS.ProcessEnv)).toBe(false);
    expect(sesConfigure({ SES_SMTP_USER: 'AKIAX' } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('avec identifiants : port 587 en STARTTLS', () => {
    const r = reglagesSmtpSes({ ...AVEC_SES, SES_REGION: 'us-east-1' })!;
    expect(r).toEqual({ host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false, auth: { user: 'AKIAX', pass: 'secret' } });
  });
});

describe('choix du fournisseur', () => {
  it('la variable tranche ; un fournisseur non configuré est ignoré', () => {
    expect(fournisseurCourriel({ COURRIEL_FOURNISSEUR: 'ses', ...AVEC_SES } as NodeJS.ProcessEnv)).toBe('ses');
    // SES demandé mais pas configuré → on n'arrête pas d'envoyer pour autant.
    expect(fournisseurCourriel({ COURRIEL_FOURNISSEUR: 'ses', RESEND_API_KEY: 're_x' } as NodeJS.ProcessEnv)).toBe('resend');
    expect(fournisseurCourriel({ COURRIEL_FOURNISSEUR: 'resend', RESEND_API_KEY: 're_x', ...AVEC_SES } as NodeJS.ProcessEnv)).toBe('resend');
    expect(fournisseurCourriel({ COURRIEL_FOURNISSEUR: 'smtp', ...AVEC_SES } as NodeJS.ProcessEnv)).toBe('smtp');
  });
  it('SES n’est JAMAIS choisi tout seul : la bascule reste volontaire', () => {
    /* Ce test vérifiait l'INVERSE jusqu'au 2026-09-22, et contredisait le
       commentaire de `fournisseurCourriel` qui le surplombait.

       SES démarre en BAC À SABLE : 200 courriels par jour, et il refuse toute
       adresse destinataire non vérifiée à la main. Poser les identifiants pour
       préparer la bascule — ce qu'on fait forcément avant de demander la
       « production access » à Amazon — aurait donc détourné TOUS les envois
       vers un compte qui les rejette, sans le moindre signe.

       La bascule se fait le jour J, par `COURRIEL_FOURNISSEUR=ses`. */
    expect(fournisseurCourriel({ ...AVEC_SES, RESEND_API_KEY: 're_x' } as NodeJS.ProcessEnv)).toBe('resend');
    expect(fournisseurCourriel({ ...AVEC_SES } as NodeJS.ProcessEnv)).toBe('smtp');
    // Demandé explicitement, il sert : c'est le seul chemin vers SES.
    expect(fournisseurCourriel({ ...AVEC_SES, COURRIEL_FOURNISSEUR: 'ses' } as NodeJS.ProcessEnv)).toBe('ses');
  });

  it('sans variable : Resend s’il est configuré, sinon SMTP', () => {
    expect(fournisseurCourriel({ RESEND_API_KEY: 're_x' } as NodeJS.ProcessEnv)).toBe('resend');
    expect(fournisseurCourriel({} as NodeJS.ProcessEnv)).toBe('smtp');
  });
});

describe('identifiant de message', () => {
  it('les chevrons et le domaine tombent : SNS cite la partie nue', () => {
    expect(messageIdSes('<010001abc@eu-west-1.amazonses.com>')).toBe('010001abc');
    expect(messageIdSes('010001abc')).toBe('010001abc');
    expect(messageIdSes(null)).toBe('');
  });
});

describe('notifications SNS', () => {
  const mail = { messageId: '<010001abc@ca-central-1.amazonses.com>', timestamp: '2026-09-17T14:00:00Z', destination: ['client@exemple.ca'] };
  it('un rebond PERMANENT est définitif ; un TRANSIENT ne l’est pas', () => {
    const permanent = evenementDepuisSns({ eventType: 'Bounce', mail, bounce: { bounceType: 'Permanent', timestamp: '2026-09-17T14:01:00Z', bouncedRecipients: [{ emailAddress: 'client@exemple.ca', diagnosticCode: 'smtp; 550 5.1.1 user unknown' }] } })!;
    expect(permanent).toMatchObject({ type: 'bounced', messageId: '010001abc', destinataires: ['client@exemple.ca'], definitif: true });
    expect(permanent.detail).toContain('550');
    const transitoire = evenementDepuisSns({ notificationType: 'Bounce', mail, bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'client@exemple.ca' }] } })!;
    expect(transitoire.definitif).toBe(false);
    // Et surtout : il ne change PAS le statut de la ligne.
    expect(statutPourEvenement(transitoire)).toBeNull();
    expect(statutPourEvenement(permanent)).toBe('bounced');
  });
  it('plainte, livraison, ouverture et clic', () => {
    expect(evenementDepuisSns({ eventType: 'Complaint', mail, complaint: { complainedRecipients: [{ emailAddress: 'x@y.ca' }], complaintFeedbackType: 'abuse' } })).toMatchObject({ type: 'complained', detail: 'abuse' });
    expect(evenementDepuisSns({ eventType: 'Delivery', mail, delivery: { recipients: ['x@y.ca'] } })).toMatchObject({ type: 'delivered' });
    expect(evenementDepuisSns({ eventType: 'Open', mail, open: { timestamp: '2026-09-17T15:00:00Z' } })).toMatchObject({ type: 'opened', quand: '2026-09-17T15:00:00Z' });
    expect(evenementDepuisSns({ eventType: 'Click', mail, click: { link: 'https://lumecrm.net/pay/abc' } })).toMatchObject({ type: 'clicked', url: 'https://lumecrm.net/pay/abc' });
  });
  it('un type inconnu, un corps vide ou sans messageId : rien', () => {
    expect(evenementDepuisSns({ eventType: 'Send', mail })).toBeNull();
    expect(evenementDepuisSns({ eventType: 'Bounce' })).toBeNull();
    expect(evenementDepuisSns(null)).toBeNull();
  });
  it('le vrai message est déplié de l’enveloppe SNS', () => {
    const interne = { eventType: 'Delivery', mail, delivery: { recipients: ['x@y.ca'] } };
    expect(evenementDepuisSns(deplierMessageSns({ Type: 'Notification', Message: JSON.stringify(interne) }))).toMatchObject({ type: 'delivered' });
    // Un Message illisible ne fait pas tomber la route.
    expect(deplierMessageSns({ Message: 'pas du json' })).toEqual({ Message: 'pas du json' });
  });
  it('la confirmation d’abonnement n’est suivie que sur un domaine AWS', () => {
    expect(urlDeConfirmationSns({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://sns.ca-central-1.amazonaws.com/?Action=Confirm' })).toContain('amazonaws.com');
    expect(urlDeConfirmationSns({ Type: 'SubscriptionConfirmation', SubscribeURL: 'https://mechant.example.com/x' })).toBeNull();
    expect(urlDeConfirmationSns({ Type: 'Notification', SubscribeURL: 'https://sns.ca-central-1.amazonaws.com/x' })).toBeNull();
  });
});

describe('garde du webhook SES', () => {
  it('le jeton est comparé en temps constant, et un jeton absent ne passe jamais', () => {
    expect(jetonValide('secret', 'secret')).toBe(true);
    expect(jetonValide('autre', 'secret')).toBe(false);
    expect(jetonValide('', '')).toBe(false);
    expect(jetonValide(undefined, 'secret')).toBe(false);
  });
  it('un blanc invisible ne fait plus échouer un jeton pourtant correct', () => {
    /* Vécu le 2026-09-22 : l'abonnement SNS restait « en attente de
       confirmation », et la seule trace était « jeton invalide ». Les deux
       valeurs étaient identiques — à un espace de fin près, qu'aucune interface
       n'affiche, ni celle de Railway ni celle d'Amazon. La comparaison échouait
       sur la LONGUEUR avant même de comparer quoi que ce soit.

       Nettoyer les deux côtés ne relâche rien : un jeton ne contient jamais
       d'espace, donc aucune valeur refusée avant ne devient acceptée. */
    const vrai = 'jeton-de-trente-deux-caracteres!';
    expect(jetonValide(`${vrai} `, vrai)).toBe(true);
    expect(jetonValide(vrai, `${vrai}\n`)).toBe(true);
    expect(jetonValide(` ${vrai}`, ` ${vrai} `)).toBe(true);
    // Un jeton réellement différent reste refusé, blancs ou pas.
    expect(jetonValide(`${vrai}x `, vrai)).toBe(false);
    // Et un jeton qui n'est QUE des blancs vaut un jeton absent.
    expect(jetonValide(vrai, '   ')).toBe(false);
  });
  it('la route est publique et montée en corps brut, sans jeton configuré elle répond 503', () => {
    const index = readFileSync(resolve(__dirname, '..', '..', 'server', 'index.ts'), 'utf8');
    expect(index).toContain("'/webhooks/ses'");
    expect(index).toContain("app.post('/api/webhooks/ses', express.raw(");
    const route = readFileSync(resolve(__dirname, '..', '..', 'server', 'routes', 'webhooks-ses.ts'), 'utf8');
    expect(route).toContain("res.status(503)");
    expect(route).toContain("res.status(401)");
  });
});

