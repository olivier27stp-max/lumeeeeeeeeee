// Normalisation : argent → cents, dates flexibles, courriels, téléphones,
// scission du nom complet, clés de relation.

import { describe, it, expect } from 'vitest';
import {
  isNullLikeValue, isScientificNotation, localToUtcIso, normalizeAddressKey,
  normalizeDigits, normalizePostalCode, normalizeRow, parseDateFlexible,
  parseDateTimeFlexible, parseMoneyToCents, stripInvisible, parsePercent, parseBooleanFlexible,
} from '../../server/lib/migration/normalize';

describe('parseMoneyToCents', () => {
  it('formats usuels en/fr', () => {
    expect(parseMoneyToCents('$1,234.56')).toBe(123456);
    expect(parseMoneyToCents('1 234,56 $')).toBe(123456);
    expect(parseMoneyToCents('150')).toBe(15000);
    expect(parseMoneyToCents('99.5')).toBe(9950);
    expect(parseMoneyToCents('(45.00)')).toBe(-4500);
    expect(parseMoneyToCents('-12.25')).toBe(-1225);
  });
  it('invalide → null', () => {
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('12.34.56')).toBeNull();
  });
});

describe('parseDateFlexible', () => {
  it('ISO, US, DD/MM certain, mois textuels fr/en', () => {
    expect(parseDateFlexible('2024-03-05')).toBe('2024-03-05');
    expect(parseDateFlexible('03/05/2024')).toBe('2024-03-05'); // MM/DD par défaut
    expect(parseDateFlexible('25/03/2024')).toBe('2024-03-25'); // jour > 12 ⇒ DD/MM
    expect(parseDateFlexible('Mar 5, 2024')).toBe('2024-03-05');
    expect(parseDateFlexible('5 mars 2024')).toBe('2024-03-05');
  });
  it('invalide → null', () => {
    expect(parseDateFlexible('13/13/2024')).toBeNull();
    expect(parseDateFlexible('2024-02-30')).toBeNull();
    expect(parseDateFlexible('bientôt')).toBeNull();
  });
});

describe('parseDateTimeFlexible', () => {
  it('date + heure, AM/PM, date seule → minuit', () => {
    expect(parseDateTimeFlexible('2024-03-05 14:30')).toBe('2024-03-05T14:30:00');
    expect(parseDateTimeFlexible('03/05/2024 2:30 PM')).toBe('2024-03-05T14:30:00');
    expect(parseDateTimeFlexible('2024-03-05')).toBe('2024-03-05T00:00:00');
  });
});

describe('normalizeAddressKey / normalizeDigits', () => {
  it('clé d\'adresse stable (accents, abréviations)', () => {
    expect(normalizeAddressKey('123 Rue Saint-Denis Été')).toBe(normalizeAddressKey('123 rue saint denis ete'));
    expect(normalizeAddressKey('45 Boulevard des Pins')).toBe('45 blvd des pins');
  });
  it('téléphone → chiffres seuls', () => {
    expect(normalizeDigits('(514) 555-1234')).toBe('5145551234');
  });
});

