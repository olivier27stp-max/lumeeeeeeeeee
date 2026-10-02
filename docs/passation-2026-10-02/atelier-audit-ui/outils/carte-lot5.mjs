import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:/lume-uiaudit/wt-lumi/server/lib/support/carte-app.ts';
let s = readFileSync(f, 'utf8');
const ancre = "publier (dans l'éditeur, par l'interrupteur de la liste ou en lot) est REFUSÉ si le parcours est incomplet, et le message nomme ce qui manque.";
if (!s.includes(ancre)) throw new Error('ancre introuvable');
s = s.replace(ancre, ancre + " Si une étape porte encore le texte d'exemple de l'éditeur (jamais rédigé), publier demande confirmation — « Publier avec le texte d'exemple ? » dans la liste, une ligne « ⚠ » dans la confirmation de l'éditeur — et cite ce texte : on peut publier quand même, ou ouvrir l'étape pour l'écrire.");
writeFileSync(f, s);
console.log('carte mise à jour');
