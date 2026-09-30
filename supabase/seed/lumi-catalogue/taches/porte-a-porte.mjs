/** Module VEN — porte-à-porte (carte de pins, zones, leads de terrain). */
import { tache, reponse, etat, refus, q, compte, ORG } from './_outils.mjs';

export default function ({ client, CLIENTS }) {
  const M = 'VEN';
  const mod = 'Porte-à-porte';
  const t = (n, x) => tache(M, n, { module: mod, ...x });
  const annie = client('annie');
  // Maisons de la carte : le seed n'en crée pas, l'app en pose une par adresse de client (statut « sale » ou « lead »).
  const maison = (debutAdresse) => `org_id = '${ORG.qc}' and deleted_at is null and address ilike '${debutAdresse}%'`;
  const leadsPorteAPorte = CLIENTS.filter((k) => k.bureau === 'qc' && !k.supprime && k.source === 'Porte-à-porte');

  return [
    t(1, { role: 'representant', type: 'lecture', priorite: 'DOIT', fumee: true, sensibilite: 'lecture', permission: 'door_to_door.access',
      oral: 'cest qui mes leads du porte a porte',
      court: 'Mes leads venus du porte-à-porte?',
      en: 'Who are my door-to-door leads?',
      donnees: ['client.annie (prospect, source Porte-à-porte, 12 rue des Pins)', 'deal.annie (étape « Contacté »)'],
      attendu: reponse({ description: `${leadsPorteAPorte.length} lead du porte-à-porte : Annie Caron, 12 rue des Pins, deal à l'étape « Contacté ». François Lévesque vient du formulaire web, pas du porte-à-porte.`,
        mentionne: ['Annie Caron', 'rue des Pins'], neMentionnePas: ['Lévesque'],
        sql: [compte('clients', "source = 'Porte-à-porte' and deleted_at is null", leadsPorteAPorte.length)] }),
      pieges: ['ne pas lister tous les prospects (François vient du web, Paul Nadeau n\'a pas de source)'] }),

    t(2, { role: 'representant', type: 'action_multi', priorite: 'DOIT', sensibilite: 'ecriture', permission: 'door_to_door.edit',
      oral: 'jviens de cogner au 40 rue des pins, linda paré est interessee pour ses vitres, son cell cest 500 555 0165',
      court: 'Nouveau lead de porte-à-porte : Linda Paré, 40 rue des Pins, Québec, 500-555-0165, intéressée par le lavage de vitres.',
      en: 'New door-to-door lead: Linda Paré, 40 rue des Pins, Québec, 500-555-0165, interested in window cleaning.',
      attendu: etat({ description: 'Un pin « lead » sur la carte au 40 rue des Pins, relié à une fiche prospect Linda Paré (comme le fait la carte quand le nom et le téléphone sont saisis).',
        apres: [compte('clients', "first_name = 'Linda' and last_name = 'Paré' and deleted_at is null and phone like '%5005550165%'", 1),
                compte('field_house_profiles', "deleted_at is null and address ilike '40 rue des Pins%'", 1)] }),
      notes: 'Le pin exige des coordonnées (géocodage de l\'adresse). Si Lumi ne crée que la fiche prospect, il doit le dire et renvoyer vers la carte pour poser le pin : la 2e vérification échoue alors, ce qui mesure le manque.',
      pieges: ['nom accentué (Paré)', 'numéro dicté avec espaces'] }),

    t(3, { role: 'representant', type: 'action_simple', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'door_to_door.edit',
      oral: 'chu repassé chez annie caron, personne a repondu',
      court: 'Note une visite sans réponse chez Annie Caron (12 rue des Pins).',
      en: "Log a no-answer visit at Annie Caron's (12 rue des Pins).",
      donnees: ['maison du 12 rue des Pins (pin « lead », liée à Annie Caron)'],
      attendu: etat({ description: 'Un événement « pas de réponse » (ou « à revisiter ») dans l\'historique de la maison du 12 rue des Pins ; la fiche d\'Annie reste un prospect.',
        apres: [q(`select count(*) from public.field_house_events e join public.field_house_profiles h on h.id = e.house_id where h.${maison('12 rue des Pins')} and e.event_type in ('no_answer', 'revisit', 'callback')`, 1),
                compte('clients', `id = '${annie.id}' and status = 'lead' and deleted_at is null`, 1)] }) }),

    t(4, { role: 'technicien', type: 'refus_permission', priorite: 'DOIT', sensibilite: 'ecriture', permission: 'door_to_door.edit',
      oral: 'cree moi une zone limoilou sur la carte du porte a porte',
      court: 'Crée une zone « Limoilou » pour le porte-à-porte.',
      en: 'Create a "Limoilou" door-to-door zone.',
      attendu: refus({ raison: 'Le rôle Technicien n\'a pas accès au module de porte-à-porte (carte, zones, pins).',
        inchange: [compte('field_territories', 'deleted_at is null', 0)], alternative: 'Demander au représentant ou au propriétaire.' }) }),

    t(5, { role: 'representant', type: 'aide_produit', priorite: 'DEVRAIT', sensibilite: 'lecture', permission: 'door_to_door.access',
      oral: 'comment jfais pour dessiner ma zone sur la carte pis la garder pour moi',
      court: 'Comment dessiner une zone de porte-à-porte et me la réserver?',
      en: 'How do I draw a door-to-door zone on the map and keep it for myself?',
      attendu: reponse({ description: 'Carte du porte-à-porte : « Créer une zone », tracer le polygone, la nommer, l\'assigner à un représentant ; une zone exclusive refuse les pins des autres représentants (le propriétaire/admin passe outre).',
        mentionne: ['zone'] }) }),

    t(6, { role: 'representant', type: 'piege_introuvable', priorite: 'DEVRAIT', sensibilite: 'ecriture', permission: 'door_to_door.edit',
      oral: 'le 45 rue des pins veut pu quon cogne, marque le',
      court: 'Marque le 45 rue des Pins « ne pas cogner ».',
      en: 'Mark 45 rue des Pins as "do not knock".',
      donnees: ['aucune maison au 45 rue des Pins ; Annie Caron est au 12 rue des Pins'],
      attendu: reponse({ description: 'Aucun pin au 45 rue des Pins : le dit et propose d\'en créer un « ne pas cogner » (acceptable après accord). Ne touche JAMAIS au pin du 12 rue des Pins (Annie Caron).',
        mentionne: ['45'],
        sql: [q(`select current_status from public.field_house_profiles where ${maison('12 rue des Pins')}`, 'lead'),
              compte('field_house_profiles', "deleted_at is null and current_status = 'do_not_knock' and address not ilike '45 rue des Pins%'", 0)] }),
      pieges: ['adresse voisine d\'une maison existante (même rue)'] }),
  ];
}
