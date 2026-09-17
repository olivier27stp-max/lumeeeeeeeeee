import React, { useEffect, useId, useState } from 'react';
import { Search, X } from 'lucide-react';
import { FilterPill } from '../ui';
import DatePickerInput from '../ui/DatePickerInput';
import type { Lang, PeriodPreset, ReportDefinition } from '../../lib/reportsApi';
import { PRESET_LABELS, PRESET_ORDER, presetRange } from '../../lib/reportFormat';

export interface ToolbarState {
  from: string;
  to: string;
  dateField: string;
  filters: Record<string, string>;
}

interface ReportToolbarProps {
  definition: ReportDefinition;
  state: ToolbarState;
  lang: Lang;
  onChange: (next: Partial<ToolbarState>) => void;
}

function activePreset(from: string, to: string): PeriodPreset | null {
  if (!from && !to) return 'all';
  for (const p of PRESET_ORDER) {
    const r = presetRange(p);
    if (r && r.from === from && r.to === to) return p;
  }
  return null;
}

/**
 * Barre d'outils d'un rapport : période (préréglages + dates), colonne de
 * date, pilules de filtres, recherche avec délai. L'état vit dans l'URL de
 * la page (via onChange), pour qu'un rapport filtré soit partageable.
 */
export default function ReportToolbar({ definition, state, lang, onChange }: ReportToolbarProps) {
  const fr = lang === 'fr';
  const searchFilters = definition.filters.filter((f) => f.type === 'search');
  const selectFilters = definition.filters.filter((f) => f.type === 'select');
  const preset = activePreset(state.from, state.to);
  const dateFieldId = useId();

  return (
    <div className="flex flex-col gap-3 mt-4 mb-4">
      {definition.dateFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium text-text-tertiary mr-1">{definition.dateFilter.label[lang]}</span>
          {PRESET_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { const r = presetRange(p); onChange({ from: r?.from || '', to: r?.to || '' }); }}
              className={`h-8 px-3 rounded-md border text-[12px] font-medium transition-colors focus-visible:ring-1 focus-visible:ring-[#94a3b8] ${preset === p
                ? 'bg-text-primary text-white border-text-primary'
                : 'bg-surface text-text-secondary border-outline hover:bg-surface-secondary'}`}
            >
              {PRESET_LABELS[p][lang]}
            </button>
          ))}
          <DatePickerInput value={state.from} onChange={(v) => onChange({ from: v })} language={lang} placeholder={fr ? 'Du' : 'From'} className="h-8 w-[130px]" />
          <DatePickerInput value={state.to} onChange={(v) => onChange({ to: v })} language={lang} placeholder={fr ? 'Au' : 'To'} className="h-8 w-[130px]" />
          {definition.dateFilter.fields && definition.dateFilter.fields.length > 1 && (
            <>
              <label htmlFor={dateFieldId} className="text-[12px] text-text-tertiary ml-1">{fr ? 'sur' : 'by'}</label>
              <select
                id={dateFieldId}
                value={state.dateField || definition.dateFilter.fields[0].value}
                onChange={(e) => onChange({ dateField: e.target.value })}
                className="h-8 px-2 text-[12px] bg-surface-card border border-outline rounded-md text-text-primary focus-visible:ring-1 focus-visible:ring-[#94a3b8]"
              >
                {definition.dateFilter.fields.map((f) => <option key={f.value} value={f.value}>{f.label[lang]}</option>)}
              </select>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {selectFilters.map((f) => (
          <FilterPill
            key={f.key}
            label={f.label[lang]}
            value={state.filters[f.key] || f.default || 'all'}
            onChange={(v) => onChange({ filters: { ...state.filters, [f.key]: v } })}
            options={[{ value: 'all', label: fr ? 'Tous' : 'All' }, ...f.options.map((o) => ({ value: o.value, label: o.label[lang] }))]}
          />
        ))}
        {searchFilters.map((f) => (
          <DebouncedSearch
            key={f.key}
            id={`report-search-${f.key}`}
            value={state.filters[f.key] || ''}
            placeholder={f.placeholder?.[lang] || f.label[lang]}
            ariaLabel={f.label[lang]}
            onChange={(v) => onChange({ filters: { ...state.filters, [f.key]: v } })}
          />
        ))}
      </div>
    </div>
  );
}

function DebouncedSearch({ id, value, placeholder, ariaLabel, onChange }: { id: string; value: string; placeholder: string; ariaLabel: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local.trim()), 300);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <div className="relative">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
      <input
        id={id}
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-9 w-[220px] pl-8 pr-8 text-[13px] bg-surface-card border border-outline rounded-md text-text-primary placeholder:text-text-tertiary focus-visible:ring-1 focus-visible:ring-[#94a3b8] focus-visible:border-[#94a3b8] transition-all"
      />
      {local && (
        <button
          type="button"
          onClick={() => { setLocal(''); onChange(''); }}
          aria-label="Effacer"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary rounded focus-visible:ring-1 focus-visible:ring-[#94a3b8]"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
