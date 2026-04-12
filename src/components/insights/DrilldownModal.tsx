import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render?: (value: any, row: any) => React.ReactNode;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  columns: Column[];
  data: Record<string, any>[];
  loading?: boolean;
}

export default function DrilldownModal({ isOpen, onClose, title, subtitle, columns, data, loading }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="bg-surface border border-outline rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline shrink-0">
              <div>
                <h3 className="text-[15px] font-bold text-text-primary">{title}</h3>
                {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-secondary transition-colors text-text-tertiary">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-auto flex-1 p-4">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
                </div>
              ) : data.length === 0 ? (
                <div className="text-center py-10 text-text-tertiary text-sm">No data to display.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-outline text-xs font-medium uppercase tracking-wider text-text-tertiary">
                      {columns.map((col) => (
                        <th key={col.key} className={`py-2 px-2 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}>
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, idx) => (
                      <tr key={idx} className="border-b border-outline/40 last:border-0 hover:bg-surface-secondary/50 transition-colors">
                        {columns.map((col) => (
                          <td key={col.key} className={`py-2.5 px-2 ${col.align === 'right' ? 'text-right tabular-nums' : col.align === 'center' ? 'text-center' : ''}`}>
                            {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '--')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-outline shrink-0 flex items-center justify-between text-xs text-text-tertiary">
              <span>{data.length} record{data.length !== 1 ? 's' : ''}</span>
              <button onClick={onClose} className="glass-button !py-1.5 !px-3 !text-xs">Close</button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
