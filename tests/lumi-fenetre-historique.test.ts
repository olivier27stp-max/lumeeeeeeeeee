/**
 * Conversation longue : ce que la personne a dit au début n'est pas oublié, et
 * le cache de la conversation n'est pas réécrit à chaque tour.
 *
 * Phase 4 de la mission (« conversations longues : pas de perte de contexte
 * critique, pas d'explosion de coût »). Avant, l'historique était coupé net à
 * ses 60 derniers messages et la coupe avançait à chaque tour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { fenetreAvecRappel, RAPPEL_MAX_MESSAGES, RAPPEL_MAX_PAR_MESSAGE } from '../server/lib/lumi/historique';

type Msg = Anthropic.Messages.MessageParam;

/** Une conversation de `tours` tours : question, appel d'outil, résultat, réponse (4 messages par tour). */
function conversation(tours: number, question: (i: number) => string = (i) => `question ${i}`): Msg[] {
  const msgs: Msg[] = [];
  for (let i = 1; i <= tours; i++) {
    msgs.push({ role: 'user', content: question(i) });
    msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: `tu_${i}`, name: 'list_invoices', input: {} }] });
    msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: `résultat ${i}` }] });
    msgs.push({ role: 'assistant', content: [{ type: 'text', text: `réponse ${i}` }] });
  }
  return msgs;
}
const premierTexte = (m: Msg[]): string => String(m[0].content);
const valide = (m: Msg[]): boolean => m.every((x, i) => {
  if (x.role !== 'assistant' || typeof x.content === 'string') return true;
  const actions = x.content.filter((b) => b.type === 'tool_use') as Array<{ id: string }>;
  if (!actions.length) return true;
  const suivant = m[i + 1];
  return !!suivant && Array.isArray(suivant.content) && actions.every((a) => (suivant.content as any[]).some((r) => r.type === 'tool_result' && r.tool_use_id === a.id));
});

describe('fenetreAvecRappel', () => {
  it('sous la limite : rien ne change', () => {
    const c = conversation(10);
    expect(fenetreAvecRappel(c, 60)).toBe(c);
  });

  it('ce que la personne a dit au début reste dans le contexte au tour 48', () => {
    const c = conversation(48, (i) => (i === 4 ? 'Pour la suite, « le dossier bleu », c’est la facture 12 de Lévesque.' : `question ${i}`));
    const f = fenetreAvecRappel([...c, { role: 'user', content: 'Il en est où, le dossier bleu ?' }], 60);
    expect(f.length).toBeLessThanOrEqual(60);
    expect(premierTexte(f)).toContain('<messages_precedents>');
    expect(premierTexte(f)).toContain('« le dossier bleu », c’est la facture 12 de Lévesque');
    // Seulement ses mots à elle : ni réponse du modèle, ni résultat d'outil.
    expect(premierTexte(f)).not.toMatch(/réponse \d|résultat \d/);
    expect(f[0].role).toBe('user');
    expect(valide(f)).toBe(true);
  });

  it('la coupe tombe sur un message texte de la personne — jamais entre une action et son résultat', () => {
    for (let tours = 16; tours <= 60; tours++) {
      const f = fenetreAvecRappel(conversation(tours), 60);
      expect(f[0].role, `tours=${tours}`).toBe('user');
      expect(typeof f[0].content, `tours=${tours}`).toBe('string');
      expect(valide(f), `tours=${tours}`).toBe(true);
      expect(f.length, `tours=${tours}`).toBeLessThanOrEqual(60);
    }
  });

  it('la coupe avance par pas : le début de l’historique reste identique pendant plusieurs tours (cache relu, pas réécrit)', () => {
    const debuts = new Set<string>();
    let changements = 0;
    let precedent = '';
    for (let tours = 16; tours <= 46; tours++) {
      const f = fenetreAvecRappel([...conversation(tours), { role: 'user', content: 'suite' }], 60);
      const debut = JSON.stringify(f.slice(0, 5));
      if (precedent && debut !== precedent) changements++;
      precedent = debut;
      debuts.add(debut);
    }
    // 31 tours de plus (124 messages) : la coupe ne doit bouger qu'une poignée de fois, pas à chaque tour.
    expect(changements).toBeLessThanOrEqual(7);
    expect(debuts.size).toBeLessThanOrEqual(8);
  });

  it('le rappel est borné : messages abrégés, et au plus trente — les premiers et les plus récents', () => {
    const long = 'x'.repeat(1000);
    const c = conversation(120, (i) => `${i === 1 ? 'PREMIER' : i === 2 ? 'DEUXIEME' : `q${i}`} ${long}`);
    const rappel = premierTexte(fenetreAvecRappel(c, 60)).split('</messages_precedents>')[0];
    const lignes = rappel.split('\n').filter((l) => l.startsWith('- '));
    expect(lignes.length).toBeLessThanOrEqual(RAPPEL_MAX_MESSAGES + 1);
    for (const l of lignes) expect(l.length).toBeLessThanOrEqual(RAPPEL_MAX_PAR_MESSAGE + 2);
    expect(rappel).toContain('PREMIER');
    expect(rappel).toContain('[…]');
    expect(rappel.length).toBeLessThan(RAPPEL_MAX_MESSAGES * (RAPPEL_MAX_PAR_MESSAGE + 3) + 400);
  });

  it('palier dégradé (fenêtre de 6) : même règle, à son échelle', () => {
    const f = fenetreAvecRappel(conversation(10, (i) => (i === 1 ? 'Ma cliente, c’est Chantal Lévesque.' : `question ${i}`)), 6);
    expect(f.length).toBeLessThanOrEqual(6);
    expect(premierTexte(f)).toContain('Ma cliente, c’est Chantal Lévesque.');
    expect(valide(f)).toBe(true);
  });

  it('la route charge l’historique par cette fenêtre', () => {
    const r = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    expect(r).toContain('fenetreAvecRappel((data ?? []).map(');
    expect(r).not.toContain('let i = msgs.length - max;');
  });
});
