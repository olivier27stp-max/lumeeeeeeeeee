import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, Calendar, Clock, Briefcase, ChevronDown } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';

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
  const [leadFirstName, setLeadFirstName] = useState('');
  const [leadLastName, setLeadLastName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadAddress, setLeadAddress] = useState('');
  const [leadStatus, setLeadStatus] = useState('Lead');
  const [leadValue, setLeadValue] = useState('0');
  const [title, setTitle] = useState('');
  const [client, setClient] = useState(initialClient || '');
  const [jobNumber, setJobNumber] = useState(Math.floor(Math.random() * 1000).toString());

  useEffect(() => {
    if (initialClient) {
      setClient(initialClient);
    }
  }, [initialClient]);

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
      name: '', 
      quantity: 1, 
      unitCost: 0, 
      unitPrice: 0, 
      description: '' 
    }]);
  };

  const removeLineItem = (id: string) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter(item => item.id !== id));
    }
  };

  const updateLineItem = (id: string, field: keyof LineItem, value: any) => {
    setLineItems(lineItems.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const calculateTotal = () => {
    return lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setInlineError(null);
    const totalValue = calculateTotal();

    if (mode === 'lead') {
      if (!leadFirstName.trim() || !leadLastName.trim() || !title.trim()) {
        setInlineError('First name, last name and lead title are required.');
        return;
      }

      try {
        await onSave({
          first_name: leadFirstName.trim(),
          last_name: leadLastName.trim(),
          email: leadEmail.trim(),
          address: leadAddress.trim(),
          company: title.trim(),
          value: Number(leadValue || 0),
          status: leadStatus,
        });
        resetForm();
      } catch (error: any) {
        setInlineError(error?.message || 'Failed to save. Please try again.');
      }
      return;
    }
    
    // Basic validation
    if (!title || !client) {
      setInlineError('Please fill in Title and Client');
      return;
    }

    const leadData = {
      title,
      client,
      job_number: jobNumber,
      salesperson,
      job_type: jobType,
      schedule: {
        start_date: startDate,
        start_time: startTime,
        end_time: endTime
      },
      line_items: lineItems,
      billing: {
        remind: billingRemind,
        split: billingSplit
      },
      value: totalValue,
      status: 'Lead'
    };

    try {
      await onSave(leadData);
      resetForm();
    } catch (error: any) {
      setInlineError(error?.message || 'Failed to save. Please try again.');
    }
  };

  const resetForm = () => {
    setLeadFirstName('');
    setLeadLastName('');
    setLeadEmail('');
    setLeadAddress('');
    setLeadStatus('Lead');
    setLeadValue('0');
    setTitle('');
    setClient('');
    setJobNumber(Math.floor(Math.random() * 1000).toString());
    setSalesperson('');
    setJobType('one-off');
    setLineItems([{ id: '1', name: '', quantity: 1, unitCost: 0, unitPrice: 0, description: '' }]);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-black/40 backdrop-blur-md overflow-hidden">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="bg-surface w-full max-w-5xl max-h-full flex flex-col shadow-2xl border border-border rounded-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="p-6 border-b border-border flex justify-between items-center bg-surface-secondary/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center">
                  <Briefcase size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-text-primary">{mode === 'lead' ? 'New Lead' : 'New Job'}</h2>
                  <p className="text-[10px] uppercase tracking-widest text-text-tertiary font-medium">Create a new lead or service request</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-surface-tertiary rounded-full transition-colors text-text-tertiary hover:text-black"
              >
                <X size={20} />
              </button>
            </div>

            {/* Scrollable Content */}
            <form ref={formRef} onSubmit={handleSave} className="flex-1 overflow-y-auto p-8 space-y-12 custom-scrollbar bg-surface">
              {mode === 'lead' ? (
                <section className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">First Name</label>
                      <input
                        autoFocus
                        value={leadFirstName}
                        onChange={(e) => setLeadFirstName(e.target.value)}
                        className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                        placeholder="John"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Last Name</label>
                      <input
                        value={leadLastName}
                        onChange={(e) => setLeadLastName(e.target.value)}
                        className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                        placeholder="Doe"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Lead Title</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full text-lg px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                      placeholder="Spring maintenance contract"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Email</label>
                    <input
                      type="email"
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                      placeholder="john@company.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Address</label>
                    <input
                      value={leadAddress}
                      onChange={(e) => setLeadAddress(e.target.value)}
                      className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                      placeholder="123 Main St, Toronto"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Status</label>
                      <select
                        value={leadStatus}
                        onChange={(e) => setLeadStatus(e.target.value)}
                        className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                      >
                        <option value="Lead">Lead</option>
                        <option value="Qualified">Qualified</option>
                        <option value="Proposal">Proposal</option>
                        <option value="Negotiation">Negotiation</option>
                        <option value="Closed">Closed</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Value</label>
                      <input
                        type="number"
                        min="0"
                        value={leadValue}
                        onChange={(e) => setLeadValue(e.target.value)}
                        className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                      />
                    </div>
                  </div>
                </section>
              ) : (
              <section className="space-y-6">
                <div className="grid grid-cols-1 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Job Title</label>
                    <input 
                      autoFocus
                      placeholder="e.g. Residential Cleaning - Smith Residence"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full text-lg px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all placeholder:text-text-tertiary text-text-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Client Name</label>
                    <input
                        type="text"
                        value={client}
                        onChange={(e) => setClient(e.target.value)}
                        className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                        placeholder="e.g. John Doe"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Job #</label>
                      <input 
                        value={jobNumber}
                        onChange={(e) => setJobNumber(e.target.value)}
                        className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Salesperson</label>
                      <div className="relative">
                        <select 
                          value={salesperson}
                          onChange={(e) => setSalesperson(e.target.value)}
                          className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all appearance-none pr-10 text-text-primary"
                        >
                          <option value="">Assign</option>
                          <option value="Me">Me</option>
                          <option value="Sarah">Sarah</option>
                        </select>
                        <Plus size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              )}

              {(inlineError || errorMessage) && (
                <div className="p-3 rounded-xl border border-danger bg-danger-light text-danger text-sm">
                  {inlineError || errorMessage}
                </div>
              )}

              {mode !== 'lead' && (
              <>
              {/* Job Type & Schedule */}
              <section className="grid grid-cols-1 lg:grid-cols-3 gap-12 pt-8 border-t border-border">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold tracking-tight text-text-primary">Job Type</h3>
                    <div className="w-4 h-4 rounded-full bg-surface-tertiary flex items-center justify-center text-[8px] text-text-tertiary font-bold cursor-help border border-border">?</div>
                  </div>
                  <div className="flex p-1 bg-surface-tertiary rounded-xl w-fit border border-border">
                    <button 
                      type="button"
                      onClick={() => setJobType('one-off')}
                      className={cn(
                        "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                        jobType === 'one-off' ? "bg-surface shadow-sm text-black" : "text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      One-off
                    </button>
                    <button 
                      type="button"
                      onClick={() => setJobType('recurring')}
                      className={cn(
                        "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                        jobType === 'recurring' ? "bg-surface shadow-sm text-black" : "text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      Recurring
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold tracking-tight text-text-primary">Schedule</h3>
                    <button type="button" className="text-[10px] uppercase tracking-widest text-text-tertiary hover:text-black font-bold flex items-center gap-1">
                      <Calendar size={12} /> Show Calendar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Start Date</label>
                      <div className="relative">
                        <input 
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all pl-10 text-text-primary"
                        />
                        <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Start Time</label>
                      <div className="relative">
                        <input 
                          type="time"
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all pl-10 text-text-primary"
                        />
                        <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">End Time</label>
                      <div className="relative">
                        <input 
                          type="time"
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                          className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all pl-10 text-text-primary"
                        />
                        <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Billing */}
              <section className="space-y-4 pt-8 border-t border-border">
                <h3 className="text-sm font-bold tracking-tight text-text-primary">Billing</h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={cn(
                      "w-5 h-5 rounded border transition-all flex items-center justify-center",
                      billingRemind ? "bg-black border-black text-white" : "border-border group-hover:border-border bg-surface"
                    )} onClick={() => setBillingRemind(!billingRemind)}>
                      {billingRemind && <Plus size={14} className="rotate-45" />}
                    </div>
                    <span className="text-sm font-medium text-text-secondary">Remind me to invoice when I close the job</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={cn(
                      "w-5 h-5 rounded border transition-all flex items-center justify-center",
                      billingSplit ? "bg-black border-black text-white" : "border-border group-hover:border-border bg-surface"
                    )} onClick={() => setBillingSplit(!billingSplit)}>
                      {billingSplit && <Plus size={14} className="rotate-45" />}
                    </div>
                    <span className="text-sm font-medium text-text-secondary">Split into multiple invoices with a payment schedule</span>
                  </label>
                </div>
              </section>

              {/* Product / Service */}
              <section className="space-y-6 pt-8 border-t border-border pb-12">
                <h3 className="text-sm font-bold tracking-tight text-text-primary">Product / Service</h3>
                <div className="space-y-6">
                  {lineItems.map((item, index) => (
                    <div key={item.id} className="p-6 rounded-2xl border border-border bg-surface-secondary/50 space-y-4 relative group">
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                        <div className="md:col-span-4 space-y-2">
                          <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Name</label>
                          <input 
                            placeholder="Service name"
                            value={item.name}
                            onChange={(e) => updateLineItem(item.id, 'name', e.target.value)}
                            className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                          />
                        </div>
                        <div className="md:col-span-1 space-y-2">
                          <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Qty</label>
                          <input 
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateLineItem(item.id, 'quantity', Number(e.target.value))}
                            className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                          />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Unit Cost</label>
                          <input 
                            type="number"
                            value={item.unitCost}
                            onChange={(e) => updateLineItem(item.id, 'unitCost', Number(e.target.value))}
                            className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                          />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Unit Price</label>
                          <input 
                            type="number"
                            value={item.unitPrice}
                            onChange={(e) => updateLineItem(item.id, 'unitPrice', Number(e.target.value))}
                            className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                          />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Total</label>
                          <div className="w-full px-4 py-3 bg-surface-tertiary border border-border rounded-xl flex items-center font-bold text-text-primary">
                            {formatCurrency(item.quantity * item.unitPrice)}
                          </div>
                        </div>
                        <div className="md:col-span-1 flex items-end justify-center">
                          <button 
                            type="button"
                            onClick={() => removeLineItem(item.id)}
                            className="p-2 text-text-tertiary hover:text-danger transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Description</label>
                        <textarea 
                          placeholder="Add details about this service..."
                          value={item.description}
                          onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                          className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all min-h-[80px] text-text-primary"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <button 
                  type="button"
                  onClick={addLineItem}
                  className="bg-surface-tertiary hover:bg-surface-tertiary border border-border text-text-primary font-bold flex items-center gap-2 text-xs py-3 px-6 rounded-xl transition-all"
                >
                  <Plus size={14} /> Add Line Item
                </button>
              </section>
              </>
              )}
              {/* Footer Action Bar */}
              <div className="p-6 border-t border-border flex justify-between items-center bg-surface-secondary">
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-text-tertiary font-bold">Total Value</p>
                    <p className="text-2xl font-bold tracking-tight text-text-primary">
                      {mode === 'lead' ? formatCurrency(Number(leadValue || 0)) : formatCurrency(calculateTotal())}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    type="button"
                    onClick={onClose}
                    className="px-8 py-3 text-sm font-bold text-text-secondary hover:bg-surface-tertiary rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={() => formRef.current?.requestSubmit()}
                    disabled={isSaving}
                    className="bg-black text-white hover:bg-text-primary px-10 py-3 text-sm font-bold rounded-xl flex items-center gap-2 transition-all shadow-lg"
                  >
                    {isSaving ? 'Saving...' : mode === 'lead' ? 'Save Lead' : 'Save Job'}
                    <ChevronDown size={16} className="opacity-50" />
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
