/* ═══════════════════════════════════════════════════════════════
   AI Tools — Leads
   ═══════════════════════════════════════════════════════════════ */

import type { ToolDefinition } from '../types';
import { fetchLeadsScoped } from '../../leadsApi';

export const leadTools: ToolDefinition[] = [
  {
    id: 'leads.search',
    label: 'Search Leads',
    description: 'Search and list leads in the pipeline by name, email, status, or source.',
    category: 'read',
    requiredPermissions: ['clients.read'],
    parameters: [
      { name: 'query', type: 'string', description: 'Search term (name, email)', required: false },
      { name: 'status', type: 'string', description: 'Filter by lead status', required: false, enum: ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Closed'] },
    ],
    execute: async (params) => {
      try {
        const leads = await fetchLeadsScoped({
          search: (params.query as string) || undefined,
          status: (params.status as string) || undefined,
        });
        return {
          success: true,
          data: {
            leads: leads.map((l) => ({
              id: l.id,
              name: `${l.first_name} ${l.last_name}`.trim(),
              email: l.email,
              phone: l.phone,
              company: l.company,
              status: l.status,
              source: l.source,
              value: l.value,
              notes: l.notes,
            })),
            count: leads.length,
          },
          summary: `Found ${leads.length} lead(s)${params.status ? ` with status "${params.status}"` : ''}.`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to search leads' };
      }
    },
  },
];
