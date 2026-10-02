/**
 * Agent P — le catalogue des variables (src/lib/automationVariables.ts) contre ce
 * que le MOTEUR remplit vraiment.
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/variables-parite.test.ts
 *
 * Une variable offerte que le moteur laisse vide est le défaut qu'on corrige :
 * ces tests gardent le catalogue et le moteur d'accord, dans les deux sens.
 *
 * QUAND UN TEST « EN ATTENTE » ROUGIT : c'est une bonne nouvelle — le moteur
 * remplit maintenant la variable. Retirer `enAttente` de son entrée dans le
 * catalogue (ou passer `CHAMPS_DE_FICHE_SUR_RENDEZ_VOUS` à vrai) : la palette
 * l'offrira, le détecteur la reconnaîtra.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CATALOGUE_VARIABLES, clesDuCatalogue, variablesEnAttente, appliquerRemplacement, variablesInconnues,
  CHAMPS_DE_FICHE_SUR_RENDEZ_VOUS, objetsDeChamps, objetsOfferts,
} from '../../../src/lib/automationVariables';
import { VARIABLES_CONNUES, VARIABLES_POINTEES_CONNUES, VARIABLES_PROPOSEES } from '../../../src/lib/emailBodyText';
import { resolveTemplate } from '../../../server/lib/actions/index';
import { AUTOMATION_PRESETS } from '../../../server/lib/automationPresets.data';
import { PACK_PARCOURS } from '../../../server/lib/automationPack.data';
import { ENTITE_PAR_DECLENCHEUR } from '../../../src/lib/automationCatalogue';
import { champsSysteme } from '../../../src/lib/champs/standard';

const RACINE = resolve(__dirname, '../../..');
const MOTEUR = readFileSync(resolve(RACINE, 'server/lib/actions/index.ts'), 'utf8');
const SYSTEME = readFileSync(resolve(RACINE, 'server/lib/champs/variablesSysteme.ts'), 'utf8');

/** Le moteur pose-t-il cette clé ? `vars.cle =`, `vars['a.b'] =`, ou une clé d'objet `cle:` rendue par un résolveur. */
function moteurRemplit(jeton: string): boolean {
  const e = jeton.replace(/[.]/g, '\\.');
  return new RegExp(`vars\\.${e}\\s*=|vars\\['${e}'\\]\\s*=|['"]${e}['"]\\s*:|\\b${e}\\s*:`).test(MOTEUR);
}

describe('P — variables : le catalogue et le moteur disent la même chose', () => {
  it('tout ce que le détecteur d’aujourd’hui accepte est au catalogue (rien de valide ne deviendra « inconnu »)', () => {
    const catalogue = new Set(clesDuCatalogue());
    expect(VARIABLES_CONNUES.filter((c) => !catalogue.has(c))).toEqual([]);
    expect(VARIABLES_POINTEES_CONNUES.filter((c) => !catalogue.has(c))).toEqual([]);
    expect(VARIABLES_PROPOSEES.map((x) => x.cle).filter((c) => !catalogue.has(c))).toEqual([]);
  });

  it('…et le catalogue n’invente rien : chaque variable « classique » qu’il offre est dans la liste du détecteur d’aujourd’hui', () => {
    const connues = new Set([...VARIABLES_CONNUES, ...VARIABLES_POINTEES_CONNUES]);
    const classiques = CATALOGUE_VARIABLES.filter((x) => !x.enAttente && !/^job\./.test(x.jeton)).map((x) => x.jeton);
    expect(classiques.filter((c) => !connues.has(c))).toEqual([]);
  });

  it('chaque variable du catalogue (hors « en attente ») est POSÉE par le moteur', () => {
    const absentes = CATALOGUE_VARIABLES
      .filter((x) => !x.enAttente && !/^job\./.test(x.jeton))
      .filter((x) => !moteurRemplit(x.jeton))
      .map((x) => x.jeton);
    expect(absentes).toEqual([]);
  });

  it('les champs de fiche offerts en « Champs de base » (`{{job.visits}}`…) sont calculés par le serveur', () => {
    for (const x of CATALOGUE_VARIABLES.filter((c) => /^job\./.test(c.jeton))) {
      const cle = x.jeton.split('.')[1];
      expect(champsSysteme('job').some((c) => c.key === cle), x.jeton).toBe(true);
      expect(new RegExp(`\\b${cle}:`).test(SYSTEME), `${x.jeton} absent de variablesSysteme.ts`).toBe(true);
    }
  });

  it('EN ATTENTE — le moteur ne remplit pas encore ces variables (si ce test rougit : retirer `enAttente`, voir l’en-tête)', () => {
    const enAttente = variablesEnAttente().map((x) => x.jeton);
    expect(enAttente).toEqual(['company_email', 'invoice_balance', 'invoice_days_overdue', 'technician_name']);
    expect(enAttente.filter(moteurRemplit), 'le moteur remplit maintenant ces variables : retirer `enAttente` dans automationVariables.ts').toEqual([]);
    // Tant qu'elles attendent : ni offertes, ni reconnues.
    for (const j of enAttente) expect(variablesInconnues(`[${j}]`, 'invoice.overdue').map((p) => p.raison)).toEqual(['inconnue']);
  });

  it('EN ATTENTE — sur un rendez-vous, le moteur ne remplit pas les champs de fiche (E-37) ; le drapeau du catalogue suit le moteur', () => {
    const debut = MOTEUR.indexOf('const liens: Record<string');
    expect(debut).toBeGreaterThan(-1);
    const bloc = MOTEUR.slice(debut, MOTEUR.indexOf('Object.assign(vars, await variablesChamps', debut));
    const moteurLeFait = /schedule_event|appointment/.test(bloc);
    expect(CHAMPS_DE_FICHE_SUR_RENDEZ_VOUS, moteurLeFait
      ? 'le moteur remplit maintenant les champs de fiche d’un rendez-vous : passer CHAMPS_DE_FICHE_SUR_RENDEZ_VOUS à true'
      : 'le drapeau est allumé mais le moteur ne remplit rien : {{client.first_name}} partirait vide').toBe(moteurLeFait);
    expect(objetsDeChamps('schedule_event')).toEqual(CHAMPS_DE_FICHE_SUR_RENDEZ_VOUS ? ['client', 'job'] : []);
  });

  it('chaque fiche que le catalogue cite est une entité que le moteur fait arriver ; la palette n’offre jamais plus que le moteur ne remplit', () => {
    const entites = new Set(Object.values(ENTITE_PAR_DECLENCHEUR).map((e) => (e === 'lead' ? 'client' : e)));
    for (const x of CATALOGUE_VARIABLES) {
      if (x.entites === '*') continue;
      for (const e of x.entites) expect(entites.has(e), `${x.jeton} cite « ${e} »`).toBe(true);
    }
    for (const e of [...entites, null]) {
      const entite = e === '*' ? null : e;
      expect(objetsOfferts(entite).filter((o) => !objetsDeChamps(entite).includes(o)), String(e)).toEqual([]);
    }
  });
});

