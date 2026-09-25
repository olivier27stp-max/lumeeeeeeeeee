/**
 * Connaissances du bot de migration — ce que Claude Code sait quand il relit
 * une migration avec Olivier, transcrit pour le modèle du bot.
 * ─────────────────────────────────────────────────────────────────
 * Deux blocs, tous deux STABLES (mis en cache 1 h avec le prompt système) :
 *  - RÈGLES : le comportement réel de l'importeur (importer.ts / normalize.ts)
 *    et les pièges vus sur de vrais exports (Jobber d'abord) ;
 *  - SÉMANTIQUE : par entité et par champ, ce que l'importeur fait vraiment
 *    de la valeur — c'est ce qui manque au catalogue seul.
 * Ne jamais y injecter une valeur variable (fichier, migration, date).
 */
import type { TargetEntity } from './types';

export const REGLES_LUME = `RÈGLES DE L'IMPORTEUR LUME (comportement réel, pas des souhaits)
1. Un fichier vise UNE seule entité. Chaque colonne va à un champ de cette entité ou à « ne pas importer » (null).
2. Deux colonnes vers le même champ : la colonne la plus À DROITE dans le fichier ÉCRASE l'autre quand elle n'est pas vide. Il n'y a AUCUNE concaténation (« Street 2 » vers « address » efface « Street 1 »). Une seule colonne par champ, toujours.
3. Les colonnes non importées ne sont pas perdues : leurs valeurs non vides sont copiées dans les notes de la fiche (12 colonnes max). En cas de doute, null est sûr.
4. Une colonne booléenne (true/false, 0/1, yes/no) ne va JAMAIS vers un identifiant, un nom, une entreprise, un courriel, un téléphone, une date, un montant ou un rattachement. « Is Company? » n'est pas un nom d'entreprise ; « Quoted qty » 0/1 n'est pas « taxable ».
5. Une colonne date ne va jamais vers un nom ou un identifiant (« CFT[Last review invite] » n'est pas un nom de famille).
6. « Tags », étiquettes, labels → jamais « external_id » ni un nom. L'identifiant externe est la clé de rattachement des documents au client : un tag l'écraserait pour TOUS les clients.
7. Champs personnalisés Jobber « CFT[...] » / « CFL[...] », colonnes « Receives automatic ... », « Text Message Enabled Phone » → null (notes). Statut client : « Archived » (oui/non) → « archived » (le client arrive archivé = inactif, sans pin Vendu) ; « Lead (as of …) » (oui/non) → « is_lead » (le client arrive prospect) ; une colonne « Status » TEXTE → « status » (lead/prospect → prospect, archived/inactive → archivé, sinon actif). Sans ces colonnes, tout client arrive actif.
8. Adresses : le champ « address » d'un CLIENT est son adresse de SERVICE (elle crée le pin sur la carte). L'adresse de facturation est une entité SÉPARÉE (billing_property) qui vient d'un fichier séparé : dans un fichier clients, les colonnes « Billing ... » → null. « Street 2 » / « Address line 2 » (service) → « address_line2 » : l'importeur l'accole à la rue (« 123 rue X, app. 4 »), JAMAIS vers « address » (écraserait la rue). Adresse de facturation sur UNE ligne (rue, ville, province, code postal dans la même cellule, ex. Jobber « Client Contact Info ») : dans un fichier billing_property, → « address » ; l'importeur la découpe lui-même en rue/ville/province/code postal quand ville, province et code postal ne sont pas mappés à côté (découpage seulement si un code postal termine la ligne, sinon la ligne reste entière).
9. Téléphones d'un client : une seule colonne principale → « phone » (la principale / « Main »), une seule → « phone_secondary » (mobile ou travail). Les autres (Home, Fax, Other, Text message) → null.
10. Montants : les lignes (line_item.unit_price, line_item.line_total) et les prix de catalogue (service.price) sont AVANT TAXES. Un total TTC (ex. 977,29 pour 850 avant taxes, ×1,14975 = TPS+TVQ) ne va JAMAIS dans une ligne : Lume rajouterait les taxes. Sur une facture, « Total » est bien le total TTC du document (champ invoice.total).
11. Rapports Jobber « Products & Services » avec Quoted qty / Quoted $ / Jobs qty / Jobs $ / Invoiced qty / Invoiced $ = RAPPORT D'UTILISATION (compteurs et totaux cumulés), PAS un catalogue : seule « Name » → service.name, tout le reste → null. Un total cumulé n'est pas un prix unitaire.
12. Rattachement au client depuis soumissions/jobs/factures/visites : « client_ref » = identifiant externe (J-ID…) ou nom ; « client_email_ref » = courriel ; « client_name_ref » = nom complet affiché ; « client_phone_ref » = téléphone. Plusieurs colonnes de rattachement peuvent coexister (repli dans cet ordre). Un champ « email » sur une soumission N'EXISTE PAS : c'est client_email_ref.
13. Dépôt / « Deposit » sur une facture → null (déjà reflété dans « balance »). « balance » fait foi pour payé / partiel / impayé ; « paid_amount » sert seulement sans solde. « Marked paid date » / date de paiement → « paid_date » (posée sur les factures soldées seulement, jamais vers issued_date ni created_date).
14. Une colonne vide dans les exemples reste mappable si l'en-tête est sans ambiguïté, mais null est préférable quand l'en-tête est douteux.
15. Confiance : ≥ 0,90 seulement si l'en-tête ET les exemples concordent avec la sémantique du champ ci-dessous. Une correspondance déjà proposée par le moteur peut être fausse : tu la confirmes, la corriges ou la refuses.
16. « manques » : quand une colonne porte une donnée utile pour laquelle Lume n'a AUCUN champ (ex. lignes de facture non importées, statut archivé, dépôt, tags, propriété d'une soumission), déclare-la dans « manques » avec l'entité, un nom de champ proposé (snake_case) et ce que l'importeur devrait en faire. Ne l'invente pas dans « field ».`;

