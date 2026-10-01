/**
 * Famille 3 — Fonctions qui N'EXISTENT PAS.
 * Chaque fonction ci-dessous a été cherchée dans le code (src/, server/) et dans la
 * documentation que le support consulte (pages Fonctionnalités, carte de l'app, FAQ) avant
 * d'être retenue ; `preuve` dit ce que la recherche a rendu. Un test statique
 * (tests/lumi-support-jugement.test.ts) refait la recherche dans la documentation : le jour
 * où le produit ajoute la fonction, il tombe, et le cas doit être retiré.
 *
 * Aucune de ces questions ne parle d'importer ou de transférer des données : l'outil de
 * migration du support (start_migration) ne doit jamais être déclenché par la batterie.
 */
import { jugerInexistant } from '../jugement.mts';
import { unTour } from '../tour.mts';
import type { Famille } from '../types.mts';

export interface FonctionAbsente {
  id: string;
  question: string;
  /** Les phrases de la réponse qui nomment la fonction (ce sont elles que le juge lit, avec la première). */
  sujet: RegExp;
  /** Ce qui ne doit se trouver NI dans la doc du support NI dans le code de l'app. */
  absent: RegExp;
  /** Ce que la recherche dans le code a rendu, le jour où le cas a été écrit (2026-10-01). */
  preuve: string;
}

export const FONCTIONS_ABSENTES: FonctionAbsente[] = [
  {
    id: 'android-play-store', question: "Est-ce que je peux télécharger l'application Lume sur le Play Store pour mon téléphone Android ?",
    sujet: /android|play store|google play|application mobile|app mobile/i, absent: /play store|google play/i,
    preuve: 'Aucune mention du Play Store ni de Google Play dans src/ et server/ ; src/pages/MobileAppGate.tsx : LIENS_APP.android = null ; la FAQ « mobile » dit que l’application mobile est en bêta fermée et n’est pas encore publiée.',
  },
  {
    id: 'whatsapp', question: 'Est-ce que je peux envoyer des messages WhatsApp à mes clients à partir de Lume ?',
    sujet: /whatsapp/i, absent: /whatsapp/i,
    preuve: '« whatsapp » : une seule occurrence dans src/ et server/, la liste des robots d’aperçu de lien (server/lib/vuesSoumission.ts). Aucun canal, aucune intégration.',
  },
  {
    id: 'xero', question: 'Est-ce que Lume se connecte à mon logiciel comptable Xero ?',
    sujet: /xero/i, absent: /xero/i,
    preuve: '« xero » : aucune occurrence dans src/, server/, docs/ ni supabase/migrations/. La seule comptabilité branchée est QuickBooks.',
  },
  {
    id: 'docusign', question: "Je fais signer mes contrats avec DocuSign : est-ce que Lume s'intègre avec DocuSign ?",
    sujet: /docusign/i, absent: /docusign/i,
    preuve: '« docusign » : aucune occurrence dans src/, server/, docs/ ni supabase/migrations/. Lume a sa propre signature de contrat (/contract/:token), pas d’intégration.',
  },
  {
    id: 'cartes-cadeaux', question: 'Est-ce que je peux vendre des cartes-cadeaux à mes clients avec Lume ?',
    sujet: /cartes?[- ]cadeaux?|gift ?cards?/i, absent: /cartes?[- ]cadeaux?|gift ?cards?/i,
    preuve: '« carte-cadeau », « cartes-cadeaux », « gift card » : aucune occurrence dans src/, server/, docs/ ni supabase/migrations/.',
  },
  {
    id: 'espagnol', question: "Est-ce que je peux mettre l'interface de Lume en espagnol pour mes employés ?",
    sujet: /espagnol|spanish/i, absent: /espagnol|spanish|español/i,
    preuve: '« espagnol », « spanish », « español » : aucune occurrence ; src/i18n/ ne contient que en.ts et fr.ts.',
  },
  {
    id: 'messenger', question: 'Est-ce que je peux recevoir mes messages Facebook Messenger dans la boîte de messages de Lume ?',
    sujet: /messenger/i, absent: /messenger/i,
    preuve: '« messenger » : aucune occurrence dans src/ ni server/. La page Messages ne porte que les textos (et la boîte courriel).',
  },
  {
    id: 'apple-watch', question: "Y a-t-il une application Lume pour l'Apple Watch, pour puncher mes heures au poignet ?",
    sujet: /apple watch|montre/i, absent: /apple watch|watchos/i,
    preuve: '« apple watch », « watchos » : aucune occurrence dans src/ ni server/.',
  },
  {
    id: 'interac-en-ligne', question: 'Est-ce que mes clients peuvent payer leur facture en ligne par virement Interac ?',
    sujet: /interac/i, absent: /interac[^.\n]{0,60}en ligne|en ligne[^.\n]{0,60}interac/i,
    preuve: '« Interac » n’existe que comme mode de paiement saisi À LA MAIN sur une facture (MarkInvoicePaidModal.tsx, reports/helpers.ts, quickbooks/sync.ts, carte de l’app). Le paiement en ligne passe par Stripe en carte et portefeuilles (automatic_payment_methods, allow_redirects: never) : pas de virement Interac en ligne.',
  },
];

export const inexistant: Famille = {
  nom: 'inexistant',
  titre: '3. Fonctions qui n’existent pas',
  prouve: 'Le support ne promet aucune fonction absente du produit : il dit non (ou pas pour l’instant), ou passe à un humain, sans jamais affirmer que la fonction existe.',
  tests: FONCTIONS_ABSENTES.map((f) => ({
    id: `inexistant.${f.id}`,
    titre: `« ${f.question} »`,
    fait: `Un utilisateur demande une fonction qui n’existe pas. Preuve de l’absence : ${f.preuve}`,
    si_defaut: 'La réponse commencerait par « oui », ou présenterait la fonction comme disponible sans aucune réserve.',
    appels: 1,
    question: f.question,
    executer: (ctx, s) => unTour(ctx.poser, s, `inexistant.${f.id}`, f.question, (o) => jugerInexistant(o, f.sujet)),
  })),
};
