/**
 * Sections « sous le pli » de l'accueil aperçu (voir HomeApercu.tsx).
 * Chaque section est un composant sans état propre, bilingue via `fr`.
 * Le CSS est regroupé dans SECTIONS_CSS, préfixe `hs-`.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRegion } from '../../hooks/useRegion';
import { creditsParMois } from '../../lib/lumiCreditsFormat';
import { INTEGRATION_LOGOS } from './integrationLogos';
import { FONCTIONS } from './fonctionsData';

type Tab = 'accueil' | 'calendrier' | 'messages' | 'finances';
type Bi = { fr: string; en: string };
const pick = (fr: boolean, b: Bi) => (fr ? b.fr : b.en);

/* ── Ce que tu arrêtes de faire : Avant Lume / Après Lume face à face.
   Rouge / vert = les deux soulignés du titre du hero (red-500, #3FAF97).
   Les deux cartes partagent les rangées de .hs-vs (subgrid) : la ligne N du
   problème est à la hauteur de la ligne N de sa solution. ── */
type VsCard = { key: 'sans' | 'avec'; label: Bi; sub: Bi; items: Bi[]; stats: { label: Bi; value: Bi }[] };
const VS_CARDS: VsCard[] = [
  {
    key: 'sans',
    label: { fr: 'Avant Lume', en: 'Before Lume' },
    sub: { fr: 'Des textos partout, des soumissions oubliées, des soirées au bureau.', en: 'Texts everywhere, forgotten quotes, evenings at the kitchen table.' },
    items: [
      { fr: 'Retaper à la main les demandes reçues sur ton site', en: 'Retyping website requests by hand' },
      { fr: 'Recevoir les textos des clients sur ton cell perso', en: 'Getting client texts on your personal cell' },
      { fr: 'Relancer une soumission sans savoir si elle a été ouverte', en: 'Following up on a quote without knowing if it was opened' },
      { fr: 'Quémander des avis Google, un client à la fois', en: 'Begging for Google reviews, one client at a time' },
      { fr: 'Arriver chez un client qui avait oublié ton passage', en: 'Showing up at a client who forgot you were coming' },
    ],
    stats: [{ label: { fr: 'Soirées au bureau', en: 'Evenings at the office' }, value: { fr: 'Toutes', en: 'All of them' } }],
  },
  {
    key: 'avec',
    label: { fr: 'Après Lume', en: 'After Lume' },
    sub: { fr: "Une seule app, et des automatisations qui travaillent pendant que t'es sur la job.", en: "One app, with automations that work while you're on the job." },
    items: [
      { fr: 'La demande sur ton site crée le client et la fiche toute seule', en: 'Website requests create the client and the record on their own' },
      { fr: 'Les textos arrivent dans Lume, sur un numéro dédié à ta business', en: 'Texts land in Lume, on a number dedicated to your business' },
      { fr: 'Tu vois quand la soumission est ouverte, et la relance part toute seule', en: 'You see when the quote is opened, and the follow-up sends itself' },
      { fr: 'La demande d\'avis part automatiquement quand la job est terminée', en: 'Review requests go out automatically when the job is done' },
      { fr: 'Le rappel SMS part la veille, le client t\'attend', en: 'The SMS reminder goes out the day before, the client is ready' },
    ],
    stats: [
      { label: { fr: 'Relances', en: 'Follow-ups' }, value: { fr: '24/7', en: '24/7' } },
      { label: { fr: 'Rappels clients', en: 'Client reminders' }, value: { fr: 'Automatiques', en: 'Automatic' } },
    ],
  },
];