export const SEMANTIQUE_ENTITE: Record<TargetEntity, string> = {
  client: `client : first_name/last_name (nom de la personne) ; full_name n'est utilisé que si prénom ET nom sont vides ; company = raison sociale (texte, jamais un oui/non) ; email = courriel unique (clé de dédup et de rattachement ; plusieurs courriels dans une cellule = invalide) ; phone = téléphone principal (clé de rattachement sur 10 chiffres) ; phone_secondary = second numéro ; address/city/province/postal_code/country = adresse de SERVICE (pin carte) ; address_line2 = complément (app., local) accolé à la rue ; lead_source = source du lead ; notes = notes libres ; status = statut TEXTE (lead/prospect → prospect, archived/inactive → archivé, autre → actif) ; is_lead = oui/non prospect ; archived = oui/non archivé (client inactif) ; external_id = identifiant de l'ancien CRM (J-ID, Customer ID) ; created_date = date de création d'origine (préservée).`,
  property: `property : address (obligatoire, adresse de service d'une propriété du client) + address_line2 (complément accolé) + city/province/postal_code/country ; client_ref / client_email_ref / client_name_ref / client_phone_ref = client propriétaire ; name = nom de la propriété ; notes.`,
  billing_property: `billing_property : address (obligatoire, adresse de FACTURATION, une seule par client ; une adresse complète sur une ligne est acceptée et découpée par l'importeur) + address_line2 + city/province/postal_code/country ; client_ref (obligatoire) ou client_email_ref / client_name_ref / client_phone_ref ; notes.`,
  service: `service (catalogue « Produits et services » du bureau, dédoublonné par nom) : name = nom du service/produit ; description ; price = prix unitaire de catalogue AVANT taxes (jamais un total cumulé, un « Quoted $ » ou un « Invoiced $ ») ; cost = coût ; category ; taxable = oui/non ; item_type = produit ou service.`,
  quote: `quote (soumission) : quote_number ; title (NOT NULL : repli « Soumission n° ») ; status (brouillon / envoyée / approuvée / convertie / archivée) ; subtotal/tax/total = montants du document tels quels ; client_ref + client_email_ref / client_name_ref / client_phone_ref ; job_ref = job issue de la soumission ; created_date ; valid_until ; PAS de champ propriété, PAS de champ email, PAS de champ description de service (les lignes ne sont pas importées : manque).`,
  job: `job : job_number (clé de rattachement des visites/factures) ; title ; description ; notes ; status (draft/scheduled/in_progress/completed/cancelled) ; client_ref + client_email_ref / client_name_ref / client_phone_ref ; property_ref = adresse de la propriété ; subtotal/tax/total tels quels ; sale_date = date de vente ; start_date/end_date ; salesperson = vendeur (nom → employé) ; created_date ; external_id. Les lignes de services d'une job ne sont PAS importées (manque).`,
  visit: `visit : job_ref (obligatoire) ; date + start_time/end_time ou start_at/end_at (heure locale America/Toronto) ; status ; notes ; assigned_to = employé assigné.`,
  invoice: `invoice (facture) : invoice_number ; status ; issued_date ; due_date ; subtotal = avant taxes ; discount = rabais soustrait avant taxes ; tax = montant des taxes ; total = total TTC du document ; paid_amount ; balance = solde (fait foi) ; paid_date = date de paiement (factures soldées) ; client_ref + client_email_ref / client_name_ref / client_phone_ref ; job_ref ; notes ; salesperson ; created_date ; external_id. Dépôt → null. Les lignes (services facturés) ne sont PAS importées : elles vont dans un fichier séparé « Lignes » (manque connu).`,
  line_item: `line_item (ligne de facture/job) : item_name ; item_description ; quantity ; unit_price AVANT taxes ; line_total AVANT taxes (jamais un total TTC) ; invoice_ref = numéro de facture ; job_ref = numéro de job. Entité mappable mais NON importée en v1 (manque à construire).`,
  payment: `payment : amount ; date ; method ; reference ; invoice_ref ; client_ref. Non importé en v1 (manque).`,
  tax_config: `tax_config : name (TPS, TVQ…) ; rate en % ; region ; is_compound.`,
};

/** Sémantique du catalogue pour une entité (vide si inconnue). */
export function semantiquePour(entity: TargetEntity): string {
  return SEMANTIQUE_ENTITE[entity] ?? '';
}