describe('normalizeRow', () => {
  it('convertit selon la correspondance et extrait les relations', () => {
    const res = normalizeRow(
      'invoice',
      { 'Invoice #': 'INV-042', Amount: '$150.00', 'Due Date': '03/15/2024', Client: 'Marc Tremblay', Notes: 'merci' },
      { 'Invoice #': 'invoice_number', Amount: 'total', 'Due Date': 'due_date', Client: 'client_ref', Notes: 'notes' },
    );
    expect(res.normalized.invoice_number).toBe('INV-042');
    expect(res.normalized.total_cents).toBe(15000);
    expect(res.normalized.due_date).toBe('2024-03-15');
    expect(res.relations.client_ref).toBe('Marc Tremblay');
    expect(res.problems).toEqual([]);
  });

  it('signale les valeurs invalides sans planter', () => {
    const res = normalizeRow('invoice', { Amount: 'abc', 'Due Date': 'jamais' }, { Amount: 'total', 'Due Date': 'due_date' });
    expect(res.problems).toContain('invalid_money:total');
    expect(res.problems).toContain('invalid_date:due_date');
  });

  it('tokens nuls (N/A, -, #REF!) = cellule vide, jamais une erreur ni un littéral (audit S2)', () => {
    const res = normalizeRow(
      'client',
      { Company: 'N/A', City: '-', Notes: '#REF!', Email: 's/o', 'First Name': 'Marc' },
      { Company: 'company', City: 'city', Notes: 'notes', Email: 'email', 'First Name': 'first_name' },
    );
    expect(res.problems).toEqual([]);
    expect(res.normalized.company).toBeUndefined();
    expect(res.normalized.city).toBeUndefined();
    expect(res.normalized.notes).toBeUndefined();
    expect(res.normalized.email).toBeUndefined();
    expect(res.normalized.first_name).toBe('Marc');
    // mais les vrais noms qui ressemblent ne sont pas avalés
    expect(isNullLikeValue('Nathalie')).toBe(false);
    expect(isNullLikeValue('Na')).toBe(false);
    expect(isNullLikeValue('N/A')).toBe(true);
  });

  it('téléphone en notation scientifique (massacre Excel) → signalé, jamais stocké (audit S2)', () => {
    const res = normalizeRow('client', { Phone: '5.14555E+11', 'First Name': 'Marc' }, { Phone: 'phone', 'First Name': 'first_name' });
    expect(res.problems).toContain('invalid_phone:phone');
    expect(res.normalized.phone).toBeUndefined();
    expect(res.normalized.phone_digits).toBeUndefined(); // pas de fausse clé de dédup
    expect(isScientificNotation('514-555-1234')).toBe(false);
  });

  it('clé de relation en notation scientifique → orphelin visible, jamais un rattachement au hasard', () => {
    const res = normalizeRow('job', { 'Client ID': '1.23457E+18', Title: 'Lavage' }, { 'Client ID': 'client_ref', Title: 'title' });
    expect(res.problems).toContain('invalid_id:client_ref');
    expect(res.relations.client_ref).toBeUndefined();
  });

  it('code postal canadien normalisé « A1A 1A1 » (audit S2)', () => {
    expect(normalizePostalCode('h2x1y4')).toBe('H2X 1Y4');
    expect(normalizePostalCode('H2X 1Y4')).toBe('H2X 1Y4');
    expect(normalizePostalCode('90210')).toBe('90210'); // US : inchangé
    const res = normalizeRow('client', { Postal: 'h2x1y4' }, { Postal: 'postal_code' });
    expect(res.normalized.postal_code).toBe('H2X 1Y4');
  });

  it('caractères invisibles retirés avant tout traitement', () => {
    expect(stripInvisible('Marc\u200B Tremblay')).toBe('Marc Tremblay');
    const res = normalizeRow('client', { Email: '\u200Bmarc@exemple.com\uFEFF' }, { Email: 'email' });
    expect(res.normalized.email).toBe('marc@exemple.com');
  });

  it('colonnes non mappées conservées dans _unmapped (audit S3 — jamais de perte silencieuse)', () => {
    const res = normalizeRow(
      'client',
      { 'First Name': 'Marc', 'Ancien champ maison': 'valeur précieuse', 'Colonne vide': '', 'Colonne nulle': 'N/A' },
      { 'First Name': 'first_name' },
    );
    expect((res.normalized._unmapped as Record<string, string>)['Ancien champ maison']).toBe('valeur précieuse');
    expect(Object.keys(res.normalized._unmapped as object)).toHaveLength(1); // vide et N/A ignorés
  });

  it('client : full_name scindé en prénom/nom', () => {
    const res = normalizeRow('client', { Name: 'Marie Ève Gagnon' }, { Name: 'full_name' });
    expect(res.normalized.first_name).toBe('Marie Ève');
    expect(res.normalized.last_name).toBe('Gagnon');
  });

  it('courriel invalide signalé, valide normalisé en minuscules', () => {
    const bad = normalizeRow('client', { Email: 'pas-un-courriel' }, { Email: 'email' });
    expect(bad.problems).toContain('invalid_email:email');
    const good = normalizeRow('client', { Email: 'Marc@Exemple.COM' }, { Email: 'email' });
    expect(good.normalized.email).toBe('marc@exemple.com');
  });
});

