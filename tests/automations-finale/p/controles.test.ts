/**
 * Agent P — les contrôles de publication qui manquaient (src/lib/automationControles.ts),
 * mission points 8 (variable inconnue → refus) et 18 (validation bloquante, 25 étapes).
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/controles.test.ts
 *
 * Deux garde-fous encadrent ces contrôles :
 *   · ils ne REDISENT rien de ce que `problemesPublication` dit déjà ;
 *   · aucun préréglage, parcours du pack ni modèle fourni par Lume n'est bloqué.
 */
import { describe, it, expect } from 'vitest';
import { controlesPublication, enProblemes, texteVisible, ETAPES_AVANT_SUGGESTION, type RegleAControler } from '../../../src/lib/automationControles';
import { problemesPublication } from '../../../src/lib/publicationAutomatisation';
import { AUTOMATION_PRESETS } from '../../../server/lib/automationPresets.data';
import { PACK_PARCOURS } from '../../../server/lib/automationPack.data';
import { MODELES_AUTOMATISATION } from '../../../server/lib/automationTemplates';
import type { ChampPourVariables } from '../../../src/lib/automationVariables';

const texto = (body: string, plus: Record<string, unknown> = {}) => ({ type: 'send_sms', config: { body, ...plus } });
const courriel = (subject: string, body: string, plus: Record<string, unknown> = {}) => ({ type: 'send_email', config: { subject, body, ...plus } });
const etape = (id: string, action: { type: string; config: Record<string, unknown> }, suivant: string | null = null, nom?: string) =>
  ({ id, type: 'action', action, suivant, ...(nom ? { nom } : {}) });
const attente = (id: string, delai_secondes: number, suivant: string | null, plus: Record<string, unknown> = {}) =>
  ({ id, type: 'attendre', delai_secondes, suivant, ...plus });
const regle = (steps: unknown[], p: Partial<RegleAControler> = {}): RegleAControler => ({ trigger_event: 'lead.created', conditions: {}, steps, actions: [], ...p });
const codes = (r: RegleAControler, champs?: ChampPourVariables[]) => controlesPublication(r, { champs }).bloquants.map((c) => c.code);
const BON = 'Bonjour [client_first_name], ici [company_name]. Merci de votre demande !';

describe('P — contrôles : une automatisation saine ne déclenche rien', () => {
  it('un parcours ordinaire : aucun bloquant, aucun avertissement', () => {
    const r = regle([etape('e1', texto(BON), 'e2'), attente('e2', 86400, 'e3'), etape('e3', courriel('Suivi', '<p>Bonjour [client_first_name|là],</p>'))]);
    expect(controlesPublication(r)).toEqual({ bloquants: [], avertissements: [] });
  });

  it('AUCUN préréglage, parcours du pack ni modèle fourni par Lume n’est bloqué', () => {
    const fautifs: string[] = [];
    for (const p of AUTOMATION_PRESETS) {
      // Semé (`is_preset`) : non contrôlé. Copié et retouché (plus un préréglage) : contrôlé — il doit passer aussi.
      for (const is_preset of [true, false]) {
        const c = controlesPublication({ ...p, is_preset, steps: [] });
        if (c.bloquants.length) fautifs.push(`${p.preset_key} : ${c.bloquants.map((b) => b.fr).join(' | ')}`);
      }
    }
    for (const p of PACK_PARCOURS) {
      const c = controlesPublication(p);
      if (c.bloquants.length) fautifs.push(`${p.preset_key} : ${c.bloquants.map((b) => b.fr).join(' | ')}`);
    }
    for (const m of MODELES_AUTOMATISATION) {
      const r = m as unknown as RegleAControler & { id?: string };
      const c = controlesPublication(r);
      if (c.bloquants.length) fautifs.push(`modèle ${r.id ?? ''} : ${c.bloquants.map((b) => b.fr).join(' | ')}`);
    }
    expect(fautifs).toEqual([]);
  });
});

