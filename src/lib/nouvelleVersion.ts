/* ═══════════════════════════════════════════════════════════════
   Nouvelle version en ligne → le prochain changement de page charge
   la page ENTIÈRE, à jour.

   Chaque déploiement renomme les fichiers des pages. Un onglet ouvert
   avant le déploiement demande encore les anciens noms : la page suivante
   ne se charge pas, `lazyResilient` réessaie puis recharge — c'est la
   « demi-seconde qui bogue » entre deux pages (signalé par Rafba le
   2026-09-25). Plutôt que réparer après coup, on évite le problème :
   l'onglet vérifie de temps en temps si l'index.html en ligne pointe vers
   un autre fichier d'entrée que le sien ; si oui, le clic suivant fait
   une navigation complète vers la même adresse — invisible, comme un lien
   normal, et la page arrive avec les bons fichiers.

   En développement (Vite), l'entrée n'est pas un fichier /assets/index-… :
   rien ne s'active.
   ═══════════════════════════════════════════════════════════════ */

const ENTREE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
const INTERVALLE_MIN = 60_000;

let nouvelleVersion = false;
let dernierControle = 0;

function entreeCourante(): string | null {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src');
  return src?.match(ENTREE)?.[0] ?? null;
}

/** Pur : l'index.html en ligne désigne-t-il une autre entrée que la mienne ? */
export function estAutreVersion(mienne: string | null, htmlEnLigne: string): boolean {
  const enLigne = htmlEnLigne.match(ENTREE)?.[0];
  return !!mienne && !!enLigne && enLigne !== mienne;
}

async function verifier(): Promise<void> {
  const mienne = entreeCourante();
  if (!mienne || nouvelleVersion) return;
  try {
    const r = await fetch('/index.html', { cache: 'no-store' });
    if (r.ok && estAutreVersion(mienne, await r.text())) nouvelleVersion = true;
  } catch (e) {
    // Lecture seulement : un réseau qui hoquette, on revérifiera au prochain tour.
    console.warn('[version] vérification impossible', e);
  }
}

function controler(): void {
  if (Date.now() - dernierControle < INTERVALLE_MIN) return;
  dernierControle = Date.now();
  void verifier();
}

export function installerDetectionVersion(): void {
  if (typeof window === 'undefined' || !entreeCourante()) return;
  const pousser = history.pushState.bind(history);
  history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    if (nouvelleVersion && url != null) {
      // Navigation complète vers la même adresse : les fichiers à jour arrivent avec elle.
      window.location.assign(String(url));
      return;
    }
    pousser(data, unused, url);
    controler();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') controler();
  });
  window.setInterval(controler, 5 * INTERVALLE_MIN);
}
