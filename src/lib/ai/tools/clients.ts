/* ═══════════════════════════════════════════════════════════════
   AI Tools — Clients
   ═══════════════════════════════════════════════════════════════ */

import type { ToolDefinition } from '../types';
import { listClients, getClientById } from '../../clientsApi';

export const clientTools: ToolDefinition[] = [
  {
    id: 'clients.search',
    label: 'Search Clients',
    description: 'Search and list clients by name, email, company, or tag. Returns paginated results.',
    category: 'read',
    requiredPermissions: ['clients.read'],
    parameters: [
      { name: 'query', type: 'string', description: 'Search term (name, email, company)', required: false },
      { name: 'page', type: 'number', description: 'Page number (default 1)', required: false, default: 1 },
      { name: 'pageSize', type: 'number', description: 'Results per page (default 10, max 50)', required: false, default: 10 },
    ],
    execute: async (params) => {
      try {
        const result = await listClients({
          q: (params.query as string) || '',
          page: Math.max(1, (params.page as number) || 1),
          pageSize: Math.min(50, Math.max(1, (params.pageSize as number) || 10)),
        });
        return {
          success: true,
          data: {
            clients: result.items.map((c) => ({
              id: c.id,
              name: `${c.first_name} ${c.last_name}`.trim(),
              email: c.email,
              phone: c.phone,
              company: c.company,
              address: c.address,
            })),
            total: result.total,
          },
          summary: `Found ${result.total} client(s)${params.query ? ` matching "${params.query}"` : ''}.`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to search clients' };
      }
    },
  },
  {
    id: 'clients.get',
    label: 'Get Client Details',
    description: 'Get full details for a specific client by ID.',
    category: 'read',
    requiredPermissions: ['clients.read'],
    parameters: [
      { name: 'clientId', type: 'string', description: 'The client UUID', required: true },
    ],
    execute: async (params) => {
      try {
        const client = await getClientById(params.clientId as string);
        if (!client) {
          return { success: false, error: 'Client not found' };
        }
        return {
          success: true,
          data: {
            id: client.id,
            name: `${client.first_name} ${client.last_name}`.trim(),
            email: client.email,
            phone: client.phone,
            company: client.company,
            address: client.address,
            created_at: client.created_at,
          },
          summary: `Client: ${client.first_name} ${client.last_name}`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get client' };
      }
    },
  },
];
