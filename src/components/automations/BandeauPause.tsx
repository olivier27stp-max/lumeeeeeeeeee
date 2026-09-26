/* ═══════════════════════════════════════════════════════════════
   TOUT ARRÊTER — l'interrupteur du client.

   Le jour où une entreprise voit partir des messages qu'elle ne veut pas
   — import massif qui déclenche tout, gabarit qui part de travers,
   campagne lancée trop tôt — elle n'avait aucun moyen d'arrêter.
   Désactiver 43 automatisations une par une prend des minutes ; un envoi
   en rafale aussi. Et ce qui est parti est parti : chaque texto est
   facturé, et lu par un vrai client.

   POURQUOI ICI. Sur la page où l'on voit ses automatisations, pas enfoui
   dans les réglages : on cherche ce bouton en panique, pas en explorant.

   DEUX ÉTATS, DEUX POIDS. En marche, c'est un lien discret — il ne doit
   pas inviter au clic. En pause, c'est un bandeau impossible à manquer :
   une entreprise qui oublie que ses automatisations dorment perd des
   relances pendant des jours sans comprendre pourquoi.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import { PauseCircle, PlayCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { confirmer } from '../ui/ConfirmDialog';
import { lireEtatPause, basculerPause } from '../../lib/automationWebhooksApi';

export default function BandeauPause({
  fr,
  onChange,
}: {
  fr: boolean;
  /** Prévient la page, pour que chaque ligne affiche « En pause » (P2-9). */
  onChange?: (enPause: boolean) => void;
}) {
  const [enPause, setEnPauseLocal] = useState<boolean | null>(null);
  const setEnPause = (v: boolean | null) => {
    setEnPauseLocal(v);
    if (v !== null) onChange?.(v);
  };
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    let vivant = true;
    lireEtatPause()
      .then((e) => { if (vivant) setEnPause(e.paused); })
      // Silence volontaire : si l'état est illisible, on n'affiche rien
      // plutôt qu'une erreur en haut de la page. Le reste fonctionne.
      .catch(() => { if (vivant) setEnPause(null); });
    return () => { vivant = false; };
  }, []);

  async function basculer(vers: boolean) {
    if (vers) {
      const ok = await confirmer({
        title: fr ? 'Arrêter toutes vos automatisations ?' : 'Pause all your automations?',
        /*
         * On dit ce qui s'arrête ET ce qui est préservé. Sans la seconde
         * phrase, personne n'ose cliquer en urgence — et un interrupteur
         * qu'on n'ose pas utiliser ne sert à rien.
         */
        message: fr
          ? 'Plus aucun courriel ni texto ne partira automatiquement, et aucune tâche ne sera créée. Ce qui est déjà prévu est CONSERVÉ : en reprenant, tout repart où c’en était.'
          : 'No automatic email or text will go out, and no task will be created. What is already scheduled is KEPT: when you resume, everything picks up where it left off.',
        confirmLabel: fr ? 'Tout arrêter' : 'Pause everything',
        danger: true,
      });
      if (!ok) return;
    }

    setOccupe(true);
    const avant = enPause;
    setEnPause(vers);
    try {
      await basculerPause(vers);
      toast.success(vers
        ? (fr ? 'Automatisations en pause.' : 'Automations paused.')
        : (fr ? 'Automatisations reprises.' : 'Automations resumed.'));
    } catch {
      setEnPause(avant);
      toast.error(fr ? 'Changement non enregistré.' : 'Change not saved.');
    } finally {
      setOccupe(false);
    }
  }

  // État inconnu (lecture échouée) : on n'affiche rien.
  if (enPause === null) return null;

  if (enPause) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger-light px-4 py-3">
        <span className="flex items-start gap-2 text-[13px] text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <strong className="font-semibold">
              {fr ? 'Vos automatisations sont en pause.' : 'Your automations are paused.'}
            </strong>{' '}
            {fr
              ? 'Aucun courriel ni texto ne part. Ce qui était prévu est conservé.'
              : 'No email or text is going out. What was scheduled is kept.'}
          </span>
        </span>
        <button
          type="button"
          onClick={() => basculer(false)}
          disabled={occupe}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <PlayCircle size={14} aria-hidden="true" />
          {fr ? 'Reprendre' : 'Resume'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={() => basculer(true)}
        disabled={occupe}
        className="inline-flex items-center gap-1.5 text-[12px] text-text-tertiary transition-colors hover:text-danger disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <PauseCircle size={13} aria-hidden="true" />
        {fr ? 'Tout arrêter' : 'Pause everything'}
      </button>
    </div>
  );
}
