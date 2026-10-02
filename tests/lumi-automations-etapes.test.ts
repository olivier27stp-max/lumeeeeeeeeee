/**
 * `automations-etapes.ts` — un seul endroit pour LIRE ce que fait une
 * automatisation (mission finale, 2026-10-02).
 *
 * Une automatisation porte deux copies de ses messages : `steps` (le parcours,
 * ce que le moteur exécute) et `actions` (le format d'origine). Chaque lecteur
 * choisissait la sienne : Lumi jugeait « elle n'écrit pas aux clients » sur un
 * `actions` vide (A-11), citait un texte que le parcours n'envoyait plus (A-05,
 * A-07), ou ne citait rien du tout (A-10). Ces fonctions lisent la BONNE copie,
 * et rendent le texte en clair, écrit par du code.
 */
import { describe, it, expect } from 'vitest';
import {
  aUnParcours, etapesDeLaRegle, typesDActionDeLaRegle, regleAtteintLeClient, messagesDeLaRegle,
  actionsDepuisEtapes, dureeEnClair, declencheurEnClair, resumeDeLaRegle, texteDuResume, avisSegments,
  type RegleLue,
} from '../server/lib/automations-etapes';

const texto = (id: string, body: string, suivant: string | null = null, nom?: string) => ({ id, type: 'action', ...(nom ? { nom } : {}), action: { type: 'send_sms', config: { body } }, suivant });
const courriel = (id: string, subject: string, body: string, suivant: string | null = null) => ({ id, type: 'action', action: { type: 'send_email', config: { subject, body } }, suivant });
const attente = (id: string, s: number, suivant: string) => ({ id, type: 'attendre', delai_secondes: s, suivant });
const regle = (plus: Partial<RegleLue> & Record<string, unknown> = {}): RegleLue => ({
  id: 'r1', name: 'Relance devis', trigger_event: 'quote.sent', conditions: {}, steps: null, actions: [], delay_seconds: 0,
  settings: null, is_active: false, is_preset: false, deleted_at: null, ...plus,
} as RegleLue);

describe('quelle copie fait foi', () => {
  it('avec un parcours, c’est `steps` — même si `actions` dit autre chose', () => {
    const r = regle({ steps: [texto('e1', 'Le VRAI texte')], actions: [{ type: 'send_sms', config: { body: 'vieux texte' } }] });
    expect(aUnParcours(r)).toBe(true);
    expect(messagesDeLaRegle(r).map((m) => m.texte)).toEqual(['Le VRAI texte']);
  });

  it('sans parcours, le format d’origine est projeté (délai puis action)', () => {
    const r = regle({ steps: null, delay_seconds: 86400, actions: [{ type: 'send_sms', config: { body: 'Rappel' } }] });
    expect(aUnParcours(r)).toBe(false);
    const etapes = etapesDeLaRegle(r);
    expect(etapes.map((e) => e.type)).toEqual(['attendre', 'action']);
    expect(messagesDeLaRegle(r)[0]).toMatchObject({ type: 'send_sms', numero: 1, texte: 'Rappel' });
  });

  it('une automatisation neuve (action provisoire « À compléter ») n’a AUCUNE étape', () => {
    const r = regle({ steps: [], actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] });
    expect(etapesDeLaRegle(r)).toEqual([]);
    expect(regleAtteintLeClient(r)).toBe(false);
  });
});

