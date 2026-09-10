/**
 * Page « En savoir plus » d'une fonction (/fonctions/:slug).
 * Contenu dans fonctionsData.ts ; même ciel et mêmes styles que l'accueil.
 */
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import BookDemoForm from '../../components/marketing/BookDemoForm';
import { useTranslation } from '../../i18n';
import { usePageMeta } from '../../hooks/usePageMeta';
import { FONCTIONS, findFonction, type Bi } from './fonctionsData';

export default function FonctionDetail() {
  const { slug } = useParams();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const f = findFonction(slug);
  const [demoOpen, setDemoOpen] = useState(false);
  usePageMeta(f
    ? { title: fr ? f.title.fr : f.title.en, description: fr ? f.lead.fr : f.lead.en, path: `/fonctions/${f.slug}`, image: f.shot }
    : { title: fr ? 'Fonction introuvable' : 'Feature not found', description: '', path: '/features' });
  if (!f) return <Navigate to="/features" replace />;
  const pick = (b: Bi) => (fr ? b.fr : b.en);
  const others = FONCTIONS.filter((x) => x.slug !== f.slug);

  return (
    <div className="fn-page">
      <style>{FN_CSS}</style>

      <section className="fn-hero">
        <div className="fn-wrap fn-hero-grid">
          <div>
            <p className="fn-crumb"><Link to="/">{fr ? 'Accueil' : 'Home'}</Link> · <Link to="/features">{fr ? 'Fonctionnalités' : 'Features'}</Link> · <span>{pick(f.title)}</span></p>
            <p className="fn-kicker">{pick(f.job)}</p>
            <h1>{pick(f.title)}</h1>
            <p className="fn-lead">{pick(f.lead)}</p>
            <div className="fn-ctas">
              <button type="button" className="fn-btn fn-dark" onClick={() => setDemoOpen(true)}>{fr ? 'Réserver une démo' : 'Book a demo'}<ArrowRight size={16} /></button>
              <Link to="/pricing" className="fn-btn fn-ghost">{fr ? 'Voir les forfaits' : 'See the plans'}</Link>
            </div>
          </div>
          <div className="fn-shot"><img src={f.shot} alt={pick(f.shotAlt)} width={1800} height={1125} decoding="async" /></div>
        </div>
      </section>

      <section className="fn-wrap fn-points">
        <p className="fn-kicker">{fr ? 'Concrètement' : 'Concretely'}</p>
        <h2>{fr ? 'Ce que ça fait, point par point.' : 'What it does, point by point.'}</h2>
        <div className="fn-pgrid">
          {f.points.map((p) => (
            <div key={p.t.en} className="fn-pt"><b>{pick(p.t)}</b><p>{pick(p.d)}</p></div>
          ))}
        </div>
      </section>

      <section className="fn-wrap fn-steps">
        <p className="fn-kicker">{fr ? 'Comment ça se passe' : 'How it goes'}</p>
        <h2>{fr ? 'En trois temps.' : 'In three steps.'}</h2>
        <ol>
          {f.steps.map((s, i) => (
            <li key={s.t.en}><span>{i + 1}</span><b>{pick(s.t)}</b><p>{pick(s.d)}</p></li>
          ))}
        </ol>
      </section>

      <section className="fn-wrap fn-replace">
        <div className="fn-rgrid">
          <div>
            <p className="fn-kicker">{fr ? 'Ce que ça remplace' : 'What it replaces'}</p>
            <ul>{f.replaces.map((r) => <li key={r.en}><span>{pick(r)}</span></li>)}</ul>
          </div>
          <div>
            <p className="fn-kicker">{fr ? 'Questions fréquentes' : 'Frequently asked questions'}</p>
            {f.faq.map((q, i) => (
              <details key={q.q.en} open={i === 0}><summary>{pick(q.q)}</summary><p>{pick(q.a)}</p></details>
            ))}
            <Link to={`/features#${f.featureAnchor}`} className="fn-link">{fr ? 'Voir cette fonction dans la page Fonctionnalités →' : 'See this feature on the Features page →'}</Link>
          </div>
        </div>
      </section>

      <section className="fn-wrap fn-others">
        <p className="fn-kicker">{fr ? 'Les autres métiers' : 'The other jobs'}</p>
        <div className="fn-ogrid">
          {others.map((o) => (
            <Link key={o.slug} to={`/fonctions/${o.slug}`} className="fn-oc"><em>{pick(o.job)}</em><b>{pick(o.title)}</b><span>{fr ? 'En savoir plus →' : 'Learn more →'}</span></Link>
          ))}
        </div>
      </section>

      <BookDemoForm open={demoOpen} onClose={() => setDemoOpen(false)} source={`fonction-${f.slug}`} />
    </div>
  );
}

