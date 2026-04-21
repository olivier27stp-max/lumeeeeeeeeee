/* Onboarding Wizard — shown to new users after first signup
   3 steps: Company info → First client → First job
   Skippable at any step. Saves progress to company_settings + creates real data.
*/

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Building2, Users, Briefcase, ArrowRight, ArrowLeft,
  Check, X, Sparkles, Phone, Mail, MapPin,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { createClient } from '../lib/clientsApi';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';

interface OnboardingWizardProps {
  userId: string;
  orgId: string;
  language: string;
  onComplete: () => void;
}

const STEPS = [
  { id: 'company', icon: Building2, labelEn: 'Your Business', labelFr: 'Votre entreprise' },
  { id: 'client', icon: Users, labelEn: 'First Client', labelFr: 'Premier client' },
  { id: 'done', icon: Sparkles, labelEn: 'Ready!', labelFr: 'Pret !' },
] as const;

export default function OnboardingWizard({ userId, orgId: orgIdProp, language, onComplete }: OnboardingWizardProps) {
  const { t } = useTranslation();
  const fr = language === 'fr';
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [resolvedOrgId, setResolvedOrgId] = useState(orgIdProp);

  // Resolve org_id from CompanyContext or RPC on mount
  React.useEffect(() => {
    if (resolvedOrgId) return;
    getCurrentOrgIdOrThrow().then(setResolvedOrgId).catch(() => {});
  }, []);

  // Step 1: Company info
  const [companyName, setCompanyName] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');

  // Step 2: First client
  const [clientFirst, setClientFirst] = useState('');
  const [clientLast, setClientLast] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');

  const handleSaveCompany = useCallback(async () => {
    const trimmedName = companyName.trim();
    if (!trimmedName) {
      toast.error(fr ? 'Le nom de l\'entreprise est requis' : 'Company name is required');
      return false;
    }
    if (trimmedName.length < 2) {
      toast.error(fr ? 'Le nom doit contenir au moins 2 caractères' : 'Name must be at least 2 characters');
      return false;
    }
    // Reject obvious garbage: all-consonants strings under 6 chars (e.g. "sfdvsdc")
    if (trimmedName.length < 6 && !/[aeiouyAEIOUY]/.test(trimmedName)) {
      toast.error(fr ? 'Veuillez entrer un nom valide' : 'Please enter a valid name');
      return false;
    }
    setSaving(true);
    try {
      // Try upsert to company_settings
      const { error } = await supabase
        .from('company_settings')
        .upsert({
          org_id: resolvedOrgId,
          company_name: companyName.trim(),
          company_phone: companyPhone.trim() || null,
          company_email: companyEmail.trim() || null,
        }, { onConflict: 'org_id' });

      if (error) throw error;
      return true;
    } catch (err: any) {
      console.warn('Company save failed:', err?.message);
      // Don't block onboarding if table doesn't exist yet
      return true;
    } finally {
      setSaving(false);
    }
  }, [companyName, companyPhone, companyEmail, resolvedOrgId, fr]);

  const handleSaveClient = useCallback(async () => {
    if (!clientFirst.trim()) {
      toast.error(t.onboarding.firstNameIsRequired);
      return false;
    }
    setSaving(true);
    try {
      await createClient({
        first_name: clientFirst.trim(),
        last_name: clientLast.trim(),
        phone: clientPhone.trim() || undefined,
        email: clientEmail.trim() || undefined,
        status: 'active',
      });
      toast.success(t.onboarding.clientCreated);
      return true;
    } catch (err: any) {
      toast.error(err?.message || (t.onboarding.failedToCreateClient));
      return false;
    } finally {
      setSaving(false);
    }
  }, [clientFirst, clientLast, clientPhone, clientEmail, fr]);

  const handleNext = async () => {
    if (step === 0) {
      const ok = await handleSaveCompany();
      if (ok) setStep(1);
    } else if (step === 1) {
      if (clientFirst.trim()) {
        const ok = await handleSaveClient();
        if (ok) setStep(2);
      } else {
        setStep(2); // Skip if empty
      }
    } else {
      // Mark onboarding complete
      try {
        await supabase.from('profiles').update({ onboarding_done: true }).eq('id', userId);
      } catch { /* ignore if column doesn't exist */ }
      onComplete();
    }
  };

  const handleSkip = () => {
    if (step < 2) {
      setStep(step + 1);
    } else {
      (async () => {
        try {
          await supabase.from('profiles').update({ onboarding_done: true }).eq('id', userId);
        } catch { /* ignore */ }
        onComplete();
      })();
    }
  };

  const currentStep = STEPS[step];

  return (
    <div className="fixed inset-0 z-[200] bg-surface flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-[14px] font-bold text-white">L</span>
            </div>
            <span className="text-[18px] font-semibold tracking-tight text-text-primary">Lume</span>
          </div>
          <p className="text-[13px] text-text-tertiary">
            {t.onboarding.letsSetUpWorkspace}
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center transition-all',
                i < step ? 'bg-primary text-white' :
                i === step ? 'bg-primary/10 text-primary border-2 border-primary' :
                'bg-surface-secondary text-text-tertiary',
              )}>
                {i < step ? <Check size={14} /> : <s.icon size={14} />}
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn('w-12 h-0.5 rounded-full', i < step ? 'bg-primary' : 'bg-outline')} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="section-card overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
              className="p-6"
            >
              {/* Step 0: Company */}
              {step === 0 && (
                <div className="space-y-4">
                  <div className="text-center mb-2">
                    <h2 className="text-[18px] font-bold text-text-primary">
                      {t.onboarding.tellUsAboutYourBusiness}
                    </h2>
                    <p className="text-[13px] text-text-tertiary mt-1">
                      {t.onboarding.thisInfoWillAppearOnYourInvoicesAndQuote}
                    </p>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                      {fr ? 'Nom de l\'entreprise' : 'Company name'} *
                    </label>
                    <div className="relative mt-1">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={15} />
                      <input
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="glass-input w-full pl-10"
                        placeholder={t.onboarding.exAbcLandscaping}
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                        {t.modals.phone}
                      </label>
                      <div className="relative mt-1">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={15} />
                        <input
                          value={companyPhone}
                          onChange={(e) => setCompanyPhone(e.target.value)}
                          className="glass-input w-full pl-10"
                          placeholder="(555) 123-4567"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                        Email
                      </label>
                      <div className="relative mt-1">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={15} />
                        <input
                          type="email"
                          value={companyEmail}
                          onChange={(e) => setCompanyEmail(e.target.value)}
                          className="glass-input w-full pl-10"
                          placeholder="info@company.com"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 1: First client */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="text-center mb-2">
                    <h2 className="text-[18px] font-bold text-text-primary">
                      {t.onboarding.addYourFirstClient}
                    </h2>
                    <p className="text-[13px] text-text-tertiary mt-1">
                      {fr ? 'Vous pourrez en ajouter d\'autres plus tard.' : 'You can add more later.'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                        {t.onboarding.firstName}
                      </label>
                      <input
                        value={clientFirst}
                        onChange={(e) => setClientFirst(e.target.value)}
                        className="glass-input w-full mt-1"
                        placeholder="John"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                        {t.onboarding.lastName}
                      </label>
                      <input
                        value={clientLast}
                        onChange={(e) => setClientLast(e.target.value)}
                        className="glass-input w-full mt-1"
                        placeholder="Doe"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                        {t.modals.phone}
                      </label>
                      <input
                        value={clientPhone}
                        onChange={(e) => setClientPhone(e.target.value)}
                        className="glass-input w-full mt-1"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
                        Email
                      </label>
                      <input
                        type="email"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        className="glass-input w-full mt-1"
                        placeholder="john@example.com"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Done */}
              {step === 2 && (
                <div className="text-center py-4">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Sparkles size={28} className="text-primary" />
                  </div>
                  <h2 className="text-[20px] font-bold text-text-primary">
                    {t.onboarding.youreAllSet}
                  </h2>
                  <p className="text-[13px] text-text-tertiary mt-2 max-w-xs mx-auto">
                    {fr
                      ? 'Votre espace de travail est configure. Explorez le CRM et commencez a gerer vos clients.'
                      : 'Your workspace is set up. Explore the CRM and start managing your clients.'}
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2 text-[12px]">
                    <span className="px-3 py-1.5 rounded-full bg-surface-secondary text-text-secondary">
                      {t.onboarding.createLeads}
                    </span>
                    <span className="px-3 py-1.5 rounded-full bg-surface-secondary text-text-secondary">
                      {t.onboarding.scheduleJobs}
                    </span>
                    <span className="px-3 py-1.5 rounded-full bg-surface-secondary text-text-secondary">
                      {t.onboarding.sendInvoices}
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-outline bg-surface-secondary/50">
            <button
              onClick={handleSkip}
              className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {step === 2 ? '' : (t.onboarding.skip)}
            </button>
            <div className="flex items-center gap-2">
              {step > 0 && step < 2 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="glass-button inline-flex items-center gap-1.5"
                  disabled={saving}
                >
                  <ArrowLeft size={14} />
                  {t.companySettings.back}
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={saving}
                className="glass-button-primary inline-flex items-center gap-1.5"
              >
                {saving
                  ? (t.billing.saving)
                  : step === 2
                    ? (t.onboarding.getStarted)
                    : (t.billing.continue)}
                {!saving && <ArrowRight size={14} />}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
