/**
 * Les fenêtres du menu ⋮ d'un pipeline (liste « Pipelines ») et de la
 * suppression d'une étape (page détail) — mission GHL du 2026-09-25.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Modal from '../../ui/Modal';
import {
  compterDealsPipeline, copierVersBureaux, donnerAccesPipeline, fetchAccesPipeline, fetchBureauxAdministres,
  fetchMembres, fetchRolesMembres, fetchStages, majDroitModifier, retirerAccesPipeline, rouvrirPipeline,
  supprimerEtape, supprimerPipeline, type PipelineResume, type PipelineStage,
} from '../../../lib/pipelineVentesApi';

const LIBELLE_ROLE: Record<string, { fr: string; en: string }> = {
  owner: { fr: 'Propriétaire', en: 'Owner' },
  admin: { fr: 'Administrateur', en: 'Admin' },
  sales_rep: { fr: 'Vendeur', en: 'Sales rep' },
  technician: { fr: 'Technicien', en: 'Technician' },
  manager: { fr: 'Gestionnaire', en: 'Manager' },
};
const libelleRole = (r: string | undefined, fr: boolean) =>
  r ? (fr ? LIBELLE_ROLE[r]?.fr : LIBELLE_ROLE[r]?.en) ?? r : '—';

function Pied({ fr, onAnnuler, onValider, libelle, occupe, danger, bloque }: {
  fr: boolean; onAnnuler: () => void; onValider: () => void; libelle: string;
  occupe?: boolean; danger?: boolean; bloque?: string | null;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onAnnuler} className="btn-secondary text-[13px] px-4 py-1.5">
        {fr ? 'Annuler' : 'Cancel'}
      </button>
      <button
        type="button"
        onClick={onValider}
        disabled={occupe || !!bloque}
        title={bloque ?? undefined}
        className={`text-[13px] px-4 py-1.5 disabled:opacity-50 ${danger ? 'btn-primary !bg-red-600 !border-red-600' : 'btn-primary'}`}
      >
        {libelle}
      </button>
    </div>
  );
}

// ── Supprimer un pipeline ───────────────────────────────────────

export function SupprimerPipelineModal({ fr, pipeline, pipelines, onFermer, onSupprime }: {
  fr: boolean;
  pipeline: PipelineResume | null;
  pipelines: PipelineResume[];
  onFermer: () => void;
  onSupprime: () => void;
}) {
  const idDestP = useId();
  const idDestE = useId();
  const autres = useMemo(() => pipelines.filter((p) => p.id !== pipeline?.id), [pipelines, pipeline]);
  const [destP, setDestP] = useState('');
  const [destE, setDestE] = useState('');
  const [occupe, setOccupe] = useState(false);

  const dealsQ = useQuery({
    queryKey: ['pipeline-nb-deals', pipeline?.id],
    queryFn: () => compterDealsPipeline(pipeline!.id), // enabled garantit pipeline
    enabled: !!pipeline,
  });
  const etapesQ = useQuery({
    queryKey: ['pipeline-stages', destP],
    queryFn: () => fetchStages(destP),
    enabled: !!destP,
  });
  const ouvertes = (etapesQ.data ?? []).filter((e) => e.kind === 'open' && e.archived_at === null);

  useEffect(() => { setDestP(autres[0]?.id ?? ''); }, [autres]);
  useEffect(() => { setDestE(ouvertes[0]?.id ?? ''); }, [ouvertes.map((e) => e.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const nb = dealsQ.data ?? 0;
  const dernier = autres.length === 0;
  const bloque = dernier
    ? (fr ? 'Impossible de supprimer le dernier pipeline' : 'You cannot delete the last pipeline')
    : nb > 0 && (!destP || !destE) ? (fr ? 'Choisissez une destination' : 'Choose a destination') : null;

  async function valider() {
    if (!pipeline) return;
    setOccupe(true);
    try {
      const deplaces = await supprimerPipeline(pipeline.id, nb > 0 ? { pipelineId: destP, etapeId: destE } : null);
      toast.success(deplaces > 0
        ? (fr ? `Pipeline supprimé — ${deplaces} deal(s) déplacé(s).` : `Pipeline deleted — ${deplaces} deal(s) moved.`)
        : (fr ? 'Pipeline supprimé.' : 'Pipeline deleted.'));
      onSupprime();
    } catch (e) {
      console.error('[pipelines] suppression', e);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <Modal
      open={!!pipeline}
      onClose={onFermer}
      size="md"
      title={fr ? `Supprimer « ${pipeline?.name ?? ''} » ?` : `Delete “${pipeline?.name ?? ''}”?`}
      footer={<Pied fr={fr} onAnnuler={onFermer} onValider={() => void valider()} libelle={fr ? 'Supprimer' : 'Delete'} occupe={occupe} danger bloque={bloque} />}
    >
      {dernier ? (
        <p className="text-[13px] text-text-secondary">
          {fr ? 'C’est votre dernier pipeline : il faut en garder au moins un.' : 'This is your last pipeline: at least one must remain.'}
        </p>
      ) : dealsQ.isLoading ? (
        <p className="text-[13px] text-text-muted">{fr ? 'Vérification des deals…' : 'Checking deals…'}</p>
      ) : nb === 0 ? (
        <p className="text-[13px] text-text-secondary">
          {fr ? 'Ce pipeline ne contient aucun deal. Ses étapes et réglages seront retirés.' : 'This pipeline holds no deals. Its stages and settings will be removed.'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-secondary">
            {fr
              ? `Ce pipeline contient ${nb} deal(s). Ils ne seront pas supprimés : choisissez où les déplacer. Aucune automatisation ne sera déclenchée.`
              : `This pipeline holds ${nb} deal(s). They won’t be deleted: choose where to move them. No automation will run.`}
          </p>
          <div>
            <label htmlFor={idDestP} className="mb-1 block text-[12px] text-text-tertiary">{fr ? 'Pipeline de destination' : 'Destination pipeline'}</label>
            <select id={idDestP} value={destP} onChange={(e) => setDestP(e.target.value)} className="input-field w-full text-[13px]">
              {autres.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={idDestE} className="mb-1 block text-[12px] text-text-tertiary">{fr ? 'Étape de destination' : 'Destination stage'}</label>
            <select id={idDestE} value={destE} onChange={(e) => setDestE(e.target.value)} className="input-field w-full text-[13px]">
              {ouvertes.map((e) => <option key={e.id} value={e.id}>{fr ? e.name_fr : e.name_en}</option>)}
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Supprimer une étape ─────────────────────────────────────────

export function SupprimerEtapeModal({ fr, etape, etapes, nbDeals, onFermer, onSupprime }: {
  fr: boolean;
  etape: PipelineStage | null;
  etapes: PipelineStage[];
  nbDeals: number;
  onFermer: () => void;
  onSupprime: () => void;
}) {
  const idDest = useId();
  const cibles = etapes.filter((e) => e.id !== etape?.id && e.kind === 'open' && e.archived_at === null);
  const [dest, setDest] = useState('');
  const [occupe, setOccupe] = useState(false);
  useEffect(() => { setDest(cibles[0]?.id ?? ''); }, [etape?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const bloque = nbDeals > 0 && !dest
    ? (fr ? 'Aucune autre étape ouverte : ajoutez-en une d’abord' : 'No other open stage: add one first')
    : null;

  async function valider() {
    if (!etape) return;
    setOccupe(true);
    try {
      const n = await supprimerEtape(etape.id, nbDeals > 0 ? dest : null);
      toast.success(n > 0
        ? (fr ? `Étape supprimée — ${n} deal(s) déplacé(s).` : `Stage deleted — ${n} deal(s) moved.`)
        : (fr ? 'Étape supprimée.' : 'Stage deleted.'));
      onSupprime();
    } catch (e) {
      console.error('[pipelines] suppression d’étape', e);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  }

  const nom = etape ? (fr ? etape.name_fr : etape.name_en) : '';
  return (
    <Modal
      open={!!etape}
      onClose={onFermer}
      size="md"
      title={fr ? `Supprimer l’étape « ${nom} » ?` : `Delete stage “${nom}”?`}
      footer={<Pied fr={fr} onAnnuler={onFermer} onValider={() => void valider()} libelle={fr ? 'Supprimer' : 'Delete'} occupe={occupe} danger bloque={bloque} />}
    >
      {nbDeals === 0 ? (
        <p className="text-[13px] text-text-secondary">
          {fr ? 'Cette étape est vide. Elle pourra être remise sur le board plus tard.' : 'This stage is empty. It can be restored later.'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-secondary">
            {fr
              ? `${nbDeals} deal(s) sont à cette étape. Choisissez où les déplacer — aucune automatisation ne sera déclenchée.`
              : `${nbDeals} deal(s) are in this stage. Choose where to move them — no automation will run.`}
          </p>
          <div>
            <label htmlFor={idDest} className="mb-1 block text-[12px] text-text-tertiary">{fr ? 'Déplacer vers' : 'Move to'}</label>
            <select id={idDest} value={dest} onChange={(e) => setDest(e.target.value)} className="input-field w-full text-[13px]">
              {cibles.map((e) => <option key={e.id} value={e.id}>{fr ? e.name_fr : e.name_en}</option>)}
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Déplacer à la position ──────────────────────────────────────

export function PositionModal({ fr, pipeline, total, onFermer, onValider }: {
  fr: boolean;
  pipeline: PipelineResume | null;
  total: number;
  onFermer: () => void;
  onValider: (position: number) => void;
}) {
  const idPos = useId();
  const [valeur, setValeur] = useState('1');
  useEffect(() => { setValeur(String(pipeline?.position ?? 1)); }, [pipeline]);
  const n = Number(valeur);
  const bloque = !Number.isInteger(n) || n < 1 || n > total
    ? (fr ? `Entre 1 et ${total}` : `Between 1 and ${total}`)
    : null;
  return (
    <Modal
      open={!!pipeline}
      onClose={onFermer}
      size="sm"
      title={fr ? 'Déplacer à la position' : 'Move to position'}
      footer={<Pied fr={fr} onAnnuler={onFermer} onValider={() => onValider(n)} libelle={fr ? 'Déplacer' : 'Move'} bloque={bloque} />}
    >
      <label htmlFor={idPos} className="mb-1 block text-[12px] text-text-tertiary">
        {fr ? `Position (1 à ${total})` : `Position (1 to ${total})`}
      </label>
      <input
        id={idPos}
        type="number"
        min={1}
        max={total}
        autoFocus
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        className="input-field w-full text-[13px]"
      />
      <p className="mt-2 text-[11.5px] text-text-muted">
        {fr ? 'Le pipeline en position 1 reçoit les leads qui n’ont pas de destination.' : 'The pipeline in position 1 receives leads with no destination.'}
      </p>
    </Modal>
  );
}

// ── Copier vers d'autres bureaux (« sous-comptes ») ─────────────

export function CopierBureauxModal({ fr, pipeline, onFermer }: {
  fr: boolean;
  pipeline: PipelineResume | null;
  onFermer: () => void;
}) {
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [occupe, setOccupe] = useState(false);
  const bureauxQ = useQuery({ queryKey: ['pipeline-bureaux-administres'], queryFn: fetchBureauxAdministres, enabled: !!pipeline });
  useEffect(() => { setChoix(new Set()); }, [pipeline]);
  const bureaux = bureauxQ.data ?? [];

  async function valider() {
    if (!pipeline) return;
    setOccupe(true);
    try {
      const n = await copierVersBureaux(pipeline.id, [...choix]);
      toast.success(fr ? `Pipeline copié dans ${n} bureau(x).` : `Pipeline copied to ${n} location(s).`);
      onFermer();
    } catch (e) {
      console.error('[pipelines] copie vers bureaux', e);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <Modal
      open={!!pipeline}
      onClose={onFermer}
      size="md"
      title={fr ? 'Copier vers d’autres bureaux' : 'Copy to other locations'}
      description={fr
        ? 'Le pipeline, ses étapes et ses réglages sont copiés — sans les deals.'
        : 'The pipeline, its stages and settings are copied — without deals.'}
      footer={<Pied fr={fr} onAnnuler={onFermer} onValider={() => void valider()} libelle={fr ? 'Copier' : 'Copy'} occupe={occupe}
        bloque={choix.size === 0 ? (fr ? 'Choisissez au moins un bureau' : 'Choose at least one location') : null} />}
    >
      {bureauxQ.isLoading ? (
        <p className="text-[13px] text-text-muted">{fr ? 'Chargement…' : 'Loading…'}</p>
      ) : bureaux.length === 0 ? (
        <p className="text-[13px] text-text-secondary">
          {fr
            ? 'Vous n’administrez aucun autre bureau. Les bureaux se créent dans Réglages → Bureaux.'
            : 'You don’t manage any other location. Locations are created in Settings → Locations.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {bureaux.map((b) => {
            const id = `bureau-${b.org_id}`;
            return (
              <li key={b.org_id} className="flex items-center gap-2">
                <input
                  id={id}
                  type="checkbox"
                  checked={choix.has(b.org_id)}
                  onChange={(e) => setChoix((c) => {
                    const n = new Set(c);
                    if (e.target.checked) n.add(b.org_id); else n.delete(b.org_id);
                    return n;
                  })}
                  className="accent-primary"
                />
                <label htmlFor={id} className="text-[13px] text-text-primary">{b.nom}</label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ── Gérer les permissions ───────────────────────────────────────

export function PermissionsModal({ fr, pipeline, onFermer }: {
  fr: boolean;
  pipeline: PipelineResume | null;
  onFermer: () => void;
}) {
  const qc = useQueryClient();
  const actif = !!pipeline;
  const membresQ = useQuery({ queryKey: ['pipeline-membres'], queryFn: fetchMembres, enabled: actif });
  const rolesQ = useQuery({ queryKey: ['pipeline-roles-membres'], queryFn: fetchRolesMembres, enabled: actif });
  const cle = ['pipeline-acces', pipeline?.id];
  const accesQ = useQuery({ queryKey: cle, queryFn: () => fetchAccesPipeline(pipeline!.id), enabled: actif }); // enabled garantit pipeline
  const [occupe, setOccupe] = useState(false);

  const roles = rolesQ.data ?? {};
  const acces = accesQ.data ?? [];
  const ouvertATous = acces.length === 0;
  const estAdmin = (uid: string) => roles[uid] === 'owner' || roles[uid] === 'admin';
  const membres = (membresQ.data ?? []).filter((m) => roles[m.id]);
  const rolesPresents = [...new Set(membres.map((m) => roles[m.id]).filter((r) => r !== 'owner' && r !== 'admin'))];

  async function agir(fn: () => Promise<void>) {
    setOccupe(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: cle });
      await qc.invalidateQueries({ queryKey: ['pipeline-liste'] });
    } catch (e) {
      console.error('[pipelines] permissions', e);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  }

  const ligne = (uid: string) => acces.find((a) => a.user_id === uid);

  /**
   * Passer de « ouvert à tous » à une liste nommée : AUCUNE ligne = tout le
   * monde voit, et la première ligne réserve le pipeline aux nommés. Toucher
   * un seul membre fermerait donc le pipeline à tous les autres, en silence.
   * On commence par nommer toute l'équipe, puis on applique le changement.
   */
  async function figerEquipe(sauf?: string) {
    for (const m of membres) {
      if (!estAdmin(m.id) && m.id !== sauf) await donnerAccesPipeline(pipeline!.id, m.id); // modal ouvert = pipeline présent
    }
  }

  function basculerVoir(uid: string, voir: boolean) {
    void agir(async () => {
      if (ouvertATous) {
        // Décocher un seul membre : tous les AUTRES gardent l'accès.
        if (!voir) await figerEquipe(uid);
        return;
      }
      const l = ligne(uid);
      if (voir && !l) await donnerAccesPipeline(pipeline!.id, uid); // modal ouvert = pipeline présent
      if (!voir && l) await retirerAccesPipeline(l.id);
    });
  }
  function basculerModifier(uid: string, modifier: boolean) {
    void agir(async () => {
      if (ouvertATous) {
        if (!modifier) return;
        await figerEquipe(uid);
        await donnerAccesPipeline(pipeline!.id, uid, true); // modal ouvert = pipeline présent
        return;
      }
      const l = ligne(uid);
      if (!l) await donnerAccesPipeline(pipeline!.id, uid, modifier); // modal ouvert = pipeline présent
      else await majDroitModifier(l.id, modifier);
    });
  }
  function donnerAuRole(role: string) {
    void agir(async () => {
      for (const m of membres.filter((x) => roles[x.id] === role && !ligne(x.id))) {
        await donnerAccesPipeline(pipeline!.id, m.id); // modal ouvert = pipeline présent
      }
    });
  }

  return (
    <Modal
      open={actif}
      onClose={onFermer}
      size="lg"
      title={fr ? `Permissions — ${pipeline?.name ?? ''}` : `Permissions — ${pipeline?.name ?? ''}`}
      description={ouvertATous
        ? (fr ? 'Ouvert à toute l’équipe en lecture. Cochez « Voir » pour le réserver à certains membres.' : 'Visible to the whole team. Tick “View” to restrict it to specific members.')
        : (fr ? 'Réservé aux membres cochés. Propriétaires et administrateurs ont toujours accès à tout.' : 'Restricted to ticked members. Owners and admins always have full access.')}
      footer={(
        <div className="flex items-center justify-between gap-2">
          {!ouvertATous ? (
            <button type="button" disabled={occupe} onClick={() => void agir(() => rouvrirPipeline(pipeline!.id))} className="text-[12.5px] text-text-secondary underline underline-offset-2 disabled:opacity-50">
              {fr ? 'Rouvrir à toute l’équipe' : 'Reopen to the whole team'}
            </button>
          ) : <span />}
          <button type="button" onClick={onFermer} className="btn-primary text-[13px] px-4 py-1.5">{fr ? 'Terminé' : 'Done'}</button>
        </div>
      )}
    >
      {rolesPresents.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-text-tertiary">{fr ? 'Donner « Voir » à :' : 'Give “View” to:'}</span>
          {rolesPresents.map((r) => (
            <button key={r} type="button" disabled={occupe} onClick={() => donnerAuRole(r)} className="btn-secondary text-[12px] px-2.5 py-1 disabled:opacity-50">
              {fr ? `Tous les ${libelleRole(r, fr).toLowerCase()}s` : `All ${libelleRole(r, fr).toLowerCase()}s`}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-left text-[11.5px] text-text-tertiary">
            <tr>
              <th scope="col" className="py-1.5 font-medium">{fr ? 'Membre' : 'Member'}</th>
              <th scope="col" className="py-1.5 font-medium">{fr ? 'Rôle' : 'Role'}</th>
              <th scope="col" className="py-1.5 text-center font-medium">{fr ? 'Voir' : 'View'}</th>
              <th scope="col" className="py-1.5 text-center font-medium">{fr ? 'Modifier' : 'Edit'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {membres.map((m) => {
              const admin = estAdmin(m.id);
              const l = ligne(m.id);
              const voit = admin || ouvertATous || !!l;
              const modifie = admin || !!l?.peut_modifier;
              return (
                <tr key={m.id}>
                  <td className="py-1.5 text-text-primary">{m.name}</td>
                  <td className="py-1.5 text-text-tertiary">{libelleRole(roles[m.id], fr)}</td>
                  <td className="py-1.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={fr ? `${m.name} peut voir` : `${m.name} can view`}
                      checked={voit}
                      disabled={admin || occupe}
                      onChange={(e) => basculerVoir(m.id, e.target.checked)}
                      className="accent-primary"
                    />
                  </td>
                  <td className="py-1.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={fr ? `${m.name} peut modifier` : `${m.name} can edit`}
                      checked={modifie}
                      disabled={admin || occupe}
                      onChange={(e) => basculerModifier(m.id, e.target.checked)}
                      className="accent-primary"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
