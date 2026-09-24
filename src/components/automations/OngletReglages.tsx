/* ═══════════════════════════════════════════════════════════════
   Les réglages d'une automatisation — l'onglet « Settings » de GHL.

   La différence avec eux : chez GoHighLevel, ces réglages sont des cases à
   cocher vides qu'il faut penser à configurer. Ici, chaque réglage AFFICHE
   D'ABORD ce que le moteur fait déjà, et ne sert qu'à s'en écarter. Une
   automatisation qu'on ne touche jamais se comporte bien.

   C'est pour ça que `settings` reste NULL tant que rien n'est changé.
   ═══════════════════════════════════════════════════════════════ */

import React, { useId, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { modifierAutomatisation } from '../../lib/automationBuilderApi';

export interface ReglagesAutomatisation {
  reentree?: boolean;
  arret_sur_reponse?: boolean;
  fenetre?: { debut: number; fin: number };
  jours_ouvrables?: boolean;
  marquer_lu?: boolean;
}

interface Props {
  ruleId: string;
  reglages: ReglagesAutomatisation | null;
  fr: boolean;
  /** Prévenir le parent pour qu'il garde l'objet à jour. */
  onChange: (r: ReglagesAutomatisation | null) => void;
}

/** Un interrupteur avec son explication — le défaut du moteur est annoncé. */
function Interrupteur({
  id, titre, aide, valeur, defaut, onBascule,
}: {
  id: string; titre: string; aide: string;
  valeur: boolean; defaut: string; onBascule: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-outline/20 py-3.5 last:border-0">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-[13px] font-medium text-text-primary">
          {titre}
        </label>
        <p className="mt-0.5 text-[12px] text-text-secondary">{aide}</p>
        <p className="mt-0.5 text-[11px] text-text-tertiary">{defaut}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={valeur}
        onClick={() => onBascule(!valeur)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          valeur ? 'bg-accent' : 'bg-surface-tertiary',
        )}
      >
        <span className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
          valeur ? 'left-[1.125rem]' : 'left-0.5',
        )} />
      </button>
    </div>
  );
}

