/**
 * La carte de confirmation parle la langue de l'utilisateur (server/lib/lumi/libelles-cartes.ts).
 *
 * Avant : 22 paramètres sur 190 avaient un libellé ; les autres sortaient sous leur nom
 * technique (« Send via », « Valid days »), les valeurs d'énumération brutes (« e-transfer »,
 * « sales_rep »), un taux sans « % », un jour de semaine en chiffre, une heure sans décalage
 * lue comme de l'UTC, et un champ vidé par une modification ne se voyait pas.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS } from '../server/lib/agent/tools';
import { LIBELLES_PARAMETRES, PARAMETRES_A_CHOIX, VALEURS_TRADUITES } from '../server/lib/lumi/libelles-cartes';
import { apercuAction, detail, libelleParametre, ligneDeVente, type ApercuAction } from '../server/lib/lumi/apercu-action';

interface Schema { type?: string; enum?: unknown[]; properties?: Record<string, Schema>; items?: Schema }
const ECRITURES = AGENT_TOOLS.filter((t) => t.kind === 'write');
const estIdentifiant = (cle: string) => /(^|_)ids?$/.test(cle);

/** Tous les paramètres d'un schéma, y compris ceux des objets et des listes d'objets. */
function parametres(schema: Schema | undefined, outil: string, sortie: Array<{ outil: string; cle: string; schema: Schema }> = []) {
  for (const [cle, s] of Object.entries(schema?.properties ?? {})) {
    sortie.push({ outil, cle, schema: s });
    parametres(s, outil, sortie);
    parametres(s.items, outil, sortie);
  }
  return sortie;
}
const TOUS = ECRITURES.flatMap((t) => parametres(t.declaration.parameters as Schema, t.declaration.name));

describe('libellés des cartes de Lumi', () => {
  it('chaque paramètre non identifiant d’un outil d’écriture a son libellé', () => {
    const manquants = [...new Set(TOUS.filter((p) => !estIdentifiant(p.cle) && !LIBELLES_PARAMETRES[p.cle]).map((p) => `${p.cle} (${p.outil})`))];
    expect(manquants).toEqual([]);
  });

  it('aucun libellé ne vise un paramètre disparu', () => {
    const cles = new Set(TOUS.map((p) => p.cle));
    // Clés fabriquées par le serveur pour la carte, absentes des schémas d'outils.
    const FABRIQUEES = new Set(['apres_debut', 'apres_fin']);
    expect(Object.keys(LIBELLES_PARAMETRES).filter((k) => !cles.has(k) && !FABRIQUEES.has(k))).toEqual([]);
  });

  it('un libellé est une phrase : majuscule, pas de nom technique, dans les deux langues', () => {
    for (const [cle, [fr, en]] of Object.entries(LIBELLES_PARAMETRES)) {
      for (const texte of [fr, en]) {
        expect(texte.length, cle).toBeGreaterThan(1);
        expect(texte, cle).toMatch(/^[\p{Lu}\d]/u);
        expect(texte, cle).not.toMatch(/_|\buuid\b/i);
      }
    }
  });

  it('chaque valeur d’une liste de choix se traduit', () => {
    const brutes = new Set<string>();
    for (const p of TOUS) {
      if (!PARAMETRES_A_CHOIX.has(p.cle)) continue;
      for (const v of [...(p.schema.enum ?? []), ...(p.schema.items?.enum ?? [])]) {
        if (typeof v === 'string' && !VALEURS_TRADUITES[v.toLowerCase()]) brutes.add(`${p.cle}=${v} (${p.outil})`);
      }
    }
    expect([...brutes]).toEqual([]);
  });

  it('un paramètre à valeurs fermées est déclaré comme liste de choix', () => {
    const oublies = [...new Set(TOUS.filter((p) => !estIdentifiant(p.cle) && p.schema.type === 'string' && p.schema.enum?.length && !PARAMETRES_A_CHOIX.has(p.cle)).map((p) => p.cle))];
    expect(oublies).toEqual([]);
  });
});

