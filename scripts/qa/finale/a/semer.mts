/**
 * Données fictives du bureau A (a) pour les passes de l'agent A : trois clients (555-01xx,
 * *.lume-qa.test) et une facture envoyée, échue depuis hier. Idempotent (retrouve par nom).
 *
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/semer.mts
 */
import { admin, bureauA } from './outils.mts';

export interface Semis { clients: Array<{ id: string; nom: string }>; factureEnRetard: string }

export async function semer(): Promise<Semis> {
  const b = await bureauA();
  const voulus = [
    { first_name: 'Maryse', last_name: 'Tremblay-QA-A', phone: '+15555550151', email: 'maryse.tremblay@lume-qa.test' },
    { first_name: 'Jocelyn', last_name: 'Gagnon-QA-A', phone: '+15555550152', email: 'jocelyn.gagnon@lume-qa.test', company: 'Gestion Gagnon inc.' },
    { first_name: 'Ginette', last_name: 'Bouchard-QA-A', phone: '+15555550153', email: 'ginette.bouchard@lume-qa.test' },
  ];
  const clients: Semis['clients'] = [];
  for (const c of voulus) {
    const { data: deja } = await admin.from('clients').select('id').eq('org_id', b.orgA).eq('last_name', c.last_name).is('deleted_at', null).maybeSingle();
    let id = deja?.id as string | undefined;
    if (!id) {
      const { data, error } = await admin.from('clients').insert({
        org_id: b.orgA, created_by: b.users.proprioA, status: 'active',
        sms_consent_at: new Date().toISOString(), email_consent_at: new Date().toISOString(), ...c,
      }).select('id').single();
      if (error) throw new Error(`client ${c.last_name} : ${error.message}`);
      id = data.id as string;
    }
    clients.push({ id, nom: `${c.first_name} ${c.last_name}` });
  }
  const sujet = 'Facture QA-A en retard';
  const { data: f0 } = await admin.from('invoices').select('id').eq('org_id', b.orgA).eq('subject', sujet).is('deleted_at', null).maybeSingle();
  let factureEnRetard = f0?.id as string | undefined;
  if (!factureEnRetard) {
    const { data: f, error } = await admin.from('invoices').insert({ org_id: b.orgA, client_id: clients[0].id, status: 'draft', created_by: b.users.proprioA, subject: sujet }).select('id').single();
    if (error) throw new Error(`facture : ${error.message}`);
    factureEnRetard = f.id as string;
    const { error: e2 } = await admin.from('invoice_items').insert({ org_id: b.orgA, invoice_id: factureEnRetard, description: 'Grand ménage', qty: 1, unit_price_cents: 24_500 });
    if (e2) throw new Error(`ligne : ${e2.message}`);
    await admin.rpc('recalculate_invoice_totals', { p_invoice_id: factureEnRetard });
  }
  const hier = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  await admin.from('invoices').update({ status: 'sent', issued_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), sent_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), due_date: hier }).eq('id', factureEnRetard);
  return { clients, factureEnRetard };
}

if (process.argv[1]?.endsWith('semer.mts')) {
  console.log(JSON.stringify(await semer(), null, 1));
}
