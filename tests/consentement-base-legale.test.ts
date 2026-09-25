/**
 * Les fenêtres de la LCAP, au jour près (2026-09-23).
 *
 * C'est le genre de code où une erreur d'un facteur 2 ou d'un mois ne se voit
 * jamais : le système continue d'envoyer, simplement il envoie à des gens
 * qu'il n'avait plus le droit de contacter. D'où des bornes testées à un jour
 * de part et d'autre.
 *
 * Références : relation d'affaires 2 ans, demande d'information 6 mois
 * (CRTC, https://crtc.gc.ca/eng/com500/guide.htm).
 */
import { describe, it, expect } from 'vitest';
import {
  baseTacite,
  baseLegalePour,
  methodePourJournal,
  decrireBase,
  JOURS_RELATION_AFFAIRES,
  JOURS_DEMANDE,
} from '../server/lib/consentement/base-legale';

const MAINTENANT = new Date('2026-09-23T12:00:00.000Z');
const ilYA = (jours: number) => new Date(MAINTENANT.getTime() - jours * 86_400_000).toISOString();

describe('relation d\'affaires — 2 ans', () => {
  it('un job de la veille de l\'échéance fonde encore le droit', () => {
    const b = baseTacite({ dernierJob: { id: 'job-1', date: ilYA(JOURS_RELATION_AFFAIRES - 1) } }, MAINTENANT);
    expect(b).toMatchObject({ type: 'tacite', raison: 'relation_affaires', reference: 'job-1' });
  });

  it('un job du lendemain de l\'échéance ne fonde plus rien', () => {
    expect(baseTacite({ dernierJob: { id: 'job-1', date: ilYA(JOURS_RELATION_AFFAIRES + 1) } }, MAINTENANT)).toBeNull();
  });

  it('une facture compte autant qu\'un job', () => {
    const b = baseTacite({ derniereFacture: { id: 'inv-9', date: ilYA(400) } }, MAINTENANT);
    expect(b).toMatchObject({ raison: 'relation_affaires', reference: 'inv-9' });
  });

  it('entre un job et une facture, la plus RÉCENTE gagne — elle repousse l\'échéance', () => {
    const b = baseTacite({
      dernierJob: { id: 'job-vieux', date: ilYA(700) },
      derniereFacture: { id: 'inv-recent', date: ilYA(30) },
    }, MAINTENANT);
    expect(b).toMatchObject({ reference: 'inv-recent' });
    // …et l'échéance part de la facture, pas du job.
    expect((b as any).expire.slice(0, 4)).toBe('2028');
  });
});

describe('demande d\'information — 6 mois', () => {
  it('un devis de la veille de l\'échéance fonde le droit', () => {
    const b = baseTacite({ dernierDevis: { id: 'q-1', date: ilYA(JOURS_DEMANDE - 1) } }, MAINTENANT);
    expect(b).toMatchObject({ type: 'tacite', raison: 'demande', reference: 'q-1' });
  });

  it('un devis du lendemain de l\'échéance ne fonde plus rien', () => {
    expect(baseTacite({ dernierDevis: { id: 'q-1', date: ilYA(JOURS_DEMANDE + 1) } }, MAINTENANT)).toBeNull();
  });

  it('la relation d\'affaires prime sur la demande — elle est plus forte et plus longue', () => {
    const b = baseTacite({
      dernierJob: { id: 'job-1', date: ilYA(400) },
      dernierDevis: { id: 'q-1', date: ilYA(10) },
    }, MAINTENANT);
    expect(b).toMatchObject({ raison: 'relation_affaires', reference: 'job-1' });
  });

  it('un devis ancien ne sauve pas un job périmé : les deux fenêtres sont indépendantes', () => {
    expect(baseTacite({
      dernierJob: { id: 'job-1', date: ilYA(800) },
      dernierDevis: { id: 'q-1', date: ilYA(300) },
    }, MAINTENANT)).toBeNull();
  });
});

describe('rien, ou des données inutilisables', () => {
  it('aucun ancrage → aucune base', () => {
    expect(baseTacite({}, MAINTENANT)).toBeNull();
  });

  it('une date illisible est ignorée plutôt que devinée', () => {
    expect(baseTacite({ dernierJob: { id: 'job-1', date: 'pas-une-date' } }, MAINTENANT)).toBeNull();
  });

  it('une date FUTURE ne fonde rien — sinon une faute de saisie ouvrirait deux ans de droit', () => {
    const demain = new Date(MAINTENANT.getTime() + 86_400_000).toISOString();
    expect(baseTacite({ dernierJob: { id: 'job-1', date: demain } }, MAINTENANT)).toBeNull();
  });
});

describe('l\'exprès prime sur le tacite', () => {
  it('un consentement exprès est retenu même avec une relation d\'affaires valide', () => {
    const b = baseLegalePour(ilYA(500), { dernierJob: { id: 'job-1', date: ilYA(10) } }, MAINTENANT);
    expect(b).toMatchObject({ type: 'expres' });
  });

  it('un exprès ANCIEN reste valide : il n\'expire pas', () => {
    // 5 ans : bien au-delà de toute fenêtre tacite.
    const b = baseLegalePour(ilYA(1825), {}, MAINTENANT);
    expect(b).toMatchObject({ type: 'expres' });
  });

  it('sans exprès, on retombe sur le tacite', () => {
    const b = baseLegalePour(null, { dernierJob: { id: 'job-1', date: ilYA(10) } }, MAINTENANT);
    expect(b).toMatchObject({ type: 'tacite' });
  });

  it('ni l\'un ni l\'autre → null, l\'appelant bloquera', () => {
    expect(baseLegalePour(null, {}, MAINTENANT)).toBeNull();
  });
});

describe('ce qu\'on écrit au journal', () => {
  it('la méthode dit d\'où vient le droit', () => {
    expect(methodePourJournal({ type: 'expres', depuis: ilYA(1) })).toBe('crm-expres');
    expect(methodePourJournal({ type: 'tacite', raison: 'relation_affaires', reference: 'x', expire: ilYA(-1) }))
      .toBe('lcap-tacite:relation_affaires');
    expect(methodePourJournal({ type: 'tacite', raison: 'demande', reference: 'x', expire: ilYA(-1) }))
      .toBe('lcap-tacite:demande');
  });

  it('la description est lisible par un humain qui enquête', () => {
    expect(decrireBase({ type: 'expres', depuis: '2026-03-12T00:00:00.000Z' })).toContain('2026-03-12');
    expect(decrireBase({ type: 'tacite', raison: 'relation_affaires', reference: 'x', expire: '2028-01-04T00:00:00.000Z' }))
      .toContain('2028-01-04');
  });
});
