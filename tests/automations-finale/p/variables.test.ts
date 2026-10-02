/**
 * Agent P — « Insérer un champ » : le catalogue unique (src/lib/automationVariables.ts).
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/variables.test.ts
 *
 * Ce que la mission demande (point 8), une exigence par bloc : liste contextuelle
 * au déclencheur, « Champs de base » d'abord, section « Champs personnalisés »,
 * exclusions par défaut, recherche, valeur de remplacement, variable inconnue.
 * La parité avec ce que le MOTEUR remplit est dans variables-parite.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  CATALOGUE_VARIABLES, variablesPour, raccourcisPour, variablesInconnues, analyserJetons, appliquerRemplacement,
  rendreAvecExemples, filtrerVariables, normaliserRecherche, champPropose, ecriture, entiteDuDeclencheur, exempleDe,
  variablesPourConsigne, variablesEnAttente, LIBELLES_GROUPE, REMPLACEMENT_MAX, type ChampPourVariables,
} from '../../../src/lib/automationVariables';
import { DECLENCHEURS, ENTITE_PAR_DECLENCHEUR } from '../../../src/lib/automationCatalogue';

/** Les champs personnalisés posés d'office dans TOUTE nouvelle entreprise (ceux que le propriétaire a vus). */
const champ = (object_type: ChampPourVariables['object_type'], key: string, label: string, field_type: ChampPourVariables['field_type'], config: ChampPourVariables['config'] = {}): ChampPourVariables =>
  ({ object_type, key, label, field_type, config, archived_at: null });
const CHAMPS_SEMES: ChampPourVariables[] = [
  champ('client', 'refere_par', 'Référé par', 'single_line'),
  champ('client', 'code_acces', 'Code d’accès', 'single_line'),
  champ('client', 'courriel_facturation', 'Courriel de facturation', 'email'),
  champ('client', 'instructions_acces', 'Instructions d’accès', 'multi_line'),
  champ('client', 'noreview', 'Aucune demande d’avis (noreview)', 'checkbox'),
  champ('job', 'depense_carburant', 'Carburant', 'monetary'),
  champ('job', 'instructions_speciales', 'Instructions spéciales', 'multi_line'),
  champ('job', 'depense_sous_traitance', 'Sous-traitance', 'monetary'),
  champ('job', 'depense_autres', 'Autres dépenses', 'monetary'),
  champ('quote', 'motif_refus', 'Motif de refus', 'dropdown_single'),
];
const libelles = (liste: Array<{ fr: string }>) => liste.map((x) => x.fr);
const ecrits = (liste: Array<{ ecrit: string }>) => liste.map((x) => x.ecrit);
const groupesDe = (liste: Array<{ groupe: { fr: string } }>) => [...new Set(liste.map((x) => x.groupe.fr))];

