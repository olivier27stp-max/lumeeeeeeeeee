/**
 * Quel fournisseur de courriel sert vraiment (2026-09-22).
 *
 * Incident : `RESEND_API_KEY` était posée sur Railway et les 37 envois de la
 * prod partaient quand même par SMTP. Le SMTP ne renvoie AUCUN accusé, donc
 * ouvertures, clics et rebonds sont restés à zéro pendant des semaines —
 * invisible, jusqu'à ce qu'on pense à lire la colonne `provider`.
 *
 * Ces tests figent la logique de choix ET le diagnostic qui l'explique.
 */
import { describe, it, expect } from 'vitest';
import { fournisseurCourriel, raisonSmtpMalgreResend, raisonSesSansSuivi } from '../../server/lib/mailer';

describe('choix du fournisseur', () => {
  it('une clé Resend seule suffit à basculer', () => {
    expect(fournisseurCourriel({ RESEND_API_KEY: 're_x' })).toBe('resend');
  });

  it('COURRIEL_FOURNISSEUR=smtp gagne sur la clé : c’est un interrupteur volontaire', () => {
    expect(fournisseurCourriel({ RESEND_API_KEY: 're_x', COURRIEL_FOURNISSEUR: 'smtp' })).toBe('smtp');
  });

  it('une clé vide ne bascule pas', () => {
    expect(fournisseurCourriel({ RESEND_API_KEY: '' })).toBe('smtp');
  });

  it('sans rien, SMTP', () => {
    expect(fournisseurCourriel({})).toBe('smtp');
  });
});

describe('diagnostic « pourquoi SMTP »', () => {
  it('nomme la variable qui force l’ancien chemin', () => {
    const r = raisonSmtpMalgreResend({ RESEND_API_KEY: 're_x', COURRIEL_FOURNISSEUR: 'smtp' });
    expect(r).toContain('COURRIEL_FOURNISSEUR=smtp');
    expect(r).toContain('retirer cette variable');
  });

  it('distingue la clé DÉCLARÉE mais vide : elle se repose, elle ne se retire pas', () => {
    const r = raisonSmtpMalgreResend({ RESEND_API_KEY: '   ' });
    expect(r).toContain('vide');
  });

  it('se tait quand tout va bien', () => {
    expect(raisonSmtpMalgreResend({ RESEND_API_KEY: 're_x' })).toBeNull();
    // SMTP assumé, sans clé Resend : rien à signaler.
    expect(raisonSmtpMalgreResend({})).toBeNull();
  });

  it('se tait aussi quand SES est choisi', () => {
    expect(raisonSmtpMalgreResend({
      SES_SMTP_USER: 'u', SES_SMTP_PASSWORD: 'p', SES_REGION: 'ca-central-1',
    })).toBeNull();
  });
});

describe('la route de santé expose le fournisseur', () => {
  it('sans jamais exposer la clé elle-même', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('server/index.ts', 'utf8');
    expect(src).toContain('fournisseur: fournisseurCourriel()');
    // Un booléen, jamais la valeur : /api/health est public.
    expect(src).toContain('resend_cle: Boolean(');
    expect(src).not.toMatch(/resend_cle:\s*process\.env\.RESEND_API_KEY[,\s}]/);
  });
});

describe('une clé faite d’espaces', () => {
  it('ne bascule pas : « » est VRAI en JavaScript', () => {
    // Sans `.trim()`, on partait sur Resend avec une clé inutilisable et
    // chaque envoi échouait en 401 au lieu de retomber sur le SMTP.
    expect(fournisseurCourriel({ RESEND_API_KEY: '   ' })).toBe('smtp');
    expect(fournisseurCourriel({ RESEND_API_KEY: '  ', COURRIEL_FOURNISSEUR: 'resend' })).toBe('smtp');
  });
});

describe('le diagnostic dit QUI envoie, pas seulement « smtp »', () => {
  it('expose l’hôte SMTP, qui seul révèle le vrai fournisseur', async () => {
    /* Amazon SES fournit des identifiants SMTP ordinaires. Collés dans
       SMTP_HOST sans toucher aux variables SES_*, ils font partir les
       courriels par Amazon pendant que le code croit faire du SMTP générique
       — et aucun accusé ne revient. Seul l'hôte tranche. */
    const fs = await import('node:fs');
    const src = fs.readFileSync('server/index.ts', 'utf8');
    expect(src).toContain('smtp_hote: process.env.SMTP_HOST');
    // `ses_variables` teste désormais la FORME de l'identifiant, pas sa
    // seule présence : une variable posée à « a » passait l'ancien test.
    expect(src).toContain('ses_variables: /^AKIA');
  });

  it('n’expose jamais un mot de passe : /api/health est public', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('server/index.ts', 'utf8');
    const i = src.indexOf('courriel: {');
    // On juge le CODE, pas les commentaires : ceux-ci nomment légitimement les
    // variables pour expliquer le piège qu'ils décrivent.
    const code = src.slice(i, src.indexOf('},', i))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const secret of ['SMTP_PASS', 'SES_SMTP_PASS']) {
      expect(code, `${secret} ne doit jamais sortir sur une route publique`).not.toContain(secret);
    }
    // La clé Resend n'apparaît que sous forme de booléen.
    expect(code).toContain('resend_cle: Boolean(');
  });
});

