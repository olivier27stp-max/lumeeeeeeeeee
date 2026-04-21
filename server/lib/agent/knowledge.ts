/* ═══════════════════════════════════════════════════════════════
   Agent Knowledge — CRM domain knowledge for system prompts

   Provides:
   - buildKnowledge(language, orgProfile?) — static CRM knowledge block
   - loadOrgKnowledge(supabase, orgId, language) — org-specific knowledge from DB
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Build static CRM knowledge block ─────────────────────────
export function buildKnowledge(
  language: 'en' | 'fr',
  orgProfile?: {
    industry?: string;
    tone?: string;
    avgJobValue?: number;
    teamCount?: number;
  }
): string {
  const fr = language === 'fr';

  const crmKnowledge = fr
    ? `# CONNAISSANCES CRM
Tu es Mr Lume, l'assistant IA de Lume CRM — un CRM concu pour les entreprises de services.

## DOMAINES D'EXPERTISE
- **Gestion des clients**: contacts, entreprises, historique des interactions
- **Soumissions & Factures**: creation, suivi, envoi, paiements
- **Gestion d'equipe**: assignation, disponibilite, competences, charge de travail
- **Pipeline de ventes**: opportunites, etapes, previsions, taux de conversion
- **Planification**: calendrier, rendez-vous, taches, rappels
- **Rapports**: performance, revenus, tendances, KPIs

## REGLES METIER
- Les soumissions doivent etre approuvees avant d'etre envoyees au client
- Les factures suivent le flux: brouillon -> envoyee -> payee
- Les assignations d'equipe tiennent compte des competences et de la disponibilite
- Les prix doivent considerer les couts, marges et prix du marche`
    : `# CRM KNOWLEDGE
You are Mr Lume, the AI assistant of Lume CRM — a CRM designed for service businesses.

## AREAS OF EXPERTISE
- **Client management**: contacts, companies, interaction history
- **Quotes & Invoices**: creation, tracking, sending, payments
- **Team management**: assignment, availability, skills, workload
- **Sales pipeline**: opportunities, stages, forecasts, conversion rates
- **Scheduling**: calendar, appointments, tasks, reminders
- **Reports**: performance, revenue, trends, KPIs

## BUSINESS RULES
- Quotes must be approved before being sent to the client
- Invoices follow the flow: draft -> sent -> paid
- Team assignments consider skills and availability
- Pricing should consider costs, margins and market rates`;

  // Org-specific context if available
  let orgContext = '';
  if (orgProfile) {
    const parts: string[] = [];
    if (orgProfile.industry) {
      parts.push(fr
        ? `Industrie du client: ${orgProfile.industry}`
        : `Client industry: ${orgProfile.industry}`);
    }
    if (orgProfile.tone) {
      parts.push(fr
        ? `Ton prefere: ${orgProfile.tone}`
        : `Preferred tone: ${orgProfile.tone}`);
    }
    if (orgProfile.avgJobValue) {
      parts.push(fr
        ? `Valeur moyenne d'un contrat: ${orgProfile.avgJobValue}$`
        : `Average job value: $${orgProfile.avgJobValue}`);
    }
    if (orgProfile.teamCount) {
      parts.push(fr
        ? `Taille de l'equipe: ${orgProfile.teamCount} membres`
        : `Team size: ${orgProfile.teamCount} members`);
    }
    if (parts.length > 0) {
      orgContext = `\n\n${fr ? '## PROFIL DE L\'ORGANISATION' : '## ORGANIZATION PROFILE'}\n${parts.join('\n')}`;
    }
  }

  return crmKnowledge + orgContext;
}

// ── Load org-specific knowledge from database ────────────────
export async function loadOrgKnowledge(
  supabase: SupabaseClient,
  orgId: string,
  language: 'en' | 'fr'
): Promise<string> {
  const fr = language === 'fr';

  // Load knowledge entries from the training/knowledge table
  const { data: entries } = await supabase
    .from('org_knowledge')
    .select('title, content, domain, language')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('priority', { ascending: false })
    .limit(10);

  if (!entries || entries.length === 0) return '';

  // Filter by language preference, fall back to any language
  const langEntries = entries.filter(e => !e.language || e.language === language);
  const finalEntries = langEntries.length > 0 ? langEntries : entries;

  const sections = finalEntries.map(e =>
    `### ${e.title}\n${e.content}`
  ).join('\n\n');

  return `\n${fr ? '## CONNAISSANCES SPECIFIQUES' : '## ORGANIZATION KNOWLEDGE'}\n${sections}`;
}
