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
    <div className="rounded-xl border border-border/60 bg-white overflow-hidden">
      {/* Batch action bar */}
      {selectable && selectedIds.size > 0 && batchActions && (
        <div className="flex items-center gap-3 border-b border-border bg-surface-secondary/80 px-4 py-2">
          <span className="text-xs font-medium text-text-secondary">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-1.5">
            {batchActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => action.onClick(Array.from(selectedIds))}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  action.variant === 'danger'
                    ? 'text-red-700 hover:bg-red-50'
                    : 'text-text-primary hover:bg-surface-tertiary'
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
            className="ml-auto text-xs text-text-secondary hover:text-text-primary"
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              {selectable && (
                <th className="w-10 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={toggleAll}
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                      allSelected
                        ? 'border-text-primary bg-text-primary text-white'
                        : someSelected
                          ? 'border-border bg-surface-tertiary'
                          : 'border-border hover:border-border'
                    )}
                  >
                    {allSelected ? (
                      <Check size={10} strokeWidth={3} />
                    ) : someSelected ? (
                      <Minus size={10} strokeWidth={3} />
                    ) : null}
                  </button>
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-text-secondary',
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
                <tr key={`skeleton-${idx}`} className="border-b border-border">
                  {selectable && <td className="px-3 py-3"><div className="h-4 w-4 rounded bg-surface-tertiary" /></td>}
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-3">
                      <div className="h-4 w-24 rounded bg-surface-tertiary animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="px-3 py-12 text-center text-sm text-text-tertiary"
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
                      'border-b border-border transition-colors',
                      onRowClick && 'cursor-pointer',
                      isSelected
                        ? 'bg-blue-50/40'
                        : 'hover:bg-surface-secondary/60'
                    )}
                  >
                    {selectable && (
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRow(row.id);
                          }}
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                            isSelected
                              ? 'border-text-primary bg-text-primary text-white'
                              : 'border-border hover:border-border'
                          )}
                        >
                          {isSelected && <Check size={10} strokeWidth={3} />}
                        </button>
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className="px-3 py-2.5 text-sm text-text-primary">
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
