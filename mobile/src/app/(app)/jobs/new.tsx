import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { ClientPicker, PickedClient } from '@/components/ClientPicker';
import { LineItemsEditor } from '@/components/LineItemsEditor';
import { MiniWeekCalendar, sameDay } from '@/components/MiniWeekCalendar';
import { createJob, listJobsInRange } from '@/lib/api/jobs';
import { getClient } from '@/lib/api/clients';
import { listTeams } from '@/lib/api/org';
import { findOrCreateConversation } from '@/lib/api/messaging';
import { sendSmsViaServer } from '@/lib/api/server';
import { LineItemInput } from '@/lib/api/billing';
import { resolveTaxes } from '@/lib/api/taxes';
import { bookingNiceMessage, packTemplate, unpackTemplate } from '@/lib/contact';
import { formatCurrencyCents, formatDateTime, formatTime } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useMembership } from '@/lib/membership-context';
import { usePermissions } from '@/lib/usePermissions';
import { useTranslation } from '@/lib/i18n';

const DEFAULT_TAX = '14.975';

function SectionLabel({ children }: { children: string }) {
  return <Text className="px-1 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{children}</Text>;
}

export default function NewJob() {
  const qc = useQueryClient();
  const { orgId, teamId, scope, permissions, role, canCreateJobs, canSeePricing } = usePermissions();
  const { session } = useAuth();
  const { current } = useMembership();
  const { t, language } = useTranslation();
  const isManager = role === 'owner' || role === 'admin';


  // Booking-confirmation popup (after Save): send the client the appointment
  // details (time / amount / address) + an editable, persisted nice message.
  const lang = language; // langue des réglages de l'app, pas celle du téléphone
  const bookingKey = `lume_booking_tmpl_${session?.user.id ?? ''}`;
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [bookingNice, setBookingNice] = useState('');
  const [sendingBooking, setSendingBooking] = useState(false);

  // Owner/admin can assign the job to any team; others default to their own.
  const [assignedTeam, setAssignedTeam] = useState<string | null>(teamId ?? null);
  const { data: teams } = useQuery({
    queryKey: ['teams', orgId],
    queryFn: () => listTeams(orgId ?? ''),
    enabled: !!orgId && isManager,
  });

  // Prefill from a D2D pin "close" (address) or other deep-links.
  const prefill = useLocalSearchParams<{
    address?: string; title?: string;
    clientId?: string; clientName?: string; clientPhone?: string; clientEmail?: string; note?: string;
  }>();
  const [title, setTitle] = useState(typeof prefill.title === 'string' ? prefill.title : '');
  // D2D flow: a pin with a linked client arrives pre-selected; otherwise its
  // customer info pre-fills the "new client" form (web pinToJobDraft behavior).
  const [client, setClient] = useState<PickedClient | null>(
    typeof prefill.clientId === 'string' && prefill.clientId
      ? { id: prefill.clientId, name: typeof prefill.clientName === 'string' && prefill.clientName ? prefill.clientName : 'Client' }
      : null,
  );
  const [address, setAddress] = useState(typeof prefill.address === 'string' ? prefill.address : '');
  const [description, setDescription] = useState(typeof prefill.note === 'string' ? prefill.note : '');
  const [jobType, setJobType] = useState<'one_off' | 'recurring'>('one_off');
  // Plan de service, même principe que le web : la règle (répétition + durée)
  // génère les vrais rendez-vous, tous aux heures choisies plus bas.
  const [repeatMode, setRepeatMode] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [endsAfterCount, setEndsAfterCount] = useState('12');
  const [endsAfterUnit, setEndsAfterUnit] = useState<'weeks' | 'months' | 'years'>('months');
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });
  const [items, setItems] = useState<LineItemInput[]>([]);
  const [taxRate, setTaxRate] = useState(DEFAULT_TAX);

  // Taxes configured on the desktop (Settings → Taxes), resolved for this
  // client. This screen used to keep the hardcoded Quebec rate, so every job
  // created on mobile from another province was taxed wrong.
  const { data: orgTax } = useQuery({
    queryKey: ['org-tax', orgId, client?.id ?? null],
    queryFn: () => resolveTaxes(String(orgId), client?.id ?? null),
    enabled: !!orgId,
  });
  useEffect(() => {
    if (orgTax) setTaxRate(String(orgTax.totalRatePct));
  }, [orgTax]);

  // When a client is chosen, prefill the job's service address from their address
  // (only when the user hasn't typed one yet) so the job and client stay connected.
  const { data: pickedClientFull } = useQuery({
    queryKey: ['clients', client?.id],
    queryFn: () => getClient(String(client?.id)),
    enabled: !!client?.id,
  });
  useEffect(() => {
    if (!pickedClientFull || address.trim()) return;
    const addr = [
      pickedClientFull.address,
      pickedClientFull.city,
      pickedClientFull.province,
      pickedClientFull.postal_code,
    ]
      .filter(Boolean)
      .join(', ');
    if (addr) setAddress(addr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedClientFull]);

  // Libellés de répétition calés sur la date de début, comme le web
  // (« Chaque semaine le mardi », « Chaque mois le 5 »).
  const repeatLabels = useMemo(() => {
    const loc = language === 'fr' ? 'fr-CA' : 'en-CA';
    const jour = startDate.toLocaleDateString(loc, { weekday: 'long' });
    const quantieme =
      language === 'fr' && startDate.getDate() === 1 ? '1er' : String(startDate.getDate());
    return {
      weekly: t.mobilePlan.weekly.replace('{day}', jour),
      biweekly: t.mobilePlan.biweekly.replace('{day}', jour),
      monthly: t.mobilePlan.monthly.replace('{day}', quantieme),
    };
  }, [startDate, language, t]);

  // Les dates du plan, générées depuis la règle — portage direct de la logique
  // du web (NewJobModal) : mensuel garde le même quantième borné à la longueur
  // du mois, hebdo/bimensuel avancent d'un pas fixe. Comme sur le web, changer
  // la règle REMPLACE la sélection; entre deux changements l'utilisateur peut
  // retirer des dates à la main.
  const [planDates, setPlanDates] = useState<string[]>([]);
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (jobType !== 'recurring') return;
    const count = parseInt(endsAfterCount, 10);
    if (!Number.isFinite(count) || count <= 0) { setPlanDates([]); return; }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (endsAfterUnit === 'weeks') end.setDate(end.getDate() + count * 7);
    else if (endsAfterUnit === 'months') end.setMonth(end.getMonth() + count);
    else end.setFullYear(end.getFullYear() + count);

    const jours: string[] = [];
    if (repeatMode === 'monthly') {
      const y0 = start.getFullYear();
      const m0 = start.getMonth();
      const d0 = startDate.getDate();
      for (let i = 0; jours.length < 366; i++) {
        const y = y0 + Math.floor((m0 + i) / 12);
        const m = (m0 + i) % 12;
        const dernier = new Date(y, m + 1, 0).getDate();
        const d = new Date(y, m, Math.min(d0, dernier));
        if (d > end) break;
        jours.push(ymd(d));
      }
    } else {
      const pas = repeatMode === 'weekly' ? 7 : 14;
      for (const d = new Date(start); d <= end && jours.length < 366; d.setDate(d.getDate() + pas)) {
        jours.push(ymd(d));
      }
    }
    setPlanDates(jours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobType, repeatMode, endsAfterCount, endsAfterUnit, startDate]);

  // Les rendez-vous eux-mêmes : toutes les dates retenues, aux heures de la règle.
  const planVisits = useMemo(() => {
    if (jobType !== 'recurring') return [];
    const dureeMs = Math.max(endDate.getTime() - startDate.getTime(), 0);
    return planDates.map((j) => {
      const [y, m, d] = j.split('-').map(Number);
      const debut = new Date(y, m - 1, d, startDate.getHours(), startDate.getMinutes(), 0, 0);
      return { startISO: debut.toISOString(), endISO: new Date(debut.getTime() + dureeMs).toISOString() };
    });
  }, [jobType, planDates, startDate, endDate]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + Math.round(i.qty * i.unit_price_cents), 0);
    const tax = Math.round((subtotal * (parseFloat(taxRate) || 0)) / 100);
    return { subtotal, tax, total: subtotal + tax };
  }, [items, taxRate]);

  // Existing jobs around now → availability dots + the selected day's bookings.
  const calRange = useMemo(() => {
    const s = new Date(); s.setDate(s.getDate() - 7); s.setHours(0, 0, 0, 0);
    const e = new Date(); e.setDate(e.getDate() + 28); e.setHours(23, 59, 59, 0);
    return { s: s.toISOString(), e: e.toISOString() };
  }, []);
  const { data: calJobs } = useQuery({
    queryKey: ['jobs', 'cal', orgId, role, teamId],
    queryFn: () => listJobsInRange(calRange.s, calRange.e, { teamId, scope, permissions, role }),
    enabled: !!orgId,
  });
  const countForDay = (d: Date) =>
    (calJobs ?? []).filter((j) => j.scheduled_at && sameDay(new Date(j.scheduled_at), d)).length;
  const dayJobs = useMemo(
    () =>
      (calJobs ?? [])
        .filter((j) => j.scheduled_at && sameDay(new Date(j.scheduled_at), startDate))
        .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '')),
    [calJobs, startDate],
  );
  // Pick a day from the calendar → keep the chosen start/end times.
  const pickDay = (d: Date) => {
    setStartDate((prev) => { const n = new Date(d); n.setHours(prev.getHours(), prev.getMinutes(), 0, 0); return n; });
    setEndDate((prev) => { const n = new Date(d); n.setHours(prev.getHours(), prev.getMinutes(), 0, 0); return n; });
  };
  const setTimeOn = (base: Date, t: Date) => {
    const n = new Date(base);
    n.setHours(t.getHours(), t.getMinutes(), 0, 0);
    return n;
  };

  const saveMut = useMutation({
    mutationFn: () => {
      return createJob(orgId ?? '', {
        title: title.trim(),
        client_id: client?.id ?? null,
        client_name: client?.name ?? null,
        property_address: address.trim(),
        description: description.trim() || null,
        team_id: isManager ? assignedTeam : teamId ?? null,
        job_type: jobType,
        requires_invoicing: true,
        scheduled_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        items: canSeePricing ? items : [],
        taxRatePct: parseFloat(taxRate) || 0,
        // Le plan matérialise ses rendez-vous : pas de règle de récurrence en
        // parallèle, elle en générerait des doublons.
        planVisits: jobType === 'recurring' && planVisits.length > 0 ? planVisits : null,
      });
    },
    onSuccess: async (job) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      // Open the booking-confirmation popup instead of navigating right away.
      setCreatedJobId(job.id);
      const saved = await AsyncStorage.getItem(bookingKey).catch(() => null);
      setBookingNice(
        unpackTemplate(saved, current?.companyName, lang, client?.name ?? '') ??
          bookingNiceMessage(current?.companyName, client?.name ?? null, lang),
      );
      setShowBooking(true);
    },
    onError: (e: Error) => Alert.alert(t.mobileJobs.couldNotCreateJob, e.message),
  });

  // The auto-filled appointment details appended under the nice message.
  const bookingDetails = () => {
    const lines: string[] = [`📅 ${formatDateTime(startDate.toISOString(), lang === 'fr' ? 'fr-CA' : 'en-CA')}`];
    if (address.trim()) lines.push(`📍 ${address.trim()}`);
    if (canSeePricing && totals.total > 0) lines.push(`💵 ${formatCurrencyCents(totals.total, 'CAD')}`);
    return lines.join('\n');
  };

  // Go to the new job's detail page (after sending or skipping the confirmation).
  const goToJob = () => {
    setShowBooking(false);
    if (createdJobId) router.replace(`/(app)/jobs/${createdJobId}`);
  };

  // Send the booking confirmation to the client via Twilio (in-app thread).
  const sendBooking = async () => {
    if (!orgId || !client?.id) {
      Alert.alert(t.mobileJobs.confirmation, t.mobileJobs.noClientAttached);
      return;
    }
    setSendingBooking(true);
    try {
      const full = await getClient(client.id);
      const phone = full?.phone ?? null;
      if (!phone) {
        Alert.alert(t.mobileJobs.confirmation, t.mobileJobs.clientNoPhone);
        setSendingBooking(false);
        return;
      }
      const body = `${bookingNice.trim()}\n\n${bookingDetails()}`;
      await sendSmsViaServer({ phone, text: body, clientId: client.id, clientName: client.name });
      // Persist the edited nice message for next time.
      AsyncStorage.setItem(bookingKey, packTemplate(bookingNice.trim(), current?.companyName, client.name ?? '')).catch(() => {});
      const cid = await findOrCreateConversation({ orgId, phone, clientId: client.id, clientName: client.name });
      setShowBooking(false);
      router.replace(
        `/(app)/conversation/${cid}?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(client.name)}&clientId=${encodeURIComponent(client.id)}` as any,
      );
    } catch (e) {
      Alert.alert(t.mobileJobs.confirmation, (e as Error).message);
    } finally {
      setSendingBooking(false);
    }
  };

  if (!canCreateJobs) return <Redirect href="/(app)/(tabs)" />;

  return (
    <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Input label={t.mobileJobs.jobTitle} value={title} onChangeText={setTitle} placeholder={t.mobileJobs.jobTitlePlaceholder} />

      <View className="gap-2">
        <SectionLabel>{t.mobileJobs.client}</SectionLabel>
        <ClientPicker
          value={client}
          onChange={setClient}
          initialForm={{
            name: typeof prefill.clientName === 'string' ? prefill.clientName : undefined,
            phone: typeof prefill.clientPhone === 'string' ? prefill.clientPhone : undefined,
            email: typeof prefill.clientEmail === 'string' ? prefill.clientEmail : undefined,
          }}
        />
      </View>

      {/* Team assignment (owner/admin) */}
      {isManager && (teams?.length ?? 0) > 0 ? (
        <View className="gap-2">
          <SectionLabel>{t.mobileJobs.assignedTeam}</SectionLabel>
          <View className="flex-row flex-wrap gap-2">
            {(teams ?? []).map((t) => {
              const sel = assignedTeam === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setAssignedTeam(t.id)}
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
        </View>
      ) : null}

      <AddressAutocomplete label={t.mobileJobs.jobSiteAddress} value={address} onChangeText={setAddress} onSelect={(a) => setAddress(a.address)} />

      {/* Job type */}
      <View className="gap-2">
        <SectionLabel>{t.mobileJobs.jobType}</SectionLabel>
        <View className="flex-row rounded-2xl bg-surface-sunken p-1">
          {(['one_off', 'recurring'] as const).map((jt) => (
            <Pressable key={jt} onPress={() => setJobType(jt)} className={`flex-1 items-center rounded-xl py-2 ${jobType === jt ? 'bg-white' : ''}`}>
              <Text className={`text-sm font-semibold ${jobType === jt ? 'text-ink' : 'text-ink-muted'}`}>
                {jt === 'one_off' ? t.mobileJobs.oneOffTab : t.mobilePlan.tab}
              </Text>
            </Pressable>
          ))}
        </View>
        {jobType === 'recurring' ? (
          <View className="gap-2 pt-1">
            {/* Se répète — les libellés suivent la date de début, comme le web */}
            <Text className="px-1 text-[11px] font-semibold uppercase text-ink-subtle">
              {t.mobilePlan.repeats}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {(['weekly', 'biweekly', 'monthly'] as const).map((rm) => (
                <Pressable
                  key={rm}
                  onPress={() => setRepeatMode(rm)}
                  className={`rounded-full border px-3.5 py-1.5 ${repeatMode === rm ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
                >
                  <Text className={`text-xs font-semibold ${repeatMode === rm ? 'text-white' : 'text-ink'}`}>
                    {repeatLabels[rm]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Se termine après N semaines / mois / ans */}
            <Text className="px-1 pt-1 text-[11px] font-semibold uppercase text-ink-subtle">
              {t.mobilePlan.endsAfter}
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={endsAfterCount}
                onChangeText={(v) => setEndsAfterCount(v.replace(/[^0-9]/g, '').slice(0, 3))}
                keyboardType="number-pad"
                className="w-16 rounded-xl border border-surface-border bg-white px-3 py-2 text-center text-sm font-semibold text-ink"
              />
              {(['weeks', 'months', 'years'] as const).map((u) => (
                <Pressable
                  key={u}
                  onPress={() => setEndsAfterUnit(u)}
                  className={`rounded-full border px-3.5 py-1.5 ${endsAfterUnit === u ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
                >
                  <Text className={`text-xs font-semibold ${endsAfterUnit === u ? 'text-white' : 'text-ink'}`}>
                    {u === 'weeks' ? t.mobilePlan.unitWeeks : u === 'months' ? t.mobilePlan.unitMonths : t.mobilePlan.unitYears}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Les rendez-vous, un par un — comme le web, on les voit et on
                peut en retirer avant d'enregistrer. */}
            <View className="mt-1 rounded-xl border border-surface-border bg-surface-sunken px-4 py-3">
              {planDates.length === 0 ? (
                <Text className="text-xs text-ink-muted">{t.mobilePlan.none}</Text>
              ) : (
                <>
                  <Text className="text-sm font-bold text-ink">
                    {planDates.length === 1
                      ? t.mobilePlan.oneAppointment
                      : t.mobilePlan.appointments.replace('{count}', String(planDates.length))}
                  </Text>
                  <Text className="pt-0.5 text-xs text-ink-muted">
                    {formatTime(startDate.toISOString())} – {formatTime(endDate.toISOString())} ·{' '}
                    {t.mobilePlan.sameTimeHint}
                  </Text>
                  <View className="mt-2 gap-1">
                    {planDates.map((j) => {
                      const [y, m, d] = j.split('-').map(Number);
                      const dte = new Date(y, m - 1, d);
                      return (
                        <View
                          key={j}
                          className="flex-row items-center justify-between rounded-lg bg-white px-3 py-2"
                        >
                          <Text className="text-xs font-semibold text-ink">
                            {dte.toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
                              weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                            })}
                          </Text>
                          <Pressable
                            hitSlop={10}
                            onPress={() => setPlanDates((prev) => prev.filter((x) => x !== j))}
                          >
                            <Text className="px-1 text-sm font-bold text-ink-subtle">✕</Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          </View>
        ) : null}
      </View>

      {/* Date & time */}
      <View className="gap-2">
        <SectionLabel>{t.mobileJobs.dateAndTime}</SectionLabel>

        <MiniWeekCalendar selected={startDate} onSelect={pickDay} counts={countForDay} />

        {/* Selected day's bookings → see free slots */}
        <View className="rounded-2xl bg-white p-3">
          <Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            {startDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} ·{' '}
            {dayJobs.length === 0 ? t.mobileJobs.freeDay : t.mobileJobs.bookedCount.replace('{n}', String(dayJobs.length))}
          </Text>
          {dayJobs.length === 0 ? (
            <Text className="text-xs text-ink-subtle">{t.mobileJobs.noJobsFreeAgenda}</Text>
          ) : (
            dayJobs.map((j) => (
              <View key={j.id} className="flex-row justify-between border-t border-surface-border py-1.5">
                <Text className="text-sm text-ink" numberOfLines={1}>{j.client_name ?? j.title}</Text>
                <Text className="text-xs text-ink-muted">{formatTime(j.scheduled_at)}</Text>
              </View>
            ))
          )}
        </View>

        {/* Start / End time — compact pickers (tap, choose, auto-close) */}
        <View className="flex-row gap-3">
          <View className="flex-1 flex-row items-center justify-between rounded-xl border border-surface-border bg-surface-sunken px-4 py-2.5">
            <Text className="text-[11px] font-semibold uppercase text-ink-subtle">{t.mobileJobs.start_}</Text>
            <DateTimePicker
              value={startDate}
              mode="time"
              display="compact"
              themeVariant="light"
              accentColor="#171717"
              onChange={(_, d) => { if (d) setStartDate((prev) => setTimeOn(prev, d)); }}
            />
          </View>
          <View className="flex-1 flex-row items-center justify-between rounded-xl border border-surface-border bg-surface-sunken px-4 py-2.5">
            <Text className="text-[11px] font-semibold uppercase text-ink-subtle">{t.mobileJobs.end}</Text>
            <DateTimePicker
              value={endDate}
              mode="time"
              display="compact"
              themeVariant="light"
              accentColor="#171717"
              onChange={(_, d) => { if (d) setEndDate((prev) => setTimeOn(prev, d)); }}
            />
          </View>
        </View>
      </View>

      <Input
        label={t.mobileJobs.description}
        value={description}
        onChangeText={setDescription}
        placeholder={t.mobileJobs.descriptionPlaceholder}
        multiline
        numberOfLines={3}
        style={{ height: 80, textAlignVertical: 'top', paddingTop: 12 }}
      />

      {/* Pricing (admin) */}
      {canSeePricing ? (
        <>
          <LineItemsEditor onChange={setItems} />
          <Input label={t.mobileJobs.taxRate} value={taxRate} onChangeText={setTaxRate} keyboardType="decimal-pad" placeholder={DEFAULT_TAX} />
          <View className="gap-1 rounded-2xl bg-white p-4">
            <Row label={t.mobileJobs.subtotal} value={formatCurrencyCents(totals.subtotal, 'CAD')} />
            <Row label={t.mobileJobs.tax} value={formatCurrencyCents(totals.tax, 'CAD')} />
            <Row label={t.mobileJobs.total} value={formatCurrencyCents(totals.total, 'CAD')} bold />
          </View>
        </>
      ) : null}

      <Button title={t.mobileJobs.createJob} onPress={() => saveMut.mutate()} loading={saveMut.isPending} disabled={!title.trim() || !orgId} />

      {/* Booking confirmation — pops up after Save: send the client the details. */}
      <Modal visible={showBooking} transparent animationType="fade" onRequestClose={goToJob}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 justify-end bg-black/40"
        >
          <Pressable className="absolute inset-0" onPress={() => Keyboard.dismiss()} />
          <View className="rounded-t-3xl bg-white p-5 gap-4" style={{ paddingBottom: 28 }}>
            <View className="gap-0.5">
              <Text className="text-lg font-bold text-ink">{t.mobileJobs.sendBookingInfo}</Text>
              <Text className="text-xs text-ink-muted">{t.mobileJobs.confirmAppointmentByMessage}</Text>
            </View>

            <View className="gap-1.5">
              <Text className="text-xs uppercase text-ink-muted">{t.mobileJobs.message}</Text>
              <TextInput
                value={bookingNice}
                onChangeText={setBookingNice}
                multiline
                scrollEnabled
                textAlignVertical="top"
                placeholderTextColor="#A3A3A3"
                style={{
                  height: 120,
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
            </View>

            {/* Auto-filled appointment details preview */}
            <View className="gap-1 rounded-2xl bg-surface-sunken p-3">
              <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
                {t.mobileJobs.autoAddedDetails}
              </Text>
              <Text className="text-sm leading-5 text-ink">{bookingDetails()}</Text>
            </View>

            <View className="flex-row gap-2 pt-1">
              <View className="flex-1">
                <Button title={t.mobileJobs.skip} variant="secondary" onPress={goToJob} disabled={sendingBooking} />
              </View>
              <View className="flex-1">
                <Button title={t.mobileJobs.send} onPress={sendBooking} loading={sendingBooking} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row justify-between">
      <Text className={bold ? 'text-base font-bold text-ink' : 'text-sm text-ink-muted'}>{label}</Text>
      <Text className={bold ? 'text-base font-bold text-ink' : 'text-sm text-ink'}>{value}</Text>
    </View>
  );
}
