/**
 * Champs personnalisés : ACTIFS PAR DÉFAUT.
 *
 * Le module est activé pour toutes les entreprises (#581, et d'office à la
 * création). Le cacher à la moindre lecture ratée de /api/features rendait la
 * page introuvable (Rafba, 2026-09-25 : « comment je peux en setup si je vois
 * pas la page »). On ne le cache plus que si une ligne dit explicitement
 * enabled=false pour ce bureau.
 */
import { useModuleAccess } from './useModuleAccess';

export function useChampsPersoActifs(): { isEnabled: boolean } {
  const { desactiveExplicitement } = useModuleAccess('custom_fields_v2');
  return { isEnabled: !desactiveExplicitement };
}
