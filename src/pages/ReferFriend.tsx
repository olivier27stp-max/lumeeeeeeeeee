import React, { useState, useEffect } from 'react';
import {
  Gift,
  Copy,
  Check,
  Loader2,
  Users,
  Clock,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/ui';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import {
  fetchMyReferralCode,
  fetchReferralHistory,
  ReferralRequiresPaidPlanError,
  type Referral,
  type ReferralStats,
} from '../lib/referralsApi';

const STATUS_CONFIG: Record<string, { label_en: string; label_fr: string; color: string }> = {
  invited:        { label_en: 'Invited',          label_fr: 'Invité',            color: 'bg-surface-tertiary text-text-secondary' },
  signed_up:      { label_en: 'Signed Up',        label_fr: 'Inscrit',           color: 'bg-surface-secondary text-text-secondary' },
  subscribed:     { label_en: 'Subscribed',        label_fr: 'Abonné',           color: 'bg-success/10 text-success' },
  reward_pending: { label_en: 'Reward Pending',    label_fr: 'Récompense en attente', color: 'bg-warning/10 text-warning' },
  rewarded:       { label_en: 'Rewarded',          label_fr: 'Récompensé',        color: 'bg-success/10 text-success' },
};

export default function ReferFriend() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const isFr = language === 'fr';

  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [referralLink, setReferralLink] = useState('');
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [stats, setStats] = useState<ReferralStats>({ total: 0, converted: 0, pending: 0, free_months_earned: 0 });
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [needsPaidPlan, setNeedsPaidPlan] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [codeData, historyData] = await Promise.all([
          fetchMyReferralCode(),
          fetchReferralHistory(),
        ]);
        setCode(codeData.code);
        setReferralLink(codeData.referral_link);
        setReferrals(historyData.referrals);
        setStats(historyData.stats);
      } catch (err: any) {
        if (err instanceof ReferralRequiresPaidPlanError) {
          setNeedsPaidPlan(true);
        } else {
          console.error('Failed to load referral data:', err.message);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const copyToClipboard = async (text: string, type: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
      toast.success(t.referFriend.copied);
    } catch {
      toast.error(t.referFriend.failedToCopy);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (needsPaidPlan) {
    return (
      <div className="space-y-8">
        <PageHeader
          title={t.referFriend.referAFriend}
          subtitle={isFr
            ? 'Parrainez des entreprises et gagnez des mois gratuits.'
            : 'Refer businesses and earn free months.'}
          icon={Gift}
          iconColor="blue"
        />
        <div className="section-card p-8 text-center max-w-lg mx-auto space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Gift size={22} className="text-primary" />
          </div>
          <h3 className="text-[16px] font-bold text-text-primary">
            {isFr ? 'Passez à un plan payant pour parrainer' : 'Upgrade to a paid plan to refer'}
          </h3>
          <p className="text-[13px] text-text-tertiary leading-relaxed">
            {isFr
              ? 'Le programme de parrainage est réservé aux abonnés payants. Chaque entreprise que vous parrainez et qui s\'abonne vous fait gagner un mois gratuit.'
              : 'The referral program is for paid subscribers. Every business you refer that subscribes earns you a free month.'}
          </p>
          <button className="glass-button-primary inline-flex items-center gap-2" onClick={() => navigate('/settings/billing')}>
            {isFr ? 'Voir les plans' : 'View plans'}
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={t.referFriend.referAFriend}
        subtitle={isFr
          ? 'Gagnez des récompenses en référant des entreprises à Lume CRM.'
          : 'Earn rewards by referring businesses to Lume CRM.'}
        icon={Gift}
        iconColor="blue"
      />

      {/* Hero banner */}
      <div className="section-card p-6 bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 w-40 h-40 bg-surface-card/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-surface-card/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-2">
            <Gift size={20} />
            <h2 className="text-[18px] font-bold">
              {isFr ? 'Gagnez 1 mois gratuit par parrainage' : 'Earn 1 free month per referral'}
            </h2>
          </div>
          <p className="text-[13px] text-white/80 max-w-lg leading-relaxed">
            {isFr
              ? 'Partagez votre lien de parrainage avec d\'autres entreprises de service. L\'entreprise que vous parrainez obtient son premier mois gratuit, et vous recevez un crédit d\'un mois sur votre prochaine facture — cumulable à l\'infini.'
              : 'Share your referral link with other service businesses. The business you refer gets their first month free, and you get a one-month credit on your next invoice — stack as many as you want.'}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Users,         label: t.referFriend.totalReferred,   value: stats.total },
          { icon: Clock,         label: t.manageTeam.pending,             value: stats.pending },
          { icon: CheckCircle2,  label: t.referFriend.converted,            value: stats.converted },
          { icon: Gift,          label: isFr ? 'Mois gratuits' : 'Free months', value: stats.free_months_earned },
        ].map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className="section-card p-4 space-y-1">
              <Icon size={14} className="text-text-tertiary" />
              <p className="text-[18px] font-bold text-text-primary tabular-nums">{stat.value}</p>
              <p className="text-[11px] text-text-tertiary">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Referral Code + Link */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Code */}
        <div className="section-card p-5 space-y-3">
          <h3 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
            {t.referFriend.yourReferralCode}
          </h3>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-surface-secondary rounded-xl px-4 py-3 text-center">
              <span className="text-[18px] font-bold text-text-primary tracking-wider font-mono">{code}</span>
            </div>
            <button
              onClick={() => copyToClipboard(code, 'code')}
              className={cn(
                'glass-button inline-flex items-center gap-1.5 !py-3 shrink-0',
                copiedCode && '!bg-success !text-white !border-success'
              )}
            >
              {copiedCode ? <Check size={14} /> : <Copy size={14} />}
              {copiedCode ? (t.invoiceDetails.copied) : (t.noteCanvas.copy)}
            </button>
          </div>
        </div>

        {/* Link */}
        <div className="section-card p-5 space-y-3">
          <h3 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
            {t.referFriend.yourReferralLink}
          </h3>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-surface-secondary rounded-xl px-4 py-3 overflow-hidden">
              <span className="text-[12px] text-text-secondary truncate block">{referralLink}</span>
            </div>
            <button
              onClick={() => copyToClipboard(referralLink, 'link')}
              className={cn(
                'glass-button inline-flex items-center gap-1.5 !py-3 shrink-0',
                copiedLink && '!bg-success !text-white !border-success'
              )}
            >
              {copiedLink ? <Check size={14} /> : <Copy size={14} />}
              {copiedLink ? (t.invoiceDetails.copied) : (t.noteCanvas.copy)}
            </button>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="section-card p-5 space-y-4">
        <h3 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
          {t.referFriend.howItWorks}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              step: '1',
              title: t.referFriend.shareYourLink,
              desc: t.referFriend.sendYourReferralLinkToAColleagueOrBusine,
            },
            {
              step: '2',
              title: isFr ? 'Ils s\'abonnent' : 'They subscribe',
              desc: t.referFriend.whenTheyCreateAnAccountAndChooseAPaidPla,
            },
            {
              step: '3',
              title: isFr ? 'Vous gagnez un mois' : 'You earn a month',
              desc: isFr
                ? 'Un crédit d\'un mois est appliqué automatiquement à votre prochaine facture. Cumulable à l\'infini.'
                : 'A one-month credit is applied automatically to your next invoice. Stack as many as you want.',
            },
          ].map((item) => (
            <div key={item.step} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[13px] font-bold shrink-0">
                {item.step}
              </div>
              <div>
                <p className="text-[13px] font-semibold text-text-primary">{item.title}</p>
                <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Referral History */}
      <div className="section-card p-5 space-y-4">
        <h3 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
          {t.referFriend.referralHistory}
        </h3>

        {referrals.length === 0 ? (
          <div className="py-8 text-center">
            <Users size={20} className="text-text-tertiary mx-auto mb-2 opacity-40" />
            <p className="text-[13px] text-text-tertiary">
              {t.referFriend.noReferralsYetShareYourLinkToGetStarted}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-outline-subtle">
                  <th className="py-2 pr-4 text-xs font-medium text-text-tertiary uppercase">{t.billing.email}</th>
                  <th className="py-2 pr-4 text-xs font-medium text-text-tertiary uppercase">{t.automations.status}</th>
                  <th className="py-2 pr-4 text-xs font-medium text-text-tertiary uppercase">{t.payments.date}</th>
                  <th className="py-2 text-xs font-medium text-text-tertiary uppercase">{t.referFriend.reward}</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((ref) => {
                  const statusCfg = STATUS_CONFIG[ref.status] || STATUS_CONFIG.invited;
                  return (
                    <tr key={ref.id} className="border-b border-outline-subtle/50 last:border-0">
                      <td className="py-3 pr-4 text-[13px] text-text-primary">{ref.referred_email}</td>
                      <td className="py-3 pr-4">
                        <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', statusCfg.color)}>
                          {isFr ? statusCfg.label_fr : statusCfg.label_en}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-[12px] text-text-secondary">
                        {new Date(ref.created_at).toLocaleDateString(t.dashboard.enus, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="py-3 text-[12px] font-semibold">
                        {ref.status === 'rewarded' ? (
                          <span className="text-success">{isFr ? '1 mois gratuit' : '1 free month'}</span>
                        ) : ['subscribed', 'reward_pending'].includes(ref.status) ? (
                          // Converted but the credit hasn't landed yet — don't
                          // claim it's granted; say it's on the way.
                          <span className="text-warning">{isFr ? '1 mois — en traitement' : '1 month — processing'}</span>
                        ) : (
                          <span className="text-text-tertiary">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
