import React, { useState } from 'react';
import { Loader2, LifeBuoy, Send } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { submitSupportRequest, type SupportCategory } from '../lib/supportApi';

const CATEGORIES: { value: SupportCategory; en: string; fr: string }[] = [
  { value: 'question', en: 'Question',        fr: 'Question' },
  { value: 'bug',      en: 'Something broke', fr: 'Un bug' },
  { value: 'billing',  en: 'Billing',         fr: 'Facturation' },
  { value: 'feature',  en: 'Feature request', fr: 'Suggestion' },
  { value: 'other',    en: 'Other',           fr: 'Autre' },
];

export default function SupportPanel({ onSent }: { onSent?: () => void } = {}) {
  const { language } = useTranslation();
  const isFr = language === 'fr';

  const [category, setCategory] = useState<SupportCategory>('question');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = subject.trim().length >= 3 && message.trim().length >= 10 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await submitSupportRequest({ subject: subject.trim(), message: message.trim(), category });
      toast.success(isFr ? 'Message envoyé — on revient vers vous bientôt.' : 'Sent — we’ll get back to you soon.');
      setSubject('');
      setMessage('');
      setCategory('question');
      onSent?.();
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec de l’envoi.' : 'Could not send your message.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <LifeBuoy size={18} className="text-primary" />
        </div>
        <div>
          <h3 className="text-[15px] font-bold text-text-primary">
            {isFr ? 'Contacter le support' : 'Contact support'}
          </h3>
          <p className="text-[12px] text-text-tertiary mt-0.5 leading-relaxed">
            {isFr
              ? 'Décrivez votre problème. Les demandes sont priorisées selon votre forfait.'
              : 'Tell us what’s going on. Requests are prioritized based on your plan.'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={cn(
                'px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all',
                category === c.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-outline-subtle text-text-secondary hover:border-outline hover:bg-surface-secondary/40'
              )}
            >
              {isFr ? c.fr : c.en}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-text-tertiary mb-1.5">
            {isFr ? 'Sujet' : 'Subject'}
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder={isFr ? 'Résumé en une ligne' : 'One-line summary'}
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-subtle bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-tertiary mb-1.5">
            {isFr ? 'Message' : 'Message'}
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            rows={6}
            placeholder={isFr ? 'Décrivez le problème, les étapes pour le reproduire, etc.' : 'Describe the issue, steps to reproduce, etc.'}
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-subtle bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none transition-colors resize-y"
          />
        </div>

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all',
              canSubmit
                ? 'bg-primary text-white hover:opacity-90'
                : 'bg-surface-secondary text-text-tertiary cursor-not-allowed'
            )}
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {isFr ? 'Envoyer' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
