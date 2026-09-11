/**
 * Fiches liées et aperçus de Lumi (server/lib/lumi/fiches.ts).
 *
 * Le modèle ne voit jamais un identifiant ; l'interface, oui : ces fonctions
 * extraient AVANT masquage les fiches touchées (liens vers la page exacte) et
 * composent l'aperçu d'une écriture proposée (document avec les taxes de l'org).
 */
import { describe, it, expect, vi } from 'vitest';

// Seules les taxes sont simulées ; le reste du module (handlers, outils) reste réel
// pour que la route Lumi, importée plus bas, se charge normalement.
vi.mock('../server/lib/agent/tools-etendus', async (importActual) => ({
  ...(await importActual<typeof import('../server/lib/agent/tools-etendus')>()),
  taxesParDefaut: async () => [
    { code: 'TPS', label: 'TPS', rate: 5, enabled: true },
    { code: 'TVQ', label: 'TVQ', rate: 9.975, enabled: true },
    { code: 'X', label: 'Inactive', rate: 50, enabled: false },
  ],
}));

const C1 = '11111111-1111-4111-8111-111111111111';
const Q1 = '22222222-2222-4222-8222-222222222222';
const J1 = '33333333-3333-4333-8333-333333333333';

function clientFactice(rangees: Record<string, any>) {
  // .from(table).select().eq().eq().maybeSingle() → rangees[table]
  const chaine = (table: string) => {
    const q: any = {};
    q.select = () => q; q.eq = () => q; q.maybeSingle = async () => ({ data: rangees[table] ?? null, error: null });
    return q;
  };
  return { from: chaine } as any;
}
const ctx = (rangees: Record<string, any> = {}) => ({ client: clientFactice(rangees), orgId: 'org', userId: 'u' });

describe('fichesDuResultat', () => {
  it('clients, devis, jobs : une fiche par ligne avec le lien de la page exacte, sans doublon, 6 max', async () => {
    const { fichesDuResultat } = await import('../server/lib/lumi/fiches');
    const clients = fichesDuResultat('search_clients', {}, { total_matching: 2, clients: [{ id: C1, name: 'Marie Tremblay' }, { id: C1, name: 'Marie Tremblay' }, { id: 'pas-un-uuid', name: 'X' }] });
    expect(clients).toEqual([{ type: 'client', id: C1, label: 'Marie Tremblay', href: `/clients/${C1}` }]);

    const devis = fichesDuResultat('list_quotes', {}, { quotes: [{ id: Q1, quote_number: 'Q-0043', title: 'Vitres', total_cents: 49439 }] });
    expect(devis[0]).toMatchObject({ type: 'quote', label: 'Q-0043 · Vitres', href: `/quotes/${Q1}`, montant_cents: 49439 });

    const jobs = fichesDuResultat('list_jobs', {}, { jobs: Array.from({ length: 10 }, (_, i) => ({ id: `4444444${i}-4444-4444-8444-444444444444`, job_number: 100 + i, title: 'T' })) });
    expect(jobs).toHaveLength(6);
    expect(jobs[0].label).toBe('Job #100 · T');
  });

  it('la fiche client vient des ARGUMENTS pour un profil (le résultat n a pas l id)', async () => {
    const { fichesDuResultat } = await import('../server/lib/lumi/fiches');
    const f = fichesDuResultat('get_client_profile', { client_id: C1 }, { client: { name: 'Sophie Bouchard' } });
    expect(f).toEqual([{ type: 'client', id: C1, label: 'Sophie Bouchard', href: `/clients/${C1}` }]);
  });

  it('une erreur d outil ou un outil inconnu ne donnent aucune fiche', async () => {
    const { fichesDuResultat } = await import('../server/lib/lumi/fiches');
    expect(fichesDuResultat('search_clients', {}, { error: 'db' })).toEqual([]);
    expect(fichesDuResultat('get_company_info', {}, { name: 'X' })).toEqual([]);
  });
});

