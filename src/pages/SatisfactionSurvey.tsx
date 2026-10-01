/* ═══════════════════════════════════════════════════════════════
   SatisfactionSurvey — Page publique /survey/:token (sans auth).

   Un seul écran pour TOUS les clients (2026-09-30) : message d'invitation
   + choix Google / Facebook (redirection automatique si une seule
   plateforme est configurée). Aucune note d'étoiles avant, aucun filtrage
   selon la satisfaction : le « review gating » est interdit par Google et
   Facebook.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Globe, Facebook, Copy } from 'lucide-react';

// ── Langue (page publique, pas de contexte d'auth) ──
const isFr = ((typeof navigator !== 'undefined' && navigator.language) || 'fr').toLowerCase().startsWith('fr');

const AUTO_REDIRECT_SECONDS = 5;

interface Destination { platform: 'google' | 'facebook'; url: string }

interface SurveyTexts { question: string; invite_message: string }

interface SurveyData {
  token: string;
  client_name: string | null;
  job_name: string | null;
  company_name: string;
  destinations: Destination[];
  auto_redirect_url: string | null;
  invite_message: string;
  invite_message_en: string;
  texts?: SurveyTexts;
  texts_en?: SurveyTexts;
}

const T = {
  oops: isFr ? 'Oups' : 'Oops',
  load: isFr ? 'Impossible de charger la page.' : 'Unable to load the page.',
  regarding: isFr ? 'Concernant :' : 'Regarding:',
  googleBtn: isFr ? 'Laisser un avis Google' : 'Leave a Google review',
  facebookBtn: isFr ? 'Laisser un avis Facebook' : 'Leave a Facebook review',
  redirecting: (n: number) => isFr ? `Redirection dans ${n} s…` : `Redirecting in ${n}s…`,
  noLink: isFr ? 'Merci ! Votre lien a bien été reçu.' : 'Thank you! Your link was received.',
  defaultTitle: isFr ? 'Merci de nous avoir fait confiance !' : 'Thank you for trusting us!',
  commentTitle: isFr ? 'Un mot sur votre expérience ? (facultatif)' : 'A word about your experience? (optional)',
  commentPh: isFr ? 'Écrivez votre commentaire dans vos mots…' : 'Write your comment in your own words…',
  copyPublish: (p: string) => isFr ? `Copier et publier sur ${p}` : `Copy and publish on ${p}`,
  copied: (p: string) => isFr
    ? `Commentaire copié. Dans la fenêtre ${p}, collez-le (appui long ou Ctrl+V), puis Publier.`
    : `Comment copied. In the ${p} window, paste it (long press or Ctrl+V), then Publish.`,
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">{children}</div>
    </div>
  );
}

export default function SatisfactionSurvey() {
  const { token } = useParams<{ token: string }>();
  const [survey, setSurvey] = useState<SurveyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [autoRedirectUrl, setAutoRedirectUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REDIRECT_SECONDS);
  /** Commentaire public : copié dans le presse-papiers puis collé par le client sur Google / Facebook. */
  const [commentaire, setCommentaire] = useState('');
  const [copieSur, setCopieSur] = useState<string | null>(null);
  const redirectTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/survey/${token}`)
      .then((r) => r.json())
      .then((data: SurveyData & { error?: string }) => {
        if (data.error) { setError(data.error); return; }
        setSurvey(data);
        if (data.auto_redirect_url) setAutoRedirectUrl(data.auto_redirect_url);
      })
      .catch(() => setError(T.load))
      .finally(() => setLoading(false));
  }, [token]);

  /** Journalise la plateforme choisie (sans bloquer la navigation). */
  function noterChoix(platform: Destination['platform']) {
    if (!token) return;
    fetch(`/api/survey/${token}/choice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform }),
      keepalive: true,
    }).catch((err) => console.error('[survey] choice save failed:', err));
  }

  // ── Redirection automatique (une seule plateforme configurée) ──
  useEffect(() => {
    if (!autoRedirectUrl) return;
    setCountdown(AUTO_REDIRECT_SECONDS);
    redirectTimer.current = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (redirectTimer.current) window.clearInterval(redirectTimer.current);
          const seule = survey?.destinations?.[0];
          if (seule) noterChoix(seule.platform);
          window.location.assign(autoRedirectUrl);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => { if (redirectTimer.current) window.clearInterval(redirectTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRedirectUrl]);

  function arreterRedirection() {
    if (redirectTimer.current) window.clearInterval(redirectTimer.current);
    redirectTimer.current = null;
    setAutoRedirectUrl(null);
  }

  /**
   * Google n'a pas d'API pour publier un avis au nom du client : l'avis doit
   * être tapé par lui, connecté à son compte, sur la page Google. Le mieux
   * possible (ce que font Podium/Birdeye) : copier SES mots dans le
   * presse-papiers et ouvrir la fenêtre d'avis, où il colle et publie. On
   * n'écrit jamais le texte à sa place (politique Google : contenu authentique).
   * Copie + ouverture se font dans le geste du clic (sinon bloqués), la
   * sauvegarde chez nous suit sans bloquer.
   */
  function copierEtPublier(d: Destination) {
    const texte = commentaire.trim();
    const nom = d.platform === 'google' ? 'Google' : 'Facebook';
    if (texte) {
      try { void navigator.clipboard?.writeText(texte); } catch { /* presse-papiers refusé : le client retape */ }
      setCopieSur(nom);
      if (token) {
        fetch(`/api/survey/${token}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: texte, public: true }),
        }).catch((err) => console.error('[survey] public comment save failed:', err));
      }
    }
    noterChoix(d.platform);
    window.open(d.url, '_blank', 'noopener,noreferrer');
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-neutral-900" />
      </div>
    );
  }

  if (error || !survey) {
    return (
      <Card>
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">{T.oops}</h1>
          <p className="text-gray-600">{error || T.load}</p>
        </div>
      </Card>
    );
  }

  const texts = (isFr ? survey.texts : survey.texts_en) || null;
  const inviteMessage = isFr ? survey.invite_message : survey.invite_message_en;
  const firstName = survey.client_name ? survey.client_name.split(' ')[0] : '';
  const title = texts?.question || T.defaultTitle;
  const destinations = survey.destinations || [];

  return (
    <Card>
      <div className="text-center">
        {survey.company_name && (
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{survey.company_name}</p>
        )}
        <h1 className="text-xl font-bold text-gray-900 mb-3">
          {firstName ? `${isFr ? 'Bonjour' : 'Hi'} ${firstName}, ${title.charAt(0).toLowerCase()}${title.slice(1)}` : title}
        </h1>
        {survey.job_name && (
          <p className="text-sm text-gray-500 -mt-1 mb-3">
            {T.regarding} <strong>{survey.job_name}</strong>
          </p>
        )}
        <p className="text-gray-600 mb-6">{inviteMessage}</p>

        {destinations.length === 0 ? (
          <p className="text-sm text-gray-500">{T.noLink}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label htmlFor="commentaire-public" className="text-left text-sm font-medium text-gray-700">{T.commentTitle}</label>
            <textarea
              id="commentaire-public"
              value={commentaire}
              onFocus={arreterRedirection}
              onChange={(e) => { arreterRedirection(); setCommentaire(e.target.value); }}
              placeholder={T.commentPh}
              maxLength={4000}
              rows={4}
              className="w-full rounded-xl border border-gray-200 p-3 text-sm text-gray-900 placeholder-gray-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 resize-none"
            />
            {destinations.map((d) => {
              const nom = d.platform === 'google' ? 'Google' : 'Facebook';
              const classes = d.platform === 'google'
                ? 'inline-flex items-center justify-center gap-2 px-6 py-3 bg-neutral-900 text-white font-semibold rounded-xl hover:bg-neutral-800 transition-colors'
                : 'inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#1877F2] text-white font-semibold rounded-xl hover:bg-[#166FE5] transition-colors';
              return commentaire.trim() ? (
                <button key={d.platform} type="button" onClick={() => copierEtPublier(d)} className={classes}>
                  <Copy size={18} /> {T.copyPublish(nom)}
                </button>
              ) : (
                <a
                  key={d.platform}
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => { arreterRedirection(); noterChoix(d.platform); }}
                  className={classes}
                >
                  {d.platform === 'google' ? <Globe size={18} /> : <Facebook size={18} />}
                  {d.platform === 'google' ? T.googleBtn : T.facebookBtn}
                </a>
              );
            })}
            {copieSur && (
              <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{T.copied(copieSur)}</p>
            )}
            {autoRedirectUrl && countdown > 0 && !commentaire && (
              <p className="text-xs text-gray-400 mt-1">{T.redirecting(countdown)}</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
