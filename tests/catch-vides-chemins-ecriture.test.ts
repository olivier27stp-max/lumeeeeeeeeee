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

/*
 * L'AUTRE FORME : `.catch(() => {})` au bout d'une promesse d'écriture.
 *
 * Audit des automatisations du 2026-09-28 : `AutomationBuilderPage.tsx`
 * enregistrait le déclencheur proposé par Lumi avec
 * `modifierAutomatisation(...).catch(() => {})`. Le détecteur ci-dessus ne
 * voit que `try { … } catch { }` : cette forme passait. L'écran montrait le
 * nouveau déclencheur, la base gardait l'ancien.
 *
 * Une écriture = celles de `ECRITURE`, ou l'appel d'un helper dont le nom
 * dit qu'il écrit (modifier…, creer…, supprimer…, enregistrer…, ecrire…).
 */
const CATCH_FLECHE_VIDE = /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(?:\{\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)?\s*\}|undefined|null|void 0)\s*\)/g;
const HELPER_ECRITURE = /\b(?:modifier|creer|supprimer|enregistrer|ecrire|changer|restaurer|ranger|renommer)[A-Z\w]*\s*\(/;

export function catchFlechesVidesSurEcriture(source: string): number[] {
  const lignes: number[] = [];
  for (const m of source.matchAll(CATCH_FLECHE_VIDE)) {
    // L'instruction qui porte le `.catch` : depuis la fin de la précédente
    // (un `;`, ou une accolade qui ouvre/ferme un BLOC — suivie d'un saut de
    // ligne —, pas celles d'un objet passé en argument).
    const avant = source.slice(0, m.index);
    const debut = Math.max(avant.lastIndexOf(';'), avant.lastIndexOf('{\n') + 1, avant.lastIndexOf('}\n') + 1);
    const instruction = avant.slice(debut + 1);
    if ((ECRITURE.test(instruction) || HELPER_ECRITURE.test(instruction)) && !STOCKAGE_LOCAL.test(instruction)) {
      lignes.push(avant.split('\n').length);
    }
  }
  return lignes;
}

describe('la forme `.catch(() => {})` sur une écriture', () => {
  it('la voit sur un helper d’écriture', () => {
    expect(catchFlechesVidesSurEcriture(`x;\nmodifierAutomatisation(id, { a: 1 }).catch(() => {});`)).toEqual([2]);
    expect(catchFlechesVidesSurEcriture(`x;\nfetch('/a', { method: 'POST' }).catch(() => undefined);`)).toEqual([2]);
  });
  it('ignore une lecture et un catch qui journalise', () => {
    expect(catchFlechesVidesSurEcriture(`x;\ngetAutomationLanguage().then(setOrgLang).catch(() => {});`)).toEqual([]);
    expect(catchFlechesVidesSurEcriture(`x;\nmodifierAutomatisation(id, {}).catch((e) => console.error(e));`)).toEqual([]);
  });

  /*
   * Appliqué à la surface des AUTOMATISATIONS (mission de launch). Le reste
   * du dépôt en compte d'autres, hors du périmètre de cette mission : ils
   * sont listés dans le rapport de launch (SUIVI_POST_LAUNCH), pas corrigés
   * en douce ici.
   */
  it('l’éditeur, la liste et les composants d’automatisation sont propres', () => {
    const cibles = [
      ...fichiers(resolve(RACINE, 'src/components/automations')),
      ...['AutomationBuilderPage.tsx', 'Automations.tsx', 'AutomationsApercu.tsx', 'AutomationsReglages.tsx']
        .map((f) => resolve(RACINE, 'src/pages', f)),
    ];
    const trouves: string[] = [];
    for (const f of cibles) {
      for (const l of catchFlechesVidesSurEcriture(readFileSync(f, 'utf8'))) {
        trouves.push(`${relative(RACINE, f).replace(/\\/g, '/')}:${l}`);
      }
    }
    expect(trouves).toEqual([]);
  });
});

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
