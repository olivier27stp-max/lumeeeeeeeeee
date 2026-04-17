import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from '../i18n';

export default function VerifyEmail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'expired'>('loading');

  const token = searchParams.get('token');
  const email = searchParams.get('email');

  useEffect(() => {
    if (!token || !email) {
      setStatus('error');
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, token }),
        });

        if (res.ok) {
          setStatus('success');
        } else {
          const data = await res.json();
          setStatus(data.error === 'expired' ? 'expired' : 'error');
        }
      } catch {
        setStatus('error');
      }
    })();
  }, [token, email]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F8F9FA]">
      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card space-y-6 text-center"
        >
          <h1 className="text-3xl font-extralight tracking-widest">LUME</h1>

          {status === 'loading' && (
            <div className="space-y-4">
              <Loader2 className="w-12 h-12 text-gray-400 animate-spin mx-auto" />
              <p className="text-sm text-gray-500 font-light">{t.verifyEmail.verifying}</p>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
                <CheckCircle className="text-green-500" size={32} />
              </div>
              <h2 className="text-lg font-light">{t.verifyEmail.success}</h2>
              <p className="text-sm text-gray-500 font-light">{t.verifyEmail.successDesc}</p>
              <button
                onClick={() => navigate('/auth')}
                className="glass-button-primary w-full"
              >
                {t.verifyEmail.goToLogin}
              </button>
            </div>
          )}

          {status === 'expired' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-yellow-50 flex items-center justify-center mx-auto">
                <XCircle className="text-yellow-500" size={32} />
              </div>
              <h2 className="text-lg font-light">{t.verifyEmail.expired}</h2>
              <p className="text-sm text-gray-500 font-light">{t.verifyEmail.expiredDesc}</p>
              <button
                onClick={() => navigate('/register')}
                className="glass-button w-full"
              >
                {t.verifyEmail.tryAgain}
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
                <XCircle className="text-red-500" size={32} />
              </div>
              <h2 className="text-lg font-light">{t.verifyEmail.error}</h2>
              <p className="text-sm text-gray-500 font-light">{t.verifyEmail.errorDesc}</p>
              <button
                onClick={() => navigate('/auth')}
                className="glass-button w-full"
              >
                {t.verifyEmail.goToLogin}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
