import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * PLUS DE FENÊTRES NATIVES DU NAVIGATEUR DANS L'APPLICATION.
 *
 * Audit du 2026-09-09 : 43 appels `alert()` / `confirm()` traînaient dans
 * `src/` — des boîtes grises système, non stylées, non traduisibles, qui
 * gèlent l'onglet, ignorent le thème et que le robot de recette ne voit
 * pas. Partout ailleurs l'application utilise ses propres modaux et les
 * toasts `sonner`.
 *
 * Remplaçants :
 *   - `confirm()`  → `await confirmer({ message, danger })`
 *                    (src/components/ui/ConfirmDialog.tsx)
 *   - `alert()`    → `toast.error()` / `toast.info()` de `sonner`
 *   - `prompt()`   → un vrai formulaire dans un modal
 *
 * Ce test parcourt tout `src/` et rougit dès qu'un appel natif réapparaît.
 * Il ignore les commentaires, et ne confond pas `confirmer(`, `onConfirm`,
 * `confirmLabel` ou `toast.confirm(` avec l'appel global.
 */

const RACINE = process.cwd();
const DOSSIER = path.join(RACINE, 'src');

/** Le seul fichier autorisé à parler de ces fonctions — il les remplace. */
const EXCLUS = new Set(['src/components/ui/ConfirmDialog.tsx']);

/**
 * Appel global à alert/confirm/prompt, avec ou sans `window.`.
 * `(?<![\w.$])` : pas précédé d'un caractère d'identifiant ni d'un point,
 * donc `confirmer(`, `onConfirm(`, `toast.confirm(` ne matchent pas.
 * Le `window.` optionnel est lui-même protégé par le même lookbehind.
 */
const APPEL_NATIF = /(?<![\w.$])(?:window\.)?(alert|confirm|prompt)\s*\(/g;

/** Retire les commentaires `//` et `/* *\/` pour ne juger que le code. */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (_m, avant: string) => avant);
}

function fichiersSource(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) fichiersSource(abs, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) acc.push(abs);
  }
  return acc;
}

function appelsNatifs(source: string): { ligne: number; texte: string }[] {
  const code = sansCommentaires(source);
  const trouves: { ligne: number; texte: string }[] = [];
  for (const m of code.matchAll(APPEL_NATIF)) {
    const ligne = code.slice(0, m.index).split('\n').length;
    trouves.push({ ligne, texte: source.split('\n')[ligne - 1].trim() });
  }
  return trouves;
}

describe('aucune fenêtre native du navigateur dans src/', () => {
  it('le détecteur reconnaît les vrais appels et ignore les faux amis', () => {
    expect(appelsNatifs("if (!confirm('x')) return;")).toHaveLength(1);
    expect(appelsNatifs("if (!window.confirm(msg)) return;")).toHaveLength(1);
    expect(appelsNatifs("window.alert('x'); alert('y'); prompt('z')")).toHaveLength(3);
    expect(appelsNatifs("await confirmer({ message: 'x' })")).toHaveLength(0);
    expect(appelsNatifs('onConfirm(); props.confirm(); toast.confirm(1)')).toHaveLength(0);
    expect(appelsNatifs('const confirmLabel = 1; confirmPassword(); $confirm()')).toHaveLength(0);
    expect(appelsNatifs("// alert('x')\n/* confirm('y') */")).toHaveLength(0);
    expect(appelsNatifs("const url = 'http://x'; // confirm('y')")).toHaveLength(0);
  });

  it("aucun alert() / confirm() / prompt() natif ne subsiste", () => {
    const fautifs: string[] = [];
    for (const abs of fichiersSource(DOSSIER)) {
      const rel = path.relative(RACINE, abs).split(path.sep).join('/');
      if (EXCLUS.has(rel)) continue;
      for (const { ligne, texte } of appelsNatifs(fs.readFileSync(abs, 'utf8'))) {
        fautifs.push(`${rel}:${ligne}  ${texte}`);
      }
    }
    expect(fautifs, 'Remplacer par confirmer() ou toast (voir en-tête du test)').toEqual([]);
  });

  it('le remplaçant est monté une seule fois, sous LanguageProvider', () => {
    const main = fs.readFileSync(path.join(RACINE, 'src/main.tsx'), 'utf8');
    expect(main).toContain('<ConfirmDialogHost />');
    expect(main.indexOf('<ConfirmDialogHost />')).toBeGreaterThan(main.indexOf('<LanguageProvider>'));
    expect(main.indexOf('<ConfirmDialogHost />')).toBeLessThan(main.indexOf('</LanguageProvider>'));
  });
});
