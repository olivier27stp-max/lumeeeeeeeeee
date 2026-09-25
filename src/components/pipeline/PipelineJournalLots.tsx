/**
 * Le journal des actions en lot et des imports.
 *
 * POURQUOI CET ÉCRAN EXISTE. Une action en lot touche des dizaines de deals
 * d'un coup. Sans trace, personne ne peut répondre à « qui a supprimé ces
 * 40 deals mardi ? », et surtout personne ne peut annuler l'erreur. C'est ce
 * journal qui rend le geste réversible, donc utilisable sans peur.
 *
 * CE QUI SE RESTAURE, ET CE QUI NE SE RESTAURE PAS. Les suppressions, oui :
 * les deals partent en suppression douce et le journal garde leurs
 * identifiants. Les modifications en lot, non — il aurait fallu garder
 * l'ancienne valeur de chaque ligne, et un retour partiel qui échoue à
 * mi-chemin laisserait un état pire que le précédent. Le menu ne propose
 * donc « Restaurer » que là où c'est vrai.
 */
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { confirmer } from '../ui/ConfirmDialog';
import { useTranslation } from '../../i18n';
import {
  fetchJournalLots, restaurerLot,
  type LigneJournalLot, type OperationLot, type StatutLot,
} from '../../lib/pipelineVentesApi';

/** Le premier jour d'il y a six mois, en AAAA-MM-JJ. */
function ilYaSixMois(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Le résultat d'une action en lot, d'un coup d'œil.
 *
 * « 38/40 » se lit, mais ne se COMPARE pas : dans une liste de vingt lignes,
 * l'œil ne repère pas celle qui a à moitié échoué. La barre le montre, le
 * texte reste pour le chiffre exact et pour la lecture d'écran.
 *
 * Un lot à zéro deal (filtre qui ne ramène rien) n'affiche pas de barre : une
 * barre vide ressemble à un échec, alors qu'il n'y avait rien à faire.
 */
function StatistiquesLot({ reussis, echoues, total, fr }: {
  reussis: number;
  echoues: number;
  total: number;
  fr: boolean;
}) {
  const base = Math.max(total, reussis + echoues);
  const partOk = base > 0 ? (reussis / base) * 100 : 0;
  const partKo = base > 0 ? (echoues / base) * 100 : 0;

  return (
    <div className="min-w-[110px]">
      {base > 0 && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-tertiary" aria-hidden="true">
          {partOk > 0 && <div style={{ width: `${partOk}%`, background: 'var(--color-success)' }} />}
          {partKo > 0 && <div style={{ width: `${partKo}%`, background: 'var(--color-danger)' }} />}
        </div>
      )}
      <p className="mt-1 text-[11.5px] tabular-nums text-text-secondary">
        {reussis}/{total}
        {echoues > 0 && (
          <span className="ml-1 font-semibold" style={{ color: 'var(--color-danger)' }}>
            · {echoues} {fr ? 'en échec' : 'failed'}
          </span>
        )}
      </p>
    </div>
  );
}

