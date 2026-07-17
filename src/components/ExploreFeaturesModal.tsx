import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { X, Sparkles, Check, MessageSquare, Bot, MapPin, GraduationCap, Code, Lock, ArrowRight } from 'lucide-react';
import { useTranslation } from '../i18n';
import { useCurrentPlan, type PlanFeatureFlag } from '../hooks/usePlanFeature';
import type { Plan } from '../lib/billingApi';
import { FEATURE_MOCKUPS } from './featureMockups';

interface ExploreFeaturesModalProps {
  open: boolean;
  onClose: () => void;
}

interface FeatureCard {
  flag: PlanFeatureFlag;
  icon: typeof MessageSquare;
  gradient: string;
  titleEn: string;
  titleFr: string;
  taglineEn: string;
  taglineFr: string;
  benefitsEn: string[];
  benefitsFr: string[];
  visualEn: string;
  visualFr: string;
}

const FEATURES: FeatureCard[] = [
  {
    flag: 'includes_sms',
    icon: MessageSquare,
    gradient: 'from-blue-600 via-indigo-600 to-purple-600',
    titleEn: 'Two-way SMS messaging',
    titleFr: 'Messagerie SMS bidirectionnelle',
    taglineEn: 'Text customers from a dedicated business number',
    taglineFr: 'Textez vos clients depuis un numéro professionnel dédié',
    benefitsEn: [
      'Dedicated Twilio business number per workspace',
      'Real-time two-way conversations with customers',
      'Automated quote & invoice follow-ups',
      'Bulk SMS campaigns with templates',
      'Threaded message history & search',
    ],
    benefitsFr: [
      'Numéro Twilio professionnel dédié par espace',
      'Conversations bidirectionnelles en temps réel',
      'Suivis automatiques de devis et factures',
      'Campagnes SMS en masse avec modèles',
      'Historique de messages avec recherche',
    ],
    visualEn: '“Hi John, your quote is ready 👍” — sent at 9:01',
    visualFr: '«Bonjour Jean, votre devis est prêt 👍» — envoyé à 9h01',
  },
  {
    flag: 'includes_ai',
    icon: Bot,
    gradient: 'from-violet-600 via-fuchsia-600 to-pink-600',
    titleEn: 'Lume AI Agent',
    titleFr: 'Agent Lume IA',
    taglineEn: 'Your AI copilot for everyday CRM work',
    taglineFr: 'Votre copilote IA pour le travail quotidien',
    benefitsEn: [
      'Voice-activated CRM commands (hands-free)',
      'Drafts quotes, emails & SMS in your tone',
      'Smart scheduling & routing suggestions',
      'Customer insights & churn predictions',
      'Unlimited interactions on Autopilot',
    ],
    benefitsFr: [
      'Commandes CRM activées par la voix',
      'Rédige devis, emails et SMS dans votre ton',
      'Suggestions de planification et de routes',
      'Insights clients et prédictions de churn',
      'Interactions illimitées sur Autopilot',
    ],
    visualEn: '🎙️ “Send John a follow-up about quote #2024-08” → done',
    visualFr: '🎙️ «Envoie un suivi à Jean pour le devis #2024-08» → fait',
  },
  {
    flag: 'includes_d2d',
    icon: MapPin,
    gradient: 'from-emerald-600 via-teal-600 to-cyan-600',
    titleEn: 'Door-to-door sales suite',
    titleFr: 'Suite porte-à-porte',
    taglineEn: 'Field sales teams, tracked at scale',
    taglineFr: 'Vos équipes terrain, gérées à grande échelle',
    benefitsEn: [
      'Live territory map with rep GPS tracking',
      'D2D pipeline with custom stages',
      'Leaderboard & gamification per rep',
      'Automated commission calculations',
      'Performance analytics & heatmaps',
    ],
    benefitsFr: [
      'Carte de territoire avec suivi GPS des reps',
      'Pipeline D2D avec étapes personnalisées',
      'Tableau de classement et gamification',
      'Calcul automatique des commissions',
      'Analyses de performance et cartes de chaleur',
    ],
    visualEn: 'Top rep this week: Sarah · 12 deals · $8,450 commission',
    visualFr: 'Top rep cette semaine : Sarah · 12 ventes · $8,450 commission',
  },
  {
    flag: 'includes_courses',
    icon: GraduationCap,
    gradient: 'from-amber-500 via-orange-500 to-red-500',
    titleEn: 'Courses & in-house LMS',
    titleFr: 'Formations et LMS interne',
    taglineEn: 'Onboard and train your team like a pro',
    taglineFr: 'Formez votre équipe comme un pro',
    benefitsEn: [
      'Build branded courses with video & quizzes',
      'Track progress and quiz scores per employee',
      'Library of pre-built service industry modules',
      'Certificates upon completion',
      'Onboard new hires 3x faster',
    ],
    benefitsFr: [
      'Créez des cours à votre image (vidéo + quiz)',
      'Suivez les progrès et notes par employé',
      'Bibliothèque de modules prêts à l\'emploi',
      'Certificats à la complétion',
      'Intégrez les nouveaux 3x plus vite',
    ],
    visualEn: '“Window cleaning safety 101” — 12/15 employees completed',
    visualFr: '«Sécurité lavage de vitres 101» — 12/15 employés complété',
  },
  {
    flag: 'includes_api',
    icon: Code,
    gradient: 'from-slate-700 via-zinc-700 to-neutral-800',
    titleEn: 'Full API & webhooks',
    titleFr: 'API complète et webhooks',
    taglineEn: 'Integrate Lume with anything in your stack',
    taglineFr: 'Intégrez Lume avec tout votre stack',
    benefitsEn: [
      'REST API with full read/write access',
      'Outbound webhooks for any CRM event',
      'OAuth-based custom integrations',
      'Higher rate limits',
      'Dedicated developer support',
    ],
    benefitsFr: [
      'API REST avec accès complet lecture/écriture',
      'Webhooks sortants pour tous les événements',
      'Intégrations personnalisées OAuth',
      'Limites de taux plus élevées',
      'Support développeur dédié',
    ],
    visualEn: 'POST /api/v1/clients → 201 Created · webhook fired',
    visualFr: 'POST /api/v1/clients → 201 Created · webhook déclenché',
  },
];

