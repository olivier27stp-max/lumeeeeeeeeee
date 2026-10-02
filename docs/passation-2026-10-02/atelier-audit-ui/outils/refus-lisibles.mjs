// Raccorde corpsRefusPermission : rbac.ts le ré-exporte du module à part, la table des routes l'utilise.
import { readFileSync, writeFileSync } from 'node:fs';
const racine = 'D:/lume-uiaudit/wt-lumi/';
const remplacer = (fichier, f) => {
  const chemin = racine + fichier;
  const avant = readFileSync(chemin, 'utf8');
  const apres = f(avant);
  if (apres === avant) throw new Error(`rien changé : ${fichier}`);
  writeFileSync(chemin, apres);
  console.log(fichier, 'ok');
};

remplacer('server/lib/rbac.ts', (s) => {
  const debut = s.indexOf('// ── Refus lisibles ─');
  const fin = s.indexOf('// ── Express middleware ─');
  if (debut === -1 || fin === -1) throw new Error('bornes introuvables dans rbac.ts');
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  const bloc = [
    '// ── Refus lisibles ──────────────────────────────────────────────────',
    '',
    '// Dans un module à part : la table des routes (`route-permissions.ts`) répond la même chose.',
    "import { corpsRefusPermission } from './refus-permission';",
    "export { corpsRefusPermission, type CorpsRefusPermission } from './refus-permission';",
    '',
    '',
  ].join(eol);
  return s.slice(0, debut) + bloc + s.slice(fin);
});

remplacer('server/lib/route-permissions.ts', (s) => {
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  let t = s.replace(
    "res.status(403).json({ error: `Permission denied: ${keys.join(' or ')}` });",
    '// Même corps que `requirePermission` : `error` inchangé, plus une phrase lisible (`message`).' + eol
      + '      res.status(403).json(corpsRefusPermission(keys));',
  );
  t = t.replace("import { requireAuthedClient } from './supabase';", `import { requireAuthedClient } from './supabase';${eol}import { corpsRefusPermission } from './refus-permission';`);
  return t;
});
