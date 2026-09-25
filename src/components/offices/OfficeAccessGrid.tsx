/**
 * Réglages → Bureaux → Accès : qui a accès à quel bureau, avec quel rôle.
 *
 * Une case = une adhésion (memberships) dans ce bureau. Les propriétaires
 * ont tous les bureaux d'office (trigger en base) : leur ligne est figée.
 * Retirer l'accès supprime l'adhésion du bureau ; jobs, ventes et historique
 * de la personne restent. Réservé au propriétaire (le serveur le vérifie).
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { confirmer } from '../ui/ConfirmDialog';
import { captureClientException } from '../../lib/sentry';
import {
  getOfficeAccess,
  setOfficeAccess,
  type OfficeAccessMatrix,
  type OfficeAccessOffice,
  type OfficeAccessPerson,
  type OfficeAccessRole,
} from '../../lib/officesApi';

const AUCUN = '';

export default function OfficeAccessGrid({ onChanged }: { onChanged?: () => void }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [data, setData] = useState<OfficeAccessMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const libelleRole = (role: string) => {
    switch (role) {
      case 'owner': return fr ? 'Propriétaire' : 'Owner';
      case 'admin': return 'Admin';
      case 'sales_rep': return fr ? 'Représentant' : 'Sales rep';
      case 'technician': return fr ? 'Technicien' : 'Technician';
      default: return role;
    }
  };

  const charger = useCallback(async () => {
    try {
      setData(await getOfficeAccess());
    } catch (e) {
      console.error('[OfficeAccessGrid] chargement', e);
      captureClientException(e);
      toast.error(fr ? 'Impossible de charger les accès.' : 'Could not load access.');
    } finally {
      setLoading(false);
    }
  }, [fr]);

  useEffect(() => { void charger(); }, [charger]);

  const nomPersonne = (p: OfficeAccessPerson) => p.full_name || p.email || (fr ? 'Membre' : 'Member');

  const changer = async (p: OfficeAccessPerson, o: OfficeAccessOffice, valeur: string) => {
    const role = (valeur || null) as OfficeAccessRole | null;
    if (role === null) {
      const ok = await confirmer({
        title: fr ? 'Retirer l\'accès' : 'Remove access',
        message: fr
          ? `${nomPersonne(p)} n'aura plus accès au bureau « ${o.name} ». Ses jobs, ventes et historique y restent.`
          : `${nomPersonne(p)} will lose access to “${o.name}”. Their jobs, sales and history stay there.`,
        confirmLabel: fr ? 'Retirer l\'accès' : 'Remove access',
        danger: true,
      });
      if (!ok) return;
    }
    const cle = `${p.user_id}:${o.id}`;
    setSaving(cle);
    try {
      await setOfficeAccess(p.user_id, o.id, role);
      await charger();
      onChanged?.();
      toast.success(role === null
        ? (fr ? 'Accès retiré.' : 'Access removed.')
        : (fr ? 'Accès mis à jour.' : 'Access updated.'));
    } catch (e: any) {
      console.error('[OfficeAccessGrid] changement', e);
      captureClientException(e);
      const messages: Record<string, string> = fr
        ? {
            last_office: 'C\'est son seul bureau. Pour la retirer de l\'entreprise, passez par Membres.',
            suspended: 'Cette personne a été retirée de ce bureau. Réactivez-la depuis Membres.',
            owner_all_offices: 'Un propriétaire a toujours accès à tous les bureaux.',
          }
        : {
            last_office: 'This is their only office. To remove them from the company, use Members.',
            suspended: 'This person was removed from this office. Reactivate them from Members.',
            owner_all_offices: 'Owners always have access to every office.',
          };
      toast.error(messages[e?.code] || (fr ? 'Modification impossible.' : 'Could not update access.'));
    } finally {
      setSaving(null);
    }
  };

  const caseAcces = (p: OfficeAccessPerson, o: OfficeAccessOffice) => {
    const acces = p.access[o.id];
    if (p.is_owner) {
      return <span className="text-[12px] font-medium text-text-secondary">{libelleRole('owner')}</span>;
    }
    if (acces && acces.status !== 'active') {
      return <span className="text-[12px] text-text-tertiary">{fr ? 'Retiré (voir Membres)' : 'Removed (see Members)'}</span>;
    }
    const cle = `${p.user_id}:${o.id}`;
    return (
      <div className="flex items-center gap-2">
        <select
          aria-label={fr ? `Accès de ${nomPersonne(p)} au bureau ${o.name}` : `${nomPersonne(p)}'s access to ${o.name}`}
          value={acces?.role ?? AUCUN}
          disabled={saving !== null}
          onChange={(e) => void changer(p, o, e.target.value)}
          className="glass-input text-[13px] py-1.5 w-full min-w-[9rem]"
        >
          <option value={AUCUN}>{fr ? 'Aucun accès' : 'No access'}</option>
          <option value="admin">{libelleRole('admin')}</option>
          <option value="sales_rep">{libelleRole('sales_rep')}</option>
          <option value="technician">{libelleRole('technician')}</option>
        </select>
        {saving === cle && <Loader2 size={14} className="animate-spin text-text-tertiary shrink-0" />}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-tertiary py-6">
        <Loader2 size={16} className="animate-spin" />
        {fr ? 'Chargement des accès…' : 'Loading access…'}
      </div>
    );
  }
  if (!data || data.offices.length < 2) return null;

  const nomBureau = (o: OfficeAccessOffice) => o.name || (fr ? 'Bureau sans nom' : 'Unnamed office');

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[16px] font-semibold text-text-primary">{fr ? 'Accès aux bureaux' : 'Office access'}</h3>
        <p className="text-[12px] text-text-tertiary mt-0.5">
          {fr
            ? 'Choisissez qui a accès à chaque bureau et avec quel rôle. Les propriétaires ont accès à tous les bureaux. Pour ajouter une nouvelle personne, invitez-la depuis Membres.'
            : 'Choose who can access each office and with which role. Owners have access to every office. To add someone new, invite them from Members.'}
        </p>
      </div>

      {/* Ordinateur : tableau personnes × bureaux */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-outline-subtle bg-surface-card">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-outline-subtle">
              <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                {fr ? 'Personne' : 'Person'}
              </th>
              {data.offices.map((o) => (
                <th key={o.id} scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {nomBureau(o)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => (
              <tr key={p.user_id} className="border-b border-outline-subtle last:border-0">
                <td className="px-4 py-2.5">
                  <span className="block text-[13px] font-medium text-text-primary truncate">{nomPersonne(p)}</span>
                  {p.email && p.full_name && (
                    <span className="block text-[12px] text-text-tertiary truncate">{p.email}</span>
                  )}
                </td>
                {data.offices.map((o) => (
                  <td key={o.id} className="px-4 py-2.5">{caseAcces(p, o)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Téléphone : une fiche par personne */}
      <div className="md:hidden space-y-2">
        {data.people.map((p) => (
          <div key={p.user_id} className="rounded-2xl p-4 bg-surface-card border border-outline-subtle space-y-2">
            <div>
              <span className="block text-[14px] font-semibold text-text-primary truncate">{nomPersonne(p)}</span>
              {p.email && p.full_name && (
                <span className="block text-[12px] text-text-tertiary truncate">{p.email}</span>
              )}
            </div>
            {data.offices.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-text-secondary truncate">{nomBureau(o)}</span>
                <div className="shrink-0 w-44">{caseAcces(p, o)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
