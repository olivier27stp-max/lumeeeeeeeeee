/**
 * Le module Vente doit rester activé — pour de bon.
 *
 * LE SYMPTÔME RAPPORTÉ
 * « Je l'active, je reviens sur le site, il faut toujours que je le réactive,
 *  mais mes données restent là. »
 *
 * Les données restaient parce que la base était CORRECTE : `org_features`
 * portait bien `module_vente / enabled = true`. Le bug était entièrement côté
 * lecture — quatre chemins distincts menaient au même symptôme, tous en
 * confondant « je ne sais pas » avec « c'est désactivé » :
 *
 *   1. le `catch` du fetch posait `enabled: false` sur une panne réseau ;
 *   2. une réponse non-OK (401 pendant le renouvellement du jeton, 500,
 *      503 au réveil de Railway) ne posait AUCUN état, mais `loading` passait
 *      quand même à false — donc `isEnabled` restait false ;
 *   3. une session pas encore restaurée sortait de la même façon ;
 *   4. App.tsx construisait le menu sur `isEnabled` seul, sans regarder
 *      `loading` : le cadenas s'affichait pendant chaque chargement.
 *
 * Un « faux désactivé » est bien plus coûteux qu'un « faux activé » : le
 * second laisse voir un écran vide protégé par la RLS, le premier fait croire
 * que le produit perd ses réglages.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const hook = read('src/hooks/useModuleAccess.ts');
const gate = read('src/components/ModuleGate.tsx');
const app = read('src/App.tsx');

describe('le hook distingue « inconnu » de « désactivé »', () => {
  it('expose un état indéterminé', () => {
    expect(hook).toContain('indetermine: boolean');
  });

  it('une panne réseau ne conclut plus « désactivé »', () => {
    // Avant : `catch { setFlag({ enabled: false }) }` — une coupure de trois
    // secondes suffisait à faire réapparaître l'écran d'activation.
    const bloc = hook.slice(hook.indexOf('const fetchFlag'), hook.indexOf('useEffect(() => {'));
    expect(bloc).not.toMatch(/catch\s*\{\s*setFlag\(\{\s*enabled:\s*false/);
    expect(bloc).toContain('setEchecLecture(true)');
  });

  it('une réponse non-OK est traitée, pas ignorée', () => {
    // Le `if (res.ok)` sans `else` laissait `flag` à null tout en terminant le
    // chargement : indiscernable d'un module désactivé.
    const bloc = hook.slice(hook.indexOf('const fetchFlag'), hook.indexOf('useEffect(() => {'));
    expect(bloc).toMatch(/\}\s*else\s*\{[\s\S]*setEchecLecture\(true\)/);
  });

  it('une session pas encore prête ne vaut pas « désactivé »', () => {
    expect(hook).toMatch(/!session\?\.access_token.*setEchecLecture\(true\)/);
  });

  it('un échec après une lecture réussie n’efface pas l’état connu', () => {
    // `flag === null` dans la condition : une fois qu'on SAIT que le module est
    // actif, un hoquet réseau ultérieur ne doit pas tout remettre en cause.
    expect(hook).toContain('indetermine: echecLecture && flag === null');
  });

  it('une lecture réussie efface l’indétermination', () => {
    expect(hook).toContain('setEchecLecture(false)');
  });
});

describe('l’écran d’activation ne réapparaît pas à tort', () => {
  it('ModuleGate laisse passer quand l’état est inconnu', () => {
    // Les pages restent protégées par la RLS et les permissions serveur : au
    // pire l'utilisateur voit un écran vide, jamais les données d'autrui.
    expect(gate).toContain('indetermine');
    const bloc = gate.slice(gate.indexOf('if (indetermine)'));
    expect(bloc.slice(0, 120)).toContain('return <>{children}</>');
  });

  it('le contrôle d’indétermination précède celui d’activation', () => {
    // Sinon `!isEnabled` l'emporterait et l'écran de déverrouillage
    // s'afficherait quand même.
    expect(gate.indexOf('if (indetermine)')).toBeLessThan(gate.indexOf('if (!isEnabled)'));
  });

  it('le menu ne montre pas le cadenas pendant le chargement', () => {
    expect(app).toContain('venteModule.isEnabled || venteModule.loading || venteModule.indetermine');
  });
});

describe('la persistance côté serveur reste correcte', () => {
  const routes = read('server/routes/feature-flags.ts');

  it('l’activation est bien écrite en base', () => {
    // La donnée n'a jamais été le problème — ce test empêche qu'elle le
    // devienne.
    expect(routes).toContain("from('org_features')");
    expect(routes).toContain('.upsert(');
    expect(routes).toContain("onConflict: 'org_id,feature'");
  });

  it('seul un propriétaire ou admin peut activer', () => {
    expect(routes).toContain('isOrgAdminOrOwner');
  });

  it('la lecture est filtrée par organisation', () => {
    const bloc = routes.slice(routes.indexOf("router.get('/features'"));
    expect(bloc.slice(0, 600)).toContain("eq('org_id', auth.orgId)");
  });
});