describe('dates en numéro de série Excel (audit S2)', () => {
  it('45234 → 2023-11-04, avec fraction d\'heure', () => {
    expect(parseDateFlexible('45234')).toBe('2023-11-04');
    expect(parseDateTimeFlexible('45234.375')).toBe('2023-11-04T09:00:00');
  });
  it('jamais avalé hors plage plausible : « 2024 » nu ou grand nombre restent invalides', () => {
    expect(parseDateFlexible('2024')).toBeNull();
    expect(parseDateFlexible('99999')).toBeNull();
    expect(parseDateFlexible('12345')).toBeNull(); // 1933 : hors plage 1954-2064
  });
});

describe('localToUtcIso — visites en heure locale du bureau (audit S2, fuseaux)', () => {
  it('9 h à Toronto (été, EDT) → 13:00 UTC — jamais « 9 h devient 5 h »', () => {
    expect(localToUtcIso('2024-07-15T09:00:00')).toBe('2024-07-15T13:00:00Z');
  });
  it('9 h à Toronto (hiver, EST) → 14:00 UTC', () => {
    expect(localToUtcIso('2024-01-15T09:00:00')).toBe('2024-01-15T14:00:00Z');
  });
  it('convention « pas d\'heure précise » : minuit local reste minuit local une fois relu', () => {
    // 00:00 EDT = 04:00Z ; new Date('...04:00Z').getHours() === 0 à Toronto → isAnytimeVisit fonctionne
    expect(localToUtcIso('2024-07-15T00:00:00')).toBe('2024-07-15T04:00:00Z');
    expect(localToUtcIso('2024-07-15T23:59:00')).toBe('2024-07-16T03:59:00Z');
  });
  it('format inattendu → null (l\'appelant garde la valeur telle quelle)', () => {
    expect(localToUtcIso('2024-07-15')).toBeNull();
    expect(localToUtcIso('2024-07-15T09:00:00Z')).toBeNull();
  });
});

describe('inférence de convention de date par colonne (précision)', async () => {
  const { inferDateConvention, parseDateFlexible, normalizeRow } = await import('../../server/lib/migration/normalize');

  it('détecte JJ/MM quand un jour dépasse 12', () => {
    expect(inferDateConvention(['05/04/2024', '25/03/2024', '01/02/2024'])).toBe('dmy');
  });
  it('détecte MM/JJ quand un deuxième segment dépasse 12', () => {
    expect(inferDateConvention(['03/15/2024', '05/01/2024'])).toBe('mdy');
  });
  it('ambigu sans preuve, incohérent si les deux', () => {
    expect(inferDateConvention(['03/05/2024', '01/02/2024'])).toBe('ambiguous');
    expect(inferDateConvention(['25/03/2024', '03/15/2024'])).toBe('mixed');
    expect(inferDateConvention(['2024-01-05'])).toBe('none');
  });
  it('la convention force l\'interprétation des valeurs ambiguës', () => {
    expect(parseDateFlexible('05/04/2024', 'dmy')).toBe('2024-04-05');
    expect(parseDateFlexible('05/04/2024', 'mdy')).toBe('2024-05-04');
    expect(parseDateFlexible('25/03/2024', 'mdy')).toBe('2024-03-25'); // preuve > convention
  });
  it('normalizeRow applique la convention et récupère l\'heure de start_date', () => {
    const res = normalizeRow(
      'job',
      { 'Scheduled Start': '05/12/2024 9:00 AM', 'Due': '05/04/2024' },
      { 'Scheduled Start': 'start_date', Due: 'due_date' },
      { start_date: 'mdy', due_date: 'dmy' },
    );
    expect(res.normalized.start_date).toBe('2024-05-12');
    expect(res.normalized.start_at).toBe('2024-05-12T09:00:00'); // heure récupérée
    expect(res.normalized.due_date).toBe('2024-04-05'); // convention dmy respectée
    expect(res.problems).toEqual([]);
  });
});

