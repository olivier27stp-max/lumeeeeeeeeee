import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, FileType, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ExportFormat, Lang } from '../../lib/reportsApi';

interface ExportMenuProps {
  lang: Lang;
  /** Nombre de lignes du résultat courant (affiché dans le bouton). */
  total: number;
  exportMaxRows: number;
  pdfMaxRows: number;
  /** Format en cours d'export, ou null. */
  busy: ExportFormat | null;
  disabled?: boolean;
  onExport: (format: ExportFormat) => void;
}

const FORMATS: Array<{ key: ExportFormat; icon: React.ComponentType<{ size?: number; className?: string }>; label: { fr: string; en: string }; hint: { fr: string; en: string } }> = [
  { key: 'xlsx', icon: FileSpreadsheet, label: { fr: 'Excel (.xlsx)', en: 'Excel (.xlsx)' }, hint: { fr: 'Mis en forme : en-têtes, formats, totaux', en: 'Formatted: headers, number formats, totals' } },
  { key: 'pdf', icon: FileText, label: { fr: 'PDF', en: 'PDF' }, hint: { fr: 'Prêt à imprimer ou à envoyer', en: 'Print-ready, shareable' } },
  { key: 'csv', icon: FileType, label: { fr: 'CSV', en: 'CSV' }, hint: { fr: 'Données brutes pour un autre logiciel', en: 'Raw data for another system' } },
];

/**
 * Bouton « Exporter » avec choix du format. Un seul bouton, téléchargement
 * immédiat (décision produit) ; les plafonds sont expliqués dans le menu au
 * lieu de désactiver silencieusement.
 */
export default function ExportMenu({ lang, total, exportMaxRows, pdfMaxRows, busy, disabled, onExport }: ExportMenuProps) {
  const fr = lang === 'fr';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const locale = fr ? 'fr-CA' : 'en-CA';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const limitFor = (f: ExportFormat) => (f === 'pdf' ? pdfMaxRows : exportMaxRows);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || !!busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 h-9 pl-4 pr-3 bg-primary text-white rounded-md text-[13px] font-medium disabled:opacity-50 hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-[#94a3b8]"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        {busy
          ? (fr ? `Export ${busy.toUpperCase()}…` : `Exporting ${busy.toUpperCase()}…`)
          : (fr ? 'Exporter' : 'Export')}
        {!busy && total > 0 && <span className="opacity-70 tabular-nums text-[12px]">{total.toLocaleString(locale)}</span>}
        <ChevronDown size={14} className={cn('opacity-80 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="menu" className="absolute top-full right-0 mt-1.5 w-[300px] bg-surface-elevated border border-outline rounded-lg shadow-dropdown z-50 py-1.5">
          <div className="px-3 pt-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
            {fr ? 'Format du fichier' : 'File format'}
          </div>
          {FORMATS.map((f) => {
            const Icon = f.icon;
            const max = limitFor(f.key);
            const over = total > max;
            return (
              <button
                key={f.key}
                type="button"
                role="menuitem"
                disabled={over || total === 0}
                onClick={() => { setOpen(false); onExport(f.key); }}
                className={cn(
                  'w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:bg-surface-secondary',
                  over || total === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-secondary',
                )}
              >
                <span className="w-8 h-8 rounded-md bg-surface-secondary flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={15} className="text-text-secondary" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-text-primary">{f.label[lang]}</span>
                  <span className="block text-[11.5px] text-text-tertiary leading-snug">
                    {over
                      ? (fr ? `Plafond de ${max.toLocaleString(locale)} lignes dépassé` : `Over the ${max.toLocaleString(locale)} row limit`)
                      : f.hint[lang]}
                  </span>
                </span>
              </button>
            );
          })}
          <div className="mx-3 mt-1.5 pt-2 border-t border-outline text-[11px] text-text-tertiary leading-snug">
            {fr
              ? 'Le fichier reprend exactement les filtres et le tri affichés.'
              : 'The file matches the filters and sort shown on screen.'}
          </div>
        </div>
      )}
    </div>
  );
}
