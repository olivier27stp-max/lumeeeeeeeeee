/* ═══════════════════════════════════════════════════════════════
   Lumi — rapports (« sors-moi mon mois », « un PDF pour mon comptable »)
   ─────────────────────────────────────────────────────────────
   Un seul outil, `build_report`, compose un rapport STRUCTURÉ à partir des
   outils de lecture existants (mêmes requêtes que les écrans Insights et
   Finances : aucune nouvelle source de vérité). Le serveur ne fabrique pas
   de PDF : l'interface reçoit la structure (événement SSE `report`), affiche
   une carte, et le bouton « Télécharger le PDF » la rend côté client avec
   jsPDF — la même mécanique que les factures et devis.

   Tout est déjà formaté ici (« 1 626,90 $ », « 9 sept. 2026 ») : le modèle
   n'a rien à calculer ni à convertir, et le PDF montre exactement ce que
   l'assistant a lu. Les rapports contiennent des montants : l'outil est
   financier (montants visibles obligatoires, permission « rapports »).
   ═══════════════════════════════════════════════════════════════ */
import type { AgentTool, ToolContext } from './tools';
import { TOOLS_BY_NAME } from './tools';
import { ETIQUETTES_DERIVED } from './tools-etendus';

export type LangueRapport = 'fr' | 'en';

export interface SectionRapport {
  titre: string;
  /** Chiffres clés, déjà formatés. */
  kpis?: Array<{ label: string; valeur: string; detail?: string }>;
  /** Tableau : `alignements` = 'd' pour une colonne de nombres (à droite). */
  tableau?: { colonnes: string[]; lignes: string[][]; alignements?: Array<'g' | 'd'> };
  note?: string;
}

export interface Rapport {
  type: 'financier' | 'retards' | 'jobs' | 'client';
  titre: string;
  sous_titre: string;
  periode: { du: string; au: string } | null;
  genere_le: string;
  langue: LangueRapport;
  sections: SectionRapport[];
}

const FUSEAU_ORG = 'America/Montreal';

function aujourdhui(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU_ORG, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Bornes de période : défaut = du 1er du mois à aujourd'hui (fuseau de l'entreprise). */
function bornes(args: Record<string, any>): { du: string; au: string } {
  const au = YMD.test(String(args.to || '')) ? String(args.to) : aujourdhui();
  const du = YMD.test(String(args.from || '')) ? String(args.from) : `${au.slice(0, 7)}-01`;
  return du <= au ? { du, au } : { du: au, au: du };
}

