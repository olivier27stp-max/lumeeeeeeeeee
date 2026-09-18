/* ═══════════════════════════════════════════════════════════════
   Modèles de courriel (/settings/email-templates)

   Tous les courriels qu'une entreprise envoie à SES clients, au même endroit,
   rangés par moment du cycle de vie : une demande arrive, la soumission, le
   contrat, le rendez-vous, l'argent, après les travaux.

   Pourquoi cette page existe : avant elle, une entreprise pouvait réécrire ses
   relances automatiques (page Automatisations) mais PAS le texte de sa propre
   facture. Les dix modèles présents en base n'étaient exposés nulle part.

   Le principe : pas de bibliothèque de modèles à choisir. Chaque courriel a un
   texte d'origine, et l'entreprise écrit le sien par-dessus quand elle le veut.
   Son texte se pose DANS le gabarit commun — le bouton d'action, les numéros de
   taxes et le pied restent posés par le serveur, quoi qu'elle écrive. Elle ne
   peut pas produire un courriel où son client ne peut pas payer.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Loader2, Pencil, RotateCcw, Zap, ExternalLink, Check } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/ui';
import { confirmer } from '../../components/ui/ConfirmDialog';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import EmailPreviewEditor from '../../components/automations/EmailPreviewEditor';
import { CATALOGUE_COURRIELS, type EntreeCourriel } from '../../lib/catalogueCourriels';
import {
  listEmailTemplates,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  type EmailTemplate,
} from '../../lib/emailTemplatesApi';

/** Le courriel ouvert dans l'éditeur. */
interface Ouvert {
  entree: EntreeCourriel;
  type: string;
  modele: EmailTemplate | null;
}

/**
 * Le texte à afficher quand l'entreprise n'a encore rien écrit : celui que le
 * serveur envoie aujourd'hui. L'éditeur travaille en HTML simple, d'où le
 * paragraphe. Sans texte connu, on laisse vide plutôt que d'inventer une
 * phrase que le client ne recevrait jamais.
 */
function texteDeDepart(entree: EntreeCourriel, fr: boolean): string {
  const t = entree.texteOrigine?.[fr ? 'fr' : 'en'];
  return t ? `<p>${t}</p>` : '';
}

