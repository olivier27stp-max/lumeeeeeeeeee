/**
 * Métadonnées SEO par page (site marketing) : <title>, description, canonical,
 * Open Graph et Twitter. Le HTML de départ (index.html) porte les valeurs de
 * l'accueil ; chaque page les remplace au montage et les remet au démontage.
 *
 * Le serveur injecte aussi ces valeurs dans le HTML servi aux robots
 * (server/index.ts, PAGE_META) : garder les deux listes cohérentes.
 */
import { useEffect } from 'react';

export const SITE_URL = 'https://lumecrm.net';
export const SITE_NAME = 'Lume';

export interface PageMeta {
  /** Titre sans le suffixe « · Lume » (ajouté ici), sauf si `raw` est vrai. */
  title: string;
  description: string;
  /** Chemin canonique, ex. « /pricing ». */
  path: string;
  /** Image de partage absolue ou relative à la racine ; défaut : /og-image.jpg. */
  image?: string;
  raw?: boolean;
}

function setMeta(selector: string, attr: string, value: string) {
  const el = document.head.querySelector<HTMLMetaElement>(selector);
  if (el) el.setAttribute(attr, value);
}

export function applyPageMeta(m: PageMeta) {
  const title = m.raw ? m.title : `${m.title} · ${SITE_NAME}`;
  const url = SITE_URL + m.path;
  const image = m.image ? (m.image.startsWith('http') ? m.image : SITE_URL + m.image) : `${SITE_URL}/og-image.jpg`;
  document.title = title;
  setMeta('meta[name="description"]', 'content', m.description);
  setMeta('meta[property="og:title"]', 'content', title);
  setMeta('meta[property="og:description"]', 'content', m.description);
  setMeta('meta[property="og:url"]', 'content', url);
  setMeta('meta[property="og:image"]', 'content', image);
  setMeta('meta[name="twitter:title"]', 'content', title);
  setMeta('meta[name="twitter:description"]', 'content', m.description);
  setMeta('meta[name="twitter:image"]', 'content', image);
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
  canonical.href = url;
}

/** Applique les métadonnées de la page ; rétablit celles de l'accueil en quittant. */
export function usePageMeta(m: PageMeta) {
  useEffect(() => {
    applyPageMeta(m);
    return () => applyPageMeta(HOME_META.fr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.title, m.description, m.path, m.image]);
}

export const HOME_META = {
  fr: { title: 'Lume · CRM pour les services résidentiels et la rénovation', description: 'Lume CRM, le logiciel tout-en-un des entreprises de services résidentiels et de rénovation : pipeline de vente clair et automatisations qui relancent tes clients à ta place.', path: '/', raw: true },
  en: { title: 'Lume · CRM for residential service and renovation businesses', description: 'Lume CRM is the all-in-one software for residential service and renovation businesses: a clear sales pipeline and automations that follow up with your clients for you.', path: '/', raw: true },
} as const;