describe('P — contrôles : variable inconnue, hors contexte, mal écrite → BLOQUANT, qui nomme l’étape et la variable', () => {
  it('[mission 8 / cible de E-45] « Étape “Courriel de relance” : [prenom_du_client] n’existe pas »', () => {
    const r = regle([etape('e1', courriel('Relance', '<p>Bonjour [prenom_du_client], à demain.</p>'), null, 'Courriel de relance')]);
    const c = controlesPublication(r).bloquants;
    expect(c).toEqual([{
      code: 'variable_inconnue', etapeId: 'e1',
      fr: 'Étape « Courriel de relance » : [prenom_du_client] n’existe pas : elle serait vide dans le message envoyé.',
      en: 'Step “Courriel de relance”: [prenom_du_client] does not exist: it would be empty in the message sent.',
    }]);
  });

  it('[cible de E-47] une variable de FACTURE sur « Nouveau prospect » : hors contexte — et la même, sur une facture, passe', () => {
    const steps = [etape('e1', texto('Bonjour, payez ici : [invoice_link] ([invoice_total]).'))];
    expect(codes(regle(steps))).toEqual(['variable_hors_contexte', 'variable_hors_contexte']);
    expect(controlesPublication(regle(steps)).bloquants[0].fr)
      .toBe('Étape 1 (Envoyer un texto) : [invoice_link] n’a pas de valeur sur « Nouveau prospect » : elle serait vide dans le message envoyé.');
    expect(codes(regle(steps, { trigger_event: 'invoice.overdue' }))).toEqual([]);
  });

  it('[cible de E-46] {prénom} : mal écrite ; un remplacement de plus de 60 caractères aussi', () => {
    expect(codes(regle([etape('e1', texto('Bonjour {prénom},'))]))).toEqual(['variable_mal_ecrite']);
    expect(codes(regle([etape('e1', texto(`Bonjour [client_first_name|${'x'.repeat(61)}]`))]))).toEqual(['remplacement_trop_long']);
  });

  it('TOUS les champs de texte sont contrôlés : objet, aperçu, corps — et leur version anglaise', () => {
    const r = regle([etape('e1', courriel('Bonjour [prenom]', '<p>ok</p>', { preheader: '[apercu_inconnu]', body_en: '<p>Hi [first_name]</p>', subject_en: 'Hi' }))]);
    const c = controlesPublication(r).bloquants;
    expect(c.map((b) => b.fr.match(/\[[a-z_]+\]/)?.[0])).toEqual(['[prenom]', '[apercu_inconnu]', '[first_name]']);
  });

  it('une notification interne et le titre d’une tâche sont contrôlés aussi', () => {
    expect(codes(regle([etape('e1', { type: 'create_notification', config: { title: 'Nouveau : [nom_du_prospect]' } })]))).toEqual(['variable_inconnue']);
    expect(codes(regle([etape('e1', { type: 'create_task', config: { title: 'Rappeler [client_name]' } })]))).toEqual([]);
  });

  it('avec la liste des champs du bureau, un champ de fiche inexistant est bloquant ; sans elle, on ne tranche pas', () => {
    const champs: ChampPourVariables[] = [{ object_type: 'client', key: 'refere_par', label: 'Référé par', field_type: 'single_line', config: {}, archived_at: null }];
    const r = regle([etape('e1', texto('Merci {{client.refere_par}} et {{client.toitur}}'))]);
    expect(codes(r, champs)).toEqual(['variable_inconnue']);
    expect(codes(r)).toEqual([]);
  });

  it('une règle au format d’origine (non convertie) est contrôlée action par action', () => {
    const r: RegleAControler = { trigger_event: 'lead.created', steps: [], actions: [texto(BON), texto('Bonjour [prenom]')] };
    expect(controlesPublication(r).bloquants).toEqual([{
      code: 'variable_inconnue', etapeId: undefined,
      fr: 'Action 2 (Envoyer un texto) : [prenom] n’existe pas : elle serait vide dans le message envoyé.',
      en: 'Action 2 (Send a text message): [prenom] does not exist: it would be empty in the message sent.',
    }]);
    // Un préréglage semé, jamais converti : non contrôlé (il tourne tel que semé).
    expect(codes({ ...r, is_preset: true })).toEqual([]);
  });
});

