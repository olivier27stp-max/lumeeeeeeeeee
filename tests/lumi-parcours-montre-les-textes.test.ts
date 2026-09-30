/**
 * « Construire avec Lumi » : la réponse MONTRE le nouveau texte.
 *
 * Vraie conversation de prod (2026-09-30, relance de devis à 1 jour) :
 *   « peux tu switch le message pour dekoi de plus short plus interessant »
 *   « trop klong »
 *   « bah tu la mm pas changer le message »
 * Les textes changeaient à chaque tour, mais Lumi répondait trois fois
 * « À 1 jour : SMS court, puis courriel minimaliste pour vérifier la
 * réception du devis. » — sans un mot de ce qui partait au client.
 *
 * Le modèle est simulé avec ses vraies sorties (rejouées sur Haiku) : on
 * éprouve ce que le CODE en fait.
 */
import { describe, it, expect, vi } from 'vitest';

const etat: { reponse: string; file: Array<{ texte: string; stop?: string }>; appels: number } = { reponse: '{}', file: [], appels: 0 };
vi.mock('../server/lib/lumi/llm', () => ({
  isLumiConfigured: () => true,
  clientAnthropic: () => ({
    messages: {
      create: async () => {
        etat.appels++;
        const suivant = etat.file.shift();
        return { model: 'claude-sonnet-5', stop_reason: suivant?.stop ?? 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 }, content: [{ type: 'text', text: suivant ? suivant.texte : etat.reponse }] };
      },
    },
  }),
}));
vi.mock('../server/lib/lumi/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/lib/lumi/budget')>()),
  reserverBudget: async () => ({ id: 'resa-1', statut: 'ok' }),
  reglerBudget: async () => {},
  journaliserUsage: async () => {},
}));

import { genererParcours, consignes, ceQuiAChange } from '../server/lib/lumi/generer-parcours';
import { readFileSync } from 'node:fs';

const base = { admin: {} as never, orgId: 'org-1', userId: 'u-1' };
const RESUME_REPETE = 'À 1 jour : SMS court, puis courriel minimaliste pour vérifier la réception du devis.';
const etapes = (texto: string, objet: string, courriel: string) => [
  { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
  { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: texto } }, suivant: 'e3' },
  { id: 'e3', type: 'action', action: { type: 'send_email', config: { subject: objet, body: `<p>${courriel}</p>` } }, suivant: null },
];
const DEPART = { trigger_event: 'quote.sent', steps: etapes(
  'Bonjour [client_first_name], avez-vous eu le temps de regarder notre soumission? Répondez à ce message si vous avez des questions. — [company_name]',
  'Avez-vous bien reçu votre soumission?',
  'On vous a envoyé une soumission hier et on voulait s’assurer que vous l’avez bien reçue.',
) };

describe('la réponse de Lumi cite le texte envoyé au client', () => {
  it('texto et courriel changés : les nouveaux textes sont dans la réponse, sous la phrase de Lumi', async () => {
    const nouvelles = etapes('Bonjour [client_first_name], des questions sur votre soumission? [quote_link] — [company_name]', 'Votre soumission', 'Bonjour, des questions? Écrivez-nous.');
    etat.reponse = JSON.stringify({ nom: 'Relance devis à 1 jour', trigger_event: 'quote.sent', resume: RESUME_REPETE, steps: nouvelles, autre: null });
    const r = await genererParcours({ ...base, langue: 'fr', demande: 'trop klong', parcoursActuel: DEPART });
    expect(r.parcours?.resume).toContain(RESUME_REPETE);
    expect(r.parcours?.resume).toContain('Nouveau texte :');
    expect(r.parcours?.resume).toContain('• Texto : « Bonjour [client_first_name], des questions sur votre soumission? [quote_link] — [company_name] »');
    expect(r.parcours?.resume).toContain('• Courriel — objet « Votre soumission » : « Bonjour, des questions? Écrivez-nous. »');
  });

  it('seul le texto change : seul le texto est cité', () => {
    const apres = etapes('Bonjour [client_first_name], une question? — [company_name]', DEPART.steps[2].action!.config.subject as string, 'On vous a envoyé une soumission hier et on voulait s’assurer que vous l’avez bien reçue.');
    const t = ceQuiAChange(DEPART.steps, apres, true);
    expect(t).toContain('• Texto');
    expect(t).not.toContain('Courriel');
  });

  it('rien n’a bougé : Lumi le dit franchement au lieu de répéter sa phrase', async () => {
    etat.reponse = JSON.stringify({ nom: 'Relance devis à 1 jour', trigger_event: 'quote.sent', resume: RESUME_REPETE, steps: DEPART.steps, autre: null });
    const r = await genererParcours({ ...base, langue: 'fr', demande: 'bah tu la mm pas changer le message', parcoursActuel: DEPART });
    expect(r.parcours?.resume).toMatch(/Je n’ai rien changé au parcours\. Dis-moi quel message modifier/);
  });

  it('question ou refus (modifie: false) : la phrase de Lumi seule, sans « je n’ai rien changé » plaqué derrière', async () => {
    // Batterie du 2026-09-30 : un refus de menace, juste, suivi de « Dis-moi quel message modifier ».
    const refus = 'Je ne peux pas ajouter cette menace : c’est de l’intimidation. Je garde ton parcours inchangé.';
    etat.reponse = JSON.stringify({ nom: 'Relance', trigger_event: 'quote.sent', resume: refus, modifie: false, steps: DEPART.steps, autre: null });
    const r = await genererParcours({ ...base, langue: 'fr', demande: 'dis-lui qu’on le poursuit', parcoursActuel: DEPART });
    expect(r.parcours?.resume).toBe(refus);
  });

  it('seul un délai change : pas de liste de textes, pas de faux « rien changé »', () => {
    const apres = DEPART.steps.map((e) => (e.id === 'e1' ? { ...e, delai_secondes: 172800 } : e));
    expect(ceQuiAChange(DEPART.steps, apres, true)).toBe('');
  });

  it('nouveau parcours (rien avant) : les messages sont cités', () => {
    expect(ceQuiAChange(undefined, DEPART.steps, true)).toContain('• Texto');
  });

  it('en anglais aussi', () => {
    const apres = etapes('Hi [client_first_name], any questions? — [company_name]', 'Your quote', 'Any questions?');
    const t = ceQuiAChange(DEPART.steps, apres, false);
    expect(t).toContain('New wording:');
    expect(t).toContain('• Text : « Hi [client_first_name], any questions? — [company_name] »');
    expect(t).toContain('• Email — subject « Your quote »');
    expect(ceQuiAChange(DEPART.steps, DEPART.steps, false)).toMatch(/I did not change anything/);
  });
});

