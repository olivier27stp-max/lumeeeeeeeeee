/**
 * Le formulaire d'un deal, calqué sur « Add new opportunity » de GoHighLevel
 * (captures de Rafba, 2026-09-29) : à gauche « Détails du deal » et « Gérer les
 * champs » en bas ; à droite « Coordonnées du contact » puis « Détails du deal »
 * sur deux colonnes (Pipeline · Étape, Statut · Valeur, Responsable · Entreprise,
 * Source · Fermeture prévue, Étiquettes).
 *
 * Le même formulaire sert à la CRÉATION (« Nouveau deal », PipelineBoard) et à la
 * 1re page de la FICHE d'un deal (DetailsDealEdition, plus bas) — décision de
 * Rafba : « quand tu cliques sur le client dans le pipeline, la première page que
 * tu vois, c'est la page du nouveau deal ». Pas de nom de deal ni d'abonnés
 * (décisions de Rafba) : le deal reste identifié par son client.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  abandonnerDeal, deplacerDeal, fetchRaisonsProposees, majContactDuDeal, majDateFermeture, majSourceDuDeal,
  marquerPerdu, nomClient, type Deal, type PipelineStage,
} from '../../lib/pipelineVentesApi';
import { poserEtiquette, retirerEtiquette } from '../../lib/etiquettesApi';
import { captureClientException } from '../../lib/sentry';
import SelecteurEtiquettes, { CLE_ETIQUETTES_CLIENTS, useEtiquettesDesClients } from '../etiquettes/SelecteurEtiquettes';

export const CLASSE_SAISIE = 'h-10 w-full rounded-lg border border-outline bg-surface px-3 text-[14px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60';
const CLASSE_ETIQUETTE = 'mb-1.5 block text-[13px] font-medium text-text-primary';

export type StatutDeal = 'ouvert' | 'gagne' | 'perdu' | 'abandonne';
export const OPTIONS_STATUT: { cle: StatutDeal; fr: string; en: string }[] = [
  { cle: 'ouvert', fr: 'Ouvert', en: 'Open' },
  { cle: 'gagne', fr: 'Gagné', en: 'Won' },
  { cle: 'perdu', fr: 'Perdu', en: 'Lost' },
  { cle: 'abandonne', fr: 'Abandonné', en: 'Abandoned' },
];
export const OPTIONS_SOURCE: { cle: string; fr: string; en: string }[] = [
  { cle: 'manual', fr: 'Saisie manuelle', en: 'Manual entry' },
  { cle: 'form_web', fr: 'Formulaire web', en: 'Web form' },
  { cle: 'meta', fr: 'Meta', en: 'Meta' },
  { cle: 'd2d', fr: 'Porte-à-porte', en: 'Door to door' },
];

/** Cadre GHL : navigation à gauche (« Détails du deal », « Gérer les champs » en bas), contenu à droite. */
export function CadreGhl({ fr, children, onGererChamps, pied, sansNav }: {
  fr: boolean;
  children: ReactNode;
  onGererChamps?: () => void;
  pied?: ReactNode;
  /** Dans la fiche du deal, ses propres onglets font déjà la navigation. */
  sansNav?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
        {!sansNav && <nav aria-label={fr ? 'Sections' : 'Sections'} className="flex shrink-0 flex-col justify-between sm:w-[190px] sm:border-r sm:border-outline sm:pr-3">
          <span className="rounded-md bg-primary/10 px-3 py-2 text-[13px] font-semibold text-primary">
            {fr ? 'Détails du deal' : 'Deal details'}
          </span>
          {onGererChamps && (
            <button type="button" onClick={onGererChamps}
              className="mt-3 inline-flex items-center gap-1.5 px-1 py-2 text-[13px] font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <Settings2 size={14} aria-hidden /> {fr ? 'Gérer les champs' : 'Manage fields'}
            </button>
          )}
        </nav>}
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
      {pied && <div className="mt-5 flex items-center justify-end gap-2.5 border-t border-outline pt-4">{pied}</div>}
    </div>
  );
}

export function SectionGhl({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-4 border-b border-outline pb-3 text-[16px] font-semibold text-text-primary">{titre}</h3>
      <div className="grid grid-cols-1 gap-x-3 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function ChampGhl({ id, libelle, requis, pleine, children }: {
  id?: string; libelle: string; requis?: boolean; pleine?: boolean; children: ReactNode;
}) {
  return (
    <div className={cn('min-w-0', pleine && 'sm:col-span-2')}>
      {id ? (
        <label htmlFor={id} className={CLASSE_ETIQUETTE}>{libelle}{requis && <span className="text-red-500" aria-hidden> *</span>}</label>
      ) : (
        <span className={CLASSE_ETIQUETTE}>{libelle}{requis && <span className="text-red-500" aria-hidden> *</span>}</span>
      )}
      {children}
    </div>
  );
}

