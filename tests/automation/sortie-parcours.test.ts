/**
 * PR 2 — Sortie automatique du parcours (drapeau `auto_sortie_parcours`).
 *
 *  - Parcours avec délai où l'état change pendant l'attente → arrêt, motif écrit.
 *  - État inchangé → l'action part.
 *  - Case décochée → l'action part malgré le changement d'état.
 *  - Case absente (automatisations existantes) → comportement d'avant :
 *    arrêt pour soumission/facture/rendez-vous, pas pour l'opportunité.
 *  - Les règles déclenchées PAR la résolution (soumission acceptée, facture
 *    payée, rendez-vous annulé) ne s'annulent plus elles-mêmes — drapeau ON
 *    comme drapeau OFF (K-012 : le pack « Dépôt », publié d'office, n'envoyait
 *    jamais sa demande dans une entreprise sans le drapeau).
 *  - Drapeau OFF → pour le reste, l'ancienne vérification, au mot près (le
 *    filet le prouve pour tout le catalogue).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({
  e: { sms: [] as any[], courriels: [] as any[], appels: [] as any[], slack: [] as any[] },
  client: { current: null as any },
}));

vi.mock('../../server/lib/supabase', async (orig) => ({ ...(await orig<any>()), getServiceClient: () => etat.client.current }));
vi.mock('../../server/lib/mailer', async (orig) => ({
  ...(await orig<any>()),
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: any) => { etat.e.courriels.push({ to: p.to, subject: p.subject, html: p.html }); return { sent: true, messageId: 't' }; }),
}));
vi.mock('../../server/lib/twilioProvisioning', async (orig) => ({ ...(await orig<any>()), getOrgSmsFromNumber: async () => '+15550000000' }));

import { jouer, evenementPour, courant, monde, IDS, etatApres, resoluPendantAttente, type Regle } from './filet-regression/_banc';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';
import { FAMILLE_PAR_DECLENCHEUR, familleSortie, sortieCochee } from '../../server/lib/sortie-parcours';
import { CASE_SORTIE } from '../../src/lib/automationCatalogue';
import { automationSettingsSchema } from '../../server/lib/validation';

const ON = { org_features: { data: [{ feature: 'auto_sortie_parcours', enabled: true }] } };
const TZ = process.env.TZ;
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';

beforeEach(() => {
  oublierDrapeaux();
  Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true });
});
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

const sms = (s: any) => s.envois.filter((e: any) => e.canal === 'sms');
const regleSms = (cle: string, delai: number, settings?: Record<string, unknown> | null): Regle & { id: string } => ({
  id: `r-${cle}-${delai}`, trigger_event: cle, delay_seconds: delai, settings: settings ?? null,
  actions: [{ type: 'send_sms', config: { body: 'Relance' } }],
});

/** Joue la règle : `resolu` = l'entité change d'état pendant l'attente. */
async function jouerCas(cle: string, delai: number, opts: { drapeau: boolean; settings?: Record<string, unknown> | null; resolu?: boolean }) {
  return jouer(
    regleSms(cle, delai, opts.settings),
    evenementPour(cle),
    etat.e,
    { ...etatApres(cle), ...(opts.drapeau ? ON : {}) },
    opts.resolu ? (resoluPendantAttente(cle) ?? {}) : {},
  ) as Promise<any>;
}

describe('état changé pendant l\'attente → arrêt avec motif (drapeau ON)', () => {
  it.each([
    ['quote.sent', 86400, 'Arrêté : la soumission a été acceptée.'],
    ['invoice.sent', 604800, 'Arrêté : la facture a été payée.'],
    ['invoice.overdue', 86400, 'Arrêté : la facture a été payée.'],
    ['appointment.created', -86400, 'Arrêté : le rendez-vous a été annulé.'],
  ])('%s : case absente (existante) = arrêt, comme avant, avec le motif', async (cle, delai, motif) => {
    const s = await jouerCas(cle, delai, { drapeau: true, resolu: true });
    expect(sms(s)).toHaveLength(0);
    expect(s.annulees).toHaveLength(1);
    expect(s.annulees[0]).toContain(motif);
  });

  it('opportunité déplacée pendant l\'attente, case cochée → arrêt', async () => {
    const s = await jouerCas('deal.stage_entered', 86400, { drapeau: true, settings: { arreter_si_resolu: true }, resolu: true });
    expect(sms(s)).toHaveLength(0);
    expect(s.annulees[0]).toContain('Arrêté : l’opportunité a changé d’étape.');
  });

  it('opportunité, case ABSENTE → pas d\'arrêt (il n\'existait pas : les règles existantes ne changent pas)', async () => {
    const s = await jouerCas('deal.stage_entered', 86400, { drapeau: true, resolu: true });
    expect(sms(s)).toHaveLength(1);
    expect(s.annulees).toHaveLength(0);
  });
});

