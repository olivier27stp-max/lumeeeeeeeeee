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

  const isFr = (typeof navigator !== 'undefined' && navigator.language || 'fr').toLowerCase().startsWith('fr');

  // Les messages d'erreur du serveur sont en anglais uniquement. Les afficher
  // tels quels donne « Invitation not found. » à un client francophone, sous
  // un titre pourtant traduit. On les rend dans sa langue.
  const messageLisible = (brut: string, repli: string): string => {
    const m = String(brut || '').toLowerCase();
    if (!m) return repli;
    if (!isFr) return brut;
    if (m.includes('too many requests')) return 'Trop de tentatives. Réessayez dans quelques instants.';
    if (m.includes('not found') || m.includes('already used')) return "Cette invitation est introuvable ou a déjà été utilisée.";
    if (m.includes('expired')) return 'Cette invitation a expiré.';
    if (m.includes('invalid')) return "Ce lien d'invitation est invalide.";
    if (m.includes('network') || m.includes('failed to fetch')) return 'Connexion impossible. Vérifiez votre accès à Internet.';
    return repli;
  };


  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMessage(isFr ? "Lien d'invitation invalide." : 'Invalid invitation link.');
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
        setErrorMessage(messageLisible(err?.message, isFr ? 'Cette invitation est invalide ou a expiré.' : 'This invitation is invalid or has expired.'));
      }
    })();
  }, [token]);

  // Password policy checks (mirror server-side validation)
  const passwordErrors: string[] = [];
  if (password && password.length < 10) passwordErrors.push(isFr ? 'Min. 10 caractères' : 'Min. 10 characters');
  if (password && (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)))
    passwordErrors.push(isFr ? 'Majuscule, minuscule et chiffre requis' : 'Uppercase, lowercase & number required');
  if (password && !/[^a-zA-Z0-9]/.test(password)) passwordErrors.push(isFr ? 'Caractère spécial requis' : 'Special character required');
  const passwordValid = password.length >= 10
    && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password)
    && /[^a-zA-Z0-9]/.test(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    if (!passwordValid) return;
    if (password !== confirmPassword) return;

    setSubmitting(true);
    try {
      await acceptInvitation(token!, password, fullName.trim());
      setState('success');
    } catch (err: any) {
      setErrorMessage(messageLisible(err?.message, isFr ? "Échec de l'acceptation de l'invitation." : 'Failed to accept invitation.'));
      setState('error');
    } finally {
      setSubmitting(false);
    }
  };

  const roleLabels: Record<string, string> = {
    admin: isFr ? 'Administrateur' : 'Admin',
    sales_rep: isFr ? 'Représentant' : 'Sales Rep',
    technician: isFr ? 'Technicien' : 'Technician',
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
            <p className="text-[13px] text-text-secondary">{isFr ? "Vérification de l'invitation..." : 'Verifying invitation...'}</p>
          </div>
        )}

        {/* Error */}
        {state === 'error' && (
          <div className="section-card p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center mx-auto">
              <AlertTriangle size={20} className="text-danger" />
            </div>
            <h2 className="text-[16px] font-bold text-text-primary">{isFr ? "Erreur d'invitation" : 'Invitation Error'}</h2>
            <p className="text-[13px] text-text-secondary">{errorMessage}</p>
            <button
              onClick={() => navigate('/')}
              className="glass-button-primary inline-flex items-center gap-1.5 text-[12px]"
            >
              {isFr ? 'Aller à Lume CRM' : 'Go to Lume CRM'}
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
              <h2 className="text-[18px] font-bold text-text-primary">{isFr ? `Rejoindre ${orgName}` : `Join ${orgName}`}</h2>
              <p className="text-[13px] text-text-secondary">
                {isFr ? 'Vous avez été invité à rejoindre en tant que ' : "You've been invited to join as "}<span className="font-semibold text-text-primary">{roleLabels[role] || role}</span>
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email (read-only) */}
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Courriel' : 'Email'}</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="glass-input w-full mt-1 opacity-60"
                />
              </div>

              {/* Full Name */}
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Nom complet *' : 'Full Name *'}</label>
                <div className="relative mt-1">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="glass-input w-full !pl-9"
                    placeholder={isFr ? 'Jean Tremblay' : 'John Doe'}
                    required
                    autoFocus
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Mot de passe *' : 'Password *'}</label>
                <div className="relative mt-1">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="glass-input w-full !pl-9"
                    placeholder={isFr ? 'Min. 10 caractères' : 'Min. 10 characters'}
                    required
                    minLength={10}
                  />
                </div>
                {password && passwordErrors.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {passwordErrors.map((err) => (
                      <p key={err} className="text-[11px] text-danger">{err}</p>
                    ))}
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">{isFr ? 'Confirmer le mot de passe *' : 'Confirm Password *'}</label>
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
                    placeholder={isFr ? 'Ressaisir le mot de passe' : 'Re-enter password'}
                    required
                  />
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-[11px] text-danger mt-1">{isFr ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.'}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || !fullName.trim() || !passwordValid || password !== confirmPassword}
                className="glass-button-primary w-full !py-3 !text-[13px] inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {submitting ? (
                  <><Loader2 size={14} className="animate-spin" /> {isFr ? 'Création du compte...' : 'Creating account...'}</>
                ) : (
                  <><Check size={14} /> {isFr ? 'Accepter et rejoindre' : 'Accept & Join'}</>
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
            <h2 className="text-[16px] font-bold text-text-primary">{isFr ? `Bienvenue chez ${orgName}!` : `Welcome to ${orgName}!`}</h2>
            <p className="text-[13px] text-text-secondary">
              {isFr ? 'Votre compte a été créé. Vous pouvez maintenant vous connecter à Lume CRM.' : 'Your account has been created. You can now sign in to Lume CRM.'}
            </p>
            <button
              onClick={() => navigate('/')}
              className="glass-button-primary inline-flex items-center gap-1.5 text-[12px]"
            >
              {isFr ? 'Se connecter' : 'Sign In'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
