/**
 * 04-courriel:793 [MSG-018] — « M'envoyer un essai » : quand le serveur dit
 * POURQUOI l'essai n'est pas parti, la fonction du navigateur
 * (`envoyerEssaiCourriel`, src/lib/emailTemplatesApi.ts) remonte cette raison
 * au lieu de la jeter. La vraie fonction, `fetch` remplacé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));

import { envoyerEssaiCourriel, EssaiRefuse } from '../../../src/lib/emailTemplatesApi';

const reponse = (status: number, corps: unknown, type = 'application/json') => new Response(
  typeof corps === 'string' ? corps : JSON.stringify(corps), { status, headers: { 'Content-Type': type } },
);
let journal: ReturnType<typeof vi.spyOn>;
beforeEach(() => { journal = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); journal.mockRestore(); });

describe('04-courriel:793 — la raison d’un essai refusé remonte jusqu’à l’écran', () => {
  it('succès : l’adresse touchée', async () => {
    vi.stubGlobal('fetch', async () => reponse(200, { html: '<p>x</p>', envoye: 'proprio@lume-qa.test' }));
    expect(await envoyerEssaiCourriel('<p>x</p>', 'Objet')).toBe('proprio@lume-qa.test');
  });

  it('refus avec une raison : `EssaiRefuse` porte la phrase du serveur, et l’échec est journalisé une fois', async () => {
    vi.stubGlobal('fetch', async () => reponse(502, { error: 'Aucun service de courriel n’est configuré pour votre entreprise.' }));
    const essai = envoyerEssaiCourriel('<p>x</p>', 'Objet');
    await expect(essai).rejects.toBeInstanceOf(EssaiRefuse);
    await expect(essai).rejects.toThrow('Aucun service de courriel n’est configuré pour votre entreprise.');
    expect(journal).toHaveBeenCalledTimes(1);
  });

  it('refus sans raison lisible (corps non JSON) ou réseau coupé : `null`, comme avant — l’écran dit « Envoi impossible »', async () => {
    vi.stubGlobal('fetch', async () => reponse(502, '<html>Bad gateway</html>', 'text/html'));
    expect(await envoyerEssaiCourriel('<p>x</p>', 'Objet')).toBeNull();
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    expect(await envoyerEssaiCourriel('<p>x</p>', 'Objet')).toBeNull();
  });
});