describe('état inchangé → l\'action part', () => {
  it.each([['quote.sent', 86400], ['invoice.sent', 604800], ['appointment.created', -86400]])('%s', async (cle, delai) => {
    const s = await jouerCas(cle, delai, { drapeau: true, settings: { arreter_si_resolu: true } });
    expect(sms(s)).toHaveLength(1);
    expect(s.annulees).toHaveLength(0);
  });
  it('deal.stage_entered, toujours dans l\'étape', async () => {
    const s = await jouerCas('deal.stage_entered', 86400, { drapeau: true, settings: { arreter_si_resolu: true } });
    expect(sms(s)).toHaveLength(1);
  });
});

describe('case décochée → l\'action part malgré le changement d\'état', () => {
  it.each([['quote.sent', 86400], ['invoice.sent', 604800], ['appointment.created', -86400], ['deal.stage_entered', 86400]])('%s', async (cle, delai) => {
    const s = await jouerCas(cle, delai, { drapeau: true, settings: { arreter_si_resolu: false }, resolu: true });
    expect(sms(s)).toHaveLength(1);
    expect(s.annulees).toHaveLength(0);
  });
});

describe('une règle déclenchée PAR la résolution ne s\'annule plus elle-même', () => {
  it.each([
    ['quote.approved', 172800],
    ['invoice.paid', 86400],
    ['appointment.cancelled', 3600],
  ])('[K-012] %s + délai : part, drapeau ON comme drapeau OFF', async (cle, delai) => {
    const on = await jouerCas(cle, delai, { drapeau: true });
    expect(sms(on)).toHaveLength(1);
    expect(on.annulees).toHaveLength(0);

    oublierDrapeaux();
    const off = await jouerCas(cle, delai, { drapeau: false });
    expect(sms(off)).toHaveLength(1);
    expect(off.annulees).toHaveLength(0);
  });

  it.each([[true], [false]])('[K-012] soumission acceptée puis CONVERTIE en job avant l\'échéance (drapeau %s) : la demande de dépôt part quand même', async (drapeau) => {
    const m = monde({ id: 'x', trigger_event: 'quote.approved' });
    const s: any = await jouer(regleSms('quote.approved', 3600), evenementPour('quote.approved'), etat.e,
      { ...(drapeau ? ON : {}), quotes: { data: [{ ...m.quotes.data[0], status: 'converted' }] } });
    expect(sms(s)).toHaveLength(1);
    expect(s.annulees).toHaveLength(0);
  });

  it.each([[true], [false]])('[K-012] soumission acceptée puis REFUSÉE avant l\'échéance (drapeau %s) : arrêt, comme avant', async (drapeau) => {
    const m = monde({ id: 'x', trigger_event: 'quote.approved' });
    const s: any = await jouer(regleSms('quote.approved', 3600), evenementPour('quote.approved'), etat.e,
      { ...(drapeau ? ON : {}), quotes: { data: [{ ...m.quotes.data[0], status: 'declined' }] } });
    expect(sms(s)).toHaveLength(0);
    expect(s.annulees).toHaveLength(1);
  });

  it('[K-012] drapeau OFF : une relance de soumission ENVOYÉE s\'arrête toujours quand elle est acceptée (l\'exception ne vaut que pour le déclencheur « acceptée »)', async () => {
    const s = await jouerCas('quote.sent', 86400, { drapeau: false, resolu: true });
    expect(sms(s)).toHaveLength(0);
    expect(s.annulees).toHaveLength(1);
  });

  it('le rappel de dépôt (preset deposit_followup_2d) part enfin', async () => {
    const s: any = await jouer(
      { id: 'preset-depot', preset_key: 'deposit_followup_2d', trigger_event: 'quote.approved', delay_seconds: 172800, actions: [{ type: 'send_sms', config: { body: 'Petit rappel pour le dépôt.' } }] },
      evenementPour('quote.approved'), etat.e, { ...etatApres('quote.approved'), ...ON },
    );
    expect(sms(s)).toHaveLength(1);
  });

  it('mais une soumission SUPPRIMÉE arrête toujours', async () => {
    const m = monde({ id: 'x', trigger_event: 'quote.approved' });
    const s: any = await jouer(regleSms('quote.approved', 172800), evenementPour('quote.approved'), etat.e,
      { ...ON, quotes: { data: [{ ...m.quotes.data[0], status: 'approved', deleted_at: '2026-09-14T00:00:00Z' }] } });
    expect(sms(s)).toHaveLength(0);
    expect(s.annulees[0]).toContain('la soumission a été supprimée');
  });

  it('[K-012] une soumission SUPPRIMÉE arrête aussi drapeau OFF', async () => {
    const m = monde({ id: 'x', trigger_event: 'quote.approved' });
    const s: any = await jouer(regleSms('quote.approved', 172800), evenementPour('quote.approved'), etat.e,
      { quotes: { data: [{ ...m.quotes.data[0], status: 'approved', deleted_at: '2026-09-14T00:00:00Z' }] } });
    expect(sms(s)).toHaveLength(0);
    expect(s.annulees).toHaveLength(1);
  });
});

