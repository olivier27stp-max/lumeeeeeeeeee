/* ═══════════════════════════════════════════════════════════════
   Quote Details — Full page with inline editing
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, MoreHorizontal, Mail, MessageSquare, Briefcase, Copy,
  Eye, Printer, FileSignature, Trash2, Clock, CheckCircle2,
  MapPin, Phone as PhoneIcon, Mail as MailIcon, Pencil, FileText,
  Plus, Check, X, Save,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  getQuoteById, updateQuote, saveQuoteLineItems, type QuoteDetail,
  type QuoteStatus, type QuoteLineItemInput, QUOTE_STATUS_LABELS, QUOTE_STATUS_COLORS,
  formatQuoteMoney, updateQuoteStatus, sendQuoteEmail, sendQuoteSms,
  convertQuoteToJob, convertQuoteToInvoice, duplicateQuote, deleteQuote,
} from '../lib/quotesApi';
import { supabase } from '../lib/supabase';
import { downloadQuotePdf } from '../lib/generateQuotePdf';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useTranslation } from '../i18n';

type EditMode = null | 'title' | 'intro' | 'lineItems' | 'disclaimer' | 'notes' | 'deposit';

export default function QuoteDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // ── Edit state ──
  const [editing, setEditing] = useState<EditMode>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDisclaimer, setEditDisclaimer] = useState('');
  const [editIntro, setEditIntro] = useState('');
  const [editDepositRequired, setEditDepositRequired] = useState(false);
  const [editRequirePayment, setEditRequirePayment] = useState(false);
  const [editLineItems, setEditLineItems] = useState<Array<{
    id: string; name: string; description: string; quantity: string;
    unit_price: string; is_optional: boolean;
  }>>([]);

  useEffect(() => { if (id) loadQuote(); }, [id]);

  async function loadQuote() {
    setLoading(true);
    try { setDetail(await getQuoteById(id!)); }
    catch { setDetail(null); }
    finally { setLoading(false); }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-5 h-5 border-2 border-outline border-t-text-primary rounded-full animate-spin" />
    </div>
  );
  if (!detail) return (
    <div className="text-center py-20">
      <p className="text-text-tertiary">{t.quoteDetails.quoteNotFound}</p>
      <button onClick={() => navigate('/quotes')} className="glass-button mt-4 inline-flex items-center gap-1.5">
        <ArrowLeft size={14} /> {t.companySettings.back}
      </button>
    </div>
  );

  const { quote, line_items, sections, lead, client } = detail;
  const entity = client || lead;
  const entityName = entity ? `${entity.first_name || ''} ${entity.last_name || ''}`.trim() : t.quoteDetails.unknown;
  const entityEmail = entity?.email || null;
  const entityPhone = entity?.phone || null;
  const entityAddress = (entity as any)?.address || null;
  const introSection = sections.find(s => s.section_type === 'introduction' && s.enabled);
  const disclaimerSection = sections.find(s => s.section_type === 'contract_disclaimer' && s.enabled);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e: any) { toast.error(e?.message || t.quoteDetails.error); }
    finally { setBusy(false); setMoreOpen(false); }
  }

  // ── Edit helpers ──
  function startEdit(mode: EditMode) {
    setEditing(mode);
    if (mode === 'title') setEditTitle(quote.title || '');
    if (mode === 'notes') setEditNotes(quote.notes || '');
    if (mode === 'disclaimer') setEditDisclaimer(disclaimerSection?.content || quote.contract_disclaimer || '');
    if (mode === 'intro') setEditIntro(introSection?.content || '');
    if (mode === 'deposit') { setEditDepositRequired(quote.deposit_required); setEditRequirePayment(quote.require_payment_method); }
    if (mode === 'lineItems') {
      setEditLineItems(line_items.filter(i => i.item_type === 'service').map(i => ({
        id: i.id, name: i.name, description: i.description || '',
        quantity: String(i.quantity), unit_price: String(i.unit_price_cents / 100),
        is_optional: i.is_optional,
      })));
    }
  }

  async function saveEdit() {
    setBusy(true);
    try {
      if (editing === 'title') {
        await updateQuote(quote.id, { title: editTitle.trim() });
      } else if (editing === 'notes') {
        await updateQuote(quote.id, { notes: editNotes.trim() || null } as any);
      } else if (editing === 'disclaimer') {
        await updateQuote(quote.id, { contract_disclaimer: editDisclaimer.trim() || null });
        // Also update the section
        if (disclaimerSection) {
          await supabase.from('quote_sections').update({ content: editDisclaimer.trim() }).eq('id', disclaimerSection.id);
        }
      } else if (editing === 'intro') {
        if (introSection) {
          await supabase.from('quote_sections').update({ content: editIntro.trim() }).eq('id', introSection.id);
        } else {
          await supabase.from('quote_sections').insert({
            quote_id: quote.id, section_type: 'introduction', title: 'Introduction',
            content: editIntro.trim(), sort_order: 0, enabled: true,
          });
        }
      } else if (editing === 'deposit') {
        await updateQuote(quote.id, {
          deposit_required: editDepositRequired,
          require_payment_method: editRequirePayment,
        } as any);
      } else if (editing === 'lineItems') {
        const items: QuoteLineItemInput[] = editLineItems
          .filter(i => i.name.trim())
          .map((i, idx) => ({
            name: i.name.trim(),
            description: i.description.trim() || null,
            quantity: Math.max(0.01, parseFloat(i.quantity) || 1),
            unit_price_cents: Math.max(0, Math.round((parseFloat(i.unit_price) || 0) * 100)),
            sort_order: idx,
            is_optional: i.is_optional,
            item_type: 'service' as const,
          }));
        await saveQuoteLineItems(quote.id, items);
      }
      toast.success(t.quoteDetails.saved);
      setEditing(null);
      await loadQuote();
    } catch (e: any) {
      toast.error(e?.message || t.quoteDetails.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  const cancelEdit = () => setEditing(null);

  const inputCls = 'w-full px-3 py-2 bg-surface border border-outline rounded-lg text-sm text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all';

  const editButtons = (
    <div className="flex items-center gap-1.5">
      <button onClick={saveEdit} disabled={busy} className="p-1.5 rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50"><Check size={13} /></button>
      <button onClick={cancelEdit} className="p-1.5 rounded-md bg-surface-tertiary text-text-secondary hover:bg-surface-secondary"><X size={13} /></button>
    </div>
  );

  return (
    <div className="-mx-6 -mt-5">
      <div className="h-1.5 bg-gradient-to-r from-primary to-primary/70" />

      {/* ── Header ── */}
      <div className="px-8 pt-5 pb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => navigate('/quotes')} className="text-text-tertiary hover:text-text-primary transition-colors"><ArrowLeft size={16} /></button>
            <FileText size={16} className="text-text-tertiary" />
            <span className={cn('px-2.5 py-0.5 rounded-full text-[11px] font-semibold border inline-flex items-center gap-1',
              QUOTE_STATUS_COLORS[quote.status as QuoteStatus] || QUOTE_STATUS_COLORS.draft)}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {QUOTE_STATUS_LABELS[quote.status as QuoteStatus] || quote.status}
            </span>
          </div>
          {editing === 'title' ? (
            <div className="flex items-center gap-2">
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                className={cn(inputCls, 'text-[22px] font-bold py-1 w-96')} autoFocus />
              {editButtons}
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-[26px] font-bold text-text-primary leading-tight">
                {quote.title || t.quoteDetails.quoteFor.replace('${name}', entityName)}
              </h1>
              <button onClick={() => startEdit('title')} className="p-1 text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary transition-all"><Pencil size={14} /></button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <button onClick={() => setMoreOpen(!moreOpen)} disabled={busy}
              className="glass-button px-3 py-2 text-[13px] font-medium flex items-center gap-1.5">
              <MoreHorizontal size={15} /> {t.quoteDetails.more}
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 bg-surface border border-outline rounded-xl shadow-xl z-40 py-1 text-[13px]">
                  <button onClick={() => act(async () => { const { jobId } = await convertQuoteToJob(quote.id); toast.success(t.quoteDetails.converted); navigate(`/jobs/${jobId}`); })}
                    disabled={quote.status === 'converted' || busy} className="w-full px-4 py-2 text-left hover:bg-surface-secondary flex items-center gap-2.5 disabled:opacity-40 text-text-primary">
                    <Briefcase size={14} /> {t.quoteDetails.convertToJob}</button>
                  {['approved', 'sent', 'awaiting_response', 'action_required'].includes(quote.status) && (
                    <button onClick={() => act(async () => { const { invoiceId } = await convertQuoteToInvoice(quote.id); toast.success(t.quoteDetails.invoiceCreated); navigate(`/invoices/${invoiceId}`); })}
                      disabled={quote.status === 'converted' || busy} className="w-full px-4 py-2 text-left hover:bg-surface-secondary flex items-center gap-2.5 disabled:opacity-40 text-text-primary">
                      <FileText size={14} /> {t.quoteDetails.convertToInvoice}</button>
                  )}
                  <button onClick={() => act(async () => { const d = await duplicateQuote(quote.id); toast.success(t.quoteDetails.duplicated); navigate(`/quotes/${d.quote.id}`); })}
                    className="w-full px-4 py-2 text-left hover:bg-surface-secondary flex items-center gap-2.5 text-text-primary">
                    <Copy size={14} /> {t.quoteDetails.createSimilarQuote}</button>
                  <div className="border-t border-outline my-1" />
                  <p className="px-4 py-1 text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">{t.quoteDetails.sendAs}</p>
                  <button onClick={() => act(async () => { await sendQuoteEmail(quote.id); toast.success(t.quoteDetails.emailSent); loadQuote(); })}
                    disabled={!entityEmail || busy} className="w-full px-4 py-2 text-left hover:bg-surface-secondary flex items-center gap-2.5 disabled:opacity-40 text-text-primary">
                    <Mail size={14} /> {t.quoteDetails.email}</button>
                  <div className="border-t border-outline my-1" />
                  <p className="px-4 py-1 text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">{t.quoteDetails.markAs}</p>
                  <button onClick={() => act(async () => { await updateQuoteStatus(quote.id, 'awaiting_response'); toast.success(t.quoteDetails.awaitingResponse); loadQuote(); })}
                    className="w-full px-4 py-2 text-left hover:bg-surface-secondary flex items-center gap-2.5 text-text-primary">
                    <Clock size={14} /> {t.quoteDetails.awaitingResponse}</button>
                  <button onClick={() => act(async () => { await updateQuoteStatus(quote.id, 'approved'); toast.success(t.quoteDetails.approved); loadQuote(); })}
                    className="w-full px-4 py-2 text-left hover:bg-surface-secondary flex items-center gap-2.5 text-text-primary">
                    <CheckCircle2 size={14} /> {t.quoteDetails.approved}</button>
                  <div className="border-t border-outline my-1" />
                  <button onClick={() => { window.open(`/quote/${quote.view_token}`, '_blank'); setMoreOpen(false); }}
                    className="w-full px-4 py-2 text-left hover:bg-surface-secondary flex items-center gap-2.5 text-text-primary">
                    <Eye size={14} /> {t.quoteDetails.previewAsClient}</button>
                  <button onClick={() => { downloadQuotePdf(detail!); setMoreOpen(false); }}
                    className="w-full px-4 py-2 text-left hover:bg-surface-secondary flex items-center gap-2.5 text-text-primary">
                    <Printer size={14} /> {t.quoteDetails.printOrSavePdf}</button>
                  <div className="border-t border-outline my-1" />
                  <button onClick={() => act(async () => { if (!confirm(t.quoteDetails.confirmDelete)) return; await deleteQuote(quote.id); toast.success(t.quoteDetails.deleted); navigate('/quotes'); })}
                    className="w-full px-4 py-2 text-left hover:bg-danger-light text-danger flex items-center gap-2.5">
                    <Trash2 size={14} /> {t.quoteDetails.delete}</button>
                </div>
              </>
            )}
          </div>
          {entityPhone && (
            <button onClick={() => act(async () => { await sendQuoteSms(quote.id); toast.success(t.quoteDetails.smsSent); loadQuote(); })}
              disabled={busy} className="glass-button-primary px-4 py-2 text-[13px] font-semibold flex items-center gap-1.5">
              <MessageSquare size={14} /> {t.quoteDetails.sendText}</button>
          )}
        </div>
      </div>

      {/* ── 2-column ── */}
      <div className="px-8 pb-8 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* ── Main ── */}
        <div className="space-y-5">
          {/* Contact + Meta */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-5">
            <div className="section-card p-5 space-y-2">
              <p className="font-semibold text-text-primary text-[15px]">{entityName}</p>
              {entityAddress && <><p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">{t.quoteDetails.propertyAddress}</p><p className="text-[13px] text-text-secondary">{entityAddress}</p></>}
              {entityPhone && <p className="text-[13px] text-text-secondary">{entityPhone}</p>}
              {entityEmail && <a href={`mailto:${entityEmail}`} className="text-[13px] text-primary hover:underline block">{entityEmail}</a>}
            </div>
            <div className="space-y-3 pt-1">
              <div className="flex justify-between text-[13px] border-b border-outline pb-2.5">
                <span className="text-text-tertiary">{t.quoteDetails.quoteNumber}</span><span className="font-semibold text-text-primary">{quote.quote_number}</span>
              </div>
              <div className="flex justify-between text-[13px] border-b border-outline pb-2.5">
                <span className="text-text-tertiary">{t.quoteDetails.created}</span><span className="font-medium text-text-primary">{format(new Date(quote.created_at), 'MMM d, yyyy')}</span>
              </div>
              {quote.valid_until && (
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-tertiary">{t.quoteDetails.validUntil}</span><span className="font-medium text-text-primary">{format(new Date(quote.valid_until), 'MMM d, yyyy')}</span>
                </div>
              )}
            </div>
          </div>

          {/* Introduction */}
          <div className="section-card p-5">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[14px] font-semibold text-text-primary">{t.quoteDetails.introduction}</h4>
              {editing !== 'intro' && <button onClick={() => startEdit('intro')} className="p-1 text-text-tertiary hover:text-text-primary"><Pencil size={13} /></button>}
              {editing === 'intro' && editButtons}
            </div>
            {editing === 'intro' ? (
              <textarea value={editIntro} onChange={e => setEditIntro(e.target.value)} className={cn(inputCls, 'min-h-[80px]')} autoFocus />
            ) : (
              <p className="text-[13px] text-text-secondary whitespace-pre-wrap">{introSection?.content || <span className="text-text-tertiary italic">{t.quoteDetails.addIntroduction}</span>}</p>
            )}
          </div>

          {/* Line Items */}
          <div className="section-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-outline flex items-center justify-between">
              <h4 className="text-[14px] font-semibold text-text-primary">{t.quoteDetails.productService}</h4>
              {editing !== 'lineItems' && <button onClick={() => startEdit('lineItems')} className="p-1 text-text-tertiary hover:text-text-primary"><Pencil size={13} /></button>}
              {editing === 'lineItems' && editButtons}
            </div>

            {editing === 'lineItems' ? (
              <div className="p-4 space-y-3">
                {editLineItems.map((item, idx) => (
                  <div key={item.id} className="grid grid-cols-12 gap-2 items-start p-3 rounded-lg border border-outline">
                    <div className="col-span-5">
                      <input value={item.name} onChange={e => { const u = [...editLineItems]; u[idx] = { ...u[idx], name: e.target.value }; setEditLineItems(u); }}
                        className={cn(inputCls, 'py-1.5')} placeholder={t.quoteDetails.namePlaceholder} />
                    </div>
                    <div className="col-span-2">
                      <input value={item.quantity} onChange={e => { const u = [...editLineItems]; u[idx] = { ...u[idx], quantity: e.target.value }; setEditLineItems(u); }}
                        className={cn(inputCls, 'py-1.5 text-center')} placeholder={t.quoteDetails.qtyPlaceholder} />
                    </div>
                    <div className="col-span-2">
                      <input value={item.unit_price} onChange={e => { const u = [...editLineItems]; u[idx] = { ...u[idx], unit_price: e.target.value }; setEditLineItems(u); }}
                        className={cn(inputCls, 'py-1.5 text-right')} placeholder={t.quoteDetails.pricePlaceholder} />
                    </div>
                    <div className="col-span-2 text-right text-sm font-medium text-text-primary pt-2">
                      {formatQuoteMoney(Math.round((parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0) * 100))}
                    </div>
                    <div className="col-span-1 flex justify-center pt-1.5">
                      <button onClick={() => setEditLineItems(p => p.length > 1 ? p.filter((_, i) => i !== idx) : p)}
                        className="p-1 text-text-tertiary hover:text-danger"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
                <button onClick={() => setEditLineItems(p => [...p, { id: crypto.randomUUID(), name: '', description: '', quantity: '1', unit_price: '0', is_optional: false }])}
                  className="glass-button text-xs flex items-center gap-1.5 px-3 py-1.5">
                  <Plus size={12} /> {t.quoteDetails.addLineItem}
                </button>
              </div>
            ) : (
              <>
                <table className="w-full text-[13px]">
                  <thead className="border-b border-outline">
                    <tr>
                      <th className="px-5 py-2.5 text-left font-semibold text-text-secondary">{t.quoteDetails.lineItem}</th>
                      <th className="px-5 py-2.5 text-center font-semibold text-text-secondary">{t.quoteDetails.quantity}</th>
                      <th className="px-5 py-2.5 text-right font-semibold text-text-secondary">{t.quoteDetails.unitPrice}</th>
                      <th className="px-5 py-2.5 text-right font-semibold text-text-secondary">{t.quoteDetails.total}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline/50">
                    {line_items.filter(i => i.item_type === 'service').map(item => (
                      <tr key={item.id} className={item.is_optional ? 'opacity-60' : ''}>
                        <td className="px-5 py-3">
                          <span className="font-medium text-text-primary">{item.name}</span>
                          {item.is_optional && <span className="ml-2 text-[10px] text-text-tertiary uppercase">{t.quoteDetails.optional}</span>}
                          {item.description && <p className="text-[12px] text-text-tertiary mt-0.5">{item.description}</p>}
                        </td>
                        <td className="px-5 py-3 text-center text-primary font-medium">{item.quantity}</td>
                        <td className="px-5 py-3 text-right text-text-secondary">{formatQuoteMoney(item.unit_price_cents)}</td>
                        <td className="px-5 py-3 text-right font-medium text-text-primary">{formatQuoteMoney(item.total_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="bg-surface-secondary border-t border-outline px-5 py-3 space-y-1.5">
                  <div className="flex justify-between text-[13px]"><span className="text-text-secondary">{t.quoteDetails.subtotal}</span><span className="text-text-primary">{formatQuoteMoney(quote.subtotal_cents)}</span></div>
                  {quote.discount_cents > 0 && <div className="flex justify-between text-[13px]"><span className="text-text-secondary">{t.quoteDetails.discount}</span><span className="text-danger">-{formatQuoteMoney(quote.discount_cents)}</span></div>}
                  <div className="flex justify-between text-[13px]"><span className="text-text-secondary">{quote.tax_rate_label || t.quoteDetails.tax}</span><span className="text-text-primary">{formatQuoteMoney(quote.tax_cents)}</span></div>
                  <div className="flex justify-between text-[15px] font-bold border-t border-outline pt-2"><span className="text-text-primary">{t.quoteDetails.total}</span><span className="text-text-primary">{formatQuoteMoney(quote.total_cents)}</span></div>
                </div>
              </>
            )}
          </div>

          {/* Contract / Disclaimer */}
          <div className="section-card p-5">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[14px] font-semibold text-text-primary">{t.quoteDetails.contractDisclaimer}</h4>
              {editing !== 'disclaimer' && <button onClick={() => startEdit('disclaimer')} className="p-1 text-text-tertiary hover:text-text-primary"><Pencil size={13} /></button>}
              {editing === 'disclaimer' && editButtons}
            </div>
            {editing === 'disclaimer' ? (
              <textarea value={editDisclaimer} onChange={e => setEditDisclaimer(e.target.value)} className={cn(inputCls, 'min-h-[80px]')} autoFocus />
            ) : (
              <p className="text-[13px] text-text-secondary whitespace-pre-wrap">{disclaimerSection?.content || quote.contract_disclaimer || <span className="text-text-tertiary italic">{t.quoteDetails.addTerms}</span>}</p>
            )}
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-5">
          {/* Deposit */}
          <div className="section-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[14px] font-semibold text-text-primary">{t.quoteDetails.depositPaymentSettings}</h4>
              {editing !== 'deposit' && <button onClick={() => startEdit('deposit')} className="p-1 text-text-tertiary hover:text-text-primary"><Pencil size={13} /></button>}
              {editing === 'deposit' && editButtons}
            </div>
            {editing === 'deposit' ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[13px] text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={editRequirePayment} onChange={e => setEditRequirePayment(e.target.checked)} className="rounded" />
                  {t.quoteDetails.requirePaymentMethod}
                </label>
                <label className="flex items-center gap-2 text-[13px] text-text-secondary cursor-pointer">
                  <input type="checkbox" checked={editDepositRequired} onChange={e => setEditDepositRequired(e.target.checked)} className="rounded" />
                  {t.quoteDetails.depositRequired}
                </label>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-text-secondary">{t.quoteDetails.requirePaymentMethod}</span>
                  <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-bold',
                    quote.require_payment_method ? 'bg-primary/10 text-primary' : 'bg-surface-tertiary text-text-tertiary')}>
                    {quote.require_payment_method ? t.quoteDetails.on : t.quoteDetails.off}
                  </span>
                </div>
                {quote.deposit_required && quote.deposit_value > 0 && (
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-text-secondary">{t.quoteDetails.deposit}</span>
                    <span className="font-semibold text-text-primary">{quote.deposit_type === 'percentage' ? `${quote.deposit_value}%` : formatQuoteMoney(quote.deposit_value * 100)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Notes */}
          <div className="section-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[14px] font-semibold text-text-primary">{t.quoteDetails.notes}</h4>
              {editing !== 'notes' && <button onClick={() => startEdit('notes')} className="p-1 text-text-tertiary hover:text-text-primary"><Pencil size={13} /></button>}
              {editing === 'notes' && editButtons}
            </div>
            {editing === 'notes' ? (
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                className={cn(inputCls, 'min-h-[100px]')} autoFocus placeholder={t.quoteDetails.notesPlaceholder} />
            ) : quote.notes ? (
              <p className="text-[13px] text-text-secondary whitespace-pre-wrap">{quote.notes}</p>
            ) : (
              <div className="border-2 border-dashed border-outline rounded-xl p-6 text-center cursor-pointer hover:bg-surface-secondary transition-colors" onClick={() => startEdit('notes')}>
                <div className="w-10 h-10 rounded-full bg-surface-secondary flex items-center justify-center mx-auto mb-2">
                  <FileText size={16} className="text-text-tertiary" />
                </div>
                <p className="text-[12px] text-text-tertiary">{t.quoteDetails.addNotes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
