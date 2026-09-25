/**
 * WorkspaceNew — filet de sécurité post-paiement.
 *
 * Le workspace se crée normalement À L'INSCRIPTION (/checkout, OnboardingFlow :
 * compte → entreprise → coordonnées → préférences → avis → équipe → paiement).
 * Cette page plein écran ne sert qu'à un compte qui arrive dans l'app avec un
 * abonnement mais sans onboarding_done (paiement par lien, ancien compte…).
 * Elle réutilise les mêmes pages (src/components/workspace/WorkspaceForm.tsx)
 * et retrouve le brouillon saisi à l'inscription, s'il y en a un.
 */
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Building2, Check, Loader2, MapPin, Settings2, Star, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { captureClientException } from '../lib/sentry';
import { useCompany } from '../contexts/CompanyContext';
import { useTranslation } from '../i18n';
import { createWorkspace } from '../lib/workspacesApi';
import {
  WorkspacePage, pageTitle, useWorkspaceForm, type WorkspacePageId,
} from '../components/workspace/WorkspaceForm';

const STEPS: WorkspacePageId[] = ['company', 'contact', 'preferences', 'reviews', 'team', 'review'];

export default function WorkspaceNew({ onComplete }: { onComplete?: () => void }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const { currentOrgId, userId, refresh } = useCompany();
  const form = useWorkspaceForm({ language });

  const [step, setStep] = useState<WorkspacePageId>('company');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Préremplissage : nom du profil + nom d'org auto-provisionné (seulement
  // si l'utilisateur n'a rien saisi encore).
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
        if (profile?.full_name) form.setState((s) => (s.full_name ? s : { ...s, full_name: profile.full_name as string }));
        if (currentOrgId) {
          const { data: cs } = await supabase.from('company_settings').select('company_name').eq('org_id', currentOrgId).limit(1).maybeSingle();
          if (cs?.company_name) form.setState((s) => (s.company_name ? s : { ...s, company_name: cs.company_name as string }));
        }
      } catch (err) {
        console.warn('[WorkspaceNew] préremplissage échoué', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, currentOrgId]);

  const stepIdx = STEPS.indexOf(step);
  const companyValid = form.companyValid(true);
  const isOptional = step !== 'company' && step !== 'review';

  const goNext = () => {
    setError(null);
    if (step === 'company' && !companyValid) {
      setError(fr ? 'Nom, entreprise, industrie et taille d’équipe sont requis.' : 'Name, company, industry and team size are required.');
      return;
    }
    const next = STEPS[stepIdx + 1];
    if (next) setStep(next);
  };
  const goBack = () => { setError(null); const prev = STEPS[stepIdx - 1]; if (prev) setStep(prev); };

  const handleSubmit = async () => {
    if (!companyValid) { setStep('company'); return; }
    setSaving(true);
    setError(null);
    try {
      await createWorkspace(form.buildPayload());
      form.clearDraft();
      await refresh();
      toast.success(fr ? 'Votre workspace est prêt.' : 'Your workspace is ready.');
      onComplete?.();
    } catch (err: any) {
      captureClientException(err, { contexte: 'WorkspaceNew: createWorkspace' });
      setError(err?.message || (fr ? 'Échec de la création.' : 'Failed to create workspace.'));
      setSaving(false);
    }
  };

  const stepIcons: Record<WorkspacePageId, React.ComponentType<{ size?: number; className?: string }>> = {
    company: Building2, contact: MapPin, preferences: Settings2, reviews: Star, team: Users, review: Check,
  };

  return (
    <div className="relative min-h-screen bg-surface flex flex-col text-text-primary">
      <div className="relative px-6 pt-8 pb-2 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-text-primary flex items-center justify-center">
            <span className="text-[14px] font-bold text-surface">L</span>
          </div>
          <span className="text-[18px] font-semibold tracking-tight">Lume</span>
        </div>
        <h2 className="text-[30px] font-extrabold tracking-tight leading-tight">
          {fr ? 'Configurons votre workspace' : 'Let’s set up your workspace'}
        </h2>
        <p className="text-[13px] text-text-tertiary mt-1">
          {fr ? 'Quelques infos pour personnaliser votre CRM. Seule la première page est obligatoire.' : 'A few details to personalize your CRM. Only the first page is required.'}
        </p>
      </div>

      <div className="px-6 pt-4">
        <ol className="max-w-2xl mx-auto flex items-center gap-1.5">
          {STEPS.map((s, i) => {
            const Icon = stepIcons[s];
            const done = i < stepIdx;
            const active = s === step;
            const reachable = done || (i > 0 && companyValid);
            return (
              <li key={s} className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => { if (reachable) { setError(null); setStep(s); } }}
                  className={cn('w-full flex flex-col items-center gap-1.5', !reachable && 'cursor-default')}
                  aria-current={active ? 'step' : undefined}
                  aria-label={pageTitle(s, fr)}
                >
                  <span className={cn('h-1.5 w-full rounded-full transition-colors', (done || active) ? 'bg-primary' : 'bg-outline')} />
                  <span className={cn('flex items-center gap-1 text-[11px] font-semibold truncate', active ? 'text-primary' : done ? 'text-text-secondary' : 'text-text-tertiary')}>
                    <Icon size={11} />
                    <span className="hidden sm:inline">{pageTitle(s, fr)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex-1 px-6 py-6">
        <div className="max-w-2xl mx-auto rounded-xl border border-border bg-surface-card p-6">
          <div className="flex items-baseline justify-between mb-5">
            <h3 className="text-[16px] font-semibold">{pageTitle(step, fr)}</h3>
            {isOptional && <span className="text-[11px] font-medium text-text-tertiary">{fr ? 'facultatif' : 'optional'}</span>}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.14 }}
            >
              <WorkspacePage
                page={step}
                form={form}
                askFullName
                logoPath={currentOrgId || `pending/${userId || 'anon'}`}
                onEditPage={(p) => { setError(null); setStep(p); }}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 px-6 py-4 border-t border-border bg-surface">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <p className="text-[13px] text-danger min-h-[1rem] flex-1">{error || ''}</p>
          <div className="flex items-center gap-2 shrink-0">
            {stepIdx > 0 && (
              <button type="button" onClick={goBack} disabled={saving} className="glass-button inline-flex items-center gap-1.5">
                <ArrowLeft size={14} /> {fr ? 'Retour' : 'Back'}
              </button>
            )}
            {isOptional && (
              <button type="button" onClick={goNext} disabled={saving} className="glass-button-ghost">
                {fr ? 'Passer' : 'Skip'}
              </button>
            )}
            {step !== 'review' ? (
              <button type="button" onClick={goNext} disabled={saving} className="glass-button-primary inline-flex items-center gap-1.5">
                {fr ? 'Continuer' : 'Continue'} <ArrowRight size={14} />
              </button>
            ) : (
              <button type="button" onClick={handleSubmit} disabled={saving} className="glass-button-primary inline-flex items-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? (fr ? 'Création…' : 'Creating…') : (fr ? 'Terminer la configuration' : 'Finish setup')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
