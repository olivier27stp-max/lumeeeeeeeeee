/**
 * Exemples — famille 3 : le support et les alertes internes (voix Lume), plus
 * le courriel libre d'un membre à un client (voix entreprise). Données
 * inventées, aucune base. Les vrais envois passent par
 * server/lib/support/tickets.ts, server/routes/request-forms.ts,
 * server/lib/scheduled-reports.ts, server/lib/security-alerting.ts,
 * server/routes/lumi.ts et server/routes/communications.ts — ici on rend les
 * mêmes gabarits, aux mêmes formes.
 */
import { rendreCourrielClient, rendreCourrielLume, montant, echapper, type Marque } from '../../../server/lib/courriels/gabarit';
import type { Exemple } from './clients.mts';

const marque: Marque = {
  nom: 'Vision Lavage', logoUrl: null, couleur: '#0f766e', email: 'info@visionlavage.ca', telephone: '514 555-0199',
  adresse: '12 rue Principale, Laval (Québec) H7L 1A1', siteWeb: 'visionlavage.ca', liensSociaux: null, lignesTaxes: null,
};
const m = (c: number) => montant(c, 'CAD', 'fr');
const texteHtml = (s: string) => echapper(s).replace(/\r?\n/g, '<br/>');
const lignesTicket = (motif?: string) => [
  { libelle: 'Entreprise', valeur: 'Vision Lavage', fort: true },
  { libelle: 'Personne', valeur: 'Rafba Test <rafba@visionlavage.ca>' },
  { libelle: 'Forfait', valeur: 'Pro · prioritaire' },
  { libelle: 'Réponse attendue', valeur: '1 jour ouvrable' },
  { libelle: 'Catégorie', valeur: 'Facturation' },
  ...(motif ? [{ libelle: 'Motif', valeur: motif }] : []),
  { libelle: 'Ticket', valeur: '7f3c2a10-5b1e-4c7d-9a2e-0d4f6b8c1e2a' },
];
const conversation = [
  { qui: 'Rafba Test', quoi: 'Bonjour, la facture 40 est partie deux fois chez mon client. Je fais quoi ?' },
  { qui: 'Assistant', quoi: 'Je vois deux envois à 14 h 02 et 14 h 03. Je passe la main à un humain pour vérifier avec vous.' },
].map((x) => `<p style="margin:0 0 12px;"><strong>${echapper(x.qui)}</strong><br/>${texteHtml(x.quoi)}</p>`).join('');