describe('P — variables : la liste est contextuelle au déclencheur', () => {
  it('« Champs de base » par fiche : seulement les groupes qui AURONT une valeur (table de la conception)', () => {
    const base = (d: string) => groupesDe(variablesPour(d).base);
    expect(base('lead.created')).toEqual(['Client', 'Entreprise']);
    expect(base('quote.sent')).toEqual(['Client', 'Entreprise', 'Devis']);
    expect(base('invoice.overdue')).toEqual(['Client', 'Entreprise', 'Facture']);
    expect(base('job.completed')).toEqual(['Client', 'Entreprise', 'Job']);
    expect(base('appointment.created')).toEqual(['Client', 'Entreprise', 'Job']);
    expect(base('deal.stage_entered')).toEqual(['Client', 'Entreprise']);
    expect(groupesDe(variablesPour('deal.stage_entered').plus)).toContain('Pipeline');
    // Un appel reçu de l'extérieur n'apporte aucune fiche : l'entreprise seulement.
    expect(base('webhook.received')).toEqual(['Entreprise']);
    expect(variablesPour('webhook.received').personnalises).toEqual([]);
  });

  it('[cible de E-31] « Nouveau prospect » : aucune variable de facture, de devis, de job ni de pipeline', () => {
    const p = variablesPour('lead.created', CHAMPS_SEMES);
    const tout = [...p.base, ...p.plus, ...p.personnalises];
    expect(tout.filter((x) => ['Facture', 'Devis', 'Job', 'Pipeline', 'Invoice', 'Quote'].includes(x.groupe.fr))).toEqual([]);
    expect(ecrits(tout).filter((e) => /invoice|quote|appointment|job|deal/.test(e))).toEqual([]);
    expect(libelles(raccourcisPour('lead.created'))).toEqual(['Nom du client', 'Nom de votre entreprise']);
  });

  it('[cible de E-32] « Facture en retard » : numéro, montant, échéance et lien de paiement, en clair', () => {
    const base = variablesPour('invoice.overdue').base;
    expect(base.filter((x) => x.groupe.fr === 'Facture').map((x) => [x.fr, x.ecrit])).toEqual([
      ['Numéro de facture', '[invoice_number]'], ['Montant de la facture', '[invoice_total]'],
      ['Date d’échéance', '[invoice_due_date]'], ['Lien de paiement', '[invoice_link]'],
    ]);
    // Solde dû et jours de retard : au catalogue, offerts dès que le moteur les remplit (voir variables-parite).
    expect(variablesEnAttente().map((x) => x.jeton)).toEqual(expect.arrayContaining(['invoice_balance', 'invoice_days_overdue']));
  });

  it('[cible de E-32] le client (prénom, nom, nom complet) et l’entreprise (nom, téléphone) sont en tête, partout où il y a un client', () => {
    for (const d of ['lead.created', 'invoice.overdue', 'quote.sent', 'appointment.created', 'job.completed', 'deal.stage_idle']) {
      expect(libelles(variablesPour(d).base).slice(0, 5), d).toEqual([
        'Prénom du client', 'Nom de famille du client', 'Nom complet du client', 'Nom de l’entreprise', 'Téléphone de l’entreprise',
      ]);
    }
  });

  it('Job : date, heure et adresse — sur un rendez-vous comme sur un job, avec la variable que le moteur remplit pour CETTE fiche', () => {
    const job = (d: string) => variablesPour(d).base.filter((x) => x.groupe.fr === 'Job').map((x) => [x.fr, x.ecrit]);
    expect(job('appointment.created')).toEqual([
      ['Date du rendez-vous', '[appointment_date]'], ['Heure du rendez-vous', '[appointment_time]'], ['Adresse du rendez-vous', '[appointment_address]'],
    ]);
    expect(job('job.completed')).toEqual([
      ['Date de la prochaine visite', '{{job.visits}}'], ['Heure de la visite', '{{job.visit_start_time}}'], ['Adresse des travaux', '{{job.property}}'],
    ]);
  });

  it('chaque déclencheur du catalogue a une palette, et une seule écriture par variable', () => {
    for (const d of DECLENCHEURS) {
      const p = variablesPour(d.cle, CHAMPS_SEMES);
      const tout = [...p.base, ...p.plus, ...p.personnalises];
      expect(p.base.length, d.cle).toBeGreaterThan(0);
      expect(new Set(ecrits(tout)).size, `${d.cle} : une variable offerte deux fois`).toBe(tout.length);
      for (const x of tout) {
        expect(x.fr.trim() && x.en.trim(), `${d.cle} ${x.cle}`).toBeTruthy();
        expect(x.ecrit).toMatch(/^(\[[a-z_]+\]|\{\{[a-z]+\.[a-z0-9_]+\}\})$/);
      }
    }
  });

  it('« Champ personnalisé modifié » (fiche variable) : rien n’est exclu d’avance ; la fiche connue par les réglages resserre', () => {
    expect(entiteDuDeclencheur('custom_field.changed')).toBeNull();
    expect(groupesDe(variablesPour('custom_field.changed').base)).toEqual(['Client', 'Entreprise', 'Facture', 'Job', 'Devis']);
    expect(groupesDe(variablesPour('custom_field.changed', [], { entite: 'quote' }).base)).toEqual(['Client', 'Entreprise', 'Devis']);
    expect(groupesDe(variablesPour('date.reached', [], { entite: 'deal' }).plus)).toContain('Pipeline');
    expect(entiteDuDeclencheur('lead.created')).toBe('client');
    expect(Object.keys(ENTITE_PAR_DECLENCHEUR).every((d) => entiteDuDeclencheur(d) !== 'lead')).toBe(true);
  });

  it('le lien de réservation n’est offert que sur « Client inactif »', () => {
    expect(ecrits(variablesPour('client.inactive').plus)).toContain('{{client.lien_reservation}}');
    expect(ecrits(variablesPour('lead.created').plus)).not.toContain('{{client.lien_reservation}}');
  });
});

