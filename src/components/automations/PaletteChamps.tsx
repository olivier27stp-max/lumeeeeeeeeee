/* ═══════════════════════════════════════════════════════════════
   « INSÉRER UN CHAMP » — LA palette, la même partout où l'on écrit un
   message d'automatisation (panneau d'étape, texto et courriel de la liste).

   Ce que le propriétaire voyait : une ligne repliée « Champs de base », puis,
   sans titre, ses champs personnalisés — lus comme le contenu de « Champs de
   base » ; la même liste pour tous les déclencheurs ; aucune recherche ; la
   variable collée à la FIN du texte.

   Ici :
     · une RECHERCHE (sans accents ni casse) ;
     · « Champs de base » d'abord, visibles : client, entreprise, puis la fiche
       du déclencheur (facture, job, devis) ; « Plus de champs » replié ;
     · « Champs personnalisés » dans SA section, titrée ;
     · seulement ce qui aura une valeur pour CE déclencheur (catalogue unique,
       src/lib/automationVariables.ts) ;
     · l'insertion À L'ENDROIT DU CURSEUR du dernier champ de texte actif
       (objet, aperçu ou message), le curseur replacé après la variable ;
     · « Si vide : … » — la valeur de remplacement : « Bonjour
       [client_first_name|là] ».

   L'INSERTION ne demande rien au panneau qui l'accueille : la palette retient
   le dernier champ de texte qui a eu le curseur dans `portee`, y écrit par
   l'accesseur natif et émet l'événement `input` — le `onChange` du champ
   contrôlé part comme pour une frappe. `onInserer`, s'il est fourni, remplace
   ce mécanisme (éditeur qui gère lui-même son texte).

   NE PAS offrir « Si vide » (`avecRemplacement`) tant que le moteur ne rend pas
   `[cle|texte]` (test [E-44]) : la variable partirait telle quelle.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Search } from 'lucide-react';
import type { ChampPerso } from '../../lib/champs/types';
import { trouverDeclencheur } from '../../lib/automationCatalogue';
import {
  variablesPour, filtrerVariables, ecriture, REMPLACEMENT_MAX, type VariableOfferte,
} from '../../lib/automationVariables';

/** Les champs où l'on peut insérer : zones de texte et champs texte d'une ligne. */
const SELECTEUR_TEXTE = 'textarea, input[type="text"], input:not([type])';
type ChampTexte = HTMLTextAreaElement | HTMLInputElement;

/** Le texte une fois la variable posée au curseur (ou à la place de la sélection), et où remettre le curseur. */
export function insererAuCurseur(valeur: string, ecrit: string, debut: number, fin: number = debut): { valeur: string; curseur: number } {
  const d = Math.max(0, Math.min(debut, valeur.length));
  const f = Math.max(d, Math.min(fin, valeur.length));
  return { valeur: valeur.slice(0, d) + ecrit + valeur.slice(f), curseur: d + ecrit.length };
}

/** Une valeur de remplacement acceptable : 60 caractères au plus, sans crochet, accolade ni barre. */
export function remplacementPropre(texte: string): string {
  return texte.replace(/[[\]{}|]/g, '').slice(0, REMPLACEMENT_MAX);
}

interface Props {
  /** Le déclencheur de l'automatisation : il décide de ce qui est offert. */
  declencheur: string | null | undefined;
  /** La fiche réelle quand les réglages de la règle la fixent (voir `champQuiFixeLEntite`). */
  entite?: string | null;
  fr: boolean;
  /** Les champs personnalisés du bureau. */
  champsPerso?: ChampPerso[];
  /** L'élément qui contient les champs de texte (le panneau). Absent : tout le document. */
  portee?: RefObject<HTMLElement | null>;
  /** Remplace l'insertion au curseur : le parent reçoit ce qu'il faut écrire. */
  onInserer?: (ecrit: string) => void;
  /** Offrir « Si vide : … » (la valeur de remplacement). */
  avecRemplacement?: boolean;
}

