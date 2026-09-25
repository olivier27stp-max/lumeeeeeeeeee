/**
 * Exemples — famille 2 : ce que LUME envoie à ses abonnés (abonnement,
 * facturation, parrainage, marketing). Rendus par les mêmes fonctions que les
 * vrais envois ; données inventées, aucune base.
 */
import type { Exemple } from './clients.mts';
import { renderPaymentReceiptEmail, sujetRecuAbonnement } from '../../../server/lib/email-templates/payment-receipt';
import {
  courrielForfaitModifie, courrielAbonnementAnnule, courrielEchecPaiement, courrielRelanceImpaye, courrielAccesSuspendu, courrielAlerteDepart,
} from '../../../server/lib/subscription-email';
import { courrielMoisGratuit } from '../../../server/lib/referral-rewards';
import { courrielDemandeDemo, courrielNouveauLead } from '../../../server/routes/marketing';

const de = 'Lume';
const recu = {
  companyName: 'Vision Lavage', planName: 'Pro', billingPeriod: 'Mensuel', amountPaid: '49,00 $', currency: 'CAD', taxes: '7,34 $', total: '56,34 $',
  paymentDate: '17 septembre 2026', billingEmail: 'rafba@visionlavage.ca', transactionId: 'pi_3Q1abcDEF456ghi7', dashboardUrl: 'https://lumecrm.net', billingUrl: 'https://lumecrm.net/settings/billing',
};
const forfait = courrielForfaitModifie({ planName: 'Croissance', amountCents: 9900, currency: 'CAD', interval: 'monthly', periodEnd: '2026-10-17T12:00:00Z' });
const annule = courrielAbonnementAnnule({ planName: 'Pro', accessUntil: '2026-10-17T12:00:00Z' });
const echec = courrielEchecPaiement({ amountCents: 5634, currency: 'CAD', suspensionLe: '2026-09-24T12:00:00Z' });
const relance = courrielRelanceImpaye({ joursRestants: 4, suspensionLe: '2026-09-24T12:00:00Z' });
const suspendu = courrielAccesSuspendu();
const depart = courrielAlerteDepart({ orgName: 'Vision Lavage', orgId: '3f1c2a8e-4b7d-4e2a-9c1d-6a5b4c3d2e1f', planName: 'Pro', feedback: 'too_expensive', comment: 'On ferme pour l’hiver, on revient au printemps.' });
const parrainage = courrielMoisGratuit({ mode: 'credit', cents: 4900, currency: 'CAD' });
const demande = { reference: 'LUM-M2K9F3', full_name: 'Rafba Test', company_name: 'Vision Lavage', email: 'beatsafterimage@gmail.com', phone: '514 555-0100', industry: 'window_cleaning' as const, employee_count: '2 à 5', source: 'Google', availability: 'Le matin, en semaine', message: 'On fait surtout du résidentiel.\nOn aimerait automatiser les rappels.', referral_code: null };
const demo = courrielDemandeDemo(demande, 'ventes@lumecrm.net');
const lead = courrielNouveauLead(demande, { recuLe: '17 septembre 2026 à 09 h 12', ip: '203.0.113.7', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)' });

export const EXEMPLES: Exemple[] = [
  { nom: 'abonnement-recu', sujet: sujetRecuAbonnement(recu.planName), html: renderPaymentReceiptEmail(recu), de },
  { nom: 'abonnement-forfait-modifie', sujet: forfait.sujet, html: forfait.html, de },
  { nom: 'abonnement-annule', sujet: annule.sujet, html: annule.html, de },
  { nom: 'abonnement-paiement-echoue', sujet: echec.sujet, html: echec.html, de },
  { nom: 'abonnement-relance-impaye', sujet: relance.sujet, html: relance.html, de },
  { nom: 'abonnement-acces-suspendu', sujet: suspendu.sujet, html: suspendu.html, de },
  { nom: 'abonnement-alerte-depart', sujet: depart.sujet, html: depart.html, de },
  { nom: 'abonnement-parrainage-mois-gratuit', sujet: parrainage.sujet, html: parrainage.html, de },
  { nom: 'abonnement-demande-demo', sujet: demo.sujet, html: demo.html, de },
  { nom: 'abonnement-nouveau-lead', sujet: lead.sujet, html: lead.html, de },
];
