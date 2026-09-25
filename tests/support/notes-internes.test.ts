/**
 * Une note interne dans un fil Slack de ticket ne part JAMAIS au client
 * (incident du 2026-09-17 : une relance de suivi d'équipe relayée à l'abonné).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { estNoteInterne } from '../../server/lib/support/relais-slack';

describe('estNoteInterne', () => {
  it('reconnaît le gabarit de relance qui a fui', () => {
    const fuite = `Relance 36h+ — toujours ouvert, pas de réponse produit Will/Oli.

Abonné : William Hébert · Coquin lavage · Autopilot
Demande : supprimer des tâches / travaux (parcours UI exact — pas de doc IA).
Compte : à enrichir (SF oct)

À faire : répondre dans ce fil avec le geste exact (ou confirmer si pas encore possible), puis on close.

 *Sent using* Slack Workflow`;
    expect(estNoteInterne(fuite)).toBe(true);
    expect(estNoteInterne('Relance 24h — toujours ouvert. À faire : relancer.')).toBe(true);
  });
  it('reconnaît les marqueurs explicites', () => {
    for (const t of ['🔒 on attend Oli avant de répondre', '[interne] je regarde demain', 'interne : c’est un bug connu', 'Note interne — voir le ticket 12', '// à discuter en stand-up', '#interne pas prioritaire']) expect(estNoteInterne(t), t).toBe(true);
  });
  it('laisse passer les vraies réponses au client', () => {
    for (const t of [
      'Bonjour William, pour supprimer une tâche : ouvre la tâche, menu ⋯ en haut à droite, « Supprimer ». Pour un job, c’est dans Jobs → le job → Archiver.',
      'On regarde ça et on revient à toi d’ici demain.',
      'C’est corrigé, tu peux réessayer.',
      'Merci de ta patience, la relance automatique est maintenant activée sur ton compte.',
      'Peux-tu nous envoyer une capture ?',
    ]) expect(estNoteInterne(t), t).toBe(false);
  });
  it('le relais applique la règle avant d écrire quoi que ce soit au client', () => {
    const src = readFileSync(resolve(__dirname, '..', '..', 'server', 'lib', 'support', 'relais-slack.ts'), 'utf8');
    const i = src.indexOf('if (estNoteInterne(corps))');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(src.indexOf('await ajouterMessage(admin, { ticket: t'));
    expect(src).toContain("return 'ignored:internal-note';");
    // Marquée comme traitée (message system avec son ts) : le relevé des 45 s ne la re-signale pas dans le fil à chaque passage.
    const marque = src.indexOf("await marquerTraiteSlack(admin, t, e.ts, 'slack:note-interne')");
    expect(marque).toBeGreaterThan(i);
    expect(marque).toBeLessThan(src.indexOf("return 'ignored:internal-note';"));
  });
});
