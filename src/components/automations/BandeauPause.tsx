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

import React, { useEffect, useRef, useState } from 'react';
import { PauseCircle, PlayCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { confirmerSansDoubleClic } from './confirmerSansDoubleClic';
import { lireEtatPause, basculerPause } from '../../lib/automationWebhooksApi';

/**
 * Espace insécable (U+00A0) devant « : » et « ? » dans le dialogue : avec une
 * espace ordinaire, la ligne se coupait juste avant et le signe partait seul
 * au début de la suivante (audit du 2026-10-01). Écrite par son code : le
 * caractère lui-même est invisible dans un éditeur.
 */
const INSECABLE = String.fromCharCode(0xa0);

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
  /**
   * La lecture de l'état a échoué. Avant, on n'affichait alors RIEN : le
   * bouton d'urgence « Tout arrêter » disparaissait sans un mot, et un bureau
   * réellement en pause ne le voyait plus (audit du 2026-10-01). On le dit,
   * on offre de réessayer, et l'arrêt d'urgence reste sous la main.
   */
  const [illisible, setIllisible] = useState(false);
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let vivant = true;
    lireEtatPause()
      .then((e) => { if (vivant) { setIllisible(false); setEnPause(e.paused); } })
      .catch((e: unknown) => {
        console.error('[BandeauPause] état de la pause illisible', e);
        if (vivant) { setEnPause(null); setIllisible(true); }
      });
    return () => { vivant = false; };
  }, [essai]);

  /** Une confirmation déjà à l'écran : une seconde activation n'en empile pas une autre. */
  const confirmationOuverte = useRef(false);

  async function basculer(vers: boolean) {
    if (vers) {
      if (confirmationOuverte.current) return;
      confirmationOuverte.current = true;
      let ok = false;
      try {
        /*
         * Double clic sur « Tout arrêter » (audit du 2026-10-01) : le second
         * clic tombait sur le fond du dialogue et l'annulait — le dialogue
         * clignotait et rien ne se passait, sur le bouton d'urgence.
         */
        ok = await confirmerSansDoubleClic({
          title: fr ? `Arrêter toutes vos automatisations${INSECABLE}?` : 'Pause all your automations?',
          /*
           * On dit ce qui s'arrête ET ce qui est préservé. Sans la seconde
           * phrase, personne n'ose cliquer en urgence — et un interrupteur
           * qu'on n'ose pas utiliser ne sert à rien.
           */
          message: fr
            ? `Plus aucun courriel ni texto ne partira automatiquement, et aucune tâche ne sera créée. Ce qui est déjà prévu est CONSERVÉ${INSECABLE}: en reprenant, tout repart où c’en était.`
            : 'No automatic email or text will go out, and no task will be created. What is already scheduled is KEPT: when you resume, everything picks up where it left off.',
          confirmLabel: fr ? 'Tout arrêter' : 'Pause everything',
          danger: true,
        });
      } finally {
        confirmationOuverte.current = false;
      }
      if (!ok) return;
    }

    setOccupe(true);
    const avant = enPause;
    try {
      // L'état affiché est celui RELU de la base (launch 2026-09-28) : avant,
      // l'écran disait « en pause » dès le clic, même quand rien n'avait été
      // arrêté (rôle sans le droit).
      const reel = await basculerPause(vers);
      setIllisible(false);
      setEnPause(reel.paused);
      if (reel.paused === vers) {
        toast.success(vers
          ? (fr ? 'Automatisations en pause.' : 'Automations paused.')
          : (fr ? 'Automatisations reprises.' : 'Automations resumed.'));
      } else {
        toast.error(fr ? 'Le changement n’a pas été appliqué.' : 'The change was not applied.');
      }
    } catch (e) {
      console.error('[BandeauPause] bascule de la pause', e);
      setEnPause(avant);
      toast.error(e instanceof Error && e.message ? e.message : (fr ? 'Changement non enregistré.' : 'Change not saved.'));
    } finally {
      setOccupe(false);
    }
  }

  // Lecture échouée : on le dit, sans retirer l'arrêt d'urgence.
  if (enPause === null && illisible) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-3 text-[12px] text-text-tertiary" role="status">
        <span>
          {fr
            ? 'Impossible de savoir si vos automatisations sont en pause pour le moment.'
            : 'Cannot tell right now whether your automations are paused.'}
        </span>
        <button
          type="button"
          onClick={() => setEssai((n) => n + 1)}
          className="underline decoration-dotted underline-offset-2 transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Réessayer' : 'Try again'}
        </button>
        <button
          type="button"
          onClick={() => basculer(true)}
          disabled={occupe}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-danger disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <PauseCircle size={13} aria-hidden="true" />
          {fr ? 'Tout arrêter' : 'Pause everything'}
        </button>
      </div>
    );
  }
  // Pas encore lu : rien (l'état arrive en une fraction de seconde).
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
        // Au doigt (tablette), 18 px de haut se ratent : le bouton d'urgence
        // gagne de la marge quand le pointeur est grossier, rien ne change à la souris.
        className="inline-flex items-center gap-1.5 rounded text-[12px] text-text-tertiary transition-colors hover:text-danger disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent pointer-coarse:px-2 pointer-coarse:py-2"
      >
        <PauseCircle size={13} aria-hidden="true" />
        {fr ? 'Tout arrêter' : 'Pause everything'}
      </button>
    </div>
  );
}
