import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { rendueSansSession } from '../lib/routesSansSession';
// Pages en chargement différé (audit I4) : chaque page est son propre chunk.
const Auth = React.lazy(() => import('../pages/Auth'));
const Register = React.lazy(() => import('../pages/Register'));
const ResetPassword = React.lazy(() => import('../pages/ResetPassword'));
const VerifyEmail = React.lazy(() => import('../pages/VerifyEmail'));
const Privacy = React.lazy(() => import('../pages/Privacy'));
const Terms = React.lazy(() => import('../pages/Terms'));
const Subprocessors = React.lazy(() => import('../pages/Subprocessors'));
const MarketingNotFound = React.lazy(() => import('../pages/marketing/NotFound'));
import MarketingLayout from '../components/marketing/MarketingLayout';
const MarketingHome = React.lazy(() => import('../pages/marketing/Home'));
const MarketingFeatures = React.lazy(() => import('../pages/marketing/Features'));
const MarketingSolutions = React.lazy(() => import('../pages/marketing/Solutions'));
const MarketingIndustries = React.lazy(() => import('../pages/marketing/Industries'));
const MarketingIndustryDetail = React.lazy(() => import('../pages/marketing/IndustryDetail'));
const MarketingContact = React.lazy(() => import('../pages/marketing/Contact'));
const MarketingPricing = React.lazy(() => import('../pages/marketing/Pricing'));
const CheckoutSuccess = React.lazy(() => import('../pages/CheckoutSuccess'));
const OnboardingFlow = React.lazy(() => import('../pages/OnboardingFlow'));
const OAuthConsent = React.lazy(() => import('../pages/OAuthConsent'));

type PublicRoutesProps = {
  /** Called when the user clicks Back from the Auth page. */
  onAuthBack: () => void;
  /** When true, the checkout + success routes are also mounted (subscription-guard path). */
  includeCheckout?: boolean;
};

/**
 * Routes accessible without an authenticated session.
 * Covers marketing pages, legal pages, and the auth flow.
 * Used both on the "not logged in" path and on the "logged in without
 * subscription" path — the latter additionally mounts the checkout routes.
 */
export function PublicRoutes({ onAuthBack, includeCheckout = false }: PublicRoutesProps) {
  return (
    <Routes>
      {includeCheckout && (
        <>
          <Route path="/checkout/success" element={<CheckoutSuccess />} />
          <Route path="/checkout" element={<OnboardingFlow />} />
        </>
      )}
      <Route path="/auth" element={<Auth onBack={onAuthBack} />} />
      <Route path="/register" element={<Register />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/subprocessors" element={<Subprocessors />} />
      {/* Consentement OAuth : la page doit exister AUSSI hors session — elle
          mémorise la demande puis renvoie vers /auth, et le retour la rejoue.
          Sans cette route, un utilisateur déconnecté verrait la page d'accueil
          marketing et le client MCP attendrait un code qui n'arrive jamais. */}
      <Route path="/oauth/consent" element={<OAuthConsent />} />
      <Route element={<MarketingLayout />}>
        <Route index element={<MarketingHome />} />
        <Route path="features" element={<MarketingFeatures />} />
        <Route path="solutions" element={<MarketingSolutions />} />
        <Route path="industries" element={<MarketingIndustries />} />
        <Route path="industries/:slug" element={<MarketingIndustryDetail />} />
        <Route path="pricing" element={<MarketingPricing />} />
        <Route path="contact" element={<MarketingContact />} />
        <Route path="*" element={<PublicCatchAll />} />
      </Route>
    </Routes>
  );
}

/**
 * Le catch-all hors session. Une URL inconnue de la vitrine → 404 marketing.
 * Une URL de l'application (/jobs, /clients/…, /settings/billing) ouverte
 * sans session → la page de connexion, qui ramènera ici après.
 *
 * Audit QA prod 2026-09-09, n°7 : avant, tout finissait en 404 marketing —
 * signet, lien reçu par courriel, onglet restauré, session expirée depuis la
 * veille. Sans connaître le code, on concluait que l'app avait perdu les données.
 */
function PublicCatchAll() {
  const { pathname, search } = useLocation();
  if (rendueSansSession(pathname)) return <MarketingNotFound />;
  return <Navigate to={`/auth?next=${encodeURIComponent(pathname + search)}`} replace />;
}
