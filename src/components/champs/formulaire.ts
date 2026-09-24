/**
 * Champs personnalisés qu'une réponse de formulaire de demande peut remplir :
 * ceux de l'opportunité créée et de son client. Vide si le drapeau
 * `custom_fields_v2` est coupé — le sélecteur ne s'affiche alors pas.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { listerChamps } from '../../lib/champsPersoApi';
import type { ChampPerso } from '../../lib/champs/types';

export function useChampsPourFormulaire(): ChampPerso[] {
  const { isEnabled } = useModuleAccess('custom_fields_v2');
  const { data } = useQuery({
    queryKey: ['champs-perso', 'formulaire'],
    queryFn: () => listerChamps(),
    enabled: isEnabled,
    staleTime: 60_000,
  });
  return useMemo(
    () => (data?.fields ?? []).filter((c) => !c.archived_at && (c.object_type === 'deal' || c.object_type === 'client')),
    [data],
  );
}