describe('une ligne de détail se lit sans rien deviner', () => {
  const FUSEAU = 'America/Toronto';

  it('le libellé et la valeur sont traduits', () => {
    expect(detail('send_via', 'link_only', FUSEAU)).toMatchObject({ libelle: { fr: LIBELLES_PARAMETRES.send_via[0] }, valeur: 'Lien seulement, rien n’est envoyé', valeur_en: 'Link only, nothing is sent' });
    expect(detail('method', 'e-transfer', FUSEAU)).toMatchObject({ valeur: 'Virement Interac', valeur_en: 'E-transfer' });
    expect(detail('role', 'sales_rep', FUSEAU)).toMatchObject({ valeur: 'Représentant' });
  });

  it('un texte libre n’est jamais « traduit » parce qu’il ressemble à un code', () => {
    expect(detail('title', 'lead', FUSEAU)).toMatchObject({ valeur: 'lead' });
    expect(detail('message_text', 'email', FUSEAU)).toMatchObject({ valeur: 'email' });
  });

  it('un taux porte son « % », un montant son « $ », un jour son nom', () => {
    expect(detail('rate', 9.975, FUSEAU)).toMatchObject({ valeur: '9,975 %', valeur_en: '9.975%' });
    expect(detail('amount_cents', 12550, FUSEAU)!.valeur).toMatch(/125,50/);
    expect(detail('weekday', 1, FUSEAU)).toMatchObject({ valeur: 'lundi', valeur_en: 'Monday' });
    expect(detail('weekday', [1, 3], FUSEAU)).toMatchObject({ valeur: 'lundi, mercredi' });
  });

  it('une heure sans décalage est l’heure dite, pas de l’UTC décalé', () => {
    const d = detail('start_at', '2026-10-06T09:00:00', FUSEAU)!;
    expect(d.valeur).toMatch(/9\s?h(\s?00)?/);
    expect(d.valeur).not.toMatch(/\b5\s?h/);
  });

  it('un champ vidé se voit sur une modification, pas sur une création', () => {
    expect(detail('phone', null, FUSEAU, true)).toMatchObject({ valeur: '(vidé)', valeur_en: '(cleared)' });
    expect(detail('phone', '', FUSEAU, true)).toMatchObject({ valeur: '(vidé)' });
    expect(detail('phone', null, FUSEAU)).toBeNull();
    expect(detail('phone', undefined, FUSEAU, true)).toBeNull();
  });

  it('une liste de codes se lit en mots', () => {
    expect(detail('channel', 'both', FUSEAU)).toMatchObject({ valeur: 'Courriel et texto' });
    expect(detail('tags', ['vip', 'printemps'], FUSEAU)).toMatchObject({ valeur: 'vip, printemps' });
  });

  it('un paramètre inconnu ne montre jamais d’underscore', () => {
    expect(libelleParametre('zz_parametre_inconnu').fr).toBe('Zz parametre inconnu');
  });
});

