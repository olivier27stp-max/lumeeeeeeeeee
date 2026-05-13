import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { X, UserPlus, Copy, Check, Mail, Phone, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import {
  listDemoRequests,
  updateDemoRequest,
  createAccountForDemoRequest,
  DEMO_STATUSES,
  type DemoRequest,
  type DemoStatus,
} from '../../lib/demoRequestsApi';

const STATUS_COLORS: Record<DemoStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  contacted: 'bg-amber-100 text-amber-800',
  demoed: 'bg-purple-100 text-purple-800',
  converted: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-gray-200 text-gray-700',
};

export default function DemoRequests() {
  const { t } = useTranslation();
  const dr = (t as any).admin?.demoRequests || {};
  const qc = useQueryClient();
  const [filter, setFilter] = useState<DemoStatus | 'all'>('all');
  const [selected, setSelected] = useState<DemoRequest | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['demo-requests', filter],
    queryFn: () => listDemoRequests(filter === 'all' ? undefined : filter),
    staleTime: 30_000,
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length };
    for (const s of DEMO_STATUSES) c[s] = requests.filter(r => r.status === s).length;
    return c;
  }, [requests]);

  function onUpdated(updated: DemoRequest) {
    qc.invalidateQueries({ queryKey: ['demo-requests'] });
    setSelected(updated);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{dr.title || 'Demo requests'}</h1>
        <p className="text-sm text-text-tertiary mt-1">{dr.subtitle || 'Inbound prospects from the marketing site'}</p>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        <Pill
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label={dr.filterAll || 'All'}
          count={counts.all}
        />
        {DEMO_STATUSES.map(s => (
          <Pill
            key={s}
            active={filter === s}
            onClick={() => setFilter(s)}
            label={dr.statuses?.[s] || s}
            count={counts[s] || 0}
          />
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-surface-card border border-border shadow-card overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-sm text-text-tertiary">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="p-10 text-center text-sm text-text-tertiary">{dr.empty || 'No demo requests yet.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[120px_1.2fr_1.2fr_1.4fr_120px_1fr_110px] gap-3 px-5 py-3 text-[11px] uppercase tracking-wide font-semibold text-text-tertiary bg-surface-tertiary border-b border-border">
                <div>{dr.cols?.created || 'Created'}</div>
                <div>{dr.cols?.name || 'Name'}</div>
                <div>{dr.cols?.company || 'Company'}</div>
                <div>{dr.cols?.email || 'Email'}</div>
                <div>{dr.cols?.phone || 'Phone'}</div>
                <div>{dr.cols?.industry || 'Industry'}</div>
                <div>{dr.cols?.status || 'Status'}</div>
              </div>
              {requests.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="w-full grid grid-cols-[120px_1.2fr_1.2fr_1.4fr_120px_1fr_110px] gap-3 px-5 py-3 text-sm text-text-primary hover:bg-surface-tertiary border-b border-border text-left items-center"
                >
                  <div className="text-xs text-text-tertiary">{fmtDate(r.created_at)}</div>
                  <div className="font-medium truncate">{r.full_name}</div>
                  <div className="truncate">{r.company_name}</div>
                  <div className="truncate text-xs">{r.email}</div>
                  <div className="text-xs">{r.phone}</div>
                  <div className="text-xs capitalize">{r.industry.replace(/_/g, ' ')}</div>
                  <div>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLORS[r.status]}`}>
                      {dr.statuses?.[r.status] || r.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selected && (
          <Drawer
            key={selected.id}
            request={selected}
            onClose={() => setSelected(null)}
            onUpdated={onUpdated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Pill({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active ? 'bg-[#111] text-white' : 'bg-surface-tertiary text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${active ? 'bg-white/20' : 'bg-white/60 text-text-tertiary'}`}>
        {count}
      </span>
    </button>
  );
}

function Drawer({
  request,
  onClose,
  onUpdated,
}: {
  request: DemoRequest;
  onClose: () => void;
  onUpdated: (r: DemoRequest) => void;
}) {
  const { t } = useTranslation();
  const dr = (t as any).admin?.demoRequests || {};
  const [notes, setNotes] = useState<string>(request.notes || '');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const statusMutation = useMutation({
    mutationFn: (status: DemoStatus) => updateDemoRequest(request.id, { status }),
    onSuccess: (r) => { onUpdated(r); toast.success('Status updated'); },
    onError: (err: any) => toast.error(err?.message || 'Failed'),
  });

  const notesMutation = useMutation({
    mutationFn: () => updateDemoRequest(request.id, { notes }),
    onSuccess: (r) => { onUpdated(r); toast.success('Notes saved'); },
    onError: (err: any) => toast.error(err?.message || 'Failed'),
  });

  const createAccountMutation = useMutation({
    mutationFn: () => createAccountForDemoRequest(request.id),
    onSuccess: (r) => {
      toast.success(dr.drawer?.accountCreated || 'Account created');
      if (r.invitation_url) setInviteUrl(r.invitation_url);
      // refetch by triggering parent update
      onUpdated({ ...request, status: 'converted', converted_user_id: r.user_id, converted_at: new Date().toISOString() });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create account'),
  });

  function confirmCreateAccount() {
    if (!window.confirm((dr.drawer?.createAccountConfirm || 'Send invitation to this prospect?'))) return;
    createAccountMutation.mutate();
  }

  function copyUrl() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.25 }}
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-surface overflow-y-auto"
      >
        <div className="sticky top-0 bg-surface border-b border-border p-5 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-text-primary">{request.full_name}</h2>
            <p className="text-xs text-text-tertiary">{request.company_name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-tertiary">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Details */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-3">
              {dr.drawer?.details || 'Details'}
            </h3>
            <div className="space-y-2 text-sm">
              <DetailRow icon={Mail} label={dr.cols?.email || 'Email'} value={request.email} href={`mailto:${request.email}`} />
              <DetailRow icon={Phone} label={dr.cols?.phone || 'Phone'} value={request.phone} href={`tel:${request.phone}`} />
              <DetailRow icon={Building2} label={dr.cols?.industry || 'Industry'} value={request.industry.replace(/_/g, ' ')} />
              {request.employee_count && <DetailRow label="Team size" value={request.employee_count} />}
              {request.source && <DetailRow label="Source" value={request.source} />}
              {request.availability && <DetailRow label="Availability" value={request.availability} />}
              {request.message && (
                <div className="pt-2">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-1">Message</p>
                  <p className="text-sm text-text-primary bg-surface-tertiary rounded-lg p-3 whitespace-pre-wrap">{request.message}</p>
                </div>
              )}
              <p className="pt-2 text-xs text-text-tertiary">Submitted {fmtDate(request.created_at)}</p>
            </div>
          </section>

          {/* Status */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-3">
              {dr.drawer?.changeStatus || 'Change status'}
            </h3>
            <div className="flex flex-wrap gap-2">
              {DEMO_STATUSES.map(s => (
                <button
                  key={s}
                  disabled={statusMutation.isPending || request.status === s}
                  onClick={() => statusMutation.mutate(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                    request.status === s
                      ? STATUS_COLORS[s]
                      : 'bg-surface-tertiary text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {dr.statuses?.[s] || s}
                </button>
              ))}
            </div>
          </section>

          {/* Notes */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">
              {dr.drawer?.notes || 'Internal notes'}
            </h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={dr.drawer?.notesPlaceholder || 'Add internal notes...'}
              rows={4}
              className="w-full px-3 py-2 border border-border bg-surface text-sm text-text-primary rounded-lg focus:outline-none focus:border-primary resize-none"
            />
            <button
              onClick={() => notesMutation.mutate()}
              disabled={notesMutation.isPending}
              className="mt-2 px-4 py-2 bg-text-primary text-surface rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {notesMutation.isPending ? 'Saving...' : (dr.drawer?.saveNotes || 'Save notes')}
            </button>
          </section>

          {/* Create account */}
          <section className="pt-3 border-t border-border">
            <button
              onClick={confirmCreateAccount}
              disabled={createAccountMutation.isPending || request.status === 'converted'}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#3FAF97] text-white px-4 py-3 rounded-lg text-sm font-bold hover:bg-[#1F5F4F] disabled:opacity-60 transition-colors"
            >
              <UserPlus size={16} />
              {createAccountMutation.isPending
                ? (dr.drawer?.creating || 'Creating...')
                : request.status === 'converted'
                  ? (dr.drawer?.accountCreated || 'Account created')
                  : (dr.drawer?.createAccount || 'Create account')}
            </button>

            {inviteUrl && (
              <div className="mt-3 p-3 bg-surface-tertiary rounded-lg">
                <p className="text-xs font-semibold text-text-tertiary mb-1.5">Invitation link</p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="flex-1 px-2 py-1.5 text-xs bg-surface border border-border rounded font-mono truncate"
                  />
                  <button
                    onClick={copyUrl}
                    className="p-2 bg-text-primary text-surface rounded hover:opacity-90"
                    title={dr.drawer?.copyInviteLink || 'Copy'}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DetailRow({
  icon: Icon, label, value, href,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  href?: string;
}) {
  const content = href ? (
    <a href={href} className="text-primary hover:underline">{value}</a>
  ) : (
    <span className="text-text-primary">{value}</span>
  );
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon size={14} className="text-text-tertiary shrink-0" />}
      <span className="text-xs text-text-tertiary min-w-[80px]">{label}</span>
      {content}
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
