/**
 * La cloche et les tâches d'une automatisation parlent la langue de celui qui
 * les reçoit, quand le texte existe dans cette langue.
 *
 * Audit du 2026-10-01 (suite du constat modeles-10) : les modèles ont
 * maintenant leurs textes anglais (`title_en`, `body_en`), mais le moteur ne
 * les lisait que pour le COURRIEL de notification. La cloche restait en
 * français pour un membre anglophone, et une tâche créée dans un bureau
 * anglophone aussi.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Ligne = Record<string, unknown>;
const cible = vi.hoisted(() => ({ parDestinataire: [] as Array<{ user: string; lang: string; title: string; body: string }> }));
vi.mock('../../server/lib/notificationHelpers', () => ({
  insertTargetedNotifications: vi.fn(async (
    _s: unknown, _o: string, destinataires: Map<string, 'fr' | 'en'>, construire: (l: 'fr' | 'en') => { title: string; body: string },
  ) => {
    for (const [user, lang] of destinataires) cible.parDestinataire.push({ user, lang, ...construire(lang) });
  }),
}));

import { executeCreateNotification, executeCreateTask, type ActionContext } from '../../server/lib/actions';

const insertions: Array<{ table: string; ligne: Ligne }> = [];
function ctx(langue?: 'fr' | 'en'): ActionContext {
  const membres = [
    { user_id: 'u-fr', role: 'owner', status: 'active', language: 'fr' },
    { user_id: 'u-en', role: 'owner', status: 'active', language: 'en' },
  ];
  const from = (table: string) => {
    const chaine: Record<string, unknown> = {
      select: () => chaine, eq: () => chaine, in: () => chaine, limit: () => chaine,
      maybeSingle: async () => ({ data: table === 'memberships' ? { user_id: 'u-fr' } : null, error: null }),
      insert: async (ligne: Ligne) => { insertions.push({ table, ligne }); return { error: null }; },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: membres, error: null }).then(ok),
    };
    return chaine;
  };
  return { supabase: { from } as never, orgId: 'o', entityType: 'client', entityId: 'c1', twilio: null, baseUrl: '', langue } as ActionContext;
}

const NOTIF = {
  title: 'Nouveau prospect : [client_name]', body: 'Un nouveau prospect vient d’arriver.',
  title_en: 'New lead: [client_name]', body_en: 'A new lead just came in.',
};
const VARS = { client_name: 'Marie Tremblay' };

beforeEach(() => { insertions.length = 0; cible.parDestinataire.length = 0; });

describe('Notifier l’équipe — la cloche', () => {
  it('destinataires ciblés : chacun dans SA langue', async () => {
    const r = await executeCreateNotification({ ...NOTIF, destinataire: 'proprietaires' } as never, VARS, ctx('fr'));
    expect(r.success).toBe(true);
    const fr = cible.parDestinataire.find((d) => d.user === 'u-fr');
    const en = cible.parDestinataire.find((d) => d.user === 'u-en');
    expect(fr).toMatchObject({ title: 'Nouveau prospect : Marie Tremblay', body: 'Un nouveau prospect vient d’arriver.' });
    expect(en).toMatchObject({ title: 'New lead: Marie Tremblay', body: 'A new lead just came in.' });
  });

  it('sans texte anglais : le membre anglophone reçoit le français (une seule langue, jamais un mélange)', async () => {
    await executeCreateNotification({ title: 'Paiement reçu', body: 'Facture 40', destinataire: 'proprietaires' } as never, {}, ctx('fr'));
    expect(cible.parDestinataire.find((d) => d.user === 'u-en')).toMatchObject({ title: 'Paiement reçu', body: 'Facture 40' });
  });

  it('titre anglais sans corps anglais : pas de titre anglais sur un corps français', async () => {
    await executeCreateNotification({ title: 'Paiement reçu', body: 'Facture 40', title_en: 'Payment received', destinataire: 'proprietaires' } as never, {}, ctx('fr'));
    expect(cible.parDestinataire.find((d) => d.user === 'u-en')).toMatchObject({ title: 'Payment received', body: '' });
  });

  it('toute l’équipe (une seule ligne) : la langue du BUREAU', async () => {
    await executeCreateNotification(NOTIF as never, VARS, ctx('en'));
    expect(insertions.find((i) => i.table === 'notifications')?.ligne).toMatchObject({ title: 'New lead: Marie Tremblay', body: 'A new lead just came in.' });
    insertions.length = 0;
    await executeCreateNotification(NOTIF as never, VARS, ctx('fr'));
    expect(insertions.find((i) => i.table === 'notifications')?.ligne).toMatchObject({ title: 'Nouveau prospect : Marie Tremblay' });
  });
});

describe('Créer une tâche', () => {
  const TACHE = { title: 'Rappeler [client_name]', body: 'Soumission sans réponse.', title_en: 'Call [client_name] back', body_en: 'Quote with no answer.' };

  it('bureau anglophone : la tâche est créée en anglais', async () => {
    const r = await executeCreateTask(TACHE as never, VARS, ctx('en'));
    expect(r.success).toBe(true);
    expect(insertions.find((i) => i.table === 'tasks')?.ligne).toMatchObject({ title: 'Call Marie Tremblay back', description: 'Quote with no answer.' });
  });

  it('bureau francophone : inchangé', async () => {
    await executeCreateTask(TACHE as never, VARS, ctx('fr'));
    expect(insertions.find((i) => i.table === 'tasks')?.ligne).toMatchObject({ title: 'Rappeler Marie Tremblay', description: 'Soumission sans réponse.' });
  });

  it('bureau anglophone sans texte anglais : le français, plutôt que rien', async () => {
    await executeCreateTask({ title: 'Rappeler [client_name]', description: 'Ancien format.' } as never, VARS, ctx('en'));
    expect(insertions.find((i) => i.table === 'tasks')?.ligne).toMatchObject({ title: 'Rappeler Marie Tremblay', description: 'Ancien format.' });
  });
});
