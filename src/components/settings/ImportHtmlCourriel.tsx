/* ═══════════════════════════════════════════════════════════════
   Import d'un courriel écrit ailleurs (HTML collé ou fichier).

   Pour une entreprise qui a déjà ses courriels dans un autre outil et ne veut
   pas les retaper. Son HTML est posé DANS le gabarit, jamais à la place : le
   bouton d'action, les numéros de taxes et le pied restent les nôtres, donc
   un client peut toujours payer même si l'import est raté.

   L'aperçu est OBLIGATOIRE avant d'enregistrer : on ne laisse personne mettre
   en service un courriel qu'il n'a pas vu. Ce que l'aperçu montre est le
   résultat après nettoyage — script, style, iframe, attributs `on*` et
   `javascript:` retirés — donc exactement ce que le client recevra.
   ═══════════════════════════════════════════════════════════════ */

import { useId, useRef, useState } from 'react';
import { X, Upload, Eye, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  titreCourriel: string;
  fr: boolean;
  onClose: () => void;
  /** Enregistre le HTML importé. L'appelant pose `source: 'import'`. */
  onImporter: (html: string) => Promise<void>;
}

/** Taille au-delà de laquelle un « courriel » n'en est plus un. */
const MAX_OCTETS = 400_000;

/**
 * Nettoyage côté page, pour que l'APERÇU montre la vérité.
 *
 * Le serveur assainit de nouveau à l'envoi — c'est lui qui fait foi, et cette
 * passe-ci ne le remplace pas. Elle existe pour qu'on ne montre pas à
 * l'entreprise un rendu avec un script actif qui disparaîtra ensuite.
 */
export function nettoyerPourApercu(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

/** Ce qui a été retiré, pour le dire plutôt que de le faire en silence. */
export function elementsRetires(html: string): string[] {
  const retires: string[] = [];
  if (/<script\b/i.test(html)) retires.push('script');
  if (/<style\b/i.test(html)) retires.push('style');
  if (/<iframe\b/i.test(html)) retires.push('iframe');
  if (/\son\w+\s*=/i.test(html)) retires.push('onclick');
  if (/javascript:/i.test(html)) retires.push('javascript:');
  return retires;
}

export default function ImportHtmlCourriel({ titreCourriel, fr, onClose, onImporter }: Props) {
  const idZone = useId();
  const [html, setHtml] = useState('');
  const [apercuVu, setApercuVu] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const fichier = useRef<HTMLInputElement>(null);

  const propre = nettoyerPourApercu(html);
  const retires = elementsRetires(html);

  const choisirFichier = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_OCTETS) {
      toast.error(fr ? 'Fichier trop lourd (400 Ko maximum)' : 'File too large (400 KB max)');
      return;
    }
    try {
      setHtml(await f.text());
      setApercuVu(false);
    } catch {
      toast.error(fr ? 'Lecture du fichier impossible' : 'Could not read the file');
    }
  };

  const enregistrer = async () => {
    if (!apercuVu || enregistrement) return;
    setEnregistrement(true);
    try {
      // On envoie l'ORIGINAL : le serveur assainit, et c'est lui qui fait foi.
      await onImporter(html);
      toast.success(fr ? 'Courriel importé' : 'Email imported');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Import impossible' : 'Could not import'));
    } finally {
      setEnregistrement(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="presentation"
      tabIndex={-1}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-2xl bg-surface sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={fr ? `Importer un courriel : ${titreCourriel}` : `Import an email: ${titreCourriel}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-outline/50 px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-text-primary">
              {fr ? 'Importer votre courriel' : 'Import your email'}
            </p>
            <p className="truncate text-[12px] text-text-tertiary">{titreCourriel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-text-tertiary hover:bg-surface-secondary"
            aria-label={fr ? 'Fermer' : 'Close'}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label htmlFor={idZone} className="mb-1.5 block text-[13px] font-medium text-text-primary">
              {fr ? 'Collez votre HTML' : 'Paste your HTML'}
            </label>
            <textarea
              id={idZone}
              value={html}
              onChange={(e) => { setHtml(e.target.value); setApercuVu(false); }}
              rows={8}
              spellCheck={false}
              placeholder={fr ? '<div>Bonjour [client_name]…</div>' : '<div>Hello [client_name]…</div>'}
              className="w-full rounded-lg border border-outline/60 bg-surface-secondary px-3 py-2 font-mono text-[12px] text-text-primary focus-visible:border-primary/60 focus-visible:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={fichier}
                type="file"
                accept=".html,.htm,text/html"
                className="hidden"
                onChange={(e) => void choisirFichier(e.target.files?.[0])}
                aria-label={fr ? 'Choisir un fichier HTML' : 'Choose an HTML file'}
              />
              <button
                type="button"
                onClick={() => fichier.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-outline/60 px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-surface-secondary"
              >
                <Upload size={13} aria-hidden="true" />
                {fr ? 'Ou choisir un fichier' : 'Or choose a file'}
              </button>
              <button
                type="button"
                disabled={!html.trim()}
                onClick={() => setApercuVu(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-40"
              >
                <Eye size={13} aria-hidden="true" />
                {fr ? 'Voir le résultat' : 'Preview'}
              </button>
            </div>
          </div>

          {retires.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="text-[12px] leading-relaxed text-amber-700">
                {fr
                  ? `Retiré de votre HTML : ${retires.join(', ')}. Les courriels ne peuvent pas exécuter de code — Gmail et Outlook le bloqueraient de toute façon.`
                  : `Removed from your HTML: ${retires.join(', ')}. Emails cannot run code — Gmail and Outlook would block it anyway.`}
              </p>
            </div>
          )}

          {apercuVu && (
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-text-primary">
                {fr ? 'Ce que votre client recevra' : 'What your client will receive'}
              </p>
              <div className="rounded-lg border border-outline/60 p-4" style={{ background: '#e6f0ff' }}>
                {/* Assaini par nettoyerPourApercu, et de nouveau côté serveur
                    à l'envoi : c'est ce dernier qui fait foi. */}
                <div
                  className="rounded-lg bg-white p-4 text-[13px] leading-relaxed text-[#374151]"
                  dangerouslySetInnerHTML={{ __html: propre }}
                />
                <p className="mt-3 text-center text-[11px]" style={{ color: '#8fa3ba' }}>
                  {fr
                    ? 'Votre bouton, vos coordonnées et vos numéros de taxes seront ajoutés automatiquement autour.'
                    : 'Your button, contact details and tax numbers are added around this automatically.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-outline/50 px-5 py-3">
          <p className="text-[11px] text-text-tertiary">
            {apercuVu
              ? (fr ? 'Vous avez vu le résultat.' : 'You have seen the result.')
              : (fr ? 'Voyez le résultat avant d’enregistrer.' : 'Preview before saving.')}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-surface-secondary"
            >
              {fr ? 'Annuler' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => void enregistrer()}
              disabled={!apercuVu || enregistrement}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-40"
            >
              {enregistrement && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
              {fr ? 'Enregistrer' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
