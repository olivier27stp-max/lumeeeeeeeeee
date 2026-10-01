/**
 * Fiches liées et aperçus de Lumi (server/lib/lumi/fiches.ts).
 *
 * Le modèle ne voit jamais un identifiant ; l'interface, oui : ces fonctions
 * extraient AVANT masquage les fiches touchées (liens vers la page exacte) et
 * composent l'aperçu d'une écriture proposée (document avec les taxes de l'org).
 */
import { describe, it, expect, vi } from 'vitest';

// Seule la résolution des taxes du client est simulée (groupe TPS + TVQ) ; le
// calcul (taxesPourDocument → computeTaxLines) et le reste du module sont réels.
vi.mock('../server/lib/taxResolve', async (importActual) => ({
  ...(await importActual<typeof import('../server/lib/taxResolve')>()),
  resolveTaxesForOrg: async () => ({
    taxes: [
      { id: 't1', name: 'TPS', rate: 5, is_active: true },
      { id: 't2', name: 'TVQ', rate: 9.975, is_active: true },
      { id: 't3', name: 'TPS', rate: 5, is_active: true }, // doublon de tax_configs : compté une fois
    ],
    group: null, region: 'QC',
  }),
}));

const C1 = '11111111-1111-4111-8111-111111111111';
const Q1 = '22222222-2222-4222-8222-222222222222';
const J1 = '33333333-3333-4333-8333-333333333333';

function clientFactice(rangees: Record<string, any>) {
  // .from(table).select().eq().eq().maybeSingle() → rangees[table]
  const chaine = (table: string) => {
    const q: any = {};
    q.select = () => q; q.eq = () => q; q.is = () => q; q.maybeSingle = async () => ({ data: rangees[table] ?? null, error: null });
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
  it('devis : lignes, sous-total, taxes DU CLIENT (même calcul que l outil), total, client', async () => {
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
    // Le vrai nom du champ est message_text (l'ancien test passait `message` et cachait une carte toujours vide).
    const s: any = await apercuProposition('send_sms', { client_name: 'Marie', phone_number: '514', message_text: 'Bonjour' }, ctx());
    expect(s).toMatchObject({ genre: 'sms', to: 'Marie · 514', subject: null, body: 'Bonjour' });
    expect(s.drapeaux).toMatchObject({ vers_client: true, jamais_d_office: true });
  });

  it('texto à un client : le numéro DE LA FICHE (celui que l’outil utilise), pas un numéro inventé', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const s: any = await apercuProposition('send_sms', { client_id: C1, client_name: 'Marie', phone_number: '+15145550000', message_text: 'On arrive' },
      ctx({ clients: { first_name: 'Marie', last_name: 'Tremblay', phone: '+15145550199' } }));
    expect(s.to).toBe('Marie Tremblay · +15145550199');
    expect(s.body).toBe('On arrive');
  });

  it('envoi d une soumission existante : numéro, montant et destinataire lus en base', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const a: any = await apercuProposition('send_quote', { quote_id: Q1 }, ctx({
      quotes: { quote_number: 'Q-0043', total_cents: 49439, client_id: C1, title: 'Vitres' },
      clients: { first_name: 'Marie', last_name: 'Tremblay', email: 'marie@x.ca' },
    }));
    expect(a).toMatchObject({ genre: 'email', to: 'Marie Tremblay <marie@x.ca>' });
    // L'objet par défaut de la route d'envoi : « Soumission N — montant », au format du courriel.
    expect(a.subject).toMatch(/^Soumission Q-0043 — 494,39\s\$$/);
  });

  it('envoi d une facture : l objet et le texte du MODÈLE de l entreprise, pas un texte générique', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const rangees: Record<string, any> = {
      invoices: { invoice_number: 'F-0012', balance_cents: 30000, total_cents: 45000, client_id: C1, currency: 'CAD', due_date: '2026-10-15' },
      clients: { first_name: 'Marie', last_name: 'Tremblay', email: 'marie@x.ca' },
      company_settings: { company_name: 'Vitres Nettes', default_language: 'fr' },
    };
    const client = {
      from: (table: string) => {
        const q: any = {};
        q.select = () => q; q.eq = () => q; q.is = () => q; q.order = () => q;
        q.limit = async () => ({ data: table === 'email_templates' ? [{ subject: 'Votre facture {invoice_number} de {company_name}', body: '<p>Bonjour {client_name}, voici {invoice_amount} à régler.</p>', source: 'user' }] : [], error: null });
        q.maybeSingle = async () => ({ data: rangees[table] ?? null, error: null });
        return q;
      },
    } as any;
    const a: any = await apercuProposition('send_invoice', { invoice_id: Q1 }, { client, orgId: 'org', userId: 'u' });
    expect(a.subject).toBe('Votre facture F-0012 de Vitres Nettes');
    // Le SOLDE (300 $), pas le total (450 $) : c'est ce que le client doit payer.
    expect(a.body).toMatch(/Bonjour Marie Tremblay, voici 300,00\s\$ à régler\./);
    expect(a.body).toMatch(/Suivi du montant à payer et du bouton pour payer la facture en ligne\./);
    expect(a.body).not.toMatch(/Courriel standard de Lume/);
  });

  it('fusion de doublons : les deux fiches côte à côte, avec leur volume d historique', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const client = {
      from: (table: string) => {
        const q: any = {};
        q.select = (_c: string, o?: any) => { q._head = !!o?.head; return q; };
        q.eq = () => q; q.is = () => q;
        q.maybeSingle = async () => ({ data: table === 'clients' ? { id: C1, first_name: 'Gaston', last_name: 'Doublon', company: null, display_as_company: false, email: 'g@x.ca', phone: '514', address: null, city: null, created_at: '2026-09-11T00:00:00Z' } : null });
        q.then = (res: any) => Promise.resolve({ count: table === 'jobs' ? 2 : 1 }).then(res);
        return q;
      },
    } as any;
    const a: any = await apercuProposition('merge_clients', { keep_client_id: C1, absorb_client_id: Q1 }, { client, orgId: 'org', userId: 'u' });
    expect(a.genre).toBe('fusion');
    expect(a.garder).toMatchObject({ name: 'Gaston Doublon', email: 'g@x.ca', jobs: 2, quotes: 1, invoices: 1, since: '2026-09-11' });
  });

  it('toute autre écriture : aperçu générique, l’élément visé NOMMÉ (audit 2026-09-30)', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const t: any = await apercuProposition('create_task', { title: 'Rappeler' }, ctx());
    expect(t).toMatchObject({ genre: 'action', cibles: [], details: [{ valeur: 'Rappeler' }] });
    // Supprimer un client : avant, carte VIDE ; maintenant le client nommé + « irréversible ».
    const d: any = await apercuProposition('delete_client', { client_id: C1 },
      ctx({ clients: { first_name: 'Marie', last_name: 'Tremblay', address: '12 rue des Érables', city: 'Québec', status: 'active' } }));
    expect(d.cibles[0]).toMatchObject({ libelle: { fr: 'Client' }, valeur: 'Marie Tremblay · 12 rue des Érables, Québec' });
    expect(d.drapeaux).toMatchObject({ irreversible: true, jamais_d_office: true });
    // Un identifiant qui ne correspond à rien dans l'entreprise est SIGNALÉ, jamais caché.
    const x: any = await apercuProposition('delete_client', { client_id: C1 }, ctx());
    expect(x.cibles[0]).toMatchObject({ alerte: true });
    // Remboursement : le montant en dollars, pas « amount cents 5000 ».
    const r: any = await apercuProposition('refund_payment', { payment_id: Q1, amount_cents: 5000, reason: 'Erreur' },
      ctx({ payments: { amount_cents: 11498, refunded_cents: 0, paid_at: '2026-09-12T15:00:00Z', method: 'card', invoice_id: null } }));
    expect(r.cibles[0].valeur).toMatch(/^114,98 \$ · /);
    expect(r.details).toEqual(expect.arrayContaining([expect.objectContaining({ valeur: '50,00 $' })]));
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

describe('remettreApercuEnAttente : la carte rouverte dit encore ce qu elle fait', () => {
  it('une proposition en attente retrouve son aperçu ; une carte déjà décidée n en reçoit pas', async () => {
    const { rendreMessages, remettreApercuEnAttente } = await import('../server/routes/lumi');
    const enAttente: any[] = [
      { role: 'user', content: 'Supprime ce client' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'delete_client', input: { client_id: C1 } }] },
    ];
    const rendus = rendreMessages(enAttente);
    expect(rendus[1].proposal?.apercu).toBeUndefined();
    await remettreApercuEnAttente(rendus, 'org:u', ctx({ clients: { first_name: 'Marie', last_name: 'Tremblay', status: 'active' } }));
    const apercu: any = rendus[1].proposal?.apercu;
    expect(apercu?.genre).toBe('action');
    expect(apercu.cibles[0].valeur).toMatch(/Marie Tremblay/);
    expect(apercu.drapeaux).toBeDefined();

    const decidee = rendreMessages([...enAttente, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '{"cancelled":true}' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Annulé.' }] }]);
    await remettreApercuEnAttente(decidee, 'org:u', ctx());
    expect(decidee.find((m) => m.proposal)?.proposal?.apercu).toBeUndefined();
  });
});

describe('carte : identifiant inventé', () => {
  it('une fiche désignée par un nom (« jean-pierre-gagnon ») est signalée, jamais cachée', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const a: any = await apercuProposition('delete_client', { client_id: 'jean-pierre-gagnon' }, ctx());
    expect(a.cibles[0]).toMatchObject({ alerte: true });
    expect(a.cibles[0].valeur).toMatch(/ne correspond à aucune fiche/);
  });
});

