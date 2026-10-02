/**
 * Le moteur des E2E : un événement écrit par la base est bien traité, pour le
 * bureau de test, et son envoi finit dans le bac à sable — jamais chez un
 * fournisseur. Si ce test tombe, aucun test « ça marche pour vrai » ne vaut.
 */
import { test, expect, creerRegle, envoisSimules, attendre } from './_outils/banc';
import { avancerMoteur } from './_outils/moteur';

/*
 * Un COURRIEL immédiat, pas un texto : le texto respecte toujours la fenêtre d'envoi (8 h – 20 h,
 * heure de l'entreprise) et serait reporté au lendemain matin — le test tombait à toute passe lancée
 * le soir (2026-10-01, 21 h 21 à Montréal). Un courriel sans délai est une confirmation : il part à
 * toute heure, ce qui rend ce canari vrai jour et nuit.
 */
test('[BANC-010] job terminé (écrit par la base) → courriel retenu par le bac à sable, journal d’exécution écrit', async ({ bureau, marque }) => {
  const depuis = new Date(Date.now() - 5_000).toISOString();
  const { data: client, error: eC } = await bureau.admin.from('clients').insert({
    org_id: bureau.orgA, created_by: bureau.comptes.proprioA.id, first_name: 'Cliente', last_name: marque, status: 'active',
    email: `e2e-${Date.now().toString(36)}@lume-qa.test`, phone: '+15555550142',
    sms_consent_at: new Date().toISOString(), email_consent_at: new Date().toISOString(),
  }).select('id').single();
  expect(eC, eC?.message).toBeNull();
  const { data: job, error: eJ } = await bureau.admin.from('jobs').insert({
    org_id: bureau.orgA, title: `Job ${marque}`, client_id: client!.id, status: 'scheduled', created_by: bureau.comptes.proprioA.id,
  }).select('id').single();
  expect(eJ, eJ?.message).toBeNull();

  const regle = await creerRegle(bureau, bureau.orgA, {
    name: `${marque} merci après job`, trigger_event: 'job.completed', is_active: true,
    conditions: { job_name: `Job ${marque}` },
    actions: [{ type: 'send_email', config: { subject: `Merci — ${marque}`, body: 'Merci [client_first_name] pour votre confiance.' } }],
  });

  const { error: eU } = await bureau.admin.from('jobs').update({ status: 'completed' }).eq('id', job!.id);
  expect(eU, eU?.message).toBeNull();
  const passage = await avancerMoteur(bureau.orgA);
  expect(passage.pieges.twilio).toBe(0);
  expect(passage.base).toBeGreaterThanOrEqual(1);

  const journaux = await attendre(
    async () => (await bureau.admin.from('automation_execution_logs').select('action_type, result_success, result_data, result_error').eq('automation_rule_id', regle.id)).data ?? [],
    (l) => l.length > 0,
  );
  expect(journaux[0].action_type).toBe('send_email');
  expect(journaux[0].result_error).toBeNull();

  const envois = (await envoisSimules(bureau, bureau.orgA, depuis)).filter((e) => String(e.sujet ?? '').includes(marque));
  expect(envois.map((e) => e.canal)).toEqual(['courriel']);
  expect(String(envois[0].corps)).toContain('Merci Cliente');

  // Ménage des données propres à ce test (la règle est retirée par `marque`).
  await bureau.admin.from('jobs').delete().eq('id', job!.id);
  await bureau.admin.from('clients').delete().eq('id', client!.id);
});