describe('listes et objets', () => {
  // Un client Supabase qui ne trouve rien : seul le fuseau est lu, et il retombe sur America/Toronto.
  const requete: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) requete[m] = () => requete;
  requete.maybeSingle = async () => ({ data: null });
  const ctx = { client: { from: () => requete } as never, orgId: 'o', userId: 'u' };
  const texte = (a: ApercuAction) => a.details.map((d) => `${d.libelle.fr} ${d.valeur}`).join('\n');

  it('une ligne de vente dit la quantité, le prix et le total', () => {
    expect(ligneDeVente({ name: 'Lavage de vitres', qty: 2, unit_price_cents: 15000 })).toMatchObject({ total: 30000 });
    expect(ligneDeVente({ name: 'Lavage de vitres', qty: 2, unit_price_cents: 15000 })!.fr).toMatch(/^2 × Lavage de vitres à 150,00 \$ = 300,00 \$$/);
    expect(ligneDeVente({ description: 'Gouttières', quantity: 1, unit_price_cents: 9000, is_optional: true })).toMatchObject({ total: null });
    expect(ligneDeVente({ description: 'Gouttières', quantity: 1, unit_price_cents: 9000, is_optional: true })!.fr).toMatch(/en option$/);
    expect(ligneDeVente({ label: 'Photo avant', type: 'photo' })).toBeNull();
  });

  it('les lignes d’une modification annoncent qu’elles remplacent tout, avec le sous-total', async () => {
    const a = await apercuAction({ line_items: [{ name: 'Lavage', qty: 2, unit_price_cents: 15000 }, { name: 'Gouttières', qty: 1, unit_price_cents: 9000 }] }, ctx, 'update_job');
    expect(texte(a)).toMatch(/Lignes? .*2 éléments — remplacent la liste actuelle au complet/);
    expect(texte(a)).toMatch(/Sous-total avant taxes 390,00 \$/);
    const creation = await apercuAction({ line_items: [{ name: 'Lavage', qty: 1, unit_price_cents: 15000 }] }, ctx, 'create_job');
    expect(texte(creation)).not.toMatch(/remplace/);
  });

  it('une liste d’objets nomme chaque champ, sans identifiant interne', async () => {
    const a = await apercuAction({ items: [{ id: 'a1', type: 'photo', label: 'Photo avant', required: true }] }, ctx, 'create_checklist_template');
    expect(texte(a)).toMatch(/1\. .*Photo.*Photo avant.*Oui/);
    expect(texte(a)).not.toMatch(/a1/);
  });

  it('les permissions se lisent dans les mots de la page Rôles, jamais en JSON', async () => {
    const a = await apercuAction({ role: 'technician', permissions: { 'invoices.delete': false, 'clients.create': true } }, ctx, 'update_role_preset');
    expect(texte(a)).toMatch(/Permissions accordées Créer des clients/);
    expect(texte(a)).toMatch(/Permissions retirées Supprimer les factures/);
    expect(texte(a)).not.toMatch(/[{}"]/);
  });

  it('la cible d’un objectif de revenus est en dollars', async () => {
    const a = await apercuAction({ metric: 'revenue', target_value: 5000000 }, ctx, 'create_goal');
    expect(texte(a)).toMatch(/50 000,00 \$/);
  });
});

describe('la fiche nommée sur la carte ne montre jamais un code de la base', () => {
  const ID = '00000000-0000-4000-8000-000000000001';
  const ctxAvec = (rangees: Record<string, unknown>) => {
    const client = { from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: rangees[table] ?? null });
      return q;
    } };
    return { client: client as never, orgId: 'o', userId: 'u' };
  };
  const cible = async (cle: string, rangees: Record<string, unknown>, outil = 'x') => (await apercuAction({ [cle]: ID }, ctxAvec(rangees), outil)).cibles[0];

  it('facture, soumission, tâche, membre, invitation : le statut et le rôle en mots', async () => {
    expect((await cible('invoice_id', { invoices: { invoice_number: '12', total_cents: 1000, balance_cents: 1000, status: 'sent' } })).valeur).toMatch(/envoyée$/);
    expect((await cible('quote_id', { quotes: { quote_number: '7', total_cents: 1000, status: 'awaiting_response' } })).valeur).toMatch(/en attente de réponse$/);
    expect((await cible('task_id', { tasks: { title: 'Rappeler', status: 'open' } })).valeur).toBe('Rappeler · à faire');
    expect((await cible('user_id', { team_members: { first_name: 'Luc', last_name: 'Roy', email: 'l@x.ca', role: 'sales_rep' } })).valeur).toBe('Luc Roy · l@x.ca · représentant');
    expect((await cible('invitation_id', { invitations: { email: 'n@x.ca', role: 'technician', status: 'pending' } })).valeur).toBe('n@x.ca · technicien · en attente');
  });

  it('automatisation, rapport, facture récurrente : le déclencheur et la fréquence en mots', async () => {
    const auto = await cible('rule_id', { automation_rules: { name: 'Merci', trigger_event: 'invoice.paid', is_active: true } });
    expect(auto.valeur).not.toMatch(/invoice\.paid/);
    expect((await cible('report_id', { scheduled_reports: { recipient_email: 'a@x.ca', frequency: 'weekly', enabled: true } })).valeur).toBe('a@x.ca · chaque semaine · actif');
    expect((await cible('schedule_id', { recurring_invoice_schedules: { subject: 'Entretien', frequency: 'monthly', is_active: true } })).valeur).toBe('Entretien · chaque mois · active');
  });

  it('aucun code avec underscore ne sort, même pour une valeur inconnue du dictionnaire', async () => {
    expect((await cible('invoice_id', { invoices: { invoice_number: '12', total_cents: 0, balance_cents: 0, status: 'un_statut_nouveau' } })).valeur).not.toMatch(/_/);
  });
});
