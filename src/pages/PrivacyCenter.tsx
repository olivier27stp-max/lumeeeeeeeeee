import { useState } from 'react';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import {
  exportMyData,
  submitDsarRequest,
  clearStoredConsent,
} from '../lib/consentApi';

/**
 * Preference Center (self-service DSR for logged-in users).
 * Route: /account/privacy
 *
 * - Export my data (JSON download)
 * - Request erasure (formal DSAR with 30-day SLA)
 * - Reset cookie choices
 */
export default function PrivacyCenter() {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [justification, setJustification] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function handleExport() {
    setMessage(null);
    setDownloading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setMessage({ kind: 'err', text: 'Not authenticated.' });
        return;
      }
      const blob = await exportMyData(session.access_token);
      if (!blob) {
        setMessage({ kind: 'err', text: t.legal.exportError });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lume-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  async function handleErasureRequest() {
    setMessage(null);
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id || !session.access_token) {
        setMessage({ kind: 'err', text: 'Not authenticated.' });
        return;
      }
      const res = await submitDsarRequest({
        subjectType: 'user',
        subjectId: session.user.id,
        requestType: 'erasure',
        justification,
        authToken: session.access_token,
      });
      if (res.error) {
        setMessage({ kind: 'err', text: res.error });
      } else {
        setMessage({ kind: 'ok', text: t.legal.requestSubmitted });
        setJustification('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetCookieConsent() {
    clearStoredConsent();
    window.location.reload();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {t.legal.preferenceCenter}
      </h1>

      {message && (
        <div
          className={`mt-4 rounded-md p-3 text-sm ${
            message.kind === 'ok'
              ? 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200'
              : 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      <section className="mt-8 rounded-lg border border-gray-200 p-5 dark:border-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t.legal.exportMyData}
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t.legal.exportMyDataDesc}
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={downloading}
          className="mt-3 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
        >
          {downloading ? '…' : t.legal.download}
        </button>
      </section>

      <section className="mt-6 rounded-lg border border-red-200 bg-red-50/50 p-5 dark:border-red-900 dark:bg-red-900/10">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t.legal.requestErasure}
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t.legal.requestErasureDesc}
        </p>
        <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t.legal.justificationLabel}
        </label>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value.slice(0, 2000))}
          rows={3}
          className="mt-1 w-full rounded-md border border-gray-300 bg-white p-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        />
        <button
          type="button"
          onClick={handleErasureRequest}
          disabled={submitting}
          className="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {submitting ? '…' : t.legal.submit}
        </button>
      </section>

      <section className="mt-6 rounded-lg border border-gray-200 p-5 dark:border-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Cookies</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Reset your cookie choices — the banner will reappear on the next page load.
        </p>
        <button
          type="button"
          onClick={resetCookieConsent}
          className="mt-3 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
        >
          Reset cookie preferences
        </button>
      </section>
    </div>
  );
}
