// L'onglet « Modèles » de la liste devient « Prêtes à publier » (page + carte de l'app du support).
import { readFileSync, writeFileSync } from 'node:fs';
const racine = 'D:/lume-uiaudit/wt-lumi/';
const maj = (f, paires) => {
  let s = readFileSync(racine + f, 'utf8');
  for (const [a, b] of paires) { if (!s.includes(a)) throw new Error(`introuvable dans ${f} : ${a.slice(0, 60)}`); s = s.split(a).join(b); }
  writeFileSync(racine + f, s);
  console.log(f, 'ok');
};
maj('src/pages/Automations.tsx', [
  ["{ cle: 'modeles' as const, fr: 'Modèles', en: 'Templates', n: modeles.length },",
   "// « Prêtes à publier », plus « Modèles » : ce mot désigne la bibliothèque du menu Créer (copies en\n    // brouillon). Ici, ce sont les automatisations fournies pas encore publiées, qu'on publie en place.\n    { cle: 'modeles' as const, fr: 'Prêtes à publier', en: 'Ready to publish', n: modeles.length },"],
  ["{fr ? 'Voir les modèles' : 'Browse templates'}", "{fr ? 'Voir les automatisations prêtes à publier' : 'See ready-to-publish automations'}"],
]);
maj('server/lib/support/carte-app.ts', [
  ["L'onglet « Modèles » de la liste, lui, montre les préréglages de l'entreprise encore en brouillon.", "L'onglet « Prêtes à publier » de la liste, lui, montre les automatisations fournies à l'entreprise et pas encore publiées (on les publie en place, sans copie)."],
  ["Onglets : Toutes, À vérifier, Modèles, Corbeille", "Onglets : Toutes, À vérifier, Prêtes à publier, Corbeille"],
  ["les autres préréglages sont dans Modèles.", "les autres préréglages sont dans l'onglet « Prêtes à publier »."],
]);
