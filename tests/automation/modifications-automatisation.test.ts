/**
 * L'HISTORIQUE DES MODIFICATIONS d'une automatisation : qui a changé quoi, et quand.
 *
 * Mission du 2026-10-01, point 5 ; constat D-20 : la seule trace d'une modification était
 * `automation_rules.updated_at` — une date, sans auteur ni contenu.
 *
 * `server/lib/automations-modifications.ts` compare l'avant et l'après, écrit une ligne (rôle de
 * service) avec un résumé lisible en français et en anglais, et ne garde que les champs changés.
 * Unitaire : aucune base, aucun réseau. La table, sa RLS et l'écran sont prouvés sur la pile
 * locale (tests/automations-finale/d/ui/50-historique-modifications.preuve.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/lib/supabase', () => ({ getServiceClient: () => { throw new Error('pas de client de service dans ce test'); } }));

const { decrireModification, journaliserModification, lireModifications, CHAMPS_SUIVIS } = await import('../../server/lib/automations-modifications');

const texto = (body: string) => ({ type: 'send_sms', config: { body, type_envoi: 'transactionnel' } });
const REGLE = {
  name: 'Relance de devis', trigger_event: 'quote.sent', conditions: {}, delay_seconds: 3 * 86_400,
  actions: [texto('Bonjour, avez-vous vu notre devis ?')], steps: null, settings: {}, is_active: false, folder_id: null, deleted_at: null,
};
const PARCOURS = [
  { id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: 'Votre devis', body: 'Bonjour.' } }, suivant: 'e2' },
  { id: 'e2', type: 'attendre', delai_secondes: 3 * 86_400, suivant: 'e3' },
  { id: 'e3', type: 'action', action: texto('Des questions ?'), suivant: null },
];

describe('decrireModification — ce qui a changé, en clair', () => {
  it('rien n’a changé : rien à écrire', () => {
    expect(decrireModification(REGLE, { ...REGLE })).toBeNull();
    // Vide = pareil : `{}`, `[]`, `null` et « absent » ne font pas une modification.
    expect(decrireModification({ ...REGLE, conditions: {} }, { ...REGLE, conditions: null })).toBeNull();
    // Des champs qu'on ne suit pas (date de mise à jour, conversation avec Lumi).
    expect(decrireModification({ ...REGLE, updated_at: 'a' }, { ...REGLE, updated_at: 'b', lumi_conversation: [1] })).toBeNull();
  });

  it('le texte d’un texto : « a changé le texte du texto de l’action » — avec l’ancien et le nouveau', () => {
    const d = decrireModification(REGLE, { ...REGLE, actions: [texto('Bonjour, une question sur le devis ?')] });
    expect(d).toMatchObject({
      action: 'modification', champs: ['actions'],
      resume_fr: 'a changé le texte du texto de l’action',
      resume_en: 'changed the text message of the action',
    });
    expect(JSON.stringify(d?.avant)).toContain('avez-vous vu notre devis');
    expect(JSON.stringify(d?.apres)).toContain('une question sur le devis');
    // Seuls les champs changés sont gardés.
    expect(Object.keys(d?.avant ?? {})).toEqual(['actions']);
  });

  it('publier, dépublier : l’action est nommée', () => {
    expect(decrireModification(REGLE, { ...REGLE, is_active: true })).toMatchObject({ action: 'publication', resume_fr: 'a publié', resume_en: 'published' });
    expect(decrireModification({ ...REGLE, is_active: true }, REGLE)).toMatchObject({ action: 'depublication', resume_fr: 'a remis en brouillon' });
  });

  it('le délai : « de 3 jours à 5 jours »', () => {
    expect(decrireModification(REGLE, { ...REGLE, delay_seconds: 5 * 86_400 })).toMatchObject({
      champs: ['delay_seconds'],
      resume_fr: 'a changé le délai de 3 jours à 5 jours',
      resume_en: 'changed the delay from 3 days to 5 days',
    });
    expect(decrireModification({ ...REGLE, delay_seconds: 0 }, { ...REGLE, delay_seconds: 3_600 })?.resume_fr).toBe('a changé le délai de 0 minute à 1 heure');
  });

  it('renommer, changer de déclencheur', () => {
    expect(decrireModification(REGLE, { ...REGLE, name: 'Relance devis J+3' })?.resume_fr).toBe('a renommé « Relance de devis » en « Relance devis J+3 »');
    const d = decrireModification(REGLE, { ...REGLE, trigger_event: 'invoice.overdue' });
    expect(d?.resume_fr).toMatch(/^a changé le déclencheur \(.+ → .+\)$/);
    expect(d?.resume_fr).not.toContain('quote.sent');
  });

  it('un parcours : le texte de l’étape 3, le délai de l’étape 2, une étape ajoutée, une étape retirée', () => {
    const avant = { ...REGLE, steps: PARCOURS };
    const texte = PARCOURS.map((e) => (e.id === 'e3' ? { ...e, action: texto('Avez-vous des questions ?') } : e));
    expect(decrireModification(avant, { ...avant, steps: texte })?.resume_fr).toBe('a changé le texte du texto de l’étape 3');

    const delai = PARCOURS.map((e) => (e.id === 'e2' ? { ...e, delai_secondes: 5 * 86_400 } : e));
    expect(decrireModification(avant, { ...avant, steps: delai })).toMatchObject({
      resume_fr: 'a changé le délai de l’étape 2 de 3 jours à 5 jours',
      resume_en: 'changed the delay of step 2 from 3 days to 5 days',
    });

    const objet = PARCOURS.map((e) => (e.id === 'e1' ? { ...e, action: { type: 'send_email', config: { subject: 'Votre devis est prêt', body: 'Bonjour.' } } } : e));
    expect(decrireModification(avant, { ...avant, steps: objet })?.resume_fr).toBe('a changé l’objet du courriel de l’étape 1');

    const ajout = [...PARCOURS.slice(0, 2), { ...PARCOURS[2], suivant: 'e4' }, { id: 'e4', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler' } }, suivant: null }];
    expect(decrireModification(avant, { ...avant, steps: ajout })?.resume_fr).toBe('a ajouté l’étape 4 (tâche)');

    const retrait = [{ ...PARCOURS[0], suivant: null }];
    expect(decrireModification(avant, { ...avant, steps: retrait })?.resume_fr).toBe('a retiré l’étape 2 (attente) ; a retiré l’étape 3 (texto)');
  });

  it('un parcours garde une copie de ses actions : le changement n’est dit qu’une fois', () => {
    const avant = { ...REGLE, steps: PARCOURS, actions: [texto('Des questions ?')] };
    const apres = { ...avant, steps: PARCOURS.map((e) => (e.id === 'e3' ? { ...e, action: texto('Autre texte') } : e)), actions: [texto('Autre texte')] };
    const d = decrireModification(avant, apres);
    expect(d?.champs).toEqual(['actions', 'steps']);
    expect(d?.resume_fr).toBe('a changé le texte du texto de l’étape 3');
  });

  it('plusieurs changements : cinq phrases au plus, puis « et N autres »', () => {
    const d = decrireModification(REGLE, {
      ...REGLE, name: 'Autre', is_active: true, trigger_event: 'invoice.overdue', conditions: { source: { eq: 'site_web' } },
      delay_seconds: 0, settings: { reentree: true }, folder_id: 'f1',
    });
    expect(d?.action).toBe('modification');
    expect(d?.resume_fr.split(' ; ')).toHaveLength(6);
    expect(d?.resume_fr).toMatch(/ ; et 2 autres changements$/);
    expect(d?.resume_en).toMatch(/; and 2 more changes$/);
  });

  it('création, duplication, corbeille, restauration', () => {
    expect(decrireModification(null, REGLE)).toMatchObject({ action: 'creation', resume_fr: 'a créé l’automatisation « Relance de devis »', avant: null });
    expect(decrireModification(null, REGLE, 'duplication')?.action).toBe('duplication');
    expect(decrireModification(REGLE, { ...REGLE, deleted_at: '2026-10-01T12:00:00Z' })).toMatchObject({ action: 'corbeille', resume_fr: 'a mis l’automatisation à la corbeille' });
    expect(decrireModification({ ...REGLE, deleted_at: '2026-10-01T12:00:00Z' }, REGLE)).toMatchObject({ action: 'restauration', resume_en: 'restored the automation' });
  });

  it('un PATCH partiel ne « retire » rien : seuls les champs présents des deux côtés se comparent', () => {
    const d = decrireModification(REGLE, { name: 'Nouveau nom' });
    expect(d?.champs).toEqual(['name']);
    expect(decrireModification({ name: 'A' }, REGLE)).toMatchObject({ champs: ['name'] });
  });

  it('les champs suivis sont ceux qui décident de ce qui part chez le client', () => {
    expect([...CHAMPS_SUIVIS]).toEqual(['name', 'trigger_event', 'conditions', 'delay_seconds', 'actions', 'steps', 'settings', 'is_active', 'folder_id', 'deleted_at']);
  });
});

describe('journaliserModification — écrire sans jamais faire échouer l’enregistrement', () => {
  let insertions: Array<Record<string, unknown>>;
  let erreurInsertion: { message: string } | null;
  const service = () => ({
    from: (table: string) => {
      if (table === 'profiles') {
        const c: Record<string, unknown> = {};
        c.select = () => c; c.eq = () => c;
        c.maybeSingle = async () => ({ data: { full_name: ' Marie Tremblay ' }, error: null });
        return c;
      }
      return {
        insert: (ligne: Record<string, unknown>) => {
          insertions.push({ table, ...ligne });
          return { select: () => ({ maybeSingle: async () => (erreurInsertion ? { data: null, error: erreurInsertion } : { data: { id: 'm1', ...ligne }, error: null }) }) };
        },
      };
    },
  });
  const P = { orgId: 'org-1', ruleId: 'regle-1', auteurId: 'user-1', origine: 'utilisateur' as const };

  beforeEach(() => {
    insertions = [];
    erreurInsertion = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('écrit une ligne : bureau, règle, auteur (et son nom), origine, action, champs, résumés, avant / après', async () => {
    const ligne = await journaliserModification({ ...P, avant: REGLE, apres: { ...REGLE, actions: [texto('Nouveau texte')] } }, service() as never);
    expect(insertions).toHaveLength(1);
    expect(insertions[0]).toMatchObject({
      table: 'automation_rule_modifications', org_id: 'org-1', rule_id: 'regle-1', auteur_id: 'user-1', auteur_nom: 'Marie Tremblay',
      origine: 'utilisateur', action: 'modification', champs: ['actions'], resume_fr: 'a changé le texte du texto de l’action',
    });
    expect(ligne?.id).toBe('m1');
  });

  it('Lumi : l’origine est notée, l’auteur reste la personne qui a demandé', async () => {
    await journaliserModification({ ...P, origine: 'lumi', avant: REGLE, apres: { ...REGLE, is_active: true } }, service() as never);
    expect(insertions[0]).toMatchObject({ origine: 'lumi', auteur_id: 'user-1', action: 'publication' });
  });

  it('le système : pas d’auteur', async () => {
    await journaliserModification({ ...P, auteurId: null, origine: 'systeme', avant: REGLE, apres: { ...REGLE, is_active: true } }, service() as never);
    expect(insertions[0]).toMatchObject({ origine: 'systeme', auteur_id: null, auteur_nom: null });
  });

  it('rien n’a changé : aucune écriture', async () => {
    expect(await journaliserModification({ ...P, avant: REGLE, apres: { ...REGLE } }, service() as never)).toBeNull();
    expect(insertions).toHaveLength(0);
  });

  it('une écriture refusée ne lève pas : l’enregistrement de l’automatisation ne doit pas en dépendre', async () => {
    erreurInsertion = { message: 'relation does not exist' };
    await expect(journaliserModification({ ...P, avant: REGLE, apres: { ...REGLE, is_active: true } }, service() as never)).resolves.toBeNull();
    const explose = { from: () => { throw new Error('réseau coupé'); } };
    await expect(journaliserModification({ ...P, avant: REGLE, apres: { ...REGLE, is_active: true } }, explose as never)).resolves.toBeNull();
  });
});

describe('lireModifications — avec le client de l’utilisateur, page par page', () => {
  it('filtre par bureau et par automatisation, la plus récente d’abord, avec le total', async () => {
    const appels: string[] = [];
    const c: Record<string, unknown> = {};
    c.select = (_cols: string, o: unknown) => { appels.push(`select:${JSON.stringify(o)}`); return c; };
    c.eq = (col: string, v: string) => { appels.push(`eq:${col}=${v}`); return c; };
    c.order = (col: string, o: { ascending: boolean }) => { appels.push(`order:${col}:${o.ascending}`); return c; };
    c.range = (de: number, a: number) => { appels.push(`range:${de}-${a}`); return Promise.resolve({ data: [{ id: 'm1' }], error: null, count: 41 }); };
    const client = { from: (t: string) => { appels.push(`from:${t}`); return c; } };
    const page = await lireModifications(client as never, 'org-1', 'regle-1', { page: 2 });
    expect(page).toMatchObject({ total: 41, page: 2, par_page: 25, lignes: [{ id: 'm1' }] });
    expect(appels).toEqual(['from:automation_rule_modifications', 'select:{"count":"exact"}', 'eq:org_id=org-1', 'eq:rule_id=regle-1', 'order:created_at:false', 'range:25-49']);
  });

  it('une lecture refusée lève : l’écran affiche une panne, pas une liste vide', async () => {
    const c: Record<string, unknown> = {};
    c.select = () => c; c.eq = () => c; c.order = () => c;
    c.range = () => Promise.resolve({ data: null, error: { message: 'permission denied' }, count: null });
    await expect(lireModifications({ from: () => c } as never, 'o', 'r')).rejects.toThrow('permission denied');
  });
});
