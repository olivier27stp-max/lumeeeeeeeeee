/**
 * Démarrage des E2E des automatisations.
 *
 *  · E2E_BASE répond déjà (atelier local, serveurs lancés à la main) : on le
 *    réutilise tel quel — à charge de qui l'a lancé de l'avoir démarré SANS
 *    fournisseur réel et sans tâche de fond.
 *  · Sinon : l'API et Vite sont démarrés puis ARRÊTÉS ici, par le même code
 *    que la suite `npm run test:automations`
 *    (tests/automations-suite/harnais/serveurs-ui.ts) : mêmes ceintures.
 *
 * Refuse la production dans tous les cas.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REF_PROD = 'bbzcuzqfgsdvjsymfwmr';

/**
 * Trois essais longs : sous charge (plusieurs suites en même temps), l'API
 * locale peut mettre plusieurs secondes à répondre. La croire absente
 * ferait tenter un second démarrage sur un port déjà pris.
 */
async function repond(url: string): Promise<boolean> {
  for (let essai = 0; essai < 3; essai++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(20_000) })).ok) return true; } catch { /* essai suivant */ }
  }
  return false;
}

export default async function demarrage(): Promise<void | (() => Promise<void>)> {
  const env = join(process.cwd(), '.env.local');
  if (existsSync(env)) config({ path: env, quiet: true } as never);
  const url = process.env.VITE_SUPABASE_URL ?? '';
  if (!url || url.includes(REF_PROD) || !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) {
    throw new Error('REFUS : les E2E des automatisations tournent sur la pile LOCALE seulement (node scripts/qa/automations-e2e/lancer.mjs).');
  }

  const base = process.env.E2E_BASE || 'http://127.0.0.1:5191';
  if (await repond(`${base}/api/health`)) {
    console.log(`[e2e] serveurs déjà démarrés sur ${base} : réutilisés.`);
    return;
  }
  const port = new URL(base).port;
  process.env.QA_UI_PORT_VITE ||= port;
  const { default: setup } = await import('../../../tests/automations-suite/harnais/serveurs-ui');
  // `project.provide` de vitest : ici, on n'a besoin que des serveurs.
  const arreter = await setup({ provide: () => undefined } as never);
  return async () => { await arreter?.(); };
}
