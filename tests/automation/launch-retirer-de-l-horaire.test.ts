/**
 * « Retirer de l'horaire » émet « Rendez-vous annulé » (audit V2, D-01).
 *
 * Depuis que les événements naissent en base (20261003100000), le trigger des
 * visites ne voit que le passage de `status` à 'cancelled'. L'interface, elle,
 * annule par rpc_unschedule_job, qui pose `deleted_at` : aucun événement, et
 * les « No-Show Follow-Up » publiés mouraient. Ce cliquet relit la DERNIÈRE
 * définition de la fonction dans les migrations.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIER = join(__dirname, '..', '..', 'supabase', 'migrations');

function derniere(nom: string): string | null {
  let corps: string | null = null;
  for (const f of readdirSync(DOSSIER).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(DOSSIER, f), 'utf8');
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nom}\\s*\\([\\s\\S]*?\\$function\\$;`, 'gi');
    for (const m of sql.matchAll(re)) corps = m[0];
  }
  return corps;
}

describe('D-01 — retirer une visite de l’horaire = rendez-vous annulé', () => {
  const corps = derniere('rpc_unschedule_job');

  it('la fonction consigne appointment.cancelled', () => {
    expect(corps, 'rpc_unschedule_job absente des migrations').not.toBeNull();
    expect(corps!).toMatch(/automation_consigner_evenement\([\s\S]*?'appointment\.cancelled'/);
  });

  it('seulement pour UNE visite désignée et réellement retirée (comme l’ancien appel du navigateur)', () => {
    const branche = corps!.slice(corps!.indexOf('if p_event_id is not null'), corps!.indexOf('else'));
    expect(branche).toMatch(/returning \* into v_visite/);
    expect(branche).toMatch(/if v_visite\.id is not null then[\s\S]*appointment\.cancelled/);
    // Le retrait de TOUTES les visites (et un transfert de bureau, qui pose aussi
    // deleted_at) n'annonce rien au client.
    expect(corps!.slice(corps!.indexOf('else'))).not.toMatch(/appointment\.cancelled/);
  });

  it('le trigger des visites ne surveille toujours pas deleted_at (sinon un transfert = « annulé »)', () => {
    const sql = readFileSync(join(DOSSIER, '20261003100000_evenements_automatisations_par_la_base.sql'), 'utf8');
    expect(sql).toMatch(/after insert or update of status on public\.schedule_events/);
  });
});
