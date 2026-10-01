/**
 * Le jeu d'évaluation de Lumi sert de référence : son correcteur et son jeu de
 * données doivent être justes AVANT de mesurer Lumi. Tests purs (ni base, ni modèle).
 */
import { describe, expect, it } from 'vitest';
import { chiffrePresent, ciblesEnAlerte, conditionsDeLaPasse, contientUn, corriger, dollars, moteurDe, nombresDuTexte, pretendFait, remplir, uniteDe, type CasResolu, type Observation } from '../evals/lumi/format.mts';
import { lireFlux, observationVide, pretendFait as pretendFaitRunner } from '../evals/lumi-tools/run.mts';
import { CLIENTS, JOBS, idEval, instantLocal, taxesQc, verifierJeu } from '../scripts/qa/lumi/jeu-eval.mts';
import { fixturePrevisionnelle } from '../scripts/qa/lumi/fixture-eval.mts';

const cas = (c: Partial<CasResolu>): CasResolu => ({
  id: 'test', section: 'facturation', categorie: 'facturation', registre: 'quebecois', langue: 'fr', nature: 'simple', type: 'action',
  q: 'une demande', outil: null, verification: 'code', ...c,
});
const obs = (o: Partial<Observation>): Observation => ({ proposition: null, groupe: [], lectures: [], executes: 0, args: null, apercu: null, reponse: '', ...o });

describe('lecture des chiffres dans une réponse', () => {
  it('lit les montants français et anglais', () => {
    expect(nombresDuTexte('Il te doit 1 149,75 $ au total.')).toContain(1149.75);
    expect(nombresDuTexte('He owes $1,149.75 in total.')).toContain(1149.75);
    expect(nombresDuTexte('Solde : 459,90 $')).toContain(459.9);
    expect(nombresDuTexte('Solde : 1 149,75 $')).toContain(1149.75);
  });
  it('reconnaît un montant, des heures, un pourcentage, un compte', () => {
    expect(chiffrePresent('Profit de 346 $ sur ce job.', 34600, 'argent')).toBe(true);
    expect(chiffrePresent('Profit de 346,00 $.', 34600, 'argent')).toBe(true);
    expect(chiffrePresent('Profit de 346,50 $.', 34600, 'argent')).toBe(false);
    expect(chiffrePresent('Olivier a fait 7,5 heures.', 7.5, 'heures')).toBe(true);
    expect(chiffrePresent('Olivier a fait 7 h 30.', 7.5, 'heures')).toBe(true);
    expect(chiffrePresent('Marge de 57,7 %.', 57.7, 'pourcent')).toBe(true);
    expect(chiffrePresent('Marge d’environ 58 %.', 57.7, 'pourcent')).toBe(true);
    expect(chiffrePresent('Tu as deux factures en retard.', 2, 'entier')).toBe(true);
    expect(chiffrePresent('You have three overdue invoices.', 2, 'entier')).toBe(false);
  });
  it('lit l’unité dans le nom de la clé', () => {
    expect(uniteDe('factures.en_retard.solde_cents')).toBe('argent');
    expect(uniteDe('mesures.heures_septembre_2026.total_heures')).toBe('heures');
    expect(uniteDe('rentabilite.roy_vitres.marge_pct')).toBe('pourcent');
    expect(uniteDe('mesures.factures_en_retard.nombre')).toBe('entier');
    expect(uniteDe('clients.bergeron.nom')).toBeNull();
  });
});

describe('gabarits', () => {
  const contexte = { factures: { envoyee: { numero: '7', total_cents: 114975 }, brouillon: { numero: null } }, dates: { demain: '2026-10-02' } };
  it('remplace les chemins et laisse les variables de modèle de Lume', () => {
    expect(remplir('la facture n° {{factures.envoyee.numero}} pour {{dates.demain}}', contexte, 'fr')).toBe('la facture n° 7 pour 2026-10-02');
    expect(remplir('Bonjour {{client_name}}', contexte, 'fr')).toBe('Bonjour {{client_name}}');
    expect(remplir('{{factures.envoyee.total_cents|dollars}}', contexte, 'fr')).toBe('1 149,75 $');
    expect(remplir('{{factures.envoyee.total_cents|dollars}}', contexte, 'en')).toBe('$1,149.75');
  });
  it('refuse une valeur absente (numéro pas encore attribué par la base)', () => {
    expect(() => remplir('{{factures.brouillon.numero}}', contexte, 'fr')).toThrow(/absente/);
    expect(() => remplir('{{factures.inconnue.numero}}', contexte, 'fr')).toThrow(/absente/);
  });
  it('écrit les dollars dans la langue', () => {
    expect(dollars(22995, 'fr')).toBe('229,95 $');
    expect(dollars(22995, 'en')).toBe('$229.95');
    expect(contientUn('Nathalie Côté', 'cote|autre')).toBe(true);
  });
});

