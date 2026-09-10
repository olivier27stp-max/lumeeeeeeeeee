/**
 * LES CATCH VIDES SUR UN CHEMIN D'ÉCRITURE.
 *
 * Audit du 2026-09-09 (I1) : 199 blocs `catch` avalaient l'erreur en entier.
 * Une recherche naïve de `catch {}` n'en voyait aucun — ils contiennent un
 * commentaire (« catch { commentaire } »), ce qui suffit à tromper l'œil.
 *
 * Sur un chemin de LECTURE, avaler est souvent un choix (compteur cosmétique,
 * météo, logo par défaut). Sur un chemin d'ÉCRITURE ou d'appel réseau
 * mutant, c'est une perte de données silencieuse : commission jamais créée,
 * notification jamais marquée lue, infos de facturation perdues, session
 * jamais révoquée. Le projet n'a pas d'ESLint ; ce test tient lieu de règle
 * `no-empty` ciblée.
 *
 * Règle : après un `try` qui contient une écriture Supabase (insert / update /
 * upsert / delete), un `fetch` mutant (POST / PUT / PATCH / DELETE) ou un
 * RPC qui n'est pas une lecture, le `catch` doit faire quelque chose —
 * au minimum un `console.error`. Les catch qui ne protègent que
 * localStorage / sessionStorage sont hors sujet.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');

function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dossier)) {
    const p = join(dossier, e);
    if (e === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

// Un catch dont le corps est vide ou ne contient qu'un commentaire.
const CATCH_VIDE = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)?\s*\}/g;
// Une écriture dans le bloc try qui précède.
const ECRITURE = /\.(insert|update|upsert|delete)\(|method:\s*['"](POST|PUT|PATCH|DELETE)['"]|\.rpc\(['"](?!has_|get_|current_|search_|is_|check_|list_|find_|count_)/;
const STOCKAGE_LOCAL = /localStorage|sessionStorage/;

export function catchVidesSurEcriture(source: string): number[] {
  const lignes: number[] = [];
  for (const m of source.matchAll(CATCH_VIDE)) {
    const debutTry = source.lastIndexOf('try', m.index);
    const bloc = source.slice(Math.max(0, debutTry), m.index);
    if (ECRITURE.test(bloc) && !STOCKAGE_LOCAL.test(bloc)) {
      lignes.push(source.slice(0, m.index).split('\n').length);
    }
  }
  return lignes;
}

describe('la détection elle-même', () => {
  it('voit un catch qui ne contient qu un commentaire', () => {
    const src = `try { await db.from('x').insert({}) } catch { ` + '/* silent */' + ` }`;
    expect(catchVidesSurEcriture(src)).toEqual([1]);
  });
  it('ignore un catch qui journalise', () => {
    const src = `try { await db.from('x').insert({}) } catch (e) { console.error(e) }`;
    expect(catchVidesSurEcriture(src)).toEqual([]);
  });
  it('ignore les lectures et le stockage local', () => {
    expect(catchVidesSurEcriture(`try { const r = await db.from('x').select() } catch {}`)).toEqual([]);
    expect(catchVidesSurEcriture(`try { localStorage.setItem('a', 'b') } catch {}`)).toEqual([]);
  });
});

describe('aucun catch vide sur un chemin d écriture', () => {
  const trouves: string[] = [];
  for (const dossier of ['src', 'server']) {
    for (const f of fichiers(resolve(RACINE, dossier))) {
      const src = readFileSync(f, 'utf8');
      for (const l of catchVidesSurEcriture(src)) {
        trouves.push(`${relative(RACINE, f).replace(/\\/g, '/')}:${l}`);
      }
    }
  }

  it('src/ et server/ sont propres', () => {
    // Si ce test rougit : une écriture vient d'être enveloppée dans un catch
    // qui avale tout. Journaliser (console.error + captureClientException côté
    // client, dead_letters côté serveur quand c'est rejouable) — pas taire.
    expect(trouves).toEqual([]);
  });
});
