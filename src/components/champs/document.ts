/**
 * Les champs personnalisés à montrer sur le document d'un devis ou d'une
 * facture (option « afficher sur le document ») — aperçu dans l'app et PDF.
 * Partage le cache du panneau de la fiche : modifier un champ met l'aperçu
 * à jour. Vide si la fonction est coupée.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useModuleAccess } from '../../hooks/useModuleAccess';
import { lireFuseau, lireValeurs } from '../../lib/champsPersoApi';
import { formaterValeur } from '../../lib/champs/valeurs';

export type ChampDocument = { label: string; valeur: string };
const AUCUN: ChampDocument[] = [];

export function useChampsDocument(objet: 'quote' | 'invoice', id: string | null | undefined, fr: boolean): ChampDocument[] {
  const { isEnabled } = useModuleAccess('custom_fields_v2');
  const { data } = useQuery({
    queryKey: ['champs-perso-valeurs', objet, id],
    queryFn: () => lireValeurs(objet, id as string),
    enabled: isEnabled && !!id,
    staleTime: 30_000,
  });
  const { data: fuseau = 'America/Toronto' } = useQuery({ queryKey: ['champs-perso', 'fuseau'], queryFn: lireFuseau, staleTime: 3_600_000, enabled: isEnabled });
  return useMemo(() => {
    if (!data) return AUCUN;
    return data.fields
      .filter((c) => c.config.show_on_documents && !c.archived_at)
      .map((c) => ({ label: c.label, valeur: formaterValeur(c, data.values[c.id]?.value ?? null, fr ? 'fr' : 'en', fuseau) }))
      .filter((x) => x.valeur !== '');
  }, [data, fr, fuseau]);
}
