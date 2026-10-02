/**
 * Un seul tour OU une seule décision à la fois par conversation.
 *
 * Tests critiques du 2026-10-01, en prod : deux « Confirmer » simultanés
 * exécutaient l'action une seule fois (idempotence), mais la conversation
 * gardait deux résultats pour la même carte — un historique que l'API du
 * modèle refuse ensuite. Même danger entre un message et un « Confirmer »
 * partis ensemble (web + téléphone, double envoi). Les deux routes prennent
 * le même verrou, par personne et par conversation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const route = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8').replace(/\r\n/g, '\n');
const bloc = (debut: string, fin: string): string => {
  const a = route.indexOf(debut);
  const b = route.indexOf(fin, a + 1);
  expect(a, debut).toBeGreaterThan(0);
  expect(b, fin).toBeGreaterThan(a);
  return route.slice(a, b);
};
const chat = bloc("router.post('/lumi/chat'", "router.post('/lumi/action'");
const execute = bloc("router.post('/lumi/execute'", "router.get('/lumi/mode'");

describe.each([
  ['/lumi/execute', () => execute, 'decision_en_cours'],
  ['/lumi/chat', () => chat, 'conversation_occupee'],
])('verrou de conversation sur %s', (_nom, source, code) => {
  it('pris AVANT de lire la conversation : le second arrivé ne voit jamais la carte « en attente »', () => {
    const s = source();
    const refus = s.indexOf('if (conversationsOccupees.has(cleVerrou))');
    const prise = s.indexOf('conversationsOccupees.add(cleVerrou);');
    const lecture = s.indexOf('chargerHistorique(');
    expect(refus).toBeGreaterThan(0);
    expect(prise).toBeGreaterThan(refus);
    expect(lecture).toBeGreaterThan(prise);
    expect(s).toContain(`code: '${code}'`);
    expect(s.slice(refus, prise)).toContain('res.status(409)');
  });

  it('aucun `await` entre le test et la prise : deux appels simultanés ne passent pas tous les deux', () => {
    const s = source();
    const refus = s.indexOf('if (conversationsOccupees.has(cleVerrou))');
    const prise = s.indexOf('conversationsOccupees.add(cleVerrou);');
    expect(s.slice(refus, prise)).not.toMatch(/\bawait\b/);
  });

  it('rendu dans un `finally`, par celui qui l’a pris seulement', () => {
    const s = source();
    expect(s).toMatch(/\} finally \{\s*if \(verrou\) conversationsOccupees\.delete\(verrou\);\s*\}/);
    expect(s).toContain('let verrou: string | null = null;');
    // `verrou` n'est posé qu'APRÈS la prise : le second appel (409) ne libère pas le verrou du premier.
    expect(s.indexOf('verrou = cleVerrou;')).toBeGreaterThan(s.indexOf('conversationsOccupees.add(cleVerrou);'));
  });

  it('la clé porte la personne : nul ne peut occuper la conversation d’un autre', () => {
    expect(source()).toMatch(/cleVerrou = (conversation_id \? )?`\$\{ctx\.auth\.user\.id\}:\$\{conversation_id\}`/);
  });
});

describe('les refus de /lumi/execute parlent la langue de la personne', () => {
  // 2026-10-02, trois confirmations de la même carte : la troisième répondait « No such pending action. » à un compte en français.
  it.each(['decision_en_cours', 'aucune_proposition', 'proposition_expiree'])('%s : une phrase en français et une en anglais', (code) => {
    const fin = execute.indexOf(`code: '${code}'`);
    expect(fin).toBeGreaterThan(0);
    const reponse = execute.slice(execute.lastIndexOf('res.status(409)', fin), fin);
    expect(reponse).toMatch(/ctx\.language === 'fr' \? '[^']+' : '[^']+'/);
  });
});

describe('un seul verrou pour les deux routes', () => {
  it('le chat et la décision partagent le même ensemble', () => {
    expect(route.match(/const conversationsOccupees = new Set<string>\(\);/g)).toHaveLength(1);
    expect(route.indexOf('const conversationsOccupees')).toBeLessThan(route.indexOf("router.post('/lumi/chat'"));
  });

  it('une NOUVELLE conversation ne prend pas de verrou (elle n’a pas encore d’identifiant à disputer)', () => {
    expect(chat).toContain('const cleVerrou = conversation_id ? `${ctx.auth.user.id}:${conversation_id}` : null;');
    expect(chat).toContain('if (cleVerrou) {');
  });
});