/**
 * SES peut envoyer parfaitement et ne RIEN rapporter (2026-09-22).
 *
 * `SES_CONFIGURATION_SET` était documentée dans ses.ts et lue nulle part. Sans
 * l'en-tête qu'elle produit, Amazon n'attache aucun suivi au courriel et ne
 * publie donc rien sur SNS : ni livraison, ni ouverture, ni clic, ni rebond.
 * On aurait tout branché — identifiants, sujet SNS, route — pour n'observer
 * strictement aucun retour, sans une seule erreur nulle part.
 */
describe('SES — ce qui bloque le suivi', () => {
  const AVEC_SES = {
    COURRIEL_FOURNISSEUR: 'ses',
    SES_SMTP_USER: 'u',
    SES_SMTP_PASS: 'p',
    SES_REGION: 'ca-central-1',
  } as NodeJS.ProcessEnv;

  it('nomme le jeu de configuration manquant', () => {
    const r = raisonSesSansSuivi(AVEC_SES);
    expect(r).toContain('SES_CONFIGURATION_SET');
    expect(r).toContain('ne publiera');
  });

  it('nomme ensuite le jeton du webhook', () => {
    const r = raisonSesSansSuivi({ ...AVEC_SES, SES_CONFIGURATION_SET: 'suivi-lume' });
    expect(r).toContain('SES_WEBHOOK_TOKEN');
  });

  it('se tait quand tout est en place', () => {
    // Les valeurs doivent avoir la forme attendue : un « jeton » de 5 lettres
    // ou un mot de passe « p » sont désormais signalés, à raison.
    expect(raisonSesSansSuivi({
      ...AVEC_SES,
      SES_SMTP_USER: 'AKIATBEGR77RQZA6OT6X',
      SES_SMTP_PASS: 'x'.repeat(44),
      SES_CONFIGURATION_SET: 'suivi-lume',
      SES_WEBHOOK_TOKEN: '7f3c2a10e94b4d1a8c65b2f0d7e83a19',
    })).toBeNull();
  });

  it('se tait quand SES ne sert pas : rien à signaler', () => {
    expect(raisonSesSansSuivi({ RESEND_API_KEY: 're_x' })).toBeNull();
    expect(raisonSesSansSuivi({})).toBeNull();
  });

  it('l’en-tête du jeu de configuration part avec chaque envoi SES', async () => {
    // C'est lui qui déclenche la publication SNS. Sans cette ligne, tout le
    // reste du branchement est inutile.
    const fs = await import('node:fs');
    const src = fs.readFileSync('server/lib/mailer.ts', 'utf8');
    expect(src).toContain("'X-SES-CONFIGURATION-SET'");
    // Et jamais sur un envoi qui n'est pas SES.
    expect(src).toContain("provider === 'ses' ? String(process.env.SES_CONFIGURATION_SET");
  });
});

/**
 * Une valeur PRÉSENTE mais absurde (2026-09-22).
 *
 * Railway refuse d'enregistrer une variable vide. Pour contourner, on pose une
 * valeur temporaire « a » puis on colle la vraie. Si le collage ne prend pas —
 * un clic de validation oublié — la variable existe, le diagnostic dit « tout
 * va bien », et chaque envoi échoue en « 535 Authentication Credentials
 * Invalid ». On a cherché l'expéditeur, le domaine et le code pendant une
 * heure avant de mesurer la longueur des valeurs.
 *
 * On ne vérifie jamais la valeur — ce sont des secrets — mais sa FORME.
 */
describe('SES — une valeur présente mais absurde', () => {
  const BASE = {
    COURRIEL_FOURNISSEUR: 'ses',
    SES_REGION: 'ca-central-1',
    SES_CONFIGURATION_SET: 'lume-suivi',
    SES_SMTP_USER: 'AKIATBEGR77RQZA6OT6X',
    SES_SMTP_PASS: 'x'.repeat(44),
    SES_WEBHOOK_TOKEN: '7f3c2a10e94b4d1a8c65b2f0d7e83a19',
  } as NodeJS.ProcessEnv;

  it('se tait quand les trois valeurs ont la bonne forme', () => {
    expect(raisonSesSansSuivi(BASE)).toBeNull();
  });

  it('repère le mot de passe resté à « a »', () => {
    const r = raisonSesSansSuivi({ ...BASE, SES_SMTP_PASS: 'a' });
    expect(r).toContain('1 caractère');
    expect(r).toContain('~44');
  });

  it('repère le jeton resté à « a »', () => {
    const r = raisonSesSansSuivi({ ...BASE, SES_WEBHOOK_TOKEN: 'a' });
    expect(r).toContain('trop court');
    expect(r).toContain('en attente de confirmation');
  });

  it('repère un identifiant qui n’est pas une clé Amazon', () => {
    const r = raisonSesSansSuivi({ ...BASE, SES_SMTP_USER: 'resend' });
    expect(r).toContain('AKIA');
  });

  it('ne fuite jamais la valeur elle-même, seulement sa longueur', () => {
    const secret = 'MotDePasseSecretQuiNeDoitPasFuiter';
    const r = raisonSesSansSuivi({ ...BASE, SES_SMTP_PASS: secret.slice(0, 5) });
    expect(r).not.toContain(secret.slice(0, 5));
  });
});
