/**
 * « Construire avec Lumi » signale une automatisation déjà publiée sur le même déclencheur.
 *
 * Vrai cas de prod (2026-10-01, Coquin lavage) : « fais un message pour notifier
 * le rep qui a envoyé le devis » → une notification à la première ouverture du
 * devis, alors que le bureau avait déjà, publiée, « Me notifier quand un client
 * ouvre sa soumission ». Lumi n'en a rien dit : publiée, la nouvelle aurait
 * notifié le rep deux fois.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lireDejaPubliees, noteDejaPubliees } from '../server/lib/lumi/deja-publiees';

/** La règle réelle du bureau, telle qu'elle est en base. */
const PREREGLAGE_PROD = {
  id: 'r1', name: 'Me notifier quand un client ouvre sa soumission', steps: null,
  actions: [{ type: 'create_notification', config: { destinataire: 'equipe_du_deal', par_courriel: 'true' } }],
};

/** Un faux client supabase-js qui note les filtres posés et rend les lignes données. */
function client(lignes: unknown[] | null, erreur: { message: string } | null = null) {
  const filtres: Array<[string, string, unknown]> = [];
  const chaine: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'neq', 'order', 'limit']) {
    chaine[m] = (a: string, b?: unknown) => { filtres.push([m, a, b]); return chaine; };
  }
  chaine.then = (ok: (v: unknown) => void) => Promise.resolve({ data: lignes, error: erreur }).then(ok);
  return { client: { from: (t: string) => { filtres.push(['from', t, undefined]); return chaine; } } as never, filtres };
}

describe('lecture des automatisations déjà publiées', () => {
  it('seulement celles du bureau, sur CE déclencheur, publiées, hors corbeille, et pas celle qu’on bâtit', async () => {
    const { client: c, filtres } = client([PREREGLAGE_PROD]);
    const r = await lireDejaPubliees(c, 'org-1', 'quote.viewed', '5b49c2ae-6809-4fff-a791-4152efb18dab', 'fr');
    expect(r).toEqual([{ nom: 'Me notifier quand un client ouvre sa soumission', actions: ['create_notification'] }]);
    expect(filtres).toContainEqual(['from', 'automation_rules', undefined]);
    expect(filtres).toContainEqual(['eq', 'org_id', 'org-1']);
    expect(filtres).toContainEqual(['eq', 'trigger_event', 'quote.viewed']);
    expect(filtres).toContainEqual(['eq', 'is_active', true]);
    expect(filtres).toContainEqual(['is', 'deleted_at', null]);
    expect(filtres).toContainEqual(['neq', 'id', '5b49c2ae-6809-4fff-a791-4152efb18dab']);
  });

  it('un préréglage semé en anglais est cité par le nom que l’écran affiche', async () => {
    const { client: c } = client([{ id: 'r2', name: 'Quote Follow-Up — 1 Day', steps: [], actions: [{ type: 'send_sms', config: {} }, { type: 'send_email', config: {} }] }]);
    const [r] = await lireDejaPubliees(c, 'org-1', 'quote.sent', null, 'fr');
    expect(r.nom).not.toBe('Quote Follow-Up — 1 Day');
    expect(r.nom).toMatch(/devis|soumission/i);
    expect(r.actions).toEqual(['send_sms', 'send_email']);
  });

  it('un parcours (`steps`) est lu par ses étapes ; la note technique `log_activity` et les doublons sont écartés', async () => {
    const { client: c } = client([{
      id: 'r3', name: 'Relance', actions: [{ type: 'send_sms', config: { body: 'À compléter' } }],
      steps: [
        { id: 'e1', type: 'attendre', delai_secondes: 86400, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'send_email', config: {} }, suivant: 'e3' },
        { id: 'e3', type: 'action', action: { type: 'log_activity', config: {} }, suivant: 'e4' },
        { id: 'e4', type: 'action', action: { type: 'send_email', config: {} }, suivant: null },
      ],
    }]);
    expect((await lireDejaPubliees(c, 'org-1', 'quote.sent', null, 'fr'))[0].actions).toEqual(['send_email']);
  });

  it('une lecture en échec ne fait jamais échouer la génération : rien à signaler', async () => {
    expect(await lireDejaPubliees(client(null, { message: 'panne' }).client, 'org-1', 'quote.viewed', null, 'fr')).toEqual([]);
  });
});

