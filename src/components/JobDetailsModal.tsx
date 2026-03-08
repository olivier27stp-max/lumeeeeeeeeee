import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Edit2, 
  Trash2, 
  Calendar, 
  Clock, 
  User, 
  MapPin, 
  Phone, 
  Mail, 
  DollarSign, 
  FileText,
  Users,
  CheckCircle2,
  AlertCircle,
  Briefcase
} from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { format } from 'date-fns';

interface JobDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: (id: string) => void;
  job: any;
}

// ADDED: Job Details Modal
export default function JobDetailsModal({ isOpen, onClose, onEdit, onDelete, job }: JobDetailsModalProps) {
  if (!job) return null;

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this job? This action cannot be undone.')) {
      onDelete(job.id);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 md:p-8 bg-black/40 backdrop-blur-md overflow-hidden">
          <motion.div
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            className="bg-surface w-full max-w-2xl max-h-full flex flex-col shadow-2xl border border-border rounded-3xl overflow-hidden"
          >
            {/* Header */}
            <div className="p-8 border-b border-border flex justify-between items-start bg-surface-secondary/50">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg",
                  job.color || "bg-black"
                )}>
                  <Briefcase size={28} className="text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold tracking-tight text-text-primary">{job.title}</h2>
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border",
                      job.status === 'Done' ? "bg-success-light text-success border-success" :
                      job.status === 'Scheduled' ? "bg-info-light text-info border-info" :
                      "bg-warning-light text-warning border-warning"
                    )}>
                      {job.status || 'Scheduled'}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-text-tertiary flex items-center gap-2">
                    Job ID: <span className="text-text-primary font-bold">#{job.id.slice(0, 8).toUpperCase()}</span>
                  </p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-surface-tertiary rounded-full transition-colors text-text-tertiary hover:text-black"
              >
                <X size={24} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar bg-surface">
              {/* Client Info Section */}
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary flex items-center gap-2">
                  <User size={12} /> Client Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-surface-secondaryp-6 rounded-2xl border border-border">
                  <div className="space-y-3">
                    <p className="text-sm font-bold text-text-primary">{job.client}</p>
                    <div className="flex items-start gap-2 text-xs text-text-secondary">
                      <MapPin size={14} className="mt-0.5 text-text-tertiary" />
                      <span>{job.address || 'No address provided'}</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <Phone size={14} className="text-text-tertiary" />
                      <span>{job.phone || 'No phone provided'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <Mail size={14} className="text-text-tertiary" />
                      <span>{job.email || 'No email provided'}</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Schedule & Team Section */}
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary flex items-center gap-2">
                  <Calendar size={12} /> Schedule & Assignment
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-surface border border-border p-4 rounded-2xl shadow-sm">
                    <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-1">Date</p>
                    <p className="text-sm font-bold text-text-primary">{format(new Date(job.startDate), 'EEEE, MMM d, yyyy')}</p>
                  </div>
                  <div className="bg-surface border border-border p-4 rounded-2xl shadow-sm">
                    <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-1">Time Window</p>
                    <p className="text-sm font-bold text-text-primary">{job.startTime} - {job.endTime}</p>
                  </div>
                  <div className="bg-surface border border-border p-4 rounded-2xl shadow-sm">
                    <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-1">Assigned Team</p>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-black flex items-center justify-center">
                        <Users size={10} className="text-white" />
                      </div>
                      <p className="text-sm font-bold text-text-primary">{job.assignedTeam || 'Unassigned'}</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Financials & Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <section className="space-y-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary flex items-center gap-2">
                    <DollarSign size={12} /> Financials
                  </h3>
                  <div className="bg-black p-6 rounded-2xl shadow-xl">
                    <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1">Total Job Value</p>
                    <p className="text-3xl font-bold text-white">{formatCurrency(job.value || 0)}</p>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary flex items-center gap-2">
                    <FileText size={12} /> Internal Notes
                  </h3>
                  <div className="bg-warning-light/50 border border-warning p-6 rounded-2xl min-h-[100px]">
                    <p className="text-xs text-text-secondary leading-relaxed italic">
                      {job.notes || job.description || "No notes provided for this job."}
                    </p>
                  </div>
                </section>
              </div>

              {/* Line Items */}
              <section className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary flex items-center gap-2">
                  <Briefcase size={12} /> Services Included
                </h3>
                <div className="border border-border rounded-2xl overflow-hidden">
                  {Array.isArray(job.lineItems) && job.lineItems.length > 0 ? (
                    <table className="w-full text-left text-sm">
                      <thead className="bg-surface-secondaryborder-b border-border">
                        <tr>
                          <th className="px-6 py-3 font-bold text-text-secondary uppercase tracking-widest text-[10px]">Service</th>
                          <th className="px-6 py-3 font-bold text-text-secondary uppercase tracking-widest text-[10px] text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {job.lineItems.map((item: any) => (
                          <tr key={item.id || item.name}>
                            <td className="px-6 py-4 font-medium text-text-primary">{item.name || 'Unnamed item'}</td>
                            <td className="px-6 py-4 text-right font-bold text-text-primary">
                              {formatCurrency((item.quantity || 1) * (item.unitPrice || 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="px-6 py-5 text-xs font-medium text-text-tertiary">
                      No services or products listed for this job.
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Footer Action Bar */}
            <div className="p-8 border-t border-border flex justify-between items-center bg-surface-secondary/50">
              <button 
                onClick={handleDelete}
                className="flex items-center gap-2 text-danger hover:text-danger text-sm font-bold transition-all px-4 py-2 rounded-xl hover:bg-danger-light"
              >
                <Trash2 size={18} /> Delete Job
              </button>
              <div className="flex items-center gap-4">
                <button 
                  onClick={onClose}
                  className="px-6 py-3 text-sm font-bold text-text-secondary hover:text-black transition-all"
                >
                  Close
                </button>
                <button 
                  onClick={() => {
                    onClose();
                    onEdit();
                  }}
                  className="bg-black text-white hover:bg-text-primary px-8 py-3 text-sm font-bold rounded-2xl flex items-center gap-2 transition-all shadow-xl hover:-translate-y-0.5"
                >
                  <Edit2 size={18} /> Edit Job
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
