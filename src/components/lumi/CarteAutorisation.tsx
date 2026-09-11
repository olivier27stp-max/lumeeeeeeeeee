/**
 * Carte d'autorisation de Lumi — façon « un outil veut agir » de Claude.
 * ─────────────────────────────────────────────────────────────────────
 * Une ligne « Lumi veut créer une soumission », l'essentiel en gris, l'état,
 * le détail sous un chevron (le VRAI document pour un devis ou une facture,
 * rendu comme la page publique QuoteView.tsx), puis trois choix : confirmer,
 * toujours confirmer ce type d'action, refuser. Une fois confirmée, la même
 * carte devient le reçu : « Devis Q-0043 créé », Ouvrir, Envoyer au client.
 *
 * Rien n'est créé avant la confirmation : la carte EST la demande.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, FileText, Mail, MessageSquare, Briefcase, CheckSquare, UserPlus, Send, Pencil, XCircle, Merge } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getCompanySettings } from '../../lib/invoicesApi';
import type { ApercuDocumentLumi, ApercuLumi, FicheLumi, PropositionLumi } from '../../lib/lumiApi';

/* ── Libellés : ce que Lumi veut faire, en mots courants ─────────────────── */
type Verbe = { fr: string; en: string; type: string; typeEn: string; icone: React.ComponentType<{ size?: number; className?: string }> };
const VERBES: Record<string, Verbe> = {
  create_quote: { fr: 'créer une soumission', en: 'create a quote', type: 'les soumissions', typeEn: 'quotes', icone: FileText },
  create_invoice: { fr: 'créer une facture', en: 'create an invoice', type: 'les factures', typeEn: 'invoices', icone: FileText },
  create_invoice_from_job: { fr: 'facturer un job', en: 'invoice a job', type: 'les factures', typeEn: 'invoices', icone: FileText },
  send_quote: { fr: 'envoyer une soumission', en: 'send a quote', type: 'les envois de soumissions', typeEn: 'quote sends', icone: Send },
  send_invoice: { fr: 'envoyer une facture', en: 'send an invoice', type: 'les envois de factures', typeEn: 'invoice sends', icone: Send },
  send_payment_reminders: { fr: 'envoyer des relances', en: 'send payment reminders', type: 'les relances', typeEn: 'reminders', icone: Mail },
  send_sms: { fr: 'envoyer un texto', en: 'send a text message', type: 'les textos', typeEn: 'text messages', icone: MessageSquare },
  send_email: { fr: 'envoyer un courriel', en: 'send an email', type: 'les courriels', typeEn: 'emails', icone: Mail },
  create_job: { fr: 'créer un job', en: 'create a job', type: 'les jobs', typeEn: 'jobs', icone: Briefcase },
  update_job: { fr: 'modifier un job', en: 'update a job', type: 'les modifications de jobs', typeEn: 'job updates', icone: Briefcase },
  reschedule_job: { fr: 'déplacer un job', en: 'reschedule a job', type: 'les déplacements de jobs', typeEn: 'job reschedules', icone: Briefcase },
  create_task: { fr: 'créer une tâche', en: 'create a task', type: 'les tâches', typeEn: 'tasks', icone: CheckSquare },
  update_task: { fr: 'modifier une tâche', en: 'update a task', type: 'les modifications de tâches', typeEn: 'task updates', icone: CheckSquare },
  create_client: { fr: 'créer un client', en: 'create a client', type: 'les nouveaux clients', typeEn: 'new clients', icone: UserPlus },
  update_client: { fr: 'modifier un client', en: 'update a client', type: 'les modifications de clients', typeEn: 'client updates', icone: UserPlus },
  mark_invoice_paid: { fr: 'marquer une facture payée', en: 'mark an invoice paid', type: 'les paiements', typeEn: 'payments', icone: FileText },
  remember_this: { fr: 'retenir quelque chose', en: 'remember something', type: 'les notes', typeEn: 'notes', icone: Pencil },
  merge_clients: { fr: 'fusionner deux fiches clients', en: 'merge two client records', type: 'les fusions de fiches', typeEn: 'client merges', icone: Merge },
  forget_note: { fr: 'oublier une note', en: 'forget a note', type: 'les notes', typeEn: 'notes', icone: Pencil },
};

