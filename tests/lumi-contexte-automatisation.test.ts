/**
 * Lumi sait de QUELLE automatisation on parle (`contexte-automatisation.ts`,
 * constats A-15, F-12, F-13 ; scénarios C08, C12, C15, C18).
 *
 * Tout ce repérage est fait par du CODE (aucun appel au modèle) et donné au
 * tour après le point de cache. Ce que ces tests figent :
 *  · une automatisation nommée est retrouvée, avec son contenu ENREGISTRÉ ;
 *  · un nom d'un seul mot ne capte pas une phrase qui parle d'autre chose ;
 *  · deux homonymes → consigne de poser UNE question, rien d'autre ;
 *  · la réponse à cette question (« celle des factures ») désigne la bonne ;
 *  · ce qui empêche d'activer (texte d'exemple) est dit avec le contenu ;
 *  · un identifiant de page qui n'est pas dans le bureau n'ouvre rien.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { base } = vi.hoisted(() => ({ base: { regles: [] as Array<Record<string, any>>, requetes: 0 } }));

vi.mock('../server/lib/agent/refs', () => ({ masquerIds: (_espace: string, id: string) => `ref_${id}` }));
vi.mock('../server/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }));

const client = {
  from: (_t: string) => {
    const filtres: Array<[string, any]> = [];
    const q: any = {};
    q.select = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.eq = (k: string, v: any) => { filtres.push([k, v]); return q; };
    q.is = (k: string, v: any) => { filtres.push([k, v]); return q; };
    const lignes = () => { base.requetes += 1; return base.regles.filter((r) => filtres.every(([k, v]) => (v === null ? r[k] == null : r[k] === v))); };
    q.maybeSingle = async () => ({ data: lignes()[0] ?? null, error: null });
    q.then = (ok: any) => Promise.resolve({ data: lignes(), error: null }).then(ok);
    return q;
  },
} as any;

import { automatisationsCitees, contexteDeLaPage, estUneSuite, sujetDeLaConversation } from '../server/lib/lumi/contexte-automatisation';
import { parleDAutomatisations, sujetParRegle } from '../server/lib/lumi/sujet-par-regle';
import { TEXTES_ACTION_PROVISOIRE } from '../src/lib/sequenceTypes';
import { trouverAction } from '../src/lib/automationCatalogue';

const o = { client, orgId: 'org', espaceRefs: 'espace', langue: 'fr' as const };
const texto = (body: string) => [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body } }, suivant: null }];
const regle = (id: string, name: string, trigger_event: string, body: string, plus: Record<string, any> = {}) => ({
  id, org_id: 'org', name, trigger_event, conditions: {}, steps: texto(body), actions: [{ type: 'send_sms', config: { body } }],
  delay_seconds: 0, settings: null, is_active: false, is_preset: false, preset_key: null, deleted_at: null, purged_at: null, ...plus,
});
const TEXTE_FACTURE = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link]. [company_name]';

beforeEach(() => {
  base.requetes = 0;
  base.regles = [
    regle('f1', 'Relance facture en retard', 'invoice.overdue', TEXTE_FACTURE),
    regle('d1', 'Relance de devis 3 jours', 'quote.sent', 'Bonjour, avez-vous regardé notre soumission ?'),
    regle('q1', 'Quote follow-up', 'quote.sent', 'Hi [client_first_name], did you get a chance to look at our quote?'),
    regle('x1', 'Autre bureau', 'quote.sent', 'x', { org_id: 'autre' }),
    regle('p1', 'Corbeille', 'quote.sent', 'x', { deleted_at: '2026-10-01T00:00:00Z' }),
  ];
});

describe('une automatisation NOMMÉE est retrouvée, avec ce qui est enregistré', () => {
  it('nom entre guillemets : celle-là, sa référence, son déclencheur en clair, son texto mot pour mot', async () => {
    const r = await automatisationsCitees('change le message de l’automatisation « Relance facture en retard »', o);
    expect(r.nombre).toBe(1);
    expect(r.contexte).toContain('rule_id « ref_f1 »');
    expect(r.contexte).toContain('Facture en retard');
    expect(r.contexte).toContain(`« ${TEXTE_FACTURE} »`);
    expect(r.contexte).toMatch(/pas besoin de lire la liste/);
    // Jamais la clé technique, jamais l'identifiant réel.
    expect(r.contexte).not.toMatch(/invoice\.overdue|send_sms/);
    expect(r.contexte).not.toContain('« f1 »');
  });

  it('les mots du nom dans le désordre suffisent (« ma relance de factures en retard »)', async () => {
    const r = await automatisationsCitees('réécris le texto de ma relance de factures en retard, plus court', o);
    expect(r.nombre).toBe(1);
    expect(r.contexte).toContain('ref_f1');
  });

  it('en anglais, le contenu est donné en anglais (C15 : la question recevait un article d’aide sur les devis)', async () => {
    const r = await automatisationsCitees('what does my Quote follow-up automation do exactly? what does the text say?', { ...o, langue: 'en' });
    expect(r.nombre).toBe(1);
    expect(r.contexte).toContain('ref_q1');
    expect(r.contexte).toContain('Trigger : Quote sent');
    expect(r.contexte).toContain('did you get a chance to look at our quote?');
  });

  it('une automatisation d’un autre bureau ou à la corbeille n’est jamais citée', async () => {
    expect((await automatisationsCitees('active l’automatisation « Autre bureau »', o)).nombre).toBe(0);
    expect((await automatisationsCitees('active l’automatisation « Corbeille »', o)).nombre).toBe(0);
  });
});

describe('ce qui ne doit PAS être pris pour une automatisation', () => {
  it('une phrase qui cite un numéro de facture parle de cette facture', async () => {
    const r = await automatisationsCitees('relance facture en retard INV-000017', o);
    expect(r.nombre).toBe(0);
    expect(base.requetes).toBe(0);
  });

  it('un nom d’un seul mot ne capte pas une demande qui parle d’autre chose', async () => {
    base.regles = [regle('r1', 'Relance', 'invoice.overdue', 'x')];
    expect((await automatisationsCitees('fais une relance à Marie Tremblay pour sa soumission', o)).nombre).toBe(0);
    // … mais il compte quand la phrase porte sur un message, un délai, une activation.
    expect((await automatisationsCitees('change le message de la relance pour quelque chose de plus court', o)).nombre).toBe(1);
  });

  it('une demande de CRÉATION qui décrit ce que fait une automatisation existante ne la « cite » pas (I-008, I-017, I-020)', async () => {
    base.regles = [
      regle('p7', 'Invoice Reminder — 7 Days', 'invoice.sent', 'x', { is_preset: true, is_active: true }),
      regle('cs', 'Contrat signé', 'agreement.signed', 'x', { is_active: true }),
      regle('sp', 'Suivi prospect — 1 jour', 'lead.created', 'x'),
    ];
    for (const demande of [
      'Create an automation: 7 days after an invoice is sent, if it is still unpaid, email the client a reminder with the payment link.',
      'Crée une automatisation qui envoie un courriel de bienvenue au client quand il signe son contrat.',
      'Crée une automatisation : quand un nouveau prospect arrive, notifie-moi, et 1 jour plus tard envoie-lui un courriel de suivi.',
    ]) {
      expect((await automatisationsCitees(demande, o)).nombre, demande).toBe(0);
    }
    // … sauf si elle la nomme entre guillemets.
    expect((await automatisationsCitees('Crée une automatisation comme « Contrat signé », mais par texto', o)).nombre).toBe(1);
  });

  it('les mots d’un nom dans le désordre ne suffisent pas quand la phrase ne parle pas d’une automatisation qu’on a', async () => {
    base.regles = [regle('sp', 'Suivi prospect — 1 jour', 'lead.created', 'x')];
    expect((await automatisationsCitees('envoie un courriel de suivi au prospect Marie Tremblay, 1 jour après la visite', o)).nombre).toBe(0);
    expect((await automatisationsCitees('change le courriel de mon suivi de prospect à 1 jour', o)).nombre).toBe(1);
  });

  it('un message trop court ou sans mot utile ne déclenche aucune lecture', async () => {
    expect((await automatisationsCitees('oui', o)).nombre).toBe(0);
    expect(base.requetes).toBe(0);
  });
});

describe('homonymes : UNE question, puis la réponse désigne la bonne (C08)', () => {
  beforeEach(() => {
    base.regles = [
      regle('hf', 'Relance', 'invoice.overdue', TEXTE_FACTURE),
      regle('hd', 'Relance', 'quote.sent', 'Bonjour, avez-vous regardé notre soumission ?'),
    ];
  });
  const demande = 'change le message de la relance pour quelque chose de plus court';

  it('deux automatisations du même nom : consigne de demander LAQUELLE, distinguées par leur déclencheur, sans leur contenu', async () => {
    const r = await automatisationsCitees(demande, o);
    expect(r.nombre).toBe(2);
    expect(r.contexte).toMatch(/Demande LAQUELLE en UNE question/);
    expect(r.contexte).toContain('Facture en retard');
    expect(r.contexte).toContain('Devis envoyé');
    expect(r.contexte).not.toContain(TEXTE_FACTURE);
  });

  it('« celle des factures » après la question : c’est celle des factures, avec son texte, et l’ordre de faire ce qui était demandé', async () => {
    const historique = [{ role: 'user' as const, content: demande }, { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Celle des factures en retard, ou celle des devis ?' }] }];
    const r = await automatisationsCitees('celle des factures', o, historique);
    expect(r.nombre).toBe(1);
    expect(r.contexte).toContain('ref_hf');
    expect(r.contexte).not.toContain('ref_hd');
    expect(r.contexte).toMatch(/vient de DÉSIGNER/);
    expect(r.contexte).toMatch(/ne redemande pas/);
    expect(r.contexte).toContain(TEXTE_FACTURE);
  });

  it('« celle des devis » désigne l’autre', async () => {
    const historique = [{ role: 'user' as const, content: demande }];
    const r = await automatisationsCitees('celle des devis', o, historique);
    expect(r.contexte).toContain('ref_hd');
    expect(r.contexte).not.toContain('ref_hf');
  });

  it('une réponse qui ne départage pas (« la deuxième », « oui ») ne désigne personne : Lumi garde la main', async () => {
    const historique = [{ role: 'user' as const, content: demande }];
    expect((await automatisationsCitees('la relance', o, historique)).nombre).toBe(0);
    expect((await automatisationsCitees('oui vas-y', o, historique)).nombre).toBe(0);
  });

  it('sans question en suspens (le message précédent ne citait qu’UNE automatisation), rien n’est déduit', async () => {
    base.regles = [regle('f1', 'Relance facture en retard', 'invoice.overdue', TEXTE_FACTURE), regle('d1', 'Relance de devis 3 jours', 'quote.sent', 'x')];
    const historique = [{ role: 'user' as const, content: 'explique-moi l’automatisation « Relance facture en retard »' }];
    expect((await automatisationsCitees('celle des devis', o, historique)).nombre).toBe(0);
  });
});

describe('ce qui empêche d’activer est dit AVEC le contenu (C12)', () => {
  it('une étape qui porte le texte d’exemple d’une étape ajoutée à la main : pareil (avertissement à l’écran, refus pour Lumi)', async () => {
    const exemple = trouverAction('send_sms')!.champs.find((c) => c.cle === 'body')!.defaut_fr!;
    base.regles = [regle('ex', 'Relance facture en retard', 'invoice.overdue', exemple)];
    const r = await automatisationsCitees('active l’automatisation « Relance facture en retard »', o);
    expect(r.contexte).toMatch(/NE PEUT PAS être activée telle quelle/);
    expect(r.contexte).toMatch(/texte d’exemple/);
  });

  it('une automatisation qui porte encore le texte d’exemple de l’éditeur : « ne peut pas être activée telle quelle »', async () => {
    base.regles = [regle('ex', 'Relance facture en retard', 'invoice.overdue', TEXTES_ACTION_PROVISOIRE[0], { steps: [] })];
    const r = await automatisationsCitees('active l’automatisation « Relance facture en retard »', o);
    expect(r.nombre).toBe(1);
    expect(r.contexte).toMatch(/NE PEUT PAS être activée telle quelle/);
    expect(r.contexte).toMatch(/ne propose pas l’activation/);
    // Passe complète du 2026-10-01 : « propose de corriger » était lu comme « réécris-le » — Lumi
    // proposait un nouveau texto sans qu'on le lui demande. Il doit DEMANDER.
    expect(r.contexte).toMatch(/DEMANDE si tu rédiges le vrai message/);
    expect(r.contexte).toMatch(/ne réécris rien de toi-même/);
  });

  it('rien de tel pour une automatisation complète, ni pour une automatisation déjà publiée', async () => {
    expect((await automatisationsCitees('active l’automatisation « Relance facture en retard »', o)).contexte).not.toMatch(/NE PEUT PAS/);
  });
});

describe('la page ouverte', () => {
  it('donne l’automatisation à l’écran, telle qu’enregistrée, et dit que « elle » la désigne', async () => {
    const t = await contexteDeLaPage({ rule_id: 'f1' }, o);
    expect(t).toMatch(/^PAGE OUVERTE/);
    expect(t).toContain('rule_id « ref_f1 »');
    expect(t).toContain(TEXTE_FACTURE);
    expect(t).toMatch(/ne demande pas laquelle/);
  });

  it('prévient quand l’éditeur a des modifications pas encore enregistrées', async () => {
    expect(await contexteDeLaPage({ rule_id: 'f1', non_enregistre: true }, o)).toMatch(/PAS ENCORE ENREGISTRÉES/);
  });

  it('un identifiant d’un autre bureau n’ouvre rien : le navigateur ne donne qu’un repère, jamais un droit', async () => {
    expect(await contexteDeLaPage({ rule_id: 'x1' }, o)).toBeNull();
    expect(await contexteDeLaPage({ rule_id: 'inconnue' }, o)).toBeNull();
  });
});

describe('garder le fil', () => {
  it('« active-la », « celle des devis », « non, plus court » sont des SUITES ; une nouvelle demande complète n’en est pas une', () => {
    for (const m of ['active-la', 'celle des devis', 'non, plus court', 'oui', 'remets-la en pause', 'do it']) expect(estUneSuite(m), m).toBe(true);
    expect(estUneSuite('crée une facture de 250 $ pour Marie Tremblay pour le lavage de vitres de mardi')).toBe(false);
  });

  it('le sujet de la conversation est celui du dernier outil appelé', () => {
    const historique = [
      { role: 'user' as const, content: 'explique-moi ma relance de devis' },
      { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 't1', name: 'get_automation', input: {} }] },
    ];
    expect(sujetDeLaConversation(historique)).toBe('rapports');
    expect(sujetDeLaConversation([{ role: 'user', content: 'bonjour' }])).toBeNull();
  });

  it('une phrase qui PARLE d’automatisations garde leurs outils, même si ce n’est pas un ordre reconnu (C18)', () => {
    expect(parleDAutomatisations('arrête toutes mes automatisations tout de suite')).toBe(true);
    expect(parleDAutomatisations('is my quote automation running?')).toBe(true);
    // « relances automatiques » = les relances de PAIEMENT, un autre réglage.
    expect(parleDAutomatisations('désactive les relances automatiques')).toBe(false);
    expect(parleDAutomatisations('envoie la facture 12 à Marie')).toBe(false);
    expect(sujetParRegle('arrête toutes mes automatisations tout de suite')).toBe('rapports');
  });
});
