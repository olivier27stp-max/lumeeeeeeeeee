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
import { createServiceContract } from '@/lib/api/serviceContracts';
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
  const [repeatMode, setRepeatMode] = useState<'weekly' | 'biweekly' | 'monthly' | 'custom'>('weekly');
  const [endsAfterCount, setEndsAfterCount] = useState('');
  const [endsAfterUnit, setEndsAfterUnit] = useState<'days' | 'weeks' | 'months' | 'years'>('months');
  // « Pas d'heure précise » : même convention que le web (00:00 → 23:59).
  const [anytime, setAnytime] = useState(false);
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

  // ── Plan de service : même modèle de données que le web (NewJobModal) ──
  // Chaque visite porte son année, son mois et sa date exacte, plus des heures
  // qui héritent de la Règle et peuvent être personnalisées visite par visite.
  type PlanVisit = { key: string; year: number; month: number; date: string };
  const [planVisits, setPlanVisits] = useState<PlanVisit[]>([]);
  const [serviceYears, setServiceYears] = useState<number[]>([new Date().getFullYear()]);
  const [visitTimes, setVisitTimes] = useState<Record<string, { start: string; end: string }>>({});
  const [createContract, setCreateContract] = useState(false);

  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dernierJour = (y: number, m: number) => new Date(y, m, 0).getDate();
  const nomMois = (m: number, style: 'short' | 'long') =>
    new Date(2000, m - 1, 1).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', { month: style });
  let compteurCle = 0;
  const nouvelleVisite = (y: number, m: number, date: string): PlanVisit => ({
    key: `${y}-${m}-${date}-${Date.now()}-${compteurCle++}`,
    year: y, month: m, date,
  });

  // Heures d'une visite : celles de la Règle, sauf personnalisation.
  const heuresDe = (key: string) =>
    visitTimes[key] ?? { start: hhmm(startDate), end: hhmm(endDate) };

  // Génération depuis la Règle. Comme sur le web, les modes non-« Personnalisé »
  // REMPLACENT la sélection à chaque changement de la Règle.
  useEffect(() => {
    if (jobType !== 'recurring' || repeatMode === 'custom') return;
    const count = parseInt(endsAfterCount, 10);
    if (!Number.isFinite(count) || count <= 0) { setPlanVisits([]); return; }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (endsAfterUnit === 'days') end.setDate(end.getDate() + count);
    else if (endsAfterUnit === 'weeks') end.setDate(end.getDate() + count * 7);
    else if (endsAfterUnit === 'months') end.setMonth(end.getMonth() + count);
    else end.setFullYear(end.getFullYear() + count);

    const out: PlanVisit[] = [];
    if (repeatMode === 'monthly') {
      const y0 = start.getFullYear();
      const m0 = start.getMonth();
      const d0 = startDate.getDate();
      for (let i = 0; out.length < 366; i++) {
        const y = y0 + Math.floor((m0 + i) / 12);
        const m = (m0 + i) % 12;
        const d = new Date(y, m, Math.min(d0, dernierJour(y, m + 1)));
        if (d > end) break;
        out.push(nouvelleVisite(y, m + 1, ymd(d)));
      }
    } else {
      const pas = repeatMode === 'weekly' ? 7 : 14;
      for (const d = new Date(start); d <= end && out.length < 366; d.setDate(d.getDate() + pas)) {
        out.push(nouvelleVisite(d.getFullYear(), d.getMonth() + 1, ymd(d)));
      }
    }
    setPlanVisits(out);
    setServiceYears(out.length > 0
      ? [...new Set(out.map((v) => v.year))].sort((a, b) => a - b)
      : [startDate.getFullYear()]);
    setVisitTimes({}); // la personnalisation repart des heures de la Règle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobType, repeatMode, endsAfterCount, endsAfterUnit, startDate]);

  const visitesDuMois = (y: number, m: number) =>
    planVisits.filter((v) => v.year === y && v.month === m).sort((a, b) => a.date.localeCompare(b.date));

  const basculerMois = (y: number, m: number) => {
    setPlanVisits((prev) => {
      const dedans = prev.filter((v) => v.year === y && v.month === m);
      if (dedans.length > 0) return prev.filter((v) => !(v.year === y && v.month === m));
      const jour = Math.min(startDate.getDate(), dernierJour(y, m));
      return [...prev, nouvelleVisite(y, m, `${y}-${String(m).padStart(2, '0')}-${String(jour).padStart(2, '0')}`)];
    });
  };
  const ajouterVisite = (y: number, m: number) => {
    const jour = Math.min(startDate.getDate(), dernierJour(y, m));
    setPlanVisits((prev) => [...prev, nouvelleVisite(y, m, `${y}-${String(m).padStart(2, '0')}-${String(jour).padStart(2, '0')}`)]);
  };
  const retirerVisite = (key: string) => setPlanVisits((prev) => prev.filter((v) => v.key !== key));
  const ajouterAnneeSuivante = () =>
    setServiceYears((prev) => [...prev, Math.max(...prev) + 1]);
  const retirerAnnee = (y: number) => {
    setServiceYears((prev) => prev.filter((x) => x !== y));
    setPlanVisits((prev) => prev.filter((v) => v.year !== y));
  };

  // Ce qui part réellement en base : une visite = un rendez-vous à l'agenda.
  const planPayload = useMemo(() => {
    if (jobType !== 'recurring') return [];
    return [...planVisits]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((v) => {
        const { start, end } = heuresDe(v.key);
        const [y, m, d] = v.date.split('-').map(Number);
        const [hs, ms] = start.split(':').map(Number);
        const [he, me] = end.split(':').map(Number);
        const debut = new Date(y, m - 1, d, hs, ms, 0, 0);
        const fin = new Date(y, m - 1, d, he, me, 0, 0);
        return { startISO: debut.toISOString(), endISO: (fin > debut ? fin : debut).toISOString() };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobType, planVisits, visitTimes, startDate, endDate]);

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
    mutationFn: async () => {
      const job = await createJob(orgId ?? '', {
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
        planVisits: jobType === 'recurring' && planPayload.length > 0 ? planPayload : null,
      });

      // Contrat de service optionnel — comme le web, il fige la liste des
      // visites telle qu'elle vient d'être planifiée.
      if (jobType === 'recurring' && createContract && planVisits.length > 0) {
        const triees = [...planVisits].sort((a, b) => a.date.localeCompare(b.date));
        await createServiceContract({
          orgId: orgId ?? '',
          job_id: job.id,
          client_id: client?.id ?? null,
          title: title.trim(),
          year: triees[0].year,
          visits: triees.map((v) => {
            const h = heuresDe(v.key);
            return {
              month: v.month,
              date: v.date,
              year: v.year,
              ...(visitTimes[v.key] ? { start_time: h.start, end_time: h.end } : {}),
            };
          }),
        });
      }
      return job;
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
              {(['weekly', 'biweekly', 'monthly', 'custom'] as const).map((rm) => (
                <Pressable
                  key={rm}
                  onPress={() => setRepeatMode(rm)}
                  className={`rounded-full border px-3.5 py-1.5 ${repeatMode === rm ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
                >
                  <Text className={`text-xs font-semibold ${repeatMode === rm ? 'text-white' : 'text-ink'}`}>
                    {rm === 'custom' ? t.mobilePlan.custom : repeatLabels[rm]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Pas d'heure précise — même convention que le web */}
            <Pressable
              onPress={() => {
                const on = !anytime;
                setAnytime(on);
                const s = new Date(startDate);
                const e = new Date(startDate);
                if (on) { s.setHours(0, 0, 0, 0); e.setHours(23, 59, 0, 0); }
                else { s.setHours(9, 0, 0, 0); e.setHours(10, 0, 0, 0); }
                setStartDate(s); setEndDate(e);
              }}
              className="flex-row items-center gap-2 px-1 pt-1"
            >
              <View className={`h-4 w-4 items-center justify-center rounded border ${anytime ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}>
                {anytime ? <Text className="text-[10px] font-bold text-white">✓</Text> : null}
              </View>
              <Text className="text-xs text-ink-muted">{t.mobilePlan.anytime}</Text>
            </Pressable>

            {repeatMode === 'custom' ? null : (
              <>
                {/* Se termine après N jours / semaines / mois / années */}
                <Text className="px-1 pt-1 text-[11px] font-semibold uppercase text-ink-subtle">
                  {t.mobilePlan.endsAfter}
                </Text>
                <View className="flex-row items-center gap-2">
                  <TextInput
                    value={endsAfterCount}
                    onChangeText={(v) => setEndsAfterCount(v.replace(/[^0-9]/g, '').slice(0, 3))}
                    keyboardType="number-pad"
                    placeholder="12"
                    className="w-14 rounded-xl border border-surface-border bg-white px-2 py-2 text-center text-sm font-semibold text-ink"
                  />
                  {(['days', 'weeks', 'months', 'years'] as const).map((u) => (
                    <Pressable
                      key={u}
                      onPress={() => setEndsAfterUnit(u)}
                      className={`rounded-full border px-3 py-1.5 ${endsAfterUnit === u ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
                    >
                      <Text className={`text-xs font-semibold ${endsAfterUnit === u ? 'text-white' : 'text-ink'}`}>
                        {u === 'days' ? t.mobilePlan.unitDays
                          : u === 'weeks' ? t.mobilePlan.unitWeeks
                          : u === 'months' ? t.mobilePlan.unitMonths
                          : t.mobilePlan.unitYears}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* Nombre de visites générées, comme le web */}
            {planVisits.length > 0 ? (
              <Text className="px-1 text-[11px] text-ink-subtle">
                {planVisits.length === 1
                  ? t.mobilePlan.generatedOne
                  : t.mobilePlan.generated.replace('{count}', String(planVisits.length))}
              </Text>
            ) : (
              <Text className="px-1 text-xs text-ink-muted">{t.mobilePlan.none}</Text>
            )}

            {/* Une section par année : grille des 12 mois, puis les dates
                exactes dans chaque mois retenu — structure du web. */}
            {serviceYears.map((year) => {
              const moisRetenus = Array.from(
                new Set(planVisits.filter((v) => v.year === year).map((v) => v.month)),
              ).sort((a, b) => a - b);
              return (
                <View key={year} className="gap-2 pt-2">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-2xl font-bold text-ink">{year}</Text>
                    {serviceYears.length > 1 ? (
                      <Pressable hitSlop={10} onPress={() => retirerAnnee(year)}>
                        <Text className="px-1 text-sm font-bold text-ink-subtle">🗑</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <View className="flex-row flex-wrap gap-2">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                      const n = visitesDuMois(year, m).length;
                      const actif = n > 0;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => basculerMois(year, m)}
                          className={`rounded-lg border px-3 py-2 ${actif ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
                        >
                          <Text className={`text-xs font-semibold capitalize ${actif ? 'text-white' : 'text-ink-muted'}`}>
                            {nomMois(m, 'short')}{n > 1 ? ` ×${n}` : ''}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {moisRetenus.length > 0 ? (
                    <>
                      <Text className="px-1 pt-1 text-[11px] font-semibold uppercase text-ink-subtle">
                        {t.mobilePlan.visitDates}
                      </Text>
                      {moisRetenus.map((m) => {
                        const visites = visitesDuMois(year, m);
                        return (
                          <View key={m} className="gap-2 rounded-xl border border-surface-border bg-surface-sunken p-3">
                            <View className="flex-row items-center justify-between">
                              <Text className="text-sm font-semibold capitalize text-ink">
                                {nomMois(m, 'long')} {year}
                              </Text>
                              <Pressable hitSlop={10} onPress={() => ajouterVisite(year, m)}>
                                <Text className="px-1 text-base font-bold text-ink">＋</Text>
                              </Pressable>
                            </View>
                            {visites.map((v) => {
                              const [vy, vm, vd] = v.date.split('-').map(Number);
                              const h = heuresDe(v.key);
                              const [hs, ms] = h.start.split(':').map(Number);
                              const [he, me] = h.end.split(':').map(Number);
                              return (
                                <View key={v.key} className="flex-row flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-2">
                                  <DateTimePicker
                                    value={new Date(vy, vm - 1, vd)}
                                    mode="date"
                                    display="compact"
                                    themeVariant="light"
                                    accentColor="#171717"
                                    minimumDate={new Date(year, m - 1, 1)}
                                    maximumDate={new Date(year, m - 1, dernierJour(year, m))}
                                    onChange={(_, d) => {
                                      if (!d) return;
                                      setPlanVisits((prev) =>
                                        prev.map((x) => (x.key === v.key ? { ...x, date: ymd(d) } : x)));
                                    }}
                                  />
                                  <DateTimePicker
                                    value={new Date(vy, vm - 1, vd, hs, ms)}
                                    mode="time"
                                    display="compact"
                                    themeVariant="light"
                                    accentColor="#171717"
                                    onChange={(_, d) => {
                                      if (!d) return;
                                      setVisitTimes((prev) => ({ ...prev, [v.key]: { start: hhmm(d), end: h.end } }));
                                    }}
                                  />
                                  <Text className="text-xs text-ink-subtle">–</Text>
                                  <DateTimePicker
                                    value={new Date(vy, vm - 1, vd, he, me)}
                                    mode="time"
                                    display="compact"
                                    themeVariant="light"
                                    accentColor="#171717"
                                    onChange={(_, d) => {
                                      if (!d) return;
                                      setVisitTimes((prev) => ({ ...prev, [v.key]: { start: h.start, end: hhmm(d) } }));
                                    }}
                                  />
                                  {visites.length > 1 ? (
                                    <Pressable hitSlop={10} onPress={() => retirerVisite(v.key)}>
                                      <Text className="px-1 text-sm font-bold text-ink-subtle">✕</Text>
                                    </Pressable>
                                  ) : null}
                                </View>
                              );
                            })}
                          </View>
                        );
                      })}
                    </>
                  ) : null}
                </View>
              );
            })}

            {/* Ajouter année suivante */}
            <Pressable
              onPress={ajouterAnneeSuivante}
              className="mt-1 items-center rounded-xl border border-dashed border-surface-border py-2.5"
            >
              <Text className="text-sm font-semibold text-ink-muted">＋ {t.mobilePlan.addNextYear}</Text>
            </Pressable>

            {/* Contrat optionnel */}
            <Pressable
              onPress={() => setCreateContract((v) => !v)}
              className="mt-1 flex-row items-start gap-3 rounded-xl border border-surface-border bg-surface-sunken p-3"
            >
              <View className={`mt-0.5 h-4 w-4 items-center justify-center rounded border ${createContract ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}>
                {createContract ? <Text className="text-[10px] font-bold text-white">✓</Text> : null}
              </View>
              <View className="flex-1">
                <Text className="text-sm text-ink">{t.mobilePlan.createContract}</Text>
                <Text className="pt-0.5 text-xs text-ink-muted">{t.mobilePlan.createContractHint}</Text>
              </View>
            </Pressable>
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