export default function PipelineJournalLots() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idDu = useId();
  const idAu = useId();
  const idStatut = useId();
  const idOperation = useId();

  const [du, setDu] = useState(ilYaSixMois());
  const [au, setAu] = useState(aujourdhui());
  const [statut, setStatut] = useState<StatutLot | ''>('');
  const [operation, setOperation] = useState<OperationLot | ''>('');

  /**
   * L'utilisateur a-t-il RESTREINT la recherche ?
   *
   * La période part à six mois : un journal vide sur cette plage veut dire
   * « rien n'a jamais été fait », pas « rien sur la période choisie ». Les
   * deux méritent un message différent — le premier explique à quoi sert
   * l'écran, le second invite à élargir.
   */
  const aDesFiltres = du !== ilYaSixMois() || au !== aujourdhui()
    || statut !== '' || operation !== '';
  const [menuOuvert, setMenuOuvert] = useState<string | null>(null);
  const [detail, setDetail] = useState<LigneJournalLot | null>(null);

  const { data: lignes = [], isLoading, refetch } = useQuery({
    queryKey: ['pipeline-journal-lots', du, au, statut, operation],
    queryFn: () => fetchJournalLots({ du, au, statut, operation }),
    staleTime: 30_000,
  });

  const LIBELLE_OPERATION: Record<OperationLot, string> = {
    suppression: fr ? 'Suppression' : 'Delete',
    modification: fr ? 'Modification' : 'Edit',
    import: fr ? 'Import' : 'Import',
  };

  const LIBELLE_STATUT: Record<StatutLot, string> = {
    en_cours: fr ? 'En cours' : 'In progress',
    termine: fr ? 'Terminé' : 'Complete',
    partiel: fr ? 'Partiel' : 'Partial',
    echoue: fr ? 'Échoué' : 'Failed',
  };

  const TEINTE_STATUT: Record<StatutLot, string> = {
    en_cours: 'var(--color-info)',
    termine: 'var(--color-success)',
    partiel: 'var(--color-warning)',
    echoue: 'var(--color-danger)',
  };

  function quand(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString(fr ? 'fr-CA' : 'en-CA', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async function restaurer(l: LigneJournalLot) {
    setMenuOuvert(null);
    const ok = await confirmer({
      title: fr ? 'Restaurer ces deals ?' : 'Restore these deals?',
      message: fr
        ? `Les ${l.total} deal(s) supprimés par cette action reviendront dans le pipeline.`
        : `The ${l.total} deal(s) deleted by this action will return to the pipeline.`,
      confirmLabel: fr ? 'Restaurer' : 'Restore',
    });
    if (!ok) return;
    try {
      const n = await restaurerLot(l.id);
      await refetch();
      // Le nombre RÉELLEMENT rendu, pas celui qu'on espérait : certains deals
      // ont pu être re-supprimés depuis, et annoncer 40 alors que 37 sont
      // revenus serait un mensonge qu'on découvre en comptant les cartes.
      toast.success(fr ? `${n} deal(s) restauré(s).` : `${n} deal(s) restored.`);
    } catch (e) {
      console.error('[journal] restauration', e);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <p className="text-[12.5px] text-text-secondary">
        {fr
          ? "Suivi des actions en lot et des imports : qui, quoi, combien, et quand."
          : 'Track bulk actions and imports: who, what, how many, and when.'}
      </p>

      {/*
        Les filtres ne s'affichent QUE s'il y a quelque chose à filtrer.
        Cinq champs au-dessus d'un écran vide donnent l'impression qu'on a
        mal cherché, alors qu'il n'y a simplement rien eu.
      */}
      {(lignes.length > 0 || aDesFiltres) && (
      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-outline bg-surface-secondary p-3.5">
        <div>
          <label htmlFor={idDu} className="mb-1 block text-[11px] text-text-tertiary">
            {fr ? 'Du' : 'From'}
          </label>
          <input
            id={idDu} type="date" value={du}
            onChange={(e) => setDu(e.target.value)}
            className="input-field text-[12.5px]"
          />
        </div>
        <div>
          <label htmlFor={idAu} className="mb-1 block text-[11px] text-text-tertiary">
            {fr ? 'Au' : 'To'}
          </label>
          <input
            id={idAu} type="date" value={au}
            onChange={(e) => setAu(e.target.value)}
            className="input-field text-[12.5px]"
          />
        </div>
        <div>
          <label htmlFor={idStatut} className="mb-1 block text-[11px] text-text-tertiary">
            {fr ? 'Statut' : 'Status'}
          </label>
          <select
            id={idStatut} value={statut}
            onChange={(e) => setStatut(e.target.value as StatutLot | '')}
            className="input-field max-w-[160px] text-[12.5px]"
          >
            <option value="">{fr ? 'Tous les statuts' : 'All statuses'}</option>
            <option value="termine">{LIBELLE_STATUT.termine}</option>
            <option value="partiel">{LIBELLE_STATUT.partiel}</option>
            <option value="echoue">{LIBELLE_STATUT.echoue}</option>
            <option value="en_cours">{LIBELLE_STATUT.en_cours}</option>
          </select>
        </div>
        <div>
          <label htmlFor={idOperation} className="mb-1 block text-[11px] text-text-tertiary">
            {fr ? 'Action' : 'Action'}
          </label>
          <select
            id={idOperation} value={operation}
            onChange={(e) => setOperation(e.target.value as OperationLot | '')}
            className="input-field max-w-[160px] text-[12.5px]"
          >
            <option value="">{fr ? 'Toutes les actions' : 'All actions'}</option>
            <option value="suppression">{LIBELLE_OPERATION.suppression}</option>
            <option value="modification">{LIBELLE_OPERATION.modification}</option>
            <option value="import">{LIBELLE_OPERATION.import}</option>
          </select>
        </div>
      </div>
      )}

      {isLoading && (
        <p className="mt-4 text-[12px] text-text-muted" role="status">
          {fr ? 'Chargement…' : 'Loading…'}
        </p>
      )}

      {!isLoading && lignes.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-outline px-5 py-8">
          <p className="text-center text-[13px] font-medium text-text-primary">
            {aDesFiltres
              ? (fr ? 'Aucune action sur cette période.' : 'No action in this period.')
              : (fr ? 'Aucune action en lot pour le moment.' : 'No bulk action yet.')}
          </p>

          {/*
            Un écran vide qui se contente de dire « rien » laisse croire que la
            page est cassée. Celui-ci explique À QUOI ça sert et COMMENT en
            produire une — c'est la seule chose utile à montrer quand il n'y a
            rien à lister.
          */}
          {!aDesFiltres && (
            <div className="mx-auto mt-3 max-w-md space-y-2 text-[12px] leading-relaxed text-text-secondary">
              <p>
                {fr
                  ? 'Sur le board, coche plusieurs deals : tu peux alors les assigner ou les déplacer d\'un seul geste. Chaque action de ce genre est consignée ici.'
                  : 'On the board, tick several deals: you can then assign or move them in one go. Every such action is logged here.'}
              </p>
              <p>
                {fr
                  ? 'C\'est ce qui rend une suppression en lot réversible — sans ce journal, cocher quarante deals et supprimer serait définitif.'
                  : 'This is what makes a bulk delete reversible — without this log, ticking forty deals and deleting would be final.'}
              </p>
              <p className="text-text-muted">
                {fr
                  ? 'Les imports CSV y apparaissent aussi, avec les lignes qui ont échoué.'
                  : 'CSV imports show up here too, with the rows that failed.'}
              </p>
            </div>
          )}

          {aDesFiltres && (
            <p className="mt-2 text-center text-[11.5px] text-text-muted">
              {fr
                ? 'Élargis la période ou retire les filtres pour voir plus loin.'
                : 'Widen the period or clear the filters to look further back.'}
            </p>
          )}
        </div>
      )}

      {lignes.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-tertiary">
                <th scope="col" className="py-2 pr-3 font-semibold">{fr ? 'Action' : 'Action label'}</th>
                <th scope="col" className="py-2 px-2 font-semibold">{fr ? 'Opération' : 'Operation'}</th>
                <th scope="col" className="py-2 px-2 font-semibold">{fr ? 'Statut' : 'Status'}</th>
                <th scope="col" className="py-2 px-2 font-semibold">{fr ? 'Par' : 'User'}</th>
                <th scope="col" className="py-2 px-2 font-semibold">
                  <span className="inline-flex items-center gap-1.5">
                    <BarChart3 size={12} aria-hidden="true" />
                    {fr ? 'Statistiques' : 'Statistics'}
                  </span>
                </th>
                <th scope="col" className="py-2 px-2 font-semibold">{fr ? 'Lancée' : 'Started'}</th>
                <th scope="col" className="py-2 pl-2 font-semibold">
                  <span className="sr-only">{fr ? 'Actions' : 'Actions'}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3 text-text-primary">{l.libelle}</td>
                  <td className="py-2 px-2 text-text-secondary">{LIBELLE_OPERATION[l.operation]}</td>
                  <td className="py-2 px-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                      style={{
                        color: TEINTE_STATUT[l.statut],
                        background: `color-mix(in srgb, ${TEINTE_STATUT[l.statut]} 13%, transparent)`,
                      }}
                    >
                      {LIBELLE_STATUT[l.statut]}
                    </span>
                    {l.restaure_le && (
                      <span className="ml-1.5 text-[10.5px] text-text-muted">
                        {fr ? 'restauré' : 'restored'}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-text-secondary">{l.user_nom ?? '—'}</td>
                  <td className="py-2 px-2">
                    <StatistiquesLot
                      reussis={l.reussis} echoues={l.echoues} total={l.total} fr={fr}
                    />
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap tabular-nums text-text-tertiary">
                    {quand(l.created_at)}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <div className="relative inline-block">
                      <button
                        type="button"
                        onClick={() => setMenuOuvert((m) => (m === l.id ? null : l.id))}
                        aria-label={fr ? `Actions pour ${l.libelle}` : `Actions for ${l.libelle}`}
                        aria-expanded={menuOuvert === l.id}
                        aria-haspopup="menu"
                        className="rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
                      >
                        <MoreVertical size={14} aria-hidden="true" />
                      </button>

                      {menuOuvert === l.id && (
                        <div
                          role="menu"
                          className="absolute right-0 z-20 mt-1 w-[210px] overflow-hidden rounded-xl border border-outline-strong bg-surface-elevated py-1 text-left shadow-lg"
                        >
                          <button
                            type="button" role="menuitem"
                            onClick={() => { setDetail(l); setMenuOuvert(null); }}
                            className="block w-full px-3 py-2 text-left text-[12.5px] text-text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary"
                          >
                            {fr ? 'Voir le détail' : 'View details'}
                          </button>

                          {/*
                            « Restaurer » seulement sur une suppression non
                            encore restaurée. Le proposer ailleurs serait
                            promettre un retour en arrière qui n'existe pas :
                            une modification en lot n'a pas gardé les
                            anciennes valeurs.
                          */}
                          {l.operation === 'suppression' && !l.restaure_le && (
                            <button
                              type="button" role="menuitem"
                              onClick={() => { void restaurer(l); }}
                              className="block w-full px-3 py-2 text-left text-[12.5px] text-text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary"
                            >
                              {fr ? 'Restaurer les deals' : 'Restore deals'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Le détail : ce que le tableau ne peut pas montrer — les erreurs. */}
      {detail && (
        <div className="mt-4 rounded-xl border border-outline bg-surface-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-text-primary">{detail.libelle}</h3>
              <p className="mt-0.5 text-[11.5px] text-text-tertiary">
                {LIBELLE_OPERATION[detail.operation]} · {LIBELLE_STATUT[detail.statut]} ·{' '}
                {detail.reussis}/{detail.total} {fr ? 'réussis' : 'succeeded'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="text-[12px] text-text-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary rounded"
            >
              {fr ? 'Fermer' : 'Close'}
            </button>
          </div>

          {detail.erreurs.length === 0 ? (
            <p className="mt-2 text-[12px] text-text-muted">
              {fr ? 'Aucune erreur.' : 'No error.'}
            </p>
          ) : (
            <ul className="mt-2 space-y-0.5">
              {detail.erreurs.slice(0, 50).map((e, i) => (
                <li key={i} className="text-[11.5px] text-text-secondary">• {e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
