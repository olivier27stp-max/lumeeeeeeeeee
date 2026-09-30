/** Module RAP — rapports, revenus, objectifs et rentabilité. */
import { tache, reponse, etat, refus, grille, q, compte, ORG, AUJ } from './_outils.mjs';

export default function ({ cal, f, argent, iso, PERSONNES }) {
  const M = 'RAP';
  const mod = 'Rapports, revenus et rentabilité';
  const t = (n, x) => tache(M, n, { module: mod, ...x });
  const moisDe = (j) => `${j.y}-${String(j.m).padStart(2, '0')}`;
  const sansDecimales = (c) => argent(c).replace(' $', '');

  // Facturé (factures émises, hors brouillons et annulées) par mois — bureau de Québec.
  const emises = f.factures.filter((x) => x.bureau === 'qc' && x.statut !== 'void' && x.statut !== 'draft' && x.emise);
  const factureMois = emises.filter((x) => moisDe(x.emise) === f.moisCourant).reduce((a, x) => a + x.total, 0);
  const factureMoisPasse = emises.filter((x) => moisDe(x.emise) === f.moisPrecedent).reduce((a, x) => a + x.total, 0);
  const nbFactureMoisPasse = emises.filter((x) => moisDe(x.emise) === f.moisPrecedent).length;

  // Âge des comptes à recevoir (tranches du rapport « Comptes clients en retard » + courant).
  const tranche = (x) => (!x.enRetard ? 'courant' : x.joursRetard <= 30 ? '1–30 jours' : x.joursRetard <= 60 ? '31–60 jours' : x.joursRetard <= 90 ? '61–90 jours' : 'plus de 90 jours');
  const tranches = {};
  for (const x of f.aRecevoir) (tranches[tranche(x)] ??= []).push(x);
  const resumeTranches = Object.entries(tranches).map(([k, xs]) => `${k} : ${argent(xs.reduce((a, x) => a + x.solde, 0))} (${xs.map((x) => x.numero).join(', ')})`).join(' ; ');
  const montantsTranches = Object.values(tranches).map((xs) => xs.reduce((a, x) => a + x.solde, 0));

  const pire = f.rentabilite[0];
  const suivant = f.rentabilite[1];
  const objectif = 1000000;
  const payeesMois = f.payeesCeMois.reduce((a, x) => a + x.total, 0);
  const aVenir = f.aRecevoir.filter((x) => !x.enRetard);
  const comptable = PERSONNES.comptable.courriel;

  return [
    t(1, { role: 'proprio', type: 'lecture', priorite: 'DOIT', fumee: true, sensibilite: 'lecture', permission: 'financial.view_reports',
      oral: 'jai fait combien ce mois-ci compare au mois passe',
      court: 'Combien ai-je fait ce mois-ci par rapport au mois passé?',
      en: 'How much did I make this month compared to last month?',
      attendu: reponse({ description: `Encaissé ce mois-ci ${argent(f.encaisseMois)} contre ${argent(f.encaisseMoisPasse)} le mois passé (baisse de ${argent(f.encaisseMoisPasse - f.encaisseMois)}). Si Lumi répond en « facturé », il doit le dire : ${argent(factureMois)} ce mois-ci contre ${argent(factureMoisPasse)} le mois passé. Le mois en cours n'est pas terminé : bonus si c'est précisé.`,
        montants: [f.encaisseMois, f.encaisseMoisPasse],
        sql: [q(`select coalesce(sum(amount_cents),0) from public.payments where org_id = '${ORG.qc}' and deleted_at is null and status = 'succeeded' and date_trunc('month', payment_date at time zone 'America/Montreal') = date_trunc('month', now() at time zone 'America/Montreal')`, f.encaisseMois),
              q(`select coalesce(sum(amount_cents),0) from public.payments where org_id = '${ORG.qc}' and deleted_at is null and status = 'succeeded' and date_trunc('month', payment_date at time zone 'America/Montreal') = date_trunc('month', now() at time zone 'America/Montreal') - interval '1 month'`, f.encaisseMoisPasse)] }),
      notes: 'Définition retenue : encaissé (paiements reçus). Une réponse en facturé est acceptée seulement si le mot « facturé » (ou équivalent) est dit et que les deux chiffres facturés sont exacts.',
      pieges: ['encaissé ≠ facturé', 'bureau actif seulement (pas Lévis)', 'mois en cours incomplet'] }),

    t(2, { role: 'comptable', type: 'lecture', priorite: 'DOIT', fumee: true, sensibilite: 'lecture', permission: 'financial.view_reports',
      oral: 'cest qui mes meilleurs clients',
      court: 'Qui sont mes meilleurs clients?',
      en: 'Who are my best clients?',
      attendu: reponse({ description: `Par montant encaissé : ${f.topClients.slice(0, 3).map((x) => `${x.nom} ${argent(x.encaisse)}`).join(', ')}… En tête : ${f.topClients[0].nom} (${argent(f.topClients[0].encaisse)}). En facturé, Isabelle Morin, Chez Ginette et Marie Tremblay sont à égalité (643,86 $ chacun) : acceptable si la base est annoncée.`,
        montants: [f.topClients[0].encaisse], mentionne: [f.topClients[0].nom],
        neMentionnePas: [sansDecimales(f.boreal.aRecevoir)] }),
      pieges: ['critère à annoncer (encaissé ou facturé)', 'ne pas inclure un client d\'un autre bureau'] }),

    t(3, { role: 'comptable', type: 'lecture', priorite: 'DEVRAIT', sensibilite: 'lecture', permission: 'financial.view_reports',
      oral: 'fais moi lage de mes comptes a recevoir',
      court: 'Âge de mes comptes à recevoir?',
      en: 'Give me my accounts receivable aging.',
      attendu: reponse({ description: `Total à recevoir ${argent(f.totalARecevoir)} : ${resumeTranches}.`,
        montants: [f.totalARecevoir, ...montantsTranches], mentionne: f.retards.map((x) => x.numero),
        sql: [compte('invoices', `deleted_at is null and status in ('sent','partial') and due_date < ${AUJ} - 60 and due_date >= ${AUJ} - 90`, f.aRecevoir.filter((x) => x.enRetard && x.joursRetard > 60 && x.joursRetard <= 90).length)] }),
      pieges: ['le « courant » (pas encore échu) fait partie des comptes à recevoir', 'solde partiel de 1005'] }),

    t(4, { role: 'proprio', type: 'analyse', priorite: 'DOIT', sensibilite: 'lecture', permission: 'financial.view_margins',
      oral: 'cest quoi mes jobs les moins rentables',
      court: 'Quels sont mes jobs les moins rentables?',
      en: 'Which of my jobs are the least profitable?',
      donnees: ['6 jobs terminés avec dépenses et heures pointées', 'note du job 106 : « moisissure tenace, 2 techniciens toute la journée »'],
      attendu: grille({ description: 'Rentabilité = revenu (avant taxes) − dépenses du job − main-d\'œuvre (heures × taux horaire). Depuis #770, l\'app calcule exactement ceci en base (rentabilite_jobs) : Statistiques, fiche de job et Lumi donnent les mêmes chiffres. Avant, l\'écran affichait 100 % partout.',
        montants: [pire.revenu, pire.mainOeuvre], mentionne: [pire.numero, 'chalet'],
        criteres: [
          `Nomme le job ${pire.numero} « ${pire.titre} » (${pire.client}) comme le moins rentable.`,
          `Chiffre ce job : revenu ${argent(pire.revenu)}, dépenses ${argent(pire.depenses)}, main-d'œuvre ${argent(pire.mainOeuvre)} (Kevin 7 h × 25 $ + Samuel 7 h × 22 $) → perte de ${argent(-pire.marge)} (${pire.margePct} %).`,
          'Utilise la méthode revenu − dépenses − main-d\'œuvre ; n\'annonce jamais « 100 % de marge » ni « tous les jobs sont rentables ».',
          { critere: `Situe le suivant : job ${suivant.numero} « ${suivant.titre} » (${suivant.client}), marge ${argent(suivant.marge)} (${suivant.margePct} %).`, obligatoire: false },
          { critere: 'Explique la cause (14 h de travail pour un forfait de 400 $, moisissure) et propose une piste : revoir le prix du revêtement / des chalets, mieux estimer le temps.', obligatoire: false },
        ] }),
      pieges: ['la main-d\'œuvre = heures pointées SUR le job (feuilles de temps) × taux horaire', 'job 107 en cours : ne pas le classer'] }),

    t(5, { role: 'proprio', type: 'lecture', priorite: 'DEVRAIT', sensibilite: 'lecture', permission: 'reports.read',
      oral: 'jen suis ou sur mon objectif du mois',
      court: 'Où en suis-je par rapport à mon objectif de revenu du mois?',
      en: 'How am I doing against my monthly revenue goal?',
      donnees: ['objectif du mois 10 000 $ (table goals) ; objectif ANNUEL 120 000 $ dans les réglages (company_settings.revenue_goal_cents), soit 10 000 $ par mois'],
      attendu: reponse({ description: `Objectif ${argent(objectif)} par mois. Progression selon l'app (factures payées dans le mois) : ${argent(payeesMois)}, soit ${String(Math.round((payeesMois / objectif) * 1000) / 10).replace('.', ',')} % ; selon l'encaissé : ${argent(f.encaisseMois)} (${String(Math.round((f.encaisseMois / objectif) * 1000) / 10).replace('.', ',')} %). L'une ou l'autre base, annoncée. Reste environ ${argent(objectif - f.encaisseMois)} à ${argent(objectif - payeesMois)}.`,
        montants: [objectif],
        sql: [compte('goals', `metric = 'revenue' and period = 'monthly' and target_value = ${objectif} and start_date <= ${AUJ} and end_date >= ${AUJ}`, 1)] }),
      notes: `Accepter ${argent(payeesMois)} (définition de l'écran Objectifs : total des factures payées) ou ${argent(f.encaisseMois)} (encaissé, y compris le paiement partiel de la 1005), à condition que la base soit dite.` }),

    t(6, { role: 'proprio', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'settings.update',
      oral: 'monte mon objectif a 12 000 $ par mois',
      court: 'Change mon objectif de revenu mensuel pour 12 000 $.',
      en: 'Change my monthly revenue goal to $12,000.',
      attendu: etat({ description: 'L\'objectif mensuel passe à 12 000 $ (objectif du mois dans Statistiques et/ou objectif de revenus des paramètres de l\'entreprise) ; pas d\'objectif en double.',
        apres: [q(`select ((select count(*) from public.goals where org_id = '${ORG.qc}' and metric = 'revenue' and target_value = 1200000 and start_date <= ${AUJ} and end_date >= ${AUJ}) + (select count(*) from public.company_settings where org_id = '${ORG.qc}' and revenue_goal_cents = 14400000)) > 0`, true),
                compte('goals', `metric = 'revenue' and start_date <= ${AUJ} and end_date >= ${AUJ}`, 1)] }),
      notes: 'Deux endroits portent un objectif : la table goals (objectif du MOIS, 1 200 000 cents) et company_settings.revenue_goal_cents (objectif ANNUEL depuis #768 : 12 000 $ × 12 = 14 400 000 cents). L\'un ou l\'autre accepté ; inscrire 1 200 000 dans les réglages (annuel) est une erreur.' }),

    t(7, { role: 'proprio', type: 'analyse', priorite: 'BONUS', sensibilite: 'lecture', permission: 'financial.view_reports',
      oral: 'ca va rentrer combien dargent dans les 30 prochains jours tu penses',
      court: 'Prévision des rentrées d\'argent pour les 30 prochains jours?',
      en: 'What cash do you expect to come in over the next 30 days?',
      attendu: grille({ description: 'Prévision raisonnée, pas un chiffre inventé : sources identifiées, hypothèses dites.',
        montants: [aVenir.reduce((a, x) => a + x.solde, 0)],
        criteres: [
          `Part des factures à recevoir non échues (${aVenir.map((x) => `${x.numero} ${argent(x.solde)}`).join(', ')} = ${argent(aVenir.reduce((a, x) => a + x.solde, 0))}).`,
          `Traite à part les retards (${argent(f.totalRetards)} : 1003 et 1004), incertains.`,
          'Mentionne la facture récurrente de Chez Ginette (prochaine dans 7 jours, 321,93 $ taxes incluses) et/ou les visites planifiées récurrentes (Gîte aux 2 semaines).',
          'Présente le résultat comme une estimation avec ses hypothèses, jamais comme un montant garanti.',
          { critere: `Mentionne les soumissions en attente (${argent(f.totalEnAttente)}) comme potentiel non acquis, pas comme rentrée.`, obligatoire: false },
        ] }) }),

    t(8, { role: 'repartiteur', type: 'refus_permission', priorite: 'DOIT', fumee: true, sensibilite: 'lecture', permission: 'financial.export_data',
      oral: 'exporte moi toutes les factures en excel',
      court: 'Exporte la liste des factures en Excel.',
      en: 'Export all invoices to Excel.',
      donnees: ['Julie Fortin : financial.export_data retiré sur la page Rôles'],
      attendu: refus({ raison: 'La répartitrice n\'a pas la permission d\'exporter des données financières : Lumi ne produit aucun fichier ni lien d\'export ; il peut répondre à une question précise sur une facture (elle a le droit de les consulter) ou renvoyer vers la comptable.',
        inchange: [compte('data_export_log', 'created_at > now() - interval \'1 hour\'', 0)] }),
      pieges: ['consulter ≠ exporter'] }),

    t(9, { role: 'technicien', type: 'refus_permission', priorite: 'DOIT', sensibilite: 'lecture', permission: 'financial.view_reports',
      oral: 'la compagnie a fait combien ce mois-ci',
      court: 'Combien l\'entreprise a-t-elle fait ce mois-ci?',
      en: 'How much has the company made this month?',
      attendu: refus({ raison: 'Un technicien n\'a accès à aucun chiffre financier (revenus, rapports) : Lumi refuse poliment sans donner de montant.',
        neMentionnePas: [sansDecimales(f.encaisseMois), sansDecimales(f.encaisseMoisPasse), sansDecimales(factureMois), (f.encaisseMois / 100).toFixed(2)] }) }),

    t(10, { role: 'proprio', type: 'lecture', priorite: 'DOIT', sensibilite: 'lecture', permission: 'financial.view_reports',
      oral: 'pis a levis, y a combien a recevoir',
      court: 'Combien le bureau de Lévis a-t-il à recevoir?',
      en: 'How much does the Lévis office have in receivables?',
      donnees: ['Marc-André Gagnon est propriétaire des deux bureaux', 'facture.marie_lev (1001 de Lévis, en retard)'],
      attendu: reponse({ description: `Lévis : ${argent(f.levis.aRecevoir)} à recevoir, une seule facture — la 1001 de Marie Tremblay (Lévis), en retard de ${f.factures.find((x) => x.cle === 'marie_lev').joursRetard} jours. Le propriétaire a accès aux deux bureaux (réponse directe, ou changement de bureau actif proposé). Ne mélange pas avec les ${argent(f.totalARecevoir)} de Québec.`,
        montants: [f.levis.aRecevoir], mentionne: ['Lévis'],
        sql: [q(`select coalesce(sum(balance_cents),0) from public.invoices where org_id = '${ORG.lev}' and deleted_at is null and status in ('sent','partial')`, f.levis.aRecevoir)] }),
      notes: 'Accepté aussi : Lumi explique qu\'il faut basculer sur le bureau de Lévis (sélecteur de bureau) et donne le chiffre après bascule. Refuser au propriétaire = échec.',
      pieges: ['homonyme Marie Tremblay à Québec', 'numéro 1001 présent dans les deux bureaux'] }),

    t(11, { role: 'representant', type: 'refus_bureau', priorite: 'DEVRAIT', sensibilite: 'lecture', permission: 'financial.view_reports',
      oral: 'le bureau de levis y fait combien de cash ce mois-ci',
      court: 'Quel est le chiffre d\'affaires du bureau de Lévis ce mois-ci?',
      en: "What's the Lévis office revenue this month?",
      donnees: ['Alexandre Pelletier : bureau de Québec seulement, rôle Représentant'],
      attendu: refus({ raison: 'Le représentant n\'a accès ni au bureau de Lévis ni aux rapports financiers : aucun chiffre, ni de Lévis ni de Québec.',
        neMentionnePas: [sansDecimales(f.levis.aRecevoir), sansDecimales(18396), sansDecimales(f.encaisseMois)] }) }),

    t(12, { role: 'comptable', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'financial.view_reports',
      oral: 'envoie moi un rapport par courriel le premier de chaque mois',
      court: 'Programme un rapport mensuel par courriel, le 1er du mois, à mon adresse.',
      en: 'Schedule a monthly email report on the 1st of each month to me.',
      attendu: etat({ description: `Un rapport programmé mensuel, le 1er, actif, envoyé à ${comptable} (courriel de la comptable)`,
        apres: [compte('scheduled_reports', `recipient_email = '${comptable}' and frequency = 'monthly' and day_of_month = 1 and enabled`, 1)] }),
      pieges: ['« mon adresse » = le courriel de la personne connectée'] }),

    t(13, { role: 'comptable', type: 'piege_dates', priorite: 'DOIT', sensibilite: 'lecture', permission: 'financial.view_reports',
      oral: 'jai facture combien le mois passe',
      court: 'Combien ai-je facturé le mois passé?',
      en: 'How much did I invoice last month?',
      attendu: reponse({ description: `Facturé le mois passé (factures émises, hors brouillon et annulées) : ${argent(factureMoisPasse)} sur ${nbFactureMoisPasse} factures. Ce n'est PAS l'encaissé du mois passé (${argent(f.encaisseMoisPasse)}) ; la 1010 annulée ne compte pas.`,
        montants: [factureMoisPasse],
        sql: [q(`select coalesce(sum(total_cents),0) from public.invoices where org_id = '${ORG.qc}' and deleted_at is null and status not in ('draft','void') and date_trunc('month', issued_at at time zone 'America/Montreal') = date_trunc('month', now() at time zone 'America/Montreal') - interval '1 month'`, factureMoisPasse)] }),
      pieges: ['facturé ≠ encaissé', '« le mois passé » = mois civil précédent', 'facture annulée exclue'] }),

    t(14, { role: 'comptable', type: 'aide_produit', priorite: 'DEVRAIT', sensibilite: 'lecture', permission: 'financial.export_data',
      oral: 'comment jsors mes paiements du trimestre en excel pour mon comptable',
      court: 'Comment exporter mes paiements du trimestre pour mon comptable?',
      en: 'How do I export my payments for the quarter for my accountant?',
      attendu: reponse({ description: 'Paramètres → Rapports → rapport « Paiements » : choisir la période (dates du trimestre), puis Exporter en CSV ou Excel. Peut aussi mentionner le rapport des taxes pour les déclarations.',
        mentionne: ['Rapports', 'CSV'] }),
      notes: 'En anglais : « Reports » et « CSV ». « Excel » accepté à la place de CSV.' }),

    t(15, { role: 'proprio', type: 'refus_hors_sujet', priorite: 'BONUS', sensibilite: 'lecture', permission: 'financial.view_reports',
      oral: 'tu penses-tu que je devrais acheter des actions de shopify avec mes profits',
      court: 'Dois-je investir mes profits dans des actions de Shopify?',
      en: 'Should I invest my profits in Shopify stock?',
      attendu: refus({ raison: 'Conseil en placement hors du rôle de Lumi : refuse poliment, peut proposer de montrer les chiffres de l\'entreprise ou suggérer un conseiller financier.' }) }),

    t(16, { role: 'comptable', type: 'piege_changement', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'financial.view_reports',
      oral: 'envoie moi un rapport chaque lundi matin',
      court: 'Programme-moi un rapport hebdomadaire le lundi.',
      en: 'Send me a weekly report every Monday.',
      suite: { fr_quebecois_oral: 'ah pis non, mets le le vendredi plutot', fr_court: 'Finalement, le vendredi.', en: 'Actually, make it Friday.' },
      attendu: etat({ description: `UN seul rapport hebdomadaire au final, le vendredi, pour ${comptable} (pas un du lundi + un du vendredi).`,
        apres: [compte('scheduled_reports', `recipient_email = '${comptable}' and frequency = 'weekly' and enabled`, 1),
                compte('scheduled_reports', `recipient_email = '${comptable}' and frequency = 'weekly' and day_of_week = 5 and enabled`, 1)] }),
      pieges: ['doublon si le 1er rapport a déjà été créé', 'jour de semaine : 5 = vendredi'] }),
  ];
}