export default function OngletReglages({ ruleId, reglages, fr, onChange }: Props) {
  const ids = useId();
  const [local, setLocal] = useState<ReglagesAutomatisation>(reglages ?? {});
  const [enregistre, setEnregistre] = useState(false);
  const [aJour, setAJour] = useState(true);

  /**
   * Applique un changement et l'enregistre.
   *
   * Un objet vide redevient `null` : une automatisation dont on a remis tous
   * les réglages par défaut ne doit pas garder un `{}` en base, sinon on ne
   * distingue plus « jamais touché » de « remis comme avant ».
   */
  const appliquer = async (patch: Partial<ReglagesAutomatisation>) => {
    const suivant = { ...local, ...patch };
    // Retirer les clés remises à leur valeur par défaut.
    for (const [k, v] of Object.entries(suivant)) {
      if (v === false || v === undefined) delete (suivant as Record<string, unknown>)[k];
    }
    const vide = Object.keys(suivant).length === 0;
    setLocal(suivant);
    setAJour(false);
    setEnregistre(true);
    try {
      await modifierAutomatisation(ruleId, { settings: vide ? null : suivant });
      onChange(vide ? null : suivant);
      setAJour(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      setLocal(local);
    } finally {
      setEnregistre(false);
    }
  };

  const fenetre = local.fenetre ?? { debut: 8, fin: 20 };
  const fenetrePersonnalisee = Boolean(local.fenetre);

  return (
    <div className="mx-auto max-w-[760px] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">
            {fr ? 'Réglages de cette automatisation' : 'This automation’s settings'}
          </h2>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            {fr
              ? 'Les valeurs par défaut conviennent à presque tout le monde. On n’y touche que pour s’en écarter.'
              : 'The defaults suit almost everyone. You only touch these to depart from them.'}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-text-tertiary">
          {enregistre
            ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />{fr ? 'Enregistrement…' : 'Saving…'}</span>
            : aJour
              ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" aria-hidden="true" />{fr ? 'Enregistré' : 'Saved'}</span>
              : null}
        </span>
      </div>

      {/* ── Le client ── */}
      <section className="section-card mb-3 px-4 py-1">
        <h3 className="border-b border-outline/20 py-3 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
          {fr ? 'Le client' : 'Contact'}
        </h3>

        <Interrupteur
          id={`${ids}-reentree`}
          titre={fr ? 'Laisser le client repasser' : 'Allow re-entry'}
          aide={fr
            ? 'Le même client peut entrer plusieurs fois dans ce parcours — utile pour un service saisonnier qui revient chaque année.'
            : 'The same client can enter this path more than once — useful for a seasonal service.'}
          defaut={fr
            ? 'Par défaut : une seule fois par devis, facture ou job. Un client qui redemande un service repasse quand même, puisque c’est un nouveau devis.'
            : 'Default: once per quote, invoice or job.'}
          valeur={local.reentree === true}
          onBascule={(v) => appliquer({ reentree: v })}
        />

        <Interrupteur
          id={`${ids}-arret`}
          titre={fr ? 'Arrêter si le client répond' : 'Stop on response'}
          aide={fr
            ? 'Le client sort du parcours dès qu’il répond à un message — on ne relance pas quelqu’un qui a déjà réagi.'
            : 'The client leaves the path as soon as they reply — no follow-up for someone who already answered.'}
          defaut={fr
            ? 'Déjà en place autrement : le parcours s’arrête quand la facture est payée, le devis accepté ou le rendez-vous annulé.'
            : 'Already in place: the path stops when the invoice is paid or the quote accepted.'}
          valeur={local.arret_sur_reponse === true}
          onBascule={(v) => appliquer({ arret_sur_reponse: v })}
        />
      </section>

      {/* ── Quand les messages partent ── */}
      <section className="section-card mb-3 px-4 py-1">
        <h3 className="border-b border-outline/20 py-3 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
          {fr ? 'Quand les messages partent' : 'When messages go out'}
        </h3>

        <div className="border-b border-outline/20 py-3.5">
          <p className="text-[13px] font-medium text-text-primary">
            {fr ? 'Fenêtre d’envoi' : 'Send window'}
          </p>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            {fr
              ? 'Aucun message ne part en dehors de ces heures : il attend la prochaine ouverture.'
              : 'No message goes out outside these hours: it waits for the next opening.'}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label htmlFor={`${ids}-debut`} className="text-[12px] text-text-secondary">
              {fr ? 'De' : 'From'}
            </label>
            <select
              id={`${ids}-debut`}
              value={fenetre.debut}
              onChange={(e) => appliquer({ fenetre: { ...fenetre, debut: Number(e.target.value) } })}
              className="glass-input py-1 text-[12px]"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h} disabled={h >= fenetre.fin}>{`${h} h`}</option>
              ))}
            </select>
            <label htmlFor={`${ids}-fin`} className="text-[12px] text-text-secondary">
              {fr ? 'à' : 'to'}
            </label>
            <select
              id={`${ids}-fin`}
              value={fenetre.fin}
              onChange={(e) => appliquer({ fenetre: { ...fenetre, fin: Number(e.target.value) } })}
              className="glass-input py-1 text-[12px]"
            >
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h} disabled={h <= fenetre.debut}>{`${h} h`}</option>
              ))}
            </select>
            {fenetrePersonnalisee && (
              <button
                type="button"
                onClick={() => appliquer({ fenetre: undefined })}
                className="text-[11px] text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {fr ? 'Revenir à 8 h – 20 h' : 'Back to 8 – 20'}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-text-tertiary">
            {fr
              ? 'Par défaut : 8 h – 20 h, heure du Québec. C’est la loi du bon sens, pas une obligation légale — mais un texto à 22 h fait perdre des clients.'
              : 'Default: 8 – 20, Québec time.'}
          </p>
        </div>

        <Interrupteur
          id={`${ids}-ouvrables`}
          titre={fr ? 'Jours ouvrables seulement' : 'Business days only'}
          aide={fr
            ? 'Rien ne part le samedi ni le dimanche : un message prêt la fin de semaine attend le lundi matin.'
            : 'Nothing goes out on weekends: a message ready on Saturday waits for Monday morning.'}
          defaut={fr ? 'Par défaut : tous les jours.' : 'Default: every day.'}
          valeur={local.jours_ouvrables === true}
          onBascule={(v) => appliquer({ jours_ouvrables: v })}
        />
      </section>

      {/* ── Boîte de réception ── */}
      <section className="section-card px-4 py-1">
        <h3 className="border-b border-outline/20 py-3 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
          {fr ? 'Boîte de réception' : 'Conversations'}
        </h3>
        <Interrupteur
          id={`${ids}-lu`}
          titre={fr ? 'Marquer comme lu' : 'Mark as read'}
          aide={fr
            ? 'Les messages envoyés par cette automatisation ne remontent pas en non-lus dans vos conversations.'
            : 'Messages sent by this automation do not show up as unread in your conversations.'}
          defaut={fr ? 'Par défaut : ils apparaissent comme tout message envoyé.' : 'Default: they appear like any sent message.'}
          valeur={local.marquer_lu === true}
          onBascule={(v) => appliquer({ marquer_lu: v })}
        />
      </section>
    </div>
  );
}
