/**
 * LUMI — RAPPORTS PDF (build_report).
 *
 * Le serveur compose un rapport DÉJÀ formaté (montants, dates, libellés) à
 * partir des outils de lecture existants ; l'interface le rend en carte et en
 * PDF. Ces tests figent : le contrat de l'outil (lecture, réservé à Lumi,
 * financier, permission « rapports »), le formatage québécois, les sommes
 * calculées côté serveur, le tri des retards, et l'absence d'identifiant
 * technique dans ce qui part à l'utilisateur.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({}), companyOrgIds: async () => [] }));
vi.mock('../server/lib/security', () => ({ logSecurityEvent: async () => {} }));
vi.mock('../server/lib/config', () => ({ twilioClient: null, getTwilioStatusCallbackUrl: () => '' }));
vi.mock('../server/lib/helpers', () => ({ normalizeE164: (s: string) => s, findOrCreateConversation: async () => null }));
vi.mock('../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => null, SmsNumberNotProvisionedError: class extends Error {}, SmsNotInPlanError: class extends Error {} }));

/** Client Supabase factice : chaque table/RPC répond ce qu'on lui a préparé. */
function clientFactice(reponses: Record<string, any>) {
  const chaine = (cle: string) => {
    const rep = reponses[cle] ?? { data: [], error: null };
    const o: any = {};
    const self = () => o;
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit', 'or', 'ilike', 'neq', 'lt', 'gt']) o[m] = self;
    o.maybeSingle = async () => ({ data: Array.isArray(rep.data) ? rep.data[0] ?? null : rep.data, error: rep.error ?? null });
    o.single = o.maybeSingle;
    o.then = (res: any, rej: any) => Promise.resolve({ data: rep.data, error: rep.error ?? null, count: rep.count ?? (Array.isArray(rep.data) ? rep.data.length : null) }).then(res, rej);
    return o;
  };
  return { from: (t: string) => chaine(t), rpc: async (n: string) => ({ data: reponses[n]?.data ?? [], error: reponses[n]?.error ?? null }) } as any;
}

const ctx = (client: any) => ({ client, orgId: 'org', userId: 'u' });

describe('contrat de l outil build_report', () => {
  it('est un outil de LECTURE, réservé à Lumi, financier, sous la permission « rapports »', async () => {
    const { AGENT_TOOLS, TOOLS_BY_NAME } = await import('../server/lib/agent/tools');
    const { PERMISSION_PAR_OUTIL, OUTILS_FINANCIERS } = await import('../server/lib/agent/garde');
    const outil = TOOLS_BY_NAME.build_report;
    expect(outil).toBeDefined();
    expect(outil.kind).toBe('read');
    expect(outil.canal).toBe('lumi');
    expect(AGENT_TOOLS).toContain(outil);
    expect(PERMISSION_PAR_OUTIL.build_report).toEqual({ cle: 'financial.view_reports', capacite: 'les rapports' });
    expect(OUTILS_FINANCIERS.has('build_report')).toBe(true);
  });

  it('le serveur MCP ne publie pas les outils réservés à Lumi', () => {
    const src = readFileSync('server/routes/mcp.ts', 'utf8');
    expect(src).toContain("t.canal !== 'lumi'");
  });

  it('un type inconnu est refusé en mots simples', async () => {
    const { TOOLS_BY_NAME } = await import('../server/lib/agent/tools');
    const r = await TOOLS_BY_NAME.build_report.handler!({ type: 'paie' }, ctx(clientFactice({})));
    expect(r.error).toMatch(/Type de rapport inconnu/);
  });
});

describe('formatage', () => {
  it('argent en dollars canadiens selon la langue', async () => {
    const { fmtArgent } = await import('../server/lib/agent/tools-rapports');
    expect(fmtArgent(162690, 'fr')).toBe('1 626,90 $');
    expect(fmtArgent(162690, 'en')).toBe('$1,626.90');
    expect(fmtArgent(null, 'fr')).toBe('0,00 $');
  });
});

