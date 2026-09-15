/**
 * Bot de migration (server/lib/migration/bot.ts) — les décisions pures et
 * les garde-fous :
 * - un champ inconnu du catalogue ne passe jamais (null, confiance 0) ;
 * - confirmation seulement à ≥ 0,90, sinon question au client ;
 * - doublon : courriel ou téléphone identique → fusion ; nom seul → question ;
 *   ressemblance faible → nouvelle fiche ; jamais une fusion par le nom ;
 * - gabarit appliqué seulement à ≥ 80 % de couverture ;
 * - réponses du client interprétées prudemment (null si ambiguë) ;
 * - le bot ne contient ni approbation ni import final ni rollback.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { couvertureGabarit, validerVerdicts, deciderDoublon, deciderMapping, constatsRejets, interpreterReponseColonne, SEUIL_CONFIRMATION, SEUIL_GABARIT, MAX_PASSES } from '../server/lib/migration/bot';
import { FIELD_CATALOG } from '../server/lib/migration/mapping';

const lu = (p: string) => readFileSync(resolve(__dirname, '..', ...p.split('/')), 'utf8');
const champsClient = FIELD_CATALOG.client;

describe('verdicts de correspondance', () => {
  it('un champ hors catalogue devient null avec confiance 0 ; les candidats inconnus sont retirés', () => {
    const v = validerVerdicts({ colonnes: [
      { position: 0, field: 'email', confidence: 0.97, raison: 'en-tête Courriel' },
      { position: 1, field: 'numero_de_cellulaire', confidence: 0.95 },
      { position: 2, field: null, confidence: 0.4, candidats: ['phone', 'fax', 'phone_secondary'] },
    ] }, champsClient);
    expect(v[0]).toMatchObject({ field: 'email', confidence: 0.97 });
    expect(v[1]).toMatchObject({ field: null, confidence: 0 });
    expect(v[2].candidats).toEqual(['phone', 'phone_secondary']);
    expect(validerVerdicts('pas du json', champsClient)).toEqual([]);
    // Un verdict mal formé est jeté seul ; une raison trop longue est coupée, pas refusée (vu en direct : le modèle explique en 250 caractères).
    const mixte = validerVerdicts({ colonnes: [{ position: 0, field: 'email', confidence: 1.5 }, { position: 1, field: 'phone', confidence: 0.95, raison: 'x'.repeat(400), candidats: ['a', 'b', 'c', 'd'] }] }, champsClient);
    expect(mixte).toHaveLength(1);
    expect(mixte[0].raison).toHaveLength(200);
    // Tableau sérialisé en chaîne (vu en direct avec Sonnet 5) : accepté.
    expect(validerVerdicts({ colonnes: JSON.stringify({ colonnes: [{ position: 3, field: 'email', confidence: 0.95 }] }) }, champsClient)).toHaveLength(1);
    expect(validerVerdicts({ colonnes: JSON.stringify([{ position: 3, field: 'email', confidence: 0.95 }]) }, champsClient)).toHaveLength(1);
  });
  it('confirmer seulement à ≥ 0,90 avec un champ ; sinon demander', () => {
    expect(SEUIL_CONFIRMATION).toBe(0.9);
    expect(deciderMapping({ position: 0, field: 'email', confidence: 0.9, raison: '', candidats: [] })).toBe('confirmer');
    expect(deciderMapping({ position: 0, field: 'email', confidence: 0.89, raison: '', candidats: [] })).toBe('demander');
    expect(deciderMapping({ position: 0, field: null, confidence: 0.99, raison: '', candidats: [] })).toBe('demander');
  });
});

describe('doublons', () => {
  it('courriel ou téléphone identique → fusion ; nom seul → question ; faible → nouvelle fiche ; déjà décidé → rien', () => {
    expect(deciderDoublon({ score: 95, decision: 'pending', match_reasons: ['email', 'name'] })).toBe('merge');
    expect(deciderDoublon({ score: 92, decision: 'pending', match_reasons: 'phone' })).toBe('merge');
    expect(deciderDoublon({ score: 95, decision: 'pending', match_reasons: ['name'] })).toBe('demander');
    expect(deciderDoublon({ score: 95, decision: 'pending', match_reasons: ['name', 'address'] })).toBe('demander');
    expect(deciderDoublon({ score: 80, decision: 'review', match_reasons: ['email'] })).toBe('create_new');
    expect(deciderDoublon({ score: 95, decision: 'merge', match_reasons: ['email'] })).toBeNull();
  });
});

describe('gabarits et réponses', () => {
  it('couverture d un gabarit : à la normalisation des en-têtes près, seuil 80 %', () => {
    expect(SEUIL_GABARIT).toBe(0.8);
    const map = { 'first name': 'first_name', 'last name': 'last_name', email: 'email', phone: 'phone' };
    expect(couvertureGabarit(['First Name', 'Last Name', 'Email', 'Phone', 'Notes'], map)).toBeCloseTo(0.8);
    expect(couvertureGabarit(['A', 'B'], map)).toBe(0);
    expect(couvertureGabarit([], map)).toBe(0);
    expect(couvertureGabarit(['Email'], undefined)).toBe(0);
  });
  it('réponse du client : option choisie, « ignorer », ou null si ambiguë', () => {
    const c = [{ field: 'phone', label: 'Téléphone' }, { field: 'phone_secondary', label: 'Téléphone secondaire' }];
    expect(interpreterReponseColonne('Téléphone secondaire', c)).toEqual({ field: 'phone_secondary', ignorer: false });
    expect(interpreterReponseColonne('phone', c)).toEqual({ field: 'phone', ignorer: false });
    expect(interpreterReponseColonne('Ignorer cette colonne', c)).toEqual({ field: null, ignorer: true });
    expect(interpreterReponseColonne('je sais pas', c)).toBeNull();
    expect(interpreterReponseColonne('', c)).toBeNull();
  });
  it('constats sur les rejets : une phrase par entité et raison, vocabulaire d affichage', () => {
    const c = constatsRejets([{ entity_type: 'invoice', status: 'orphan', n: 12 }, { entity_type: 'job', status: 'error', n: 1 }, { entity_type: 'client', status: 'ready', n: 5 }, { entity_type: 'visit', status: 'orphan', n: 0 }]);
    expect(c).toEqual([
      '12 factures sans client ou job correspondant dans les fichiers (lignes orphelines : elles ne seront pas importées).',
      '1 jobs avec une valeur illisible (date, montant ou identifiant) : voir les rejets.',
    ]);
  });
});

describe('garde-fous', () => {
  it('le bot ne contient ni approbation, ni import final, ni rollback ; il est borné ; le modèle ne voit que des échantillons masqués', () => {
    const src = lu('server/lib/migration/bot.ts');
    expect(src).not.toMatch(/runFinalImport\(|rollbackFinalBatch\(|from\('migration_approvals'\)|status: 'approved'|poserStatut\([^)]*'ready_for_final_import'/);
    expect(MAX_PASSES).toBeLessThanOrEqual(10);
    expect(src).toContain('samples_masked');
    expect(src).not.toMatch(/payload/);
    // Les décisions sont auditées comme « assistant », jamais comme un admin.
    expect(src).toContain("role: 'assistant'");
    expect(src).not.toContain("actorRole: 'platform_admin'");
  });
  it('les routes admin et le bot partagent le même import test et la même demande d approbation', () => {
    const r = lu('server/routes/migration-admin.ts');
    expect(r).toContain("import { lancerImportTest, demanderApprobation } from '../lib/migration/execution';");
    expect(r).toContain("router.post('/migration-admin/migrations/:id/bot'");
    expect(r).toContain("'bot_actif'] as const");
    expect(lu('server/index.ts')).toContain("withAdvisoryLock('migration-bot'");
    expect(lu('src/pages/AdminMigrations.tsx')).toContain('Confier au bot');
  });
});
