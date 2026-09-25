/**
 * Saisie d'UNE valeur de champ personnalisé, selon son type.
 *
 * Composant contrôlé et sans réseau : le parent décide quand enregistrer
 * (au blur pour le texte, au changement pour une liste ou une date). Sert
 * au panneau des fiches (CustomFieldsPanel) et à l'aperçu en direct de la
 * création de champ.
 *
 * Montant : l'utilisateur tape des DOLLARS, la valeur émise est en CENTS
 * (règle Lume : *_cents = source de vérité).
 */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import DatePickerInput from '../ui/DatePickerInput';
import type { ChampPerso, ValeurChamp } from '../../lib/champs/types';

interface Props {
  id: string;
  champ: Pick<ChampPerso, 'label' | 'field_type' | 'config' | 'options' | 'placeholder'>;
  valeur: ValeurChamp;
  fr: boolean;
  /** Valeur « à écrire » (texte : au blur ; le reste : tout de suite). */
  onValider: (v: ValeurChamp) => void;
  disabled?: boolean;
  invalide?: boolean;
  /** Décrit par (message d'erreur / aide). */
  describedBy?: string;
}

const base = 'w-full h-9 px-3 text-[14px] bg-surface-card border rounded-md text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors';

export default function ChampSaisie({ id, champ, valeur, fr, onValider, disabled, invalide, describedBy }: Props) {
  const bord = invalide ? 'border-red-400' : 'border-outline';
  const options = champ.options.filter((o) => !o.archived_at || (Array.isArray(valeur) ? valeur.includes(o.id) : valeur === o.id));

  // Texte en cours de frappe : on n'écrit qu'au blur (ou Entrée).
  const versTexte = (v: ValeurChamp) => {
    if (v === null || v === undefined) return '';
    if (champ.field_type === 'monetary') return String(Number(v) / 100);
    return String(v);
  };
  const [brouillon, setBrouillon] = useState(versTexte(valeur));
  useEffect(() => { setBrouillon(versTexte(valeur)); }, [valeur]); // eslint-disable-line react-hooks/exhaustive-deps

  const commettre = () => {
    const t = brouillon.trim();
    if (t === versTexte(valeur)) return;
    if (t === '') return onValider(null);
    if (champ.field_type === 'monetary') {
      const n = Number(t.replace(/[\s$]/g, '').replace(',', '.'));
      return onValider(Number.isFinite(n) ? Math.round(n * 100) : t);
    }
    if (champ.field_type === 'number') {
      const n = Number(t.replace(/\s/g, '').replace(',', '.'));
      return onValider(Number.isFinite(n) ? n : t);
    }
    return onValider(t);
  };

  switch (champ.field_type) {
    case 'multi_line':
      return (
        <textarea
          id={id} rows={3} disabled={disabled} value={brouillon} aria-invalid={invalide} aria-describedby={describedBy}
          placeholder={champ.placeholder ?? ''}
          onChange={(e) => setBrouillon(e.target.value)} onBlur={commettre}
          className={cn(base, bord, 'h-auto py-2 resize-y')}
        />
      );
    case 'dropdown_single':
      return (
        <select
          id={id} disabled={disabled} aria-invalid={invalide} aria-describedby={describedBy}
          value={typeof valeur === 'string' ? valeur : ''}
          onChange={(e) => onValider(e.target.value || null)}
          className={cn(base, bord)}
        >
          <option value="">{fr ? '— Aucun —' : '— None —'}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}{o.archived_at ? (fr ? ' (retirée)' : ' (removed)') : ''}</option>
          ))}
        </select>
      );
    case 'dropdown_multi': {
      const choisies = Array.isArray(valeur) ? valeur : [];
      return (
        <div id={id} role="group" aria-label={champ.label} aria-describedby={describedBy} className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const actif = choisies.includes(o.id);
            return (
              <button
                key={o.id} type="button" disabled={disabled || (!!o.archived_at && !actif)} aria-pressed={actif}
                onClick={() => onValider(actif ? choisies.filter((x) => x !== o.id) : [...choisies, o.id])}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  actif ? 'border-transparent text-text-primary' : 'border-outline text-text-secondary hover:text-text-primary',
                )}
                style={actif ? { backgroundColor: `${o.color ?? '#94a3b8'}33` } : undefined}
              >
                {actif && <Check size={12} aria-hidden />}
                {o.label}
              </button>
            );
          })}
          {options.length === 0 && <span className="text-[12px] text-text-tertiary">{fr ? 'Aucune option' : 'No options'}</span>}
        </div>
      );
    }
    case 'date':
      if (champ.config.include_time) {
        // datetime-local : heure murale du navigateur → ISO (instant).
        const local = typeof valeur === 'string' && valeur
          ? new Date(new Date(valeur).getTime() - new Date(valeur).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
          : '';
        return (
          <input
            id={id} type="datetime-local" disabled={disabled} aria-invalid={invalide} aria-describedby={describedBy}
            value={local}
            onChange={(e) => onValider(e.target.value ? new Date(e.target.value).toISOString() : null)}
            className={cn(base, bord)}
          />
        );
      }
      return (
        <div aria-describedby={describedBy}>
          <DatePickerInput
            value={typeof valeur === 'string' ? valeur.slice(0, 10) : ''}
            onChange={(v: string) => onValider(v || null)}
            language={fr ? 'fr' : 'en'}
            disabled={disabled}
            placeholder={champ.placeholder ?? undefined}
          />
        </div>
      );
    default: {
      const type = champ.field_type === 'email' ? 'email' : champ.field_type === 'phone' ? 'tel'
        : champ.field_type === 'number' || champ.field_type === 'monetary' ? 'text' : 'text';
      return (
        <div className="relative">
          {champ.field_type === 'monetary' && (
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-text-tertiary">
              {champ.config.currency || 'CAD'}
            </span>
          )}
          <input
            id={id} type={type} disabled={disabled} aria-invalid={invalide} aria-describedby={describedBy}
            inputMode={champ.field_type === 'number' || champ.field_type === 'monetary' ? 'decimal' : undefined}
            placeholder={champ.placeholder ?? ''}
            value={brouillon}
            onChange={(e) => setBrouillon(e.target.value)}
            onBlur={commettre}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commettre(); } }}
            className={cn(base, bord, champ.field_type === 'monetary' && 'pr-12')}
          />
        </div>
      );
    }
  }
}
