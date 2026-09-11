/**
 * Page Fonctionnalités publique.
 * Même mécanique qu'avant : le menu Fonctionnalités de l'en-tête et les puces
 * sous le titre mènent à une carte par son ancre (#pipeline, #d2d-map…), puis
 * on défile pour voir les autres. Seuls le style (ciel, cartes blanches) et
 * les images (vraies captures de l'app dans /landing) ont changé.
 */
import { Link } from 'react-router-dom';
import { FONCTIONS } from './fonctionsData';

/** Chaque carte mène à la page « En savoir plus » de sa fonction quand elle existe, sinon au contact. */
const PAGE_PAR_CARTE: Record<string, string> = Object.fromEntries(FONCTIONS.map((x) => [x.featureAnchor, `/fonctions/${x.slug}`]));
import { motion } from 'motion/react';
import { ArrowRight, BellRing, Calendar, CreditCard, FileText, Kanban, Map, Mic, Star, Trophy, Zap } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { usePageMeta } from '../../hooks/usePageMeta';
import type { Language } from '../../i18n';

// Copie bilingue locale — les dictionnaires i18n globaux ne couvrent pas ces
// clés et ne doivent pas être modifiés d'ici.
type Bi = Record<Language, string>;

interface Feature {
  id: string;
  icon: typeof Mic;
  /** Capture réelle de l'app (public/landing). */
  shot: string;
  title: Bi;
  subtitle: Bi;
  bullets: Record<Language, string[]>;
}

const FEATURES: Feature[] = [
  {
    id: 'ai-voice',
    shot: '/landing/apercu-lumi.webp',
    icon: Mic,
    title: { en: 'AI Voice Assistant', fr: 'Assistant vocal IA' },
    subtitle: { en: 'Speak. Lume acts.', fr: 'Parlez. Lume s\'exécute.' },
    bullets: {
      en: ['Create leads by voice', 'Send quotes instantly', 'Smart daily summaries', 'Hands-free productivity'],
      fr: ['Créez des leads à la voix', 'Envoyez des soumissions instantanément', 'Résumés quotidiens intelligents', 'Productivité mains libres'],
    },
  },
  {
    id: 'pipeline',
    shot: '/landing/apercu-quotes.webp',
    icon: Kanban,
    title: { en: 'Visual Pipeline', fr: 'Pipeline visuel' },
    subtitle: { en: 'Never lose a lead again', fr: 'Ne perdez plus jamais un lead' },
    bullets: {
      en: ['Drag-and-drop Kanban board', 'Filter by stage or assignee', 'Complete lead history', 'Bulk actions'],
      fr: ['Tableau kanban en glisser-déposer', 'Filtrez par étape ou par assigné', 'Historique complet de chaque lead', 'Actions en lot'],
    },
  },
  {
    id: 'request-form',
    shot: '/landing/apercu-formulaire.webp',
    icon: FileText,
    title: { en: 'Request Forms', fr: 'Formulaires de demande' },
    subtitle: { en: 'Capture leads 24/7', fr: 'Captez des leads 24/7' },
    bullets: {
      en: ['Embeddable web form', 'Auto-creates leads in pipeline', 'Instant notifications', 'Custom fields and branding'],
      fr: ['Formulaire web intégrable', 'Création automatique des leads dans le pipeline', 'Notifications instantanées', 'Champs personnalisés et image de marque'],
    },
  },
  {
    id: 'd2d-map',
    shot: '/landing/apercu-porte-a-porte.webp',
    icon: Map,
    title: { en: 'D2D Map', fr: 'Carte porte-à-porte' },
    subtitle: { en: 'Your territory, mastered', fr: 'Votre territoire, maîtrisé' },
    bullets: {
      en: ['Color-coded pins by status', 'Real-time GPS tracking', 'Assignable territory zones', 'Offline mode'],
      fr: ['Punaises colorées selon le statut', 'Suivi GPS en temps réel', 'Zones de territoire assignables', 'Mode hors ligne'],
    },
  },
  {
    id: 'leaderboard',
    shot: '/landing/apercu-classement.webp',
    icon: Trophy,
    title: { en: 'Leaderboard', fr: 'Classement' },
    subtitle: { en: 'Performance becomes a game', fr: 'La performance devient un jeu' },
    bullets: {
      en: ['Real-time rankings', 'Badges and achievements', 'Daily challenges', 'Team comparisons'],
      fr: ['Classements en temps réel', 'Badges et accomplissements', 'Défis quotidiens', 'Comparaisons entre équipes'],
    },
  },
  {
    id: 'notifications',
    shot: '/landing/apercu-messages.webp',
    icon: BellRing,
    title: { en: 'Quote Notifications', fr: 'Notifications de soumission' },
    subtitle: { en: 'Follow up at the right time', fr: 'Relancez au bon moment' },
    bullets: {
      en: ['Know when quotes are opened', 'Auto reminders', 'View count tracking', 'Push and email alerts'],
      fr: ['Sachez quand vos soumissions sont ouvertes', 'Rappels automatiques', 'Suivi du nombre de consultations', 'Alertes push et par courriel'],
    },
  },
  {
    id: 'reviews',
    shot: '/landing/apercu-avis.webp',
    icon: Star,
    title: { en: 'Google Reviews', fr: 'Avis Google' },
    subtitle: { en: 'Build reputation on autopilot', fr: 'Bâtissez votre réputation en pilote automatique' },
    bullets: {
      en: ['Auto review requests post-service', 'Satisfaction filter', 'Track reviews generated', 'Direct Google integration'],
      fr: ['Demandes d\'avis automatiques après le service', 'Filtre de satisfaction', 'Suivi des avis générés', 'Intégration directe à Google'],
    },
  },
  {
    id: 'scheduling',
    shot: '/landing/apercu-dispatch.webp',
    icon: Calendar,
    title: { en: 'Scheduling & Dispatch', fr: 'Planification et répartition' },
    subtitle: { en: 'Centralized team scheduling', fr: 'Une planification d\'équipe centralisée' },
    bullets: {
      en: ['Day / week / month views', 'Job assignment', 'Conflict detection', 'Google Calendar sync'],
      fr: ['Vues jour / semaine / mois', 'Assignation des jobs', 'Détection de conflits', 'Synchronisation Google Agenda'],
    },
  },
  {
    id: 'automation',
    shot: '/landing/apercu-automatisations.webp',
    icon: Zap,
    title: { en: 'Automations', fr: 'Automatisations' },
    subtitle: { en: 'Eliminate repetitive work', fr: 'Éliminez le travail répétitif' },
    bullets: {
      en: ['No-code workflows', 'Auto follow-ups', 'Status-based triggers', 'Quote reminders'],
      fr: ['Workflows sans code', 'Relances automatiques', 'Déclencheurs selon le statut', 'Rappels de soumission'],
    },
  },
  {
    id: 'payments',
    shot: '/landing/apercu-finances.webp',
    icon: CreditCard,
    title: { en: 'Lume Payments', fr: 'Lume Payments' },
    subtitle: { en: 'Get paid faster, every time', fr: 'Soyez payé plus vite, chaque fois' },
    bullets: {
      en: ['Accept cards on-site or online', 'Auto-invoice after job completion', 'Payment tracking per client'],
      fr: ['Acceptez les cartes sur place ou en ligne', 'Facturation automatique à la fin de la job', 'Suivi des paiements par client'],
    },
  },
];

