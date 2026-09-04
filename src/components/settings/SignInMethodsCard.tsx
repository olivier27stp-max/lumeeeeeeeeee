import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, Eye, EyeOff, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { getSignInMethods, setPassword as enregistrerMotDePasse, AuthApiError, type SignInMethods } from '../../lib/authApi';
import { passwordMeetsRules } from '../../lib/passwordRules';
import PasswordStrength from '../auth/PasswordStrength';

/**
 * Carte « Connexion » de Mon profil : quels moyens de connexion sont actifs
 * (Google, courriel + mot de passe), et un formulaire pour DÉFINIR un mot de
 * passe (compte créé avec Google) ou le CHANGER (mot de passe actuel exigé).
 *
 * Raison d'être : un client inscrit avec Google restait prisonnier de Google.
 * Avec un mot de passe, il se connecte avec l'un OU l'autre.
 */
export default function SignInMethodsCard() {
  const { language, t } = useTranslation();
  const isFr = language === 'fr';
  const navigate = useNavigate();

  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [chargement, setChargement] = useState(true);
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    getSignInMethods()
      .then(setMethods)
      .catch(() => setMethods(null))
      .finally(() => setChargement(false));
  }, []);

  const fermer = () => {
    setEditing(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setErreur(null);
  };

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!methods) return;
    setErreur(null);
    if (methods.hasPassword && !current) {
      setErreur(isFr ? 'Entre ton mot de passe actuel.' : 'Enter your current password.');
      return;
    }
    if (!passwordMeetsRules(next)) {
      setErreur(t.register.passwordTooWeak);
      return;
    }
    if (next !== confirm) {
      setErreur(t.register.passwordsDoNotMatch);
      return;
    }
    setSaving(true);
    try {
      await enregistrerMotDePasse({ currentPassword: methods.hasPassword ? current : undefined, newPassword: next });
      // Supabase révoque TOUTES les sessions du compte quand le mot de passe
      // est posé côté serveur (vérifié sur staging) : celle-ci est déjà morte.
      // Plutôt que de laisser l'app échouer au prochain appel, on repart
      // proprement vers la connexion, courriel pré-rempli — et le client
      // constate tout de suite qu'il peut entrer avec son mot de passe.
      toast.success(
        methods.hasPassword
          ? (isFr ? 'Mot de passe changé. Par sécurité, reconnecte-toi.' : 'Password changed. For security, please sign in again.')
          : (isFr ? 'Mot de passe défini. Reconnecte-toi avec ton courriel et ce mot de passe.' : 'Password set. Sign in again with your email and this password.'),
        { duration: 8000 },
      );
      await supabase.auth.signOut({ scope: 'local' }).catch(() => { /* session déjà révoquée */ });
      navigate('/auth', { replace: true, state: { passwordReset: true, email: methods.email } });
    } catch (err: any) {
      const code = err instanceof AuthApiError ? err.code : undefined;
      if (code === 'wrong_current') setErreur(isFr ? 'Mot de passe actuel incorrect.' : 'Current password is incorrect.');
      else if (code === 'same_password') setErreur(isFr ? 'Le nouveau mot de passe doit être différent de l’actuel.' : 'The new password must differ from the current one.');
      else if (code === 'weak_password') setErreur(t.register.passwordTooWeak);
      else if (code === 'mfa_required') setErreur(isFr ? 'Double authentification requise : déconnecte-toi, reconnecte-toi avec ton code, puis réessaie.' : 'Two-factor verification required: sign out, sign back in with your code, then try again.');
      else setErreur(err?.message || (isFr ? 'Échec de l’enregistrement.' : 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const Ligne = ({ nom, actif, detail }: { nom: string; actif: boolean; detail: string }) => (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-outline/60 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{nom}</p>
        <p className="text-[11px] text-text-tertiary">{detail}</p>
      </div>
      <span
        className={cn(
          'shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
          actif ? 'bg-success-light text-success' : 'bg-surface-tertiary text-text-tertiary',
        )}
      >
        {actif && <Check size={11} />}
        {actif ? (isFr ? 'Actif' : 'Active') : (isFr ? 'Non défini' : 'Not set')}
      </span>
    </div>
  );

  return (
    <div className="section-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-text-tertiary">{isFr ? 'Connexion' : 'Sign-in'}</p>
        {!chargement && methods && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="glass-button-ghost text-[11px] font-medium inline-flex items-center gap-1.5">
            <KeyRound size={12} />
            {methods.hasPassword
              ? (isFr ? 'Changer le mot de passe' : 'Change password')
              : (isFr ? 'Définir un mot de passe' : 'Set a password')}
          </button>
        )}
      </div>

      {chargement ? (
        <div className="h-16 rounded-xl bg-surface-tertiary animate-pulse" />
      ) : !methods ? (
        <p className="text-xs text-text-tertiary">{isFr ? 'Impossible de charger les moyens de connexion.' : 'Could not load sign-in methods.'}</p>
      ) : (
        <>
          <div>
            <Ligne
              nom={isFr ? 'Courriel et mot de passe' : 'Email and password'}
              actif={methods.hasPassword}
              detail={methods.email}
            />
            <Ligne
              nom="Google"
              actif={methods.google}
              detail={methods.google
                ? (isFr ? 'Bouton « Google » sur la page de connexion' : '“Google” button on the sign-in page')
                : (isFr ? 'Connecte-toi une fois avec Google pour le lier' : 'Sign in once with Google to link it')}
            />
          </div>

          {methods.google && !methods.hasPassword && !editing && (
            <p className="text-[11px] text-text-secondary leading-relaxed">
              {isFr
                ? 'Ton compte a été créé avec Google. Définis un mot de passe pour pouvoir aussi te connecter avec ton courriel, sans passer par Google.'
                : 'Your account was created with Google. Set a password so you can also sign in with your email, without going through Google.'}
            </p>
          )}

          {editing && (
            <form onSubmit={soumettre} className="space-y-3 pt-1">
              {methods.hasPassword && (
                <div>
                  <label className="text-xs font-medium text-text-tertiary">{isFr ? 'Mot de passe actuel' : 'Current password'}</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    className="glass-input w-full mt-1.5"
                  />
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-text-tertiary">{isFr ? 'Nouveau mot de passe' : 'New password'}</label>
                <div className="relative mt-1.5">
                  <input
                    type={showNext ? 'text' : 'password'}
                    autoComplete="new-password"
                    autoFocus={!methods.hasPassword}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    className="glass-input w-full pr-10"
                  />
                  <button type="button" onClick={() => setShowNext(!showNext)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary">
                    {showNext ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <PasswordStrength password={next} />
              </div>
              <div>
                <label className="text-xs font-medium text-text-tertiary">{t.register.confirmPassword}</label>
                <input
                  type={showNext ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="glass-input w-full mt-1.5"
                />
                {confirm.length > 0 && next !== confirm && (
                  <p className="text-[11px] text-danger mt-1">{t.register.passwordsDoNotMatch}</p>
                )}
              </div>

              {erreur && <p className="text-xs text-danger">{erreur}</p>}

              <div className="flex items-center gap-2">
                <button type="submit" disabled={saving} className="glass-button-primary text-[11px] inline-flex items-center gap-1.5">
                  {saving && <Loader2 size={11} className="animate-spin" />}
                  {isFr ? 'Enregistrer' : 'Save'}
                </button>
                <button type="button" onClick={fermer} disabled={saving} className="glass-button-ghost text-[11px]">
                  {isFr ? 'Annuler' : 'Cancel'}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
