/* ═══════════════════════════════════════════════════════════════
   SatisfactionSurvey — Page publique /survey/:token (sans auth).

   Deux temps :
     1. la note (1-5 étoiles)
     2a. 4-5 étoiles → message d'invitation + Google / Facebook
         (redirection automatique si une seule plateforme est configurée)
     2b. 1-3 étoiles → formulaire de commentaires interne
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Star, Globe, Facebook, Check } from 'lucide-react';

// ── Langue (page publique, pas de contexte d'auth) ──
const isFr = ((typeof navigator !== 'undefined' && navigator.language) || 'fr').toLowerCase().startsWith('fr');

const AUTO_REDIRECT_SECONDS = 5;

interface Destination { platform: 'google' | 'facebook'; url: string }

interface SurveyData {
  token: string;
  submitted: boolean;
  rating: number | null;
  feedback_submitted: boolean;
  feedback_needed: boolean;
  client_name: string | null;
  job_name: string | null;
  company_name: string;
  destinations: Destination[];
  invite_message: string;
  invite_message_en: string;
}

type Step = 'rate' | 'public_review' | 'feedback' | 'done';

const T = {
  oops: isFr ? 'Oups' : 'Oops',
  load: isFr ? 'Impossible de charger le sondage.' : 'Unable to load survey.',
  fail: isFr ? 'Échec de l’envoi.' : 'Failed to submit.',
  yourExperience: isFr ? 'Votre expérience' : 'Your experience',
  regarding: isFr ? 'Concernant :' : 'Regarding:',
  sendRating: isFr ? 'Envoyer ma note' : 'Send my rating',
  sending: isFr ? 'Envoi…' : 'Sending…',
  pickStar: isFr ? 'Touchez une étoile pour noter' : 'Tap a star to rate',
  googleBtn: isFr ? 'Laisser un avis Google' : 'Leave a Google review',
  facebookBtn: isFr ? 'Laisser un avis Facebook' : 'Leave a Facebook review',
  redirecting: (n: number) => isFr ? `Redirection dans ${n} s…` : `Redirecting in ${n}s…`,
  noLink: isFr ? 'Merci ! Votre note a bien été enregistrée.' : 'Thank you! Your rating has been recorded.',
  sorry: isFr ? 'Nous sommes désolés que ce ne soit pas à la hauteur.' : 'We’re sorry it wasn’t up to par.',
  tellUs: isFr ? 'Dites-nous ce qui n’a pas fonctionné. Votre message est envoyé directement à l’équipe, pas publié.' : 'Tell us what went wrong. Your message goes straight to the team, it is not published.',
  feedbackPh: isFr ? 'Ce qui s’est passé, ce qu’on aurait pu mieux faire…' : 'What happened, what we could have done better…',
  sendFeedback: isFr ? 'Envoyer mes commentaires' : 'Send my feedback',
  thanksFeedback: isFr ? 'Merci pour votre franchise.' : 'Thank you for your honesty.',
  followUp: isFr ? 'Un membre de l’équipe vous contactera rapidement.' : 'A team member will reach out to you shortly.',
  alreadyDone: isFr ? 'Vos commentaires ont déjà été enregistrés.' : 'Your feedback has already been recorded.',
  thanks: isFr ? 'Merci !' : 'Thank you!',
  ratingLabels: isFr
    ? ['', 'Très insatisfait', 'Insatisfait', 'Correct', 'Satisfait', 'Excellent !']
    : ['', 'Very unhappy', 'Unhappy', 'Okay', 'Satisfied', 'Excellent!'],
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">{children}</div>
    </div>
  );
}

function Stars({ value, size = 32 }: { value: number; size?: number }) {
  return (
    <div className="flex justify-center gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={size} className={s <= value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'} />
      ))}
    </div>
  );
}

export default function SatisfactionSurvey() {
  const { token } = useParams<{ token: string }>();
  const [survey, setSurvey] = useState<SurveyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('rate');
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [inviteMessage, setInviteMessage] = useState('');
  const [autoRedirectUrl, setAutoRedirectUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REDIRECT_SECONDS);
  const redirectTimer = useRef<number | null>(null);

  // ── Chargement + reprise d'un sondage déjà commencé ──
  useEffect(() => {
    if (!token) return;
    fetch(`/api/survey/${token}`)
      .then((r) => r.json())
      .then((data: SurveyData & { error?: string }) => {
        if (data.error) { setError(data.error); return; }
        setSurvey(data);
        setDestinations(data.destinations || []);
        setInviteMessage(isFr ? data.invite_message : data.invite_message_en);
        if (data.submitted && data.rating != null) {
          setRating(data.rating);
          if (data.rating >= 4) {
            setStep('public_review');
            // Déjà noté : on montre les liens sans relancer le compte à rebours.
          } else if (data.feedback_needed) {
            setStep('feedback');
          } else {
            setStep('done');
          }
        }
      })
      .catch(() => setError(T.load))
      .finally(() => setLoading(false));
  }, [token]);

  // ── Redirection automatique (une seule plateforme configurée) ──
  useEffect(() => {
    if (!autoRedirectUrl) return;
    setCountdown(AUTO_REDIRECT_SECONDS);
    redirectTimer.current = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (redirectTimer.current) window.clearInterval(redirectTimer.current);
          window.location.assign(autoRedirectUrl);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (redirectTimer.current) window.clearInterval(redirectTimer.current); };
  }, [autoRedirectUrl]);

  async function submitRating() {
    if (!token || rating === 0 || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/survey/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || T.fail);

      setDestinations(data.destinations || []);
      setInviteMessage(isFr ? data.invite_message : data.invite_message_en);
      if (data.step === 'public_review') {
        setStep('public_review');
        if (data.auto_redirect_url) setAutoRedirectUrl(data.auto_redirect_url);
      } else {
        setStep('feedback');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFeedback() {
    if (!token || !feedback.trim() || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/survey/${token}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || T.fail);
      setStep('done');
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
      <Card>
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">{T.oops}</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </Card>
    );
  }

  const firstName = survey?.client_name ? survey.client_name.split(' ')[0] : '';
  const company = survey?.company_name || '';

  // ── 2a. Note haute : message + plateformes ──
  if (step === 'public_review') {
    return (
      <Card>
        <div className="text-center">
          <Stars value={rating} />
          <h1 className="text-xl font-bold text-gray-900 mt-5 mb-3">
            {firstName ? (isFr ? `Merci ${firstName} !` : `Thank you ${firstName}!`) : T.thanks}
          </h1>
          <p className="text-gray-600 mb-6">{inviteMessage}</p>

          {destinations.length === 0 ? (
            <p className="text-sm text-gray-500">{T.noLink}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {destinations.map((d) => (
                <a
                  key={d.platform}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={
                    d.platform === 'google'
                      ? 'inline-flex items-center justify-center gap-2 px-6 py-3 bg-neutral-900 text-white font-semibold rounded-xl hover:bg-neutral-800 transition-colors'
                      : 'inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#1877F2] text-white font-semibold rounded-xl hover:bg-[#166FE5] transition-colors'
                  }
                >
                  {d.platform === 'google' ? <Globe size={18} /> : <Facebook size={18} />}
                  {d.platform === 'google' ? T.googleBtn : T.facebookBtn}
                </a>
              ))}
              {autoRedirectUrl && countdown > 0 && (
                <p className="text-xs text-gray-400 mt-1">{T.redirecting(countdown)}</p>
              )}
            </div>
          )}
          {company && <p className="text-xs text-gray-400 mt-6">{company}</p>}
        </div>
      </Card>
    );
  }

  // ── 2b. Note basse : commentaires internes ──
  if (step === 'feedback') {
    return (
      <Card>
        <div className="text-center mb-6">
          <Stars value={rating} size={28} />
          <h1 className="text-xl font-bold text-gray-900 mt-5 mb-2">{T.sorry}</h1>
          <p className="text-gray-600 text-sm">{T.tellUs}</p>
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={T.feedbackPh}
          aria-label={T.tellUs}
          autoFocus
          maxLength={4000}
          className="w-full rounded-xl border border-gray-200 p-3 text-sm text-gray-900 placeholder-gray-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 resize-none"
          rows={5}
        />
        <button
          type="button"
          onClick={submitFeedback}
          disabled={!feedback.trim() || submitting}
          className="mt-4 w-full py-3 bg-neutral-900 text-white font-semibold rounded-xl hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? T.sending : T.sendFeedback}
        </button>
        {company && <p className="text-xs text-gray-400 mt-6 text-center">{company}</p>}
      </Card>
    );
  }

  // ── Terminé ──
  if (step === 'done') {
    return (
      <Card>
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Check size={24} />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">{T.thanksFeedback}</h1>
          <p className="text-gray-600">{survey?.feedback_submitted ? T.alreadyDone : T.followUp}</p>
        </div>
      </Card>
    );
  }

  // ── 1. La note ──
  return (
    <Card>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{company || T.yourExperience}</h1>
        <p className="text-gray-600">
          {firstName
            ? (isFr ? `Bonjour ${firstName}, comment s’est passé notre service ?` : `Hi ${firstName}, how did we do?`)
            : (isFr ? 'Comment s’est passé notre service ?' : 'How did we do?')}
        </p>
        {survey?.job_name && (
          <p className="text-sm text-gray-500 mt-1">
            {T.regarding} <strong>{survey.job_name}</strong>
          </p>
        )}
      </div>

      <div className="flex justify-center gap-2 mb-3">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`${s}/5`}
            onMouseEnter={() => setHoveredStar(s)}
            onMouseLeave={() => setHoveredStar(0)}
            onClick={() => setRating(s)}
            className="transition-transform hover:scale-110"
          >
            <Star
              size={44}
              className={`transition-colors ${
                s <= (hoveredStar || rating) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200 hover:text-yellow-200'
              }`}
            />
          </button>
        ))}
      </div>
      <p className="text-center text-sm text-gray-500 mb-8 h-5">
        {(hoveredStar || rating) ? T.ratingLabels[hoveredStar || rating] : T.pickStar}
      </p>

      <button
        type="button"
        onClick={submitRating}
        disabled={rating === 0 || submitting}
        className="w-full py-3 bg-neutral-900 text-white font-semibold rounded-xl hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? T.sending : T.sendRating}
      </button>
    </Card>
  );
}
