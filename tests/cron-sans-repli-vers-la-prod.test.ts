/**
 * Un cron pg_cron n'appelle jamais la prod « par défaut » (audit V2, C31).
 *
 * Les fonctions trigger_* retombaient sur https://lumecrm.net quand le secret
 * `app_base_url` manquait : le pg_cron de STAGING postait chaque jour vers la
 * PROD (constaté le 2026-09-29, réponse 200). Ce cliquet relit la DERNIÈRE
 * définition de chaque fonction dans les migrations et refuse le repli.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIER = join(__dirname, '..', 'supabase', 'migrations');
const FONCTIONS = ['trigger_payment_reminders', 'trigger_sms_number_release'];

function derniereDefinition(nom: string): { fichier: string; corps: string } | null {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).sort();
  let trouvee: { fichier: string; corps: string } | null = null;
  for (const f of fichiers) {
    const sql = readFileSync(join(DOSSIER, f), 'utf8');
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nom}\\s*\\(\\)[\\s\\S]*?\\$function\\$;`, 'gi');
    for (const m of sql.matchAll(re)) trouvee = { fichier: f, corps: m[0] };
  }
  return trouvee;
}

describe('les crons ne retombent jamais sur l’URL de la prod', () => {
  for (const nom of FONCTIONS) {
    it(`${nom} : pas de repli codé en dur`, () => {
      const def = derniereDefinition(nom);
      expect(def, `aucune définition de ${nom} dans les migrations`).not.toBeNull();
      expect(def!.corps, `${def!.fichier} : repli vers la prod`).not.toMatch(/coalesce\([\s\S]*?'https?:\/\/[^']*lumecrm\.net[^']*'\s*\)/i);
    });
  }
});
