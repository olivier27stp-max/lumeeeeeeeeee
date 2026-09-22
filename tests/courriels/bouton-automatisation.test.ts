/**
 * Le bouton des courriels d'automatisation (2026-09-22).
 *
 * Les 26 relances partaient sans aucun bouton : toutes demandaient de
 * « répondre à ce courriel ». Une relance de soumission sans bouton
 * « Accepter » oblige le client à écrire un message au lieu de cliquer une
 * fois — et la plupart n'écrivent jamais.
 *
 * Ce que ces tests protègent surtout : les REFUS. Un bouton qui mène nulle
 * part détruit plus de confiance qu'un courriel sans bouton.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { boutonPourEntite, TYPES_AVEC_BOUTON } from '../../server/lib/courriels/bouton-automatisation';

/** Un client Supabase minimal : la chaîne `.from().select().eq().eq().maybeSingle()`. */
function faussDb(reponse: { data?: unknown; error?: { message: string } | null }) {
  const chaine: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chaine[m] = vi.fn(() => chaine);
  chaine.maybeSingle = vi.fn(async () => reponse);
  return { from: vi.fn(() => chaine) } as never;
}

const AVANT = process.env.PUBLIC_URL;

beforeEach(() => { process.env.PUBLIC_URL = 'https://lumecrm.net'; });
afterEach(() => {
  if (AVANT === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = AVANT;
});

describe('bouton d’automatisation', () => {
  it('construit le lien public d’une soumission', async () => {
    const b = await boutonPourEntite(faussDb({ data: { view_token: 'jeton123' } }), 'org1', 'quote', 'q1', 'fr');
    expect(b).toEqual({ texte: 'Voir la soumission', url: 'https://lumecrm.net/quote/jeton123' });
  });

  it('construit le lien public d’une facture, en anglais aussi', async () => {
    const b = await boutonPourEntite(faussDb({ data: { view_token: 'j9' } }), 'org1', 'invoice', 'i1', 'en');
    expect(b?.url).toBe('https://lumecrm.net/invoice/j9');
    expect(b?.texte).toBe('View and pay invoice');
  });

  it('REFUSE une entité sans page publique : un lead n’a rien à ouvrir', async () => {
    const b = await boutonPourEntite(faussDb({ data: { view_token: 'x' } }), 'org1', 'lead', 'l1');
    expect(b).toBeNull();
  });

  it('REFUSE quand le jeton manque : le lien mènerait nulle part', async () => {
    const b = await boutonPourEntite(faussDb({ data: { view_token: null } }), 'org1', 'quote', 'q1');
    expect(b).toBeNull();
  });

  it('REFUSE quand l’entité est introuvable', async () => {
    const b = await boutonPourEntite(faussDb({ data: null }), 'org1', 'quote', 'q1');
    expect(b).toBeNull();
  });

  it('REFUSE sans jamais lever : un courriel doit partir même sans bouton', async () => {
    const b = await boutonPourEntite(faussDb({ data: null, error: { message: 'boom' } }), 'org1', 'quote', 'q1');
    expect(b).toBeNull();
  });

  it('REFUSE quand l’adresse publique n’est pas configurée', async () => {
    delete process.env.PUBLIC_URL;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.FRONTEND_URL;
    delete process.env.APP_URL;
    const b = await boutonPourEntite(faussDb({ data: { view_token: 'x' } }), 'org1', 'quote', 'q1');
    expect(b).toBeNull();
  });

  it('filtre par organisation : jamais l’entité d’une autre', async () => {
    const db = faussDb({ data: { view_token: 'x' } });
    await boutonPourEntite(db, 'org1', 'quote', 'q1');
    const chaine = (db as never as { from: (t: string) => { eq: ReturnType<typeof vi.fn> } }).from('quotes');
    // Deux filtres : l'identifiant ET l'organisation.
    expect(chaine.eq).toHaveBeenCalledWith('org_id', 'org1');
  });

  it('les chemins publics utilisés sont ceux que l’app sert vraiment', async () => {
    // `/q/` traîne dans emails.ts, mais CHEMINS_PUBLICS déclare `/quote/`.
    // Un chemin inventé enverrait le client sur une page blanche.
    for (const type of TYPES_AVEC_BOUTON) {
      const b = await boutonPourEntite(faussDb({ data: { view_token: 'j' } }), 'org1', type, 'e1');
      expect(b?.url, type).toMatch(/\/(quote|invoice)\/j$/);
    }
  });
});
