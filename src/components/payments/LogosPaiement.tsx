import React from 'react';

/**
 * Logos des moyens de paiement acceptés par Lume Payments, en SVG inline
 * (aucune dépendance, aucun téléchargement, lisibles en mode sombre).
 * Chaque marque a son `<title>` : un lecteur d'écran lit « Visa », pas un
 * dessin muet. Les couleurs sont celles des chartes officielles.
 */

const cadre = 'inline-flex h-7 w-11 items-center justify-center rounded-md border border-outline bg-white shrink-0';

export function LogoVisa() {
  return (
    <span className={cadre}>
      <svg viewBox="0 0 48 16" width="34" height="12" role="img" aria-label="Visa">
        <title>Visa</title>
        <text x="0" y="14" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontStyle="italic" fontSize="16" fill="#1A1F71" letterSpacing="-0.5">VISA</text>
      </svg>
    </span>
  );
}

export function LogoMastercard() {
  return (
    <span className={cadre}>
      <svg viewBox="0 0 32 20" width="28" height="18" role="img" aria-label="Mastercard">
        <title>Mastercard</title>
        <circle cx="12" cy="10" r="8" fill="#EB001B" />
        <circle cx="20" cy="10" r="8" fill="#F79E1B" />
        <path d="M16 3.6a8 8 0 0 1 0 12.8 8 8 0 0 1 0-12.8z" fill="#FF5F00" />
      </svg>
    </span>
  );
}

export function LogoAmex() {
  return (
    <span className={`${cadre} !bg-[#006FCF] !border-[#006FCF]`}>
      <svg viewBox="0 0 48 16" width="36" height="12" role="img" aria-label="American Express">
        <title>American Express</title>
        <text x="1" y="12.5" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="11" fill="#fff" letterSpacing="0.2">AMEX</text>
      </svg>
    </span>
  );
}

export function LogoApplePay() {
  return (
    <span className={`${cadre} !bg-black !border-black`}>
      <svg viewBox="0 0 50 20" width="36" height="14" role="img" aria-label="Apple Pay">
        <title>Apple Pay</title>
        <g transform="translate(2 1) scale(0.75)" fill="#fff">
          <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
        </g>
        <text x="20" y="15" fontFamily="-apple-system, Helvetica Neue, Arial, sans-serif" fontWeight="600" fontSize="13" fill="#fff">Pay</text>
      </svg>
    </span>
  );
}

export function LogoGooglePay() {
  return (
    <span className={cadre}>
      <svg viewBox="0 0 50 20" width="38" height="15" role="img" aria-label="Google Pay">
        <title>Google Pay</title>
        <g transform="translate(1 2) scale(0.66)">
          <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v2.98h3.86c2.26-2.09 3.56-5.17 3.56-8.8z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-2.98c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z" />
          <path fill="#FBBC04" d="M5.27 14.31A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.58.37-2.31V6.6H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.4l3.98-3.09z" />
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.6l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
        </g>
        <text x="20" y="15" fontFamily="Roboto, Arial, sans-serif" fontWeight="500" fontSize="13" fill="#3C4043">Pay</text>
      </svg>
    </span>
  );
}

/** Rangée complète ; `wallets` à false masque Apple Pay et Google Pay. */
export default function RangeeLogos({ wallets = true, className = '' }: { wallets?: boolean; className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-1.5 ${className}`} aria-label="Moyens de paiement acceptés">
      <li><LogoVisa /></li>
      <li><LogoMastercard /></li>
      <li><LogoAmex /></li>
      {wallets && <li><LogoApplePay /></li>}
      {wallets && <li><LogoGooglePay /></li>}
    </ul>
  );
}
