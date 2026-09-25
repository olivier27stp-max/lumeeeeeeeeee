/**
 * Empreinte des libellés d'interface, page par page (2026-09-17).
 * ────────────────────────────────────────────────────────────────
 * La carte de l'app du support (server/lib/support/carte-app.ts) cite les
 * boutons EXACTS de chaque écran ; c'est la seule source de Lumi pour un
 * « comment faire ». Elle vieillit dès qu'une page change ses libellés sans
 * qu'on la relise (vu avec la PR #415 : pourboires, litiges, rappels de
 * paiement ajoutés, carte muette).
 *
 * Ici : pour chaque page, l'ensemble trié de ses libellés français écrits en
 * dur dans le JSX (texte entre balises, `fr ? '…' : '…'`, label / title /
 * placeholder / aria-label), haché. Le test tests/support/carte-app-fraicheur
 * compare à tests/support/carte-app-empreinte.json : une page dont les
 * libellés ont changé fait échouer le test tant que l'empreinte n'est pas
 * régénérée (`npm run carte:empreinte`) — geste à faire APRÈS avoir mis la
 * carte à jour. Les libellés passés par i18n (t.xxx) ne sont pas couverts.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Dossiers dont chaque .tsx est une page ou un panneau de réglages. */
export const DOSSIERS = ['src/pages', 'src/pages/settings', 'src/components/settings'];

const LETTRE = /[A-Za-zÀ-ÿ]{3,}/;

/** Les libellés français d'un source TSX, triés, dédoublonnés. Pur. */
export function extraireLibelles(source) {
  const out = new Set();
  // Un jeton de code (className, /automations, onClick) n'est pas un libellé : sans espace ET sans majuscule initiale, on l'écarte.
  // Un fragment de code (« ) : enrolled ? ( », « ${x} ») non plus : accolades, parenthèses, ?, ;, = ou backtick l'écartent.
  const garder = (s) => { const t = s.replace(/\s+/g, ' ').trim(); if (t.length >= 3 && LETTRE.test(t) && !/[{}()?;=`|]/.test(t) && !(/^[a-z0-9_./:-]+$/i.test(t) && !/^[A-ZÀ-Ý]/.test(t))) out.add(t); };
  // fr ? 'Libellé' : 'Label'  /  language === 'fr' ? 'Libellé' : …  /  isFr ? "…" : …
  for (const m of source.matchAll(/(?:\bfr\b|===\s*'fr'|\bisFr\b|\bestFr\b)\s*\?\s*(['"`])((?:(?!\1)[^\\]|\\.){3,160})\1/g)) garder(m[2]);
  // Texte entre balises : >Libellé<   (sans accolade : pas d'expression)
  for (const m of source.matchAll(/>\s*([^<>{}\n]{3,160}?)\s*</g)) garder(m[1]);
  // Attributs textuels
  for (const m of source.matchAll(/\b(?:label|title|placeholder|aria-label|alt)=(['"])([^'"{}]{3,160})\1/g)) garder(m[2]);
  return [...out].sort();
}

function fichiersTsx(dossier) {
  let noms = [];
  try { noms = readdirSync(dossier); } catch { return []; }
  return noms.filter((n) => n.endsWith('.tsx')).map((n) => join(dossier, n)).filter((f) => statSync(f).isFile());
}

/** { 'src/pages/Jobs.tsx': 'sha1 des libellés', … } pour toutes les pages. */
export function empreintePages(racine) {
  const out = {};
  for (const d of DOSSIERS) {
    for (const f of fichiersTsx(join(racine, d))) {
      const libelles = extraireLibelles(readFileSync(f, 'utf8'));
      out[relative(racine, f).replace(/\\/g, '/')] = createHash('sha1').update(libelles.join('\n')).digest('hex').slice(0, 16);
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}