const FN_CSS = `
.fn-page { --forest:#1F5F4F; --mint:#3FAF97; color:#171717; background:transparent; }
.fn-wrap { max-width:1180px; margin:0 auto; padding:52px 24px 8px; }
.fn-page h1 { font-size:clamp(34px,4vw,52px); font-weight:800; letter-spacing:-.035em; line-height:1.05; margin:12px 0 0; color:#0a0a0a; text-wrap:balance; }
.fn-page h2 { font-size:28px; font-weight:800; letter-spacing:-.025em; line-height:1.12; color:#0a0a0a; margin:8px 0 0; max-width:26ch; }
.fn-kicker { font-size:11px; letter-spacing:.2em; text-transform:uppercase; font-weight:600; color:var(--forest); margin:0; }
.fn-crumb { font-size:12.5px; color:#555; margin:0 0 14px; } .fn-crumb a { color:#555; text-decoration:none; } .fn-crumb a:hover { color:#111; } .fn-crumb span { color:#111; font-weight:600; }
.fn-hero { padding-top:88px; }
.fn-hero-grid { display:grid; grid-template-columns:.9fr 1.1fr; gap:40px; align-items:center; padding-bottom:16px; }
.fn-lead { font-size:17px; line-height:1.55; color:#171717; margin:18px 0 0; max-width:50ch; }
.fn-ctas { display:flex; gap:10px; margin-top:22px; flex-wrap:wrap; }
.fn-btn { display:inline-flex; align-items:center; gap:8px; padding:13px 20px; border-radius:12px; border:0; font-size:14.5px; font-weight:700; cursor:pointer; text-decoration:none; }
.fn-dark { background:#111; color:#fff; } .fn-dark:hover { background:#000; } .fn-ghost { background:rgba(255,255,255,.7); color:#171717; border:1.5px solid rgba(0,0,0,.22); font-weight:600; }
.fn-shot img { width:100%; height:auto; border-radius:16px; border:1px solid rgba(11,92,173,.12); box-shadow:0 40px 90px -36px rgba(0,0,0,.45); display:block; }
.fn-pgrid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:20px; }
.fn-pt { background:#fff; border:1px solid rgba(11,92,173,.12); border-radius:16px; padding:20px; } .fn-pt b { font-size:15.5px; color:#111; } .fn-pt p { margin:8px 0 0; font-size:13.5px; line-height:1.55; color:#333; }
.fn-steps ol { list-style:none; margin:22px 0 0; padding:0; display:grid; grid-template-columns:repeat(3,1fr); gap:24px; }
.fn-steps li span { display:grid; place-items:center; width:38px; height:38px; border-radius:50%; background:#111; color:#fff; font-weight:800; }
.fn-steps li b { display:block; margin-top:12px; font-size:16px; color:#111; } .fn-steps li p { margin:6px 0 0; font-size:14px; line-height:1.5; color:#333; }
.fn-rgrid { display:grid; grid-template-columns:1fr 1.3fr; gap:40px; }
.fn-replace ul { list-style:none; margin:14px 0 0; padding:0; } .fn-replace li { font-size:18px; font-weight:600; color:#0a0a0a; padding:12px 0; border-top:1px solid #d9d9d4; } .fn-replace li span { position:relative; } .fn-replace li span::after { content:""; position:absolute; left:0; right:0; top:55%; height:3px; background:#ef4444; border-radius:2px; }
.fn-replace details { border-top:1px solid #d9d9d4; padding:12px 0; margin-top:6px; } .fn-replace summary { cursor:pointer; font-weight:700; font-size:15px; color:#111; list-style:none; display:flex; justify-content:space-between; } .fn-replace summary::-webkit-details-marker { display:none; } .fn-replace summary::after { content:"+"; color:#888; } .fn-replace details[open] summary::after { content:"–"; } .fn-replace details p { margin:8px 0 0; font-size:14px; line-height:1.55; color:#333; }
.fn-link { display:inline-block; margin-top:16px; font-weight:700; font-size:13.5px; color:var(--forest); text-decoration:none; }
.fn-others { padding-bottom:64px; }
.fn-ogrid { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-top:16px; }
.fn-oc { display:flex; flex-direction:column; background:#fff; border:1px solid rgba(11,92,173,.12); border-radius:14px; padding:16px; text-decoration:none; color:inherit; }
.fn-oc em { font-style:normal; font-size:10.5px; letter-spacing:.14em; text-transform:uppercase; font-weight:800; color:var(--forest); } .fn-oc b { margin-top:6px; font-size:15px; color:#111; } .fn-oc span { margin-top:auto; padding-top:10px; font-size:12.5px; font-weight:700; color:var(--forest); }
@media (max-width: 900px) { .fn-hero-grid, .fn-pgrid, .fn-steps ol, .fn-rgrid { grid-template-columns:1fr; } .fn-ogrid { grid-template-columns:1fr 1fr; } }
`;
