/**
 * E-11 — un numéro de la liste STOP (`sms_opt_outs`) ne reçoit AUCUN texto
 * d'automatisation : commercial ou transactionnel, drapeau « désabonnement
 * par canal » allumé ou non (décision de la mission : « désabonnés / STOP
 * toujours exclus, peu importe les règles »).
 *
 * Avant, sous le drapeau, un texto dit transactionnel (confirmation, rappel)
 * était tenté, en comptant sur le blocage de l'opérateur. Or un retrait fait
 * sur la page de désabonnement écrit `sms_opt_outs` sans que Twilio en sache
 * rien : ce texto-là arrivait.
 *
 * Et deux trous de la même garde : une liste STOP illisible, ou deux lignes
 * pour le même numéro (`maybeSingle` rend alors une erreur), étaient lues
 * comme « pas de STOP » — le texto partait.
 */
import { describe, it, expect } from 'vitest';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { executeSendSms } from '../../../server/lib/actions/index';

const ORG = '11111111-1111-4111-8111-111111111111';
const NUMERO = '+15145550142';

function contexte(options: { stop?: Ligne[]; parCanal?: boolean; commercial?: boolean; erreur?: string } = {}) {
  const partis: string[] = [];
  const sb = fauxSupabase({
    sms_opt_outs: options.stop ?? [],
    clients: [{ id: 'c1', org_id: ORG, phone: NUMERO, sms_consent_at: '2026-01-01', email_consent_at: null, email_opt_out_at: null, deleted_at: null }],
    messages: [],
  }, options.erreur ? { erreurs: { sms_opt_outs: options.erreur } } : {});
  const ctx = {
    supabase: sb.client, orgId: ORG, entityType: 'client', entityId: 'c1', baseUrl: 'http://t',
    parCanal: options.parCanal, commercial: options.commercial,
    // Un envoi réellement tenté passerait par ici : c'est ce qu'on surveille.
    twilio: { client: { messages: { create: async (p: { to: string }) => { partis.push(p.to); return { sid: 'SM1' }; } } }, phoneNumber: '+15145550000' },
  };
  return { ctx: ctx as never, partis, sb };
}
const UN_STOP: Ligne[] = [{ id: 'opt-1', org_id: ORG, phone: NUMERO, reason: 'client_stop' }];
const envoyer = (ctx: never) => executeSendSms({ body: 'Rappel : rendez-vous demain.' }, { client_phone: NUMERO }, ctx);

describe('[E-11] un numéro STOP ne reçoit aucun texto, quel que soit le réglage', () => {
  it.each([
    ['drapeau ÉTEINT, transactionnel', { parCanal: false, commercial: false }],
    ['drapeau ÉTEINT, commercial', { parCanal: false, commercial: true }],
    ['drapeau ALLUMÉ, commercial', { parCanal: true, commercial: true }],
    ['drapeau ALLUMÉ, transactionnel (partait avant)', { parCanal: true, commercial: false }],
  ])('%s : sauté « désabonné », rien n’est tenté', async (_nom, reglage) => {
    const { ctx, partis } = contexte({ stop: UN_STOP, ...reglage });
    const r = await envoyer(ctx);
    expect(r).toEqual({ success: true, data: { saute: 'Client désabonné (texto)', saute_code: 'desabonne' } });
    expect(partis).toEqual([]);
  });

  it('deux lignes STOP pour le même numéro : toujours sauté (avant : une erreur de lecture, lue comme « pas de STOP »)', async () => {
    const { ctx, partis } = contexte({ stop: [...UN_STOP, { id: 'opt-2', org_id: ORG, phone: NUMERO, reason: 'page' }], parCanal: true, commercial: false });
    const r = await envoyer(ctx);
    expect((r.data as { saute_code?: string }).saute_code).toBe('desabonne');
    expect(partis).toEqual([]);
  });

  it('le STOP d’une AUTRE entreprise ou d’un autre numéro ne bloque pas : la garde ne déborde pas', async () => {
    const ailleurs = [{ id: 'x', org_id: '22222222-2222-4222-8222-222222222222', phone: NUMERO }, { id: 'y', org_id: ORG, phone: '+15145550199' }];
    const { ctx } = contexte({ stop: ailleurs, parCanal: true, commercial: false });
    const r = await envoyer(ctx);
    expect((r.data as { saute_code?: string } | undefined)?.saute_code).not.toBe('desabonne');
  });
});

describe('[E-11] liste STOP illisible : on ne sait pas, donc on n’envoie pas', () => {
  it.each([[true], [false]])('drapeau par canal = %s : échec repris plus tard, aucun envoi tenté', async (parCanal) => {
    const { ctx, partis } = contexte({ erreur: 'timeout', parCanal, commercial: false });
    const r = await envoyer(ctx);
    expect(r.success).toBe(false);
    expect(r.error).toBe('Lecture de la liste STOP impossible (erreur technique) — envoi suspendu');
    expect(partis).toEqual([]);
  });

  it('cet échec est PASSAGER pour le moteur : la tâche est reprise, pas abandonnée', async () => {
    const { isTransientFailure } = await import('../../../server/lib/automationEngine');
    expect(isTransientFailure('Lecture de la liste STOP impossible (erreur technique) — envoi suspendu')).toBe(true);
  });
});
