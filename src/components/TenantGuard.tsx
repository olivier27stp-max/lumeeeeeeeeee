/**
 * TenantGuard — prevents cross-tenant resource access via URL manipulation.
 *
 * Wraps detail pages (e.g. /clients/:id, /jobs/:id) and verifies the resource
 * belongs to the current company before rendering children.
 *
 * Usage:
 *   <TenantGuard table="clients" id={clientId}>
 *     <ClientDetails />
 *   </TenantGuard>
 *
 * If the resource doesn't exist or belongs to another org, shows an error.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { useTranslation } from '../i18n';

interface TenantGuardProps {
  /** Supabase table name to check */
  table: string;
  /** Resource ID to verify */
  id: string | undefined;
  /** Children to render if resource belongs to current org */
  children: React.ReactNode;
  /** Optional: redirect path on denial (default: go back) */
  redirectTo?: string;
}

type GuardState = 'loading' | 'allowed' | 'denied' | 'not_found';

export default function TenantGuard({ table, id, children, redirectTo }: TenantGuardProps) {
  const [state, setState] = useState<GuardState>('loading');
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';

  useEffect(() => {
    if (!id) {
      setState('not_found');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const orgId = await getCurrentOrgIdOrThrow();

        // Check if resource exists in the current org
        const { data, error } = await supabase
          .from(table)
          .select('id, org_id')
          .eq('id', id)
          .maybeSingle();

        if (cancelled) return;

        if (error || !data) {
          setState('not_found');
          return;
        }

        if (data.org_id !== orgId) {
          setState('denied');
          return;
        }

        setState('allowed');
      } catch {
        if (!cancelled) setState('denied');
      }
    })();

    return () => { cancelled = true; };
  }, [table, id]);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-outline border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (state === 'allowed') {
    return <>{children}</>;
  }

  // Denied or not found
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-500/10 mb-4">
          <ShieldAlert className="w-7 h-7 text-red-500" />
        </div>
        <h2 className="text-lg font-bold text-text-primary">
          {state === 'not_found'
            ? (fr ? 'Ressource introuvable' : 'Resource not found')
            : (fr ? 'Accès refusé' : 'Access denied')}
        </h2>
        <p className="text-sm text-text-secondary mt-2">
          {state === 'not_found'
            ? (fr ? 'Cette ressource n\'existe pas ou a été supprimée.' : 'This resource does not exist or has been deleted.')
            : (fr ? 'Cette ressource n\'appartient pas à votre compagnie.' : 'This resource does not belong to your company.')}
        </p>
        <button
          onClick={() => redirectTo ? navigate(redirectTo) : navigate(-1)}
          className="mt-4 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
        >
          {fr ? 'Retour' : 'Go back'}
        </button>
      </div>
    </div>
  );
}
