/**
 * LES CONDITIONS D'UNE ÉTAPE « SI… », EN TEXTE — src/lib/conditionsEtapeSi.ts.
 * Triage « déclencheurs », 05-etapes-controle:470 et :501 : ce que la zone ne
 * sait pas lire ou écrire n'est jamais jeté en silence.
 */
import { describe, it, expect } from 'vitest';
import { analyserConditions, conditionsConservees, texteDesConditions } from '../../../src/lib/conditionsEtapeSi';

const lire = (texte: string, origine?: Record<string, unknown>) => analyserConditions(texte, origine);

describe('05:470 — une ligne que l’analyse ne comprend pas est SIGNALÉE, pas ignorée', () => {
  it('« montant 5000 » (sans signe) et « statut = » (sans valeur) : deux lignes illisibles, chacune avec ce qui lui manque', () => {
    const r = lire('montant 5000\nstatut =');
    expect(r.conditions).toEqual({});
    expect(r.illisibles).toEqual([
      { ligne: 'montant 5000', fr: 'il manque un signe (=, !=, >, >=, <, <=) ou « est l’un de » entre le champ et la valeur.', en: 'a sign (=, !=, >, >=, <, <=) or “is one of” is missing between the field and the value.' },
      { ligne: 'statut =', fr: 'il manque la valeur.', en: 'the value is missing.' },
    ]);
  });

  it('« = 5 » (sans champ), une liste vide, un mot seul : signalés aussi', () => {
    expect(lire('= 5').illisibles[0].fr).toBe('il manque le nom du champ avant le signe.');
    expect(lire('source est l’un de ').illisibles[0].fr).toBe('il manque la valeur.');
    expect(lire('source est l’un de , ,').illisibles[0].fr).toBe('il manque la liste des valeurs (séparées par des virgules).');
    expect(lire('statut').illisibles).toHaveLength(1);
  });

  it('les lignes lisibles voisines sont gardées ; une ligne vide n’est pas une faute', () => {
    const r = lire('source = web\n\nmontant 5000\n  \ntotal_cents > 500000');
    expect(r.conditions).toEqual({ source: 'web', total_cents: { gt: 500000 } });
    expect(r.illisibles.map((l) => l.ligne)).toEqual(['montant 5000']);
  });

  it('deux fois le même signe sur le même champ : la seconde ligne est signalée (avant, elle écrasait la première sans un mot)', () => {
    const r = lire('statut = envoye\nstatut = accepte');
    expect(r.conditions).toEqual({ statut: 'envoye' });
    expect(r.illisibles).toEqual([{ ligne: 'statut = accepte', fr: '« statut » a déjà une condition de ce type plus haut : une seule serait gardée.', en: '“statut” already has a condition of this kind above: only one would be kept.' }]);
  });

  it('une égalité ET une autre condition sur le même champ : les DEUX sont gardées (avant, la seconde remplaçait la première)', () => {
    expect(lire('statut = envoye\nstatut != perdu').conditions).toEqual({ statut: { eq: 'envoye', neq: 'perdu' } });
    expect(lire('statut != perdu\nstatut = envoye').conditions).toEqual({ statut: { neq: 'perdu', eq: 'envoye' } });
  });

  it('une comparaison (>, >=, <, <=) sur autre chose qu’un nombre ou une date : signalée (le moteur refuserait la branche à chaque passage)', () => {
    const r = lire('montant > 1500$\ncreated_at >= demain\ncreated_at < 2026-02-30\nmontant > 100source est l’un de web');
    expect(r.conditions).toEqual({});
    expect(r.illisibles.map((l) => l.fr)).toEqual([
      'une comparaison attend un nombre ou une date (AAAA-MM-JJ) : « 1500$ » n’est ni l’un ni l’autre.',
      'une comparaison attend un nombre ou une date (AAAA-MM-JJ) : « demain » n’est ni l’un ni l’autre.',
      'une comparaison attend un nombre ou une date (AAAA-MM-JJ) : « 2026-02-30 » n’est ni l’un ni l’autre.',
      'une comparaison attend un nombre ou une date (AAAA-MM-JJ) : « 100source est l’un de web » n’est ni l’un ni l’autre.',
    ]);
    // « différent de » compare du texte : tout se dit.
    expect(lire('statut != en attente').illisibles).toEqual([]);
    expect(lire('montant > -12.5\ncreated_at >= 2026-06-01T10:00:00Z').illisibles).toEqual([]);
    // Une comparaison déjà en base, même douteuse, n’est pas re-jugée tant qu’on n’y touche pas : elle est gardée telle quelle.
    expect(lire('montant > abc', { montant: { gt: 'abc' } })).toEqual({ conditions: { montant: { gt: 'abc' } }, illisibles: [] });
  });

  it('ce qui se lisait déjà se lit pareil : égalité à plat en texte, comparaison en nombre, intervalle sur deux lignes, date', () => {
    expect(lire('statut = envoye\nmontant = 5000\ntotal_cents >= 100\ntotal_cents < 900\ncreated_at >= 2026-06-01\nscore != 4.5').conditions).toEqual({
      statut: 'envoye', montant: '5000', total_cents: { gte: 100, lt: 900 }, created_at: { gte: '2026-06-01' }, score: { neq: 4.5 },
    });
    expect(lire('url = https://x.test/?a=b').conditions).toEqual({ url: 'https://x.test/?a=b' });
  });
});

