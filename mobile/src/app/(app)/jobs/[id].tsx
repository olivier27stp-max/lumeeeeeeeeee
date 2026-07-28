import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { StatusPill } from '@/components/ui/StatusPill';
import UnifiedAvatar from '@/components/ui/UnifiedAvatar';
import { JobPhotoGrid } from '@/components/JobPhotoGrid';
import { SpecificNotesCard } from '@/components/SpecificNotesCard';
import { CustomFieldsCard } from '@/components/CustomFieldsCard';
import { JobMaterialsCard } from '@/components/JobMaterialsCard';
import { JobVisitsCard } from '@/components/JobVisitsCard';
import { JobBillingCard } from '@/components/JobBillingCard';
import { SignaturePad } from '@/components/SignaturePad';
import { deleteJob, getJob, listJobLineItems, reopenJob, updateJob } from '@/lib/api/jobs';
import { finishJobAndPrepareInvoice } from '@/lib/api/billing';
import { getJobTime, startJobTimer, stopJobTimer } from '@/lib/api/jobTime';
import { getActiveTimesheet, punchIn } from '@/lib/api/timesheets';
import { listTeams } from '@/lib/api/org';
import { getClient } from '@/lib/api/clients';
import { MK } from '@/lib/offline/mutationKeys';
import { uploadJobSignature } from '@/lib/api/jobPhotos';
import { findOrCreateConversation } from '@/lib/api/messaging';
import { sendSmsViaServer } from '@/lib/api/server';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callNumber, etaSentence, onMyWayGreeting, packTemplate, promptCall, unpackTemplate } from '@/lib/contact';
import { clientFullName, formatCurrencyCents, formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';
import { useTranslation } from '@/lib/i18n';

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

export default function JobDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const [showSignature, setShowSignature] = useState(false);
  const [savingSig, setSavingSig] = useState(false);
  // "On my way" composer: pick an ETA (5/15/30/60 min) + edit the message. The
  // edited greeting is saved (per user) so it's reused every time; only the
  // minutes change per send.
  const [showOnMyWay, setShowOnMyWay] = useState(false);
  const [etaMin, setEtaMin] = useState<number>(15);
  const [omwText, setOmwText] = useState('');
  const [savedTemplate, setSavedTemplate] = useState<string | null>(null);
  const { session } = useAuth();
  const { current } = useMembership();
  const { t, language } = useTranslation();
  const { teamId, scope, permissions, role, canSeePricing, orgId, can } = usePermissions();
  const access = { teamId, scope, permissions, role };
  const isManager = role === 'owner' || role === 'admin';

  const { data: teams } = useQuery({
    queryKey: ['teams', orgId],
    queryFn: () => listTeams(orgId ?? ''),
    enabled: !!orgId && isManager,
  });
  const assignTeamMut = useMutation({
    mutationFn: (newTeamId: string) => updateJob(String(id), { team_id: newTeamId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e: Error) => Alert.alert(t.mobileJobs.assignment, e.message),
  });

  // Per-job timer (time spent on this specific job).
  const timerUserId = session?.user.id ?? '';
  const jobTimeQ = useQuery({
    queryKey: ['jobTime', id, timerUserId],
    queryFn: () => getJobTime(String(id), timerUserId),
    enabled: !!id,
    refetchInterval: 30000,
  });
  const jobTimerActive = !!jobTimeQ.data?.activeStartedAt;
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (!jobTimerActive) return;
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [jobTimerActive]);
  const jobElapsedSec =
    (jobTimeQ.data?.totalSeconds ?? 0) +
    (jobTimeQ.data?.activeStartedAt
      ? Math.max(0, Math.floor((tick - new Date(jobTimeQ.data.activeStartedAt).getTime()) / 1000))
      : 0);
  const startTimerMut = useMutation({
    mutationFn: async () => {
      await startJobTimer(orgId ?? '', String(id), timerUserId);
      // Auto punch-in for the shift clock if not already clocked in — so starting
      // a job's time always counts toward the timesheet. If already punched in
      // (here or elsewhere), do nothing: no double entry, no conflict.
      const active = await getActiveTimesheet(timerUserId).catch(() => null);
      if (!active) {
        await punchIn({
          orgId: orgId ?? '',
          employeeId: timerUserId,
          employeeName: current?.fullName ?? null,
          jobId: String(id),
          teamId: job?.team_id ?? null,
        }).catch(() => {
          /* 23505 = already punched in elsewhere → ignore */
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobTime', id] });
      // Refresh the shift-clock state (Time tab, live-tracking, today's entries).
      qc.invalidateQueries({ queryKey: ['live-tracking-clock'] });
      qc.invalidateQueries({ queryKey: ['timesheet'] });
      qc.invalidateQueries({ queryKey: ['timeEntries'] });
    },
    onError: (e: Error) => Alert.alert(t.mobileJobs.timer, e.message),
  });
  const stopTimerMut = useMutation({
    mutationFn: () => stopJobTimer(String(id), timerUserId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobTime', id] }),
    onError: (e: Error) => Alert.alert(t.mobileJobs.timer, e.message),
  });

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['jobs', id, role],
    queryFn: () => getJob(String(id), access),
    enabled: !!id,
  });

  const { data: client } = useQuery({
    queryKey: ['clients', job?.client_id],
    queryFn: () => getClient(String(job?.client_id)),
    enabled: !!job?.client_id,
  });

  const { data: lineItems } = useQuery({
    queryKey: ['jobs', id, 'lineItems'],
    queryFn: () => listJobLineItems(String(id)),
    enabled: !!id,
  });

  const phone = client?.phone ?? null;

  // Messages go out in the device's language (fr/en) — mirrors the user's choice.
  const lang = language; // langue des réglages de l'app, pas celle du téléphone
  const omwKey = `lume_omw_tmpl_${session?.user.id ?? ''}`;

  // Load the user's saved greeting (if any) so it's reused every time.
  useEffect(() => {
    AsyncStorage.getItem(omwKey).then((v) => {
      if (v) setSavedTemplate(v);
    });
  }, [omwKey]);

  // The greeting to prefill: saved custom one (with the LIVE company name swapped
  // in), else the default. This way renaming the company updates the message.
  const defaultGreeting = () =>
    unpackTemplate(savedTemplate, current?.companyName, lang) ?? onMyWayGreeting(current?.companyName, lang);

  // Open the "on my way" composer prefilled with a 15-min ETA. Only the greeting
  // is editable here; the ETA sentence is appended automatically on send.
  const openOnMyWay = () => {
    setEtaMin(15);
    setOmwText(defaultGreeting());
    setShowOnMyWay(true);
  };

  // ETA chips only change the minutes — they never touch the edited greeting.
  const pickEta = (m: number) => setEtaMin(m);

  // Always send through Lume/Twilio (NEVER the native composer): persist the
  // edited greeting for next time, append the chosen ETA, fire on the org's
  // number, then open the in-app thread. A real failure surfaces an alert.
  const handleOnMyWay = async () => {
    if (!phone || !orgId) return;
    const greeting = omwText.trim() || onMyWayGreeting(current?.companyName, lang);
    // Persist text + the company name in effect, so a later rename is reflected.
    const tmpl = packTemplate(greeting, current?.companyName);
    setSavedTemplate(tmpl);
    AsyncStorage.setItem(omwKey, tmpl).catch(() => {});
    const body = greeting + etaSentence(etaMin, lang);
    setShowOnMyWay(false);
    try {
      await sendSmsViaServer({ phone, text: body, clientId: job?.client_id ?? null, clientName: job?.client_name ?? null });
      const cid = await findOrCreateConversation({
        orgId,
        phone,
        clientId: job?.client_id ?? null,
        clientName: job?.client_name ?? null,
      });
      router.push(
        `/(app)/conversation/${cid}?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(job?.client_name ?? '')}&clientId=${encodeURIComponent(job?.client_id ?? '')}` as any,
      );
    } catch (e) {
      Alert.alert(t.mobileJobs.onTheWay, (e as Error).message);
    }
  };

  // "Text" — open the in-app Lume conversation thread (sends via Twilio server).
  const openThread = async () => {
    if (!phone || !orgId) return;
    try {
      const cid = await findOrCreateConversation({
        orgId,
        phone,
        clientId: job?.client_id ?? null,
        clientName: job?.client_name ?? null,
      });
      router.push(
        `/(app)/conversation/${cid}?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(job?.client_name ?? '')}&clientId=${encodeURIComponent(job?.client_id ?? '')}` as any,
      );
    } catch (e) {
      Alert.alert(t.mobileJobs.message, (e as Error).message);
    }
  };

  const saveSignature = async (base64Png: string) => {
    if (!orgId || !job) return;
    setSavingSig(true);
    try {
      await uploadJobSignature({ jobId: job.id, orgId, base64Png, userId: session?.user.id });
      qc.invalidateQueries({ queryKey: ['jobs', id] });
      setShowSignature(false);
      // Signature captured → finalize the job. Payment stays a separate step
      // (the Billing card / "Send invoice"), never bundled with this pop-up.
      completeMut.mutate({ id: String(id), notes });
    } catch (e) {
      Alert.alert(t.mobileJobs.signature, (e as Error).message);
    } finally {
      setSavingSig(false);
    }
  };

  // "Mark complete" flow: capture the client's signature in its own pop-up first
  // (unless already signed or the user can't edit), then complete in saveSignature.
  const handleComplete = () => {
    if (can('jobs.update') && !hasSignature) {
      setShowSignature(true);
    } else {
      completeMut.mutate({ id: String(id), notes });
    }
  };

  // These use shared mutation keys (see registerMutationDefaults) so they pause
  // and queue when offline, then resume automatically when back online.
  const startMut = useMutation<unknown, Error, { id: string }>({
    mutationKey: MK.jobStart,
    onError: (e: Error) => Alert.alert(t.mobileJobs.couldNotStartJob, e.message),
  });

  const completeMut = useMutation<unknown, Error, { id: string; notes?: string }>({
    mutationKey: MK.jobComplete,
    onSuccess: async () => {
      // Same flow as desktop (JobModalController.handleFinishJob): completing the
      // job auto-prepares the invoice draft via the finish_job_and_prepare_invoice
      // RPC, then opens it directly — no "do you want to invoice?" prompt. Only for
      // users who can invoice / see prices; technicians just see "done".
      if (!(can('invoices.create') || canSeePricing)) {
        Alert.alert(t.mobileJobs.jobCompleted, t.mobileJobs.niceWork, [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }
      try {
        const { invoiceId } = await finishJobAndPrepareInvoice({ orgId, jobId: String(id) });
        qc.invalidateQueries({ queryKey: ['invoices'] });
        qc.invalidateQueries({ queryKey: ['billing', 'invoices', String(id)] });
        router.replace(`/(app)/invoices/send?id=${invoiceId}` as any);
      } catch (e) {
        // Job is completed regardless; surface why the invoice couldn't be prepared.
        Alert.alert(t.mobileJobs.jobCompleted, t.mobileJobs.invoiceNotPrepared.replace('{message}', (e as Error).message), [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    },
    onError: (e: Error) => Alert.alert(t.mobileJobs.couldNotCompleteJob, e.message),
  });

  // Delete the job (confirm first), then leave the screen.
  const deleteMut = useMutation({
    mutationFn: () => deleteJob(String(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      router.back();
    },
    onError: (e: Error) => Alert.alert(t.mobileJobs.deleteAlt, e.message),
  });
  const confirmDelete = () => {
    Alert.alert(t.mobileJobs.deleteJobTitle, t.mobileJobs.deleteJobConfirm, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.common.delete, style: 'destructive', onPress: () => deleteMut.mutate() },
    ]);
  };

  // Re-open a completed job (undo the completion) so it can be edited/re-finished.
  const reopenMut = useMutation({
    mutationFn: () => reopenJob(String(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e: Error) => Alert.alert(t.mobileJobs.reopenJobAlt, e.message),
  });
  const confirmReopen = () => {
    Alert.alert(t.mobileJobs.reopenJobAlt, t.mobileJobs.reopenJobConfirm, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.mobileJobs.reopen, onPress: () => reopenMut.mutate() },
    ]);
  };

  // Editable description (saves on blur).
  const [desc, setDesc] = useState('');
  useEffect(() => {
    if (job) setDesc(job.description ?? '');
  }, [job?.id]);
  const saveDescMut = useMutation({
    mutationFn: () => updateJob(String(id), { description: desc.trim() || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs', id] }),
    onError: (e: Error) => Alert.alert(t.mobileJobs.description, e.message),
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt">
        <Text className="text-ink-muted">{t.mobileJobs.loading}</Text>
      </View>
    );
  }

  if (error || !job) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-alt p-6">
        <Text className="text-ink-muted text-center">
          {error ? (error as Error).message : t.mobileJobs.jobNotFound}
        </Text>
      </View>
    );
  }

  const when = job.scheduled_at ?? job.start_at ?? null;
  const clientAddress = client
    ? [client.address, client.city, client.province, client.postal_code].filter(Boolean).join(', ')
    : '';
  // The job's service address, falling back to the client's address when the job
  // has no distinct one — so it's never blank or mismatched with the client.
  const address = job.property_address || clientAddress || null;
  const isDone = job.status === 'completed';
  const isActive = job.status === 'in_progress';
  const hasSignature = (job.attachments ?? []).some((a) => a.kind === 'signature');

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt">
      <View className="p-5 gap-4">
        <View className="gap-2">
          <View className="flex-row items-start justify-between">
            <Text className="text-xs text-ink-muted">#{job.job_number}</Text>
            {can('jobs.update') ? (
              <Pressable onPress={() => router.push(`/(app)/jobs/edit?id=${job.id}`)}>
                <Text className="text-sm font-medium text-brand">{t.mobileJobs.edit}</Text>
              </Pressable>
            ) : null}
          </View>
          <Text className="text-2xl font-bold text-ink">{job.title}</Text>
          <StatusPill status={job.status} />
        </View>

        {/* Hero card: the client first — tap to open, one-tap call/text — plus the
            contract total and the appointment, all in the first thing you see. */}
        <Card className="gap-3">
          {client ? (
            <Pressable
              onPress={() => router.push(`/(app)/clients/${client.id}`)}
              className="flex-row items-center gap-3"
            >
              <UnifiedAvatar id={client.id} name={clientFullName(client)} size={48} />
              <View className="flex-1">
                <Text className="text-lg font-bold text-ink">{clientFullName(client)}</Text>
                {client.company ? <Text className="text-sm text-ink-muted">{client.company}</Text> : null}
                {client.phone ? <Text className="text-sm text-ink-muted">{client.phone}</Text> : null}
              </View>
              {can('clients.update') ? (
                <Pressable hitSlop={8} onPress={() => router.push(`/(app)/clients/edit?id=${client.id}`)}>
                  <Text className="text-sm font-medium text-brand">{t.mobileJobs.edit}</Text>
                </Pressable>
              ) : null}
            </Pressable>
          ) : job.client_name ? (
            <View>
              <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.client}</Text>
              <Text className="text-lg font-bold text-ink">{job.client_name}</Text>
            </View>
          ) : null}

          {/* Quick call / text shortcuts */}
          {phone ? (
            <View className="flex-row gap-2">
              <View className="flex-1"><Button title={t.mobileJobs.call} onPress={() => callNumber(phone)} /></View>
              <View className="flex-1"><Button title={t.mobileJobs.text} variant="secondary" onPress={openThread} /></View>
            </View>
          ) : null}
          {phone && !isDone ? (
            <Button title={t.mobileJobs.onTheWayBtn} variant="secondary" onPress={openOnMyWay} />
          ) : null}
          {client?.email ? (
            <Pressable onPress={() => Linking.openURL(`mailto:${client.email}`)}>
              <Text className="text-sm text-brand underline">{client.email}</Text>
            </Pressable>
          ) : null}

          {/* Appointment + contract total */}
          <View className="flex-row items-end justify-between border-t border-surface-border pt-3">
            <View className="flex-1 pr-3">
              <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.appointment}</Text>
              <Text className="text-sm text-ink">{formatDateTime(when)}</Text>
            </View>
            {canSeePricing ? (
              <View className="items-end">
                <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.contractTotal}</Text>
                <Text className="text-xl font-bold text-ink">{formatCurrencyCents(job.total_cents, job.currency)}</Text>
              </View>
            ) : null}
          </View>

          {/* Job location (separate from the client's address) */}
          {address ? (
            <Pressable onPress={() => Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(address)}`)}>
              <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.jobAddress}</Text>
              <Text className="text-sm text-brand underline">{address}</Text>
            </Pressable>
          ) : null}
        </Card>

        {/* Détails du job — type, schedule window. */}
        <Card className="gap-3">
          <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.jobDetails}</Text>
          <View className="flex-row items-center justify-between">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.type}</Text>
            <Text className="text-sm text-ink">{job.job_type || t.mobileJobs.oneOff}</Text>
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.start_}</Text>
            <Text className="text-sm text-ink">{formatDateTime(when)}</Text>
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.end}</Text>
            <Text className="text-sm text-ink">{job.end_at ? formatDateTime(job.end_at) : '—'}</Text>
          </View>
        </Card>

        {/* Client's address, when it differs from the job location above. */}
        {client && clientAddress && clientAddress !== address ? (
          <Card>
            <Pressable
              onPress={() =>
                Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(clientAddress)}`)
              }
            >
              <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
                {t.mobileJobs.clientAddress}
              </Text>
              <Text className="text-base text-brand underline">{clientAddress}</Text>
            </Pressable>
          </Card>
        ) : null}

        {/* Quick team assignment (owner/admin) */}
        {isManager && (teams?.length ?? 0) > 0 ? (
          <Card className="gap-2">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.assignedTeam}</Text>
            <View className="flex-row flex-wrap gap-2">
              {(teams ?? []).map((t) => {
                const sel = job.team_id === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => assignTeamMut.mutate(t.id)}
                    disabled={assignTeamMut.isPending}
                    className={`flex-row items-center gap-1.5 rounded-full border px-3.5 py-1.5 ${sel ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
                  >
                    {t.color_hex ? (
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color_hex }} />
                    ) : null}
                    <Text className={`text-xs font-semibold ${sel ? 'text-white' : 'text-ink'}`}>{t.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ) : null}

        {/* Per-job timer */}
        {can('jobs.update') ? (
          <Card className="gap-2">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.timeOnThisJob}</Text>
            <View className="flex-row items-center justify-between">
              <Text className="text-2xl font-bold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
                {fmtDur(jobElapsedSec)}
              </Text>
              {jobTimerActive ? (
                <Button title={t.mobileJobs.stop} variant="danger" onPress={() => stopTimerMut.mutate()} loading={stopTimerMut.isPending} />
              ) : (
                <Button title={t.mobileJobs.start} onPress={() => startTimerMut.mutate()} loading={startTimerMut.isPending} />
              )}
            </View>
            {jobTimerActive ? <Text className="text-xs font-medium text-status-completed">{t.mobileJobs.inProgress}</Text> : null}
          </Card>
        ) : null}

        {/* Services — what the tech will actually do, with prices (behind pricing access). */}
        {lineItems && lineItems.length > 0 ? (
          <Card className="gap-2">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{t.mobileJobs.services}</Text>
            {lineItems.map((li) => (
              <View key={li.id} className="flex-row items-center justify-between border-t border-surface-border pt-2.5">
                <Text className="flex-1 pr-3 text-base text-ink">
                  {li.qty > 1 ? `${li.qty}× ` : ''}
                  {li.name}
                </Text>
                {canSeePricing ? (
                  <Text className="text-base font-medium text-ink">
                    {formatCurrencyCents(li.total_cents, job.currency)}
                  </Text>
                ) : null}
              </View>
            ))}
            {canSeePricing ? (
              <View className="flex-row items-center justify-between border-t border-surface-border pt-2.5">
                <Text className="text-base font-semibold text-ink">{t.mobileJobs.total}</Text>
                <Text className="text-base font-bold text-ink">
                  {formatCurrencyCents(job.total_cents, job.currency)}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {orgId ? (
          <JobVisitsCard jobId={job.id} orgId={orgId} teamId={job.team_id} canEdit={can('jobs.update')} />
        ) : null}

        {canSeePricing && orgId ? (
          <JobBillingCard
            jobId={job.id}
            orgId={orgId}
            currency={job.currency}
            userId={session?.user.id}
            clientId={job.client_id}
            clientName={job.client_name}
            clientPhone={phone}
          />
        ) : null}

        {orgId ? <SpecificNotesCard jobId={job.id} orgId={orgId} /> : null}

        {orgId ? <JobMaterialsCard jobId={job.id} orgId={orgId} canSeePricing={canSeePricing} /> : null}

        {orgId ? <CustomFieldsCard orgId={orgId} entity="jobs" recordId={job.id} /> : null}

        {orgId ? (
          <Card>
            <JobPhotoGrid
              jobId={job.id}
              orgId={orgId}
              userId={session?.user.id}
              attachments={job.attachments ?? []}
              editable={can('jobs.update')}
              onChange={() => qc.invalidateQueries({ queryKey: ['jobs', id] })}
            />
          </Card>
        ) : null}

        {!isDone ? (
          <View className="gap-3 pt-2">
            {!isActive ? (
              <Button
                title={t.mobileJobs.startJob}
                onPress={() => startMut.mutate({ id: String(id) })}
                loading={startMut.isPending}
              />
            ) : null}
            <Button
              title={t.mobileJobs.markComplete}
              variant={isActive ? 'primary' : 'secondary'}
              onPress={handleComplete}
              loading={completeMut.isPending || savingSig}
            />
            {can('jobs.update') ? (
              <Text className="text-center text-xs text-ink-muted">
                {hasSignature
                  ? t.mobileJobs.signatureCaptured
                  : t.mobileJobs.signatureWillBeRequested}
              </Text>
            ) : null}
          </View>
        ) : (
          <Card className="bg-emerald-50 border-emerald-200 gap-2">
            <Text className="text-emerald-700 font-semibold">
              {t.mobileJobs.completedAt.replace('{date}', formatDateTime(job.completed_at))}
            </Text>
            {hasSignature ? (
              <Text className="text-emerald-700 text-sm">{t.mobileJobs.signedByClient}</Text>
            ) : null}
            {can('jobs.update') ? (
              <Button title={t.mobileJobs.reopenJob} variant="secondary" onPress={confirmReopen} loading={reopenMut.isPending} />
            ) : null}
          </Card>
        )}

        {can('jobs.delete') ? (
          <Button
            title={t.mobileJobs.deleteJob}
            variant="danger"
            onPress={confirmDelete}
            loading={deleteMut.isPending}
          />
        ) : null}
      </View>

      {/* "On my way" composer — pick an ETA, tweak the text, send via Twilio.
          KeyboardAvoidingView lifts the sheet above the keyboard; the message is a
          tall, internally-scrollable field so the full text is always reachable. */}
      <Modal visible={showOnMyWay} transparent animationType="fade" onRequestClose={() => setShowOnMyWay(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end bg-black/40"
        >
          <Pressable className="absolute inset-0" onPress={() => Keyboard.dismiss()} />
          <View className="rounded-t-3xl bg-white p-5 gap-4" style={{ paddingBottom: 28 }}>
            <Text className="text-lg font-bold text-ink">{t.mobileJobs.onTheWayBtn}</Text>

            <View className="gap-1.5">
              <Text className="text-xs uppercase text-ink-muted">{t.mobileJobs.arriveIn}</Text>
              <View className="flex-row gap-2">
                {[5, 15, 30, 60].map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => pickEta(m)}
                    className={`flex-1 items-center rounded-xl py-2.5 ${etaMin === m ? 'bg-ink' : 'bg-surface-sunken'}`}
                  >
                    <Text className={`text-sm font-semibold ${etaMin === m ? 'text-white' : 'text-ink-muted'}`}>
                      {t.mobileJobs.minutes.replace('{n}', String(m))}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View className="gap-1.5">
              <Text className="text-xs uppercase text-ink-muted">{t.mobileJobs.message}</Text>
              <TextInput
                value={omwText}
                onChangeText={setOmwText}
                multiline
                scrollEnabled
                textAlignVertical="top"
                placeholderTextColor="#A3A3A3"
                style={{
                  height: 170,
                  borderWidth: 1,
                  borderColor: '#E5E5E5',
                  borderRadius: 12,
                  backgroundColor: '#F5F5F5',
                  paddingHorizontal: 14,
                  paddingTop: 12,
                  paddingBottom: 12,
                  fontSize: 16,
                  lineHeight: 22,
                  color: '#171717',
                }}
              />
              <Text className="text-xs italic text-ink-subtle">
                {t.mobileJobs.addedAutomatically.replace('{sentence}', etaSentence(etaMin, lang).trim())}
              </Text>
            </View>

            <View className="flex-row gap-2 pt-1">
              <View className="flex-1">
                <Button title={t.common.cancel} variant="secondary" onPress={() => setShowOnMyWay(false)} />
              </View>
              <View className="flex-1">
                <Button title={t.mobileJobs.send} onPress={handleOnMyWay} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <SignaturePad
        visible={showSignature}
        onClose={() => setShowSignature(false)}
        onSave={saveSignature}
      />
    </ScrollView>
  );
}