describe('A-11 — « écrit-elle aux clients ? » se lit dans le parcours', () => {
  it('un parcours qui envoie un texto atteint le client, même avec `actions` vide', () => {
    // Le cas réel : une automatisation créée par Lumi avait `actions: []` — jugée « sans envoi », elle s'activait sans carte.
    const r = regle({ steps: [attente('e0', 3600, 'e1'), texto('e1', 'Bonjour')], actions: [] });
    expect(regleAtteintLeClient(r)).toBe(true);
    expect(typesDActionDeLaRegle(r)).toEqual(['send_sms']);
  });

  it('une tâche interne seule n’atteint pas le client ; la note interne `log_activity` ne compte pas', () => {
    const r = regle({ steps: [{ id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler' } }, suivant: 'e2' }, { id: 'e2', type: 'action', action: { type: 'log_activity', config: {} }, suivant: null }] });
    expect(regleAtteintLeClient(r)).toBe(false);
    expect(typesDActionDeLaRegle(r)).toEqual(['create_task']);
  });

  it('un sondage d’avis atteint le client', () => {
    expect(regleAtteintLeClient(regle({ steps: [{ id: 'e1', type: 'action', action: { type: 'request_review', config: {} }, suivant: null }] }))).toBe(true);
  });
});

describe('les messages, dans l’ordre, numérotés par type', () => {
  const r = regle({ steps: [texto('e1', 'Premier texto', 'e2', 'Confirmation'), courriel('e2', 'Objet', '<h2>Bonjour</h2><p>Voici votre devis.</p>', 'e3'), attente('e3', 86400, 'e4'), texto('e4', 'Second texto')] });

  it('« le 2e texto » est le deuxième TEXTO, pas la deuxième étape', () => {
    const m = messagesDeLaRegle(r);
    expect(m.map((x) => [x.type, x.numero, x.index])).toEqual([['send_sms', 1, 0], ['send_email', 1, 1], ['send_sms', 2, 3]]);
    expect(m[0].nom).toBe('Confirmation');
  });

  it('un courriel se LIT en texte (le HTML de l’éditeur est déplié), et se garde tel qu’enregistré', () => {
    const c = messagesDeLaRegle(r)[1];
    expect(c.objet).toBe('Objet');
    expect(c.corps).toContain('<h2>');
    expect(c.texte).not.toMatch(/<[a-z]/);
    expect(c.texte).toContain('Voici votre devis.');
  });
});

describe('A-02 / A-07 — `actions` re-dérivé du parcours', () => {
  it('les actions des étapes, dans l’ordre, sans les attentes ni les conditions', () => {
    const steps = [attente('e0', 60, 'e1'), texto('e1', 'A', 'e2'), { id: 'e2', type: 'condition', suivant_oui: 'e3', suivant_non: null }, courriel('e3', 'O', 'B')];
    expect(actionsDepuisEtapes(steps)).toEqual([
      { type: 'send_sms', config: { body: 'A' } },
      { type: 'send_email', config: { subject: 'O', body: 'B' } },
    ]);
  });

  it('rend une COPIE (modifier le reflet ne modifie pas le parcours), et tolère n’importe quoi', () => {
    const steps = [texto('e1', 'A')];
    const actions = actionsDepuisEtapes(steps);
    actions[0].config.body = 'modifié';
    expect((steps[0].action.config as { body: string }).body).toBe('A');
    expect(actionsDepuisEtapes(null)).toEqual([]);
    expect(actionsDepuisEtapes([null, 'x', { type: 'action' }])).toEqual([]);
  });
});

describe('A-10 — le résumé en clair, écrit par du code', () => {
  const r = regle({
    name: 'Relance de devis 3 jours',
    steps: [attente('e0', 3 * 86400, 'e1'), texto('e1', 'Bonjour [client_first_name], avez-vous regardé notre soumission ? [quote_link]')],
  });

  it('dit l’état, le déclencheur dans les mots de l’écran, chaque étape, et CITE le message mot pour mot', () => {
    const resume = resumeDeLaRegle(r, 'fr');
    expect(resume.etat).toMatch(/brouillon/);
    expect(resume.publiee).toBe(false);
    expect(resume.declencheur).toBe('Devis envoyé');
    expect(resume.etapes).toHaveLength(2);
    expect(resume.etapes[0]).toMatch(/^1\. .*3 jours/);
    expect(resume.etapes[1]).toContain('« Bonjour [client_first_name], avez-vous regardé notre soumission ? [quote_link] »');
    expect(resume.messages[0]).toMatchObject({ etape: 2, canal: 'texto', numero: 1, caracteres: 'Bonjour [client_first_name], avez-vous regardé notre soumission ? [quote_link]'.length });
  });

  it('jamais de clé technique dans ce que Lumi lira (ni `quote.sent`, ni `send_sms`)', () => {
    const texte = texteDuResume(resumeDeLaRegle(r, 'fr'), 'fr');
    expect(texte).not.toMatch(/quote\.sent|send_sms|delai_secondes|trigger_event/);
    expect(declencheurEnClair('quote.sent', false)).toBe('Quote sent');
  });

  it('publiée, à la corbeille : l’état le dit', () => {
    expect(resumeDeLaRegle(regle({ ...r, is_active: true }), 'fr').etat).toMatch(/publiée/);
    const corbeille = resumeDeLaRegle(regle({ ...r, is_active: true, deleted_at: '2026-10-01T00:00:00Z' }), 'fr');
    expect(corbeille.etat).toMatch(/corbeille/);
    expect(corbeille.publiee).toBe(false);
  });

  it('en anglais quand la conversation est en anglais (A-09)', () => {
    const en = resumeDeLaRegle(r, 'en');
    expect(en.etat).toMatch(/draft/);
    expect(en.declencheur).toBe('Quote sent');
    expect(en.messages[0].canal).toBe('text');
  });

  it('les durées se disent comme à l’écran', () => {
    expect(dureeEnClair(3 * 86400, true)).toBe('3 jours');
    expect(dureeEnClair(3600, true)).toBe('1 heure');
    expect(dureeEnClair(2 * 86400, false)).toBe('2 days');
  });
});

describe('A-18 — un texto de plus d’un SMS se dit', () => {
  it('rien à dire sous 160 caractères', () => {
    expect(avisSegments('Bonjour, votre rendez-vous est demain.', true)).toBeNull();
  });

  it('au-delà : le nombre de caractères ET le nombre de SMS facturés', () => {
    const long = 'a'.repeat(212);
    expect(avisSegments(long, true)).toMatch(/212 caractères.*facturé 2 SMS/);
    expect(avisSegments(long, false)).toMatch(/212 characters.*2 SMS/);
  });

  it('un émoji ramène la limite à 70 caractères : c’est dit', () => {
    const avis = avisSegments(`Merci ${'a'.repeat(80)} 🙂`, true);
    expect(avis).toMatch(/facturé 2 SMS/);
    expect(avis).toMatch(/émoji/);
  });

  it('le résumé porte le compte quand le texto dépasse un SMS', () => {
    const r = regle({ steps: [texto('e1', 'a'.repeat(200))] });
    expect(resumeDeLaRegle(r, 'fr').messages[0]).toMatchObject({ caracteres: 200, sms_factures: 2 });
  });
});