export default function ExploreFeaturesModal({ open, onClose }: ExploreFeaturesModalProps) {
  const { language } = useTranslation();
  const navigate = useNavigate();
  const { currentPlan, plans } = useCurrentPlan();
  const isFr = language === 'fr';

  if (!open) return null;

  // Show only features the user does NOT currently have
  const lockedFeatures = FEATURES.filter((f) => !currentPlan || !(currentPlan as any)[f.flag]);

  if (lockedFeatures.length === 0) {
    return (
      <div
        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-surface-card rounded-3xl shadow-2xl max-w-md w-full p-10 text-center border border-outline-subtle"
        >
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center mb-5">
            <Check size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-extrabold text-text-primary">
            {isFr ? 'Vous avez tout débloqué !' : 'You\'ve unlocked everything!'}
          </h2>
          <p className="text-sm text-text-secondary mt-2">
            {isFr
              ? `Vous profitez de toutes les fonctionnalités Lume sur le plan ${currentPlan?.name}.`
              : `You're enjoying every Lume feature on the ${currentPlan?.name} plan.`}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 px-5 py-2.5 rounded-xl bg-text-primary text-surface text-sm font-bold hover:bg-text-primary/90 transition-colors"
          >
            {isFr ? 'Fermer' : 'Close'}
          </button>
        </motion.div>
      </div>
    );
  }

  // Lookup the required plan name for each feature (cheapest plan that grants it)
  const requiredPlanFor = (flag: PlanFeatureFlag): Plan | null => {
    return plans
      .filter((p) => Boolean((p as any)[flag]))
      .sort((a, b) => (a.monthly_price_usd || 0) - (b.monthly_price_usd || 0))[0] ?? null;
  };

  const handleUpgrade = () => {
    onClose();
    navigate('/settings/billing');
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 32, scale: 0.97 }}
          transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="relative bg-surface-card rounded-t-3xl sm:rounded-3xl shadow-2xl max-w-3xl w-full max-h-[92vh] sm:my-8 overflow-hidden border border-outline-subtle flex flex-col"
        >
          {/* Sticky header */}
          <div className="sticky top-0 z-10 bg-surface-card/95 backdrop-blur-lg border-b border-outline-subtle px-6 sm:px-8 py-5 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles size={14} className="text-primary" />
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-tertiary">
                  {isFr ? 'Explorer' : 'Explore'}
                </p>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-text-primary tracking-tight">
                {isFr ? 'Découvrez ce qui vous attend' : 'Discover what\'s waiting for you'}
              </h2>
              <p className="text-[12px] text-text-secondary mt-1">
                {isFr
                  ? `${lockedFeatures.length} fonctionnalités premium disponibles dans les plans supérieurs`
                  : `${lockedFeatures.length} premium features available on higher plans`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 w-9 h-9 rounded-full bg-surface-secondary hover:bg-surface-tertiary text-text-secondary flex items-center justify-center transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable feature list */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">
            {lockedFeatures.map((feature) => {
              const requiredPlan = requiredPlanFor(feature.flag);
              const Icon = feature.icon;
              const title = isFr ? feature.titleFr : feature.titleEn;
              const tagline = isFr ? feature.taglineFr : feature.taglineEn;
              const benefits = isFr ? feature.benefitsFr : feature.benefitsEn;
              const visual = isFr ? feature.visualFr : feature.visualEn;

              return (
                <motion.div
                  key={feature.flag}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-2xl overflow-hidden border border-outline-subtle bg-surface-card"
                >
                  {/* Feature hero */}
                  <div className={`relative px-6 py-6 bg-gradient-to-br ${feature.gradient} text-white overflow-hidden`}>
                    {/* Decorative blob */}
                    <div className="absolute inset-0 opacity-15 pointer-events-none" aria-hidden="true">
                      <svg className="absolute -top-8 -right-8 w-44 h-44" viewBox="0 0 200 200" fill="none">
                        <path fill="white" d="M44.7,-71.8C58.7,-65.1,71.1,-54,77.4,-40.3C83.7,-26.7,84,-10.4,80.7,4.6C77.4,19.7,70.5,33.6,60.8,44.7C51.1,55.9,38.6,64.3,24.6,69.4C10.6,74.6,-4.9,76.5,-19.2,73.1C-33.6,69.7,-46.7,61,-57.4,49.4C-68.1,37.7,-76.4,23.1,-78,7.5C-79.6,-8.2,-74.6,-24.9,-66,-39.1C-57.4,-53.3,-45.4,-65.1,-31.8,-71.6C-18.3,-78.2,-3.2,-79.5,11.4,-77.6C26,-75.7,38.7,-78.4,44.7,-71.8Z" transform="translate(100 100)" />
                      </svg>
                    </div>
                    <div className="relative flex items-start gap-4">
                      <div className="shrink-0 w-12 h-12 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center ring-1 ring-white/20">
                        <Icon size={22} strokeWidth={2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Lock size={10} className="text-white/70" />
                          {requiredPlan && (
                            <p className="text-[9px] font-bold uppercase tracking-widest text-white/80">
                              {isFr ? `Plan ${requiredPlan.name}+` : `${requiredPlan.name}+ plan`}
                            </p>
                          )}
                        </div>
                        <h3 className="text-lg sm:text-xl font-extrabold tracking-tight">{title}</h3>
                        <p className="text-[12px] text-white/85 mt-1">{tagline}</p>
                      </div>
                    </div>
                  </div>

                  {/* Visual mockup */}
                  {(() => {
                    const Mockup = FEATURE_MOCKUPS[feature.flag];
                    if (!Mockup) return null;
                    return (
                      <div className="border-b border-outline-subtle">
                        <Mockup isFr={isFr} />
                      </div>
                    );
                  })()}

                  {/* Benefits */}
                  <div className="px-6 py-5">
                    <ul className="space-y-2">
                      {benefits.map((benefit, bi) => (
                        <li key={bi} className="flex items-start gap-2.5 text-[13px] text-text-primary">
                          <div className="shrink-0 w-4 h-4 rounded-full bg-emerald-500/15 flex items-center justify-center mt-0.5">
                            <Check size={9} className="text-emerald-600" strokeWidth={3} />
                          </div>
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              );
            })}

            {/* Closing CTA card */}
            <div className="rounded-2xl p-6 text-center bg-gradient-to-br from-primary/10 via-surface-card to-transparent border border-primary/20">
              <div className="w-12 h-12 mx-auto rounded-full bg-primary/15 flex items-center justify-center mb-3">
                <Sparkles size={20} className="text-primary" />
              </div>
              <h3 className="text-base font-extrabold text-text-primary">
                {isFr ? 'Prêt à débloquer plus?' : 'Ready to unlock more?'}
              </h3>
              <p className="text-[13px] text-text-secondary mt-1 max-w-md mx-auto">
                {isFr
                  ? 'Mettez à niveau votre plan en quelques clics. Sans engagement, annulable à tout moment.'
                  : 'Upgrade in a few clicks. No commitment, cancel anytime.'}
              </p>
            </div>
          </div>

          {/* Sticky footer CTA */}
          <div className="sticky bottom-0 z-10 bg-surface-card/95 backdrop-blur-lg border-t border-outline-subtle px-6 sm:px-8 py-4 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {isFr ? 'Plus tard' : 'Maybe later'}
            </button>
            <button
              type="button"
              onClick={handleUpgrade}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-extrabold bg-text-primary text-surface hover:bg-text-primary/90 active:scale-[0.98] transition-all shadow-md"
            >
              <Sparkles size={13} />
              {isFr ? 'Voir les plans' : 'See plans'}
              <ArrowRight size={13} />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
