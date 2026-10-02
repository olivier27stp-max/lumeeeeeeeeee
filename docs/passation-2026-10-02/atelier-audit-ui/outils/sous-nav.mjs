// Remplace les trois copies de la sous-navigation par <SousNavigation />, sans toucher aux fins de ligne.
import { readFileSync, writeFileSync } from 'node:fs';
const racine = 'D:/lume-uiaudit/wt-lumi/';
const pages = [
  ['src/pages/Automations.tsx', 'liste', "import BandeauPause from '../components/automations/BandeauPause';"],
  ['src/pages/AutomationsApercu.tsx', 'apercu', "import PermissionGate from '../components/PermissionGate';"],
  ['src/pages/AutomationsReglages.tsx', 'reglages', "import PermissionGate from '../components/PermissionGate';"],
];
for (const [fichier, section, ancre] of pages) {
  let s = readFileSync(racine + fichier, 'utf8');
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  const motif = /<div className="flex flex-wrap items-center gap-5 border-b border-border[^"]*">[\s\S]*?<\/nav>\s*<\/div>/;
  if (!motif.test(s)) throw new Error(`bloc introuvable : ${fichier}`);
  s = s.replace(motif, `<SousNavigation courante="${section}" fr={fr} />`);
  if (!s.includes(ancre)) throw new Error(`ancre d'import introuvable : ${fichier}`);
  s = s.replace(ancre, `${ancre}${eol}import SousNavigation from '../components/automations/SousNavigation';`);
  writeFileSync(racine + fichier, s);
  console.log(fichier, 'ok', eol === '\r\n' ? 'CRLF' : 'LF');
}
