/**
 * ConfirmDialog — remplaçant applicatif du `confirm()` natif du navigateur.
 *
 * Usage, depuis n'importe où (composant React, *Api.ts, callback) :
 *
 *   if (!(await confirmer({ message: 'Supprimer ce devis ?', danger: true }))) return;
 *
 * Fonctionnement : un petit store au niveau du module empile les demandes ;
 * `<ConfirmDialogHost />` (monté UNE fois dans main.tsx, sous LanguageProvider)
 * affiche la demande en tête de file et résout la promesse au clic.
 * Look identique à LeaveFormConfirm. Échap / clic sur l'overlay = annuler.
 * Le focus initial va sur « Annuler » : une touche Entrée par réflexe ne
 * déclenche jamais une action destructrice.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from '../../i18n';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Bouton de confirmation rouge (suppression, annulation, écrasement). */
  danger?: boolean;
}

interface Demande {
  id: number;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

// --- Store module-level -------------------------------------------------
let file: Demande[] = [];
let compteur = 0;
const abonnes = new Set<() => void>();

function notifier() {
  abonnes.forEach((cb) => cb());
}

function subscribe(cb: () => void) {
  abonnes.add(cb);
  return () => {
    abonnes.delete(cb);
  };
}

function getSnapshot(): Demande | null {
  return file[0] ?? null;
}

function repondre(id: number, ok: boolean) {
  const demande = file.find((d) => d.id === id);
  if (!demande) return;
  file = file.filter((d) => d.id !== id);
  notifier();
  demande.resolve(ok);
}

/**
 * Demande une confirmation à l'utilisateur. Résout `true` si confirmé,
 * `false` si annulé (bouton, Échap ou clic hors de la carte).
 * Sans Host monté (ne devrait jamais arriver : il est dans main.tsx), on
 * REFUSE : une confirmation qui ne peut pas être posée ne vaut pas un oui —
 * la plupart des appels protègent une suppression.
 */
export function confirmer(options: ConfirmOptions): Promise<boolean> {
  if (abonnes.size === 0) {
    console.error('[confirmer] ConfirmDialogHost non monté — action refusée', options.message);
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    file = [...file, { id: ++compteur, options, resolve }];
    notifier();
  });
}

// --- Host ---------------------------------------------------------------
export function ConfirmDialogHost() {
  const demande = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!demande) return null;
  return <ConfirmDialogView key={demande.id} demande={demande} />;
}

function ConfirmDialogView({ demande }: { demande: Demande }) {
  const { t } = useTranslation();
  const annulerRef = useRef<HTMLButtonElement>(null);
  const { options, id } = demande;

  const annuler = () => repondre(id, false);
  const valider = () => repondre(id, true);

  useEffect(() => {
    annulerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        repondre(id, false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [id]);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={annuler}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`confirm-title-${id}`}
        aria-describedby={`confirm-message-${id}`}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={`confirm-title-${id}`} className="text-3xl font-extrabold tracking-tight text-text-primary">
          {options.title ?? t.modals.confirmTitle}
        </h3>
        <p id={`confirm-message-${id}`} className="text-base font-medium text-text-primary mt-3 whitespace-pre-line">
          {options.message}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <button
            ref={annulerRef}
            type="button"
            onClick={annuler}
            className="flex-1 rounded-xl border border-border bg-surface-secondary px-4 py-2 font-semibold text-text-primary shadow-sm transition-colors hover:bg-surface-tertiary"
          >
            {options.cancelLabel ?? t.modals.cancelBtn}
          </button>
          <button
            type="button"
            onClick={valider}
            className={
              options.danger
                ? 'flex-1 rounded-xl bg-red-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-red-700'
                : 'flex-1 rounded-xl bg-primary px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:opacity-90'
            }
          >
            {options.confirmLabel ?? t.modals.confirmBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
