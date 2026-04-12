import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import NewJobModal, { JobDraftInitialValues, JobModalSourceContext } from '../components/NewJobModal';
import InvoicePreviewModal from '../components/InvoicePreviewModal';
import { createJob, getJobModalDraftById, updateJob, softDeleteJob } from '../lib/jobsApi';
import { geocodeJob } from '../lib/geocodeApi';
import { invalidateScheduleCache } from '../lib/scheduleApi';
import { finishJobAndPrepareInvoice } from '../lib/invoicesApi';
import { Job } from '../types';

type OpenJobModalParams = {
  initialValues?: JobDraftInitialValues;
  jobId?: string;
  sourceContext?: JobModalSourceContext;
  onCreated?: (job: Job) => void | Promise<void>;
  onCancel?: () => void;
};

type JobModalControllerValue = {
  isOpen: boolean;
  initialValues: JobDraftInitialValues | null;
  sourceContext: JobModalSourceContext | null;
  openJobModal: (params?: OpenJobModalParams) => void;
  closeJobModal: () => void;
};

const JobModalControllerContext = createContext<JobModalControllerValue | null>(null);

export function JobModalControllerProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [initialValues, setInitialValues] = useState<JobDraftInitialValues | null>(null);
  const [sourceContext, setSourceContext] = useState<JobModalSourceContext | null>(null);
  const [onCreatedCallback, setOnCreatedCallback] = useState<OpenJobModalParams['onCreated'] | null>(null);
  const [onCancelCallback, setOnCancelCallback] = useState<OpenJobModalParams['onCancel'] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isFinishingJob, setIsFinishingJob] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);
  const [isInvoicePreviewOpen, setIsInvoicePreviewOpen] = useState(false);

  const closeJobModal = useCallback(() => {
    setIsOpen(false);
    setSaveError(null);
  }, []);

  const openJobModal = useCallback((params?: OpenJobModalParams) => {
    // Reset state first to prevent leakage from previous modal opens
    setInitialValues(null);
    setOnCreatedCallback(() => null);
    setOnCancelCallback(() => null);
    setSaveError(null);
    setSourceContext(params?.sourceContext || null);

    if (params?.jobId) {
      void getJobModalDraftById(params.jobId)
        .then((draft) => {
          setInitialValues(draft || null);
          if (!draft) {
            toast.error('Job not found.');
            return;
          }
          setOnCreatedCallback(() => params?.onCreated || null);
          setOnCancelCallback(() => params?.onCancel || null);
          setIsOpen(true);
        })
        .catch((error: any) => {
          toast.error(error?.message || 'Unable to open job.');
        });
    } else {
      setInitialValues(params?.initialValues || null);
      setOnCreatedCallback(() => params?.onCreated || null);
      setOnCancelCallback(() => params?.onCancel || null);
      setIsOpen(true);
    }
  }, []);

  const handleSave = useCallback(async (payload: Parameters<typeof createJob>[0]) => {
    setIsSaving(true);
    setSaveError(null);
    try {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[jobs:handleSave] payload', {
          id: payload.id || null,
          lead_id: payload.lead_id || null,
          client_id: payload.client_id || null,
          scheduled_at: payload.scheduled_at || null,
          end_at: payload.end_at || null,
          total_cents: payload.total_cents || 0,
        });
      }
      const created = await createJob(payload as any);
      if (!created?.id) {
        throw new Error('Job save failed: missing persisted id.');
      }
      void geocodeJob(created.id).catch(() => undefined);
      // Clear internal schedule cache + invalidate React Query cache
      invalidateScheduleCache();
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendarEvents'] }),
        queryClient.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] }),
        queryClient.invalidateQueries({ queryKey: ['jobsTable'] }),
      ]);
      toast.success(payload.id ? 'Job updated' : 'Job created');
      return created;
    } catch (error: any) {
      const message = error?.message || 'Could not create job';
      setSaveError(message);
      toast.error(message);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [queryClient]);

  const handleCreated = useCallback(
    async (job: Job) => {
      closeJobModal();
      if (onCreatedCallback) {
        await onCreatedCallback(job);
      }
      // Always redirect to job details after save so user sees the full summary
      navigate(`/jobs/${job.id}`);
    },
    [closeJobModal, navigate, onCreatedCallback]
  );

  const handleCancel = useCallback(() => {
    closeJobModal();
    onCancelCallback?.();
  }, [closeJobModal, onCancelCallback]);

  const handleFinishJob = useCallback(
    async (payload: {
      jobId: string;
      subtotal: number;
      tax_total: number;
      total: number;
      tax_lines: Array<{ code: string; label: string; rate: number; enabled: boolean }>;
    }) => {
      setIsFinishingJob(true);
      try {
        await updateJob(payload.jobId, {
          status: 'completed',
          subtotal: payload.subtotal,
          tax_total: payload.tax_total,
          total: payload.total,
          tax_lines: payload.tax_lines as any,
        } as any);

        const result = await finishJobAndPrepareInvoice({ jobId: payload.jobId });
        if (!result?.invoice_id) {
          throw new Error('Invoice id missing after finishing job.');
        }
        // Invalidate schedule queries after status change
        invalidateScheduleCache();
        void queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
        setPreviewInvoiceId(result.invoice_id);
        setIsInvoicePreviewOpen(true);
        toast.success(result.already_exists ? 'Job completed. Existing invoice loaded.' : 'Job completed. Invoice draft created.');
      } catch (error: any) {
        toast.error(error?.message || 'Unable to finish job.');
      } finally {
        setIsFinishingJob(false);
      }
    },
    []
  );

  const handleDelete = useCallback(
    async (jobId: string) => {
      setIsDeleting(true);
      try {
        await softDeleteJob(jobId);
        // Invalidate schedule/jobs queries after deletion
        invalidateScheduleCache();
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['calendarEvents'] }),
          queryClient.invalidateQueries({ queryKey: ['calendarUnscheduledJobs'] }),
          queryClient.invalidateQueries({ queryKey: ['jobsTable'] }),
        ]);
        toast.success('Job deleted');
        closeJobModal();
        onCreatedCallback?.(undefined as any); // trigger list refresh
      } catch (error: any) {
        toast.error(error?.message || 'Unable to delete job.');
      } finally {
        setIsDeleting(false);
      }
    },
    [closeJobModal, onCreatedCallback, queryClient]
  );

  const value = useMemo<JobModalControllerValue>(
    () => ({
      isOpen,
      initialValues,
      sourceContext,
      openJobModal,
      closeJobModal,
    }),
    [closeJobModal, initialValues, isOpen, openJobModal, sourceContext]
  );

  return (
    <JobModalControllerContext.Provider value={value}>
      {children}
      <NewJobModal
        isOpen={isOpen}
        onClose={closeJobModal}
        onSave={handleSave}
        isSaving={isSaving}
        errorMessage={saveError}
        initialValues={initialValues}
        source={sourceContext}
        onFinishJob={handleFinishJob}
        isFinishingJob={isFinishingJob}
        onCreated={(job) => void handleCreated(job)}
        onCancel={handleCancel}
        onDelete={handleDelete}
        isDeleting={isDeleting}
      />
      <InvoicePreviewModal
        isOpen={isInvoicePreviewOpen}
        invoiceId={previewInvoiceId}
        onClose={() => setIsInvoicePreviewOpen(false)}
      />
    </JobModalControllerContext.Provider>
  );
}

const FALLBACK_VALUE: JobModalControllerValue = {
  isOpen: false,
  initialValues: null,
  sourceContext: null,
  openJobModal: () => {
    console.warn('[JobModalController] openJobModal called outside provider — ignored.');
  },
  closeJobModal: () => {},
};

export function useJobModalController() {
  const context = useContext(JobModalControllerContext);
  if (!context) {
    // Return a safe no-op fallback instead of throwing.
    // This prevents crashes during hot-reload or when a component
    // is briefly rendered outside the provider tree.
    return FALLBACK_VALUE;
  }
  return context;
}
