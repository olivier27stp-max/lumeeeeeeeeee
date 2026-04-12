// ═══════════════════════════════════════════════════════════════════════════
// LIA Context Loader
// Builds a rich CRM context for LIA's system prompt so she can act as
// a real creative/marketing director with full business knowledge.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from '../supabase';
import { getCurrentOrgIdOrThrow } from '../orgApi';
import { getTopPerformingPrompts, getAnalyticsSummary, listStyleDna, type StyleDnaRecord } from '../directorApi';

export interface PromptPerformance {
  prompt: string;
  model: string;
  usage_count: number;
}

export interface LiaContext {
  company: string | null;
  industry: string | null;
  companyPhone: string | null;
  companyWebsite: string | null;
  totalClients: number;
  topClients: string[];
  totalLeads: number;
  recentLeads: string[];
  activeJobs: number;
  totalRevenue: number;
  pipelineSummary: string;
  teamNames: string[];
  recentGenerations: string[];
  creditBalance: number;
  topPrompts: PromptPerformance[];
  analytics: { totalGenerations: number; totalDownloads: number; totalReuses: number; favoriteCount: number; topModel: string | null };
  styleDna: StyleDnaRecord[];
}

export async function loadLiaContext(): Promise<LiaContext> {
  const ctx: LiaContext = {
    company: null,
    industry: null,
    companyPhone: null,
    companyWebsite: null,
    totalClients: 0,
    topClients: [],
    totalLeads: 0,
    recentLeads: [],
    activeJobs: 0,
    totalRevenue: 0,
    pipelineSummary: '',
    teamNames: [],
    recentGenerations: [],
    creditBalance: 0,
    topPrompts: [],
    analytics: { totalGenerations: 0, totalDownloads: 0, totalReuses: 0, favoriteCount: 0, topModel: null },
    styleDna: [],
  };

  try {
    const orgId = await getCurrentOrgIdOrThrow();

    // All queries run in parallel for speed — scoped to current org
    const [
      companyRes,
      clientsRes,
      leadsRes,
      jobsRes,
      pipelineRes,
      teamsRes,
      generationsRes,
      creditsRes,
      topPromptsRes,
      analyticsRes,
      styleDnaRes,
    ] = await Promise.allSettled([
      // Company info
      supabase.from('company_settings').select('company_name,phone,website,industry').eq('org_id', orgId).limit(1).maybeSingle(),
      // Top clients
      supabase.from('clients').select('first_name,last_name,company').eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }).limit(10),
      // Recent leads
      supabase.from('leads_active').select('first_name,last_name,company,stage').eq('org_id', orgId).order('created_at', { ascending: false }).limit(10),
      // Active jobs count + revenue
      supabase.from('jobs_active').select('status,total_cents').eq('org_id', orgId).limit(500),
      // Pipeline summary
      supabase.from('pipeline_deals').select('stage,value').eq('org_id', orgId).is('deleted_at', null).limit(200),
      // Teams
      supabase.from('teams').select('name').eq('org_id', orgId).is('deleted_at', null).order('name').limit(20),
      // Recent generations
      supabase.from('director_generations').select('title,output_type,model,prompt,created_at').eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }).limit(5),
      // Credits
      supabase.from('org_credit_balances').select('credits_balance').eq('org_id', orgId).limit(1).maybeSingle(),
      // Top performing prompts
      getTopPerformingPrompts(orgId).catch(() => []),
      // Analytics summary
      getAnalyticsSummary(orgId).catch(() => ({ totalGenerations: 0, totalDownloads: 0, totalReuses: 0, favoriteCount: 0, topModel: null })),
      // Style DNA
      listStyleDna(orgId).catch(() => []),
    ]);

    // Company
    if (companyRes.status === 'fulfilled' && companyRes.value.data) {
      const c = companyRes.value.data;
      ctx.company = c.company_name || null;
      ctx.industry = c.industry || null;
      ctx.companyPhone = c.phone || null;
      ctx.companyWebsite = c.website || null;
    }

    // Clients
    if (clientsRes.status === 'fulfilled' && clientsRes.value.data) {
      const rows = clientsRes.value.data;
      ctx.totalClients = rows.length;
      ctx.topClients = rows.slice(0, 5).map((r: any) =>
        [r.first_name, r.last_name].filter(Boolean).join(' ') || r.company || 'Client'
      );
    }

    // Leads
    if (leadsRes.status === 'fulfilled' && leadsRes.value.data) {
      const rows = leadsRes.value.data;
      ctx.totalLeads = rows.length;
      ctx.recentLeads = rows.slice(0, 5).map((r: any) => {
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.company || 'Lead';
        return `${name} (${r.stage || 'new'})`;
      });
    }

    // Jobs
    if (jobsRes.status === 'fulfilled' && jobsRes.value.data) {
      const rows = jobsRes.value.data;
      ctx.activeJobs = rows.filter((r: any) => r.status === 'scheduled' || r.status === 'in_progress').length;
      ctx.totalRevenue = rows.reduce((sum: number, r: any) => sum + (r.total_cents || 0), 0) / 100;
    }

    // Pipeline
    if (pipelineRes.status === 'fulfilled' && pipelineRes.value.data) {
      const rows = pipelineRes.value.data;
      const stages: Record<string, { count: number; value: number }> = {};
      for (const r of rows as any[]) {
        const s = r.stage || 'unknown';
        if (!stages[s]) stages[s] = { count: 0, value: 0 };
        stages[s].count++;
        stages[s].value += Number(r.value || 0);
      }
      ctx.pipelineSummary = Object.entries(stages)
        .map(([stage, data]) => `${stage}: ${data.count} deals ($${data.value.toLocaleString()})`)
        .join(', ');
    }

    // Teams
    if (teamsRes.status === 'fulfilled' && teamsRes.value.data) {
      ctx.teamNames = (teamsRes.value.data as any[]).map((t) => t.name);
    }

    // Generations
    if (generationsRes.status === 'fulfilled' && generationsRes.value.data) {
      ctx.recentGenerations = (generationsRes.value.data as any[]).map((g) =>
        `${g.output_type}: "${g.title}" (${g.model || 'unknown'})${g.prompt ? ` — prompt: "${g.prompt.slice(0, 80)}..."` : ''}`
      );
    }

    // Credits
    if (creditsRes.status === 'fulfilled' && creditsRes.value.data) {
      ctx.creditBalance = Number(creditsRes.value.data.credits_balance || 0);
    }

    // Top prompts
    if (topPromptsRes.status === 'fulfilled') {
      ctx.topPrompts = topPromptsRes.value as PromptPerformance[];
    }

    // Analytics
    if (analyticsRes.status === 'fulfilled') {
      ctx.analytics = analyticsRes.value as any;
    }

    // Style DNA
    if (styleDnaRes.status === 'fulfilled') {
      ctx.styleDna = styleDnaRes.value as StyleDnaRecord[];
    }
  } catch {
    // Non-blocking — return partial context
  }

  return ctx;
}

