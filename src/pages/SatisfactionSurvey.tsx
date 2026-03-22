/* ═══════════════════════════════════════════════════════════════
   SatisfactionSurvey — Public page for rating experience.
   Accessed via /survey/:token (no auth required).
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Star } from 'lucide-react';

interface SurveyData {
  token: string;
  submitted: boolean;
  rating: number | null;
  client_name: string | null;
  job_name: string | null;
  company_name: string;
  google_review_url: string | null;
}

export default function SatisfactionSurvey() {
  const { token } = useParams<{ token: string }>();
  const [survey, setSurvey] = useState<SurveyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{
    redirect_to_review: boolean;
    google_review_url: string | null;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!token) return;

    fetch(`/api/survey/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setSurvey(data);
          if (data.submitted) {
            setSubmitted(true);
            setRating(data.rating || 0);
          }
        }
      })
      .catch(() => setError('Unable to load survey.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit() {
    if (!token || rating === 0 || submitting) return;
    setSubmitting(true);

    try {
      const response = await fetch(`/api/survey/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, feedback: feedback.trim() || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to submit.');

      setSubmitted(true);
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-neutral-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Oops</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted && result) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          {/* Stars display */}
          <div className="flex justify-center gap-1 mb-6">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                size={32}
                className={s <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}
              />
            ))}
          </div>

          <h1 className="text-xl font-bold text-gray-900 mb-3">{result.message}</h1>

          {result.redirect_to_review && result.google_review_url && (
            <div className="mt-6">
              <p className="text-gray-600 mb-4">
                Would you mind sharing your experience on Google? It helps us a lot!
              </p>
              <a
                href={result.google_review_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-neutral-900 text-white font-semibold rounded-xl hover:bg-neutral-800 transition-colors"
              >
                <Star size={18} className="fill-white" />
                Leave a Google Review
              </a>
            </div>
          )}

          {!result.redirect_to_review && (
            <p className="text-gray-500 mt-4 text-sm">
              We appreciate your honesty. Our team will be in touch soon.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Thank you!</h1>
          <p className="text-gray-600">Your feedback has already been recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {survey?.company_name || 'Your experience'}
          </h1>
          {survey?.client_name && (
            <p className="text-gray-600">
              Hi {survey.client_name.split(' ')[0]}, how was your experience?
            </p>
          )}
          {survey?.job_name && (
            <p className="text-sm text-gray-500 mt-1">
              Regarding: <strong>{survey.job_name}</strong>
            </p>
          )}
        </div>

        {/* Star Rating */}
        <div className="flex justify-center gap-2 mb-8">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              type="button"
              onMouseEnter={() => setHoveredStar(s)}
              onMouseLeave={() => setHoveredStar(0)}
              onClick={() => setRating(s)}
              className="transition-transform hover:scale-110"
            >
              <Star
                size={40}
                className={`transition-colors ${
                  s <= (hoveredStar || rating)
                    ? 'text-yellow-400 fill-yellow-400'
                    : 'text-gray-200 hover:text-yellow-200'
                }`}
              />
            </button>
          ))}
        </div>

        {rating > 0 && (
          <p className="text-center text-sm text-gray-500 mb-6">
            {rating >= 4 ? 'Glad to hear it!' : rating >= 3 ? 'Thanks for your feedback.' : 'We\'re sorry to hear that.'}
          </p>
        )}

        {/* Feedback */}
        <div className="mb-6">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Any comments? (optional)"
            className="w-full rounded-xl border border-gray-200 p-3 text-sm text-gray-900 placeholder-gray-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 resize-none"
            rows={3}
          />
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className="w-full py-3 bg-neutral-900 text-white font-semibold rounded-xl hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </div>
    </div>
  );
}
