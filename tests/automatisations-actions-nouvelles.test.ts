/**
 * LES ACTIONS AJOUTÉES LE 2026-09-24 — ce qu'elles écrivent vraiment.
 *
 * Le danger de ce lot n'est pas qu'une action plante : c'est qu'elle
 * RÉUSSISSE en écrivant au mauvais endroit. Une étiquette posée dans
 * `clients.tags` (la colonne morte) au lieu de `client_tags` (la table que
 * l'interface lit) donne une automatisation qui se dit satisfaite et un
 * écran qui ne change pas — le pire des résultats, parce que rien ne
 * signale l'erreur.
 *
 * Ces tests appellent donc les vrais exécuteurs avec un faux client
 * Supabase, et vérifient la TABLE, les COLONNES et les VALEURS envoyées.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  executeAjouterEtiquette,
  executeRetirerEtiquette,
  executeModifierClient,
  executeAssignerResponsable,
  executeAjouterNote,
  executeStatutRendezVous,
  executeWebhook,
  executeArreterAutomatisation,
  type ActionContext,
} from '../server/lib/actions/index';

/**
 * Un faux Supabase qui ENREGISTRE ce qu'on lui demande.
 *
 * Chaque appel laisse une trace dans `journal` : c'est elle qu'on inspecte.
 * `reponses` permet de décider ce que renvoie une lecture donnée (pour
 * simuler un membre qui existe, ou pas).
 */
function faireSupabase(reponses: Record<string, unknown> = {}) {
  const journal: Array<{ table: string; op: string; payload?: unknown; filtres: Array<[string, unknown]> }> = [];

  const faireRequete = (table: string, op: string, payload?: unknown) => {
    const entree = { table, op, payload, filtres: [] as Array<[string, unknown]> };
    journal.push(entree);
    const chaine: Record<string, unknown> = {};
    // Chaque filtre s'enregistre et rend la chaîne, comme PostgREST.
    for (const m of ['eq', 'is', 'in', 'gte', 'neq', 'limit']) {
      chaine[m] = (a: unknown, b?: unknown) => { entree.filtres.push([`${m}:${String(a)}`, b]); return chaine; };
    }
    chaine.select = () => {
      const cle = `${table}.${op}`;
      const data = cle in reponses ? reponses[cle] : [{ id: 'row-1' }];
      const p = Promise.resolve({ data, error: null });
      // `.select(...)` peut être suivi de filtres OU attendu directement.
      return Object.assign(chaine, p, { then: p.then.bind(p) });
    };
    chaine.maybeSingle = () => {
      const cle = `${table}.maybeSingle`;
      return Promise.resolve({ data: cle in reponses ? reponses[cle] : null, error: null });
    };
    chaine.then = (r: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: null, error: null }).then(r);
    return chaine;
  };

  return {
    journal,
    client: {
      from: (table: string) => ({
        insert: (payload: unknown) => faireRequete(table, 'insert', payload),
        upsert: (payload: unknown, opts?: unknown) => faireRequete(table, 'upsert', { payload, opts }),
        update: (payload: unknown) => faireRequete(table, 'update', payload),
        delete: () => faireRequete(table, 'delete'),
        select: (cols?: string) => faireRequete(table, 'select', cols),
      }),
    },
  };
}

function faireCtx(sb: ReturnType<typeof faireSupabase>, over: Partial<ActionContext> = {}): ActionContext {
  return {
    supabase: sb.client as never,
    orgId: 'org-1',
    entityType: 'client',
    entityId: 'client-1',
    twilio: null,
    baseUrl: 'https://exemple.test',
    ...over,
  };
}

describe('les étiquettes vont dans la table que l’interface lit', () => {
  it('ajoute dans `client_tags`, jamais dans la colonne morte `clients.tags`', async () => {
    const sb = faireSupabase();
    const r = await executeAjouterEtiquette({ etiquette: 'VIP' }, {}, faireCtx(sb));

    expect(r.success).toBe(true);
    const ecriture = sb.journal.find((e) => e.op === 'upsert');
    expect(ecriture?.table, 'l’étiquette doit aller dans client_tags').toBe('client_tags');
    // La preuve que ça ne part pas dans `clients` : aucune écriture sur cette table.
    expect(sb.journal.some((e) => e.table === 'clients' && e.op !== 'select')).toBe(false);
    expect((ecriture?.payload as { payload: Record<string, string> }).payload).toMatchObject({
      client_id: 'client-1', tag: 'VIP',
    });
  });

  it('résout le client À TRAVERS le job quand l’entité est un job', async () => {
    const sb = faireSupabase({ 'jobs.maybeSingle': { client_id: 'client-du-job' } });
    await executeAjouterEtiquette({ etiquette: 'Fait' }, {}, faireCtx(sb, { entityType: 'job', entityId: 'job-9' }));

    const ecriture = sb.journal.find((e) => e.op === 'upsert');
    expect((ecriture?.payload as { payload: Record<string, string> }).payload.client_id).toBe('client-du-job');
  });

  it('échoue proprement quand l’entité n’a pas de client', async () => {
    // `jobs.maybeSingle` renvoie null : job introuvable ou sans client.
    const sb = faireSupabase({ 'jobs.maybeSingle': null });
    const r = await executeAjouterEtiquette({ etiquette: 'X' }, {}, faireCtx(sb, { entityType: 'job', entityId: 'j' }));
    expect(r.success).toBe(false);
    expect(r.error).toContain('client');
  });

  it('« retirer toutes » ne filtre PAS sur une étiquette', async () => {
    const sb = faireSupabase();
    await executeRetirerEtiquette({ toutes: 'true' }, {}, faireCtx(sb));
    const suppr = sb.journal.find((e) => e.op === 'delete');
    const cles = suppr?.filtres.map(([k]) => k) ?? [];
    expect(cles).toContain('eq:client_id');
    expect(cles, 'avec « toutes », aucun filtre sur le tag').not.toContain('eq:tag');
  });
});