describe('P — variables : « Champs personnalisés », section à part, exclusions par défaut', () => {
  it('[cible de E-30] les champs de l’entreprise sont dans LEUR section — jamais dans « Champs de base »', () => {
    const p = variablesPour('invoice.overdue', CHAMPS_SEMES);
    expect(p.personnalises.map((x) => `${x.groupe.fr} · ${x.fr}`)).toEqual([
      'Client · Référé par', 'Client · Courriel de facturation', 'Job · Carburant', 'Job · Sous-traitance', 'Job · Autres dépenses',
    ]);
    expect(libelles(p.base).some((l) => /Référé|Carburant|Motif/.test(l))).toBe(false);
  });

  it('[cible de E-33] exclus par défaut : cases à cocher, fichiers, codes et instructions d’accès, paragraphes, notes internes', () => {
    const p = variablesPour('invoice.overdue', CHAMPS_SEMES);
    const offerts = ecrits([...p.base, ...p.plus, ...p.personnalises]);
    for (const interdit of [
      '{{invoice.internal_notes}}', '{{invoice.notes}}', '{{client.display_as_company}}', '{{client.billing_same_as_service}}',
      '{{job.show_on_leaderboard}}', '{{job.notes}}', '{{client.noreview}}', '{{client.code_acces}}', '{{client.instructions_acces}}',
      '{{job.instructions_speciales}}',
    ]) expect(offerts, interdit).not.toContain(interdit);
    // Sur AUCUN déclencheur une case à cocher, un fichier ou un paragraphe de formulaire n'est offert.
    for (const d of DECLENCHEURS) {
      const tout = [...variablesPour(d.cle).plus].map((x) => x.cle);
      expect(tout.filter((c) => /internal_notes|\.notes$|display_as_company|show_on_leaderboard|ask_for_review|photos|line_items/.test(c)), d.cle).toEqual([]);
    }
  });

  it('« Proposer dans les messages » : l’entreprise peut offrir un champ sensible, ou retirer un champ ordinaire', () => {
    expect(champPropose(champ('client', 'code_acces', 'Code d’accès', 'single_line'))).toBe(false);
    expect(champPropose(champ('client', 'code_acces', 'Code d’accès', 'single_line', { dans_messages: true }))).toBe(true);
    expect(champPropose(champ('client', 'code_alarme', 'Code d’alarme', 'number'))).toBe(false);
    expect(champPropose(champ('job', 'consignes', 'Consignes', 'multi_line', { dans_messages: true }))).toBe(true);
    expect(champPropose(champ('client', 'refere_par', 'Référé par', 'single_line', { dans_messages: false }))).toBe(false);
    // Une case à cocher ou un fichier : jamais, même cochée « proposer ».
    expect(champPropose(champ('client', 'noreview', 'x', 'checkbox', { dans_messages: true }))).toBe(false);
    expect(champPropose(champ('job', 'plan', 'Plan', 'file', { dans_messages: true }))).toBe(false);
    expect(champPropose({ ...champ('client', 'ancien', 'Ancien', 'single_line'), archived_at: '2026-01-01' })).toBe(false);
  });

  it('seuls les champs des fiches du contexte sont offerts ; un champ de propriété, jamais', () => {
    const tous = [...CHAMPS_SEMES, champ('property', 'superficie_pi2', 'Superficie', 'number'), champ('deal', 'budget', 'Budget', 'monetary')];
    expect(ecrits(variablesPour('lead.created', tous).personnalises)).toEqual(['{{client.refere_par}}', '{{client.courriel_facturation}}']);
    expect(ecrits(variablesPour('quote.sent', tous).personnalises)).toContain('{{quote.motif_refus}}');
    expect(ecrits(variablesPour('deal.stage_entered', tous).personnalises)).toContain('{{deal.budget}}');
    expect(ecrits(variablesPour('custom_field.changed', tous).personnalises).some((e) => e.startsWith('{{property.'))).toBe(false);
  });
});

