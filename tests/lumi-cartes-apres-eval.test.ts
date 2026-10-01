/**
 * Trois défauts de carte relevés par la passe d'évaluation en prod du 2026-10-01
 * (bureau « [TEST] QA Lumi éval 2 », 221 demandes) :
 *
 *   devis-06 / devis-11 / devis-16 — « envoie / supprime / modifie la soumission de Mélanie Simard » :
 *     la carte ne nommait pas Mélanie Simard, parce que son devis est celui d'un PROSPECT (lead_id).
 *   clients-10 — « ajoute une note sur la fiche de Patrick Girard » : la carte disait « Élément visé : entity ».
 *   planif-10 — « crée une job pour Isabelle Fournier : lavage de vitres extérieur, 200 $, le 12 novembre à 9 h » :
 *     le raccourci sans modèle proposait une job sans prix ni date, titrée de toute la phrase.
 */
import { describe, it, expect } from 'vitest';
import { apercuAction } from '../server/lib/lumi/apercu-action';
import { detecterActionDirecte } from '../server/lib/lumi/actions-directes';

const ORG = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Ligne = Record<string, unknown>;

function base(tables: Record<string, Ligne[]>) {
  const requete = (depart: Ligne[]) => {
    let lignes = depart;
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => { lignes = lignes.filter((l) => l[col] === v); return q; },
      is: (col: string, v: unknown) => { lignes = lignes.filter((l) => (l[col] ?? null) === v); return q; },
      order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: lignes[0] ?? null, error: null }),
    };
    return q;
  };
  return { client: { from: (t: string) => requete((tables[t] ?? []).map((l) => ({ org_id: ORG, ...l }))) } as never, orgId: ORG, userId: id(99) };
}

describe('la carte d’un devis nomme la personne, cliente ou prospect', () => {
  const tables = {
    quotes: [
      { id: id(1), quote_number: '1', title: 'Lavage de vitres et gouttières', total_cents: 51739, status: 'draft', client_id: null, lead_id: id(10) },
      { id: id(2), quote_number: '2', title: 'Entretien', total_cents: 10000, status: 'draft', client_id: id(11), lead_id: null },
    ],
    clients: [{ id: id(10), first_name: 'Mélanie', last_name: 'Simard', status: 'lead' }, { id: id(11), first_name: 'Marie', last_name: 'Roy', status: 'active' }],
  };

  it('devis d’un prospect : son nom est sur la carte (envoi par texto, suppression, modification)', async () => {
    for (const outil of ['send_quote_sms', 'delete_quote', 'update_quote']) {
      const a = await apercuAction({ quote_id: id(1) }, base(tables), outil);
      expect(a.cibles[0].valeur, outil).toMatch(/#1 · Lavage de vitres et gouttières · Mélanie Simard · 517,39 \$/);
    }
  });

  it('devis d’un client : inchangé', async () => {
    const a = await apercuAction({ quote_id: id(2) }, base(tables), 'delete_quote');
    expect(a.cibles[0].valeur).toMatch(/#2 · Entretien · Marie Roy/);
  });
});

describe('une fiche désignée par son type et son identifiant est nommée', () => {
  const tables = {
    clients: [{ id: id(20), first_name: 'Patrick', last_name: 'Girard', phone: '514-555-0120', status: 'active' }],
    jobs: [{ id: id(21), job_number: 44, title: 'Lavage', client_name: 'Marie Roy' }],
  };

  it('une note sur un client : la carte dit lequel, et ne répète pas « type : client »', async () => {
    const a = await apercuAction({ entity_type: 'client', entity_id: id(20), note: 'Gate code is 4471.' }, base(tables), 'add_note');
    expect(a.cibles[0]).toMatchObject({ libelle: { fr: 'Client' } });
    expect(a.cibles[0].valeur).toMatch(/Patrick Girard/);
    expect(a.details.map((d) => d.valeur)).toEqual(['Gate code is 4471.']);
    expect(JSON.stringify(a)).not.toMatch(/Élément visé|"entity"/);
  });

  it('une note sur un job : le job est nommé', async () => {
    const a = await apercuAction({ entity_type: 'job', entity_id: id(21), note: 'Clé sous le pot.' }, base(tables), 'add_note');
    expect(a.cibles[0].valeur).toMatch(/#44 · Lavage · Marie Roy/);
  });

  it('une fiche qui n’existe pas reste signalée', async () => {
    const a = await apercuAction({ entity_type: 'client', entity_id: id(22), note: 'x' }, base(tables), 'add_note');
    expect(a.cibles[0].alerte).toBe(true);
  });
});

describe('le raccourci « job chez un client » ne prend pas un prix ou une date pour un titre', () => {
  it('un titre simple reste un raccourci sans modèle', () => {
    const a = detecterActionDirecte('Crée une job pour Isabelle Fournier : lavage de vitres extérieur');
    expect(a).toMatchObject({ id: 'job-chez', tool: 'create_job', args: { title: 'lavage de vitres extérieur' } });
  });

  it('un prix, une date ou une heure après « : » → pas de raccourci, le modèle compose la job', () => {
    expect(detecterActionDirecte('Crée une job pour Isabelle Fournier : lavage de vitres extérieur, 200 $, le 12 novembre 2026 à 9 h.')).toBeNull();
    expect(detecterActionDirecte('Crée une job pour Isabelle Fournier : lavage de vitres demain matin')).toBeNull();
    expect(detecterActionDirecte('Crée une job pour Isabelle Fournier : gouttières à 175 dollars')).toBeNull();
    expect(detecterActionDirecte('Create a job for Isabelle Fournier: window cleaning on Monday')).toBeNull();
  });
});
