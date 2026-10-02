import { useEffect, useRef } from 'react';

/**
 * Relit des chiffres sans recharger la page : au retour sur l'onglet du
 * navigateur, et à intervalle régulier tant que la page est visible.
 *
 * Les statistiques des automatisations ne bougeaient qu'au chargement
 * (constat D-18) : une exécution arrivée entre-temps restait invisible
 * jusqu'au rechargement. Pas de Realtime ici — une lecture légère, et
 * aucune quand l'onglet est caché (un onglet oublié ne coûte rien).
 *
 * `rafraichir` peut changer à chaque rendu : c'est toujours la dernière
 * version qui est appelée, sans relancer la minuterie.
 */
export function useRafraichissementVisible(rafraichir: () => void, intervalleMs = 30_000): void {
  const dernier = useRef(rafraichir);
  dernier.current = rafraichir;

  useEffect(() => {
    const siVisible = () => {
      if (document.visibilityState === 'visible') dernier.current();
    };
    document.addEventListener('visibilitychange', siVisible);
    const minuterie = window.setInterval(siVisible, intervalleMs);
    return () => {
      document.removeEventListener('visibilitychange', siVisible);
      window.clearInterval(minuterie);
    };
  }, [intervalleMs]);
}