const classeBouton = 'rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export default function PaletteChamps({
  declencheur, entite, fr, champsPerso = [], portee, onInserer, avecRemplacement = true,
}: Props) {
  const ids = useId();
  const racine = useRef<HTMLDivElement>(null);
  const [recherche, setRecherche] = useState('');
  const [siVideOuvert, setSiVideOuvert] = useState(false);
  const [siVide, setSiVide] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const palette = useMemo(() => variablesPour(declencheur, champsPerso, { entite }), [declencheur, champsPerso, entite]);
  const base = useMemo(() => filtrerVariables(palette.base, recherche, fr), [palette, recherche, fr]);
  const plus = useMemo(() => filtrerVariables(palette.plus, recherche, fr), [palette, recherche, fr]);
  const personnalises = useMemo(() => filtrerVariables(palette.personnalises, recherche, fr), [palette, recherche, fr]);
  const enRecherche = recherche.trim() !== '';
  const decl = declencheur ? trouverDeclencheur(declencheur) : undefined;

  /*
   * LE DERNIER CHAMP DE TEXTE ACTIF. Cliquer un bouton de la palette retire le
   * curseur du texte : on retient donc le champ au moment où il le reçoit. Sa
   * sélection, elle, reste lisible sur l'élément après la perte du curseur.
   */
  const dernier = useRef<ChampTexte | null>(null);
  useEffect(() => {
    const retenir = (e: Event) => {
      const cible = e.target;
      if (!(cible instanceof HTMLTextAreaElement || cible instanceof HTMLInputElement)) return;
      if (!cible.matches(SELECTEUR_TEXTE) || racine.current?.contains(cible)) return;
      if (portee?.current && !portee.current.contains(cible)) return;
      dernier.current = cible;
    };
    // `focus` ne remonte pas : on l'écoute à la capture.
    document.addEventListener('focus', retenir, true);
    return () => document.removeEventListener('focus', retenir, true);
  }, [portee]);

  /** Le champ où insérer : le dernier actif s'il est encore là, sinon le premier champ de texte de la portée. */
  const cible = (): ChampTexte | null => {
    const hote = portee?.current ?? document.body;
    if (dernier.current && dernier.current.isConnected && hote.contains(dernier.current)) return dernier.current;
    const candidats = Array.from(hote.querySelectorAll<ChampTexte>(SELECTEUR_TEXTE)).filter((c) => !racine.current?.contains(c) && !c.disabled && !c.readOnly);
    return candidats.find((c) => c instanceof HTMLTextAreaElement) ?? candidats[0] ?? null;
  };

  const inserer = (x: VariableOfferte) => {
    const remplacement = avecRemplacement && siVideOuvert ? siVide.trim() : '';
    const ecrit = ecriture(x.cle, remplacement);
    setMessage(null);
    if (onInserer) { onInserer(ecrit); return; }
    const champ = cible();
    if (!champ) {
      setMessage(fr ? 'Cliquez d’abord dans le texte où insérer le champ.' : 'Click first in the text where the field should go.');
      return;
    }
    // Jamais focalisé : à la fin du texte. Sinon, à l'endroit du curseur (ou à la place de la sélection).
    const jamaisActif = dernier.current !== champ;
    const debut = jamaisActif ? champ.value.length : (champ.selectionStart ?? champ.value.length);
    const fin = jamaisActif ? champ.value.length : (champ.selectionEnd ?? debut);
    const { valeur, curseur } = insererAuCurseur(champ.value, ecrit, debut, fin);
    if (champ.maxLength > 0 && valeur.length > champ.maxLength) {
      setMessage(fr ? 'Le texte dépasserait la longueur permise : raccourcissez-le avant d’insérer ce champ.' : 'The text would exceed the allowed length: shorten it before inserting this field.');
      return;
    }
    // L'accesseur NATIF, puis l'événement `input` : le `onChange` du champ contrôlé part comme pour une frappe.
    const prototype = champ instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(champ, valeur);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    dernier.current = champ;
    champ.focus();
    champ.setSelectionRange(curseur, curseur);
  };

  const libelle = (x: VariableOfferte) => (fr ? x.fr : x.en);
  const boutonDe = (x: VariableOfferte, avecGroupe: boolean) => (
    <button key={x.cle} type="button" onClick={() => inserer(x)} title={x.ecrit} className={classeBouton}>
      {avecGroupe ? `${fr ? x.groupe.fr : x.groupe.en} · ${libelle(x)}` : libelle(x)}
    </button>
  );
  /** Les variables rangées par groupe, dans l'ordre du catalogue. */
  const parGroupe = (liste: VariableOfferte[]) => {
    const groupes: Array<{ nom: string; variables: VariableOfferte[] }> = [];
    for (const x of liste) {
      const nom = fr ? x.groupe.fr : x.groupe.en;
      const g = groupes.find((y) => y.nom === nom);
      if (g) g.variables.push(x); else groupes.push({ nom, variables: [x] });
    }
    return groupes.map((g) => (
      <div key={g.nom} role="group" aria-label={g.nom} className="flex flex-wrap items-center gap-1.5">
        <span className="w-full text-[10px] font-medium uppercase tracking-wide text-text-tertiary">{g.nom}</span>
        {g.variables.map((x) => boutonDe(x, false))}
      </div>
    ));
  };
  const rien = base.length + plus.length + personnalises.length === 0;

  return (
    <div ref={racine} className="space-y-2.5">
      <p className="text-xs font-medium text-text-primary">{fr ? 'Insérer un champ' : 'Insert a field'}</p>
      <div className="space-y-2.5">
        <div className="relative">
          <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)}
            aria-label={fr ? 'Chercher un champ' : 'Search for a field'} placeholder={fr ? 'Chercher un champ…' : 'Search for a field…'}
            className="h-8 w-full rounded-md border border-border bg-surface-primary pl-7 pr-2 text-[12px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <p className="text-[11px] text-text-tertiary">
          {decl
            ? (fr ? `Champs qui auront une valeur pour « ${decl.fr} ». Cliquez dans le texte, puis sur un champ : il s’insère au curseur.` : `Fields that will have a value for “${decl.en}”. Click in the text, then on a field: it is inserted at the cursor.`)
            : (fr ? 'Cliquez dans le texte, puis sur un champ : il s’insère au curseur.' : 'Click in the text, then on a field: it is inserted at the cursor.')}
        </p>

        {avecRemplacement && (
          <div className="rounded-md border border-border px-2 py-1.5">
            <button
              type="button" aria-expanded={siVideOuvert} aria-controls={`${ids}-sivide`} onClick={() => setSiVideOuvert((o) => !o)}
              className="text-[11px] font-medium text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {fr ? 'Si vide : …' : 'If empty: …'}
            </button>
            {siVideOuvert && (
              <div id={`${ids}-sivide`} className="mt-1.5">
                <label htmlFor={`${ids}-sivide-texte`} className="block text-[11px] text-text-secondary">
                  {fr ? 'Texte à mettre quand le champ est vide' : 'Text to use when the field is empty'}
                </label>
                <input
                  id={`${ids}-sivide-texte`} type="text" value={siVide} maxLength={REMPLACEMENT_MAX}
                  onChange={(e) => setSiVide(remplacementPropre(e.target.value))} placeholder={fr ? 'ex. : là' : 'e.g. there'}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-surface-primary px-2 text-[12px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <p className="mt-1 text-[11px] text-text-tertiary">
                  {siVide.trim()
                    ? (fr ? `Le prochain champ inséré s’écrira ${ecriture('client_first_name', siVide.trim())} : « ${siVide.trim()} » quand il est vide.` : `The next field inserted is written ${ecriture('client_first_name', siVide.trim())}: “${siVide.trim()}” when it is empty.`)
                    : (fr ? 'Ex. : « Bonjour [client_first_name|là], » donne « Bonjour là, » quand le prénom manque.' : 'E.g. “Hello [client_first_name|there],” gives “Hello there,” when the first name is missing.')}
                </p>
              </div>
            )}
          </div>
        )}

        {message && <p role="alert" className="text-[11px] text-danger">{message}</p>}

        {rien ? (
          <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun champ ne correspond à cette recherche.' : 'No field matches this search.'}</p>
        ) : (
          <>
            {base.length > 0 && (
              <section aria-labelledby={`${ids}-base`} className="space-y-1.5">
                <h4 id={`${ids}-base`} className="text-[11px] font-semibold text-text-primary">{fr ? 'Champs de base' : 'Base fields'}</h4>
                {parGroupe(base)}
              </section>
            )}

            {plus.length > 0 && (enRecherche ? (
              <section aria-labelledby={`${ids}-plus`} className="space-y-1.5">
                <h4 id={`${ids}-plus`} className="text-[11px] font-semibold text-text-primary">{fr ? 'Plus de champs' : 'More fields'}</h4>
                {parGroupe(plus)}
              </section>
            ) : (
              <details className="w-full">
                <summary className="cursor-pointer text-[11px] font-medium text-text-secondary hover:text-text-primary">{fr ? 'Plus de champs' : 'More fields'}</summary>
                <div className="mt-1.5 space-y-1.5">{parGroupe(plus)}</div>
              </details>
            ))}

            {personnalises.length > 0 && (
              <section aria-labelledby={`${ids}-perso`} className="space-y-1.5 border-t border-border pt-2">
                <h4 id={`${ids}-perso`} className="text-[11px] font-semibold text-text-primary">{fr ? 'Champs personnalisés' : 'Custom fields'}</h4>
                <div className="flex flex-wrap gap-1.5">{personnalises.map((x) => boutonDe(x, true))}</div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
