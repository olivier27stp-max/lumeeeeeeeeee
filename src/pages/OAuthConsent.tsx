/* ═══════════════════════════════════════════════════════════════
   Écran de consentement OAuth
   ─────────────────────────────────────────────────────────────
   La seule page que l'utilisateur voit du parcours OAuth. Claude (ou
   un autre client MCP) l'envoie ici ; il autorise, et repart vers son
   application avec un accès lié à SON compte.

   Elle doit être honnête sur ce qui est accordé : lecture seule, et
   la liste de ce qui devient visible. Un écran de consentement vague
   est un écran que personne ne lit.

   Non connecté → on renvoie vers /auth en conservant l'URL complète,
   pour revenir ici après la connexion sans perdre les paramètres.
   ═══════════════════════════════════════════════════════════════ */

import { useContext, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTranslation } from '../i18n';
import { CompanyContext } from '../contexts/CompanyContext';

interface ClientInfo {
  client_id: string;
  client_name: string;
  logo_uri: string | null;
  client_uri: string | null;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const { language } = useTranslation();
  const fr = language === 'fr';
  // Le bureau actif : c'est LUI que l'autorisation va lier au connecteur.
  // Multi-bureaux → l'utilisateur doit voir lequel avant de cliquer, sinon
  // Claude pourrait agir dans le mauvais sans qu'il s'en rende compte.
  // On lit le contexte SANS useCompany() : cette page est aussi montée hors
  // de <CompanyProvider> (parcours public), où useCompany() lèverait. Absent
  // → on masque simplement le bandeau bureau, pas de plantage.
  const companyCtx = useContext(CompanyContext);
  const current = companyCtx?.current ?? null;
  const companies = companyCtx?.companies ?? [];

  const [client, setClient] = useState<ClientInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const scope = params.get('scope') || 'mcp:read';
  // Ce que l'application demande RÉELLEMENT : l'écran doit le refléter.
  // Un consentement qui dit « lecture seule » pendant que le jeton porte
  // l'écriture serait un mensonge — c'est ici que la vérité se joue.
  const demandeEcriture = scope.split(/\s+/).includes('mcp:write');
  const resource = params.get('resource') || '';
  const state = params.get('state') || '';

