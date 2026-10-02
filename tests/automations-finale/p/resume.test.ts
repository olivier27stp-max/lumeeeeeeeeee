/**
 * Agent P — la phrase-résumé d'une automatisation (src/lib/automationResume.ts),
 * mission point 17 : « générée par du CODE (pas le LLM) », exacte pour chaque
 * déclencheur et chaque type d'étape.
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/resume.test.ts
 *
 * Le dernier bloc parcourt TOUT : chaque déclencheur du catalogue × chaque action,
 * tous les préréglages, le pack de base et la bibliothèque de modèles — et refuse
 * une phrase vide, une clé technique ou une variable brute.
 */
import { describe, it, expect } from 'vitest';
import {
  resumeAutomatisation, resumeEnMorceaux, dureeCourte, DECLENCHEURS_RESUMES, ACTIONS_RESUMEES, MORCEAUX_MAX, type RegleAResumer,
} from '../../../src/lib/automationResume';
import { ACTIONS, DECLENCHEURS, configParDefaut } from '../../../src/lib/automationCatalogue';
import { AUTOMATION_PRESETS } from '../../../server/lib/automationPresets.data';
import { PACK_PARCOURS } from '../../../server/lib/automationPack.data';
import { MODELES_AUTOMATISATION } from '../../../server/lib/automationTemplates';
import type { Etape } from '../../../src/lib/sequenceTypes';

const texto = (body = 'Bonjour [client_first_name]') => ({ type: 'send_sms', config: { body } });
const courriel = () => ({ type: 'send_email', config: { subject: 'Objet', body: '<p>Bonjour</p>' } });
const e = (id: string, a: { type: string; config: Record<string, unknown> }, suivant: string | null = null): Etape =>
  ({ id, type: 'action', action: a as never, suivant });

describe('P — résumé : la phrase de la mission', () => {
  it('« Quand une facture est en retard de 7 jours → texto au client (sauf étiquette « VIP ») »', () => {
    const regle: RegleAResumer = {
      trigger_event: 'invoice.overdue',
      conditions: { days_overdue: 7, ciblage: { exclure: [{ type: 'etiquette', valeur: 'VIP' }] } },
      steps: [e('e1', texto())],
    };
    expect(resumeAutomatisation(regle)).toBe('Quand une facture est en retard de 7 jours → texto au client (sauf étiquette « VIP »)');
    expect(resumeAutomatisation(regle, false)).toBe('When an invoice is 7 days overdue → text to the client (except tag “VIP”)');
  });

  it('les quatre parties « Quand… → Si… → Qui… → Alors… » sont rendues séparément, pour l’écran', () => {
    const r = resumeEnMorceaux({
      trigger_event: 'quote.sent',
      conditions: { montant__gte: 500, client_a_etiquette: 'Commercial', client_sans_etiquette: 'Ne pas relancer' },
      steps: [{ id: 'a', type: 'attendre', delai_secondes: 3 * 86400, suivant: 'b' }, e('b', courriel())],
    });
    expect(r).toEqual({
      quand: 'Quand un devis est envoyé',
      si: 'si une autre condition est remplie',
      qui: 'clients avec étiquette « Commercial », sauf étiquette « Ne pas relancer »',
      alors: 'attendre 3 jours → courriel au client',
      phrase: 'Quand un devis est envoyé, si une autre condition est remplie → attendre 3 jours → courriel au client (clients avec étiquette « Commercial », sauf étiquette « Ne pas relancer »)',
    });
  });

  it('une automatisation neuve (« À compléter ») ou sans déclencheur dit qu’elle est vide — jamais une phrase vide', () => {
    expect(resumeAutomatisation({ trigger_event: 'lead.created', steps: [], actions: [texto('À compléter')] }))
      .toBe('Quand un nouveau prospect arrive → rien pour l’instant (aucune étape)');
    expect(resumeAutomatisation({})).toBe('Quand un déclencheur reste à choisir → rien pour l’instant (aucune étape)');
    expect(resumeAutomatisation({}, false)).toBe('When a trigger is still to be picked → nothing yet (no step)');
  });
});

