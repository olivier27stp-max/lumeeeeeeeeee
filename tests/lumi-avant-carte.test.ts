/**
 * Ce qui est vérifié — et dit — AVANT d'afficher la carte d'une écriture sur
 * une automatisation (`server/lib/lumi/avant-carte.ts`, mission finale).
 *
 * Une carte se confirme d'un clic. Si ce qu'elle propose est faux (variable
 * inventée, « plus court » qui est plus long, automatisation à la corbeille),
 * l'utilisateur ne le découvre qu'après avoir cliqué. Le contrôle a donc lieu
 * quand le modèle PROPOSE : le refus lui revient, il corrige dans le même tour.
 * Et une activation n'est jamais proposée sans que le serveur ait écrit, mot
 * pour mot, ce qui partira (A-13).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { base } = vi.hoisted(() => ({ base: { regle: null as Record<string, any> | null, evenements: 3 as number | null } }));

function clientDe(table: () => Record<string, any> | null) {
  const from = (_t: string) => {
    const q: any = {};
    for (const m of ['select', 'eq', 'is', 'gte', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: table(), error: null });
    q.then = (ok: any) => Promise.resolve({ data: null, error: null, count: base.evenements }).then(ok);
    return q;
  };
  return { from } as any;
}
vi.mock('../server/lib/supabase', () => ({
  getServiceClient: () => clientDe(() => null),
  companyOrgIds: async () => ['org'],
  isOrgAdminOrOwner: async () => true,
}));
vi.mock('../server/lib/security', () => ({ logSecurityEvent: async () => {} }));
vi.mock('../server/lib/config', () => ({ twilioClient: null, getTwilioStatusCallbackUrl: () => '' }));
vi.mock('../server/lib/helpers', () => ({ normalizeE164: (s: string) => s, findOrCreateConversation: async () => null }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => null, SmsNumberNotProvisionedError: class extends Error {}, SmsNotInPlanError: class extends Error {} }));

import { verifierAvantCarte, texteAvantCarte } from '../server/lib/lumi/avant-carte';

const ctx = { client: clientDe(() => base.regle), orgId: 'org', langue: 'fr' as const };
const texto = (id: string, body: string, suivant: string | null = null) => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });
const ACTUEL = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard. Vous pouvez la régler ici : [invoice_link]. Merci, [company_name]';
const regle = (plus: Record<string, any> = {}) => ({
  id: 'r1', name: 'Relance facture en retard', trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0,
  steps: [texto('e1', ACTUEL)], actions: [{ type: 'send_sms', config: { body: ACTUEL } }],
  settings: null, is_active: false, is_preset: false, deleted_at: null, ...plus,
});

beforeEach(() => { base.regle = regle(); base.evenements = 3; });

describe('les outils qui ne sont pas concernés passent sans lecture', () => {
  it('un autre outil : rien à vérifier', async () => {
    expect(await verifierAvantCarte('send_sms', { to: 'x' }, ctx)).toBeNull();
    expect(await texteAvantCarte('send_sms', { to: 'x' }, ctx)).toBeNull();
  });
});

describe('la cible : introuvable, à la corbeille (A-08)', () => {
  it('automatisation introuvable : refus ferme, avec quoi faire', async () => {
    base.regle = null;
    const r = await verifierAvantCarte('update_automation_sms_body', { rule_id: 'absente', body: 'Bonjour' }, ctx);
    expect(r).toMatchObject({ genre: 'ferme', code: 'introuvable' });
    expect(r!.message).toMatch(/get_automation/);
  });

  it('automatisation à la corbeille : aucune carte, pour aucun des outils', async () => {
    base.regle = regle({ deleted_at: '2026-10-01T00:00:00Z' });
    for (const [outil, args] of [
      ['update_automation_sms_body', { rule_id: 'r1', body: 'Bonjour' }],
      ['update_automation_message', { rule_id: 'r1', action_type: 'send_sms', body: 'Bonjour' }],
      ['update_automation_from_text', { rule_id: 'r1', instruction: 'ajoute un délai' }],
      ['toggle_automation_rule', { rule_id: 'r1', is_active: true }],
    ] as const) {
      expect(await verifierAvantCarte(outil, args, ctx), outil).toMatchObject({ genre: 'ferme', code: 'corbeille' });
    }
  });
});

describe('réécrire un message', () => {
  it('une variable inventée est refusée AVANT la carte (A-06)', async () => {
    const r = await verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: 'Bonjour [prenom_du_client], merci !' }, ctx);
    expect(r).toMatchObject({ genre: 'ferme', code: 'variables' });
    expect(r!.message).toMatch(/prenom_du_client/);
  });

  it('une variable connue passe', async () => {
    expect(await verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: 'Bonjour [client_first_name], merci !' }, ctx)).toBeNull();
  });

  it('« plus court » : le serveur compte — un texte aussi long ou plus long est refusé, avec une cible en MOTS', async () => {
    const plusLong = `${ACTUEL} Bonne journée !`;
    const r = await verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: plusLong, must_be_shorter: true }, ctx);
    expect(r).toMatchObject({ genre: 'ferme', code: 'pas_plus_court' });
    expect(r!.message).toContain(`${ACTUEL.length} caractères`);
    expect(r!.message).toContain(`${plusLong.length}`);
    // Un modèle ne sait pas compter des caractères : on lui donne des mots, et on lui dit de ne pas compter.
    expect(r!.message).toMatch(/vise \d+ mots environ/);
    expect(r!.message).toMatch(/Ne compte pas/);
    expect(await verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: 'Bonjour [client_first_name], facture [invoice_number] en retard : [invoice_link]', must_be_shorter: true }, ctx)).toBeNull();
  });

  it('un texto qui PASSE au-delà de 160 caractères est signalé une fois (A-18), pas refusé pour toujours', async () => {
    base.regle = regle({ steps: [texto('e1', 'Court.')] });
    const long = `Bonjour [client_first_name], ${'merci infiniment de votre confiance '.repeat(5)}`;
    expect(long.length).toBeGreaterThan(160);
    const r = await verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: long }, ctx);
    expect(r).toMatchObject({ genre: 'une_fois', code: 'trop_long' });
    expect(r!.message).toMatch(/facturé 2 SMS/);
  });

  it('un texto DÉJÀ long qui reste long n’est pas signalé (ce n’est pas ce changement qui le rend cher)', async () => {
    const dejaLong = 'a'.repeat(200);
    base.regle = regle({ steps: [texto('e1', dejaLong)] });
    expect(await verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: 'b'.repeat(190) }, ctx)).toBeNull();
  });

  it('plusieurs textos : il faut dire lequel — la liste est rendue pour poser UNE question', async () => {
    base.regle = regle({ steps: [texto('e1', 'Confirmation de rendez-vous', 'e2'), texto('e2', 'Rappel la veille')] });
    const r = await verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: 'Nouveau' }, ctx);
    expect(r).toMatchObject({ genre: 'ferme', code: 'lequel' });
    expect(r!.message).toMatch(/1\. « Confirmation de rendez-vous ».*2\. « Rappel la veille »/);
    expect(await verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: 'Nouveau', message_number: 2 }, ctx)).toBeNull();
    expect(await verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: 'Nouveau', message_number: 3 }, ctx)).toMatchObject({ code: 'numero' });
  });

  it('aucun message de ce type : rien à réécrire, et c’est dit', async () => {
    const r = await verifierAvantCarte('update_automation_message', { rule_id: 'r1', action_type: 'send_email', body: 'Bonjour', subject: 'Objet' }, ctx);
    expect(r).toMatchObject({ genre: 'ferme', code: 'aucun_message' });
    expect(r!.message).toMatch(/n’envoie pas de courriel/);
  });
});

describe('activer', () => {
  it('une automatisation qui porte encore le texte d’exemple de l’éditeur n’est pas proposée à l’activation', async () => {
    const { TEXTES_ACTION_PROVISOIRE } = await import('../src/lib/sequenceTypes');
    base.regle = regle({ steps: [], actions: [{ type: 'send_sms', config: { body: TEXTES_ACTION_PROVISOIRE[0] } }] });
    const r = await verifierAvantCarte('toggle_automation_rule', { rule_id: 'r1', is_active: true }, ctx);
    expect(r?.genre).toBe('ferme');
    expect(['texte_exemple', 'incomplete']).toContain(r!.code);
  });

  it('mettre en pause n’est jamais retenu', async () => {
    base.regle = regle({ is_active: true });
    expect(await verifierAvantCarte('toggle_automation_rule', { rule_id: 'r1', is_active: false }, ctx)).toBeNull();
    expect(await texteAvantCarte('toggle_automation_rule', { rule_id: 'r1', is_active: false }, ctx)).toBeNull();
  });

  it('A-13 — au-dessus de la carte, le SERVEUR écrit ce qui partira : déclencheur en clair, message mot pour mot, portée', async () => {
    const t = await texteAvantCarte('toggle_automation_rule', { rule_id: 'r1', is_active: true }, ctx);
    expect(t).toContain('Avant de publier « Relance facture en retard »');
    expect(t).toContain('Déclencheur : Facture en retard');
    expect(t).toContain(`« ${ACTUEL} »`);
    expect(t).toMatch(/0 client ne reçoit quoi que ce soit/);
    expect(t).toMatch(/arrivé 3 fois dans les 14 derniers jours/);
    expect(t).not.toMatch(/invoice\.overdue|send_sms/);
  });

  it('… en anglais dans une conversation en anglais (A-09)', async () => {
    const t = await texteAvantCarte('toggle_automation_rule', { rule_id: 'r1', is_active: true }, { ...ctx, langue: 'en' });
    expect(t).toContain('Before publishing');
    expect(t).toContain('Trigger : Invoice overdue');
    expect(t).toMatch(/0 clients receive anything/);
  });

  it('rien à dire pour une automatisation déjà publiée, ou qui n’écrit pas aux clients', async () => {
    base.regle = regle({ is_active: true });
    expect(await texteAvantCarte('toggle_automation_rule', { rule_id: 'r1', is_active: true }, ctx)).toBeNull();
    base.regle = regle({ steps: [{ id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler' } }, suivant: null }] });
    expect(await texteAvantCarte('toggle_automation_rule', { rule_id: 'r1', is_active: true }, ctx)).toBeNull();
  });
});

describe('un contrôle qui plante n’empêche pas une carte (le handler revérifie à l’exécution)', () => {
  it('lecture en erreur : null, pas d’exception', async () => {
    const casse = { ...ctx, client: { from: () => { throw new Error('base injoignable'); } } as any };
    await expect(verifierAvantCarte('update_automation_sms_body', { rule_id: 'r1', body: 'x' }, casse)).resolves.toBeNull();
    await expect(texteAvantCarte('toggle_automation_rule', { rule_id: 'r1', is_active: true }, casse)).resolves.toBeNull();
  });
});
