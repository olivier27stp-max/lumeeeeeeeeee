import { useEffect, useState } from 'react';
import { Users, Check, X, Clock, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { fetchConsentRoster, reRequestConsent, type ConsentRosterEntry } from '../../lib/locationConsentApi';

/**
 * Vue admin des consentements de localisation (Loi 25) : qui a accepté,
 * refusé, ou n'a jamais répondu — avec « Redemander » qui fait réapparaître
 * le modal de consentement à la prochaine connexion du membre.
 */
export default function LocationConsentRoster({ language }: { language: 'en' | 'fr' }) {
  const fr = language === 'fr';
  const [roster, setRoster] = useState<ConsentRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      setRoster(await fetchConsentRoster());
    } catch {
      // non-admin ou erreur — la section reste vide (le parent gate déjà par rôle)
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleReRequest = async (entry: ConsentRosterEntry) => {
    setBusyId(entry.user_id);
    try {
      await reRequestConsent(entry.user_id);
      toast.success(fr
        ? `${entry.full_name || 'Le membre'} verra la demande à sa prochaine connexion`
        : `${entry.full_name || 'The member'} will see the request at next sign-in`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  if (loading) return null;
  if (roster.length === 0) return null;

  const badge = (e: ConsentRosterEntry) => {
    if (e.consent === true) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full px-2.5 py-1">
          <Check size={9} /> {fr ? 'Accepté' : 'Accepted'}{e.consent_at ? ` · ${fmtDate(e.consent_at)}` : ''}
        </span>
      );
    }
    if (e.consent === false) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400 rounded-full px-2.5 py-1">
          <X size={9} /> {fr ? 'Refusé' : 'Declined'}{e.consent_at ? ` · ${fmtDate(e.consent_at)}` : ''}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 rounded-full px-2.5 py-1">
        <Clock size={9} /> {fr ? 'Jamais demandé' : 'Never asked'}
      </span>
    );
  };

  return (
    <div className="section-card p-5 space-y-4">
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-text-tertiary flex items-center gap-2">
          <Users size={13} /> {fr ? 'Consentements de l\'équipe' : 'Team consents'}
        </h3>
        <p className="text-[12px] text-text-tertiary mt-1.5">
          {fr
            ? 'La position d\'un membre n\'est suivie que s\'il a accepté (exigé par la Loi 25). Le refus est bloqué côté serveur. « Jamais demandé » : la demande apparaît automatiquement à sa prochaine connexion.'
            : 'A member\'s position is only tracked if they accepted (required by Law 25). Refusal is enforced server-side. "Never asked": the request appears automatically at their next sign-in.'}
        </p>
      </div>
      <div className="divide-y divide-outline/30">
        {roster.map((e) => (
          <div key={e.user_id} className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-text-primary truncate">
              {e.full_name || (fr ? '(sans nom)' : '(unnamed)')}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {badge(e)}
              {e.consent === false && (
                <button
                  type="button"
                  onClick={() => handleReRequest(e)}
                  disabled={busyId === e.user_id}
                  className={cn(
                    'inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-outline-subtle hover:border-outline text-text-secondary hover:text-text-primary transition-colors',
                    busyId === e.user_id && 'opacity-50',
                  )}
                >
                  {busyId === e.user_id ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  {fr ? 'Redemander' : 'Ask again'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
