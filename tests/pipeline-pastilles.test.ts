/**
 * Les pastilles automatiques des cartes du board.
 *
 * GoHighLevel appelle ça des « smart tags » et les fait configurer par un
 * constructeur de règles en deux écrans. Ici elles sont DÉRIVÉES — rien de
 * stocké, rien à configurer — donc une pastille ne peut pas devenir fausse
 * parce qu'un travail de fond a cessé de tourner. Ce test fige les seuils et
 * l'ordre de priorité, qui sont tout ce qui les rend utiles.
 */
import { describe, it, expect } from 'vitest';
import { pastilles, type Deal, type PipelineStage } from '../src/lib/pipelineVentesApi';

const MAINTENANT = new Date('2026-09-24T12:00:00Z');

const ETAPES: PipelineStage[] = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau', name_en: 'New', guidance_fr: '', guidance_en: '', position: 1, kind: 'open', archived_at: null },
  { id: 'e2', pipeline_id: 'p1', name_fr: 'Gagné', name_en: 'Won', guidance_fr: '', guidance_en: '', position: 2, kind: 'won', archived_at: null },
];

/** Un deal contacté, assigné, actif aujourd'hui : aucun signal. */
function deal(over: Partial<Deal> = {}): Deal {
  const hier = new Date(MAINTENANT.getTime() - 86_400_000).toISOString();
  return {
    id: 'd1', pipeline_id: 'p1', stage_id: 'e1', client_id: 'c1',
    assigned_user_id: 'u1', source: 'manual',
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
    job_id: null, quote_id: null,
    first_contacted_at: hier,
    last_activity_at: MAINTENANT.toISOString(),
    stage_entered_at: hier, won_at: null, lost_at: null,
    lost_reason: null, lost_from_stage_id: null, pin_id: null, field_rep_id: null,
    created_at: hier,
    ...over,
  } as Deal;
}

/** Une date à N jours dans le passé. */
function ilYA(jours: number): string {
  return new Date(MAINTENANT.getTime() - jours * 86_400_000).toISOString();
}

const cles = (d: Deal, montant?: number) =>
  pastilles(d, ETAPES, montant, MAINTENANT).map((p) => p.cle);

describe('pastilles automatiques', () => {
  it('un deal sain ne porte aucune pastille', () => {
    // Une pastille sur chaque carte ne signalerait plus rien.
    expect(cles(deal())).toEqual([]);
  });

  it('signale un deal que personne n’a contacté', () => {
    expect(cles(deal({ first_contacted_at: null, last_activity_at: ilYA(3) })))
      .toContain('jamais_contacte');
  });

  it('ne crie pas « jamais contacté » sur un lead arrivé il y a une heure', () => {
    // Le monde n'a pas encore eu le temps de répondre : ce serait une
    // fausse alerte le matin même.
    const frais = new Date(MAINTENANT.getTime() - 3_600_000).toISOString();
    expect(cles(deal({ first_contacted_at: null, last_activity_at: frais })))
      .not.toContain('jamais_contacte');
  });

  it('signale un deal que personne n’a pris', () => {
    expect(cles(deal({ assigned_user_id: null }))).toContain('non_assigne');
  });

  it('signale un deal qui dort depuis deux semaines', () => {
    const c = cles(deal({ last_activity_at: ilYA(20) }));
    expect(c).toContain('dort');
    expect(c).not.toContain('a_relancer');
  });

  it('propose de relancer entre 5 et 14 jours', () => {
    const c = cles(deal({ last_activity_at: ilYA(7) }));
    expect(c).toContain('a_relancer');
    expect(c).not.toContain('dort');
  });

  it('signale un gros montant, sans alarmer', () => {
    const p = pastilles(deal(), ETAPES, 600_000, MAINTENANT);
    const gros = p.find((x) => x.cle === 'gros');
    expect(gros).toBeTruthy();
    // Un gros deal récent et bien suivi n'a aucun problème : informatif.
    expect(gros!.ton).toBe('info');
  });

  it('ne compte pas 4 999 $ comme un gros job', () => {
    expect(cles(deal(), 499_900)).not.toContain('gros');
  });

  it('n’en montre jamais plus de deux', () => {
    // Le pire cas possible : jamais contacté, non assigné, qui dort, gros.
    const p = pastilles(
      deal({ first_contacted_at: null, assigned_user_id: null, last_activity_at: ilYA(30) }),
      ETAPES, 900_000, MAINTENANT,
    );
    expect(p).toHaveLength(2);
    // Et ce sont les DEUX PLUS URGENTES, pas les deux premières venues.
    expect(p.map((x) => x.cle)).toEqual(['jamais_contacte', 'non_assigne']);
  });

  it('ne met aucune pastille sur un deal fermé', () => {
    // « Dort depuis 20 jours » sur une vente conclue est un faux signal.
    expect(cles(deal({ stage_id: 'e2', last_activity_at: ilYA(60) }))).toEqual([]);
  });
});
