/**
 * Accueil marketing « aperçu » — version Ciel (septembre 2026).
 *
 * Remplace `Home.tsx` comme page d'index. L'ancienne page reste dans le
 * dépôt, volontairement non routée, pour pouvoir y revenir.
 *
 * Structure :
 *   1. Hero compact (titre i18n existant, sous-titre, deux boutons, trois faits)
 *   2. Aperçu interactif de l'app : quatre onglets (Accueil, Calendrier,
 *      Messages, Finances) qui affichent de vraies captures de l'app
 *      (`/public/landing/apercu-*.webp`, prises sur staging avec des données
 *      de démo, org « Vision Lavage »).
 *   3. Quatre tuiles de fonctionnalités animées ; un clic ouvre l'onglet
 *      correspondant dans l'aperçu.
 *   4. Étude de cas Vision Lavage : une journée avant et avec Lume.
 *
 * Le panneau Lumi (assistant vendeur) et le décalage de la page à sa
 * gauche sont gérés par `MarketingLayout` / `LumiAgent`, pas ici.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import BookDemoForm from '../../components/marketing/BookDemoForm';
import { useTranslation } from '../../i18n';
import { usePageMeta, HOME_META } from '../../hooks/usePageMeta';
import { StopList, Pillars, Roles, LumiSection, StatsBand, Flow, PlansTeaser, Security, Faq, SECTIONS_CSS } from './homeApercuSections';

type Tab = 'accueil' | 'calendrier' | 'messages' | 'finances';

const TABS: { key: Tab; fr: string; en: string; url: string }[] = [
  { key: 'accueil', fr: 'Accueil', en: 'Home', url: 'app.lumecrm.net/accueil' },
  { key: 'calendrier', fr: 'Calendrier', en: 'Calendar', url: 'app.lumecrm.net/calendrier' },
  { key: 'messages', fr: 'Messages', en: 'Messages', url: 'app.lumecrm.net/messages' },
  { key: 'finances', fr: 'Finances', en: 'Finances', url: 'app.lumecrm.net/finances' },
];

/* Souligné à main levée, identique à celui de l'ancien hero. */
function Underline({ color }: { color: string }) {
  return (
    <svg className={`absolute -bottom-1 left-0 w-full ${color}`} height="6" viewBox="0 0 120 8" fill="none" preserveAspectRatio="none" aria-hidden="true">
      <path d="M2 5.5C12 2.5 22 7 32 4S52 1 62 4.5S82 7.5 92 4S112 2 118 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/* Deux membres d'une équipe type, avec les mêmes avatars DiceBear « notionists »
   que dans l'app (UnifiedAvatar). Personas, pas des clients réels. */
const PEOPLE = [
  { seed: 'Julie Tremblay', side: 'l', name: 'Julie', role: { fr: 'Répartition', en: 'Dispatch' }, quote: { fr: '« 4 min pour planifier ma journée. »', en: '“4 minutes to plan my day.”' } },
  { seed: 'Antoine Roy', side: 'r', name: 'Antoine', role: { fr: 'Terrain', en: 'Field' }, quote: { fr: '« Je vois mes jobs, je pars. »', en: '“I see my jobs, I go.”' } },
] as const;
const dicebear = (seed: string) => `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&size=104&backgroundColor=f5f5f5&radius=50`;

export default function HomeApercu() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  usePageMeta(HOME_META[language]);
  const h = t.marketingSite.hero;
  const [demoOpen, setDemoOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('accueil');
  const frameRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const onHeroMove = (e: MouseEvent<HTMLElement>) => {
    const el = heroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', String((e.clientX - r.left) / r.width - 0.5));
    el.style.setProperty('--py', String((e.clientY - r.top) / r.height - 0.5));
  };
  const onHeroLeave = () => { heroRef.current?.style.removeProperty('--px'); heroRef.current?.style.removeProperty('--py'); };
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const goTo = useCallback((next: Tab) => {
    setTab(next);
    frameRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [reduceMotion]);

  const before = fr
    ? [
        ['7 h', 'Appels et textos de confirmation faits un par un, depuis le camion, avant la première job.'],
        ['12 h', 'Soumission tapée sur le téléphone entre deux clients. Envoyée le soir, quand on y pense.'],
        ['18 h', 'Les factures de la journée à faire à la maison. Celles de la semaine passée, pas encore relancées.'],
        ['Vendredi', 'Heures de chacun reconstituées de mémoire pour la paie. Deux ou trois heures, chaque semaine.'],
      ]
    : [
        ['7 AM', 'Confirmation calls and texts sent one by one from the truck, before the first job.'],
        ['Noon', 'Quote typed on the phone between two clients. Sent that evening, if remembered.'],
        ['6 PM', "The day's invoices done at home. Last week's still not followed up."],
        ['Friday', "Everyone's hours rebuilt from memory for payroll. Two or three hours, every week."],
      ];
  const after = fr
    ? [
        ['6 h 45', 'Les rappels SMS sont partis la veille. Le brief du matin arrive : jobs, équipes, retards.'],
        ['12 h', "Soumission envoyée de la job, à partir d'un modèle. Le client signe sur son téléphone."],
        ['18 h', 'La facture part quand la job est marquée terminée. Paiement en ligne, relance automatique à J+7.'],
        ['Vendredi', "Feuilles de temps pointées dans l'app, approuvées en cinq minutes. La paie est prête."],
      ]
    : [
        ['6:45 AM', 'SMS reminders went out the night before. The morning brief arrives: jobs, crews, overdue items.'],
        ['Noon', 'Quote sent from the job site, from a template. The client signs on their phone.'],
        ['6 PM', 'The invoice goes out when the job is marked done. Online payment, automatic follow-up at day 7.'],
        ['Friday', 'Timesheets clocked in the app, approved in five minutes. Payroll is ready.'],
      ];

  return (
    <div className="home-apercu">
      <style>{HOME_APERCU_CSS + SECTIONS_CSS}</style>

      {/* ── 1. Hero compact ── */}
      <section className="ha-hero" ref={heroRef} onMouseMove={onHeroMove} onMouseLeave={onHeroLeave}>
        <div className="ha-cloud ha-c1" aria-hidden="true" />
        <div className="ha-cloud ha-c2" aria-hidden="true" />
        {PEOPLE.map((p) => (
          <div key={p.seed} className={`ha-person ha-p-${p.side}`} aria-hidden="true">
            <img src={dicebear(p.seed)} alt="" width={52} height={52} loading="lazy" decoding="async" />
            <div><em>{p.role[language]}</em><b>{p.name}</b><span>{p.quote[language]}</span></div>
          </div>
        ))}
        <div className="ha-head">
          <h1 className="ha-h1">
            <span>{h.titleStopManaging}{' '}<span className="relative inline-block">{h.titleManually}<Underline color="text-red-500" /></span></span>
            <br />
            <span>{h.titleStartScaling}{' '}<span className="relative inline-block">{h.titleAutomatically}<Underline color="text-[#3FAF97]" /></span></span>
          </h1>
          <p className="ha-sub">{h.subtitle}</p>
          <div className="ha-ctas">
            <button type="button" onClick={() => setDemoOpen(true)} className="ha-btn ha-dark group">
              {h.bookDemo}
              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </div>

        {/* ── 2. Aperçu interactif ── */}
        <div className="ha-stage" ref={frameRef}>
          <div className="ha-float ha-f1" aria-hidden="true"><span className="ha-ic">✓</span><div><b>{fr ? 'Soumission #1042 signée' : 'Quote #1042 signed'}</b><span>{fr ? 'Excavation Roy · il y a 2 min' : 'Excavation Roy · 2 min ago'}</span></div></div>
          <div className="ha-float ha-f2" aria-hidden="true"><span className="ha-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></span><div><b>{fr ? 'Soumission #1043 ouverte' : 'Quote #1043 opened'}</b><span>{fr ? 'Prospect · Marc Gagnon · à l\'instant' : 'Prospect · Marc Gagnon · just now'}</span></div></div>
          <div className="ha-devices">
          <div className="ha-frame">
            <div className="ha-bar">
              <i /><i /><i />
              <span className="ha-url">{TABS.find((x) => x.key === tab)?.url}</span>
              <span className="ha-hint">{fr ? 'Clique pour explorer ↗' : 'Click to explore ↗'}</span>
              <div className="ha-seg" role="tablist" aria-label={fr ? "Écrans de l'app" : 'App screens'}>
                {TABS.map((x) => (
                  <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)}>
                    {fr ? x.fr : x.en}
                  </button>
                ))}
              </div>
            </div>
            {TABS.map((x) => (
              <img
                key={x.key}
                src={`/landing/apercu-${x.key}.webp`}
                alt={fr ? `Écran ${x.fr} de Lume` : `Lume ${x.en} screen`}
                width={1800}
                height={1125}
                loading={x.key === 'accueil' ? 'eager' : 'lazy'}
                decoding="async"
                hidden={tab !== x.key}
                className="ha-shot"
              />
            ))}
          </div>
          {/* Téléphone posé sur la droite du screenshot : écran Accueil de l'app iOS
              (maquette scripts/marketing/apercu-accueil-mobile.html). */
          <div className="ha-phone">
            <i className="ha-btn-side ha-btn-power" aria-hidden="true" />
            <i className="ha-btn-side ha-btn-vol1" aria-hidden="true" />
            <i className="ha-btn-side ha-btn-vol2" aria-hidden="true" />
            <div className="ha-phone-body">
              <div className="ha-phone-screen">
                <img
                  src="/landing/apercu-accueil-mobile.webp"
                  alt={fr ? "Écran Accueil de Lume sur téléphone" : 'Lume Home screen on a phone'}
                  width={780}
                  height={1688}
                  decoding="async"
                />
                <span className="ha-island" aria-hidden="true" />
              </div>
            </div>
          </div>
          </div>
        </div>
      </section>

      {/* ── 3. Sous le pli ── */}
      <StopList fr={fr} />
      <Pillars fr={fr} />
      <Roles fr={fr} goTo={goTo} />
      <LumiSection fr={fr} />
      <StatsBand fr={fr} />

      {/* ── 4. Étude de cas ── */}
      <section className="ha-case" aria-label={fr ? 'Étude de cas Vision Lavage' : 'Vision Lavage case study'}>
        <div className="ha-case-head">
          <img className="ha-case-logo" src="/vision-lavage.png" alt="Vision Lavage" width={426} height={68} />
          <div className="ha-case-meta">
            <span>{fr ? 'Client Lume depuis 2025' : 'Lume customer since 2025'}</span>
            <span>{fr ? 'Lavage de vitres et lavage à pression' : 'Window and pressure washing'}</span>
            <span>Québec</span>
          </div>
        </div>
        <blockquote className="ha-quote">
          {fr ? "« On a sauvé l'équivalent du salaire d'une secrétaire à temps plein. »" : '“We saved the equivalent of a full-time secretary’s salary.”'}
          <footer>{fr ? 'Propriétaire, Vision Lavage' : 'Owner, Vision Lavage'}</footer>
        </blockquote>
        <div className="ha-day">
          <div className="ha-col ha-before">
            <h3>{fr ? 'Une journée, avant' : 'A day, before'}</h3>
            <dl>{before.map(([k, v]) => <div key={k} className="contents"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
          <div className="ha-col ha-after">
            <h3>{fr ? 'La même journée, avec Lume' : 'The same day, with Lume'}</h3>
            <dl>{after.map(([k, v]) => <div key={k} className="contents"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
        </div>
        <p className="ha-case-note">{fr ? 'Les horaires décrivent un fonctionnement type, pas une journée précise.' : 'The times describe a typical day, not a specific one.'}</p>
      </section>

      <Flow fr={fr} />
      <PlansTeaser fr={fr} />
      <Security fr={fr} />
      <Faq fr={fr} />

      <BookDemoForm open={demoOpen} onClose={() => setDemoOpen(false)} source="home" />
    </div>
  );
}

/* CSS de la page, à côté du composant : pas de dépendance à la config
   Tailwind, préfixe `ha-` pour ne rien écraser ailleurs. */
const HOME_APERCU_CSS = `
.home-apercu { --forest:#1F5F4F; --mint:#3FAF97; --mint-soft:#dff3ec; --amber:#b45309; --amber-soft:#fef3c7; --line:#e5e5e0; color:#171717; background:transparent; }
.home-apercu .ha-kicker { font-size:11px; letter-spacing:.2em; text-transform:uppercase; font-weight:600; color:var(--forest); margin:0; }

.ha-hero { position:relative; overflow:hidden; background:transparent; padding-top:88px; container:ha-hero / inline-size; }
.ha-cloud { position:absolute; border-radius:50%; background:#fff; filter:blur(2px); opacity:.9; pointer-events:none; }
.ha-c1 { width:520px; height:170px; left:-120px; top:140px; } .ha-c2 { width:380px; height:130px; right:-60px; top:100px; }
.ha-head { position:relative; z-index:2; max-width:1400px; margin:0 auto; padding:26px 24px 8px; text-align:center; container-type:inline-size; }
.ha-h1 { font-size:clamp(30px,5cqi,68px); font-weight:800; letter-spacing:-.035em; line-height:1.05; margin:12px auto 0; max-width:none; color:#111; text-wrap:balance; }
.ha-sub { font-size:clamp(15px,1.25vw,18px); line-height:1.45; color:#3a3a3a; max-width:46ch; margin:20px auto 0; }
.ha-ctas { display:flex; justify-content:center; gap:10px; margin-top:26px; flex-wrap:wrap; }
.ha-btn { display:inline-flex; align-items:center; gap:8px; padding:13px 20px; border-radius:12px; border:0; font-size:14.5px; font-weight:700; cursor:pointer; text-decoration:none; }
.ha-dark { background:#111; color:#fff; } .ha-dark:hover { background:#000; }

.ha-stage { position:relative; z-index:2; max-width:1180px; margin:22px auto 0; padding:0 24px 40px; scroll-margin-top:84px; }
.ha-frame { background:#fff; border-radius:18px; box-shadow:0 40px 90px -36px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.06); overflow:hidden; }
.ha-bar { height:46px; background:#f3f3f1; border-bottom:1px solid #e6e6e3; display:flex; align-items:center; gap:6px; padding:0 14px; }
.ha-bar > i { width:10px; height:10px; border-radius:50%; background:#d9d9d5; } .ha-bar > i:nth-child(1){background:#f87171} .ha-bar > i:nth-child(2){background:#fbbf24} .ha-bar > i:nth-child(3){background:#34d399}
.ha-url { margin-left:10px; font-size:11px; color:#8a8a84; background:#fff; border-radius:6px; padding:3px 10px; width:210px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ha-hint { margin-left:12px; font-size:11px; color:#8a8a84; }
.ha-seg { margin-left:auto; display:flex; gap:2px; background:#e9e9e6; border-radius:999px; padding:3px; }
.ha-seg button { border:0; background:transparent; font-size:12px; padding:5px 13px; border-radius:999px; color:#555; font-weight:600; cursor:pointer; }
.ha-seg button[aria-selected="true"] { background:#fff; color:#111; box-shadow:0 1px 2px rgba(0,0,0,.1); }
.ha-shot { display:block; width:100%; height:auto; }
.ha-float { position:absolute; z-index:4; background:#fff; border:1px solid rgba(0,0,0,.08); border-radius:14px; padding:11px 14px; box-shadow:0 20px 40px -18px rgba(0,0,0,.3); font-size:13px; display:flex; gap:10px; align-items:center; animation:ha-float 6s ease-in-out infinite; }
.ha-float .ha-ic { width:32px; height:32px; border-radius:10px; background:var(--mint-soft); color:var(--forest); display:grid; place-items:center; font-weight:800; font-size:12px; flex:none; }
.ha-float b { display:block; font-weight:700; color:#171717; } .ha-float span { color:#8a8a84; font-size:12px; }
.ha-f1 { left:6px; top:-22px; } .ha-f2 { left:-14px; bottom:22%; animation-delay:-2.5s; }
@keyframes ha-float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-8px); } }

/* Téléphone ancré au cadre desktop. Les tailles sont en cqi (largeur de
   .ha-devices) : hauteur du cadre ≈ 62.5cqi + 46px (image 16:10 + barre), le
   téléphone en fait ~87 %, donc largeur ≈ 26cqi + 19px au ratio 418/872.
   Inclinaison : rotateZ pousse le haut vers la droite, rotateY négatif amène
   la tranche droite (::before) vers l'avant. */
.ha-devices { position:relative; container-type:inline-size; margin-bottom:48px; }
.ha-phone { position:absolute; z-index:5; right:3%; bottom:-7%; width:calc(26cqi + 19px); aspect-ratio:418/872; transform:perspective(1600px) rotateY(-14deg) rotateZ(4deg); transform-origin:50% 100%; animation:ha-pop .8s .35s cubic-bezier(.2,.8,.2,1) both; }
.ha-phone::before { content:""; position:absolute; inset:.6% -2.4% .4% 2.4%; border-radius:15% / 7.2%; background:linear-gradient(90deg,#1a1a1d 0%,#3b3b40 45%,#121214 100%); }
.ha-phone::after { content:""; position:absolute; left:6%; right:-4%; bottom:-3%; height:7%; border-radius:50%; background:rgba(0,0,0,.35); filter:blur(14px); z-index:-1; }
.ha-phone-body { position:relative; height:100%; padding:3.2%; border-radius:15% / 7.2%; background:#0d0d0f; box-shadow:inset 0 0 0 1.5px #4a4a50, inset 0 0 0 4px #141416, 30px 40px 70px -24px rgba(0,0,0,.5), 6px 10px 22px -10px rgba(0,0,0,.35); }
.ha-phone-screen { position:relative; height:100%; overflow:hidden; border-radius:12.5% / 5.8%; background:#fafafa; }
.ha-phone-screen img { display:block; width:100%; height:100%; object-fit:cover; object-position:top; }
.ha-phone-screen::after { content:""; position:absolute; inset:0; background:linear-gradient(118deg, rgba(255,255,255,.22) 0%, rgba(255,255,255,0) 32%); pointer-events:none; }
.ha-island { position:absolute; top:1.3%; left:50%; width:31%; aspect-ratio:125/37; translate:-50% 0; border-radius:999px; background:#000; }
.ha-btn-side { position:absolute; width:1.6%; border-radius:2px; background:#2a2a2e; }
.ha-btn-power { right:-2.6%; top:24%; height:11%; background:#4a4a50; }
.ha-btn-vol1 { left:-.9%; top:20%; height:6%; } .ha-btn-vol2 { left:-.9%; top:28%; height:6%; }
@container (max-width: 640px) {
  .ha-phone { width:calc(30cqi + 8px); right:2%; bottom:-9%; transform:perspective(1200px) rotateY(-12deg) rotateZ(4deg); }
  .ha-phone-body { box-shadow:inset 0 0 0 1px #4a4a50, inset 0 0 0 2.5px #141416, 14px 20px 36px -14px rgba(0,0,0,.5); }
}

/* Personas : une carte de chaque côté du titre, dans la même famille que les
   cartes flottantes de l'aperçu. Entrée en douceur, avatar qui flotte, et la
   carte se déplace un peu vers la souris (--px/--py posés par le hero). */
.ha-person { position:absolute; z-index:3; top:300px; display:flex; gap:12px; align-items:center; background:#fff; border:1px solid rgba(11,40,80,.12); border-radius:16px; padding:12px 16px 12px 12px; box-shadow:0 24px 50px -28px rgba(0,0,0,.35); font-size:14px; color:#171717; white-space:nowrap; animation:ha-pop .7s cubic-bezier(.2,.8,.2,1) both; transform:translate(calc(var(--px, 0) * 16px), calc(var(--py, 0) * 10px)); transition:transform .35s ease-out; }
.ha-p-l { left:max(24px, calc(50% - 640px)); animation-delay:.25s; }
.ha-p-r { right:max(24px, calc(50% - 640px)); top:360px; animation-delay:.4s; }
.ha-person img { width:52px; height:52px; border-radius:50%; background:#f5f5f5; flex:none; animation:ha-float 6s ease-in-out infinite; }
.ha-p-r img { animation-delay:-3s; }
.ha-person em { display:block; font-style:normal; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; font-weight:700; color:var(--forest); }
.ha-person b { display:block; font-size:14px; color:#0a0a0a; }
.ha-person span { display:block; font-size:12.5px; color:#4a4f57; margin-top:2px; }
@keyframes ha-pop { from { opacity:0; translate:0 14px; scale:.96; } to { opacity:1; translate:0 0; scale:1; } }
@container ha-hero (max-width: 1400px) { .ha-person { display:none; } }

.ha-case-note { margin:28px 0 0; padding-top:12px; border-top:1px solid #d9d9d4; font-size:12.5px; color:#555; }

.ha-case { max-width:1000px; margin:56px auto 0; padding:0 24px 64px; color:#111; }
.ha-case-head { display:flex; align-items:center; justify-content:space-between; gap:20px; padding-bottom:18px; border-bottom:1px solid #d9d9d4; }
.ha-case-logo { height:34px; width:auto; }
.ha-case-meta { display:flex; gap:18px; font-size:12.5px; color:#555; flex-wrap:wrap; }
.ha-case-meta span + span::before { content:"·"; margin-right:18px; color:#aaa; }
.ha-quote { margin:36px 0 0; font-size:clamp(24px,2.6vw,34px); font-weight:600; letter-spacing:-.02em; line-height:1.25; max-width:24ch; }
.ha-quote footer { margin-top:14px; font-size:13px; font-weight:500; color:#555; letter-spacing:0; }
.ha-day { display:grid; grid-template-columns:1fr 1fr; gap:48px; margin-top:44px; }
.ha-day h3 { font-size:12px; letter-spacing:.14em; text-transform:uppercase; font-weight:700; margin:0 0 14px; padding-bottom:10px; border-bottom:1px solid #d9d9d4; color:#111; }
.ha-after h3 { border-bottom-color:var(--forest); color:var(--forest); }
.ha-day dl { margin:0; display:grid; grid-template-columns:76px 1fr; row-gap:14px; column-gap:12px; }
.ha-day dt { font-variant-numeric:tabular-nums; font-size:13px; font-weight:700; color:#111; padding-top:1px; }
.ha-day dd { margin:0; font-size:14.5px; line-height:1.5; color:#333; }
.ha-before dd { color:#555; }

@media (max-width: 900px) {
  .ha-day { grid-template-columns:1fr; }
  .ha-float { display:none; }
  .ha-hint { display:none; }
  .ha-bar { height:auto; flex-wrap:wrap; padding:8px 12px; } .ha-seg { margin-left:0; width:100%; justify-content:space-between; }
  .ha-case-head { flex-direction:column; align-items:flex-start; }
}
@media (prefers-reduced-motion: reduce) { .ha-float, .ha-person, .ha-person img, .ha-phone { animation:none !important; transition:none !important; } }
`;
