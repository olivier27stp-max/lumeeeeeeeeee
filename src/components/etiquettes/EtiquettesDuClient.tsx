/**
 * Les étiquettes d'UN client, modifiables sur place — en-tête de la fiche du
 * deal (étape 3 du plan étiquettes + champs). Les étiquettes vivent sur le
 * client (D1) : les poser ici les pose sur sa fiche, et chaque ajout annonce
 * « Étiquette ajoutée » au moteur d'automatisations (poserEtiquette).
 *
 * Lit la même requête groupée que les cartes du board ; après une écriture,
 * on invalide le préfixe pour que les cartes suivent.
 */
import { useQueryClient } from '@tanstack/react-query';
import { poserEtiquette, retirerEtiquette } from '../../lib/etiquettesApi';
import { hasPermission } from '../../lib/permissions';
import { usePermissions } from '../../hooks/usePermissions';
import SelecteurEtiquettes, { CLE_ETIQUETTES_CLIENTS, useEtiquettesDesClients } from './SelecteurEtiquettes';

export default function EtiquettesDuClient({ clientId, fr }: { clientId: string; fr: boolean }) {
  const qc = useQueryClient();
  const { permissions, role } = usePermissions();
  // Poser une étiquette modifie la fiche du CLIENT : le droit est « clients.update ».
  const lectureSeule = !hasPermission(permissions, 'clients.update', role ?? undefined);
  const { parClient, isLoading } = useEtiquettesDesClients([clientId]);
  const valeurs = parClient[clientId] ?? [];

  const rafraichir = async () => {
    await qc.invalidateQueries({ queryKey: [CLE_ETIQUETTES_CLIENTS] });
    // Le nombre de clients par étiquette (Réglages → Étiquettes) bouge aussi.
    void qc.invalidateQueries({ queryKey: ['etiquettes'] });
  };

  if (isLoading) return null;
  if (lectureSeule && valeurs.length === 0) return null;
  return (
    <div className="mt-2" data-testid="etiquettes-client-deal">
      <SelecteurEtiquettes
        valeurs={valeurs}
        fr={fr}
        lectureSeule={lectureSeule}
        onAjouter={async (tag) => { await poserEtiquette(clientId, tag); await rafraichir(); }}
        onRetirer={async (tag) => { await retirerEtiquette(clientId, tag); await rafraichir(); }}
      />
    </div>
  );
}
