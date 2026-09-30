/**
 * Les champs personnalisés DANS un formulaire de création (client, job, devis,
 * facture) — miroir mobile de src/components/champs/creation.tsx du web.
 *
 *   const champs = useChampsCreation('job');
 *   // rendu :    {champs.bloc}
 *   // avant de créer : const err = champs.valider(); if (err) { Alert…; return; }
 *   // après :          await champs.enregistrer(nouvelId);
 *
 * Pourquoi en deux temps : une valeur de champ a besoin de l'id de la fiche
 * (`custom_field_values.job_id`), qui n'existe pas encore pendant le formulaire.
 * Le web fait exactement pareil.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { SaisieChamp } from '@/components/champs/SaisieChamp';
import {
  ChampPerso,
  ObjetChamp,
  ValeurChamp,
  champsDeCreation,
  ecrireValeurs,
  listerChamps,
  valeurParDefaut,
  valeurVide,
} from '@/lib/api/customFields';
import { useTranslation } from '@/lib/i18n';

export interface ChampsCreation {
  /** À insérer dans le formulaire. `null` s'il n'y a aucun champ à remplir. */
  bloc: React.ReactNode;
  /** Première erreur bloquante, ou null. À appeler AVANT de créer la fiche. */
  valider: () => string | null;
  /** Écrit les valeurs sur la fiche créée. Ne lève jamais. */
  enregistrer: (entityId: string | null | undefined) => Promise<void>;
  actif: boolean;
}

export function useChampsCreation(objet: ObjetChamp): ChampsCreation {
  const { t } = useTranslation();
  const c = t.mobileComp;

  const { data } = useQuery({
    queryKey: ['champs-perso', 'definitions', objet],
    queryFn: () => listerChamps(objet),
    staleTime: 60_000,
  });
  // Stabilisé : sans ça la liste est un nouveau tableau à chaque rendu et
  // l'effet de pré-remplissage repart en boucle.
  const champs = useMemo(() => (data ? champsDeCreation(data.fields) : []), [data]);

  const [valeurs, setValeurs] = useState<Record<string, ValeurChamp>>({});
  // Le bouton « Créer » est pressé dans le MÊME événement que le blur du dernier
  // champ texte : l'état React n'est pas encore rendu et la closure verrait
  // l'ancienne valeur. La ref, elle, est à jour. (Même raison que sur le web.)
  const courant = useRef<Record<string, ValeurChamp>>({});
  const poser = (id: string, v: ValeurChamp) => {
    courant.current = { ...courant.current, [id]: v };
    setValeurs(courant.current);
  };

  // Valeur par défaut du bureau : posée une seule fois par champ, sans jamais
  // écraser ce que l'usager a déjà tapé.
  const preremplis = useRef(new Set<string>());
  useEffect(() => {
    let change = false;
    for (const champ of champs) {
      if (preremplis.current.has(champ.id)) continue;
      preremplis.current.add(champ.id);
      if (champ.id in courant.current) continue;
      const v = valeurParDefaut(champ);
      if (valeurVide(v)) continue;
      courant.current = { ...courant.current, [champ.id]: v };
      change = true;
    }
    if (change) setValeurs({ ...courant.current });
  }, [champs]);

  /**
   * On ne valide ici QUE l'obligatoire manquant : c'est une porte d'usage, pas
   * une règle. Le format, les bornes et l'unicité restent au serveur, qui est la
   * seule autorité — dupliquer ses règles ici les ferait dériver. Conséquence
   * assumée : une valeur mal formée n'est refusée qu'à l'écriture, après la
   * création de la fiche, et le refus est alors affiché.
   */
  const valider = (): string | null => {
    for (const champ of champs) {
      if (champ.is_required && valeurVide(courant.current[champ.id])) {
        return c.cfObligatoire.replace('{champ}', champ.label);
      }
    }
    return null;
  };

  /** La fiche existe déjà : un refus est signalé, jamais bloquant. */
  const enregistrer = async (entityId: string | null | undefined): Promise<void> => {
    if (!entityId) return;
    const ecritures = champs
      .filter((champ) => !valeurVide(courant.current[champ.id]))
      .map((champ) => ({ field_id: champ.id, value: courant.current[champ.id] }));
    if (ecritures.length === 0) return;
    try {
      const resultats = await ecrireValeurs(objet, entityId, ecritures);
      const refus = resultats.filter((r) => !r.ok);
      if (refus.length) {
        // Pas d'Alert ici : la fiche est créée, l'écran va naviguer. On journalise
        // pour que ça remonte au serveur (lib/erreurs via le MutationCache n'est
        // pas sur ce chemin).
        console.error('[champs] refus à la création :', refus.map((r) => r.erreur).filter(Boolean).join(' · '));
      }
    } catch (e) {
      console.error('[champs] valeurs non enregistrées après création', e);
    }
  };

  const bloc =
    champs.length === 0 ? null : (
      <View className="gap-3">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.customFields}</Text>
        {champs.map((champ: ChampPerso) => (
          <View key={champ.id} className="gap-1.5">
            <Text className="text-sm font-semibold text-ink">
              {champ.label}
              {champ.is_required ? <Text className="text-status-late"> *</Text> : null}
            </Text>
            {champ.help_text ? <Text className="text-xs text-ink-subtle">{champ.help_text}</Text> : null}
            <SaisieChamp
              champ={champ}
              valeur={valeurs[champ.id] ?? null}
              onChange={(v) => poser(champ.id, v)}
            />
          </View>
        ))}
      </View>
    );

  return { bloc, valider, enregistrer, actif: champs.length > 0 };
}
