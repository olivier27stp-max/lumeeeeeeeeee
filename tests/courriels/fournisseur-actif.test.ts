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
import { fournisseurCourriel, raisonSmtpMalgreResend } from '../../server/lib/mailer';

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
    expect(src).toContain('ses_variables: Boolean(');
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
