/**
 * Le clavardage avec Lumi dans l'éditeur d'automatisations.
 *
 * Deux formes, un seul fil :
 *   · `carte`   — au centre du canevas, AVANT le premier message : c'est
 *                 l'invitation « Décris ton automatisation » ;
 *   · `lateral` — dès le premier message, le fil s'ouvre en PANNEAU À GAUCHE,
 *                 comme le support : le parcours se construit au centre
 *                 pendant qu'on continue à jaser à côté (« ajoute un texto
 *                 après 2 jours »). La droite reste au panneau d'une étape.
 *
 * Le fil vient de `automation_rules.lumi_conversation` : il survit à la
 * fermeture de l'éditeur, et Lumi s'en souvient à la réouverture.
 */
import React, { useEffect, useRef } from 'react';
import { Loader2, PanelLeftClose, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { remplir, textesCredits } from '../../lib/lumiCreditsFormat';

export interface TourLumi { role: 'user' | 'assistant'; content: string }

interface Props {
  fr: boolean;
  variante: 'carte' | 'lateral';
  echanges: TourLumi[];
  genere: boolean;
  prompt: string;
  onPrompt: (valeur: string) => void;
  onEnvoyer: () => void;
  textareaId: string;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  /** Replier le panneau latéral (le fil est gardé). */
  onReduire?: () => void;
  /** Sous le champ, en forme carte seulement : les départs tout faits. */
  pied?: React.ReactNode;
}

export default function ClavardageLumi({
  fr, variante, echanges, genere, prompt, onPrompt, onEnvoyer, textareaId, textareaRef, onReduire, pied,
}: Props) {
  const lateral = variante === 'lateral';
  const finDuFil = useRef<HTMLDivElement>(null);

  // Le dernier message reste visible : un fil qui ne suit pas donne
  // l'impression que Lumi n'a rien répondu.
  useEffect(() => {
    finDuFil.current?.scrollIntoView?.({ block: 'end' });
  }, [echanges.length, genere]);

  const peutEnvoyer = prompt.trim().length >= 10 && !genere;

  const fil = (echanges.length > 0 || genere) && (
    /*
     * `aria-live` : la réponse de Lumi arrive sans que le focus bouge ; sans
     * ça, un lecteur d'écran ne l'annonce jamais.
     */
    <div
      aria-live="polite"
      className={cn(
        'space-y-2 overflow-y-auto text-left',
        lateral ? 'flex-1 px-4 py-3' : 'mb-3 max-h-56 border-b border-border pb-3',
      )}
    >
      {echanges.map((tour, i) => (
        <div key={`${i}-${tour.role}`} className={tour.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
          <p
            className={
              tour.role === 'user'
                ? 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent/10 px-3 py-2 text-[12px] text-text-primary'
                : 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface px-3 py-2 text-[12px] text-text-secondary'
            }
          >
            {tour.content}
          </p>
        </div>
      ))}
      {/* Le tour en cours : la demande AVANT la réponse, sinon le fil paraît
          figé pendant que Lumi travaille. */}
      {genere && prompt.trim().length > 0 && (
        <>
          <div className="flex justify-end">
            <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent/10 px-3 py-2 text-[12px] text-text-primary">
              {prompt.trim()}
            </p>
          </div>
          <div className="flex justify-start">
            <p className="inline-flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-surface px-3 py-2 text-[12px] text-text-muted">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              {fr ? 'Lumi construit…' : 'Lumi is building…'}
            </p>
          </div>
        </>
      )}
      <div ref={finDuFil} />
    </div>
  );

  const saisie = (
    <div className={lateral ? 'border-t border-border p-3' : ''}>
      <label htmlFor={textareaId} className="sr-only">
        {fr ? 'Décris ton automatisation' : 'Describe your automation'}
      </label>
      <textarea
        id={textareaId}
        ref={textareaRef}
        rows={lateral ? 3 : 3}
        value={prompt}
        onChange={(e) => onPrompt(e.target.value)}
        onKeyDown={(e) => {
          // Entrée envoie, Maj+Entrée va à la ligne — comme tout clavardage.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (peutEnvoyer) onEnvoyer();
          }
        }}
        placeholder={echanges.length > 0
          ? (fr
              ? 'Change le délai du deuxième message à 2 jours. Retire le courriel.'
              : 'Change the second message delay to 2 days. Remove the email.')
          : (fr
              ? 'Après l’envoi d’un devis, attends 24 h puis envoie un texto de suivi, attends 2 jours de plus pour un courriel, et crée une tâche d’appel après 3 jours.'
              : 'After sending a quote, wait 24 hours then send a text follow-up, wait 2 more days for an email, and create a call task after 3 days.')}
        className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-text-muted">
          {remplir(textesCredits(fr ? 'fr' : 'en').deducted, { unit: textesCredits(fr ? 'fr' : 'en').unit })}
        </span>
        <button
          type="button"
          onClick={onEnvoyer}
          disabled={!peutEnvoyer}
          className="glass-button-primary inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          {genere
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
          {genere
            ? (fr ? 'Lumi construit…' : 'Lumi is building…')
            : (echanges.length > 0 ? (fr ? 'Envoyer' : 'Send') : (fr ? 'Construire' : 'Build'))}
        </button>
      </div>
    </div>
  );

  if (lateral) {
    return (
      <aside
        aria-label={fr ? 'Clavardage avec Lumi' : 'Chat with Lumi'}
        className="flex w-full shrink-0 flex-col border-r border-border bg-surface-card md:w-[340px]"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
            {fr ? 'Lumi — ce parcours' : 'Lumi — this path'}
          </p>
          {onReduire && (
            <button
              type="button"
              onClick={onReduire}
              aria-label={fr ? 'Replier le clavardage' : 'Collapse the chat'}
              className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {fil || <div className="flex-1" />}
        {saisie}
      </aside>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-surface-card p-5 shadow-sm">
      <p className="mb-3 flex items-center justify-center gap-2 text-center text-sm font-medium text-text-primary">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
        {fr ? 'Décris ton automatisation à Lumi' : 'Describe your automation to Lumi'}
      </p>
      {fil}
      {saisie}
      {pied}
    </div>
  );
}
