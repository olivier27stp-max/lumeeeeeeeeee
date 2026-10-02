/**
 * Agent E — point 8 de la mission : les variables d'un message (« Insérer un champ »).
 * Fonctions PURES du moteur et de l'éditeur, sans réseau.
 *
 *   npx vitest run --maxWorkers=2 --config tests/automations-finale/e/vitest.config.ts --project e-unitaires
 *
 * « témoin » = vert aujourd'hui. Les autres sont ROUGES aujourd'hui (défaut ou
 * manque constaté, voir D:/lume-final/notes/E-constats.md) et deviendront verts
 * une fois le correctif posé.
 */
import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '../../../../server/lib/actions/index';
import { variablesInconnues, VARIABLES_CONNUES, VARIABLES_PROPOSEES } from '../../../../src/lib/emailBodyText';
import { automationRuleCreateSchema } from '../../../../server/lib/validation';
import { champsSysteme } from '../../../../src/lib/champs/standard';
import { OBJETS } from '../../../../src/lib/champs/types';

const VARS = {
  client_first_name: 'Marie', client_name: 'Marie Tremblay', company_name: 'Lavage Éclair inc.',
  invoice_number: 'F-0042', invoice_total: '517,39 $', client_cf_refere_par: 'Luc & Fils <b>inc.</b>',
};

describe('E — rendu des variables : témoins (vert aujourd’hui)', () => {
  it('[E-40 témoin] accents et caractères spéciaux d’une valeur arrivent intacts dans un texto', () => {
    const sortie = resolveTemplate('Bonjour [client_first_name], ici {company_name} — « ça va » ? 100 % 🙂', { ...VARS, client_first_name: 'Zoé-Ève' });
    expect(sortie).toBe('Bonjour Zoé-Ève, ici Lavage Éclair inc. — « ça va » ? 100 % 🙂');
  });

  it('[E-41 témoin] corps de courriel : une valeur de champ contenant du HTML est échappée (aucune injection)', () => {
    const mechant = '<img src=x onerror=alert(1)><a href="https://hameçon.test">Cliquez</a> & "guillemets"';
    const sortie = resolveTemplate('<p>Référé par : {{client.refere_par}} — [client_first_name]</p>', { client_cf_refere_par: mechant, client_first_name: '<script>x</script>' }, { html: true });
    expect(sortie).not.toMatch(/<img|<a |<script/);
    expect(sortie).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(sortie).toContain('&amp; &quot;guillemets&quot;');
    expect(sortie).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('[E-41 témoin] un champ personnalisé dont la clé finit par « _html » n’échappe PAS à l’échappement', () => {
    const sortie = resolveTemplate('<p>{{client.notes_html}}</p>', { client_cf_notes_html: '<b>gras</b>' }, { html: true });
    expect(sortie).toBe('<p>&lt;b&gt;gras&lt;/b&gt;</p>');
  });

  it('[E-42 témoin] une valeur n’est jamais relue comme un gabarit (pas de seconde passe)', () => {
    const sortie = resolveTemplate('Bonjour [client_first_name]', { client_first_name: '[company_name] {invoice_total}', company_name: 'X', invoice_total: 'Y' });
    expect(sortie).toBe('Bonjour [company_name] {invoice_total}');
  });

  it('[E-43 témoin] une variable inconnue part VIDE, sans erreur ni trace', () => {
    expect(resolveTemplate('Bonjour [prenom], total {{facture.solde}}.', VARS)).toBe('Bonjour , total .');
  });
});

describe('E — valeur de remplacement si le champ est vide (ROUGE aujourd’hui : la syntaxe n’existe pas)', () => {
  it('[E-44] « Bonjour [client_first_name|là], » → « Bonjour là, » quand le prénom est vide', () => {
    expect(resolveTemplate('Bonjour [client_first_name|là],', { client_first_name: '' })).toBe('Bonjour là,');
  });

  it('[E-44] « {{client.first_name|cher client}} » → la valeur quand elle existe, le remplacement sinon', () => {
    expect(resolveTemplate('Bonjour {{client.first_name|cher client}},', { client_cf_first_name: 'Marie' })).toBe('Bonjour Marie,');
    expect(resolveTemplate('Bonjour {{client.first_name|cher client}},', {})).toBe('Bonjour cher client,');
  });

  it('[E-44] l’éditeur ne prend pas une variable AVEC remplacement pour du texte ordinaire : elle ne part jamais telle quelle chez le client', () => {
    // Aujourd'hui « {client_first_name|là} » n'est reconnu par personne : le client lit les accolades.
    const sortie = resolveTemplate('Bonjour {client_first_name|là},', { client_first_name: 'Marie' });
    expect(sortie).not.toContain('{');
    expect(sortie).not.toContain('|');
  });
});

describe('E — variable inconnue → erreur à l’enregistrement (ROUGE aujourd’hui : avertissement seulement, et incomplet)', () => {
  const regle = (corps: string) => ({
    name: 'E — variable inconnue', trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'send_sms', config: { body: corps } }],
  });

  it('[E-45 témoin] une règle aux variables connues est acceptée', () => {
    expect(automationRuleCreateSchema.safeParse(regle('Bonjour [client_first_name], ici [company_name].')).success).toBe(true);
  });

  it('[E-45] le serveur REFUSE d’enregistrer un texto qui cite une variable inexistante', () => {
    const r = automationRuleCreateSchema.safeParse(regle('Bonjour [prenom_du_client], à demain.'));
    expect(r.success, 'la règle a été acceptée avec [prenom_du_client]').toBe(false);
  });

  it('[E-46] le détecteur de l’éditeur voit aussi une variable ÉCRITE AVEC UN ACCENT ({prénom}) — sinon le client lit « {prénom} »', () => {
    // Le moteur ne remplace pas {prénom} (une clé commence par une lettre sans accent) : il part tel quel.
    expect(resolveTemplate('Bonjour {prénom},', VARS)).toBe('Bonjour {prénom},'); // l'état constaté
    expect(variablesInconnues('Bonjour {prénom}, [côté]')).not.toEqual([]);
  });

  it('[E-47] une variable de FACTURE sur « Nouveau prospect » est refusée ou signalée : elle n’a jamais de valeur sur ce déclencheur', () => {
    // Aujourd'hui `variablesInconnues` ne connaît pas le déclencheur : [invoice_link] passe partout.
    const r = automationRuleCreateSchema.safeParse(regle('Bonjour, payez ici : [invoice_link] ([invoice_total]).'));
    expect(r.success, '[invoice_link] accepté sur lead.created').toBe(false);
  });
});

describe('E — la liste proposée contre ce que le moteur remplit', () => {
  it('[E-48 témoin] les 8 raccourcis de l’éditeur de la liste existent tous côté moteur', () => {
    for (const v of VARIABLES_PROPOSEES) expect(VARIABLES_CONNUES).toContain(v.cle);
  });

  it('[E-49] « Champs de base » ne propose ni case à cocher ni note interne (ROUGE : 11 cases sur 90 entrées, et les notes internes de la facture y sont)', () => {
    const proposes = OBJETS.filter((o) => o !== 'property').flatMap((o) => champsSysteme(o).map((c) => ({ objet: o, ...c })));
    const cases = proposes.filter((c) => c.field_type === 'checkbox').map((c) => `${c.objet}.${c.key}`);
    const internes = proposes.filter((c) => /internal|interne/i.test(`${c.key} ${c.label.fr}`)).map((c) => `${c.objet}.${c.key}`);
    expect({ cases, internes }).toEqual({ cases: [], internes: [] });
  });
});
