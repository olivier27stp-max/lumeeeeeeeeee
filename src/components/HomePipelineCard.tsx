/**
 * HomePipelineCard — snapshot of the quote pipeline (from the shared dashboard
 * query's workflow summary). Bars are sized relative to the largest stage.
 * Header links to the Quotes page.
 */
import { Filter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { formatCurrency } from '../lib/utils';
import HomeCard from './HomeCard';
import type { WorkflowSummary } from '../lib/dashboardApi';

type HomePipelineCardProps = {
  workflow: WorkflowSummary;
  loading?: boolean;
  className?: string;
};

export default function HomePipelineCard({ workflow, loading, className }: HomePipelineCardProps) {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const q = workflow.quotes;

  const stages: { name: string; count: number; amount?: number }[] = [
    { name: fr ? 'Prospects actifs' : 'Active leads', count: q.activeLeads },
    { name: fr ? 'Brouillons' : 'Drafts', count: q.draft },
    { name: fr ? 'Modifs demandées' : 'Changes requested', count: q.changesRequested },
    { name: fr ? 'Approuvés' : 'Approved', count: q.approved, amount: q.approvedAmount },
  ];
  const max = Math.max(1, ...stages.map((s) => s.count));

  return (
    <HomeCard
      icon={Filter}
      title={fr ? 'Pipeline' : 'Pipeline'}
      action={{ label: fr ? 'Devis' : 'Quotes', onClick: () => navigate('/quotes') }}
      className={className}
    >
      {loading ? (
        <div className="space-y-3.5 pt-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-6 bg-surface-tertiary/50 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {stages.map((s) => (
            <button
              key={s.name}
              onClick={() => navigate('/quotes')}
              className="text-left group"
            >
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[12px] font-medium text-text-secondary">{s.name}</span>
                <span className="text-[13px] font-bold text-text-primary tabular-nums">
                  {s.count}
                  {s.amount !== undefined && s.amount > 0 && (
                    <span className="text-[11px] font-medium text-text-muted ml-1.5">
                      {formatCurrency(s.amount)}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-tertiary overflow-hidden">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(4, (s.count / max) * 100)}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </HomeCard>
  );
}
