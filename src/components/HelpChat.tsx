import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Loader2, HelpCircle, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Knowledge base for the AI assistant — answers questions about Lume CRM
const LUME_KNOWLEDGE: Array<{ keywords: string[]; answer_en: string; answer_fr: string }> = [
  {
    keywords: ['lead', 'leads', 'prospect', 'add lead', 'create lead'],
    answer_en: 'To manage leads, go to **Leads** in the CRM section of the sidebar. You can add new leads with the "Add Lead" button, filter by status (Lead, Qualified, Proposal, Negotiation, Closed), search, and export to CSV. You can also convert leads into clients directly.',
    answer_fr: 'Pour gérer les leads, allez dans **Leads** dans la section CRM du menu latéral. Vous pouvez ajouter de nouveaux leads avec le bouton « Ajouter un lead », filtrer par statut, rechercher et exporter en CSV. Vous pouvez aussi convertir les leads en clients directement.',
  },
  {
    keywords: ['pipeline', 'deal', 'deals', 'kanban', 'stage'],
    answer_en: 'The **Pipeline** page shows your deals in a Kanban board. You can drag and drop deals between stages (Lead, Qualified, Proposal, Negotiation, Closed). Click on any deal to view details, link jobs, or add schedule events.',
    answer_fr: 'La page **Pipeline** affiche vos deals dans un tableau Kanban. Vous pouvez glisser-déposer les deals entre les étapes. Cliquez sur un deal pour voir les détails, lier des jobs ou ajouter des événements.',
  },
  {
    keywords: ['client', 'clients', 'customer', 'contact'],
    answer_en: 'Go to **Clients** in the CRM section to manage your client directory. You can create new clients, view their linked jobs and invoices, archive clients, and search by name or email.',
    answer_fr: 'Allez dans **Clients** dans la section CRM pour gérer votre répertoire. Vous pouvez créer des clients, voir leurs jobs et factures liés, archiver des clients et rechercher par nom ou courriel.',
  },
  {
    keywords: ['job', 'jobs', 'work order', 'service'],
    answer_en: 'The **Jobs** page (under Operations) lets you manage service jobs. You can create one-off or recurring jobs, assign teams, track status, and view them on a map. Each job can be linked to a client, lead, and invoice.',
    answer_fr: 'La page **Jobs** (sous Opérations) vous permet de gérer les travaux. Vous pouvez créer des jobs ponctuels ou récurrents, assigner des équipes, suivre le statut et les voir sur une carte.',
  },
  {
    keywords: ['calendar', 'schedule', 'event', 'appointment'],
    answer_en: 'Use the **Calendar** page to view and manage events in day, week, or month views. You can drag and drop to reschedule events.',
    answer_fr: 'Utilisez le **Calendrier** pour voir et gérer les événements en vue jour, semaine ou mois. Vous pouvez glisser-déposer pour replanifier.',
  },
  {
    keywords: ['invoice', 'invoices', 'billing', 'bill'],
    answer_en: 'Go to **Invoices** under Finance to create and manage invoices. You can create invoices for clients, add line items, set due dates, track payment status (Draft, Sent, Paid, Past Due), and send invoices via email.',
    answer_fr: 'Allez dans **Factures** sous Finance pour créer et gérer les factures. Vous pouvez ajouter des lignes, définir des échéances, suivre le statut (Brouillon, Envoyée, Payée, En retard) et envoyer par courriel.',
  },
  {
    keywords: ['payment', 'payments', 'stripe', 'paypal', 'pay'],
    answer_en: 'The **Payments** page shows transaction overview and payouts. Go to Payment Settings to connect Stripe or PayPal. Once connected, you can track funds, view payout history, and export CSV reports.',
    answer_fr: 'La page **Paiements** affiche l\'aperçu des transactions et versements. Allez dans les paramètres de paiement pour connecter Stripe ou PayPal. Vous pourrez suivre les fonds et exporter des rapports CSV.',
  },
  {
    keywords: ['task', 'tasks', 'todo', 'to-do'],
    answer_en: 'Use **Tasks** (under Operations) to manage your to-do list. You can quickly add tasks, link them to leads, and mark them as completed. Tasks are organized into Active and Completed tabs.',
    answer_fr: 'Utilisez **Tâches** (sous Opérations) pour gérer votre liste de choses à faire. Vous pouvez ajouter rapidement des tâches, les lier à des leads et les marquer comme complétées.',
  },
  {
    keywords: ['insight', 'insights', 'analytics', 'report', 'chart'],
    answer_en: 'The **Insights** page provides business analytics including revenue trends, lead conversion rates, job statistics, and invoice summaries with interactive charts.',
    answer_fr: 'La page **Statistiques** offre des analytiques d\'affaires incluant les tendances de revenus, les taux de conversion des leads, les statistiques de jobs et les résumés de factures.',
  },
  {
    keywords: ['setting', 'settings', 'profile', 'account', 'workspace'],
    answer_en: 'Go to **Settings** at the bottom of the sidebar to manage your account (name, email), billing plan, workspace settings, language preferences, and company details.',
    answer_fr: 'Allez dans **Paramètres** en bas du menu latéral pour gérer votre compte (nom, courriel), forfait, paramètres d\'espace de travail, langue et détails de l\'entreprise.',
  },
  {
    keywords: ['search', 'find', 'global search'],
    answer_en: 'Use the **Global Search** bar at the top of the page to search across clients, jobs, leads, and dates. You can also use quick actions like opening the calendar on a specific date.',
    answer_fr: 'Utilisez la **recherche globale** en haut de la page pour chercher parmi les clients, jobs, leads et dates. Vous pouvez aussi utiliser des actions rapides.',
  },
  {
    keywords: ['team', 'teams', 'availability'],
    answer_en: 'Manage teams from the **Teams** button on the Jobs page. Set team availability schedules in the **Availability** page.',
    answer_fr: 'Gérez les équipes depuis le bouton **Équipes** sur la page Jobs. Définissez les horaires dans la page **Disponibilités**.',
  },
  {
    keywords: ['dark mode', 'theme', 'light mode', 'appearance'],
    answer_en: 'Toggle between light and dark mode using the **sun/moon icon** at the bottom of the sidebar, just above Settings.',
    answer_fr: 'Basculez entre le mode clair et sombre avec l\'**icône soleil/lune** en bas du menu latéral, juste au-dessus des Paramètres.',
  },
  {
    keywords: ['language', 'french', 'english', 'langue'],
    answer_en: 'Change the app language in **Settings → Language**. Lume supports English and French.',
    answer_fr: 'Changez la langue dans **Paramètres → Langue**. Lume supporte l\'anglais et le français.',
  },
  {
    keywords: ['timesheet', 'timesheets', 'time tracking', 'punch', 'clock'],
    answer_en: 'Go to **Timesheets** in the Operations section of the sidebar. You can track punch in/out times, breaks, and view daily, weekly, or monthly totals per employee.',
    answer_fr: 'Allez dans **Feuilles de temps** dans la section Opérations du menu latéral. Vous pouvez suivre les heures de pointage, les pauses et voir les totaux quotidiens, hebdomadaires ou mensuels par employé.',
  },
  {
    keywords: ['automation', 'automations', 'workflow', 'reminder', 'auto'],
    answer_en: 'Go to **Settings → Automations** to manage automated workflows like appointment reminders, invoice payment reminders, quote follow-ups, and customer follow-ups. Each automation can be enabled/disabled and customized.',
    answer_fr: 'Allez dans **Paramètres → Automatisations** pour gérer les workflows automatisés comme les rappels de rendez-vous, de paiement de factures, de suivi de devis et de clients.',
  },
  {
    keywords: ['company', 'company settings', 'business info', 'company details'],
    answer_en: 'Go to **Settings → Company** to set your company name, phone, website, email, and full address. This information is used on invoices, quotes, and emails.',
    answer_fr: 'Allez dans **Paramètres → Entreprise** pour définir le nom, téléphone, site web, courriel et adresse de votre entreprise. Ces informations sont utilisées sur les factures et courriels.',
  },
];