export function buildContextBlock(ctx: LiaContext): string {
  const lines: string[] = [];

  lines.push('=== YOUR BUSINESS CONTEXT ===');

  if (ctx.company) {
    lines.push(`Company: ${ctx.company}`);
    if (ctx.industry) lines.push(`Industry: ${ctx.industry}`);
    if (ctx.companyWebsite) lines.push(`Website: ${ctx.companyWebsite}`);
  }

  lines.push(`\nClients: ${ctx.totalClients} total`);
  if (ctx.topClients.length > 0) {
    lines.push(`Top clients: ${ctx.topClients.join(', ')}`);
  }

  lines.push(`Leads: ${ctx.totalLeads} active`);
  if (ctx.recentLeads.length > 0) {
    lines.push(`Recent leads: ${ctx.recentLeads.join(', ')}`);
  }

  lines.push(`Active jobs: ${ctx.activeJobs}`);
  lines.push(`Total revenue: $${ctx.totalRevenue.toLocaleString()}`);

  if (ctx.pipelineSummary) {
    lines.push(`\nPipeline: ${ctx.pipelineSummary}`);
  }

  if (ctx.teamNames.length > 0) {
    lines.push(`Teams: ${ctx.teamNames.join(', ')}`);
  }

  lines.push(`\nDirector Panel credits: ${ctx.creditBalance}`);

  if (ctx.recentGenerations.length > 0) {
    lines.push(`\nRecent AI generations:`);
    for (const g of ctx.recentGenerations) {
      lines.push(`  - ${g}`);
    }
  }

  // Analytics
  if (ctx.analytics.totalGenerations > 0) {
    lines.push(`\n=== GENERATION ANALYTICS ===`);
    lines.push(`Total generations: ${ctx.analytics.totalGenerations}`);
    lines.push(`Downloads: ${ctx.analytics.totalDownloads}`);
    lines.push(`Prompt reuses: ${ctx.analytics.totalReuses}`);
    lines.push(`Favorites: ${ctx.analytics.favoriteCount}`);
    if (ctx.analytics.topModel) lines.push(`Most used model: ${ctx.analytics.topModel}`);
  }

  // Top performing prompts (learning from what works)
  if (ctx.topPrompts.length > 0) {
    lines.push(`\n=== TOP PERFORMING PROMPTS (learn from these) ===`);
    lines.push(`These prompts were downloaded, reused, or favorited the most. Use them as reference for quality and style.`);
    for (const p of ctx.topPrompts.slice(0, 5)) {
      lines.push(`  - [${p.model}] (used ${p.usage_count}x): "${p.prompt.slice(0, 150)}${p.prompt.length > 150 ? '...' : ''}"`);
    }
    lines.push(`Build on these patterns. Match the level of detail, structure, and specificity.`);
  }

  // Style DNA (brand styles)
  if (ctx.styleDna.length > 0) {
    lines.push(`\n=== SAVED BRAND STYLES (Style DNA) ===`);
    lines.push(`The user has ${ctx.styleDna.length} saved style(s). Reference these for visual consistency.`);
    for (const style of ctx.styleDna.slice(0, 5)) {
      lines.push(`  - "${style.name}": ${style.description || 'No description'}`);
      if (style.color_palette.length > 0) lines.push(`    Colors: ${style.color_palette.join(', ')}`);
      if (style.lighting) lines.push(`    Lighting: ${style.lighting}`);
      if (style.contrast) lines.push(`    Contrast: ${style.contrast}`);
      if (style.camera_style) lines.push(`    Camera: ${style.camera_style}`);
      if (style.brand_descriptors.length > 0) lines.push(`    Brand feel: ${style.brand_descriptors.join(', ')}`);
      if (style.visual_rules.length > 0) lines.push(`    Rules: ${style.visual_rules.slice(0, 3).join(' | ')}`);
    }
    lines.push(`When generating prompts, incorporate these styles unless the user requests something different.`);
  }

  lines.push('\n=== USE THIS CONTEXT ===');
  lines.push('- Reference the company name and industry when suggesting creative direction');
  lines.push('- Suggest content that fits their client base');
  lines.push('- Consider their budget (credit balance) when recommending models');
  lines.push('- Build on their recent generations for consistency');
  lines.push('- Suggest campaigns targeting their leads/pipeline');

  return lines.join('\n');
}
