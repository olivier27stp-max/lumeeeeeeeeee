/**
 * Ce que l'app télécharge AVANT d'afficher quoi que ce soit (2026-09-24).
 *
 * Mesuré à la sourcemap, le bundle d'entrée portait 1,4 Mo, dont 196 Ko pour
 * `NewJobModal` — un formulaire monté en permanence avec `isOpen={false}`.
 * Quelqu'un qui consultait ses factures téléchargeait le formulaire de job
 * sans jamais l'ouvrir.
 *
 * Ce test ne mesure pas une performance, il empêche une RÉGRESSION : un
 * import statique ajouté par mégarde dans un contexte ou dans App.tsx fait
 * grossir l'entrée sans que personne ne le voie, et le prochain qui le
 * remarque aura 300 Ko de plus à défaire.
 *
 * Le plafond est volontairement lâche (10 % au-dessus du mesuré) : il attrape
 * un gros module qui retombe dans l'entrée, pas la dérive normale du code.
 * Un test de poids trop serré finit désactivé.
 *
 * Il ne s'exécute QUE si `dist/` existe — sinon il passerait silencieusement
 * en CI si le build changeait de dossier.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const racine = resolve(__dirname, '..');
const dist = resolve(racine, 'dist');
const assets = resolve(dist, 'assets');

/** Les fichiers que `index.html` charge lui-même, avant tout routage. */
function bundlesDEntree(): { nom: string; ko: number }[] {
  const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
  const chemins = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  return chemins.map((c) => {
    const p = resolve(dist, c.replace(/^\//, ''));
    return { nom: c.split('/').pop() as string, ko: Math.round(statSync(p).size / 1024) };
  });
}

const aUnBuild = existsSync(resolve(dist, 'index.html')) && existsSync(assets);

describe.skipIf(!aUnBuild)('poids du démarrage', () => {
  it('l’entrée reste sous le plafond', () => {
    /* Mesuré le 2026-09-24 : 1 097 Ko + 276 Ko de vendor, après avoir sorti
       NewJobModal (−303 Ko, −21 %). Plafond à 1 550 Ko pour les deux : il
       laisse respirer, et hurle si un gros module retombe dans l'entrée. */
    const total = bundlesDEntree().reduce((n, b) => n + b.ko, 0);
    expect(total, `entrée = ${total} Ko`).toBeLessThan(1550);
  });

  it('un seul fichier est préchargé, et c’est vendor', () => {
    // Règle du CLAUDE.md : « Seul `vendor` doit être préchargé dans
    // dist/index.html — vérifier après tout changement de découpage. »
    const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
    const preloads = [...html.matchAll(/rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toMatch(/\/assets\/vendor-[^.]+\.js$/);
  });

  it('les modales lourdes ont leur propre fichier, chargé à la demande', () => {
    /* La preuve que le découpage a bien eu lieu : si quelqu'un remet un
       import statique, Rollup refusionne le module dans l'entrée et ce
       fichier disparaît. */
    const fichiers = readdirSync(assets);
    expect(fichiers.some((f) => /^NewJobModal-.*\.js$/.test(f)), 'NewJobModal devrait être un chunk séparé').toBe(true);
  });

  it('le contrôleur charge ses modales en lazy, pas en dur', () => {
    const src = readFileSync(resolve(racine, 'src/contexts/JobModalController.tsx'), 'utf8');
    expect(src).toContain("lazy(() => import('../components/NewJobModal'))");
    expect(src).not.toMatch(/^import NewJobModal from/m);
    // Monté seulement quand il s'ouvre : c'est ce qui permet au code de ne
    // pas être téléchargé avant.
    expect(src).toContain('{isOpen && (');
  });
});