function verbe(p: PropositionLumi, fr: boolean): Verbe {
  const v = VERBES[p.tool];
  if (v) return v;
  const humain = p.capacite || p.tool.replace(/_/g, ' ');
  return { fr: humain, en: humain, type: humain, typeEn: humain, icone: Pencil };
}

export function fmtMontant(cents: number): string {
  const v = (cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v} $`;
}

/** Une ligne de résumé sous le titre : « Marie Tremblay · 2 lignes · 494,39 $ taxes incluses ». */
function resume(p: PropositionLumi, fr: boolean): string {
  const a = p.apercu;
  if (a && (a.genre === 'quote' || a.genre === 'invoice')) {
    const n = a.lignes.length;
    const parts = [a.client?.name, `${n} ${fr ? (n > 1 ? 'lignes' : 'ligne') : (n > 1 ? 'lines' : 'line')}`, `${fmtMontant(a.total_cents)} ${a.taxes.length ? (fr ? 'taxes incluses' : 'incl. taxes') : (fr ? 'sans taxes' : 'no taxes')}`];
    return parts.filter(Boolean).join(' · ');
  }
  if (a && (a.genre === 'sms' || a.genre === 'email')) {
    return [a.to ? `${fr ? 'À' : 'To'} ${a.to}` : null, a.subject].filter(Boolean).join(' · ');
  }
  if (a && a.genre === 'fusion') {
    return `${a.garder?.name ?? '?'} ${fr ? '← absorbe' : '← absorbs'} ${a.absorber?.name ?? '?'}`;
  }
  const args = p.args as Record<string, unknown>;
  if (p.tool === 'remember_this' && typeof args.note === 'string') return args.note;
  if (p.tool === 'forget_note' && typeof args.key === 'string') return args.key;
  const t = [args.client_name, args.title, args.name].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
  return t ?? '';
}

/* ── Le document : mêmes valeurs que la page publique (QuoteView.tsx) ───── */
interface Compagnie { company_name: string | null; company_email: string | null; company_phone: string | null; company_address: string | null; company_logo_url: string | null }
let compagnieCache: Promise<Compagnie> | null = null;
function chargerCompagnie(): Promise<Compagnie> {
  if (!compagnieCache) compagnieCache = getCompanySettings().catch(() => ({ company_name: null, company_email: null, company_phone: null, company_address: null, company_logo_url: null }));
  return compagnieCache;
}

function fmtDate(d: Date, fr: boolean): string {
  return d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function DocumentApercu({ doc, fr }: { doc: ApercuDocumentLumi; fr: boolean }) {
  const [co, setCo] = useState<Compagnie | null>(null);
  useEffect(() => { let vivant = true; chargerCompagnie().then((c) => { if (vivant) setCo(c); }); return () => { vivant = false; }; }, []);
  const devis = doc.genre === 'quote';
  const aujourdhui = new Date();
  const valide = doc.valid_days ? new Date(aujourdhui.getTime() + doc.valid_days * 86400000) : null;
  return (
    <div className="bg-[#f0f0f0] p-3">
      <div className="bg-white rounded-lg border border-[#e5e5e5] shadow-sm overflow-hidden text-[#111]">
        {/* En-tête : logo + compagnie à gauche, SOUMISSION #… à droite */}
        <div className="px-5 sm:px-8 pt-6 sm:pt-8 pb-5 sm:pb-6 flex items-start justify-between gap-6">
          <div className="min-w-0">
            {co?.company_logo_url
              ? <img src={co.company_logo_url} alt="" className="h-10 max-w-[180px] object-contain mb-3" />
              : <div className="h-10 mb-3 flex items-center text-[15px] font-extrabold tracking-[0.14em] text-[#111]">{(co?.company_name || 'LUME').toUpperCase()}</div>}
            <h2 className="text-[14px] font-semibold text-[#111]">{co?.company_name || ''}</h2>
            {co?.company_address && <p className="text-[12px] text-[#888] mt-0.5">{co.company_address}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
              {co?.company_phone && <span className="text-[12px] text-[#888]">{co.company_phone}</span>}
              {co?.company_email && <span className="text-[12px] text-[#888]">{co.company_email}</span>}
            </div>
          </div>
          <div className="text-right ml-2 shrink-0">
            <h1 className="text-[22px] sm:text-[28px] font-bold text-[#111] tracking-tight leading-none">{devis ? (fr ? 'SOUMISSION' : 'QUOTE') : (fr ? 'FACTURE' : 'INVOICE')}</h1>
            <p className="text-[13px] text-[#888] mt-1 font-medium">{fr ? 'Brouillon' : 'Draft'}</p>
          </div>
        </div>
        <div className="border-t border-[#eee]" />
        {/* Préparé pour / Détails */}
        <div className="px-5 sm:px-8 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          <div>
            <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">{fr ? 'Préparé pour' : 'Prepared for'}</p>
            {doc.client ? (
              <>
                <p className="text-[14px] font-semibold text-[#111]">{doc.client.name}</p>
                {doc.client.company && doc.client.company !== doc.client.name && <p className="text-[12px] text-[#666] mt-0.5">{doc.client.company}</p>}
                {doc.client.email && <p className="text-[12px] text-[#888] mt-0.5">{doc.client.email}</p>}
                {doc.client.phone && <p className="text-[12px] text-[#888] mt-0.5">{doc.client.phone}</p>}
              </>
            ) : <p className="text-[13px] text-[#aaa]">--</p>}
          </div>
          <div className="sm:text-right space-y-1.5">
            <p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-2">{fr ? 'Détails' : 'Details'}</p>
            <div className="flex sm:justify-end gap-2 text-[12px]"><span className="text-[#888]">Date</span><span className="text-[#333] font-medium">{fmtDate(aujourdhui, fr)}</span></div>
            {valide && <div className="flex sm:justify-end gap-2 text-[12px]"><span className="text-[#888]">{fr ? 'Valide jusqu’au' : 'Valid until'}</span><span className="text-[#333] font-medium">{fmtDate(valide, fr)}</span></div>}
            <div className="flex sm:justify-end gap-2 text-[12px]"><span className="text-[#888]">{fr ? 'Statut' : 'Status'}</span><span className="text-[#333] font-medium">{fr ? 'À créer' : 'To be created'}</span></div>
          </div>
        </div>
        {doc.title && <div className="px-5 sm:px-8 pb-4"><p className="text-[14px] font-medium text-[#333]">{doc.title}</p></div>}
        <div className="border-t border-[#eee]" />
        {/* Lignes */}
        <div className="px-5 sm:px-8 py-5 sm:py-6">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#e5e5e5]">
                <th className="text-left py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em]">Description</th>
                <th className="text-center py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-12 sm:w-16">{fr ? 'Qté' : 'Qty'}</th>
                <th className="text-right py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-20 sm:w-24">{fr ? 'Prix' : 'Price'}</th>
                <th className="text-right py-2.5 font-semibold text-[#888] text-[11px] uppercase tracking-[0.05em] w-20 sm:w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {doc.lignes.map((l, i) => (
                <tr key={i} className="border-b border-[#f0f0f0]">
                  <td className="py-3 text-[#222]">
                    <div className="font-medium">{l.name}</div>
                    {l.description && <div className="text-[11px] text-[#999] mt-0.5 leading-relaxed">{l.description}</div>}
                  </td>
                  <td className="py-3 text-center text-[#555]">{l.quantity}</td>
                  <td className="py-3 text-right text-[#333] tabular-nums">{fmtMontant(l.unit_price_cents)}</td>
                  <td className="py-3 text-right text-[#111] font-medium tabular-nums">{fmtMontant(l.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Totaux */}
        <div className="px-5 sm:px-8 pb-5 sm:pb-6">
          <div className="ml-auto w-full max-w-[280px] space-y-2 text-[13px]">
            <div className="flex justify-between"><span className="text-[#888]">{fr ? 'Sous-total' : 'Subtotal'}</span><span className="text-[#333] font-medium tabular-nums">{fmtMontant(doc.subtotal_cents)}</span></div>
            {doc.taxes.map((t, i) => (
              <div key={i} className="flex justify-between"><span className="text-[#888]">{t.label} ({t.rate} %)</span><span className="text-[#333] font-medium tabular-nums">{fmtMontant(t.amount_cents)}</span></div>
            ))}
            <div className="border-t border-[#e5e5e5] pt-2 mt-2 flex justify-between text-[15px]">
              <span className="font-bold text-[#111]">Total</span>
              <span className="font-bold text-[#111] tabular-nums">{fmtMontant(doc.total_cents)}</span>
            </div>
          </div>
        </div>
        {doc.notes && (
          <>
            <div className="border-t border-[#eee]" />
            <div className="px-5 sm:px-8 py-4"><p className="text-[10px] font-semibold text-[#aaa] uppercase tracking-[0.08em] mb-1.5">Notes</p><p className="text-[12.5px] text-[#555] whitespace-pre-wrap">{doc.notes}</p></div>
          </>
        )}
      </div>
    </div>
  );
}

function MessageApercu({ a, fr }: { a: Extract<ApercuLumi, { genre: 'sms' | 'email' }>; fr: boolean }) {
  return (
    <div className="px-4 py-3.5 text-[13px]">
      {a.to && <div><span className="text-text-tertiary mr-2">{fr ? 'À' : 'To'}</span><span className="text-text-primary font-medium">{a.to}</span></div>}
      {a.subject && <div className="mt-1"><span className="text-text-tertiary mr-2">{fr ? 'Objet' : 'Subject'}</span><span className="text-text-primary font-medium">{a.subject}</span></div>}
      <blockquote className="mt-2.5 pl-3 border-l-2 border-outline-strong text-text-secondary whitespace-pre-wrap">{a.body}</blockquote>
    </div>
  );
}

function FicheFusion({ f, titre, teinte }: { f: { name: string; company: string | null; email: string | null; phone: string | null; address: string | null; since: string | null; jobs: number; quotes: number; invoices: number } | null; titre: string; teinte: string }) {
  return (
    <div className={cn('rounded-xl border px-3.5 py-3 text-[12.5px]', teinte)}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-tertiary mb-1.5">{titre}</p>
      {f ? (
        <>
          <p className="font-semibold text-text-primary">{f.name}</p>
          {f.company && f.company !== f.name && <p className="text-text-secondary">{f.company}</p>}
          {f.email && <p className="text-text-secondary">{f.email}</p>}
          {f.phone && <p className="text-text-secondary">{f.phone}</p>}
          {f.address && <p className="text-text-tertiary">{f.address}</p>}
          <p className="mt-1.5 text-text-tertiary">{f.jobs} jobs · {f.quotes} devis · {f.invoices} factures{f.since ? ` · depuis ${f.since}` : ''}</p>
        </>
      ) : <p className="text-text-tertiary">--</p>}
    </div>
  );
}

function FusionApercu({ a, fr }: { a: Extract<ApercuLumi, { genre: 'fusion' }>; fr: boolean }) {
  return (
    <div className="px-4 py-3.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FicheFusion f={a.garder} titre={fr ? 'On garde' : 'Kept'} teinte="border-[#3FAF97]/50 bg-[#3FAF97]/5" />
        <FicheFusion f={a.absorber} titre={fr ? 'On fusionne dedans (archivée)' : 'Merged in (archived)'} teinte="border-outline bg-surface" />
      </div>
      <p className="mt-3 text-[12px] text-text-tertiary">{fr ? 'Tout l’historique de la seconde (jobs, devis, factures, messages…) passe sur la première. Ses champs vides sont complétés. Ce n’est pas réversible.' : 'Everything attached to the second record moves to the first. Its empty fields get filled. This cannot be undone.'}</p>
    </div>
  );
}

/** Liste des champs, quand il n'y a pas d'aperçu composé (jobs, tâches, clients…). */
function ChampsApercu({ args }: { args: Record<string, unknown> }) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const entrees = Object.entries(args).filter(([k, v]) => v !== null && v !== undefined && v !== '' && !/(^|_)id$/.test(k) && !(typeof v === 'string' && UUID.test(v)));
  if (!entrees.length) return null;
  return (
    <dl className="px-4 py-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
      {entrees.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-text-tertiary">{k.replace(/_/g, ' ')}</dt>
          <dd className="text-text-primary break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/* ── Une ligne d'un groupe d'actions ───────────────────────────────────── */
function LigneGroupe({ p, fr, index }: { p: PropositionLumi; fr: boolean; index: number }) {
  const v = verbe(p, fr);
  const Icone = v.icone;
  const a = p.apercu ?? null;
  const document = a && (a.genre === 'quote' || a.genre === 'invoice') ? a : null;
  const message = a && (a.genre === 'sms' || a.genre === 'email') ? a : null;
  const fusion = a && a.genre === 'fusion' ? a : null;
  const sousTitre = resume(p, fr);
  const ok = p.statut === 'confirmee';
  return (
    <details className="group border-t border-outline first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="w-4 text-[11px] font-semibold tabular-nums text-text-tertiary">{index + 1}</span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#3FAF97]/12 text-[#3FAF97]"><Icone size={13} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-text-primary leading-tight">{ok && p.fiche?.label ? p.fiche.label : (fr ? v.fr : v.en)}</span>
          {sousTitre && sousTitre !== (ok ? p.fiche?.label : undefined) && <span className="block truncate text-[12px] text-text-tertiary">{sousTitre}</span>}
        </span>
        {p.statut !== 'en_attente' && (
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', ok ? 'bg-success-light text-success' : p.statut === 'echouee' ? 'bg-danger-light text-danger' : 'bg-surface-secondary text-text-tertiary')}>
            {ok ? (fr ? 'Fait' : 'Done') : p.statut === 'echouee' ? (fr ? 'Échouée' : 'Failed') : (fr ? 'Annulée' : 'Cancelled')}
          </span>
        )}
        {ok && p.fiche && p.fiche.type !== 'task' && <Link to={p.fiche.href} onClick={(ev) => ev.stopPropagation()} className="shrink-0 text-[12px] text-text-secondary underline hover:text-text-primary">{fr ? 'Ouvrir' : 'Open'}</Link>}
        <ChevronDown size={14} className="shrink-0 text-text-tertiary transition-transform group-open:rotate-180" />
      </summary>
      {document ? <DocumentApercu doc={document} fr={fr} /> : message ? <MessageApercu a={message} fr={fr} /> : fusion ? <FusionApercu a={fusion} fr={fr} /> : <ChampsApercu args={p.args as Record<string, unknown>} />}
    </details>
  );
}

/* ── La carte ──────────────────────────────────────────────────────────── */
export function CarteAutorisation({ proposition, fr, busy, onDecision, onSuite, autorise, onAutoriser }: {
  proposition: PropositionLumi;
  fr: boolean;
  busy: boolean;
  onDecision: (d: 'confirm' | 'cancel', toujours?: boolean) => void;
  /** Enchaîner en langage courant après le reçu (« Envoie la soumission Q-0043 à Marie »). */
  onSuite?: (texte: string) => void;
  /** Cet outil est déjà en « toujours confirmer » (préférence serveur, par utilisateur). */
  autorise: boolean;
  /** Activer / retirer « toujours confirmer » pour cet outil. */
  onAutoriser: (tool: string, actif: boolean) => void;
}) {
  const p = proposition;
  const v = verbe(p, fr);
  const Icone = v.icone;
  const a = p.apercu ?? null;
  const document = a && (a.genre === 'quote' || a.genre === 'invoice') ? a : null;
  const message = a && (a.genre === 'sms' || a.genre === 'email') ? a : null;
  const fusion = a && a.genre === 'fusion' ? a : null;
  const attente = p.statut === 'en_attente';
  const ok = p.statut === 'confirmee';
  const groupe = p.groupe && p.groupe.length > 1 ? p.groupe : null;
  const nFaites = groupe ? groupe.filter((g) => g.statut === 'confirmee').length : 0;
  const titre = groupe
    ? (attente
      ? (fr ? `Lumi veut faire ${groupe.length} choses` : `Lumi wants to do ${groupe.length} things`)
      : ok ? (fr ? `${groupe.length} actions faites` : `${groupe.length} actions done`)
        : p.statut === 'echouee' ? (fr ? `${nFaites} sur ${groupe.length} faites, une a échoué` : `${nFaites} of ${groupe.length} done, one failed`)
          : (fr ? 'Actions refusées' : 'Actions declined'))
    : attente
    ? `${fr ? 'Lumi veut' : 'Lumi wants to'} ${fr ? v.fr : v.en}`
    : ok
      ? (p.tool === 'remember_this' ? (fr ? 'Noté pour la prochaine fois' : 'Noted for next time')
        : p.tool === 'forget_note' ? (fr ? 'Note oubliée' : 'Note forgotten')
        : p.fiche?.label ? `${p.fiche.label} ${fr ? (p.fiche.type === 'invoice' || p.fiche.type === 'task' ? 'créée' : 'créé') : 'created'}` : (fr ? 'Action exécutée' : 'Action executed'))
      : p.statut === 'echouee' ? (fr ? 'Action échouée' : 'Action failed') : (fr ? 'Action refusée' : 'Action declined');
  const sousTitre = groupe ? groupe.map((g) => (fr ? verbe(g, fr).fr : verbe(g, fr).en)).join(' · ') : resume(p, fr);
  const detailLabel = document
    ? (document.genre === 'quote' ? (fr ? 'Voir la soumission' : 'View the quote') : (fr ? 'Voir la facture' : 'View the invoice'))
    : message ? (message.genre === 'sms' ? (fr ? 'Voir le texto' : 'View the text') : (fr ? 'Voir le courriel' : 'View the email'))
      : fusion ? (fr ? 'Voir les deux fiches' : 'View both records')
        : (fr ? 'Voir les détails' : 'View details');

  return (
    <div className="mt-3 rounded-2xl border border-outline-strong bg-surface-card overflow-hidden text-[13.5px]">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3FAF97]/12 text-[#3FAF97]"><Icone size={16} /></span>
        <div className="min-w-0">
          <p className="font-semibold text-text-primary leading-tight">{titre}</p>
          {sousTitre && <p className="text-[12.5px] text-text-tertiary mt-0.5 truncate">{sousTitre}</p>}
        </div>
        <span className={cn('ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium',
          attente ? 'bg-[#fffbeb] text-[#b45309]' : ok ? 'bg-success-light text-success' : p.statut === 'echouee' ? 'bg-danger-light text-danger' : 'bg-surface-secondary text-text-tertiary')}>
          {attente ? (fr ? 'En attente' : 'Pending') : ok ? (p.auto ? (fr ? 'Confirmée auto' : 'Auto-confirmed') : (fr ? 'Confirmée' : 'Confirmed')) : p.statut === 'echouee' ? (fr ? 'Échouée' : 'Failed') : (fr ? 'Refusée' : 'Declined')}
        </span>
      </div>

      {groupe && (
        <div className="border-t border-outline">
          {groupe.map((g, i) => <LigneGroupe key={g.tool_use_id} p={g} fr={fr} index={i} />)}
        </div>
      )}
      {!groupe && (document || message || fusion || Object.keys(p.args).length > 0) && (
        <details className="group border-t border-outline" open={(!!document || !!fusion) && attente}>
          <summary className="flex cursor-pointer list-none items-center gap-2 bg-surface px-3.5 py-2 text-[12.5px] text-text-secondary [&::-webkit-details-marker]:hidden">
            {detailLabel}
            <ChevronDown size={14} className="ml-auto text-text-tertiary transition-transform group-open:rotate-180" />
          </summary>
          {document ? <DocumentApercu doc={document} fr={fr} /> : message ? <MessageApercu a={message} fr={fr} /> : fusion ? <FusionApercu a={fusion} fr={fr} /> : <ChampsApercu args={p.args as Record<string, unknown>} />}
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-outline bg-surface px-3.5 py-2.5">
        {attente ? (
          <>
            <button type="button" disabled={busy} onClick={() => onDecision('confirm')} className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {fr ? 'Confirmer' : 'Confirm'}
            </button>
            {!groupe && (
              <button type="button" disabled={busy} onClick={() => { onAutoriser(p.tool, true); onDecision('confirm', true); }} className="rounded-lg border border-outline-strong bg-surface-card px-3 py-1.5 text-[12.5px] font-medium text-text-secondary hover:bg-surface-secondary disabled:opacity-50">
                {fr ? `Toujours confirmer ${v.type}` : `Always confirm ${v.typeEn}`}
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => onDecision('cancel')} className="rounded-lg border border-outline-strong bg-surface-card px-3 py-1.5 text-[12.5px] font-medium text-text-secondary hover:text-danger disabled:opacity-50">
              {fr ? 'Refuser' : 'Decline'}
            </button>
            <span className="ml-auto text-[11.5px] text-text-tertiary">{groupe ? (fr ? `Les ${groupe.length} actions partent ensemble, dans l’ordre` : `All ${groupe.length} actions run together, in order`) : (fr ? 'Rien n’est fait avant que tu confirmes' : 'Nothing happens until you confirm')}</span>
          </>
        ) : ok ? (
          <>
            <span className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary"><span className="h-2 w-2 rounded-full bg-[#3FAF97]" aria-hidden="true" />{fr ? 'Fait' : 'Done'}</span>
            {!groupe && p.fiche && p.fiche.type !== 'task' && (
              <Link to={p.fiche.href} className="rounded-lg border border-outline-strong bg-surface-card px-3 py-1.5 text-[12.5px] font-medium text-text-secondary hover:bg-surface-secondary">{fr ? 'Ouvrir' : 'Open'}</Link>
            )}
            {!groupe && p.fiche && (p.fiche.type === 'quote' || p.fiche.type === 'invoice') && onSuite && document?.client?.name && (
              <button type="button" disabled={busy} onClick={() => onSuite(fr ? `Envoie ${p.fiche!.label.toLowerCase().startsWith('devis') ? 'la soumission' : 'la facture'} ${p.fiche!.label.split(' ').slice(1).join(' ')} à ${document.client!.name}` : `Send ${p.fiche!.label} to ${document.client!.name}`)} className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {fr ? `Envoyer à ${document.client.name.split(' ')[0]}` : `Send to ${document.client.name.split(' ')[0]}`}
              </button>
            )}
            {autorise && (
              <button type="button" onClick={() => onAutoriser(p.tool, false)} className="ml-auto text-[11.5px] text-text-tertiary underline hover:text-text-secondary">
                {fr ? 'Redemander à chaque fois' : 'Ask every time again'}
              </button>
            )}
          </>
        ) : (
          <span className={cn('inline-flex items-center gap-2 text-[12.5px]', p.statut === 'echouee' ? 'text-danger' : 'text-text-tertiary')}>
            <XCircle size={12} />{p.statut === 'echouee' ? (fr ? 'Ça n’a pas fonctionné, rien n’a été créé.' : 'It failed, nothing was created.') : (fr ? 'Annulée, rien n’a été fait.' : 'Cancelled, nothing was done.')}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Fiches liées : puces sous la réponse ──────────────────────────────── */
const TYPE_FICHE: Record<FicheLumi['type'], [string, string]> = {
  client: ['Client', 'Client'], lead: ['Prospect', 'Lead'], job: ['Job', 'Job'], quote: ['Soumission', 'Quote'], invoice: ['Facture', 'Invoice'], task: ['Tâche', 'Task'],
};

export function FichesLiees({ fiches, fr }: { fiches: FicheLumi[]; fr: boolean }) {
  if (!fiches.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {fiches.map((f) => (
        <Link key={f.href + f.label} to={f.href} className="inline-flex items-center gap-1.5 rounded-full border border-outline bg-surface px-2.5 py-1 text-[12px] text-text-secondary hover:border-outline-strong hover:text-text-primary">
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-text-tertiary">{fr ? TYPE_FICHE[f.type][0] : TYPE_FICHE[f.type][1]}</span>
          <span>{f.label}</span>
          {typeof f.montant_cents === 'number' && f.type !== 'client' && <span className="text-text-tertiary">· {fmtMontant(f.montant_cents)}</span>}
        </Link>
      ))}
    </div>
  );
}

/**
 * Transforme, dans un morceau de texte, les noms qui correspondent à une fiche
 * en liens vers cette fiche. Le nom d'un client (« Marie Tremblay ») ou un
 * numéro de document (« Q-0043 ») deviennent cliquables dans la phrase.
 */
export function avecLiensFiches(texte: string, fiches: FicheLumi[]): React.ReactNode {
  if (!fiches.length || !texte) return texte;
  const cles: Array<{ cle: string; fiche: FicheLumi }> = [];
  for (const f of fiches) {
    const nom = f.label.split(' · ')[0].replace(/^(Devis|Facture|Job #)\s*/i, '').trim();
    if (nom.length >= 3) cles.push({ cle: nom, fiche: f });
    const complet = f.label.split(' · ')[0].trim();
    if (complet !== nom && complet.length >= 3) cles.push({ cle: complet, fiche: f });
  }
  if (!cles.length) return texte;
  const echappe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${cles.map((c) => echappe(c.cle)).sort((x, y) => y.length - x.length).join('|')})`, 'g');
  const parts = texte.split(re);
  if (parts.length === 1) return texte;
  return parts.map((part, i) => {
    const c = cles.find((k) => k.cle === part);
    return c
      ? <Link key={i} to={c.fiche.href} className="border-b-[1.5px] border-[#3FAF97] text-text-primary hover:bg-[#3FAF97]/10">{part}</Link>
      : <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
