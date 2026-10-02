/* ═══════════════════════════════════════════════════════════════
   L'AUTRE LANGUE d'un message d'automatisation.

   Un texto ou un courriel peut porter deux textes : le texte de base
   (français) et une version anglaise. Le moteur envoie celui de la langue
   dans laquelle le bureau écrit à ses clients. La règle des écrans (fixée
   le 2026-10-01) :

     · le champ PRINCIPAL montre et modifie le texte de cette langue — celui
       qui part ;
     · l'AUTRE langue, quand le message en porte une, vit ici : un bloc
       secondaire REPLIÉ, dépliable et modifiable ;
     · modifier le texte principal sans toucher à l'autre ne bloque JAMAIS
       l'enregistrement : le bloc se déplie, dit « Cette version n'est plus à
       jour. » et offre deux choix, le premier coché d'office — « La retirer
       (vos clients recevront le texte ci-dessus) » ou « La garder telle
       quelle ». Rien n'est retiré sans être écrit à l'écran ; rien de périmé
       ne reste sans que l'utilisateur l'ait choisi.

   RIEN N'EST RETIRÉ SANS ÊTRE ÉCRIT DANS LA ZONE VISIBLE (remarque de la
   session des specs, 2026-10-02). Le bloc est en bas de l'écran : sur une
   fenêtre basse ou un texte long il passait sous le pli, « Enregistrer »
   restait cliquable, « La retirer » était coché d'office — la version
   disparaissait sans avoir été vue. Deux garanties :
     · le bloc DÉFILE dans la vue quand il se déplie (ici, pour tous les
       écrans qui l'emploient) ;
     · `AvisRetraitAutreVersion`, à poser à côté du bouton « Enregistrer » :
       « La version anglaise sera retirée. » et un lien « Voir » qui y mène.

   Ce composant ne porte que le cadre : l'intitulé, le pli, l'avis et les
   deux choix. Les champs de l'autre version (un champ de texto, ou l'objet
   et les lignes d'un courriel) sont ses enfants.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useId, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export type LangueMessage = 'fr' | 'en';
/** Ce que devient l'autre version quand le texte principal change sans elle. */
export type ChoixAutreVersion = 'retirer' | 'garder';

/** « Version anglaise » / « Version française », dans la langue de l'interface. */
export function nomAutreVersion(fr: boolean, langue: LangueMessage): string {
  if (langue === 'en') return fr ? 'Version anglaise' : 'English version';
  return fr ? 'Version française' : 'French version';
}

/** L'intitulé du bloc : la version, et quand elle sert. */
export function titreAutreVersion(fr: boolean, langue: LangueMessage): string {
  if (langue === 'en') {
    return fr
      ? 'Version anglaise — utilisée seulement si vos messages partent en anglais'
      : 'English version — used only if your messages are sent in English';
  }
  return fr
    ? 'Version française — utilisée seulement si vos messages partent en français'
    : 'French version — used only if your messages are sent in French';
}

/**
 * La phrase qui dit dans quelle langue le bureau envoie ses messages — donc quel
 * texte le champ principal montre. `langueBureau` nul : elle n'a pas pu être lue.
 * `principale` : la langue du texte affiché (le texte de base quand le message
 * n'a pas de version anglaise, même si le bureau écrit en anglais).
 */
export function phraseLangueDesMessages(
  fr: boolean,
  langueBureau: LangueMessage | null,
  principale: LangueMessage,
  quoi: 'texto' | 'courriel',
): string {
  if (langueBureau === null) {
    return fr
      ? 'La langue dans laquelle vos messages partent n’a pas pu être lue pour le moment : le texte affiché est le texte de base.'
      : 'The language your messages are sent in could not be read right now: the text shown is the base text.';
  }
  if (langueBureau === 'en' && principale === 'fr') {
    return fr
      ? `Vos messages partent en anglais, mais ce ${quoi} n’a qu’un texte : c’est lui que vos clients reçoivent.`
      : `Your messages are sent in English, but this ${quoi === 'texto' ? 'text message' : 'email'} has only one text: it is the one your clients receive.`;
  }
  if (langueBureau === 'en') {
    return fr
      ? 'Vos messages partent en anglais : c’est ce texte que vos clients reçoivent.'
      : 'Your messages are sent in English: this is the text your clients receive.';
  }
  return fr
    ? 'Vos messages partent en français : c’est ce texte que vos clients reçoivent.'
    : 'Your messages are sent in French: this is the text your clients receive.';
}

