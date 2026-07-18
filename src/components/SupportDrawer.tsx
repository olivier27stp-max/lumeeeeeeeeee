import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, ChevronDown, LifeBuoy, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { Z } from '../lib/zIndex';
import { useTranslation } from '../i18n';
import SupportPanel from './SupportPanel';

/**
 * Side drawer for in-app help: searchable FAQ on top, contact form behind a
 * button at the bottom. Answers live in code (no help-center infrastructure),
 * so they must stay short and point at a real page in the app.
 */

export interface Article {
  id: string;
  /** Route the answer refers to; the drawer offers to navigate there. */
  path?: string;
  q_fr: string;
  q_en: string;
  a_fr: string;
  a_en: string;
  /** Extra search terms that don't appear in the question/answer text. */
  tags: string;
}

export const ARTICLES: Article[] = [
  {
    id: 'quote-to-invoice',
    path: '/quotes',
    q_fr: 'Comment transformer un devis en facture ?',
    q_en: 'How do I turn a quote into an invoice?',
    a_fr: "Ouvrez le devis approuvé, puis utilisez l'action « Convertir en facture ». Les articles, prix et taxes sont repris automatiquement — vous n'avez qu'à vérifier la date d'échéance avant d'envoyer.",
    a_en: 'Open the approved quote and use the “Convert to invoice” action. Line items, pricing and taxes carry over automatically — just confirm the due date before sending.',
    tags: 'devis soumission facture invoice quote convertir',
  },
  {
    id: 'get-paid',
    path: '/payments',
    q_fr: 'Comment me faire payer par carte ?',
    q_en: 'How do I get paid by card?',
    a_fr: "Activez Lume Payments dans Paramètres → Lume Payments. Une fois votre compte connecté, chaque facture envoyée contient un bouton de paiement, et l'argent est déposé automatiquement dans votre compte bancaire.",
    a_en: 'Enable Lume Payments under Settings → Lume Payments. Once your account is connected, every invoice you send includes a payment button and funds are deposited to your bank automatically.',
    tags: 'paiement carte credit stripe argent depot payout encaisser',
  },
  {
    id: 'add-member',
    path: '/manage-team',
    q_fr: 'Comment ajouter un employé à mon équipe ?',
    q_en: 'How do I add an employee to my team?',
    a_fr: "Allez dans Paramètres → Membres, puis invitez la personne par courriel. Elle recevra un lien pour créer son compte. Si votre forfait n'a plus de sièges disponibles, un siège supplémentaire vous sera facturé au prorata.",
    a_en: 'Go to Settings → Members and invite the person by email. They get a link to set up their account. If your plan is out of seats, an extra seat is billed pro rata.',
    tags: 'equipe employe membre inviter siege seat utilisateur team',
  },
  {
    id: 'permissions',
    path: '/settings/roles',
    q_fr: 'Comment limiter ce qu\'un employé peut voir ?',
    q_en: 'How do I limit what an employee can see?',
    a_fr: 'Dans Paramètres → Rôles & Permissions, choisissez le rôle du membre ou créez-en un sur mesure. Vous contrôlez l\'accès module par module : finances, clients, horaire, etc.',
    a_en: 'Under Settings → Roles & Permissions, pick the member’s role or build a custom one. You control access module by module: finances, clients, schedule, and so on.',
    tags: 'permission role acces droit securite restreindre cacher',
  },
  {
    id: 'schedule-job',
    path: '/calendar',
    q_fr: 'Comment planifier un travail dans le calendrier ?',
    q_en: 'How do I schedule a job on the calendar?',
    a_fr: "Depuis le Calendrier, cliquez sur une plage horaire, ou ouvrez un travail existant et assignez-lui une date et un employé. La vue Répartition permet de déplacer les visites par glisser-déposer.",
    a_en: 'From the Calendar, click a time slot, or open an existing job and assign it a date and an employee. The Dispatch view lets you drag visits around.',
    tags: 'calendrier horaire planifier cedule job travail visite dispatch',
  },
  {
    id: 'recurring',
    path: '/jobs',
    q_fr: 'Comment créer un travail récurrent ?',
    q_en: 'How do I create a recurring job?',
    a_fr: "À la création du travail, choisissez une récurrence (hebdomadaire, mensuelle, etc.). Lume génère les visites à l'avance ; vous pouvez modifier ou annuler une occurrence sans toucher aux autres.",
    a_en: 'When creating the job, pick a recurrence (weekly, monthly, and so on). Lume generates the visits ahead of time, and you can edit or cancel a single occurrence without affecting the rest.',
    tags: 'recurrent repetition contrat hebdomadaire mensuel abonnement client',
  },
  {
    id: 'sms',
    path: '/settings/messaging',
    q_fr: 'Comment envoyer des SMS à mes clients ?',
    q_en: 'How do I text my clients?',
    a_fr: "La messagerie SMS s'active dans Paramètres → Messagerie SMS. Un numéro local vous est attribué avec les forfaits qui incluent les SMS. Vous pouvez ensuite envoyer des rappels de rendez-vous automatiques.",
    a_en: 'SMS messaging is set up under Settings → SMS Messaging. A local number is provisioned on plans that include SMS. From there you can send automatic appointment reminders.',
    tags: 'sms texto message rappel numero telephone twilio',
  },
  {
    id: 'automations',
    path: '/automations',
    q_fr: 'Comment automatiser les rappels et les suivis ?',
    q_en: 'How do I automate reminders and follow-ups?',
    a_fr: "Dans Automatisations, créez une règle du type « quand un devis est approuvé → envoyer un courriel ». Les rappels de rendez-vous et les relances de factures impayées sont les plus utilisés.",
    a_en: 'Under Automations, build a rule such as “when a quote is approved → send an email.” Appointment reminders and overdue-invoice follow-ups are the most common ones.',
    tags: 'automatisation automation rappel relance suivi workflow declencheur',
  },
  {
    id: 'change-plan',
    path: '/settings/billing',
    q_fr: 'Comment changer ou annuler mon forfait ?',
    q_en: 'How do I change or cancel my plan?',
    a_fr: "Tout se passe dans Paramètres → Forfait & facturation. Une amélioration prend effet immédiatement (montant ajusté au prorata) ; une rétrogradation ou une annulation prend effet à la fin de la période déjà payée.",
    a_en: 'Everything is under Settings → Plan & billing. Upgrades take effect immediately with a pro-rata charge; downgrades and cancellations take effect at the end of the period you already paid for.',
    tags: 'forfait plan abonnement annuler upgrade downgrade facturation prix',
  },
  {
    id: 'invoice-unpaid',
    path: '/invoices',
    q_fr: 'Un client n\'a pas payé sa facture — que faire ?',
    q_en: 'A client hasn’t paid their invoice — what now?',
    a_fr: "La facture apparaît comme « en retard » dans Factures. Vous pouvez la renvoyer en un clic, ou configurer une relance automatique dans Automatisations pour que Lume s'en occupe à votre place.",
    a_en: 'The invoice shows as overdue under Invoices. You can resend it in one click, or set up an automatic follow-up under Automations so Lume chases it for you.',
    tags: 'impaye retard relance facture overdue rappel argent du',
  },
  {
    id: 'import-clients',
    path: '/clients',
    q_fr: 'Puis-je importer ma liste de clients ?',
    q_en: 'Can I import my client list?',
    a_fr: "Oui. Depuis la page Clients, utilisez l'import par fichier CSV. Prévoyez au minimum le nom et un moyen de contact (courriel ou téléphone) par ligne. Écrivez-nous si votre fichier vient d'un autre logiciel, on peut vous aider à le préparer.",
    a_en: 'Yes. From the Clients page, use the CSV import. Each row needs at least a name and one way to reach them (email or phone). Message us if your file comes from another tool — we can help you prep it.',
    tags: 'import importer csv excel migration client contact transferer',
  },
  {
    id: 'mobile',
    q_fr: 'Est-ce que Lume fonctionne sur téléphone ?',
    q_en: 'Does Lume work on a phone?',
    a_fr: "Oui, Lume s'adapte au mobile dans le navigateur — vos employés peuvent consulter leur horaire, remplir leurs feuilles de temps et marquer un travail comme terminé sur le terrain, sans installer d'application.",
    a_en: 'Yes — Lume adapts to mobile in the browser. Your crew can check their schedule, fill timesheets and mark jobs complete in the field, with nothing to install.',
    tags: 'mobile telephone cellulaire app application terrain ipad tablette',
  },
];

