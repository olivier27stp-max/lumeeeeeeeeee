import React, { useState, useEffect } from 'react';
import {
  Phone,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/ui';
import { useTranslation } from '../i18n';

export default function PhoneNumberSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const s = t.settings;

  const [loading, setLoading] = useState(true);
  const [companyPhone, setCompanyPhone] = useState<string | null>(null);

  // Future: replace with real Twilio number from user/org record
  const twilioPhoneNumber: string | null = null;

  useEffect(() => {
    async function fetchCompanyPhone() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data } = await supabase
        .from('company_settings')
        .select('phone')
        .limit(1)
        .maybeSingle();

      if (data?.phone) {
        setCompanyPhone(data.phone);
      }
      setLoading(false);
    }
    fetchCompanyPhone();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-2xl mx-auto"
    >
      <PageHeader
        title={s.phoneNumber}
        subtitle={s.phoneNumberSubtitle}
      />

      {/* ── Your Number ─────────────────────────────── */}
      <div className="section-card p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Phone size={16} className="text-primary" />
          <h3 className="text-[13px] font-bold text-text-primary uppercase tracking-wider">
            {s.yourNumber}
          </h3>
        </div>

        <div className="flex flex-col items-center py-8 space-y-3">
          {twilioPhoneNumber ? (
            <span className="text-2xl font-bold text-text-primary tracking-wide">
              {twilioPhoneNumber}
            </span>
          ) : (
            <span className="badge-neutral text-sm px-4 py-1.5 font-semibold">
              {t.common.comingSoon}
            </span>
          )}
          <p className="text-[13px] text-text-tertiary text-center max-w-sm">
            {s.yourNumberDesc}
          </p>
        </div>
      </div>

      {/* ── Call Forwarding ──────────────────────────── */}
      <div className="section-card p-6 space-y-4">
        <h3 className="text-[13px] font-bold text-text-primary uppercase tracking-wider">
          {s.callForwarding}
        </h3>

        <div className="space-y-3">
          <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
            {s.callsForwardTo}
          </label>

          {companyPhone ? (
            <button
              onClick={() => navigate('/settings/company')}
              className="group flex items-center gap-3 w-full p-4 rounded-xl border border-outline-subtle hover:border-primary/40 hover:bg-primary/5 transition-all text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-surface-secondary flex items-center justify-center shrink-0">
                <Phone size={15} className="text-text-tertiary group-hover:text-primary transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[15px] font-semibold text-text-primary group-hover:text-primary transition-colors">
                  {companyPhone}
                </span>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                  {s.phoneNumber} &middot; {t.common.edit}
                </p>
              </div>
              <ArrowRight size={14} className="text-text-tertiary group-hover:text-primary transition-colors shrink-0" />
            </button>
          ) : (
            <div className="p-4 rounded-xl border border-outline-subtle bg-surface-secondary/40 space-y-2">
              <p className="text-[13px] text-text-tertiary font-medium">
                {s.noNumberSet}
              </p>
              <button
                onClick={() => navigate('/settings/company')}
                className="text-[12px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
              >
                {s.setupInCompany}
                <ArrowRight size={12} />
              </button>
            </div>
          )}
        </div>

        <p className="text-[12px] text-text-tertiary leading-relaxed">
          {s.callForwardingDesc}
        </p>
      </div>
    </motion.div>
  );
}