/** Amène un élément dans la vue (sans rien faire là où le navigateur ne sait pas défiler : tests, anciens moteurs). */
function amenerDansLaVue(el: Element | null | undefined, bloc: ScrollLogicalPosition = 'nearest'): void {
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: bloc, behavior: 'smooth' });
}

/**
 * À côté du bouton « Enregistrer », tant que le retrait est coché : ce qui va
 * être retiré est écrit LÀ OÙ L'ON CLIQUE, même si le bloc est sous le pli.
 * « Voir » y mène. `idBloc` : l'`id` donné au `AutreVersionMessage` visé.
 */
export function AvisRetraitAutreVersion({ fr, langue, idBloc, className }: {
  fr: boolean; langue: LangueMessage; idBloc: string; className?: string;
}) {
  return (
    <span role="status" data-testid="avis-retrait-autre-version" className={cn('text-[11px] leading-tight text-amber-800 dark:text-amber-300', className)}>
      {langue === 'en'
        ? (fr ? 'La version anglaise sera retirée.' : 'The English version will be removed.')
        : (fr ? 'La version française sera retirée.' : 'The French version will be removed.')}
      {' '}
      <button
        type="button"
        onClick={() => amenerDansLaVue(document.getElementById(idBloc), 'center')}
        className="rounded font-medium underline underline-offset-2 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        {fr ? 'Voir' : 'View'}
      </button>
    </span>
  );
}

interface Props {
  /** `id` du bloc, pour y mener depuis `AvisRetraitAutreVersion`. */
  id?: string;
  /** Langue de l'INTERFACE. */
  fr: boolean;
  /** La langue de cette version secondaire. */
  langue: LangueMessage;
  /** Le texte principal a changé, pas cette version. */
  perimee: boolean;
  choix: ChoixAutreVersion;
  onChoix: (choix: ChoixAutreVersion) => void;
  /** Déplié par l'utilisateur. Une version périmée est TOUJOURS dépliée. */
  deplie: boolean;
  onDeplie: (deplie: boolean) => void;
  className?: string;
  /** Les champs de cette version. */
  children: React.ReactNode;
}

export default function AutreVersionMessage({ id, fr, langue, perimee, choix, onChoix, deplie, onDeplie, className, children }: Props) {
  const idContenu = useId();
  const idRetirer = useId();
  const idGarder = useId();
  const nomChoix = useId();
  const ouvert = deplie || perimee;
  // Le bloc qui se DÉPLIE vient dans la vue (jamais au premier rendu : ouvrir un écran ne le fait pas défiler).
  const racine = useRef<HTMLDivElement>(null);
  const dejaRendu = useRef(false);
  useEffect(() => {
    if (dejaRendu.current && ouvert) amenerDansLaVue(racine.current);
    dejaRendu.current = true;
  }, [ouvert]);

  return (
    <div
      ref={racine}
      id={id}
      data-testid="autre-version"
      className={cn(
        'rounded-md border text-[11px] leading-relaxed',
        perimee ? 'border-amber-500/40 bg-amber-500/10' : 'border-outline/50 bg-surface',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={ouvert}
        aria-controls={idContenu}
        onClick={() => onDeplie(!ouvert)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-medium text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <span>{titreAutreVersion(fr, langue)}</span>
        <ChevronDown size={13} aria-hidden="true" className={cn('shrink-0 transition-transform', ouvert && 'rotate-180')} />
      </button>

      {ouvert && (
        <div id={idContenu} className="space-y-2 px-2.5 pb-2.5">
          {perimee && (
            <fieldset className="space-y-1 text-amber-800 dark:text-amber-300">
              <legend className="font-semibold">
                {fr ? 'Cette version n’est plus à jour.' : 'This version is no longer up to date.'}
              </legend>
              <label htmlFor={idRetirer} className="flex cursor-pointer items-start gap-2">
                <input
                  id={idRetirer}
                  type="radio"
                  name={nomChoix}
                  checked={choix === 'retirer'}
                  onChange={() => onChoix('retirer')}
                  className="mt-0.5 h-3.5 w-3.5 border-outline text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                />
                <span>{fr ? 'La retirer (vos clients recevront le texte ci-dessus)' : 'Remove it (your clients will receive the text above)'}</span>
              </label>
              <label htmlFor={idGarder} className="flex cursor-pointer items-start gap-2">
                <input
                  id={idGarder}
                  type="radio"
                  name={nomChoix}
                  checked={choix === 'garder'}
                  onChange={() => onChoix('garder')}
                  className="mt-0.5 h-3.5 w-3.5 border-outline text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                />
                <span>{fr ? 'La garder telle quelle' : 'Keep it as is'}</span>
              </label>
            </fieldset>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
