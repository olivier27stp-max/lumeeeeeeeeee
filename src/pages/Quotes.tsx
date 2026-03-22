/* ═══════════════════════════════════════════════════════════════
   Page — Quotes List
   ═══════════════════════════════════════════════════════════════ */

import React, { useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download, FileText, Plus, Search,
  MoreHorizontal, Send, CheckCircle2, Copy, Trash2, Eye, ArrowUpDown,
  Receipt,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import {
  listAllQuotes,
  fetchQuoteKpis,
  formatQuoteMoney,
  deleteQuote,
  sendQuoteEmail,
  sendQuoteSms,
  updateQuoteStatus,
  duplicateQuote,
  convertQuoteToInvoice,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_COLORS,
  type Quote,
  type QuoteStatus,
} from '../lib/quotesApi';
import { cn, formatDate } from '../lib/utils';
import { PageHeader, EmptyState, StatCard, IconTile } from '../components/ui';
import StatusBadge from '../components/ui/StatusBadge';
import { useTranslation } from '../i18n';
import { downloadQuotePdf } from '../lib/generateQuotePdf';
import { getQuoteById } from '../lib/quotesApi';

const PAGE_SIZE = 20;

type StatusTab = 'all' | QuoteStatus;

const TABS: { key: StatusTab; label: string; labelFr: string; dot: string }[] = [
  { key: 'all', label: 'All Quotes', labelFr: 'Tous', dot: '' },
  { key: 'draft', label: 'Draft', labelFr: 'Brouillons', dot: 'bg-gray-400' },
  { key: 'action_required', label: 'Action Req.', labelFr: 'Action req.', dot: 'bg-amber-500' },
  { key: 'sent', label: 'Sent', labelFr: 'Envoy\u00e9s', dot: 'bg-neutral-500' },
  { key: 'approved', label: 'Approved', labelFr: 'Approuv\u00e9s', dot: 'bg-emerald-500' },
  { key: 'declined', label: 'Declined', labelFr: 'D\u00e9clin\u00e9s', dot: 'bg-red-500' },
  { key: 'expired', label: 'Expired', labelFr: 'Expir\u00e9s', dot: 'bg-gray-400' },
  { key: 'converted', label: 'Converted', labelFr: 'Convertis', dot: 'bg-green-500' },
];

export default function Quotes() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const statusFilter = (searchParams.get('status') || 'all') as StatusTab;
  const searchQ = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('page') || '1'));
  const [search, setSearch] = useState(searchQ);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const { data: kpis } = useQuery({
    queryKey: ['quote-kpis'],
    queryFn: fetchQuoteKpis,
    staleTime: 30_000,
  });

  const { data: result, isLoading } = useQuery({
    queryKey: ['quotes-list', statusFilter, searchQ, page],
    queryFn: () => listAllQuotes({ status: statusFilter, search: searchQ, page, pageSize: PAGE_SIZE }),
  });

  const quotes = result?.data || [];
  const total = result?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams);
    p.set(key, value);
    if (key !== 'page') p.set('page', '1');
    setSearchParams(p);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setParam('q', search);
  }

  function getContactName(q: any): string {
    const client = q.clients as any;
    const lead = q.leads as any;
    if (client) return `${client.first_name || ''} ${client.last_name || ''}`.trim() || client.company || 'Client';
    if (lead) return `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.company || 'Lead';
    return '\u2014';
  }

  async function handleDelete(id: string) {
    if (!confirm(language === 'fr' ? 'Supprimer ce devis ?' : 'Delete this quote?')) return;
    try {
      await deleteQuote(id);
      queryClient.invalidateQueries({ queryKey: ['quotes-list'] });
      queryClient.invalidateQueries({ queryKey: ['quote-kpis'] });
      toast.success(language === 'fr' ? 'Devis supprim\u00e9' : 'Quote deleted');
    } catch { toast.error('Failed to delete'); }
  }

  async function handleSendEmail(id: string) {
    try {
      await sendQuoteEmail(id);
      queryClient.invalidateQueries({ queryKey: ['quotes-list'] });
      toast.success(language === 'fr' ? 'Email envoy\u00e9' : 'Quote email sent');
    } catch (e: any) { toast.error(e?.message || 'Failed to send'); }
    setMenuOpen(null);
  }

  async function handleDuplicate(id: string) {
    try {
      const dup = await duplicateQuote(id);
      queryClient.invalidateQueries({ queryKey: ['quotes-list'] });
      queryClient.invalidateQueries({ queryKey: ['quote-kpis'] });
      toast.success(language === 'fr' ? 'Devis dupliqu\u00e9' : 'Quote duplicated');
    } catch { toast.error('Failed to duplicate'); }
    setMenuOpen(null);
  }

  async function handleConvertToInvoice(id: string) {
    try {
      const { invoiceId } = await convertQuoteToInvoice(id);
      queryClient.invalidateQueries({ queryKey: ['quotes-list'] });
      queryClient.invalidateQueries({ queryKey: ['quote-kpis'] });
      toast.success(language === 'fr' ? 'Facture cr\u00e9\u00e9e' : 'Invoice created');
      navigate(`/invoices/${invoiceId}`);
    } catch (e: any) { toast.error(e?.message || 'Failed to convert'); }
    setMenuOpen(null);
  }

  async function handleDownloadPdf(id: string) {
    try {
      const detail = await getQuoteById(id);
      if (detail) downloadQuotePdf(detail);
    } catch { toast.error('Failed to generate PDF'); }
    setMenuOpen(null);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={language === 'fr' ? 'Devis' : 'Quotes'}
        subtitle={language === 'fr' ? 'G\u00e9rez vos devis et propositions' : 'Manage your quotes and proposals'}
      />

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label={language === 'fr' ? 'En attente' : 'Pending'}
            value={formatQuoteMoney(kpis.pending_value_cents)}
            subtitle={`${kpis.pending_count} ${language === 'fr' ? 'devis' : 'quotes'}`}
            icon={FileText}
            iconColor="amber"
          />
          <StatCard
            label={language === 'fr' ? 'Approuv\u00e9s' : 'Approved'}
            value={formatQuoteMoney(kpis.approved_value_cents)}
            subtitle={`${kpis.approved_count} ${language === 'fr' ? 'devis' : 'quotes'}`}
            icon={CheckCircle2}
            iconColor="green"
          />
          <StatCard
            label={language === 'fr' ? 'Total' : 'Total Value'}
            value={formatQuoteMoney(kpis.total_value_cents)}
            subtitle={`${kpis.total_count} ${language === 'fr' ? 'devis' : 'quotes'}`}
            icon={Receipt}
            iconColor="blue"
          />
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setParam('status', tab.key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap',
                statusFilter === tab.key
                  ? 'bg-surface-tertiary text-text-primary'
                  : 'text-text-secondary hover:bg-surface-secondary'
              )}
            >
              {tab.dot && <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1.5', tab.dot)} />}
              {language === 'fr' ? tab.labelFr : tab.label}
            </button>
          ))}
        </div>
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={language === 'fr' ? 'Rechercher...' : 'Search...'}
              className="pl-8 pr-3 py-1.5 text-[13px] border border-outline rounded-lg bg-surface w-48 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </form>
      </div>

      {/* Table */}
      <div className="bg-surface rounded-xl border border-outline overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-outline border-t-text-primary rounded-full animate-spin" />
          </div>
        ) : quotes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={language === 'fr' ? 'Aucun devis' : 'No quotes'}
            description={language === 'fr' ? 'Cr\u00e9ez votre premier devis' : 'Create your first quote'}
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-surface-secondary border-b border-outline">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold text-text-secondary">#</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-secondary">{language === 'fr' ? 'Client' : 'Client'}</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-secondary">{language === 'fr' ? 'Titre' : 'Title'}</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-secondary">Status</th>
                <th className="text-right px-4 py-2.5 font-semibold text-text-secondary">Total</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-secondary">{language === 'fr' ? 'Valide jusqu\'au' : 'Valid Until'}</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-secondary">{language === 'fr' ? 'Cr\u00e9\u00e9' : 'Created'}</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline/50">
              {quotes.map((q: any) => (
                <tr
                  key={q.id}
                  className="hover:bg-surface-secondary/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/quotes/${q.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-text-primary">{q.quote_number}</td>
                  <td className="px-4 py-3 text-text-primary">{getContactName(q)}</td>
                  <td className="px-4 py-3 text-text-secondary max-w-[200px] truncate">{q.title || '\u2014'}</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border', QUOTE_STATUS_COLORS[q.status as QuoteStatus] || 'bg-gray-100 text-gray-600')}>
                      {QUOTE_STATUS_LABELS[q.status as QuoteStatus] || q.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-text-primary tabular-nums">
                    {formatQuoteMoney(q.total_cents, q.currency)}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{q.valid_until ? formatDate(q.valid_until) : '\u2014'}</td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(q.created_at)}</td>
                  <td className="px-4 py-3 relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === q.id ? null : q.id); }}
                      className="p-1 rounded-md hover:bg-surface-tertiary text-text-tertiary"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {menuOpen === q.id && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(null)} />
                        <div className="absolute right-4 top-full mt-1 z-40 bg-surface border border-outline rounded-lg shadow-lg py-1 w-48">
                          <button onClick={(e) => { e.stopPropagation(); handleSendEmail(q.id); }} className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-secondary flex items-center gap-2">
                            <Send size={13} /> {language === 'fr' ? 'Envoyer par email' : 'Send Email'}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDuplicate(q.id); }} className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-secondary flex items-center gap-2">
                            <Copy size={13} /> {language === 'fr' ? 'Dupliquer' : 'Duplicate'}
                          </button>
                          {q.status === 'approved' && (
                            <button onClick={(e) => { e.stopPropagation(); handleConvertToInvoice(q.id); }} className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-secondary flex items-center gap-2">
                              <Receipt size={13} /> {language === 'fr' ? 'Convertir en facture' : 'Convert to Invoice'}
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); handleDownloadPdf(q.id); }} className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-secondary flex items-center gap-2">
                            <Download size={13} /> PDF
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); window.open(`/quote/${q.view_token}`, '_blank'); setMenuOpen(null); }} className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-surface-secondary flex items-center gap-2">
                            <Eye size={13} /> {language === 'fr' ? 'Voir comme client' : 'Preview as Client'}
                          </button>
                          <div className="border-t border-outline my-1" />
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(q.id); setMenuOpen(null); }} className="w-full text-left px-3 py-1.5 text-[13px] text-danger hover:bg-danger-light flex items-center gap-2">
                            <Trash2 size={13} /> {language === 'fr' ? 'Supprimer' : 'Delete'}
                          </button>
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[13px] text-text-secondary">
          <span>{language === 'fr' ? `${total} devis` : `${total} quotes`}</span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
              className="p-1.5 rounded-md hover:bg-surface-secondary disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2 font-medium">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setParam('page', String(page + 1))}
              className="p-1.5 rounded-md hover:bg-surface-secondary disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
