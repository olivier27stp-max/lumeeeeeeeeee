import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X, MoreHorizontal, Mail, MessageSquare, Briefcase, Copy,
  Eye, Pen, Printer, FileSignature, Trash2, Clock, CheckCircle2,
  MapPin, Phone as PhoneIcon, Mail as MailIcon, User, Calendar, ChevronDown,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  type QuoteDetail, type QuoteStatus,
  QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS,
  formatQuoteMoney, updateQuoteStatus, sendQuoteEmail, sendQuoteSms,
  convertQuoteToJob, duplicateQuote, deleteQuote,
} from '../../lib/quotesApi';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface QuoteDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  detail: QuoteDetail | null;
  onRefresh: () => void;
  onConvertedToJob?: (jobId: string) => void;
  onDuplicated?: (detail: QuoteDetail) => void;
}

export default function QuoteDetailsModal({
  isOpen, onClose, detail, onRefresh, onConvertedToJob, onDuplicated,
}: QuoteDetailsModalProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isOpen || !detail) return null;

  const { quote, line_items, sections, lead, client } = detail;
  const entity = client || lead;
  const entityName = entity ? `${entity.first_name || ''} ${entity.last_name || ''}`.trim() : 'Unknown';
  const entityEmail = entity?.email || null;
  const entityPhone = entity?.phone || null;
  const entityAddress = (entity as any)?.address || null;

  const introSection = sections.find(s => s.section_type === 'introduction' && s.enabled);
  const disclaimerSection = sections.find(s => s.section_type === 'contract_disclaimer' && s.enabled);

  async function handleAction(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch (err: any) { toast.error(err?.message || 'Action failed.'); }
    finally { setBusy(false); setMoreOpen(false); }
  }

  const handleSendEmail = () => handleAction(async () => {
    await sendQuoteEmail(quote.id);
    toast.success('Quote sent via email.');
    onRefresh();
  });

  const handleSendSms = () => handleAction(async () => {
    await sendQuoteSms(quote.id);
    toast.success('Quote sent via SMS.');
    onRefresh();
  });

  const handleMarkStatus = (status: QuoteStatus) => () => handleAction(async () => {
    await updateQuoteStatus(quote.id, status);
    toast.success(`Quote marked as ${QUOTE_STATUS_LABELS[status]}.`);
    onRefresh();
  });

  const handleConvert = () => handleAction(async () => {
    const { jobId } = await convertQuoteToJob(quote.id);
    toast.success('Quote converted to job.');
    onConvertedToJob?.(jobId);
    onRefresh();
  });

  const handleDuplicate = () => handleAction(async () => {
    const dup = await duplicateQuote(quote.id);
    toast.success('Similar quote created.');
    onDuplicated?.(dup);
  });

  const handleDelete = () => handleAction(async () => {
    if (!window.confirm('Delete this quote?')) return;
    await deleteQuote(quote.id);
    toast.success('Quote deleted.');
    onClose();
  });

  const handlePreview = () => {
    window.open(`/quote/${quote.view_token}`, '_blank');
    setMoreOpen(false);
  };

  const handlePrint = () => {
    window.open(`/quote/${quote.view_token}`, '_blank');
    setMoreOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 backdrop-blur-md p-4 overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        className="w-full max-w-4xl max-h-[94vh] bg-white rounded-2xl border border-gray-200 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={cn(
              'px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border',
              QUOTE_STATUS_COLORS[quote.status as QuoteStatus] || QUOTE_STATUS_COLORS.draft
            )}>
              {QUOTE_STATUS_LABELS[quote.status as QuoteStatus] || quote.status}
            </span>
            {quote.context_type === 'lead' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-200">Lead</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* More dropdown */}
            <div className="relative">
              <button onClick={() => setMoreOpen(!moreOpen)} disabled={busy}
                className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5">
                <MoreHorizontal size={14} /> More
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1 text-sm">
                  <button onClick={handleConvert} disabled={quote.status === 'converted' || busy}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2 disabled:opacity-40">
                    <Briefcase size={14} /> Convert to Job
                  </button>
                  <button onClick={handleDuplicate} disabled={busy}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2">
                    <Copy size={14} /> Create Similar Quote
                  </button>
                  <div className="border-t border-gray-100 my-1" />
                  <p className="px-4 py-1 text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Send as...</p>
                  <button onClick={handleSendEmail} disabled={!entityEmail || busy}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2 disabled:opacity-40">
                    <Mail size={14} /> Email
                  </button>
                  <button onClick={handleSendSms} disabled={!entityPhone || busy}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2 disabled:opacity-40">
                    <MessageSquare size={14} /> Text
                  </button>
                  <div className="border-t border-gray-100 my-1" />
                  <p className="px-4 py-1 text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Mark as...</p>
                  <button onClick={handleMarkStatus('awaiting_response')} disabled={busy}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2">
                    <Clock size={14} /> Awaiting Response
                  </button>
                  <button onClick={handleMarkStatus('approved')} disabled={busy}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2">
                    <CheckCircle2 size={14} /> Approved
                  </button>
                  <div className="border-t border-gray-100 my-1" />
                  <button onClick={handlePreview}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2">
                    <Eye size={14} /> Preview as Client
                  </button>
                  <button onClick={handlePrint}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2">
                    <Printer size={14} /> Print or Save PDF
                  </button>
                  <button onClick={() => { setMoreOpen(false); toast.info('Signature collection coming soon.'); }}
                    className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2">
                    <FileSignature size={14} /> Collect Signature
                  </button>
                  <div className="border-t border-gray-100 my-1" />
                  <button onClick={handleDelete} disabled={busy}
                    className="w-full px-4 py-2.5 text-left hover:bg-red-50 text-red-600 flex items-center gap-2">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}
            </div>
            {entityPhone && (
              <button onClick={handleSendSms} disabled={busy}
                className="px-3 py-2 text-sm font-semibold text-white bg-green-700 hover:bg-green-800 rounded-lg flex items-center gap-1.5">
                <MessageSquare size={14} /> Send Text
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-6 space-y-6">
            {/* Title */}
            <h1 className="text-2xl font-bold text-gray-900">{quote.title || `Quote for ${entityName}`}</h1>

            {/* Identity + Meta */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Entity card */}
              <div className="border border-gray-200 rounded-xl p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900">{entityName}</p>
                  {quote.context_type === 'lead' && (
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                  )}
                </div>
                {entityAddress && (
                  <div className="flex items-start gap-2 text-xs text-gray-500">
                    <MapPin size={12} className="mt-0.5 shrink-0" />
                    <span>{entityAddress}</span>
                  </div>
                )}
                {entityPhone && (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <PhoneIcon size={12} /> {entityPhone}
                  </div>
                )}
                {entityEmail && (
                  <div className="flex items-center gap-2 text-xs text-blue-600">
                    <MailIcon size={12} />
                    <a href={`mailto:${entityEmail}`}>{entityEmail}</a>
                  </div>
                )}
              </div>
              {/* Meta */}
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Quote #</span>
                  <span className="font-semibold">{quote.quote_number}</span>
                </div>
                {quote.salesperson_id && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Salesperson</span>
                    <span className="font-medium">Assigned</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Created</span>
                  <span className="font-medium">{format(new Date(quote.created_at), 'MMM d, yyyy')}</span>
                </div>
                {quote.valid_until && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Valid until</span>
                    <span className="font-medium">{format(new Date(quote.valid_until), 'MMM d, yyyy')}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Introduction */}
            {introSection && (
              <div className="border border-gray-200 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Introduction</h4>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{introSection.content}</p>
              </div>
            )}

            {/* Line Items Table */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-800">Product / Service</h4>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Line Item</th>
                    <th className="px-5 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Quantity</th>
                    <th className="px-5 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Unit Price</th>
                    <th className="px-5 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {line_items.filter(i => i.item_type === 'service').map(item => (
                    <tr key={item.id} className={item.is_optional ? 'opacity-60' : ''}>
                      <td className="px-5 py-3">
                        <span className="font-medium text-gray-900">{item.name}</span>
                        {item.is_optional && <span className="ml-2 text-[10px] text-gray-400 uppercase">Optional</span>}
                        {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
                      </td>
                      <td className="px-5 py-3 text-center text-green-700 font-medium">{item.quantity}</td>
                      <td className="px-5 py-3 text-right">{formatQuoteMoney(item.unit_price_cents)}</td>
                      <td className="px-5 py-3 text-right font-medium">{formatQuoteMoney(item.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Totals */}
              <div className="bg-gray-50/50 border-t border-gray-100 px-5 py-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span>{formatQuoteMoney(quote.subtotal_cents)}</span>
                </div>
                {quote.discount_cents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Discount</span>
                    <span className="text-red-600">-{formatQuoteMoney(quote.discount_cents)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">{quote.tax_rate_label || 'Tax'}</span>
                  <span>{formatQuoteMoney(quote.tax_cents)}</span>
                </div>
                <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2">
                  <span>Total</span>
                  <span>{formatQuoteMoney(quote.total_cents)}</span>
                </div>
              </div>
            </div>

            {/* Deposit settings */}
            {(quote.deposit_required || quote.require_payment_method) && (
              <div className="border border-gray-200 rounded-xl p-4 space-y-2">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Deposit payment settings</h4>
                {quote.require_payment_method && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Require payment method on file</span>
                    <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">ON</span>
                  </div>
                )}
              </div>
            )}

            {/* Contract / Disclaimer */}
            {disclaimerSection && (
              <div className="border border-gray-200 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Contract / Disclaimer</h4>
                <p className="text-sm text-gray-600 italic">{disclaimerSection.content || quote.contract_disclaimer}</p>
              </div>
            )}

            {/* Notes */}
            {quote.notes && (
              <div className="border border-dashed border-gray-300 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Notes</h4>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{quote.notes}</p>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Backdrop click to close more menu */}
      {moreOpen && <div className="fixed inset-0 z-[129]" onClick={() => setMoreOpen(false)} />}
    </div>
  );
}