export default function SupportDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset to the browse view each time the drawer opens, so it never reopens
  // mid-form with stale state.
  useEffect(() => {
    if (open) {
      setQuery('');
      setExpanded(null);
      setShowForm(false);
      setTimeout(() => searchRef.current?.focus(), 350);
    }
  }, [open]);

  // Escape closes the form first, then the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showForm) setShowForm(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, showForm, onClose]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ARTICLES;
    // Match on question, answer and tags so a user's own wording still lands.
    return ARTICLES.filter((a) =>
      `${a.q_fr} ${a.q_en} ${a.a_fr} ${a.a_en} ${a.tags}`.toLowerCase().includes(q),
    );
  }, [query]);

  const goTo = (path: string) => { onClose(); navigate(path); };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ zIndex: Z.supportDrawerBackdrop }}
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={isFr ? 'Aide et support' : 'Help and support'}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            style={{ zIndex: Z.supportDrawer }}
            className="fixed top-0 right-0 bottom-0 w-full sm:w-[420px] bg-surface-elevated border-l border-outline shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-subtle shrink-0">
              <div className="flex items-center gap-2.5">
                {showForm && (
                  <button
                    onClick={() => setShowForm(false)}
                    aria-label={isFr ? 'Retour' : 'Back'}
                    className="w-7 h-7 rounded-lg hover:bg-surface-secondary flex items-center justify-center text-text-secondary transition-colors"
                  >
                    <ArrowLeft size={16} />
                  </button>
                )}
                <h2 className="text-[16px] font-bold text-text-primary">
                  {showForm
                    ? (isFr ? 'Contacter le support' : 'Contact support')
                    : (isFr ? 'Besoin d\'aide ?' : 'Need a hand?')}
                </h2>
              </div>
              <button
                onClick={onClose}
                aria-label={isFr ? 'Fermer' : 'Close'}
                className="w-8 h-8 rounded-lg hover:bg-surface-secondary flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {showForm ? (
              <div className="flex-1 overflow-y-auto p-5">
                <SupportPanel bare onSent={onClose} />
              </div>
            ) : (
              <>
                {/* Search */}
                <div className="px-5 py-4 shrink-0">
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => { setQuery(e.target.value); setExpanded(null); }}
                      placeholder={isFr ? 'Rechercher dans l\'aide…' : 'Search our help…'}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-surface-secondary border border-outline-subtle text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                    />
                  </div>
                </div>

                {/* Articles */}
                <div className="flex-1 overflow-y-auto px-5 pb-4">
                  <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">
                    {query.trim()
                      ? (isFr ? `${results.length} résultat${results.length > 1 ? 's' : ''}` : `${results.length} result${results.length > 1 ? 's' : ''}`)
                      : (isFr ? 'Questions fréquentes' : 'Common questions')}
                  </p>

                  {results.length === 0 ? (
                    <div className="py-10 text-center">
                      <p className="text-[13px] text-text-tertiary mb-4">
                        {isFr
                          ? 'Aucune réponse ne correspond à votre recherche.'
                          : 'Nothing matches your search.'}
                      </p>
                      <button onClick={() => setShowForm(true)} className="glass-button-primary text-[13px]">
                        {isFr ? 'Poser la question au support' : 'Ask support directly'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {results.map((a) => {
                        const isOpen = expanded === a.id;
                        return (
                          <div
                            key={a.id}
                            className={cn(
                              'rounded-xl border transition-colors',
                              isOpen ? 'border-outline bg-surface-secondary/40' : 'border-transparent hover:bg-surface-secondary/40',
                            )}
                          >
                            <button
                              onClick={() => setExpanded(isOpen ? null : a.id)}
                              aria-expanded={isOpen}
                              className="w-full flex items-start justify-between gap-3 px-3 py-2.5 text-left"
                            >
                              <span className="text-[13px] font-medium text-text-primary leading-snug">
                                {isFr ? a.q_fr : a.q_en}
                              </span>
                              <ChevronDown
                                size={15}
                                className={cn(
                                  'text-text-tertiary shrink-0 mt-0.5 transition-transform',
                                  isOpen && 'rotate-180',
                                )}
                              />
                            </button>

                            <AnimatePresence initial={false}>
                              {isOpen && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.18 }}
                                  className="overflow-hidden"
                                >
                                  <div className="px-3 pb-3">
                                    <p className="text-[12.5px] text-text-secondary leading-relaxed">
                                      {isFr ? a.a_fr : a.a_en}
                                    </p>
                                    {a.path && (
                                      <button
                                        onClick={() => goTo(a.path!)}
                                        className="mt-2.5 text-[12px] font-semibold text-primary hover:underline"
                                      >
                                        {isFr ? 'Aller à la page →' : 'Take me there →'}
                                      </button>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer CTA */}
                <div className="px-5 py-4 border-t border-outline-subtle shrink-0">
                  <p className="text-[11px] text-text-tertiary mb-2.5 leading-relaxed">
                    {isFr
                      ? 'Vous ne trouvez pas ? Écrivez-nous, on répond vite.'
                      : 'Can’t find it? Send us a message — we reply fast.'}
                  </p>
                  <button
                    onClick={() => setShowForm(true)}
                    className="w-full glass-button-primary inline-flex items-center justify-center gap-2 !py-2.5"
                  >
                    <LifeBuoy size={15} />
                    {isFr ? 'Contacter le support' : 'Get support'}
                  </button>
                </div>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
