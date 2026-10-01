/**
 * LUMI — une réponse coupée en route se VOIT (mission fiabilité, 2026-10-01).
 *
 * Constat en prod : un redéploiement pendant un tour ferme le flux sans « done »
 * ni « error ». Le lecteur du client s'arrêtait en silence : bulle à moitié
 * écrite, aucun message, l'utilisateur ne sait pas si son action est partie.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }));
vi.mock('../src/lib/deviceToken', () => ({ deviceTokenHeader: () => ({}) }));

function reponseEnFlux(morceaux: string[]): Response {
  return new Response(new ReadableStream({
    start(ctl) { for (const m of morceaux) ctl.enqueue(new TextEncoder().encode(m)); ctl.close(); },
  }), { status: 200 });
}
afterEach(() => vi.unstubAllGlobals());

describe('flux SSE de Lumi', () => {
  it('fermé sans « done » ni « error » : ErreurLumi « interrompu », et le texte déjà reçu est livré', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reponseEnFlux(['event: text\ndata: {"delta":"Je prépare la fact"}\n\n'])));
    const { envoyerMessageLumi, ErreurLumi } = await import('../src/lib/lumiApi');
    const recus: any[] = [];
    const essai = envoyerMessageLumi({ conversation_id: null, message: 'x', language: 'fr' }, (e) => recus.push(e));
    await expect(essai).rejects.toBeInstanceOf(ErreurLumi);
    await expect(essai).rejects.toMatchObject({ code: 'interrompu' });
    expect(recus.map((e) => e.type)).toEqual(['text']);
  });

  it('terminé par « done » : aucune erreur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reponseEnFlux(['event: text\ndata: {"delta":"Fait."}\n\nevent: done\ndata: {"conversation_id":"c1","proposal":null}\n\n'])));
    const { envoyerMessageLumi } = await import('../src/lib/lumiApi');
    await expect(envoyerMessageLumi({ conversation_id: null, message: 'x', language: 'fr' }, () => {})).resolves.toBeUndefined();
  });

  it('terminé par « error » (échec dit par le serveur) : pas de second message « interrompu »', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reponseEnFlux(['event: error\ndata: {"message":"Lumi failed to respond."}\n\n'])));
    const { envoyerMessageLumi } = await import('../src/lib/lumiApi');
    await expect(envoyerMessageLumi({ conversation_id: null, message: 'x', language: 'fr' }, () => {})).resolves.toBeUndefined();
  });

  it('annulé par l’utilisateur (changement de page) : silencieux', async () => {
    const ctrl = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => reponseEnFlux(['event: text\ndata: {"delta":"a"}\n\n'])));
    const { envoyerMessageLumi } = await import('../src/lib/lumiApi');
    ctrl.abort();
    await expect(envoyerMessageLumi({ conversation_id: null, message: 'x', language: 'fr' }, () => {}, ctrl.signal)).resolves.toBeUndefined();
  });

  it('l’écran dit quoi faire, en français et en anglais', () => {
    const page = readFileSync(resolve(__dirname, '../src/pages/Lumi.tsx'), 'utf8');
    expect(page).toContain("erreur.code === 'interrompu'");
    expect(page).toContain('a été interrompue avant la fin');
    expect(page).toContain('was cut off before the end');
  });
});