describe('P — variables : la recherche', () => {
  const tout = () => { const p = variablesPour('invoice.overdue', CHAMPS_SEMES); return [...p.base, ...p.plus, ...p.personnalises]; };

  it('[cible de E-34] sans accents ni casse, sur le libellé, le groupe et ce qu’on écrit', () => {
    expect(normaliserRecherche('  Échéance  D’AVIS ')).toBe('echeance d avis');
    expect(libelles(filtrerVariables(tout(), 'echeance'))).toEqual(['Date d’échéance']);
    expect(libelles(filtrerVariables(tout(), 'PRÉNOM'))).toEqual(['Prénom du client']);
    expect(libelles(filtrerVariables(tout(), 'invoice_link'))).toEqual(['Lien de paiement']);
    expect(libelles(filtrerVariables(tout(), 'refere'))).toEqual(['Référé par']);
    // Plusieurs mots : tous doivent y être, dans n'importe quel ordre.
    expect(libelles(filtrerVariables(tout(), 'facture numero'))).toEqual(['Numéro de facture']);
    expect(filtrerVariables(tout(), 'zzz')).toEqual([]);
    expect(filtrerVariables(tout(), '   ')).toHaveLength(tout().length);
  });

  it('en anglais, la recherche porte sur les libellés anglais', () => {
    expect(filtrerVariables(tout(), 'due date', false).map((x) => x.en)).toEqual(['Due date']);
    expect(filtrerVariables(tout(), 'échéance', false)).toEqual([]);
  });
});

