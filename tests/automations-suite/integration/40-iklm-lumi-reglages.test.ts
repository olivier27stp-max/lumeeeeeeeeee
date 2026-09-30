/**
 * I — Activer, mettre en pause, réécrire un message, changer la langue des
 * automatisations : par Lumi (vrai modèle, vrai chemin /api/lumi/chat →
 * carte → /api/lumi/execute), identité JWT du propriétaire du bureau A.
 * L'effet est vérifié EN BASE, et pour l'activation, par le vrai moteur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { demarrerMoteur, marque, attendre } from '../harnais/moteur';
import { sessionDe, COMPTES } from '../harnais/bureau-test';
import { demanderALumi, deciderCarte, depenseDepuis, arreterApiLumi, type SessionLumi, type ReponseLumi } from '../harnais/lumi-api';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
let s: SessionLumi;
const debut = new Date().toISOString();
const m = marque('I-reglages');
const NOM_SMS = `Relance essai ${m.slice(-9, -1)}`;
const NOM_COURRIEL = `Suivi courriel ${m.slice(-9, -1)}`;
let idSms = '';
let idCourriel = '';

/** Un tour : demande, puis confirmation de la carte si Lumi en propose une. */
async function faire(message: string, outilsAttendus: string[]): Promise<{ r: ReponseLumi; c: ReponseLumi | null }> {
  const r = await demanderALumi(s, message);
  const ok = r.proposition && outilsAttendus.includes(r.proposition.tool);
  const c = ok && r.conversation_id ? await deciderCarte(s, r.conversation_id, r.proposition!.tool_use_id, 'confirm') : null;
  return { r, c };
}
const diag = (x: { r: ReponseLumi; c: ReponseLumi | null }) => JSON.stringify({ texte: x.r.texte.slice(0, 300), outils: x.r.outils, proposition: x.r.proposition, recu: x.c?.texte, executes: x.c?.executes });

beforeAll(async () => {
  b = await demarrerMoteur();
  s = { jeton: (await sessionDe(b.admin, COMPTES.proprioA.email)).jeton, orgId: b.orgA, langue: 'fr' };
  await b.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA);
  const { data, error } = await b.admin.from('automation_rules').insert([
    {
      org_id: b.orgA, name: NOM_SMS, trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0, actions: [], is_active: false,
      steps: [
        { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], ancien texte. [company_name]' } } },
      ],
    },
    {
      org_id: b.orgA, name: NOM_COURRIEL, trigger_event: 'quote.approved', conditions: {}, delay_seconds: 0, actions: [], is_active: false,
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: 'Ancien objet', body: '<p>Bonjour [client_first_name], ancien courriel.</p>' } } }],
    },
  ]).select('id, name');
  if (error) throw new Error(error.message);
  idSms = data!.find((x) => x.name === NOM_SMS)!.id;
  idCourriel = data!.find((x) => x.name === NOM_COURRIEL)!.id;
});

afterAll(async () => {
  await b.admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', [idSms, idCourriel]).eq('org_id', b.orgA);
  await b.admin.from('automation_rules').delete().in('id', [idSms, idCourriel]).eq('org_id', b.orgA);
  await b.admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA);
  await arreterApiLumi();
});

