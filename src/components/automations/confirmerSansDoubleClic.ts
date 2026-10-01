/* ═══════════════════════════════════════════════════════════════
   Une confirmation qui survit à un double clic.

   Le dialogue de `confirmer()` s'ouvre au premier clic et se ferme d'un
   clic sur son fond. Un double clic — geste courant, surtout sur un bouton
   d'urgence — envoie donc son second clic sur ce fond : le dialogue
   s'annule aussitôt, l'écran clignote et « rien ne se passe » (audit du
   2026-10-01, liste-08).

   Corrigé côté APPELANT : pendant le temps d'un double clic, un clic tombé
   HORS de la carte du dialogue est ignoré. Les boutons du dialogue, eux,
   répondent tout de suite ; passé ce délai, le fond annule comme avant.
   ═══════════════════════════════════════════════════════════════ */

import { confirmer, type ConfirmOptions } from '../ui/ConfirmDialog';

/** Le délai de double clic par défaut des systèmes (Windows, macOS) : 500 ms. */
export const DELAI_DOUBLE_CLIC_MS = 500;

export function confirmerSansDoubleClic(options: ConfirmOptions): Promise<boolean> {
  if (typeof window === 'undefined') return confirmer(options);

  const ouvertA = Date.now();
  let minuterie: ReturnType<typeof setTimeout> | null = null;

  const retirer = () => {
    window.removeEventListener('click', ignorer, true);
    window.removeEventListener('mousedown', ignorer, true);
    if (minuterie) { clearTimeout(minuterie); minuterie = null; }
  };

  /*
   * En phase de CAPTURE sur la fenêtre : l'événement est arrêté avant
   * d'atteindre React, donc avant le fond du dialogue. Le `mousedown` aussi,
   * pour que le focus reste sur « Annuler » au lieu de partir sur le fond.
   */
  function ignorer(e: Event) {
    if (Date.now() - ouvertA >= DELAI_DOUBLE_CLIC_MS) { retirer(); return; }
    const cible = e.target;
    if (cible instanceof Element && cible.closest('[role="dialog"]')) return;
    e.stopPropagation();
    e.preventDefault();
  }

  window.addEventListener('click', ignorer, true);
  window.addEventListener('mousedown', ignorer, true);
  minuterie = setTimeout(retirer, DELAI_DOUBLE_CLIC_MS);

  return confirmer(options).finally(retirer);
}
