import React, { useEffect, useRef } from 'react';
import { useTranslation } from '../i18n/LanguageContext';

/**
 * Sentinelle de défilement infini — remplace la pagination Précédent/Suivant
 * des tableaux de listes (Clients, Jobs, Devis, Factures, Paiements, Tâches).
 *
 * Placée juste sous les lignes du tableau : dès qu'elle entre dans le viewport
 * et qu'il reste des éléments à charger, `onLoadMore` est appelé. Un bouton
 * « Charger plus » sert de repli (observer indisponible, scroll dans un
 * conteneur non standard, etc.).
 */
export default function InfiniteScrollSentinel({
  hasMore,
  loading,
  onLoadMore,
  loaded,
  total,
  className = '',
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** Nombre de lignes affichées (facultatif — affiche « X sur Y »). */
  loaded?: number;
  /** Nombre total de lignes (facultatif). */
  total?: number;
  className?: string;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const ref = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (visible && hasMoreRef.current && !loadingRef.current) cbRef.current();
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Quand une page vient d'être ajoutée et que la sentinelle est toujours
  // visible (page courte, filtre client-side qui vide une page…), on enchaîne.
  useEffect(() => {
    if (loading || !hasMore) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const inView = r.top < (window.innerHeight || document.documentElement.clientHeight) + 400 && r.bottom > -400;
    if (inView) cbRef.current();
  }, [loading, hasMore, loaded]);

  const showCount = typeof loaded === 'number' && typeof total === 'number' && total > 0;

  return (
    <div ref={ref} className={`flex items-center justify-center gap-3 py-3 min-h-[44px] ${className}`}>
      {loading ? (
        <span className="inline-flex items-center gap-2 text-[13px] text-text-tertiary">
          <span className="w-4 h-4 rounded-full border-2 border-outline border-t-text-secondary animate-spin" />
          {fr ? 'Chargement…' : 'Loading…'}
        </span>
      ) : hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="h-8 px-3 bg-surface-card border border-outline rounded-md text-[13px] text-text-secondary hover:bg-surface-secondary transition-colors cursor-pointer"
        >
          {fr ? 'Charger plus' : 'Load more'}
          {showCount && <span className="ml-1.5 tabular-nums text-text-tertiary">({loaded} / {total})</span>}
        </button>
      ) : showCount ? (
        <span className="text-[12px] text-text-tertiary tabular-nums">
          {fr ? `${loaded} sur ${total}` : `${loaded} of ${total}`}
        </span>
      ) : null}
    </div>
  );
}