function findAnswer(query: string, lang: 'en' | 'fr'): string {
  const q = query.toLowerCase();
  let bestMatch: typeof LUME_KNOWLEDGE[0] | null = null;
  let bestScore = 0;

  for (const entry of LUME_KNOWLEDGE) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (q.includes(kw)) score += kw.split(' ').length; // multi-word keywords score higher
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  if (bestMatch && bestScore > 0) {
    return lang === 'fr' ? bestMatch.answer_fr : bestMatch.answer_en;
  }

  return lang === 'fr'
    ? "Je ne suis pas sûr de comprendre votre question. Essayez de me demander comment utiliser une fonctionnalité spécifique comme les leads, les factures, le calendrier, les paiements, les tâches ou les paramètres. Je suis là pour vous aider à naviguer dans Lume!"
    : "I'm not sure I understand your question. Try asking me about a specific feature like leads, invoices, calendar, payments, tasks, or settings. I'm here to help you navigate Lume!";
}

// Render markdown-like bold text
function renderContent(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function HelpChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const welcomeMsg = language === 'fr'
    ? "Bonjour! Je suis l'assistant Lume. Posez-moi une question sur l'utilisation du CRM — leads, factures, calendrier, paiements, et plus encore!"
    : "Hi! I'm the Lume assistant. Ask me anything about using the CRM — leads, invoices, calendar, payments, and more!";

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: welcomeMsg,
        timestamp: new Date(),
      }]);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Simulate AI response with a small delay
    setTimeout(() => {
      const answer = findAnswer(trimmed, language as 'en' | 'fr');
      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: answer,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    }, 600 + Math.random() * 400);
  };

  const suggestions = language === 'fr'
    ? ['Comment ajouter un lead?', 'Comment créer une facture?', 'Comment utiliser le calendrier?', 'Comment connecter Stripe?']
    : ['How do I add a lead?', 'How do I create an invoice?', 'How do I use the calendar?', 'How do I connect Stripe?'];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] bg-black/20 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Slide-out panel */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed right-0 top-0 z-[90] h-screen w-full max-w-md bg-surface border-l border-outline flex flex-col"
          >
            {/* Header */}
            <div className="h-[56px] px-4 flex items-center justify-between border-b border-outline shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="icon-tile icon-tile-sm icon-tile-blue">
                  <Sparkles size={13} strokeWidth={2} />
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-text-primary">
                    {t.helpChat.lumeAssistant}
                  </h3>
                  <p className="text-[10px] text-text-tertiary">
                    {t.helpChat.crmHelpSupport}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg border border-transparent text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary hover:border-outline-subtle transition-all"
              >
                <X size={14} />
              </button>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'flex gap-2.5',
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {msg.role === 'assistant' && (
                    <div className="icon-tile icon-tile-sm icon-tile-blue shrink-0 mt-0.5">
                      <Bot size={12} />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[80%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-primary text-white rounded-br-sm'
                        : 'bg-surface-secondary border border-outline-subtle text-text-primary rounded-bl-sm'
                    )}
                  >
                    {renderContent(msg.content)}
                  </div>
                  {msg.role === 'user' && (
                    <div className="avatar-sm shrink-0 mt-0.5">
                      <User size={12} />
                    </div>
                  )}
                </motion.div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-2.5"
                >
                  <div className="icon-tile icon-tile-sm icon-tile-blue shrink-0 mt-0.5">
                    <Bot size={12} />
                  </div>
                  <div className="bg-surface-secondary border border-outline-subtle rounded-xl rounded-bl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-text-tertiary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Quick suggestions (only when there's just the welcome message) */}
              {messages.length === 1 && !isTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="space-y-1.5 pt-2"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary px-1">
                    {t.helpChat.quickQuestions}
                  </p>
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setInput(s); setTimeout(() => { setInput(''); const userMsg: Message = { id: `user-${Date.now()}`, role: 'user', content: s, timestamp: new Date() }; setMessages((prev) => [...prev, userMsg]); setIsTyping(true); setTimeout(() => { const answer = findAnswer(s, language as 'en' | 'fr'); setMessages((prev) => [...prev, { id: `assistant-${Date.now()}`, role: 'assistant', content: answer, timestamp: new Date() }]); setIsTyping(false); }, 600 + Math.random() * 400); }, 50); }}
                      className="w-full text-left px-3 py-2 rounded-lg border border-outline-subtle text-[12px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary hover:border-outline transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="px-4 pb-4 pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={t.helpChat.askAQuestion}
                  className="glass-input flex-1 !py-2.5"
                  disabled={isTyping}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className={cn(
                    'glass-button-primary !p-2.5 !rounded-xl transition-all',
                    (!input.trim() || isTyping) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {isTyping ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-text-tertiary mt-2 text-center">
                {language === 'fr' ? 'Assistant IA local — Données non envoyées à l\'extérieur' : 'Local AI assistant — No data sent externally'}
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
