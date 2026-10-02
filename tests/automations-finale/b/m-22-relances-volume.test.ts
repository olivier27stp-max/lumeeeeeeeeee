/**
 * B-22 — relances de paiement (`reminder_settings` + cron) : au-delà de 500
 * factures en retard dans un palier, certaines ne sont JAMAIS relancées.
 *
 * Le cron lisait `.limit(500)` SANS ordre : toujours les mêmes 500 lignes.
 * Une fois celles-ci relancées (journal `reminder_log`), les passages suivants
 * relisaient les mêmes, les sautaient, et la 501e facture n'était jamais lue.
 *
 * La preuve, sans envoyer 500 courriels : 500 factures en retard DÉJÀ
 * relancées (journal posé), puis 3 factures de plus, jamais relancées.
 *
 * Vrai cron, pile locale, bureau B « (b) » (le bureau A porte les factures
 * des mesures de charge).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { marque } from '../../automations-suite/harnais/moteur';
import { preparerBureau, ok, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { jourLocal } from './outils-b';

const TZ = 'America/Toronto';
const PALIER = 7;
const DEJA_RELANCEES = 500;

let b: Bureau;
let reglagesAvant: Record<string, unknown> | null = null;
let fuseauAvant = TZ;
/** Midi à Toronto, AUJOURD'HUI : dans les heures d'envoi, quelle que soit l'heure où le test tourne. */
const midi = () => new Date(`${jourLocal(TZ)}T16:00:00Z`);
const echeance = () => jourLocal(TZ, -10);
const m = marque('M22');
const crees: string[] = [];

async function client(nom: string, adresse: string): Promise<string> {
  const maintenant = new Date().toISOString();
  const c = await ok<{ id: string }>(b.admin.from('clients').insert({
    org_id: b.orgB, created_by: b.users.proprioB, first_name: 'Relance', last_name: nom, status: 'active', email: adresse,
    email_consent_at: maintenant,
  }).select('id').single(), 'client');
  return c.id;
}

const facture = (clientId: string, n: string) => ({
  org_id: b.orgB, client_id: clientId, created_by: b.users.proprioB, invoice_number: `M22-${Date.now().toString(36)}-${n}`,
  subtotal_cents: 12_000, tax_cents: 0, total_cents: 12_000, paid_cents: 0, balance_cents: 12_000,
  issued_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), status: 'sent', due_date: echeance(), subject: `Facture ${m} ${n}`,
});

async function passer() {
  const { executerRelancesPaiement } = await import('../../../server/routes/reminders-cron');
  return executerRelancesPaiement({ publicBase: 'https://staging.lume-qa.test', orgId: b.orgB, aujourdHui: midi() });
}

const relances = async (ids: string[]) => (await ok<Array<{ invoice_id: string; status: string }>>(
  b.admin.from('reminder_log').select('invoice_id, status').eq('org_id', b.orgB).eq('days_after_due', PALIER).in('invoice_id', ids), 'journal des relances',
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
  // Le bureau est rendu comme il était : les factures du test sortent de la fenêtre des relances.
  for (let i = 0; i < crees.length; i += 200) {
    await b.admin.from('invoices').update({ status: 'void', deleted_at: new Date().toISOString() }).in('id', crees.slice(i, i + 200));
  }
  await b.admin.from('company_settings').update({ timezone: fuseauAvant }).eq('org_id', b.orgB);
  viderCacheFuseau();
  if (reglagesAvant) await b.admin.from('reminder_settings').upsert(reglagesAvant, { onConflict: 'org_id' });
  else await b.admin.from('reminder_settings').delete().eq('org_id', b.orgB);
}, 120_000);

describe('B-22 — plus de 500 factures en retard dans un palier', () => {
  it('[M22-01] les factures au-delà de la 500e sont relancées elles aussi', async () => {
    // 500 factures en retard, DÉJÀ relancées à ce palier (leur ligne est au journal).
    const remplissage = await client(`${m} remplissage`, `m22-rempl-${Date.now().toString(36)}@lume-qa.test`);
    const anciennes: string[] = [];
    for (let i = 0; i < DEJA_RELANCEES; i += 100) {
      const lot = await ok<Array<{ id: string }>>(b.admin.from('invoices')
        .insert(Array.from({ length: 100 }, (_, k) => facture(remplissage, `a${i + k}`))).select('id'), 'factures déjà relancées');
      anciennes.push(...lot.map((f) => f.id));
    }
    crees.push(...anciennes);
    for (let i = 0; i < anciennes.length; i += 100) {
      await ok(b.admin.from('reminder_log').insert(anciennes.slice(i, i + 100).map((id) => ({
        org_id: b.orgB, invoice_id: id, days_after_due: PALIER, channel: 'email', sent_to: 'deja@lume-qa.test', status: 'sent',
      }))), 'journal posé');
    }

    // Puis 3 factures de plus, jamais relancées : les 501e, 502e et 503e.
    const adresse = `m22-${Date.now().toString(36)}@lume-qa.test`;
    const nouveau = await client(`${m} nouvelles`, adresse);
    const nouvelles = (await ok<Array<{ id: string }>>(b.admin.from('invoices')
      .insert(['n1', 'n2', 'n3'].map((n) => facture(nouveau, n))).select('id'), 'factures à relancer')).map((f) => f.id).sort();
    crees.push(...nouvelles);

    const depuis = new Date(Date.now() - 5_000).toISOString();
    const r = await passer();
    expect(r.hors_fenetre, 'le bureau doit être dans ses heures d’envoi').toBe(0);

    expect(await relances(nouvelles), `${JSON.stringify({ processed: r.processed, sent: r.sent, failed: r.failed })}`).toEqual(nouvelles);
    const envois = await ok<Array<{ id: string }>>(b.admin.from('envois_simules').select('id').eq('org_id', b.orgB).eq('destinataire', adresse).gte('created_at', depuis), 'envois');
    expect(envois).toHaveLength(3);
    // Aucune des 500 déjà relancées n'a été relancée une 2e fois.
    expect(r.sent).toBe(3);
  }, 600_000);

  it('[M22-02] un 2e passage le même jour ne relance personne une deuxième fois', async () => {
    const r = await passer();
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(0);
  }, 600_000);
});
