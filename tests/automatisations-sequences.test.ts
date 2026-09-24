/**
 * LES SÉQUENCES — parcours, branches, et surtout : pas de boucle.
 *
 * Une séquence est un graphe. Un graphe accepte ce qu'un tableau interdit :
 * `e1 → e2 → e1` enverrait des messages à un client jusqu'à la fin des temps.
 * C'est le risque principal de ce chantier, et la moitié de ce fichier existe
 * pour le rendre impossible.
 *
 * L'autre moitié protège l'anti-doublon : la clé d'unicité porte désormais
 * l'étape. Si elle cessait de distinguer deux étapes, une séquence se
 * bloquerait elle-même ; si elle cessait de dédupliquer, le client recevrait
 * tout en double — les deux sont arrivés en prod avant d'être corrigés.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  problemesDuGraphe,
  cleEtape,
  etapeSuivante,
  premiereEtape,
  trouverEtape,
  ETAPES_MAX_PAR_PARCOURS,
  type Etape,
} from '../server/lib/automationSequences';
import {
  nouvelIdEtape,
  etapeVierge,
  insererEtape,
  retirerEtape,
  type Etape as EtapeFront,
} from '../src/lib/sequenceTypes';
import { automationRuleCreateSchema } from '../server/lib/validation';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

const action = (id: string, suivant?: string | null): Etape => ({
  id, type: 'action',
  action: { type: 'send_sms', config: { body: `message ${id}` } },
  suivant: suivant ?? null,
});

describe('le graphe refuse ce qui ferait du mal', () => {
  it('accepte un parcours linéaire', () => {
    expect(problemesDuGraphe([action('e1', 'e2'), action('e2')])).toEqual([]);
  });

  it('REFUSE une boucle directe', () => {
    const p = problemesDuGraphe([action('e1', 'e2'), action('e2', 'e1')]);
    expect(p.join(' ')).toContain('revient sur lui-même');
  });

  it('REFUSE une boucle longue', () => {
    const p = problemesDuGraphe([action('e1', 'e2'), action('e2', 'e3'), action('e3', 'e1')]);
    expect(p.join(' ')).toContain('revient sur lui-même');
  });

  it('REFUSE une boucle qui passe par une branche « si »', () => {
    const steps: Etape[] = [
      action('e1', 'e2'),
      { id: 'e2', type: 'si', conditions: {}, alors: 'e3', sinon: null },
      action('e3', 'e1'),
    ];
    expect(problemesDuGraphe(steps).join(' ')).toContain('revient sur lui-même');
  });

  it('REFUSE une étape qui se pointe elle-même', () => {
    expect(problemesDuGraphe([action('e1', 'e1')]).join(' ')).toContain('revient sur lui-même');
  });

  it('REFUSE un renvoi vers une étape qui n\'existe pas', () => {
    expect(problemesDuGraphe([action('e1', 'fantome')]).join(' ')).toContain('n\'existe pas');
  });

  it('REFUSE deux étapes avec le même identifiant', () => {
    expect(problemesDuGraphe([action('e1'), action('e1')]).join(' ')).toContain('même identifiant');
  });

  it('REFUSE une séquence vide', () => {
    expect(problemesDuGraphe([]).length).toBeGreaterThan(0);
  });

  it('signale une séquence qui finit par une attente', () => {
    const steps: Etape[] = [action('e1', 'e2'), { id: 'e2', type: 'attendre', delai_secondes: 3600 }];
    expect(problemesDuGraphe(steps).join(' ')).toContain('se termine par une attente');
  });

  it('accepte un « si » dont une branche s\'arrête', () => {
    const steps: Etape[] = [
      { id: 'e1', type: 'si', conditions: { status: { eq: 'sent' } }, alors: 'e2', sinon: null },
      action('e2'),
    ];
    expect(problemesDuGraphe(steps)).toEqual([]);
  });

  it('accepte deux branches qui se rejoignent (losange)', () => {
    // Ce n'est PAS une boucle : les deux chemins convergent vers l'aval.
    const steps: Etape[] = [
      { id: 'e1', type: 'si', conditions: {}, alors: 'e2', sinon: 'e3' },
      action('e2', 'e4'),
      action('e3', 'e4'),
      action('e4'),
    ];
    expect(problemesDuGraphe(steps)).toEqual([]);
  });
});

describe('la clé d\'unicité — le double envoi ne doit pas revenir', () => {
  it('distingue deux étapes de la même séquence', () => {
    expect(cleEtape('r1', 'devis9', 'e1')).not.toBe(cleEtape('r1', 'devis9', 'e2'));
  });

  it('distingue deux entités', () => {
    expect(cleEtape('r1', 'devis9', 'e1')).not.toBe(cleEtape('r1', 'devis8', 'e1'));
  });

  it('est IDENTIQUE pour le même couple — c\'est ce qui déduplique', () => {
    expect(cleEtape('r1', 'devis9', 'e1')).toBe(cleEtape('r1', 'devis9', 'e1'));
  });

  it('ne contient PAS de date', () => {
    // Avec la date du jour, renvoyer le même devis le lendemain produisait une
    // clé différente : les tâches déjà en attente restaient, de nouvelles
    // s'ajoutaient, et le client recevait tout en double (constaté en prod).
    const cle = cleEtape('r1', 'devis9', 'e1');
    expect(cle).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(cle).toBe('r1:devis9:step:e1');
  });

  it('ne contient pas de « : » venant de l\'identifiant d\'étape', () => {
    // La clé est découpée sur « : » dans les journaux ; un id qui en contient
    // rendrait la clé ambiguë. La validation borne le format des ids.
    const source = lire('server/lib/validation.ts');
    expect(source).toMatch(/ID_ETAPE[\s\S]{0,200}regex\(/);
  });
});

describe('le parcours', () => {
  it('suit « suivant » sur une action', () => {
    expect(etapeSuivante(action('e1', 'e2'))).toBe('e2');
  });

  it('choisit la branche selon le verdict', () => {
    const si: Etape = { id: 'e1', type: 'si', conditions: {}, alors: 'oui', sinon: 'non' };
    expect(etapeSuivante(si, true)).toBe('oui');
    expect(etapeSuivante(si, false)).toBe('non');
  });

  it('s\'arrête sur une étape « arreter »', () => {
    expect(etapeSuivante({ id: 'e1', type: 'arreter' })).toBeNull();
  });

  it('trouve la première étape et une étape par id', () => {
    const steps = [action('e1', 'e2'), action('e2')];
    expect(premiereEtape(steps)?.id).toBe('e1');
    expect(trouverEtape(steps, 'e2')?.id).toBe('e2');
    expect(trouverEtape(steps, 'absent')).toBeNull();
    expect(trouverEtape(steps, null)).toBeNull();
  });

  it('borne le nombre d\'étapes franchies', () => {
    // Le filet qui rattrape une boucle passée entre les mailles de la
    // validation — par exemple sur une règle écrite avant cette garde.
    expect(ETAPES_MAX_PAR_PARCOURS).toBeGreaterThan(10);
    expect(ETAPES_MAX_PAR_PARCOURS).toBeLessThanOrEqual(100);
  });
});

describe('câbler le parcours depuis l\'interface', () => {
  it('insère en tête sans couper la suite', () => {
    const avant: EtapeFront[] = [action('e1') as EtapeFront];
    const apres = insererEtape(avant, etapeVierge('action', 'e2'), null);
    expect(apres[0].id).toBe('e2');
    expect((apres[0] as { suivant?: string | null }).suivant).toBe('e1');
  });

  it('insère au milieu sans amputer ce qui suit', () => {
    // Le défaut le plus facile à commettre : ajouter une attente entre deux
    // messages et faire disparaître le second.
    const avant: EtapeFront[] = [action('e1', 'e2') as EtapeFront, action('e2') as EtapeFront];
    const apres = insererEtape(avant, etapeVierge('attendre', 'e3'), 'e1');
    const e1 = apres.find((e) => e.id === 'e1') as { suivant?: string | null };
    const e3 = apres.find((e) => e.id === 'e3') as { suivant?: string | null };
    expect(e1.suivant).toBe('e3');
    expect(e3.suivant).toBe('e2');
  });

  it('insère sur la branche demandée d\'un « si »', () => {
    const avant: EtapeFront[] = [
      { id: 'e1', type: 'si', conditions: {}, alors: 'e2', sinon: null },
      action('e2') as EtapeFront,
    ];
    const apres = insererEtape(avant, etapeVierge('action', 'e3'), 'e1', 'sinon');
    const si = apres.find((e) => e.id === 'e1') as { alors?: string | null; sinon?: string | null };
    expect(si.sinon).toBe('e3');
    expect(si.alors).toBe('e2'); // l'autre branche est intacte
  });

  it('retire une étape en recousant le parcours', () => {
    const avant: EtapeFront[] = [
      action('e1', 'e2') as EtapeFront,
      action('e2', 'e3') as EtapeFront,
      action('e3') as EtapeFront,
    ];
    const apres = retirerEtape(avant, 'e2');
    expect(apres.map((e) => e.id)).toEqual(['e1', 'e3']);
    expect((apres[0] as { suivant?: string | null }).suivant).toBe('e3');
  });

  it('un retrait ne laisse jamais de renvoi orphelin', () => {
    const avant: EtapeFront[] = [
      { id: 'e1', type: 'si', conditions: {}, alors: 'e2', sinon: 'e3' },
      action('e2') as EtapeFront,
      action('e3') as EtapeFront,
    ];
    const apres = retirerEtape(avant, 'e2');
    expect(problemesDuGraphe(apres as unknown as Etape[])).toEqual([]);
  });

  it('donne un identifiant neuf, jamais déjà pris', () => {
    const steps = [action('e1'), action('e2')] as unknown as EtapeFront[];
    const neuf = nouvelIdEtape(steps);
    expect(neuf).toBe('e3');
    expect(steps.some((e) => e.id === neuf)).toBe(false);
  });
});

describe('validation serveur — ce qui peut être enregistré', () => {
  const base = {
    name: 'Relance',
    trigger_event: 'quote.sent',
    delay_seconds: 0,
    actions: [{ type: 'send_sms', config: { body: 'x' } }],
  };

  it('accepte une séquence bien formée', () => {
    const r = automationRuleCreateSchema.safeParse({
      ...base,
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: 'e2' },
        { id: 'e2', type: 'attendre', delai_secondes: 259200, suivant: 'e3' },
        { id: 'e3', type: 'si', conditions: { status: { eq: 'sent' } }, alors: 'e4', sinon: null },
        { id: 'e4', type: 'action', action: { type: 'send_email', config: { subject: 'Suivi', body: 'Bonjour' } } },
      ],
    });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('REFUSE une séquence qui boucle', () => {
    const r = automationRuleCreateSchema.safeParse({
      ...base,
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'a' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'b' } }, suivant: 'e1' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('REFUSE une attente négative', () => {
    const r = automationRuleCreateSchema.safeParse({
      ...base,
      steps: [{ id: 'e1', type: 'attendre', delai_secondes: -3600, suivant: null }],
    });
    expect(r.success).toBe(false);
  });

  it('REFUSE un destinataire dans une étape', () => {
    // Même garde que pour les règles simples : DESTINATAIRE_IMPOSE ne doit pas
    // pouvoir rentrer par la porte des séquences.
    const r = automationRuleCreateSchema.safeParse({
      ...base,
      steps: [{
        id: 'e1', type: 'action',
        action: { type: 'send_email', config: { subject: 'a', body: 'b', to: 'pirate@example.com' } },
      }],
    });
    expect(r.success).toBe(false);
  });

  it('REFUSE un identifiant d\'étape avec un « : »', () => {
    const r = automationRuleCreateSchema.safeParse({
      ...base,
      steps: [{ id: 'e1:x', type: 'action', action: { type: 'send_sms', config: { body: 'a' } } }],
    });
    expect(r.success).toBe(false);
  });

  it('accepte l\'absence de steps — une règle simple reste simple', () => {
    expect(automationRuleCreateSchema.safeParse(base).success).toBe(true);
    expect(automationRuleCreateSchema.safeParse({ ...base, steps: null }).success).toBe(true);
  });

  it('accepte un parcours VIDE et le ramene a null', () => {
    // L'etat d'une automatisation qu'on vient de creer : le parcours n'est pas
    // encore dessine. Le refuser faisait echouer l'enregistrement automatique
    // du builder a chaque frappe, et le travail se perdait sans un mot
    // (constate en vrai : PATCH 400 « A sequence needs at least one step »).
    const r = automationRuleCreateSchema.safeParse({ ...base, steps: [] });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    expect(r.success && r.data.steps).toBeNull();
  });

  it('la normalisation du parcours vide est bien dans la source', () => {
    // Le test ci-dessus passe par le schema deja importe ; celui-ci lit la
    // SOURCE, pour attraper le cas ou quelqu'un retirerait la normalisation.
    const src = lire('server/lib/validation.ts');
    expect(src).toContain('z.array(z.never()).max(0)');
    expect(src).toContain('Array.isArray(v) && v.length === 0 ? null : v');
  });
});

describe('le moteur lit et avance vraiment', () => {
  const moteur = lire('server/lib/automationEngine.ts');

  it('charge `steps` avec la règle — sinon les séquences seraient invisibles', () => {
    // Avec PostgREST, une colonne oubliée dans le select ne lève pas : la
    // fonctionnalité meurt en silence. C'est écrit dans CLAUDE.md, et c'est
    // exactement ce qui arriverait ici.
    // `settings` s'est ajouté depuis : ce qui compte, c'est que `steps` soit
    // toujours là — une colonne oubliée ici rend les séquences invisibles.
    const selectMoteur = moteur.slice(moteur.indexOf('automation_rule_id_fkey('));
    const colonnesChargees = selectMoteur.slice(0, selectMoteur.indexOf(')'));
    expect(colonnesChargees, 'steps doit etre charge avec la regle').toContain('steps');
  });

  it('démarre une séquence au déclenchement', () => {
    expect(moteur).toMatch(/Array\.isArray\(rule\.steps\)/);
    expect(moteur).toMatch(/planifierEtape/);
  });

  it('n\'avance QUE sur succès', () => {
    // Enchaîner après un échec ferait partir la suite alors que le message
    // précédent n'est jamais parti.
    expect(moteur).toMatch(/if \(result\.success && task\.step_id/);
  });

  it('évalue une branche sur l\'état ACTUEL, pas celui du déclenchement', () => {
    expect(moteur).toMatch(/metadonneesFraiches/);
  });

  it('réutilise l\'évaluateur de conditions des règles simples', () => {
    // Deux moteurs de conditions finiraient par diverger.
    const bloc = moteur.slice(moteur.indexOf('etape.type === \'si\''));
    expect(bloc.slice(0, 1200)).toMatch(/evaluateConditions/);
  });
});

describe('les deux copies des types ne divergent pas', () => {
  it('les mêmes types d\'étapes des deux côtés', () => {
    // `src/` n'a pas le droit d'importer `server/`, d'où deux déclarations.
    // Deux copies qui divergent en silence seraient pires qu'une dépendance.
    const serveur = lire('server/lib/automationSequences.ts');
    const client = lire('src/lib/sequenceTypes.ts');
    for (const t of ['action', 'attendre', 'si', 'arreter']) {
      expect(serveur).toContain(`'${t}'`);
      expect(client).toContain(`'${t}'`);
    }
    for (const champ of ['delai_secondes', 'suivant', 'alors', 'sinon']) {
      expect(serveur, `${champ} manque côté serveur`).toContain(champ);
      expect(client, `${champ} manque côté client`).toContain(champ);
    }
  });
});

describe('réglages par automatisation — le moteur les respecte vraiment', () => {
  /** Un moment donné, en heure du Québec. */
  const a = (h: number, jour = 15) => new Date(`2026-09-${jour}T${String(h).padStart(2, '0')}:00:00-04:00`);

  it('sans réglage, la fenêtre reste 8 h – 20 h', async () => {
    const { horsFenetre } = await import('../server/lib/automationEngine');
    expect(horsFenetre(null, a(7))).toBe(true);
    expect(horsFenetre(null, a(9))).toBe(false);
    expect(horsFenetre(null, a(19))).toBe(false);
    expect(horsFenetre(null, a(21))).toBe(true);
    // Une règle qui n'a jamais été touchée doit se comporter EXACTEMENT
    // comme avant : c'est la promesse d'une migration additive.
    expect(horsFenetre(undefined, a(9))).toBe(false);
  });

  it('une fenêtre personnalisée change vraiment le comportement', async () => {
    const { horsFenetre } = await import('../server/lib/automationEngine');
    const urgence = { fenetre: { debut: 6, fin: 23 } };
    expect(horsFenetre(urgence, a(7)), '7 h doit passer avec une fenêtre 6-23').toBe(false);
    expect(horsFenetre(urgence, a(22)), '22 h doit passer').toBe(false);
    expect(horsFenetre(urgence, a(5)), '5 h reste hors fenêtre').toBe(true);
  });

  it('« jours ouvrables » bloque la fin de semaine', async () => {
    const { horsFenetre } = await import('../server/lib/automationEngine');
    // Le 19 septembre 2026 est un samedi, le 21 un lundi.
    expect(horsFenetre({ jours_ouvrables: true }, a(10, 19)), 'samedi 10 h doit être bloqué').toBe(true);
    expect(horsFenetre({ jours_ouvrables: true }, a(10, 21)), 'lundi 10 h doit passer').toBe(false);
    // Sans le réglage, le samedi passe comme avant.
    expect(horsFenetre(null, a(10, 19))).toBe(false);
  });

  it('le prochain créneau sort de la fenêtre calme', async () => {
    const { nextSendTime, horsFenetre } = await import('../server/lib/automationEngine');
    const nuit = a(3);
    const prochain = nextSendTime(nuit, null);
    expect(prochain.getTime()).toBeGreaterThan(nuit.getTime());
    expect(horsFenetre(null, prochain), 'le créneau trouvé doit être DANS la fenêtre').toBe(false);
  });

  it('avec « jours ouvrables », le samedi attend jusqu\'à lundi', async () => {
    const { nextSendTime, horsFenetre } = await import('../server/lib/automationEngine');
    const r = { jours_ouvrables: true };
    // Samedi 10 h : 24 h de recherche ne suffiraient pas, il faut aller
    // jusqu'à lundi — d'où les 144 pas au lieu de 48.
    const prochain = nextSendTime(a(10, 19), r);
    expect(horsFenetre(r, prochain), 'le créneau trouvé doit être un jour ouvrable').toBe(false);
  });

  it('la validation refuse une fenêtre inversée', async () => {
    const { automationSettingsSchema } = await import('../server/lib/validation');
    // 20 h → 8 h ne laisserait JAMAIS rien passer : le moteur attendrait
    // pour toujours, sans un mot.
    expect(automationSettingsSchema.safeParse({ fenetre: { debut: 20, fin: 8 } }).success).toBe(false);
    expect(automationSettingsSchema.safeParse({ fenetre: { debut: 8, fin: 20 } }).success).toBe(true);
  });

  it('la validation refuse un réglage inventé', async () => {
    const { automationSettingsSchema } = await import('../server/lib/validation');
    expect(automationSettingsSchema.safeParse({ envoyer_des_licornes: true }).success).toBe(false);
  });

  it('le worker charge bien `settings` avec la règle', () => {
    // Sans cette colonne dans le select, la fenêtre personnalisée ne
    // s'appliquerait qu'aux envois immédiats — et personne ne le verrait.
    const moteur = lire('server/lib/automationEngine.ts');
    expect(moteur).toContain('conditions, steps, settings)');
  });
});