describe('P — résumé : l’occurrence visée par les réglages du déclencheur', () => {
  const dire = (trigger_event: string, conditions: Record<string, unknown>, libelles = {}) =>
    resumeEnMorceaux({ trigger_event, conditions, steps: [e('e1', texto())] }, true, libelles).quand;

  it('jours de retard, étiquette, première ouverture, mois d’inactivité', () => {
    expect(dire('invoice.overdue', {})).toBe('Quand une facture est en retard');
    expect(dire('invoice.overdue', { days_overdue: 1 })).toBe('Quand une facture est en retard de 1 jour');
    expect(dire('invoice.overdue', { days_overdue: { eq: 15 } })).toBe('Quand une facture est en retard de 15 jours');
    expect(dire('client.tagged', { tag: 'À rappeler' })).toBe('Quand l’étiquette « À rappeler » est ajoutée à un client');
    expect(dire('client.untagged', {})).toBe('Quand une étiquette est retirée d’un client');
    expect(dire('quote.viewed', { ouverture: 'premiere' })).toBe('Quand le client ouvre son devis pour la première fois');
    expect(dire('quote.viewed', { ouverture: 'chaque' })).toBe('Quand le client ouvre son devis (à chaque ouverture)');
    expect(dire('client.inactive', { mois: 12 })).toBe('Quand un client n’a eu aucun job terminé depuis 12 mois');
  });

  it('étape du pipeline, date surveillée et champ modifié : par leur NOM quand on le connaît, sans identifiant sinon', () => {
    const libelles = { etapes: { s1: 'Soumission envoyée' }, champs: { c1: { label: 'Fin de contrat' } } };
    expect(dire('deal.stage_entered', { stage_id: 's1' }, libelles)).toBe('Quand une opportunité entre dans l’étape « Soumission envoyée »');
    expect(dire('deal.stage_entered', { stage_id: 's1' })).toBe('Quand une opportunité entre dans une étape du pipeline');
    expect(dire('deal.stage_idle', { stage_id: 's1' }, libelles)).toBe('Quand une opportunité dort dans l’étape « Soumission envoyée »');
    expect(dire('date.reached', { champ_id: 'c1', jours_avant: 30 }, libelles)).toBe('Quand la date « Fin de contrat » arrive dans 30 jours');
    expect(dire('date.reached', { champ_id: 'c1', jours_avant: 0 }, libelles)).toBe('Quand la date « Fin de contrat » arrive');
    expect(dire('date.reached', { champ_id: 'c1', jours_avant: -7 }, libelles)).toBe('Quand la date « Fin de contrat » est passée depuis 7 jours');
    expect(dire('date.reached', { champ_id: 'inconnu' })).toBe('Quand une date surveillée arrive');
    expect(dire('custom_field.changed', { field_id: { eq: 'c1' } }, libelles)).toBe('Quand le champ « Fin de contrat » est modifié');
  });

  it('un réglage déjà dit par « Quand » n’est pas recompté comme filtre ; les autres le sont', () => {
    const si = (trigger_event: string, conditions: Record<string, unknown>) => resumeEnMorceaux({ trigger_event, conditions, steps: [e('e1', texto())] }).si;
    expect(si('invoice.overdue', { days_overdue: 7 })).toBe('');
    expect(si('quote.viewed', { ouverture: 'premiere', montant__gte: 500, montant__lte: 5000 })).toBe('si 2 autres conditions sont remplies');
    expect(si('lead.created', { source: { neq: 'request_form' }, champs_perso: [{ field_id: 'a', op: 'is', value: 'x' }, { field_id: 'b', op: 'is_empty' }] }))
      .toBe('si 3 autres conditions sont remplies');
    expect(si('lead.created', { client_a_etiquette: 'VIP', ciblage: {} })).toBe('');
  });
});

