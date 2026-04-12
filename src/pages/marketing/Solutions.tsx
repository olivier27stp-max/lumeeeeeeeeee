import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase, UserCircle, MapPin, Headset, Target,
  BarChart3, Trophy, Kanban, Map, Calendar, Mic,
  BellRing, Users, Zap, Star, FileText,
} from 'lucide-react';
import Section, { FadeIn } from '../../components/marketing/Section';

const ROLES = [
  {
    id: 'owners',
    icon: Briefcase,
    title: 'Propriétaires & Gestionnaires',
    subtitle: 'Votre entreprise, sous contrôle total',
    desc: 'En tant que propriétaire, vous avez besoin de voir l\'ensemble du portrait sans perdre de temps. Lume vous donne un dashboard exécutif avec les métriques qui comptent : revenus, pipeline, performance de l\'équipe, et opérations — en un seul endroit.',
    pain: 'Le problème : vous jonglez entre 5 outils pour avoir une vue d\'ensemble de votre business.',
    solution: 'Avec Lume : un seul dashboard qui vous montre tout ce qui se passe dans votre entreprise.',
    features: [
      { icon: BarChart3, label: 'Dashboard exécutif avec KPIs en temps réel' },
      { icon: Kanban, label: 'Vue globale du pipeline de vente' },
      { icon: Users, label: 'Suivi de performance de chaque membre' },
      { icon: Trophy, label: 'Leaderboard pour garder l\'équipe motivée' },
      { icon: Zap, label: 'Automatisations pour éliminer le travail manuel' },
      { icon: Star, label: 'Suivi de la réputation et des avis Google' },
    ],
  },
  {
    id: 'sales',
    icon: Target,
    title: 'Équipes de vente',
    subtitle: 'Fermez plus de deals, plus vite',
    desc: 'Vos vendeurs ont besoin d\'un pipeline clair, de savoir quand relancer, et d\'être poussés à performer. Lume leur donne exactement ça — sans la complexité d\'un CRM entreprise.',
    pain: 'Le problème : vos vendeurs perdent du temps sur la paperasse au lieu de vendre.',
    solution: 'Avec Lume : un pipeline visuel, des notifications de devis, et un leaderboard qui motive.',
    features: [
      { icon: Kanban, label: 'Pipeline visuel pour chaque opportunité' },
      { icon: BellRing, label: 'Alerte quand un client ouvre un devis' },
      { icon: Trophy, label: 'Leaderboard et classement entre reps' },
      { icon: Mic, label: 'Assistant IA pour créer des leads par la voix' },
      { icon: Zap, label: 'Suivis automatiques' },
      { icon: BarChart3, label: 'Métriques de conversion personnelles' },
    ],
  },
  {
    id: 'field',
    icon: MapPin,
    title: 'Équipes terrain & D2D',
    subtitle: 'Chaque porte, chaque territoire, maîtrisé',
    desc: 'Vos reps terrain ont besoin d\'un outil mobile, rapide et intuitif. La carte D2D de Lume leur montre exactement où aller, quelles portes revisiter, et comment maximiser leur couverture.',
    pain: 'Le problème : vos reps terrain travaillent à l\'aveugle, sans data sur les portes visitées.',
    solution: 'Avec Lume : une carte interactive avec historique complet de chaque adresse.',
    features: [
      { icon: Map, label: 'Carte interactive porte-à-porte' },
      { icon: MapPin, label: 'Suivi GPS en temps réel' },
      { icon: UserCircle, label: 'Historique par adresse et résultat' },
      { icon: Trophy, label: 'Badges et défis quotidiens' },
      { icon: FileText, label: 'Capture de leads sur le terrain' },
      { icon: Calendar, label: 'Planification des tournées' },
    ],
  },
  {
    id: 'dispatch',
    icon: Headset,
    title: 'Répartiteurs & Admins',
    subtitle: 'Planification centralisée, zéro chaos',
    desc: 'Le bureau a besoin de voir qui est où, quand ils sont disponibles, et comment assigner les jobs efficacement. Lume centralise la planification, les disponibilités et le dispatch.',
    pain: 'Le problème : la planification se fait sur papier, par texto, ou dans des spreadsheets.',
    solution: 'Avec Lume : un calendrier centralisé avec dispatch intelligent et vue d\'équipe.',
    features: [
      { icon: Calendar, label: 'Calendrier avec vue jour/semaine/mois' },
      { icon: Users, label: 'Vue de disponibilité par membre' },
      { icon: Map, label: 'Dispatch par zone géographique' },
      { icon: BellRing, label: 'Notifications d\'assignation' },
      { icon: FileText, label: 'Gestion des devis et factures' },
      { icon: Zap, label: 'Workflows automatiques' },
    ],
  },
];

export default function Solutions() {
  return (
    <>
      {/* Hero */}
      <section className="pt-28 pb-16 md:pt-36 md:pb-20 px-6 bg-surface">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-primary mb-4">Solutions</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.1]">
            Un outil adapté
            <br />
            <span className="italic text-text-secondary">à chaque rôle</span>
          </h1>
          <p className="mt-5 text-lg font-normal text-text-tertiary max-w-2xl mx-auto">
            Que vous soyez propriétaire, vendeur, rep terrain ou répartiteur — Lume s'adapte à votre façon de travailler.
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
                  <p className="text-[10px] uppercase tracking-[0.15em] font-semibold text-text-tertiary">Solution</p>
                  <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-text-primary">{role.title}</h2>
                </div>
              </div>

              <h3 className="text-xl md:text-2xl font-semibold text-text-primary mb-4">{role.subtitle}</h3>
              <p className="text-text-tertiary font-normal leading-relaxed max-w-3xl mb-6">{role.desc}</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <div className="p-4 rounded-xl border border-danger/20 bg-danger-light">
                  <p className="text-sm font-medium text-danger">{role.pain}</p>
                </div>
                <div className="p-4 rounded-xl border border-success/20 bg-success-light">
                  <p className="text-sm font-medium text-success">{role.solution}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {role.features.map(f => (
                  <div key={f.label} className="flex items-start gap-3 p-4 rounded-xl border border-outline bg-surface hover:border-text-tertiary transition-colors">
                    <f.icon size={16} className="text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-text-secondary">{f.label}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <Link
                  to="/contact"
                  className="inline-flex items-center gap-2 bg-text-primary text-surface px-6 py-3 rounded-lg text-sm font-medium hover:opacity-85 transition-opacity group"
                >
                  Voir la démo pour {role.title.toLowerCase().split(' ')[0] === 'propriétaires' ? 'propriétaires' : role.title.toLowerCase()}
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
