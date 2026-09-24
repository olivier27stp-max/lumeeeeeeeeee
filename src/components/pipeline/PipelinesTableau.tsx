/**
 * La liste des pipelines, en tableau.
 *
 * Reprend la page « Pipelines » de GoHighLevel : numéro, nom, nombre
 * d'étapes, dernière modification, et un menu « ⋮ » par ligne.
 *
 * Le tableau REMPLACE la liste de cartes, mais renommer un pipeline et
 * régler qui le voit devaient survivre : ces deux gestes vivent maintenant
 * dans une ligne de détail qu'on déplie sous le pipeline choisi. Un tableau
 * qui ne montre que des nombres aurait été plus fidèle à la capture et
 * moins utile que ce qu'il remplaçait.
 *
 * Pagination à partir de vingt lignes seulement. Une PME de service en a
 * deux ou trois ; afficher « Page 1 sur 1 » sous une liste de deux pipelines
 * habille l'écran sans rien apprendre à personne.
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, MoreVertical, Star } from 'lucide-react';
import { toast } from 'sonner';
import { confirmer } from '../ui/ConfirmDialog';
import { useTranslation } from '../../i18n';
import { supprimerPipeline, type PipelineResume } from '../../lib/pipelineVentesApi';

const PAR_PAGE = 20;

export default function PipelinesTableau({
  pipelines, pipelineActif, onChangement, onOuvrir, onDefaut, detail,
}: {
  pipelines: PipelineResume[];
  pipelineActif: string | null;
  onChangement: () => void;
  /** Consulter ce pipeline dans le board. */
  onOuvrir: (pipelineId: string) => void;
  /** Le parent garde sa confirmation, plus précise que celle d'ici. */
  onDefaut: (pipelineId: string) => void;
  /** Renommage + partage, dépliés sous la ligne choisie. */
  detail: (pipeline: PipelineResume) => ReactNode;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idRecherche = useId();

  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);
  const [menuOuvert, setMenuOuvert] = useState<string | null>(null);
  const [deplie, setDeplie] = useState<string | null>(null);
  const zoneMenu = useRef<HTMLTableSectionElement>(null);

  /*
   * Un menu « ⋮ » ouvert restait ouvert : cliquer ailleurs, ouvrir celui
   * d'une autre ligne ou appuyer sur Échap ne le fermait pas. Sur une liste
   * de pipelines, on se retrouvait avec un menu flottant par-dessus la ligne
   * qu'on essayait de lire.
   */
  useEffect(() => {
    if (!menuOuvert) return;

    function auClic(e: MouseEvent) {
      // Un clic DANS le menu (ou sur le « ⋮ ») garde la main : c'est le
      // bouton lui-même qui bascule, sinon rouvrir fermerait aussitôt.
      if (zoneMenu.current?.contains(e.target as Node)) return;
      setMenuOuvert(null);
    }
    function auClavier(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOuvert(null);
    }

    document.addEventListener('mousedown', auClic);
    document.addEventListener('keydown', auClavier);
    return () => {
      document.removeEventListener('mousedown', auClic);
      document.removeEventListener('keydown', auClavier);
    };
  }, [menuOuvert]);

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return q ? pipelines.filter((p) => p.name.toLowerCase().includes(q)) : pipelines;
  }, [pipelines, recherche]);

  const pages = Math.max(1, Math.ceil(filtres.length / PAR_PAGE));
  const pageSure = Math.min(page, pages);
  const visibles = filtres.slice((pageSure - 1) * PAR_PAGE, pageSure * PAR_PAGE);

  function quand(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString(fr ? 'fr-CA' : 'en-CA', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async function supprimer(p: PipelineResume) {
    setMenuOuvert(null);
    // Supprimer un pipeline emporte ses deals (cascade). Le dire AVANT, pas
    // après : c'est irréversible, contrairement à une suppression de deal.
    const ok = await confirmer({
      title: fr ? `Supprimer « ${p.name} » ?` : `Delete “${p.name}”?`,
      message: fr
        ? 'Ses étapes ET ses deals seront supprimés. Cette action ne se défait pas.'
        : 'Its stages AND its deals will be deleted. This cannot be undone.',
      confirmLabel: fr ? 'Supprimer' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await supprimerPipeline(p.id);
      onChangement();
      toast.success(fr ? 'Pipeline supprimé.' : 'Pipeline deleted.');
    } catch (e) {
      console.error('[pipelines] suppression', e);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      {/* La recherche n'apparaît qu'à partir de quatre pipelines : en dessous
          on les voit tous, et un champ vide de plus n'aide personne. */}
      {pipelines.length > 3 && (
        <div className="mb-2.5 flex justify-end">
          <label htmlFor={idRecherche} className="sr-only">
            {fr ? 'Rechercher un pipeline' : 'Search a pipeline'}
          </label>
          <input
            id={idRecherche}
            type="search"
            value={recherche}
            onChange={(e) => { setRecherche(e.target.value); setPage(1); }}
            placeholder={fr ? 'Rechercher…' : 'Search…'}
            className="input-field w-full max-w-[240px] text-[12.5px]"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-outline">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-secondary">
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-tertiary">
              <th scope="col" className="px-3 py-2 font-semibold">#</th>
              <th scope="col" className="px-3 py-2 font-semibold">{fr ? 'Nom du pipeline' : 'Pipeline name'}</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">{fr ? 'Étapes' : 'Total stages'}</th>
              <th scope="col" className="px-3 py-2 font-semibold">{fr ? 'Modifié le' : 'Updated on'}</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                <span className="sr-only">{fr ? 'Actions' : 'Actions'}</span>
              </th>
            </tr>
          </thead>
          <tbody ref={zoneMenu} className="divide-y divide-border-subtle">
            {visibles.map((p, i) => (
              <Fragment key={p.id}>
                <tr className={p.id === pipelineActif ? 'bg-surface-secondary' : undefined}>
                  <td className="px-3 py-2.5 tabular-nums text-text-tertiary">
                    {(pageSure - 1) * PAR_PAGE + i + 1}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {/* Le chevron ouvre les réglages du pipeline ; le nom
                          va au board. Deux gestes, deux cibles distinctes. */}
                      <button
                        type="button"
                        onClick={() => setDeplie((d) => (d === p.id ? null : p.id))}
                        aria-expanded={deplie === p.id}
                        aria-label={
                          fr ? `Réglages de ${p.name}` : `Settings for ${p.name}`
                        }
                        className="rounded p-0.5 text-text-muted hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                      >
                        <ChevronDown
                          size={13}
                          aria-hidden="true"
                          className={`transition-transform ${deplie === p.id ? 'rotate-180' : ''}`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => onOuvrir(p.id)}
                        className="rounded text-left text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                      >
                        {p.name}
                      </button>

                      {p.is_default && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-primary">
                          <Star size={9} aria-hidden="true" />
                          {fr ? 'Par défaut' : 'Default'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                    {p.nb_etapes ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-text-tertiary">
                    {quand(p.updated_at)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="relative inline-block">
                      <button
                        type="button"
                        onClick={() => setMenuOuvert((m) => (m === p.id ? null : p.id))}
                        aria-label={fr ? `Actions pour ${p.name}` : `Actions for ${p.name}`}
                        aria-expanded={menuOuvert === p.id}
                        aria-haspopup="menu"
                        className="rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                      >
                        <MoreVertical size={14} aria-hidden="true" />
                      </button>

                      {menuOuvert === p.id && (
                        <div
                          role="menu"
                          className="absolute right-0 z-20 mt-1 w-[210px] overflow-hidden rounded-xl border border-outline-strong bg-surface-elevated py-1 text-left shadow-lg"
                        >
                          <button
                            type="button" role="menuitem"
                            onClick={() => { setMenuOuvert(null); onOuvrir(p.id); }}
                            className="block w-full px-3 py-2 text-left text-[12.5px] text-text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary"
                          >
                            {fr ? 'Voir le board' : 'View board'}
                          </button>

                          <button
                            type="button" role="menuitem"
                            onClick={() => { setMenuOuvert(null); setDeplie(p.id); }}
                            className="block w-full px-3 py-2 text-left text-[12.5px] text-text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary"
                          >
                            {fr ? 'Renommer et partager' : 'Rename and share'}
                          </button>

                          {!p.is_default && (
                            <button
                              type="button" role="menuitem"
                              onClick={() => { setMenuOuvert(null); onDefaut(p.id); }}
                              className="block w-full px-3 py-2 text-left text-[12.5px] text-text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary"
                            >
                              {fr ? 'Définir par défaut' : 'Set as default'}
                            </button>
                          )}

                          {/*
                            Le pipeline par défaut ne se supprime pas : les
                            nouveaux leads y atterrissent, et sans lui ils
                            n'auraient nulle part où aller.
                          */}
                          {!p.is_default && (
                            <button
                              type="button" role="menuitem"
                              onClick={() => { void supprimer(p); }}
                              className="block w-full px-3 py-2 text-left text-[12.5px] hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary"
                              style={{ color: 'var(--color-danger)' }}
                            >
                              {fr ? 'Supprimer' : 'Delete'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>

                {deplie === p.id && (
                  <tr>
                    <td colSpan={5} className="bg-surface-secondary px-3 py-3">
                      {detail(p)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}

            {visibles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[12px] text-text-muted">
                  {recherche
                    ? (fr ? 'Aucun pipeline ne correspond.' : 'No pipeline matches.')
                    : (fr ? 'Aucun pipeline.' : 'No pipeline.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* La pagination n'apparaît que si elle sert : « Page 1 sur 1 » sous
          deux lignes habille l'écran sans rien apprendre. */}
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-[12px]">
          <button
            type="button"
            onClick={() => setPage((n) => Math.max(1, n - 1))}
            disabled={pageSure === 1}
            className="btn-secondary text-[12px] disabled:opacity-40"
          >
            {fr ? 'Précédent' : 'Previous'}
          </button>
          <span className="tabular-nums text-text-tertiary">
            {fr ? `Page ${pageSure} sur ${pages}` : `Page ${pageSure} of ${pages}`}
          </span>
          <button
            type="button"
            onClick={() => setPage((n) => Math.min(pages, n + 1))}
            disabled={pageSure === pages}
            className="btn-secondary text-[12px] disabled:opacity-40"
          >
            {fr ? 'Suivant' : 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}
