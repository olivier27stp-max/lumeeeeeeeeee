import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase, UserCircle, MapPin, Headset, Target,
  BarChart3, Trophy, Kanban, Map, Calendar, Mic,
  BellRing, Users, Zap, Star, FileText,
} from 'lucide-react';
import Section, { FadeIn } from '../../components/marketing/Section';
import { useTranslation } from '../../i18n';
import type { Language } from '../../i18n';

// Copie locale bilingue — les dictionnaires i18n globaux ne couvrent pas ces
// clés et ne doivent pas être modifiés d'ici.
type Bi = Record<Language, string>;

interface Role {
  id: string;
  icon: typeof Briefcase;
  title: Bi;
  subtitle: Bi;
  desc: Bi;
  pain: Bi;
  solution: Bi;
  cta: Bi;
  features: { icon: typeof Briefcase; label: Bi }[];
}

const ROLES: Role[] = [
  {
    id: 'owners',
    icon: Briefcase,
    title: {
      fr: 'Propriétaires & Gestionnaires',
      en: 'Owners & Managers',
    },
    subtitle: {
      fr: 'Votre entreprise, sous contrôle total',
      en: 'Your business, fully under control',
    },
    desc: {
      fr: 'En tant que propriétaire, vous avez besoin de voir l\'ensemble du portrait sans perdre de temps. Lume vous donne un dashboard exécutif avec les métriques qui comptent : revenus, pipeline, performance de l\'équipe, et opérations — en un seul endroit.',
      en: 'As an owner, you need the full picture without wasting time. Lume gives you an executive dashboard with the metrics that matter: revenue, pipeline, team performance, and operations — all in one place.',
    },
    pain: {
      fr: 'Le problème : vous jonglez entre 5 outils pour avoir une vue d\'ensemble de votre business.',
      en: 'The problem: you juggle 5 different tools just to get an overview of your business.',
    },
    solution: {
      fr: 'Avec Lume : un seul dashboard qui vous montre tout ce qui se passe dans votre entreprise.',
      en: 'With Lume: one dashboard that shows you everything happening in your company.',
    },
    cta: {
      fr: 'Voir la démo pour propriétaires',
      en: 'See the demo for owners',
    },
    features: [
      { icon: BarChart3, label: { fr: 'Dashboard exécutif avec KPIs en temps réel', en: 'Executive dashboard with real-time KPIs' } },
      { icon: Kanban, label: { fr: 'Vue globale du pipeline de vente', en: 'Global view of the sales pipeline' } },
      { icon: Users, label: { fr: 'Suivi de performance de chaque membre', en: 'Performance tracking for every member' } },
      { icon: Trophy, label: { fr: 'Leaderboard pour garder l\'équipe motivée', en: 'Leaderboard to keep the team motivated' } },
      { icon: Zap, label: { fr: 'Automatisations pour éliminer le travail manuel', en: 'Automations to eliminate manual work' } },
      { icon: Star, label: { fr: 'Suivi de la réputation et des avis Google', en: 'Reputation and Google reviews tracking' } },
    ],
  },
  {
    id: 'sales',
    icon: Target,
    title: {
      fr: 'Équipes de vente',
      en: 'Sales Teams',
    },
    subtitle: {
      fr: 'Fermez plus de deals, plus vite',
      en: 'Close more deals, faster',
    },
    desc: {
      fr: 'Vos vendeurs ont besoin d\'un pipeline clair, de savoir quand relancer, et d\'être poussés à performer. Lume leur donne exactement ça — sans la complexité d\'un CRM entreprise.',
      en: 'Your salespeople need a clear pipeline, to know when to follow up, and to be pushed to perform. Lume gives them exactly that — without the complexity of an enterprise CRM.',
    },
    pain: {
      fr: 'Le problème : vos vendeurs perdent du temps sur la paperasse au lieu de vendre.',
      en: 'The problem: your salespeople waste time on paperwork instead of selling.',
    },
    solution: {
      fr: 'Avec Lume : un pipeline visuel, des notifications de devis, et un leaderboard qui motive.',
      en: 'With Lume: a visual pipeline, quote notifications, and a leaderboard that motivates.',
    },
    cta: {
      fr: 'Voir la démo pour équipes de vente',
      en: 'See the demo for sales teams',
    },
    features: [
      { icon: Kanban, label: { fr: 'Pipeline visuel pour chaque opportunité', en: 'Visual pipeline for every opportunity' } },
      { icon: BellRing, label: { fr: 'Alerte quand un client ouvre un devis', en: 'Alert when a client opens a quote' } },
      { icon: Trophy, label: { fr: 'Leaderboard et classement entre reps', en: 'Leaderboard and rankings between reps' } },
      { icon: Mic, label: { fr: 'Assistant IA pour créer des leads par la voix', en: 'AI assistant to create leads by voice' } },
      { icon: Zap, label: { fr: 'Suivis automatiques', en: 'Automatic follow-ups' } },
      { icon: BarChart3, label: { fr: 'Métriques de conversion personnelles', en: 'Personal conversion metrics' } },
    ],
  },
  {
    id: 'field',
    icon: MapPin,
    title: {
      fr: 'Équipes terrain & D2D',
      en: 'Field & D2D Teams',
    },
    subtitle: {
      fr: 'Chaque porte, chaque territoire, maîtrisé',
      en: 'Every door, every territory, mastered',
    },
    desc: {
      fr: 'Vos reps terrain ont besoin d\'un outil mobile, rapide et intuitif. La carte D2D de Lume leur montre exactement où aller, quelles portes revisiter, et comment maximiser leur couverture.',
      en: 'Your field reps need a mobile tool that is fast and intuitive. Lume\'s D2D map shows them exactly where to go, which doors to revisit, and how to maximize their coverage.',
    },
    pain: {
      fr: 'Le problème : vos reps terrain travaillent à l\'aveugle, sans data sur les portes visitées.',
      en: 'The problem: your field reps work blind, with no data on the doors they visit.',
    },
    solution: {
      fr: 'Avec Lume : une carte interactive avec historique complet de chaque adresse.',
      en: 'With Lume: an interactive map with the full history of every address.',
    },
    cta: {
      fr: 'Voir la démo pour équipes terrain',
      en: 'See the demo for field teams',
    },
    features: [
      { icon: Map, label: { fr: 'Carte interactive porte-à-porte', en: 'Interactive door-to-door map' } },
      { icon: MapPin, label: { fr: 'Suivi GPS en temps réel', en: 'Real-time GPS tracking' } },
      { icon: UserCircle, label: { fr: 'Historique par adresse et résultat', en: 'History by address and outcome' } },
      { icon: Trophy, label: { fr: 'Badges et défis quotidiens', en: 'Badges and daily challenges' } },
      { icon: FileText, label: { fr: 'Capture de leads sur le terrain', en: 'Lead capture in the field' } },
      { icon: Calendar, label: { fr: 'Planification des tournées', en: 'Route planning' } },
    ],
  },
  {
    id: 'dispatch',
    icon: Headset,
    title: {
      fr: 'Répartiteurs & Admins',
      en: 'Dispatchers & Admins',
    },
    subtitle: {
      fr: 'Planification centralisée, zéro chaos',
      en: 'Centralized scheduling, zero chaos',
    },
    desc: {
      fr: 'Le bureau a besoin de voir qui est où, quand ils sont disponibles, et comment assigner les jobs efficacement. Lume centralise la planification, les disponibilités et le dispatch.',
      en: 'The office needs to see who is where, when they are available, and how to assign jobs efficiently. Lume centralizes scheduling, availability, and dispatch.',
    },
    pain: {
      fr: 'Le problème : la planification se fait sur papier, par texto, ou dans des spreadsheets.',
      en: 'The problem: scheduling happens on paper, by text message, or in spreadsheets.',
    },
    solution: {
      fr: 'Avec Lume : un calendrier centralisé avec dispatch intelligent et vue d\'équipe.',
      en: 'With Lume: a centralized calendar with smart dispatch and a team view.',
    },
    cta: {
      fr: 'Voir la démo pour répartiteurs',
      en: 'See the demo for dispatchers',
    },
    features: [
      { icon: Calendar, label: { fr: 'Calendrier avec vue jour/semaine/mois', en: 'Calendar with day/week/month views' } },
      { icon: Users, label: { fr: 'Vue de disponibilité par membre', en: 'Availability view per member' } },
      { icon: Map, label: { fr: 'Dispatch par zone géographique', en: 'Dispatch by geographic zone' } },
      { icon: BellRing, label: { fr: 'Notifications d\'assignation', en: 'Assignment notifications' } },
      { icon: FileText, label: { fr: 'Gestion des devis et factures', en: 'Quote and invoice management' } },
      { icon: Zap, label: { fr: 'Workflows automatiques', en: 'Automatic workflows' } },
    ],
  },
];

