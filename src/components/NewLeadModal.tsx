import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, Calendar, Clock, Briefcase, ChevronDown, User, Mail, MapPin, Phone, DollarSign, Tag } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { useTranslation } from '../i18n';

interface LineItem {
  id: string;
  name: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  description: string;
}

interface NewLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => Promise<void> | void;
  initialClient?: string;
  initialSchedule?: {
    start_date: string;
    start_time: string;
    end_time: string;
  };
  isSaving?: boolean;
  errorMessage?: string | null;
  mode?: 'lead' | 'job';
}

export default function NewLeadModal({
  isOpen,
  onClose,
  onSave,
  initialClient,
  initialSchedule,
  isSaving = false,
  errorMessage = null,
  mode = 'job',
}: NewLeadModalProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const { t, language } = useTranslation();
  const [leadFirstName, setLeadFirstName] = useState('');
  const [leadLastName, setLeadLastName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadAddress, setLeadAddress] = useState('');
  const [leadCompany, setLeadCompany] = useState('');
  const [leadStatus, setLeadStatus] = useState('Lead');
  const [leadValue, setLeadValue] = useState('0');
  const [leadSource, setLeadSource] = useState('');
  const [leadNotes, setLeadNotes] = useState('');
  const [title, setTitle] = useState('');
  const [client, setClient] = useState(initialClient || '');
  const [jobNumber, setJobNumber] = useState(Math.floor(Math.random() * 1000).toString());

  useEffect(() => { if (initialClient) setClient(initialClient); }, [initialClient]);
  useEffect(() => {
    if (initialSchedule) {
      setStartDate(initialSchedule.start_date);
      setStartTime(initialSchedule.start_time);
      setEndTime(initialSchedule.end_time);
    }
  }, [initialSchedule]);

  const [salesperson, setSalesperson] = useState('');
  const [jobType, setJobType] = useState<'one-off' | 'recurring'>('one-off');
  const [startDate, setStartDate] = useState(initialSchedule?.start_date || new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState(initialSchedule?.start_time || '09:00');
  const [endTime, setEndTime] = useState(initialSchedule?.end_time || '10:00');
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: '1', name: '', quantity: 1, unitCost: 0, unitPrice: 0, description: '' }
  ]);
  const [billingRemind, setBillingRemind] = useState(true);
  const [billingSplit, setBillingSplit] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const addLineItem = () => {
    setLineItems([...lineItems, {
      id: Math.random().toString(36).substr(2, 9),
      name: '', quantity: 1, unitCost: 0, unitPrice: 0, description: ''
    }]);
  };

  const removeLineItem = (id: string) => {
    if (lineItems.length > 1) setLineItems(lineItems.filter(item => item.id !== id));
  };

  const updateLineItem = (id: string, field: keyof LineItem, value: any) => {
    setLineItems(lineItems.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const calculateTotal = () => lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);

    if (mode === 'lead') {
      if (!leadFirstName.trim() || !leadLastName.trim()) {
        setInlineError(t.modals.firstAndLastNameAreRequired);
        return;
      }
      try {
        await onSave({
          first_name: leadFirstName.trim(),
          last_name: leadLastName.trim(),
          email: leadEmail.trim(),
          phone: leadPhone.trim(),
          address: leadAddress.trim(),
          company: leadCompany.trim(),
          value: Number(leadValue || 0),
          status: leadStatus,
          source: leadSource.trim(),
          notes: leadNotes.trim(),
        });
        resetForm();
      } catch (error: any) {
        setInlineError(error?.message || t.modals.failedSave);
      }
      return;
    }

    if (!title || !client) {
      setInlineError(t.modals.fillTitleClient);
      return;
    }

    try {
      await onSave({
        title, client, job_number: jobNumber, salesperson, job_type: jobType,
        schedule: { start_date: startDate, start_time: startTime, end_time: endTime },
        line_items: lineItems,
        billing: { remind: billingRemind, split: billingSplit },
        value: calculateTotal(), status: 'Lead',
      });
      resetForm();
    } catch (error: any) {
      setInlineError(error?.message || t.modals.failedSave);
    }
  };

  const resetForm = () => {
    setLeadFirstName(''); setLeadLastName(''); setLeadEmail(''); setLeadPhone('');
    setLeadAddress(''); setLeadCompany(''); setLeadStatus('Lead'); setLeadValue('0');
    setLeadSource(''); setLeadNotes('');
    setTitle(''); setClient('');
    setJobNumber(Math.floor(Math.random() * 1000).toString());
    setSalesperson(''); setJobType('one-off');
    setLineItems([{ id: '1', name: '', quantity: 1, unitCost: 0, unitPrice: 0, description: '' }]);
  };

  const inputCls = 'w-full px-3 py-2.5 bg-surface border border-outline rounded-lg text-sm text-text-primary focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-all';
  const labelCls = 'text-xs text-text-secondary font-medium mb-1 block';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-black/40 backdrop-blur-md overflow-hidden">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="w-full max-w-5xl max-h-[94vh] bg-surface rounded-2xl border border-outline shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-outline flex items-center justify-between bg-surface-secondary">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  {mode === 'lead' ? <User size={18} className="text-primary" /> : <Briefcase size={18} className="text-primary" />}
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-text-primary">
                    {mode === 'lead' ? (t.modals.newLead) : (t.modals.newJob)}
                  </h2>
                  <p className="text-xs text-text-tertiary">
                    {mode === 'lead'
                      ? (t.modals.fillInTheProspectInformation)
                      : (t.modals.createANewJob)}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-full hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <form ref={formRef} onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {mode === 'lead' ? (
                <>
                  {/* Contact info */}
                  <div className="section-card p-5 space-y-4">
                    <h3 className="text-[14px] font-semibold text-text-primary flex items-center gap-2">
                      <User size={15} className="text-text-tertiary" />
                      {t.modals.contactInformation}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={labelCls}>{t.common.firstName} *</label>
                        <input autoFocus value={leadFirstName} onChange={(e) => setLeadFirstName(e.target.value)}
                          className={inputCls} placeholder="John" />
                      </div>
                      <div>
                        <label className={labelCls}>{t.common.lastName} *</label>
                        <input value={leadLastName} onChange={(e) => setLeadLastName(e.target.value)}
                          className={inputCls} placeholder="Doe" />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>{t.modals.company}</label>
                      <input value={leadCompany} onChange={(e) => setLeadCompany(e.target.value)}
                        className={inputCls} placeholder={language === 'fr' ? 'Nom de l\'entreprise' : 'Company name'} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={cn(labelCls, 'flex items-center gap-1')}>
                          <Mail size={11} className="text-text-tertiary" /> {t.common.email}
                        </label>
                        <input type="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)}
                          className={inputCls} placeholder="john@company.com" />
                      </div>
                      <div>
                        <label className={cn(labelCls, 'flex items-center gap-1')}>
                          <Phone size={11} className="text-text-tertiary" /> {t.modals.phone}
                        </label>
                        <input type="tel" value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)}
                          className={inputCls} placeholder="(514) 555-1234" />
                      </div>
                    </div>
                    <div>
                      <label className={cn(labelCls, 'flex items-center gap-1')}>
                        <MapPin size={11} className="text-text-tertiary" /> {t.common.address}
                      </label>
                      <input value={leadAddress} onChange={(e) => setLeadAddress(e.target.value)}
                        className={inputCls} placeholder="123 Main St, Montreal, QC" />
                    </div>
                  </div>

                  {/* Lead details */}
                  <div className="section-card p-5 space-y-4">
                    <h3 className="text-[14px] font-semibold text-text-primary flex items-center gap-2">
                      <Tag size={15} className="text-text-tertiary" />
                      {t.modals.leadDetails}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className={labelCls}>{t.common.status}</label>
                        <select value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)} className={inputCls}>
                          <option value="Lead">Lead</option>
                          <option value="Qualified">Qualified</option>
                          <option value="Proposal">Proposal</option>
                          <option value="Negotiation">Negotiation</option>
                          <option value="Closed">Closed</option>
                        </select>
                      </div>
                      <div>
                        <label className={cn(labelCls, 'flex items-center gap-1')}>
                          <DollarSign size={11} className="text-text-tertiary" /> {t.common.value}
                        </label>
                        <input type="number" min="0" value={leadValue} onChange={(e) => setLeadValue(e.target.value)}
                          className={inputCls} placeholder="0" />
                      </div>
                      <div>
                        <label className={labelCls}>Source</label>
                        <select value={leadSource} onChange={(e) => setLeadSource(e.target.value)} className={inputCls}>
                          <option value="">{t.modals.select}</option>
                          <option value="website">Website</option>
                          <option value="referral">{t.modals.referral}</option>
                          <option value="google">Google</option>
                          <option value="facebook">Facebook</option>
                          <option value="instagram">Instagram</option>
                          <option value="phone">{t.modals.phoneCall}</option>
                          <option value="walk_in">Walk-in</option>
                          <option value="other">{t.billing.other}</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="section-card border-dashed p-5">
                    <h4 className="text-[13px] font-semibold text-text-primary mb-2">Notes</h4>
                    <textarea value={leadNotes} onChange={(e) => setLeadNotes(e.target.value)}
                      className="w-full px-3 py-2 border-0 text-sm min-h-[60px] resize-none outline-none bg-transparent text-text-primary placeholder:text-text-tertiary"
                      placeholder={t.modals.addInternalNotes} />
                  </div>
                </>
              ) : (
                <>
                  {/* Job details */}
                  <div className="section-card p-5 space-y-4">
                    <h3 className="text-[14px] font-semibold text-text-primary">{t.modals.jobDetails}</h3>
                    <div>
                      <label className={labelCls}>{t.modals.jobTitle}</label>
                      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
                        className={cn(inputCls, 'text-lg')} placeholder="e.g. Residential Cleaning - Smith Residence" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div>
                        <label className={labelCls}>{t.modals.clientName}</label>
                        <input value={client} onChange={(e) => setClient(e.target.value)} className={inputCls} placeholder="e.g. John Doe" />
                      </div>
                      <div>
                        <label className={labelCls}>{t.jobs.jobNumber}</label>
                        <input value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>{t.modals.salesperson}</label>
                        <select value={salesperson} onChange={(e) => setSalesperson(e.target.value)} className={inputCls}>
                          <option value="">{t.modals.assign}</option>
                          <option value="Me">Me</option>
                          <option value="Sarah">Sarah</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>{t.modals.jobType}</label>
                        <div className="flex p-0.5 bg-surface-tertiary rounded-lg border border-outline">
                          <button type="button" onClick={() => setJobType('one-off')}
                            className={cn("flex-1 px-3 py-2 rounded-md text-xs font-semibold transition-all",
                              jobType === 'one-off' ? "bg-surface shadow-sm text-text-primary" : "text-text-tertiary")}>
                            {t.modals.oneOff}
                          </button>
                          <button type="button" onClick={() => setJobType('recurring')}
                            className={cn("flex-1 px-3 py-2 rounded-md text-xs font-semibold transition-all",
                              jobType === 'recurring' ? "bg-surface shadow-sm text-text-primary" : "text-text-tertiary")}>
                            {t.modals.recurring}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Schedule */}
                  <div className="section-card p-5 space-y-4">
                    <h3 className="text-[14px] font-semibold text-text-primary flex items-center gap-2">
                      <Calendar size={15} className="text-text-tertiary" /> {t.modals.schedule}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className={labelCls}>{t.modals.startDate}</label>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>{t.modals.startTime}</label>
                        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>{t.modals.endTime}</label>
                        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                  </div>

                  {/* Line items */}
                  <div className="section-card p-5 space-y-4">
                    <h3 className="text-[14px] font-semibold text-text-primary">{t.modals.productService}</h3>
                    {lineItems.map((item) => (
                      <div key={item.id} className="grid grid-cols-12 gap-3 items-start p-3 rounded-lg border border-outline bg-surface">
                        <div className="col-span-5 space-y-1">
                          <input value={item.name} onChange={(e) => updateLineItem(item.id, 'name', e.target.value)}
                            className={cn(inputCls, 'py-2')} placeholder={t.modals.serviceName || 'Name'} />
                          <textarea value={item.description} onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                            className={cn(inputCls, 'py-1.5 text-xs min-h-[40px] resize-none')} placeholder={t.modals.addDescription || 'Description'} />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[10px] text-text-tertiary font-medium">{t.invoiceDetails.qty}</label>
                          <input type="number" value={item.quantity} onChange={(e) => updateLineItem(item.id, 'quantity', Number(e.target.value))}
                            className={cn(inputCls, 'py-2 text-center')} />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[10px] text-text-tertiary font-medium">{t.modals.unitPrice}</label>
                          <input type="number" value={item.unitPrice} onChange={(e) => updateLineItem(item.id, 'unitPrice', Number(e.target.value))}
                            className={cn(inputCls, 'py-2 text-right')} />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[10px] text-text-tertiary font-medium">{t.common.total}</label>
                          <p className="px-2.5 py-2 text-sm font-medium text-right text-text-primary">{formatCurrency(item.quantity * item.unitPrice)}</p>
                        </div>
                        <div className="col-span-1 flex items-center justify-center pt-5">
                          <button type="button" onClick={() => removeLineItem(item.id)} disabled={lineItems.length === 1}
                            className="p-1 text-text-tertiary hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={addLineItem}
                      className="glass-button-primary text-xs flex items-center gap-1.5 px-3 py-2">
                      <Plus size={12} /> {t.modals.addLineItem}
                    </button>
                  </div>

                  {/* Totals */}
                  <div className="section-card p-5 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Subtotal</span>
                      <span className="font-semibold text-text-primary">{formatCurrency(calculateTotal())}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold border-t border-outline pt-3">
                      <span className="text-text-primary">{t.common.total}</span>
                      <span className="text-text-primary">{formatCurrency(calculateTotal())}</span>
                    </div>
                  </div>

                  {/* Billing */}
                  <div className="section-card p-5 space-y-3">
                    <h3 className="text-[13px] font-semibold text-text-primary">{t.modals.billing}</h3>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={billingRemind} onChange={() => setBillingRemind(!billingRemind)} className="h-4 w-4 rounded" />
                      <span className="text-sm text-text-secondary">{t.modals.remindInvoice}</span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={billingSplit} onChange={() => setBillingSplit(!billingSplit)} className="h-4 w-4 rounded" />
                      <span className="text-sm text-text-secondary">{t.modals.splitInvoices}</span>
                    </label>
                  </div>
                </>
              )}

              {(inlineError || errorMessage) && (
                <div className="rounded-xl border border-danger bg-danger-light text-danger px-4 py-3 text-sm">{inlineError || errorMessage}</div>
              )}
            </form>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-outline bg-surface-secondary flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
                  {mode === 'lead' ? (t.modals.value) : (t.billing.total)}
                </p>
                <p className="text-lg font-bold text-text-primary">
                  {mode === 'lead' ? formatCurrency(Number(leadValue || 0)) : formatCurrency(calculateTotal())}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={onClose}
                  className="glass-button px-5 py-2.5 text-sm font-medium">
                  {t.common.cancel}
                </button>
                <button type="button" onClick={() => formRef.current?.requestSubmit()} disabled={isSaving}
                  className="glass-button-primary px-6 py-2.5 text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
                  {isSaving
                    ? (t.invoiceEdit.saving)
                    : mode === 'lead'
                      ? (t.modals.saveLead)
                      : (t.modals.saveJob)}
                  <ChevronDown size={14} className="opacity-70" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
