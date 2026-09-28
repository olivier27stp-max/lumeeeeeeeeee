/**
 * Launch 2026-09-28 — M1 : un texto IMPOSSIBLE ne tue plus le parcours.
 *
 * Aucun bureau n'a encore de numéro texto. Avant : le texto de confirmation
 * du pack « rendez-vous » échouait, l'étape était reprise puis abandonnée, et
 * le parcours s'arrêtait là — ni courriel, ni rappels 7 j / veille / 2 h.
 * Maintenant : le texto est SAUTÉ (motif au journal), la suite part.
 *
 * Vrai moteur, vraies actions, monde figé (filet-regression/_banc).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({
  e: { sms: [] as any[], courriels: [] as any[], appels: [] as any[], slack: [] as any[] },
  client: { current: null as any },
  numero: { erreur: { code: 'no_number' } as { code: string } | null },
}));

vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  getServiceClient: () => etat.client.current,
}));
vi.mock('../../server/lib/mailer', async (orig) => ({
  ...(await orig<any>()),
  isMailerConfigured: () => true,
  sendEmail: vi.fn(async (p: any) => { etat.e.courriels.push({ to: p.to, subject: p.subject, html: p.html, headers: p.headers }); return { sent: true, messageId: 't' }; }),
}));
vi.mock('../../server/lib/twilioProvisioning', async (orig) => ({
  ...(await orig<any>()),
  // Le bureau n'a PAS de numéro texto (la situation de la prod au launch).
  getOrgSmsFromNumber: async () => { if (etat.numero.erreur) throw etat.numero.erreur; return '+15550000000'; },
}));

import { jouer, evenementPour, courant } from './filet-regression/_banc';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';
import { PACK_PARCOURS } from '../../server/lib/automationPack.data';

const lier = () => Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true });
const TZ = process.env.TZ;
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.lume.test';

beforeEach(() => { oublierDrapeaux(); lier(); etat.numero.erreur = { code: 'no_number' }; });
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

const rdv = PACK_PARCOURS.find((p) => p.preset_key === 'pack_rendez_vous')!;
const regle = { id: 'pack-rdv', name: 'Rendez-vous', trigger_event: rdv.trigger_event, actions: rdv.actions, steps: rdv.steps, preset_key: rdv.preset_key };

describe('M1 — pack rendez-vous sans numéro texto', () => {
  it('le texto est sauté, le courriel et les rappels 7 j / veille / 2 h partent', async () => {
    const sortie = await jouer(regle as any, evenementPour('appointment.created'), etat.e);

    // Aucun texto envoyé, jamais.
    expect(sortie.envois.filter((x) => x.canal === 'sms')).toHaveLength(0);
    // Le parcours n'est PAS mort : des courriels sont partis.
    expect(sortie.envois.filter((x) => x.canal === 'courriel').length).toBeGreaterThanOrEqual(1);

    // Les attentes « avant la date » ont toutes été planifiées (7 j, veille, 2 h).
    const debut = Date.parse('2026-09-25T13:00:00Z');
    const echeances = sortie.planifie.map((p) => Date.parse(p.execute_at));
    for (const avant of [7 * 86_400_000, 86_400_000, 7_200_000]) {
      expect(echeances.some((t) => Math.abs(t - (debut - avant)) < 60_000), `attente ${avant / 3_600_000} h avant`).toBe(true);
    }

    // Le saut est JOURNALISÉ avec son motif, en succès (pas un échec à reprendre).
    const journaux = sortie.ecritures.filter((w) => w.table === 'automation_execution_logs' && w.op === 'insert').map((w) => w.valeur as any);
    const sautes = journaux.filter((j) => j?.result_data?.saute);
    expect(sautes.length).toBeGreaterThanOrEqual(1);
    expect(sautes.every((j) => j.result_success === true && j.action_type === 'send_sms')).toBe(true);
    expect(sautes[0].result_data.saute_code).toBe('sms_non_configure');
    // Aucune tâche marquée en échec.
    const echecs = sortie.ecritures.filter((w) => w.table === 'automation_scheduled_tasks' && w.op === 'update' && (w.valeur as any)?.status === 'failed');
    expect(echecs).toHaveLength(0);
  });

  it('un VRAI échec (fournisseur en panne) garde l’ancien comportement : la suite ne part pas', async () => {
    const mailer = await import('../../server/lib/mailer');
    vi.mocked(mailer.sendEmail).mockImplementation(async () => ({ sent: false, error: 'Resend 502 Bad Gateway' }) as any);
    try {
      const parcours = {
        id: 'panne', name: 'Panne', trigger_event: 'appointment.created', actions: [{ type: 'send_email', config: { subject: 'A', body: 'A' } }],
        steps: [
          { id: 'a1', type: 'action', action: { type: 'send_email', config: { subject: 'Premier', body: 'Premier' } }, suivant: 'a2' },
          { id: 'a2', type: 'attendre', mode: 'duree', delai_secondes: 86400, suivant: 'a3' },
          { id: 'a3', type: 'action', action: { type: 'send_email', config: { subject: 'Second', body: 'Second' } }, suivant: null },
        ],
      };
      const sortie = await jouer(parcours as any, evenementPour('appointment.created'), etat.e);
      // Seule la 1re étape a été planifiée : l'échec n'ouvre pas la suite.
      expect(sortie.planifie.every((p) => p.step_id === 'a1')).toBe(true);
      const journaux = sortie.ecritures.filter((w) => w.table === 'automation_execution_logs' && w.op === 'insert').map((w) => w.valeur as any);
      expect(journaux.length).toBeGreaterThan(0);
      expect(journaux.every((j) => j.result_success === false && !j.result_data?.saute)).toBe(true);
    } finally {
      vi.mocked(mailer.sendEmail).mockImplementation(async (p: any) => { etat.e.courriels.push({ to: p.to, subject: p.subject, html: p.html, headers: p.headers }); return { sent: true, messageId: 't' } as any; });
    }
  });
});
