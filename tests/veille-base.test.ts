/**
 * Veille de la base : quelqu'un est prévenu quand elle ne répond plus.
 *
 * 2026-09-28 et 2026-10-01 : deux pannes de la base de production (65 minutes la
 * seconde), aucune alerte. Le serveur tourne pendant ces pannes et Slack ne
 * dépend pas de la base : c'est lui qui sonne.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const messages: Array<{ channel: string; text: string }> = [];
let slackActif = true;
vi.mock('../server/lib/slack', () => ({
  isSlackConfigured: () => slackActif,
  canalSupport: () => 'C-EQUIPE',
  envoyerMessageSlack: async (p: { channel: string; text: string }) => { messages.push(p); return { ts: '1', channel: p.channel }; },
}));
vi.mock('../server/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ETAT_INITIAL, ECHECS_AVANT_ALERTE, etapeVeille, messagePanne, messageRetour, projetVise, releverBase, sonderBase, type EtatVeille } from '../server/lib/veille-base';

const T0 = Date.UTC(2026, 9, 1, 20, 36, 0); // 16 h 36 à Montréal
const MIN = 60_000;
const base = (ok: boolean | 'pendue') => ({
  from: () => ({ select: () => ({ limit: () => (ok === 'pendue' ? new Promise(() => {}) : Promise.resolve({ error: ok ? null : { message: 'timeout' } })) }) }),
}) as never;

beforeEach(() => { messages.length = 0; slackActif = true; });

describe('la décision, relevé après relevé', () => {
  it('un ou deux échecs ne sonnent pas : un accroc d’une minute n’est pas une panne', () => {
    let e: EtatVeille = ETAT_INITIAL;
    for (let i = 0; i < ECHECS_AVANT_ALERTE - 1; i++) {
      const s = etapeVeille(e, false, T0 + i * MIN);
      expect(s.action.type).toBe('rien');
      e = s.etat;
    }
    // Puis la base répond : tout est oublié, sans message.
    const retour = etapeVeille(e, true, T0 + 2 * MIN);
    expect(retour.action.type).toBe('rien');
    expect(retour.etat).toEqual(ETAT_INITIAL);
  });

  it('au troisième échec de suite : une alerte, avec l’heure du PREMIER échec', () => {
    let e: EtatVeille = ETAT_INITIAL;
    e = etapeVeille(e, false, T0).etat;
    e = etapeVeille(e, false, T0 + MIN).etat;
    const s = etapeVeille(e, false, T0 + 2 * MIN);
    expect(s.action).toEqual({ type: 'alerter', debut: T0 });
    expect(s.etat.enPanne).toBe(true);
  });

  it('une panne qui dure ne redit rien : un seul message, même après une heure', () => {
    let e: EtatVeille = ETAT_INITIAL;
    let alertes = 0;
    for (let i = 0; i < 65; i++) {
      const s = etapeVeille(e, false, T0 + i * MIN);
      if (s.action.type === 'alerter') alertes += 1;
      e = s.etat;
    }
    expect(alertes).toBe(1);
  });

  it('au retour : un message, avec la durée de la coupure ; la panne suivante sonnera de nouveau', () => {
    let e: EtatVeille = ETAT_INITIAL;
    for (let i = 0; i < 65; i++) e = etapeVeille(e, false, T0 + i * MIN).etat;
    const retour = etapeVeille(e, true, T0 + 65 * MIN);
    expect(retour.action).toEqual({ type: 'annoncer_retour', debut: T0, dureeMin: 65 });
    expect(retour.etat).toEqual(ETAT_INITIAL);
    let f = retour.etat;
    let alertes = 0;
    for (let i = 0; i < 5; i++) { const s = etapeVeille(f, false, T0 + (70 + i) * MIN); if (s.action.type === 'alerter') alertes += 1; f = s.etat; }
    expect(alertes).toBe(1);
  });
});

describe('les messages', () => {
  it('disent l’heure de Montréal, ce que voient les clients et le remède connu', () => {
    const m = messagePanne(T0);
    expect(m).toContain('16 h 36');
    expect(m).toContain('plus rien ne charge');
    expect(m).toContain('Restart project');
    // Le projet visé est nommé : une instance de test ne fait pas croire à une panne de la prod.
    expect(projetVise('https://bbzcuzqfgsdvjsymfwmr.supabase.co')).toBe('bbzcuzqfgsdvjsymfwmr');
    expect(projetVise('')).toBe('inconnu');
    expect(m).toContain('projet Supabase');
    expect(messageRetour(T0, 65)).toContain('Coupure de 65 minutes');
    expect(messageRetour(T0, 1)).toContain('Coupure de 1 minute,');
  });
});

describe('la sonde et le relevé', () => {
  it('une base qui répond, une base en erreur, une base qui ne rend jamais la main', async () => {
    expect(await sonderBase(base(true), 50)).toBe(true);
    expect(await sonderBase(base(false), 50)).toBe(false);
    expect(await sonderBase(base('pendue'), 50)).toBe(false);
  });

  it('trois relevés en échec : UN message dans le canal de l’équipe ; le retour en envoie un second', async () => {
    let e: EtatVeille = ETAT_INITIAL;
    for (let i = 0; i < 5; i++) e = await releverBase(e, base(false), T0 + i * MIN);
    expect(messages).toHaveLength(1);
    expect(messages[0].channel).toBe('C-EQUIPE');
    expect(messages[0].text).toContain('ne répond plus');
    e = await releverBase(e, base(true), T0 + 5 * MIN);
    expect(messages).toHaveLength(2);
    expect(messages[1].text).toContain('répond de nouveau');
    expect(messages[1].text).toContain('5 minutes');
  });

  it('sans Slack configuré : rien n’est envoyé, la veille continue', async () => {
    slackActif = false;
    let e: EtatVeille = ETAT_INITIAL;
    for (let i = 0; i < 4; i++) e = await releverBase(e, base(false), T0 + i * MIN);
    expect(messages).toHaveLength(0);
    expect(e.enPanne).toBe(true);
  });
});

describe('le serveur arme la veille au démarrage', () => {
  it('server/index.ts appelle demarrerVeilleBase avec le client de service', () => {
    const index = readFileSync(resolve(__dirname, '..', 'server', 'index.ts'), 'utf8');
    expect(index).toContain("import('./lib/veille-base')");
    expect(index).toContain('demarrerVeilleBase(serviceClient);');
  });
});
