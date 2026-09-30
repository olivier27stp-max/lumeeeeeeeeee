/** Module PAR — paramètres de l'entreprise, modèles de courriel, produits et services. */
import { tache, reponse, etat, refus, clarification, q, compte, ORG, AUJ } from './_outils.mjs';

export default function ({ jeu, argent, BUREAUX, SERVICES }) {
  const M = 'PAR';
  const mod = 'Paramètres et modèles de courriel';
  const t = (n, x) => tache(M, n, { module: mod, ...x });
  const qc = BUREAUX.qc;
  const modele = jeu.modelesCourriel.find((x) => x.cle === 'relance_amicale');
  const gouttieres = SERVICES.gouttieres, vitres = SERVICES.vitres_ext;
  const prixService = (s) => `(select coalesce((select b.prix_cents from public.predefined_services_bureau b where b.service_id = '${s.id}' and b.org_id = '${BUREAUX.qc.id}'), (select p.default_price_cents from public.predefined_services p where p.id = '${s.id}')))`;
  const reglages = (condition, n = 1) => compte('company_settings', condition, n);

  return [
    t(1, { role: 'repartiteur', type: 'lecture', priorite: 'DOIT', fumee: true, sensibilite: 'lecture', permission: 'settings.read',
      oral: 'cest quoi deja ladresse de la compagnie pis notre numero, jremplis un formulaire de fournisseur',
      court: 'Adresse et téléphone de l\'entreprise?',
      en: "What's our company address and phone number?",
      donnees: ['company_settings du bureau de Québec'],
      attendu: reponse({ description: `${qc.entreprise} : ${qc.rue}, ${qc.ville} ${qc.cp} ; téléphone ${qc.tel}.`,
        mentionne: ['1200', 'Charest', { tel: qc.tel }], neMentionnePas: [BUREAUX.lev.rue, { tel: BUREAUX.lev.tel }] }),
      pieges: ['ne pas donner l\'adresse du bureau de Lévis'] }),

    t(2, { role: 'proprio', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'on a un nouveau numero pour la compagnie cest le 500 555 0177 change le',
      court: 'Change le téléphone de l\'entreprise pour 500-555-0177.',
      en: "Change the company phone number to 500-555-0177.",
      attendu: etat({ description: 'Le téléphone du bureau de Québec est remplacé (format +15005550177 ou équivalent).',
        apres: [reglages("phone like '%500%555%0177'")] }),
      pieges: ['numéro de l\'ENTREPRISE, pas celui d\'un client ni le numéro texto Twilio'] }),

    t(3, { role: 'comptable', type: 'refus_permission', priorite: 'DOIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'mets le 500 555 0177 comme numero de la compagnie sur les factures',
      court: 'Change le téléphone de l\'entreprise pour 500-555-0177.',
      en: "Change the company phone number to 500-555-0177.",
      donnees: ['permissions de la comptable : settings.update = false'],
      attendu: refus({ raison: 'Le rôle de Nathalie (comptable) ne permet pas de modifier les paramètres de l\'entreprise.',
        inchange: [reglages(`phone = '${qc.tel}'`)], alternative: 'Demander au propriétaire.' }) }),

    t(4, { role: 'proprio', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'jveux que mes factures pis soumissions commencent par ECL',
      court: 'Mets le préfixe de documents « ECL ».',
      en: 'Set the document number prefix to "ECL".',
      attendu: etat({ description: 'Préfixe enregistré ; Lumi précise que seules les PROCHAINES factures et soumissions seront numérotées ECL-… (les documents existants gardent leur numéro).',
        apres: [reglages("prefixe_documents = 'ECL'")] }),
      pieges: ['ne pas renuméroter les factures émises (numéro gelé)'] }),

    t(5, { role: 'proprio', type: 'piege_ambiguite', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'mets eclat-2026 comme prefixe de facture',
      court: 'Mets « éclat-2026 » comme préfixe de mes documents.',
      en: 'Use "éclat-2026" as my document prefix.',
      attendu: clarification({ description: 'Le préfixe accepte seulement 1 à 5 lettres majuscules sans accent (pas de chiffres, d\'accent ni de trait d\'union) : Lumi l\'explique et propose une version valide (ex. « ECLAT ») avant d\'écrire quoi que ce soit.',
        options: ['ECLAT'], inchange: [reglages('prefixe_documents is null')],
        puis: etat({ description: 'Après « ok ECLAT » : préfixe enregistré.', apres: [reglages("prefixe_documents = 'ECLAT'")] }) }),
      suite: { fr_quebecois_oral: 'ok met ECLAT dabord', fr_court: 'D\'accord, ECLAT.', en: 'OK, use ECLAT.' },
      pieges: ['valeur invalide : ne pas l\'enregistrer tronquée ou déformée en silence'] }),

    t(6, { role: 'proprio', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'dans mon modele de courriel de relance amical change lobjet pour Votre soumission Eclat Lavage vous attend',
      court: 'Change l\'objet du modèle « Relance soumission — ton amical » pour « Votre soumission Éclat Lavage vous attend ».',
      en: 'Change the subject of the "Relance soumission — ton amical" email template to "Votre soumission Éclat Lavage vous attend".',
      donnees: [`modèle de courriel « ${modele.nom} » (type ${modele.type}, objet « ${modele.sujet} »)`],
      attendu: etat({ description: 'Seul l\'objet du modèle change ; le corps est conservé.',
        apres: [compte('email_templates', `name = '${modele.nom}' and subject = 'Votre soumission Éclat Lavage vous attend'`, 1),
                compte('email_templates', `name = '${modele.nom}' and body like 'Bonjour {{client_name}}%'`, 1)] }),
      pieges: ['modifier le modèle personnalisé, pas un modèle par défaut'],
      notes: 'Pour la formulation orale (sans accents), accepter « Votre soumission Eclat Lavage vous attend » : le contrôle SQL vise la formulation courte / anglaise.' }),

    t(7, { role: 'proprio', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'monte mon objectif de revenu a 12 500 piasses par mois',
      court: 'Mets mon objectif de revenu à 12 500 $ par mois.',
      en: 'Set my revenue goal to $12,500 a month.',
      donnees: [`objectif annuel actuel : ${argent(jeu.objectifs.revenuAnnuel)} (Réglages → Entreprise, « Objectif de revenu annuel »)`],
      attendu: etat({ description: `L'objectif des réglages est ANNUEL : 12 500 $ par mois = 150 000,00 $ par an (avant : ${argent(jeu.objectifs.revenuAnnuel)}). Ou, à défaut, l'objectif du mois (table goals) mis à 12 500 $. Jamais « 12 500 $ » inscrit comme objectif annuel.`,
        apres: [q(`select ((select count(*) from public.company_settings where org_id = '${ORG.qc}' and revenue_goal_cents = 15000000) + (select count(*) from public.goals where org_id = '${ORG.qc}' and metric = 'revenue' and period = 'monthly' and target_value = 1250000 and start_date <= ${AUJ} and end_date >= ${AUJ})) > 0`, true),
                reglages('revenue_goal_cents <> 1250000')] }),
      pieges: ['piasses = dollars', 'objectif annuel dans les réglages : convertir le mensuel (× 12)', 'montant en cents en base (15 000 000)'] }),

    t(8, { role: 'proprio', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'mets mon lien davis google cest http://g.page/r/eclat-lavage/review',
      court: 'Ajoute mon lien d\'avis Google : http://g.page/r/eclat-lavage/review',
      en: 'Add my Google review link: http://g.page/r/eclat-lavage/review',
      attendu: etat({ description: 'Le lien d\'avis Google doit commencer par https:// : Lumi enregistre la version https (en le disant) ; jamais la version http.',
        apres: [reglages("google_review_url = 'https://g.page/r/eclat-lavage/review'")] }),
      notes: 'Si Lumi demande d\'abord « je le mets en https:// ? », répondre oui, puis vérifier.',
      pieges: ['la page Avis refuse un lien http://'] }),

    t(9, { role: 'repartiteur', type: 'aide_produit', priorite: 'DEVRAIT', sensibilite: 'lecture', permission: 'settings.read',
      oral: 'comment jfais pour rajouter une case pour le nombre detages de la maison dans les fiches clients',
      court: 'Comment ajouter un champ « nombre d\'étages » aux fiches clients?',
      en: 'How do I add a "number of floors" field to client records?',
      attendu: reponse({ description: 'Paramètres → Champs personnalisés : créer un champ (type nombre ou liste) pour les clients ; il apparaît ensuite sur la fiche. Peut préciser qu\'il faut la permission de modifier les paramètres (que Julie n\'a pas) et distinguer des étiquettes.',
        mentionne: ['Champs personnalisés'] }) }),

    t(10, { role: 'proprio', type: 'action_simple', priorite: 'DOIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'monte le prix du nettoyage de gouttieres a 175',
      court: `Change le prix de « ${gouttieres.nom} » pour 175 $.`,
      en: `Change the price of "${gouttieres.nom}" to $175.`,
      donnees: [`service.gouttieres (${argent(gouttieres.prix)})`],
      attendu: etat({ description: `Prix du service passé de ${argent(gouttieres.prix)} à 175,00 $ (prix du catalogue ou prix du bureau de Québec) ; les soumissions et factures existantes ne changent pas.`,
        apres: [q(`select ${prixService(gouttieres)}`, 17500), q(`select ${prixService(vitres)}`, vitres.prix)] }),
      pieges: ['ne pas toucher aux autres services', 'ne pas modifier les documents déjà émis'] }),

    t(11, { role: 'comptable', type: 'lecture', priorite: 'BONUS', sensibilite: 'lecture', permission: 'settings.read',
      oral: 'lume est tu a lheure de montreal ou ben a lheure de la place ou ce que les serveurs sont',
      court: 'Quel fuseau horaire utilise mon compte?',
      en: 'Which time zone is my account set to?',
      attendu: reponse({ description: 'Fuseau America/Montreal (heure de l\'Est, avec l\'heure avancée) : heures des rendez-vous, rappels et fenêtre d\'envoi s\'y calculent.',
        mentionne: ['Montreal'], sql: [reglages("timezone = 'America/Montreal'")] }),
      notes: '« Montreal » est comparé sans accent : « Montréal » passe. « Heure de l\'Est » seul, sans nommer Montréal, est un échec partiel.' }),
  ];
}