describe('taxes — taux et composée', () => {
  it('parsePercent : « 9,975 % », « 9.975 », fraction 0.05 → 5', () => {
    expect(parsePercent('9,975 %')).toBe(9.975);
    expect(parsePercent('9.975')).toBe(9.975);
    expect(parsePercent('5%')).toBe(5);
    expect(parsePercent('0.05')).toBe(5);
    expect(parsePercent('0.5%')).toBe(0.5);
    expect(parsePercent('abc')).toBe(null);
    expect(parsePercent('-2')).toBe(null);
  });

  it('parseBooleanFlexible : oui/non, yes/no, 1/0', () => {
    expect(parseBooleanFlexible('Oui')).toBe(true);
    expect(parseBooleanFlexible('yes')).toBe(true);
    expect(parseBooleanFlexible('1')).toBe(true);
    expect(parseBooleanFlexible('non')).toBe(false);
    expect(parseBooleanFlexible('No')).toBe(false);
    expect(parseBooleanFlexible('peut-être')).toBe(null);
  });

  it('normalizeRow tax_config : taux en pourcentage, composée en booléen', () => {
    const rec = normalizeRow('tax_config', { 'Tax Name': 'TVQ', 'Rate': '9,975 %', 'Compound': 'non', 'Province': 'QC' }, {
      'Tax Name': 'name', 'Rate': 'rate', 'Compound': 'is_compound', 'Province': 'region',
    });
    expect(rec.normalized).toMatchObject({ name: 'TVQ', rate: 9.975, is_compound: false, region: 'QC' });
    expect(rec.problems).toEqual([]);
  });
});

describe('relations de repli client (courriel / nom complet)', async () => {
  const { normalizeRow } = await import('../../server/lib/migration/normalize');
  it('client_email_ref et client_name_ref sont des relations, pas des champs', () => {
    const res = normalizeRow('quote', { 'Client email': 'Marc@Ex.com', 'Display name': 'Marc Tremblay' }, { 'Client email': 'client_email_ref', 'Display name': 'client_name_ref' });
    expect(res.relations.client_email_ref).toBe('Marc@Ex.com');
    expect(res.relations.client_name_ref).toBe('Marc Tremblay');
    expect(res.normalized.client_email_ref).toBeUndefined();
  });
});

// ── Manques comblés (rapport du bot, export Jobber 2026-09) ──

import { parseFlagFlexible, splitOneLineAddress } from '../../server/lib/migration/normalize';

describe('parseFlagFlexible — « Lead (as of …) », « Archived »', () => {
  it('oui/non et mots de statut', () => {
    expect(parseFlagFlexible('Yes')).toBe(true);
    expect(parseFlagFlexible('No')).toBe(false);
    expect(parseFlagFlexible('Lead')).toBe(true);
    expect(parseFlagFlexible('Archived')).toBe(true);
    expect(parseFlagFlexible('Inactive')).toBe(true);
    expect(parseFlagFlexible('Active')).toBe(false);
    expect(parseFlagFlexible('Client')).toBe(false);
    expect(parseFlagFlexible('peut-être')).toBeNull();
  });
});

