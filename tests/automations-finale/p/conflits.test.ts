/**
 * Agent P — doublons : l'avertissement à la publication (server/lib/automations-conflits.ts).
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/conflits.test.ts
 *
 * Les quatre conditions de la conception, une par une, puis la phrase qui nomme
 * l'automatisation en conflit. Jamais bloquant : une lecture ratée ne rend rien.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  reglesEnConflit, conflitsDePublication, memeOccurrence, phraseConflit, avertissementsDeConflit, lignesDeConflit,
  type RegleComparee,
} from '../../../server/lib/automations-conflits';
import { CLES_DE_CIBLAGE } from '../../../server/lib/automationEngine';
import { ENTITE_PAR_DECLENCHEUR } from '../../../src/lib/automationCatalogue';
import { logger } from '../../../server/lib/logger';
import { FausseBase, uuid } from './fausse-base';

const ORG = uuid(1, 9);
const CORPS = 'Bonjour [client_first_name], merci de votre demande. On vous rappelle très vite.';
const texto = (body = CORPS) => ({ type: 'send_sms', config: { body } });
const courriel = (subject = 'Merci', body = `<p>${CORPS}</p>`) => ({ type: 'send_email', config: { subject, body } });
const regle = (id: number, p: Partial<RegleComparee> = {}): RegleComparee => ({
  id: uuid(id, 5), name: `Automatisation ${id}`, trigger_event: 'note.added', conditions: {}, steps: [], actions: [texto()], ...p,
});
const noms = (r: RegleComparee, autres: RegleComparee[]) => reglesEnConflit(r, autres).map((c) => c.nom);

afterEach(() => { vi.restoreAllMocks(); });

describe('P — conflits : les quatre conditions', () => {
  it('[mécanisme de E-28] une copie d’une automatisation publiée (même déclencheur, même canal, mêmes clients) est en conflit — et nommée', () => {
    const a = regle(1, { name: 'Bienvenue A' });
    const c = reglesEnConflit(regle(2, { name: 'Bienvenue B' }), [a]);
    expect(c).toEqual([{ regle_id: uuid(1, 5), nom: 'Bienvenue A', canaux: ['sms'], meme_message: true }]);
  });

  it('1. déclencheur différent : pas de conflit', () => {
    expect(noms(regle(2), [regle(1, { trigger_event: 'lead.created' })])).toEqual([]);
  });

  it('2. occurrence différente : « 3 jours de retard » et « 15 jours de retard » ne se marchent pas dessus ; absente d’un côté = conflit', () => {
    const retard = (id: number, jours?: unknown) => regle(id, { trigger_event: 'invoice.overdue', conditions: jours === undefined ? {} : { days_overdue: jours } });
    expect(noms(retard(2, 3), [retard(1, 15)])).toEqual([]);
    expect(noms(retard(2, 3), [retard(1, 3)])).toEqual(['Automatisation 1']);
    expect(noms(retard(2, 3), [retard(1, { eq: 3 })])).toEqual(['Automatisation 1']);
    expect(noms(retard(2, 3), [retard(1)])).toEqual(['Automatisation 1']);
    expect(memeOccurrence('client.tagged', { tag: 'VIP' }, { tag: 'vip ' })).toBe(true);
    expect(memeOccurrence('client.tagged', { tag: 'VIP' }, { tag: 'Commercial' })).toBe(false);
    expect(memeOccurrence('deal.stage_entered', { stage_id: 'a', pipeline_id: 'p' }, { stage_id: 'b', pipeline_id: 'p' })).toBe(false);
    // Un filtre qui n'est PAS une clé d'occurrence ne prouve rien.
    expect(memeOccurrence('quote.sent', { montant__gte: 500 }, { montant__gte: 5000 })).toBe(true);
  });

  it('3. aucun canal client en commun : pas de conflit ; une demande d’avis compte pour les deux canaux', () => {
    expect(noms(regle(2, { actions: [courriel()] }), [regle(1)])).toEqual([]);
    expect(noms(regle(2, { actions: [{ type: 'create_task', config: { title: 'Rappeler' } }] }), [regle(1)])).toEqual([]);
    expect(reglesEnConflit(regle(2, { actions: [{ type: 'request_review', config: {} }] }), [regle(1, { actions: [courriel()] })]))
      .toEqual([{ regle_id: uuid(1, 5), nom: 'Automatisation 1', canaux: ['email'], meme_message: false }]);
    expect(reglesEnConflit(regle(2, { actions: [texto(), courriel()] }), [regle(1, { actions: [texto('Autre chose, sans rapport avec le reste.'), courriel('Autre', '<p>Un tout autre courriel.</p>')] })])[0])
      .toMatchObject({ canaux: ['sms', 'email'], meme_message: false });
  });

  it('[mécanisme de E-29] 4. ciblages disjoints (l’un exige VIP, l’autre exclut VIP) : pas de conflit — anciennes clés comme nouveau format', () => {
    const offreVip = regle(1, { name: 'Offre VIP', conditions: { client_a_etiquette: 'VIP' } });
    expect(noms(regle(2, { conditions: { client_sans_etiquette: 'VIP' } }), [offreVip])).toEqual([]);
    expect(noms(regle(2, { conditions: { ciblage: { exclure: [{ type: 'etiquette', valeur: 'vip' }] } } }), [offreVip])).toEqual([]);
    expect(noms(regle(2, { conditions: { client_sans_etiquette: 'Ne pas relancer' } }), [offreVip])).toEqual(['Offre VIP']);
    expect(noms(regle(2), [offreVip])).toEqual(['Offre VIP']);
  });

  it('le parcours (`steps`) est lu, pas la copie `actions` ; une automatisation neuve (« À compléter ») n’est en conflit avec rien', () => {
    const parcours = regle(2, { steps: [{ id: 'e1', type: 'attendre', delai_secondes: 3600, suivant: 'e2' }, { id: 'e2', type: 'action', action: courriel() }], actions: [texto()] });
    expect(noms(parcours, [regle(1)])).toEqual([]);
    expect(noms(parcours, [regle(1, { actions: [courriel()] })])).toEqual(['Automatisation 1']);
    expect(noms(regle(2, { actions: [texto('À compléter')] }), [regle(1)])).toEqual([]);
  });

  it('elle-même n’est jamais citée ; le cas grave (même message) passe en premier', () => {
    const moi = regle(2);
    const c = reglesEnConflit(moi, [moi, regle(3, { actions: [texto('Votre facture est prête, vous pouvez la régler en ligne.')] }), regle(1)]);
    expect(c.map((x) => [x.nom, x.meme_message])).toEqual([['Automatisation 1', true], ['Automatisation 3', false]]);
  });

  it('un préréglage semé en anglais est nommé comme l’écran le nomme', () => {
    const c = reglesEnConflit(regle(2, { trigger_event: 'invoice.sent' }), [regle(1, { trigger_event: 'invoice.sent', name: 'Invoice Reminder — 7 Days' })]);
    expect(c[0].nom).not.toBe('Invoice Reminder — 7 Days');
    expect(c[0].nom).toMatch(/facture/i);
  });

  it('les clés d’occurrence du moteur ne portent que sur des déclencheurs connus du catalogue (ou de l’ancien moteur)', () => {
    for (const d of Object.keys(CLES_DE_CIBLAGE)) {
      expect(d in ENTITE_PAR_DECLENCHEUR || d === 'deal.stage_exited', d).toBe(true);
    }
  });
});

describe('P — conflits : la lecture du bureau', () => {
  const base = () => new FausseBase({ automation_rules: [
    { ...regle(1, { name: 'Bienvenue A' }), org_id: ORG, is_active: true, deleted_at: null, created_at: '2026-09-01' },
    { ...regle(3, { name: 'Brouillon' }), org_id: ORG, is_active: false, deleted_at: null, created_at: '2026-09-02' },
    { ...regle(4, { name: 'À la corbeille' }), org_id: ORG, is_active: true, deleted_at: '2026-09-20', created_at: '2026-09-03' },
    { ...regle(5, { name: 'Autre bureau' }), org_id: uuid(2, 9), is_active: true, deleted_at: null, created_at: '2026-09-04' },
    { ...regle(6, { name: 'Autre déclencheur', trigger_event: 'lead.created' }), org_id: ORG, is_active: true, deleted_at: null, created_at: '2026-09-05' },
  ] });

  it('seules les automatisations PUBLIÉES, vivantes, du MÊME bureau sont comparées', async () => {
    const b = base();
    expect((await conflitsDePublication(b.client, ORG, regle(2))).map((c) => c.nom)).toEqual(['Bienvenue A']);
    // Une règle pas encore enregistrée (aucun id) se compare aussi.
    expect((await conflitsDePublication(b.client, ORG, { ...regle(2), id: null })).map((c) => c.nom)).toEqual(['Bienvenue A']);
    // Publier A elle-même : rien à signaler.
    expect(await conflitsDePublication(b.client, ORG, regle(1))).toEqual([]);
  });

  it('une règle qui n’écrit pas au client ne lit même pas la base', async () => {
    const b = base();
    expect(await conflitsDePublication(b.client, ORG, regle(2, { actions: [{ type: 'create_task', config: { title: 'x' } }] }))).toEqual([]);
    expect(b.totalLectures()).toBe(0);
  });

  it('JAMAIS bloquant : une lecture ratée ne rend aucun conflit, et laisse une trace', async () => {
    const trace = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const b = base();
    b.pannes.automation_rules = { message: 'délai dépassé' };
    expect(await conflitsDePublication(b.client, ORG, regle(2))).toEqual([]);
    expect(trace).toHaveBeenCalledTimes(1);
    const casse = { from: () => { throw new Error('fetch failed'); } } as never;
    expect(await conflitsDePublication(casse, ORG, regle(2))).toEqual([]);
    expect(trace).toHaveBeenCalledTimes(2);
  });
});

describe('P — conflits : la phrase d’avertissement', () => {
  const conflit = { regle_id: uuid(1, 5), nom: 'Relance de facture — 3, 7, 14 et 30 jours', canaux: ['sms' as const], meme_message: false };

  it('elle nomme l’automatisation en conflit et dit ce qui va se passer — dans les deux langues', () => {
    expect(phraseConflit(conflit)).toBe('« Relance de facture — 3, 7, 14 et 30 jours » envoie déjà un texto aux mêmes clients sur ce déclencheur. Les deux partiront : un message identique ne sera envoyé qu’une fois.');
    expect(phraseConflit({ ...conflit, canaux: ['sms', 'email'] }, false)).toBe('“Relance de facture — 3, 7, 14 et 30 jours” already sends a text and an email to the same clients on this trigger. Both will go out: an identical message is only sent once.');
    expect(phraseConflit({ ...conflit, canaux: ['email'], meme_message: true })).toMatch(/envoie déjà presque le même message \(un courriel\).*Un seul des deux partira/);
  });

  it('la réponse de la publication porte le nom ET l’identifiant de chaque automatisation en conflit', () => {
    const r = avertissementsDeConflit([conflit]);
    expect(r).toEqual([{ ...conflit, message: phraseConflit(conflit) }]);
    expect(JSON.stringify(r)).toContain('Relance de facture — 3, 7, 14 et 30 jours');
  });

  it('au-delà de trois, la liste se résume en une ligne', () => {
    const cinq = [1, 2, 3, 4, 5].map((n) => ({ ...conflit, regle_id: uuid(n, 5), nom: `Relance ${n}` }));
    const lignes = lignesDeConflit(cinq);
    expect(lignes).toHaveLength(4);
    expect(lignes[3]).toBe('… et 2 autres automatisations publiées sur ce déclencheur.');
    expect(lignesDeConflit(cinq.slice(0, 4), false)[3]).toBe('… and 1 more published automation on this trigger.');
    expect(lignesDeConflit([])).toEqual([]);
  });
});