export const EXEMPLES: Exemple[] = [
  { nom: 'support-reponse-client', de: 'Lume', sujet: 'Re: Facture envoyée deux fois', html: rendreCourrielLume({
    langue: 'fr', preheader: 'Bonjour Rafba, c’est réglé : le deuxième envoi a été annulé…', titre: 'Réponse du support', salutation: 'Bonjour Rafba,',
    intro: 'Rafba, du support Lume, te répond au sujet de « Facture envoyée deux fois » :',
    corpsHtml: `<p style="margin:0;padding:14px 16px;background:#f9fafb;border-left:3px solid #111827;border-radius:6px;">${texteHtml('Bonjour Rafba, c’est réglé : le deuxième envoi a été annulé et ton client n’a reçu qu’un seul courriel actif.\n\nSi tu veux, je peux aussi activer l’anti double-clic sur ton compte.')}</p>`,
    bouton: { texte: 'Répondre dans Lume', url: 'https://lumecrm.net/support?ticket=7f3c2a10' },
    note: 'Tu peux aussi répondre directement à ce courriel.', supportEmail: 'support@lumecrm.net',
  }) },
  { nom: 'support-escalade-interne', de: 'Lume', sujet: '[PRIORITY · Pro] Facture envoyée deux fois', html: rendreCourrielLume({
    langue: 'fr', preheader: 'Vision Lavage · Pro — Facture envoyée deux fois', titre: 'Demande de support prioritaire',
    intro: 'Un client attend un humain. Répondre à ce courriel répond directement au client.',
    lignes: lignesTicket('Le client demande un humain'),
    corpsHtml: `<p style="margin:0 0 12px;font-weight:700;">Facture envoyée deux fois</p>${conversation}`, signature: null,
  }) },
  { nom: 'support-message-client-relaye', de: 'Lume', sujet: 'Re: [PRIORITY · Pro] Facture envoyée deux fois', html: rendreCourrielLume({
    langue: 'fr', preheader: 'Rafba Test — Merci ! Et pour les rappels automatiques, ça reste actif ?', titre: 'Nouveau message du client',
    intro: 'Rafba Test a écrit dans la conversation « Facture envoyée deux fois ». Répondre à ce courriel répond directement au client.',
    lignes: lignesTicket(),
    corpsHtml: `<p style="margin:0;"><strong>Rafba Test</strong><br/>${texteHtml('Merci ! Et pour les rappels automatiques, ça reste actif ?')}</p>`, signature: null,
  }) },
  { nom: 'formulaire-nouvelle-demande', de: 'Lume', sujet: 'Nouvelle demande de Marie Tremblay', html: rendreCourrielLume({
    langue: 'fr', preheader: 'Marie Tremblay — marie@exemple.ca · 450 555-0142', titre: 'Nouvelle demande reçue',
    intro: 'Marie Tremblay vient de remplir ton formulaire public. La demande est déjà dans Lume.',
    lignes: [
      { libelle: 'Nom', valeur: 'Marie Tremblay', fort: true }, { libelle: 'Courriel', valeur: 'marie@exemple.ca' },
      { libelle: 'Téléphone', valeur: '450 555-0142' }, { libelle: 'Adresse', valeur: '88 rue des Érables, Boisbriand, QC, J7G 1A1' },
    ],
    corpsHtml: `<p style="margin:0 0 6px;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#6b7280;font-weight:600;">Message</p><p style="margin:0;padding:14px 16px;background:#f9fafb;border-left:3px solid #111827;border-radius:6px;">${texteHtml('Bonjour, j’aimerais un lavage de vitres extérieur pour une maison à deux étages.\nDisponible les samedis.')}</p>`,
    bouton: { texte: 'Voir la demande', url: 'https://lumecrm.net/requests' }, signature: null,
  }) },
  { nom: 'rapport-hebdomadaire', de: 'Lume', sujet: 'Ton rapport hebdomadaire — Vision Lavage', html: rendreCourrielLume({
    langue: 'fr', preheader: `Vision Lavage — ${m(1284500)} de revenus, 14 nouveaux prospects, 9 nouveaux travaux`, titre: 'Ton rapport hebdomadaire',
    intro: 'Voici où en est Vision Lavage (du 8 septembre 2026 au 14 septembre 2026).',
    montant: { libelle: 'Revenus encaissés', valeur: m(1284500), sous: `Facturé : ${m(1512000)}` },
    lignes: [
      { libelle: 'Nouveaux prospects', valeur: '14' }, { libelle: 'Nouveaux travaux', valeur: '9' },
      { libelle: 'Taux de conversion', valeur: '35,7 %' }, { libelle: 'Solde impayé', valeur: m(227500), fort: true },
    ],
    corpsHtml: `<p style="margin:0 0 20px;padding:12px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:14px;"><strong style="color:#dc2626;">2 clients à risque de départ</strong> — sans travaux depuis longtemps ; un appel vaut la peine.</p><p style="margin:0 0 6px;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#6b7280;font-weight:600;">Meilleurs clients</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${[['Condos du Parc', 412000], ['Boulangerie Lafleur', 268500], ['Marie Tremblay', 98000]].map(([n, c], i) => `<tr><td style="padding:8px 0;font-size:14px;color:#374151;${i ? 'border-top:1px solid #e5e7eb;' : ''}">${echapper(n)}</td><td align="right" style="padding:8px 0;font-size:14px;font-weight:600;color:#111827;${i ? 'border-top:1px solid #e5e7eb;' : ''}">${m(Number(c))}</td></tr>`).join('')}</table>`,
    bouton: { texte: 'Ouvrir Lume', url: 'https://lumecrm.net/insights' },
    note: 'Tu reçois ce rapport parce qu’il est programmé dans Lume. Pour changer sa fréquence ou l’arrêter, demande-le à Lumi.',
  }) },
  { nom: 'securite-alerte', de: 'Lume', sujet: '[Lume] 2 évènement(s) de sécurité — critical', html: rendreCourrielLume({
    langue: 'fr', preheader: '2 évènement(s) high/critical non résolus — invariant_violation', titre: '2 évènements de sécurité',
    intro: 'Sévérité high ou critical, non résolus, depuis le dernier passage. Le détail complet est dans security_events.',
    lignes: [{ libelle: 'Critiques', valeur: '1', fort: true }, { libelle: 'Élevés (high)', valeur: '1' }, { libelle: 'Le plus récent', valeur: '2026-09-17 03:10:42 UTC' }],
    corpsHtml: [
      { s: 'critical', t: 'invariant_violation', src: 'nightly_probe', q: '2026-09-17 03:10:42', d: '{"table":"invoices","orphans":3}' },
      { s: 'high', t: 'auth_failed_burst', src: 'auth', q: '2026-09-17 02:58:07', d: '{"ip":"203.0.113.9","attempts":42}' },
    ].map((e, i) => `<p style="margin:0;padding:12px 0;${i ? 'border-top:1px solid #e5e7eb;' : ''}"><strong style="color:${e.s === 'critical' ? '#dc2626' : '#111827'};">${e.s}</strong> &nbsp;·&nbsp; ${e.t} &nbsp;·&nbsp; <span style="color:#6b7280;">${e.src}</span><br/><span style="font-size:12px;color:#6b7280;">${e.q} UTC</span><br/><span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:#374151;word-break:break-all;">${echapper(e.d)}</span></p>`).join(''),
    signature: null,
  }) },
  { nom: 'lumi-budget-alerte', de: 'Lume', sujet: 'Lumi · Vision Lavage a dépensé 12,00 $ ce mois-ci (pro)', html: rendreCourrielLume({
    langue: 'fr', titre: 'Budget Lumi', preheader: 'Lumi · Vision Lavage a dépensé 12,00 $ ce mois-ci (pro)',
    corpsHtml: texteHtml('L\'entreprise Vision Lavage a atteint 12,00 $ d\'inférence Lumi sur un plafond de 20,00 $ (pro).\nElle passe en mode économe (modèle moins cher). À 20,00 $, Lumi se met en pause jusqu\'au 1er.\nRegarde si c\'est un usage réel (proposer Autopilot / un supplément) ou un abus (script, boucle).'),
    signature: null,
  }) },
  { nom: 'courriel-libre-entreprise', de: 'Vision Lavage', sujet: 'Suite à notre appel de ce matin', html: rendreCourrielClient({
    langue: 'fr', marque, signature: null,
    corpsHtml: `<p style="margin:0;white-space:pre-wrap;">${texteHtml('Bonjour Madame Tremblay,\n\nComme convenu au téléphone, nous passerons samedi le 26 septembre en avant-midi pour le lavage des vitres extérieures. Aucune préparation n’est nécessaire de votre côté.\n\nBonne journée,\nRafba — Vision Lavage')}</p>`,
  }) },
];
