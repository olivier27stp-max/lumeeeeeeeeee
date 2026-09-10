/**
 * Page Tarifs publique.
 *
 * Structure (maquette validée le 2026-09-10) :
 *  1. Titre + bascule Mensuel / Annuel.
 *  2. Trois cartes emboîtées (« Tout Minimum, plus », « Tout Scale, plus »).
 *  3. Suppléments + « Tous les forfaits incluent ».
 *  4. Trouveur : taille d'équipe + besoins cochés → forfait recommandé et son
 *     prix réel. Il est relié au reste de la page : étiquette « Recommandé
 *     pour vous » sur la carte, lignes cochées surlignées et colonne
 *     recommandée teintée dans la comparaison complète.
 *  5. Comparaison complète des 39 fonctions, repliée par défaut.
 *  6. FAQ.
 * Prix par devise selon la région choisie dans l'en-tête (useRegion).
 */
import { motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import BookDemoForm from '../../components/marketing/BookDemoForm';
import { useTranslation } from '../../i18n';
import { useRegion } from '../../hooks/useRegion';
import { usePageMeta } from '../../hooks/usePageMeta';
import type { Language } from '../../i18n';

// Copie bilingue locale — les dictionnaires i18n globaux ne couvrent pas ces
// clés et ne doivent pas être modifiés d'ici.
type Bi = Record<Language, string>;

interface Plan {
  name: string;
  slug: string;
  /** L'étape de vie de l'entreprise que le forfait adresse — affichée au-dessus du nom. */
  stage: Bi;
  users: Bi;
  extraUserPrice: Bi;
  offices: Bi;
  extraOfficePrice?: Bi;
  /** Prix par devise (source : table `plans` en prod, colonnes *_cad / *_usd). */
  prices: Record<'CAD' | 'USD', { monthly: number; annualFullYr: number; annualFirstYr: number; extraUser: number; extraOffice: number }>;
  badge?: Bi;
  desc: Bi;
  cta: Bi;
  featured: boolean;
  /** Utilisateurs et bureaux inclus (chiffres, pour le calcul du trouveur). */
  seats: { users: number; offices: number };
  /** Titre de la liste courte : « Inclus » / « Tout Minimum, plus ». */
  inherits: Bi;
  /** Six lignes qui résument le forfait sur sa carte. */
  highlights: Bi[];
}

const PLANS: Plan[] = [
  {
    name: 'Minimum',
    slug: 'starter',
    stage: { en: 'Getting started', fr: 'Je démarre' },
    users: { en: 'Includes 3 users', fr: '3 utilisateurs inclus' },
    extraUserPrice: { en: '+{x}/extra user/mo', fr: '+{x}/utilisateur suppl./mois' },
    offices: { en: '1 office', fr: '1 bureau' },
    extraOfficePrice: { en: '+{x}/extra office', fr: '+{x}/bureau suppl.' },
    prices: { CAD: { monthly: 150, annualFullYr: 1530, annualFirstYr: 1300, extraUser: 35, extraOffice: 100 }, USD: { monthly: 110, annualFullYr: 1122, annualFirstYr: 954, extraUser: 35, extraOffice: 100 } },
    desc: {
      en: 'Everything you need to run the business solo or with a small crew.',
      fr: 'Tout ce qu\'il faut pour rouler votre entreprise seul ou avec une petite équipe.',
    },
    cta: { en: 'Book a demo', fr: 'Réserver une démo' },
    featured: false,
    seats: { users: 3, offices: 1 },
    inherits: { en: 'Included', fr: 'Inclus' },
    highlights: [
      { en: 'Clients, quotes, e-signatures & contracts', fr: 'Clients, soumissions, signatures et contrats' },
      { en: 'Calendar, jobs & recurring jobs', fr: 'Calendrier, jobs et jobs récurrentes' },
      { en: 'Invoicing & online payments', fr: 'Facturation et paiements en ligne' },
      { en: 'Incoming requests & client portal', fr: 'Demandes entrantes et portail client' },
      { en: 'Client emails & appointment reminders', fr: 'Courriels et rappels de rendez-vous' },
      { en: 'Mobile access, basic finances & reports', fr: 'Accès mobile, finances et rapports de base' },
    ],
  },
  {
    name: 'Scale',
    slug: 'pro',
    stage: { en: 'I have a team', fr: 'J\'ai une équipe' },
    users: { en: 'Includes 10 users', fr: '10 utilisateurs inclus' },
    extraUserPrice: { en: '+{x}/extra user/mo', fr: '+{x}/utilisateur suppl./mois' },
    offices: { en: '2 offices', fr: '2 bureaux' },
    extraOfficePrice: { en: '+{x}/extra office', fr: '+{x}/bureau suppl.' },
    prices: { CAD: { monthly: 340, annualFullYr: 3468, annualFirstYr: 2948, extraUser: 30, extraOffice: 100 }, USD: { monthly: 250, annualFullYr: 2550, annualFirstYr: 2168, extraUser: 30, extraOffice: 100 } },
    badge: { en: 'Most Popular', fr: 'Le plus populaire' },
    desc: {
      en: 'For growing teams — stop being the dispatcher and let the system run the day.',
      fr: 'Pour les équipes en croissance — arrêtez d\'être le répartiteur et laissez le système gérer la journée.',
    },
    cta: { en: 'Book a demo', fr: 'Réserver une démo' },
    featured: true,
    seats: { users: 10, offices: 2 },
    inherits: { en: 'Everything in Minimum, plus', fr: 'Tout Minimum, plus' },
    highlights: [
      { en: 'Two-way SMS & batch messaging', fr: 'Textos bidirectionnels et messages groupés' },
      { en: 'Automations & quote/invoice follow-ups', fr: 'Automatisations et relances de soumissions et factures' },
      { en: 'Dispatch map & live GPS', fr: 'Répartition sur carte et GPS en direct' },
      { en: 'Timesheets, payroll & performance', fr: 'Feuilles de temps, paie et performance' },
      { en: 'Advanced analytics & QuickBooks export', fr: 'Statistiques avancées et export QuickBooks' },
      { en: 'Lumi by text, with a monthly quota', fr: 'Lumi par texte, avec quota mensuel' },
    ],
  },
  {
    name: 'Autopilot',
    slug: 'autopilot',
    stage: { en: 'Runs without me', fr: 'Ça roule sans moi' },
    users: { en: 'Includes 20 users', fr: '20 utilisateurs inclus' },
    extraUserPrice: { en: '+{x}/extra user/mo', fr: '+{x}/utilisateur suppl./mois' },
    offices: { en: '5 offices', fr: '5 bureaux' },
    extraOfficePrice: { en: '+{x}/extra office', fr: '+{x}/bureau suppl.' },
    prices: { CAD: { monthly: 495, annualFullYr: 5049, annualFirstYr: 4292, extraUser: 25, extraOffice: 100 }, USD: { monthly: 360, annualFullYr: 3672, annualFirstYr: 3121, extraUser: 25, extraOffice: 100 } },
    desc: {
      en: 'For businesses that grow without the owner — AI, sales teams and full control.',
      fr: 'Pour les entreprises qui grandissent sans le propriétaire — IA, équipes de vente et contrôle complet.',
    },
    cta: { en: 'Book a demo', fr: 'Réserver une démo' },
    featured: false,
    seats: { users: 20, offices: 5 },
    inherits: { en: 'Everything in Scale, plus', fr: 'Tout Scale, plus' },
    highlights: [
      { en: 'Lumi on the phone and by text, unlimited', fr: 'Lumi au téléphone et par texte, illimité' },
      { en: 'Door-to-door: pipeline, commissions, leaderboard', fr: 'Porte-à-porte : pipeline, commissions, leaderboard' },
      { en: 'Team courses (LMS)', fr: 'Formations de l\'équipe (LMS)' },
      { en: 'Advanced roles, multi-team & availability', fr: 'Rôles avancés, multi-équipes et disponibilités' },
      { en: 'Automated satisfaction surveys', fr: 'Sondages de satisfaction automatisés' },
      { en: 'API, marketplace & premium support', fr: 'API, marketplace et soutien prioritaire' },
    ],
  },
];

// ── Tableau comparatif ────────────────────────────────────────────
// `true` = inclus, `false` = non inclus, un objet Bi = texte (ex. quota).
type Cell = boolean | Bi;
interface CompareRow { label: Bi; cells: [Cell, Cell, Cell] }
interface CompareGroup { title: Bi; rows: CompareRow[] }

const COMPARISON: CompareGroup[] = [
  {
    title: { en: 'Core CRM', fr: 'Cœur du CRM' },
    rows: [
      { label: { en: 'Dashboard & global search', fr: 'Tableau de bord et recherche globale' }, cells: [true, true, true] },
      { label: { en: 'Clients, notes, history & archives', fr: 'Clients, notes, historique et archives' }, cells: [true, true, true] },
      { label: { en: 'Incoming requests', fr: 'Demandes entrantes' }, cells: [true, true, true] },
      { label: { en: 'Quotes, invoicing, e-signatures & contracts', fr: 'Soumissions, facturation, signatures et contrats' }, cells: [true, true, true] },
      { label: { en: 'Products, services & taxes', fr: 'Produits, services et taxes' }, cells: [true, true, true] },
      { label: { en: 'Online payments (Stripe & PayPal)', fr: 'Paiements en ligne (Stripe et PayPal)' }, cells: [true, true, true] },
      { label: { en: 'Jobs, calendar, day view & tasks', fr: 'Jobs, calendrier, vue Jour et tâches' }, cells: [true, true, true] },
      { label: { en: 'Recurring jobs', fr: 'Jobs récurrentes' }, cells: [true, true, true] },
      { label: { en: 'Client emails & appointment reminders', fr: 'Courriels clients et rappels de rendez-vous' }, cells: [true, true, true] },
      { label: { en: 'Client portal', fr: 'Portail client' }, cells: [true, true, true] },
      { label: { en: 'Basic finances & reporting', fr: 'Finances et rapports de base' }, cells: [true, true, true] },
      { label: { en: 'Mobile access', fr: 'Accès mobile' }, cells: [true, true, true] },
      { label: { en: 'Referral program', fr: 'Programme de parrainage' }, cells: [true, true, true] },
    ],
  },
  {
    title: { en: 'Team & operations', fr: 'Équipe et opérations' },
    rows: [
      { label: { en: 'Two-way SMS with a dedicated number', fr: 'Textos bidirectionnels avec numéro dédié' }, cells: [false, true, true] },
      { label: { en: 'Batch messaging', fr: 'Messages groupés' }, cells: [false, true, true] },
      { label: { en: 'Automations & quote/invoice follow-ups', fr: 'Automatisations et relances de soumissions et factures' }, cells: [false, true, true] },
      { label: { en: 'Custom request forms', fr: 'Formulaires de demande personnalisés' }, cells: [false, true, true] },
      { label: { en: 'Employee timesheets & payroll', fr: 'Feuilles de temps et paie' }, cells: [false, true, true] },
      { label: { en: 'Dispatch map & live GPS', fr: 'Carte de répartition et GPS en direct' }, cells: [false, true, true] },
      { label: { en: 'Checklists & checklist templates', fr: 'Listes de vérification et modèles' }, cells: [false, true, true] },
      { label: { en: 'Internal team chat', fr: 'Clavardage d\'équipe interne' }, cells: [false, true, true] },
      { label: { en: 'Quote templates, presets & satellite measure tool', fr: 'Modèles de soumission, préréglages et mesure satellite' }, cells: [false, true, true] },
      { label: { en: 'Employee performance tracking', fr: 'Suivi de la performance des employés' }, cells: [false, true, true] },
      { label: { en: 'Insights & advanced analytics', fr: 'Insights et statistiques avancées' }, cells: [false, true, true] },
      { label: { en: 'QuickBooks export', fr: 'Exportation QuickBooks' }, cells: [false, true, true] },
      { label: { en: 'Webhooks', fr: 'Webhooks' }, cells: [false, true, true] },
    ],
  },
  {
    title: { en: 'Artificial intelligence', fr: 'Intelligence artificielle' },
    rows: [
      { label: { en: 'Lume AI Agent — text', fr: 'Agent IA Lume — texte' }, cells: [false, { en: 'Monthly quota', fr: 'Quota mensuel' }, { en: 'Unlimited', fr: 'Illimité' }] },
      { label: { en: 'Lume AI Agent — voice', fr: 'Agent IA Lume — voix' }, cells: [false, false, { en: 'Unlimited', fr: 'Illimité' }] },
    ],
  },
  {
    title: { en: 'Growth & control', fr: 'Croissance et contrôle' },
    rows: [
      { label: { en: 'Door-to-door: map, pipeline, leaderboard, commissions, reports', fr: 'Porte-à-porte : carte, pipeline, leaderboard, commissions, rapports' }, cells: [false, false, true] },
      { label: { en: 'Courses / LMS', fr: 'Formations / LMS' }, cells: [false, false, true] },
      { label: { en: 'Full API access', fr: 'Accès complet à l\'API' }, cells: [false, false, true] },
      { label: { en: 'Integrations marketplace', fr: 'Marketplace d\'intégrations' }, cells: [false, false, true] },
      { label: { en: 'Advanced roles & permissions', fr: 'Rôles et permissions avancés' }, cells: [false, false, true] },
      { label: { en: 'Multi-team management', fr: 'Gestion multi-équipes' }, cells: [false, false, true] },
      { label: { en: 'Team availability management', fr: 'Gestion des disponibilités' }, cells: [false, false, true] },
      { label: { en: 'Automated satisfaction surveys', fr: 'Sondages de satisfaction automatisés' }, cells: [false, false, true] },
    ],
  },
  {
    title: { en: 'Support', fr: 'Accompagnement' },
    rows: [
      { label: { en: 'Standard support', fr: 'Soutien standard' }, cells: [true, true, true] },
      { label: { en: 'Premium support', fr: 'Soutien prioritaire' }, cells: [false, false, true] },
      { label: { en: 'Dedicated onboarding specialist', fr: 'Spécialiste d\'intégration dédié' }, cells: [false, false, true] },
    ],
  },
];

const FAQS: { q: Bi; a: Bi }[] = [
  {
    q: { en: 'Is there a commitment?', fr: 'Y a-t-il un engagement ?' },
    a: {
      en: 'Monthly plans have no commitment — cancel anytime. Annual plans are a one-year commitment, billed upfront at a 15% discount.',
      fr: 'Les forfaits mensuels sont sans engagement — annulez en tout temps. Les forfaits annuels représentent un engagement d\'un an, facturé d\'avance avec un rabais de 15 %.',
    },
  },
  {
    q: { en: 'Can I switch plans?', fr: 'Puis-je changer de forfait ?' },
    a: {
      en: 'Yes. You can upgrade or downgrade at any time. Changes take effect on the next billing cycle.',
      fr: 'Oui. Vous pouvez passer à un forfait supérieur ou inférieur en tout temps. Les changements prennent effet au prochain cycle de facturation.',
    },
  },
  {
    q: { en: 'Can I see a demo first?', fr: 'Puis-je voir une démo d\'abord ?' },
    a: {
      en: 'Yes! Book a demo with our team and we\'ll walk you through the platform live.',
      fr: 'Oui ! Réservez une démo avec notre équipe et nous vous ferons visiter la plateforme en direct.',
    },
  },
  {
    q: { en: 'How does billing work?', fr: 'Comment fonctionne la facturation ?' },
    a: {
      en: 'Billing is monthly by credit card. You receive a detailed invoice each month.',
      fr: 'La facturation est mensuelle, par carte de crédit. Vous recevez une facture détaillée chaque mois.',
    },
  },
  {
    q: { en: 'Is onboarding included?', fr: 'L\'intégration est-elle incluse ?' },
    a: {
      en: 'Yes. All plans include guided onboarding. AutoPilot includes dedicated onboarding with a specialist.',
      fr: 'Oui. Tous les forfaits incluent une intégration guidée. Autopilot inclut une intégration dédiée avec un spécialiste.',
    },
  },
];


// ── Trouveur : besoins cochables ─────────────────────────────────
// `plan` = indice du premier forfait qui l'inclut ; `rows` = libellés anglais
// des lignes correspondantes dans COMPARISON (pour les surligner).
interface Need { key: string; label: Bi; plan: 0 | 1 | 2; rows: string[] }
interface NeedGroup { title: Bi; items: Need[] }

const NEEDS: NeedGroup[] = [
  {
    title: { en: 'Sales', fr: 'Ventes' },
    items: [
      { key: 'quotes', label: { en: 'Quotes & e-signature', fr: 'Soumissions et signature électronique' }, plan: 0, rows: ['Quotes, invoicing, e-signatures & contracts'] },
      { key: 'requests', label: { en: 'Website requests', fr: 'Demandes entrantes du site web' }, plan: 0, rows: ['Incoming requests'] },
      { key: 'portal', label: { en: 'Client portal', fr: 'Portail client' }, plan: 0, rows: ['Client portal'] },
      { key: 'forms', label: { en: 'Custom request forms', fr: 'Formulaires de demande sur mesure' }, plan: 1, rows: ['Custom request forms'] },
      { key: 'templates', label: { en: 'Quote templates & satellite measure', fr: 'Modèles de soumission et mesure satellite' }, plan: 1, rows: ['Quote templates, presets & satellite measure tool'] },
      { key: 'followups', label: { en: 'Automatic quote follow-ups', fr: 'Relances automatiques des soumissions' }, plan: 1, rows: ['Automations & quote/invoice follow-ups'] },
      { key: 'd2d', label: { en: 'Door-to-door: pipeline & commissions', fr: 'Porte-à-porte : pipeline et commissions' }, plan: 2, rows: ['Door-to-door: map, pipeline, leaderboard, commissions, reports'] },
      { key: 'surveys', label: { en: 'Automatic satisfaction surveys', fr: 'Sondages de satisfaction automatiques' }, plan: 2, rows: ['Automated satisfaction surveys'] },
    ],
  },
  {
    title: { en: 'Field', fr: 'Terrain' },
    items: [
      { key: 'calendar', label: { en: 'Calendar, jobs & day view', fr: 'Calendrier, jobs et vue Jour' }, plan: 0, rows: ['Jobs, calendar, day view & tasks'] },
      { key: 'recurring', label: { en: 'Recurring jobs', fr: 'Jobs récurrentes' }, plan: 0, rows: ['Recurring jobs'] },
      { key: 'mobile', label: { en: 'Mobile access', fr: 'Accès mobile' }, plan: 0, rows: ['Mobile access'] },
      { key: 'dispatch', label: { en: 'Dispatch map & live GPS', fr: 'Carte de répartition et GPS en direct' }, plan: 1, rows: ['Dispatch map & live GPS'] },
      { key: 'checklists', label: { en: 'Checklists', fr: 'Listes de vérification' }, plan: 1, rows: ['Checklists & checklist templates'] },
      { key: 'availability', label: { en: 'Availability management', fr: 'Gestion des disponibilités' }, plan: 2, rows: ['Team availability management'] },
      { key: 'teams', label: { en: 'Multiple teams', fr: 'Plusieurs équipes' }, plan: 2, rows: ['Multi-team management'] },
    ],
  },
  {
    title: { en: 'Communication', fr: 'Communication' },
    items: [
      { key: 'emails', label: { en: 'Emails & appointment reminders', fr: 'Courriels et rappels de rendez-vous' }, plan: 0, rows: ['Client emails & appointment reminders'] },
      { key: 'sms', label: { en: 'SMS with a dedicated number', fr: 'Textos avec un numéro dédié' }, plan: 1, rows: ['Two-way SMS with a dedicated number'] },
      { key: 'batch', label: { en: 'Batch messaging', fr: 'Messages groupés' }, plan: 1, rows: ['Batch messaging'] },
      { key: 'chat', label: { en: 'Team chat', fr: 'Clavardage d\'équipe' }, plan: 1, rows: ['Internal team chat'] },
      { key: 'lumi-text', label: { en: 'Lumi answers by text (AI)', fr: 'Lumi répond par texte (IA)' }, plan: 1, rows: ['Lume AI Agent — text'] },
      { key: 'lumi-voice', label: { en: 'Lumi answers the phone (AI)', fr: 'Lumi répond au téléphone (IA)' }, plan: 2, rows: ['Lume AI Agent — voice'] },
    ],
  },
  {
    title: { en: 'Accounting & team', fr: 'Comptabilité et équipe' },
    items: [
      { key: 'payments', label: { en: 'Invoicing & online payments', fr: 'Facturation et paiements en ligne' }, plan: 0, rows: ['Online payments (Stripe & PayPal)'] },
      { key: 'finances', label: { en: 'Basic finances & reports', fr: 'Finances et rapports de base' }, plan: 0, rows: ['Basic finances & reporting'] },
      { key: 'payroll', label: { en: 'Timesheets & payroll', fr: 'Feuilles de temps et paie' }, plan: 1, rows: ['Employee timesheets & payroll'] },
      { key: 'performance', label: { en: 'Employee performance tracking', fr: 'Suivi de performance des employés' }, plan: 1, rows: ['Employee performance tracking'] },
      { key: 'analytics', label: { en: 'Advanced analytics', fr: 'Statistiques avancées' }, plan: 1, rows: ['Insights & advanced analytics'] },
      { key: 'quickbooks', label: { en: 'QuickBooks export', fr: 'Export QuickBooks' }, plan: 1, rows: ['QuickBooks export'] },
      { key: 'roles', label: { en: 'Advanced roles & permissions', fr: 'Rôles et permissions avancés' }, plan: 2, rows: ['Advanced roles & permissions'] },
      { key: 'lms', label: { en: 'Team courses (LMS)', fr: 'Formations de l\'équipe (LMS)' }, plan: 2, rows: ['Courses / LMS'] },
      { key: 'api', label: { en: 'Full API & marketplace', fr: 'API complète et marketplace' }, plan: 2, rows: ['Full API access', 'Integrations marketplace'] },
    ],
  },
];
const NEED_BY_KEY: Record<string, Need> = Object.fromEntries(NEEDS.flatMap(g => g.items.map(n => [n.key, n])));
/** Sélection de départ : une PME typique qui a une équipe sur la route. */
const DEFAULT_NEEDS = ['quotes', 'calendar', 'sms', 'dispatch', 'payroll', 'payments'];

const COPY = {
  en: {
    kicker: 'Pricing',
    titleLine1: 'Simple pricing,',
    titleUnderlined: 'no surprises',
    subtitle: 'Three plans that build on each other. Pick the stage your business is at today, move to the next one when you\'re ready.',
    monthly: 'Monthly',
    annual: 'Annual',
    perMonth: '/mo',
    billedMonthly: 'Billed monthly · cancel anytime',
    billedAnnually: (firstYr: string, fullYr: string) => `${firstYr} billed for year one, then ${fullYr}/yr`,
    mostPopular: 'Most popular',
    recommended: 'Recommended for you',
    seats: (u: number, o: number) => `${u} users · ${o} ${o > 1 ? 'offices' : 'office'} included`,
    seatExtras: (u: string, o: string) => `+${u} per extra user · +${o} per office`,
    extrasUser: 'Extra user:',
    extrasUserTail: 'per month depending on the plan',
    extrasOffice: 'Extra office:',
    extrasOfficeTail: 'per month',
    extrasCurrency: (cur: string) => `Prices in ${cur}, taxes extra`,
    cornerTitle: 'Every plan includes',
    cornerPoints: ['Guided onboarding with our team', 'Cancel anytime on monthly billing', 'Support in French and English'],
    finderKicker: 'Not sure?',
    finderTitle: 'Check what you need, the plan picks itself.',
    finderLead: 'Tell us the size of the team and what Lume should do for you. The recommended plan and its real price for your team are computed on the right.',
    usersLabel: 'People using Lume',
    usersHint: 'office and field',
    officesLabel: 'Offices or branches',
    officesHint: 'distinct addresses',
    less: 'Less',
    more: 'More',
    nFeatures: (n: number) => `${n} features`,
    because: 'Because of:',
    becauseSeats: (u: number, o: number, cheaper: string) => `your team (${u} ${u > 1 ? 'people' : 'person'}, ${o} ${o > 1 ? 'offices' : 'office'}) is more than ${cheaper} includes`,
    tooManyUsers: (u: number, inc: number) => `${u} people, ${inc} included`,
    tooManyOffices: (o: number, inc: number) => `${o} offices, ${inc} included`,
    withExtras: 'With extras:',
    verdictKicker: 'The plan you need',
    verdictLine: (n: number, u: number, o: number) => n > 0 ? `Covers your ${n} need${n > 1 ? 's' : ''}, ${u} ${u > 1 ? 'people' : 'person'} and ${o} ${o > 1 ? 'offices' : 'office'}.` : `For ${u} ${u > 1 ? 'people' : 'person'} and ${o} ${o > 1 ? 'offices' : 'office'}. Check features to refine.`,
    coverage: (c: number, n: number) => `${c} / ${n} of your needs`,
    missing: 'Missing:',
    gotoCompare: 'See your needs in the full comparison ↓',
    finderNote: 'Monthly prices. The recommended plan is the cheapest one that includes every feature you checked and your whole team. Beyond what Autopilot includes, users and offices are added to the price.',
    detailKicker: 'In detail',
    detailTitle: 'Everything each plan includes.',
    compareSummary: 'See the full comparison of all features',
    compareHint: (n: number) => `Your ${n} need${n > 1 ? 's are' : ' is'} highlighted`,
    expand: 'Expand',
    collapse: 'Collapse',
    checked: 'checked',
    faqKicker: 'Frequently asked questions',
    faqHeading: 'Before you choose.',
    included: 'Included',
    notIncluded: 'Not included',
  },
  fr: {
    kicker: 'Tarifs',
    titleLine1: 'Des prix simples,',
    titleUnderlined: 'sans surprises',
    subtitle: 'Trois forfaits qui s\'emboîtent. Choisissez l\'étape où votre entreprise est aujourd\'hui, passez à la suivante quand vous serez prêt.',
    monthly: 'Mensuel',
    annual: 'Annuel',
    perMonth: '/mois',
    billedMonthly: 'Facturé mensuellement · annulez en tout temps',
    billedAnnually: (firstYr: string, fullYr: string) => `${firstYr} facturés la première année, puis ${fullYr}/an`,
    mostPopular: 'Le plus choisi',
    recommended: 'Recommandé pour vous',
    seats: (u: number, o: number) => `${u} utilisateurs · ${o} bureau${o > 1 ? 'x' : ''} inclus`,
    seatExtras: (u: string, o: string) => `+${u} par utilisateur supplémentaire · +${o} par bureau`,
    extrasUser: 'Utilisateur supplémentaire :',
    extrasUserTail: 'par mois selon le forfait',
    extrasOffice: 'Bureau supplémentaire :',
    extrasOfficeTail: 'par mois',
    extrasCurrency: (cur: string) => `Prix en ${cur}, taxes en sus`,
    cornerTitle: 'Tous les forfaits incluent',
    cornerPoints: ['Une intégration guidée avec notre équipe', 'Annulation en tout temps en mensuel', 'Un soutien en français et en anglais'],
    finderKicker: 'Pas certain ?',
    finderTitle: 'Cochez ce dont vous avez besoin, le forfait se trouve tout seul.',
    finderLead: 'Dites la taille de l\'équipe et ce que Lume doit faire pour vous. Le forfait recommandé et son vrai prix pour votre équipe se calculent à droite.',
    usersLabel: 'Personnes qui utilisent Lume',
    usersHint: 'bureau et terrain',
    officesLabel: 'Bureaux ou succursales',
    officesHint: 'adresses distinctes',
    less: 'Moins',
    more: 'Plus',
    nFeatures: (n: number) => `${n} fonctions`,
    because: 'Parce que :',
    becauseSeats: (u: number, o: number, cheaper: string) => `votre équipe (${u} personne${u > 1 ? 's' : ''}, ${o} bureau${o > 1 ? 'x' : ''}) dépasse ce que ${cheaper} inclut`,
    tooManyUsers: (u: number, inc: number) => `${u} personnes, ${inc} incluses`,
    tooManyOffices: (o: number, inc: number) => `${o} bureaux, ${inc} inclus`,
    withExtras: 'Avec suppléments :',
    verdictKicker: 'Le forfait qu\'il vous faut',
    verdictLine: (n: number, u: number, o: number) => n > 0 ? `Couvre vos ${n} besoin${n > 1 ? 's' : ''}, ${u} personne${u > 1 ? 's' : ''} et ${o} bureau${o > 1 ? 'x' : ''}.` : `Pour ${u} personne${u > 1 ? 's' : ''} et ${o} bureau${o > 1 ? 'x' : ''}. Cochez des fonctions pour préciser.`,
    coverage: (c: number, n: number) => `${c} / ${n} de vos besoins`,
    missing: 'Manque :',
    gotoCompare: 'Voir vos besoins dans la comparaison complète ↓',
    finderNote: 'Prix mensuels. Le forfait recommandé est le moins cher qui inclut chaque fonction cochée et toute votre équipe. Au-delà de ce qu\'Autopilot inclut, utilisateurs et bureaux s\'ajoutent au prix.',
    detailKicker: 'Dans le détail',
    detailTitle: 'Tout ce que chaque forfait comprend.',
    compareSummary: 'Voir la comparaison complète de toutes les fonctions',
    compareHint: (n: number) => `Vos ${n} besoin${n > 1 ? 's' : ''} y ${n > 1 ? 'sont' : 'est'} surligné${n > 1 ? 's' : ''}`,
    expand: 'Déplier',
    collapse: 'Replier',
    checked: 'coché',
    faqKicker: 'Questions fréquentes',
    faqHeading: 'Avant de choisir.',
    included: 'Inclus',
    notIncluded: 'Non inclus',
  },
} as const;

const Check = ({ color = '#0a0a0a', label }: { color?: string; label: string }) => (
  <svg className="pr-ck" viewBox="0 0 16 16" fill="none" role="img" aria-label={label}>
    <path d="M2.5 8.5l3.5 3.5L13.5 4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function Pricing({ authenticated: _authenticated }: { authenticated?: boolean }) {
  const [annual, setAnnual] = useState(true);
  const [demoOpen, setDemoOpen] = useState(false);
  const [users, setUsers] = useState(6);
  const [offices, setOffices] = useState(1);
  const [needs, setNeeds] = useState<Set<string>>(() => new Set(DEFAULT_NEEDS));
  const [compareOpen, setCompareOpen] = useState(false);
  const compareRef = useRef<HTMLDetailsElement>(null);
  const { language } = useTranslation();
  const c = COPY[language];
  usePageMeta(language === 'fr'
    ? { title: 'Tarifs', description: 'Trois forfaits qui s\'emboîtent : Minimum, Scale et Autopilot. Prix simples, sans surprises, en CAD ou USD. Cochez ce dont vous avez besoin, le forfait se trouve tout seul.', path: '/pricing' }
    : { title: 'Pricing', description: 'Three plans that build on each other: Minimum, Scale and Autopilot. Simple pricing, no surprises, in CAD or USD. Check what you need, the plan picks itself.', path: '/pricing' });
  const { currency } = useRegion();
  const money = (n: number) => (language === 'fr' ? `${n.toLocaleString('fr-CA')} $` : `$${n.toLocaleString('en-CA')}`);
  const pr = (plan: Plan) => plan.prices[currency];

  // ── Trouveur ──
  const priceFor = (plan: Plan) =>
    pr(plan).monthly + Math.max(0, users - plan.seats.users) * pr(plan).extraUser + Math.max(0, offices - plan.seats.offices) * pr(plan).extraOffice;
  const { rec, wantedRows, coverage, why } = useMemo(() => {
    const list = [...needs].map(k => NEED_BY_KEY[k]).filter(Boolean);
    const coverage = PLANS.map((_, i) => list.filter(n => n.plan <= i));
    const coversAll = (i: number) => coverage[i].length === list.length;
    const fits = (i: number) => users <= PLANS[i].seats.users && offices <= PLANS[i].seats.offices;
    // Le moins cher qui couvre toutes les fonctions cochées ET inclut l'équipe ;
    // au-delà des inclus d'Autopilot, Autopilot avec suppléments.
    let rec = PLANS.findIndex((_, i) => coversAll(i) && fits(i));
    if (rec < 0) rec = PLANS.length - 1;
    // Pourquoi ce forfait : les fonctions qui l'exigent, et l'équipe si un forfait
    // moins cher couvrait déjà les fonctions.
    const byFeature = list.filter(n => n.plan === rec);
    const cheaperCovers = PLANS.findIndex((_, i) => coversAll(i));
    const bySeats = cheaperCovers >= 0 && cheaperCovers < rec;
    return { rec, wantedRows: new Set(list.flatMap(n => n.rows)), coverage, why: { byFeature, bySeats } };
  }, [needs, users, offices]);
  const toggleNeed = (k: string) => setNeeds(prev => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s; });
  const gotoCompare = () => {
    setCompareOpen(true);
    requestAnimationFrame(() => {
      const el = compareRef.current;
      if (!el) return;
      el.open = true;
      (el.querySelector('tr.hi') ?? el).scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  return (
    <div className="pr-page">
      <style>{PRICING_CSS}</style>

      {/* Titre + bascule */}
      <section className="pr-hero">
        <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="pr-kicker">{c.kicker}</motion.p>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          {c.titleLine1}
          <br />
          <span className="pr-u">{c.titleUnderlined}<svg className="absolute -bottom-1 left-0 w-full text-[#3FAF97]" height="6" viewBox="0 0 120 8" fill="none" preserveAspectRatio="none"><path d="M2 5.5C12 2.5 22 7 32 4S52 1 62 4.5S82 7.5 92 4S112 2 118 5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" /></svg></span>
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="pr-sub">{c.subtitle}</motion.p>
        <div className="pr-toggle" role="group">
          <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>{c.monthly}</button>
          <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>{c.annual} <i>−15 %</i></button>
        </div>
      </section>

      {/* Cartes */}
      <section className="pr-wrap">
        <div className="pr-plans">
          {PLANS.map((plan, i) => {
            const p = pr(plan);
            const now = annual ? Math.round(p.annualFirstYr / 12) : p.monthly;
            return (
              <article key={plan.slug} className={`pr-plan${plan.featured ? ' feat' : ''}${i === rec ? ' rec' : ''}`} data-rec={c.recommended}>
                <div className="pr-stage">{plan.stage[language]}</div>
                <h3>{plan.name}{plan.featured && <span className="pr-tag">{c.mostPopular}</span>}</h3>
                <p className="pr-desc">{plan.desc[language]}</p>
                <div className="pr-price">
                  {annual && <span className="was">{money(Math.round(p.annualFullYr / 12))}</span>}
                  <span className="now">{money(now)}</span>
                  <span className="cur">{currency}</span>
                  <span className="per">{c.perMonth}</span>
                </div>
                <div className="pr-bill">{annual ? c.billedAnnually(money(p.annualFirstYr), money(p.annualFullYr)) : c.billedMonthly}</div>
                <div className="pr-seats">{c.seats(plan.seats.users, plan.seats.offices)}<small>{c.seatExtras(money(p.extraUser), money(p.extraOffice))}</small></div>
                <div className="pr-inh">{plan.inherits[language]}</div>
                <ul>
                  {plan.highlights.map(h => <li key={h.en}><Check label={c.included} /><span>{h[language]}</span></li>)}
                </ul>
                <div className="pr-btn"><button type="button" onClick={() => setDemoOpen(true)}>{plan.cta[language]}</button></div>
              </article>
            );
          })}
        </div>
        <div className="pr-extras">
          <span>{c.extrasUser} {PLANS.map((p, i) => <b key={p.slug}>{i > 0 && <span className="sep"> · </span>}{money(pr(p).extraUser)}</b>)} {c.extrasUserTail}</span>
          <span>{c.extrasOffice} <b>{money(pr(PLANS[0]).extraOffice)}</b> {c.extrasOfficeTail}</span>
          <span>{c.extrasCurrency(currency)}</span>
        </div>
        <div className="pr-every">
          <span className="t">{c.cornerTitle}</span>
          {c.cornerPoints.map(pt => <div key={pt}><Check label={c.included} />{pt}</div>)}
        </div>
      </section>

      {/* Trouveur */}
      <section className="pr-wrap pr-sec">
        <p className="pr-kicker">{c.finderKicker}</p>
        <h2>{c.finderTitle}</h2>
        <p className="pr-lead">{c.finderLead}</p>
        <div className="pr-fgrid">
          <div>
            <div className="pr-team">
              <div className="pr-num">
                <label htmlFor="pr-users">{c.usersLabel}<small>{c.usersHint}</small></label>
                <span className="pr-stepper">
                  <button type="button" aria-label={c.less} onClick={() => setUsers(u => Math.max(1, u - 1))}>−</button>
                  <output id="pr-users">{users}</output>
                  <button type="button" aria-label={c.more} onClick={() => setUsers(u => Math.min(60, u + 1))}>+</button>
                </span>
              </div>
              <div className="pr-num">
                <label htmlFor="pr-offices">{c.officesLabel}<small>{c.officesHint}</small></label>
                <span className="pr-stepper">
                  <button type="button" aria-label={c.less} onClick={() => setOffices(o => Math.max(1, o - 1))}>−</button>
                  <output id="pr-offices">{offices}</output>
                  <button type="button" aria-label={c.more} onClick={() => setOffices(o => Math.min(12, o + 1))}>+</button>
                </span>
              </div>
            </div>
            {NEEDS.map(g => (
              <div key={g.title.en}>
                <div className="pr-gt">{g.title[language]}<span>{c.nFeatures(g.items.length)}</span></div>
                <div className="pr-chips">
                  {g.items.map(n => (
                    <button key={n.key} type="button" className="pr-chip" aria-pressed={needs.has(n.key)} onClick={() => toggleNeed(n.key)}>{n.label[language]}<i>{PLANS[n.plan].name}</i></button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <aside className="pr-side">
            <div className="pr-verdict">
              <div className="k">{c.verdictKicker}</div>
              <h3>{PLANS[rec].name}<small>{money(priceFor(PLANS[rec]))} {c.perMonth}</small></h3>
              <p>{c.verdictLine(needs.size, users, offices)} {PLANS[rec].stage[language]}.</p>
              {(why.byFeature.length > 0 || why.bySeats) && (
                <p className="why">
                  {c.because}{' '}
                  {why.byFeature.map((n, j) => <span key={n.key}>{j > 0 && ', '}<b>{n.label[language]}</b></span>)}
                  {why.byFeature.length > 0 && why.bySeats && ' · '}
                  {why.bySeats && <b>{c.becauseSeats(users, offices, PLANS[rec - 1].name)}</b>}
                </p>
              )}
            </div>
            {PLANS.map((plan, i) => {
              const miss = [...needs].map(k => NEED_BY_KEY[k]).filter(n => n && n.plan > i);
              const pct = needs.size ? Math.round((coverage[i].length / needs.size) * 100) : 0;
              const seatMiss: string[] = [];
              if (users > plan.seats.users) seatMiss.push(c.tooManyUsers(users, plan.seats.users));
              if (offices > plan.seats.offices) seatMiss.push(c.tooManyOffices(offices, plan.seats.offices));
              const isLast = i === PLANS.length - 1;
              return (
                <div key={plan.slug} className={`pr-pl${i === rec ? ' rec' : ''}`}>
                  <div className="n">{plan.name}{i === rec && <em>{c.recommended}</em>}</div>
                  <div className="pr">{money(priceFor(plan))}<small> {c.perMonth}</small></div>
                  <div className="cov"><b>{c.coverage(coverage[i].length, needs.size)}</b> · {c.seats(plan.seats.users, plan.seats.offices)}</div>
                  {(miss.length > 0 || (seatMiss.length > 0 && !isLast)) && (
                    <div className="miss">{c.missing} {miss.map((n, j) => <span key={n.key}>{j > 0 && ', '}<s>{n.label[language]}</s></span>)}{miss.length > 0 && seatMiss.length > 0 && !isLast && ', '}{!isLast && seatMiss.map((m, j) => <span key={m}>{j > 0 && ', '}<s>{m}</s></span>)}</div>
                  )}
                  {seatMiss.length > 0 && isLast && <div className="miss">{c.withExtras} {seatMiss.join(', ')}</div>}
                  <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
            {wantedRows.size > 0 && <a href="#comparaison" className="pr-goto" onClick={e => { e.preventDefault(); gotoCompare(); }}>{c.gotoCompare}</a>}
            <p className="pr-note">{c.finderNote}</p>
          </aside>
        </div>
      </section>

      {/* Comparaison complète */}
      <section className="pr-wrap pr-sec" id="comparaison">
        <p className="pr-kicker">{c.detailKicker}</p>
        <h2>{c.detailTitle}</h2>
        <details ref={compareRef} className="pr-cmp" open={compareOpen} onToggle={e => setCompareOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>
            {c.compareSummary}
            {wantedRows.size > 0 && <b>{c.compareHint(wantedRows.size)}</b>}
            <span>{compareOpen ? c.collapse : c.expand} <ChevronDown size={14} /></span>
          </summary>
          <div className="pr-scroller">
            <table>
              <thead>
                <tr>
                  <th className="f" />
                  {PLANS.map((plan, i) => (
                    <th key={plan.slug} className={`p${plan.featured ? ' feat' : ''}${i === rec ? ' rec' : ''}`}>
                      <span className="pn">{plan.name}</span>
                      <span className="pp">{money(pr(plan).monthly)} {c.perMonth}</span>
                      {i === rec && <span className="rl">{c.recommended}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              {COMPARISON.map(group => (
                <tbody key={group.title.en}>
                  <tr><th colSpan={4}>{group.title[language]}</th></tr>
                  {group.rows.map(row => (
                    <tr key={row.label.en} className={wantedRows.has(row.label.en) ? 'hi' : undefined}>
                      <td><i className="dot" aria-hidden="true" />{row.label[language]}<em className="you">{c.checked}</em></td>
                      {row.cells.map((cell, i) => (
                        <td key={i} className={`c${PLANS[i].featured ? ' feat' : ''}${i === rec ? ' rec' : ''}`}>
                          <CompareCell cell={cell} language={language} yes={c.included} no={c.notIncluded} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </details>
      </section>

      {/* FAQ */}
      <section className="pr-wrap pr-sec pr-faq-sec">
        <p className="pr-kicker">{c.faqKicker}</p>
        <h2>{c.faqHeading}</h2>
        <div className="pr-faq">
          {FAQS.map((faq, i) => <PricingFAQ key={faq.q.en} q={faq.q[language]} a={faq.a[language]} defaultOpen={i === 0} />)}
        </div>
      </section>

      <BookDemoForm open={demoOpen} onClose={() => setDemoOpen(false)} source="pricing" />
    </div>
  );
}

function PricingFAQ({ q, a, defaultOpen }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="pr-faq-item">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{q}</span>
        <ChevronDown size={16} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p>{a}</p>}
    </div>
  );
}

function CompareCell({ cell, language, yes, no }: { cell: Cell; language: Language; yes: string; no: string }) {
  if (cell === true) return <Check label={yes} />;
  if (cell === false) return <span className="pr-no" role="img" aria-label={no} />;
  return <span className="pr-val">{cell[language]}</span>;
}

const PRICING_CSS = `
.pr-page { --ink:#0a0a0a; --ink2:#171717; --ink3:#4a4f57; --ink4:#8a909a; --forest:#1F5F4F; --mint:#3FAF97; --red:#ef4444; --rule:#111; --hair:rgba(11,40,80,.12); --hair2:rgba(11,40,80,.07); color:var(--ink2); font-size:14px; line-height:1.45; padding-bottom:64px; }
.pr-page h1, .pr-page h2, .pr-page h3 { margin:0; color:var(--ink); letter-spacing:-.02em; text-wrap:balance; }
.pr-wrap { max-width:1120px; margin:0 auto; padding:0 24px; }
.pr-kicker { font-size:11px; letter-spacing:.2em; text-transform:uppercase; font-weight:600; color:var(--forest); margin:0 0 10px; }
.pr-sec { padding-top:72px; }
.pr-sec h2 { font-size:clamp(26px,3.2vw,36px); font-weight:800; letter-spacing:-.03em; line-height:1.08; }
.pr-lead { max-width:58ch; color:var(--ink3); margin:10px 0 0; font-size:15.5px; }
.pr-ck { display:inline-block; width:14px; height:14px; vertical-align:-2px; flex:none; }
.pr-no { display:inline-block; width:10px; height:1px; background:rgba(11,40,80,.25); vertical-align:middle; }
.pr-val { font-size:12.5px; font-weight:600; color:var(--ink2); }

.pr-hero { padding:120px 24px 34px; text-align:center; }
.pr-hero h1 { font-size:clamp(38px,5.4vw,64px); font-weight:800; letter-spacing:-.04em; line-height:1.02; }
.pr-u { position:relative; display:inline-block; }
.pr-sub { max-width:60ch; margin:16px auto 0; font-size:17px; color:var(--ink3); }
.pr-toggle { display:inline-flex; align-items:center; background:rgba(255,255,255,.75); border:1px solid var(--hair); border-radius:999px; padding:4px; margin-top:26px; }
.pr-toggle button { border:0; background:transparent; border-radius:999px; padding:8px 16px; font-size:13.5px; font-weight:600; color:var(--ink3); cursor:pointer; display:inline-flex; gap:8px; align-items:center; }
.pr-toggle button[aria-pressed="true"] { background:#111; color:#fff; }
.pr-toggle button i { font-style:normal; font-size:11px; font-weight:800; color:var(--mint); }

.pr-plans { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; align-items:stretch; margin-top:34px; }
.pr-plan { background:#fff; border:1px solid var(--hair); border-radius:20px; padding:26px 26px 22px; display:flex; flex-direction:column; position:relative; }
.pr-plan.feat { border:2px solid #111; box-shadow:0 34px 70px -40px rgba(0,0,0,.45); }
.pr-plan.rec::before { content:attr(data-rec); position:absolute; top:-13px; left:24px; font-size:10px; letter-spacing:.14em; text-transform:uppercase; font-weight:800; color:#fff; background:var(--forest); border-radius:999px; padding:5px 10px; }
.pr-stage { font-size:11px; letter-spacing:.18em; text-transform:uppercase; font-weight:700; color:var(--forest); }
.pr-plan h3 { font-size:26px; font-weight:800; letter-spacing:-.03em; margin-top:6px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.pr-tag { font-size:10px; letter-spacing:.14em; text-transform:uppercase; font-weight:800; color:#fff; background:#111; border-radius:999px; padding:4px 9px; }
.pr-desc { color:var(--ink3); font-size:14px; margin:8px 0 0; min-height:42px; }
.pr-price { margin-top:18px; display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; font-variant-numeric:tabular-nums; }
.pr-price .was { font-size:15px; color:var(--ink4); text-decoration:line-through; }
.pr-price .now { font-size:40px; font-weight:800; letter-spacing:-.04em; color:var(--ink); line-height:1; }
.pr-price .per { font-size:13px; color:var(--ink3); font-weight:500; }
.pr-price .cur { font-size:10px; font-weight:700; color:var(--ink4); align-self:flex-start; margin-top:4px; }
.pr-bill { font-size:12px; color:var(--ink4); margin-top:6px; min-height:18px; }
.pr-seats { margin-top:14px; padding:10px 0; border-top:1px solid var(--hair); border-bottom:1px solid var(--hair); font-size:13px; font-weight:600; color:var(--ink); }
.pr-seats small { display:block; font-weight:400; color:var(--ink4); font-size:12px; margin-top:2px; }
.pr-inh { margin:16px 0 4px; font-size:11px; letter-spacing:.16em; text-transform:uppercase; font-weight:700; color:var(--forest); }
.pr-plan ul { list-style:none; margin:6px 0 0; padding:0; }
.pr-plan li { display:flex; gap:10px; align-items:flex-start; padding:7px 0; font-size:14px; color:var(--ink2); }
.pr-plan li .pr-ck { margin-top:3px; }
.pr-btn { margin-top:auto; padding-top:20px; }
.pr-btn button { width:100%; border:1.5px solid #111; background:transparent; color:#111; font-weight:700; border-radius:12px; padding:12px; font-size:14px; cursor:pointer; }
.pr-plan.feat .pr-btn button { background:#111; color:#fff; }
.pr-extras { display:flex; gap:28px; flex-wrap:wrap; justify-content:center; margin-top:22px; font-size:13px; color:var(--ink3); }
.pr-extras b { color:var(--ink); font-weight:700; }
.pr-extras .sep { color:var(--ink3); font-weight:400; }
.pr-every { display:grid; grid-template-columns:auto 1fr 1fr 1fr; gap:18px 28px; align-items:center; margin-top:28px; padding:18px 24px; border-top:1px solid var(--rule); border-bottom:1px solid var(--hair); }
.pr-every .t { font-size:11px; letter-spacing:.18em; text-transform:uppercase; font-weight:700; color:var(--ink); }
.pr-every div { font-size:13.5px; color:var(--ink2); display:flex; gap:9px; align-items:center; }

.pr-fgrid { display:grid; grid-template-columns:1.25fr .95fr; gap:36px; align-items:start; margin-top:30px; }
.pr-team { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:24px; }
.pr-num { background:#fff; border:1px solid var(--hair); border-radius:14px; padding:14px 16px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
.pr-num label { font-size:13px; font-weight:600; color:var(--ink2); }
.pr-num label small { display:block; font-weight:400; color:var(--ink4); font-size:11.5px; }
.pr-stepper { display:inline-flex; align-items:center; border:1px solid var(--hair); border-radius:10px; overflow:hidden; }
.pr-stepper button { width:34px; height:34px; border:0; background:transparent; font-size:18px; cursor:pointer; color:var(--ink); }
.pr-stepper button:hover { background:#f1f5fb; }
.pr-stepper output { width:40px; text-align:center; font-weight:800; font-variant-numeric:tabular-nums; font-size:15px; }
.pr-gt { margin:20px 0 8px; font-size:11px; letter-spacing:.18em; text-transform:uppercase; font-weight:700; color:var(--forest); display:flex; justify-content:space-between; align-items:baseline; }
.pr-team + div .pr-gt { margin-top:0; }
.pr-gt span { font-weight:500; letter-spacing:0; text-transform:none; color:var(--ink4); font-size:12px; }
.pr-chips { display:flex; flex-wrap:wrap; gap:6px; }
.pr-chip { appearance:none; border:1px solid rgba(11,40,80,.16); background:rgba(255,255,255,.7); border-radius:999px; padding:7px 12px 7px 10px; font-size:13px; font-weight:500; color:var(--ink2); cursor:pointer; display:inline-flex; align-items:center; gap:7px; text-align:left; }
.pr-chip::before { content:""; width:14px; height:14px; border-radius:4px; border:1.5px solid rgba(11,40,80,.28); background:#fff; flex:none; }
.pr-chip[aria-pressed="true"] { background:#111; color:#fff; border-color:#111; }
.pr-chip[aria-pressed="true"]::before { background:var(--mint) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M3.5 8.5l3 3L12.5 5' stroke='%23111' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 12px no-repeat; border-color:var(--mint); }
.pr-chip i { font-style:normal; font-size:10px; letter-spacing:.08em; text-transform:uppercase; font-weight:700; color:var(--ink4); margin-left:2px; }
.pr-chip[aria-pressed="true"] i { color:#9fb3ab; }
.pr-chip:hover { border-color:#111; }
.pr-verdict .why { margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,.14); font-size:12.5px; color:#c8cfd8; line-height:1.5; }
.pr-verdict .why b { color:#fff; font-weight:600; }
.pr-chip:focus-visible, .pr-stepper button:focus-visible, .pr-toggle button:focus-visible { outline:2px solid var(--mint); outline-offset:2px; }
.pr-side { position:sticky; top:84px; }
.pr-verdict { background:#111; color:#fff; border-radius:18px; padding:20px 22px; margin-bottom:12px; }
.pr-verdict .k { font-size:11px; letter-spacing:.18em; text-transform:uppercase; font-weight:700; color:var(--mint); }
.pr-verdict h3 { color:#fff; font-size:30px; font-weight:800; letter-spacing:-.03em; margin-top:4px; display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
.pr-verdict h3 small { font-size:15px; font-weight:600; color:#c8cfd8; letter-spacing:0; }
.pr-verdict p { margin:8px 0 0; color:#c8cfd8; font-size:13.5px; }
.pr-verdict p.why { font-size:12.5px; }
.pr-pl { background:#fff; border:1px solid var(--hair); border-radius:14px; padding:14px 16px; margin-top:8px; display:grid; grid-template-columns:1fr auto; gap:2px 14px; align-items:center; }
.pr-pl.rec { border-color:#111; box-shadow:0 0 0 1px #111 inset; }
.pr-pl .n { font-weight:800; font-size:15px; color:var(--ink); }
.pr-pl .n em { font-style:normal; font-size:10px; letter-spacing:.14em; text-transform:uppercase; font-weight:700; color:var(--forest); margin-left:8px; }
.pr-pl .pr { font-weight:800; font-size:15px; font-variant-numeric:tabular-nums; text-align:right; color:var(--ink); }
.pr-pl .pr small { font-weight:500; color:var(--ink4); font-size:11.5px; }
.pr-pl .cov { grid-column:1/-1; font-size:12.5px; color:var(--ink3); margin-top:2px; }
.pr-pl .cov b { color:var(--ink); }
.pr-pl .miss { grid-column:1/-1; font-size:12px; color:var(--ink3); margin-top:6px; line-height:1.5; }
.pr-pl .miss s { color:var(--red); text-decoration-color:var(--red); text-decoration-thickness:1.5px; }
.pr-pl .bar { grid-column:1/-1; height:3px; background:#e9eef6; border-radius:2px; margin-top:8px; overflow:hidden; }
.pr-pl .bar i { display:block; height:100%; background:var(--mint); transition:width .25s; }
.pr-goto { display:inline-block; margin-top:12px; font-weight:700; font-size:13px; color:var(--forest); text-decoration:none; border-bottom:1.5px solid var(--mint); }
.pr-note { margin:12px 0 0; font-size:11.5px; color:var(--ink4); line-height:1.5; }

.pr-cmp { margin-top:26px; border-top:1px solid var(--rule); }
.pr-cmp summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:12px; padding:20px 0; font-size:16px; font-weight:800; color:var(--ink); }
.pr-cmp summary::-webkit-details-marker { display:none; }
.pr-cmp summary b { font-size:12.5px; font-weight:600; color:var(--forest); }
.pr-cmp summary span { margin-left:auto; font-size:13px; font-weight:600; color:var(--ink3); display:inline-flex; gap:8px; align-items:center; white-space:nowrap; }
.pr-cmp summary svg { transition:transform .2s; }
.pr-cmp[open] summary svg { transform:rotate(180deg); }
.pr-scroller { overflow-x:auto; }
.pr-cmp table { width:100%; border-collapse:collapse; min-width:720px; font-variant-numeric:tabular-nums; }
.pr-cmp th, .pr-cmp td { text-align:left; vertical-align:middle; }
.pr-cmp thead th { position:sticky; top:64px; z-index:5; background:rgba(238,245,255,.94); backdrop-filter:blur(6px); padding:14px 0 12px; border-bottom:1px solid var(--rule); }
.pr-cmp thead th.f { width:40%; }
.pr-cmp thead th.p { width:20%; text-align:center; }
.pr-cmp thead th.p.feat { background:rgba(255,255,255,.55); }
.pr-cmp thead th.p.rec { background:rgba(31,95,79,.07); }
.pr-cmp .pn { display:block; font-size:17px; font-weight:800; letter-spacing:-.02em; color:var(--ink); }
.pr-cmp .pp { display:block; font-size:12.5px; color:var(--ink3); margin-top:2px; }
.pr-cmp .rl { display:block; margin-top:6px; font-size:10px; letter-spacing:.14em; text-transform:uppercase; font-weight:800; color:var(--forest); }
.pr-cmp tbody th { padding:40px 0 8px; font-size:16px; font-weight:800; letter-spacing:-.015em; color:var(--ink); border-bottom:1px solid var(--rule); }
.pr-cmp tbody:first-of-type th { padding-top:22px; }
.pr-cmp td { padding:9px 0; border-bottom:1px solid var(--hair2); font-size:14px; color:var(--ink2); }
.pr-cmp td.c { text-align:center; }
.pr-cmp td.c.feat { background:rgba(255,255,255,.55); }
.pr-cmp td.c.rec { background:rgba(31,95,79,.05); }
.pr-cmp td .dot { display:none; width:8px; height:8px; border-radius:50%; background:var(--mint); margin-right:10px; vertical-align:1px; }
.pr-cmp td .you { display:none; font-style:normal; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; font-weight:700; color:var(--forest); margin-left:10px; }
.pr-cmp tr.hi td { font-weight:600; color:var(--ink); }
.pr-cmp tr.hi td .dot, .pr-cmp tr.hi td .you { display:inline-block; }

.pr-faq { max-width:760px; margin-top:22px; }
.pr-faq-item { border-top:1px solid var(--hair); padding:14px 0; }
.pr-faq-item:last-child { border-bottom:1px solid var(--hair); }
.pr-faq-item > button { width:100%; background:transparent; border:0; padding:0; cursor:pointer; font-weight:700; font-size:15.5px; color:var(--ink); display:flex; justify-content:space-between; gap:16px; text-align:left; font-family:inherit; }
.pr-faq-item p { margin:10px 0 0; color:var(--ink3); font-size:14px; line-height:1.55; max-width:66ch; }

@media (min-width: 780px) { .pr-scroller { overflow:visible; } }
@media (max-width: 900px) {
  .pr-plans, .pr-fgrid { grid-template-columns:1fr; }
  .pr-side { position:static; }
  .pr-every { grid-template-columns:1fr; }
  .pr-cmp thead th { top:0; }
  .pr-hero { padding-top:104px; }
}
`;
