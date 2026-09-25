/* ═══════════════════════════════════════════════════════════════
   LES ADRESSES D'APPEL — brancher Lume sur l'extérieur.

   Jusqu'ici, une automatisation ne pouvait partir que d'un événement NÉ
   dans Lume. Un formulaire sur le site de l'entreprise, Zapier, Facebook
   Leads : rien ne pouvait rien déclencher. À la question « est-ce que ça
   se branche à mon site ? », la réponse était non.

   Ici, l'utilisateur crée une adresse, la copie, et la colle chez son
   fournisseur. Ensuite il construit une automatisation qui part du
   déclencheur « Appel reçu de l'extérieur ».

   LE VOCABULAIRE. On dit « adresse d'appel », pas « webhook » : la
   personne qui lit cette page pose des gouttières ou répare des
   fournaises. Le mot technique apparaît une fois, entre parenthèses,
   pour celui qui cherche où coller l'URL que Zapier lui réclame.

   LA CLÉ EST UN SECRET. Elle est masquée par défaut : une capture
   d'écran de cette page, un partage rapide, et n'importe qui peut
   déclencher les automatisations de l'entreprise. Qui détient l'adresse
   peut appeler.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import { Loader2, Copy, Check, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { confirmer } from '../ui/ConfirmDialog';
import {
  listerAdressesDAppel, creerAdresseDAppel, basculerAdresseDAppel,
  supprimerAdresseDAppel, type AdresseDAppel,
} from '../../lib/automationWebhooksApi';

/** L'URL complète que l'utilisateur colle chez son fournisseur. */
function urlComplete(cle: string): string {
  return `${window.location.origin}/api/hooks/${cle}`;
}

export default function AdressesDAppel({ fr }: { fr: boolean }) {
  const [adresses, setAdresses] = useState<AdresseDAppel[]>([]);
  const [chargement, setChargement] = useState(true);
  const [creation, setCreation] = useState(false);
  const [devoilees, setDevoilees] = useState<Set<string>>(new Set());
  const [copiee, setCopiee] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    listerAdressesDAppel()
      .then((l) => { if (vivant) setAdresses(l); })
      .catch(() => {
        if (vivant) {
          toast.error(fr ? 'Impossible de lire vos adresses d’appel.' : 'Could not load your endpoints.');
        }
      })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [fr]);

  async function creer() {
    setCreation(true);
    try {
      const nouvelle = await creerAdresseDAppel(
        fr ? 'Formulaire de mon site' : 'My website form',
      );
      setAdresses((a) => [...a, nouvelle]);
      // On la dévoile tout de suite : elle vient d'être créée pour être
      // copiée, la masquer obligerait à un clic de plus sans rien protéger.
      setDevoilees((d) => new Set(d).add(nouvelle.id));
      toast.success(fr ? 'Adresse créée.' : 'Endpoint created.');
    } catch {
      toast.error(fr ? 'Impossible de créer l’adresse.' : 'Could not create the endpoint.');
    } finally {
      setCreation(false);
    }
  }

  async function copier(a: AdresseDAppel) {
    try {
      await navigator.clipboard.writeText(urlComplete(a.api_key));
      setCopiee(a.id);
      setTimeout(() => setCopiee((c) => (c === a.id ? null : c)), 2000);
    } catch {
      // Le presse-papiers est refusé hors HTTPS et dans certains contextes :
      // on dévoile la clé pour que l'utilisateur la sélectionne à la main,
      // plutôt que de le laisser devant un bouton qui ne fait rien.
      setDevoilees((d) => new Set(d).add(a.id));
      toast.error(fr
        ? 'Copie impossible : sélectionnez l’adresse affichée.'
        : 'Copy failed: select the address shown.');
    }
  }

  async function basculer(a: AdresseDAppel) {
    const vise = !a.enabled;
    setAdresses((l) => l.map((x) => (x.id === a.id ? { ...x, enabled: vise } : x)));
    try {
      await basculerAdresseDAppel(a.id, vise);
    } catch {
      setAdresses((l) => l.map((x) => (x.id === a.id ? { ...x, enabled: a.enabled } : x)));
      toast.error(fr ? 'Changement non enregistré.' : 'Change not saved.');
    }
  }

  async function supprimer(a: AdresseDAppel) {
    const ok = await confirmer({
      title: fr ? 'Supprimer cette adresse ?' : 'Delete this endpoint?',
      // On dit la CONSÉQUENCE, pas l'action : ce qui compte, c'est que le
      // service branché dessus cessera de fonctionner.
      message: fr
        ? 'Le service branché sur cette adresse cessera de déclencher vos automatisations. Cette adresse ne pourra pas être réutilisée.'
        : 'Whatever is connected to this address will stop triggering your automations. This address cannot be reused.',
      confirmLabel: fr ? 'Supprimer' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    const avant = adresses;
    setAdresses((l) => l.filter((x) => x.id !== a.id));
    try {
      await supprimerAdresseDAppel(a.id);
    } catch {
      setAdresses(avant);
      toast.error(fr ? 'Suppression impossible.' : 'Could not delete.');
    }
  }

  if (chargement) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-text-secondary">
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        {fr ? 'Chargement…' : 'Loading…'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {adresses.length === 0 && (
        <p className="text-[12px] text-text-secondary">
          {fr
            ? 'Aucune adresse pour l’instant. Créez-en une, puis collez-la dans votre formulaire, Zapier ou Facebook Leads.'
            : 'No address yet. Create one, then paste it into your form, Zapier or Facebook Leads.'}
        </p>
      )}

      {adresses.map((a) => {
        const devoilee = devoilees.has(a.id);
        const url = urlComplete(a.api_key);
        return (
          <div key={a.id} className="rounded-lg border border-outline/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-[13px] font-medium text-text-primary">{a.name}</span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => basculer(a)}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                    a.enabled
                      ? 'bg-success-light text-success'
                      : 'bg-surface-tertiary text-text-tertiary'
                  }`}
                >
                  {a.enabled ? (fr ? 'Active' : 'Active') : (fr ? 'En pause' : 'Paused')}
                </button>
                <button
                  type="button"
                  onClick={() => supprimer(a)}
                  aria-label={fr ? `Supprimer ${a.name}` : `Delete ${a.name}`}
                  className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-danger-light hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-surface-secondary px-2 py-1.5 font-mono text-[11px] text-text-secondary">
                {devoilee ? url : `${window.location.origin}/api/hooks/${'•'.repeat(24)}`}
              </code>
              <button
                type="button"
                onClick={() => setDevoilees((d) => {
                  const n = new Set(d);
                  if (n.has(a.id)) n.delete(a.id); else n.add(a.id);
                  return n;
                })}
                aria-label={devoilee
                  ? (fr ? 'Masquer l’adresse' : 'Hide address')
                  : (fr ? 'Afficher l’adresse' : 'Show address')}
                className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {devoilee ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => copier(a)}
                aria-label={fr ? 'Copier l’adresse' : 'Copy address'}
                className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {copiee === a.id
                  ? <Check size={13} className="text-success" aria-hidden="true" />
                  : <Copy size={13} aria-hidden="true" />}
              </button>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={creer}
        disabled={creation}
        className="inline-flex items-center gap-1.5 rounded-lg border border-outline/50 px-3 py-1.5 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-tertiary disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {creation
          ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          : <Plus size={13} aria-hidden="true" />}
        {fr ? 'Créer une adresse' : 'Create an address'}
      </button>
    </div>
  );
}