describe('apercuProposition', () => {
  it('devis : lignes, sous-total, taxes ACTIVES de l org, total, client', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const a: any = await apercuProposition('create_quote', {
      client_id: C1, title: 'Vitres', valid_days: 30,
      line_items: [{ name: 'Lavage de vitres', quantity: 1, unit_price_cents: 25000 }, { name: 'Gouttières', quantity: 2, unit_price_cents: 9000 }],
    }, ctx({ clients: { first_name: 'Marie', last_name: 'Tremblay', company: 'Résidences Tremblay', email: 'm@x.ca', phone: '514', address: '1250 rue X', city: 'Longueuil' } }));
    expect(a.genre).toBe('quote');
    expect(a.client).toMatchObject({ name: 'Marie Tremblay', company: 'Résidences Tremblay', address: '1250 rue X, Longueuil' });
    expect(a.lignes[1]).toMatchObject({ quantity: 2, total_cents: 18000 });
    expect(a.subtotal_cents).toBe(43000);
    expect(a.taxes).toEqual([{ label: 'TPS', rate: 5, amount_cents: 2150 }, { label: 'TVQ', rate: 9.975, amount_cents: 4289 }]);
    expect(a.total_cents).toBe(49439);
    expect(a.valid_days).toBe(30);
  });

  it('no_taxes → aucune taxe ; texto → destinataire et message', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const a: any = await apercuProposition('create_invoice', { client_id: C1, no_taxes: true, items: [{ name: 'X', qty: 1, unit_price_cents: 100 }] }, ctx());
    expect(a.taxes).toEqual([]);
    expect(a.total_cents).toBe(100);
    const s: any = await apercuProposition('send_sms', { client_name: 'Marie', phone_number: '514', message: 'Bonjour' }, ctx());
    expect(s).toEqual({ genre: 'sms', to: 'Marie', subject: null, body: 'Bonjour' });
  });

  it('envoi d une soumission existante : numéro, montant et destinataire lus en base', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const a: any = await apercuProposition('send_quote', { quote_id: Q1 }, ctx({
      quotes: { quote_number: 'Q-0043', total_cents: 49439, client_id: C1, title: 'Vitres' },
      clients: { first_name: 'Marie', last_name: 'Tremblay', email: 'marie@x.ca' },
    }));
    expect(a).toMatchObject({ genre: 'email', to: 'Marie Tremblay <marie@x.ca>', subject: 'Soumission Q-0043 · 494,39 $' });
  });

  it('un outil sans aperçu → null (la carte retombe sur la liste des champs)', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    expect(await apercuProposition('create_task', { title: 'Rappeler' }, ctx())).toBeNull();
  });
});

describe('ficheCreee', () => {
  it('devis créé → « Devis Q-0043 » avec son lien et son total', async () => {
    const { ficheCreee } = await import('../server/lib/lumi/fiches');
    const f = await ficheCreee('create_quote', {}, { created: true, quote_id: Q1 }, ctx({ quotes: { id: Q1, quote_number: 'Q-0043', total_cents: 49439 } }));
    expect(f).toEqual({ type: 'quote', id: Q1, label: 'Devis Q-0043', href: `/quotes/${Q1}`, montant_cents: 49439 });
  });

  it('job et tâche créés ; résultat sans id → null', async () => {
    const { ficheCreee } = await import('../server/lib/lumi/fiches');
    const j = await ficheCreee('create_job', {}, { job_id: J1 }, ctx({ jobs: { id: J1, job_number: 118, title: 'Gouttières' } }));
    expect(j).toMatchObject({ type: 'job', label: 'Job #118 · Gouttières', href: `/jobs/${J1}` });
    const t = await ficheCreee('create_task', { title: 'Rappeler Sophie' }, { created: true, task: { id: C1, title: 'Rappeler Sophie' } }, ctx());
    expect(t).toMatchObject({ type: 'task', label: 'Rappeler Sophie', href: '/tasks' });
    expect(await ficheCreee('create_quote', {}, { created: true }, ctx())).toBeNull();
  });
});

describe('rendreMessages : le reçu survit à la relecture', () => {
  it('une écriture exécutée avec sa fiche redonne le lien « Ouvrir »', async () => {
    const { rendreMessages } = await import('../server/routes/lumi');
    const fiche = { type: 'quote', id: Q1, label: 'Devis Q-0043', href: `/quotes/${Q1}` };
    const msgs: any[] = [
      { role: 'user', content: 'Prépare un devis' },
      { role: 'assistant', content: [{ type: 'text', text: 'Voici.' }, { type: 'tool_use', id: 'tu1', name: 'create_quote', input: { title: 'Vitres' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: JSON.stringify({ executed: true, result: { quote_id: Q1 }, fiche }) }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Créé.' }] },
    ];
    const r = rendreMessages(msgs);
    const carte = r.find((m) => m.proposal)!;
    expect(carte.proposal?.statut).toBe('confirmee');
    expect(carte.proposal?.fiche).toEqual(fiche);
  });
});
