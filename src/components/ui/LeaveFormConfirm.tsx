/**
 * LeaveFormConfirm — "leave without saving?" confirmation shown when the user
 * navigates away from a form that contains unsaved data. Rendered as an overlay
 * filling its positioned parent. The "leave anyway" CTA is intentionally red.
 */
import { useTranslation } from '../../i18n';

interface LeaveFormConfirmProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function LeaveFormConfirm({ open, onConfirm, onCancel }: LeaveFormConfirmProps) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold tracking-tight text-text-primary">{t.modals.leaveFormTitle}</h3>
        <p className="text-[13px] text-text-tertiary mt-2">{t.modals.leaveFormBody}</p>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="glass-button">
            {t.modals.keepEditingBtn}
          </button>
          <button type="button" onClick={onConfirm} className="glass-button-danger px-4 py-2 font-semibold">
            {t.modals.leaveAnywayBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
