/* ═══════════════════════════════════════════════════════════════
   Édition d'un courriel d'automatisation, directement dans son aperçu.

   Le corps est stocké en HTML. Le montrer tel quel — `<div
   style="font-family:sans-serif;max-width:600px;...">` — est illisible pour
   qui veut simplement changer une phrase.

   Ici, le courriel s'affiche comme le client le recevra, et chaque bloc de
   texte est modifiable sur place : on clique sur la phrase, on la corrige.
   Aucune balise n'est jamais visible.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useMemo, useEffect } from 'react';
import { X, Loader2, Check, Plus, Trash2, Type, List } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { updateRuleMessage } from '../../lib/automationRulesApi';
import { htmlVersTexte, texteVersHtml, remplacerVariables } from '../../lib/emailBodyText';

interface Props {
  ruleId: string;
  ruleName: string;
  /** Corps HTML actuel. */
  body: string;
  subject: string;
  fr: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Un bloc du courriel : titre, paragraphe ou puce. */
interface Bloc {
  id: number;
  type: 'titre' | 'paragraphe' | 'puce';
  texte: string;
}

/** Variables du moteur, nommées en clair. */
const VARIABLES: Array<{ cle: string; fr: string; en: string }> = [
  { cle: 'client_first_name', fr: 'Prénom du client', en: 'Client first name' },
  { cle: 'client_name', fr: 'Nom complet', en: 'Full name' },
  { cle: 'company_name', fr: 'Votre entreprise', en: 'Your company' },
  { cle: 'invoice_number', fr: 'N° de facture', en: 'Invoice #' },
  { cle: 'invoice_total', fr: 'Montant', en: 'Amount' },
  { cle: 'quote_number', fr: 'N° de soumission', en: 'Quote #' },
  { cle: 'appointment_date', fr: 'Date du RDV', en: 'Appointment date' },
  { cle: 'appointment_time', fr: 'Heure du RDV', en: 'Appointment time' },
];

let compteurId = 0;

/** Découpe le texte converti en blocs manipulables. */
function texteEnBlocs(texte: string): Bloc[] {
  const lignes = texte.split('\n').filter((l) => l.trim());
  return lignes.map((ligne, i) => ({
    id: compteurId++,
    type: ligne.startsWith('- ') ? 'puce' : i === 0 ? 'titre' : 'paragraphe',
    texte: ligne.startsWith('- ') ? ligne.slice(2) : ligne,
  }));
}

function blocsEnTexte(blocs: Bloc[]): string {
  return blocs
    .map((b) => (b.type === 'puce' ? `- ${b.texte}` : b.texte))
    .join('\n');
}

