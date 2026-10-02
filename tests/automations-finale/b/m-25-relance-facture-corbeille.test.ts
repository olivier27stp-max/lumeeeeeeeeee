/**
 * M-25 (trouvé par l'agent M en écrivant la preuve de B-22) — le cron des
 * relances de paiement ne regardait pas la CORBEILLE : une facture supprimée
 * garde son statut « envoyée », et son client recevait quand même le rappel
 * « votre facture est en retard ».
 *
 * Vrai cron, pile locale, bureau B « (b) ».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { marque } from '../../automations-suite/harnais/moteur';
import { preparerBureau, ok, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { jourLocal } from './outils-b';

const TZ = 'America/Toronto';
const PALIER = 7;

let b: Bureau;
let reglagesAvant: Record<string, unknown> | null = null;
let fuseauAvant = TZ;
/** Midi à Toronto, AUJOURD'HUI : dans les heures d'envoi, quelle que soit l'heure où le test tourne. */
const midi = () => new Date(`${jourLocal(TZ)}T16:00:00Z`);
const m = marque('M25');
const crees: string[] = [];

const relances = async (ids: string[]) => (await ok<Array<{ invoice_id: string }>>(
  b.admin.from('reminder_log').select('invoice_id').eq('org_id', b.orgB).eq('days_after_due', PALIER).in('invoice_id', ids), 'journal des relances',
)).map((l) => l.invoice_id).sort();

beforeAll(async () => {
  b = await preparerBureau();
  const { viderCacheFuseau } = await import('../../../server/lib/automations-fuseau-org');
  reglagesAvant = await ok<Record<string, unknown> | null>(b.admin.from('reminder_settings').select('*').eq('org_id', b.orgB).maybeSingle(), 'réglages');
  fuseauAvant = (await ok<{ timezone: string }>(b.admin.from('company_settings').select('timezone').eq('org_id', b.orgB).single(), 'fuseau')).timezone;
  await ok(b.admin.from('company_settings').update({ timezone: TZ }).eq('org_id', b.orgB), 'fuseau');
  viderCacheFuseau();
  await ok(b.admin.from('reminder_settings').upsert({ org_id: b.orgB, enabled: true, schedule: [{ days_after_due: PALIER, channel: 'email' }] }, { onConflict: 'org_id' }), 'réglages relances');
}, 120_000);

afterAll(async () => {
  const { viderCacheFuseau } = await import('../../../server/lib/automations-fuseau-org');
  if (crees.length) await b.admin.from('invoices').update({ status: 'void', deleted_at: new Date().toISOString() }).in('id', crees);
  await b.admin.from('company_settings').update({ timezone: fuseauAvant }).eq('org_id', b.orgB);
  viderCacheFuseau();
  if (reglagesAvant) await b.admin.from('reminder_settings').upsert(reglagesAvant, { onConflict: 'org_id' });
  else await b.admin.from('reminder_settings').delete().eq('org_id', b.orgB);
}, 120_000);

describe('relances de paiement — une facture à la corbeille', () => {
  it('[M25-01] une facture supprimée (corbeille) n’est pas relancée ; sa voisine, elle, l’est', async () => {
    const adresse = `m25-${Date.now().toString(36)}@lume-qa.test`;
    const maintenant = new Date().toISOString();
    const c = await ok<{ id: string }>(b.admin.from('clients').insert({
      org_id: b.orgB, created_by: b.users.proprioB, first_name: 'Relance', last_name: m, status: 'active', email: adresse, email_consent_at: maintenant,
    }).select('id').single(), 'client');
    const facture = (n: string) => ({
      org_id: b.orgB, client_id: c.id, created_by: b.users.proprioB, invoice_number: `M25-${Date.now().toString(36)}-${n}`,
      subtotal_cents: 12_000, tax_cents: 0, total_cents: 12_000, paid_cents: 0, balance_cents: 12_000,
      issued_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), status: 'sent', due_date: jourLocal(TZ, -10), subject: `Facture ${m} ${n}`,
    });
    const [supprimee, temoin] = await ok<Array<{ id: string }>>(b.admin.from('invoices')
      .insert([facture('corbeille'), facture('temoin')]).select('id'), 'factures');
    crees.push(supprimee.id, temoin.id);
    await ok(b.admin.from('invoices').update({ deleted_at: new Date().toISOString() }).eq('id', supprimee.id), 'mise à la corbeille');
    const etat = await ok<{ status: string; deleted_at: string | null }>(b.admin.from('invoices').select('status, deleted_at').eq('id', supprimee.id).single(), 'relecture');
    // Le cas tel qu'il existe : la facture à la corbeille garde son statut « envoyée ».
    expect(etat).toMatchObject({ status: 'sent' });
    expect(etat.deleted_at).not.toBeNull();

    const depuis = new Date(Date.now() - 5_000).toISOString();
    const { executerRelancesPaiement } = await import('../../../server/routes/reminders-cron');
    await executerRelancesPaiement({ publicBase: 'https://staging.lume-qa.test', orgId: b.orgB, aujourdHui: midi() });

    // Le témoin (même client, même échéance, pas supprimé) prouve que le passage a bien eu lieu.
    expect(await relances([temoin.id])).toEqual([temoin.id]);
    expect(await relances([supprimee.id]), 'facture à la corbeille relancée').toEqual([]);
    const envois = await ok<Array<{ id: string }>>(b.admin.from('envois_simules').select('id').eq('org_id', b.orgB).eq('destinataire', adresse).gte('created_at', depuis), 'envois');
    expect(envois, 'un seul rappel : celui de la facture qui existe encore').toHaveLength(1);
  }, 600_000);
});
