import React from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Check, Sparkles, X, MessageSquare, Bot, MapPin, GraduationCap, Code, Lock, Zap, Store, Timer, FileText, Shield } from 'lucide-react';
import { useTranslation } from '../i18n';
import type { Plan } from '../lib/billingApi';
import type { PlanFeatureFlag } from '../hooks/usePlanFeature';

interface PlanUpgradeModalProps {
  open: boolean;
  onClose: () => void;
  /** The flag the user is trying to access (e.g. 'includes_sms') */
  flag: PlanFeatureFlag;
  /** The plan that grants the feature (cheapest one) */
  requiredPlan: Plan | null;
  /** The user's current plan (for price comparison) */
  currentPlan: Plan | null;
}

/** Visual + copy metadata for each gated feature */
const FEATURE_META: Record<PlanFeatureFlag, {
  icon: typeof MessageSquare;
  titleEn: string;
  titleFr: string;
  taglineEn: string;
  taglineFr: string;
  benefitsEn: string[];
  benefitsFr: string[];
  gradient: string;
}> = {
  includes_sms: {
    icon: MessageSquare,
    titleEn: 'Two-way SMS messaging',
    titleFr: 'Messagerie SMS bidirectionnelle',
    taglineEn: 'Text your customers from a dedicated number',
    taglineFr: 'Textez vos clients depuis un numéro dédié',
    benefitsEn: [
      'Dedicated Twilio business number',
      'Two-way conversations with customers',
      'Automated quote & invoice follow-ups',
      'Bulk SMS campaigns',
    ],
    benefitsFr: [
      'Numéro Twilio professionnel dédié',
      'Conversations bidirectionnelles avec vos clients',
      'Suivis automatiques de devis et factures',
      'Campagnes SMS en masse',
    ],
    gradient: 'from-blue-600 via-indigo-600 to-purple-600',
  },
  includes_ai: {
    icon: Bot,
    titleEn: 'Lume AI Agent',
    titleFr: 'Agent Lume IA',
    taglineEn: 'Your AI co-pilot for everyday work',
    taglineFr: 'Votre copilote IA pour le travail quotidien',
    benefitsEn: [
      'Voice-activated CRM commands',
      'Automated quote drafting & follow-ups',
      'Smart scheduling suggestions',
      'Customer insights & predictions',
    ],
    benefitsFr: [
      'Commandes CRM activées par la voix',
      'Rédaction automatique de devis et suivis',
      'Suggestions intelligentes de planification',
      'Insights et prédictions clients',
    ],
    gradient: 'from-violet-600 via-fuchsia-600 to-pink-600',
  },
  includes_d2d: {
    icon: MapPin,
    titleEn: 'Door-to-door sales suite',
    titleFr: 'Suite porte-à-porte',
    taglineEn: 'Manage field sales teams at scale',
    taglineFr: 'Gérez vos équipes de vente terrain à grande échelle',
    benefitsEn: [
      'Territory map with live rep tracking',
      'D2D pipeline + leaderboard',
      'Automated commission calculations',
      'Performance analytics per rep',
    ],
    benefitsFr: [
      'Carte de territoire avec suivi des reps en direct',
      'Pipeline D2D + tableau de classement',
      'Calcul automatique des commissions',
      'Analyses de performance par rep',
    ],
    gradient: 'from-emerald-600 via-teal-600 to-cyan-600',
  },
  includes_courses: {
    icon: GraduationCap,
    titleEn: 'Courses & training (LMS)',
    titleFr: 'Formations et LMS',
    taglineEn: 'Onboard and train your team in-house',
    taglineFr: 'Formez et intégrez votre équipe en interne',
    benefitsEn: [
      'Build branded training courses',
      'Track team progress and quiz scores',
      'Onboard new hires faster',
      'Library of pre-built modules',
    ],
    benefitsFr: [
      'Créez des formations à votre image',
      'Suivez les progrès et les notes des quiz',
      'Intégrez les nouveaux employés plus vite',
      'Bibliothèque de modules prêts à l\'emploi',
    ],
    gradient: 'from-amber-500 via-orange-500 to-red-500',
  },
  includes_api: {
    icon: Code,
    titleEn: 'Full API & webhooks',
    titleFr: 'API complète + webhooks',
    taglineEn: 'Integrate Lume with anything',
    taglineFr: 'Intégrez Lume avec tout votre stack',
    benefitsEn: [
      'REST API with full read/write access',
      'Outbound webhooks for any event',
      'Custom integrations with your tools',
      'Higher rate limits',
    ],
    benefitsFr: [
      'API REST avec accès complet lecture/écriture',
      'Webhooks sortants pour tous les événements',
      'Intégrations personnalisées avec vos outils',
      'Limites de taux plus élevées',
    ],
    gradient: 'from-slate-700 via-zinc-700 to-neutral-800',
  },
  includes_automations: {
    icon: Zap,
    titleEn: 'Automations',
    titleFr: 'Automatisations',
    taglineEn: 'Put your busywork on autopilot',
    taglineFr: 'Mettez vos tâches répétitives en pilote automatique',
    benefitsEn: [
      'Automated quote & invoice follow-ups',
      'Trigger actions on any CRM event',
      'Reminders & status updates on their own',
      'Save hours every week',
    ],
    benefitsFr: [
      'Suivis automatiques de devis et factures',
      'Déclenchez des actions sur tout événement du CRM',
      'Rappels et mises à jour de statut automatiques',
      'Économisez des heures chaque semaine',
    ],
    gradient: 'from-amber-500 via-orange-600 to-red-600',
  },
  includes_marketplace: {
    icon: Store,
    titleEn: 'Marketplace & integrations',
    titleFr: 'Marketplace et intégrations',
    taglineEn: 'Connect Lume to the tools you already use',
    taglineFr: 'Connectez Lume aux outils que vous utilisez déjà',
    benefitsEn: [
      'Marketplace integrations & webhooks',
      'QuickBooks, Mailchimp & more',
      'Sync data across your stack',
      'Custom request forms',
    ],
    benefitsFr: [
      'Intégrations Marketplace et webhooks',
      'QuickBooks, Mailchimp et plus',
      'Synchronisez vos données entre vos outils',
      'Formulaires de demande personnalisés',
    ],
    gradient: 'from-emerald-600 via-teal-600 to-cyan-700',
  },
  includes_timesheets: {
    icon: Timer,
    titleEn: 'Employee timesheets',
    titleFr: "Feuilles de temps",
    taglineEn: 'Track your team\'s hours & performance',
    taglineFr: "Suivez les heures et la performance de ton équipe",
    benefitsEn: [
      'Clock in / out per employee',
      'Hours per job & per client',
      'Labour cost on jobs',
      'Team performance tracking',
    ],
    benefitsFr: [
      'Pointer l\'arrivée / départ par employé',
      'Heures par job et par client',
      'Coût de main-d\'œuvre sur les jobs',
      'Suivi de performance de l\'équipe',
    ],
    gradient: 'from-sky-600 via-blue-600 to-indigo-700',
  },
  includes_request_forms: {
    icon: FileText,
    titleEn: 'Custom request forms',
    titleFr: 'Formulaires de demande personnalisés',
    taglineEn: 'Capture leads with branded online forms',
    taglineFr: 'Capte des leads avec des formulaires en ligne à ta marque',
    benefitsEn: [
      'Branded, shareable request forms',
      'Leads flow straight into your pipeline',
      'Custom fields for your business',
      'Embed on your website',
    ],
    benefitsFr: [
      'Formulaires de demande à ta marque, partageables',
      'Les leads tombent direct dans ton pipeline',
      'Champs personnalisés pour ta business',
      'Intègre-les sur ton site web',
    ],
    gradient: 'from-violet-600 via-purple-600 to-fuchsia-700',
  },
  includes_advanced_roles: {
    icon: Shield,
    titleEn: 'Advanced roles & multi-team',
    titleFr: 'Rôles avancés & multi-équipes',
    taglineEn: 'Fine-grained control for bigger teams',
    taglineFr: 'Un contrôle précis pour les plus grosses équipes',
    benefitsEn: [
      'Custom roles & granular permissions',
      'Multiple teams & offices',
      'Scope what each member can see & do',
      'Manager hierarchies',
    ],
    benefitsFr: [
      'Rôles personnalisés & permissions granulaires',
      'Plusieurs équipes & bureaux',
      'Contrôle ce que chaque membre voit et fait',
      'Hiérarchies de gestionnaires',
    ],
    gradient: 'from-rose-600 via-red-600 to-orange-700',
  },
};

