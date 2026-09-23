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
import { Loader2, Zap, ExternalLink, Check } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/ui';
import { confirmer } from '../../components/ui/ConfirmDialog';
import EmailPreviewEditor from '../../components/automations/EmailPreviewEditor';
import ImportHtmlCourriel from '../../components/settings/ImportHtmlCourriel';
import { CATALOGUE_COURRIELS, type EntreeCourriel } from '../../lib/catalogueCourriels';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
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

/**
 * La vignette d'un courriel : ce que le client verra, en petit.
 *
 * Elle reprend le décor du gabarit serveur — fond gris, filet de la couleur de
 * l'entreprise, carte blanche — pour qu'on reconnaisse le bon modèle sans lire
 * son titre. Volontairement schématique : c'est un repère, pas un aperçu. Le
 * vrai aperçu est dans l'éditeur, rendu par le serveur.
 *
 * Les couleurs sont écrites en dur plutôt qu'en classes de thème : un courriel
 * ne suit pas le mode sombre de l'app, il arrive tel quel dans la boîte.
 */
function MiniatureCourriel({ couleur, avecMontant }: { couleur: string; avecMontant: boolean }) {
  return (
    <div className="h-[86px] overflow-hidden px-3 pt-0" style={{ background: '#f4f5f7' }} aria-hidden="true">
      <div style={{ height: 3, background: couleur, margin: '0 -12px 8px' }} />
      <div style={{ background: '#fff', border: '1px solid #e4e7ec', borderRadius: 7, padding: '6px 8px' }}>
        {avecMontant ? (
          <div style={{ fontSize: 13, fontWeight: 800, color: '#101828', letterSpacing: '-0.5px', textAlign: 'center', margin: '2px 0 4px' }}>
            1 220,17 $
          </div>
        ) : (
          <div style={{ height: 3, background: '#eceef2', borderRadius: 2, margin: '4px 0' }} />
        )}
        <div style={{ height: 3, background: '#eceef2', borderRadius: 2, marginTop: 3 }} />
        <div style={{ height: 3, width: '62%', background: '#eceef2', borderRadius: 2, marginTop: 3 }} />
        <div style={{ height: 9, background: couleur, borderRadius: 3, marginTop: 5 }} />
      </div>
    </div>
  );
}