/** Statut affiché d'un deal, déduit de son étape (gagné / perdu) ; abandonné = perdu sans décision du client. */
export function statutDuDeal(deal: Deal, etapes: PipelineStage[]): StatutDeal {
  const kind = etapes.find((e) => e.id === deal.stage_id)?.kind;
  return kind === 'won' ? 'gagne' : kind === 'lost' ? 'perdu' : 'ouvert';
}

/** Raison de perte / d'abandon : les motifs de l'entreprise, ou un texte libre. */
export function ChampRaison({ id, valeur, onChange, fr, requise }: {
  id: string; valeur: string; onChange: (v: string) => void; fr: boolean; requise: boolean;
}) {
  const { data: raisons = [] } = useQuery({ queryKey: ['pipeline-raisons-proposees'], queryFn: fetchRaisonsProposees, staleTime: 600_000 });
  return (
    <ChampGhl id={id} libelle={requise ? (fr ? 'Raison de la perte' : 'Lost reason') : (fr ? 'Pourquoi abandonner ? (facultatif)' : 'Why abandon it? (optional)')} requis={requise} pleine>
      <input id={id} list={`${id}-liste`} value={valeur} onChange={(e) => onChange(e.target.value)} maxLength={200}
        placeholder={fr ? 'Choisis ou écris une raison' : 'Pick or type a reason'} className={CLASSE_SAISIE} />
      <datalist id={`${id}-liste`}>
        {raisons.map((r) => <option key={r.id} value={r.libelle} />)}
      </datalist>
    </ChampGhl>
  );
}

/**
 * 1re page de la fiche d'un deal : le même formulaire que « Nouveau deal »,
 * rempli et modifiable, avec « Enregistrer ». Les étiquettes (sur le client) et
 * les champs personnalisés s'enregistrent tout de suite, comme ailleurs.
 */
