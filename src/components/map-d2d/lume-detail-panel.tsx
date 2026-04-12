import { useState, useEffect } from 'react';

// Inlined from @/types/lume
interface LumeCustomerSummary {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  address: string;
  created_at: string;
  updated_at: string;
  lume_url: string;
}

interface LumeJobSummary {
  id: string;
  service_type: string;
  requested_date: string;
  scheduled_date: string;
  job_status: string;
  estimated_value: number | null;
  customer_id: string;
  lume_url: string;
}

interface LumeDetailPanelProps {
  customerId: string;
  jobId: string | null;
  onClose: () => void;
  onRetry?: () => void;
}

export function LumeDetailPanel({ customerId, jobId, onClose, onRetry }: LumeDetailPanelProps) {
  const [customer, setCustomer] = useState<LumeCustomerSummary | null>(null);
  const [job, setJob] = useState<LumeJobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');

      try {
        const [custRes, jobRes] = await Promise.all([
          fetch(`/api/lume/customer?id=${customerId}`),
          jobId ? fetch(`/api/lume/job?id=${jobId}`) : null,
        ]);

        if (custRes.ok) setCustomer(await custRes.json());
        if (jobRes?.ok) setJob(await jobRes.json());

        if (!custRes.ok) throw new Error('Impossible de charger les informations');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur de chargement');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [customerId, jobId]);

  const row = 'flex items-center justify-between py-2 border-b border-white/5 last:border-0';
  const label = 'text-[11px] text-white/35';
  const value = 'text-[12px] font-medium text-white/80';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-[380px] rounded-2xl border border-white/10 bg-[#0c0c14] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-3.5">
          <h3 className="text-[14px] font-bold text-white">Détails du client</h3>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-white/30 hover:bg-white/8 hover:text-white/60">
            ✕
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          </div>
        )}

        {error && !loading && (
          <div className="px-5 py-8 text-center">
            <p className="text-[12px] text-red-400">{error}</p>
            {onRetry && (
              <button onClick={onRetry} className="mt-3 rounded-lg bg-indigo-500 px-4 py-2 text-[12px] font-semibold text-white">
                Réessayer
              </button>
            )}
          </div>
        )}

        {!loading && !error && customer && (
          <div className="px-5 py-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-white/25">Client</p>
            <div className={row}><span className={label}>Nom</span><span className={value}>{customer.full_name}</span></div>
            <div className={row}><span className={label}>Téléphone</span><span className={value}>{customer.phone}</span></div>
            {customer.email && <div className={row}><span className={label}>Courriel</span><span className={value}>{customer.email}</span></div>}
            <div className={row}><span className={label}>Adresse</span><span className={value}>{customer.address}</span></div>

            {job && (
              <>
                <p className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wider text-white/25">Travail</p>
                <div className={row}><span className={label}>Service</span><span className={value}>{job.service_type}</span></div>
                <div className={row}>
                  <span className={label}>Statut</span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">{job.job_status}</span>
                </div>
                <div className={row}><span className={label}>Date</span><span className={value}>{job.requested_date}</span></div>
                {job.estimated_value && (
                  <div className={row}><span className={label}>Valeur</span><span className={value}>{job.estimated_value.toLocaleString('fr-CA')} $</span></div>
                )}
              </>
            )}

            <div className="mt-5 flex gap-2">
              {customer.lume_url && (
                <a href={customer.lume_url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-center text-[12px] font-medium text-indigo-400 transition-colors hover:bg-white/10">
                  Voir les détails
                </a>
              )}
              <button onClick={onClose} className="flex-1 rounded-lg bg-white/8 py-2 text-[12px] font-medium text-white/60 transition-colors hover:bg-white/12">
                Fermer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
