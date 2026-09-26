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
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { lienFichierChamp, televerserFichierChamp } from '../../lib/champsPersoApi';
import { nomFichier } from '../../lib/champs/valeurs';
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
  // Dernier texte déjà envoyé : Entrée PUIS la sortie du champ ne doivent pas
  // écrire deux fois la même valeur (deux insertions simultanées → « Doublon refusé »).
  const envoye = useRef<string | null>(null);
  useEffect(() => { setBrouillon(versTexte(valeur)); envoye.current = null; }, [valeur]); // eslint-disable-line react-hooks/exhaustive-deps
  // Refusé : on peut renvoyer le même texte (réessai après une erreur réseau).
  useEffect(() => { if (invalide) envoye.current = null; }, [invalide]);

  const commettre = () => {
    const t = brouillon.trim();
    if (t === versTexte(valeur) || t === envoye.current) return;
    envoye.current = t;
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
    case 'file':
      return <SaisieFichier id={id} valeur={typeof valeur === 'string' ? valeur : null} fr={fr} disabled={disabled}
        describedBy={describedBy} onValider={onValider} />;
    case 'checkbox':
      return (
        <label htmlFor={id} className="inline-flex h-9 items-center gap-2 text-[14px] text-text-primary">
          <input
            id={id} type="checkbox" disabled={disabled} aria-invalid={invalide} aria-describedby={describedBy}
            checked={valeur === true || valeur === 'true'}
            onChange={(e) => onValider(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          {champ.placeholder || (fr ? 'Oui' : 'Yes')}
        </label>
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
      const type = champ.field_type === 'email' ? 'email' : champ.field_type === 'phone' ? 'tel' : champ.field_type === 'url' ? 'url'
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

/** Ouvre un fichier de champ par un lien temporaire (bucket privé). */
export async function ouvrirFichierChamp(chemin: string, fr: boolean) {
  try {
    window.open(await lienFichierChamp(chemin), '_blank', 'noopener,noreferrer');
  } catch (err) {
    console.error('[champs] ouverture du fichier', err);
    toast.error(err instanceof Error ? err.message : (fr ? 'Le fichier n’a pas pu être ouvert.' : 'The file could not be opened.'));
  }
}

/** Champ « Fichier » : téléverser, ouvrir, retirer. Le téléversement précède l'écriture de la valeur. */
function SaisieFichier({ id, valeur, fr, disabled, describedBy, onValider }: {
  id: string; valeur: string | null; fr: boolean; disabled?: boolean; describedBy?: string; onValider: (v: ValeurChamp) => void;
}) {
  const entree = useRef<HTMLInputElement>(null);
  const [envoi, setEnvoi] = useState(false);
  const choisir = async (f: File | undefined) => {
    if (!f) return;
    setEnvoi(true);
    try {
      onValider(await televerserFichierChamp(f));
    } catch (err) {
      console.error('[champs] téléversement', err);
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
      if (entree.current) entree.current.value = '';
    }
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2" aria-describedby={describedBy}>
      {valeur && (
        <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-outline bg-surface-card px-2 py-1 text-[13px]">
          <Paperclip size={12} aria-hidden className="shrink-0 text-text-tertiary" />
          <button type="button" onClick={() => { void ouvrirFichierChamp(valeur, fr); }}
            className="truncate text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" title={nomFichier(valeur)}>
            {nomFichier(valeur)}
          </button>
          {!disabled && (
            <button type="button" onClick={() => onValider(null)} aria-label={fr ? 'Retirer le fichier' : 'Remove file'}
              className="rounded p-0.5 text-text-tertiary hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X size={12} aria-hidden /></button>
          )}
        </span>
      )}
      <input id={id} ref={entree} type="file" className="sr-only" disabled={disabled || envoi}
        accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        onChange={(e) => { void choisir(e.target.files?.[0]); }} />
      <label htmlFor={id}
        className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-outline px-3 text-[13px] text-text-secondary hover:text-text-primary',
          (disabled || envoi) && 'pointer-events-none opacity-50')}>
        {envoi ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Paperclip size={13} aria-hidden />}
        {valeur ? (fr ? 'Remplacer' : 'Replace') : (fr ? 'Téléverser un fichier' : 'Upload a file')}
      </label>
    </div>
  );
}