describe('modifier le client refuse ce que la base refuserait', () => {
  it('rejette un statut hors contrainte AVANT d’écrire', async () => {
    // `clients_status_check` n'admet que active/inactive/lead. Écrire autre
    // chose ferait échouer l'UPDATE ENTIER — la source serait perdue avec.
    const sb = faireSupabase();
    const r = await executeModifierClient({ statut: 'archived', source: 'Google' }, {}, faireCtx(sb));
    expect(r.success).toBe(false);
    expect(sb.journal.some((e) => e.op === 'update'), 'rien ne doit être écrit').toBe(false);
  });

  it('accepte les trois statuts réels', async () => {
    for (const statut of ['active', 'inactive', 'lead']) {
      const sb = faireSupabase();
      const r = await executeModifierClient({ statut }, {}, faireCtx(sb));
      expect(r.success, `« ${statut} » doit passer`).toBe(true);
    }
  });

  it('refuse un montant que `numeric(12,2)` ne tiendrait pas', async () => {
    const sb = faireSupabase();
    const r = await executeModifierClient({ valeur: '99999999999999' }, {}, faireCtx(sb));
    expect(r.success).toBe(false);
  });

  it('ne touche QUE les champs remplis', async () => {
    const sb = faireSupabase();
    await executeModifierClient({ source: 'Référence' }, {}, faireCtx(sb));
    const maj = sb.journal.find((e) => e.op === 'update');
    expect(Object.keys(maj?.payload as object)).toEqual(['source']);
  });
});

describe('assigner : jamais quelqu’un d’une autre organisation', () => {
  it('refuse un membre absent de l’org', async () => {
    const sb = faireSupabase({ 'memberships.maybeSingle': null });
    const r = await executeAssignerResponsable(
      { membre_id: '11111111-1111-1111-1111-111111111111' }, {}, faireCtx(sb),
    );
    expect(r.success).toBe(false);
    expect(sb.journal.some((e) => e.table === 'clients' && e.op === 'update')).toBe(false);
  });

  it('« seulement si vide » pose le filtre DANS la requête', async () => {
    // Un lire-puis-écrire laisserait passer deux automatisations simultanées.
    const sb = faireSupabase({ 'memberships.maybeSingle': { user_id: 'u1' } });
    await executeAssignerResponsable(
      { membre_id: '11111111-1111-1111-1111-111111111111', seulement_si_vide: 'true' },
      {}, faireCtx(sb),
    );
    const maj = sb.journal.find((e) => e.table === 'clients' && e.op === 'update');
    expect(maj?.filtres.map(([k]) => k)).toContain('is:assigned_to');
  });

  it('vide = retire le responsable, sans vérifier de membre', async () => {
    const sb = faireSupabase();
    const r = await executeAssignerResponsable({ membre_id: '' }, {}, faireCtx(sb));
    expect(r.success).toBe(true);
    expect((sb.journal.find((e) => e.op === 'update')?.payload as Record<string, unknown>).assigned_to).toBeNull();
  });
});

