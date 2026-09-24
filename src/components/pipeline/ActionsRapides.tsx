/**
 * Actions rapides d'une carte du board — le menu « ⋮ ».
 *
 * Ce qu'on fait vraiment depuis un board de ventes : texter, appeler,
 * chiffrer, se rappeler de relancer, confier à quelqu'un.
 *
 * Chaque action AMÈNE là où elle se fait, elle ne la fait pas à la place de
 * l'utilisateur. Le texto s'envoyait depuis une zone de saisie du menu : on
 * écrivait sans voir ce que le client avait déjà répondu.
 *
 * Ce qui n'est PAS ici, volontairement : planifier un rendez-vous. Une visite
 * demande une durée, une équipe et une adresse confirmée — ça mérite la vraie
 * fenêtre de job, pas un menu contextuel qui devinerait à la place du vendeur.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, FileText, MoreVertical, Phone, User, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { creerTacheDeal, nomClient, type Deal } from '../../lib/pipelineVentesApi';

interface Membre { id: string; name: string }

export default function ActionsRapides({ deal, membres, onAssigner, onChangement }: {
  deal: Deal;
  membres: Membre[];
  onAssigner: (dealId: string, membreId: string | null) => void;
  onChangement?: () => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const idMenu = useId();
  const idRappel = useId();

  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState<'menu' | 'rappel' | 'assigner'>('menu');
  const [jours, setJours] = useState('2');
  const [enCours, setEnCours] = useState(false);
  const ancre = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const tel = deal.client?.phone ?? null;
  const prenom = deal.client?.first_name?.trim() || nomClient(deal);

  // Fermeture au clic extérieur et à Échap.
  useEffect(() => {
    if (!ouvert) return;
    const surClic = (e: MouseEvent) => {
      const cible = e.target as Node;
      if (ancre.current?.contains(cible)) return;
      if (document.getElementById(idMenu)?.contains(cible)) return;
      setOuvert(false);
    };
    const surTouche = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', surClic);
    document.addEventListener('keydown', surTouche);
    return () => {
      document.removeEventListener('mousedown', surClic);
      document.removeEventListener('keydown', surTouche);
    };
  }, [ouvert, idMenu]);

  function basculer(e: React.MouseEvent) {
    e.stopPropagation();
    if (ouvert) { setOuvert(false); return; }
    const r = ancre.current?.getBoundingClientRect();
    if (r) {
      // Le menu s'ancre sous le bouton ; s'il déborde à droite, il se cale
      // sur le bord de l'écran plutôt que de sortir de la fenêtre.
      const large = 268;
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - large, window.innerWidth - large - 8)) });
    }
    setVue('menu');
    setOuvert(true);
  }

  async function poserRappel() {
    if (enCours) return;
    const n = Number(jours);
    if (!Number.isFinite(n) || n < 0) return;
    setEnCours(true);
    try {
      const echeance = new Date();
      echeance.setDate(echeance.getDate() + n);
      await creerTacheDeal(deal.id, {
        title: fr ? `Relancer ${nomClient(deal)}` : `Follow up with ${nomClient(deal)}`,
        // Date seule (AAAA-MM-JJ) : `tasks.due_date` est une colonne `date`,
        // et une heure la ferait reculer d'un jour au Québec.
        due_date: echeance.toISOString().slice(0, 10),
      });
      toast.success(fr ? `Rappel dans ${n} jour(s).` : `Reminder in ${n} day(s).`);
      setOuvert(false);
      onChangement?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  }

  const ligne = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-text-primary '
    + 'hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary '
    + 'disabled:cursor-not-allowed disabled:opacity-45';

  return (
    <>
      <button
        ref={ancre}
        onClick={basculer}
        aria-label={fr ? `Actions pour ${nomClient(deal)}` : `Actions for ${nomClient(deal)}`}
        aria-expanded={ouvert}
        aria-haspopup="menu"
        className="shrink-0 rounded text-text-muted hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
      >
        <MoreVertical size={13} aria-hidden="true" />
      </button>

      {ouvert && pos && createPortal(
        <div
          id={idMenu}
          role="menu"
          aria-label={fr ? 'Actions rapides' : 'Quick actions'}
          // Pas de onClick ici : le conteneur ne doit pas être cliquable, sinon
          // il compte comme une div interactive sans rôle de bouton. Le clic
          // extérieur est déjà géré par le listener document, qui ignore ce
          // menu grâce à son id.
          style={{ top: pos.top, left: pos.left, width: 268 }}
          className="fixed z-[70] overflow-hidden rounded-xl border border-outline-strong bg-surface-elevated py-1 shadow-lg"
        >
          {vue === 'menu' && (
            <>
              {/*
                Le texto AMÈNE à la conversation, il ne s'envoie plus depuis
                le menu. Écrire dans une petite zone de saisie, c'est écrire
                sans voir ce que le client a déjà répondu — le contexte vit
                dans la messagerie, pas dans un menu contextuel.
              */}
              <button
                type="button"
                role="menuitem"
                className={ligne}
                disabled={!tel}
                title={tel ? undefined : (fr ? 'Aucun numéro au dossier' : 'No phone on file')}
                onClick={() => {
                  setOuvert(false);
                  const p = new URLSearchParams();
                  if (deal.client_id) p.set('clientId', deal.client_id);
                  if (tel) p.set('phone', tel);
                  p.set('name', nomClient(deal));
                  navigate(`/messages?${p.toString()}`);
                }}
              >
                <MessageSquare size={14} aria-hidden="true" />
                {fr ? 'Ouvrir la conversation' : 'Open conversation'}
              </button>

              {/*
                Le numéro est AFFICHÉ : sur un ordinateur, `tel:` ne fait
                souvent rien de visible, et un bouton « Appeler » qui ne
                compose pas laisse croire que l'application est cassée.
                Au moins, le numéro est lisible et copiable.
              */}
              <a
                role="menuitem"
                href={tel ? `tel:${tel}` : undefined}
                aria-disabled={!tel}
                className={ligne + (tel ? '' : ' pointer-events-none opacity-45')}
                onClick={() => setOuvert(false)}
              >
                <Phone size={14} aria-hidden="true" />
                {tel
                  ? `${fr ? 'Appeler' : 'Call'} ${tel}`
                  : (fr ? 'Aucun numéro' : 'No phone')}
              </a>

              <button
                type="button"
                role="menuitem"
                className={ligne}
                onClick={() => {
                  setOuvert(false);
                  // Le devis se crée dans son propre écran, avec le client
                  // pré-sélectionné : le chiffrage ne se bâcle pas en popup.
                  navigate(`/quotes/new?clientId=${deal.client_id}`);
                }}
              >
                <FileText size={14} aria-hidden="true" />
                {fr ? 'Créer un devis' : 'Create a quote'}
              </button>

              <button type="button" role="menuitem" className={ligne} onClick={() => setVue('rappel')}>
                <CalendarClock size={14} aria-hidden="true" />
                {fr ? 'Planifier un rappel' : 'Schedule a reminder'}
              </button>

              <button type="button" role="menuitem" className={ligne} onClick={() => setVue('assigner')}>
                <User size={14} aria-hidden="true" />
                {fr ? 'Assigner à…' : 'Assign to…'}
              </button>
            </>
          )}

          {vue === 'rappel' && (
            <div className="p-3">
              <label htmlFor={idRappel} className="mb-1.5 block text-[11px] text-text-tertiary">
                {fr ? 'Me rappeler dans' : 'Remind me in'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={idRappel}
                  type="number"
                  min={0}
                  max={365}
                  value={jours}
                  onChange={(e) => setJours(e.target.value)}
                  className="input-field w-20 text-[12.5px]"
                />
                <span className="text-[12px] text-text-secondary">{fr ? 'jours' : 'days'}</span>
              </div>
              <p className="mt-1.5 text-[10.5px] text-text-muted">
                {fr ? 'Crée une tâche rattachée à ce deal.' : 'Creates a task linked to this deal.'}
              </p>
              <div className="mt-2.5 flex justify-end gap-2">
                <button type="button" className="btn-secondary text-[12px]" onClick={() => setVue('menu')}>
                  {fr ? 'Retour' : 'Back'}
                </button>
                <button
                  type="button"
                  className="btn-primary text-[12px] disabled:opacity-50"
                  disabled={enCours}
                  onClick={() => { void poserRappel(); }}
                >
                  {fr ? 'Planifier' : 'Schedule'}
                </button>
              </div>
            </div>
          )}

          {vue === 'assigner' && (
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                className={ligne}
                onClick={() => { onAssigner(deal.id, null); setOuvert(false); }}
              >
                {fr ? 'Personne' : 'Nobody'}
              </button>
              {membres.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitem"
                  className={ligne + (deal.assigned_user_id === m.id ? ' font-semibold' : '')}
                  onClick={() => { onAssigner(deal.id, m.id); setOuvert(false); }}
                >
                  {m.name}
                </button>
              ))}
              {membres.length === 0 && (
                <p className="px-3 py-2 text-[12px] text-text-muted">
                  {fr ? 'Aucun membre dans cette équipe.' : 'No member in this team.'}
                </p>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