export default function EmailTemplatesSettings() {
  /* `fr` est ici la langue des COURRIELS, pas celle de l'interface.

     La page lisait `useTranslation()` : quelqu'un dont l'app est en anglais
     voyait les textes d'origine en anglais et les enregistrait par-dessus,
     alors que le serveur envoie dans la langue de l'entreprise
     (`company_settings.default_language`, cf. `langueEntreprise`). Ses clients
     recevaient donc soudain de l'anglais — au Québec, un problème de loi 101
     autant que d'exactitude.

     Le défaut est le français : `langueDe` côté serveur en fait autant, et la
     colonne `default_language` vaut 'fr' en base. */
  const [langueCourriels, setLangueCourriels] = useState<'fr' | 'en'>('fr');
  const fr = langueCourriels === 'fr';

  const [modeles, setModeles] = useState<EmailTemplate[]>([]);
  const [chargement, setChargement] = useState(true);
  const [ouvert, setOuvert] = useState<Ouvert | null>(null);
  const [aImporter, setAImporter] = useState<Ouvert | null>(null);
  /* La couleur de l'entreprise, pour que les vignettes montrent SES courriels
     et pas un gris générique. `#111827` est le repli du gabarit serveur
     (`COULEUR_LUME`) : une couleur absente ou trop pâle y aboutit aussi. */
  const [couleurMarque, setCouleurMarque] = useState('#111827');

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

  /* La couleur de l'entreprise, pour les vignettes. Best-effort : si la
     lecture échoue, elles gardent le noir de repli — une vignette grise vaut
     mieux qu'une page qui ne s'affiche pas pour un détail décoratif. */
  useEffect(() => {
    void (async () => {
      try {
        const orgId = await getCurrentOrgIdOrThrow();
        const { data } = await supabase
          .from('company_settings')
          .select('brand_color, default_language')
          .eq('org_id', orgId)
          .limit(1)
          .maybeSingle();
        const c = String(data?.brand_color || '').trim();
        if (/^#[0-9a-f]{6}$/i.test(c)) setCouleurMarque(c);
        // Même règle que `langueDe` côté serveur : tout ce qui n'est pas
        // explicitement anglais est du français.
        if (String(data?.default_language || '').toLowerCase().startsWith('en')) setLangueCourriels('en');
      } catch {
        // Le repli suffit : rien à signaler au propriétaire pour une vignette.
      }
    })();
  }, []);

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

  const importer = async (o: Ouvert, html: string) => {
    if (o.modele) {
      await updateEmailTemplate(o.modele.id, { body: html, source: 'import' });
    } else {
      await createEmailTemplate({
        name: o.entree.titre[fr ? 'fr' : 'en'],
        type: o.type,
        subject: o.entree.objetOrigine?.[fr ? 'fr' : 'en'] ?? '',
        body: html,
        variables: [],
        is_active: true,
        source: 'import',
      });
    }
    void charger();
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

  /* Les cinq courriels qu'on modifie ICI, et le compte de ceux qui vivent
     ailleurs. La page affichait les 27 entrées du catalogue à plat : 22
     d'entre elles ne faisaient qu'un lien vers /automations, et occupaient
     80 % de l'écran pour ça. On les replie en UNE ligne. */
  const { editables, nbAutomatisations } = useMemo(() => {
    const e: EntreeCourriel[] = [];
    let n = 0;
    for (const groupe of CATALOGUE_COURRIELS) {
      for (const entree of groupe.entrees) {
        if (entree.origine === 'automatisation') n += entree.variantes ?? 1;
        else if (entree.type) e.push(entree);
      }
    }
    return { editables: e, nbAutomatisations: n };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modèles de courriel"
        subtitle="Le texte que vos clients reçoivent. Le bouton, vos coordonnées et vos numéros de taxes s’ajoutent tout seuls."
      />

      {chargement ? (
        <div className="flex items-center gap-2 text-text-secondary text-sm">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Chargement…
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
              Vos courriels
            </h2>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {editables.map((entree) => {
                const modele = parType.get(entree.type as string) ?? null;
                const titre = entree.titre.fr;
                return (
                  <article
                    key={entree.type}
                    className="flex flex-col overflow-hidden rounded-xl border border-outline/60 bg-surface"
                  >
                    <MiniatureCourriel couleur={couleurMarque} avecMontant={entree.type !== 'quote_sent' && entree.type !== 'contract_sent'} />

                    <div className="flex flex-1 flex-col gap-0.5 px-4 pb-3 pt-3">
                      <h3 className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-text-primary">
                        {titre}
                        {modele ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                            <Check className="h-3 w-3" aria-hidden="true" />
                            Modifié
                          </span>
                        ) : null}
                      </h3>
                      <p className="text-[12.5px] text-text-tertiary">{entree.quand.fr}</p>
                    </div>

                    <div className="px-4 pb-4">
                      <button
                        type="button"
                        onClick={() => setOuvert({ entree, type: entree.type as string, modele })}
                        className="w-full rounded-lg border border-outline/60 px-3 py-2 text-[13px] font-semibold text-text-secondary hover:bg-surface-secondary"
                      >
                        Modifier
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Les relances : une seule ligne, et la flèche annonce le changement
              de page. Leur texte vit dans la règle d'automatisation, pas dans
              email_templates — le déplacer casserait les textes que des
              entreprises ont déjà personnalisés là-bas. */}
          <section>
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-tertiary mb-3">
              Les relances automatiques
            </h2>

            <Link
              to="/automations"
              className="flex items-center gap-3 rounded-xl border border-outline/60 bg-surface px-4 py-3.5 hover:bg-surface-secondary"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600" aria-hidden="true">
                <Zap className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-text-primary">
                  {nbAutomatisations} relances automatiques
                </span>
                <span className="block text-[12.5px] text-text-tertiary">
                  Soumissions, factures, rendez-vous, avis — chacune avec son délai
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-outline/60 px-3 py-1.5 text-[13px] font-semibold text-text-secondary">
                Ouvrir
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </Link>
          </section>
        </div>
      )}

      {ouvert ? (
        <EmailPreviewEditor
          ruleName={ouvert.entree.titre[fr ? 'fr' : 'en']}
          /* Sans texte de départ, une entreprise qui vient corriger un mot
             tombait sur « Courriel vide » et devait tout réécrire. On ouvre
             donc sur le texte que le serveur envoie aujourd'hui. */
          body={ouvert.modele?.body ?? texteDeDepart(ouvert.entree, fr)}
          /* L'objet s'ouvrait VIDE : l'entreprise ne voyait pas ce qu'elle
             remplaçait, et un champ laissé vide n'enregistre rien. */
          subject={ouvert.modele?.subject ?? ouvert.entree.objetOrigine?.[fr ? 'fr' : 'en'] ?? ''}
          fr={fr}
          typeCourriel={ouvert.type}
          enregistrerTexte={(corpsHtml, objet) => enregistrer(ouvert, corpsHtml, objet)}
          /* Les deux actions rares. `revenirAuDefaut` n'existe QUE si
             l'entreprise a écrit quelque chose : sans texte à elle, il n'y a
             rien à défaire, et le bouton ne s'affiche pas. */
          revenirAuDefaut={ouvert.modele
            ? async () => {
                await revenirAuDefaut(ouvert.modele as EmailTemplate, ouvert.entree.titre.fr);
                setOuvert(null);
              }
            : undefined}
          importerHtml={() => { setOuvert(null); setAImporter(ouvert); }}
          onClose={() => setOuvert(null)}
          onSaved={() => { setOuvert(null); void charger(); }}
        />
      ) : null}

      {aImporter ? (
        <ImportHtmlCourriel
          titreCourriel={aImporter.entree.titre[fr ? 'fr' : 'en']}
          fr={fr}
          onImporter={(html) => importer(aImporter, html)}
          onClose={() => setAImporter(null)}
        />
      ) : null}
    </div>
  );
}
