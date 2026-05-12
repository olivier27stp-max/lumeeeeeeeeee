import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Calendar as CalendarIcon, Check, MapPin, Clock } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchPublicBookingPage,
  fetchSlots,
  submitBooking,
  type PublicBookingPage,
} from '../lib/bookingApi';
import { useTranslation } from '../i18n';

const ACCENT = '#3FAF97';

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function formatDateLong(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function PublicBooking() {
  const { t, language } = useTranslation();
  const locale = language === 'fr' ? 'fr-CA' : 'en-CA';
  const { slug = '' } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<PublicBookingPage | null>(null);
  const [business, setBusiness] = useState<{ name: string | null; logo_url: string | null }>({ name: null, logo_url: null });

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [slots, setSlots] = useState<{ start: string; end: string }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ scheduled_at: string } | null>(null);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPublicBookingPage(slug)
      .then((r) => {
        if (cancelled) return;
        setPage(r.page);
        setBusiness(r.business);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  // Fetch slots when date changes
  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSelectedSlot(null);
    fetchSlots(slug, ymd(selectedDate))
      .then((r) => {
        if (cancelled) return;
        setSlots(r);
        setSlotsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSlots([]);
        setSlotsLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug, page, selectedDate]);

  const dateOptions = useMemo(() => {
    if (!page) return [];
    const days: Date[] = [];
    const maxAhead = Math.min(page.max_days_ahead, 60);
    for (let i = 0; i < maxAhead; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
  }, [page, today]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error || !page) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-semibold text-slate-900 mb-2">{(t.booking as any).unavailableTitle}</h1>
          <p className="text-slate-600">{error || (t.booking as any).unavailableDesc}</p>
        </div>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto mb-6 w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${ACCENT}20` }}>
            <Check className="w-8 h-8" style={{ color: ACCENT }} />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 mb-2">{(t.booking as any).bookedExclaim}</h1>
          <p className="text-slate-600 mb-1">
            {new Date(confirmation.scheduled_at).toLocaleString(locale, {
              weekday: 'long', month: 'long', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            })}
          </p>
          <p className="text-slate-500 text-sm">{(t.booking as any).confirmationSent.replace('{email}', email)}</p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) {
      toast.error((t.booking as any).pickTimeSlot);
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      toast.error((t.booking as any).nameEmailRequired);
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitBooking(slug, {
        customer_first_name: firstName.trim(),
        customer_last_name: lastName.trim(),
        customer_email: email.trim(),
        customer_phone: phone.trim() || null,
        service_address: address.trim() || null,
        notes: notes.trim() || null,
        scheduled_at: selectedSlot,
      });
      setConfirmation({ scheduled_at: res.booking.scheduled_at });
    } catch (err: any) {
      toast.error(err?.message || (t.booking as any).couldNotBook);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-8">
          {business.logo_url && (
            <img src={business.logo_url} alt={business.name || ''} className="h-10 mb-4" />
          )}
          {business.name && <p className="text-sm uppercase tracking-wide text-slate-500 mb-1">{business.name}</p>}
          <h1 className="text-3xl sm:text-4xl font-semibold text-slate-900">{page.title}</h1>
          {page.description && <p className="mt-3 text-slate-600 leading-relaxed">{page.description}</p>}
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Clock className="w-4 h-4" />
            <span>{page.duration_minutes} {(t.booking as any).minutes}</span>
          </div>
        </div>

        {/* Date picker — horizontal scroll */}
        <div className="mb-6">
          <h2 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
            <CalendarIcon className="w-4 h-4" /> {(t.booking as any).pickDateHeader}
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2">
            {dateOptions.map((d) => {
              const isSelected = ymd(d) === ymd(selectedDate);
              return (
                <button
                  key={ymd(d)}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className={`flex-shrink-0 px-4 py-3 rounded-lg border text-center transition ${
                    isSelected ? 'border-transparent text-white' : 'border-slate-200 text-slate-700 hover:border-slate-300'
                  }`}
                  style={isSelected ? { backgroundColor: ACCENT } : undefined}
                >
                  <div className="text-xs uppercase">{d.toLocaleDateString(locale, { weekday: 'short' })}</div>
                  <div className="text-lg font-semibold">{d.getDate()}</div>
                  <div className="text-xs">{d.toLocaleDateString(locale, { month: 'short' })}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Slots */}
        <div className="mb-8">
          <h2 className="text-sm font-medium text-slate-700 mb-3">
            {(t.booking as any).availableTimesFor.replace('{date}', formatDateLong(selectedDate, locale))}
          </h2>
          {slotsLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : slots.length === 0 ? (
            <p className="text-slate-500 text-sm py-6">{(t.booking as any).tryAnotherDay}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {slots.map((s) => {
                const isSel = selectedSlot === s.start;
                return (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => setSelectedSlot(s.start)}
                    className={`px-3 py-2.5 rounded-lg border text-sm transition ${
                      isSel ? 'border-transparent text-white' : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                    style={isSel ? { backgroundColor: ACCENT } : undefined}
                  >
                    {formatTime(s.start, locale)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Customer info */}
        {selectedSlot && (
          <form onSubmit={handleSubmit} className="space-y-4 border-t border-slate-100 pt-8">
            <h2 className="text-lg font-semibold text-slate-900">{(t.booking as any).yourDetails}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={(t.booking as any).firstName}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={(t.booking as any).lastName}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={(t.booking as any).emailLabel}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={(t.booking as any).phoneOptional}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={(t.booking as any).serviceAddressOptional}
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={(t.booking as any).notesOptional}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 resize-none"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full px-4 py-3 rounded-lg text-white font-medium transition disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {(t.booking as any).submitting}</span>
              ) : (
                <>{(t.booking as any).confirmAt.replace('{time}', formatTime(selectedSlot, locale))}</>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