describe('P — résumé : chaque type d’étape', () => {
  const alors = (steps: Etape[], fr = true) => resumeEnMorceaux({ trigger_event: 'appointment.created', steps }, fr).alors;

  it('les trois attentes : durée, réponse du client, avant le rendez-vous', () => {
    expect(alors([{ id: 'a', type: 'attendre', delai_secondes: 7200, suivant: 'b' }, e('b', texto())])).toBe('attendre 2 heures → texto au client');
    expect(alors([{ id: 'a', type: 'attendre', mode: 'reponse', delai_secondes: 3 * 86400, suivant: 'b' }, e('b', texto())]))
      .toBe('attendre la réponse du client (3 jours au plus) → texto au client');
    expect(alors([{ id: 'a', type: 'attendre', mode: 'avant_date', delai_secondes: 0, secondes_avant: 86400, suivant: 'b' }, e('b', texto())]))
      .toBe('attendre jusqu’à 1 jour avant le rendez-vous → texto au client');
    expect(alors([{ id: 'a', type: 'attendre', mode: 'avant_date', delai_secondes: 0, secondes_avant: 7200, suivant: 'b' }, e('b', texto())], false))
      .toBe('wait until 2 hours before the appointment → text to the client');
  });

  it('une condition : la branche « alors » continue la phrase, la branche « sinon » est dite entre parenthèses', () => {
    const steps: Etape[] = [
      e('e1', texto(), 'si'),
      { id: 'si', type: 'si', conditions: { status: 'approved' }, alors: 'oui', sinon: 'non' },
      e('oui', courriel()),
      e('non', { type: 'create_task', config: { title: 'Rappeler' } }),
    ];
    expect(alors(steps)).toBe('texto au client → si la condition est remplie (sinon : créer une tâche) → courriel au client');
    expect(alors([{ id: 'si', type: 'si', conditions: {}, alors: null, sinon: null }])).toBe('si la condition est remplie');
  });

  it('« Arrêter ici » termine la phrase ; une note interne du moteur n’y figure pas', () => {
    expect(alors([e('e1', texto(), 'fin'), { id: 'fin', type: 'arreter' }, e('orpheline', courriel())])).toBe('texto au client');
    expect(alors([e('e1', { type: 'log_activity', config: { event_type: 'x' } }, 'e2'), e('e2', texto())])).toBe('texto au client');
  });

  it('une boucle dans le parcours (brouillon mal câblé) ne fait pas tourner le résumé en rond', () => {
    expect(alors([e('e1', texto(), 'e2'), e('e2', courriel(), 'e1')])).toBe('texto au client → courriel au client');
  });

  it(`au-delà de ${MORCEAUX_MAX} morceaux, la phrase résume et dit le nombre d’étapes`, () => {
    const steps: Etape[] = Array.from({ length: 12 }, (_, i) => (i % 2 === 0
      ? e(`e${i}`, texto(), i < 11 ? `e${i + 1}` : null)
      : { id: `e${i}`, type: 'attendre', delai_secondes: 86400, suivant: i < 11 ? `e${i + 1}` : null }));
    expect(alors(steps)).toBe('texto au client → attendre 1 jour → texto au client → attendre 1 jour → texto au client → attendre 1 jour → … (12 étapes en tout)');
    expect(alors(steps, false)).toMatch(/→ … \(12 steps in all\)$/);
  });

  it('le format d’origine (`actions` + délai) se lit comme un parcours : le délai d’abord, négatif = avant le rendez-vous', () => {
    expect(resumeAutomatisation({ trigger_event: 'invoice.sent', actions: [texto(), courriel()], delay_seconds: 3 * 86400 }))
      .toBe('Quand une facture est envoyée → attendre 3 jours → texto au client → courriel au client');
    expect(resumeAutomatisation({ trigger_event: 'appointment.created', actions: [texto()], delay_seconds: -86400 }))
      .toBe('Quand un rendez-vous est planifié → attendre jusqu’à 1 jour avant le rendez-vous → texto au client');
    // Le parcours gagne sur `actions` : c'est lui que le moteur exécute.
    expect(resumeAutomatisation({ trigger_event: 'invoice.sent', steps: [e('e1', courriel())], actions: [texto()] }))
      .toBe('Quand une facture est envoyée → courriel au client');
  });

  it('les durées se disent dans la plus grande unité exacte', () => {
    expect([60, 3600, 5400, 86400, 172800, 604800, 1209600, 45].map((s) => dureeCourte(s, true)))
      .toEqual(['1 minute', '1 heure', '90 minutes', '1 jour', '2 jours', '7 jours', '2 semaines', '45 secondes']);
    expect(dureeCourte(1209600, false)).toBe('2 weeks');
  });

  it('étiquettes et destinataire d’une notification sont nommés', () => {
    expect(alors([e('e1', { type: 'ajouter_etiquette', config: { etiquette: 'À rappeler' } })])).toBe('ajouter l’étiquette « À rappeler »');
    expect(alors([e('e1', { type: 'retirer_etiquette', config: { toutes: 'true' } })])).toBe('retirer toutes les étiquettes');
    expect(alors([e('e1', { type: 'create_notification', config: { title: 'x', destinataire: 'proprietaire' } })])).toBe('notification au propriétaire');
    expect(alors([e('e1', { type: 'create_notification', config: { title: 'x' } })])).toBe('notification à l’équipe');
  });
});