export default function EmailTemplatesSettings() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [modeles, setModeles] = useState<EmailTemplate[]>([]);
  const [chargement, setChargement] = useState(true);
  const [ouvert, setOuvert] = useState<Ouvert | null>(null);

  const charger = async () => {
    try {
      setModeles(await listEmailTemplates());
    } catch (e: any) {
      // Sans ce message, la page afficherait « texte d'origine » partout et
      // l'entreprise croirait avoir perdu ses textes.
      toast.error(e?.message || (fr ? 'Chargement impossible' : 'Could not load'));
    } finally {
      setChargement(false);
    }
  };

  useEffect(() => { void charger(); }, []);

  /** Le texte de l'entreprise pour un poste, s'il existe. */
  const parType = useMemo(() => {
    const m = new Map<string, EmailTemplate>();
    for (const t of modeles) if (t.is_active && !m.has(t.type)) m.set(t.type, t);
    return m;
  }, [modeles]);

  const enregistrer = async (o: Ouvert, corpsHtml: string, objet: string) => {
    if (o.modele) {
      await updateEmailTemplate(o.modele.id, { subject: objet, body: corpsHtml });
    } else {
      await createEmailTemplate({
        name: o.entree.titre[fr ? 'fr' : 'en'],
        type: o.type as EmailTemplate['type'],
        subject: objet,
        body: corpsHtml,
        variables: [],
        is_active: true,
      });
    }
  };

  const revenirAuDefaut = async (t: EmailTemplate, titre: string) => {
    const ok = await confirmer({
      title: fr ? 'Revenir au texte d’origine ?' : 'Restore the original text?',
      message: fr
        ? `Votre version de « ${titre} » sera supprimée. Le courriel repartira avec le texte d’origine.`
        : `Your version of “${titre}” will be deleted. The email will go back to its original text.`,
      confirmLabel: fr ? 'Revenir au texte d’origine' : 'Restore original',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteEmailTemplate(t.id);
      toast.success(fr ? 'Texte d’origine rétabli' : 'Original text restored');
      void charger();
    } catch (e: any) {
      toast.error(e?.message || (fr ? 'Suppression impossible' : 'Could not delete'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={fr ? 'Modèles de courriel' : 'Email templates'}
        subtitle={fr
          ? 'Les courriels que vos clients reçoivent. Modifiez le texte de chacun ; le bouton, vos coordonnées et vos numéros de taxes restent ajoutés automatiquement.'
          : 'The emails your clients receive. Edit any text; the action button, your contact details and tax numbers are always added for you.'}
      />

      {chargement ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          {fr ? 'Chargement…' : 'Loading…'}
        </div>
      ) : (
        <div className="space-y-8">
          {CATALOGUE_COURRIELS.map((groupe) => (
            <section key={groupe.cle}>
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
                {groupe.titre[fr ? 'fr' : 'en']}
              </h2>

              <ul className="space-y-2">
                {groupe.entrees.map((entree, i) => {
                  const modele = entree.type ? parType.get(entree.type) ?? null : null;
                  const titre = entree.titre[fr ? 'fr' : 'en'];
                  const estAuto = entree.origine === 'automatisation';

                  return (
                    <li
                      key={`${groupe.cle}-${entree.type ?? i}`}
                      className="flex items-center gap-3 rounded-xl border border-outline/60 bg-surface px-4 py-3"
                    >
                      <span
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                          estAuto ? 'bg-amber-500/10 text-amber-600' : 'bg-primary/10 text-primary',
                        )}
                        aria-hidden="true"
                      >
                        {estAuto ? <Zap className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[14px] font-medium text-text-primary">{titre}</span>
                          {entree.variantes ? (
                            <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] text-text-tertiary">
                              {fr ? `${entree.variantes} courriels` : `${entree.variantes} emails`}
                            </span>
                          ) : null}
                          {modele ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                              <Check className="h-3 w-3" aria-hidden="true" />
                              {fr ? 'Votre texte' : 'Your text'}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-[12px] text-text-secondary">
                          {entree.quand[fr ? 'fr' : 'en']}
                        </p>
                      </div>

                      {estAuto ? (
                        // Le texte d'une automatisation vit dans sa règle, pas
                        // dans email_templates : on envoie vers l'éditeur qui
                        // le possède plutôt que d'en copier une deuxième source.
                        <Link
                          to="/automations"
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-outline/60 px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-surface-secondary"
                        >
                          {fr ? 'Modifier' : 'Edit'}
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1.5">
                          {modele ? (
                            <button
                              type="button"
                              onClick={() => void revenirAuDefaut(modele, titre)}
                              className="rounded-lg p-2 text-text-tertiary hover:bg-surface-secondary hover:text-text-secondary"
                              aria-label={fr ? `Revenir au texte d’origine : ${titre}` : `Restore original: ${titre}`}
                              title={fr ? 'Revenir au texte d’origine' : 'Restore original'}
                            >
                              <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setOuvert({ entree, type: entree.type as string, modele })}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-outline/60 px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-surface-secondary"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            {fr ? 'Modifier' : 'Edit'}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {ouvert ? (
        <EmailPreviewEditor
          ruleName={ouvert.entree.titre[fr ? 'fr' : 'en']}
          /* Sans texte de départ, une entreprise qui vient corriger un mot
             tombait sur « Courriel vide » et devait tout réécrire. On ouvre
             donc sur le texte que le serveur envoie aujourd'hui. */
          body={ouvert.modele?.body ?? texteDeDepart(ouvert.entree, fr)}
          subject={ouvert.modele?.subject ?? ''}
          fr={fr}
          enregistrerTexte={(corpsHtml, objet) => enregistrer(ouvert, corpsHtml, objet)}
          onClose={() => setOuvert(null)}
          onSaved={() => { setOuvert(null); void charger(); }}
        />
      ) : null}
    </div>
  );
}
