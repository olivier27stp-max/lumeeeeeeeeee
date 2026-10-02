/**
 * Agent F — constat F-03.
 *
 * « Construire avec Lumi » envoie au modèle le parcours affiché à l'écran pour
 * qu'il le MODIFIE. Le code coupe ce parcours à 6 000 caractères
 * (`JSON.stringify(parcoursActuel).slice(0, 6_000)`, generer-parcours.ts).
 * Deux automatisations du pack de base, publiées d'office à la création de
 * chaque entreprise, dépassent cette taille : le modèle reçoit un JSON coupé
 * au milieu d'une étape, renvoie un parcours que la validation refuse, et la
 * demande est quand même débitée (mesuré le 2026-10-01 : 3,41 ¢ et 3,62 ¢,
 * HTTP 422, 17 et 18 s — sorties/f-gros-parcours.json).
 *
 * Test pur : aucune base, aucun réseau, aucun modèle.
 */
import { describe, it, expect } from 'vitest';
import { construireMessages } from '../../../server/lib/lumi/generer-parcours';
import { PACK_PARCOURS } from '../../../server/lib/automationPack.data';

/** Le JSON du parcours tel qu'il figure dans le message envoyé au modèle. */
function parcoursDansLeMessage(steps: unknown[], trigger_event: string): string {
  const messages = construireMessages('Change le premier délai à 2 jours.', [], { trigger_event, steps });
  const porteur = messages.find((m) => m.content.includes('Voici le parcours ACTUEL'));
  if (!porteur) throw new Error('le message « Voici le parcours ACTUEL » est absent');
  const debut = porteur.content.indexOf('{');
  // Une consigne « ÉTAPE NON RÉDIGÉE » peut suivre le JSON : elle n'en fait pas partie.
  return porteur.content.slice(debut).split('\n\nÉTAPE')[0];
}

describe('F-03 — le parcours à modifier part ENTIER au modèle', () => {
  it.each(PACK_PARCOURS.map((p) => [p.name, p] as const))('« %s » : toutes ses étapes sont dans le message, en JSON lisible', (_nom, p) => {
    const texte = parcoursDansLeMessage(p.steps, p.trigger_event);
    let lu: { steps?: unknown[] } | null = null;
    try { lu = JSON.parse(texte) as { steps?: unknown[] }; } catch { lu = null; }
    expect(lu, `le JSON envoyé au modèle est coupé (parcours de ${JSON.stringify({ trigger_event: p.trigger_event, steps: p.steps }).length} caractères, limite 6 000)`).not.toBeNull();
    expect(lu?.steps?.length).toBe(p.steps.length);
  });

  it('un parcours de 30 étapes (le maximum que l’éditeur accepte) part entier', () => {
    const gros = [...PACK_PARCOURS].sort((a, b) => b.steps.length - a.steps.length)[0];
    const ajouts = gros.steps.filter((e) => e.type === 'action').slice(0, 30 - gros.steps.length).map((e, i) => ({ ...e, id: `x${i + 1}`, suivant: null }));
    const steps = [...gros.steps, ...ajouts];
    expect(steps.length).toBe(30);
    const texte = parcoursDansLeMessage(steps, gros.trigger_event);
    let etapes = -1;
    try { etapes = (JSON.parse(texte) as { steps: unknown[] }).steps.length; } catch { etapes = -1; }
    expect(etapes).toBe(30);
  });
});