const COPY = {
  en: {
    kicker: 'Solutions',
    titleLine1: 'One tool, built',
    titleLine2: 'for every role',
    subtitle: 'Whether you\'re an owner, a salesperson, a field rep, or a dispatcher — Lume adapts to the way you work.',
    solutionLabel: 'Solution',
  },
  fr: {
    kicker: 'Solutions',
    titleLine1: 'Un outil adapté',
    titleLine2: 'à chaque rôle',
    subtitle: 'Que vous soyez propriétaire, vendeur, rep terrain ou répartiteur — Lume s\'adapte à votre façon de travailler.',
    solutionLabel: 'Solution',
  },
} as const;

export default function Solutions() {
  const { language } = useTranslation();
  const c = COPY[language];
  return (
    <>
      {/* Hero */}
      <section className="pt-28 pb-16 md:pt-36 md:pb-20 px-6 bg-surface">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-primary mb-4">{c.kicker}</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.1]">
            {c.titleLine1}
            <br />
            <span className="italic text-text-secondary">{c.titleLine2}</span>
          </h1>
          <p className="mt-5 text-lg font-normal text-text-tertiary max-w-2xl mx-auto">
            {c.subtitle}
          </p>
        </div>
      </section>

      {/* Role Sections */}
      {ROLES.map((role, i) => (
        <Section key={role.id} id={role.id} bg={i % 2 === 0 ? 'neutral' : 'white'}>
          <FadeIn>
            <div className="max-w-5xl mx-auto">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-surface-tertiary flex items-center justify-center">
                  <role.icon size={20} className="text-primary" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-text-tertiary">{c.solutionLabel}</p>
                  <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-text-primary">{role.title[language]}</h2>
                </div>
              </div>

              <h3 className="text-xl md:text-2xl font-semibold text-text-primary mb-4">{role.subtitle[language]}</h3>
              <p className="text-text-tertiary font-normal leading-relaxed max-w-3xl mb-6">{role.desc[language]}</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="p-4 rounded-xl border border-danger/20 bg-danger-light">
                  <p className="text-sm font-medium text-danger">{role.pain[language]}</p>
                </div>
                <div className="p-4 rounded-xl border border-success/20 bg-success-light">
                  <p className="text-sm font-medium text-success">{role.solution[language]}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {role.features.map(f => (
                  <div key={f.label.en} className="flex items-start gap-3 p-4 rounded-xl border border-outline bg-surface hover:border-text-tertiary transition-colors">
                    <f.icon size={16} className="text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-text-secondary">{f.label[language]}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <Link
                  to="/contact"
                  className="inline-flex items-center gap-2 bg-text-primary text-surface px-6 py-3 rounded-lg text-sm font-medium hover:opacity-85 transition-opacity group"
                >
                  {role.cta[language]}
                  <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            </div>
          </FadeIn>
        </Section>
      ))}
    </>
  );
}