  // ── Session requise : sinon on passe par /auth et on revient ici ──
  useEffect(() => {
    let annule = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // La page d'authentification ne relaie pas de paramètre de retour :
        // on mémorise la demande nous-mêmes et on la rejoue au retour, plutôt
        // que de toucher au flux de connexion existant.
        try {
          sessionStorage.setItem('lume-oauth-retour', window.location.pathname + window.location.search);
        } catch { /* navigation privée : l'utilisateur relancera depuis Claude */ }
        window.location.replace('/auth');
        return;
      }
      if (!clientId || !redirectUri || !codeChallenge) {
        if (!annule) { setError(fr ? 'Demande incomplète.' : 'Incomplete request.'); setLoading(false); }
        return;
      }
      try {
        const r = await fetch(`/api/oauth/client-info?client_id=${encodeURIComponent(clientId)}`);
        if (!r.ok) throw new Error(fr ? 'Application inconnue.' : 'Unknown application.');
        const info = await r.json();
        if (!annule) { setClient(info); setLoading(false); }
      } catch (e: any) {
        if (!annule) { setError(e?.message || 'Erreur'); setLoading(false); }
      }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, redirectUri, codeChallenge]);

  async function autoriser() {
    setSubmitting(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error(fr ? 'Session expirée.' : 'Session expired.');

      const r = await fetch('/api/oauth/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          // Multi-bureaux : sans cet en-tête, l'autorisation se lie au
          // PREMIER bureau de l'utilisateur — pas forcément celui où il
          // travaille. Le serveur vérifie l'appartenance (anti-IDOR).
          ...(() => {
            try {
              const bureau = localStorage.getItem('lume-active-org');
              return bureau ? { 'x-org-id': bureau } : {};
            } catch { return {}; }
          })(),
        },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          scope,
          resource,
          state,
          // Transmet la session Supabase pour que le serveur puisse interroger
          // la base à VOTRE identité. Sans elle, il l'interroge en service_role
          // (sans auth.uid()) et les RPC qui vérifient l'appartenance à l'org
          // refusent : le chiffre d'affaires et les impayés deviennent
          // inaccessibles. Le jeton est chiffré au repos, jamais exposé.
          supabase_refresh_token: session.refresh_token,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error_description || json?.error || (fr ? 'Autorisation refusée.' : 'Authorization failed.'));
      // Retour vers le client MCP avec le code.
      window.location.replace(json.redirect_to);
    } catch (e: any) {
      setError(e?.message || 'Erreur');
      setSubmitting(false);
    }
  }

  function refuser() {
    if (!redirectUri) { window.location.replace('/'); return; }
    const u = new URL(redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (state) u.searchParams.set('state', state);
    window.location.replace(u.toString());
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-secondary/30">
        <Loader2 className="animate-spin text-text-tertiary" size={24} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-secondary/30 px-4 py-10">
      <div className="w-full max-w-md section-card p-6 space-y-5">
        {/* En-tête */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-surface-secondary flex items-center justify-center mx-auto">
            {client?.logo_uri
              ? <img src={client.logo_uri} alt="" className="w-7 h-7 rounded" />
              : <ShieldCheck size={22} className="text-text-tertiary" />}
          </div>
          <h1 className="text-[16px] font-semibold text-text-primary">
            {fr ? 'Autoriser l’accès à votre CRM' : 'Authorize access to your CRM'}
          </h1>
          <p className="text-[13px] text-text-secondary leading-relaxed">
            {fr ? (
              <><span className="font-medium text-text-primary">{client?.client_name}</span> demande à {demandeEcriture ? 'consulter votre CRM et à y créer des éléments' : 'consulter les données de Lume'} avec votre compte.</>
            ) : (
              <><span className="font-medium text-text-primary">{client?.client_name}</span> is requesting to {demandeEcriture ? 'read your CRM and create items in it' : 'read your Lume data'} using your account.</>
            )}
          </p>
        </div>

        {/* Le bureau lié : essentiel en multi-bureaux — l'accès sera collé à
            celui-ci, et Claude n'en verra pas d'autre tant que l'utilisateur
            ne reconnecte pas depuis le bon bureau. */}
        {current?.companyName && (
          <div className="rounded-lg bg-surface-secondary/50 border border-outline/40 p-3 flex items-start gap-2.5">
            <Building2 size={15} className="text-text-tertiary shrink-0 mt-0.5" />
            <div className="text-[12.5px] leading-relaxed">
              <span className="text-text-secondary">
                {fr ? 'Accès lié au bureau ' : 'Access tied to '}
              </span>
              <span className="font-semibold text-text-primary">{current.companyName}</span>
              <span className="text-text-secondary">
                {fr ? '. Claude n’agira que dans ce bureau.' : '. Claude will act only in this office.'}
              </span>
              {companies && companies.length > 1 && (
                <div className="mt-1 text-[11.5px] text-text-tertiary">
                  {fr
                    ? 'Vous avez plusieurs bureaux. Pour un autre, changez de bureau dans Lume, puis reconnectez le connecteur.'
                    : 'You have several offices. For a different one, switch office in Lume, then reconnect the connector.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ce qui est accordé — et ce qui ne l'est pas */}
        <div className="rounded-lg bg-surface-secondary/50 border border-outline/40 p-4 space-y-2.5">
          <div className="text-[12px] font-semibold text-text-primary">
            {fr ? 'Cette application pourra :' : 'This application will be able to:'}
          </div>
          <ul className="space-y-1.5 text-[12.5px] text-text-secondary">
            <li className="flex gap-2">
              <Check size={14} className="text-success shrink-0 mt-0.5" />
              {fr ? 'Consulter vos clients, prospects et travaux' : 'Read your clients, leads and jobs'}
            </li>
            <li className="flex gap-2">
              <Check size={14} className="text-success shrink-0 mt-0.5" />
              {fr ? 'Consulter vos devis, factures et revenus' : 'Read your quotes, invoices and revenue'}
            </li>
            <li className="flex gap-2">
              <Check size={14} className="text-success shrink-0 mt-0.5" />
              {fr ? 'Consulter votre horaire et vos tournées' : 'Read your schedule and routes'}
            </li>
          </ul>
          {demandeEcriture && (
            <>
              <div className="pt-1.5 border-t border-outline/40 text-[12px] font-semibold text-text-primary">
                {fr ? 'Et elle pourra aussi :' : 'And it will also be able to:'}
              </div>
              <ul className="space-y-1.5 text-[12.5px] text-text-secondary">
                <li className="flex gap-2">
                  <Check size={14} className="text-warning shrink-0 mt-0.5" />
                  {fr ? 'Créer des clients, travaux, tâches et devis' : 'Create clients, jobs, tasks and quotes'}
                </li>
                <li className="flex gap-2">
                  <Check size={14} className="text-warning shrink-0 mt-0.5" />
                  {fr ? 'Préparer des factures (brouillons — rien n’est envoyé)' : 'Prepare invoices (drafts — nothing is sent)'}
                </li>
                <li className="flex gap-2">
                  <Check size={14} className="text-warning shrink-0 mt-0.5" />
                  {fr ? 'Envoyer des SMS à vos clients en votre nom' : 'Send SMS to your clients on your behalf'}
                </li>
              </ul>
            </>
          )}
          <div className="pt-1.5 border-t border-outline/40 flex gap-2 text-[12.5px] text-text-secondary">
            <X size={14} className="text-danger shrink-0 mt-0.5" />
            <span>
              {demandeEcriture
                ? (fr
                  ? 'Elle ne peut rien supprimer ni encaisser, et chaque action est tracée à votre nom avec vos permissions Lume.'
                  : 'It cannot delete anything or take payments, and every action is logged under your name with your Lume permissions.')
                : (fr
                  ? 'Elle ne peut rien modifier, supprimer ni envoyer — l’accès est en lecture seule.'
                  : 'It cannot change, delete or send anything — access is read-only.')}
            </span>
          </div>
        </div>

        <p className="text-[11.5px] text-text-tertiary leading-relaxed">
          {fr
            ? 'Vous pourrez retirer cet accès à tout moment depuis Réglages › API & MCP.'
            : 'You can revoke this access at any time from Settings › API & MCP.'}
        </p>

        {error && <div className="text-[12.5px] text-danger">{error}</div>}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={refuser}
            disabled={submitting}
            className="flex-1 rounded-lg bg-surface-secondary hover:bg-surface-secondary/70 px-4 py-2.5 text-[13px] font-medium text-text-primary transition disabled:opacity-60"
          >
            {fr ? 'Refuser' : 'Deny'}
          </button>
          <button
            type="button"
            onClick={autoriser}
            disabled={submitting || !client}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-medium text-white transition disabled:opacity-60"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {fr ? 'Autoriser' : 'Authorize'}
          </button>
        </div>
      </div>
    </div>
  );
}