describe('splitOneLineAddress — adresse de facturation sur une ligne', () => {
  it('avec virgules, province écrite', () => {
    expect(splitOneLineAddress('123 rue Saint-Denis, Montréal, QC H2X 3K5')).toEqual({
      address: '123 rue Saint-Denis', city: 'Montréal', province: 'QC', postal_code: 'H2X 3K5', country: 'CA',
    });
  });
  it('sans virgules (export Jobber) : dernier mot = ville, province déduite du code postal', () => {
    expect(splitOneLineAddress('5300 7e Rang Wotton J1A 1B2')).toEqual({
      address: '5300 7e Rang', city: 'Wotton', province: 'QC', postal_code: 'J1A 1B2', country: 'CA',
    });
    expect(splitOneLineAddress('1100 Avenue du Parc Montréal Québec H2W 4A3')).toEqual({
      address: '1100 Avenue du Parc', city: 'Montréal', province: 'QC', postal_code: 'H2W 4A3', country: 'CA',
    });
  });
  it('pays en fin de ligne retiré, province sur deux mots', () => {
    expect(splitOneLineAddress('10 King St, Toronto, Ontario M5H 1A1, Canada')).toEqual({
      address: '10 King St', city: 'Toronto', province: 'ON', postal_code: 'M5H 1A1', country: 'CA',
    });
  });
  it('sans code postal en fin de ligne : pas de découpage', () => {
    expect(splitOneLineAddress('123 rue Saint-Denis')).toBeNull();
    expect(splitOneLineAddress('123 rue Saint-Denis, Montréal')).toBeNull();
    expect(splitOneLineAddress('')).toBeNull();
  });
});

describe('normalizeRow — prospect, archivé, complément, date de paiement, adresse sur une ligne', () => {
  it('client : « Lead » / « Archived » deviennent des booléens, Street 2 reste séparé', () => {
    const { normalized, problems } = normalizeRow('client', {
      'Lead (as of 2026-09-15 15:07)': 'Yes', Archived: 'No', 'Service Street 1': '123 rue X', 'Service Street 2': 'app. 4',
    }, { 'Lead (as of 2026-09-15 15:07)': 'is_lead', Archived: 'archived', 'Service Street 1': 'address', 'Service Street 2': 'address_line2' });
    expect(problems).toEqual([]);
    expect(normalized.is_lead).toBe(true);
    expect(normalized.archived).toBe(false);
    expect(normalized.address).toBe('123 rue X');
    expect(normalized.address_line2).toBe('app. 4');
  });
  it('client : drapeau illisible → problème, pas de valeur', () => {
    const { normalized, problems } = normalizeRow('client', { Archived: 'bof' }, { Archived: 'archived' });
    expect(problems).toContain('invalid_boolean:archived');
    expect(normalized.archived).toBeUndefined();
  });
  it('facture : « Marked paid date » → paid_date (date)', () => {
    const { normalized } = normalizeRow('invoice', { 'Marked paid date': '09/03/2026' }, { 'Marked paid date': 'paid_date' });
    expect(normalized.paid_date).toBe('2026-09-03');
  });
  it('adresse de facturation sur une ligne → découpée quand rien d\'autre n\'est mappé', () => {
    const { normalized } = normalizeRow('billing_property',
      { 'Billing address': '222 De La Salle Drummondville QC J2C 1A1', Email: 'a@b.ca' },
      { 'Billing address': 'address', Email: 'client_email_ref' });
    expect(normalized.address).toBe('222 De La Salle');
    expect(normalized.city).toBe('Drummondville');
    expect(normalized.province).toBe('QC');
    expect(normalized.postal_code).toBe('J2C 1A1');
  });
  it('adresse sur une ligne NON découpée quand la ville est mappée à côté', () => {
    const { normalized } = normalizeRow('client',
      { Address: '222 De La Salle Drummondville QC J2C 1A1', City: 'Drummondville' },
      { Address: 'address', City: 'city' });
    expect(normalized.address).toBe('222 De La Salle Drummondville QC J2C 1A1');
  });
});
