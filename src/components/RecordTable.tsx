import React, { useState, useMemo, useCallback } from 'react';
import { ChevronUp, ChevronDown, Check, Minus, Trash2, Archive } from 'lucide-react';
import { cn } from '../lib/utils';

export interface RecordColumn<T> {
  key: string;
  label: string;
  width?: string;
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
}

export interface RecordTableProps<T extends { id: string }> {
  columns: RecordColumn<T>[];
  rows: T[];
  loading?: boolean;
  emptyMessage?: string;
  selectable?: boolean;
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  batchActions?: Array<{
    label: string;
    icon?: React.ReactNode;
    variant?: 'default' | 'danger';
    onClick: (selectedIds: string[]) => void;
  }>;
}

export default function RecordTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  emptyMessage = 'No records found.',
  selectable = false,
  sortKey,
  sortDirection,
  onSort,
  onRowClick,
  selectedIds: controlledSelectedIds,
  onSelectionChange,
  batchActions,
}: RecordTableProps<T>) {
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;
  const setSelectedIds = onSelectionChange ?? setInternalSelectedIds;

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    }
  }, [allSelected, rows, setSelectedIds]);

  const toggleRow = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(next);
    },
    [selectedIds, setSelectedIds]
  );

  return (
    <div className="section-card">
      {/* Batch action bar */}
      {selectable && selectedIds.size > 0 && batchActions && (
        <div className="flex items-center gap-3 border-b border-border-light bg-primary/5 px-5 py-3">
          <span className="text-xs font-semibold text-primary">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-1.5">
            {batchActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => action.onClick(Array.from(selectedIds))}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  action.variant === 'danger'
                    ? 'text-danger hover:bg-danger-light'
                    : 'text-text-primary hover:bg-surface-secondary'
                )}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs font-medium text-text-tertiary hover:text-text-primary"
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border-light">
              {selectable && (
                <th className="w-10 px-5 py-3.5">
                  <button
                    type="button"
                    onClick={toggleAll}
                    className={cn(
                      'flex h-[18px] w-[18px] items-center justify-center rounded-md border-[1.5px] transition-all',
                      allSelected
                        ? 'border-primary bg-primary text-white'
                        : someSelected
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-outline hover:border-outline-strong'
                    )}
                  >
                    {allSelected ? (
                      <Check size={11} strokeWidth={3} />
                    ) : someSelected ? (
                      <Minus size={11} strokeWidth={3} className="text-primary" />
                    ) : null}
                  </button>
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-5 py-3.5 text-xs font-medium text-text-tertiary',
                    col.sortable && 'cursor-pointer select-none hover:text-text-primary'
                  )}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => col.sortable && onSort?.(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      sortDirection === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={`skeleton-${idx}`} className="border-b border-border-light/60">
                  {selectable && <td className="px-5 py-4"><div className="h-[18px] w-[18px] rounded-md bg-surface-secondary" /></td>}
                  {columns.map((col) => (
                    <td key={col.key} className="px-5 py-4">
                      <div className="h-4 w-24 rounded-md bg-surface-secondary animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="px-5 py-16 text-center text-sm text-text-tertiary"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => {
                const isSelected = selectedIds.has(row.id);
                return (
                  <tr
                    key={row.id}
                    onClick={() => onRowClick?.(row)}
                    className={cn(
                      'border-b border-border-light/60 transition-colors',
                      onRowClick && 'cursor-pointer',
                      isSelected
                        ? 'bg-primary/[0.04]'
                        : 'hover:bg-surface-secondary dark:hover:bg-surface-secondary/50'
                    )}
                  >
                    {selectable && (
                      <td className="px-5 py-3.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRow(row.id);
                          }}
                          className={cn(
                            'flex h-[18px] w-[18px] items-center justify-center rounded-md border-[1.5px] transition-all',
                            isSelected
                              ? 'border-primary bg-primary text-white'
                              : 'border-outline hover:border-outline-strong'
                          )}
                        >
                          {isSelected && <Check size={11} strokeWidth={3} />}
                        </button>
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className="px-5 py-3.5 text-[13px] text-text-primary">
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
