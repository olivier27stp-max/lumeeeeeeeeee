/* ═══════════════════════════════════════════════════════════════
   AI Tools — Schedule
   ═══════════════════════════════════════════════════════════════ */

import type { ToolDefinition } from '../types';
import { listScheduleEventsRange, listUnscheduledJobs } from '../../scheduleApi';

export const scheduleTools: ToolDefinition[] = [
  {
    id: 'schedule.list',
    label: 'List Schedule Events',
    description: 'List scheduled events (appointments, jobs) within a date range. Defaults to today if no dates provided.',
    category: 'read',
    requiredPermissions: ['jobs.read'],
    parameters: [
      { name: 'startDate', type: 'string', description: 'Start date (ISO format, e.g. 2026-03-13)', required: false },
      { name: 'endDate', type: 'string', description: 'End date (ISO format)', required: false },
    ],
    execute: async (params) => {
      try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
        const startAt = (params.startDate as string) ? new Date(params.startDate as string).toISOString() : todayStart;
        const endAt = (params.endDate as string) ? new Date(params.endDate as string).toISOString() : todayEnd;

        const events = await listScheduleEventsRange({ startAt, endAt });
        return {
          success: true,
          data: {
            events: events.map((e) => ({
              id: e.id,
              job_id: e.job_id,
              title: e.job?.title || 'Untitled',
              client_name: e.job?.client_name || null,
              start_at: e.start_at,
              end_at: e.end_at,
              status: e.status,
              team_id: e.team_id,
              property_address: e.job?.property_address || null,
            })),
            count: events.length,
          },
          summary: `${events.length} event(s) scheduled.`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to list schedule' };
      }
    },
  },
  {
    id: 'schedule.unscheduled',
    label: 'List Unscheduled Jobs',
    description: 'List jobs that have no scheduled date yet and need to be planned.',
    category: 'read',
    requiredPermissions: ['jobs.read'],
    parameters: [],
    execute: async () => {
      try {
        const jobs = await listUnscheduledJobs();
        return {
          success: true,
          data: {
            jobs: jobs.map((j) => ({
              id: j.id,
              title: j.title,
              client_name: j.client_name,
              property_address: j.property_address,
              total_cents: j.total_cents,
            })),
            count: jobs.length,
          },
          summary: `${jobs.length} unscheduled job(s).`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to list unscheduled jobs' };
      }
    },
  },
];