export function fmtArgent(cents: number | null | undefined, langue: LangueRapport): string {
  const n = Math.abs(Number(cents) || 0) / 100;
  const signe = (Number(cents) || 0) < 0 ? '-' : '';
  const [entier, dec] = n.toFixed(2).split('.');
  if (langue === 'fr') {
    // Format québécois, espace ordinaire entre les milliers (déterministe, lisible partout) : 1 626,90 $
    const groupes = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${signe}${groupes},${dec} $`;
  }
  return `${signe}$${entier.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

export function fmtDate(iso: string | null | undefined, langue: LangueRapport, heure = false): string {
  if (!iso) return '—';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', {
    timeZone: FUSEAU_ORG, year: 'numeric', month: 'short', day: 'numeric', ...(heure ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(d);
}

function fmtPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(Number(p))) return '—';
  const v = Number(p);
  return `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10} %`;
}

const L = (langue: LangueRapport) => (fr: string, en: string) => (langue === 'fr' ? fr : en);

/** Appelle un outil de lecture existant, sans repasser par les gardes (déjà passées pour build_report). */
async function lire(nom: string, args: Record<string, any>, ctx: ToolContext): Promise<any> {
  const outil = TOOLS_BY_NAME[nom];
  if (!outil?.handler) return { error: `outil ${nom} indisponible` };
  try { return await outil.handler(args, ctx); } catch (e: any) { return { error: e?.message || String(e) }; }
}

/* ── Rapport financier ─────────────────────────────────────────── */
async function rapportFinancier(args: Record<string, any>, ctx: ToolContext, langue: LangueRapport): Promise<Rapport> {
  const t = L(langue);
  const { du, au } = bornes(args);
  const [comp, serie, renta, services, retards, top] = await Promise.all([
    lire('compare_revenue', { from: du, to: au }, ctx),
    ctx.client.rpc('rpc_insights_revenue_series', { p_org: ctx.orgId, p_from: du, p_to: au, p_granularity: 'month' }),
    lire('get_job_profitability', { from: du, to: au }, ctx),
    lire('get_top_services', { from: du, to: au }, ctx),
    lire('get_overdue_payments', { limit: 100 }, ctx),
    lire('get_top_clients', { limit: 10 }, ctx),
  ]);

  const sections: SectionRapport[] = [];

  // Vue d'ensemble : la période contre la précédente.
  const LIB: Record<string, [string, string]> = {
    'nouveaux clients': ['Nouveaux clients', 'New clients'], 'nouveaux jobs': ['Nouveaux jobs', 'New jobs'],
    'valeur facturée': ['Valeur facturée', 'Invoiced value'], conversions: ['Conversions', 'Conversions'],
    'factures payées': ['Factures payées', 'Paid invoices'],
    revenus: ['Revenus facturés', 'Invoiced revenue'], encaissé: ['Encaissé', 'Collected'], jobs: ['Jobs', 'Jobs'],
    factures: ['Factures', 'Invoices'], devis: ['Devis', 'Quotes'],
  };
  const kpis = (comp?.comparaison || []).map((c: any) => {
    const lib = LIB[c.mesure] ? (langue === 'fr' ? LIB[c.mesure][0] : LIB[c.mesure][1]) : String(c.mesure);
    const valeur = 'valeur_cents' in c ? fmtArgent(c.valeur_cents, langue) : String(c.valeur ?? 0);
    return { label: lib, valeur, detail: `${fmtPct(c.variation_pct)} ${t('vs période précédente', 'vs previous period')}` };
  });
  if (kpis.length) sections.push({ titre: t("Vue d'ensemble", 'Overview'), kpis });

  // Revenus par mois.
  const lignesSerie = (Array.isArray(serie.data) ? serie.data : []).map((r: any) => [
    new Intl.DateTimeFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', { timeZone: FUSEAU_ORG, month: 'long', year: 'numeric' }).format(new Date(`${r.bucket_start}T12:00:00`)),
    fmtArgent(r.invoiced_cents, langue),
    fmtArgent(r.revenue_cents, langue),
  ]);
  if (lignesSerie.length) {
    sections.push({
      titre: t('Revenus par mois', 'Revenue by month'),
      tableau: { colonnes: [t('Mois', 'Month'), t('Facturé', 'Invoiced'), t('Encaissé', 'Collected')], lignes: lignesSerie, alignements: ['g', 'd', 'd'] },
    });
  }

  // Rentabilité.
  if (renta && !renta.error && renta.nombre_de_jobs != null) {
    sections.push({
      titre: t('Rentabilité des jobs', 'Job profitability'),
      kpis: [
        { label: t('Jobs', 'Jobs'), valeur: String(renta.nombre_de_jobs) },
        { label: t('Revenus', 'Revenue'), valeur: fmtArgent(renta.revenus_cents, langue) },
        { label: t('Coûts enregistrés', 'Recorded costs'), valeur: fmtArgent(renta.couts_cents, langue) },
        { label: t('Marge brute', 'Gross margin'), valeur: fmtArgent(renta.marge_cents, langue), detail: renta.marge_pct == null ? undefined : `${renta.marge_pct} %` },
        { label: t('Jobs rentables', 'Profitable jobs'), valeur: String(renta.jobs_rentables) },
        { label: t('Jobs à perte', 'Jobs at a loss'), valeur: String(renta.jobs_a_perte) },
      ],
      note: t('Les coûts sont ceux saisis sur les jobs ; un job sans dépense saisie compte comme 100 % de marge.', 'Costs are those recorded on jobs; a job with no recorded expense counts as 100% margin.'),
    });
  }

  // Services.
  const lignesServices = (services?.services || []).map((s: any) => [s.service, String(s.nombre_de_jobs), fmtArgent(s.total_cents, langue)]);
  if (lignesServices.length) {
    sections.push({
      titre: t('Ce qui rapporte le plus', 'Top earners'),
      tableau: { colonnes: [t('Service', 'Service'), t('Jobs', 'Jobs'), t('Total', 'Total')], lignes: lignesServices, alignements: ['g', 'd', 'd'] },
    });
  }

  // Comptes à recevoir (toutes périodes : un retard est un retard).
  sections.push(sectionRetards(retards, langue));

  // Meilleurs clients (valeur à vie).
  const lignesTop = (top?.clients || []).map((c: any) => [c.nom, String(c.nombre_de_jobs), fmtArgent(c.total_cents, langue), fmtArgent(c.valeur_moyenne_cents, langue)]);
  if (lignesTop.length) {
    sections.push({
      titre: t('Meilleurs clients (depuis le début)', 'Best clients (all time)'),
      tableau: { colonnes: [t('Client', 'Client'), t('Jobs', 'Jobs'), t('Total', 'Total'), t('Job moyen', 'Avg. job')], lignes: lignesTop, alignements: ['g', 'd', 'd', 'd'] },
    });
  }

  return {
    type: 'financier',
    titre: t('Rapport financier', 'Financial report'),
    sous_titre: `${t('Du', 'From')} ${fmtDate(du, langue)} ${t('au', 'to')} ${fmtDate(au, langue)}`,
    periode: { du, au }, genere_le: new Date().toISOString(), langue, sections,
  };
}

/* ── Comptes à recevoir ────────────────────────────────────────── */
function sectionRetards(retards: any, langue: LangueRapport): SectionRapport {
  const t = L(langue);
  const lignes = [...(retards?.overdue || [])]
    .sort((a: any, b: any) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0))
    .map((r: any) => [r.invoice_number || '—', r.client_name || '—', fmtDate(r.due_date, langue), String(r.days_overdue ?? '—'), fmtArgent(r.balance_cents, langue)]);
  const total = fmtArgent(retards?.sum_balance_cents, langue);
  if (!lignes.length) return { titre: t('Comptes à recevoir en retard', 'Overdue receivables'), note: t('Aucune facture en retard. 🎉', 'No overdue invoices. 🎉') };
  return {
    titre: t('Comptes à recevoir en retard', 'Overdue receivables'),
    kpis: [
      { label: t('Factures en retard', 'Overdue invoices'), valeur: String(lignes.length) },
      { label: t('Total en souffrance', 'Total outstanding'), valeur: total },
    ],
    tableau: {
      colonnes: [t('Facture', 'Invoice'), t('Client', 'Client'), t('Échéance', 'Due'), t('Jours', 'Days'), t('Solde', 'Balance')],
      lignes, alignements: ['g', 'g', 'g', 'd', 'd'],
    },
  };
}

async function rapportRetards(_args: Record<string, any>, ctx: ToolContext, langue: LangueRapport): Promise<Rapport> {
  const t = L(langue);
  const retards = await lire('get_overdue_payments', { limit: 100 }, ctx);
  const sections = [sectionRetards(retards, langue)];
  // Par client : qui doit combien, pour prioriser les relances.
  const parClient = new Map<string, { n: number; solde: number; max: number }>();
  for (const r of retards?.overdue || []) {
    const cle = r.client_name || '—';
    const cur = parClient.get(cle) || { n: 0, solde: 0, max: 0 };
    cur.n += 1; cur.solde += Number(r.balance_cents) || 0; cur.max = Math.max(cur.max, Number(r.days_overdue) || 0);
    parClient.set(cle, cur);
  }
  if (parClient.size > 1) {
    sections.push({
      titre: t('Par client', 'By client'),
      tableau: {
        colonnes: [t('Client', 'Client'), t('Factures', 'Invoices'), t('Retard max (jours)', 'Max overdue (days)'), t('Solde', 'Balance')],
        lignes: [...parClient.entries()].sort((a, b) => b[1].solde - a[1].solde).map(([nom, v]) => [nom, String(v.n), String(v.max), fmtArgent(v.solde, langue)]),
        alignements: ['g', 'd', 'd', 'd'],
      },
    });
  }
  return {
    type: 'retards', titre: t('Comptes à recevoir', 'Accounts receivable'),
    sous_titre: `${t('En date du', 'As of')} ${fmtDate(aujourdhui(), langue)}`,
    periode: null, genere_le: new Date().toISOString(), langue, sections,
  };
}

/* ── Jobs de la période ────────────────────────────────────────── */
async function rapportJobs(args: Record<string, any>, ctx: ToolContext, langue: LangueRapport): Promise<Rapport> {
  const t = L(langue);
  const { du, au } = bornes(args);
  const { data, error } = await ctx.client
    .from('jobs_active')
    .select('job_number, title, client_name, property_address, scheduled_at, status, derived_status, total_cents')
    .eq('org_id', ctx.orgId)
    .gte('scheduled_at', `${du}T00:00:00`)
    .lte('scheduled_at', `${au}T23:59:59`)
    .order('scheduled_at', { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  const jobs = data || [];
  const ETIQ_EN: Record<string, string> = {
    upcoming: 'upcoming', late: 'late', action_required: 'action required', archived: 'archived', requires_invoicing: 'to invoice',
    scheduled: 'scheduled', completed: 'completed', in_progress: 'in progress', cancelled: 'cancelled', draft: 'draft',
  };
  const etiquette = (j: any) => {
    const cle = j.derived_status || j.status;
    return (langue === 'fr' ? ETIQUETTES_DERIVED[cle] : ETIQ_EN[cle]) || String(cle || '—');
  };
  const parStatut = new Map<string, number>();
  let total = 0;
  for (const j of jobs) { const e = etiquette(j); parStatut.set(e, (parStatut.get(e) || 0) + 1); total += Number(j.total_cents) || 0; }
  const termines = jobs.filter((j: any) => j.status === 'completed');
  const sections: SectionRapport[] = [
    {
      titre: t('En chiffres', 'At a glance'),
      kpis: [
        { label: t('Jobs planifiés', 'Scheduled jobs'), valeur: String(jobs.length) },
        { label: t('Terminés', 'Completed'), valeur: String(termines.length) },
        { label: t('Valeur totale', 'Total value'), valeur: fmtArgent(total, langue) },
        { label: t('Valeur des terminés', 'Completed value'), valeur: fmtArgent(termines.reduce((s: number, j: any) => s + (Number(j.total_cents) || 0), 0), langue) },
      ],
    },
  ];
  if (parStatut.size) {
    sections.push({
      titre: t('Par statut', 'By status'),
      tableau: { colonnes: [t('Statut', 'Status'), t('Jobs', 'Jobs')], lignes: [...parStatut.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => [s, String(n)]), alignements: ['g', 'd'] },
    });
  }
  sections.push(jobs.length
    ? {
      titre: t('Détail des jobs', 'Job list'),
      tableau: {
        colonnes: [t('Date', 'Date'), t('N°', 'No.'), t('Job', 'Job'), t('Client', 'Client'), t('Statut', 'Status'), t('Montant', 'Amount')],
        lignes: jobs.map((j: any) => [fmtDate(j.scheduled_at, langue, true), j.job_number || '—', j.title || '—', j.client_name || '—', etiquette(j), fmtArgent(j.total_cents, langue)]),
        alignements: ['g', 'g', 'g', 'g', 'g', 'd'],
      },
    }
    : { titre: t('Détail des jobs', 'Job list'), note: t('Aucun job planifié sur cette période.', 'No jobs scheduled in this period.') });
  return {
    type: 'jobs', titre: t('Rapport des jobs', 'Jobs report'),
    sous_titre: `${t('Du', 'From')} ${fmtDate(du, langue)} ${t('au', 'to')} ${fmtDate(au, langue)}`,
    periode: { du, au }, genere_le: new Date().toISOString(), langue, sections,
  };
}

/* ── Dossier client ────────────────────────────────────────────── */
async function rapportClient(args: Record<string, any>, ctx: ToolContext, langue: LangueRapport): Promise<Rapport> {
  const t = L(langue);
  if (!args.client_id) throw new Error(t('client_id requis : cherche le client d’abord.', 'client_id required: search the client first.'));
  const p = await lire('get_client_profile', { client_id: args.client_id }, ctx);
  if (!p || p.error) throw new Error(p?.error || 'profil indisponible');
  const c = p.client || {};
  const coordonnees = [
    [t('Nom', 'Name'), c.name], [t('Entreprise', 'Company'), c.company], [t('Téléphone', 'Phone'), c.phone], [t('Courriel', 'Email'), c.email],
    [t('Adresse', 'Address'), [c.address, c.city].filter(Boolean).join(', ')], [t('Client depuis', 'Client since'), c.since ? fmtDate(c.since, langue) : null], [t('Statut', 'Status'), c.statut],
  ].filter(([, v]) => v).map(([k, v]) => [String(k), String(v)]);
  const sections: SectionRapport[] = [
    { titre: t('Coordonnées', 'Contact'), tableau: { colonnes: ['', ''], lignes: coordonnees } },
    {
      titre: t('En chiffres', 'At a glance'),
      kpis: [
        { label: t('Jobs', 'Jobs'), valeur: String(p.jobs?.total ?? 0) },
        { label: t('Valeur totale', 'Lifetime value'), valeur: fmtArgent(p.jobs?.lifetime_value_cents, langue) },
        { label: t('Factures', 'Invoices'), valeur: String(p.billing?.invoices_total ?? 0) },
        { label: t('Impayé', 'Unpaid'), valeur: fmtArgent(p.billing?.unpaid_cents, langue), detail: `${p.billing?.unpaid_count ?? 0} ${t('facture(s)', 'invoice(s)')}` },
        { label: t('En retard', 'Overdue'), valeur: fmtArgent(p.billing?.overdue_cents, langue) },
        { label: t('Devis', 'Quotes'), valeur: String(p.quotes?.total ?? 0) },
      ],
    },
  ];
  const jobs = (p.jobs?.recent || []).map((j: any) => [fmtDate(j.date, langue, true), j.job_number || '—', j.title || '—', j.display_status || '—', fmtArgent(j.total_cents, langue)]);
  if (jobs.length) sections.push({ titre: t('Derniers jobs', 'Recent jobs'), tableau: { colonnes: [t('Date', 'Date'), t('N°', 'No.'), t('Job', 'Job'), t('Statut', 'Status'), t('Montant', 'Amount')], lignes: jobs, alignements: ['g', 'g', 'g', 'g', 'd'] } });
  const devis = (p.quotes?.recent || []).map((q: any) => [q.title || '—', q.statut || '—', fmtArgent(q.total_cents, langue)]);
  if (devis.length) sections.push({ titre: t('Derniers devis', 'Recent quotes'), tableau: { colonnes: [t('Devis', 'Quote'), t('Statut', 'Status'), t('Montant', 'Amount')], lignes: devis, alignements: ['g', 'g', 'd'] } });
  return {
    type: 'client', titre: `${t('Dossier client', 'Client file')} — ${c.name || ''}`.trim(),
    sous_titre: `${t('En date du', 'As of')} ${fmtDate(aujourdhui(), langue)}`,
    periode: null, genere_le: new Date().toISOString(), langue, sections,
  };
}

/* ── L'outil ───────────────────────────────────────────────────── */
export const buildReport: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  canal: 'lumi',
  declaration: {
    name: 'build_report',
    description:
      'Build a downloadable PDF report and show it to the user as a card (the card has the download button). '
      + 'Use whenever the user asks for a report, a PDF, a document to print/send/forward, a summary for their accountant, or « sors-moi mon mois ». '
      + 'Types: financial (revenue vs previous period, revenue by month, profitability, top services, overdue, best clients), '
      + 'receivables (overdue invoices, by client), jobs (all jobs scheduled in the period with status and amounts), '
      + 'client (one client’s file: contact, numbers, recent jobs and quotes — needs client_id from a search). '
      + 'Dates YYYY-MM-DD; default period = 1st of this month to today. After calling it, summarize the 2-3 key facts in words; do not repeat the tables.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: "One of: 'financier', 'retards', 'jobs', 'client'." },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (financier, jobs).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (financier, jobs).' },
        client_id: { type: 'string', description: "Client id (type 'client' only)." },
        language: { type: 'string', description: "'fr' or 'en' — the user's language. Default fr." },
      },
      required: ['type'],
    },
  },
  handler: async (args, ctx) => {
    const langue: LangueRapport = args.language === 'en' ? 'en' : 'fr';
    const type = String(args.type || '').toLowerCase();
    const alias: Record<string, Rapport['type']> = {
      financier: 'financier', financial: 'financier', finances: 'financier', finance: 'financier',
      retards: 'retards', receivables: 'retards', overdue: 'retards', impayes: 'retards',
      jobs: 'jobs', job: 'jobs', client: 'client', clients: 'client',
    };
    const t = alias[type];
    if (!t) return { error: `Type de rapport inconnu : ${type}. Types : financier, retards, jobs, client.` };
    try {
      const rapport = t === 'financier' ? await rapportFinancier(args, ctx, langue)
        : t === 'retards' ? await rapportRetards(args, ctx, langue)
          : t === 'jobs' ? await rapportJobs(args, ctx, langue)
            : await rapportClient(args, ctx, langue);
      return { rapport, note: 'Le rapport est affiché à l’utilisateur avec un bouton de téléchargement PDF. Résume les points saillants en quelques phrases.' };
    } catch (e: any) {
      console.error('[build_report]', e?.message || e);
      return { error: 'Le rapport n’a pas pu être produit.' };
    }
  },
};

export const OUTILS_RAPPORTS: AgentTool[] = [buildReport];
