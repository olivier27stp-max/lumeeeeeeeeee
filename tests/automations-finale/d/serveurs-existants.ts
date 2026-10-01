/**
 * globalSetup des preuves d'écran de l'agent D : se branche sur des serveurs DÉJÀ lancés.
 *
 * Le globalSetup de la suite (tests/automations-suite/harnais/serveurs-ui.ts) démarre l'API et
 * Vite à chaque passe et leur laisse 120 s : sur le poste partagé (six agents), l'API met
 * parfois plus longtemps à compiler. Ici on lance les serveurs UNE fois :
 *
 *   node D:/lume-final/outils/serveurs.mjs D:/lume-final/wt-d 3494 5494     (en arrière-plan)
 *
 * puis chaque passe s'y branche. Mêmes valeurs fournies aux tests que serveurs-ui.ts
 * (`inject('uiBase')`, …) : le harnais `navigateur.ts` s'utilise tel quel.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from 'dotenv';
import type { TestProject } from 'vitest/node';
import { assurerBureauTest, COMPTES, REF_PROD } from '../../automations-suite/harnais/bureau-test';

const PORT_API = Number(process.env.QA_UI_PORT_API || 3494);
const PORT_VITE = Number(process.env.QA_UI_PORT_VITE || 5494);

async function repond(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(8000) })).ok;
  } catch {
    return false;
  }
}

export default async function setup(project: TestProject) {
  const fichierEnv = join(process.cwd(), '.env.local');
  if (existsSync(fichierEnv)) config({ path: fichierEnv, quiet: true } as never);
  const url = process.env.VITE_SUPABASE_URL ?? '';
  if (!url || url.includes(REF_PROD) || !/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error('REFUS : les preuves d’écran de l’agent D ne tournent que sur la pile locale.');
  }

  const api = `http://127.0.0.1:${PORT_API}`;
  const app = `http://127.0.0.1:${PORT_VITE}`;
  const [okApi, okVite, okProxy] = await Promise.all([repond(`${api}/api/health`), repond(`${app}/`), repond(`${app}/api/health`)]);
  if (!okApi || !okVite || !okProxy) {
    throw new Error(`Serveurs absents (API ${okApi}, Vite ${okVite}, proxy ${okProxy}). Lancer d'abord, en arrière-plan : node D:/lume-final/outils/serveurs.mjs ${process.cwd()} ${PORT_API} ${PORT_VITE}`);
  }

  const bureau = await assurerBureauTest();
  for (const id of Object.values(bureau.users)) {
    const { error } = await bureau.admin.from('profiles')
      .update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(`profil de test : ${error.message}`);
  }

  const sorties = resolve(process.env.QA_UI_SORTIES || 'D:/lume-final/sorties/d');
  mkdirSync(sorties, { recursive: true });

  project.provide('uiBase', app);
  project.provide('uiApi', api);
  project.provide('uiOrgA', bureau.orgA);
  project.provide('uiOrgB', bureau.orgB);
  project.provide('uiProprioA', COMPTES.proprioA.email);
  project.provide('uiSorties', sorties);
  project.provide('uiJournalApi', 'D:/lume-final/sorties/api-3494.log');
}
