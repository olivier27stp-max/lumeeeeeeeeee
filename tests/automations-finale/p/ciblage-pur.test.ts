/**
 * Agent P — « Qui est ciblé » : le cœur pur (src/lib/automationCiblage.ts) et le
 * schéma du serveur (server/lib/automations-ciblage-schema.ts).
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/ciblage-pur.test.ts
 *
 * Les cas de la conception de l'agent E (tests/automations-finale/e/unitaires/
 * e-prototype-conceptions.test.ts) sont rejoués ici sur le VRAI module, puis
 * étendus : anciennes clés d'étiquette, règle illisible ou invérifiable,
 * écriture, bornes.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluerCiblage, lireCiblage, ciblagesSeChevauchent, ecrireCiblage, ciblagePourEditeur, nettoyerCiblage,
  fautesDuCiblage, champsCites, citeDesEtiquettes, ciblageVide, ciblageEnClair, phraseHorsCiblage, libelleRegle,
  regleVraie, CIBLAGE_MAX_INCLURE, CIBLAGE_MAX_EXCLURE,
  type Ciblage, type FicheClient, type RegleCiblage,
} from '../../../src/lib/automationCiblage';
import { ciblageSchema, regleCiblageSchema } from '../../../server/lib/automations-ciblage-schema';
import { conditionChampSchema } from '../../../server/lib/validation';

const fiche = (p: Partial<FicheClient> = {}): FicheClient => ({
  id: 'c1', status: 'active', company: null, city: 'Montréal', lead_source: null, source: null, etiquettes: [], champs: {}, ...p,
});
const ctx = { fuseau: 'America/Toronto' };
const ID = '11111111-1111-4111-8111-111111111111';
const vipOuCommercial: Ciblage = {
  inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'etiquette', valeur: 'Commercial' }] },
  exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }],
};

describe('P — ciblage : ET / OU, exclusions prioritaires, raison lisible', () => {
  it('sans ciblage : tous les clients', () => {
    expect(evaluerCiblage(null, fiche(), ctx)).toEqual({ cible: true, raison: null });
    expect(evaluerCiblage({}, fiche(), ctx).cible).toBe(true);
    expect(lireCiblage({})).toBeNull();
    expect(lireCiblage({ days_overdue: 3 })).toBeNull();
    expect(lireCiblage({ ciblage: { inclure: { mode: 'une', regles: [] }, exclure: [] } })).toBeNull();
  });

  it('OU : une seule des étiquettes suffit ; la casse et les espaces ne comptent pas', () => {
    expect(evaluerCiblage(vipOuCommercial, fiche({ etiquettes: [' commercial'] }), ctx).cible).toBe(true);
    expect(evaluerCiblage(vipOuCommercial, fiche({ etiquettes: ['Autre'] }), ctx))
      .toEqual({ cible: false, raison: 'ne remplit aucune des conditions' });
  });

  it('ET : toutes les conditions doivent tenir ; la raison nomme celle qui manque', () => {
    const c: Ciblage = { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'etiquette', valeur: 'Commercial' }] } };
    expect(evaluerCiblage(c, fiche({ etiquettes: ['VIP', 'Commercial'] }), ctx).cible).toBe(true);
    expect(evaluerCiblage(c, fiche({ etiquettes: ['VIP'] }), ctx)).toEqual({ cible: false, raison: 'n’a pas l’étiquette « Commercial »' });
  });

  it('l’exclusion est PRIORITAIRE et la raison nomme ce qui exclut', () => {
    expect(evaluerCiblage(vipOuCommercial, fiche({ etiquettes: ['VIP', 'Ne pas relancer'] }), ctx))
      .toEqual({ cible: false, raison: 'exclu par l’étiquette « Ne pas relancer »' });
    expect(phraseHorsCiblage('exclu par l’étiquette « Ne pas relancer »'))
      .toBe('Ignoré : hors ciblage — exclu par l’étiquette « Ne pas relancer »');
    expect(phraseHorsCiblage(null)).toBe('Ignoré : hors ciblage');
  });

  it('« type de client » (entreprise / particulier) et un champ personnalisé du CLIENT, reliés par ET', () => {
    const c: Ciblage = { inclure: { mode: 'toutes', regles: [
      { type: 'fiche', cle: 'genre', op: 'is', value: 'entreprise' },
      { type: 'champ', field_id: 'f-ref', op: 'is', value: 'Facebook' },
    ] } };
    const champs = { 'f-ref': { type: 'single_line' as const, valeur: 'facebook ' } };
    expect(evaluerCiblage(c, fiche({ company: 'Tremblay inc.', champs }), ctx).cible).toBe(true);
    expect(evaluerCiblage(c, fiche({ company: '   ', champs }), ctx))
      .toEqual({ cible: false, raison: 'ne remplit pas la condition sur « Type de client »' });
    expect(evaluerCiblage(c, fiche({ company: 'Tremblay inc.', typesChamps: { 'f-ref': 'single_line' } }), ctx, { 'f-ref': 'Référé par' }))
      .toEqual({ cible: false, raison: 'ne remplit pas la condition sur « Référé par »' });
  });

  it('statut, ville, source : jugés comme du texte, sans casse', () => {
    const regle = (r: RegleCiblage) => evaluerCiblage({ inclure: { mode: 'toutes', regles: [r] } }, fiche({ status: 'lead', city: 'Québec', lead_source: 'Site web' }), ctx).cible;
    expect(regle({ type: 'fiche', cle: 'status', op: 'is', value: 'lead' })).toBe(true);
    expect(regle({ type: 'fiche', cle: 'status', op: 'is_not', value: 'lead' })).toBe(false);
    expect(regle({ type: 'fiche', cle: 'city', op: 'contains', value: 'QUÉB' })).toBe(true);
    expect(regle({ type: 'fiche', cle: 'lead_source', op: 'is', value: 'site web' })).toBe(true);
    expect(regle({ type: 'fiche', cle: 'source', op: 'is_empty' })).toBe(true);
    expect(regle({ type: 'fiche', cle: 'company', op: 'is_not_empty' })).toBe(false);
  });

  it('case à cocher : « noreview » coché exclut ; jamais rempli = pas coché', () => {
    const c: Ciblage = { exclure: [{ type: 'champ', field_id: 'f-nr', op: 'is', value: true }] };
    expect(evaluerCiblage(c, fiche({ champs: { 'f-nr': { type: 'checkbox', valeur: true } } }), ctx, { 'f-nr': 'Aucune demande d’avis' }))
      .toEqual({ cible: false, raison: 'exclu par la condition sur « Aucune demande d’avis »' });
    expect(evaluerCiblage(c, fiche({ typesChamps: { 'f-nr': 'checkbox' } }), ctx).cible).toBe(true);
  });

  it('la raison se rend aussi en anglais (écran « Tester avec un client »)', () => {
    expect(evaluerCiblage(vipOuCommercial, fiche({ etiquettes: ['VIP', 'ne pas relancer'] }), { ...ctx, fr: false }))
      .toEqual({ cible: false, raison: 'excluded by the tag “Ne pas relancer”' });
  });
});

describe('P — ciblage : on n’écrit jamais sur une règle qu’on ne sait pas juger', () => {
  it('champ disparu : une inclusion invérifiable ne cible pas, une exclusion invérifiable exclut', () => {
    const inclusion: Ciblage = { inclure: { mode: 'toutes', regles: [{ type: 'champ', field_id: 'f-parti', op: 'is', value: 'x' }] } };
    const exclusion: Ciblage = { exclure: [{ type: 'champ', field_id: 'f-parti', op: 'is', value: 'x' }] };
    expect(regleVraie(inclusion.inclure!.regles[0], fiche(), ctx)).toBeNull();
    expect(evaluerCiblage(inclusion, fiche(), ctx).cible).toBe(false);
    const v = evaluerCiblage(exclusion, fiche(), ctx);
    expect(v.cible).toBe(false);
    expect(v.raison).toMatch(/ne peut pas être vérifiée/);
  });

  it('condition incomplète (« contient » sans valeur) ou opérateur étranger au type : invérifiable, jamais « vrai pour tous »', () => {
    const f = fiche({ champs: { 'f-a': { type: 'single_line', valeur: 'abc' }, 'f-n': { type: 'number', valeur: 3 } } });
    expect(regleVraie({ type: 'champ', field_id: 'f-a', op: 'contains', value: '' }, f, ctx)).toBeNull();
    expect(regleVraie({ type: 'champ', field_id: 'f-n', op: 'contains', value: '3' }, f, ctx)).toBeNull();
    expect(regleVraie({ type: 'fiche', cle: 'city', op: 'is', value: '' }, f, ctx)).toBeNull();
    expect(regleVraie({ type: 'etiquette', valeur: '  ' }, f, ctx)).toBeNull();
  });

  it('règle ÉCRITE À LA MAIN que rien ne sait lire : gardée comme « illisible », elle ne laisse passer personne', () => {
    const inclure = lireCiblage({ ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'inconnu', x: 1 }] } } });
    expect(inclure?.illisible).toEqual({ inclure: 1, exclure: 0 });
    expect(evaluerCiblage(inclure, fiche(), ctx)).toEqual({ cible: false, raison: 'une condition du ciblage est illisible' });
    const exclure = lireCiblage({ ciblage: { exclure: [{ type: 'etiquette' }] } });
    expect(evaluerCiblage(exclure, fiche(), ctx)).toEqual({ cible: false, raison: 'une exclusion du ciblage est illisible' });
    // En mode OU, une règle illisible ne compte simplement pas : les autres décident.
    const ou = lireCiblage({ ciblage: { inclure: { mode: 'une', regles: [{ type: 'inconnu' }, { type: 'etiquette', valeur: 'VIP' }] } } });
    expect(evaluerCiblage(ou, fiche({ etiquettes: ['vip'] }), ctx).cible).toBe(true);
    expect(evaluerCiblage(ou, fiche(), ctx).cible).toBe(false);
  });

  it('un mode absent ou inconnu se lit « toutes » : le sens le plus strict', () => {
    const lu = lireCiblage({ ciblage: { inclure: { mode: 'nimporte', regles: [{ type: 'etiquette', valeur: 'A' }, { type: 'etiquette', valeur: 'B' }] } } });
    expect(lu?.inclure?.mode).toBe('toutes');
    expect(evaluerCiblage(lu, fiche({ etiquettes: ['A'] }), ctx).cible).toBe(false);
  });
});

describe('P — ciblage : compatibilité avec `client_a_etiquette` / `client_sans_etiquette` (aucune migration)', () => {
  it('les deux anciennes clés se lisent comme une étiquette exigée et une exclusion', () => {
    const lu = lireCiblage({ client_a_etiquette: 'VIP', client_sans_etiquette: 'Ne pas relancer' });
    expect(lu).toEqual({ exiger: [{ type: 'etiquette', valeur: 'VIP' }], exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }] });
    expect(evaluerCiblage(lu, fiche({ etiquettes: ['vip'] }), ctx).cible).toBe(true);
    expect(evaluerCiblage(lu, fiche({ etiquettes: ['vip', 'ne pas relancer'] }), ctx).raison).toBe('exclu par l’étiquette « Ne pas relancer »');
    expect(evaluerCiblage(lu, fiche(), ctx).raison).toBe('n’a pas l’étiquette « VIP »');
  });

  it('ancienne clé + nouveau ciblage en OU : l’ancienne reste EXIGÉE (elle se combinait par ET)', () => {
    const lu = lireCiblage({ client_a_etiquette: 'VIP', ciblage: { inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'A' }, { type: 'etiquette', valeur: 'B' }] } } });
    expect(evaluerCiblage(lu, fiche({ etiquettes: ['A'] }), ctx).cible).toBe(false);
    expect(evaluerCiblage(lu, fiche({ etiquettes: ['VIP', 'B'] }), ctx).cible).toBe(true);
  });

  it('l’éditeur montre les anciennes clés comme des lignes, et les réécrit au nouveau format', () => {
    const conditions = { days_overdue: 3, client_a_etiquette: 'VIP', client_sans_etiquette: 'Ne pas relancer' };
    const pourEditeur = ciblagePourEditeur(conditions);
    expect(pourEditeur).toEqual({
      inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }] },
      exclure: [{ type: 'etiquette', valeur: 'Ne pas relancer' }],
    });
    const ecrites = ecrireCiblage(conditions, pourEditeur);
    expect(ecrites).toEqual({ days_overdue: 3, ciblage: pourEditeur });
    // Même verdict avant et après la réécriture, pour les quatre cas.
    for (const etiquettes of [[], ['VIP'], ['Ne pas relancer'], ['VIP', 'Ne pas relancer']]) {
      expect(evaluerCiblage(lireCiblage(ecrites), fiche({ etiquettes }), ctx).cible)
        .toBe(evaluerCiblage(lireCiblage(conditions), fiche({ etiquettes }), ctx).cible);
    }
  });

  it('« tous les clients » retire la clé `ciblage` ET les anciennes clés ; le reste des conditions est gardé', () => {
    expect(ecrireCiblage({ days_overdue: 3, client_a_etiquette: 'VIP', champs_perso: [{ field_id: ID, op: 'is', value: 'x' }] }, {}))
      .toEqual({ days_overdue: 3, champs_perso: [{ field_id: ID, op: 'is', value: 'x' }] });
    expect(ecrireCiblage(null, null)).toEqual({});
  });
});

describe('P — ciblage : ce qu’on enregistre', () => {
  it('les lignes incomplètes et les doublons sont retirés ; les étiquettes sont rognées', () => {
    expect(nettoyerCiblage({
      inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: ' VIP ' }, { type: 'etiquette', valeur: 'vip' }, { type: 'etiquette', valeur: '' },
        { type: 'fiche', cle: 'city', op: 'is', value: '' }, { type: 'champ', field_id: ID, op: 'any_of', value: [] }] },
      exclure: [{ type: 'fiche', cle: 'company', op: 'is_empty' }],
    })).toEqual({ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }] }, exclure: [{ type: 'fiche', cle: 'company', op: 'is_empty' }] });
    expect(ciblageVide(nettoyerCiblage({ inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: '' }] } }))).toBe(true);
  });

  it('bornes : 10 inclusions et 10 exclusions — l’éditeur et le serveur refusent la onzième', () => {
    const onze = Array.from({ length: 11 }, (_, i): RegleCiblage => ({ type: 'etiquette', valeur: `E${i}` }));
    const dix = onze.slice(0, 10);
    expect(CIBLAGE_MAX_INCLURE).toBe(10);
    expect(CIBLAGE_MAX_EXCLURE).toBe(10);
    expect(fautesDuCiblage({ inclure: { mode: 'une', regles: dix }, exclure: dix })).toEqual([]);
    expect(fautesDuCiblage({ inclure: { mode: 'une', regles: onze } })[0].fr).toMatch(/Au plus 10 conditions/);
    expect(fautesDuCiblage({ exclure: onze })[0].fr).toMatch(/Au plus 10 exclusions/);
    expect(ciblageSchema.safeParse({ inclure: { mode: 'une', regles: dix }, exclure: dix }).success).toBe(true);
    expect(ciblageSchema.safeParse({ inclure: { mode: 'une', regles: onze } }).success).toBe(false);
    expect(ciblageSchema.safeParse({ exclure: onze }).success).toBe(false);
  });

  it('un champ qui n’est pas un champ de la fiche client, ou une comparaison sans sens pour son type, est refusé', () => {
    const champs = { [ID]: { label: 'Nombre de fenêtres', type: 'number' as const } };
    expect(fautesDuCiblage({ inclure: { mode: 'toutes', regles: [{ type: 'champ', field_id: ID, op: 'gt', value: 20 }] } }, champs)).toEqual([]);
    expect(fautesDuCiblage({ inclure: { mode: 'toutes', regles: [{ type: 'champ', field_id: ID, op: 'contains', value: '2' }] } }, champs)[0].fr)
      .toMatch(/Nombre de fenêtres.*n’a pas de sens/);
    expect(fautesDuCiblage({ exclure: [{ type: 'champ', field_id: '22222222-2222-4222-8222-222222222222', op: 'is', value: 'x' }] }, champs)[0].fr)
      .toMatch(/n’est pas \(ou plus\) un champ de la fiche client/);
    expect(fautesDuCiblage({ inclure: { mode: 'toutes', regles: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'commerce' }] } })[0].fr)
      .toMatch(/Type de client : choisissez une valeur dans la liste/);
  });

  it('ce que le moteur doit lire : seulement les champs cités, et les étiquettes seulement si une règle en parle', () => {
    const c = lireCiblage({ client_a_etiquette: 'VIP', ciblage: { exclure: [{ type: 'champ', field_id: ID, op: 'is', value: true }] } });
    expect(champsCites(c)).toEqual([ID]);
    expect(citeDesEtiquettes(c)).toBe(true);
    expect(citeDesEtiquettes({ exclure: [{ type: 'fiche', cle: 'city', op: 'is', value: 'Laval' }] })).toBe(false);
    expect(champsCites(null)).toEqual([]);
  });
});

describe('P — ciblage : le schéma du serveur', () => {
  it('accepte la structure de la conception (celle du test [E-03])', () => {
    const ciblage = { inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: 'VIP' }, { type: 'etiquette', valeur: 'Commercial' }] }, exclure: [] };
    expect(ciblageSchema.safeParse(ciblage).success).toBe(true);
    expect(ciblageSchema.safeParse({
      inclure: { mode: 'toutes', regles: [{ type: 'champ', field_id: ID, op: 'is', value: 'Commercial' }, { type: 'fiche', cle: 'genre', op: 'is', value: 'entreprise' }] },
      exclure: [{ type: 'fiche', cle: 'company', op: 'is_empty' }],
    }).success).toBe(true);
  });

  it('refuse une clé inconnue, un mode inconnu, un type inconnu, une étiquette vide, une valeur hors liste', () => {
    const refuse = (c: unknown) => expect(ciblageSchema.safeParse(c).success, JSON.stringify(c)).toBe(false);
    refuse({ exclur: [{ type: 'etiquette', valeur: 'VIP' }] });
    refuse({ inclure: { mode: 'ou', regles: [] } });
    refuse({ inclure: { regles: [{ type: 'etiquette', valeur: 'VIP' }] } });
    refuse({ exclure: [{ type: 'segment', valeur: 'VIP' }] });
    refuse({ exclure: [{ type: 'etiquette', valeur: '   ' }] });
    refuse({ exclure: [{ type: 'etiquette', valeur: 'VIP', autre: 1 }] });
    refuse({ exclure: [{ type: 'fiche', cle: 'email', op: 'is', value: 'x' }] });
    refuse({ exclure: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'commerce' }] });
    refuse({ exclure: [{ type: 'fiche', cle: 'genre', op: 'contains', value: 'entreprise' }] });
    refuse({ exclure: [{ type: 'fiche', cle: 'city', op: 'is' }] });
    refuse({ exclure: [{ type: 'champ', field_id: 'pas-un-uuid', op: 'is', value: 'x' }] });
    refuse({ exclure: [{ type: 'champ', field_id: ID, op: 'ressemble', value: 'x' }] });
  });

  it('la règle « champ » a EXACTEMENT la forme de `conditionChampSchema` (validation.ts), plus `type`', () => {
    const cas: Array<Record<string, unknown>> = [
      { field_id: ID, op: 'is', value: 'x' },
      { field_id: ID, op: 'between', value: 1, value2: 5 },
      { field_id: ID, op: 'any_of', value: ['a', 'b'] },
      { field_id: ID, op: 'in_last', n: 3, unit: 'weeks' },
      { field_id: ID, op: 'is', value: true },
      { field_id: ID, op: 'is_empty' },
      { field_id: 'x', op: 'is', value: 'x' },
      { field_id: ID, op: 'like', value: 'x' },
      { field_id: ID, op: 'in_last', n: 4000 },
      { field_id: ID, op: 'is', value: 'x', inconnu: 1 },
      { field_id: ID, op: 'is', value: 'a'.repeat(501) },
    ];
    for (const c of cas) {
      expect(regleCiblageSchema.safeParse({ type: 'champ', ...c }).success, JSON.stringify(c))
        .toBe(conditionChampSchema.safeParse(c).success);
    }
  });

  it('ce que l’éditeur enregistre (`nettoyerCiblage`) passe toujours le schéma ; ce que `fautesDuCiblage` refuse, le schéma le refuse aussi', () => {
    const brouillon: Ciblage = {
      inclure: { mode: 'une', regles: [{ type: 'etiquette', valeur: ' VIP ' }, { type: 'etiquette', valeur: '' }, { type: 'fiche', cle: 'status', op: 'is_not', value: 'lead' }] },
      exclure: [{ type: 'champ', field_id: ID, op: 'is', value: true }, { type: 'fiche', cle: 'city', op: 'contains', value: '' }],
    };
    expect(ciblageSchema.safeParse(nettoyerCiblage(brouillon)).success).toBe(true);
    const fautif: Ciblage = { inclure: { mode: 'toutes', regles: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'commerce' }] } };
    expect(fautesDuCiblage(fautif).length).toBeGreaterThan(0);
    expect(ciblageSchema.safeParse(fautif).success).toBe(false);
  });
});

describe('P — ciblage : chevauchement de deux ciblages (avertissement de doublon)', () => {
  const vip: Ciblage = { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }] } };
  const sansVip: Ciblage = { exclure: [{ type: 'etiquette', valeur: 'vip' }] };

  it('disjoints seulement si l’un exige ce que l’autre exclut', () => {
    expect(ciblagesSeChevauchent(vip, sansVip)).toBe(false);
    expect(ciblagesSeChevauchent(sansVip, vip)).toBe(false);
    expect(ciblagesSeChevauchent(vip, null)).toBe(true);
    expect(ciblagesSeChevauchent(null, null)).toBe(true);
    expect(ciblagesSeChevauchent(vip, vipOuCommercial)).toBe(true);
    // « VIP OU Commercial » n'EXIGE pas VIP : un client Commercial non VIP est dans les deux.
    expect(ciblagesSeChevauchent(vipOuCommercial, sansVip)).toBe(true);
  });

  it('les anciennes clés d’étiquette comptent (le cas du test [E-29])', () => {
    expect(ciblagesSeChevauchent(lireCiblage({ client_a_etiquette: 'VIP' }), lireCiblage({ client_sans_etiquette: 'VIP' }))).toBe(false);
    expect(ciblagesSeChevauchent(lireCiblage({ client_a_etiquette: 'VIP' }), lireCiblage({ client_sans_etiquette: 'Autre' }))).toBe(true);
  });

  it('« Entreprise » d’un côté, « Particulier » de l’autre : aucun client commun', () => {
    const genre = (v: string): Ciblage => ({ inclure: { mode: 'toutes', regles: [{ type: 'fiche', cle: 'genre', op: 'is', value: v }] } });
    expect(ciblagesSeChevauchent(genre('entreprise'), genre('particulier'))).toBe(false);
    expect(ciblagesSeChevauchent(genre('entreprise'), genre('Entreprise'))).toBe(true);
    expect(ciblagesSeChevauchent(genre('entreprise'), { exclure: [{ type: 'fiche', cle: 'genre', op: 'is', value: 'entreprise' }] })).toBe(false);
    // Deux champs DIFFÉRENTS de la fiche ne prouvent rien.
    expect(ciblagesSeChevauchent(genre('entreprise'), { inclure: { mode: 'toutes', regles: [{ type: 'fiche', cle: 'city', op: 'is', value: 'Laval' }] } })).toBe(true);
  });
});

describe('P — ciblage : en clair (résumé, confirmation de publication)', () => {
  it('une phrase par ciblage, dans les deux langues ; vide quand tous les clients sont visés', () => {
    expect(ciblageEnClair(null)).toBe('');
    expect(ciblageEnClair(vipOuCommercial)).toBe('seulement les clients avec étiquette « VIP » ou étiquette « Commercial », sauf étiquette « Ne pas relancer »');
    expect(ciblageEnClair(vipOuCommercial, false)).toBe('only clients with tag “VIP” or tag “Commercial”, except tag “Ne pas relancer”');
    expect(ciblageEnClair({ exclure: [{ type: 'etiquette', valeur: 'VIP' }] })).toBe('tous les clients sauf étiquette « VIP »');
    expect(ciblageEnClair(lireCiblage({ client_a_etiquette: 'VIP' }))).toBe('seulement les clients avec étiquette « VIP »');
  });

  it('une règle se lit avec ses libellés d’écran — jamais une clé technique', () => {
    expect(libelleRegle({ type: 'fiche', cle: 'genre', op: 'is', value: 'entreprise' })).toBe('Type de client est Entreprise');
    expect(libelleRegle({ type: 'fiche', cle: 'status', op: 'is_not', value: 'lead' }, false)).toBe('Status is not Lead');
    expect(libelleRegle({ type: 'fiche', cle: 'company', op: 'is_empty' })).toBe('Nom de la compagnie est vide');
    const champs = { [ID]: { label: 'Type de bâtiment', options: [{ id: 'o1', label: 'Commercial' }, { id: 'o2', label: 'Résidentiel' }] } };
    expect(libelleRegle({ type: 'champ', field_id: ID, op: 'any_of', value: ['o1', 'o2'] }, true, champs)).toBe('Type de bâtiment est l’un de Commercial, Résidentiel');
    expect(libelleRegle({ type: 'champ', field_id: ID, op: 'is', value: true }, true, champs)).toBe('Type de bâtiment est oui');
    expect(libelleRegle({ type: 'champ', field_id: 'parti', op: 'is', value: 'x' })).toBe('Champ supprimé est x');
  });
});
