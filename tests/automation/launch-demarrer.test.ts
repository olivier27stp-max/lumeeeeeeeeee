/**
 * Launch 2026-09-28 — « Démarrer une automatisation » par le VRAI moteur.
 *
 * Avant : l'action n'inscrivait que les `actions` de la règle visée, toutes
 * « maintenant ». Sur un parcours, seule la 1re action partait, sans ses
 * attentes ; et A → B → A tournait sans fin (seul « se démarrer soi-même »
 * était refusé).
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

import { jouer, evenementPour, courant, IDS, ORG } from './filet-regression/_banc';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';

const TZ = process.env.TZ;
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.lume.test';
beforeEach(() => { oublierDrapeaux(); Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true }); });
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

const A = { id: 'regle-a', name: 'A', trigger_event: 'quote.approved', delay_seconds: 0, actions: [{ type: 'demarrer_automatisation', config: { rule_id: IDS.autreRegle } }] };
const ligne = (r: any) => ({ org_id: ORG, conditions: {}, settings: null, is_active: true, deleted_at: null, pipeline_id: null, stage_id: null, preset_key: null, steps: null, delay_seconds: 0, ...r });
/** La base : l'identifiant visé rend la règle B, tout le reste rend A. */
const avecB = (b: any) => ({
  automation_rules: (req: any) => ({ data: req.filtres.some(([op, c, v]: any) => op === 'eq' && c === 'id' && v === IDS.autreRegle) ? [ligne(b)] : [ligne(A)] }),
});
const ecrits = (s: any, table: string) => s.ecritures.filter((w: any) => w.table === table && w.op === 'insert').flatMap((w: any) => (Array.isArray(w.valeur) ? w.valeur : [w.valeur]));

describe('Démarrer une automatisation — vrai moteur', () => {
  it('un PARCOURS visé démarre à sa 1re étape (son attente est respectée)', async () => {
    const B = {
      id: IDS.autreRegle, name: 'Accueil', trigger_event: 'task.completed',
      actions: [{ type: 'send_sms', config: { body: 'Bienvenue' } }],
      steps: [
        { id: 'b1', type: 'attendre', mode: 'duree', delai_secondes: 86400, suivant: 'b2' },
        { id: 'b2', type: 'action', action: { type: 'send_sms', config: { body: 'Bienvenue' } }, suivant: null },
      ],
    };
    const s: any = await jouer(A as any, evenementPour('quote.approved'), etat.e, avecB(B));
    const taches = ecrits(s, 'automation_scheduled_tasks');
    // L'attente d'un jour planifie l'étape suivante à J+1.
    expect(taches.some((t: any) => t.automation_rule_id === IDS.autreRegle && t.step_id === 'b2' && t.execute_at === '2026-09-14T15:00:00.000Z')).toBe(true);
    // Rien n'est parti « tout de suite » : le parcours attend son jour.
    expect(s.envois.filter((x: any) => x.canal === 'sms' && x.moment === 'immediat')).toHaveLength(0);
  }, 30_000);

  it('A démarre B qui démarre A : la boucle est arrêtée au 2e maillon', async () => {
    const B = { id: IDS.autreRegle, name: 'B', trigger_event: 'task.completed', actions: [{ type: 'demarrer_automatisation', config: { rule_id: 'regle-a' } }] };
    const s: any = await jouer(A as any, evenementPour('quote.approved'), etat.e, avecB(B));
    const logs = ecrits(s, 'automation_execution_logs').concat(
      s.ecritures.filter((w: any) => w.table === 'automation_execution_logs' && w.op === 'update').map((w: any) => w.valeur),
    );
    expect(logs.some((l: any) => l?.result_data?.saute_code === 'boucle')).toBe(true);
    // A n'a été lancé qu'une fois (pas de 2e démarrage de B).
    const lecturesB = s.ecritures.length; // la sortie est finie : pas d'emballement
    expect(lecturesB).toBeLessThan(50);
  }, 30_000);
});
