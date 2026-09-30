import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { SaisieChamp } from '@/components/champs/SaisieChamp';
import { Button } from '@/components/ui/Button';
import {
  ChampPerso,
  FicheChamps,
  ObjetChamp,
  ValeurChamp,
  champsVisibles,
  lireChampsEtValeurs,
} from '@/lib/api/customFields';
import type { ResultatEcriture } from '@/lib/api/customFields';
import type { EcritureChampPerso } from '@/lib/offline/registerMutationDefaults';
import { MK } from '@/lib/offline/mutationKeys';
import { useTranslation } from '@/lib/i18n';

/**
 * Champs personnalisés d'une fiche (client, job, devis…) : lecture, édition,
 * enregistrement. Les définitions sont gérées au bureau ; le mobile les affiche
 * et écrit les valeurs par la route serveur, qui garde la validation, l'unicité
 * et les permissions.
 */
export function CustomFieldsCard({ objet, recordId }: { objet: ObjetChamp; recordId: string }) {
  const { t } = useTranslation();
  const c = t.mobileComp;
  const qc = useQueryClient();
  const cle = ['champs-perso', objet, recordId];

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: cle,
    queryFn: () => lireChampsEtValeurs(objet, recordId),
    enabled: !!recordId,
  });

  const champs = useMemo(() => (data ? champsVisibles(data) : []), [data]);

  // Les saisies en cours se SUPERPOSENT à l'instantané du serveur au lieu d'en
  // être une copie : un rafraîchissement (invalidation, retour au premier plan)
  // ne peut donc pas écraser ce que l'utilisateur est en train de taper.
  const [saisies, setSaisies] = useState<Record<string, ValeurChamp>>({});
  const [refus, setRefus] = useState<Record<string, string>>({});

  // Changement de fiche → on repart à zéro (motif React « ajuster un état quand
  // une prop change », pendant le rendu ; pas d'effet, pas de rendu en cascade).
  const [ancre, setAncre] = useState(recordId);
  if (ancre !== recordId) {
    setAncre(recordId);
    setSaisies({});
    setRefus({});
  }

  const valeurDe = (champ: ChampPerso): ValeurChamp =>
    champ.id in saisies ? saisies[champ.id] : (data?.values[champ.id]?.value ?? null);

  // Pas de mutationFn ici : la clé MK.champsPersoEcrire porte celle du registre
  // hors ligne (lib/offline). Conséquence voulue — sans réseau l'écriture est
  // MISE EN FILE au lieu d'échouer, et repart au retour du réseau, même après un
  // redémarrage de l'app. Le rejeu est sûr : la `version` envoyée fait répondre
  // « conflit » plutôt que d'écrire deux fois.
  //
  // La valeur est passée EXPLICITEMENT plutôt que relue dans l'état : sinon il
  // faudrait différer chaque enregistrement d'un tour de rendu pour que la
  // mutation voie la saisie qui vient d'avoir lieu.
  const enregistrer = useMutation<ResultatEcriture[], Error, EcritureChampPerso>({
    // Aucune mutationFn ici : elle vient du registre hors ligne, attachée à
    // cette clé. C'est CE qui rend l'écriture rejouable après un redémarrage —
    // la file ne garde que la clé et les variables, jamais la fonction.
    mutationKey: MK.champsPersoEcrire,
    onSuccess: (resultats, vars) => {
      const resultat = resultats?.[0];
      if (!resultat) return;
      const id = vars.fieldId;
      const oublierSaisie = () =>
        setSaisies((s) => {
          const { [id]: _ignore, ...reste } = s;
          return reste;
        });

      if (resultat.conflict) {
        // Quelqu'un a touché le même champ entre-temps : on reprend la version
        // du serveur plutôt que d'écraser son travail en silence.
        setRefus((r) => ({ ...r, [id]: c.cfConflit }));
        oublierSaisie();
        void qc.invalidateQueries({ queryKey: cle });
        return;
      }
      if (!resultat.ok) {
        // La saisie reste à l'écran : l'utilisateur doit pouvoir la corriger.
        setRefus((r) => ({ ...r, [id]: resultat.erreur ?? c.cfRefus }));
        return;
      }
      setRefus((r) => {
        const { [id]: _ignore, ...reste } = r;
        return reste;
      });
      oublierSaisie();
      void qc.invalidateQueries({ queryKey: cle });
    },
    onError: (e: Error, vars) => setRefus((r) => ({ ...r, [vars.fieldId]: e.message })),
  });

  /** Met une écriture en route (ou en file, si le téléphone est hors ligne). */
  const envoyer = (champ: ChampPerso, valeur: ValeurChamp) =>
    enregistrer.mutate({
      objet,
      recordId,
      fieldId: champ.id,
      valeur,
      version: data?.values[champ.id]?.version ?? null,
    });

  if (isLoading) {
    return (
      <View className="gap-3 rounded-2xl bg-surface p-4">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.customFields}</Text>
        <Text className="text-sm text-ink-muted">{c.loading}</Text>
      </View>
    );
  }

  // Un échec de chargement ne doit JAMAIS faire disparaître la carte sans rien
  // dire : c'est comme ça que la mort des champs est passée inaperçue.
  if (isError) {
    return (
      <View className="gap-3 rounded-2xl bg-surface p-4">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.customFields}</Text>
        <Text className="text-sm text-status-late">{c.cfErreurChargement}</Text>
        <Button title={c.retry} variant="secondary" onPress={() => void refetch()} />
      </View>
    );
  }

  if (champs.length === 0) return null;

  const dossiers = new Map((data as FicheChamps).folders.map((d) => [d.id, d]));
  const groupes = new Map<string, ChampPerso[]>();
  for (const champ of champs) {
    const k = champ.folder_id ?? '';
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k)!.push(champ);
  }
  const ordre = [...groupes.keys()].sort(
    (a, b) => (dossiers.get(a)?.position ?? -1) - (dossiers.get(b)?.position ?? -1),
  );

  const majSaisie = (id: string, v: ValeurChamp) => setSaisies((s) => ({ ...s, [id]: v }));

  return (
    <View className="gap-4 rounded-2xl bg-surface p-4">
      <Text className="text-[10px] font-bold uppercase tracking-widest text-ink-subtle">{c.customFields}</Text>

      {ordre.map((idDossier) => (
        <View key={idDossier || 'sans-dossier'} className="gap-3">
          {dossiers.get(idDossier) ? (
            <Text className="text-xs font-bold uppercase tracking-wide text-ink-muted">
              {dossiers.get(idDossier)!.name}
            </Text>
          ) : null}

          {groupes.get(idDossier)!.map((champ) => (
            <View key={champ.id} className="gap-1.5">
              <Text className="text-sm font-semibold text-ink">
                {champ.label}
                {champ.is_required ? <Text className="text-status-late"> *</Text> : null}
              </Text>
              {champ.help_text ? <Text className="text-xs text-ink-subtle">{champ.help_text}</Text> : null}

              <SaisieChamp
                champ={champ}
                valeur={valeurDe(champ)}
                onChange={(v) => majSaisie(champ.id, v)}
                onValider={(v) => envoyer(champ, v)}
              />

              {refus[champ.id] ? <Text className="text-xs text-status-late">{refus[champ.id]}</Text> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
