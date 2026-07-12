/**
 * EntityNumberEditor — numéro (#) d'une entité, affiché et modifiable inline
 * sur les pages hub (job, devis, facture, client).
 *
 * Au clic sur le crayon, le numéro devient un champ (chiffres seulement).
 * À la sauvegarde, mêmes règles qu'à la création :
 *   • numérique obligatoire
 *   • jamais au-delà du prochain numéro disponible de l'org
 *   • warning si le numéro est déjà pris (doublon)
 * puis rpc_update_entity_number applique le changement atomiquement (la
 * validation serveur re-vérifie tout et avance le compteur de l'org).
 */
import React, { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  isEntityNumberTaken,
  peekNextNumbers,
  updateEntityNumber,
  type NumberedEntity,
} from '../lib/numbersApi';
import { useTranslation } from '../i18n';

interface EntityNumberEditorProps {
  entity: NumberedEntity;
  entityId: string;
  /** Valeur stockée actuelle (« 12 » ou « INV-000042 »). */
  value: string | null | undefined;
  /** Reçoit la valeur stockée après sauvegarde (formatée pour les factures). */
  onSaved: (nextValue: string) => void;
  /** Texte affiché au repos; défaut « #<value> ». */
  display?: string;
  /** Classes du texte au repos (taille/couleur selon la page). */
  className?: string;
}

export default function EntityNumberEditor({
  entity,
  entityId,
  value,
  onSaved,
  display,
  className = 'text-[20px] font-bold text-text-tertiary',
}: EntityNumberEditorProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (!value) return null;
  const currentDigits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');

  const startEdit = () => {
    setDraft(currentDigits);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setDraft('');
  };

  const save = async () => {
    const digits = draft.trim();
    if (!digits || digits === currentDigits) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      // Prochain numéro disponible : on ne peut pas « sauter » en avant.
      const next = await peekNextNumbers();
      const nextForEntity = entity === 'invoice'
        ? (next?.invoiceSeq != null ? String(next.invoiceSeq) : null)
        : next?.[entity] ?? null;
      if (nextForEntity && parseInt(digits, 10) > parseInt(nextForEntity, 10)) {
        toast.error(fr
          ? `Le numéro ${digits} n'existe pas encore — le prochain disponible est ${nextForEntity}.`
          : `Number ${digits} doesn't exist yet — the next available is ${nextForEntity}.`);
        return;
      }
      // Warning doublon : le numéro est déjà utilisé dans l'org.
      if (await isEntityNumberTaken(entity, digits, entityId)) {
        toast.error(fr
          ? `Le numéro « ${digits} » est déjà utilisé.`
          : `Number "${digits}" is already in use.`);
        return;
      }
      const stored = await updateEntityNumber(entity, entityId, digits);
      onSaved(stored);
      toast.success(fr ? 'Numéro mis à jour.' : 'Number updated.');
      setEditing(false);
    } catch (err: any) {
      toast.error(err?.message || (fr ? 'Impossible de changer le numéro.' : 'Could not change the number.'));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5 align-middle">
        <span className={className}>#</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void save(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          className="glass-input w-24 px-2 py-1 text-[14px] font-semibold"
          inputMode="numeric"
          disabled={saving}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="p-1 rounded-md text-success hover:bg-surface-secondary transition-colors"
          title={fr ? 'Enregistrer' : 'Save'}
        >
          <Check size={15} />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
          title={fr ? 'Annuler' : 'Cancel'}
        >
          <X size={15} />
        </button>
      </span>
    );
  }

  return (
    <span className="group/number inline-flex items-center gap-1 align-middle whitespace-nowrap">
      <span className={className}>{display ?? `#${value}`}</span>
      <button
        type="button"
        onClick={startEdit}
        className="p-1 text-text-tertiary opacity-0 group-hover/number:opacity-100 hover:text-text-primary transition-all print:hidden"
        title={fr ? 'Modifier le numéro' : 'Edit number'}
      >
        <Pencil size={13} />
      </button>
    </span>
  );
}
