/**
 * Banc commun des tests de composants de l'agent T : monter un vrai composant
 * en jsdom, taper dans un champ comme un utilisateur, cliquer, attendre.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;

/** Monte (ou re-rend, sur la même racine) un élément. */
export async function monter(element: React.ReactElement): Promise<HTMLDivElement> {
  if (!conteneur) {
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { racine!.render(<QueryClientProvider client={qc}>{element}</QueryClientProvider>); });
  await attendre();
  return conteneur;
}

export async function demonter(): Promise<void> {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
  conteneur = null;
}

/** Laisse passer les promesses en attente (lectures, enregistrements). */
export async function attendre(ms = 0): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

/** Attend qu'une condition devienne vraie (au plus `delai` ms). */
export async function jusqua(condition: () => boolean, delai = 2000): Promise<void> {
  const fin = Date.now() + delai;
  while (!condition() && Date.now() < fin) await attendre(10);
  if (!condition()) throw new Error('condition jamais atteinte');
}

export const texteEcran = (): string => document.body.textContent ?? '';

export function boutons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('button'));
}
/** Les noms d'un bouton : son texte, son `aria-label`, son `title`. */
const nomDe = (b: HTMLButtonElement): string[] => [(b.textContent ?? '').trim(), b.getAttribute('aria-label') ?? '', b.getAttribute('title') ?? ''].filter(Boolean);
/** Le bouton dont le texte (ou le nom accessible) est exactement celui-ci. */
export function bouton(nom: string, rang = 0): HTMLButtonElement {
  const trouves = boutons().filter((b) => nomDe(b).includes(nom));
  if (!trouves[rang]) throw new Error(`bouton « ${nom} » (n° ${rang}) introuvable — boutons : ${boutons().map((b) => (b.textContent ?? '').trim() || b.getAttribute('aria-label')).join(' | ')}`);
  return trouves[rang];
}
export const boutonPresent = (nom: string): boolean => boutons().some((b) => nomDe(b).includes(nom));

/** Les champs (input, textarea) dont le nom accessible est exactement celui-ci. */
export function champs<T extends HTMLInputElement | HTMLTextAreaElement = HTMLTextAreaElement>(nom: string): T[] {
  return Array.from(document.body.querySelectorAll<T>('input, textarea')).filter((c) => c.getAttribute('aria-label') === nom);
}
export function champ<T extends HTMLInputElement | HTMLTextAreaElement = HTMLTextAreaElement>(nom: string, rang = 0): T {
  const c = champs<T>(nom)[rang];
  if (!c) throw new Error(`champ « ${nom} » (n° ${rang}) introuvable`);
  return c;
}

export async function cliquer(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('rien à cliquer');
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await attendre();
}

/** Remplace le contenu d'un champ, comme `fill` de Playwright. */
export async function saisir(el: HTMLInputElement | HTMLTextAreaElement | null | undefined, valeur: string): Promise<void> {
  if (!el) throw new Error('champ introuvable');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
