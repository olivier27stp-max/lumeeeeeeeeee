import React, { useState } from 'react';
import { Loader2, LifeBuoy, Send } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { submitSupportRequest, type SupportCategory, type SlaKey } from '../lib/supportApi';

// Clé i18n du délai de première réponse renvoyé par le serveur.
const SLA_KEYS: Record<SlaKey, 'sla4h' | 'sla1d' | 'sla2d'> = {
  '4h': 'sla4h',
  '1d': 'sla1d',
  '2d': 'sla2d',
};

const CATEGORIES: { value: SupportCategory; key: 'categoryQuestion' | 'categoryBug' | 'categoryBilling' | 'categoryFeature' | 'categoryOther' }[] = [
  { value: 'question', key: 'categoryQuestion' },
  { value: 'bug',      key: 'categoryBug' },
  { value: 'billing',  key: 'categoryBilling' },
  { value: 'feature',  key: 'categoryFeature' },
  { value: 'other',    key: 'categoryOther' },
];

/**
 * `bare` strips the card chrome and the title block. Used when the panel is
 * already inside a titled container (the support drawer), where repeating the
 * heading and nesting a card inside a card reads as a rendering bug.
 */
export default function SupportPanel({ onSent, bare = false }: { onSent?: () => void; bare?: boolean } = {}) {
  const { t } = useTranslation();
  const ts = t.support;

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
      const result = await submitSupportRequest({ subject: subject.trim(), message: message.trim(), category });
      // Le délai est déjà calculé côté serveur d'après le forfait : l'annoncer
      // vaut mieux qu'un « bientôt » vague. Repli sur le message générique si
      // le serveur ne renvoie pas encore la clé.
      const slaKey = result.slaKey ? SLA_KEYS[result.slaKey] : undefined;
      const delay = slaKey ? ts[slaKey] : undefined;
      toast.success(delay ? ts.sentWithSla.replace('{delay}', delay) : ts.sent);
      setSubject('');
      setMessage('');
      setCategory('question');
      onSent?.();
    } catch (err: any) {
      // Les messages du serveur sont anglais : on les reformule ici, où la
      // langue est connue. L'adresse de repli est conservée — c'est ce qui
      // rend l'erreur actionnable quand l'envoi est cassé.
      const fallback = err?.supportEmail as string | undefined;
      let text: string;
      if (err?.code === 'mailer_unconfigured' || err?.code === 'send_failed') {
        text = fallback ? ts.sendFailedWithEmail.replace('{email}', fallback) : ts.sendFailed;
      } else {
        text = err?.message || ts.sendFailed;
      }
      toast.error(text);
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <div className={cn(bare ? 'space-y-5' : 'glass-card rounded-2xl p-6 space-y-5')}>
      {bare ? (
        <p className="text-[12.5px] text-text-tertiary leading-relaxed">{ts.intro}</p>
      ) : (
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <LifeBuoy size={18} className="text-primary" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-text-primary">
              {ts.contactTitle}
            </h3>
            <p className="text-[12px] text-text-tertiary mt-0.5 leading-relaxed">{ts.intro}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={cn(
                // py-2.5 → ~40px de haut : les pastilles étaient à ~30px, sous
                // le minimum tactile recommandé (44px) et difficiles au doigt.
                'px-3.5 py-2.5 rounded-full text-[12px] font-medium border transition-all',
                category === c.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-outline-subtle text-text-secondary hover:border-outline hover:bg-surface-secondary/40'
              )}
            >
              {ts[c.key]}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="support-subject" className="block text-xs font-medium text-text-tertiary mb-1.5">
            {ts.subject}
          </label>
          <input
            id="support-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder={ts.subjectPlaceholder}
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-subtle bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none transition-colors"
          />
        </div>

        <div>
          <label htmlFor="support-message" className="block text-xs font-medium text-text-tertiary mb-1.5">
            {ts.message}
          </label>
          <textarea
            id="support-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            rows={6}
            placeholder={ts.messagePlaceholder}
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-subtle bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none transition-colors resize-y"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Dit POURQUOI le bouton est grisé : sans ça, l'utilisateur doit
              deviner les seuils. `aria-live` l'annonce aux lecteurs d'écran. */}
          <p id="support-hint" aria-live="polite" className="text-[11.5px] text-text-tertiary leading-snug">
            {!submitting && !canSubmit ? ts.hint : ''}
          </p>
          <button
            type="submit"
            disabled={!canSubmit}
            aria-describedby="support-hint"
            className={cn(
              'inline-flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold transition-all shrink-0',
              canSubmit
                ? 'bg-primary text-white hover:opacity-90'
                : 'bg-surface-secondary text-text-tertiary cursor-not-allowed'
            )}
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {ts.send}
          </button>
        </div>
      </form>
    </div>
  );
}
