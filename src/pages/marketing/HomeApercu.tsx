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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import BookDemoForm from '../../components/marketing/BookDemoForm';
import { useTranslation } from '../../i18n';

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

export default function HomeApercu() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const h = t.marketingSite.hero;
  const [demoOpen, setDemoOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('accueil');
  const frameRef = useRef<HTMLDivElement>(null);
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

  const facts = fr
    ? ['Sans engagement en mensuel', 'Intégration guidée incluse', 'Support FR / EN']
    : ['No commitment on monthly plans', 'Guided onboarding included', 'Support in FR / EN'];

  const tiles: { key: Tab; title: string; text: string; scene: React.ReactNode }[] = [
    {
      key: 'accueil',
      title: fr ? 'Soumissions en 4 minutes' : 'Quotes in 4 minutes',
      text: fr ? 'Modèles, préréglages et mesure satellite. Le client signe sur son téléphone.' : 'Templates, presets and satellite measuring. The client signs on their phone.',
      scene: (
        <div className="ha-scene ha-s1"><div className="ha-doc"><i /><i /><i style={{ width: '60%' }} /><span className="ha-stamp">{fr ? 'Signée ✓' : 'Signed ✓'}</span></div></div>
      ),
    },
    {
      key: 'calendrier',
      title: fr ? 'Calendrier et équipes' : 'Calendar and crews',
      text: fr ? 'Jobs récurrents, répartition par équipe, trajets optimisés, GPS en direct.' : 'Recurring jobs, crew dispatch, optimized routes, live GPS.',
      scene: (
        <div className="ha-scene ha-s2">
          <div className="ha-wk">
            <div><em>{fr ? 'Jeu' : 'Thu'}</em><span className="ha-blk ha-rain">Excavation</span></div>
            <div><em>{fr ? 'Ven' : 'Fri'}</em><span className="ha-blk ha-ok">Excavation</span></div>
          </div>
          <small className="ha-why">{fr ? 'Pluie 90 % → déplacé au vendredi' : 'Rain 90% → moved to Friday'}</small>
        </div>
      ),
    },
    {
      key: 'messages',
      title: fr ? 'SMS et relances automatiques' : 'Automatic SMS and follow-ups',
      text: fr ? 'Rappels de rendez-vous, relances de soumissions et de factures, numéro dédié.' : 'Appointment reminders, quote and invoice follow-ups, dedicated number.',
      scene: (
        <div className="ha-scene ha-s3">
          <div className="ha-sms ha-out">{fr ? 'Rappel : demain 9 h. Répondez OK.' : 'Reminder: tomorrow 9 AM. Reply OK.'}</div>
          <div className="ha-sms ha-in">{fr ? 'OK merci !' : 'OK thanks!'}</div>
        </div>
      ),
    },
    {
      key: 'finances',
      title: fr ? 'Facturation et paie' : 'Invoicing and payroll',
      text: fr ? 'Paiement en ligne, feuilles de temps, paie prête le vendredi, export QuickBooks.' : 'Online payment, timesheets, payroll ready on Friday, QuickBooks export.',
      scene: (
        <div className="ha-scene ha-s4">
          <div className="ha-pay"><span className="ha-amt">1 250 $</span><span className="ha-pill">{fr ? 'Payée' : 'Paid'}</span></div>
          <div className="ha-prog"><i /></div>
        </div>
      ),
    },
  ];

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
      <style>{HOME_APERCU_CSS}</style>

      {/* ── 1. Hero compact ── */}
      <section className="ha-hero">
        <div className="ha-cloud ha-c1" aria-hidden="true" />
        <div className="ha-cloud ha-c2" aria-hidden="true" />
        <div className="ha-head">
          <p className="ha-kicker">{fr ? 'Lume · CRM + assistant IA pour entreprises de services' : 'Lume · CRM + AI assistant for service businesses'}</p>
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
            <Link to="/features" className="ha-btn ha-ghost">{fr ? 'Voir les fonctionnalités' : 'See the features'}</Link>
          </div>
          <ul className="ha-facts">{facts.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>

        {/* ── 2. Aperçu interactif ── */}
        <div className="ha-stage" ref={frameRef}>
          <div className="ha-float ha-f1" aria-hidden="true"><span className="ha-ic">✓</span><div><b>{fr ? 'Soumission #1042 signée' : 'Quote #1042 signed'}</b><span>{fr ? 'Excavation Roy · il y a 2 min' : 'Excavation Roy · 2 min ago'}</span></div></div>
          <div className="ha-float ha-f2" aria-hidden="true"><span className="ha-ic">$</span><div><b>{fr ? '1 250 $ reçus en ligne' : '$1,250 received online'}</b><span>{fr ? 'Vision Lavage · facture #877' : 'Vision Lavage · invoice #877'}</span></div></div>
          <div className="ha-frame">
            <div className="ha-bar">
              <i /><i /><i />
              <span className="ha-url">{TABS.find((x) => x.key === tab)?.url}</span>
              <span className="ha-hint">{fr ? 'Cliquez pour explorer ↗' : 'Click to explore ↗'}</span>
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
        </div>
      </section>

      {/* ── 3. Tuiles ── */}
      <section className="ha-feats" aria-labelledby="ha-feats-h">
        <p className="ha-kicker">{fr ? 'Tout au même endroit' : 'All in one place'}</p>
        <h2 id="ha-feats-h">{fr ? 'Ce que Lume fait à ta place' : 'What Lume does for you'}</h2>
        <p className="ha-fsub">{fr ? "Clique sur une tuile pour l'ouvrir dans l'aperçu." : 'Click a tile to open it in the preview.'}</p>
        <div className="ha-fgrid">
          {tiles.map((tile) => (
            <button key={tile.key} type="button" className="ha-ft" onClick={() => goTo(tile.key)}>
              {tile.scene}
              <b>{tile.title}</b>
              <p>{tile.text}</p>
            </button>
          ))}
        </div>
      </section>

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
        <div className="ha-nums">
          <div><b>12 h</b><span>{fr ? "d'administration en moins par semaine" : 'less admin per week'}</span></div>
          <div><b>4 min</b><span>{fr ? 'entre la fin de la visite et la soumission envoyée' : 'from the end of the visit to the quote being sent'}</span></div>
          <div><b>2×</b><span>{fr ? 'plus de soumissions signées, grâce aux relances' : 'more quotes signed, thanks to follow-ups'}</span></div>
        </div>
      </section>

      <BookDemoForm open={demoOpen} onClose={() => setDemoOpen(false)} source="home" />
    </div>
  );
}