describe('la note sous la réponse de Lumi', () => {
  it('rien de publié sur ce déclencheur : aucune note', () => {
    expect(noteDejaPubliees([], 'quote.viewed', 'fr', ['create_notification'])).toBe('');
  });

  it('le cas de prod : le nom de l’automatisation, ce qu’elle fait, et quoi vérifier', () => {
    const note = noteDejaPubliees([{ nom: 'Me notifier quand un client ouvre sa soumission', actions: ['create_notification'] }], 'quote.viewed', 'fr', ['create_notification']);
    expect(note).toContain('À savoir : tu as déjà une automatisation publiée qui fait la même chose sur ce déclencheur («');
    expect(note).toContain('• « Me notifier quand un client ouvre sa soumission » — Notifier l’équipe');
    expect(note).toContain('Vérifie qu’elle ne fait pas double emploi avant de publier celle-ci.');
    // Le déclencheur est nommé comme à l'écran, jamais par sa clé technique.
    expect(note).not.toContain('quote.viewed');
  });

  it('plusieurs : le pluriel, une ligne chacune, et « … et d’autres » au-delà de cinq', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ nom: `Relance ${i + 1}`, actions: ['send_sms'] }));
    const note = noteDejaPubliees(six, 'quote.sent', 'fr', ['send_sms']);
    expect(note).toContain('tu as déjà des automatisations publiées qui font la même chose');
    expect(note).toContain('Vérifie qu’elles ne font pas double emploi');
    expect(note.match(/• « Relance \d »/g)).toHaveLength(5);
    expect(note).toContain('• … et d’autres.');
    expect(note).toContain('— Envoyer un texto');
  });

  it('en anglais', () => {
    const note = noteDejaPubliees([{ nom: 'Notify me', actions: ['create_notification'] }], 'quote.viewed', 'en', ['create_notification']);
    expect(note).toContain('Good to know: you already have a published automation that does the same thing on this trigger');
    expect(note).toContain('• « Notify me » — Notify the team');
  });

  it('un type d’action inconnu du catalogue n’affiche pas sa clé brute', () => {
    expect(noteDejaPubliees([{ nom: 'X', actions: ['action_inconnue'] }], 'quote.viewed', 'fr', ['action_inconnue'])).toContain('• « X »\n');
  });

  it('seules les automatisations qui font LA MÊME CHOSE sont citées — vu sur lumecrm.net : 5 relances par texto et courriel listées pour une simple notification', () => {
    const relances = [
      { nom: 'Suivi de devis — 1 jour', actions: ['send_sms', 'send_email'] },
      { nom: 'Suivi de devis — 7 jours', actions: ['send_email'] },
      { nom: 'Suivi de devis — 21 jours (final)', actions: ['send_email', 'create_notification'] },
    ];
    // Le nouveau parcours ne fait qu'une notification interne : une seule fait la même chose.
    const note = noteDejaPubliees(relances, 'quote.sent', 'fr', ['create_notification']);
    expect(note).toContain('• « Suivi de devis — 21 jours (final) »');
    expect(note).not.toContain('Suivi de devis — 1 jour');
    expect(note).not.toContain('Suivi de devis — 7 jours');
    // Aucune ne fait la même chose : aucune note, plutôt qu'une fausse alerte de doublon.
    expect(noteDejaPubliees(relances.slice(0, 2), 'quote.sent', 'fr', ['create_notification'])).toBe('');
  });
});

describe('branchement dans la route', () => {
  const route = readFileSync(resolve(__dirname, '..', 'server/routes/automation-rules.ts'), 'utf8');
  it('la note n’est ajoutée qu’au PREMIER tour d’une conversation (ensuite ce serait du bruit)', () => {
    expect(route).toMatch(/if \(!echanges\?\.length\) \{\s+const dejaLa = await lireDejaPubliees\(auth\.client, auth\.orgId, resultat\.parcours\.trigger_event, ruleIdEnvoye, langue\);\s+resultat\.parcours\.resume \+= noteDejaPubliees\(dejaLa, resultat\.parcours\.trigger_event, langue, typesDAction\(\{ steps: verdict\.data \}\)\);/);
  });
  it('elle est lue avec le client de l’UTILISATEUR (la RLS borne au bureau), jamais en service_role', () => {
    expect(route).not.toMatch(/lireDejaPubliees\(getServiceClient\(\)/);
  });
});
