// Ajoute à la carte de l'app (lue par l'assistant de support) ce que le lot 2 change à l'écran.
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:/lume-uiaudit/wt-lumi/server/lib/support/carte-app.ts';
let s = readFileSync(f, 'utf8');
const ancre = "Dans la liste, Échap ferme le menu « … » d'une ligne et le menu « Créer ».";
if (!s.includes(ancre)) throw new Error('ancre introuvable');
const ajout = " Un seul menu s'ouvre à la fois. La liste est rangée par ordre alphabétique des noms affichés. En haut des trois pages, « Automatisations », « Vue d'ensemble » et « Réglages globaux » sont des liens. Si la langue du bureau ne peut pas être lue, la liste dit « Langue actuelle inconnue » et Réglages globaux « Impossible de lire la langue pour le moment. » : réessayer plus tard, rien n'a changé. Dans l'éditeur : le tiroir d'étapes s'ouvre le curseur dans la recherche et Échap le ferme ; Ctrl+Z annule et Ctrl+Y rétablit la dernière modification du parcours (hors d'un champ de saisie) ; un seul panneau à droite à la fois (ouvrir « Quand » ferme l'étape ouverte, après confirmation si une saisie se perdrait) ; pendant qu'un changement de déclencheur s'enregistre, la carte montre déjà le nouveau choix et l'indicateur dit « Enregistrement… » ; si l'automatisation a été supprimée pendant qu'on l'édite, l'écran dit « Cette automatisation n'existe plus. » avec « Mes automatisations ». Un rôle sans le droit reçoit « Votre rôle ne permet pas de modifier les automatisations. ». Bibliothèque de modèles : l'aperçu dit les conditions en clair (« Sauf les demandes venues du formulaire de demande ») et compte toutes les étapes, branches « si oui » / « si non » et note automatique comprises. Notifications et tâches d'une automatisation : en anglais pour un membre ou un bureau anglophone quand le texte anglais existe.";
s = s.replace(ancre, ancre + ajout);
writeFileSync(f, s);
console.log('carte mise à jour');