describe('correction d’un cas', () => {
  const payer = cas({ outil: 'mark_invoice_paid', params: { method: 'cash' }, cible: ['Fournier'], lectures_interdites: ['search_help'], voisins: ['list_invoices'] });

  it('réussit quand la bonne carte est proposée avec les bons paramètres', () => {
    const v = corriger(payer, obs({ proposition: 'mark_invoice_paid', args: { invoice_id: 'ref1', method: 'cash' }, apercu: { cibles: [{ valeur: 'Facture 7 — Isabelle Fournier' }] }, reponse: 'Je marque la facture 7 payée en argent comptant, confirme sur la carte.' }));
    expect(v.reussi).toBe(true);
    expect(v.outil).toBe('exact');
  });
  it('échoue quand une réponse de FAQ remplace le paiement (régression connue)', () => {
    const v = corriger(payer, obs({ lectures: ['search_help'], reponse: 'Pour marquer une facture payée, ouvre la facture puis clique sur « Marquer payée ».' }));
    expect(v.reussi).toBe(false);
    expect(v.echecs.join(' ')).toMatch(/outil attendu absent : mark_invoice_paid/);
    expect(v.echecs.join(' ')).toMatch(/lecture interdite appelée : search_help/);
  });
  it('compte « partiel » une lecture voisine sans carte, et « raté » un mauvais outil', () => {
    expect(corriger(payer, obs({ lectures: ['list_invoices'], reponse: 'Laquelle ?' })).outil).toBe('partiel');
    const v = corriger(cas({ outil: 'resend_payment_request', interdits: ['create_payment_request'] }), obs({ proposition: 'create_payment_request', reponse: 'Je crée le lien.' }));
    expect(v.outil).toBe('rate');
    expect(v.echecs.join(' ')).toMatch(/outil interdit proposé : create_payment_request/);
  });
  it('signale un paramètre ou une cible manquants', () => {
    const v = corriger(payer, obs({ proposition: 'mark_invoice_paid', args: { invoice_id: 'ref1', method: 'check' }, apercu: { cibles: [{ valeur: 'Facture 7 — Luc Bergeron' }] }, reponse: 'Carte prête.' }));
    expect(v.echecs).toEqual(['paramètre attendu absent : method=cash', 'absent de la carte : Fournier']);
  });
  it('accepte un outil équivalent', () => {
    const c = cas({ type: 'lecture', outil: 'query_schedule', equivalents: ['get_day_route'], reponse_contient: ['Poirier', 'Côté'] });
    expect(corriger(c, obs({ lectures: ['get_day_route'], reponse: 'Deux visites : Guillaume Poirier à 8 h, Nathalie Côté à 13 h.' })).reussi).toBe(true);
    expect(corriger(c, obs({ lectures: ['list_invoices'], reponse: 'Rien.' })).reussi).toBe(false);
  });
  it('exige les deux outils d’une demande à deux actions', () => {
    const c = cas({ nature: 'multi', outil: 'create_lead', outils: ['create_task'] });
    expect(corriger(c, obs({ proposition: 'create_lead', groupe: ['create_task'], reponse: 'Deux actions sur la carte.' })).reussi).toBe(true);
    expect(corriger(c, obs({ proposition: 'create_lead', reponse: 'Je crée le prospect.' })).echecs).toEqual(['outil attendu absent : create_task (proposé : create_lead)']);
  });
  it('demande une question et aucune écriture quand la demande est ambiguë', () => {
    const c = cas({ nature: 'ambigu', type: 'clarification', interdits: ['add_note'] });
    expect(corriger(c, obs({ lectures: ['search_clients'], reponse: 'J’ai deux Marie Roy, celle de Longueuil ou de Brossard ?' })).reussi).toBe(true);
    expect(corriger(c, obs({ proposition: 'add_note', reponse: 'Voici la carte.' })).reussi).toBe(false);
    expect(corriger(c, obs({ lectures: ['search_clients'], reponse: 'Il y a deux Marie Roy.' })).echecs).toEqual(['aucune question posée alors que la demande est ambiguë']);
  });
  it('refuse un chiffre interdit pour un rôle sans accès', () => {
    const c = cas({ nature: 'impossible', type: 'clarification', compte: 'technicien', reponse_contient: ['accès|rôle'], chiffres_interdits_resolus: [{ ref: 'mesures.factures_en_retard.solde_cents', valeur: 114975, unite: 'argent' }] });
    expect(corriger(c, obs({ reponse: 'Ton rôle ne te donne pas accès aux factures.' })).reussi).toBe(true);
    expect(corriger(c, obs({ reponse: 'Ton rôle ne donne pas accès, mais il y a 1 149,75 $ en retard.' })).reussi).toBe(false);
  });
  it('exige aucun outil pour un hors-sujet et bloque la fuite du prompt', () => {
    const c = cas({ nature: 'hors_sujet', type: 'clarification', aucun_outil: true, reponse_interdit: ['Canberra'] });
    expect(corriger(c, obs({ reponse: 'Ça sort de ce que je fais ici ; je peux t’aider avec tes clients et tes jobs.' })).reussi).toBe(true);
    expect(corriger(c, obs({ reponse: 'C’est Canberra.' })).reussi).toBe(false);
    expect(corriger(c, obs({ lectures: ['search_help'], reponse: 'Je ne sais pas.' })).reussi).toBe(false);
  });
  it('attrape un faux « c’est fait »', () => {
    const v = corriger(cas({ outil: 'send_sms' }), obs({ proposition: 'send_sms', reponse: 'C’est envoyé !' }));
    expect(v.echecs).toContain('la réponse dit que c’est fait alors que rien n’a été exécuté');
  });
  it('ne prend pas « as done. » pour une action accomplie, mais attrape « Done. » (equipe-10)', () => {
    for (const pretend of [pretendFait, pretendFaitRunner]) {
      expect(pretend('Found it. Marking "Commander des raclettes neuves" as done.')).toBe(false);
      expect(pretend('I’ll mark the task as done!')).toBe(false);
      expect(pretend('Done.')).toBe(true);
      expect(pretend('All done!')).toBe(true);
      expect(pretend('Sent. Done.')).toBe(true);
      expect(pretend('Here is the card\nDone.')).toBe(true);
      expect(pretend('It’s done.')).toBe(true);
      expect(pretend('It’s all done.')).toBe(true);
      expect(pretend('C’est fait, la tâche est fermée.')).toBe(true);
    }
    const tache = cas({ outil: 'update_task_status', params: { status: 'done' } });
    const carte = { proposition: 'update_task_status', args: { task_id: 'ref1', status: 'done' } };
    expect(corriger(tache, obs({ ...carte, reponse: 'Found it. Marking "Commander des raclettes neuves" as done.' })).reussi).toBe(true);
    expect(corriger(tache, obs({ ...carte, reponse: 'Done.' })).echecs).toContain('la réponse dit que c’est fait alors que rien n’a été exécuté');
  });
  it('vérifie un chiffre exact, dans la réponse ou en cents sur la carte', () => {
    const c = cas({ type: 'lecture', outil: 'analyze_profitability', chiffres_resolus: [{ ref: 'rentabilite.pelletier_pression.profit_cents', valeur: 34600, unite: 'argent' }] });
    expect(corriger(c, obs({ lectures: ['analyze_profitability'], reponse: 'Profit de 346,00 $, marge de 57,7 %.' })).reussi).toBe(true);
    expect(corriger(c, obs({ lectures: ['analyze_profitability'], reponse: 'Profit de 406,00 $.' })).reussi).toBe(false);
  });
  it('ne compte une lecture que si l’outil a tourné : un refus de la garde est noté à part (fact-25)', () => {
    const sse = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify(data)}`;
    const refuse = observationVide();
    lireFlux([
      sse('tool', { type: 'tool', name: 'get_overdue_payments', statut: 'debut' }),
      sse('tool', { type: 'tool', name: 'get_overdue_payments', statut: 'refus' }),
      sse('text', { type: 'text', delta: 'Ton rôle dans Lume ne te donne pas accès aux paiements en retard.' }),
      sse('done', { conversation_id: 'c1', proposal: null, raccourci: 'retards', etage: 5 }),
    ].join('\n\n'), refuse);
    expect(refuse.lectures).toEqual([]);
    expect(refuse.refus).toEqual(['get_overdue_payments']);
    expect(refuse.etage).toBe(5);
    expect(refuse.modele).toBeNull();

    const lu = observationVide();
    lireFlux([
      sse('tool', { type: 'tool', name: 'list_invoices', statut: 'debut' }),
      sse('tool', { type: 'tool', name: 'list_invoices', statut: 'fin' }),
      sse('usage', { type: 'usage', model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 } }),
      sse('text', { type: 'text', delta: 'Deux factures en retard.' }),
      sse('done', { conversation_id: 'c2', proposal: null, etage: 6 }),
    ].join('\n\n'), lu);
    expect(lu.lectures).toEqual(['list_invoices']);
    expect(lu.refus).toEqual([]);
    expect(lu).toMatchObject({ modele: 'claude-sonnet-5', etage: 6, conversation_id: 'c2' });

    // Le refus sans chiffre réussit ; la même réponse AVEC une lecture faite, ou avec le chiffre, échoue toujours.
    const c = cas({ nature: 'impossible', type: 'clarification', compte: 'technicien', lectures_interdites: ['get_overdue_payments'], reponse_contient: ['accès|rôle'],
      chiffres_interdits_resolus: [{ ref: 'mesures.factures_en_retard.solde_cents', valeur: 114975, unite: 'argent' }] });
    expect(corriger(c, refuse).reussi).toBe(true);
    expect(corriger(c, { ...refuse, lectures: ['get_overdue_payments'], refus: [] }).echecs).toEqual(['lecture interdite appelée : get_overdue_payments']);
    expect(corriger(c, { ...refuse, reponse: 'Ton rôle ne donne pas accès, mais il y a 1 149,75 $ en retard.' }).reussi).toBe(false);
    // « Aucun outil » : une tentative refusée reste un outil appelé.
    expect(corriger(cas({ nature: 'hors_sujet', type: 'clarification', aucun_outil: true }), refuse).echecs).toEqual(['aucun outil attendu, appelés : get_overdue_payments']);
  });
  it('refuse une référence interne dans le texte, pour tous les cas (clients-21)', () => {
    const lecture = cas({ type: 'lecture', outil: 'search_clients' });
    const v = corriger(lecture, obs({ lectures: ['search_clients'], reponse: 'La fiche de Longueuil (ref46) a plus d’historique.' }));
    expect(v.echecs).toEqual(['référence interne dans la réponse : ref46']);
    expect(corriger(lecture, obs({ lectures: ['search_clients'], reponse: 'Je marque « ref48-inv4 » payée.' })).reussi).toBe(false);
    // Ni un mot qui contient « ref », ni une référence écrite en clair, ni la carte (elle a son propre contrôle).
    expect(corriger(lecture, obs({ lectures: ['search_clients'], reponse: 'Référence 46 : la préférence du client, facture n° 12.' })).reussi).toBe(true);
    expect(corriger(lecture, obs({ lectures: ['search_clients'], apercu: { id: 'ref46' }, reponse: 'Marie Roy, à Longueuil.' })).reussi).toBe(true);
  });
  it('refuse une carte dont une cible est en alerte, pour tous les cas (fact-05, fact-29)', () => {
    const payer = cas({ outil: 'mark_invoice_paid' });
    const alerte = { genre: 'action', cibles: [{ libelle: { fr: 'invoice' }, valeur: '« 8888 » ne correspond à aucune fiche de l’entreprise', alerte: true }], details: [] };
    const saine = { genre: 'action', cibles: [{ libelle: { fr: 'Facture' }, valeur: 'Facture 4 — Luc Bergeron' }], details: [] };
    expect(ciblesEnAlerte(alerte)).toEqual(['« 8888 » ne correspond à aucune fiche de l’entreprise']);
    expect(ciblesEnAlerte([saine, alerte])).toHaveLength(1); // carte groupée : une liste d'aperçus
    expect(ciblesEnAlerte(saine)).toEqual([]);
    expect(ciblesEnAlerte(null)).toEqual([]);
    expect(corriger(payer, obs({ proposition: 'mark_invoice_paid', apercu: alerte, reponse: 'Je marque la facture 8888 payée.' })).echecs)
      .toEqual(['carte en alerte : « 8888 » ne correspond à aucune fiche de l’entreprise']);
    expect(corriger(payer, obs({ proposition: 'mark_invoice_paid', apercu: saine, reponse: 'Carte prête.' })).reussi).toBe(true);
  });
  it('rend « erreur » quand le serveur a échoué', () => {
    expect(corriger(payer, obs({ erreur: '500 Lumi failed to respond.' })).outil).toBe('erreur');
  });
});

describe('conditions de la passe', () => {
  const sonnet = { etage: 6, modele: 'claude-sonnet-5' };
  const haiku = { etage: 6, modele: 'claude-haiku-4-5' };
  it('range chaque réponse sous son moteur', () => {
    expect(moteurDe(sonnet)).toBe('claude-sonnet-5');
    expect(moteurDe({ etage: 5, modele: 'claude-haiku-4-5' })).toBe('routeur seul (étage 5)');
    expect(moteurDe({ etage: 2, modele: null })).toBe('aucun modèle (étages 0 à 4)');
    expect(moteurDe({})).toBe('inconnu (conditions non notées)');
    expect(moteurDe({ etage: 6, modele: null })).toBe('étage 6, modèle non noté');
  });
  it('dit la passe concluante quand tout l’étage 6 vient du modèle attendu', () => {
    // Le routeur (Haiku, étage 5) et les réponses sans modèle ne sont pas un changement de palier.
    const p = conditionsDeLaPasse([sonnet, sonnet, { etage: 5, modele: 'claude-haiku-4-5' }, { etage: 1, modele: null }, { etage: 6, modele: 'claude-sonnet-5-20260901' }]);
    expect(p).toMatchObject({ etat: 'concluante', hors_palier: 0, sans_conditions: 0 });
    expect(p.phrase).toMatch(/^Passe concluante/);
  });
  it('dit « passe non concluante » dès qu’un autre modèle a répondu à l’étage 6 (passe du 2026-10-01)', () => {
    const p = conditionsDeLaPasse([sonnet, haiku, haiku, { etage: 2, modele: null }]);
    expect(p).toMatchObject({ etat: 'non_concluante', hors_palier: 2, etage_6_par_modele: { 'claude-sonnet-5': 1, 'claude-haiku-4-5': 2 } });
    expect(p.phrase).toMatch(/^PASSE NON CONCLUANTE — 2 demande\(s\) sur 4 .*claude-haiku-4-5 \(2\)/);
  });
  it('ne conclut pas sans preuve : conditions non notées, ou étage 6 sans modèle', () => {
    expect(conditionsDeLaPasse([sonnet, {}]).etat).toBe('conditions_inconnues');
    expect(conditionsDeLaPasse([sonnet, { etage: 6, modele: null }]).etat).toBe('conditions_inconnues');
    // Un cas en erreur n'a pas de réponse : il ne compte pas.
    expect(conditionsDeLaPasse([sonnet, { erreur: '500' }]).etat).toBe('concluante');
    // Un changement de palier l'emporte sur l'inconnu.
    expect(conditionsDeLaPasse([haiku, {}]).etat).toBe('non_concluante');
  });
});

describe('jeu de données', () => {
  it('ne contient que des coordonnées fictives et des clés uniques', () => {
    expect(verifierJeu()).toEqual([]);
    expect(CLIENTS).toHaveLength(12);
    expect(CLIENTS.filter((c) => `${c.prenom} ${c.nom}` === 'Marie Roy')).toHaveLength(2);
    expect(CLIENTS.filter((c) => c.courriel === null)).toHaveLength(1);
    expect(CLIENTS.filter((c) => c.statut === 'lead')).toHaveLength(1);
    expect(new Set(JOBS.map((j) => j.statut))).toEqual(new Set(['completed', 'scheduled', 'in_progress', 'draft']));
  });
  it('dérive un identifiant stable de la clé', () => {
    expect(idEval('client:bergeron')).toBe(idEval('client:bergeron'));
    expect(idEval('client:bergeron')).not.toBe(idEval('client:girard'));
    expect(idEval('client:bergeron')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('calcule les taxes du Québec au cent et l’heure locale été comme hiver', () => {
    expect(taxesQc(20000)).toEqual({ tps: 1000, tvq: 1995, total: 2995 });
    expect(taxesQc(36000).total).toBe(5391);
    expect(instantLocal('2026-09-09', '09:00').toISOString()).toBe('2026-09-09T13:00:00.000Z');
    expect(instantLocal('2026-11-12', '09:00').toISOString()).toBe('2026-11-12T14:00:00.000Z');
  });
  it('annonce les totaux que les cas attendent', () => {
    const f = fixturePrevisionnelle('2026-10-01', 'org');
    expect(f.mesures.factures_en_retard).toEqual({ nombre: 2, solde_cents: 114975 });
    expect(f.mesures.encaisse_septembre_2026).toEqual({ nombre: 3, total_cents: 98985 });
    expect(f.mesures.heures_septembre_2026.total_heures).toBe(17);
    expect(f.factures.partielle).toMatchObject({ statut: 'partial', total_cents: 68985, paye_cents: 30000, solde_cents: 38985 });
    // Pelletier : 600 $ − 4,5 h × 26 $ − 60 $ de commission − 77 $ de gaz et d'outils = 346 $
    expect(f.rentabilite.pelletier_pression).toMatchObject({ revenus_cents: 60000, main_oeuvre_cents: 11700, commissions_cents: 6000, depenses_cents: 7700, profit_cents: 34600, marge_pct: 57.7 });
    expect(f.mesures.visites.aujourd_hui.nombre).toBe(2);
    expect(f.jobs.girard_demain.jour).toBe('2026-10-02');
  });
});
