// « Soumission ouverte par le client » (mission du 2026-09-28).
//
// Ce qui se juge sans base : qui compte comme une ouverture, et quelles
// règles se déclenchent. Le reste — atomicité de la « première vue »,
// dédoublonnage 30 min, notification, déplacement du deal, isolation entre
// entreprises — est prouvé contre staging par
// scripts/qa/verifier-soumission-ouverte.mjs et en vrai navigateur.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/lib/eventBus', () => ({ eventBus: { emit: vi.fn() } }));
vi.mock('../server/lib/clientActivity', () => ({ recordClientActivity: vi.fn() }));

import { estRobot, empreinte, tropTotApresEnvoi } from '../server/lib/vuesSoumission';
import { evaluateConditions } from '../server/lib/automationEngine';
import { DECLENCHEURS, ACTIONS, champVisible } from '../src/lib/automationCatalogue';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const evt = (metadata: Record<string, unknown>) => ({
  type: 'quote.viewed' as const, orgId: 'o', entityType: 'quote', entityId: 'q', metadata,
});
const PREMIERE = { ouverture: ['premiere', 'chaque'], montant: 1250, etiquette: ['vip', 'printemps'], service_id: ['s1'] };
const SUIVANTE = { ...PREMIERE, ouverture: ['chaque'] };

describe('qui compte comme une ouverture', () => {
  it('un vrai navigateur compte', () => {
    expect(estRobot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(estRobot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36')).toBe(false);
  });

  it('les robots et scanners de liens ne comptent pas', () => {
    for (const ua of [
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'facebookexternalhit/1.1',
      'WhatsApp/2.23.20.0',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0)',
      'python-requests/2.31',
      'curl/8.4.0',
      'Mozilla/5.0 HeadlessChrome/120.0',
      '',
    ]) {
      expect(estRobot(ua), ua || '(vide)').toBe(true);
    }
  });

  it('une « ouverture » moins de 2 s après l’envoi est un scanner', () => {
    const envoi = new Date('2026-09-28T10:00:00Z').toISOString();
    const t = Date.parse(envoi);
    expect(tropTotApresEnvoi([envoi, null], t + 900)).toBe(true);
    expect(tropTotApresEnvoi([envoi], t + 2500)).toBe(false);
    expect(tropTotApresEnvoi([null, undefined])).toBe(false);
    // Le DERNIER envoi compte (courriel puis texto 5 min après).
    const sms = new Date(t + 300_000).toISOString();
    expect(tropTotApresEnvoi([envoi, sms], t + 300_000 + 500)).toBe(true);
  });

  it('Loi 25 : on ne garde qu’une empreinte, jamais la valeur', () => {
    const e = empreinte('Mozilla/5.0 Chrome');
    expect(e).toMatch(/^[0-9a-f]{64}$/);
    expect(e).toBe(empreinte('Mozilla/5.0 Chrome'));
    expect(empreinte('')).toBeNull();
    const code = lire('server/lib/vuesSoumission.ts');
    expect(code).not.toMatch(/ip_address|req\.ip|x-forwarded-for/);
  });

  it('l’ancien appel de la page ne compte plus une soumission (sinon vue en double)', () => {
    const route = lire('server/routes/quotes.ts');
    expect(route).toContain("raison: 'suivi_au_chargement'");
    expect(lire('src/pages/QuoteView.tsx')).not.toContain('/track-view');
    // … et c'est bien la page SERVIE qui compte.
    expect(route).toContain('void enregistrerOuverture(admin, req, quote)');
  });
});

describe('quelles règles se déclenchent', () => {
  it('« première ouverture » : la première oui, les suivantes non', () => {
    expect(evaluateConditions({ ouverture: 'premiere' }, evt(PREMIERE))).toBe(true);
    expect(evaluateConditions({ ouverture: 'premiere' }, evt(SUIVANTE))).toBe(false);
  });

  it('« chaque ouverture » : toutes', () => {
    expect(evaluateConditions({ ouverture: 'chaque' }, evt(PREMIERE))).toBe(true);
    expect(evaluateConditions({ ouverture: 'chaque' }, evt(SUIVANTE))).toBe(true);
  });

  it('montant minimum / maximum', () => {
    expect(evaluateConditions({ montant__gte: 1000 }, evt(PREMIERE))).toBe(true);
    expect(evaluateConditions({ montant__gte: 2000 }, evt(PREMIERE))).toBe(false);
    expect(evaluateConditions({ montant__lte: 1250 }, evt(PREMIERE))).toBe(true);
    expect(evaluateConditions({ montant__gte: 1000, montant__lte: 1200 }, evt(PREMIERE))).toBe(false);
  });

  it('étiquette du client et service : il suffit d’en avoir un', () => {
    expect(evaluateConditions({ etiquette: 'vip' }, evt(PREMIERE))).toBe(true);
    expect(evaluateConditions({ etiquette: 'autre' }, evt(PREMIERE))).toBe(false);
    expect(evaluateConditions({ service_id: 's1' }, evt(PREMIERE))).toBe(true);
    expect(evaluateConditions({ service_id: 's9' }, evt(PREMIERE))).toBe(false);
  });

  it('un réglage laissé vide n’est pas un filtre', () => {
    expect(evaluateConditions({ ouverture: 'premiere', montant__gte: '' }, evt(PREMIERE))).toBe(true);
  });

  it('une valeur simple se compare comme avant (aucune règle existante ne change)', () => {
    expect(evaluateConditions({ status: 'paid' }, evt({ status: 'paid' }))).toBe(true);
    expect(evaluateConditions({ status: 'paid' }, evt({ status: 'sent' }))).toBe(false);
    expect(evaluateConditions({ amount_cents: { gte: 5000 } }, evt({ amount_cents: 7000 }))).toBe(true);
  });
});

describe('catalogue', () => {
  const d = DECLENCHEURS.find((x) => x.cle === 'quote.viewed');

  it('le déclencheur existe, en FR et EN, catégorie Devis', () => {
    expect(d?.fr).toBe('Devis ouvert par le client');
    expect(d?.en).toBe('Quote opened by client');
    expect(d?.famille).toBe('devis');
  });

  it('« première ouverture » est le réglage posé d’office', () => {
    expect(d?.conditions_defaut).toEqual({ ouverture: 'premiere' });
  });

  it('les filtres demandés sont là', () => {
    expect(d?.champs?.map((c) => c.cle)).toEqual(
      ['ouverture', 'montant__gte', 'montant__lte', 'service_id', 'stage_id', 'etiquette'],
    );
  });

  it('« Déplacer l’opportunité » accepte une soumission et le mode « vers Soumission ouverte »', () => {
    const a = ACTIONS.find((x) => x.cle === 'move_deal_stage');
    expect(a?.entites).toContain('quote');
    const etape = a?.champs.find((c) => c.cle === 'stage_id');
    // En mode « rôle », l'étape précise n'est pas demandée (sinon l'automatisation système serait « à compléter »).
    expect(etape && champVisible(etape, { cible: 'role' })).toBe(false);
    expect(etape && champVisible(etape, { cible: 'etape' })).toBe(true);
  });
});