describe('05:501 — « est l’un de » / « n’est aucun de » (`in` / `not_in`) s’écrivent, se relisent, et survivent', () => {
  const DE_LUMI = { source: { in: ['web', 'facebook'] }, statut: { not_in: ['perdu'] } };

  it('les conditions posées par Lumi ou un modèle sont écrites en texte', () => {
    expect(texteDesConditions(DE_LUMI)).toBe('source est l’un de web, facebook\nstatut n’est aucun de perdu');
    expect(texteDesConditions(DE_LUMI, false)).toBe('source is one of web, facebook\nstatut is none of perdu');
  });

  it('relues telles quelles, elles redonnent EXACTEMENT l’objet d’origine — et une ligne ajoutée ne les touche pas', () => {
    const texte = texteDesConditions(DE_LUMI);
    expect(lire(texte, DE_LUMI)).toEqual({ conditions: DE_LUMI, illisibles: [] });
    expect(lire(`${texte}\nmontant > 100`, DE_LUMI).conditions).toEqual({ ...DE_LUMI, montant: { gt: 100 } });
  });

  it('tapées à la main : apostrophe droite ou courbe, français ou anglais, majuscules', () => {
    expect(lire("source est l'un de web, facebook").conditions).toEqual({ source: { in: ['web', 'facebook'] } });
    expect(lire('source EST L’UN DE web ,facebook,').conditions).toEqual({ source: { in: ['web', 'facebook'] } });
    expect(lire("statut n'est aucun de perdu, annule").conditions).toEqual({ statut: { not_in: ['perdu', 'annule'] } });
    expect(lire('source is one of web\nstatut is none of lost').conditions).toEqual({ source: { in: ['web'] }, statut: { not_in: ['lost'] } });
  });

  it('une liste et une comparaison sur le même champ se combinent', () => {
    expect(lire('score est l’un de 1, 2, 3\nscore != 2').conditions).toEqual({ score: { in: ['1', '2', '3'], neq: 2 } });
  });

  it('une ligne restée telle quelle garde sa valeur D’ORIGINE : un nombre reste un nombre, une liste de nombres aussi', () => {
    const origine = { jours: 30, actif: true, score: { in: [1, 2] }, montant: { gt: 100 } };
    const texte = texteDesConditions(origine);
    expect(texte).toBe('jours = 30\nactif = true\nscore est l’un de 1, 2\nmontant > 100');
    expect(lire(`${texte}\nsource = web`, origine).conditions).toEqual({ ...origine, source: 'web' });
    // Retouchée, la ligne est relue comme une saisie.
    expect(lire('jours = 45', origine).conditions).toEqual({ jours: '45' });
  });

  it('un mot d’opérateur DANS une valeur n’est pas un opérateur', () => {
    expect(lire('note = il est l’un de nous').conditions).toEqual({ note: 'il est l’un de nous' });
    expect(texteDesConditions({ note: 'il est l’un de nous' })).toBe('note = il est l’un de nous');
  });
});

describe('ce que le texte ne peut pas porter fidèlement est CONSERVÉ tel quel, jamais écrit de travers', () => {
  const AVANCEES = {
    source: 'web',
    vide: '',
    rien: null,
    liste_a_virgule: { in: ['Montréal, QC', 'Laval'] },
    operateur_inconnu: { contains: 'abc' },
    liste_vide: { in: [] },
    'cle = bizarre': 'x',
    multi: 'ligne 1\nligne 2',
    champs_perso: [{ field_id: 'f1', op: 'eq', value: 1 }],
  };

  it('le texte ne montre que ce qu’il saura relire', () => {
    expect(texteDesConditions(AVANCEES)).toBe('source = web');
  });

  it('le reste est rendu à part, intact — `champs_perso` a son propre éditeur et n’en fait pas partie', () => {
    const { source: _s, champs_perso: _c, ...reste } = AVANCEES;
    expect(conditionsConservees(AVANCEES)).toEqual(reste);
  });

  it('écrire puis relire ne perd ni n’invente rien', () => {
    for (const conditions of [
      { statut: 'envoye' }, { total_cents: { gte: 100, lt: 900 } }, { statut: { eq: 'a', neq: 'b' } },
      { source: { in: ['web', 'facebook'] }, statut: { not_in: ['perdu'] } }, { created_at: { gte: '2026-06-01' } },
    ]) {
      const relu = { ...conditionsConservees(conditions), ...lire(texteDesConditions(conditions), conditions).conditions };
      expect(relu, JSON.stringify(conditions)).toEqual(conditions);
    }
    // Une égalité écrite `{ eq }` seule revient à plat : même sens pour le moteur.
    expect(lire(texteDesConditions({ statut: { eq: 'a' } }), { statut: { eq: 'a' } }).conditions).toEqual({ statut: 'a' });
  });
});
