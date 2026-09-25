/**
 * Messages des champs personnalisés : chaque message écrit en français dans
 * le code (serveur, validation partagée, filtres, API client, contraintes en
 * base) a sa traduction anglaise. src/lib/champs/messages.ts
 *
 * Le relevé est statique : un nouveau message sans règle fait échouer ce
 * test, au lieu d'apparaître en français à un utilisateur anglophone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { messageChamps } from '../src/lib/champs/messages';

const racine = join(__dirname, '..');
const lire = (f: string) => readFileSync(join(racine, f), 'utf8');

const SOURCES_JS = [
  'server/lib/champs/service.ts',
  'server/routes/custom-fields.ts',
  'src/lib/champs/valeurs.ts',
  'src/lib/champs/filtres.ts',
  'src/lib/champs/filtresListe.ts',
  'src/lib/champsPersoApi.ts',
];
const MIGRATIONS = readdirSync(join(racine, 'supabase/migrations'))
  .filter((f) => /^20260926100\d{3}_.*\.sql$/.test(f))
  .map((f) => `supabase/migrations/${f}`);
/** Messages de développeur (paramètres d'une RPC mal appelée), jamais vus d'un utilisateur. */
const INTERNES = [/^p_champs doit/, /^cf_copier_valeurs :/];

const echantillon = (gabarit: string) => gabarit
  .replace(/\$\{[^}]+\}/g, 'X')
  .replace(/date%/g, 'date')
  .replace(/%/g, '3')
  .replace(/''/g, "'");

function messagesJs(): string[] {
  const res: string[] = [];
  for (const f of SOURCES_JS) {
    const s = lire(f);
    // Toute chaîne littérale qui ressemble à une phrase (majuscule ou « au début,
    // point ou » à la fin) — y compris dans un ternaire —, hors commentaires et journaux.
    for (const ligne of s.split('\n')) {
      if (/^\s*(\*|\/\/|\/\*)|console\.|logger\.|^import /.test(ligne)) continue;
      for (const x of ligne.matchAll(/([`'])((?:(?!\1).)*)\1/g)) {
        if (/^[A-ZÀ-Ü«][^]*\s[^]*[.»]$/.test(x[2])) res.push(x[2]);
      }
    }
    // « Impossible de <contexte>. » : chaque contexte passé à traduireErreur.
    for (const x of s.matchAll(/traduireErreur\([^,]+, ([`'])((?:(?!\1).)*)\1/g)) res.push(`Impossible de ${x[2]}.`);
  }
  return res;
}

function messagesSql(): string[] {
  const res: string[] = [];
  for (const f of MIGRATIONS) {
    for (const x of lire(f).matchAll(/raise exception '((?:[^']|'')*)'/g)) res.push(x[1]);
  }
  return res;
}

describe('messages des champs personnalisés — anglais', () => {
  const tous = [...new Set([...messagesJs(), ...messagesSql()].map(echantillon))]
    .filter((m) => /[a-zà-ÿ]/i.test(m))
    .filter((m) => /[éèàêçÉ«]|^(Impossible|Objet|Champ|Doublon|Permission|Identifiant|Seule|Une |Un |Le |La |Des |Ce |Cette |Aucun|Valeur|Date|Opérateur|Conditions|Unité|Non |Session|Action|refusé)/.test(m))
    .filter((m) => !INTERNES.some((r) => r.test(m)));

  it('le relevé trouve bien les messages (garde du test lui-même)', () => {
    expect(tous.length).toBeGreaterThan(60);
  });

  it.each(tous)('« %s » a sa traduction', (m) => {
    const en = messageChamps(m, false);
    expect(en).not.toBe(m);
    expect(en).not.toMatch(/[éèàêç«»]|Impossible|attend /);
  });

  it('exemples', () => {
    expect(messageChamps('« Superficie » attend un nombre.', false)).toBe('“Superficie” expects a number.');
    expect(messageChamps('Impossible d’enregistrer « Type ».', false)).toBe('Unable to save “Type”.');
    expect(messageChamps("Impossible d'enregistrer les champs cherchables.", false)).toBe('Unable to save the searchable fields.');
    expect(messageChamps('Le nombre de valeurs a changé (4 au lieu de 3) : relis le rapport.', false))
      .toBe('The number of values changed (4 instead of 3): review the report.');
    // Refus groupés, traduits morceau par morceau.
    expect(messageChamps('« A » est obligatoire. · « B » attend un nombre.', false)).toBe('“A” is required. · “B” expects a number.');
  });

  it('français : inchangé ; message inconnu : inchangé', () => {
    expect(messageChamps('« A » attend un nombre.', true)).toBe('« A » attend un nombre.');
    expect(messageChamps('Network error', false)).toBe('Network error');
  });
});
