/* ═══════════════════════════════════════════════════════════════
   Un champ de configuration d'action, rendu selon son type.

   Un seul endroit décide de quoi ressemble un champ « choix », un
   « nombre » ou une « bascule ». Le panneau d'édition (PanneauEtape) et
   l'ancien formulaire (AutomationBuilder) l'utilisent tous les deux : un
   type de champ ajouté au catalogue apparaît donc partout du même coup,
   et ne peut pas diverger entre deux écrans.

   Toutes les valeurs sont stockées en TEXTE — c'est ce que `config`
   (jsonb) porte et ce que la validation serveur attend. Une bascule vaut
   la chaîne « true » ou « false », un nombre la chaîne « 250 ».
   ═══════════════════════════════════════════════════════════════ */

import { useId } from 'react';
import type { ChampAction as ModeleChamp } from '../../lib/automationCatalogue';

interface Props {
  champ: ModeleChamp;
  valeur: string;
  onChange: (valeur: string) => void;
  fr: boolean;
  /** Membres de l'org, pour les champs de type `membre`. */
  membres?: Array<{ user_id: string; nom: string }>;
  /** Étiquettes déjà utilisées, proposées en autocomplétion. */
  etiquettes?: string[];
  /** Champs date de la fiche client, pour le type `champ_date`. */
  champsDate?: Array<{ id: string; label: string }>;
  /** Autres automatisations publiées, pour le type `automatisation`. */
  automatisations?: Array<{ id: string; nom: string }>;
}

export default function ChampActionUI({
  champ, valeur, onChange, fr, membres = [], etiquettes = [], champsDate = [],
  automatisations = [],
}: Props) {
  // `useId` plutôt qu'un littéral : ce composant est rendu plusieurs fois
  // sur la même page (une par étape), et deux `id` identiques casseraient
  // le lien `label`/`input` — l'accessibilité et le clic sur le libellé.
  const id = useId();
  const libelle = fr ? champ.fr : champ.en;
  const aide = fr ? champ.aide_fr : champ.aide_en;

  const classeChamp =
    'w-full rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  const contenu = () => {
    switch (champ.type) {
      case 'zone':
        return (
          <textarea
            id={id}
            rows={champ.max && champ.max > 2000 ? 6 : 3}
            maxLength={champ.max}
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            className={classeChamp}
          />
        );

      case 'choix':
        return (
          <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className={classeChamp}>
            <option value="">{fr ? '— Inchangé —' : '— Unchanged —'}</option>
            {(champ.options ?? []).map((o) => (
              <option key={o.cle} value={o.cle}>
                {fr ? o.fr : o.en}
              </option>
            ))}
          </select>
        );

      case 'nombre':
        return (
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={champ.min_valeur}
            max={champ.max_valeur}
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            className={classeChamp}
          />
        );

      case 'bascule':
        // La bascule porte son propre libellé à droite : un interrupteur
        // sans texte à côté oblige à deviner ce qu'il commande.
        return (
          <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
            <input
              id={id}
              type="checkbox"
              checked={valeur === 'true'}
              onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
              className="h-4 w-4 rounded border-border text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span className="text-sm text-text-primary">{libelle}</span>
          </label>
        );

      case 'membre':
        return (
          <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className={classeChamp}>
            <option value="">{fr ? '— Personne —' : '— Nobody —'}</option>
            {membres.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.nom}
              </option>
            ))}
          </select>
        );

      case 'automatisation':
        /*
         * Les autres automatisations PUBLIÉES. Un brouillon n'enverrait
         * rien, et la règle courante est déjà exclue par l'appelant : une
         * automatisation qui se démarre elle-même boucle à l'infini.
         */
        if (automatisations.length === 0) {
          return (
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[13px] text-text-secondary">
              {fr
                ? 'Aucune autre automatisation publiée à démarrer.'
                : 'No other published automation to start.'}
            </p>
          );
        }
        return (
          <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className={classeChamp}>
            <option value="">{fr ? '— Choisir —' : '— Pick one —'}</option>
            {automatisations.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nom}
              </option>
            ))}
          </select>
        );

      case 'champ_date':
        /*
         * Les champs date de la fiche client, propres à l'entreprise.
         *
         * Quand il n'y en a AUCUN, on le dit et on renvoie vers l'écran qui
         * les crée : une liste vide sans explication laisse croire à un
         * bogue, et c'est le seul réglage sans lequel ce déclencheur ne part
         * jamais.
         */
        if (champsDate.length === 0) {
          return (
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[13px] text-text-secondary">
              {fr
                ? 'Aucun champ date sur la fiche client. Créez-en un dans Paramètres → Champs personnalisés.'
                : 'No date field on the client record. Create one in Settings → Custom fields.'}
            </p>
          );
        }
        return (
          <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className={classeChamp}>
            <option value="">{fr ? '— Choisir une date —' : '— Pick a date field —'}</option>
            {champsDate.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        );

      case 'etiquette':
        // Un champ libre AVEC suggestions : les étiquettes existantes sont
        // proposées, mais on peut en créer une nouvelle en la tapant —
        // comme le « + Add New Tag » de GoHighLevel.
        return (
          <>
            <input
              id={id}
              type="text"
              list={`${id}-liste`}
              maxLength={champ.max}
              value={valeur}
              onChange={(e) => onChange(e.target.value)}
              className={classeChamp}
            />
            <datalist id={`${id}-liste`}>
              {etiquettes.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          </>
        );

      case 'url':
        return (
          <input
            id={id}
            type="url"
            placeholder="https://"
            maxLength={champ.max}
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            className={classeChamp}
          />
        );

      default:
        return (
          <input
            id={id}
            type="text"
            maxLength={champ.max}
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            className={classeChamp}
          />
        );
    }
  };

  return (
    <div>
      {champ.type !== 'bascule' && (
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-text-primary">
          {libelle}
          {champ.obligatoire ? (
            <span className="text-red-500"> *</span>
          ) : (
            <span className="font-normal text-text-tertiary"> {fr ? '(facultatif)' : '(optional)'}</span>
          )}
        </label>
      )}
      {contenu()}
      {aide && <p className="mt-1 text-[11px] text-text-tertiary">{aide}</p>}
    </div>
  );
}
