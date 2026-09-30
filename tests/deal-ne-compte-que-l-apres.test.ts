/**
 * Un deal ne compte que ce qui arrive APRÈS son entrée dans la pipeline
 * (Rafba, 2026-09-30 : « si le devis est créé après l'apparition dans la
 * pipeline, fine ; sinon non — même s'il y a eu un devis approuvé l'an passé »).
 *
 * Cas réel : un « Nouveau lead » porte-à-porte affichait « Devis rattaché à ce
 * deal · 793 $ » et « approved » — le devis d'une vente de juillet.
 *
 * Le comportement en base (trigger + montants) est prouvé contre staging ; ce
 * test fige les trois endroits qui doivent porter la règle, pour qu'une
 * réécriture ne la perde pas en silence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { libelleStatutDocument } from '../src/components/pipeline/DealDrawer';

const migration = readFileSync('supabase/migrations/20261003200000_deal_ne_compte_que_l_apres.sql', 'utf8');
const actions = readFileSync('server/lib/actions/index.ts', 'utf8');

describe('un deal ne compte que ce qui arrive après lui', () => {
  it('la base refuse de rattacher un devis ou une job antérieur au deal', () => {
    expect(migration).toMatch(/before insert or update of quote_id, job_id on public\.deals/);
    expect(migration).toMatch(/v_cree < v_depuis/);
  });

  it('le montant d’un deal ignore les devis et jobs faits avant lui', () => {
    expect(migration).toMatch(/q2\.created_at >= d\.created_at/);
    expect(migration).toMatch(/q\.created_at >= d\.created_at/);
    expect(migration).toMatch(/j\.created_at >= d\.created_at/);
  });

  it('une automatisation de devis ne déplace jamais un deal créé après ce devis', () => {
    const debut = actions.indexOf('async function dealDeLaSoumission');
    const corps = actions.slice(debut, actions.indexOf('\n}\n', debut));
    expect(corps).toMatch(/\.lte\('created_at', q\.created_at/);
  });
});

describe('statuts de documents dans la fiche du deal', () => {
  it('traduit au lieu d’afficher le code anglais', () => {
    expect(libelleStatutDocument('approved', true)).toBe('Accepté');
    expect(libelleStatutDocument('approved', false)).toBe('Approved');
    expect(libelleStatutDocument('in_progress', true)).toBe('En cours');
    expect(libelleStatutDocument(null, true)).toBe('—');
    // Un statut inconnu reste lisible plutôt que de disparaître.
    expect(libelleStatutDocument('quelque_chose', true)).toBe('quelque_chose');
  });
});
