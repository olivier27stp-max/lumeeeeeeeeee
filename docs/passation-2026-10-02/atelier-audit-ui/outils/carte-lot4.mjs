// Carte de l'app : les causes d'échec dites en clair (lot 4).
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:/lume-uiaudit/wt-lumi/server/lib/support/carte-app.ts';
let s = readFileSync(f, 'utf8');
const ancre = "le badge « N échec(s) dans les 7 derniers jours » dit aussi la cause ;";
if (!s.includes(ancre)) throw new Error('ancre introuvable');
s = s.replace(ancre, ancre + " la cause est dite en clair dans la liste comme dans l'onglet Journaux (ex. « Les demandes d'avis sont désactivées dans Paramètres › Avis clients. », « Une demande d'avis a déjà été envoyée à ce client dans les 7 derniers jours. », « Ce client n'a ni adresse courriel ni numéro de téléphone. ») ;");
writeFileSync(f, s);
console.log('carte mise à jour');