describe('P — résumé : TOUT le catalogue, tous les préréglages — aucune phrase vide, aucun jeton non traduit', () => {
  /** Ce qui ne doit jamais sortir dans une phrase destinée au propriétaire. */
  const JETONS_BRUTS = [
    /\b[a-z]+\.[a-z_]+\b/,            // clé de déclencheur : invoice.overdue
    /\b[a-z]+_[a-z_]+\b/,             // clé technique : send_sms, days_overdue
    /undefined|null|NaN|\[object/,
    /[[\]{}]/,                        // variable brute : [client_name], {{…}}
  ];
  const verifier = (phrase: string, quoi: string) => {
    expect(phrase.trim().length, `${quoi} : phrase vide`).toBeGreaterThan(20);
    for (const re of JETONS_BRUTS) expect(re.test(phrase), `${quoi} : jeton non traduit dans « ${phrase} »`).toBe(false);
    expect(phrase, quoi).toMatch(/^(Quand|When) .+ → .+/);
  };

  it('chaque déclencheur du catalogue a sa formule, et il n’y a pas de formule orpheline', () => {
    expect([...DECLENCHEURS_RESUMES].sort()).toEqual(DECLENCHEURS.map((d) => d.cle).sort());
  });

  it('chaque action du catalogue a sa formule (plus la note interne `log_activity`)', () => {
    expect([...ACTIONS_RESUMEES].sort()).toEqual([...ACTIONS.map((a) => a.cle), 'log_activity'].sort());
  });

  it('chaque déclencheur × chaque action, en français et en anglais, avec les réglages d’office', () => {
    let n = 0;
    for (const d of DECLENCHEURS) {
      for (const a of ACTIONS) {
        for (const fr of [true, false]) {
          const regle: RegleAResumer = {
            trigger_event: d.cle, conditions: d.conditions_defaut ?? {},
            steps: [{ id: 'a', type: 'attendre', delai_secondes: 86400, suivant: 'b' }, e('b', { type: a.cle, config: configParDefaut(a.cle, fr) })],
          };
          verifier(resumeAutomatisation(regle, fr), `${d.cle} × ${a.cle} (${fr ? 'fr' : 'en'})`);
          n++;
        }
      }
    }
    expect(n).toBe(DECLENCHEURS.length * ACTIONS.length * 2);
  });

  it('chaque réglage de déclencheur rempli (valeurs d’exemple) donne encore une phrase propre', () => {
    for (const d of DECLENCHEURS) {
      const conditions: Record<string, unknown> = {};
      for (const c of d.champs ?? []) conditions[c.cle] = c.type === 'nombre' ? 3 : c.options?.[0]?.cle ?? 'Exemple';
      for (const fr of [true, false]) verifier(resumeAutomatisation({ trigger_event: d.cle, conditions, steps: [e('e1', texto())] }, fr), `${d.cle} réglé`);
    }
  });

  it('les préréglages fournis (format d’origine), dans les deux langues', () => {
    expect(AUTOMATION_PRESETS.length).toBeGreaterThanOrEqual(30);
    for (const p of AUTOMATION_PRESETS) {
      for (const fr of [true, false]) verifier(resumeAutomatisation(p, fr), `préréglage ${p.preset_key}`);
    }
  });

  it('les parcours du pack de base, dans les deux langues', () => {
    for (const p of PACK_PARCOURS) for (const fr of [true, false]) verifier(resumeAutomatisation(p, fr), `pack ${p.preset_key}`);
    expect(resumeAutomatisation(PACK_PARCOURS.find((p) => p.preset_key === 'pack_suivi_prospect')!))
      .toMatch(/^Quand un nouveau prospect arrive, si une autre condition est remplie → /);
  });

  it('la bibliothèque de modèles (« Partir d’un modèle »), dans les deux langues', () => {
    expect(MODELES_AUTOMATISATION.length).toBeGreaterThan(5);
    for (const m of MODELES_AUTOMATISATION) {
      const regle = m as unknown as RegleAResumer & { delai_secondes?: number; id?: string };
      for (const fr of [true, false]) verifier(resumeAutomatisation({ ...regle, delay_seconds: regle.delai_secondes ?? regle.delay_seconds }, fr), `modèle ${regle.id ?? ''}`);
    }
  });

  it('un déclencheur ou une action que le catalogue ne connaît plus : une formule neutre, jamais la clé', () => {
    const phrase = resumeAutomatisation({ trigger_event: 'estimate.sent', actions: [{ type: 'post_appointment', config: {} }] });
    expect(phrase).toBe('Quand un événement qui n’est plus offert se produit → une action qui n’est plus offerte');
    verifier(phrase, 'inconnus');
  });
});
