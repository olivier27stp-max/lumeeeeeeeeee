// Étape 5 du plan étiquettes + champs (2026-09-28) : les valeurs des champs
// personnalisés suivent le deal — client → deal, deal → devis.
//
// Le comportement (copie, pas d'écrasement, option par libellé) est celui de
// cf_copier_valeurs, éprouvé sur staging dans une transaction annulée ; ce
// test fige le branchement : les bons événements, dans le bon ordre, sans
// bloquer l'enregistrement du deal, et sans exposer la fonction.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(resolve(__dirname, '../supabase/migrations/20261001150000_champs_suivent_le_deal.sql'), 'utf8');

describe('les champs suivent le deal', () => {
  it('se déclenche à la création du deal et quand son client ou son devis change', () => {
    expect(sql).toMatch(/create trigger deals_cf_suivre after insert or update of client_id, quote_id on public\.deals/);
  });

  it('client → deal PUIS deal → devis (le devis reçoit ce que le deal a hérité)', () => {
    const client = sql.indexOf("'client', new.client_id, 'deal', new.id");
    const devis = sql.indexOf("'deal', new.id, 'quote', new.quote_id");
    expect(client).toBeGreaterThan(0);
    expect(devis).toBeGreaterThan(client);
  });

  it('une copie ratée ne bloque jamais le deal', () => {
    expect(sql.match(/exception when others then\s+raise warning/g)?.length).toBe(2);
  });

  it('la fonction du déclencheur n’est pas appelable par les clients de l’API', () => {
    expect(sql).toContain('revoke all on function public.cf_deal_suivre() from public, anon, authenticated;');
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
  });
});
