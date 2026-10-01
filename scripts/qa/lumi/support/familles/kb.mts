/**
 * Famille 1 — Base de connaissances : les questions « comment faire ».
 * Les questions et leurs attentes viennent de scripts/qa/evaluer-support-qualite.mts
 * (50 questions de clients québécois, écrites comme ils écrivent). Ce script-là appelle le
 * cerveau du support en mémoire, sur staging ; ici la question passe par la vraie route, en
 * production : la FAQ écrite, le centre d'aide et le cache répondent AVANT le modèle, et
 * c'est la réponse que le client reçoit qui est jugée, quel que soit l'étage.
 *
 * Écarts avec la liste d'origine :
 *  - « bogue » et « je veux parler à une vraie personne » sont dans la famille escalade ;
 *  - « paie-export » ne nomme plus QuickBooks (c'est une des sources de l'outil de migration
 *    de données, que la batterie ne doit jamais déclencher) : la question demande le même
 *    export, pour le comptable ;
 *  - deux attentes étaient périmées par rapport à la carte de l'app (server/lib/support/carte-app.ts)
 *    et sont mises à jour, sans rien adoucir d'autre : « terrain-pipeline » accepte /ventes (l'ancien
 *    /pipeline est retiré du menu : « toujours diriger vers /ventes ») ; « terrain-rapports » accepte
 *    « semaine » (la carte dit « jour / semaine / mois », plus « hebdomadaire »).
 * Aucune des 50 ne portait sur l'import ou la migration de données.
 */
import { jugerKb, type AttenduKb } from '../jugement.mts';
import { unTour } from '../tour.mts';
import type { Contexte, Famille } from '../types.mts';

interface CasKb { id: string; question: string; attendu: AttenduKb }

