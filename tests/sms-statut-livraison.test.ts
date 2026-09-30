/**
 * Vague 3 (audit V2, C13) — accusés de réception Twilio.
 *
 * Reproduit la preuve de l'audit (`twilio-statut.mjs`) : `delivered` puis un
 * `sent` en retard REPASSAIT le message à « envoyé ». Ici la base est simulée
 * avec son état : la mise à jour conditionnelle n'agit que si le statut
 * courant est plus ancien.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appliquerStatutTwilio, statutInterne, statutsRemplacables, texteErreur } from '../server/lib/sms/statut-livraison';
import { clientEnregistreur, requetes, type Requete } from './automation/filet-regression/_enregistreur';

/** Une ligne `messages` avec un statut courant, et le filtre `.or(status…)` appliqué pour de vrai. */
function base(statutInitial: string | null, extra: { recentes?: unknown[] } = {}) {
  const ligne = { id: 'm1', org_id: 'org-a', phone_number: '+15145550101', direction: 'outbound', status: statutInitial as string | null, error_message: null as string | null };
  const autorise = (req: Requete) => {
    const or = req.filtres.find(([m]) => m === 'or')?.[1] as string | undefined;
    if (!or) return true;
    const liste = /status\.in\.\(([^)]*)\)/.exec(or)?.[1].split(',') ?? [];
    return (ligne.status === null && or.includes('status.is.null')) || (ligne.status !== null && liste.includes(ligne.status));
  };
  const r = clientEnregistreur({
    messages: (req) => {
      if (req.op !== 'update') return { data: [] };
      if (!autorise(req)) return { data: [] };
      Object.assign(ligne, req.valeur as object);
      return { data: [ligne] };
    },
    notifications: { data: extra.recentes ?? [] },
    memberships: { data: [{ user_id: 'u-fr', role: 'owner', status: 'active', language: 'fr' }, { user_id: 'u-en', role: 'admin', status: 'active', language: 'en' }] },
  });
  return { ...r, ligne };
}

describe('C13 — le statut d’un texto ne recule jamais', () => {
  it('LA PREUVE DE L’AUDIT : delivered puis un sent en retard → reste delivered', async () => {
    const { client, ligne } = base('sent');
    await appliquerStatutTwilio(client, { sid: 'SM1', statutTwilio: 'delivered' });
    expect(ligne.status).toBe('delivered');
    const r = await appliquerStatutTwilio(client, { sid: 'SM1', statutTwilio: 'sent' });
    expect(r).toMatchObject({ ok: true, maj: 0, ignore: 'deja_plus_avance' });
    expect(ligne.status).toBe('delivered');
  });

  it('queued → sent → delivered avance normalement', async () => {
    const { client, ligne } = base('queued');
    await appliquerStatutTwilio(client, { sid: 'SM1', statutTwilio: 'sent' });
    expect(ligne.status).toBe('sent');
    await appliquerStatutTwilio(client, { sid: 'SM1', statutTwilio: 'delivered' });
    expect(ligne.status).toBe('delivered');
  });

  it('un failed n’est pas écrasé par un delivered tardif, ni l’inverse', async () => {
    const a = base('failed');
    await appliquerStatutTwilio(a.client, { sid: 'SM1', statutTwilio: 'delivered' });
    expect(a.ligne.status).toBe('failed');
    const b = base('delivered');
    await appliquerStatutTwilio(b.client, { sid: 'SM1', statutTwilio: 'undelivered', codeErreur: '30007' });
    expect(b.ligne.status).toBe('delivered');
  });

  it('les statuts intermédiaires de Twilio ne cassent plus la contrainte CHECK', () => {
    expect(statutInterne('sending')).toBe('queued');
    expect(statutInterne('accepted')).toBe('queued');
    expect(statutInterne('read')).toBe('delivered');
    expect(statutInterne('canceled')).toBe('failed');
    expect(statutInterne('inventé')).toBeNull();
    expect(statutsRemplacables('queued')).toEqual([]);
    expect(statutsRemplacables('failed').sort()).toEqual(['queued', 'sent']);
  });
});

describe('C13 — le code d’erreur est gardé et l’échec est signalé', () => {
  it('undelivered 30007 → failed, error_message « Twilio 30007 — … », notification FR/EN aux gestionnaires', async () => {
    const { client, journal, ligne } = base('sent');
    const r = await appliquerStatutTwilio(client, { sid: 'SM1', statutTwilio: 'undelivered', codeErreur: '30007' });
    expect(r).toMatchObject({ ok: true, maj: 1, statut: 'failed' });
    expect(ligne.status).toBe('failed');
    expect(ligne.error_message).toMatch(/^Twilio 30007 — filtré par l’opérateur/);
    const notifs = requetes(journal, 'notifications', 'insert').flatMap((q) => q.valeur as Array<Record<string, string>>);
    expect(notifs.map((n) => n.user_id).sort()).toEqual(['u-en', 'u-fr']);
    expect(notifs.find((n) => n.user_id === 'u-fr')).toMatchObject({ type: 'sms_failed', title: 'Texto non livré au +15145550101' });
    expect(notifs.find((n) => n.user_id === 'u-en')?.title).toBe('Text not delivered to +15145550101');
  });

  it('une notification par heure au plus : 200 échecs ne font pas 200 notifications', async () => {
    const { client, journal } = base('sent', { recentes: [{ id: 'n-deja' }] });
    await appliquerStatutTwilio(client, { sid: 'SM1', statutTwilio: 'failed', codeErreur: '30006' });
    expect(requetes(journal, 'notifications', 'insert')).toHaveLength(0);
  });

  it('delivered : aucune notification', async () => {
    const { client, journal } = base('sent');
    await appliquerStatutTwilio(client, { sid: 'SM1', statutTwilio: 'delivered' });
    expect(requetes(journal, 'notifications')).toHaveLength(0);
  });

  it('échec d’écriture → ok:false (la route répond 500, Twilio rejoue)', async () => {
    const { client } = clientEnregistreur({ messages: { data: null, error: { message: 'boom' } } });
    expect((await appliquerStatutTwilio(client, { sid: 'SM1', statutTwilio: 'delivered' })).ok).toBe(false);
  });

  it('texteErreur : code inconnu → le message de Twilio', () => {
    expect(texteErreur('30999', 'Something odd')).toBe('Twilio 30999 — Something odd');
    expect(texteErreur(null)).toBe('Twilio — échec de livraison / delivery failed');
  });

  it('la route passe par ce module et garde le 500 sur échec d’écriture', () => {
    const route = readFileSync(resolve(__dirname, '../server/routes/messages.ts'), 'utf8');
    expect(route).toContain('appliquerStatutTwilio(getServiceClient()');
    expect(route).toContain('ErrorCode');
    expect(route).toContain("return res.status(500).json({ error: 'Failed to persist status update' })");
  });
});
