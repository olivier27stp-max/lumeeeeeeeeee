/**
 * Launch 2026-09-28 — bloc 4 : l'action « webhook » ne peut pas viser le
 * réseau interne (SSRF). L'ancienne garde ne lisait que le TEXTE de
 * l'adresse : un nom pointant vers 127.0.0.1, `[::1]`, `0.0.0.0`, 100.64/10
 * ou une redirection vers 169.254.169.254 passaient.
 */
import { describe, it, expect, vi } from 'vitest';
import { ipNonPublique, adresseAcceptable, resolutionPublique, posterSansSsrf } from '../../server/lib/url-sortante';

describe('IP non publiques', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0',
    '100.64.0.1', '100.127.255.255', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'ff02::1',
  ])('%s est refusée', (ip) => expect(ipNonPublique(ip)).toBe(true));
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.63.0.1', '2606:4700:4700::1111'])('%s est acceptée', (ip) => expect(ipNonPublique(ip)).toBe(false));
});

describe('texte de l’adresse', () => {
  it.each([
    ['http://exemple.com/x', 'https'],
    ['https://localhost/x', 'interne'],
    ['https://2130706433/x', 'non publique'], // 127.0.0.1 en décimal
    ['https://0x7f.1/x', 'non publique'], // 127.0.0.1 en hexadécimal
    ['https://[::1]/x', 'non publique'],
    ['https://0.0.0.0/x', 'non publique'],
    ['https://user:pass@exemple.com/x', 'identifiants'],
    ['https://metadata.google.internal/x', 'interne'],
  ])('%s refusée (%s)', (url, raison) => {
    const v = adresseAcceptable(url);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.raison).toMatch(new RegExp(raison));
  });
});

describe('résolution DNS', () => {
  const resoudre = (table: Record<string, string[]>) => async (h: string) => (table[h] ?? []).map((address) => ({ address }));
  it('un nom qui pointe vers 127.0.0.1 est refusé', async () => {
    expect(await resolutionPublique('piege.exemple.com', resoudre({ 'piege.exemple.com': ['127.0.0.1'] }))).toBe(false);
  });
  it('une seule adresse privée parmi plusieurs suffit à refuser', async () => {
    expect(await resolutionPublique('mixte.exemple.com', resoudre({ 'mixte.exemple.com': ['93.184.216.34', '10.0.0.5'] }))).toBe(false);
  });
  it('un nom introuvable est refusé', async () => {
    expect(await resolutionPublique('rien.exemple.com', resoudre({}))).toBe(false);
  });
  it('un nom public passe', async () => {
    expect(await resolutionPublique('ok.exemple.com', resoudre({ 'ok.exemple.com': ['93.184.216.34'] }))).toBe(true);
  });
});

describe('redirections', () => {
  const resoudre = async (h: string) => [{ address: h === 'interne.exemple.com' ? '10.0.0.9' : '93.184.216.34' }];
  const reponse = (status: number, location?: string) => new Response(null, { status, headers: location ? { location } : {} });

  it('une redirection vers les métadonnées du nuage (169.254.169.254) est refusée', async () => {
    const fetcher = vi.fn(async () => reponse(302, 'https://169.254.169.254/latest/meta-data/')) as unknown as typeof fetch;
    await expect(posterSansSsrf('https://ok.exemple.com/h', {}, { resoudre, fetcher })).rejects.toThrow(/Adresse refusée/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('une redirection vers un nom qui résout en interne est refusée', async () => {
    const fetcher = vi.fn(async () => reponse(307, 'https://interne.exemple.com/x')) as unknown as typeof fetch;
    await expect(posterSansSsrf('https://ok.exemple.com/h', {}, { resoudre, fetcher })).rejects.toThrow(/publique/);
  });
  it('plus de 3 redirections : refus', async () => {
    const fetcher = vi.fn(async () => reponse(302, 'https://ok.exemple.com/boucle')) as unknown as typeof fetch;
    await expect(posterSansSsrf('https://ok.exemple.com/h', {}, { resoudre, fetcher })).rejects.toThrow(/redirections/);
  });
  it('une adresse publique sans redirection : l’appel part, sans suivre de redirection automatiquement', async () => {
    const fetcher = vi.fn(async () => reponse(200)) as unknown as typeof fetch;
    const r = await posterSansSsrf('https://ok.exemple.com/h', { a: 1 }, { resoudre, fetcher });
    expect(r.status).toBe(200);
    expect((fetcher as any).mock.calls[0][1].redirect).toBe('manual');
  });
});

describe('l’action « webhook » elle-même', () => {
  it.each(['https://[::1]/x', 'https://0.0.0.0/x', 'https://100.64.0.1/x'])('%s : aucun appel ne part', async (url) => {
    const appel = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', appel);
    try {
      const { executeWebhook } = await import('../../server/lib/actions/index');
      const r = await executeWebhook({ url }, {}, { supabase: {} as any, orgId: 'o', entityType: 'client', entityId: 'c', twilio: null, baseUrl: 'x' });
      expect(r.success).toBe(false);
      expect(appel).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Vague 3 (audit V2, C23) — les deux IPv6 qui passaient encore', () => {
  it.each(['::7f00:1', '[::7f00:1]', '::127.0.0.1', '::a00:1', '2002:7f00:1::', '[2002:7f00:1::]', '2002:c0a8:101::1'])('%s est refusée', (ip) => expect(ipNonPublique(ip)).toBe(true));
  it.each(['http://[::7f00:1]/hook', 'http://[2002:7f00:1::]/hook'])('%s est refusée au texte', (url) => expect(adresseAcceptable(url).ok).toBe(false));
  it('une IPv6 publique ordinaire passe toujours', () => {
    expect(ipNonPublique('2606:4700:4700::1111')).toBe(false);
    expect(ipNonPublique('2a00:1450:4009:81f::200e')).toBe(false);
  });
});
