/**
 * Le Reçu — attribution.
 *
 * Ce test fige la promesse commerciale : le reçu ne compte QUE l'argent qui a
 * eu besoin d'un suivi. Chaque cas ci-dessous est une façon de gonfler le total
 * sans mentir techniquement — et chacune doit échouer.
 */
import { describe, it, expect } from 'vitest';
import {
  attribuer,
  composerRecu,
  expliquer,
  FENETRE_ATTRIBUTION_JOURS,
  type ChronologieDevis,
  type Relance,
} from '../server/lib/recu/attribution';

const j = (iso: string) => new Date(`${iso}T12:00:00Z`);

const relance = (iso: string, o: Partial<Relance> = {}): Relance => ({
  envoyeeA: j(iso),
  canal: 'email',
  origine: 'auto',
  source: 'automation_execution_logs',
  ...o,
});

const devis = (o: Partial<ChronologieDevis> = {}): ChronologieDevis => ({
  devisId: 'q1',
  orgId: 'org1',
  montantCents: 420_000,
  envoyeA: j('2026-09-01'),
  signeA: j('2026-09-20'),
  relances: [],
  ...o,
});

describe('attribuer', () => {
  it('crédite la DERNIÈRE relance avant la signature (last-touch)', () => {
    const v = attribuer(devis({
      relances: [relance('2026-09-05'), relance('2026-09-15', { canal: 'sms' })],
    }));
    expect(v.retenu).toBe(true);
    if (!v.retenu) return;
    expect(v.relanceCreditee.envoyeeA).toEqual(j('2026-09-15'));
    expect(v.relanceCreditee.canal).toBe('sms');
    expect(v.nbRelances).toBe(2);
    expect(v.joursEntreRelanceEtSignature).toBe(5);
  });

  it('EXCLUT une soumission signée sans aucune relance', () => {
    // Le cœur de la promesse : cet argent serait rentré tout seul.
    const v = attribuer(devis({ relances: [] }));
    expect(v.retenu).toBe(false);
    if (v.retenu) return;
    expect(v.raison).toBe('aucune_relance_avant_signature');
  });

  it('ne compte pas l’envoi initial comme une relance', () => {
    // Une trace déposée à la seconde de l'envoi n'est pas un suivi : sans cette
    // borne stricte, TOUTE soumission signée entrerait dans le reçu.
    const v = attribuer(devis({
      envoyeA: j('2026-09-01'),
      relances: [relance('2026-09-01')],
    }));
    expect(v.retenu).toBe(false);
  });

  it('ignore une relance partie APRÈS la signature', () => {
    // Cas réel : le moteur envoie la relance de J+14 avant d'avoir vu la
    // signature. Elle n'a rien causé.
    const v = attribuer(devis({
      signeA: j('2026-09-10'),
      relances: [relance('2026-09-12')],
    }));
    expect(v.retenu).toBe(false);
    if (v.retenu) return;
    expect(v.raison).toBe('aucune_relance_avant_signature');
  });

  it('ignore une relance plus vieille que la fenêtre d’attribution', () => {
    const v = attribuer(devis({
      envoyeA: j('2026-01-01'),
      signeA: j('2026-09-20'),
      relances: [relance('2026-01-05')],
    }));
    expect(v.retenu).toBe(false);
  });

  it('retient une relance juste à l’intérieur de la fenêtre', () => {
    const signe = j('2026-09-20');
    const dedans = new Date(signe.getTime() - (FENETRE_ATTRIBUTION_JOURS - 1) * 86_400_000);
    const v = attribuer(devis({ envoyeA: j('2026-01-01'), signeA: signe, relances: [relance(dedans.toISOString().slice(0, 10))] }));
    expect(v.retenu).toBe(true);
  });

  it('écarte un devis jamais envoyé, même marqué signé', () => {
    const v = attribuer(devis({ envoyeA: null, relances: [relance('2026-09-15')] }));
    expect(v.retenu).toBe(false);
    if (v.retenu) return;
    expect(v.raison).toBe('jamais_envoye');
  });

  it('écarte un devis non signé', () => {
    const v = attribuer(devis({ signeA: null, relances: [relance('2026-09-05')] }));
    expect(v.retenu).toBe(false);
    if (v.retenu) return;
    expect(v.raison).toBe('non_signe');
  });

  it('écarte un montant nul ou négatif', () => {
    for (const montant of [0, -1000]) {
      const v = attribuer(devis({ montantCents: montant, relances: [relance('2026-09-05')] }));
      expect(v.retenu).toBe(false);
      if (v.retenu) continue;
      expect(v.raison).toBe('montant_nul');
    }
  });

  it('refuse une chronologie incohérente plutôt que de deviner', () => {
    const v = attribuer(devis({ envoyeA: j('2026-09-20'), signeA: j('2026-09-01') }));
    expect(v.retenu).toBe(false);
    if (v.retenu) return;
    expect(v.raison).toBe('signe_avant_envoi');
  });

  it('accepte les relances données dans le désordre', () => {
    const v = attribuer(devis({
      relances: [relance('2026-09-15'), relance('2026-09-05'), relance('2026-09-10')],
    }));
    expect(v.retenu).toBe(true);
    if (!v.retenu) return;
    expect(v.relanceCreditee.envoyeeA).toEqual(j('2026-09-15'));
  });
});

describe('composerRecu', () => {
  it('additionne les retenus, garde les écartés et trie par montant', () => {
    const r = composerRecu([
      devis({ devisId: 'a', montantCents: 120_000, relances: [relance('2026-09-05')] }),
      devis({ devisId: 'b', montantCents: 840_000, relances: [relance('2026-09-06')] }),
      devis({ devisId: 'c', montantCents: 500_000, relances: [] }),
    ]);
    expect(r.totalCents).toBe(960_000);
    expect(r.attributions.map((a) => a.devisId)).toEqual(['b', 'a']);
    expect(r.ecartes).toEqual([{ devisId: 'c', raison: 'aucune_relance_avant_signature' }]);
  });

  it('rend un reçu vide, pas une erreur, quand rien n’est attribuable', () => {
    const r = composerRecu([devis({ relances: [] })]);
    expect(r.totalCents).toBe(0);
    expect(r.attributions).toEqual([]);
  });
});

describe('expliquer', () => {
  it('donne la timeline sans affirmer la causalité', () => {
    const v = attribuer(devis({
      montantCents: 420_000,
      relances: [relance('2026-09-05'), relance('2026-09-19')],
    }));
    expect(v.retenu).toBe(true);
    if (!v.retenu) return;
    const { retenu: _r, ...a } = v;
    const phrase = expliquer(a);
    expect(phrase).toContain('2026-09-01');
    expect(phrase).toContain('2026-09-19');
    // `expliquer` ramène les espaces d'Intl (U+00A0/U+202F selon la version
    // d'ICU) à une espace ordinaire, comme partout dans Lume. Le test l'exige
    // explicitement : un montant collé à une insécable casse l'affichage.
    expect(phrase).toContain('4 200,00 $');
    expect(phrase).not.toMatch(/[  ]/);
    // « signée après relance », jamais « récupérée PAR la relance ».
    expect(phrase).not.toMatch(/récupérée? par/i);
  });
});
