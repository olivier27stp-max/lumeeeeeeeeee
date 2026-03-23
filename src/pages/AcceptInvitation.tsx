import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, Loader2, X, Users, Lock, User, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { verifyInvitation, acceptInvitation } from '../lib/invitationsApi';

export default function AcceptInvitation() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [state, setState] = useState<'loading' | 'form' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMessage('Invalid invitation link.');
      return;
    }

    (async () => {
      try {
        const data = await verifyInvitation(token);
        setOrgName(data.invitation.org_name);
        setEmail(data.invitation.email);
        setRole(data.invitation.role);
        setState('form');
      } catch (err: any) {
        setState('error');
        setErrorMessage(err.message || 'This invitation is invalid or has expired.');
      }
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    if (password.length < 8) return;
    if (password !== confirmPassword) return;

    setSubmitting(true);
    try {
      await acceptInvitation(token!, password, fullName.trim());
      setState('success');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to accept invitation.');
      setState('error');
    } finally {
      setSubmitting(false);
    }
  };

  const roleLabels: Record<string, string> = {
    admin: 'Admin',
    sales_rep: 'Sales Rep',
    technician: 'Technician',
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/lume-logo.png" alt="Lume CRM" className="h-16 mx-auto dark:invert" />
        </div>

        {/* Loading */}
        {state === 'loading' && (
          <div className="section-card p-8 text-center">
            <Loader2 size={24} className="animate-spin text-primary mx-auto mb-3" />
            <p className="text-[13px] text-text-secondary">Verifying invitation...</p>
          </div>
        )}

        {/* Error */}
        {state === 'error' && (
          <div className="section-card p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center mx-auto">
              <AlertTriangle size={20} className="text-danger" />
            </div>
            <h2 className="text-[16px] font-bold text-text-primary">Invitation Error</h2>
            <p className="text-[13px] text-text-secondary">{errorMessage}</p>
            <button
              onClick={() => navigate('/')}
              className="glass-button-primary inline-flex items-center gap-1.5 text-[12px]"
            >
              Go to Lume CRM
            </button>
          </div>
        )}

        {/* Form */}
        {state === 'form' && (
          <div className="section-card p-6 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Users size={20} className="text-primary" />
              </div>
              <h2 className="text-[18px] font-bold text-text-primary">Join {orgName}</h2>
              <p className="text-[13px] text-text-secondary">
                You've been invited to join as <span className="font-semibold text-text-primary">{roleLabels[role] || role}</span>
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email (read-only) */}
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="glass-input w-full mt-1 opacity-60"
                />
              </div>

              {/* Full Name */}
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Full Name *</label>
                <div className="relative mt-1">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="glass-input w-full !pl-9"
                    placeholder="John Doe"
                    required
                    autoFocus
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Password *</label>
                <div className="relative mt-1">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="glass-input w-full !pl-9"
                    placeholder="Min. 8 characters"
                    required
                    minLength={8}
                  />
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Confirm Password *</label>
                <div className="relative mt-1">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={cn(
                      'glass-input w-full !pl-9',
                      confirmPassword && password !== confirmPassword && '!border-danger'
                    )}
                    placeholder="Re-enter password"
                    required
                  />
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-[11px] text-danger mt-1">Passwords do not match.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || !fullName.trim() || password.length < 8 || password !== confirmPassword}
                className="glass-button-primary w-full !py-3 !text-[13px] inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 size={14} className="animate-spin" /> Creating account...</>
                ) : (
                  <><Check size={14} /> Accept & Join</>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Success */}
        {state === 'success' && (
          <div className="section-card p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <Check size={20} className="text-success" />
            </div>
            <h2 className="text-[16px] font-bold text-text-primary">Welcome to {orgName}!</h2>
            <p className="text-[13px] text-text-secondary">
              Your account has been created. You can now sign in to Lume CRM.
            </p>
            <button
              onClick={() => navigate('/')}
              className="glass-button-primary inline-flex items-center gap-1.5 text-[12px]"
            >
              Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
