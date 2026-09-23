/**
 * Consentement commercial d'un client — LCAP / loi 25 (2026-09-23).
 * ─────────────────────────────────────────────────────────────────
 * Depuis le 2026-09-19, un message commercial (relance, réengagement,
 * anniversaire) exige une base légale, sinon il est bloqué à l'envoi. Mais
 * aucun écran ne permettait d'en enregistrer une : la fonctionnalité était
 * inutilisable, et 0 consentement figurait en base.
 *
 * Cette carte montre les DEUX bases que la loi reconnaît :
 *
 *  • EXPRÈS — la personne a dit oui. Saisi ici, n'expire pas. C'est le seul
 *    élément modifiable : on n'invente pas un consentement, on le constate.
 *
 *  • TACITE — il découle de la relation : 2 ans après un job ou une facture,
 *    6 mois après un devis. Il est CALCULÉ, donc affiché en lecture seule.
 *    L'afficher compte autant que le saisir : sans lui, on croit qu'un client
 *    est injoignable alors que la loi permet de le contacter.
 *
 * Le retrait (désabonnement courriel, STOP au SMS) prime sur tout et se gère
 * ailleurs — il n'est montré ici que pour expliquer un blocage.
 */
import { useEffect, useId, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { definirConsentement, type ClientRecord } from '../lib/clientsApi';
import { confirmer } from './ui/ConfirmDialog';

/** Mêmes fenêtres que le serveur (`server/lib/consentement/base-legale.ts`). */
const JOURS_RELATION_AFFAIRES = 730;
const JOURS_DEMANDE = 182;
const JOUR_MS = 86_400_000;

type Tacite = { raison: 'relation_affaires' | 'demande'; expire: string } | null;

interface Props {
  client: ClientRecord;
  fr: boolean;
  /** Remonte l'état à la page parente pour que l'affichage reste cohérent. */
  onChange: (champs: Partial<ClientRecord>) => void;
}

export default function ClientConsentement({ client, fr, onChange }: Props) {
  const id = useId();
  const [tacite, setTacite] = useState<Tacite>(null);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState<'email' | 'sms' | null>(null);

  // Le tacite se calcule à partir des jobs, factures et devis du client. On
  // lit les mêmes données que le serveur pour montrer le MÊME verdict : un
  // écran qui dirait « autorisé » alors que l'envoi bloque serait pire que
  // pas d'écran du tout.
  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const recent = async (table: 'jobs' | 'invoices' | 'quotes') => {
          const { data, error } = await supabase
            .from(table)
            .select('created_at')
            .eq('client_id', client.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          return data?.created_at ? new Date(data.created_at).getTime() : null;
        };
        const [job, facture, devis] = await Promise.all([recent('jobs'), recent('invoices'), recent('quotes')]);
        if (!vivant) return;
        const now = Date.now();
        const affaires = [job, facture].filter((t): t is number => t !== null && t <= now);
        const finAffaires = affaires.length ? Math.max(...affaires) + JOURS_RELATION_AFFAIRES * JOUR_MS : 0;
        if (finAffaires > now) {
          setTacite({ raison: 'relation_affaires', expire: new Date(finAffaires).toISOString() });
        } else if (devis !== null && devis <= now && devis + JOURS_DEMANDE * JOUR_MS > now) {
          setTacite({ raison: 'demande', expire: new Date(devis + JOURS_DEMANDE * JOUR_MS).toISOString() });
        } else {
          setTacite(null);
        }
      } catch {
        // Le tacite reste inconnu : on n'affiche pas de base plutôt que d'en
        // inventer une. Le serveur reste seul juge à l'envoi.
        if (vivant) setTacite(null);
      } finally {
        if (vivant) setChargement(false);
      }
    })();
    return () => { vivant = false; };
  }, [client.id]);

  const dateCourte = (iso: string) =>
    new Date(iso).toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  async function basculer(canal: 'email' | 'sms', actuel: string | null | undefined) {
    const accorde = !actuel;
    if (!accorde) {
      const ok = await confirmer({
        message: fr
          ? `Retirer le consentement ${canal === 'email' ? 'courriel' : 'SMS'} de ce client ? Les relances commerciales cesseront, sauf si une relation d'affaires récente le permet encore.`
          : `Withdraw this client's ${canal === 'email' ? 'email' : 'SMS'} consent? Commercial follow-ups will stop, unless a recent business relationship still allows them.`,
        danger: true,
      });
      if (!ok) return;
    }
    const champ = canal === 'email' ? 'email_consent_at' : 'sms_consent_at';
    const avant = actuel ?? null;
    setEnCours(canal);
    onChange({ [champ]: accorde ? new Date().toISOString() : null });
    try {
      const { journalEcrit } = await definirConsentement(client.id, canal, accorde);
      if (!journalEcrit) {
        // Le consentement EST enregistré ; c'est sa trace probante qui manque.
        // On le dit, parce que c'est cette trace qu'on produirait en cas de plainte.
        toast.warning(fr
          ? 'Consentement enregistré, mais le journal de preuve n\'a pas pu être écrit.'
          : 'Consent saved, but the proof journal could not be written.');
      } else {
        toast.success(accorde
          ? (fr ? 'Consentement enregistré' : 'Consent recorded')
          : (fr ? 'Consentement retiré' : 'Consent withdrawn'));
      }
    } catch (e: any) {
      onChange({ [champ]: avant });
      toast.error(e?.message || (fr ? 'Échec de l\'enregistrement' : 'Save failed'));
    } finally {
      setEnCours(null);
    }
  }

  function Ligne({ canal, consenti }: { canal: 'email' | 'sms'; consenti: string | null | undefined }) {
    const titre = canal === 'email' ? (fr ? 'Courriel' : 'Email') : 'SMS';
    const bloque = canal === 'email' && !!client.email_opt_out_at;
    let etat: string;
    let ton: string;
    if (bloque) {
      etat = fr ? 'Désabonné — aucun envoi possible' : 'Unsubscribed — no sending possible';
      ton = 'text-danger';
    } else if (consenti) {
      etat = fr ? `Exprès, depuis le ${dateCourte(consenti)}` : `Express, since ${dateCourte(consenti)}`;
      ton = 'text-success';
    } else if (chargement) {
      etat = fr ? 'Vérification…' : 'Checking…';
      ton = 'text-text-tertiary';
    } else if (tacite) {
      etat = tacite.raison === 'relation_affaires'
        ? (fr ? `Tacite — relation d'affaires, jusqu'au ${dateCourte(tacite.expire)}` : `Implied — business relationship, until ${dateCourte(tacite.expire)}`)
        : (fr ? `Tacite — demande de prix, jusqu'au ${dateCourte(tacite.expire)}` : `Implied — quote request, until ${dateCourte(tacite.expire)}`);
      ton = 'text-success';
    } else {
      etat = fr ? 'Aucune base — les envois commerciaux sont bloqués' : 'No legal basis — commercial sending is blocked';
      ton = 'text-text-tertiary';
    }
    return (
      <div className="flex items-center justify-between gap-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-text-primary">{titre}</p>
          <p className={`text-[11px] mt-0.5 ${ton}`}>{etat}</p>
        </div>
        <button
          type="button"
          role="switch"
          id={`${id}-${canal}`}
          aria-checked={!!consenti}
          aria-label={fr ? `Consentement commercial ${titre}` : `${titre} commercial consent`}
          disabled={enCours === canal || bloque}
          onClick={() => void basculer(canal, consenti)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${consenti ? 'bg-primary' : 'bg-surface-tertiary'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-surface-card shadow-sm transition-transform ${consenti ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    );
  }

  return (
    <div className="section-card">
      <div className="px-5 py-3.5 border-b border-outline">
        <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
          <ShieldCheck size={15} className="text-text-secondary" />
          {fr ? 'Consentement commercial' : 'Commercial consent'}
        </h2>
        <p className="text-[11px] text-text-tertiary mt-0.5">
          {fr
            ? 'Requis pour les relances et offres. Les factures, devis et confirmations partent toujours.'
            : 'Required for follow-ups and offers. Invoices, quotes and confirmations are always sent.'}
        </p>
      </div>
      <div className="px-5 py-2 divide-y divide-outline-subtle">
        <Ligne canal="email" consenti={client.email_consent_at} />
        <Ligne canal="sms" consenti={client.sms_consent_at} />
      </div>
    </div>
  );
}
