/**
 * Point 12 — réponses des clients.
 *
 *  · Deux bureaux ont un client au MÊME numéro. Le texto entrant va dans les
 *    Conversations du bureau dont le numéro a reçu le message, lié à SON
 *    client — jamais dans l'autre.
 *  · STOP : appliqué tout de suite, à toutes les automatisations du bureau
 *    qui l'a reçu (tâche déjà en file comprise) ; l'autre bureau n'est pas
 *    désabonné à la place du client.
 *
 * Vrai webhook Twilio signé (POST /api/messages/inbound, routeur réel monté
 * en mémoire), vrai moteur, pile locale, bureaux A et B « (b) » en bac à sable.
 * Le courriel entrant (boîte Gmail connectée) reste hors de portée : B-091.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NUMERO_A, NUMERO_B } from '../../automations-suite/harnais/bureau-test';
import { attendre, marque, traiterFile } from '../../automations-suite/harnais/moteur';
import { preparerBureau, apiEnMemoire, ok, smsEntrant, type Api, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { regle, texto, emettre, attendreTaches, tachesDe, journauxDe, envoisAvec } from './outils-b';

process.env.TWILIO_AUTH_TOKEN = 'qa_jeton_twilio_test_automatisations';
process.env.TWILIO_WEBHOOK_BASE_URL = 'https://twilio.lume-qa.test';

let b: Bureau & { fuseau: string };
let api: Api;
const TEL = '+12045550160';
const m = marque('B12');
let clientA = '';
let clientB = '';
let regleB = '';

async function clientDe(org: string, createur: string, nom: string): Promise<string> {
  const maintenant = new Date().toISOString();
  const c = await ok<{ id: string }>(b.admin.from('clients').insert({
    org_id: org, created_by: createur, first_name: 'Réponse', last_name: nom, status: 'active',
    email: `b12-${Math.random().toString(36).slice(2, 8)}@lume-qa.test`, phone: TEL, sms_consent_at: maintenant, email_consent_at: maintenant,
  }).select('id').single(), 'client');
  return c.id;
}

const messagesDe = (org: string) => ok<Array<{ id: string; client_id: string | null; conversation_id: string; message_text: string }>>(
  b.admin.from('messages').select('id, client_id, conversation_id, message_text').eq('org_id', org).eq('phone_number', TEL).eq('direction', 'inbound').order('created_at'), 'messages');

beforeAll(async () => {
  b = await preparerBureau();
  for (const org of [b.orgA, b.orgB]) {
    await b.admin.from('messages').delete().eq('org_id', org).eq('phone_number', TEL);
    await b.admin.from('conversations').delete().eq('org_id', org).eq('phone_number', TEL);
    await b.admin.from('clients').update({ phone: null }).eq('org_id', org).eq('phone', TEL);
    await b.admin.from('sms_opt_outs').delete().eq('org_id', org).eq('phone', TEL);
  }
  await ok(b.admin.from('communication_channels').update({ phone_number: NUMERO_A }).eq('org_id', b.orgA).eq('channel_type', 'sms'), 'numéro A');
  await ok(b.admin.from('communication_channels').update({ phone_number: NUMERO_B }).eq('org_id', b.orgB).eq('channel_type', 'sms'), 'numéro B');
  clientA = await clientDe(b.orgA, b.users.proprioA, `${m} A`);
  clientB = await clientDe(b.orgB, b.users.proprioB, `${m} B`);
  const messages = await import('../../../server/routes/messages');
  api = await apiEnMemoire(b, [{ routeur: messages.default }]);
});

afterAll(async () => {
  await api?.fermer();
  if (regleB) await b.admin.from('automation_rules').delete().eq('id', regleB);
  for (const org of [b.orgA, b.orgB]) await b.admin.from('sms_opt_outs').delete().eq('org_id', org).eq('phone', TEL);
});

describe('point 12 — le texto entrant va au BON bureau, lié au bon client', () => {
  it('[B12-01] le client répond au numéro du bureau B → Conversations de B, fiche de B ; rien dans A', async () => {
    const r = await smsEntrant(api, TEL, NUMERO_B, `Oui pour jeudi ${m}`);
    expect(r.status).toBe(200);
    const chezB = await attendre(() => messagesDe(b.orgB), (l) => l.length > 0, 15_000);
    expect(chezB).toHaveLength(1);
    expect(chezB[0].client_id).toBe(clientB);
    expect(await messagesDe(b.orgA)).toHaveLength(0);
  });

  it('[B12-02] le même client répond au numéro du bureau A → Conversations de A, fiche de A ; B inchangé', async () => {
    const r = await smsEntrant(api, TEL, NUMERO_A, `Parfait merci ${m}`);
    expect(r.status).toBe(200);
    const chezA = await attendre(() => messagesDe(b.orgA), (l) => l.length > 0, 15_000);
    expect(chezA).toHaveLength(1);
    expect(chezA[0].client_id).toBe(clientA);
    expect(await messagesDe(b.orgB)).toHaveLength(1);
  });
});

describe('point 12 — STOP : appliqué tout de suite à toutes les automatisations du bureau qui l’a reçu', () => {
  let regleDifferee = '';
  let regleImmediate = '';
  const mDiff = marque('B12-differe');
  const mImm = marque('B12-immediat');
  const mB = marque('B12-bureauB');

  it('[B12-03] un texto est déjà en file ; le client écrit STOP au bureau A → la désinscription est enregistrée dans A, pas dans B', async () => {
    regleDifferee = await regle(b, mDiff, { trigger_event: 'note.added', delay_seconds: 86_400, actions: [texto(mDiff, 'Relance')], settings: { fenetre: { debut: 0, fin: 24 } } });
    await emettre(b, 'note.added', 'client', clientA);
    await attendreTaches(b, regleDifferee, 1);

    expect((await smsEntrant(api, TEL, NUMERO_A, 'STOP')).status).toBe(200);
    const stops = await attendre(
      () => ok<Array<{ org_id: string }>>(b.admin.from('sms_opt_outs').select('org_id').eq('phone', TEL).in('org_id', [b.orgA, b.orgB]), 'désinscriptions'),
      (l) => l.length > 0, 15_000);
    expect(stops.map((s) => s.org_id)).toEqual([b.orgA]);
  });

  it('[B12-04] le texto qui était en file ne part pas (délai écoulé), avec la raison au journal', async () => {
    await ok(b.admin.from('automation_scheduled_tasks').update({ execute_at: new Date(Date.now() - 1_000).toISOString() }).eq('automation_rule_id', regleDifferee).eq('status', 'pending'), 'échéance');
    await traiterFile(b.admin, b.orgA);
    const envois = await envoisAvec(b, mDiff);
    expect(envois).toHaveLength(0);
    const [t] = await tachesDe(b, regleDifferee);
    const lignes = await journauxDe(b, regleDifferee);
    const raison = `${t.last_error ?? ''} ${lignes.map((l) => `${l.result_data?.saute ?? ''} ${l.result_error ?? ''}`).join(' ')}`;
    expect(raison).toMatch(/STOP|désabonn|desabonn|opt/i);
  });

  it('[B12-05] une AUTRE automatisation du bureau A, immédiate, ne lui écrit plus', async () => {
    regleImmediate = await regle(b, mImm, { trigger_event: 'note.added', actions: [texto(mImm, 'Confirmation')], settings: { fenetre: { debut: 0, fin: 24 } } });
    await ok(b.admin.from('automation_rules').update({ is_active: false }).eq('id', regleDifferee), 'première règle éteinte');
    await emettre(b, 'note.added', 'client', clientA);
    await new Promise((r) => setTimeout(r, 2_000));
    const envois = await envoisAvec(b, mImm);
    expect(envois).toHaveLength(0);
  });

  it('[B12-06] le bureau B, à qui le client n’a pas dit STOP, peut encore lui écrire', async () => {
    const r = await ok<{ id: string }>(b.admin.from('automation_rules').insert({
      org_id: b.orgB, name: mB, trigger_event: 'note.added', conditions: {}, delay_seconds: 0, is_active: true, is_preset: false,
      actions: [texto(mB, 'Confirmation')], settings: { fenetre: { debut: 0, fin: 24 } },
    }).select('id').single(), 'règle B');
    regleB = r.id;
    await b.eventBus.emit('note.added' as never, { orgId: b.orgB, entityType: 'client', entityId: clientB, metadata: {} } as never);
    const envois = await attendre(
      () => envoisAvec(b, mB, b.orgB),
      (l) => l.length > 0, 20_000);
    expect(envois).toHaveLength(1);
    expect(envois[0].destinataire).toBe(TEL);
  });
});