/* CSS de la page, à côté du composant : pas de dépendance à la config
   Tailwind, préfixe `ha-` pour ne rien écraser ailleurs. */
const HOME_APERCU_CSS = `
.home-apercu { --forest:#1F5F4F; --mint:#3FAF97; --mint-soft:#dff3ec; --amber:#b45309; --amber-soft:#fef3c7; --line:#e5e5e0; color:#171717; }
.home-apercu .ha-kicker { font-size:11px; letter-spacing:.2em; text-transform:uppercase; font-weight:600; color:var(--forest); margin:0; }

.ha-hero { position:relative; overflow:hidden; background:linear-gradient(180deg,#e9f2ff 0%, #f5f9ff 40%, #ffffff 100%); padding-top:88px; }
.ha-cloud { position:absolute; border-radius:50%; background:#fff; filter:blur(2px); opacity:.9; pointer-events:none; }
.ha-c1 { width:520px; height:170px; left:-120px; top:140px; } .ha-c2 { width:380px; height:130px; right:-60px; top:100px; }
.ha-head { position:relative; z-index:2; max-width:820px; margin:0 auto; padding:26px 24px 8px; text-align:center; }
.ha-h1 { font-size:clamp(34px,3.6vw,50px); font-weight:800; letter-spacing:-.035em; line-height:1.05; margin:12px auto 0; max-width:20ch; color:#111; text-wrap:balance; }
.ha-sub { font-size:15px; line-height:1.55; color:#3a3a3a; max-width:52ch; margin:14px auto 0; }
.ha-ctas { display:flex; justify-content:center; gap:10px; margin-top:16px; flex-wrap:wrap; }
.ha-btn { display:inline-flex; align-items:center; gap:8px; padding:13px 20px; border-radius:12px; border:0; font-size:14.5px; font-weight:700; cursor:pointer; text-decoration:none; }
.ha-dark { background:#111; color:#fff; } .ha-dark:hover { background:#000; }
.ha-ghost { background:rgba(255,255,255,.7); color:#171717; border:1.5px solid rgba(0,0,0,.22); font-weight:600; } .ha-ghost:hover { background:#fff; }
.ha-facts { list-style:none; margin:14px 0 0; padding:0; display:flex; justify-content:center; gap:16px; flex-wrap:wrap; }
.ha-facts li { display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:500; color:#3a3a3a; }
.ha-facts li::before { content:""; width:16px; height:16px; border-radius:50%; border:2px solid var(--mint); background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M3 8.5l3.5 3.5L13 5' stroke='%233FAF97' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/9px no-repeat; flex:none; }

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
.ha-f1 { left:6px; top:-22px; } .ha-f2 { right:6px; top:120px; animation-delay:-2.5s; }
@keyframes ha-float { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-8px); } }

.ha-feats { max-width:1180px; margin:0 auto; padding:44px 24px 8px; }
.ha-feats h2 { font-size:26px; font-weight:800; letter-spacing:-.02em; margin:8px 0 6px; color:#111; }
.ha-fsub { margin:0 0 16px; font-size:13px; color:#555; }
.ha-fgrid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
.ha-ft { background:#fff; border:1px solid rgba(0,0,0,.08); border-radius:16px; padding:18px 18px 16px; box-shadow:0 10px 30px -22px rgba(0,0,0,.25); text-align:left; cursor:pointer; font:inherit; color:inherit; transition:transform .2s, box-shadow .2s; }
.ha-ft:hover { transform:translateY(-3px); box-shadow:0 24px 40px -24px rgba(0,0,0,.35); }
.ha-ft > b { display:block; margin-top:12px; font-size:14.5px; color:#111; }
.ha-ft > p { margin:6px 0 0; font-size:13px; line-height:1.5; color:#333; }
.ha-scene { height:96px; border-radius:12px; background:#f6f7f5; border:1px solid #ececec; position:relative; overflow:hidden; padding:12px; }
.ha-s1 .ha-doc { width:120px; margin:0 auto; background:#fff; border:1px solid #e5e5e5; border-radius:6px; padding:10px; position:relative; height:72px; }
.ha-s1 .ha-doc i { display:block; height:5px; background:#e5e5e5; border-radius:3px; margin-bottom:6px; width:85%; }
.ha-stamp { position:absolute; right:8px; bottom:8px; font-size:10px; font-weight:800; color:var(--forest); border:2px solid var(--forest); border-radius:6px; padding:2px 6px; transform:rotate(-8deg) scale(0); animation:ha-stamp 5s infinite; }
@keyframes ha-stamp { 0%,40% { transform:rotate(-8deg) scale(0); opacity:0; } 48%,90% { transform:rotate(-8deg) scale(1); opacity:1; } 100% { opacity:0; } }
.ha-wk { display:grid; grid-template-columns:1fr 1fr; gap:8px; height:56px; } .ha-wk em { display:block; font-style:normal; font-size:9px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:.1em; margin-bottom:4px; }
.ha-blk { display:block; font-size:10px; font-weight:600; border-radius:5px; padding:4px 6px; border-left:3px solid; }
.ha-rain { background:var(--amber-soft); color:var(--amber); border-color:var(--amber); animation:ha-fadeout 5s infinite; }
.ha-ok { background:#eef0fb; color:#3b4a9e; border-color:#5b6cd6; animation:ha-fadein 5s infinite; }
.ha-why { position:absolute; left:12px; bottom:8px; font-size:10px; color:#555; }
@keyframes ha-fadeout { 0%,45% { opacity:1; transform:none; } 55%,100% { opacity:.15; transform:translateY(-4px); } }
@keyframes ha-fadein { 0%,45% { opacity:0; transform:translateY(8px); } 55%,100% { opacity:1; transform:none; } }
.ha-sms { max-width:78%; font-size:10.5px; padding:6px 9px; border-radius:10px; margin-bottom:6px; opacity:0; }
.ha-out { background:var(--forest); color:#fff; border-bottom-left-radius:3px; animation:ha-pop1 5s infinite; }
.ha-in { background:#fff; border:1px solid #e5e5e5; margin-left:auto; border-bottom-right-radius:3px; animation:ha-pop2 5s infinite; }
@keyframes ha-pop1 { 0% { opacity:0; transform:translateY(6px); } 12%,90% { opacity:1; transform:none; } 100% { opacity:0; } }
@keyframes ha-pop2 { 0%,40% { opacity:0; transform:translateY(6px); } 52%,90% { opacity:1; transform:none; } 100% { opacity:0; } }
.ha-pay { display:flex; align-items:center; justify-content:space-between; margin-top:10px; } .ha-amt { font-size:22px; font-weight:800; font-variant-numeric:tabular-nums; color:#111; }
.ha-pill { font-size:9px; font-weight:800; letter-spacing:.08em; border-radius:999px; padding:2px 8px; text-transform:uppercase; background:#dcfce7; color:#166534; animation:ha-pop2 5s infinite; }
.ha-prog { height:6px; background:#e9e9e6; border-radius:999px; margin-top:14px; overflow:hidden; } .ha-prog i { display:block; height:100%; width:0; background:var(--mint); animation:ha-fill 5s infinite; }
@keyframes ha-fill { 0% { width:0; } 45%,90% { width:100%; } 100% { width:0; } }

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
.ha-nums { margin-top:44px; padding-top:22px; border-top:1px solid #d9d9d4; display:grid; grid-template-columns:repeat(3,1fr); gap:24px; }
.ha-nums b { display:block; font-size:34px; font-weight:800; letter-spacing:-.03em; line-height:1; color:#111; font-variant-numeric:tabular-nums; }
.ha-nums span { display:block; margin-top:8px; font-size:13px; line-height:1.4; color:#333; max-width:24ch; }

@media (max-width: 900px) {
  .ha-fgrid, .ha-day, .ha-nums { grid-template-columns:1fr; }
  .ha-float { display:none; }
  .ha-hint { display:none; }
  .ha-bar { height:auto; flex-wrap:wrap; padding:8px 12px; } .ha-seg { margin-left:0; width:100%; justify-content:space-between; }
  .ha-case-head { flex-direction:column; align-items:flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .ha-float, .ha-stamp, .ha-rain, .ha-ok, .ha-sms, .ha-pill, .ha-prog i { animation:none !important; }
  .ha-stamp { transform:rotate(-8deg) scale(1); opacity:1; } .ha-sms { opacity:1; } .ha-ok { opacity:1; } .ha-prog i { width:100%; }
}
`;
