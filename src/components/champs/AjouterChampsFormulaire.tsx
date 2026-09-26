/**
 * Formulaire de demande : « Ajouter des champs personnalisés » — le « Add
 * Object Fields » de GoHighLevel (analyse Muse, 2026-09-25). On coche des
 * champs du client ou du pipeline, « Ajouter N champs », et chacun devient une
 * question DÉJÀ reliée (la réponse remplit le champ), en fin de section.
 */
import { useId, useState } from 'react';
import { Layers, X } from 'lucide-react';
import type { ChampPerso } from '../../lib/champs/types';
import type { FormField, FormFieldType } from '../../types';

/** Type de question du formulaire pour un type de champ personnalisé. */
export function typeQuestion(c: ChampPerso): FormFieldType {
  switch (c.field_type) {
    case 'multi_line': return 'paragraph';
    case 'number':
    case 'monetary': return 'number';
    case 'dropdown_single': return 'dropdown';
    case 'dropdown_multi': return 'checkbox';
    default: return 'text';
  }
}

/** La question créée pour un champ : même libellé, options, obligatoire, et reliée au champ. */
export function questionPour(c: ChampPerso, section: FormField['section'], id: string): FormField {
  const avecOptions = c.field_type === 'dropdown_single' || c.field_type === 'dropdown_multi';
  return {
    id,
    label: c.label,
    type: typeQuestion(c),
    required: !!c.is_required,
    options: avecOptions ? c.options.filter((o) => !o.archived_at).map((o) => o.label) : [],
    section,
    cf_field_id: c.id,
  };
}

export default function AjouterChampsFormulaire({ champs, dejaRelies, fr, onAjouter }: {
  champs: ChampPerso[];
  /** Champs déjà reliés à une question : pas reproposés. */
  dejaRelies: Set<string>;
  fr: boolean;
  onAjouter: (choisis: ChampPerso[]) => void;
}) {
  const ids = useId();
  const [ouvert, setOuvert] = useState(false);
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const libres = champs.filter((c) => !dejaRelies.has(c.id));
  if (champs.length === 0) return null;
  const basculer = (id: string) => setChoisis((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="relative">
      <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}
        className="glass-button inline-flex items-center gap-1 text-[11px]">
        <Layers size={12} aria-hidden />{fr ? 'Ajouter des champs personnalisés' : 'Add custom fields'}
      </button>
      {ouvert && (
        <div role="dialog" aria-label={fr ? 'Ajouter des champs personnalisés' : 'Add custom fields'}
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-outline bg-surface-elevated p-3 shadow-dropdown">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-text-primary">{fr ? 'Champs à ajouter au formulaire' : 'Fields to add to the form'}</p>
            <button type="button" onClick={() => setOuvert(false)} aria-label={fr ? 'Fermer' : 'Close'}
              className="rounded p-0.5 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X size={14} /></button>
          </div>
          {libres.length === 0 ? (
            <p className="text-[12px] text-text-tertiary">{fr ? 'Tous tes champs client et pipeline sont déjà dans le formulaire.' : 'All your client and pipeline fields are already in the form.'}</p>
          ) : (['client', 'deal'] as const).map((o) => {
            const liste = libres.filter((c) => c.object_type === o);
            if (!liste.length) return null;
            return (
              <div key={o} className="mb-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{o === 'deal' ? 'Pipeline' : 'Client'}</p>
                {liste.map((c) => (
                  <label key={c.id} htmlFor={`${ids}-${c.id}`} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[13px] text-text-primary hover:bg-surface-secondary">
                    <input id={`${ids}-${c.id}`} type="checkbox" checked={choisis.has(c.id)} onChange={() => basculer(c.id)} className="h-4 w-4 accent-primary" />
                    <span className="truncate">{c.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {libres.length > 0 && (
            <button type="button" disabled={choisis.size === 0}
              onClick={() => { onAjouter(libres.filter((c) => choisis.has(c.id))); setChoisis(new Set()); setOuvert(false); }}
              className="glass-button-primary mt-1 w-full px-3 py-1.5 text-[12px] disabled:opacity-50">
              {fr ? `Ajouter ${choisis.size} champ${choisis.size > 1 ? 's' : ''}` : `Add ${choisis.size} field${choisis.size > 1 ? 's' : ''}`}
            </button>
          )}
          <p className="mt-2 text-[11px] text-text-tertiary">{fr ? 'Chaque champ devient une question reliée : la réponse remplit le champ du client ou de la carte du pipeline.' : 'Each field becomes a linked question: the answer fills the client or pipeline field.'}</p>
        </div>
      )}
    </div>
  );
}
