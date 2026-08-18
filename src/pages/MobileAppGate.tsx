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
    <div className="min-h-screen bg-surface text-text-primary antialiased flex flex-col">
      {/* ── En-tête ── */}
      <header className="px-6 pt-10 pb-2 flex justify-center">
        <img src="/lume-logo.png" alt="Lume" className="h-16 w-auto mix-blend-multiply" />
      </header>

      {/* ── Contenu ── */}
      <main className="flex-1 flex flex-col justify-center px-7 pb-10 max-w-md mx-auto w-full">
        <div className="space-y-7 text-center">
          <div className="flex justify-center">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-black/[0.04] flex items-center justify-center">
                <Smartphone size={28} strokeWidth={1.25} className="text-text-primary" />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl font-extralight tracking-tight leading-tight">
              Lume, c'est <span className="italic">mieux</span> dans l'app
            </h1>
            <p className="text-text-tertiary text-[15px] font-light leading-relaxed">
              Votre CRM est conçu pour le grand écran. Sur téléphone, on vous
              donne une application faite pour le terrain — pas une page web
              rétrécie.
            </p>
          </div>

          {/* ── Action ── */}
          <div className="pt-1 space-y-3">
            {lienDirect ? (
              <a
                href={lienDirect}
                className="flex items-center justify-center gap-2.5 w-full h-[52px] rounded-2xl bg-text-primary text-surface font-medium text-[15px] active:scale-[0.98] transition-transform"
              >
                {os === 'ios' ? <Apple size={18} strokeWidth={1.5} /> : <Smartphone size={18} strokeWidth={1.5} />}
                Télécharger l'application
              </a>
            ) : (
              /* Aucun lien encore : on le dit franchement plutôt que d'afficher
                 un bouton inerte. */
              <div className="rounded-2xl border border-black/[0.07] bg-white px-5 py-6 space-y-2.5">
                <p className="text-[15px] font-normal">L'application arrive bientôt</p>
                <p className="text-text-tertiary text-[13.5px] font-light leading-relaxed">
                  Elle est en test auprès des premiers utilisateurs. En attendant,
                  ouvrez <span className="text-text-primary font-normal">lumecrm.net</span> sur
                  votre ordinateur pour accéder à votre CRM.
                </p>
              </div>
            )}
          </div>

          {/* ── Rappel ordinateur ── */}
          <div className="pt-2 flex items-start gap-3 text-left rounded-2xl bg-black/[0.025] px-4 py-3.5">
            <Monitor size={17} strokeWidth={1.4} className="text-text-tertiary shrink-0 mt-0.5" />
            <p className="text-text-tertiary text-[13px] font-light leading-relaxed">
              Vos données sont intactes et vous attendent. Rien n'est perdu :
              connectez-vous depuis un ordinateur et vous retrouverez tout.
            </p>
          </div>

          <div className="pt-1">
            <a
              href="mailto:support@lumecrm.net"
              className="inline-flex items-center gap-2 text-text-tertiary text-[13px] font-light hover:text-text-primary transition-colors"
            >
              <Mail size={14} strokeWidth={1.4} />
              Besoin d'aide ? Écrivez-nous
            </a>
          </div>
        </div>
      </main>

      <footer className="px-6 pb-7 text-center">
        <p className="text-text-tertiary/60 text-[11px] font-light tracking-[0.15em] uppercase">Lume</p>
      </footer>
    </div>
  );
}
