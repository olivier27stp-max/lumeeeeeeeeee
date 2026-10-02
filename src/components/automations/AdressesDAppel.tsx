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
   peut appeler. Depuis le launch (2026-09-28), elle n'est MONTRÉE qu'une
   fois — juste après la création ou la régénération. Perdue ? On la
   régénère (l'ancienne adresse cesse de fonctionner).
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Copy, Check, Eye, EyeOff, Plus, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { confirmer } from '../ui/ConfirmDialog';
import {
  listerAdressesDAppel, creerAdresseDAppel, basculerAdresseDAppel,
  supprimerAdresseDAppel, regenererAdresseDAppel, type AdresseDAppel,
} from '../../lib/automationWebhooksApi';

/** L'URL complète que l'utilisateur colle chez son fournisseur. */
function urlComplete(cle: string): string {
  return `${window.location.origin}/api/hooks/${cle}`;
}

export default function AdressesDAppel({ fr }: { fr: boolean }) {
  const [adresses, setAdresses] = useState<AdresseDAppel[]>([]);
  const [chargement, setChargement] = useState(true);
  /** La lecture a échoué : on ne sait PAS s'il y a des adresses — on ne dit donc pas « aucune ». */
  const [lectureRatee, setLectureRatee] = useState(false);
  const [essaiLecture, setEssaiLecture] = useState(0);
  const [creation, setCreation] = useState(false);
  const [devoilees, setDevoilees] = useState<Set<string>>(new Set());
  const [copiee, setCopiee] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    listerAdressesDAppel()
      .then((l) => { if (vivant) { setAdresses(l); setLectureRatee(false); } })
      .catch(() => {
        if (vivant) {
          setLectureRatee(true);
          toast.error(fr ? 'Impossible de lire vos adresses d’appel.' : 'Could not load your addresses.');
        }
      })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [fr, essaiLecture]);

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

  async function regenerer(a: AdresseDAppel) {
    const ok = await confirmer({
      title: fr ? 'Régénérer cette adresse ?' : 'Regenerate this address?',
      message: fr
        ? 'Une nouvelle adresse sera créée et affichée une seule fois. L’ancienne cessera immédiatement de déclencher vos automatisations : il faudra coller la nouvelle chez votre fournisseur.'
        : 'A new address will be created and shown once. The old one will stop triggering your automations immediately: paste the new one at your provider.',
      confirmLabel: fr ? 'Régénérer' : 'Regenerate',
      danger: true,
    });
    if (!ok) return;
    try {
      const nouvelle = await regenererAdresseDAppel(a.id);
      setAdresses((l) => l.map((x) => (x.id === a.id ? nouvelle : x)));
      setDevoilees((d) => new Set(d).add(a.id));
      toast.success(fr ? 'Nouvelle adresse : copiez-la maintenant, elle ne sera plus affichée.' : 'New address: copy it now, it will not be shown again.');
    } catch (e) {
      console.error('[AdressesDAppel] régénération', e);
      toast.error(e instanceof Error && e.message ? e.message : (fr ? 'Régénération impossible.' : 'Could not regenerate.'));
    }
  }

  async function copier(a: AdresseDAppel) {
    if (!a.api_key) return;
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

  /*
   * DEUX CLICS RAPPROCHÉS (triage « modèles », 06-reglages-globaux:299).
   *
   * Pause puis reprise, coup sur coup : si le premier appel traîne, le second
   * passe devant lui, puis le premier arrive et l'écrase. L'écran finissait sur
   * « Active » pendant que la base contenait `enabled = false` — une adresse en
   * pause sans que personne le voie, donc un formulaire de site qui ne déclenche
   * plus rien.
   *
   * Tant que des bascules sont en route, l'écran montre le dernier clic. Quand
   * la dernière est revenue ET que des appels se sont chevauchés, on RELIT la
   * base : l'écran affiche ce qu'elle contient, et le dit si ce n'est pas ce
   * qu'on venait de demander.
   */
  const bascules = useRef(new Map<string, { enRoute: number; croisees: boolean; voulu: boolean }>());

  async function basculer(a: AdresseDAppel) {
    const vise = !a.enabled;
    const suivi = bascules.current.get(a.id) ?? { enRoute: 0, croisees: false, voulu: vise };
    if (suivi.enRoute > 0) suivi.croisees = true;
    suivi.enRoute += 1;
    suivi.voulu = vise; // le dernier clic : ce que la personne veut
    bascules.current.set(a.id, suivi);

    setAdresses((l) => l.map((x) => (x.id === a.id ? { ...x, enabled: vise } : x)));
    let echec = false;
    try {
      await basculerAdresseDAppel(a.id, vise);
    } catch {
      echec = true;
      toast.error(fr ? 'Changement non enregistré.' : 'Change not saved.');
    }

    suivi.enRoute -= 1;
    if (suivi.enRoute > 0) return; // un clic plus récent est encore en route : c'est lui qui conclura
    bascules.current.delete(a.id);

    if (!suivi.croisees) {
      // Un seul appel : on sait ce que la base contient.
      if (echec) setAdresses((l) => l.map((x) => (x.id === a.id ? { ...x, enabled: a.enabled } : x)));
      return;
    }
    // Des appels se sont chevauchés : seul le serveur sait lequel est arrivé en dernier.
    try {
      const enBase = (await listerAdressesDAppel()).find((x) => x.id === a.id);
      if (!enBase) return;
      setAdresses((l) => l.map((x) => (x.id === a.id ? { ...x, enabled: enBase.enabled } : x)));
      if (enBase.enabled !== suivi.voulu) {
        toast.error(enBase.enabled
          ? (fr ? 'Vos clics se sont croisés : l’adresse est restée active. Cliquez de nouveau pour la mettre en pause.' : 'Your clicks crossed: the address is still active. Click again to pause it.')
          : (fr ? 'Vos clics se sont croisés : l’adresse est en pause. Cliquez de nouveau pour la remettre en service.' : 'Your clicks crossed: the address is paused. Click again to turn it back on.'));
      }
    } catch (e: unknown) {
      console.error('[AdressesDAppel] relecture après bascule', e);
      toast.error(fr ? 'Impossible de relire l’état de l’adresse : rechargez la page.' : 'Could not re-read the address state: reload the page.');
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
      {/* Lecture en panne : la carte disait « Aucune adresse pour l'instant »
          alors qu'il en existait une — on aurait cru devoir en recréer
          (06-reglages-globaux:467). */}
      {lectureRatee && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-secondary px-3 py-2 text-[12px] text-text-secondary">
          <span>
            {fr
              ? 'Vos adresses d’appel n’ont pas pu être lues pour le moment : celles qui existent fonctionnent toujours.'
              : 'Your addresses could not be read right now: the existing ones still work.'}
          </span>
          <button
            type="button"
            onClick={() => setEssaiLecture((n) => n + 1)}
            className="font-medium text-accent underline underline-offset-2 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {fr ? 'Réessayer' : 'Try again'}
          </button>
        </div>
      )}

      {!lectureRatee && adresses.length === 0 && (
        <p className="text-[12px] text-text-secondary">
          {fr
            ? 'Aucune adresse pour l’instant. Créez-en une, puis collez-la dans votre formulaire, Zapier ou Facebook Leads.'
            : 'No address yet. Create one, then paste it into your form, Zapier or Facebook Leads.'}
        </p>
      )}

      {adresses.map((a) => {
        // La clé complète n'est connue que juste après création / régénération.
        const cleConnue = !!a.api_key;
        const devoilee = cleConnue && devoilees.has(a.id);
        const url = a.api_key ? urlComplete(a.api_key) : '';
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
                {devoilee ? url : `${window.location.origin}/api/hooks/${a.cle_masquee}`}
              </code>
              {cleConnue ? (<>
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
              </>) : (
                <button
                  type="button"
                  onClick={() => regenerer(a)}
                  className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <RefreshCw size={12} aria-hidden="true" />
                  {fr ? 'Régénérer' : 'Regenerate'}
                </button>
              )}
            </div>
            {cleConnue && (
              <p className="mt-1.5 text-[11px] text-text-tertiary">
                {fr ? 'Copiez-la maintenant : elle ne sera plus affichée.' : 'Copy it now: it will not be shown again.'}
              </p>
            )}
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
