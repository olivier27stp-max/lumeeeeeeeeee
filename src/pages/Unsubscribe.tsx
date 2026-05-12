/* ═══════════════════════════════════════════════════════════════
   Page — Unsubscribe (public, no auth)

   Receives a signed token from a campaign email footer and records
   an opt-out for that email. CASL / CAN-SPAM compliance.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, Mail } from 'lucide-react';

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'error'>(token ? 'idle' : 'error');
  const [email, setEmail] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!token) setError('Missing token');
  }, [token]);

  const submit = async () => {
    setState('loading');
    try {
      const res = await fetch('/api/public/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setEmail(body.email || '');
      setState('ok');
    } catch (e: any) {
      setError(e.message);
      setState('error');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full">
        <div className="flex justify-center mb-4">
          <Mail className="w-12 h-12 text-blue-600" />
        </div>
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-2">
          Unsubscribe / Se désabonner
        </h1>

        {state === 'idle' && (
          <>
            <p className="text-gray-600 text-center mb-6">
              Click the button below to unsubscribe from this organization's marketing emails.
              <br />
              <span className="text-sm text-gray-500">
                Cliquez pour vous désabonner des courriels marketing.
              </span>
            </p>
            <button
              onClick={submit}
              className="w-full px-4 py-2 bg-rose-600 text-white rounded-md font-medium hover:bg-rose-700"
            >
              Confirm unsubscribe / Confirmer
            </button>
          </>
        )}

        {state === 'loading' && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        )}

        {state === 'ok' && (
          <div className="text-center">
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">You have been unsubscribed.</p>
            <p className="text-sm text-gray-500 mt-1">Vous avez été désabonné{email ? ` (${email})` : ''}.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="text-center">
            <XCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">Unable to unsubscribe.</p>
            <p className="text-sm text-gray-500 mt-1">{error || 'Invalid or expired link.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