export function DetailsDealEdition({ deal, etapes, membres, montantCents, nomPipeline, fr, lectureSeule, onAssigner, onCreerJob, onChangement, champsPerso, onGererChamps }: {
  deal: Deal;
  nomPipeline?: string;
  etapes: PipelineStage[];
  membres: { id: string; name: string }[];
  montantCents?: number | null;
  fr: boolean;
  lectureSeule: boolean;
  onAssigner: (dealId: string, membreId: string | null) => void;
  onCreerJob: (deal: Deal, versEtapeId?: string) => void;
  onChangement?: () => void;
  /** Les champs personnalisés du deal (panneau de la fiche), placés sous les détails. */
  champsPerso: ReactNode;
  onGererChamps?: () => void;
}) {
  const ids = useId();
  const qc = useQueryClient();
  const ouvertes = useMemo(() => etapes.filter((e) => e.kind === 'open' && !e.archived_at).sort((a, b) => a.position - b.position), [etapes]);
  const initial = useMemo(() => ({
    courriel: deal.client?.email ?? '',
    telephone: deal.client?.phone ?? '',
    entreprise: deal.client?.company ?? '',
    etape: deal.stage_id,
    statut: statutDuDeal(deal, etapes),
    responsable: deal.assigned_user_id ?? '',
    source: deal.source ?? 'manual',
    fermeture: deal.expected_close_date ?? '',
  }), [deal, etapes]);
  const [v, setV] = useState(initial);
  const [raison, setRaison] = useState('');
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { setV(initial); setRaison(''); }, [initial]);
  const poser = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const modifie = JSON.stringify(v) !== JSON.stringify(initial);
  const changeStatut = v.statut !== initial.statut;

  const { parClient } = useEtiquettesDesClients(deal.client_id ? [deal.client_id] : []);
  const etiquettes = deal.client_id ? parClient[deal.client_id] ?? [] : [];
  const rafraichirEtiquettes = async () => {
    await qc.invalidateQueries({ queryKey: [CLE_ETIQUETTES_CLIENTS] });
    void qc.invalidateQueries({ queryKey: ['etiquettes'] });
  };

  const enregistrer = async () => {
    if (changeStatut && v.statut === 'perdu' && !raison.trim()) {
      toast.error(fr ? 'Indique la raison de la perte.' : 'Enter the lost reason.');
      return;
    }
    setEnvoi(true);
    try {
      const contact: Record<string, string | null> = {};
      if (v.courriel !== initial.courriel) contact.email = v.courriel.trim() || null;
      if (v.telephone !== initial.telephone) contact.phone = v.telephone.trim() || null;
      if (v.entreprise !== initial.entreprise) contact.company = v.entreprise.trim() || null;
      if (deal.client_id && Object.keys(contact).length) await majContactDuDeal(deal.client_id, contact);
      if (v.source !== initial.source) await majSourceDuDeal(deal.id, v.source);
      if (v.fermeture !== initial.fermeture) await majDateFermeture(deal.id, v.fermeture || null);
      if (v.responsable !== initial.responsable) onAssigner(deal.id, v.responsable || null);

      if (changeStatut) {
        const gagnee = etapes.find((e) => e.kind === 'won' && !e.archived_at);
        const perdue = etapes.find((e) => e.kind === 'lost' && !e.archived_at);
        if (v.statut === 'gagne' && gagnee) {
          // Gagné : la création de la job s'ouvre, comme en glissant vers « Gagné ».
          onCreerJob(deal, gagnee.id);
        } else if (v.statut === 'perdu' && perdue) {
          await marquerPerdu(deal.id, perdue.id, raison.trim());
        } else if (v.statut === 'abandonne') {
          await abandonnerDeal(deal.id, raison);
        } else if (v.statut === 'ouvert') {
          await deplacerDeal(deal.id, v.etape !== initial.etape ? v.etape : (ouvertes[0]?.id ?? v.etape));
        }
      } else if (v.etape !== initial.etape) {
        await deplacerDeal(deal.id, v.etape);
      }
      toast.success(fr ? 'Deal enregistré.' : 'Deal saved.');
      onChangement?.();
    } catch (err) {
      console.error('[DetailsDealEdition] enregistrement', err);
      captureClientException(err, { contexte: 'DetailsDealEdition.enregistrer' });
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvoi(false);
    }
  };

  const nom = nomClient(deal);
  return (
    <CadreGhl fr={fr} onGererChamps={onGererChamps} sansNav
      pied={lectureSeule ? undefined : (
        <>
          <button type="button" onClick={() => { setV(initial); setRaison(''); }} disabled={!modifie || envoi} className="btn-secondary text-[13px] disabled:opacity-50">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button type="button" onClick={() => { void enregistrer(); }} disabled={!modifie || envoi} className="btn-primary text-[13px] disabled:opacity-50">
            {envoi ? (fr ? 'Enregistrement…' : 'Saving…') : (fr ? 'Enregistrer' : 'Save')}
          </button>
        </>
      )}>
      <SectionGhl titre={fr ? 'Coordonnées du contact' : 'Contact details'}>
        <ChampGhl libelle={fr ? 'Contact principal' : 'Primary contact'} requis>
          <div className={cn(CLASSE_SAISIE, 'flex items-center justify-between gap-2')}>
            <span className="truncate font-medium">{nom || '—'}</span>
            {deal.client_id && <Link to={`/clients/${deal.client_id}`} className="shrink-0 text-[12px] text-primary hover:underline">{fr ? 'Fiche' : 'Record'}</Link>}
          </div>
        </ChampGhl>
        <ChampGhl id={`${ids}-courriel`} libelle={fr ? 'Courriel principal' : 'Primary email'}>
          <input id={`${ids}-courriel`} type="email" value={v.courriel} disabled={lectureSeule} onChange={(e) => poser({ courriel: e.target.value })}
            placeholder={fr ? 'Entrer un courriel' : 'Enter email'} className={CLASSE_SAISIE} />
        </ChampGhl>
        <ChampGhl id={`${ids}-tel`} libelle={fr ? 'Téléphone principal' : 'Primary phone'}>
          <input id={`${ids}-tel`} type="tel" value={v.telephone} disabled={lectureSeule} onChange={(e) => poser({ telephone: e.target.value })}
            placeholder={fr ? 'Entrer un téléphone' : 'Enter phone'} className={CLASSE_SAISIE} />
        </ChampGhl>
      </SectionGhl>

      <SectionGhl titre={fr ? 'Détails du deal' : 'Deal details'}>
        <ChampGhl libelle="Pipeline">
          <div className={cn(CLASSE_SAISIE, 'flex items-center text-text-secondary')}>{nomPipeline || '—'}</div>
        </ChampGhl>
        <ChampGhl id={`${ids}-etape`} libelle={fr ? 'Étape' : 'Stage'}>
          <select id={`${ids}-etape`} value={v.statut === 'ouvert' ? v.etape : ''} disabled={lectureSeule || v.statut !== 'ouvert'}
            onChange={(e) => poser({ etape: e.target.value })} className={CLASSE_SAISIE}>
            {v.statut !== 'ouvert' && <option value="">{fr ? '— Deal fermé —' : '— Closed deal —'}</option>}
            {ouvertes.map((e) => <option key={e.id} value={e.id}>{fr ? e.name_fr : e.name_en}</option>)}
          </select>
        </ChampGhl>
        <ChampGhl id={`${ids}-statut`} libelle={fr ? 'Statut' : 'Status'}>
          <select id={`${ids}-statut`} value={v.statut} disabled={lectureSeule}
            onChange={(e) => poser({ statut: e.target.value as StatutDeal, ...(e.target.value === 'ouvert' && initial.statut !== 'ouvert' ? { etape: ouvertes[0]?.id ?? v.etape } : {}) })}
            className={CLASSE_SAISIE}>
            {OPTIONS_STATUT.map((s) => <option key={s.cle} value={s.cle}>{fr ? s.fr : s.en}</option>)}
          </select>
        </ChampGhl>
        <ChampGhl libelle={fr ? 'Valeur' : 'Value'}>
          <div className={cn(CLASSE_SAISIE, 'flex items-center justify-between gap-2')}>
            <span className="tabular-nums">{montantCents != null ? new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD' }).format(montantCents / 100) : (fr ? 'C$ —' : 'C$ —')}</span>
            {deal.quote_id && <Link to={`/quotes/${deal.quote_id}`} className="shrink-0 text-[12px] text-primary hover:underline">{fr ? 'Devis' : 'Quote'}</Link>}
          </div>
        </ChampGhl>
        {changeStatut && (v.statut === 'perdu' || v.statut === 'abandonne') && (
          <ChampRaison id={`${ids}-raison`} valeur={raison} onChange={setRaison} fr={fr} requise={v.statut === 'perdu'} />
        )}
        <ChampGhl id={`${ids}-resp`} libelle={fr ? 'Responsable' : 'Owner'}>
          <select id={`${ids}-resp`} value={v.responsable} disabled={lectureSeule} onChange={(e) => poser({ responsable: e.target.value })} className={CLASSE_SAISIE}>
            <option value="">{fr ? 'Non assigné' : 'Unassigned'}</option>
            {membres.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </ChampGhl>
        <ChampGhl id={`${ids}-entreprise`} libelle={fr ? 'Entreprise' : 'Business name'}>
          <input id={`${ids}-entreprise`} value={v.entreprise} disabled={lectureSeule} onChange={(e) => poser({ entreprise: e.target.value })}
            placeholder={fr ? 'Nom de l’entreprise' : 'Enter business name'} className={CLASSE_SAISIE} />
        </ChampGhl>
        <ChampGhl id={`${ids}-source`} libelle="Source">
          <select id={`${ids}-source`} value={v.source} disabled={lectureSeule} onChange={(e) => poser({ source: e.target.value })} className={CLASSE_SAISIE}>
            {!OPTIONS_SOURCE.some((s) => s.cle === v.source) && <option value={v.source}>{v.source}</option>}
            {OPTIONS_SOURCE.map((s) => <option key={s.cle} value={s.cle}>{fr ? s.fr : s.en}</option>)}
          </select>
        </ChampGhl>
        <ChampGhl id={`${ids}-fermeture`} libelle={fr ? 'Date de fermeture prévue' : 'Expected close date'}>
          <input id={`${ids}-fermeture`} type="date" value={v.fermeture} disabled={lectureSeule} onChange={(e) => poser({ fermeture: e.target.value })} className={CLASSE_SAISIE} />
        </ChampGhl>
        <ChampGhl libelle={fr ? 'Étiquettes' : 'Tags'} pleine>
          {deal.client_id ? (
            <div className="flex min-h-10 items-center rounded-lg border border-outline bg-surface px-2 py-1.5">
              <SelecteurEtiquettes valeurs={etiquettes} fr={fr} lectureSeule={lectureSeule}
                onAjouter={async (tag) => { await poserEtiquette(deal.client_id, tag); await rafraichirEtiquettes(); }}
                onRetirer={async (tag) => { await retirerEtiquette(deal.client_id, tag); await rafraichirEtiquettes(); }} />
            </div>
          ) : <p className="text-[12px] text-text-tertiary">{fr ? 'Aucun client rattaché.' : 'No client linked.'}</p>}
        </ChampGhl>
      </SectionGhl>
      {champsPerso}
    </CadreGhl>
  );
}