export function StopList({ fr }: { fr: boolean }) {
  return (
    <section className="hs-stop">
      <p className="ha-kicker">{fr ? 'Ce que tu arrêtes de faire' : 'What you stop doing'}</p>
      <h2>{fr ? 'Le soir, tu fermes le camion. Pas le bureau.' : 'At night, you close the truck. Not the office.'}</h2>
      <div className="hs-vs">
        {VS_CARDS.map((c) => (
          <div key={c.key} className={`hs-vscard ${c.key}`}>
            <h3>{pick(fr, c.label)}</h3>
            <p className="hs-vssub">{pick(fr, c.sub)}</p>
            <ul>
              {c.items.map((it) => (
                <li key={it.en}><span className="hs-vsic" aria-hidden="true">{c.key === 'avec' ? '✓' : '✕'}</span>{pick(fr, it)}</li>
              ))}
            </ul>
            <dl className="hs-vsstats">
              {c.stats.map((st) => (
                <div key={st.label.en}><dt>{pick(fr, st.label)}</dt><dd>{pick(fr, st.value)}</dd></div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <LogoMarquee fr={fr} />
    </section>
  );
}

/* ── Outils connectés : bande défilante. La liste est rendue deux fois pour
   boucler sans saut (translateX -50 %) ; la copie est cachée aux lecteurs d'écran. ── */
function LogoMarquee({ fr }: { fr: boolean }) {
  const row = (hidden: boolean) => (
    <ul className="hs-logos" aria-hidden={hidden || undefined}>
      {INTEGRATION_LOGOS.map((l) => (
        <li key={l.name}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill={l.color} d={l.path} /></svg>
          <span>{l.name}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="hs-marquee">
      <p className="hs-mlabel">{fr ? 'Se connecte à vos outils' : 'Connects to your tools'}</p>
      <div className="hs-mtrack">{row(false)}{row(true)}</div>
    </div>
  );
}

/* ── Quatre fonctions, texte et capture en alternance, dans l'ordre d'une
   job : demande → pipeline → avis → facture. Les trois premières rangées
   sont propres à l'accueil (formulaire de demande intégré au site du client,
   pipeline et ses automatisations par étape, demande d'avis) ; la dernière
   reprend fonctionsData (mêmes textes et captures que les pages « En savoir plus »). ── */
type FeatureRow = { slug: string; job: Bi; lead: Bi; shot: string; alt: Bi; w: number; h: number };
const REQUEST_FORM_ROW: FeatureRow = {
  slug: 'clients',
  job: { fr: 'Formulaire de demande', en: 'Request form' },
  lead: {
    fr: "Garde ton site actuel. Colle le code d'intégration dans ta page et le formulaire Lume y apparaît. Chaque demande crée le client et le lead dans ton pipeline, sans rien retaper.",
    en: 'Keep your current website. Paste the embed code into your page and the Lume form shows up there. Every request creates the client and the lead in your pipeline, with nothing retyped.',
  },
  shot: '/landing/fonction-formulaire.webp',
  alt: { fr: 'Constructeur du formulaire de demande dans Lume', en: 'Request form builder in Lume' },
  w: 720,
  h: 606,
};
/* Étapes et pipelines : PipelineDetail ; déclencheurs par étape
   deal.stage_entered / stage_exited / stage_idle (eventBus). Pas de capture du
   pipeline dans /public/landing : on montre la liste des automatisations. */
const PIPELINE_ROW: FeatureRow = {
  slug: 'pipeline',
  job: { fr: 'Pipeline de vente', en: 'Sales pipeline' },
  lead: {
    fr: "Monte ton pipeline comme tu vends : tes étapes, dans ton ordre. Chaque étape a ses propres automatisations : un texto, un courriel ou une tâche part quand un lead y entre, en sort ou y dort trop longtemps.",
    en: 'Build your pipeline the way you sell: your stages, in your order. Each stage has its own automations: a text, an email or a task goes out when a lead enters it, leaves it or sits there too long.',
  },
  shot: '/landing/fonction-automatisations.webp',
  alt: { fr: 'Automatisations par étape dans Lume', en: 'Per-stage automations in Lume' },
  w: 760,
  h: 640,
};
/* Avis : workflow de server/lib/reviews.ts — lien envoyé à tous à la fin de
   la job (sauf champ client « noreview »), choix Google / Facebook sur
   /survey/:token, sans note préalable (le « review gating » est interdit). */
const REVIEWS_ROW: FeatureRow = {
  slug: 'avis',
  job: { fr: 'Avis clients', en: 'Client reviews' },
  lead: {
    fr: "Quand la job est terminée, ton client reçoit un texto et un courriel avec un lien. Il choisit Google ou Facebook et laisse son avis en 30 secondes. Toi, tu n'as plus rien à demander.",
    en: "When the job is done, your client gets a text and an email with a link. They pick Google or Facebook and leave a review in 30 seconds. You don't have to ask anymore.",
  },
  shot: '/landing/fonction-avis.webp',
  alt: { fr: "Texto de demande d'avis et page de choix Google ou Facebook", en: 'Review request text and Google or Facebook choice page' },
  w: 840,
  h: 540,
};
/* Images des fonctions : maquettes HTML calquées sur les vraies captures
   (scripts/marketing/fonction-*.html), rendues en 2,5x. Les captures de l'app
   n'existent qu'en 1x et devenaient floues une fois agrandies sur un écran
   Retina. */
const ZOOM_SHOTS: Record<string, { shot: string; alt: Bi; w: number; h: number }> = {
  finances: { shot: '/landing/fonction-finances.webp', alt: { fr: 'Factures payées, en attente et en retard dans Lume', en: 'Paid, pending and overdue invoices in Lume' }, w: 800, h: 500 },
};
const FEATURE_ROWS: FeatureRow[] = [
  REQUEST_FORM_ROW,
  PIPELINE_ROW,
  REVIEWS_ROW,
  ...['finances'].flatMap((slug) => {
    const f = FONCTIONS.find((x) => x.slug === slug);
    return f ? [{ slug, job: f.job, lead: f.lead, ...ZOOM_SHOTS[slug] }] : [];
  }),
];

export function FeatureRows({ fr }: { fr: boolean }) {
  return (
    <section className="hs-feat">
      <p className="ha-kicker">{fr ? 'Les fonctions' : 'The features'}</p>
      <h2>{fr ? 'De la demande au paiement, sans rien retaper.' : 'From request to payment, with nothing retyped.'}</h2>
      {FEATURE_ROWS.map((f) => (
        <div key={f.slug} className="hs-frow">
          <div className="hs-ftxt">
            <h3>{pick(fr, f.job)}</h3>
            <p>{pick(fr, f.lead)}</p>
          </div>
          <img src={f.shot} alt={pick(fr, f.alt)} loading="lazy" decoding="async" width={f.w} height={f.h} />
        </div>
      ))}
    </section>
  );
}

/* ── Par rôle ── */
export function Roles({ fr, goTo }: { fr: boolean; goTo: (t: Tab) => void }) {
  const roles: { key: Tab; label: Bi; title: Bi; items: Bi[]; cta: Bi }[] = [
    { key: 'accueil', label: { fr: 'Propriétaire', en: 'Owner' }, title: { fr: "Tu vois la journée avant qu'elle commence.", en: 'You see the day before it starts.' },
      items: [{ fr: 'Brief du matin : jobs, équipes, retards, argent qui rentre.', en: 'Morning brief: jobs, crews, overdue items, cash coming in.' }, { fr: 'Revenus encaissés et planifiés, semaine par semaine.', en: 'Collected and scheduled revenue, week by week.' }, { fr: 'Ce qui traîne : soumissions sans réponse, factures en retard, tâches du jour.', en: "What's stuck: unanswered quotes, overdue invoices, today's tasks." }], cta: { fr: 'Voir le tableau de bord →', en: 'See the dashboard →' } },
    { key: 'calendrier', label: { fr: 'Répartition', en: 'Dispatch' }, title: { fr: 'Une job se déplace en la glissant. Le client est averti tout seul.', en: 'Drag a job to move it. The client is notified automatically.' },
      items: [{ fr: 'Vue mois, semaine, jour, par équipe.', en: 'Month, week and day views, per crew.' }, { fr: 'Trajets optimisés sur de vraies routes, GPS en direct.', en: 'Routes optimized on real roads, live GPS.' }, { fr: 'Pluie annoncée ? Lumi propose le déplacement, tu confirmes.', en: 'Rain in the forecast? Lumi proposes the move, you confirm.' }], cta: { fr: 'Voir le calendrier →', en: 'See the calendar →' } },
    { key: 'messages', label: { fr: 'Terrain', en: 'Field' }, title: { fr: 'Le terrain a tout dans sa poche.', en: 'The field has everything in its pocket.' },
      items: [{ fr: "La route du jour, l'adresse, les notes du client, la checklist.", en: "The day's route, the address, client notes, the checklist." }, { fr: 'Photos avant/après, pointage des heures, job terminée en un tap.', en: 'Before/after photos, clocking hours, job done in one tap.' }, { fr: "Les SMS du client arrivent dans l'app, pas sur le cell perso.", en: 'Client texts land in the app, not on a personal phone.' }], cta: { fr: 'Voir Messages →', en: 'See Messages →' } },
    { key: 'finances', label: { fr: 'Comptabilité', en: 'Accounting' }, title: { fr: 'La facture part quand la job finit. La paie est prête le vendredi.', en: 'The invoice goes out when the job ends. Payroll is ready on Friday.' },
      items: [{ fr: "Payées, en attente, en retard : tout d'un coup d'œil.", en: 'Paid, pending, overdue: all at a glance.' }, { fr: 'Paiement en ligne, relance automatique à J+7.', en: 'Online payment, automatic follow-up at day 7.' }, { fr: 'Feuilles de temps approuvées, export QuickBooks.', en: 'Approved timesheets, QuickBooks export.' }], cta: { fr: 'Voir Finances →', en: 'See Finances →' } },
  ];
  const [cur, setCur] = useState<Tab>('accueil');
  const r = roles.find((x) => x.key === cur)!;
  return (
    <section className="hs-roles">
      <p className="ha-kicker">{fr ? "Pour chaque personne de l'équipe" : 'For everyone on the team'}</p>
      <h2>{fr ? 'Le proprio, la répartition, le terrain, la comptabilité : chacun son écran.' : 'Owner, dispatch, field, accounting: each gets their own screen.'}</h2>
      <div className="hs-rtabs" role="tablist">
        {roles.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={cur === x.key} onClick={() => setCur(x.key)}>{pick(fr, x.label)}</button>
        ))}
      </div>
      <div className="hs-rp">
        <div className="hs-rtxt">
          <h3>{pick(fr, r.title)}</h3>
          <ul>{r.items.map((it) => <li key={it.en}>{pick(fr, it)}</li>)}</ul>
          <button type="button" className="hs-link" onClick={() => goTo(r.key)}>{pick(fr, r.cta)}</button>
        </div>
        <img src={`/landing/apercu-${r.key}.webp`} alt="" width={1800} height={1125} loading="lazy" decoding="async" />
      </div>
    </section>
  );
}

/* ── Lumi ── */
export function LumiSection({ fr }: { fr: boolean }) {
  const caps: Bi[] = [
    { fr: '<b>Il répond aux clients.</b> Un texto à 21 h reçoit un prix, un créneau, une soumission.', en: '<b>It answers clients.</b> A 9 PM text gets a price, a time slot, a quote.' },
    { fr: '<b>Il replanifie.</b> Pluie annoncée : la job glisse au lendemain, le client et l\'équipe sont avertis.', en: '<b>It reschedules.</b> Rain in the forecast: the job slides to the next day, client and crew are notified.' },
    { fr: '<b>Il relance.</b> Soumission sans réponse à J+3, facture en retard à J+7, sans que tu y penses.', en: '<b>It follows up.</b> Unanswered quote at day 3, overdue invoice at day 7, without you thinking about it.' },
    { fr: '<b>Il te brief.</b> Chaque matin : jobs, équipes, retards, argent qui rentre.', en: '<b>It briefs you.</b> Every morning: jobs, crews, overdue items, cash coming in.' },
  ];
  const conv: { who: 'you' | 'ai'; text: Bi; note?: Bi }[] = [
    { who: 'you', text: { fr: "Il pleut jeudi, on fait quoi avec l'excavation de la Ville ?", en: "It's raining Thursday, what do we do with the City excavation?" } },
    { who: 'ai', text: { fr: 'Pluie à 90 % jeudi. Je propose <b>vendredi 8 h</b>, équipe A, même durée. Karim est libre. Je déplace et j\'avertis le client par SMS ?', en: '90% rain Thursday. I suggest <b>Friday 8 AM</b>, crew A, same duration. Karim is free. Shall I move it and text the client?' } },
    { who: 'you', text: { fr: 'Oui', en: 'Yes' } },
    { who: 'ai', text: { fr: '<b>Fait.</b> Job déplacée, SMS envoyé, Karim a la nouvelle route. Autre chose : trois soumissions sans réponse depuis trois jours. Je relance ?', en: '<b>Done.</b> Job moved, text sent, Karim has the new route. One more thing: three quotes unanswered for three days. Shall I follow up?' },
      note: { fr: 'Actions dans Lume : déplacer la job · envoyer un SMS · 2 confirmations', en: 'Actions in Lume: move the job · send a text · 2 confirmations' } },
  ];
  return (
    <section className="hs-lumi">
      <div className="hs-lgrid">
        <div>
          <p className="ha-kicker">{fr ? "Lumi, l'assistant" : 'Lumi, the assistant'}</p>
          <h2>{fr ? 'Un employé de plus, qui ne dort pas.' : 'One more employee, who never sleeps.'}</h2>
          <p className="hs-lsub">{fr ? 'Lumi lit tes jobs, tes clients et tes factures. Il propose, tu confirmes. Tout ce qu\'il fait est journalisé.' : 'Lumi reads your jobs, clients and invoices. It proposes, you confirm. Everything it does is logged.'}</p>
          <ul className="hs-lcaps">{caps.map((c) => <li key={c.en} dangerouslySetInnerHTML={{ __html: pick(fr, c) }} />)}</ul>
          <p className="hs-lsafe">{fr ? "Lecture seule par défaut. Les actions qui touchent un client ou de l'argent demandent ta confirmation." : 'Read-only by default. Actions that touch a client or money require your confirmation.'}</p>
        </div>
        <div className="hs-lconv" aria-label={fr ? 'Exemple de conversation avec Lumi' : 'Example conversation with Lumi'}>
          {conv.map((m, i) => (
            <div key={i} className={`hs-lrow ${m.who}`}>
              <span className="hs-who">{m.who === 'ai' ? 'Lumi' : fr ? 'Toi' : 'You'}</span>
              <p dangerouslySetInnerHTML={{ __html: pick(fr, m.text) }} />
              {m.note && <small>{pick(fr, m.note)}</small>}
            </div>
          ))}
          <div className="hs-lrow in"><span className="hs-who" /><p>{fr ? 'Écrire à Lumi…' : 'Write to Lumi…'}</p></div>
        </div>
      </div>
    </section>
  );
}

/* ── Bande de chiffres ── */
export function StatsBand({ fr }: { fr: boolean }) {
  const stats: { v: string; l: Bi }[] = [
    { v: '12 h', l: { fr: "d'administration en moins par semaine", en: 'less admin per week' } },
    { v: '4 min', l: { fr: 'entre la visite et la soumission envoyée', en: 'from the visit to the quote being sent' } },
    { v: '2×', l: { fr: 'plus de soumissions signées grâce aux relances', en: 'more quotes signed thanks to follow-ups' } },
    { v: 'FR / EN', l: { fr: 'support par des humains, au Québec', en: 'support by humans, in Québec' } },
  ];
  return (
    <section className="hs-band">
      {stats.map((s) => <div key={s.v}><b>{s.v}</b><span>{pick(fr, s.l)}</span></div>)}
    </section>
  );
}

/* ── Une seule donnée, du texto à la paie ── */
export function Flow({ fr }: { fr: boolean }) {
  const steps: { t: Bi; d: Bi }[] = [
    { t: { fr: 'Demande', en: 'Request' }, d: { fr: 'Formulaire sur ton site, texto, appel. Le client est créé une fois.', en: 'Form on your site, text, call. The client is created once.' } },
    { t: { fr: 'Soumission', en: 'Quote' }, d: { fr: 'Modèle, préréglages, mesure satellite. Signée sur téléphone.', en: 'Template, presets, satellite measuring. Signed on the phone.' } },
    { t: { fr: 'Job', en: 'Job' }, d: { fr: 'Planifiée, assignée, sur la carte. Checklist et photos sur le terrain.', en: 'Scheduled, assigned, on the map. Checklist and photos in the field.' } },
    { t: { fr: 'Facture', en: 'Invoice' }, d: { fr: 'Créée à la fin de la job. Payée en ligne. Relancée si besoin.', en: 'Created when the job ends. Paid online. Followed up if needed.' } },
    { t: { fr: 'Paie', en: 'Payroll' }, d: { fr: 'Heures pointées, approuvées, prêtes le vendredi. Export QuickBooks.', en: 'Hours clocked, approved, ready on Friday. QuickBooks export.' } },
  ];
  return (
    <section className="hs-flow">
      <p className="ha-kicker">{fr ? 'Comment ça tient ensemble' : 'How it holds together'}</p>
      <h2>{fr ? 'Une seule donnée, du premier texto à la paie.' : 'One set of data, from the first text to payroll.'}</h2>
      <p className="hs-sub">{fr ? "Rien n'est ressaisi. Le client entré à la demande est le même sur la soumission, la job, la facture et le reçu." : 'Nothing is retyped. The client entered at the request is the same on the quote, the job, the invoice and the receipt.'}</p>
      <ol className="hs-steps">
        {steps.map((s, i) => <li key={s.t.en}><span>{i + 1}</span><b>{pick(fr, s.t)}</b><p>{pick(fr, s.d)}</p></li>)}
      </ol>
      <p className="hs-indline"><b>{fr ? 'Utilisé en' : 'Used in'}</b>{(fr
        ? ['lavage de vitres', 'paysagement', 'déneigement', 'toiture', 'excavation', 'peinture', 'plomberie', 'CVAC', 'nettoyage', 'pavé uni', 'extermination']
        : ['window cleaning', 'landscaping', 'snow removal', 'roofing', 'excavation', 'painting', 'plumbing', 'HVAC', 'cleaning', 'paving', 'pest control']).map((x) => <span key={x}>{x}</span>)}</p>
    </section>
  );
}

/* ── Forfaits ── */
export function PlansTeaser({ fr }: { fr: boolean }) {
  const { currency } = useRegion();
  const plans: { stage: Bi; name: string; price: Record<'CAD' | 'USD', number>; d: Bi; feat?: boolean }[] = [
    { stage: { fr: 'Je démarre', en: 'Getting started' }, name: 'Minimum', price: { CAD: 150, USD: 110 }, d: { fr: 'Clients, soumissions, jobs, calendrier, factures, paiements. 3 utilisateurs.', en: 'Clients, quotes, jobs, calendar, invoices, payments. 3 users.' } },
    { stage: { fr: "J'ai une équipe", en: 'I have a team' }, name: 'Scale', price: { CAD: 347, USD: 249 }, feat: true, d: { fr: 'Tout Minimum, plus SMS, automatisations, feuilles de temps, dispatch. 10 utilisateurs.', en: 'Everything in Minimum, plus SMS, automations, timesheets and dispatch. 10 users.' } },
    // Lumi est exclusif à Autopilot depuis le 2026-09-19 : c'est ce qui distingue les deux forfaits.
    { stage: { fr: 'Ça roule sans moi', en: 'Runs without me' }, name: 'Autopilot', price: { CAD: 495, USD: 360 }, d: { fr: `Tout Scale, plus Lumi (texte et voix, ${creditsParMois('fr')}), porte-à-porte, formations, API. 20 utilisateurs.`, en: `Everything in Scale, plus Lumi (text and voice, ${creditsParMois('en')}), door-to-door, courses, API. 20 users.` } },
  ];
  return (
    <section className="hs-plans">
      <p className="ha-kicker">{fr ? 'Forfaits' : 'Plans'}</p>
      <h2>{fr ? 'Trois forfaits, une étape de ta business chacun.' : 'Three plans, one stage of your business each.'}</h2>
      <div className="hs-plgrid">
        {plans.map((p) => (
          <Link key={p.name} to="/pricing" className={`hs-pl ${p.feat ? 'feat' : ''}`}>
            {p.feat && <span className="hs-tag">{fr ? 'Le plus populaire' : 'Most popular'}</span>}
            <em>{pick(fr, p.stage)}</em>
            <b>{p.name}</b>
            <div className="hs-pp">{fr ? `${p.price[currency]} $` : `$${p.price[currency]}`}<span>{fr ? '/mois' : '/mo'} {currency}</span></div>
            <p>{pick(fr, p.d)}</p>
          </Link>
        ))}
      </div>
      <Link to="/pricing" className="hs-link">{fr ? 'Comparer les forfaits en détail →' : 'Compare plans in detail →'}</Link>
    </section>
  );
}

/* ── Tes données ── */
export function Security({ fr }: { fr: boolean }) {
  const items: { t: Bi; d: Bi }[] = [
    { t: { fr: 'Hébergement au Canada', en: 'Hosted in Canada' }, d: { fr: 'Base de données et fichiers dans un centre de données canadien, chiffrés au repos et en transit.', en: 'Database and files in a Canadian data centre, encrypted at rest and in transit.' } },
    { t: { fr: 'Sauvegardes chaque jour', en: 'Daily backups' }, d: { fr: 'Copies quotidiennes conservées 14 jours, vérifiées. Tu peux tout exporter toi-même, en un clic.', en: 'Daily copies kept 14 days, verified. You can export everything yourself, in one click.' } },
    { t: { fr: 'Un compte par personne', en: 'One account per person' }, d: { fr: 'Rôles et permissions par employé. Le terrain voit sa route, pas tes finances.', en: 'Roles and permissions per employee. The field sees its route, not your finances.' } },
    { t: { fr: 'Aucune vente de données', en: 'No data selling' }, d: { fr: 'Tes clients restent tes clients. Politique de confidentialité en français, lisible en cinq minutes.', en: 'Your clients stay your clients. A privacy policy you can read in five minutes.' } },
  ];
  return (
    <section className="hs-secu">
      <p className="ha-kicker">{fr ? 'Tes données' : 'Your data'}</p>
      <h2>{fr ? 'Hébergées au Canada. À toi.' : 'Hosted in Canada. Yours.'}</h2>
      <div className="hs-sgrid">{items.map((it) => <div key={it.t.en}><b>{pick(fr, it.t)}</b><p>{pick(fr, it.d)}</p></div>)}</div>
    </section>
  );
}

/* ── FAQ ── */
export function Faq({ fr }: { fr: boolean }) {
  const qa: { q: Bi; a: Bi }[] = [
    { q: { fr: 'Combien de temps pour être opérationnel ?', en: 'How long until we are up and running?' }, a: { fr: "Une semaine en général. On importe tes clients (CSV ou export de ton ancien outil), on configure tes services, tes taxes et tes modèles de soumission avec toi. L'intégration guidée est incluse dans tous les forfaits.", en: 'About a week. We import your clients (CSV or an export from your old tool), and set up your services, taxes and quote templates with you. Guided onboarding is included in every plan.' } },
    { q: { fr: 'Est-ce que mon équipe terrain doit apprendre un nouvel outil ?', en: 'Does my field crew need to learn a new tool?' }, a: { fr: "L'app mobile montre la route du jour, la job, la checklist et les heures. Trois boutons. La plupart des équipes sont autonomes le premier jour.", en: "The mobile app shows the day's route, the job, the checklist and the hours. Three buttons. Most crews are on their own by day one." } },
    { q: { fr: 'Y a-t-il un engagement ?', en: 'Is there a commitment?' }, a: { fr: "Aucun en mensuel, tu annules quand tu veux. Le forfait annuel est un engagement d'un an, facturé d'avance, avec 15 % de rabais.", en: 'None on monthly plans, cancel anytime. The annual plan is a one-year commitment, billed upfront, with a 15% discount.' } },
    { q: { fr: 'Où sont mes données ?', en: 'Where is my data?' }, a: { fr: 'Hébergées au Canada, chiffrées, sauvegardées chaque jour. Tu peux tout exporter en un clic, et fermer ton compte toi-même.', en: 'Hosted in Canada, encrypted, backed up daily. You can export everything in one click, and close your account yourself.' } },
    { q: { fr: 'Lumi peut-il faire des erreurs ?', en: 'Can Lumi make mistakes?' }, a: { fr: "Oui, c'est une IA. C'est pourquoi il te propose et tu confirmes pour tout ce qui touche un client ou de l'argent, et que chaque action est journalisée.", en: 'Yes, it is an AI. That is why it proposes and you confirm anything that touches a client or money, and every action is logged.' } },
  ];
  return (
    <section className="hs-faq">
      <p className="ha-kicker">{fr ? 'Questions fréquentes' : 'Frequently asked questions'}</p>
      <h2>{fr ? "Ce qu'on nous demande avant une démo" : 'What people ask before a demo'}</h2>
      {qa.map((x, i) => (
        <details key={x.q.en} open={i === 0}><summary>{pick(fr, x.q)}</summary><p>{pick(fr, x.a)}</p></details>
      ))}
    </section>
  );
}

export const SECTIONS_CSS = `
.home-apercu h2 { font-size:28px; font-weight:800; letter-spacing:-.025em; line-height:1.12; color:#0a0a0a; margin:8px 0 0; max-width:26ch; }
.home-apercu .hs-sub { margin:10px 0 0; font-size:15px; line-height:1.55; color:#333; max-width:70ch; }
.home-apercu .hs-link { display:inline-block; margin-top:16px; font-weight:700; font-size:13.5px; color:var(--forest); background:none; border:0; padding:0; cursor:pointer; text-decoration:none; font-family:inherit; }
.hs-stop, .hs-feat, .hs-roles, .hs-lumi, .hs-flow, .hs-plans, .hs-secu { max-width:1180px; margin:0 auto; padding:52px 24px 8px; }
.hs-vs { display:grid; grid-template-columns:1fr 1fr; grid-template-rows:repeat(8,auto); column-gap:16px; margin-top:22px; }
.hs-vscard { grid-row:span 8; display:grid; grid-template-rows:subgrid; border-radius:18px; padding:22px; }
.hs-vscard { --vs:#ef4444; --vs-line:rgba(239,68,68,.25); background:#fff; border:2px solid var(--vs); box-shadow:0 24px 40px -28px var(--vs-line); }
.hs-vscard.avec { --vs:#3FAF97; --vs-line:rgba(63,175,151,.3); }
.hs-vscard h3 { margin:0; text-align:center; font-size:clamp(28px,3vw,38px); font-weight:800; letter-spacing:-.03em; line-height:1.1; color:var(--vs); }
.hs-vssub { margin:10px auto 0; max-width:34ch; text-align:center; font-size:17px; font-weight:600; letter-spacing:-.01em; line-height:1.4; color:#111; }
.hs-vscard ul { grid-row:span 5; display:grid; grid-template-rows:subgrid; list-style:none; margin:14px 0 0; padding:0; }
.hs-vscard li { display:flex; gap:10px; align-items:flex-start; font-size:14.5px; line-height:1.45; color:#171717; padding:11px 0; border-top:1px solid #ececea; }
.hs-vsic { flex:none; width:20px; height:20px; margin-top:1px; border-radius:50%; display:grid; place-items:center; font-size:11px; font-weight:800; background:var(--vs); color:#fff; }
.hs-vsstats { display:flex; justify-content:center; gap:28px; margin:6px 0 0; padding-top:16px; border-top:1px solid var(--vs-line); align-self:end; text-align:center; }
.hs-vsstats dt { font-size:12px; color:#555; }
.hs-vsstats dd { margin:4px 0 0; font-size:28px; font-weight:800; letter-spacing:-.03em; line-height:1; color:var(--vs); }
.hs-marquee { margin:34px 0 0; overflow:hidden; -webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent); mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent); }
.hs-mlabel { margin:0 0 14px; text-align:center; font-size:11px; letter-spacing:.14em; text-transform:uppercase; font-weight:700; color:#8a8a84; }
.hs-mtrack { display:flex; width:max-content; animation:hs-marquee 32s linear infinite; }
.hs-marquee:hover .hs-mtrack { animation-play-state:paused; }
.hs-logos { list-style:none; margin:0; padding:0 56px 0 0; display:flex; gap:56px; }
.hs-logos li { display:flex; align-items:center; gap:12px; padding:8px 0; font-size:22px; font-weight:700; letter-spacing:-.015em; color:#111; white-space:nowrap; }
.hs-logos svg { width:34px; height:34px; flex:none; }
@keyframes hs-marquee { to { transform:translateX(-50%); } }
.hs-feat > .ha-kicker, .hs-feat > h2 { text-align:center; } .hs-feat > h2 { margin-left:auto; margin-right:auto; }
.hs-frow { display:grid; grid-template-columns:.85fr 1.15fr; gap:56px; align-items:center; margin-top:56px; }
.hs-frow:nth-of-type(even) { grid-template-columns:1.15fr .85fr; } .hs-frow:nth-of-type(even) .hs-ftxt { order:2; }
.hs-ftxt h3 { margin:0; font-size:clamp(24px,2.4vw,32px); font-weight:800; letter-spacing:-.025em; line-height:1.12; color:#111; }
.hs-ftxt p { margin:12px 0 0; font-size:15.5px; line-height:1.55; color:#171717; max-width:48ch; }
.hs-frow img { width:100%; height:auto; border-radius:14px; border:1px solid rgba(11,92,173,.12); box-shadow:0 30px 60px -30px rgba(0,0,0,.35); }
.hs-rtabs { display:flex; gap:4px; background:#f1f1ef; border-radius:999px; padding:4px; width:max-content; max-width:100%; margin-top:18px; overflow:auto; }
.hs-rtabs button { border:0; background:transparent; font-size:13px; font-weight:600; color:#555; padding:8px 16px; border-radius:999px; cursor:pointer; white-space:nowrap; font-family:inherit; } .hs-rtabs button[aria-selected="true"] { background:#111; color:#fff; }
.hs-rp { display:grid; grid-template-columns:.9fr 1.4fr; gap:36px; align-items:center; margin-top:24px; }
.hs-rtxt h3 { font-size:24px; font-weight:800; letter-spacing:-.02em; margin:0; color:#111; line-height:1.15; } .hs-rtxt ul { margin:14px 0 0; padding-left:18px; font-size:14px; line-height:1.55; color:#333; } .hs-rtxt li { margin-bottom:6px; }
.hs-rp img { width:100%; height:auto; border-radius:14px; border:1px solid rgba(11,92,173,.12); box-shadow:0 30px 60px -30px rgba(0,0,0,.35); }
.hs-lgrid { display:grid; grid-template-columns:1fr 1fr; gap:40px; align-items:center; }
.hs-lumi h2 { font-size:32px; }
.hs-lsub { font-size:16px; line-height:1.55; color:#171717; margin:14px 0 0; max-width:46ch; }
.hs-lcaps { list-style:none; margin:18px 0 0; padding:0; display:grid; gap:10px; } .hs-lcaps li { font-size:15px; line-height:1.5; color:#171717; padding-left:18px; position:relative; } .hs-lcaps li::before { content:""; position:absolute; left:0; top:9px; width:8px; height:8px; border-radius:50%; background:var(--mint); } .hs-lcaps b { color:#111; }
.hs-lsafe { margin:16px 0 0; font-size:12.5px; color:#444; border-top:1px solid #d9d9d4; padding-top:12px; }
.hs-lconv { background:#fff; border:1px solid rgba(0,0,0,.1); border-radius:16px; padding:6px 22px; box-shadow:0 30px 70px -34px rgba(0,0,0,.35); }
.hs-lrow { display:grid; grid-template-columns:52px 1fr; gap:14px; padding:16px 0; border-top:1px solid #ececea; align-items:start; } .hs-lrow:first-child { border-top:0; }
.hs-who { font-size:11px; letter-spacing:.14em; text-transform:uppercase; font-weight:700; color:#8a8a84; padding-top:3px; }
.hs-lrow p { margin:0; font-size:14.5px; line-height:1.55; color:#171717; }
.hs-lrow.ai .hs-who { color:var(--forest); } .hs-lrow.ai p { padding-left:14px; border-left:3px solid var(--mint); } .hs-lrow.ai b { color:var(--forest); }
.hs-lrow small { display:block; grid-column:2; margin:-6px 0 0 17px; font-size:11.5px; color:#777; }
.hs-lrow.in { border-top:1px dashed #d9d9d4; } .hs-lrow.in p { color:#9a9a94; font-size:13.5px; }
.hs-band { max-width:1180px; margin:40px auto 0; padding:26px 24px; display:grid; grid-template-columns:repeat(4,1fr); gap:20px; border-top:1px solid #d9d9d4; border-bottom:1px solid #d9d9d4; }
.hs-band b { display:block; font-size:32px; font-weight:800; letter-spacing:-.03em; color:#111; line-height:1; font-variant-numeric:tabular-nums; } .hs-band span { display:block; margin-top:8px; font-size:13px; color:#333; max-width:22ch; }
.hs-steps { list-style:none; margin:22px 0 0; padding:0; display:grid; grid-template-columns:repeat(5,1fr); position:relative; }
.hs-steps::before { content:""; position:absolute; left:6%; right:6%; top:18px; height:2px; background:#d9d9d4; }
.hs-steps li { position:relative; padding:0 14px; text-align:center; } .hs-steps li span { display:grid; place-items:center; width:38px; height:38px; border-radius:50%; background:#111; color:#fff; font-weight:800; margin:0 auto; position:relative; } .hs-steps li b { display:block; margin-top:12px; font-size:15px; color:#111; } .hs-steps li p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:#333; }
.hs-indline { margin:44px 0 0; padding:14px 0; border-top:1px solid #d9d9d4; border-bottom:1px solid #d9d9d4; display:flex; gap:18px; flex-wrap:wrap; align-items:center; font-size:13px; color:#333; }
.hs-indline b { font-size:11px; letter-spacing:.14em; text-transform:uppercase; font-weight:700; color:#8a8a84; margin-right:6px; }
.hs-indline span + span::before { content:"·"; color:#bbb; margin-right:18px; }
.hs-plgrid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:20px; }
.hs-pl { position:relative; display:block; background:#fff; border:1px solid rgba(11,92,173,.12); border-radius:18px; padding:22px; text-decoration:none; color:inherit; } .hs-pl.feat { border:2px solid var(--forest); }
.hs-pl em { font-style:normal; font-size:11px; letter-spacing:.14em; text-transform:uppercase; font-weight:700; color:var(--forest); } .hs-pl b { display:block; font-size:24px; font-weight:800; letter-spacing:-.02em; margin-top:6px; color:#111; }
.hs-pp { font-size:30px; font-weight:800; letter-spacing:-.02em; margin-top:8px; color:#111; font-variant-numeric:tabular-nums; } .hs-pp span { font-size:13px; font-weight:500; color:#555; }
.hs-pl p { margin:10px 0 0; font-size:13.5px; line-height:1.5; color:#333; }
.hs-tag { position:absolute; top:-12px; left:22px; background:var(--forest); color:#fff; font-size:10px; letter-spacing:.14em; text-transform:uppercase; font-weight:700; padding:4px 10px; border-radius:999px; }
.hs-sgrid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-top:20px; } .hs-sgrid div { border-top:2px solid #111; padding-top:12px; } .hs-sgrid b { font-size:15px; color:#111; } .hs-sgrid p { margin:6px 0 0; font-size:13px; line-height:1.5; color:#333; }
.hs-faq { max-width:820px; margin:0 auto; padding:52px 24px 64px; }
.hs-faq details { border-top:1px solid #d9d9d4; padding:14px 0; } .hs-faq details:last-of-type { border-bottom:1px solid #d9d9d4; }
.hs-faq summary { cursor:pointer; font-weight:700; font-size:15.5px; color:#111; list-style:none; display:flex; justify-content:space-between; align-items:center; } .hs-faq summary::-webkit-details-marker { display:none; } .hs-faq summary::after { content:"+"; font-size:20px; color:#888; } .hs-faq details[open] summary::after { content:"–"; }
.hs-faq p { margin:10px 0 0; font-size:14px; line-height:1.55; color:#333; max-width:68ch; }
@media (max-width: 900px) {
  .hs-vs { grid-template-columns:1fr; grid-template-rows:none; row-gap:16px; }
  .hs-vscard, .hs-vscard ul { grid-row:auto; display:flex; flex-direction:column; }
  .hs-vsstats { align-self:stretch; }
  .hs-frow, .hs-rp, .hs-lgrid, .hs-band, .hs-steps, .hs-plgrid, .hs-sgrid { grid-template-columns:1fr; }
  .hs-steps::before { display:none; }
  .hs-frow, .hs-frow:nth-of-type(even) { grid-template-columns:1fr; gap:20px; margin-top:40px; } .hs-frow:nth-of-type(even) .hs-ftxt { order:0; }
}
@media (prefers-reduced-motion: reduce) {
  .hs-mtrack { animation:none; width:auto; justify-content:center; } .hs-logos { flex-wrap:wrap; justify-content:center; } .hs-logos[aria-hidden] { display:none; }
}
`;
