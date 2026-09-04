/* ═══════════════════════════════════════════════════════════════
   Settings → API & MCP
   ─────────────────────────────────────────────────────────────
   Réduit à une seule mission : brancher un assistant IA (Claude…)
   sur le CRM de cette organisation via le serveur MCP.

   La gestion des clés d'accès machine et des applications OAuth
   connectées a été RETIRÉE de cette page (décision produit
   2026-09-04) : elle noyait la seule action utile. Le serveur MCP
   s'authentifie par le compte Lume de l'utilisateur (OAuth), aucune
   clé à copier. Les routes /api/api-keys et /api/oauth existent
   toujours côté serveur ; elles ne sont simplement plus exposées ici.

   Design « Lume × Claude » : un pont entre les deux logos, l'adresse
   à copier, trois étapes, et ce que l'assistant peut faire. Couleurs
   issues des tokens du CRM.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, BarChart3, CalendarDays, Plus, FileText, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { getMcpInfo, type McpInfo } from '../../lib/mcpApi';

// Logo Claude : image officielle déposée dans /public par le propriétaire.
// Tant qu'elle n'est pas là, on retombe sur une marque neutre (voir ClaudeMark).
const CLAUDE_LOGO_URL = '/claude-logo.svg';
// Image de fond optionnelle du hero (générée par le propriétaire). Absente =
// dégradé de marque uniquement.
const HERO_BG_URL = '/mcp-hero-bg.webp';

function CopyAddress({ value, fr }: { value: string; fr: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          toast.error(fr ? 'Copie impossible' : 'Copy failed');
        }
      }}
      className="shrink-0 inline-flex items-center gap-2 rounded-r-xl bg-text-primary text-surface-card px-5 text-[13px] font-bold hover:bg-primary-hover transition-colors"
    >
      {copied
        ? <><Check size={15} /> {fr ? 'Copié' : 'Copied'}</>
        : <><Copy size={15} /> {fr ? 'Copier' : 'Copy'}</>}
    </button>
  );
}

/** Marque Claude de repli si le logo officiel n'est pas encore déposé. */
function ClaudeMark() {
  const [broken, setBroken] = useState(false);
  if (!broken) {
    return (
      <img
        src={CLAUDE_LOGO_URL}
        alt="Claude"
        onError={() => setBroken(true)}
        className="w-9 h-9 object-contain"
      />
    );
  }
  return (
    <svg viewBox="0 0 36 36" className="w-8 h-8 text-[#d97757]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <path d="M18 5v7M18 24v7M5 18h7M24 18h7M9 9l4.5 4.5M22.5 22.5L27 27M27 9l-4.5 4.5M13.5 22.5L9 27" />
      <circle cx="18" cy="18" r="3.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function ApiMcpSettings() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [mcp, setMcp] = useState<McpInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [heroBg, setHeroBg] = useState(false);

  useEffect(() => {
    getMcpInfo().then(setMcp).catch(() => setMcp(null)).finally(() => setLoading(false));
  }, []);

  // Précharge l'image de fond : on ne l'affiche que si elle existe vraiment.
  useEffect(() => {
    const img = new Image();
    img.onload = () => setHeroBg(true);
    img.src = HERO_BG_URL;
  }, []);

  const mcpUrl = mcp?.url || '';
  const ready = !!mcp?.enabled && !!mcpUrl;

  const steps = fr
    ? [
        { t: 'Ouvre Claude', d: 'Dans l’app ou sur claude.ai : Réglages › Connecteurs.' },
        { t: 'Ajoute un connecteur personnalisé', d: 'Colle l’adresse ci-dessus, puis valide.' },
        { t: 'Connecte-toi avec Lume', d: 'Autorise l’accès dans la fenêtre. C’est fait — pose ta première question.' },
      ]
    : [
        { t: 'Open Claude', d: 'In the app or on claude.ai: Settings › Connectors.' },
        { t: 'Add a custom connector', d: 'Paste the address above, then confirm.' },
        { t: 'Sign in with Lume', d: 'Authorize access in the popup. Done — ask your first question.' },
      ];

  const cans = fr
    ? [
        { icon: BarChart3, t: 'Consulter tes chiffres', d: '« Mon chiffre d’affaires ce mois-ci ? »' },
        { icon: CalendarDays, t: 'Lire ton horaire', d: '« Qu’est-ce que j’ai demain ? »' },
        { icon: Plus, t: 'Créer jobs & clients', d: 'Si tu l’autorises à la connexion' },
        { icon: FileText, t: 'Préparer devis & relances', d: 'Brouillons et SMS, à ta demande' },
      ]
    : [
        { icon: BarChart3, t: 'Check your numbers', d: '“What’s my revenue this month?”' },
        { icon: CalendarDays, t: 'Read your schedule', d: '“What do I have tomorrow?”' },
        { icon: Plus, t: 'Create jobs & clients', d: 'If you allow it at connection' },
        { icon: FileText, t: 'Draft quotes & reminders', d: 'Drafts and SMS, on request' },
      ];

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── Hero « Lume × Claude » ──
         L'illustration porte déjà le titre « LUME × Claude » et l'histoire du
         pont : on la laisse parler. Si le fichier public/mcp-hero-bg.webp est
         absent, on retombe sur un bandeau de marque + titre texte. */}
      {heroBg ? (
        <div className="relative overflow-hidden rounded-2xl border border-outline bg-surface-card">
          <img
            src={HERO_BG_URL}
            alt={fr ? 'Lume connecté à Claude' : 'Lume connected to Claude'}
            className="w-full block dark:brightness-95"
          />
          {/* Voile bas → le sous-titre reste lisible par-dessus l'illustration claire. */}
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-surface-card via-surface-card/85 to-transparent" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 px-6 pb-5 pt-8 text-center">
            <p className="text-sm text-text-secondary max-w-md mx-auto leading-relaxed">
              {fr
                ? 'Parle à ton entreprise en langage naturel. Colle une adresse dans Claude, connecte-toi avec ton compte Lume — aucune clé à gérer.'
                : 'Talk to your business in plain language. Paste one address into Claude, sign in with your Lume account — no keys to manage.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-outline bg-surface-card">
          <div className="absolute inset-0 bg-gradient-to-br from-accent-light via-surface-card to-surface-card" aria-hidden />
          <div className="relative px-6 pt-8 pb-7 text-center">
            <div className="flex items-center justify-center mb-5">
              <div className="w-16 h-16 rounded-2xl bg-surface-card border border-outline shadow-sm grid place-items-center z-10">
                <img src="/lume-logo-v2.png" alt="Lume" className="w-9 h-9 object-contain dark:invert" />
              </div>
              <div className="w-14 h-0.5 bg-gradient-to-r from-accent to-[#d97757] relative">
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-surface-card border border-outline grid place-items-center text-[11px] font-bold text-text-secondary z-20">
                  ×
                </span>
              </div>
              <div className="w-16 h-16 rounded-2xl bg-surface-card border border-outline shadow-sm grid place-items-center z-10">
                <ClaudeMark />
              </div>
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-text-primary">
              {fr ? 'Branche ton CRM à Claude' : 'Connect your CRM to Claude'}
            </h2>
            <p className="mt-2 text-sm text-text-secondary max-w-md mx-auto leading-relaxed">
              {fr
                ? 'Parle à ton entreprise en langage naturel. Colle une adresse dans Claude, connecte-toi avec ton compte Lume — aucune clé à gérer.'
                : 'Talk to your business in plain language. Paste one address into Claude, sign in with your Lume account — no keys to manage.'}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-24 rounded-2xl bg-surface-tertiary animate-pulse" />
      ) : !ready ? (
        <div className="section-card p-5 text-[13px] text-text-secondary">
          {fr
            ? 'Le serveur MCP n’est pas encore activé pour ton organisation. Contacte le support pour l’ouvrir.'
            : 'The MCP server is not enabled for your organization yet. Contact support to turn it on.'}
        </div>
      ) : (
        <>
          {/* ── Adresse MCP ── */}
          <div className="section-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
                {fr ? 'Adresse du serveur MCP' : 'MCP server address'}
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-success-light px-2.5 py-0.5 text-[11px] font-bold text-success">
                <Check size={11} strokeWidth={3} /> {fr ? 'Actif' : 'Active'}
              </span>
            </div>
            <div className="flex items-stretch">
              <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-l-xl border border-r-0 border-outline bg-surface-secondary px-3.5 py-3 font-mono text-[12.5px] text-text-primary flex items-center">
                {mcpUrl}
              </code>
              <CopyAddress value={mcpUrl} fr={fr} />
            </div>
            <p className="text-[12.5px] text-text-secondary leading-relaxed">
              {fr
                ? 'Cette adresse est propre à ton entreprise. La connexion passe par ton compte Lume et respecte tes permissions.'
                : 'This address is unique to your business. The connection goes through your Lume account and respects your permissions.'}
            </p>
          </div>

          {/* ── Étapes ── */}
          <div className="section-card p-5">
            <p className="text-[13px] font-bold text-text-primary mb-3">
              {fr ? 'Trois étapes, une minute' : 'Three steps, one minute'}
            </p>
            <div className="divide-y divide-outline/70">
              {steps.map((s, i) => (
                <div key={i} className="flex gap-3.5 py-3 first:pt-0 last:pb-0">
                  <div className="shrink-0 w-6 h-6 rounded-full bg-text-primary text-surface-card grid place-items-center text-[12px] font-extrabold">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-text-primary">{s.t}</p>
                    <p className="text-[13px] text-text-secondary">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Ce que l'assistant peut faire ── */}
          <div className="space-y-3">
            <p className="text-[13px] font-bold text-text-primary px-1">
              {fr ? 'Ce que l’assistant pourra faire' : 'What the assistant can do'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {cans.map(({ icon: Icon, t, d }) => (
                <div key={t} className="flex gap-3 items-start section-card p-3.5">
                  <div className="shrink-0 w-8 h-8 rounded-lg bg-accent-light text-accent grid place-items-center">
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-text-primary leading-tight">{t}</p>
                    <p className="text-[11.5px] text-text-tertiary mt-0.5">{d}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-center gap-2 text-[12px] text-text-secondary text-center pt-1">
              <ShieldCheck size={14} className="text-success shrink-0" />
              {fr
                ? 'Chaque action est tracée à ton nom. Rien ne peut être supprimé ni encaissé.'
                : 'Every action is logged under your name. Nothing can be deleted or charged.'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
