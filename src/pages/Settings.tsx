import React, { useState, useEffect } from 'react';
import {
  User,
  Building2,
  Shield,
  Moon,
  CreditCard,
  Check,
  Loader2,
  Settings as SettingsIcon
} from 'lucide-react';
import { motion } from 'motion/react';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/ui';

export default function Settings() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'account' | 'billing' | 'workspace'>('account');
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function fetchProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        setProfile(data);
        setFullName(data?.full_name || '');
      }
      setLoading(false);
    }
    fetchProfile();
  }, []);

  async function handleSaveProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setSaving(true);
    setSaved(false);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() })
      .eq('id', user.id);
    setSaving(false);
    if (!error) {
      setSaved(true);
      setProfile((prev) => prev ? { ...prev, full_name: fullName.trim() } : prev);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  const tabs = [
    { id: 'account', label: 'Account', icon: User },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'workspace', label: 'Workspace', icon: Building2 },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Configure your LUME experience" icon={SettingsIcon} iconColor="purple" />

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Sidebar Tabs */}
        <div className="lg:w-56 flex flex-row lg:flex-col gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all',
                activeTab === tab.id
                  ? 'bg-primary text-white border-[1.5px] border-primary'
                  : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
              )}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 max-w-2xl">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-5"
          >
            {activeTab === 'account' && (
              <div className="space-y-5">
                <div className="section-card p-5 space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="avatar-md text-lg">
                      {profile?.full_name?.[0] || 'U'}
                    </div>
                    <div>
                      <h3 className="text-[13px] font-bold text-text-primary">Profile Picture</h3>
                      <p className="text-xs text-text-tertiary">Update your avatar across the workspace</p>
                      <span className="badge-neutral text-[10px] mt-1 inline-block">Coming soon</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Full Name</label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="glass-input w-full mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Email Address</label>
                      <input type="email" disabled className="glass-input w-full mt-1 opacity-50" />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveProfile}
                    disabled={saving || fullName.trim() === (profile?.full_name || '')}
                    className={cn(
                      'glass-button inline-flex items-center gap-1.5',
                      saved && '!bg-success !text-white !border-success'
                    )}
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
                    {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
                  </button>
                </div>

                <div className="section-card p-5 space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Security</h3>
                  <div className="flex items-center justify-between p-3 bg-surface-secondary rounded-xl">
                    <div className="flex items-center gap-3">
                      <Shield size={16} className="text-text-tertiary" />
                      <div>
                        <p className="text-[13px] font-semibold text-text-primary">Two-Factor Authentication</p>
                        <p className="text-xs text-text-tertiary">Add an extra layer of security</p>
                      </div>
                    </div>
                    <span className="badge-neutral text-[10px]">Coming soon</span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'billing' && (
              <div className="space-y-5">
                <div className="section-card p-5 bg-text-primary text-white overflow-hidden relative">
                  <div className="relative z-10 space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wider text-white/50">Current Plan</p>
                        <p className="text-xl font-bold mt-1">LUME Pro</p>
                      </div>
                      <span className="badge-success text-[10px]">Active</span>
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/50 mb-1">
                        <span>Usage</span>
                        <span>85%</span>
                      </div>
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-white w-[85%] rounded-full" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="section-card p-5 space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Subscription Tiers</h3>
                  <div className="space-y-2">
                    {['Free', 'Pro', 'Enterprise'].map(plan => (
                      <div key={plan} className={cn(
                        'flex items-center justify-between p-3 rounded-xl border-[1.5px] transition-all',
                        plan === 'Pro' ? 'border-primary bg-primary/5' : 'border-outline-subtle'
                      )}>
                        <div className="flex items-center gap-3">
                          <div className={cn('w-2 h-2 rounded-full', plan === 'Pro' ? 'bg-primary' : 'bg-border')} />
                          <span className="text-[13px] font-semibold text-text-primary">{plan}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-text-tertiary tabular-nums">
                            {plan === 'Free' ? '$0' : plan === 'Pro' ? '$29' : 'Custom'} / mo
                          </span>
                          {plan === 'Pro' ? (
                            <span className="badge-info text-[10px]">Current</span>
                          ) : (
                            <span className="badge-neutral text-[10px]">Coming soon</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'workspace' && (
              <div className="space-y-5">
                <div className="section-card p-5 space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">General</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Workspace Name</label>
                      <input type="text" defaultValue="Acme Corp" className="glass-input w-full mt-1" disabled />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Workspace URL</label>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-text-tertiary">lume.crm/</span>
                        <input type="text" defaultValue="acme-corp" className="glass-input flex-1" disabled />
                      </div>
                    </div>
                  </div>
                  <span className="badge-neutral text-[10px] inline-block">Workspace settings coming soon</span>
                </div>

                <div className="section-card p-5 space-y-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Appearance</h3>
                  <div className="flex items-center justify-between p-3 bg-surface-secondary rounded-xl">
                    <div className="flex items-center gap-3">
                      <Moon size={16} className="text-text-tertiary" />
                      <div>
                        <p className="text-[13px] font-semibold text-text-primary">Dark Mode</p>
                        <p className="text-xs text-text-tertiary">Switch to the dark aesthetic</p>
                      </div>
                    </div>
                    <span className="badge-neutral text-[10px]">Coming soon</span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
