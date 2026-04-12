import React from 'react';
import { Plus } from 'lucide-react';
import type { LumePaymentClient } from '../../../lib/financeDashboardApi';

function fmtDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

function generateCardNumber(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = ((hash << 5) - hash + clientId.charCodeAt(i)) | 0;
  }
  const last4 = Math.abs(hash % 10000).toString().padStart(4, '0');
  return `5375  ****  ****  ${last4}`;
}

/* ── Card gradients ─────────────────────────────────────────── */

const CARD_STYLES = [
  'bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950',
  'bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-900',
  'bg-gradient-to-br from-emerald-800 via-emerald-900 to-emerald-950',
  'bg-gradient-to-br from-neutral-700 via-neutral-800 to-neutral-900',
];

/* ── Single client card ─────────────────────────────────────── */

function ClientCard({
  client,
  styleIndex,
}: {
  client: LumePaymentClient;
  styleIndex: number;
}) {
  const cardStyle = CARD_STYLES[styleIndex % CARD_STYLES.length];
  const cardNumber = generateCardNumber(client.client_id);

  return (
    <div
      className={`${cardStyle} rounded-2xl p-5 text-white relative overflow-hidden min-h-[160px] flex flex-col justify-between`}
    >
      {/* Subtle glow pattern */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none">
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white blur-2xl" />
        <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-white blur-2xl" />
      </div>

      {/* Top row */}
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-xs font-medium text-white/60">Lume Card</p>
          <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            Active
          </span>
        </div>
        <p className="text-[10px] font-medium text-white/40 uppercase tracking-wider">Lume Pay</p>
      </div>

      {/* Card number */}
      <p className="text-sm font-mono tracking-[0.15em] text-white/80 mt-4 relative z-10">
        {cardNumber}
      </p>

      {/* Bottom row */}
      <div className="flex items-end justify-between mt-4 relative z-10">
        <div>
          <p className="text-[10px] text-white/40 uppercase tracking-wider">Client</p>
          <p className="text-sm font-medium text-white/90 truncate max-w-[140px]">
            {client.client_name}
          </p>
        </div>
        <p className="text-lg font-bold text-white tabular-nums">
          {fmtDollars(client.total_paid_cents)}
        </p>
      </div>
    </div>
  );
}

/* ── Empty state ────────────────────────────────────────────── */

export function EmptyClientCardsState() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">Client Cards</h3>
          <p className="text-xs text-zinc-400">Virtual client cards linked to Lume Payments</p>
        </div>
      </div>

      {/* Disabled sample card */}
      <div className="rounded-2xl bg-zinc-100 p-5 opacity-50 blur-[0.5px] min-h-[140px] flex flex-col justify-between border border-zinc-200">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-zinc-400">Lume Card</p>
            <span className="inline-flex items-center rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 mt-1">
              Inactive
            </span>
          </div>
          <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Lume Pay</p>
        </div>
        <p className="text-sm font-mono tracking-[0.15em] text-zinc-300 mt-3">
          **** **** **** ****
        </p>
        <p className="text-xs text-zinc-300 mt-3">No client linked</p>
      </div>

      <p className="text-sm text-zinc-500 text-center mt-4">
        No active Lume Payments clients yet
      </p>
      <div className="flex justify-center mt-3">
        <button className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 text-white text-xs font-medium py-2.5 px-5 hover:bg-zinc-800 transition-colors">
          Activate Lume Payments
        </button>
      </div>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────── */

export default function ClientPaymentCards({
  clients,
}: {
  clients: LumePaymentClient[];
}) {
  if (clients.length === 0) {
    return <EmptyClientCardsState />;
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">Client Cards</h3>
          <p className="text-xs text-zinc-400">
            A total of {clients.length} card{clients.length > 1 ? 's' : ''} listed
          </p>
        </div>
        <button className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 transition-colors">
          <Plus size={13} />
          Add New
        </button>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {clients.slice(0, 4).map((client, i) => (
          <ClientCard key={client.client_id} client={client} styleIndex={i} />
        ))}
      </div>
    </div>
  );
}
