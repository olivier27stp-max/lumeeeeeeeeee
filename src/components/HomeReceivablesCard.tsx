/**
 * HomeReceivablesCard — top clients with an outstanding balance (from the
 * shared dashboard query). Bars are relative to the largest balance.
 * Header links to Finances.
 */
import { Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { formatCurrency } from '../lib/utils';
import HomeCard from './HomeCard';
import type { BusinessPerformance } from '../lib/dashboardApi';

type HomeReceivablesCardProps = {
  receivables: BusinessPerformance['receivables'];
  loading?: boolean;
  className?: string;
};

export default function HomeReceivablesCard({ receivables, loading, className }: HomeReceivablesCardProps) {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const clients = receivables.topClients || [];
  const max = Math.max(1, ...clients.map((c) => c.balance));

  return (
    <HomeCard
      icon={Wallet}
      title={fr ? 'À recevoir' : 'Receivable'}
      subtitle={
        receivables.totalDue > 0
          ? `${formatCurrency(receivables.totalDue)} · ${receivables.clientsOwing} ${fr ? 'clients' : 'clients'}`
          : undefined
      }
      action={{ label: fr ? 'Finances' : 'Finances', onClick: () => navigate('/finances') }}
      className={className}
      bodyClassName="-mx-1"
    >
      {loading ? (
        <div className="space-y-2 px-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 bg-surface-tertiary/50 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className="py-10 text-center text-[12px] text-text-muted">
          {fr ? 'Aucun solde à recevoir' : 'Nothing outstanding'}
        </div>
      ) : (
        clients.map((c, i) => (
          <button
            key={`${c.clientName}-${i}`}
            onClick={() => navigate('/finances')}
            className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-text-primary truncate">{c.clientName}</span>
              <span className="text-[13px] font-bold text-text-primary tabular-nums shrink-0">
                {formatCurrency(c.balance)}
              </span>
            </div>
            <div className="h-1 rounded-full bg-surface-tertiary overflow-hidden mt-1.5">
              <span
                className="block h-full rounded-full bg-primary/55"
                style={{ width: `${Math.max(4, (c.balance / max) * 100)}%` }}
              />
            </div>
          </button>
        ))
      )}
    </HomeCard>
  );
}