describe('P — contrôles : parcours cassé (mission 18)', () => {
  it('message vide une fois la mise en forme retirée → bloquant ; vraiment vide : laissé à `problemesPublication`', () => {
    expect(texteVisible('<div style="x"><p><br></p>&nbsp;</div>')).toBe('');
    expect(texteVisible('<p>Bonjour&nbsp;là</p>')).toBe('Bonjour là');
    expect(codes(regle([etape('e1', courriel('Objet', '<div style="font-family:sans-serif"><p><br></p></div>'))]))).toEqual(['message_vide']);
    expect(codes(regle([etape('e1', courriel('Objet', '<p>Bonjour</p>', { body_en: '<p> </p>' }))]))).toEqual(['message_vide']);
    expect(controlesPublication(regle([etape('e1', courriel('Objet', '<p></p>', {}), null)])).bloquants[0].fr)
      .toBe('Étape 1 (Envoyer un courriel) : « Message » ne contient que de la mise en forme — le client recevrait un message vide.');
    // Champ obligatoire tout simplement vide : c'est `problemesPublication` qui le dit, pas nous (aucun doublon).
    expect(codes(regle([etape('e1', texto(''))]))).toEqual([]);
    expect(problemesPublication({ ...regle([etape('e1', texto(''))]) }).some((p) => /est vide/.test(p.message))).toBe(true);
  });

  it('attente sans durée → bloquant, dans les trois modes', () => {
    expect(codes(regle([attente('a', 0, 'b'), etape('b', texto(BON))]))).toEqual(['attente_sans_duree']);
    expect(codes(regle([attente('a', 0, 'b', { mode: 'reponse' }), etape('b', texto(BON))]))).toEqual(['attente_sans_duree']);
    expect(codes(regle([attente('a', 0, 'b', { mode: 'avant_date' }), etape('b', texto(BON))], { trigger_event: 'appointment.created' }))).toEqual(['attente_sans_duree']);
    expect(codes(regle([attente('a', 0, 'b', { mode: 'avant_date', secondes_avant: 86400 }), etape('b', texto(BON))], { trigger_event: 'appointment.created' }))).toEqual([]);
    expect(controlesPublication(regle([attente('a', 0, 'b'), etape('b', texto(BON))])).bloquants[0])
      .toMatchObject({ etapeId: 'a', fr: 'Étape 1 : l’attente n’a pas de durée — la suite partirait tout de suite.' });
  });

  it('condition dont aucune branche ne mène quelque part → bloquant ; une seule branche remplie suffit', () => {
    const si = (alors: string | null, sinon: string | null) => ({ id: 's', type: 'si', conditions: { status: 'approved' }, alors, sinon });
    expect(codes(regle([si(null, null)]))).toEqual(['branche_vide']);
    expect(codes(regle([si('e1', null), etape('e1', texto(BON))]))).toEqual([]);
    expect(codes(regle([si(null, 'e1'), etape('e1', texto(BON))]))).toEqual([]);
  });

  it('étape que rien n’atteint → bloquant, et nommée', () => {
    const r = regle([etape('e1', texto(BON)), etape('perdue', texto(BON), null, 'Rappel oublié')]);
    expect(controlesPublication(r).bloquants).toEqual([{
      code: 'etape_orpheline', etapeId: 'perdue',
      fr: 'Étape « Rappel oublié » : rien ne mène à cette étape, elle ne s’exécuterait jamais. Reliez-la au parcours ou supprimez-la.',
      en: 'Step “Rappel oublié”: nothing leads to this step, it would never run. Connect it to the journey or delete it.',
    }]);
    // Atteinte par une branche « sinon », par « si le client répond » ou par « si la date est passée » : pas orpheline.
    expect(codes(regle([
      { id: 's', type: 'si', conditions: { a: 1 }, alors: 'w', sinon: 'non' },
      attente('w', 3600, 'oui', { mode: 'reponse', si_reponse: 'rep' }),
      etape('oui', texto(BON)), etape('non', texto(BON)), etape('rep', texto(BON)),
    ]))).toEqual([]);
  });

  it('parcours qui revient sur lui-même → bloquant (une fois), sans tourner en rond', () => {
    const r = regle([etape('e1', texto(BON), 'e2'), attente('e2', 3600, 'e1')]);
    expect(codes(r)).toEqual(['boucle']);
  });

  it('message au client sur « Appel reçu de l’extérieur » (aucun client) → bloquant ; une action interne passe', () => {
    expect(codes(regle([etape('e1', texto('Bonjour, ici [company_name].'))], { trigger_event: 'webhook.received' }))).toEqual(['sans_destinataire']);
    expect(codes(regle([etape('e1', { type: 'create_notification', config: { title: 'Appel reçu' } })], { trigger_event: 'webhook.received' }))).toEqual([]);
  });

  it(`plus de ${ETAPES_AVANT_SUGGESTION} étapes → un AVERTISSEMENT doux, jamais un refus ; ${ETAPES_AVANT_SUGGESTION} étapes : rien`, () => {
    const parcours = (n: number) => Array.from({ length: n }, (_, i) => etape(`e${i + 1}`, texto(BON), i + 1 < n ? `e${i + 2}` : null));
    expect(ETAPES_AVANT_SUGGESTION).toBe(25);
    expect(controlesPublication(regle(parcours(25)))).toEqual({ bloquants: [], avertissements: [] });
    const c = controlesPublication(regle(parcours(26)));
    expect(c.bloquants).toEqual([]);
    expect(c.avertissements).toEqual([{
      code: 'trop_d_etapes',
      fr: 'Ce parcours compte 26 étapes. Au-delà de 25, il devient difficile à suivre et à corriger : pensez à le séparer en deux automatisations.',
      en: 'This journey has 26 steps. Past 25, it gets hard to follow and to fix: consider splitting it into two automations.',
    }]);
  });
});

