/* ═══════════════════════════════════════════════════════════════
   AI Tools — Jobs
   ═══════════════════════════════════════════════════════════════ */

import type { ToolDefinition } from '../types';
import { getJobs, getJobById, getJobsKpis } from '../../jobsApi';

export const jobTools: ToolDefinition[] = [
  {
    id: 'jobs.search',
    label: 'Search Jobs',
    description: 'Search and list jobs by title, client name, status, or job type. Returns paginated results.',
    category: 'read',
    requiredPermissions: ['jobs.read'],
    parameters: [
      { name: 'query', type: 'string', description: 'Search term', required: false },
      { name: 'status', type: 'string', description: 'Filter by status', required: false, enum: ['Late', 'Unscheduled', 'Requires Invoicing', 'Action Required', 'Ending within 30 days', 'Scheduled', 'Completed'] },
      { name: 'jobType', type: 'string', description: 'Filter by job type', required: false },
      { name: 'page', type: 'number', description: 'Page number (default 1)', required: false, default: 1 },
      { name: 'pageSize', type: 'number', description: 'Results per page (default 10, max 50)', required: false, default: 10 },
    ],
    execute: async (params) => {
      try {
        const result = await getJobs({
          q: (params.query as string) || '',
          status: (params.status as string) || undefined,
          jobType: (params.jobType as string) || undefined,
          page: Math.max(1, (params.page as number) || 1),
          pageSize: Math.min(50, Math.max(1, (params.pageSize as number) || 10)),
        });
        return {
          success: true,
          data: {
            jobs: result.jobs.map((j) => ({
              id: j.id,
              job_number: j.job_number,
              title: j.title,
              client_name: j.client_name,
              status: j.status,
              property_address: j.property_address,
              scheduled_at: j.scheduled_at,
              end_at: j.end_at,
              total_cents: j.total_cents,
              currency: j.currency,
            })),
            total: result.total,
          },
          summary: `Found ${result.total} job(s)${params.query ? ` matching "${params.query}"` : ''}${params.status ? ` with status "${params.status}"` : ''}.`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to search jobs' };
      }
    },
  },
  {
    id: 'jobs.get',
    label: 'Get Job Details',
    description: 'Get full details for a specific job by ID.',
    category: 'read',
    requiredPermissions: ['jobs.read'],
    parameters: [
      { name: 'jobId', type: 'string', description: 'The job UUID', required: true },
    ],
    execute: async (params) => {
      try {
        const job = await getJobById(params.jobId as string);
        if (!job) {
          return { success: false, error: 'Job not found' };
        }
        return {
          success: true,
          data: {
            id: job.id,
            job_number: job.job_number,
            title: job.title,
            client_name: job.client_name,
            status: job.status,
            property_address: job.property_address,
            scheduled_at: job.scheduled_at,
            end_at: job.end_at,
            total_cents: job.total_cents,
            currency: job.currency,
            notes: job.notes,
            job_type: job.job_type,
          },
          summary: `Job #${job.job_number}: ${job.title}`,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get job' };
      }
    },
  },
  {
    id: 'jobs.kpis',
    label: 'Jobs KPIs',
    description: 'Get job statistics: counts by status, total values, and overdue/action-required counts.',
    category: 'read',
    requiredPermissions: ['jobs.read'],
    parameters: [
      { name: 'status', type: 'string', description: 'Filter KPIs by status', required: false },
      { name: 'jobType', type: 'string', description: 'Filter KPIs by job type', required: false },
    ],
    execute: async (params) => {
      try {
        const kpis = await getJobsKpis({
          status: (params.status as string) || undefined,
          jobType: (params.jobType as string) || undefined,
        });
        return {
          success: true,
          data: kpis,
          summary: 'Job KPIs retrieved.',
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to get job KPIs' };
      }
    },
  },
];