export default function EmailPreviewEditor({
  ruleId, ruleName, body, subject, fr, onClose, onSaved,
}: Props) {
  const [blocs, setBlocs] = useState<Bloc[]>(() => texteEnBlocs(htmlVersTexte(body)));
  const [objet, setObjet] = useState(subject);
  const [actif, setActif] = useState<number | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistre, setEnregistre] = useState(false);

  const initial = useMemo(() => ({ blocs: blocsEnTexte(texteEnBlocs(htmlVersTexte(body))), objet: subject }), [body, subject]);
  const modifie = blocsEnTexte(blocs) !== initial.blocs || objet !== initial.objet;

  // Échap ferme le panneau — réflexe attendu d'une fenêtre superposée.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const majBloc = (id: number, texte: string) =>
    setBlocs((bs) => bs.map((b) => (b.id === id ? { ...b, texte } : b)));

  const supprimerBloc = (id: number) =>
    setBlocs((bs) => bs.filter((b) => b.id !== id));

  const ajouterBloc = (type: Bloc['type']) =>
    setBlocs((bs) => [...bs, { id: compteurId++, type, texte: '' }]);

  const insererVariable = (cle: string) => {
    const cible = actif ?? blocs[blocs.length - 1]?.id;
    if (cible === undefined) return;
    setBlocs((bs) => bs.map((b) => (b.id === cible ? { ...b, texte: `${b.texte}[${cle}]` } : b)));
  };

  const enregistrer = async () => {
    if (!modifie || enregistrement) return;
    setEnregistrement(true);
    try {
      // Le HTML n'est reconstruit qu'ici : l'utilisateur ne l'a jamais vu.
      await updateRuleMessage(ruleId, 'send_email', texteVersHtml(blocsEnTexte(blocs)), objet);
      setEnregistre(true);
      setTimeout(() => setEnregistre(false), 1800);
      onSaved();
      toast.success(fr ? 'Courriel enregistré' : 'Email saved');
    } catch (e: any) {
      // `updateRuleMessage` lève quand la RLS filtre la ligne — sans quoi
      // l'utilisateur croirait avoir enregistré.
      toast.error(e?.message || (fr ? 'Enregistrement impossible' : 'Could not save'));
    } finally {
      setEnregistrement(false);
    }
  };

  /** Champ auto-dimensionné : le texte ne doit jamais être coupé. */
  const Champ = ({ bloc }: { bloc: Bloc }) => (
    <textarea
      value={bloc.texte}
      onChange={(e) => majBloc(bloc.id, e.target.value)}
      onFocus={() => setActif(bloc.id)}
      rows={1}
      placeholder={fr ? 'Écrivez ici…' : 'Type here…'}
      className={cn(
        'w-full bg-transparent border border-transparent rounded px-2 py-1 resize-none overflow-hidden',
        'hover:border-outline/40 focus:border-primary/60 focus:bg-surface focus:outline-none transition-colors',
        bloc.type === 'titre'
          ? 'text-[17px] font-semibold text-text-primary'
          : 'text-[13px] text-text-secondary leading-relaxed',
      )}
      style={{ height: 'auto', minHeight: bloc.type === 'titre' ? 30 : 26 }}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }}
      ref={(el) => {
        if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
      }}
    />
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl bg-surface-secondary shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outline/50 shrink-0">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary truncate">{ruleName}</p>
            <p className="text-[11px] text-text-tertiary">
              {fr ? 'Cliquez sur le texte pour le modifier' : 'Click the text to edit it'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface-tertiary text-text-secondary shrink-0"
            aria-label={fr ? 'Fermer' : 'Close'}
          >
            <X size={16} />
          </button>
        </div>

        {/* Le courriel */}
        <div className="flex-1 overflow-y-auto p-5 bg-surface-tertiary/30">
          <div className="mx-auto max-w-[600px] rounded-lg bg-white dark:bg-surface shadow-sm overflow-hidden">
            {/* Objet — ce que le client voit dans sa boîte */}
            <div className="px-5 py-3 border-b border-outline/40 bg-surface-secondary/40">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                {fr ? 'Objet' : 'Subject'}
              </p>
              <input
                value={objet}
                onChange={(e) => setObjet(e.target.value)}
                onFocus={() => setActif(null)}
                placeholder={fr ? 'Objet du courriel' : 'Email subject'}
                className="w-full bg-transparent border border-transparent rounded px-2 py-1 text-[13px] font-semibold text-text-primary hover:border-outline/40 focus:border-primary/60 focus:bg-surface focus:outline-none transition-colors"
              />
            </div>

            {/* Corps */}
            <div className="px-5 py-4 space-y-0.5">
              {blocs.map((bloc) => (
                <div key={bloc.id} className="group relative flex items-start gap-1">
                  {bloc.type === 'puce' && (
                    <span className="text-text-tertiary text-[13px] pt-1.5 select-none">•</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <Champ bloc={bloc} />
                  </div>
                  <button
                    onClick={() => supprimerBloc(bloc.id)}
                    title={fr ? 'Supprimer cette ligne' : 'Remove this line'}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-text-tertiary hover:text-red-500 shrink-0 mt-1"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              {blocs.length === 0 && (
                <p className="text-[12px] text-text-tertiary italic py-3">
                  {fr ? 'Courriel vide — ajoutez une ligne ci-dessous.' : 'Empty email — add a line below.'}
                </p>
              )}

              <div className="flex items-center gap-1.5 pt-2">
                <button
                  onClick={() => ajouterBloc('paragraphe')}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
                >
                  <Type size={11} /> {fr ? 'Paragraphe' : 'Paragraph'}
                </button>
                <button
                  onClick={() => ajouterBloc('puce')}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
                >
                  <List size={11} /> {fr ? 'Puce' : 'Bullet'}
                </button>
              </div>
            </div>
          </div>

          {/* Aperçu du rendu final, variables remplacées */}
          <div className="mx-auto max-w-[600px] mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1.5">
              {fr ? 'Ce que le client lira' : 'What the client will read'}
            </p>
            <div className="rounded-lg border border-outline/50 bg-surface p-4">
              {objet && (
                <p className="text-[12px] font-semibold text-text-primary pb-2 mb-2 border-b border-outline/40">
                  {remplacerVariables(objet)}
                </p>
              )}
              {blocs.map((b) => (
                <p
                  key={b.id}
                  className={cn(
                    b.type === 'titre' ? 'text-[13px] font-semibold text-text-primary mb-1.5' : 'text-[12px] text-text-secondary leading-relaxed mb-1.5',
                    b.type === 'puce' && 'pl-3',
                  )}
                >
                  {b.type === 'puce' && '• '}
                  {remplacerVariables(b.texte) || <span className="italic text-text-tertiary">…</span>}
                </p>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-text-tertiary">
              {fr
                ? 'Exemple avec des données fictives — les vraies valeurs du client seront utilisées.'
                : 'Sample data — the client’s real values will be used.'}
            </p>
          </div>
        </div>

        {/* Pied : variables + enregistrement */}
        <div className="border-t border-outline/50 px-5 py-3 shrink-0 bg-surface-secondary">
          <div className="flex flex-wrap items-center gap-1 mb-2.5">
            <span className="text-[10px] text-text-tertiary mr-1">
              {fr ? 'Insérer :' : 'Insert:'}
            </span>
            {VARIABLES.map((v) => (
              <button
                key={v.cle}
                title={`[${v.cle}]`}
                onClick={() => insererVariable(v.cle)}
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary hover:bg-surface-tertiary/70 transition-colors"
              >
                <Plus size={9} /> {fr ? v.fr : v.en}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-text-tertiary">
              {modifie
                ? (fr ? 'Modifications non enregistrées' : 'Unsaved changes')
                : (fr ? 'Aucune modification' : 'No changes')}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-[11px] text-text-secondary hover:bg-surface-tertiary transition-colors"
              >
                {fr ? 'Fermer' : 'Close'}
              </button>
              <button
                onClick={enregistrer}
                disabled={!modifie || enregistrement}
                className={cn(
                  'px-4 py-1.5 rounded-md text-[11px] font-semibold transition-colors flex items-center gap-1.5',
                  modifie && !enregistrement
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'bg-surface-tertiary text-text-tertiary cursor-not-allowed',
                )}
              >
                {enregistrement && <Loader2 size={11} className="animate-spin" />}
                {enregistre && !enregistrement && <Check size={11} />}
                {fr ? 'Enregistrer' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
