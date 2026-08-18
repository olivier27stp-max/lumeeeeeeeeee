/**
 * Page affichée quand un utilisateur ouvre lumecrm.net depuis un téléphone.
 *
 * POURQUOI ELLE EXISTE
 * Le CRM est conçu pour un écran d'ordinateur : tableaux à colonnes multiples,
 * calendrier de répartition, glisser-déposer du pipeline. Sur un écran de six
 * pouces, ces mises en page ne se dégradent pas — elles cassent. Mieux vaut
 * assumer une porte propre qu'un produit qui a l'air bâclé.
 *
 * CE QU'ELLE NE BLOQUE JAMAIS
 * Elle ne s'affiche QUE pour les utilisateurs de Lume. Les pages qu'ouvrent
 * LEURS clients — soumission reçue par texto, contrat à signer, paiement,
 * portail, formulaire de demande — restent intactes sur mobile. Ces gens n'ont
 * pas de compte Lume et n'installeront jamais l'application : les envoyer vers
 * un magasin d'applications ferait perdre des contrats à nos utilisateurs.
 * La liste blanche vit dans `src/lib/mobileGate.ts`, avec ses tests.
 *
 * ÉTAT ACTUEL — l'application est en bêta fermée (TestFlight), pas publiée.
 * La page l'annonce sans promettre de bouton mort : un bouton qui ne mène
 * nulle part est pire que pas de bouton. Dès que les liens de magasin
 * existent, ils se posent dans `LIENS_APP` ci-dessous et les boutons
 * apparaissent d'eux-mêmes.
 */

import { Monitor, Smartphone, Apple, Mail } from 'lucide-react';

/**
 * Liens de téléchargement. Laisser `null` tant qu'un lien n'existe pas :
 * la page bascule alors sur le message d'attente au lieu d'afficher un
 * bouton qui ne mène nulle part.
 */
const LIENS_APP: { ios: string | null; android: string | null; testflight: string | null } = {
  ios: null,
  android: null,
  testflight: null,
};

/** Système détecté, pour n'afficher que le bouton pertinent. */
function systeme(): 'ios' | 'android' | 'autre' {
  if (typeof navigator === 'undefined') return 'autre';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'autre';
}

export default function MobileAppGate() {
  const os = systeme();
  const lienDirect = os === 'ios' ? (LIENS_APP.ios ?? LIENS_APP.testflight) : os === 'android' ? LIENS_APP.android : null;

  return (
    // Fond blanc assumé, pas `bg-surface` : la page doit ressembler a Lume
    // quel que soit le thème système du telephone.
    <div className="min-h-screen bg-white text-[#141518] antialiased flex flex-col justify-center px-8 py-12">
      <div className="w-full max-w-sm mx-auto text-center">
        <img
          src="/lume-logo-new.png"
          alt="Lume"
          className="h-14 w-auto mx-auto mb-9"
        />

        <h1 className="text-2xl font-light tracking-tight leading-[1.28] text-balance">
          Le bureau sur l'ordi.
          <br />
          Le terrain dans <span className="italic">l'app</span>.
        </h1>

        <p className="mt-3.5 text-sm text-[#71747B] leading-relaxed max-w-[30ch] mx-auto">
          Votre CRM travaille mieux sur un grand écran. L'application mobile,
          elle, est faite pour le camion.
        </p>

        {lienDirect ? (
          <a
            href={lienDirect}
            className="mt-8 flex items-center justify-center gap-2.5 w-full h-[52px] rounded-2xl bg-[#141518] text-white font-medium text-[15px] active:scale-[0.98] transition-transform"
          >
            {os === 'ios' ? <Apple size={18} strokeWidth={1.5} /> : <Smartphone size={18} strokeWidth={1.5} />}
            Télécharger l'application
          </a>
        ) : (
          <>
            {/* Aucun lien de magasin : on le dit franchement plutôt que
                d'afficher un bouton qui ne mène nulle part. */}
            <div className="w-7 h-px bg-black/10 mx-auto my-7" />
            <p className="text-[12.5px] text-[#A8ABB2] leading-[1.65]">
              Elle arrive bientôt.
              <br />
              D'ici là, retrouvez tout sur{' '}
              <span className="text-[#141518] font-medium">lumecrm.net</span>
              <br />
              depuis votre ordinateur.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
