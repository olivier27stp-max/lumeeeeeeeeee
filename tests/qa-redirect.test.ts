import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  redirigerSms,
  redirigerEmail,
  envelopperTwilio,
  qaRedirectActif,
  qaRedirectResume,
} from '../server/lib/qa-redirect';

/**
 * Le filet de sécurité du robot de recette.
 *
 * Ces tests gardent une promesse simple : quand le mode QA est armé, AUCUN
 * message ne peut atteindre un vrai client, quel que soit le chemin d'appel.
 * Ils vérifient aussi l'inverse — sans les variables, le comportement normal
 * est strictement inchangé, sans quoi on casserait la production.
 */

const SAUVEGARDE = { ...process.env };

beforeEach(() => {
  delete process.env.QA_REDIRECT_TO;
  delete process.env.QA_REDIRECT_EMAIL;
});

afterEach(() => {
  process.env = { ...SAUVEGARDE };
  vi.restoreAllMocks();
});

describe('mode inactif — le comportement normal ne bouge pas', () => {
  it('ne touche pas au SMS', () => {
    const r = redirigerSms('+15145550123', 'Bonjour Marc');
    expect(r.to).toBe('+15145550123');
    expect(r.body).toBe('Bonjour Marc');
    expect(r.redirige).toBe(false);
  });

  it('ne touche pas au courriel', () => {
    const r = redirigerEmail('marc@exemple.com', 'Votre facture');
    expect(r.to).toBe('marc@exemple.com');
    expect(r.subject).toBe('Votre facture');
    expect(r.redirige).toBe(false);
  });

  it('renvoie le client Twilio inchangé', () => {
    const client = { messages: { create: vi.fn() } };
    expect(envelopperTwilio(client)).toBe(client);
  });

  it('se déclare inactif', () => {
    expect(qaRedirectActif()).toBe(false);
  });
});

describe('mode actif — tout est détourné', () => {
  beforeEach(() => {
    process.env.QA_REDIRECT_TO = '+15550001111';
    process.env.QA_REDIRECT_EMAIL = 'qa@exemple.com';
  });

  it('détourne le SMS et annonce le destinataire d\'origine', () => {
    const r = redirigerSms('+15145550123', 'Bonjour Marc');
    expect(r.to).toBe('+15550001111');
    expect(r.redirige).toBe(true);
    expect(r.body).toContain('Bonjour Marc');
    expect(r.body).toMatch(/^\[QA → /);
  });

  it('masque partiellement le numéro d\'origine', () => {
    const r = redirigerSms('+15145550123', 'test');
    // Reconnaissable, mais pas recopié en entier dans un message qui part.
    expect(r.body).toContain('+1514');
    expect(r.body).toContain('0123');
    expect(r.body).not.toContain('+15145550123');
  });

  it('détourne le courriel et met l\'origine dans l\'objet', () => {
    const r = redirigerEmail('marc@exemple.com', 'Votre facture');
    expect(r.to).toBe('qa@exemple.com');
    expect(r.subject).toContain('Votre facture');
    expect(r.subject).toMatch(/^\[QA → /);
    expect(r.redirige).toBe(true);
  });

  it('gère une liste de destinataires', () => {
    const r = redirigerEmail(['a@x.com', 'b@x.com'], 'Rapport');
    expect(r.to).toBe('qa@exemple.com');
    expect(r.redirige).toBe(true);
  });

  it('n\'empile pas les préfixes si la cible est déjà la bonne', () => {
    const r = redirigerSms('+15550001111', 'Déjà pour la QA');
    expect(r.body).toBe('Déjà pour la QA');
    expect(r.redirige).toBe(false);
  });

  it('se déclare actif et se résume', () => {
    expect(qaRedirectActif()).toBe(true);
    expect(qaRedirectResume()).toContain('+15550001111');
    expect(qaRedirectResume()).toContain('qa@exemple.com');
  });
});

describe('un seul canal armé', () => {
  it('les SMS seuls sont détournés', () => {
    process.env.QA_REDIRECT_TO = '+15550001111';
    expect(redirigerSms('+15145550123', 'x').redirige).toBe(true);
    expect(redirigerEmail('marc@exemple.com', 'x').redirige).toBe(false);
  });

  it('les courriels seuls sont détournés', () => {
    process.env.QA_REDIRECT_EMAIL = 'qa@exemple.com';
    expect(redirigerEmail('marc@exemple.com', 'x').redirige).toBe(true);
    expect(redirigerSms('+15145550123', 'x').redirige).toBe(false);
  });
});

describe('enveloppe du client Twilio — le vrai garde-fou', () => {
  beforeEach(() => {
    process.env.QA_REDIRECT_TO = '+15550001111';
  });

  it('détourne messages.create quel que soit l\'appelant', async () => {
    const create = vi.fn().mockResolvedValue({ sid: 'SM123' });
    const client = envelopperTwilio({ messages: { create } })!;

    await client.messages.create({
      body: 'Votre rendez-vous est confirmé',
      from: '+15140000000',
      to: '+15145550123',
    });

    expect(create).toHaveBeenCalledTimes(1);
    const opts = create.mock.calls[0][0];
    expect(opts.to).toBe('+15550001111');
    expect(opts.body).toMatch(/^\[QA → /);
    // L'expéditeur et les autres options passent intacts.
    expect(opts.from).toBe('+15140000000');
  });

  it('conserve les options additionnelles (statusCallback…)', async () => {
    const create = vi.fn().mockResolvedValue({ sid: 'SM1' });
    const client = envelopperTwilio({ messages: { create } })!;

    await client.messages.create({
      body: 'x',
      from: '+1',
      to: '+15145550123',
      statusCallback: 'https://exemple.com/hook',
    });

    expect(create.mock.calls[0][0].statusCallback).toBe('https://exemple.com/hook');
  });

  it('laisse passer le reste du client Twilio', () => {
    const client = envelopperTwilio({
      messages: { create: vi.fn() },
      incomingPhoneNumbers: { list: () => 'intact' },
    } as any)! as any;

    expect(client.incomingPhoneNumbers.list()).toBe('intact');
  });

  it('renvoie null si aucun client (Twilio non configuré)', () => {
    expect(envelopperTwilio(null)).toBeNull();
  });

  it('remonte l\'erreur de Twilio sans l\'avaler', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Twilio 21610'));
    const client = envelopperTwilio({ messages: { create } })!;
    await expect(
      client.messages.create({ body: 'x', from: '+1', to: '+15145550123' }),
    ).rejects.toThrow('Twilio 21610');
  });
});
