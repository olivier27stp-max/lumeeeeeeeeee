/**
 * « Crée une autre chaîne : quand il répond, envoie-lui mon lien Calendly. »
 *
 * Constaté en prod le 2026-09-28 : Lumi inventait une étape « démarrer
 * l'automatisation calendly_reply » qui pointait vers rien. Puis, sur le
 * vrai modèle, il écrivait `[CALENDLY_LINK]` ou sa QUESTION à l'utilisateur
 * dans le texto destiné au client. Ces tests figent les gardes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contientTrou, consignes } from '../server/lib/lumi/generer-parcours';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const sms = (body: string) => [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body } } }];

describe('un trou dans le message n’est jamais envoyé au client', () => {
  it.each([
    ['crochet en majuscules', 'Réserve ici : [CALENDLY_LINK]'],
    ['crochet de lien en minuscules', 'Réserve : [lien_calendly]'],
    ['la question à l’utilisateur écrite DANS le texto', 'Quel est ton lien Calendly ? Je crée la réponse automatique dès que je l’ai.'],
    ['un lien annoncé sans adresse', 'Parfait! Réserve ton créneau avec mon lien.'],
  ])('%s → trou', (_nom, body) => {
    expect(contientTrou(sms(body))).toBe(true);
  });

  it.each([
    ['un vrai lien', 'Parfait! Réserve ici : https://calendly.com/coquin-lavage/30min'],
    ['une vraie variable', 'Bonjour [client_first_name], merci pour votre réponse!'],
    ['des guillemets dans le texte', 'Vous avez dit "oui" — voici le lien https://a.b/c'],
  ])('%s → pas de trou', (_nom, body) => {
    expect(contientTrou(sms(body))).toBe(false);
  });
});

describe('les consignes de Lumi', () => {
  const texte = consignes(true);

  it('ne proposent plus démarrer / arrêter une automatisation (il inventait l’identifiant)', () => {
    const catalogue = texte.slice(texte.indexOf('ACTIONS DISPONIBLES'), texte.indexOf('FORME DE LA RÉPONSE'));
    expect(catalogue).not.toMatch(/- demarrer_automatisation/);
    expect(catalogue).not.toMatch(/- arreter_automatisation/);
  });

  it('expliquent la 2e automatisation, sa limite sur « Le client répond » et le champ « manque »', () => {
    expect(texte).toMatch(/"autre"/);
    expect(texte).toMatch(/une_fois_par_client_jours": 7/);
    expect(texte).toMatch(/"manque"/);
  });
});

describe('la route et le moteur', () => {
  it('la route refuse une étape qui vise une automatisation inexistante', () => {
    const route = lire('server/routes/automation-rules.ts');
    expect(route).toMatch(/refAutomatisationInventee\(auth\.client, auth\.orgId, verdict\.data\)/);
    expect(route).toMatch(/autre,\n\s*\}\);/);
  });

  it('le moteur honore « une fois par client tous les N jours »', () => {
    const moteur = lire('server/lib/automationEngine.ts');
    expect(moteur).toMatch(/if \(jours && await dejaPasseRecemment\(/);
  });

  it('l’éditeur met à jour la 2e automatisation au lieu d’en créer une copie', () => {
    const editeur = lire('src/pages/AutomationBuilderPage.tsx');
    expect(editeur).toMatch(/await modifierAutomatisation\(dejaLa\.id, contenu\)/);
  });

  it('une automatisation neuve n’est plus prise pour une vieille règle', async () => {
    const { estFormatOrigine } = await import('../src/lib/sequenceTypes');
    expect(estFormatOrigine({ steps: null, actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] })).toBe(false);
    expect(estFormatOrigine({ steps: null, actions: [{ type: 'send_sms', config: { body: 'Bonjour!' } }] })).toBe(true);
  });
});
