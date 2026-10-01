/**
 * Point 11 — à quelle heure partent VRAIMENT les envois ?
 *
 *  · Le détecteur de factures en retard tourne au tick de 5 min, jour ET nuit,
 *    et « aujourd'hui » se compte dans le fuseau de l'entreprise : une facture
 *    devient « en retard » à minuit, heure locale. On pose donc le fuseau du
 *    bureau de test là où il est EN CE MOMENT en pleine nuit, et on regarde ce
 *    qui part.
 *  · La fenêtre 8 h-20 h : pour qui, réglable où, et le report est-il visible ?
 *  · Le changement d'heure du 1er novembre 2026 (America/Toronto).
 *
 * Vrai moteur, pile locale, bureau A « (b) » en bac à sable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { marque } from '../../automations-suite/harnais/moteur';
import { preparerBureau, ok, creerClient, type Bureau } from '../../automations-suite/integration/10-b-outils';
import {
  regle, courriel, texto, envoisAvec, factureEnRetard, tachesDe, journauxDe, fuseauEnPleineNuit, heureLocale, poserFuseau, jourLocal,
} from './outils-b';

let b: Bureau & { fuseau: string };
let nuit = '';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  b = await preparerBureau();
  nuit = fuseauEnPleineNuit();
});
afterAll(async () => { await poserFuseau(b, b.fuseau); });

describe('point 11 — une facture devient « en retard » à minuit : que reçoit le client en pleine nuit ?', () => {
  const mCourriel = marque('B11-courriel');
  const mTexto = marque('B11-texto');
  const mParcours = marque('B11-parcours');
  let idParcours = '';
  let idCourriel = '';
  let idTexto = '';
  let heure = -1;

  beforeAll(async () => {
    const { detectOverdueInvoices } = await import('../../../server/lib/scheduler');
    await poserFuseau(b, nuit);
    heure = heureLocale(nuit);
    const c1 = await creerClient(b, mCourriel);
    const c2 = await creerClient(b, mTexto);
    // Deux automatisations NEUVES, sans aucun réglage de fenêtre — ce qu'un propriétaire crée en deux clics.
    idCourriel = await regle(b, mCourriel, { trigger_event: 'invoice.overdue', conditions: { days_overdue: 1 }, actions: [courriel(mCourriel, 'Votre facture est en retard')] });
    idTexto = await regle(b, mTexto, { trigger_event: 'invoice.overdue', conditions: { days_overdue: 3 }, actions: [texto(mTexto, 'Votre facture est en retard')] });
    // La même automatisation au format de l'ÉDITEUR plein écran (un parcours : `steps`), jalon J+5.
    const c3 = await creerClient(b, mParcours);
    const action = courriel(mParcours, 'Votre facture est en retard');
    idParcours = await regle(b, mParcours, { trigger_event: 'invoice.overdue', conditions: { days_overdue: 5 }, actions: [action], steps: [{ id: 'm1', type: 'action', action, suivant: null }] });
    await factureEnRetard(b, mParcours, c3.id, 5, nuit);
    await factureEnRetard(b, mCourriel, c1.id, 1, nuit);
    await factureEnRetard(b, mTexto, c2.id, 3, nuit);
    // Le tick de 5 min, tel que le serveur le fait tourner la nuit.
    await detectOverdueInvoices(b.admin, { orgId: b.orgA });
    await pause(6_000);
  }, 300_000);

  it('le bureau est bien en pleine nuit (entre 1 h et 5 h, heure locale)', () => {
    expect(heure).toBeGreaterThanOrEqual(1);
    expect(heure).toBeLessThanOrEqual(5);
  });

  it('[B11-00] automatisation faite dans l’éditeur (parcours) : le courriel attend 8 h — la première étape passe par la file', async () => {
    const { traiterFile } = await import('../../automations-suite/harnais/moteur');
    await traiterFile(b.admin, b.orgA); // le tick de 5 min dépile la file : hors fenêtre → reporté
    expect((await envoisAvec(b, mParcours)).length).toBe(0);
    const [t] = await tachesDe(b, idParcours);
    expect(t?.status).toBe('pending');
    expect(heureLocale(nuit, new Date(t.execute_at))).toBe(8);
  });

  it('[B11-01] automatisation « à plat » (préréglage, API, ancien format) : le COURRIEL « facture en retard » ne part PAS en pleine nuit', async () => {
    const envois = await envoisAvec(b, mCourriel);
    expect(envois.length, `courriel parti à ${heure} h, heure locale de l’entreprise`).toBe(0);
    const [t] = await tachesDe(b, idCourriel);
    expect(t?.status).toBe('pending');
  });

  it('[B11-02] le TEXTO « facture en retard » ne part pas la nuit : reporté à 8 h, heure de l’entreprise', async () => {
    expect((await envoisAvec(b, mTexto)).length).toBe(0);
    const [t] = await tachesDe(b, idTexto);
    expect(t?.status).toBe('pending');
    expect(t.action_config.report_heures_calmes).toBe(true);
    expect(heureLocale(nuit, new Date(t.execute_at))).toBe(8);
  });

  it('[B11-03] le report « hors heures d’envoi » laisse une ligne lisible au JOURNAL de l’automatisation', async () => {
    const lignes = await journauxDe(b, idTexto);
    // Attendu par la mission : « ignoré / reporté : hors heures d'envoi », visible dans les Journaux.
    expect(lignes.length, 'aucune ligne de journal : le report n’existe que comme tâche en attente').toBeGreaterThan(0);
    expect(JSON.stringify(lignes)).toMatch(/heures|fenêtre|report/i);
  });
});

describe('point 11 — le cron des relances de paiement (13:00 UTC) ignore l’heure de l’entreprise', () => {
  // Dans le bureau B : le bureau A porte les 600 factures de la mesure de charge, et le cron lit
  // 500 factures par palier SANS ordre (reminders-cron.ts) — la nôtre n'y serait pas à coup sûr.
  it('[B11-04] une entreprise pour qui il est la nuit ne relance pas ses clients à cette heure', async () => {
    const { executerRelancesPaiement } = await import('../../../server/routes/reminders-cron');
    const { viderCacheFuseau } = await import('../../../server/lib/automations-fuseau-org');
    const m = marque('B11-relance');
    const adresse = `b11-${Date.now().toString(36)}@lume-qa.test`;
    const avant = await ok<Record<string, unknown> | null>(b.admin.from('reminder_settings').select('*').eq('org_id', b.orgB).maybeSingle(), 'réglages');
    const fuseauAvant = await ok<{ timezone: string }>(b.admin.from('company_settings').select('timezone').eq('org_id', b.orgB).single(), 'fuseau B');
    await ok(b.admin.from('company_settings').update({ timezone: nuit }).eq('org_id', b.orgB), 'fuseau de nuit');
    viderCacheFuseau();
    await ok(b.admin.from('reminder_settings').upsert({ org_id: b.orgB, enabled: true, schedule: [{ days_after_due: 1, channel: 'email' }] }, { onConflict: 'org_id' }), 'réglages relances');
    try {
      const maintenant = new Date().toISOString();
      const c = await ok<{ id: string }>(b.admin.from('clients').insert({
        org_id: b.orgB, created_by: b.users.proprioB, first_name: 'Relance', last_name: m, status: 'active', email: adresse,
        phone: '+12045550162', email_consent_at: maintenant, sms_consent_at: maintenant,
      }).select('id').single(), 'client B');
      await ok(b.admin.from('invoices').insert({
        org_id: b.orgB, client_id: c.id, created_by: b.users.proprioB, invoice_number: `B11-${Date.now().toString(36)}`,
        subtotal_cents: 20_000, tax_cents: 0, total_cents: 20_000, paid_cents: 0, balance_cents: 20_000,
        issued_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), status: 'sent', due_date: jourLocal(nuit, -3), subject: `Facture ${m}`,
      }), 'facture B');
      const depuis = new Date(Date.now() - 5_000).toISOString();
      await executerRelancesPaiement({ publicBase: 'https://staging.lume-qa.test', orgId: b.orgB });
      const { data } = await b.admin.from('envois_simules').select('id').eq('org_id', b.orgB).eq('destinataire', adresse).gte('created_at', depuis);
      expect((data ?? []).length, `relance envoyée à ${heureLocale(nuit)} h, heure locale de l’entreprise`).toBe(0);
    } finally {
      await b.admin.from('company_settings').update({ timezone: fuseauAvant.timezone }).eq('org_id', b.orgB);
      viderCacheFuseau();
      if (avant) await b.admin.from('reminder_settings').upsert(avant, { onConflict: 'org_id' });
      else await b.admin.from('reminder_settings').delete().eq('org_id', b.orgB);
    }
  });
});

describe('point 11 — changement d’heure du 1er novembre 2026 (America/Toronto : 2 h → 1 h)', () => {
  const TZ = 'America/Toronto';

  it('[B11-10] un message prêt dans la nuit du 31 octobre au 1er novembre part à 8 h 00 HEURE NORMALE (13:00 UTC), pas à 7 h ni à 9 h', async () => {
    const { nextSendTime, horsFenetre } = await import('../../../server/lib/automationEngine');
    // 31 oct. 23 h 30 HAE = 03:30 UTC le 1er nov.
    expect(nextSendTime(new Date('2026-11-01T03:30:00Z'), null, TZ).toISOString()).toBe('2026-11-01T13:00:00.000Z');
    // Pendant l'heure répétée (1 h 30 HNE = 06:30 UTC).
    expect(nextSendTime(new Date('2026-11-01T06:30:00Z'), null, TZ).toISOString()).toBe('2026-11-01T13:00:00.000Z');
    // La veille du changement, 8 h HAE = 12:00 UTC : la fenêtre ouvre bien une heure UTC plus tôt.
    expect(nextSendTime(new Date('2026-10-31T03:30:00Z'), null, TZ).toISOString()).toBe('2026-10-31T12:00:00.000Z');
    // 12:30 UTC le 1er nov. = 7 h 30 HNE : encore hors fenêtre (c'était 8 h 30 la veille).
    expect(horsFenetre(null, new Date('2026-11-01T12:30:00Z'), TZ)).toBe(true);
    // Fin de fenêtre : 19 h 59 HNE = 00:59 UTC le 2 nov. ; 20 h 00 HNE = 01:00 UTC.
    expect(horsFenetre(null, new Date('2026-11-02T00:59:00Z'), TZ)).toBe(false);
    expect(horsFenetre(null, new Date('2026-11-02T01:00:00Z'), TZ)).toBe(true);
  });

  it('[B11-11] un rappel « 24 h avant » un rendez-vous du 1er novembre à 14 h part le 31 octobre à 14 h (heure locale), pas à 15 h', async () => {
    const { corrigerChangementDHeure } = await import('../../../server/lib/automations-fuseau-org');
    const rdv = Date.parse('2026-11-01T19:00:00Z'); // 14 h HNE
    const brut = rdv - 86_400_000; // 31 oct. 19:00 UTC = 15 h HAE
    expect(new Date(corrigerChangementDHeure(rdv, brut, TZ)).toISOString()).toBe('2026-10-31T18:00:00.000Z'); // 14 h HAE
  });

  it('[B11-12] un rappel « 2 h avant » un rendez-vous du 1er novembre à 9 h reste à 7 h locale (2 h d’horloge réelle avant)', async () => {
    const { corrigerChangementDHeure } = await import('../../../server/lib/automations-fuseau-org');
    const rdv = Date.parse('2026-11-01T14:00:00Z'); // 9 h HNE
    const brut = rdv - 2 * 3600_000; // 12:00 UTC = 7 h HNE (même côté du changement)
    expect(new Date(corrigerChangementDHeure(rdv, brut, TZ)).toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });

  it('[B11-13] « jours de retard » le 1er novembre : une facture échue le 31 octobre a 1 jour de retard toute la journée (25 h)', async () => {
    // Le calcul du détecteur (server/lib/scheduler.ts, jourDans + joursDeRetard), sur les bornes du jour de 25 h.
    const jourDans = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const retard = (d: Date) => Math.round((Date.parse(`${jourDans(d)}T00:00:00Z`) - Date.parse('2026-10-31T00:00:00Z')) / 86_400_000);
    expect(retard(new Date('2026-11-01T04:00:00Z'))).toBe(1); // 0 h 00 HAE
    expect(retard(new Date('2026-11-01T06:30:00Z'))).toBe(1); // 1 h 30 HNE (heure répétée)
    expect(retard(new Date('2026-11-02T04:59:00Z'))).toBe(1); // 23 h 59 HNE
    expect(retard(new Date('2026-11-02T05:00:00Z'))).toBe(2); // 0 h 00 HNE le 2
  });
});
