/**
 * Publier une étape qui porte encore le TEXTE D'EXEMPLE de l'éditeur : on prévient.
 *
 * Constat P-008 (audit du 2026-10-01), vécu en prod : une étape ajoutée à la
 * main naît avec un texte d'exemple envoyable (« Bonjour [client_name], c'est
 * [company_name]. Merci ! »). Rien ne disait, à la publication, que personne
 * ne l'avait rédigé : il partait tel quel à chaque client.
 *
 * Ce n'est pas un blocage (le texte EST envoyable, et on peut le vouloir) :
 * c'est un avertissement, montré dans la confirmation de publication.
 */
import { describe, it, expect } from 'vitest';
import { problemesAvantPublication, trouverAction, ACTIONS } from '../../src/lib/automationCatalogue';
import { problemesPublication, bloquantsPublication } from '../../src/lib/publicationAutomatisation';

const exemple = (action: string, champ: string, langue: 'fr' | 'en' = 'fr') => {
  const c = trouverAction(action)?.champs.find((x) => x.cle === champ);
  const v = langue === 'fr' ? c?.defaut_fr : c?.defaut_en;
  if (!v) throw new Error(`pas de texte d'exemple pour ${action}.${champ}`);
  return v;
};
const etape = (id: string, type: string, config: Record<string, string>, suivant: string | null = null) =>
  ({ id, type: 'action', action: { type, config }, suivant });
const avertissements = (steps: unknown[], declencheur = 'lead.created') =>
  problemesAvantPublication({ trigger_event: declencheur, steps, actions: [], conditions: {}, fr: true })
    .filter((p) => p.gravite === 'avertissement');

describe('texte d’exemple jamais rédigé', () => {
  it('un texto resté sur l’exemple : un avertissement qui cite le texte et vise l’étape', () => {
    const corps = exemple('send_sms', 'body');
    const vus = avertissements([etape('e1', 'send_sms', { body: corps })]);
    const a = vus.find((p) => /texte d’exemple/.test(p.message));
    expect(a, 'aucun avertissement').toBeDefined();
    expect(a!.etapeId).toBe('e1');
    expect(a!.message).toContain('Envoyer un texto');
    expect(a!.message).toContain(corps);
  });

  it('un texto rédigé : aucun avertissement de ce genre', () => {
    const vus = avertissements([etape('e1', 'send_sms', { body: 'Bonjour [client_first_name], votre facture est prête.' })]);
    expect(vus.filter((p) => /texte d’exemple/.test(p.message))).toEqual([]);
  });

  it('l’exemple anglais compte aussi, et les espaces en trop ne trompent pas', () => {
    const vus = avertissements([etape('e1', 'send_sms', { body: `  ${exemple('send_sms', 'body', 'en')}  ` })]);
    expect(vus.some((p) => /texte d’exemple/.test(p.message))).toBe(true);
  });

  it('un courriel resté sur l’exemple (objet et corps) : UN seul avertissement pour l’étape', () => {
    const vus = avertissements([etape('e1', 'send_email', { subject: exemple('send_email', 'subject'), body: exemple('send_email', 'body') })]);
    expect(vus.filter((p) => /texte d’exemple/.test(p.message) && p.etapeId === 'e1')).toHaveLength(1);
  });

  it('deux étapes sur l’exemple : deux avertissements, chacun sur la sienne', () => {
    const vus = avertissements([
      etape('e1', 'send_sms', { body: exemple('send_sms', 'body') }, 'e2'),
      etape('e2', 'create_task', { title: exemple('create_task', 'title') }),
    ]).filter((p) => /texte d’exemple/.test(p.message));
    expect(vus.map((p) => p.etapeId).sort()).toEqual(['e1', 'e2']);
  });

  it('ce n’est JAMAIS un blocage : la publication reste permise', () => {
    const regle = { trigger_event: 'lead.created', steps: [etape('e1', 'send_sms', { body: exemple('send_sms', 'body') })], actions: [], conditions: {}, fr: true };
    expect(bloquantsPublication(regle)).toEqual([]);
    expect(problemesPublication(regle).some((p) => p.gravite === 'avertissement' && /texte d’exemple/.test(p.message))).toBe(true);
  });

  it('en anglais, l’avertissement est en anglais', () => {
    const vus = problemesAvantPublication({ trigger_event: 'lead.created', steps: [etape('e1', 'send_sms', { body: exemple('send_sms', 'body') })], actions: [], conditions: {}, fr: false });
    expect(vus.some((p) => p.gravite === 'avertissement' && /sample text/.test(p.message))).toBe(true);
  });

  it('chaque texte d’exemple du catalogue est reconnu (aucune action oubliée)', () => {
    const oubliees: string[] = [];
    for (const a of ACTIONS) {
      // Une action pas encore offerte (« Envoyer dans Slack ») est déjà BLOQUÉE à la publication.
      if (a.indisponible) continue;
      for (const c of a.champs) {
        if ((c.type !== 'zone' && c.type !== 'texte') || !c.defaut_fr?.trim()) continue;
        const vus = problemesAvantPublication({ trigger_event: 'lead.created', steps: [etape('e1', a.cle, { [c.cle]: c.defaut_fr })], actions: [], conditions: {}, fr: true });
        if (!vus.some((p) => p.gravite === 'avertissement' && /texte d’exemple/.test(p.message))) oubliees.push(`${a.cle}.${c.cle}`);
      }
    }
    expect(oubliees).toEqual([]);
  });

  it('une automatisation fournie, au format d’origine, n’est pas concernée', () => {
    const fournie = { trigger_event: 'lead.created', steps: null, actions: [{ type: 'send_sms', config: { body: exemple('send_sms', 'body') } }], conditions: {}, is_preset: true, fr: true };
    expect(problemesPublication(fournie)).toEqual([]);
  });
});
