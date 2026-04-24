import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import QuoteView from '../pages/QuoteView';
import SatisfactionSurvey from '../pages/SatisfactionSurvey';
import ClientPortal from '../pages/ClientPortal';
import PublicPayment from '../pages/PublicPayment';
import AcceptInvitation from '../pages/AcceptInvitation';

type TokenKind = 'quote' | 'survey' | 'portal' | 'pay' | 'invite';

const ELEMENTS: Record<TokenKind, { path: string; element: ReactElement }> = {
  quote: { path: '/quote/:token', element: <QuoteView /> },
  survey: { path: '/survey/:token', element: <SatisfactionSurvey /> },
  portal: { path: '/portal/:token', element: <ClientPortal /> },
  pay: { path: '/pay/:token', element: <PublicPayment /> },
  invite: { path: '/invite/:token', element: <AcceptInvitation /> },
};

/**
 * Single-route page rendered for a public token URL.
 * Kept isolated from the rest of the app so no providers, sidebar,
 * or auth state interfere with the public viewer.
 */
export function TokenRoute({ kind }: { kind: TokenKind }) {
  const { path, element } = ELEMENTS[kind];
  return (
    <Routes>
      <Route path={path} element={element} />
    </Routes>
  );
}

/** Returns the token kind for a pathname, or null if not a public token URL. */
export function detectTokenKind(pathname: string): TokenKind | null {
  if (pathname.startsWith('/quote/')) return 'quote';
  if (pathname.startsWith('/survey/')) return 'survey';
  if (pathname.startsWith('/portal/')) return 'portal';
  if (pathname.startsWith('/pay/')) return 'pay';
  if (pathname.startsWith('/invite/')) return 'invite';
  return null;
}
