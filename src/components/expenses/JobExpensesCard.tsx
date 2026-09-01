/**
 * "Dépenses" card on the job hub — the primary place to log job expenses
 * (a tech buys materials in the field → opens the job → logs it here).
 * Feeds the Profitability by job table in Statistiques via the DB trigger.
 */
import { useTranslation } from '../../i18n';
import ExpensesEditor from './ExpensesEditor';

export default function JobExpensesCard({ jobId, onChanged }: { jobId: string; onChanged?: () => void }) {
  const { language } = useTranslation();
  const fr = language === 'fr';

  return (
    <div className="rounded-xl border border-outline bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-subtle">
        <h2 className="text-[13px] font-semibold text-text-primary">{fr ? 'Dépenses' : 'Expenses'}</h2>
        <span className="text-[11.5px] text-text-tertiary">
          {fr ? 'Comptées dans la rentabilité du job' : 'Counted in job profitability'}
        </span>
      </div>
      <div className="p-5">
        <ExpensesEditor jobId={jobId} onChanged={onChanged} />
      </div>
    </div>
  );
}