describe('cartes : facture récurrente, contrat, rapport planifié (audit 2026-09-30)', () => {
  it('nomment le client, la fréquence, le destinataire', async () => {
    const { apercuProposition } = await import('../server/lib/lumi/fiches');
    const S1 = '44444444-4444-4444-8444-444444444444';
    const rec: any = await apercuProposition('run_recurring_invoice_now', { schedule_id: S1 }, ctx({
      recurring_invoice_schedules: { client_id: C1, subject: 'Entretien mensuel', frequency: 'monthly', is_active: true, auto_send: true },
      clients: { first_name: 'Marie', last_name: 'Tremblay' },
    }));
    expect(rec.cibles[0].valeur).toMatch(/Marie Tremblay.*Entretien mensuel.*monthly.*envoi automatique/);
    const rap: any = await apercuProposition('send_scheduled_report_now', { report_id: S1 }, ctx({ scheduled_reports: { recipient_email: 'externe@exemple.com', frequency: 'monthly', enabled: true } }));
    expect(rap.cibles[0].valeur).toMatch(/externe@exemple\.com/);
    const con: any = await apercuProposition('send_agreement_sms', { agreement_id: S1 }, ctx({
      job_agreements: { job_id: J1, client_id: C1, status: 'draft' },
      jobs: { job_number: '30', title: 'Revêtement', client_name: 'Marie Tremblay' },
      clients: { first_name: 'Marie', last_name: 'Tremblay' },
    }));
    expect(con.cibles[0].valeur).toMatch(/#30.*Marie Tremblay.*draft/);
  });
});
