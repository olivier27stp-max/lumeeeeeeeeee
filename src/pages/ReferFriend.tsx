import React, { useState, useEffect } from 'react';
import {
  Gift,
  Copy,
  Check,
  Loader2,
  ArrowLeft,
  DollarSign,
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
  const [stats, setStats] = useState<ReferralStats>({ total: 0, converted: 0, pending: 0, total_rewards_cents: 0 });
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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
        console.error('Failed to load referral data:', err.message);
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

  return (
    <div className="space-y-8">
      <PageHeader
        title={t.referFriend.referAFriend}
        subtitle={isFr
          ? 'Gagnez des récompenses en référant des entreprises à Lume CRM.'
          : 'Earn rewards by referring businesses to Lume CRM.'}
        icon={Gift}
        iconColor="blue"
      >
        <button className="glass-button inline-flex items-center gap-1.5" onClick={() => navigate('/settings')}>
          <ArrowLeft size={14} />
          {t.manageTeam.settings}
        </button>
      </PageHeader>

      {/* Hero banner */}
      <div className="section-card p-6 bg-gradient-to-br from-primary via-primary to-blue-600 text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 w-40 h-40 bg-surface-card/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-surface-card/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-2">
            <Gift size={20} />
            <h2 className="text-[18px] font-bold">
              {t.referFriend.earn150UsdPerReferral}
            </h2>
          </div>
          <p className="text-[13px] text-white/80 max-w-lg leading-relaxed">
            {isFr
              ? 'Partagez votre code de parrainage avec d\'autres entreprises de service. Quand ils s\'abonnent, vous recevez une récompense prépayée de $150 USD.'
              : 'Share your referral code with other service businesses. When they subscribe, you receive a $150 USD prepaid reward.'}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: Users,         label: t.referFriend.totalReferred,   value: stats.total },
          { icon: Clock,         label: t.manageTeam.pending,             value: stats.pending },
          { icon: CheckCircle2,  label: t.referFriend.converted,            value: stats.converted },
          { icon: DollarSign,    label: t.referFriend.totalRewards, value: `$${(stats.total_rewards_cents / 100).toFixed(0)} USD` },
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
              title: t.referFriend.youGetRewarded,
              desc: t.referFriend.receive150UsdPrepaidRewardForEachConvers,
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
                        {['subscribed', 'reward_pending', 'rewarded'].includes(ref.status) ? (
                          <span className="text-success">${(ref.reward_amount_cents / 100).toFixed(0)} {ref.reward_currency}</span>
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
