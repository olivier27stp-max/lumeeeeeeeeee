/**
 * B-22 — relances de paiement : au-delà de 500 factures en retard dans un
 * palier, certaines n'étaient JAMAIS relancées.
 *
 * Le cron lisait `.limit(500)` sans ordre : toujours les mêmes 500 lignes.
 * Il lit maintenant toutes les pages, dans un ordre stable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lireToutesLesPages, PAGE_FACTURES, PAGES_MAX_PAR_PALIER } from '../../../server/routes/reminders-cron';

/** Une « table » de n factures, lue par tranches comme PostgREST (`range(de, a)`, bornes incluses). */
function table(n: number) {
  const lignes = Array.from({ length: n }, (_, i) => ({ id: `f${i}` }));
  const appels: Array<[number, number]> = [];
  const lirePage = async (de: number, a: number) => { appels.push([de, a]); return { data: lignes.slice(de, a + 1), error: null }; };
  return { lignes, appels, lirePage };
}

describe('[B-22] le cron lit TOUTES les factures du palier', () => {
  it('1 203 factures : trois pages, aucune oubliée, aucune en double', async () => {
    const t = table(1203);
    const r = await lireToutesLesPages<{ id: string }>(t.lirePage);
    expect(t.appels).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(r.lignes.map((l) => l.id)).toEqual(t.lignes.map((l) => l.id));
    expect(r).toMatchObject({ erreur: null, tronque: false });
  });

  it('moins d’une page : une seule lecture', async () => {
    const t = table(12);
    const r = await lireToutesLesPages<{ id: string }>(t.lirePage);
    expect(t.appels).toEqual([[0, 499]]);
    expect(r.lignes).toHaveLength(12);
  });

  it('exactement une page pleine : une lecture de plus, vide, pour savoir que c’est fini', async () => {
    const t = table(PAGE_FACTURES);
    const r = await lireToutesLesPages<{ id: string }>(t.lirePage);
    expect(t.appels).toHaveLength(2);
    expect(r.lignes).toHaveLength(PAGE_FACTURES);
  });

  it('une erreur à la 2e page : ce qui a été lu est rendu, avec l’erreur — rien n’est inventé', async () => {
    const t = table(900);
    let n = 0;
    const r = await lireToutesLesPages<{ id: string }>(async (de, a) => (++n === 2 ? { data: null, error: { message: 'panne' } } : t.lirePage(de, a)));
    expect(r.lignes).toHaveLength(500);
    expect(r.erreur).toBe('panne');
  });

  it('garde-fou : un passage s’arrête au plafond de pages et le dit', async () => {
    const t = table(10_000);
    const r = await lireToutesLesPages<{ id: string }>(t.lirePage, 100, 3);
    expect(r.lignes).toHaveLength(300);
    expect(r.tronque).toBe(true);
    expect(PAGES_MAX_PAR_PALIER * PAGE_FACTURES).toBeGreaterThanOrEqual(20_000);
  });

  it('la requête du cron est ORDONNÉE (échéance, puis identifiant) et paginée — plus de `limit(500)` sans ordre', () => {
    const source = readFileSync(resolve(__dirname, '../../../server/routes/reminders-cron.ts'), 'utf8');
    expect(source).toMatch(/\.order\('due_date', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)\.range\(de, a\)/);
    expect(source).not.toMatch(/requete\.limit\(500\)/);
    expect(source).toContain('lireToutesLesPages<FactureARelancer>(lirePage)');
  });
});
