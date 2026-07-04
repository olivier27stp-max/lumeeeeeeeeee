/**
 * HomeHero — greeting + day summary (left) and quick-create actions (right).
 * Quick actions mirror the CommandPalette wiring so they land in the same flows:
 *   Devis   → /quotes + `crm:open-new-quote`
 *   Job     → openJobModal()
 *   Client  → /clients + `crm:open-new-client`
 *   Facture → /invoices/new
 */
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { useCompany } from '../contexts/CompanyContext';
import { useJobModalController } from '../contexts/JobModalController';

type HomeHeroProps = {
  appointmentsTotal: number;
  overdue: number;
};

export default function HomeHero({ appointmentsTotal, overdue }: HomeHeroProps) {
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { current } = useCompany();
  const { openJobModal } = useJobModalController();

  const firstName = current?.fullName?.trim().split(/\s+/)[0] || '';
  const greeting = firstName
    ? `${fr ? 'Bon retour' : 'Welcome back'}, ${firstName}`
    : fr ? 'Bon retour' : 'Welcome back';
  const dateLabel = new Date().toLocaleDateString(fr ? 'fr-CA' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const openNewQuote = () => {
    navigate('/quotes');
    setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-quote')), 300);
  };
  const openNewClient = () => {
    navigate('/clients');
    setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-client')), 300);
  };

  const actions: { label: string; onClick: () => void; primary?: boolean }[] = [
    { label: fr ? 'Devis' : 'Quote', onClick: openNewQuote, primary: true },
    { label: 'Job', onClick: () => openJobModal() },
    { label: 'Client', onClick: openNewClient },
    { label: fr ? 'Facture' : 'Invoice', onClick: () => navigate('/invoices/new') },
  ];

  return (
    <div className="flex items-end justify-between gap-6 flex-wrap mb-5">
      <div>
        <h1 className="text-[24px] font-bold text-text-primary tracking-tight">{greeting}</h1>
        <p className="text-[14px] text-text-secondary font-medium mt-1">
          <span className="first-letter:uppercase">{dateLabel}</span>
          {appointmentsTotal > 0 && (
            <>
              <span className="text-text-muted mx-1.5">·</span>
              <span className="tabular-nums">
                {appointmentsTotal} {fr ? 'rendez-vous' : 'appointments'}
              </span>
            </>
          )}
          {overdue > 0 && (
            <>
              <span className="text-text-muted mx-1.5">·</span>
              <span className="tabular-nums">
                {overdue} {fr ? 'en retard' : 'overdue'}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className={
              'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold border transition-colors ' +
              (a.primary
                ? 'bg-primary border-primary text-primary-foreground hover:brightness-110'
                : 'bg-surface-card border-border text-text-primary hover:border-text-muted')
            }
          >
            <Plus size={15} />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