export default function PlanUpgradeModal({ open, onClose, flag, requiredPlan, currentPlan }: PlanUpgradeModalProps) {
  const { language } = useTranslation();
  const navigate = useNavigate();
  const isFr = language === 'fr';

  if (!open) return null;

  const meta = FEATURE_META[flag];
  const FeatureIcon = meta.icon;

  const title = isFr ? meta.titleFr : meta.titleEn;
  const tagline = isFr ? meta.taglineFr : meta.taglineEn;
  const benefits = isFr ? meta.benefitsFr : meta.benefitsEn;

  const currentPrice = currentPlan ? Math.round(currentPlan.monthly_price_usd / 100) : null;
  const requiredPrice = requiredPlan ? Math.round(requiredPlan.monthly_price_usd / 100) : null;
  const priceDelta = requiredPrice && currentPrice ? requiredPrice - currentPrice : requiredPrice;

  const handleUpgrade = () => {
    onClose();
    navigate('/settings/billing');
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="relative bg-surface-card rounded-3xl shadow-2xl max-w-lg w-full my-8 overflow-hidden border border-outline-subtle"
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur text-white flex items-center justify-center transition-colors"
          aria-label="Close"
        >
          <X size={15} strokeWidth={2.5} />
        </button>

        {/* Hero gradient header with feature icon */}
        <div className={`relative px-8 pt-12 pb-10 bg-gradient-to-br ${meta.gradient} overflow-hidden`}>
          {/* Decorative blobs */}
          <div className="absolute inset-0 opacity-20" aria-hidden="true">
            <svg className="absolute -top-16 -right-16 w-72 h-72" viewBox="0 0 200 200" fill="none">
              <path fill="white" d="M37.6,-50.7C49.4,-44.4,60.1,-34.9,65.4,-22.5C70.7,-10.1,70.6,5.3,65.4,18.9C60.2,32.5,49.9,44.4,37.4,53.1C24.9,61.9,10.3,67.6,-4.2,73.1C-18.7,78.7,-37.5,84.2,-49.7,77.3C-61.9,70.4,-67.5,51.2,-71.7,33.4C-76,15.7,-78.9,-0.6,-74.4,-14.6C-69.9,-28.7,-58,-40.5,-44.7,-46.6C-31.5,-52.6,-15.7,-52.9,-1.7,-50.5C12.3,-48.2,25.9,-57,37.6,-50.7Z" transform="translate(100 100)" />
            </svg>
            <svg className="absolute -bottom-20 -left-20 w-96 h-96" viewBox="0 0 200 200" fill="none">
              <path fill="white" d="M44.7,-71.8C58.7,-65.1,71.1,-54,77.4,-40.3C83.7,-26.7,84,-10.4,80.7,4.6C77.4,19.7,70.5,33.6,60.8,44.7C51.1,55.9,38.6,64.3,24.6,69.4C10.6,74.6,-4.9,76.5,-19.2,73.1C-33.6,69.7,-46.7,61,-57.4,49.4C-68.1,37.7,-76.4,23.1,-78,7.5C-79.6,-8.2,-74.6,-24.9,-66,-39.1C-57.4,-53.3,-45.4,-65.1,-31.8,-71.6C-18.3,-78.2,-3.2,-79.5,11.4,-77.6C26,-75.7,38.7,-78.4,44.7,-71.8Z" transform="translate(100 100)" />
            </svg>
          </div>

          <div className="relative text-white">
            <div className="flex items-center gap-2 mb-4">
              <Lock size={12} />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
                {isFr ? 'Fonctionnalité premium' : 'Premium feature'}
              </p>
            </div>

            <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mb-5 ring-2 ring-white/20">
              <FeatureIcon size={28} strokeWidth={2} />
            </div>

            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">{title}</h2>
            <p className="text-[14px] text-white/85 mt-2">{tagline}</p>
          </div>
        </div>

        {/* Plan requirement badge */}
        {requiredPlan && (
          <div className="px-8 py-4 bg-primary/5 border-b border-primary/15 flex items-center gap-3">
            <Sparkles size={16} className="text-primary shrink-0" />
            <p className="text-[13px] text-text-primary">
              {isFr ? `Inclus dans le plan ` : `Included with the `}
              <span className="font-extrabold">Lume {requiredPlan.name}</span>
              {isFr ? ` et supérieurs` : ` plan and above`}
            </p>
          </div>
        )}

        {/* Benefits list */}
        <div className="px-8 py-6">
          <p className="text-[11px] uppercase tracking-wider font-bold text-text-tertiary mb-3">
            {isFr ? 'Ce que vous débloquez' : `What you'll unlock`}
          </p>
          <ul className="space-y-2.5">
            {benefits.map((benefit, i) => (
              <li key={i} className="flex items-start gap-3 text-[13px] text-text-primary">
                <div className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center mt-0.5">
                  <Check size={11} className="text-emerald-600" strokeWidth={3} />
                </div>
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Price comparison */}
        {requiredPlan && requiredPrice != null && (
          <div className="mx-8 mb-6 p-4 rounded-2xl bg-surface-secondary/40 border border-outline-subtle">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider font-bold text-text-tertiary">
                  {isFr ? 'Passer à Lume ' : 'Upgrade to Lume '} {requiredPlan.name}
                </p>
                <p className="text-2xl font-extrabold text-text-primary mt-1 tabular-nums">
                  ${requiredPrice}
                  <span className="text-sm font-normal text-text-tertiary">/{isFr ? 'mois' : 'mo'}</span>
                </p>
              </div>
              {currentPrice != null && priceDelta && priceDelta > 0 && (
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-text-tertiary">
                    {isFr ? 'Différence' : 'Difference'}
                  </p>
                  <p className="text-sm font-bold text-text-primary tabular-nums">
                    +${priceDelta}/{isFr ? 'mois' : 'mo'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-8 pb-7 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-3 rounded-xl text-[13px] font-medium text-text-tertiary hover:text-text-secondary border border-outline-subtle hover:border-outline transition-colors"
          >
            {isFr ? 'Plus tard' : 'Maybe later'}
          </button>
          <button
            type="button"
            onClick={handleUpgrade}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-[13px] font-extrabold bg-text-primary text-surface hover:bg-text-primary/90 active:scale-[0.98] transition-all shadow-md"
          >
            <Sparkles size={14} />
            {requiredPlan
              ? (isFr ? `Passer à ${requiredPlan.name}` : `Upgrade to ${requiredPlan.name}`)
              : (isFr ? 'Mettre à niveau' : 'Upgrade')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