describe('P — variables : valeur de remplacement « Bonjour [client_first_name|là] »', () => {
  it('[cible de E-44] le remplacement sert quand la valeur est vide ; la valeur gagne quand elle existe — dans les trois écritures', () => {
    expect(appliquerRemplacement('Bonjour [client_first_name|là],', { client_first_name: '' })).toBe('Bonjour là,');
    expect(appliquerRemplacement('Bonjour [client_first_name|là],', {})).toBe('Bonjour là,');
    expect(appliquerRemplacement('Bonjour [client_first_name|là],', { client_first_name: 'Marie' })).toBe('Bonjour Marie,');
    expect(appliquerRemplacement('Bonjour {{client.first_name|cher client}},', { client_cf_first_name: 'Marie' })).toBe('Bonjour Marie,');
    expect(appliquerRemplacement('Bonjour {{client.first_name|cher client}},', {})).toBe('Bonjour cher client,');
    expect(appliquerRemplacement('Bonjour {client_first_name|là},', { client_first_name: 'Marie' })).toBe('Bonjour Marie,');
    expect(appliquerRemplacement('Bonjour {{ client_first_name | là }},', {})).toBe('Bonjour là,');
  });

  it('sans remplacement : exactement comme avant (une variable vide ou inconnue part vide)', () => {
    expect(appliquerRemplacement('Bonjour [prenom], total {{facture.solde}}.', { client_first_name: 'Marie' })).toBe('Bonjour , total .');
    expect(appliquerRemplacement('Rabais [50] %, étape {0}, [ci-dessous]', {})).toBe('Rabais [50] %, étape {0}, [ci-dessous]');
    expect(appliquerRemplacement('[constructor] {toString}', {})).toBe(' ');
  });

  it('dans un courriel, la valeur ET le remplacement sont échappés ; une valeur n’est jamais relue comme un gabarit', () => {
    expect(appliquerRemplacement('<p>[client_first_name|<b>ami</b>]</p>', {}, { html: true })).toBe('<p>&lt;b&gt;ami&lt;/b&gt;</p>');
    expect(appliquerRemplacement('<p>[client_first_name]</p>', { client_first_name: '<script>x</script>' }, { html: true })).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
    expect(appliquerRemplacement('[contract_html]', { contract_html: '<p>ok</p>' }, { html: true, htmlDeConfiance: new Set(['contract_html']) })).toBe('<p>ok</p>');
    expect(appliquerRemplacement('Bonjour [client_first_name]', { client_first_name: '[company_name|x]', company_name: 'Y' })).toBe('Bonjour [company_name|x]');
  });

  it('au-delà de 60 caractères, ou avec un crochet dedans, ce n’est plus une variable : le texte reste tel quel et le détecteur le dit', () => {
    const long = `[client_first_name|${'a'.repeat(REMPLACEMENT_MAX + 1)}]`;
    expect(appliquerRemplacement(long, {})).toBe(long);
    expect(variablesInconnues(long, 'lead.created')[0]).toMatchObject({ raison: 'remplacement_trop_long' });
    expect(appliquerRemplacement(`[client_first_name|${'a'.repeat(REMPLACEMENT_MAX)}]`, {})).toBe('a'.repeat(REMPLACEMENT_MAX));
  });

  it('l’analyse rend chaque variable avec sa clé, son remplacement et sa place dans le texte', () => {
    const texte = 'Bonjour [client_first_name|là], voici {{quote.total}} et {company_name}.';
    expect(analyserJetons(texte).map((j) => [j.brut, j.cle, j.pointee, j.remplacement])).toEqual([
      ['[client_first_name|là]', 'client_first_name', false, 'là'], ['{{quote.total}}', 'quote.total', true, null], ['{company_name}', 'company_name', false, null],
    ]);
    const j = analyserJetons(texte)[0];
    expect(texte.slice(j.debut, j.fin)).toBe('[client_first_name|là]');
    expect(ecriture('client_first_name', 'là')).toBe('[client_first_name|là]');
    expect(ecriture('client.refere_par', 'un ami')).toBe('{{client.refere_par|un ami}}');
  });
});

