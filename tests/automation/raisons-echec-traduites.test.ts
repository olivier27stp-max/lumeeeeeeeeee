/**
 * Aucun motif d'échec du moteur n'arrive à l'écran en anglais.
 *
 * Relevé dans les journaux de prod le 2026-10-01 : « Review requests are
 * disabled in Settings → Customer reviews. », « A review request was already
 * sent to this client in the last 7 days. », « No org owner found to own the
 * task »… Le moteur écrit ces causes en anglais (des tests et le classement
 * « à réessayer / définitif » s'appuient sur ces textes : on ne les change
 * pas). C'est l'ÉCRAN qui les traduit — mais il y avait deux traducteurs, un
 * pour la liste, un pour l'onglet Journaux, et aucun des deux ne connaissait
 * tous les messages : l'onglet Journaux affichait alors l'anglais brut.
 *
 * Ce test relit le moteur : tout message d'échec anglais qu'il peut écrire doit
 * être traduit par les DEUX traducteurs. Un nouveau message anglais ajouté au
 * moteur sans sa traduction fait échouer ce test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { raisonLisible, raisonEchecListe } from '../../src/lib/automationJournauxApi';

const MOTEUR = ['server/lib/actions/index.ts', 'server/lib/automationEngine.ts'];
const ANGLAIS = /\b(the|not|no|was|is|has|have|for|already|failed|missing|skipped|reached|disabled|cannot|invalid|unknown|found|configured|required)\b/i;
const FRANCAIS = /[àâçéèêëîïôùûœ’]|\b(le|la|les|pas|aucune?|introuvable|une?|est|pour|déjà|ce|cette|des|du|sans|ne|rien)\b/i;

/** Les littéraux `error: '…'` du moteur écrits en anglais, variables remplacées par un exemple. */
function messagesAnglaisDuMoteur(): string[] {
  const vus = new Set<string>();
  for (const f of MOTEUR) {
    const source = readFileSync(join(process.cwd(), f), 'utf8');
    // Toute la ligne : `error: a ? 'X' : 'Y'` ou `error: [...].join(' / ') || 'Z'` portent aussi des messages.
    for (const ligne of source.split('\n')) {
      if (!/\berror:/.test(ligne)) continue;
      for (const m of ligne.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
        const brut = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'");
        if (brut.length < 8 || !ANGLAIS.test(brut) || FRANCAIS.test(brut)) continue;
        vus.add(brut.replace(/\$\{[^}]*\}/g, 'exemple'));
      }
    }
  }
  return [...vus];
}

/**
 * Les causes en anglais RÉELLEMENT présentes dans les journaux de prod (60 jours, relevé du 2026-10-01),
 * numéros et adresses remplacés. Certaines viennent d'autres modules que le moteur (fournisseur de
 * textos) ou d'anciennes versions : elles restent dans les journaux, donc à l'écran.
 */
const VUES_EN_PROD = [
  'Frequency cap reached for +15145550000 (max 3 commercial messages / 24h) — skipped to avoid spamming',
  'Twilio not configured',
  'A review request was already sent to this client in the last 7 days.',
  'No recipient email',
  'No recipient phone',
  'Table not allowed for update_status: memberships',
  'Review request could not be sent',
  'Organization has no SMS number provisioned (sms_not_provisioned)',
  'Review requests are disabled in Company Settings.',
  'Review requests are disabled in Settings → Customer reviews.',
];

const messages = [...new Set([...messagesAnglaisDuMoteur(), ...VUES_EN_PROD])];

describe('motifs d’échec du moteur', () => {
  it('le relevé trouve bien les messages anglais du moteur (témoin)', () => {
    expect(messages.length).toBeGreaterThanOrEqual(10);
    expect(messages).toContain('Review requests are disabled in Settings → Customer reviews.');
    expect(messages).toContain('A review request was already sent to this client in the last 7 days.');
  });

  it.each(messages)('onglet Journaux : « %s » est traduit', (message) => {
    const fr = raisonLisible(message, true);
    expect(fr, 'rendu tel quel').not.toBe(message);
    expect(fr).toBeTruthy();
    expect(fr!, 'encore de l’anglais').not.toMatch(/\b(the|not|was|already|reached|disabled|configured|found)\b/i);
  });

  it.each(messages)('liste : « %s » est traduit', (message) => {
    const fr = raisonEchecListe(message, true);
    expect(fr, 'aucune cause affichée').toBeTruthy();
    expect(fr!, 'encore de l’anglais').not.toMatch(/\b(the|not|was|already|reached|disabled|configured|found)\b/i);
  });
});

describe('des traductions justes', () => {
  it('avis désactivés : l’écran dit où les activer', () => {
    expect(raisonLisible('Review requests are disabled in Settings → Customer reviews.', true))
      .toBe('les demandes d’avis sont désactivées dans Paramètres › Avis clients');
    expect(raisonEchecListe('Review requests are disabled in Settings → Customer reviews.', true))
      .toBe('Les demandes d’avis sont désactivées dans Paramètres › Avis clients.');
  });

  it('demande d’avis déjà envoyée', () => {
    expect(raisonLisible('A review request was already sent to this client in the last 7 days.', true))
      .toBe('une demande d’avis a déjà été envoyée à ce client dans les 7 derniers jours');
  });

  it('ni courriel ni téléphone : les deux sont dits', () => {
    expect(raisonLisible('Client has no email address or phone number.', true))
      .toBe('ce client n’a ni adresse courriel ni numéro de téléphone');
    expect(raisonEchecListe('Client has no email address or phone number.', true))
      .toBe('Ce client n’a ni adresse courriel ni numéro de téléphone.');
  });

  it('en anglais, les mêmes causes en phrases anglaises lisibles', () => {
    expect(raisonLisible('No org owner found to own the task', false)).toBe('no owner was found for this office, so the task could not be created');
    expect(raisonEchecListe('No org owner found to own the task', false)).toBe('No owner was found for this office, so the task could not be created.');
  });

  it('un message déjà en français passe tel quel dans les Journaux ; la liste ne montre que ce qu’elle reconnaît', () => {
    expect(raisonLisible('Client introuvable.', true)).toBe('Client introuvable.');
    expect(raisonEchecListe('Client introuvable.', true)).toBeNull();
    expect(raisonEchecListe(null, true)).toBeNull();
  });

  it('les traductions d’avant sont intactes', () => {
    expect(raisonEchecListe('No SMS number configured', true)).toBe('Aucun numéro texto n’est configuré pour ce bureau.');
    expect(raisonEchecListe('Frequency cap reached for +15145550000 (max 3 commercial messages / 24h) — skipped to avoid spamming', true))
      .toBe('Plafond atteint : ce client a déjà reçu plusieurs messages aujourd’hui.');
    expect(raisonLisible('No recipient phone', true)).toBe('ce client n’a pas de numéro de téléphone');
  });
});