describe('le prompt : « trop long » vise les messages, et la phrase dit ce qui a été fait', () => {
  const p = consignes(true);
  it('« trop long », « t’as rien changé » visent les MESSAGES au client', () => {
    expect(p).toMatch(/« Trop long », « plus court », « plus punché », « change le message »,\s+« t'as rien changé » visent les MESSAGES envoyés au client/);
  });
  it('un texto court garde l’ouverture DE SA LANGUE et la signature (régression anglaise du #799)', () => {
    expect(p).toMatch(/garde l'ouverture « Bonjour \[client_first_name\], »\s+et la signature \[company_name\]/);
    const en = consignes(false);
    expect(en).toMatch(/garde l'ouverture "Hi \[client_first_name\],"\s+et la signature/);
    expect(en).not.toMatch(/garde l'ouverture « Bonjour/);
    expect(en).toMatch(/LANGUE : l'entreprise travaille en ANGLAIS/);
    expect(p).not.toMatch(/LANGUE : l'entreprise travaille en ANGLAIS/);
  });
  it('un texto tient en 160 caractères ; une question se répond sans rien modifier', () => {
    expect(p).toMatch(/Un texto tient TOUJOURS en 160 caractères au plus/);
    expect(p).toMatch(/Une QUESTION sur le parcours[\s\S]*?"modifie": false/);
  });
  it('« resume » = ce qui vient d’être fait, pas une redescription', () => {
    expect(p).toMatch(/"resume" répond à la DERNIÈRE demande/);
  });
});

describe('le modèle', () => {
  it('Sonnet, pas Haiku (textes plats et phrase répétée mesurés sur Haiku)', () => {
    const src = readFileSync('server/lib/lumi/generer-parcours.ts', 'utf8');
    expect(src).toMatch(/const MODELE = 'claude-sonnet-5';/);
  });
});

describe('réponse illisible ou coupée (batterie qa:construire-lumi, 2026-09-30)', () => {
  const valide = JSON.stringify({ nom: 'R', trigger_event: 'quote.sent', resume: 'J’ai raccourci le texto.', modifie: true, steps: etapes('Bonjour [client_first_name], une question? — [company_name]', 'Objet', 'Texte'), autre: null });

  it('JSON illisible (accolade de trop) : UN second essai, et le client reçoit la bonne réponse', async () => {
    etat.appels = 0;
    etat.file = [{ texte: valide.replace('"suivant":"e3"}', '"suivant":"e3"}}') }, { texte: valide }];
    const r = await genererParcours({ ...base, langue: 'fr', demande: 'raccourcis le texto', parcoursActuel: DEPART });
    expect(etat.appels).toBe(2);
    expect(r.parcours?.resume).toContain('• Texto');
    expect(r.coutCents).toBeGreaterThan(0);
  });

  it('illisible deux fois : message clair, pas de troisième appel', async () => {
    etat.appels = 0;
    etat.file = [{ texte: 'Voici ce que je propose : …' }, { texte: 'Toujours du texte.' }];
    const r = await genererParcours({ ...base, langue: 'fr', demande: 'raccourcis le texto', parcoursActuel: DEPART });
    expect(etat.appels).toBe(2);
    expect(r.parcours).toBeNull();
    expect(r.erreur).toMatch(/n’a pas compris cette modification/);
  });

  it('réponse COUPÉE au plafond : dite comme telle, sans second essai', async () => {
    etat.appels = 0;
    etat.file = [{ texte: valide.slice(0, 120), stop: 'max_tokens' }];
    const r = await genererParcours({ ...base, langue: 'fr', demande: 'raccourcis le texto', parcoursActuel: DEPART });
    expect(etat.appels).toBe(1);
    expect(r.erreur).toMatch(/a été coupée/);
  });
});