describe('P — variables : variable inconnue, hors contexte, mal écrite', () => {
  const raisons = (texte: string, d: string, champs?: ChampPourVariables[]) => variablesInconnues(texte, d, champs).map((p) => [p.ecrit, p.raison]);

  it('[cible de E-36] les trois fautes du relevé sont TOUTES signalées (une seule l’était)', () => {
    expect(raisons('Bonjour [prenom_du_client], voici {{client.champ_qui_nexiste_pas}} et {prénom|là}.', 'lead.created', CHAMPS_SEMES)).toEqual([
      ['[prenom_du_client]', 'inconnue'], ['{{client.champ_qui_nexiste_pas}}', 'inconnue'], ['{prénom|là}', 'mal_ecrite'],
    ]);
  });

  it('[cible de E-46] une variable écrite avec un accent, une majuscule de fiche ou des crochets dépareillés : « mal écrite »', () => {
    expect(raisons('Bonjour {prénom}, [côté]', 'lead.created')).toEqual([['{prénom}', 'mal_ecrite'], ['[côté]', 'mal_ecrite']]);
    expect(raisons('{client.first_name} [client.first_name] {{Client.first_name}} [client_name}', 'lead.created').map((r) => r[1]))
      .toEqual(['mal_ecrite', 'mal_ecrite', 'mal_ecrite', 'mal_ecrite']);
    expect(variablesInconnues('{prénom}', 'lead.created')[0].fr).toContain('le client lira ce texte tel quel');
  });

  it('[cible de E-47] une variable qui existe mais n’a jamais de valeur pour CE déclencheur est signalée, et le message nomme le déclencheur', () => {
    const p = variablesInconnues('Bonjour, payez ici : [invoice_link] ([invoice_total]).', 'lead.created');
    expect(p.map((x) => [x.ecrit, x.raison])).toEqual([['[invoice_link]', 'hors_contexte'], ['[invoice_total]', 'hors_contexte']]);
    expect(p[0].fr).toBe('[invoice_link] n’a pas de valeur sur « Nouveau prospect » : elle serait vide dans le message envoyé.');
    expect(p[0].en).toBe('[invoice_link] has no value on “New lead”: it would be empty in the message sent.');
    expect(raisons('[invoice_link]', 'invoice.overdue')).toEqual([]);
    expect(raisons('{{quote.title}} {{job.motif}}', 'invoice.overdue', CHAMPS_SEMES)).toEqual([['{{quote.title}}', 'hors_contexte'], ['{{job.motif}}', 'inconnue']]);
  });

  it('ce qui n’est pas une variable n’est jamais signalé — le moteur n’y touche pas', () => {
    for (const t of ['Rabais [50 %] appliqué', 'Voir [ci-dessous] le détail', 'Réf. [A-1234]', 'Étape {0}', '<style>p{color:red}</style>', 'Stationnez [côté rue]', '{ "a": 1 }']) {
      expect(variablesInconnues(t, 'lead.created'), t).toEqual([]);
    }
    // …mais un mot seul entre crochets, lui, serait EFFACÉ par le moteur : signalé.
    expect(raisons('Note [important] ici', 'lead.created')).toEqual([['[important]', 'inconnue']]);
  });

  it('un champ de fiche connu passe ; sans la liste des champs du bureau on ne crie pas au loup ; un champ archivé est inconnu', () => {
    expect(raisons('{{client.refere_par}} {{client.first_name}} {client_cf_refere_par} [client_cf_city]', 'lead.created', CHAMPS_SEMES)).toEqual([]);
    expect(raisons('{{client.toitur}}', 'lead.created')).toEqual([]);
    expect(raisons('{{client.toitur}}', 'lead.created', CHAMPS_SEMES)).toEqual([['{{client.toitur}}', 'inconnue']]);
    expect(raisons('{{client.refere_par}}', 'lead.created', [{ ...CHAMPS_SEMES[0], archived_at: '2026-01-01' }])).toEqual([['{{client.refere_par}}', 'inconnue']]);
    // Un champ sensible n'est plus OFFERT, mais ce qui est déjà écrit reste rempli : pas une faute.
    expect(raisons('Code : {{client.code_acces}}', 'lead.created', CHAMPS_SEMES)).toEqual([]);
  });

  it('une fiche LIÉE que le moteur remplit (le job d’une facture, l’opportunité d’un devis) n’est pas « hors contexte »', () => {
    expect(raisons('{{job.title}} {{job.depense_carburant}}', 'invoice.overdue', CHAMPS_SEMES)).toEqual([]);
    expect(raisons('{{deal.amount}}', 'quote.sent', CHAMPS_SEMES)).toEqual([]);
    expect(raisons('{{invoice.subject}}', 'quote.sent', CHAMPS_SEMES)).toEqual([['{{invoice.subject}}', 'hors_contexte']]);
  });

  it('une variable « en attente » du moteur est encore inconnue ; la même variable citée deux fois n’est dite qu’une fois', () => {
    expect(raisons('[invoice_balance] [invoice_balance]', 'invoice.overdue')).toEqual([['[invoice_balance]', 'inconnue']]);
    expect(raisons('[company_email]', 'lead.created')).toEqual([['[company_email]', 'inconnue']]);
  });

  it('la valeur de remplacement ne change pas le verdict : [prenom|là] reste inconnue, [client_first_name|là] passe', () => {
    expect(raisons('[prenom|là] [client_first_name|là] {{client.first_name|cher client}}', 'lead.created')).toEqual([['[prenom]', 'inconnue']]);
  });

  it('les variables pointées des préréglages de base passent sur leur fiche', () => {
    expect(raisons('{{soumission.numero}} {{soumission.lien}} {{client.nom}}', 'quote.viewed')).toEqual([]);
    expect(raisons('{{facture.lien}} {{paiement.montant}}', 'payment.failed')).toEqual([]);
    expect(raisons('{{soumission.total}}', 'invoice.viewed')).toEqual([['{{soumission.total}}', 'hors_contexte']]);
  });
});