describe('P — variables : `appliquerRemplacement` rend comme le moteur (`resolveTemplate`)', () => {
  const VARS: Record<string, string> = {
    client_first_name: 'Zoé-Ève', client_last_name: 'Tremblay', client_name: 'Zoé-Ève Tremblay', company_name: 'Lavage & Fils <inc.>', company_phone: '514 555-0100',
    invoice_number: 'F-0042', invoice_total: '517,39 $', invoice_due_date: '15 octobre 2026', invoice_link: 'https://app.exemple.test/invoice/1111',
    quote_number: 'D-0218', quote_total: '1 437,19 $', quote_link: 'https://app.exemple.test/quote/2222',
    appointment_date: '14 octobre 2026', appointment_time: '09 h 00', job_name: 'Lavage "de" vitres', contract_html: '<p>À signer</p>',
    client_cf_refere_par: 'Luc & Fils <b>inc.</b>', 'client.nom': 'Zoé-Ève Tremblay', 'soumission.total': '1 437,19 $',
  };
  const HTML_DE_LUME = new Set(['contract_html']);
  type Action = { type?: string; config?: Record<string, unknown> };
  const gabarits: string[] = [
    'Bonjour [client_first_name], ici {company_name} — « ça va » ? 100 % 🙂',
    'Rabais [50] %, étape {0}, [ci-dessous], [A-1234], {{ client_name }}, {{client.refere_par}}, {{soumission.total}}, {{client.nom}}',
    '[constructor] {toString} [__proto__] {{hasOwnProperty}}',
    '<p>Référé par : {{client.refere_par}} — [client_first_name] [contract_html] {job_name}</p>',
    'Bonjour [prenom], total {{facture.solde}}. {prénom} [côté] [client name]',
    '', '[', '{{', '[[client_name]]', '{{{client_name}}}', '{client_name}}', 'a [client_name] b [client_name] c',
  ];
  for (const p of AUTOMATION_PRESETS) for (const a of (p.actions ?? []) as Action[]) for (const t of Object.values(a.config ?? {})) if (typeof t === 'string') gabarits.push(t);
  for (const p of PACK_PARCOURS) {
    for (const e of ((p as unknown as { steps?: Array<{ action?: Action }> }).steps ?? [])) for (const t of Object.values(e.action?.config ?? {})) if (typeof t === 'string') gabarits.push(t);
  }

  it('le corpus : les cas limites et tous les textes fournis par Lume (plus de 150 gabarits)', () => {
    expect(gabarits.length).toBeGreaterThan(150);
  });

  it('texte brut : sortie IDENTIQUE à celle du moteur, gabarit par gabarit', () => {
    for (const g of gabarits) expect(appliquerRemplacement(g, VARS), g.slice(0, 80)).toBe(resolveTemplate(g, VARS));
  });

  it('corps de courriel (HTML) : sortie IDENTIQUE — mêmes échappements, même exception pour le HTML bâti par Lume', () => {
    for (const g of gabarits) {
      expect(appliquerRemplacement(g, VARS, { html: true, htmlDeConfiance: HTML_DE_LUME }), g.slice(0, 80)).toBe(resolveTemplate(g, VARS, { html: true }));
    }
  });

  it('sans aucune valeur : sortie IDENTIQUE (tout part vide, rien d’autre ne bouge)', () => {
    for (const g of gabarits) expect(appliquerRemplacement(g, {}), g.slice(0, 80)).toBe(resolveTemplate(g, {}));
  });
});
