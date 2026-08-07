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
import { listMembers, listTeams } from '@/lib/api/org';
import { findOrCreateConversation } from '@/lib/api/messaging';
import { sendSmsViaServer } from '@/lib/api/server';
import { LineItemInput } from '@/lib/api/billing';
import { resolveTaxes } from '@/lib/api/taxes';
import { createServiceContract } from '@/lib/api/serviceContracts';
import { createJobAgreement } from '@/lib/api/jobAgreements';
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

/** Ligne de réglage à menu déroulant — l'équivalent mobile du <select> que le
 *  web utilise dans la carte « Règle » du plan de service. */
function SelectRow<T extends string>({
  label, value, options, onSelect,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onSelect: (k: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const courant = options.find((o) => o.key === value);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between gap-3 py-2.5"
      >
        <Text className="shrink-0 text-xs font-medium text-ink-muted">{label}</Text>
        <View className="flex-1 flex-row items-center justify-end gap-1">
          <Text className="text-right text-sm font-semibold text-ink" numberOfLines={1}>
            {courant?.label ?? ''}
          </Text>
          <Text className="text-sm text-ink-subtle">›</Text>
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/30" onPress={() => setOpen(false)}>
          <View className="rounded-t-3xl bg-white px-4 pb-10 pt-3">
            <Text className="px-1 pb-2 text-[11px] font-bold uppercase tracking-widest text-ink-subtle">
              {label}
            </Text>
            {options.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => { onSelect(o.key); setOpen(false); }}
                className="flex-row items-center justify-between border-t border-surface-border py-3"
              >
                <Text className={`text-base ${o.key === value ? 'font-bold text-ink' : 'text-ink-muted'}`}>
                  {o.label}
                </Text>
                {o.key === value ? <Text className="text-base font-bold text-ink">✓</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
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
  // Champs du formulaire web qui manquaient au mobile.
  const [jobNumber, setJobNumber] = useState('');
  const [salespersonId, setSalespersonId] = useState<string | null>(null);
  const [saleDate, setSaleDate] = useState<Date | null>(null);
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);
  const [depositRequired, setDepositRequired] = useState(false);
  const [depositType, setDepositType] = useState<'percentage' | 'fixed'>('percentage');
  const [depositValue, setDepositValue] = useState('');
  const [requirePaymentMethod, setRequirePaymentMethod] = useState(false);
  const [billingSplit, setBillingSplit] = useState(false);
  // Le mobile forçait requires_invoicing à vrai; le web en fait une case.
  const [requiresInvoicing, setRequiresInvoicing] = useState(true);

  // Les vendeurs à qui attribuer la job (bloc « Vendeur » du web).
  const { data: membres } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => listMembers(orgId ?? ''),
    enabled: !!orgId,
  });

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
  // Produits/services : communs à tout le plan, ou propres à chaque visite —
  // comme le web (case « appliquer à toutes les visites », cochée par défaut).
  const [applyItemsToAll, setApplyItemsToAll] = useState(true);
  const [visitItems, setVisitItems] = useState<Record<string, LineItemInput[]>>({});
  const [itemsVisitKey, setItemsVisitKey] = useState<string | null>(null);
  // Facturation du plan — mêmes trois modes que le web.
  const [billingMode, setBillingMode] = useState<'per_visit' | 'single' | 'installments'>('per_visit');
  const [autoCharge, setAutoCharge] = useState(false);
  const [installmentsCount, setInstallmentsCount] = useState('');
  const [installmentAmount, setInstallmentAmount] = useState('');

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
    setVisitItems({});
    setItemsVisitKey(null);
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

  /** Déplace une année planifiée — et les visites qu'elle porte — vers une
   *  autre. Refuse une année hors bornes ou déjà présente. */
  const changerAnnee = (ancienne: number, nouvelle: number) => {
    if (!Number.isFinite(nouvelle) || nouvelle < 2000 || nouvelle > 2100) return;
    if (nouvelle === ancienne || serviceYears.includes(nouvelle)) return;
    setServiceYears((prev) => [...prev.filter((y) => y !== ancienne), nouvelle].sort((a, b) => a - b));
    setPlanVisits((prev) =>
      prev.map((v) => {
        if (v.year !== ancienne) return v;
        // Le quantième est borné à la longueur du mois dans la nouvelle année
        // (29 février d'une année bissextile → 28).
        const jour = Math.min(Number(v.date.slice(8, 10)), dernierJour(nouvelle, v.month));
        return {
          ...v,
          year: nouvelle,
          date: `${nouvelle}-${String(v.month).padStart(2, '0')}-${String(jour).padStart(2, '0')}`,
        };
      }),
    );
  };
  const retirerAnnee = (y: number) => {
    setServiceYears((prev) => prev.filter((x) => x !== y));
    setPlanVisits((prev) => prev.filter((v) => v.year !== y));
  };

  // ── Produits/services par visite ──
  const itemsPersonnalises = jobType === 'recurring' && !applyItemsToAll;
  const itemsDeVisite = (key: string) => visitItems[key] ?? items;
  /** La visite en cours d'édition — repli sur la première si la règle a
   *  régénéré le plan et que la clé retenue n'existe plus (comportement du web). */
  const visiteEditee =
    itemsPersonnalises
      ? [...planVisits].sort((a, b) => a.date.localeCompare(b.date))
          .find((v) => v.key === itemsVisitKey) ??
        [...planVisits].sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
      : null;

  /** Le menu « S'applique à » — porte à lui seul la bascule, comme le web
   *  (selectItemsScope) : « Toutes les visites » revient au jeu commun, choisir
   *  une visite sème chaque visite d'une copie puis ouvre celle-là. */
  const choisirPorteeServices = (valeur: string) => {
    if (valeur === 'all') {
      setApplyItemsToAll(true);
      setItemsVisitKey(null);
      return;
    }
    if (applyItemsToAll) {
      setApplyItemsToAll(false);
      setVisitItems(
        Object.fromEntries(planVisits.map((v) => [v.key, items.map((i) => ({ ...i }))])),
      );
    }
    setItemsVisitKey(valeur);
  };
  /** « Lavage — août 2026 » : une fois les lignes aplaties au niveau du job, on
   *  doit encore savoir de quelle visite chacune provient (convention du web). */
  const etiquetteVisite = (v: PlanVisit) => `${nomMois(v.month, 'long')} ${v.year}`;
  /** « 5 août 2026 » à partir d'un AAAA-MM-JJ. */
  const dateLisible = (ymdStr: string) => {
    const [y, m, d] = ymdStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  };

  /** Ce qui est réellement facturé : les lignes du plan, ou la somme de toutes
   *  les visites quand les services sont personnalisés. */
  const billableItems = useMemo<LineItemInput[]>(() => {
    if (!itemsPersonnalises) return items;
    return [...planVisits]
      .sort((a, b) => a.date.localeCompare(b.date))
      .flatMap((v) =>
        itemsDeVisite(v.key)
          .filter((it) => (it.name?.trim() || it.unit_price_cents > 0))
          .map((it) => ({ ...it, name: `${it.name?.trim() || 'Service'} — ${etiquetteVisite(v)}` })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsPersonnalises, items, planVisits, visitItems, language]);

  /** Liste lisible des services, inscrite sur le rendez-vous de la visite. */
  const notesDeVisite = (key: string): string | null => {
    if (!itemsPersonnalises) return null;
    const parts = itemsDeVisite(key)
      .filter((it) => it.name?.trim())
      .map((it) => (it.qty > 1 ? `${it.name.trim()} ×${it.qty}` : it.name.trim()));
    if (parts.length === 0) return null;
    return `${lang === 'fr' ? 'Services : ' : 'Services: '}${parts.join(' · ')}`;
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
        return {
          startISO: debut.toISOString(),
          endISO: (fin > debut ? fin : debut).toISOString(),
          notes: notesDeVisite(v.key),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobType, planVisits, visitTimes, startDate, endDate, visitItems, applyItemsToAll, items]);

  // N versements du montant choisi; ce qui reste devient le « Solde ».
  const installmentsPlan = useMemo(() => {
    const count = parseInt(installmentsCount, 10);
    const amountCents = Math.round((Number.parseFloat(installmentAmount) || 0) * 100);
    if (!Number.isFinite(count) || count <= 0 || amountCents <= 0) return null;
    return { count, amountCents, coveredCents: count * amountCents };
  }, [installmentsCount, installmentAmount]);

  const totals = useMemo(() => {
    const subtotal = billableItems.reduce((s, i) => s + Math.round(i.qty * i.unit_price_cents), 0);
    const tax = Math.round((subtotal * (parseFloat(taxRate) || 0)) / 100);
    return { subtotal, tax, total: subtotal + tax };
  }, [billableItems, taxRate]);

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
        requires_invoicing: requiresInvoicing,
        scheduled_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        items: canSeePricing ? billableItems : [],
        taxRatePct: parseFloat(taxRate) || 0,
        // Le plan matérialise ses rendez-vous : pas de règle de récurrence en
        // parallèle, elle en générerait des doublons.
        planVisits: jobType === 'recurring' && planPayload.length > 0 ? planPayload : null,
        jobNumber,
        salespersonId,
        saleDate: saleDate ? ymd(saleDate) : null,
        showOnLeaderboard,
        depositRequired,
        depositType,
        depositValue: parseFloat(depositValue) || 0,
        requirePaymentMethod,
        billingSplit,
        billingMode: jobType === 'recurring' ? billingMode : null,
        autoCharge: jobType === 'recurring' ? autoCharge : false,
        installments:
          jobType === 'recurring' && billingMode === 'installments' ? installmentsPlan : null,
      });

      // Sur le web, cocher « créer un contrat » crée AUSSI l'entente écrite —
      // les deux cases y sont synchronisées. Au pire du best-effort : le job et
      // ses rendez-vous sont déjà enregistrés.
      if (jobType === 'recurring' && createContract) {
        try {
          await createJobAgreement({
            orgId: orgId ?? '',
            jobId: job.id,
            clientId: client?.id ?? null,
            language: lang === 'fr' ? 'fr' : 'en',
          });
        } catch (e) {
          console.warn('[plan] entente non créée:', (e as Error).message);
        }
      }

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
              // Les services ne sont figés au contrat que s'ils diffèrent d'une
              // visite à l'autre — même convention que le web.
              ...(itemsPersonnalises
                ? {
                    items: itemsDeVisite(v.key)
                      .filter((it) => it.name?.trim() || it.unit_price_cents > 0)
                      .map((it) => ({
                        name: it.name?.trim() || 'Service',
                        qty: it.qty,
                        unit_price_cents: it.unit_price_cents,
                      })),
                  }
                : {}),
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

      {/* Détails — numéro, vendeur, date de vente, classement. Le formulaire
          web les porte dans son bloc « Détails »; ils manquaient au mobile. */}
      <View className="rounded-2xl border border-surface-border bg-surface-sunken px-4">
        <View className="flex-row items-center justify-between gap-3 py-2.5">
          <Text className="shrink-0 text-xs font-medium text-ink-muted">{t.jobs.jobNumber}</Text>
          <TextInput
            value={jobNumber}
            onChangeText={setJobNumber}
            placeholder="—"
            className="flex-1 text-right text-sm font-semibold text-ink"
          />
        </View>

        <View className="border-t border-surface-border">
          <SelectRow
            label={t.modals.salesperson}
            value={salespersonId ?? ''}
            onSelect={(v) => setSalespersonId(v || null)}
            options={[
              { key: '', label: '—' },
              ...(membres ?? []).map((m) => ({ key: m.user_id, label: m.full_name || m.user_id.slice(0, 8) })),
            ]}
          />
        </View>

        <View className="flex-row items-center justify-between gap-3 border-t border-surface-border py-2">
          <Text className="shrink-0 text-xs font-medium text-ink-muted">{t.modals.saleDate}</Text>
          {saleDate ? (
            <View className="flex-row items-center gap-2">
              <DateTimePicker
                value={saleDate}
                mode="date"
                display="compact"
                themeVariant="light"
                accentColor="#171717"
                onChange={(_, d) => { if (d) setSaleDate(d); }}
              />
              <Pressable hitSlop={8} onPress={() => setSaleDate(null)}>
                <Text className="text-xs font-semibold text-ink-muted">{t.common.clear}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setSaleDate(new Date())}>
              <Text className="text-sm font-semibold text-ink-muted">—</Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => setShowOnLeaderboard((v) => !v)}
          className="flex-row items-center gap-2 border-t border-surface-border py-2.5"
        >
          <View className={`h-4 w-4 items-center justify-center rounded border ${showOnLeaderboard ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}>
            {showOnLeaderboard ? <Text className="text-[10px] font-bold text-white">✓</Text> : null}
          </View>
          <Text className="text-xs text-ink-muted">{t.modals.showOnLeaderboard}</Text>
        </Pressable>
      </View>

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
            {/* Titre du bloc, comme le web (Box « Calendrier du plan de service ») */}
            <View className="px-1 pt-1">
              <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
                {t.modals.servicePlanSchedule}
              </Text>
              <Text className="pt-0.5 text-[11px] text-ink-muted">
                {t.modals.servicePlanScheduleHint}
              </Text>
            </View>

            {/* ── Carte « Règle », comme le web : champs étiquetés et menus
                   déroulants, pas une rangée de pastilles. ── */}
            <View className="rounded-2xl border border-surface-border bg-surface-sunken px-4 py-1">
              <Text className="pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
                {t.mobilePlan.rule}
              </Text>

              <View className="flex-row items-center justify-between gap-3 border-t border-surface-border py-2">
                <Text className="text-xs font-medium text-ink-muted">{t.mobilePlan.startDate}</Text>
                <DateTimePicker
                  value={startDate}
                  mode="date"
                  display="compact"
                  themeVariant="light"
                  accentColor="#171717"
                  onChange={(_, d) => { if (d) pickDay(d); }}
                />
              </View>

              {!anytime ? (
                <View className="flex-row items-center justify-between gap-2 border-t border-surface-border py-2">
                  <Text className="shrink-0 text-xs font-medium text-ink-muted">{t.modals.startTime}</Text>
                  <DateTimePicker
                    value={startDate}
                    mode="time"
                    display="compact"
                    themeVariant="light"
                    accentColor="#171717"
                    onChange={(_, d) => { if (d) setStartDate((p) => setTimeOn(p, d)); }}
                  />
                  <Text className="shrink-0 text-xs font-medium text-ink-muted">{t.modals.endTime}</Text>
                  <DateTimePicker
                    value={endDate}
                    mode="time"
                    display="compact"
                    themeVariant="light"
                    accentColor="#171717"
                    onChange={(_, d) => { if (d) setEndDate((p) => setTimeOn(p, d)); }}
                  />
                </View>
              ) : null}

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
                className="flex-row items-center gap-2 border-t border-surface-border py-2.5"
              >
                <View className={`h-4 w-4 items-center justify-center rounded border ${anytime ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}>
                  {anytime ? <Text className="text-[10px] font-bold text-white">✓</Text> : null}
                </View>
                <Text className="text-xs text-ink-muted">{t.mobilePlan.anytime}</Text>
              </Pressable>

              <View className="border-t border-surface-border">
                <SelectRow
                  label={t.mobilePlan.repeats}
                  value={repeatMode}
                  onSelect={setRepeatMode}
                  options={[
                    { key: 'weekly' as const, label: repeatLabels.weekly },
                    { key: 'biweekly' as const, label: repeatLabels.biweekly },
                    { key: 'monthly' as const, label: repeatLabels.monthly },
                    { key: 'custom' as const, label: t.mobilePlan.custom },
                  ]}
                />
              </View>

              {repeatMode === 'custom' ? null : (
                <View className="flex-row items-center justify-between gap-2 border-t border-surface-border py-2">
                  <Text className="shrink-0 text-xs font-medium text-ink-muted">{t.mobilePlan.endsAfter}</Text>
                  <TextInput
                    value={endsAfterCount}
                    onChangeText={(v) => setEndsAfterCount(v.replace(/[^0-9]/g, '').slice(0, 3))}
                    keyboardType="number-pad"
                    placeholder="12"
                    className="w-14 rounded-lg border border-surface-border bg-white px-2 py-1.5 text-center text-sm font-semibold text-ink"
                  />
                  <View className="flex-1">
                    <SelectRow
                      label=""
                      value={endsAfterUnit}
                      onSelect={setEndsAfterUnit}
                      options={[
                        { key: 'days' as const, label: t.mobilePlan.unitDays },
                        { key: 'weeks' as const, label: t.mobilePlan.unitWeeks },
                        { key: 'months' as const, label: t.mobilePlan.unitMonths },
                        { key: 'years' as const, label: t.mobilePlan.unitYears },
                      ]}
                    />
                  </View>
                </View>
              )}
            </View>

            {/* Nombre de visites générées, comme le web */}
            {planVisits.length > 0 ? (
              <Text className="px-1 text-[11px] text-ink-subtle">
                {planVisits.length === 1
                  ? t.mobilePlan.generatedOne
                  : t.mobilePlan.generated.replace('{count}', String(planVisits.length))}
              </Text>
            ) : (
              <Text className="px-1 text-xs text-ink-muted">{t.modals.noVisitsPlanned}</Text>
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
                    {/* Année modifiable, comme le web : on valide à la sortie du
                        champ. Une valeur invalide ou déjà planifiée est refusée
                        et l'affichage revient à l'année d'origine. */}
                    <TextInput
                      key={`an-${year}`}
                      defaultValue={String(year)}
                      keyboardType="number-pad"
                      maxLength={4}
                      onEndEditing={(e) => changerAnnee(year, parseInt(e.nativeEvent.text, 10))}
                      className="w-24 p-0 text-2xl font-bold text-ink"
                    />
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
                        {t.modals.servicePlanDates}
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
                <Text className="pt-0.5 text-xs text-ink-muted">{t.modals.servicePlanCreateContractHint}</Text>
              </View>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Date & heure — masquée pour un plan de service : sa carte « Règle »
          porte déjà la date de début et les heures, et chaque visite a les
          siennes. Les afficher ici en plus, c'était le même réglage deux fois.
          Le web fait pareil ({!isServicePlan && …}). */}
      <View className="gap-2" style={jobType === 'recurring' ? { display: 'none' } : undefined}>
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
            <Text className="text-[11px] font-semibold uppercase text-ink-subtle">{t.modals.endTime}</Text>
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
          {/* Facturation — dépôt, moyen de paiement, échéancier. Bloc du web
              (« Facturation »), placé comme lui avant les produits et services. */}
          <View className="rounded-2xl border border-surface-border bg-surface-sunken px-4">
            <Text className="pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
              {t.modals.billing}
            </Text>

            <Pressable
              onPress={() => setRequiresInvoicing((v) => !v)}
              className="flex-row items-center gap-2 border-t border-surface-border py-2.5"
            >
              <View className={`h-4 w-4 items-center justify-center rounded border ${requiresInvoicing ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}>
                {requiresInvoicing ? <Text className="text-[10px] font-bold text-white">✓</Text> : null}
              </View>
              <Text className="flex-1 text-xs text-ink">{t.modals.remindInvoice}</Text>
            </Pressable>

            <Pressable
              onPress={() => setDepositRequired((v) => !v)}
              className="flex-row items-center gap-2 border-t border-surface-border py-2.5"
            >
              <View className={`h-4 w-4 items-center justify-center rounded border ${depositRequired ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}>
                {depositRequired ? <Text className="text-[10px] font-bold text-white">✓</Text> : null}
              </View>
              <Text className="flex-1 text-xs text-ink">{t.modals.requireDeposit}</Text>
            </Pressable>

            {depositRequired ? (
              <View className="flex-row items-center gap-2 border-t border-surface-border py-2">
                {(['percentage', 'fixed'] as const).map((dt) => (
                  <Pressable
                    key={dt}
                    onPress={() => setDepositType(dt)}
                    className={`rounded-full border px-3 py-1.5 ${depositType === dt ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}
                  >
                    <Text className={`text-xs font-semibold ${depositType === dt ? 'text-white' : 'text-ink'}`}>
                      {dt === 'percentage' ? t.modals.percentageOption : t.modals.fixedAmountOption}
                    </Text>
                  </Pressable>
                ))}
                <TextInput
                  value={depositValue}
                  onChangeText={(v) => setDepositValue(v.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                  keyboardType="decimal-pad"
                  placeholder={depositType === 'percentage' ? '25' : '100'}
                  className="flex-1 rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-semibold text-ink"
                />
              </View>
            ) : null}

            <Pressable
              onPress={() => setRequirePaymentMethod((v) => !v)}
              className="flex-row items-center gap-2 border-t border-surface-border py-2.5"
            >
              <View className={`h-4 w-4 items-center justify-center rounded border ${requirePaymentMethod ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}>
                {requirePaymentMethod ? <Text className="text-[10px] font-bold text-white">✓</Text> : null}
              </View>
              <Text className="flex-1 text-xs text-ink">{t.modals.requirePaymentMethodOnFile}</Text>
            </Pressable>

            {jobType === 'recurring' ? null : (
              <Pressable
                onPress={() => setBillingSplit((v) => !v)}
                className="flex-row items-center gap-2 border-t border-surface-border py-2.5"
              >
                <View className={`h-4 w-4 items-center justify-center rounded border ${billingSplit ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}>
                  {billingSplit ? <Text className="text-[10px] font-bold text-white">✓</Text> : null}
                </View>
                <Text className="flex-1 text-xs text-ink">{t.modals.splitInvoices}</Text>
              </Pressable>
            )}
          </View>

          <Text className="px-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
            {t.modals.productsServices}
          </Text>
          {/* Plan de service — « S'applique à » : un seul menu, comme le web.
              Choisir une visite bascule d'office en services personnalisés. */}
          {jobType === 'recurring' && planVisits.length > 0 ? (
            <View className="rounded-2xl border border-surface-border bg-surface-sunken px-4 pb-2">
              <SelectRow
                label={t.mobilePlan.appliesToLabel}
                value={itemsVisitKey ?? 'all'}
                onSelect={choisirPorteeServices}
                options={[
                  { key: 'all', label: t.mobilePlan.allVisits },
                  ...[...planVisits]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((v) => ({ key: v.key, label: `${etiquetteVisite(v)} — ${dateLisible(v.date)}` })),
                ]}
              />
              <Text className="pb-1 text-[11px] text-ink-subtle">
                {itemsPersonnalises ? t.mobilePlan.itemsCustomHint : t.mobilePlan.itemsApplyAllHint}
              </Text>
            </View>
          ) : null}

          {itemsPersonnalises && visiteEditee ? (
            <LineItemsEditor
              key={visiteEditee.key}
              seedKey={visiteEditee.key}
              seed={visitItems[visiteEditee.key] ?? items}
              onChange={(lignes) => setVisitItems((prev) => ({ ...prev, [visiteEditee.key]: lignes }))}
            />
          ) : (
            <LineItemsEditor onChange={setItems} />
          )}
          <Input label={t.mobileJobs.taxRate} value={taxRate} onChangeText={setTaxRate} keyboardType="decimal-pad" placeholder={DEFAULT_TAX} />
          <View className="gap-1 rounded-2xl bg-white p-4">
            <Row label={t.mobileJobs.subtotal} value={formatCurrencyCents(totals.subtotal, 'CAD')} />
            <Row label={t.mobileJobs.tax} value={formatCurrencyCents(totals.tax, 'CAD')} />
            <Row label={t.mobileJobs.total} value={formatCurrencyCents(totals.total, 'CAD')} bold />
          </View>
          {/* Facturation et paiements — après les produits et services,
              comme le web (Box « Facturation et paiements »). */}
          {jobType === 'recurring' ? (
            <View className="mt-1 rounded-2xl border border-surface-border bg-surface-sunken px-4 py-1">
              <Text className="pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-ink-subtle">
                {t.modals.billingAndPayments}
              </Text>
              {/* Les trois modes, chacun avec son explication visible — comme le
                  web, qui les présente en cartes plutôt qu'en menu déroulant. */}
              <View className="gap-2 border-t border-surface-border py-2">
                {([
                  { key: 'per_visit' as const, label: t.mobilePlan.modePerVisit, hint: t.mobilePlan.modePerVisitHint },
                  { key: 'single' as const, label: t.mobilePlan.modeSingle, hint: t.mobilePlan.modeSingleHint },
                  { key: 'installments' as const, label: t.mobilePlan.modeInstallments, hint: t.mobilePlan.modeInstallmentsHint },
                ]).map((opt) => {
                  const actif = billingMode === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setBillingMode(opt.key)}
                      className={`rounded-xl border px-3 py-2.5 ${actif ? 'border-ink bg-white' : 'border-surface-border bg-white'}`}
                    >
                      <Text className={`text-sm ${actif ? 'font-bold text-ink' : 'font-medium text-ink-muted'}`}>
                        {opt.label}
                      </Text>
                      <Text className="pt-0.5 text-[11px] text-ink-subtle">{opt.hint}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {billingMode === 'installments' ? (
                <View className="gap-2 border-t border-surface-border py-2">
                  {/* Deux champs étiquetés, comme le web */}
                  <View className="flex-row gap-3">
                    <View className="flex-1 gap-1">
                      <Text className="text-[11px] font-medium text-ink-muted">
                        {t.mobilePlan.paymentCount}
                      </Text>
                      <TextInput
                        value={installmentsCount}
                        onChangeText={(v) => setInstallmentsCount(v.replace(/[^0-9]/g, '').slice(0, 2))}
                        keyboardType="number-pad"
                        placeholder="3"
                        className="rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-semibold text-ink"
                      />
                    </View>
                    <View className="flex-1 gap-1">
                      <Text className="text-[11px] font-medium text-ink-muted">
                        {t.mobilePlan.paymentAmount}
                      </Text>
                      <TextInput
                        value={installmentAmount}
                        onChangeText={(v) => setInstallmentAmount(v.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                        keyboardType="decimal-pad"
                        placeholder="100"
                        className="rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-semibold text-ink"
                      />
                    </View>
                  </View>
                  {/* Récapitulatif au format du web : N paiements de X = Y · total de la job Z */}
                  {installmentsPlan ? (
                    <View>
                      <Text className="text-[11px] text-ink-muted">
                        {t.mobilePlan.installmentsRecap
                          .replace('{count}', String(installmentsPlan.count))
                          .replace('{each}', formatCurrencyCents(installmentsPlan.amountCents, 'CAD'))
                          .replace('{covered}', formatCurrencyCents(installmentsPlan.coveredCents, 'CAD'))}
                        <Text className="text-ink-subtle">
                          {' · '}
                          {t.mobilePlan.jobTotal.replace('{total}', formatCurrencyCents(totals.total, 'CAD'))}
                        </Text>
                      </Text>
                      {installmentsPlan.coveredCents > totals.total ? (
                        <Text className="pt-0.5 text-[11px] text-status-late">
                          {t.mobilePlan.overTotal.replace(
                            '{amount}',
                            formatCurrencyCents(installmentsPlan.coveredCents - totals.total, 'CAD'))}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Pressable
                onPress={() => setAutoCharge((v) => !v)}
                className="flex-row items-start gap-2 border-t border-surface-border py-2.5"
              >
                <View className={`mt-0.5 h-4 w-4 items-center justify-center rounded border ${autoCharge ? 'border-ink bg-ink' : 'border-surface-border bg-white'}`}>
                  {autoCharge ? <Text className="text-[10px] font-bold text-white">✓</Text> : null}
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-ink">{t.mobilePlan.autoCharge}</Text>
                  {autoCharge ? (
                    <Text className="pt-0.5 text-[11px] text-ink-subtle">{t.mobilePlan.autoChargeHint}</Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          ) : null}

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
