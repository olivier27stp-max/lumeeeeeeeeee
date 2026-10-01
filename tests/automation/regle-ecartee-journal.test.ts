/**
 * [L-004] Une règle ÉCARTÉE par ses conditions laisse une trace — prouvé sur
 * le vrai moteur (bus, `handleEvent`), base enregistrée (aucun réseau).
 *
 *  · un filtre non rempli → UNE ligne `automation_execution_logs`
 *    (`action_type = 'conditions'`, succès technique, motif dans
 *    `result_data.saute`), aucune action, aucun envoi, rien en file ;
 *  · une règle qui ne VISE pas l'événement (autre jalon de retard) → rien ;
 *  · conditions remplies → l'action part, aucune ligne « conditions ».
 *
 * Le chemin complet contre la base est dans
 * tests/automations-suite/integration/40-iklm-observabilite.test.ts.
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

import { jouer, evenementPour, courant, IDS, ORG, type Regle } from './filet-regression/_banc';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';

const TZ = process.env.TZ;
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';

beforeEach(() => {
  oublierDrapeaux();
  Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true });
});
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

const regle = (id: string, cle: string, conditions: Record<string, unknown>, delai = 0): Regle & { id: string } => ({
  id, trigger_event: cle, delay_seconds: delai, conditions, settings: null,
  actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }],
});

/** Les lignes de journal écrites pendant le traitement de l'événement. */
const journal = (s: any) => s.ecritures.filter((x: any) => x.table === 'automation_execution_logs' && x.op === 'insert').map((x: any) => x.valeur);

describe('[L-004] règle écartée par un filtre : une trace, et rien d’autre', () => {
  it('« Devis envoyé », filtre channel = sms, événement par courriel → une ligne « conditions », aucun texto, rien en file', async () => {
    const s: any = await jouer(regle('r-ecartee', 'quote.sent', { channel: 'sms' }), evenementPour('quote.sent'), etat.e);
    expect(s.envois).toEqual([]);
    expect(s.planifie).toEqual([]);
    const lignes = journal(s);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      org_id: ORG, automation_rule_id: 'r-ecartee', trigger_event: 'quote.sent', entity_type: 'quote', entity_id: IDS.devis,
      action_type: 'conditions', action_config: {}, result_success: true, result_error: null,
      result_data: { saute: 'Conditions non remplies : channel', saute_code: 'conditions', condition: 'channel' },
    });
    // La clé d'exécution identifie (règle, fiche, événement) : un rejeu ne réécrit pas la ligne.
    expect(String(lignes[0].execution_key)).toMatch(new RegExp(`^r-ecartee:${IDS.devis}:conditions:(e\\d+|t\\d+)$`));
  });

  it('même règle DIFFÉRÉE (+1 jour) : la trace est écrite, aucune tâche n’est planifiée', async () => {
    const s: any = await jouer(regle('r-ecartee-j1', 'quote.sent', { channel: 'sms' }, 86400), evenementPour('quote.sent'), etat.e);
    expect(s.planifie).toEqual([]);
    expect(journal(s).map((l: any) => [l.action_type, l.result_data.saute_code])).toEqual([['conditions', 'conditions']]);
  });

  it('filtre « le client a l’étiquette » non rempli → la trace nomme le filtre', async () => {
    const s: any = await jouer(regle('r-etiquette', 'quote.sent', { client_a_etiquette: 'vip' }), evenementPour('quote.sent'), etat.e);
    expect(s.envois).toEqual([]);
    expect(journal(s).map((l: any) => [l.action_type, l.result_success, l.result_data.saute])).toEqual([
      ['conditions', true, 'Conditions non remplies : étiquette du client'],
    ]);
  });
});

describe('[L-004] pas de bruit : la règle qui ne vise pas l’événement n’écrit rien', () => {
  it('« Facture en retard » de 12 jours, règle du jalon 30 jours → aucune ligne de journal', async () => {
    const s: any = await jouer(regle('r-jalon-30', 'invoice.overdue', { days_overdue: 30 }), evenementPour('invoice.overdue'), etat.e);
    expect(s.envois).toEqual([]);
    expect(journal(s)).toEqual([]);
  });

  it('le bon jalon mais un filtre non rempli → une ligne', async () => {
    const s: any = await jouer(regle('r-jalon-12', 'invoice.overdue', { days_overdue: 12, invoice_number: 'INV-AUTRE' }), evenementPour('invoice.overdue'), etat.e);
    expect(journal(s).map((l: any) => l.result_data.saute)).toEqual(['Conditions non remplies : invoice_number']);
  });
});

describe('[L-004] conditions remplies : comme avant', () => {
  it('l’action part, aucune ligne « conditions »', async () => {
    const s: any = await jouer(regle('r-ok', 'quote.sent', { channel: 'email' }), evenementPour('quote.sent'), etat.e);
    expect(s.envois.filter((x: any) => x.canal === 'sms')).toHaveLength(1);
    expect(journal(s).filter((l: any) => l.action_type === 'conditions')).toEqual([]);
  });
});
