import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '../components/d2d/input';
import { Button } from '../components/d2d/button';
import { Avatar } from '../components/d2d/avatar';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { Camera, User, Briefcase, Check } from 'lucide-react';

type UserRole = 'owner' | 'admin' | 'team_leader' | 'sales_rep';

const TOTAL_STEPS = 3;

export default function D2DOnboarding() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1 — Identity
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 2 — Role & Company
  const [role, setRole] = useState<UserRole>('sales_rep');
  const [companyName, setCompanyName] = useState('');

  // Step 3 — Bio
  const [bio, setBio] = useState('');

  // Check if user exists, redirect if not logged in
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        navigate('/login');
      } else {
        setUserId(user.id);
      }
    });
  }, [navigate]);

  function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function canAdvance(): boolean {
    if (step === 1) return firstName.trim().length > 0 && lastName.trim().length > 0 && phone.trim().length > 0;
    if (step === 2) return companyName.trim().length > 0;
    if (step === 3) return bio.trim().length > 0;
    return false;
  }

  async function handleNext() {
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
      return;
    }

    // Final step — save everything
    if (!userId) return;
    setIsLoading(true);
    setError('');

    try {
      let avatarUrl: string | null = null;

      // Upload avatar if provided
      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop();
        const path = `avatars/${userId}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, { upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
          avatarUrl = urlData.publicUrl;
        }
      }

      // Use company name as a deterministic company ID
      const companyId = companyName.trim().toLowerCase().replace(/\s+/g, '-');

      // Upsert profile
      const userEmail = (await supabase.auth.getUser()).data.user?.email ?? '';
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          company_id: companyId,
          email: userEmail,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim(),
          avatar_url: avatarUrl,
          role,
          bio: bio.trim(),
          is_active: true,
          hire_date: new Date().toISOString().split('T')[0],
        } as any);

      if (profileError) {
        setError(profileError.message);
        setIsLoading(false);
        return;
      }

      navigate('/dashboard');
    } catch {
      setError('An error occurred. Please try again.');
      setIsLoading(false);
    }
  }

  const roles: { value: UserRole; icon: React.ReactNode }[] = [
    { value: 'owner', icon: <Briefcase className="h-4 w-4" /> },
    { value: 'admin', icon: <Briefcase className="h-4 w-4" /> },
    { value: 'team_leader', icon: <User className="h-4 w-4" /> },
    { value: 'sales_rep', icon: <User className="h-4 w-4" /> },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F5F6F8] px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-6 flex flex-col items-center">
          <div className="h-9 w-9 rounded-lg bg-text-primary flex items-center justify-center text-surface font-bold text-sm">L</div>
          <h1 className="mt-4 text-lg font-semibold text-text-primary">Complete Your Profile</h1>
          <p className="mt-1 text-sm text-text-tertiary">Tell us about yourself to get started</p>
        </div>

        {/* Progress */}
        <div className="mb-6 flex items-center gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} className="flex-1">
              <div className={cn(
                'h-1 rounded-full transition-colors',
                i + 1 <= step ? 'bg-text-primary' : 'bg-border-subtle'
              )} />
            </div>
          ))}
        </div>
        <p className="mb-4 text-center text-[11px] text-text-muted">
          Step {step} of {TOTAL_STEPS}
        </p>

        {/* Card */}
        <div className="rounded-xl border border-border-subtle bg-white p-6 shadow-sm">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          )}

          {/* Step 1 — Identity */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Avatar */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="group relative"
                >
                  <Avatar
                    name={`${firstName} ${lastName}`.trim() || 'U'}
                    src={avatarPreview}
                    size="lg"
                    className="!h-20 !w-20"
                  />
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <Camera className="h-5 w-5 text-white" />
                  </div>
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
                <p className="mt-2 text-[10px] text-text-muted">Cliquez pour ajouter une photo</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-text-secondary">First Name</label>
                  <Input
                    placeholder="Jean"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-text-secondary">Last Name</label>
                  <Input
                    placeholder="Dupont"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-secondary">Phone</label>
                <Input
                  type="tel"
                  placeholder="819-555-0100"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {/* Step 2 — Role & Company */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-secondary">Company Name</label>
                <Input
                  placeholder="Clostra Inc."
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-secondary">Role</label>
                <div className="grid grid-cols-2 gap-2">
                  {roles.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all',
                        role === r.value
                          ? 'border-outline-strong bg-surface-secondary text-text-primary'
                          : 'border-border-subtle text-text-secondary hover:border-border hover:bg-surface-elevated'
                      )}
                    >
                      {r.icon}
                      <span className="text-[12px] font-medium">
                        {r.value}
                      </span>
                      {role === r.value && <Check className="ml-auto h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Bio */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-secondary">Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell us about yourself..."
                  rows={4}
                  className="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors hover:border-border focus:border-outline-strong focus:outline-none focus:ring-2 focus:ring-outline/30 resize-none"
                />
              </div>

              {/* Preview */}
              <div className="rounded-lg border border-border-subtle bg-surface-elevated p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-text-muted">Apercu du profil</p>
                <div className="flex items-center gap-3">
                  <Avatar
                    name={`${firstName} ${lastName}`}
                    src={avatarPreview}
                    size="lg"
                    className="!h-12 !w-12"
                  />
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">{firstName} {lastName}</p>
                    <p className="text-[11px] text-text-muted">{role} &middot; {companyName}</p>
                    <p className="text-[11px] text-text-tertiary">{phone}</p>
                  </div>
                </div>
                {bio && (
                  <p className="mt-2 text-[11px] text-text-secondary italic">&ldquo;{bio}&rdquo;</p>
                )}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="mt-6 flex gap-3">
            {step > 1 && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setStep(step - 1)}
              >
                Retour
              </Button>
            )}
            <Button
              className="flex-1"
              disabled={!canAdvance()}
              isLoading={isLoading}
              onClick={handleNext}
            >
              {step === TOTAL_STEPS ? 'Finish Setup' : 'Continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