describe('rapport des comptes à recevoir', () => {
  const lignes = [
    { invoice_number: 'INV-000006', client_id: 'c1', client_name: 'Sophie Bouchard', balance_cents: 162690, due_date: '2026-08-19' },
    { invoice_number: 'INV-000004', client_id: 'c2', client_name: 'Jean-Pierre Gagnon', balance_cents: 17246, due_date: '2026-07-31' },
    { invoice_number: 'INV-000015', client_id: 'c2', client_name: 'Jean-Pierre Gagnon', balance_cents: 17246, due_date: '2026-09-05' },
  ];

  it('total calculé côté serveur, factures triées du plus vieux retard au plus récent, regroupement par client', async () => {
    const { TOOLS_BY_NAME } = await import('../server/lib/agent/tools');
    const client = clientFactice({ rpc_list_invoices: { data: lignes }, clients: { data: [{ id: 'c1', phone: '450' }, { id: 'c2', phone: '438' }] } });
    const r = await TOOLS_BY_NAME.build_report.handler!({ type: 'retards', language: 'fr' }, ctx(client));
    expect(r.rapport.type).toBe('retards');
    const [retards, parClient] = r.rapport.sections;
    expect(retards.kpis).toEqual([
      { label: 'Factures en retard', valeur: '3' },
      { label: 'Total en souffrance', valeur: '1 971,82 $' },
    ]);
    expect(retards.tableau.lignes.map((l: string[]) => l[0])).toEqual(['INV-000004', 'INV-000006', 'INV-000015']);
    expect(parClient.titre).toBe('Par client');
    expect(parClient.tableau.lignes[0]).toEqual(['Sophie Bouchard', '1', expect.any(String), '1 626,90 $']);
    expect(parClient.tableau.lignes[1]).toEqual(['Jean-Pierre Gagnon', '2', expect.any(String), '344,92 $']);
  });

  it('aucun identifiant technique ne part vers l utilisateur', async () => {
    const { TOOLS_BY_NAME } = await import('../server/lib/agent/tools');
    const client = clientFactice({ rpc_list_invoices: { data: lignes }, clients: { data: [] } });
    const r = await TOOLS_BY_NAME.build_report.handler!({ type: 'retards' }, ctx(client));
    expect(JSON.stringify(r.rapport)).not.toMatch(/"c1"|"c2"|client_id|_cents/);
  });

  it('sans retard : une note, pas de tableau vide', async () => {
    const { TOOLS_BY_NAME } = await import('../server/lib/agent/tools');
    const r = await TOOLS_BY_NAME.build_report.handler!({ type: 'receivables', language: 'en' }, ctx(clientFactice({})));
    expect(r.rapport.sections).toHaveLength(1);
    expect(r.rapport.sections[0].note).toMatch(/No overdue invoices/);
  });
});

describe('rapport des jobs', () => {
  it('période bornée, statuts en mots, totaux calculés ici', async () => {
    const { TOOLS_BY_NAME } = await import('../server/lib/agent/tools');
    const client = clientFactice({
      jobs_active: { data: [
        { job_number: '24', title: 'Lumières de Noël', client_name: 'Sophie Bouchard', scheduled_at: '2026-09-09T13:00:00Z', status: 'scheduled', derived_status: 'late', total_cents: 141500 },
        { job_number: '25', title: 'Gouttières', client_name: 'Marie Tremblay', scheduled_at: '2026-09-10T12:00:00Z', status: 'completed', derived_status: 'completed', total_cents: 42500 },
      ] },
    });
    const r = await TOOLS_BY_NAME.build_report.handler!({ type: 'jobs', from: '2026-09-07', to: '2026-09-13' }, ctx(client));
    expect(r.rapport.periode).toEqual({ du: '2026-09-07', au: '2026-09-13' });
    expect(r.rapport.sections[0].kpis).toEqual([
      { label: 'Jobs planifiés', valeur: '2' }, { label: 'Terminés', valeur: '1' },
      { label: 'Valeur totale', valeur: '1 840,00 $' }, { label: 'Valeur des terminés', valeur: '425,00 $' },
    ]);
    const detail = r.rapport.sections.find((s: any) => s.titre === 'Détail des jobs');
    expect(detail.tableau.lignes[0][4]).toBe('en retard');
    expect(detail.tableau.lignes[1][4]).toBe('terminé');
    expect(JSON.stringify(r.rapport)).not.toMatch(/derived_status|scheduled_at/);
  });

  it('des bornes inversées sont remises dans l ordre ; sans bornes, du 1er du mois à aujourd hui', async () => {
    const { TOOLS_BY_NAME } = await import('../server/lib/agent/tools');
    const r1 = await TOOLS_BY_NAME.build_report.handler!({ type: 'jobs', from: '2026-09-13', to: '2026-09-07' }, ctx(clientFactice({})));
    expect(r1.rapport.periode).toEqual({ du: '2026-09-07', au: '2026-09-13' });
    const r2 = await TOOLS_BY_NAME.build_report.handler!({ type: 'jobs' }, ctx(clientFactice({})));
    expect(r2.rapport.periode.du).toMatch(/^\d{4}-\d{2}-01$/);
    expect(r2.rapport.periode.au >= r2.rapport.periode.du).toBe(true);
  });
});

describe('PDF côté client', () => {
  it('se construit en mémoire, pagine, et nomme le fichier d après le titre et la période', async () => {
    const { construireRapportPdf, nomFichierRapport } = await import('../src/lib/generateRapportPdf');
    const rapport: any = {
      type: 'jobs', titre: 'Rapport des jobs', sous_titre: 'Du 7 sept. 2026 au 13 sept. 2026', periode: { du: '2026-09-07', au: '2026-09-13' },
      genere_le: '2026-09-10T15:00:00Z', langue: 'fr',
      sections: [
        { titre: 'En chiffres', kpis: [{ label: 'Jobs', valeur: '80' }, { label: 'Valeur', valeur: '12 345,67 $', detail: '+3 %' }] },
        { titre: 'Détail', tableau: { colonnes: ['Date', 'Job', 'Montant'], alignements: ['g', 'g', 'd'], lignes: Array.from({ length: 80 }, (_, i) => [`2026-09-${String((i % 28) + 1).padStart(2, '0')}`, `Job ${i}`, '100,00 $']) } },
        { titre: 'Note', note: 'Les coûts sont ceux saisis.' },
      ],
    };
    const doc = construireRapportPdf(rapport);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(nomFichierRapport(rapport)).toBe('rapport-des-jobs-2026-09-07-2026-09-13.pdf');
  });
});
