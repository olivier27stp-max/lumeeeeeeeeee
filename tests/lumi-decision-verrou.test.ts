/**
 * Une seule décision (confirmer / annuler) à la fois par conversation.
 *
 * Tests critiques du 2026-10-01, en prod : deux « Confirmer » simultanés
 * exécutaient l'action une seule fois (idempotence), mais la conversation
 * gardait deux résultats pour la même carte — un historique que l'API du
 * modèle refuse ensuite. La route prend maintenant un verrou par conversation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const route = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8').replace(/\r\n/g, '\n');
const debut = route.indexOf("router.post('/lumi/execute'");
const fin = route.indexOf("router.get('/lumi/mode'");
const execute = route.slice(debut, fin);

describe('verrou de décision sur /lumi/execute', () => {
  it('la route existe et son bloc est isolé', () => {
    expect(debut).toBeGreaterThan(0);
    expect(fin).toBeGreaterThan(debut);
  });

  it('le verrou est pris AVANT de lire la conversation : le second appel ne voit jamais la carte « en attente »', () => {
    const refus = execute.indexOf('if (decisionsEnCours.has(conversation_id))');
    const prise = execute.indexOf('decisionsEnCours.add(conversation_id);');
    const lecture = execute.indexOf('chargerHistorique(conversation_id');
    expect(refus).toBeGreaterThan(0);
    expect(prise).toBeGreaterThan(refus);
    expect(lecture).toBeGreaterThan(prise);
    expect(execute).toContain("code: 'decision_en_cours'");
    expect(execute.slice(refus, prise)).toContain('res.status(409)');
  });

  it('aucun `await` entre le test et la prise du verrou : deux appels simultanés ne passent pas tous les deux', () => {
    const refus = execute.indexOf('if (decisionsEnCours.has(conversation_id))');
    const prise = execute.indexOf('decisionsEnCours.add(conversation_id);');
    expect(execute.slice(refus, prise)).not.toMatch(/\bawait\b/);
  });

  it('le verrou est rendu dans un `finally` : une erreur ou un retour anticipé ne bloque pas la conversation', () => {
    expect(execute).toMatch(/\} finally \{\s*if \(verrou\) decisionsEnCours\.delete\(verrou\);\s*\}/);
    // Rendu seulement par celui qui l'a pris : le second appel (409) ne libère pas le verrou du premier.
    expect(execute).toContain('let verrou: string | null = null;');
    expect(execute.indexOf('verrou = conversation_id;')).toBeGreaterThan(execute.indexOf('decisionsEnCours.add(conversation_id);'));
  });
});
