/* ===============================================================
   AI Tools — Global Search
   Shares the same search API layer as the GlobalSearch UI.
   =============================================================== */

import type { ToolDefinition } from '../types';
import { fetchSearchSuggestions, fetchSearchResults } from '../../globalSearchApi';

export const searchTools: ToolDefinition[] = [
  {
    id: 'search.global',
    label: 'Global CRM Search',
    description:
      'Search across all CRM data: clients, jobs, leads, invoices, quotes, teams, and calendar events. ' +
      'Supports searching by name, phone, email, address, company, job number, invoice number, quote number, status, and more. ' +
      'Returns grouped, ranked results with metadata (status, amount, dates, related client).',
    category: 'read',
    requiredPermissions: [],
    parameters: [
      { name: 'query', type: 'string', description: 'The search term (name, phone, email, address, company, ID, etc.)', required: true },
      { name: 'type', type: 'string', description: 'Filter by entity type', required: false, enum: ['all', 'clients', 'jobs', 'leads', 'invoices', 'quotes', 'teams', 'events'] },
      { name: 'page', type: 'number', description: 'Page number for paginated results (default 1)', required: false, default: 1 },
      { name: 'pageSize', type: 'number', description: 'Results per page (default 10, max 20)', required: false, default: 10 },
    ],
    execute: async (params) => {
      try {
        const query = (params.query as string) || '';
        if (!query.trim()) {
          return { success: false, error: 'Search query is required.' };
        }

        const entityType = (params.type as string) || 'all';
        const page = Math.max(1, (params.page as number) || 1);
        const pageSize = Math.min(20, Math.max(1, (params.pageSize as number) || 10));

        if (entityType === 'all' && page === 1) {
          // For initial search, use suggestions API for speed
          const suggestions = await fetchSearchSuggestions(query, 12);
          const totalItems = suggestions.items.length;

          const formatItem = (item: typeof suggestions.items[0]) => ({
            type: item.type,
            id: item.id,
            title: item.title,
            subtitle: item.subtitle,
            status: item.status,
            amount: item.amountCents ? `${(item.amountCents / 100).toFixed(2)} ${item.currency || 'CAD'}` : null,
            date: item.date,
            clientName: item.clientName,
          });

          const grouped: Record<string, ReturnType<typeof formatItem>[]> = {};
          for (const [key, items] of Object.entries(suggestions.grouped)) {
            if (items.length > 0) {
              grouped[key] = items.map(formatItem);
            }
          }

          return {
            success: true,
            data: {
              query,
              totalResults: totalItems,
              results: suggestions.items.map(formatItem),
              grouped,
            },
            summary: totalItems > 0
              ? `Found ${totalItems} result(s) for "${query}".`
              : `No results found for "${query}".`,
          };
        }

        // Full paginated search
        const results = await fetchSearchResults({
          q: query,
          tab: entityType as any,
          page,
          pageSize,
        });

        const formatItem = (item: typeof results.groups.clients.items[0]) => ({
          type: item.type,
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          status: item.status,
          amount: item.amountCents ? `${(item.amountCents / 100).toFixed(2)} ${item.currency || 'CAD'}` : null,
          date: item.date,
          clientName: item.clientName,
        });

        const grouped: Record<string, { total: number; items: ReturnType<typeof formatItem>[] }> = {};
        for (const [key, group] of Object.entries(results.groups)) {
          if (group.total > 0) {
            grouped[key] = {
              total: group.total,
              items: group.items.map(formatItem),
            };
          }
        }

        return {
          success: true,
          data: {
            query,
            tab: results.tab,
            counts: results.counts,
            grouped,
          },
          summary: results.counts.all > 0
            ? `Found ${results.counts.all} total result(s) for "${query}" (${Object.entries(results.counts).filter(([k, v]) => k !== 'all' && v > 0).map(([k, v]) => `${v} ${k}`).join(', ')}).`
            : `No results found for "${query}".`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Global search failed' };
      }
    },
  },
];
