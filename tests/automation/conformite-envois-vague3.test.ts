/**
 * Vague 3 (audit V2) — conformité des envois d'automatisation.
 *
 *  L7 : un texto COMMERCIAL porte l'identification de l'entreprise et
 *       « Répondez STOP pour ne plus recevoir » (FR/EN), ajoutés
 *       automatiquement ; un transactionnel n'est pas touché ; la mention
 *       ne fait pas basculer l'encodage (segments).
 *  L8 : un courriel COMMERCIAL sans nom ou sans adresse postale de
 *       l'entreprise est sauté avec un motif lisible ; le transactionnel part.
 *
 * Aucun envoi réel : Twilio et le courriel sont des doublures.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mailer = vi.hoisted(() => ({ sendEmail: vi.fn(async (_p?: unknown) => ({ sent: true, messageId: 'x' })) }));
const societe = vi.hoisted(() => ({ courante: {} as Record<string, unknown> }));
vi.mock('../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  adresseInjoignable: async () => false,
  sendEmail: (p: any) => mailer.sendEmail(p),
}));
vi.mock('../../server/lib/notificationHelpers', async (orig) => ({
  ...(await orig<any>()),
  isEmailUnsubscribed: async () => false,
  getUnsubscribeUrl: async () => 'https://app.lume.test/desabonnement/x',
}));
vi.mock('../../server/routes/emails', () => ({
  getCompanySettings: async () => societe.courante,
  buildEmailLayout: (_c: unknown, b: string) => b,
  senderFor: () => ({ from: 'test@lume.test' }),
  senderForOrg: async () => ({ from: 'Test <test@lume.test>' }),
  langueEntreprise: () => 'fr',
}));
vi.mock('../../server/lib/courriels/bouton-automatisation', () => ({ boutonPourEntite: async () => null }));
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
vi.mock('../../server/lib/migration/gel-communications', () => ({ destinataireGele: async () => null, journaliserBlocage: () => {}, MESSAGE_GEL: 'gel' }));

import { executeSendEmail, executeSendSms, identiteManquante } from '../../server/lib/actions';
import { avecMentionCommerciale, phraseStop, segmentsSms } from '../../server/lib/desabonnement/mention-sms';
import { clientEnregistreur } from './filet-regression/_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';
const TEL = '+15145550101';
const FICHE = { id: 'client-a', phone: TEL, email: 'alice@a.test', email_consent_at: '2026-09-01T00:00:00Z', sms_consent_at: '2026-09-01T00:00:00Z', email_opt_out_at: null };

let twilio: { messages: { create: ReturnType<typeof vi.fn> } };
beforeEach(() => {
  vi.clearAllMocks();
  societe.courante = {};
  twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM1' })) } };
});

function ctxDe(p: { commercial: boolean; langue?: 'fr' | 'en'; nom?: string | null; nomBureau?: string | null }) {
  const { client, journal } = clientEnregistreur({
    company_settings: { data: p.nom === null ? [] : [{ company_name: p.nom ?? 'Lavage Coquin' }] },
    orgs: { data: [{ name: p.nomBureau ?? 'Bureau A' }] },
    clients: { data: [FICHE] },
    sms_opt_outs: { data: null },
    messages: { data: [], count: 0 },
    conversations: { data: [{ id: 'conv-1', client_id: 'client-a' }] },
    consents: { data: null },
  });
  return {
    journal,
    ctx: {
      supabase: client, orgId: ORG, entityType: 'client', entityId: 'client-a',
      twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test',
      commercial: p.commercial, langue: p.langue ?? 'fr',
    } as any,
  };
}
const corpsEnvoye = () => (twilio.messages.create.mock.calls[0]?.[0] as { body: string } | undefined)?.body;

describe('L7 — mention STOP et identification des textos commerciaux', () => {
  it('commercial FR : nom de l\'entreprise + « Répondez STOP pour ne plus recevoir. »', async () => {
    const { ctx } = ctxDe({ commercial: true });
    const r = await executeSendSms({ body: 'Profitez de 10 % sur le lavage de vitres ce mois-ci !' }, { client_phone: TEL }, ctx);
    expect(r.success).toBe(true);
    expect(corpsEnvoye()).toBe('Profitez de 10 % sur le lavage de vitres ce mois-ci !\nLavage Coquin - Répondez STOP pour ne plus recevoir.');
  });

  it('commercial EN : « Reply STOP to opt out. »', async () => {
    const { ctx } = ctxDe({ commercial: true, langue: 'en', nom: 'Coquin Wash' });
    await executeSendSms({ body: 'Spring special: 10% off!' }, { client_phone: TEL }, ctx);
    expect(corpsEnvoye()).toBe('Spring special: 10% off!\nCoquin Wash - Reply STOP to opt out.');
  });

  it('transactionnel : le texte part tel quel', async () => {
    const { ctx, journal } = ctxDe({ commercial: false });
    await executeSendSms({ body: 'Rappel : votre rendez-vous est demain à 9 h.' }, { client_phone: TEL }, ctx);
    expect(corpsEnvoye()).toBe('Rappel : votre rendez-vous est demain à 9 h.');
    // Et on ne lit même pas le nom de l'entreprise.
    expect(journal.some((q) => q.table === 'company_settings')).toBe(false);
  });

  it('sollicitation immédiate (demande d\'avis) : mention ajoutée même si le moteur ne la dit pas commerciale', async () => {
    const { ctx } = ctxDe({ commercial: false });
    await executeSendSms({ body: 'Votre avis compte : https://g.page/x', sollicitation: true }, { client_phone: TEL }, ctx);
    expect(corpsEnvoye()).toContain('Répondez STOP pour ne plus recevoir.');
  });

  it('sans nom dans les réglages : le nom du bureau identifie l\'expéditeur', async () => {
    const { ctx } = ctxDe({ commercial: true, nom: null, nomBureau: 'Vision Lavage' });
    await executeSendSms({ body: 'Promo !' }, { client_phone: TEL }, ctx);
    expect(corpsEnvoye()).toBe('Promo !\nVision Lavage - Répondez STOP pour ne plus recevoir.');
  });

  it('le message enregistré dans la conversation est celui qui est parti', async () => {
    const { ctx, journal } = ctxDe({ commercial: true });
    await executeSendSms({ body: 'Promo !' }, { client_phone: TEL }, ctx);
    const ins = journal.find((q) => q.table === 'messages' && q.op === 'insert');
    expect((ins?.valeur as { message_text: string }).message_text).toBe(corpsEnvoye());
  });
});

describe('L7 — la mention elle-même', () => {
  it('ne répète pas ce qui y est déjà', () => {
    expect(avecMentionCommerciale('Lavage Coquin : promo. Répondez STOP pour arrêter.', 'Lavage Coquin', 'fr'))
      .toBe('Lavage Coquin : promo. Répondez STOP pour arrêter.');
    expect(avecMentionCommerciale('Promo ! Répondez STOP pour arrêter.', 'Lavage Coquin', 'fr'))
      .toBe('Promo ! Répondez STOP pour arrêter.\nLavage Coquin');
    expect(avecMentionCommerciale('Lavage Coquin : promo.', 'Lavage Coquin', 'fr'))
      .toBe(`Lavage Coquin : promo.\n${phraseStop('fr')}`);
  });

  it('« stop by our store » n\'est pas une consigne de retrait', () => {
    expect(avecMentionCommerciale('Stop by our store', 'Coquin', 'en')).toBe('Stop by our store\nCoquin - Reply STOP to opt out.');
  });

  it('un nom très long est coupé à 40 caractères', () => {
    const r = avecMentionCommerciale('Promo', 'X'.repeat(80), 'fr');
    expect(r).toBe(`Promo\n${'X'.repeat(40)} - ${phraseStop('fr')}`);
  });

  it('la mention reste en GSM-7 : elle ne fait jamais basculer un texto en UCS-2', () => {
    for (const langue of ['fr', 'en'] as const) {
      const corps = 'Bonjour Alice, profitez de notre promo de printemps sur le lavage de vitres.';
      expect(segmentsSms(corps).encodage).toBe('GSM-7');
      const avec = avecMentionCommerciale(corps, 'Lavage Coquin', langue);
      expect(segmentsSms(avec).encodage).toBe('GSM-7');
      // Un texto court reste sur un seul segment.
      expect(segmentsSms(avec).segments).toBe(1);
    }
  });

  it('segments : 160 / 153 en GSM-7, 70 / 67 en UCS-2', () => {
    expect(segmentsSms('a'.repeat(160)).segments).toBe(1);
    expect(segmentsSms('a'.repeat(161)).segments).toBe(2);
    expect(segmentsSms('ê'.repeat(70))).toEqual({ encodage: 'UCS-2', unites: 70, segments: 1 });
    expect(segmentsSms('ê'.repeat(71)).segments).toBe(2);
    expect(segmentsSms('€').unites).toBe(2);
  });
});

describe('L8 — courriel commercial sans identification de l’entreprise', () => {
  const COMPLETE = { company_name: 'Lavage Coquin', company_address: '120 rue Principale, Granby, QC, J2G 2V1' };
  const envoyer = (commercial: boolean) => {
    const { ctx } = ctxDe({ commercial });
    return executeSendEmail({ subject: 'Promo de printemps', body: '<p>10 % sur les vitres</p>' }, { client_email: 'alice@a.test' }, ctx);
  };

  it('sans nom ni adresse : sauté, motif lisible, rien n’est envoyé', async () => {
    societe.courante = {};
    const r = await envoyer(true);
    expect(r).toEqual({ success: true, data: { saute: expect.stringContaining('le nom et l’adresse postale de l’entreprise manquent'), saute_code: 'identite_manquante' } });
    expect(mailer.sendEmail).not.toHaveBeenCalled();
  });

  it('avec le nom mais sans adresse : sauté aussi (la loi exige les deux)', async () => {
    societe.courante = { company_name: 'Lavage Coquin' };
    const r = await envoyer(true);
    expect((r.data as { saute: string }).saute).toContain('l’adresse postale de l’entreprise manque');
    expect(mailer.sendEmail).not.toHaveBeenCalled();
  });

  it('identité complète : le courriel commercial part', async () => {
    societe.courante = COMPLETE;
    const r = await envoyer(true);
    expect(r.success).toBe(true);
    expect((r.data as { saute?: string }).saute).toBeUndefined();
    expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('transactionnel sans identité : part comme avant', async () => {
    societe.courante = {};
    const r = await envoyer(false);
    expect((r.data as { saute?: string }).saute).toBeUndefined();
    expect(mailer.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('le type marketing calculé par le moteur prime sur « différé »', async () => {
    societe.courante = {};
    const { ctx } = ctxDe({ commercial: false });
    ctx.marketing = true;
    const r = await executeSendEmail({ subject: 'Promo', body: 'x' }, { client_email: 'alice@a.test' }, ctx);
    expect((r.data as { saute_code?: string }).saute_code).toBe('identite_manquante');
  });

  it('identiteManquante : motif selon ce qui manque', () => {
    expect(identiteManquante(COMPLETE)).toBeNull();
    expect(identiteManquante({ company_name: '  ', company_address: 'x' })).toContain('le nom de l’entreprise manque');
  });
});
