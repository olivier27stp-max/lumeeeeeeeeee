import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trash2, Calendar, Clock, User, Briefcase, ChevronDown, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';

interface EditJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  onDelete: (id: string) => void;
  job: any;
}

export default function EditJobModal({ isOpen, onClose, onSave, onDelete, job }: EditJobModalProps) {
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [status, setStatus] = useState<'Lead' | 'Scheduled' | 'Done'>('Scheduled');
  const [notes, setNotes] = useState('');
  const [assignedTeam, setAssignedTeam] = useState('All');

  useEffect(() => {
    if (job) {
      setTitle(job.title || '');
      setClient(job.client || '');
      setStartDate(job.startDate ? new Date(job.startDate).toISOString().split('T')[0] : '');
      setStartTime(job.startTime || '');
      setEndTime(job.endTime || '');
      setStatus(job.status || 'Scheduled');
      setNotes(job.notes || '');
      setAssignedTeam(job.assignedTeam || 'All');
    }
  }, [job, isOpen]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !client) {
      alert('Please fill in Title and Client');
      return;
    }

    onSave({
      ...job,
      title,
      client,
      startDate: new Date(startDate),
      startTime,
      endTime,
      status,
      notes,
      assignedTeam
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8 bg-black/40 backdrop-blur-md overflow-hidden">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="bg-surface w-full max-w-2xl max-h-full flex flex-col shadow-2xl border border-border rounded-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="p-6 border-b border-border flex justify-between items-center bg-surface-secondary/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center">
                  <Briefcase size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-text-primary">Edit Job</h2>
                  <p className="text-[10px] uppercase tracking-widest text-text-tertiary font-medium">Update job details and schedule</p>
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
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar bg-surface">
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Job Title</label>
                  <input 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full text-lg px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Client</label>
                    <input 
                      value={client}
                      onChange={(e) => setClient(e.target.value)}
                      className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all text-text-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Status</label>
                    <div className="relative">
                      <select 
                        value={status}
                        onChange={(e) => setStatus(e.target.value as any)}
                        className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all appearance-none pr-10 text-text-primary"
                      >
                        <option value="Lead">Lead</option>
                        <option value="Scheduled">Scheduled</option>
                        <option value="Done">Done</option>
                      </select>
                      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Date</label>
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

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Assigned Team</label>
                  <div className="relative">
                    <select 
                      value={assignedTeam}
                      onChange={(e) => setAssignedTeam(e.target.value)}
                      className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all appearance-none pr-10 text-text-primary"
                    >
                      <option value="All">All Teams</option>
                      <option value="Team A">Team A</option>
                      <option value="Team B">Team B</option>
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest text-text-secondary font-bold">Notes</label>
                  <textarea 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any additional notes here..."
                    className="w-full px-4 py-3 bg-surface border border-border rounded-xl focus:ring-2 focus:ring-black/5 focus:border-black outline-none transition-all min-h-[100px] text-text-primary"
                  />
                </div>
              </div>
            </form>

            {/* Footer Action Bar */}
            <div className="p-6 border-t border-border flex justify-between items-center bg-surface-secondary">
              <button 
                type="button"
                onClick={() => {
                  if (window.confirm('Are you sure you want to delete this job?')) {
                    onDelete(job.id);
                  }
                }}
                className="flex items-center gap-2 text-danger hover:text-danger text-sm font-bold transition-all"
              >
                <Trash2 size={16} /> Delete Job
              </button>
              <div className="flex items-center gap-3">
                <button 
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 text-sm font-bold text-text-secondary hover:bg-surface-tertiary rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  onClick={handleSave}
                  className="bg-black text-white hover:bg-text-primary px-8 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-all shadow-lg"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
