/**
 * PR 3 — Facture consultée par le client (drapeau `auto_consultation_documents`).
 *
 * La soumission a déjà son déclencheur (#704, `quote.viewed`) : on réutilise
 * sa mécanique pour la facture.
 *  - Première vue → déclenche ; deuxième vue → ne déclenche pas (mode par
 *    défaut « première ») ; « chaque » → déclenche les deux fois.
 *  - Membre connecté / aperçu ignorés ; robot ignoré ; ouverture < 2 s après
 *    l'envoi ignorée ; doublon de session (30 min, en base) ignoré.
 *  - Variables {{facture.nb_vues}} / {{facture.consultee_le}} : drapeau
 *    seulement (l'action webhook envoie toutes les variables).
 *  - Le déclencheur n'est offert qu'aux entreprises qui ont le drapeau.
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

import { enregistrerOuvertureFacture, type FactureServie } from '../../server/lib/vuesFacture';
import { eventBus } from '../../server/lib/eventBus';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';
import { resolveEntityVariables, resolveTemplate } from '../../server/lib/actions';
import { DECLENCHEURS, declencheurOffert } from '../../src/lib/automationCatalogue';
import { clientEnregistreur, requetes } from './filet-regression/_enregistreur';
import { jouer, evenementPour, courant, monde, IDS, ORG } from './filet-regression/_banc';

process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
const TZ = process.env.TZ;
const NAVIGATEUR = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const facture: FactureServie = {
  id: IDS.facture, org_id: ORG, client_id: IDS.client, invoice_number: 'INV-000042',
  total_cents: 162690, balance_cents: 162690, sent_at: '2026-09-01T12:00:00Z',
};
const requete = (entetes: Record<string, string> = {}) => ({ headers: { 'user-agent': NAVIGATEUR, 'x-lume-session': 'onglet-1', ...entetes } }) as any;

/** Le serveur tel que la RPC `enregistrer_vue_facture` le voit. */
function base(reponseRpc: Record<string, unknown> | null, rpcErreur?: string) {
  return clientEnregistreur({
    'rpc:enregistrer_vue_facture': { data: reponseRpc, error: rpcErreur ? { message: rpcErreur } : null },
    clients: { data: [{ first_name: 'Marie', last_name: 'Tremblay', tags: [] }] },
    memberships: { data: [] },
    notifications: { data: [] },
  });
}

