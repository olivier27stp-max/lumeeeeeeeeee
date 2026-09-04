/**
 * UNE DATE SANS HEURE NE RECULE JAMAIS D'UN JOUR.
 *
 * LE CONSTAT (2026-09-04)
 * Les colonnes `date` arrivent de Supabase sous la forme « 2026-09-04 ».
 * `new Date('2026-09-04')` est minuit UTC — soit le 3 à 20 h partout au
 * Canada. Résultat, vérifié en fuseau America/Toronto :
 *
 *     stocké : 2026-09-04     affiché : 2026-09-03
 *
 * Une facture « due le 4 » s'affichait « due le 3 » sur la liste, la
 * fiche, le PDF envoyé au client et le portail. Un devis « valide
 * jusqu'au 4 » était refusé à l'approbation toute la journée du 4.
 *
 * CE QUE CES TESTS FIGENT
 *   1. Les deux helpers (navigateur et serveur) lisent une date seule
 *      comme une date civile, quel que soit le fuseau de la machine.
 *   2. Les trois formateurs partagés passent par le helper.
 *   3. Aucun `new Date(x.due_date)` ne subsiste dans le code — c'est le
 *      garde qui empêche le bug de revenir par un nouveau fichier.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { versDate, finDeJournee, estDateSeule } from '../src/lib/dateSeule';
import { dateDuJour, estEchue } from '../server/lib/date-seule';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

/* ── 1. Les helpers ─────────────────────────────────────────────── */

describe('versDate (navigateur)', () => {
  it('lit « 2026-09-04 » comme le 4 septembre, dans le fuseau de la machine', () => {
    // Quel que soit le fuseau où tourne ce test, la date civile est la même.
    const d = versDate('2026-09-04');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 4]);
    expect(d.getHours()).toBe(0);
  });

  it('laisse un instant complet (timestamptz) strictement intact', () => {
    // Un timestamptz est un instant précis : le convertir en local est
    // le comportement voulu, et ne doit pas changer.
    const iso = '2026-07-31T01:01:41.843+00:00';
    expect(versDate(iso).getTime()).toBe(new Date(iso).getTime());
  });

  it('rend une Date telle quelle', () => {
    const d = new Date(2026, 0, 15);
    expect(versDate(d)).toBe(d);
  });

  it('estDateSeule reconnaît la forme exacte, rien d autre', () => {
    expect(estDateSeule('2026-09-04')).toBe(true);
    expect(estDateSeule('2026-09-04T00:00:00Z')).toBe(false);
    expect(estDateSeule('04/09/2026')).toBe(false);
    expect(estDateSeule(null)).toBe(false);
  });

  it('finDeJournee couvre la journée entière', () => {
    // « Valide jusqu'au 4 » = valide à 23 h 59 le 4.
    const f = finDeJournee('2026-09-04');
    expect([f.getDate(), f.getHours(), f.getMinutes()]).toEqual([4, 23, 59]);
    expect(f.getTime()).toBeGreaterThan(new Date(2026, 8, 4, 22).getTime());
  });
});

describe('estEchue (serveur)', () => {
  // 2026-09-04T03:30Z = le 3 septembre à 23 h 30 à Montréal (UTC-4 en été).
  const SOIR_DU_3 = new Date('2026-09-04T03:30:00Z');
  // 2026-09-04T04:30Z = le 4 septembre à 00 h 30 à Montréal.
  const NUIT_DU_4 = new Date('2026-09-04T04:30:00Z');
  // 2026-09-05T02:00Z = le 4 septembre à 22 h à Montréal.
  const SOIR_DU_4 = new Date('2026-09-05T02:00:00Z');

  it('dateDuJour donne la date civile dans le fuseau demandé', () => {
    expect(dateDuJour('America/Toronto', SOIR_DU_3)).toBe('2026-09-03');
    expect(dateDuJour('America/Toronto', NUIT_DU_4)).toBe('2026-09-04');
    expect(dateDuJour('UTC', SOIR_DU_3)).toBe('2026-09-04');
  });

  it('le dernier jour de validité compte encore', () => {
    // C'est le bug d'origine : à 22 h le 4, un devis valide jusqu'au 4
    // était déjà refusé, parce que minuit UTC était passé depuis 20 h.
    expect(estEchue('2026-09-04', 'America/Toronto', SOIR_DU_4)).toBe(false);
  });

  it('la veille au soir, un devis valide jusqu au lendemain n est pas échu', () => {
    expect(estEchue('2026-09-04', 'America/Toronto', SOIR_DU_3)).toBe(false);
  });

  it('le lendemain à minuit passé, il l est', () => {
    expect(estEchue('2026-09-03', 'America/Toronto', NUIT_DU_4)).toBe(true);
  });

  it('sans date, jamais échu', () => {
    expect(estEchue(null)).toBe(false);
    expect(estEchue(undefined)).toBe(false);
  });

  it('absorbe l heure d hiver sans arithmétique', () => {
    // 2026-01-15T04:30Z = le 14 janvier à 23 h 30 à Montréal (UTC-5).
    expect(dateDuJour('America/Toronto', new Date('2026-01-15T04:30:00Z'))).toBe('2026-01-14');
  });
});

/* ── 2. Les formateurs partagés passent par le helper ───────────── */

describe('les formateurs partagés utilisent versDate', () => {
  it('formatDate (utils.ts)', () => {
    const src = lire('src/lib/utils.ts');
    const i = src.indexOf('export function formatDate');
    expect(src.slice(i, i + 300)).toContain('versDate(date)');
  });

  for (const f of ['src/lib/generateInvoicePdf.ts', 'src/lib/generateQuotePdf.ts']) {
    it(`fmtDate (${f.split('/').pop()})`, () => {
      const src = lire(f);
      const i = src.indexOf('function fmtDate');
      expect(src.slice(i, i + 200)).toContain('versDate(iso)');
    });
  }

  it('l approbation publique d un devis compare des dates civiles', () => {
    const src = lire('server/routes/quotes.ts');
    expect(src).toContain('estEchue(quote.valid_until)');
    expect(src).not.toMatch(/new Date\(quote\.valid_until\) < new Date\(\)/);
  });
});

/* ── 3. Le garde : aucun `new Date(x.<colonne date>)` ne subsiste ── */

describe('aucune colonne date n est passée à new Date() directement', () => {
  const COLONNES = [
    'due_date', 'valid_until', 'sale_date', 'next_recurrence_date', 'birth_date',
    'start_date', 'end_date', 'period_start', 'period_end', 'slot_date',
    'work_date', 'visit_date', 'next_run_date', 'anchor_date', 'value_date', 'target_date',
  ];
  const motif = `new Date\\([a-zA-Z_.?!]*\\.(${COLONNES.join('|')})\\b`;

  it('dans src/', () => {
    // Si ce test rougit : un nouveau fichier lit une colonne `date` via
    // `new Date()`. Remplacer par `versDate()` de src/lib/dateSeule.ts.
    let sortie = '';
    try {
      sortie = execSync(`git grep -nE "${motif}" -- src ":!*.test.*"`, { cwd: RACINE, encoding: 'utf8' });
    } catch (e: any) {
      // git grep sort en code 1 quand il ne trouve rien : c'est le cas voulu.
      sortie = e.stdout ?? '';
    }
    expect(sortie.trim().split('\n').filter(Boolean)).toEqual([]);
  });
});