describe('la note respecte la contrainte de `notes.entity_type`', () => {
  it('rabat une entité non permise sur le client', async () => {
    // `notes_entity_type_check` n'admet pas « quote ». Écrire tel quel
    // violerait la contrainte : l'action échouerait en silence, réessayée
    // trois fois pour rien — le bug déjà corrigé sur `create_task`.
    const sb = faireSupabase({ 'quotes.maybeSingle': { client_id: 'c-9', lead_id: null } });
    const r = await executeAjouterNote({ body: 'Rappeler' }, {}, faireCtx(sb, { entityType: 'quote', entityId: 'q-1' }));

    expect(r.success).toBe(true);
    const ins = sb.journal.find((e) => e.op === 'insert');
    expect((ins?.payload as Record<string, unknown>).entity_type).toBe('client');
    expect((ins?.payload as Record<string, unknown>).entity_id).toBe('c-9');
  });

  it('garde le type quand il est permis', async () => {
    const sb = faireSupabase();
    await executeAjouterNote({ body: 'Note' }, {}, faireCtx(sb, { entityType: 'job', entityId: 'job-1' }));
    const ins = sb.journal.find((e) => e.op === 'insert');
    expect((ins?.payload as Record<string, unknown>).entity_type).toBe('job');
  });

  it('remplace les variables avant d’écrire', async () => {
    const sb = faireSupabase();
    await executeAjouterNote({ body: 'Client : [client_name]' }, { client_name: 'Rafba' }, faireCtx(sb));
    const ins = sb.journal.find((e) => e.op === 'insert');
    expect((ins?.payload as Record<string, unknown>).content).toBe('Client : Rafba');
  });
});

describe('le statut de rendez-vous ne vaut que pour un rendez-vous', () => {
  it('refuse sur une autre entité', async () => {
    const sb = faireSupabase();
    const r = await executeStatutRendezVous({ statut: 'completed' }, {}, faireCtx(sb, { entityType: 'invoice' }));
    expect(r.success).toBe(false);
    expect(sb.journal.some((e) => e.op === 'update')).toBe(false);
  });

  it('écrit dans `schedule_events`', async () => {
    const sb = faireSupabase();
    const r = await executeStatutRendezVous(
      { statut: 'cancelled' }, {}, faireCtx(sb, { entityType: 'schedule_event', entityId: 'ev-1' }),
    );
    expect(r.success).toBe(true);
    const maj = sb.journal.find((e) => e.op === 'update');
    expect(maj?.table).toBe('schedule_events');
    expect((maj?.payload as Record<string, unknown>).status).toBe('cancelled');
  });
});

describe('le webhook ne peut pas viser l’intérieur du serveur', () => {
  const interdits = [
    'http://exemple.com',                 // pas de TLS
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://169.254.169.254/latest/meta-data/', // métadonnées du nuage
    'https://truc.internal/x',
  ];

  for (const url of interdits) {
    it(`refuse ${url}`, async () => {
      const fetchEspion = vi.fn();
      vi.stubGlobal('fetch', fetchEspion);
      const r = await executeWebhook({ url }, {}, faireCtx(faireSupabase()));
      expect(r.success).toBe(false);
      expect(fetchEspion, 'aucun appel ne doit partir').not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  }

  it('accepte une adresse publique en https et envoie les variables', async () => {
    const fetchEspion = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchEspion);
    const r = await executeWebhook(
      { url: 'https://exemple.com/hook' },
      { client_name: 'Rafba' },
      faireCtx(faireSupabase()),
    );
    expect(r.success).toBe(true);
    const corps = JSON.parse(fetchEspion.mock.calls[0][1].body);
    expect(corps.data.client_name).toBe('Rafba');
    expect(corps.org_id).toBe('org-1');
    vi.unstubAllGlobals();
  });

  it('rapporte un échec quand le serveur distant refuse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const r = await executeWebhook({ url: 'https://exemple.com/hook' }, {}, faireCtx(faireSupabase()));
    expect(r.success).toBe(false);
    expect(r.error).toContain('500');
    vi.unstubAllGlobals();
  });
});

describe('arrêter une automatisation n’annule que ce qu’il faut', () => {
  it('par défaut, seulement la règle en cours', async () => {
    const sb = faireSupabase();
    await executeArreterAutomatisation({}, {}, faireCtx(sb, { ruleId: 'regle-1' }));
    const maj = sb.journal.find((e) => e.op === 'update');
    const cles = maj?.filtres.map(([k]) => k) ?? [];
    expect(cles).toContain('eq:automation_rule_id');
    // Et jamais les tâches déjà exécutées : on ne « décommande » pas un envoi.
    expect(cles).toContain('eq:status');
  });

  it('« toutes » ne filtre pas sur la règle', async () => {
    const sb = faireSupabase();
    await executeArreterAutomatisation({ portee: 'toutes' }, {}, faireCtx(sb, { ruleId: 'regle-1' }));
    const maj = sb.journal.find((e) => e.op === 'update');
    expect(maj?.filtres.map(([k]) => k)).not.toContain('eq:automation_rule_id');
  });

  it('ne touche que les tâches EN ATTENTE', async () => {
    const sb = faireSupabase();
    await executeArreterAutomatisation({}, {}, faireCtx(sb, { ruleId: 'r' }));
    const maj = sb.journal.find((e) => e.op === 'update');
    const statut = maj?.filtres.find(([k]) => k === 'eq:status');
    expect(statut?.[1], 'une tâche en cours doit finir, pas être marquée annulée').toBe('pending');
    expect((maj?.payload as Record<string, unknown>).status).toBe('cancelled');
  });
});
