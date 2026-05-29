/**
 * Visual mockups for each premium feature shown inside ExploreFeaturesModal.
 * Pure CSS/SVG — no external assets. Each mockup is a small, realistic-looking
 * preview of what the feature actually does in the app.
 */
import React from 'react';
import { MessageSquare, Bot, MapPin, GraduationCap, Code, Mic, CheckCircle2, Trophy, DollarSign, Play } from 'lucide-react';

interface MockupProps {
  isFr: boolean;
}

// ── 1. SMS — two-way conversation mockup ──────────────────────────
export function SmsMockup({ isFr }: MockupProps) {
  return (
    <div className="bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950 p-4">
      <div className="max-w-sm mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden border border-slate-200 dark:border-slate-700">
        {/* Phone-like header */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
            JD
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-slate-900 dark:text-white">John Dawson</p>
            <p className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> {isFr ? 'En ligne' : 'Active now'}
            </p>
          </div>
          <MessageSquare size={14} className="text-slate-400" />
        </div>
        {/* Messages */}
        <div className="p-4 space-y-2.5 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-white dark:bg-slate-700 rounded-2xl rounded-tl-md px-3 py-2 shadow-sm">
              <p className="text-[11px] text-slate-900 dark:text-white">
                {isFr ? 'Salut! Vous êtes encore disponible pour le lavage de vitres lundi?' : 'Hi! Are you still available for window cleaning Monday?'}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <div className="max-w-[80%] bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl rounded-tr-md px-3 py-2 shadow-sm">
              <p className="text-[11px]">
                {isFr ? 'Oui! 9h confirmé. Votre devis #2024-08 est joint 👍' : 'Yes! 9am confirmed. Quote #2024-08 attached 👍'}
              </p>
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-white dark:bg-slate-700 rounded-2xl rounded-tl-md px-3 py-2 shadow-sm">
              <p className="text-[11px] text-slate-900 dark:text-white">
                {isFr ? 'Parfait, merci! 🙏' : 'Perfect, thanks! 🙏'}
              </p>
            </div>
          </div>
        </div>
        {/* Composer */}
        <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center gap-2">
          <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full px-3 py-1.5">
            <p className="text-[10px] text-slate-400">{isFr ? 'Répondre…' : 'Reply…'}</p>
          </div>
          <button className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 2. Lume AI Agent — voice transcript mockup ────────────────────
export function AiMockup({ isFr }: MockupProps) {
  return (
    <div className="bg-gradient-to-b from-violet-50 to-fuchsia-50 dark:from-violet-950/40 dark:to-fuchsia-950/40 p-4">
      <div className="max-w-sm mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden border border-violet-200 dark:border-violet-700/50">
        {/* AI header */}
        <div className="px-4 py-3 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
            <Bot size={15} strokeWidth={2.2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold">Lume Agent</p>
            <p className="text-[10px] text-white/80">{isFr ? 'IA · Connectée' : 'AI · Connected'}</p>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-1 h-3 rounded-full bg-white/70 animate-pulse" />
            <div className="w-1 h-4 rounded-full bg-white/70 animate-pulse" style={{ animationDelay: '0.15s' }} />
            <div className="w-1 h-2.5 rounded-full bg-white/70 animate-pulse" style={{ animationDelay: '0.3s' }} />
            <div className="w-1 h-4 rounded-full bg-white/70 animate-pulse" style={{ animationDelay: '0.45s' }} />
          </div>
        </div>
        {/* Voice transcript */}
        <div className="p-4 space-y-3 bg-white dark:bg-slate-800">
          <div className="flex items-start gap-2">
            <div className="shrink-0 w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
              <Mic size={11} className="text-violet-600" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-0.5">{isFr ? 'Vous' : 'You'}</p>
              <p className="text-[12px] text-slate-700 dark:text-slate-200 italic">
                {isFr
                  ? '"Envoie un suivi à John pour le devis 2024-08"'
                  : '"Send John a follow-up about quote 2024-08"'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <Bot size={11} className="text-white" strokeWidth={2.5} />
            </div>
            <div className="flex-1">
              <p className="text-[10px] uppercase font-bold text-violet-600 tracking-wider mb-0.5">Lume</p>
              <p className="text-[12px] text-slate-900 dark:text-white font-medium">
                {isFr
                  ? 'C\'est fait ✓ J\'ai envoyé un email + SMS à John à propos du devis #2024-08.'
                  : 'Done ✓ Sent both an email and SMS to John about quote #2024-08.'}
              </p>
              <div className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-emerald-600 font-medium bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-md">
                <CheckCircle2 size={10} />
                {isFr ? '2 actions effectuées' : '2 actions completed'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 3. D2D — territory map mockup ─────────────────────────────────
export function D2dMockup({ isFr }: MockupProps) {
  return (
    <div className="bg-gradient-to-b from-emerald-50 to-cyan-50 dark:from-emerald-950/40 dark:to-cyan-950/40 p-4">
      <div className="max-w-sm mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden border border-emerald-200 dark:border-emerald-700/50">
        {/* Map area */}
        <div className="relative h-44 bg-gradient-to-br from-emerald-100 via-teal-100 to-cyan-100 dark:from-emerald-900/30 dark:via-teal-900/30 dark:to-cyan-900/30 overflow-hidden">
          {/* Grid pattern */}
          <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-emerald-600" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
          {/* Streets */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 180" preserveAspectRatio="none">
            <path d="M0 60 Q150 70 300 50" stroke="white" strokeWidth="6" fill="none" opacity="0.7" />
            <path d="M0 120 Q150 110 300 130" stroke="white" strokeWidth="6" fill="none" opacity="0.7" />
            <path d="M80 0 L100 180" stroke="white" strokeWidth="5" fill="none" opacity="0.6" />
            <path d="M200 0 L220 180" stroke="white" strokeWidth="5" fill="none" opacity="0.6" />
          </svg>
          {/* Pins */}
          <div className="absolute top-[20%] left-[25%] w-6 h-6 rounded-full bg-emerald-500 ring-4 ring-emerald-500/30 flex items-center justify-center text-white text-[9px] font-bold shadow-lg">S</div>
          <div className="absolute top-[55%] left-[60%] w-6 h-6 rounded-full bg-blue-500 ring-4 ring-blue-500/30 flex items-center justify-center text-white text-[9px] font-bold shadow-lg">M</div>
          <div className="absolute top-[30%] left-[75%] w-6 h-6 rounded-full bg-amber-500 ring-4 ring-amber-500/30 flex items-center justify-center text-white text-[9px] font-bold shadow-lg">A</div>
          <div className="absolute bottom-[15%] left-[35%] w-6 h-6 rounded-full bg-rose-500 ring-4 ring-rose-500/30 flex items-center justify-center text-white text-[9px] font-bold shadow-lg">T</div>
          {/* Mini legend */}
          <div className="absolute top-2 right-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur rounded-lg px-2 py-1 shadow-md">
            <p className="text-[8px] uppercase tracking-wider font-bold text-slate-500">{isFr ? 'Reps actifs' : 'Active reps'}</p>
            <p className="text-[14px] font-extrabold text-emerald-600 leading-none">4</p>
          </div>
        </div>
        {/* Leaderboard preview */}
        <div className="p-3 bg-white dark:bg-slate-800">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1.5">
              <Trophy size={11} className="text-amber-500" />
              {isFr ? 'Top reps cette semaine' : 'Top reps this week'}
            </p>
          </div>
          <div className="space-y-1.5">
            {[
              { rank: 1, name: 'Sarah', deals: 12, amount: '$8,450', color: 'bg-emerald-500' },
              { rank: 2, name: 'Marc', deals: 9, amount: '$6,120', color: 'bg-blue-500' },
              { rank: 3, name: 'Alex', deals: 7, amount: '$4,800', color: 'bg-amber-500' },
            ].map((rep) => (
              <div key={rep.rank} className="flex items-center gap-2.5">
                <div className={`shrink-0 w-5 h-5 rounded-full ${rep.color} flex items-center justify-center text-white text-[10px] font-bold`}>
                  {rep.rank}
                </div>
                <span className="flex-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">{rep.name}</span>
                <span className="text-[10px] text-slate-500 tabular-nums">{rep.deals} {isFr ? 'ventes' : 'deals'}</span>
                <span className="text-[11px] font-bold text-emerald-600 tabular-nums">{rep.amount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 4. Courses / LMS mockup ───────────────────────────────────────
export function CoursesMockup({ isFr }: MockupProps) {
  return (
    <div className="bg-gradient-to-b from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 p-4">
      <div className="max-w-sm mx-auto space-y-2">
        {/* Course card */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg overflow-hidden border border-amber-200 dark:border-amber-700/50">
          {/* Video thumbnail */}
          <div className="relative h-24 bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 flex items-center justify-center">
            <div className="absolute inset-0 opacity-20" aria-hidden="true">
              <svg className="absolute -top-4 -right-4 w-32 h-32" viewBox="0 0 200 200" fill="none">
                <path fill="white" d="M44.7,-71.8C58.7,-65.1,71.1,-54,77.4,-40.3C83.7,-26.7,84,-10.4,80.7,4.6C77.4,19.7,70.5,33.6,60.8,44.7C51.1,55.9,38.6,64.3,24.6,69.4C10.6,74.6,-4.9,76.5,-19.2,73.1C-33.6,69.7,-46.7,61,-57.4,49.4C-68.1,37.7,-76.4,23.1,-78,7.5C-79.6,-8.2,-74.6,-24.9,-66,-39.1C-57.4,-53.3,-45.4,-65.1,-31.8,-71.6C-18.3,-78.2,-3.2,-79.5,11.4,-77.6C26,-75.7,38.7,-78.4,44.7,-71.8Z" transform="translate(100 100)" />
              </svg>
            </div>
            <div className="relative w-11 h-11 rounded-full bg-white/95 flex items-center justify-center shadow-lg">
              <Play size={16} className="text-orange-600 ml-0.5" fill="currentColor" />
            </div>
            <div className="absolute bottom-1.5 right-2 bg-black/60 backdrop-blur text-white text-[9px] font-bold px-1.5 py-0.5 rounded">12:45</div>
          </div>
          <div className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[8px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                {isFr ? 'Sécurité' : 'Safety'}
              </span>
              <span className="text-[8px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                {isFr ? 'Obligatoire' : 'Required'}
              </span>
            </div>
            <p className="text-[12px] font-bold text-slate-900 dark:text-white leading-tight">
              {isFr ? 'Sécurité lavage de vitres 101' : 'Window cleaning safety 101'}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex -space-x-1.5">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 ring-2 ring-white" />
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 ring-2 ring-white" />
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 ring-2 ring-white" />
                <div className="w-5 h-5 rounded-full bg-slate-200 ring-2 ring-white flex items-center justify-center text-[8px] font-bold text-slate-600">+9</div>
              </div>
              <p className="text-[10px] text-slate-500 font-medium">
                12/15 {isFr ? 'complété' : 'completed'}
              </p>
            </div>
            {/* Progress bar */}
            <div className="mt-2 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full" style={{ width: '80%' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 5. API mockup ─────────────────────────────────────────────────
export function ApiMockup({ isFr }: MockupProps) {
  return (
    <div className="bg-gradient-to-b from-slate-100 to-zinc-100 dark:from-slate-900 dark:to-zinc-950 p-4">
      <div className="max-w-sm mx-auto bg-slate-900 dark:bg-black rounded-2xl shadow-lg overflow-hidden border border-slate-700">
        {/* Editor chrome */}
        <div className="px-3 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-2">
          <div className="flex gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          </div>
          <p className="text-[10px] text-slate-400 font-mono ml-2">curl</p>
          <div className="ml-auto flex items-center gap-1 text-[9px] text-emerald-400 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
            201
          </div>
        </div>
        {/* Code */}
        <div className="p-3 font-mono text-[10px] leading-relaxed">
          <p><span className="text-purple-400">POST</span> <span className="text-cyan-300">https://api.lume.app/v1/clients</span></p>
          <p className="text-slate-500">Authorization: <span className="text-amber-300">Bearer sk_live_•••</span></p>
          <p className="mt-2 text-slate-300">{'{'}</p>
          <p className="text-slate-300 pl-3"><span className="text-cyan-300">"name"</span>: <span className="text-emerald-300">"John Dawson"</span>,</p>
          <p className="text-slate-300 pl-3"><span className="text-cyan-300">"email"</span>: <span className="text-emerald-300">"john@example.com"</span>,</p>
          <p className="text-slate-300 pl-3"><span className="text-cyan-300">"phone"</span>: <span className="text-emerald-300">"+1-514-555-0142"</span></p>
          <p className="text-slate-300">{'}'}</p>
          <div className="mt-3 pt-3 border-t border-slate-700">
            <p className="text-emerald-400 font-bold">✓ 201 Created</p>
            <p className="text-slate-500 mt-1">{isFr ? '→ webhook envoyé à votre endpoint' : '→ webhook fired to your endpoint'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Lookup table: flag → mockup component */
export const FEATURE_MOCKUPS: Record<string, React.FC<MockupProps>> = {
  includes_sms: SmsMockup,
  includes_ai: AiMockup,
  includes_d2d: D2dMockup,
  includes_courses: CoursesMockup,
  includes_api: ApiMockup,
};