const COPY = {
  en: {
    kicker: 'Features',
    titleLine1: 'One platform.',
    titleLine2: 'Every tool your business needs.',
    subtitle: 'From lead capture to 5-star reviews — manage sales, operations, scheduling, automation, and team performance in one place.',
    ctaHeading: 'Ready to see Lume in action?',
    ctaDesc: 'Book a personalized demo and discover how Lume can transform your operations.',
    bookDemo: 'Book a demo',
  },
  fr: {
    kicker: 'Fonctionnalités',
    titleLine1: 'Une seule plateforme.',
    titleLine2: 'Tous les outils dont votre entreprise a besoin.',
    subtitle: 'De la capture de leads aux avis 5 étoiles — gérez vos ventes, vos opérations, votre horaire, vos automatisations et la performance de votre équipe au même endroit.',
    ctaHeading: 'Prêt à voir Lume en action ?',
    ctaDesc: 'Réservez une démo personnalisée et découvrez comment Lume peut transformer vos opérations.',
    bookDemo: 'Réserver une démo',
  },
} as const;

const Check = ({ label }: { label: string }) => (
  <svg className="ft-ck" viewBox="0 0 16 16" fill="none" role="img" aria-label={label}>
    <path d="M2.5 8.5l3.5 3.5L13.5 4" stroke="#0a0a0a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function Features() {
  const { language } = useTranslation();
  const c = COPY[language];
  usePageMeta(language === 'fr'
    ? { title: 'Fonctionnalités', description: 'Assistant IA, pipeline, formulaires de demande, carte porte-à-porte, classement, relances de soumissions, avis Google, planification, automatisations et paiements : tout ce que Lume fait pour une entreprise de services.', path: '/features' }
    : { title: 'Features', description: 'AI assistant, pipeline, request forms, door-to-door map, leaderboard, quote follow-ups, Google reviews, scheduling, automations and payments: everything Lume does for a service business.', path: '/features' });
  const learnMore = language === 'fr' ? 'En savoir plus →' : 'Learn more →';
  const included = language === 'fr' ? 'Inclus' : 'Included';

  return (
    <div className="ft-page">
      <style>{FEATURES_CSS}</style>

      <section className="ft-hero">
        <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="ft-kicker">{c.kicker}</motion.p>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          {c.titleLine1}<br />{c.titleLine2}
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="ft-sub">{c.subtitle}</motion.p>
      </section>

      {/* Puces : même ancres que le menu de l'en-tête */}
      <nav className="ft-chips" aria-label={c.kicker}>
        {FEATURES.map(f => <a key={f.id} href={`#${f.id}`}>{f.title[language]}</a>)}
      </nav>

      <div className="ft-grid">
        {FEATURES.map((feature, i) => (
          <motion.article
            key={feature.id}
            id={feature.id}
            className="ft-card"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ delay: i % 2 === 0 ? 0 : 0.08 }}
          >
            <p className="ft-kicker">{feature.title[language]}</p>
            <h2>{feature.subtitle[language]}</h2>
            <ul>
              {feature.bullets[language].map(b => <li key={b}><Check label={included} /><span>{b}</span></li>)}
            </ul>
            <Link to={PAGE_PAR_CARTE[feature.id] ?? '/contact'} className="ft-lnk">{learnMore}</Link>
            <div className="ft-shot"><img src={feature.shot} alt="" width={1800} height={1125} loading="lazy" decoding="async" /></div>
          </motion.article>
        ))}
      </div>

      <div className="ft-cta">
        <div><h2>{c.ctaHeading}</h2><p>{c.ctaDesc}</p></div>
        <Link to="/contact" className="ft-btn">{c.bookDemo}<ArrowRight size={16} /></Link>
      </div>
    </div>
  );
}