describe('séquence : l\'étape après l\'attente s\'arrête si la soumission est acceptée entre-temps', () => {
  const sequence = (settings?: Record<string, unknown>): Regle & { id: string } => ({
    id: 'r-seq', trigger_event: 'quote.sent', delay_seconds: 0, actions: [], settings: settings ?? null,
    steps: [
      { id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Soumission envoyée', body: 'Suivi' } }, suivant: 'e2' },
      { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e3' },
      { id: 'e3', type: 'action', action: { type: 'send_sms', config: { body: 'Et alors ?' } } },
    ],
  });
  it('cochée (nouvelle automatisation) → e3 arrêtée avec motif', async () => {
    const s: any = await jouer(sequence({ arreter_si_resolu: true }), evenementPour('quote.sent'), etat.e, ON, resoluPendantAttente('quote.sent') ?? {});
    expect(s.planifie.map((p: any) => p.step_id)).toEqual(['e1', 'e3']);
    expect(sms(s)).toHaveLength(0);
    expect(s.annulees[0]).toContain('la soumission a été acceptée');
  });
  it('décochée → e3 part', async () => {
    const s: any = await jouer(sequence({ arreter_si_resolu: false }), evenementPour('quote.sent'), etat.e, ON, resoluPendantAttente('quote.sent') ?? {});
    expect(sms(s)).toHaveLength(1);
  });
});

describe('cohérence écran ↔ moteur', () => {
  it('les 4 familles ont une case, avec le même défaut des deux côtés', () => {
    expect(Object.keys(CASE_SORTIE).sort()).toEqual(Object.keys(FAMILLE_PAR_DECLENCHEUR).sort());
    for (const [cle, c] of Object.entries(CASE_SORTIE)) {
      expect(sortieCochee(null, familleSortie(cle)!), cle).toBe(c.defaut);
    }
  });
  it('le schéma des réglages accepte la case, et refuse toujours une clé inconnue', () => {
    expect(automationSettingsSchema.safeParse({ arreter_si_resolu: true }).success).toBe(true);
    expect(automationSettingsSchema.safeParse({ arreter_si_resolu: 'oui' }).success).toBe(false);
    expect(automationSettingsSchema.safeParse({ inconnu: true }).success).toBe(false);
  });
});

it('le banc partagé expose le même monde', () => {
  expect(monde({ id: 'x', trigger_event: 'quote.sent' }).quotes.data[0].id).toBe(IDS.devis);
});
