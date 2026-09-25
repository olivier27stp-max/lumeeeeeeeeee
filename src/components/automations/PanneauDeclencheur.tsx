/* ═══════════════════════════════════════════════════════════════
   Le panneau de réglage du DÉCLENCHEUR.

   Certains déclencheurs ne se suffisent pas à eux-mêmes. « Facture
   payée » se comprend seul ; « Date atteinte » ne veut rien dire tant
   qu'on n'a pas dit QUELLE date surveiller et combien de jours avant.

   Sans cet écran, ces réglages n'étaient saisissables NULLE PART : la
   règle se publiait, s'affichait comme active, et le balayage quotidien
   passait son chemin faute de `champ_id`. Une automatisation qui ne part
   jamais, sans un mot — l'échec le plus coûteux parce qu'il ne se voit pas.

   ── Même mécanique que le panneau d'étape ──────────────────────
   Brouillon local, « Annuler » qui annule vraiment, et les champs rendus
   par `ChampAction` — donc un type de champ ajouté au catalogue apparaît
   ici du même coup, sans code en double.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { X, Zap } from 'lucide-react';
import type { DeclencheurCatalogue } from '../../lib/automationCatalogue';
import { champVisible } from '../../lib/automationCatalogue';
import ChampActionUI from './ChampAction';

interface Props {
  declencheur: DeclencheurCatalogue;
  /** Les `conditions` de la règle — là où vivent ces réglages. */
  conditions: Record<string, unknown> | null;
  fr: boolean;
  /** Champs date de la fiche client, pour le type `champ_date`. */
  champsDate: Array<{ id: string; label: string }>;
  onEnregistrer: (conditions: Record<string, unknown>) => void;
  onFermer: () => void;
}

export default function PanneauDeclencheur({
  declencheur, conditions, fr, champsDate, onEnregistrer, onFermer,
}: Props) {
  /*
   * Le brouillon : toutes les valeurs en TEXTE, comme les champs d'action.
   * La conversion vers le type final se fait à l'enregistrement, au même
   * endroit que la validation — jamais à chaque frappe.
   */
  const [brouillon, setBrouillon] = useState<Record<string, string>>({});

  // Clé sur `cle` du déclencheur, PAS sur l'objet : dépendre de l'objet
  // relancerait l'effet à chaque rendu du parent et effacerait la saisie
  // en cours.
  useEffect(() => {
    const init: Record<string, string> = {};
    for (const champ of declencheur.champs ?? []) {
      const v = conditions?.[champ.cle];
      init[champ.cle] = v === undefined || v === null ? '' : String(v);
    }
    setBrouillon(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declencheur.cle]);

  const champs = declencheur.champs ?? [];

  /** Ce qui manque encore — le bouton reste actif, le message est clair. */
  const manquants = champs.filter(
    (c) => c.obligatoire && champVisible(c, brouillon) && !String(brouillon[c.cle] ?? '').trim(),
  );

  const enregistrer = () => {
    /*
     * On repart des conditions EXISTANTES : une règle peut porter des
     * conditions qui ne viennent pas de ce panneau (filtres d'un « si »,
     * réglages d'une version antérieure). Les écraser ferait disparaître
     * des réglages que personne n'a demandé à supprimer.
     */
    const sortie: Record<string, unknown> = { ...(conditions ?? {}) };
    for (const champ of champs) {
      const brut = String(brouillon[champ.cle] ?? '').trim();
      if (!brut || !champVisible(champ, brouillon)) {
        delete sortie[champ.cle];
        continue;
      }
      // `nombre` part en NOMBRE : le balayage fait `Number(...)`, et une
      // chaîne vide y devient 0 sans qu'on s'en aperçoive.
      sortie[champ.cle] = champ.type === 'nombre' ? Number(brut) : brut;
    }
    onEnregistrer(sortie);
  };

  return (
    <aside
      aria-label={fr ? 'Réglages du déclencheur' : 'Trigger settings'}
      className="flex w-[380px] shrink-0 flex-col border-l border-border bg-surface-card"
    >
      <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Zap className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-primary">
            {fr ? declencheur.fr : declencheur.en}
          </span>
          <span className="block text-[11px] text-text-secondary">
            {fr ? declencheur.aide_fr : declencheur.aide_en}
          </span>
        </span>
        <button
          type="button"
          onClick={onFermer}
          aria-label={fr ? 'Fermer' : 'Close'}
          className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {champs.map((champ) =>
          champVisible(champ, brouillon) ? (
            <ChampActionUI
              key={champ.cle}
              champ={champ}
              valeur={brouillon[champ.cle] ?? ''}
              onChange={(v) => setBrouillon((p) => ({ ...p, [champ.cle]: v }))}
              fr={fr}
              champsDate={champsDate}
            />
          ) : null,
        )}

        {manquants.length > 0 && (
          <p className="rounded-lg border border-warning/40 bg-warning-light px-3 py-2 text-[12px] text-warning">
            {fr
              ? `Sans « ${manquants.map((c) => c.fr).join(' », « ')} », l’automatisation ne partirait jamais.`
              : `Without “${manquants.map((c) => c.en).join('”, “')}”, the automation would never run.`}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={onFermer}
          className="rounded-lg px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {fr ? 'Annuler' : 'Cancel'}
        </button>
        <button type="button" onClick={enregistrer} className="glass-button-primary text-[13px]">
          {fr ? 'Enregistrer' : 'Save'}
        </button>
      </div>
    </aside>
  );
}