let emis: any[] = [];
beforeEach(() => {
  oublierDrapeaux();
  emis = [];
  eventBus.removeAllListeners();
  eventBus.on('invoice.viewed', (e: unknown) => { emis.push(e); });
  Object.defineProperty(etat.client, 'current', { get: () => courant.client, configurable: true });
});
afterEach(() => { vi.useRealTimers(); if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

describe('enregistrement d\'une consultation', () => {
  it('première vue : compte, prévient l\'équipe, émet invoice.viewed (première ET chaque)', async () => {
    const { client, journal } = base({ enregistree: true, premiere: true, nb_vues: 1, contact_id: IDS.client });
    expect(await enregistrerOuvertureFacture(client, requete(), facture)).toBe('enregistree');
    const rpc = requetes(journal, 'rpc:enregistrer_vue_facture', 'rpc')[0].valeur as any;
    expect(rpc.p_invoice_id).toBe(IDS.facture);
    // Loi 25 : des empreintes, jamais la valeur en clair.
    expect(rpc.p_user_agent_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rpc.p_session_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rpc)).not.toContain('Safari');
    expect(requetes(journal, 'notifications', 'insert')).toHaveLength(1);
    expect(emis).toHaveLength(1);
    expect(emis[0]).toMatchObject({ type: 'invoice.viewed', orgId: ORG, entityType: 'invoice', entityId: IDS.facture });
    expect(emis[0].metadata).toMatchObject({ is_first_view: true, view_count: 1, ouverture: ['premiere', 'chaque'], client_id: IDS.client });
  });

  it('deuxième vue : émet « chaque » seulement, pas de nouvelle notification', async () => {
    const { client, journal } = base({ enregistree: true, premiere: false, nb_vues: 2, contact_id: IDS.client });
    await enregistrerOuvertureFacture(client, requete(), facture);
    expect(requetes(journal, 'notifications', 'insert')).toHaveLength(0);
    expect(emis[0].metadata).toMatchObject({ is_first_view: false, view_count: 2, ouverture: ['chaque'] });
  });

  it('aperçu depuis l\'app : ignoré, rien n\'est compté', async () => {
    const { client, journal } = base({ enregistree: true, premiere: true, nb_vues: 1 });
    expect(await enregistrerOuvertureFacture(client, requete({ 'x-lume-apercu': '1' }), facture)).toBe('interne');
    expect(requetes(journal, 'rpc:enregistrer_vue_facture')).toHaveLength(0);
    expect(emis).toHaveLength(0);
  });

  it('membre connecté de l\'entreprise : ignoré', async () => {
    const { client } = clientEnregistreur({ memberships: { data: [{ user_id: IDS.owner }] } });
    client.auth = { getUser: async () => ({ data: { user: { id: IDS.owner } } }) };
    expect(await enregistrerOuvertureFacture(client, requete({ authorization: 'Bearer jeton-equipe' }), facture)).toBe('interne');
    expect(emis).toHaveLength(0);
  });

  it.each(['Mozilla/5.0 (compatible; bingbot/2.0)', 'Microsoft Office Outlook', 'Slackbot-LinkExpanding 1.0', ''])('robot / scanner « %s » : ignoré', async (ua) => {
    const { client, journal } = base({ enregistree: true, premiere: true, nb_vues: 1 });
    expect(await enregistrerOuvertureFacture(client, { headers: { 'user-agent': ua } } as any, facture)).toBe('robot');
    expect(requetes(journal, 'rpc:enregistrer_vue_facture')).toHaveLength(0);
  });

  it('ouverture moins de 2 s après l\'envoi : ignorée (scanner de lien)', async () => {
    const { client } = base({ enregistree: true, premiere: true, nb_vues: 1 });
    const r = await enregistrerOuvertureFacture(client, requete(), { ...facture, sent_at: new Date(Date.now() - 800).toISOString() });
    expect(r).toBe('trop_tot');
    expect(emis).toHaveLength(0);
  });

  it('même session dans les 30 min : doublon, rien d\'émis', async () => {
    const { client } = base({ enregistree: false, raison: 'doublon' });
    expect(await enregistrerOuvertureFacture(client, requete(), facture)).toBe('doublon');
    expect(emis).toHaveLength(0);
  });

  it('un échec d\'enregistrement ne lève jamais (la facture s\'affiche quand même)', async () => {
    const { client } = base(null, 'panne');
    expect(await enregistrerOuvertureFacture(client, requete(), facture)).toBe('erreur');
  });
});

describe('le déclencheur dans le moteur', () => {
  const regle = (ouverture: 'premiere' | 'chaque') => ({
    id: `r-vue-${ouverture}`, trigger_event: 'invoice.viewed', delay_seconds: 0,
    conditions: { ouverture },
    actions: [{ type: 'create_notification', config: { title: 'Facture consultée', body: '{{facture.nb_vues}} vue(s)' } }],
  });
  const ON = { org_features: { data: [{ feature: 'auto_consultation_documents', enabled: true }] } };
  const deuxieme = { ...evenementPour('invoice.viewed'), metadata: { ...evenementPour('invoice.viewed').metadata, is_first_view: false, view_count: 2, ouverture: ['chaque'] } };
  const notifs = (s: any) => s.ecritures.filter((w: any) => w.table === 'notifications' && w.op === 'insert');

  it('« première » (défaut) : la 1re vue déclenche, la 2e non', async () => {
    expect(notifs(await jouer(regle('premiere'), evenementPour('invoice.viewed'), etat.e, ON))).toHaveLength(1);
    expect(notifs(await jouer(regle('premiere'), deuxieme, etat.e, ON))).toHaveLength(0);
  });

  it('« chaque » : les deux vues déclenchent', async () => {
    expect(notifs(await jouer(regle('chaque'), evenementPour('invoice.viewed'), etat.e, ON))).toHaveLength(1);
    expect(notifs(await jouer(regle('chaque'), deuxieme, etat.e, ON))).toHaveLength(1);
  });

  it('les variables de consultation sont résolues', async () => {
    const m = monde({ id: 'x', trigger_event: 'invoice.viewed' });
    const { client } = clientEnregistreur({ ...m, ...ON, invoices: { data: [{ ...m.invoices.data[0], view_count: 3, viewed_at: '2026-09-13T13:00:00Z' }] } });
    oublierDrapeaux();
    const vars = await resolveEntityVariables(client, ORG, 'invoice', IDS.facture);
    expect(resolveTemplate('{{facture.nb_vues}} vues — {{facture.lien}}', vars)).toBe('3 vues — https://app.lume.test/invoice/bbbbbbbb-0000-4000-8000-000000000002');
    expect(vars['facture.consultee_le']).toMatch(/2026/);
  });

  it('drapeau OFF : aucune variable de consultation (la charge d\'un webhook ne change pas)', async () => {
    const m = monde({ id: 'x', trigger_event: 'invoice.viewed' });
    const { client } = clientEnregistreur(m);
    oublierDrapeaux();
    const vars = await resolveEntityVariables(client, ORG, 'invoice', IDS.facture);
    expect(Object.keys(vars).some((k) => k.startsWith('facture.'))).toBe(false);
  });
});

describe('le catalogue', () => {
  const d = DECLENCHEURS.find((x) => x.cle === 'invoice.viewed')!;
  it('« Facture consultée par le client », première consultation par défaut', () => {
    expect(d.fr).toBe('Facture consultée par le client');
    expect(d.conditions_defaut).toEqual({ ouverture: 'premiere' });
  });
  it('offert seulement avec le drapeau', () => {
    expect(declencheurOffert(d, new Set())).toBe(false);
    expect(declencheurOffert(d, new Set(['auto_consultation_documents']))).toBe(true);
    // Les déclencheurs sans drapeau restent offerts à tous.
    expect(declencheurOffert(DECLENCHEURS.find((x) => x.cle === 'quote.viewed')!, new Set())).toBe(true);
  });
});
