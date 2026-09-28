/**
 * Réglages → Étiquettes (étape 2 du plan étiquettes + champs, 2026-09-28).
 *
 * Une ligne par étiquette : couleur, nom, nombre de clients. On crée, on
 * recolore, on renomme (renommer vers un nom existant FUSIONNE les deux), on
 * supprime (retirée de tous les clients, aucun client supprimé). Renommer ou
 * supprimer ne déclenche aucune automatisation « Étiquette retirée » : ce
 * n'est pas un geste sur un client.
 */
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { confirmer } from '../../components/ui/ConfirmDialog';
import TagColorSwatches from '../../components/TagColorSwatches';
import { TAG_COLORS } from '../../lib/tagPalette';
import { captureClientException } from '../../lib/sentry';
import { useEtiquettes, PastilleEtiquette } from '../../components/etiquettes/SelecteurEtiquettes';
import {
  creerEtiquette, modifierEtiquette, supprimerEtiquette, COULEUR_ETIQUETTE_DEFAUT, type Etiquette,
} from '../../lib/etiquettesApi';

export default function EtiquettesSettings() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const ids = useId();
  const qc = useQueryClient();
  const { etiquettes, isLoading } = useEtiquettes();
  const [recherche, setRecherche] = useState('');
  const [nouveauNom, setNouveauNom] = useState('');
  const [nouvelleCouleur, setNouvelleCouleur] = useState(TAG_COLORS[10]);
  const [enEdition, setEnEdition] = useState<{ nom: string; texte: string } | null>(null);
  const [couleurOuverte, setCouleurOuverte] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return q ? etiquettes.filter((e) => e.nom.toLowerCase().includes(q)) : etiquettes;
  }, [etiquettes, recherche]);

  const rafraichir = () => qc.invalidateQueries({ queryKey: ['etiquettes'] });
  const echec = (err: unknown, contexte: string, repli: string) => {
    console.error(`[etiquettes] ${contexte}`, err);
    captureClientException(err, { contexte: `EtiquettesSettings.${contexte}` });
    toast.error(err instanceof Error && err.message ? err.message : repli);
  };

  const creer = async () => {
    const nom = nouveauNom.trim();
    if (!nom) return;
    setOccupe(true);
    try {
      const r = await creerEtiquette(nom, nouvelleCouleur);
      toast.success(r.existait
        ? (fr ? `« ${r.nom} » existait déjà.` : `“${r.nom}” already existed.`)
        : (fr ? `Étiquette « ${r.nom} » créée.` : `Tag “${r.nom}” created.`));
      setNouveauNom('');
      await rafraichir();
    } catch (err) {
      echec(err, 'creer', fr ? 'Impossible de créer l’étiquette.' : 'Could not create the tag.');
    } finally {
      setOccupe(false);
    }
  };

  const recolorer = async (e: Etiquette, couleur: string) => {
    setCouleurOuverte(null);
    try {
      await modifierEtiquette(e.nom, { couleur });
      await rafraichir();
    } catch (err) {
      echec(err, 'recolorer', fr ? 'Impossible de changer la couleur.' : 'Could not change the color.');
    }
  };

  const renommer = async () => {
    if (!enEdition) return;
    const { nom, texte } = enEdition;
    const nouveau = texte.trim();
    setEnEdition(null);
    if (!nouveau || nouveau === nom) return;
    const cible = etiquettes.find((x) => x.nom.toLowerCase() === nouveau.toLowerCase() && x.nom !== nom);
    if (cible) {
      const ok = await confirmer({
        title: fr ? 'Fusionner les étiquettes ?' : 'Merge tags?',
        message: fr
          ? `« ${cible.nom} » existe déjà. Les clients de « ${nom} » recevront « ${cible.nom} », et « ${nom} » disparaîtra.`
          : `“${cible.nom}” already exists. Clients tagged “${nom}” will get “${cible.nom}”, and “${nom}” will be removed.`,
        confirmLabel: fr ? 'Fusionner' : 'Merge',
      });
      if (!ok) return;
    }
    try {
      const r = await modifierEtiquette(nom, { nouveau_nom: cible?.nom ?? nouveau });
      toast.success(fr
        ? `« ${nom} » → « ${r.nom} » (${r.nb_clients ?? 0} client(s)).`
        : `“${nom}” → “${r.nom}” (${r.nb_clients ?? 0} client(s)).`);
      await rafraichir();
    } catch (err) {
      echec(err, 'renommer', fr ? 'Impossible de renommer l’étiquette.' : 'Could not rename the tag.');
    }
  };

  const supprimer = async (e: Etiquette) => {
    const ok = await confirmer({
      title: fr ? `Supprimer « ${e.nom} » ?` : `Delete “${e.nom}”?`,
      message: e.nb_clients > 0
        ? (fr ? `Elle sera retirée de ${e.nb_clients} client(s). Aucun client n’est supprimé.` : `It will be removed from ${e.nb_clients} client(s). No client is deleted.`)
        : (fr ? 'Aucun client ne la porte.' : 'No client has it.'),
      confirmLabel: fr ? 'Supprimer' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await supprimerEtiquette(e.nom);
      toast.success(fr ? `« ${e.nom} » supprimée (${r.retiree_de} client(s)).` : `“${e.nom}” deleted (${r.retiree_de} client(s)).`);
      await rafraichir();
    } catch (err) {
      echec(err, 'supprimer', fr ? 'Impossible de supprimer l’étiquette.' : 'Could not delete the tag.');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight text-text-primary">{fr ? 'Étiquettes' : 'Tags'}</h2>
        <p className="mt-0.5 text-[12px] text-text-tertiary">
          {fr
            ? 'Les étiquettes classent tes clients (VIP, Printemps 2026…). Elles s’affichent partout avec leur couleur et servent aux filtres et aux automatisations.'
            : 'Tags sort your clients (VIP, Spring 2026…). They show everywhere with their color and drive filters and automations.'}
        </p>
      </div>

      {/* ── Nouvelle étiquette ── */}
      <div className="rounded-xl border border-outline bg-surface-card p-4">
        <label htmlFor={`${ids}-nom`} className="text-[12.5px] font-semibold text-text-primary">{fr ? 'Nouvelle étiquette' : 'New tag'}</label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input id={`${ids}-nom`} value={nouveauNom} maxLength={60} onChange={(e) => setNouveauNom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void creer(); }}
            placeholder={fr ? 'Ex. : VIP' : 'E.g. VIP'} className="glass-input h-9 w-56 text-[13px]" />
          <TagColorSwatches value={nouvelleCouleur} onChange={setNouvelleCouleur} size="sm" />
          <button type="button" onClick={() => void creer()} disabled={occupe || !nouveauNom.trim()}
            className="glass-button-primary inline-flex items-center gap-1.5 disabled:opacity-50">
            <Plus size={14} aria-hidden="true" /> {fr ? 'Créer' : 'Create'}
          </button>
        </div>
      </div>

      {/* ── Liste ── */}
      <div className="rounded-xl border border-outline bg-surface-card">
        <div className="flex items-center gap-2 border-b border-outline px-4 py-2.5">
          <Search size={14} className="text-text-tertiary" aria-hidden="true" />
          <input aria-label={fr ? 'Chercher une étiquette' : 'Search tags'} value={recherche} onChange={(e) => setRecherche(e.target.value)}
            placeholder={fr ? 'Chercher…' : 'Search…'}
            className="h-7 flex-1 bg-transparent text-[13px] text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded" />
          <span className="text-[11.5px] tabular-nums text-text-tertiary">{etiquettes.length} {fr ? 'étiquette(s)' : 'tag(s)'}</span>
        </div>

        {isLoading ? (
          <p className="p-6 text-center text-[13px] text-text-tertiary">{fr ? 'Chargement…' : 'Loading…'}</p>
        ) : visibles.length === 0 ? (
          <div className="p-8 text-center">
            <Tag size={26} className="mx-auto mb-2 text-text-tertiary opacity-40" aria-hidden="true" />
            <p className="text-[13px] text-text-tertiary">
              {etiquettes.length === 0
                ? (fr ? 'Aucune étiquette pour l’instant. Crée la première ci-dessus.' : 'No tags yet. Create the first one above.')
                : (fr ? 'Aucune étiquette ne correspond.' : 'No tag matches.')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-outline/60">
            {visibles.map((e) => (
              <li key={e.nom} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="relative">
                  <button type="button" onClick={() => setCouleurOuverte(couleurOuverte === e.nom ? null : e.nom)}
                    aria-label={fr ? `Couleur de ${e.nom}` : `Color of ${e.nom}`} aria-expanded={couleurOuverte === e.nom}
                    className="block h-5 w-5 rounded-full border border-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    style={{ backgroundColor: e.couleur || COULEUR_ETIQUETTE_DEFAUT }} />
                  {couleurOuverte === e.nom && (
                    <div className="absolute left-0 top-7 z-20 w-64 rounded-xl border border-outline bg-surface-card p-3 shadow-lg">
                      <TagColorSwatches value={e.couleur || ''} onChange={(c) => void recolorer(e, c)} size="sm" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {enEdition?.nom === e.nom ? (
                    <input aria-label={fr ? `Nouveau nom pour ${e.nom}` : `New name for ${e.nom}`} autoFocus maxLength={60}
                      value={enEdition.texte} onChange={(ev) => setEnEdition({ nom: e.nom, texte: ev.target.value })}
                      onKeyDown={(ev) => {
                        // preventDefault : sans lui, la même touche Entrée « clique » le bouton
                        // Annuler de la fenêtre de fusion qui vient de prendre le focus.
                        if (ev.key === 'Enter') { ev.preventDefault(); void renommer(); }
                        if (ev.key === 'Escape') setEnEdition(null);
                      }}
                      onBlur={() => void renommer()} className="glass-input h-8 w-60 text-[13px]" />
                  ) : (
                    <PastilleEtiquette nom={e.nom} couleur={e.couleur || COULEUR_ETIQUETTE_DEFAUT} fr={fr} />
                  )}
                </div>
                <Link to={`/clients?etiquette=${encodeURIComponent(e.nom)}`}
                  className={cn('text-[12px] tabular-nums hover:underline', e.nb_clients ? 'text-text-secondary' : 'text-text-tertiary')}>
                  {e.nb_clients} {fr ? 'client(s)' : 'client(s)'}
                </Link>
                <button type="button" onClick={() => setEnEdition({ nom: e.nom, texte: e.nom })}
                  aria-label={fr ? `Renommer ${e.nom}` : `Rename ${e.nom}`}
                  className="rounded p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => void supprimer(e)}
                  aria-label={fr ? `Supprimer ${e.nom}` : `Delete ${e.nom}`}
                  className="rounded p-1 text-text-tertiary hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