describe('I — Lumi règle les automatisations existantes (effet en base)', () => {
  it('[I-024] « Active l’automatisation X » → carte toggle_automation_rule → publiée, et le moteur la déclenche', async () => {
    const x = await faire(`Active mon automatisation « ${NOM_SMS} ».`, ['toggle_automation_rule']);
    expect(x.r.proposition?.tool, diag(x)).toBe('toggle_automation_rule');
    expect(x.r.proposition?.args.is_active, diag(x)).toBe(true);
    expect(x.c?.executes.every((e) => e.ok), diag(x)).toBe(true);
    const { data } = await b.admin.from('automation_rules').select('is_active').eq('id', idSms).single();
    expect(data!.is_active).toBe(true);
    // Effet réel : un devis envoyé inscrit l'entité dans le parcours (1re étape planifiée).
    const devis = randomUUID();
    await b.eventBus.emit('quote.sent', { orgId: b.orgA, entityType: 'quote', entityId: devis, metadata: {} });
    const taches = await attendre(
      async () => (await b.admin.from('automation_scheduled_tasks').select('id, status').eq('automation_rule_id', idSms).eq('entity_id', devis)).data ?? [],
      (t) => t.length > 0,
    );
    expect(taches.map((t) => t.status)).toEqual(['pending']);
  });

  it('[I-025] « Mets en pause l’automatisation X » → dépubliée', async () => {
    const x = await faire(`Mets en pause l’automatisation « ${NOM_SMS} ».`, ['toggle_automation_rule']);
    expect(x.r.proposition?.tool, diag(x)).toBe('toggle_automation_rule');
    expect(x.r.proposition?.args.is_active, diag(x)).toBe(false);
    expect(x.c?.executes.every((e) => e.ok), diag(x)).toBe(true);
    const { data } = await b.admin.from('automation_rules').select('is_active').eq('id', idSms).single();
    expect(data!.is_active).toBe(false);
  });

  it('[I-026] « Change le texto de X pour … » → l’étape texto (steps) porte exactement le nouveau texte', async () => {
    const texte = 'Bonjour [client_first_name], petit rappel au sujet de votre soumission. [company_name]';
    const x = await faire(`Change le texto de l’automatisation « ${NOM_SMS} » pour exactement ce texte : ${texte}`, ['update_automation_sms_body', 'update_automation_message']);
    expect(['update_automation_sms_body', 'update_automation_message'], diag(x)).toContain(x.r.proposition?.tool);
    expect(x.c?.executes.every((e) => e.ok), diag(x)).toBe(true);
    const { data } = await b.admin.from('automation_rules').select('steps').eq('id', idSms).single();
    const etape = (data!.steps as Array<{ type: string; action?: { type: string; config: { body: string } } }>).find((e) => e.action?.type === 'send_sms');
    expect(etape?.action?.config.body).toBe(texte);
  });

  it('[I-027] « Change l’objet et le texte du courriel de X » → objet et corps de l’étape courriel', async () => {
    const objet = 'Votre soumission est acceptée';
    const corps = 'Bonjour [client_first_name], merci pour votre confiance. [company_name]';
    const x = await faire(`Dans l’automatisation « ${NOM_COURRIEL} », change le courriel : objet « ${objet} », texte « ${corps} ».`, ['update_automation_message']);
    expect(x.r.proposition?.tool, diag(x)).toBe('update_automation_message');
    expect(x.c?.executes.every((e) => e.ok), diag(x)).toBe(true);
    const { data } = await b.admin.from('automation_rules').select('steps').eq('id', idCourriel).single();
    const cfg = (data!.steps as Array<{ action?: { type: string; config: { subject: string; body: string } } }>)[0].action!.config;
    expect(cfg.subject).toBe(objet);
    expect(cfg.body).toContain('merci pour votre confiance');
  });

  it('[I-028] « Mes messages automatiques doivent partir en anglais » → set_automation_language en', async () => {
    const x = await faire('À partir de maintenant, mes messages automatiques aux clients doivent partir en anglais.', ['set_automation_language']);
    expect(x.r.proposition?.tool, diag(x)).toBe('set_automation_language');
    expect(x.c?.executes.every((e) => e.ok), diag(x)).toBe(true);
    const { data } = await b.admin.from('company_settings').select('default_language').eq('org_id', b.orgA).single();
    expect(data!.default_language).toBe('en');
  });

  it('[I-029] le coût de ces cinq demandes reste sous 20 ¢', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const cents = await depenseDepuis(b.admin, b.orgA, debut);
    console.info(`[I-029] coût de la passe « réglages » : ${cents.toFixed(2)} ¢`);
    expect(cents).toBeLessThan(20);
  });
});
