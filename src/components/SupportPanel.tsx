import React, { useState } from 'react';
import { Loader2, LifeBuoy, Send } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { submitSupportRequest, type SupportCategory, type SlaKey } from '../lib/supportApi';

// Délai de première réponse renvoyé par le serveur (dérivé du forfait).
const SLA_LABELS: Record<SlaKey, { fr: string; en: string }> = {
  '4h': { fr: '4 heures ouvrables', en: '4 business hours' },
  '1d': { fr: '1 jour ouvrable', en: '1 business day' },
  '2d': { fr: '2 jours ouvrables', en: '2 business days' },
};

const CATEGORIES: { value: SupportCategory; en: string; fr: string }[] = [
  { value: 'question', en: 'Question',        fr: 'Question' },
  { value: 'bug',      en: 'Something broke', fr: 'Un bug' },
  { value: 'billing',  en: 'Billing',         fr: 'Facturation' },
  { value: 'feature',  en: 'Feature request', fr: 'Suggestion' },
  { value: 'other',    en: 'Other',           fr: 'Autre' },
];

/**
 * `bare` strips the card chrome and the title block. Used when the panel is
 * already inside a titled container (the support drawer), where repeating the
 * heading and nesting a card inside a card reads as a rendering bug.
 */
export default function SupportPanel({ onSent, bare = false }: { onSent?: () => void; bare?: boolean } = {}) {
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
      const result = await submitSupportRequest({ subject: subject.trim(), message: message.trim(), category });
      // Le délai est déjà calculé côté serveur d'après le forfait : l'annoncer
      // vaut mieux qu'un « bientôt » vague. Repli sur le message générique si
      // le serveur ne renvoie pas encore la clé.
      const delay = result.slaKey ? SLA_LABELS[result.slaKey]?.[isFr ? 'fr' : 'en'] : undefined;
      toast.success(
        delay
          ? isFr
            ? `Message envoyé — réponse sous ${delay}.`
            : `Sent — we’ll reply within ${delay}.`
          : isFr
            ? 'Message envoyé — on revient vers vous bientôt.'
            : 'Sent — we’ll get back to you soon.',
      );
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
        text = isFr
          ? `Échec de l’envoi.${fallback ? ` Écrivez-nous à ${fallback}.` : ''}`
          : `Could not send your message.${fallback ? ` Please email ${fallback}.` : ''}`;
      } else {
        text = err?.message || (isFr ? 'Échec de l’envoi.' : 'Could not send your message.');
      }
      toast.error(text);
    } finally {
      setSubmitting(false);
    }
  }

  // Écrit une fois : les deux variantes (tiroir / carte) affichaient la même
  // phrase dupliquée mot pour mot, et une modification n'en touchait qu'une.
  const intro = isFr
    ? 'Décrivez votre problème. Les demandes sont priorisées selon votre forfait.'
    : 'Tell us what’s going on. Requests are prioritized based on your plan.';

  return (
    <div className={cn(bare ? 'space-y-5' : 'glass-card rounded-2xl p-6 space-y-5')}>
      {bare ? (
        <p className="text-[12.5px] text-text-tertiary leading-relaxed">{intro}</p>
      ) : (
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <LifeBuoy size={18} className="text-primary" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-text-primary">
              {isFr ? 'Contacter le support' : 'Contact support'}
            </h3>
            <p className="text-[12px] text-text-tertiary mt-0.5 leading-relaxed">{intro}</p>
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
              {isFr ? c.fr : c.en}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="support-subject" className="block text-xs font-medium text-text-tertiary mb-1.5">
            {isFr ? 'Sujet' : 'Subject'}
          </label>
          <input
            id="support-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder={isFr ? 'Résumé en une ligne' : 'One-line summary'}
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-subtle bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none transition-colors"
          />
        </div>

        <div>
          <label htmlFor="support-message" className="block text-xs font-medium text-text-tertiary mb-1.5">
            {isFr ? 'Message' : 'Message'}
          </label>
          <textarea
            id="support-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            rows={6}
            placeholder={isFr ? 'Décrivez le problème, les étapes pour le reproduire, etc.' : 'Describe the issue, steps to reproduce, etc.'}
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-subtle bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none transition-colors resize-y"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Dit POURQUOI le bouton est grisé : sans ça, l'utilisateur doit
              deviner les seuils. `aria-live` l'annonce aux lecteurs d'écran. */}
          <p id="support-hint" aria-live="polite" className="text-[11.5px] text-text-tertiary leading-snug">
            {submitting
              ? ''
              : !canSubmit
                ? isFr
                  ? 'Un sujet (3 caractères) et un message (10 caractères) sont requis.'
                  : 'A subject (3 characters) and a message (10 characters) are required.'
                : ''}
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
            {isFr ? 'Envoyer' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