export const CAS_KB: CasKb[] = [
  // ── Travail quotidien ──
  { id: 'taches-supprimer', question: "comment je fais pour effacer une tache que j'ai pu besoin", attendu: { route: /\/tasks/, mots: /Supprimer/, transfert: false } },
  { id: 'jobs-supprimer', question: "c'est où pour supprimer une job au complet", attendu: { route: /\/jobs/, mots: /Supprimer/, transfert: false } },
  { id: 'calendrier-creer', question: 'comment je cree une job direct dans le calendrier', attendu: { route: /\/calendar/, mots: /Créer/, transfert: false } },
  { id: 'repartition-map', question: "c'est où que je vois mes gars sur la map en temps réel", attendu: { route: /\/dispatch/, mots: /répartition/i, transfert: false } },
  { id: 'clients-archiver', question: "mon client a fermé sa shop, comment je l'archive", attendu: { route: /\/clients/, mots: /Archiver/, transfert: false } },
  { id: 'demandes-convertir', question: "j'ai recu une demande par mon formulaire, comment je la change en soumission", attendu: { route: /\/requests/, mots: /Convertir en devis/, transfert: false } },
  { id: 'devis-modele', question: 'comment je fais un modèle de soumission pour pas tout retaper à chaque fois', attendu: { route: /\/quotes\/(presets|templates)/, mots: /Nouveau modèle/, transfert: false } },
  { id: 'devis-mesure', question: 'est-ce que je peux mesurer le terrain sur une carte pour ma soumission', attendu: { route: /\/quotes(\/:id)?\/measure/, mots: /Envoyer au devis|Terminer|Rechercher une adresse/, transfert: false } },
  { id: 'devis-depot', question: "je veux demander un dépot de 30% sur mes soumissions, c'est où", attendu: { route: /\/quotes/, mots: /dépôt/i, transfert: false } },
  { id: 'messages-texto', question: "comment j'envoie un texto a un client", attendu: { route: /\/messages/, mots: /Nouveau message/, transfert: false } },
  // ── Argent ──
  { id: 'factures-creer', question: 'comment je fais une facture', attendu: { route: /\/invoices\/new|\/finances|\/quotes/, mots: /Nouvelle facture|Convertir en facture/, transfert: false } },
  { id: 'factures-payee', question: "mon client m'a payé cash, comment je marque sa facture payée", attendu: { route: /\/finances|\/invoices/, mots: /Marquer payée/, transfert: false } },
  { id: 'finances-paiements', question: "c'est où que je vois tous les paiements que j'ai recus ce mois-ci", attendu: { route: /\/finances/, mots: /Paiements/, transfert: false } },
  { id: 'finances-versements', question: "c'est où que je vois quand l'argent rentre dans mon compte de banque", attendu: { route: /\/finances/, mots: /Versements/, transfert: false } },
  { id: 'finances-csv', question: 'je veux sortir mes factures en csv pour mon comptable', attendu: { route: /\/finances/, mots: /CSV/, transfert: false } },
  { id: 'payments-interrupteurs', question: 'je veux fermer le paiement en ligne sur les devis mais le garder sur les factures', attendu: { route: /\/settings\/payments/, transfert: false } },
  { id: 'payments-pourboires', question: 'est-ce que mes clients peuvent laisser un pourboire quand ils paient leur facture', attendu: { route: /\/settings\/payments/, transfert: false } },
  { id: 'payments-instantanes', question: "je peux tu recevoir mon argent le jour meme au lieu d'attendre le versement", attendu: { route: /\/settings\/payments|\/finances/, transfert: false } },
  { id: 'payments-litiges', question: 'un client a contesté un paiement sur sa carte, je fais quoi', attendu: { transfert: 'tolere' } },
  { id: 'payments-rappels', question: "comment j'active les rappels automatiques pour les factures en retard", attendu: { route: /\/settings\/payments|\/automations/, mots: /rappel|relance/i, transfert: false } },
  { id: 'taxes-region', question: "comment j'ajoute la TPS pis la TVQ sur mes factures", attendu: { route: /\/settings\/taxes/, mots: /Ajouter une région/, transfert: false } },
  // Un changement de forfait est aussi un motif de transfert dans le prompt : toléré.
  { id: 'forfait-changer', question: 'je veux monter de forfait, je fais ça où', attendu: { route: /\/settings\/billing/, mots: /Changer ou rétrograder mon plan|Voir tous les plans|Passer à/, transfert: 'tolere' } },
  { id: 'commissions-voir', question: "c'est où que je vois mes commissions du mois", attendu: { route: /\/commissions/, mots: /Mes commissions/, transfert: false } },
  { id: 'paie-export', question: 'comment je sors la paie de mes gars en fichier pour mon comptable', attendu: { route: /\/settings\/payroll/, mots: /Exporter/, transfert: false } },
  // ── Équipe & temps ──
  { id: 'membres-inviter', question: "comment j'ajoute un nouvel employé dans lume", attendu: { route: /\/settings\/team/, mots: /Inviter un membre/, transfert: false } },
  { id: 'roles-permissions', question: 'je veux pas que mes techniciens voient les factures, je fais comment', attendu: { route: /\/settings\/roles/, mots: /permission/i, transfert: false } },
  { id: 'temps-approuver', question: "comment j'approuve les heures de mes gars pour la semaine", attendu: { route: /\/timesheets/, mots: /Approuver/, transfert: false } },
  { id: 'gps-activer', question: "je veux voir où sont mes trucks, comment j'active le gps", attendu: { route: /\/settings\/location/, mots: /GPS/i, transfert: false } },
  { id: 'formations-creer', question: 'comment je fais une formation pour mes nouveaux employés', attendu: { route: /\/courses/, mots: /Créer une formation/, transfert: false } },
  // ── Vente terrain ──
  { id: 'terrain-pin', question: "comment j'ajoute une adresse sur la map de porte a porte", attendu: { route: /\/field-sales/, mots: /Ajouter un pin/, transfert: false } },
  { id: 'terrain-pipeline', question: "comment je change l'étape d'un deal dans le pipeline", attendu: { route: /\/pipeline|\/ventes/, mots: /glisser/i, transfert: false } },
  { id: 'terrain-classement', question: 'je veux voir le classement de mes reps pour le mois passé', attendu: { route: /\/leaderboard/, mots: /Changer/, transfert: false } },
  { id: 'terrain-rapports', question: "c'est où les rapports de vente terrain de la semaine", attendu: { route: /\/d2d-reports/, mots: /hebdomadaire|semaine/i, transfert: false } },
  { id: 'stats-revenus', question: 'je veux voir mes revenus des 12 derniers mois', attendu: { route: /\/insights/, mots: /12 derniers mois/, transfert: false } },
  // ── Réglages ──
  { id: 'profil-langue', question: "comment je mets l'app en anglais", attendu: { route: /\/settings\/profile/, mots: /English|Langue de l'interface/, transfert: false } },
  { id: 'entreprise-logo', question: 'je veux mettre mon logo sur mes factures', attendu: { route: /\/settings\/company/, mots: /logo/i, transfert: false } },
  { id: 'bureaux-nouveau', question: "j'ouvre une 2e succursale, comment j'ajoute un bureau", attendu: { route: /\/settings\/offices/, mots: /Nouveau bureau/, transfert: false } },
  { id: 'produits-service', question: "comment j'ajoute un service avec son prix", attendu: { route: /\/settings\/products/, mots: /Nouveau service/, transfert: false } },
  { id: 'automatisations-pause', question: 'comment je mets en pause une automatisation qui envoie trop de courriels', attendu: { route: /\/automations/, mots: /Désactiver|interrupteur/i, transfert: false } },
  { id: 'avis-google', question: 'comment je demande un avis google apres une job', attendu: { route: /\/settings\/reviews/, mots: /avis/i, transfert: false } },
  { id: 'formulaire-site', question: 'comment je mets le formulaire de demande sur mon site web', attendu: { route: /\/settings\/request-form/, mots: /code/i, transfert: false } },
  { id: 'securite-2fa', question: "c'est quoi le code qr qu'il me demande quand j'invite quelqu'un", attendu: { mots: /Google Authenticator|6 chiffres|QR/i, transfert: false } },
  { id: 'connexion-mdp', question: "j'ai oublié mon mot de passe pis je rentre pu", attendu: { route: /\/auth|\/reset-password/, mots: /Mot de passe oublié/, transfert: false } },
  // Les pages reçues par le client n'ont pas de route dans l'app : on attend le mécanisme, pas une route.
  { id: 'pages-clients-devis', question: "mon client recoit quoi quand j'envoie une soumission", attendu: { mots: /approuver|signer|téléphone|sans (avoir à créer de )?compte/i, transfert: false } },
  // ── Hors « comment faire » ──
  { id: 'hors-lume', question: 'est-ce que je peux déduire mon camion dans mes impots', attendu: { mots: /hors|extérieur|pas .{0,40}(Lume|CRM)|comptable|ne (concerne|couvre|relève) pas/i, transfert: false } },
  // Le forfait attendu est lu dans la base au lancement (voir `attenduDe`).
  { id: 'compte-forfait', question: "c'est quoi mon forfait pis ça se renouvelle quand", attendu: { transfert: false } },
  { id: 'compte-paiements', question: 'est-ce que lume payments est déja branché sur mon compte', attendu: { transfert: false } },
  { id: 'ambigu-taches', question: 'comment je supprime toutes mes taches de la semaine passée', attendu: { mots: /(tâche[\s\S]*(job|travau))|((job|travau)[\s\S]*tâche)|précis|voulez-vous dire|parlez-vous|s'agit-il/i, transfert: false } },
];

/** L'attente d'un cas, avec ce que la base dit du bureau (son forfait). */
export function attenduDe(c: CasKb, forfait: string | null): AttenduKb {
  if (c.id !== 'compte-forfait') return c.attendu;
  return forfait ? { transfert: false, mots: new RegExp(forfait.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } : { transfert: 'tolere', mots: /abonnement/i };
}

const decrire = (a: AttenduKb): string => [
  a.route ? `la route ${a.route.source}` : '', a.mots ? `le libellé ${a.mots.source}` : '',
  a.transfert === false ? 'sans transfert à un humain' : a.transfert === true ? 'avec transfert à un humain' : 'transfert toléré',
].filter(Boolean).join(', ');

export const kb: Famille = {
  nom: 'kb',
  titre: '1. Base de connaissances (« comment faire »)',
  prouve: 'Le support répond à partir de sa documentation : il cite la bonne page de l’app (route) et le libellé exact du bouton, ne passe pas un « comment faire » à l’équipe, vouvoie, et ne laisse aucun statut anglais brut.',
  tests: CAS_KB.map((c) => ({
    id: `kb.${c.id}`,
    titre: `« ${c.question} »`,
    fait: `Un utilisateur pose la question telle quelle au chat de support ; on attend ${decrire(c.attendu)}${c.id === 'compte-forfait' ? ', et le nom du forfait du bureau (lu dans la base)' : ''}.`,
    si_defaut: 'La route ou le libellé manquerait, le ticket serait escaladé, ou la réponse tutoierait le client / laisserait un statut anglais brut.',
    appels: 1,
    question: c.question,
    executer: (ctx: Contexte, s) => unTour(ctx.poser, s, `kb.${c.id}`, c.question, (o) => jugerKb(o, attenduDe(c, ctx.forfait))),
  })),
};
