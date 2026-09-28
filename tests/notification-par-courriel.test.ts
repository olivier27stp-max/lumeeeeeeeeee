// « Aussi par courriel » de l'action Notifier l'équipe (2026-09-28).
//
// Le courriel part aux MÊMES personnes que la cloche, à leur adresse de
// connexion, seulement quand la case est cochée. Le préréglage « Devis ouvert
// par le client » l'a cochée par défaut.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Le lien du bouton est absolu : il faut l'adresse publique (posée en prod, absente en CI).
process.env.PUBLIC_URL = 'https://lumecrm.net';

const envois: Array<{ to: string; subject: string; html: string }> = [];
vi.mock('../server/lib/mailer', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; html: string }) => { envois.push(p); return { sent: true }; }),
}));
vi.mock('../server/lib/notificationHelpers', () => ({ insertTargetedNotifications: vi.fn(async () => undefined) }));
const adresses: Record<string, string> = { u1: 'rep@exemple.test', u2: 'proprio@exemple.test' };
vi.mock('../server/lib/supabase', () => ({
  getServiceClient: () => ({
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: adresses[id] } }, error: null }) } },
  }),
}));

import { courrielNotification, lienAbsolu } from '../server/lib/notificationCourriel';
import { executeCreateNotification, type ActionContext } from '../server/lib/actions';
import { AUTOMATION_PRESETS } from '../server/lib/automationPresets.data';
import { ACTIONS } from '../src/lib/automationCatalogue';

function ctx(): ActionContext {
  const membres = [
    { user_id: 'u1', role: 'sales_rep', status: 'active', language: 'fr' },
    { user_id: 'u2', role: 'owner', status: 'active', language: 'en' },
  ];
  const chaine: any = {
    select: () => chaine, eq: () => chaine, maybeSingle: async () => ({ data: null }),
    insert: async () => ({ error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: membres, error: null }).then(r),
  };
  return { supabase: { from: () => chaine } as any, orgId: 'o', entityType: 'quote', entityId: 'q', twilio: null, baseUrl: '' } as ActionContext;
}

beforeEach(() => { envois.length = 0; });

describe('Notifier l’équipe — aussi par courriel', () => {
  it('case cochée : un courriel par personne prévenue, dans sa langue', async () => {
    const r = await executeCreateNotification(
      { title: 'Jean a ouvert la soumission #12', body: 'Ouverte à 10 h', par_courriel: 'true', lien: '/quotes/q' },
      {}, ctx(),
    );
    expect(r.success).toBe(true);
    expect(envois.map((e) => e.to).sort()).toEqual(['proprio@exemple.test', 'rep@exemple.test']);
    expect(envois[0].subject).toBe('Jean a ouvert la soumission #12');
    const fr = envois.find((e) => e.to === 'rep@exemple.test')!;
    const en = envois.find((e) => e.to === 'proprio@exemple.test')!;
    expect(fr.html).toContain('Ouvrir dans Lume');
    expect(en.html).toContain('Open in Lume');
  });

  it('case décochée ou absente : aucun courriel', async () => {
    await executeCreateNotification({ title: 't', body: 'b' }, {}, ctx());
    await executeCreateNotification({ title: 't', body: 'b', par_courriel: 'false' }, {}, ctx());
    expect(envois).toHaveLength(0);
  });

  it('le lien interne devient absolu ; un lien non http est ignoré', () => {
    expect(lienAbsolu('/quotes/q', 'https://lumecrm.net/')).toBe('https://lumecrm.net/quotes/q');
    expect(lienAbsolu('https://lumecrm.net/x', 'https://a.b')).toBe('https://lumecrm.net/x');
    expect(lienAbsolu('javascript:alert(1)', 'https://lumecrm.net')).toBeNull();
    expect(lienAbsolu(null)).toBeNull();
    const cles = ['PUBLIC_URL', 'PUBLIC_BASE_URL', 'FRONTEND_URL', 'APP_URL'] as const;
    const avant = cles.map((k) => process.env[k]);
    for (const k of cles) delete process.env[k];
    expect(lienAbsolu('/quotes/q')).toBeNull(); // pas d'adresse publique : pas de bouton, pas d'échec
    cles.forEach((k, i) => { if (avant[i] !== undefined) process.env[k] = avant[i]; });
    const { html } = courrielNotification({ title: 'T', body: '<b>x</b>', lien: null }, 'fr', 'https://lumecrm.net');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('Ouvrir dans Lume');
  });

  it('le préréglage « Devis ouvert par le client » envoie aussi le courriel par défaut', () => {
    const p = AUTOMATION_PRESETS.find((x) => x.preset_key === 'quote_opened_notify')!;
    expect(p.actions[0].type).toBe('create_notification');
    expect(p.actions[0].config.par_courriel).toBe('true');
    expect(p.actions[0].config.destinataire).toBe('equipe_du_deal');
  });

  it('la case existe dans le constructeur (bascule)', () => {
    const a = ACTIONS.find((x) => x.cle === 'create_notification')!;
    expect(a.champs.find((c) => c.cle === 'par_courriel')?.type).toBe('bascule');
  });
});
