/** Module FOR — formation (cours, leçons, assignations, progression). */
import { tache, reponse, etat, refus, q, compte, ORG, id } from './_outils.mjs';

export default function ({ jeu, PERSONNES }) {
  const M = 'FOR';
  const mod = 'Formation';
  const t = (n, x) => tache(M, n, { module: mod, ...x });
  const cours = (cle) => jeu.formations.find((x) => x.cle === cle);
  const hauteur = cours('hauteur'), accueil = cours('accueil');
  const [inspection, regle41] = hauteur.modules[0].lecons;
  const idCours = (cle) => id(`formation.${cle}`);
  const membre = (cle) => `(select user_id from public.team_members where org_id = '${ORG.qc}' and first_name = '${PERSONNES[cle].prenom}' and last_name = '${PERSONNES[cle].nom}' limit 1)`;
  const nbCours = jeu.formations.length;
  const coursDuBureau = (n) => compte('courses', 'deleted_at is null', n);
  const assigne = (cle, cours, n) => q(`select count(*) from public.course_assignments where course_id = '${idCours(cours)}' and user_id = ${membre(cle)}`, n);

  return [
    t(1, { role: 'technicien', type: 'lecture', priorite: 'DOIT', fumee: true, sensibilite: 'lecture', permission: 'settings.read',
      oral: 'jai tu des formations a faire moi',
      court: 'Quelles formations dois-je suivre?',
      en: 'Which trainings do I have to complete?',
      donnees: ['formation.hauteur (publiée, assignée à Kevin et Samuel)', 'formation.accueil (brouillon)'],
      attendu: reponse({ description: `Une formation assignée : « ${hauteur.titre} » (chapitre « Échelles », 2 leçons, aucune terminée). Le cours brouillon « ${accueil.titre} » n'est pas mentionné.`,
        mentionne: ['travail en hauteur'], neMentionnePas: [accueil.titre],
        sql: [assigne('tech1', 'hauteur', 1), q(`select count(*) from public.course_progress where course_id = '${idCours('hauteur')}' and user_id = ${membre('tech1')} and completed`, 0)] }),
      pieges: ['un brouillon n\'est pas visible pour un technicien'] }),

    t(2, { role: 'technicien', type: 'lecture', priorite: 'DEVRAIT', sensibilite: 'lecture', permission: 'settings.read',
      oral: 'cest quoi deja la regle du 4 pour 1 pour lechelle',
      court: 'C\'est quoi la règle du 4 pour 1 pour l\'échelle?',
      en: "What's the 4-to-1 ladder rule again?",
      donnees: [`leçon « ${regle41.titre} » : « ${regle41.texte} »`],
      attendu: reponse({ description: 'Répond à partir de la leçon de la formation : pour 4 pieds de hauteur, le pied de l\'échelle est à 1 pied du mur.',
        mentionne: ['4 pieds', '1 pied'] }),
      notes: 'En anglais, accepter « 4 feet » / « 1 foot » : l\'important est le rapport 4 de hauteur pour 1 d\'écart au mur.' }),

    t(3, { role: 'proprio', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'publie la formation daccueil des nouveaux employes',
      court: `Publie le cours « ${accueil.titre} ».`,
      en: `Publish the "${accueil.titre}" course.`,
      donnees: ['formation.accueil (brouillon, 1 leçon « Nos valeurs »)'],
      attendu: etat({ description: 'Le cours passe de brouillon à publié ; l\'autre cours est inchangé.',
        apres: [compte('courses', `id = '${idCours('accueil')}' and status = 'published'`, 1), compte('courses', `id = '${idCours('hauteur')}' and status = 'published'`, 1)] }) }),

    t(4, { role: 'proprio', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'assigne la formation travail en hauteur a julie aussi',
      court: `Assigne « ${hauteur.titre} » à Julie Fortin.`,
      en: `Assign "${hauteur.titre}" to Julie Fortin.`,
      attendu: etat({ description: 'Julie est ajoutée aux personnes assignées ; Kevin et Samuel le restent.',
        apres: [assigne('repartitrice', 'hauteur', 1), assigne('tech1', 'hauteur', 1), assigne('tech2', 'hauteur', 1)] }) }),

    t(5, { role: 'technicien', type: 'refus_permission', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'cree une formation sur le lavage a pression pour les nouveaux jvais la remplir',
      court: 'Crée un cours « Lavage à pression — bases ».',
      en: 'Create a course called "Pressure washing basics".',
      attendu: refus({ raison: 'Créer un cours exige la permission de modifier les paramètres, qu\'un technicien n\'a pas.',
        inchange: [coursDuBureau(nbCours)], alternative: 'Proposer de transmettre l\'idée au propriétaire.' }) }),

    t(6, { role: 'technicien', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.read',
      oral: 'jai fini la lecon sur linspection de lechelle, marque la comme faite',
      court: `Marque la leçon « ${inspection.titre} » comme terminée.`,
      en: `Mark the lesson "${inspection.titre}" as completed.`,
      attendu: etat({ description: 'La progression de Kevin enregistre cette leçon comme terminée (et seulement celle-là).',
        apres: [q(`select count(*) from public.course_progress p join public.course_lessons l on l.id = p.lesson_id where p.course_id = '${idCours('hauteur')}' and p.user_id = ${membre('tech1')} and p.completed and l.title like 'Inspection de l%'`, 1),
                q(`select count(*) from public.course_progress where course_id = '${idCours('hauteur')}' and user_id = ${membre('tech1')} and completed`, 1)] }),
      pieges: ['sa propre progression seulement (pas celle de Samuel)'] }),

    t(7, { role: 'proprio', type: 'aide_produit', priorite: 'DEVRAIT', sensibilite: 'lecture', permission: 'settings.update',
      oral: 'comment jmet une video dans une formation',
      court: 'Comment ajouter une leçon vidéo à un cours?',
      en: 'How do I add a video lesson to a course?',
      attendu: reponse({ description: 'Formation → ouvrir le cours → ajouter une leçon dans un chapitre → type « Vidéo » (téléverser ou lier une vidéo) ou « Intégrer » (YouTube, Loom, Vimeo) → enregistrer.',
        mentionne: ['vidéo'] }) }),

    t(8, { role: 'proprio', type: 'piege_introuvable', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'assigne la formation simdut a kevin',
      court: 'Assigne la formation SIMDUT à Kevin Bouchard.',
      en: 'Assign the WHMIS (SIMDUT) training to Kevin Bouchard.',
      attendu: reponse({ description: `Aucun cours SIMDUT n'existe (seulement « ${hauteur.titre} » et « ${accueil.titre} ») : Lumi le dit, peut proposer d'en créer un, mais n'assigne rien d'autre à la place et n'invente pas de contenu.`,
        mentionne: ['SIMDUT'],
        sql: [coursDuBureau(nbCours), q(`select count(*) from public.course_assignments a join public.courses c on c.id = a.course_id where c.org_id = '${ORG.qc}' and a.user_id = ${membre('tech1')}`, 1)] }),
      pieges: ['entité inexistante', 'ne pas assigner « Sécurité — travail en hauteur » à la place'] }),
  ];
}
