/**
 * CANARI — à passer AVANT tout le reste. S'il échoue, rien d'autre ne tourne
 * (vitest.automations.config.ts : bail) : un envoi réel serait possible.
 *
 * Prouve deux choses :
 *  1. Les pièges DÉTECTENT un envoi réel : un envoi d'une entreprise hors bac
 *     à sable, vers un destinataire non fictif, atteint le fournisseur piège
 *     (témoin positif). Sans ce témoin, « zéro appel » ne prouverait rien.
 *  2. Le bureau de test n'atteint JAMAIS un fournisseur : par les trois
 *     canaux, en appel direct puis par le vrai moteur sur un vrai événement,
 *     chaque envoi finit dans `envois_simules` et aucun piège ne bouge.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  demarrerMoteur, appelsTwilio, clientTwilioPiege, appelsHttpBloques, envoisSimules, attendre, marque,
} from '../harnais/moteur';

let b: Awaited<ReturnType<typeof demarrerMoteur>>;
const nettoyer: Array<() => PromiseLike<unknown>> = [];

beforeAll(async () => { b = await demarrerMoteur(); });
afterAll(async () => { for (const f of nettoyer.reverse()) await f(); });

describe('canari — les pièges détectent un envoi réel (témoin positif)', () => {
  it('la redirection QA est désarmée, même après le chargement de config.ts', async () => {
    await import('../../../server/lib/config');
    const { qaRedirectActif } = await import('../../../server/lib/qa-redirect');
    expect(qaRedirectActif()).toBe(false);
  });

  it('un texto hors bac à sable atteint le client Twilio piège', async () => {
    const { envelopperBacASable } = await import('../../../server/lib/bac-a-sable');
    const avant = appelsTwilio.length;
    await expect(envelopperBacASable(clientTwilioPiege)!.messages.create({ to: '+15145551234', body: 'témoin' }))
      .rejects.toThrow(/PIÈGE/);
    expect(appelsTwilio.length).toBe(avant + 1);
    appelsTwilio.length = avant;
  });

  it('un courriel hors bac à sable part vers le vrai fournisseur… qui est un port fermé', async () => {
    const { sendEmail } = await import('../../../server/lib/mailer');
    const r = await sendEmail({ to: 'temoin-qa@lumecrm-temoin.com', subject: 'Témoin', html: '<p>témoin</p>' });
    expect(r.sent).toBe(false);
    expect(String(r.error)).toMatch(/ECONNREFUSED|connect/i);
  });

  it('un webhook hors bac à sable atteint le fetch piège', async () => {
    const { posterSansSsrf } = await import('../../../server/lib/url-sortante');
    const avant = appelsHttpBloques().length;
    // Résolveur fixe (IP publique de documentation) : le témoin ne dépend pas du DNS du poste.
    const resoudre = async () => [{ address: '93.184.215.14' }];
    await expect(posterSansSsrf('https://example.com/temoin', { t: 1 }, { orgId: randomUUID(), resoudre })).rejects.toThrow(/PIÈGE/);
    expect(appelsHttpBloques().length).toBe(avant + 1);
  });
});

describe('canari — le bureau de test n’envoie rien de réel', () => {
  it('appels directs : texto, courriel, webhook du bureau A → envois_simules, aucun piège', async () => {
    const m = marque('canari-direct');
    const depuis = new Date().toISOString();
    const { envelopperBacASable, contexteEnvoi } = await import('../../../server/lib/bac-a-sable');
    const { sendEmail } = await import('../../../server/lib/mailer');
    const { posterSansSsrf } = await import('../../../server/lib/url-sortante');
    const twilioAvant = appelsTwilio.length;
    const httpAvant = appelsHttpBloques().length;

    const sms = (await contexteEnvoi.run({ orgId: b.orgA }, () =>
      envelopperBacASable(clientTwilioPiege)!.messages.create({ to: '+15145551234', body: `canari direct ${m}` }))) as unknown as { sid: string };
    expect(sms.sid).toMatch(/^SM_SIMULE_/);
    const courriel = await sendEmail({ to: 'canari-qa@lumecrm-canari.com', subject: `Canari direct ${m}`, html: '<p>canari</p>', suivi: { orgId: b.orgA, entityType: 'client', entityId: randomUUID() } });
    expect(courriel.sent).toBe(true);
    const hook = await posterSansSsrf('https://example.com/canari', { canari: m }, { orgId: b.orgA, resoudre: async () => [{ address: '93.184.215.14' }] });
    expect(hook.status).toBe(200);

    // Par la MARQUE, pas seulement par l'heure : rien d'un autre test ne s'y mêle.
    const rows = (await envoisSimules(b.admin, b.orgA, depuis))
      .filter((r) => `${r.sujet ?? ''} ${r.corps ?? ''}`.includes(m));
    expect(rows.map((r) => r.canal).sort()).toEqual(['courriel', 'sms', 'webhook']);
    expect(rows.every((r) => (r.meta as { raison?: string }).raison === 'entreprise')).toBe(true);
    expect(appelsTwilio.length).toBe(twilioAvant);
    expect(appelsHttpBloques().length).toBe(httpAvant);
  });

  it('par le vrai moteur : une règle texto + courriel + webhook sur un vrai lead.created', async () => {
    const m = marque('canari');
    const depuis = new Date().toISOString();
    const twilioAvant = appelsTwilio.length;
    const httpAvant = appelsHttpBloques().length;

    const { data: client, error: eClient } = await b.admin.from('clients').insert({
      org_id: b.orgA, created_by: b.users.proprioA, first_name: 'Canari', last_name: m, status: 'lead',
      phone: '+15145551234', email: 'canari-qa@lumecrm-canari.com',
      sms_consent_at: new Date().toISOString(), email_consent_at: new Date().toISOString(),
    }).select('id').single();
    expect(eClient).toBeNull();
    nettoyer.push(() => b.admin.from('clients').delete().eq('id', client!.id));

    const { data: regle, error: eRegle } = await b.admin.from('automation_rules').insert({
      org_id: b.orgA, name: m, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
      is_active: true, is_preset: false,
      actions: [
        { type: 'send_sms', config: { body: `Bonjour {client_first_name} ${m}`, type_envoi: 'transactionnel' } },
        { type: 'send_email', config: { subject: `Canari ${m}`, body: '<p>Bonjour {client_first_name}</p>', type_envoi: 'transactionnel' } },
        { type: 'webhook', config: { url: 'https://93.184.215.14/canari-moteur' } },
      ],
    }).select('id').single();
    expect(eRegle).toBeNull();
    nettoyer.push(() => b.admin.from('automation_rules').delete().eq('id', regle!.id));

    await b.eventBus.emit('lead.created', { orgId: b.orgA, entityType: 'client', entityId: client!.id, metadata: {} });

    const rows = await attendre(
      async () => (await envoisSimules(b.admin, b.orgA, depuis)).filter((r) =>
        String(r.corps ?? '').includes(m) || String(r.sujet ?? '').includes(m) || r.destinataire.includes('canari-moteur')),
      (r) => r.length >= 3,
      // Une base lente n'est pas un envoi réel : sur un staging saturé, un envoi
      // SIMULÉ a mis plus de 5 s (CI du 2026-10-01). Le canari attend ; ce qui
      // le rend rouge, ce sont les pièges, vérifiés juste après.
      75_000, 500,
    );
    const { data: journal } = await b.admin.from('automation_execution_logs').select('*').eq('automation_rule_id', regle!.id).limit(5);
    expect(rows.map((r) => r.canal).sort(), `journal : ${JSON.stringify(journal)}`).toEqual(['courriel', 'sms', 'webhook']);
    expect(rows.every((r) => (r.meta as { raison?: string }).raison === 'entreprise')).toBe(true);
    expect(appelsTwilio.length, 'un texto a atteint le fournisseur').toBe(twilioAvant);
    expect(appelsHttpBloques().length, 'un appel HTTP a atteint le réseau').toBe(httpAvant);
  }, 150_000);
});