const FEATURES_CSS = `
.ft-page { --ink:#0a0a0a; --ink2:#171717; --ink3:#4a4f57; --forest:#1F5F4F; --mint:#3FAF97; --rule:#111; --hair:rgba(11,40,80,.12); --hair2:rgba(11,40,80,.07); color:var(--ink2); max-width:1180px; margin:0 auto; padding:0 24px 96px; }
.ft-page h1, .ft-page h2 { margin:0; color:var(--ink); letter-spacing:-.02em; text-wrap:balance; }
.ft-kicker { font-size:11px; letter-spacing:.2em; text-transform:uppercase; font-weight:600; color:var(--forest); margin:0 0 10px; }
.ft-hero { padding:120px 0 22px; text-align:center; }
.ft-hero h1 { font-size:clamp(34px,4.6vw,56px); font-weight:800; letter-spacing:-.04em; line-height:1.02; }
.ft-sub { max-width:60ch; margin:16px auto 0; font-size:17px; color:var(--ink3); }
.ft-chips { display:flex; flex-wrap:wrap; justify-content:center; gap:6px; padding:14px 0 34px; }
.ft-chips a { font-size:12.5px; font-weight:600; color:var(--ink2); text-decoration:none; padding:7px 12px; border-radius:999px; border:1px solid rgba(11,40,80,.16); background:rgba(255,255,255,.7); }
.ft-chips a:hover { border-color:#111; background:#fff; }
.ft-grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
.ft-card { background:#fff; border:1px solid var(--hair); border-radius:22px; padding:30px 30px 0; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 30px 60px -44px rgba(11,40,80,.35); scroll-margin-top:84px; }
.ft-card .ft-kicker { margin:0; }
.ft-card h2 { font-size:26px; font-weight:800; letter-spacing:-.03em; line-height:1.1; margin-top:8px; }
.ft-card ul { list-style:none; margin:16px 0 0; padding:0; }
.ft-card li { display:flex; gap:10px; align-items:flex-start; padding:7px 0; border-top:1px solid var(--hair2); font-size:14px; font-weight:600; color:var(--ink); }
.ft-card li:first-child { border-top:0; }
.ft-ck { display:inline-block; width:14px; height:14px; flex:none; margin-top:3px; }
.ft-lnk { display:inline-block; margin-top:12px; font-weight:700; font-size:13px; color:var(--forest); text-decoration:none; border-bottom:1.5px solid var(--mint); align-self:flex-start; }
.ft-shot { margin:22px -30px 0 30px; border-radius:12px 0 0 0; border:1px solid rgba(11,92,173,.14); border-right:0; border-bottom:0; box-shadow:0 30px 60px -30px rgba(0,0,0,.35); aspect-ratio:16/9.6; overflow:hidden; background:#fff; margin-top:auto; padding-top:0; }
.ft-shot img { width:130%; height:auto; display:block; }
.ft-card:target { outline:2px solid #111; outline-offset:3px; }
.ft-cta { margin-top:56px; padding-top:36px; border-top:1px solid var(--rule); display:flex; justify-content:space-between; align-items:center; gap:20px; flex-wrap:wrap; }
.ft-cta h2 { font-size:28px; font-weight:800; letter-spacing:-.03em; }
.ft-cta p { margin:6px 0 0; color:var(--ink3); }
.ft-btn { display:inline-flex; align-items:center; gap:8px; background:#111; color:#fff; border-radius:12px; padding:14px 22px; font-weight:700; font-size:15px; text-decoration:none; }
.ft-btn:hover { background:#000; }
@media (max-width: 900px) { .ft-grid { grid-template-columns:1fr; } .ft-hero { padding-top:104px; } .ft-shot { margin-left:0; } }
@media (prefers-reduced-motion: reduce) { .ft-card { transition:none !important; } }
`;