describe('P — variables : exemples et aperçu', () => {
  it('JAMAIS le nom d’un vrai client ni d’une vraie entreprise ; l’exemple de l’entreprise est neutre', () => {
    const VRAIS_CLIENTS = [/coquin\s*lavage/i, /vision\s*lavage/i];
    for (const x of CATALOGUE_VARIABLES) {
      for (const texte of [x.exemple.fr, x.exemple.en, x.fr, x.en]) expect(VRAIS_CLIENTS.some((re) => re.test(texte)), `${x.jeton} : ${texte}`).toBe(false);
    }
    expect(exempleDe('company_name')).toBe('Votre entreprise');
    expect(exempleDe('company_name', false)).toBe('Your company');
    expect(exempleDe('inconnue')).toBe('');
  });

  it('toute variable OFFERTE a un exemple, un libellé français et un libellé anglais ; un groupe a ses deux noms', () => {
    for (const x of CATALOGUE_VARIABLES.filter((c) => c.rang !== 'masquee')) {
      expect(x.exemple.fr.trim() && x.exemple.en.trim(), x.jeton).toBeTruthy();
      expect(x.fr.trim() && x.en.trim(), x.jeton).toBeTruthy();
      expect(x.source.trim(), x.jeton).toBeTruthy();
      expect(LIBELLES_GROUPE[x.groupe].fr && LIBELLES_GROUPE[x.groupe].en).toBeTruthy();
    }
    expect(new Set(CATALOGUE_VARIABLES.map((x) => x.jeton)).size).toBe(CATALOGUE_VARIABLES.length);
  });

  it('« Le client lira » : chaque variable devient son exemple, le remplacement joue, une variable hors contexte part vide', () => {
    expect(rendreAvecExemples('Bonjour [client_first_name|là], ici [company_name]. Facture [invoice_number] : [invoice_link]', 'invoice.overdue'))
      .toBe('Bonjour Marie, ici Votre entreprise. Facture FAC-1042 : https://lumecrm.net/invoice/exemple');
    expect(rendreAvecExemples('Hello [client_first_name], total [invoice_total], due [invoice_due_date].', 'invoice.overdue', [], false))
      .toBe('Hello Marie, total $450.00, due August 30, 2026.');
    expect(rendreAvecExemples('Payez : [invoice_link|plus tard]. Référé par {{client.refere_par}}.', 'lead.created', CHAMPS_SEMES))
      .toBe('Payez : plus tard. Référé par (Référé par).');
  });

  it('la liste donnée à Lumi : les variables remplies aujourd’hui, avec leurs fiches — aucune « en attente », aucune écriture masquée', () => {
    const lignes = variablesPourConsigne();
    expect(lignes).toContain('[client_first_name] — Prénom du client (dès qu’il y a un client)');
    expect(lignes).toContain('[invoice_link] — Lien de paiement (facture)');
    expect(lignes).toContain('[company_name] — Nom de l’entreprise (toujours)');
    expect(lignes.join('\n')).not.toMatch(/invoice_balance|company_email|technician_name|contract_html|soumission\./);
    expect(variablesPourConsigne(false)).toContain('[invoice_link] — Payment link (invoice)');
  });
});