describe('P — contrôles : le branchement dans `problemesPublication` tient en une ligne', () => {
  it('`enProblemes` rend la forme de `problemesPublication` (message, gravité, étape), dans la langue demandée', () => {
    const r = { ...regle([etape('e1', texto('Bonjour [prenom]'), 'e2'), attente('e2', 0, null)]), fr: false };
    expect(enProblemes(r)).toEqual([
      { message: 'Step 1 (Send a text message): [prenom] does not exist: it would be empty in the message sent.', gravite: 'bloquant', etapeId: 'e1' },
      { message: 'Step 2: the wait has no duration — what follows would go out right away.', gravite: 'bloquant', etapeId: 'e2' },
    ]);
    expect(enProblemes({ ...r, fr: true })[0].message).toMatch(/^Étape 1 \(Envoyer un texto\)/);
  });

  it('mis bout à bout avec `problemesPublication`, aucun problème n’est dit deux fois', () => {
    const cas: RegleAControler[] = [
      regle([etape('e1', texto(''))]),
      regle([etape('e1', texto(BON), 'fantome')]),
      regle([attente('a', 86400, null)]),
      regle([{ id: 's', type: 'si', conditions: {}, alors: null, sinon: null }]),
      regle([etape('e1', { type: 'envoyer_facture', config: {} })]),
      regle([etape('e1', texto('Bonjour [prenom]'))], { trigger_event: null }),
      regle([]),
    ];
    for (const r of cas) {
      const tous = [...problemesPublication({ ...r }), ...enProblemes(r)].map((p) => p.message);
      expect(new Set(tous).size, JSON.stringify(tous)).toBe(tous.length);
    }
  });
});
