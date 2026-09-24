/**
 * Importer des deals depuis un CSV.
 *
 * On montre ce qu'on a compris AVANT d'écrire quoi que ce soit : l'aperçu
 * n'est pas une politesse, c'est ce qui évite de découvrir après coup que
 * quarante lignes sont parties avec le nom dans la colonne du téléphone.
 *
 * Chaque ligne passe par `creerDealManuel`, donc par la même porte que le
 * formulaire public : rapprochement par téléphone ou courriel, première
 * étape ouverte, non assigné. Un client déjà connu n'est jamais dupliqué —
 * il est retrouvé, et le deal s'ajoute à son dossier.
 */
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import Modal from '../ui/Modal';
import { useTranslation } from '../../i18n';
import { creerDealManuel, journaliserLot } from '../../lib/pipelineVentesApi';
import { analyserCsv, type AnalyseCsv, type LigneImport } from '../../lib/pipeline/importCsv';

/** Au-delà, on refuse : un import de cette taille mérite le vrai outil de migration. */
const MAX_LIGNES = 500;

function messageErreur(code: string, fr: boolean): string {
  if (code === 'fichier_vide') return fr ? 'Le fichier est vide.' : 'The file is empty.';
  if (code === 'aucune_donnee') {
    return fr ? "Le fichier ne contient que son en-tête." : 'The file only has a header row.';
  }
  return fr
    ? "Aucune colonne reconnue. Il faut au moins une colonne de nom, et une de courriel ou de téléphone."
    : 'No column recognised. At least a name column and an email or phone column are needed.';
}

function messageProbleme(code: string, fr: boolean): string {
  if (code === 'sans_nom') return fr ? 'sans nom' : 'no name';
  return fr ? 'ni courriel ni téléphone' : 'no email or phone';
}

export default function ImportCsvModal({ ouvert, onFermer, onImporte }: {
  ouvert: boolean;
  onFermer: () => void;
  /** Appelé après un import réussi, pour que le board recharge. */
  onImporte: () => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idFichier = useId();
  const champFichier = useRef<HTMLInputElement>(null);

  const [analyse, setAnalyse] = useState<AnalyseCsv | null>(null);
  const [nomFichier, setNomFichier] = useState('');
  const [enCours, setEnCours] = useState(false);

  if (!ouvert) return null;

  function reinitialiser() {
    setAnalyse(null);
    setNomFichier('');
    if (champFichier.current) champFichier.current.value = '';
  }

  async function lireFichier(f: File) {
    setNomFichier(f.name);
    try {
      const texte = await f.text();
      setAnalyse(analyserCsv(texte));
    } catch (e) {
      console.error('[ImportCsv] lecture du fichier', e);
      toast.error(fr ? 'Fichier illisible.' : 'Unreadable file.');
      reinitialiser();
    }
  }

  const bonnes: LigneImport[] = (analyse?.lignes ?? []).filter((l) => l.probleme === '');
  const mauvaises: LigneImport[] = (analyse?.lignes ?? []).filter((l) => l.probleme !== '');
  const tropGrand = bonnes.length > MAX_LIGNES;

  async function importer() {
    if (enCours || bonnes.length === 0 || tropGrand) return;
    setEnCours(true);
    let crees = 0;
    let fusionnes = 0;
    let echecs = 0;

    // Une ligne à la fois : `ingest_lead` rapproche les contacts, et deux
    // lignes du MÊME client envoyées en parallèle créeraient deux clients
    // avant que l'une ait pu voir l'autre.
    for (const l of bonnes) {
      try {
        const r = await creerDealManuel({
          prenom: l.prenom || l.nom,
          nom: l.prenom ? l.nom : null,
          courriel: l.courriel || null,
          telephone: l.telephone || null,
          adresse: l.adresse || null,
        });
        if (r.fusionne || r.dealExistant) fusionnes++; else crees++;
      } catch (e) {
        echecs++;
        console.error('[ImportCsv] ligne', l.ligne, e);
      }
    }

    // Le journal : un import de 40 lignes dont 12 échouent doit laisser une
    // trace consultable, pas seulement un toast qui disparaît.
    void journaliserLot({
      libelle: fr ? `Import — ${nomFichier}` : `Import — ${nomFichier}`,
      operation: 'import',
      statut: echecs === 0 ? 'termine' : echecs === bonnes.length ? 'echoue' : 'partiel',
      total: bonnes.length,
      reussis: crees + fusionnes,
      echoues: echecs,
      erreurs: mauvaises.slice(0, 30).map((l) =>
        fr ? `Ligne ${l.ligne} — ${messageProbleme(l.probleme, true)}`
           : `Row ${l.ligne} — ${messageProbleme(l.probleme, false)}`),
    });

    setEnCours(false);
    onImporte();
    reinitialiser();
    onFermer();

    // On dit les trois nombres, pas seulement le bon : « 40 importés » alors
    // que 12 ont échoué est un mensonge qu'on découvre en comptant les cartes.
    const parts = [
      fr ? `${crees} deal(s) créé(s)` : `${crees} deal(s) created`,
      fusionnes > 0
        ? (fr ? `${fusionnes} rattaché(s) à un client existant` : `${fusionnes} matched to an existing client`)
        : '',
      echecs > 0 ? (fr ? `${echecs} en échec` : `${echecs} failed`) : '',
    ].filter(Boolean);

    if (echecs > 0) toast.error(parts.join(' · '));
    else toast.success(parts.join(' · '));
  }

  return (
    <Modal open onClose={onFermer} size="lg" title={fr ? 'Importer des deals' : 'Import deals'}>
      <div className="space-y-4">
        <div>
          <label htmlFor={idFichier} className="mb-1.5 block text-[12px] text-text-secondary">
            {fr ? 'Fichier CSV' : 'CSV file'}
          </label>
          <input
            id={idFichier}
            ref={champFichier}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void lireFichier(f);
            }}
            className="block w-full text-[12.5px] text-text-secondary file:mr-3 file:rounded-lg file:border file:border-outline file:bg-surface-secondary file:px-3 file:py-1.5 file:text-[12px] file:text-text-primary"
          />
          <p className="mt-1.5 text-[11px] text-text-muted">
            {fr
              ? "Une colonne de nom, plus une de courriel ou de téléphone. Les en-têtes français et anglais sont reconnus, ainsi que le point-virgule d'Excel."
              : "A name column, plus an email or phone column. French and English headers are recognised, as is Excel's semicolon."}
          </p>
        </div>

        {analyse?.erreur && (
          <p className="rounded-xl border border-outline bg-surface-secondary px-3.5 py-2.5 text-[12.5px] text-text-secondary">
            {messageErreur(analyse.erreur, fr)}
          </p>
        )}

        {analyse && !analyse.erreur && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border border-outline bg-surface-secondary px-3.5 py-2.5">
              <span className="text-[12.5px] font-semibold text-text-primary">
                {fr ? `${bonnes.length} deal(s) à importer` : `${bonnes.length} deal(s) to import`}
              </span>
              {mauvaises.length > 0 && (
                <span className="text-[12px]" style={{ color: 'var(--color-warning)' }}>
                  {fr ? `${mauvaises.length} ligne(s) ignorée(s)` : `${mauvaises.length} row(s) skipped`}
                </span>
              )}
              <span className="text-[11px] text-text-muted">{nomFichier}</span>
            </div>

            {analyse.colonnesIgnorees.length > 0 && (
              <p className="text-[11.5px] text-text-muted">
                {fr ? 'Colonnes non utilisées : ' : 'Unused columns: '}
                {analyse.colonnesIgnorees.join(', ')}
              </p>
            )}

            {tropGrand && (
              <p
                className="rounded-xl border px-3.5 py-2.5 text-[12.5px]"
                style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
              >
                {fr
                  ? `Plus de ${MAX_LIGNES} lignes : passe par l'outil de migration, fait pour les gros volumes.`
                  : `More than ${MAX_LIGNES} rows: use the migration tool, built for large volumes.`}
              </p>
            )}

            {/* L'aperçu : ce qu'on a compris, avant d'écrire. */}
            {bonnes.length > 0 && (
              <div className="max-h-[240px] overflow-auto rounded-xl border border-outline">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-surface-secondary">
                    <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-tertiary">
                      <th scope="col" className="px-3 py-1.5 font-semibold">{fr ? 'Nom' : 'Name'}</th>
                      <th scope="col" className="px-3 py-1.5 font-semibold">{fr ? 'Courriel' : 'Email'}</th>
                      <th scope="col" className="px-3 py-1.5 font-semibold">{fr ? 'Téléphone' : 'Phone'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {bonnes.slice(0, 20).map((l) => (
                      <tr key={l.ligne}>
                        <td className="px-3 py-1.5 text-text-primary">{`${l.prenom} ${l.nom}`.trim()}</td>
                        <td className="px-3 py-1.5 text-text-secondary">{l.courriel || '—'}</td>
                        <td className="px-3 py-1.5 text-text-secondary">{l.telephone || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bonnes.length > 20 && (
                  <p className="px-3 py-1.5 text-[11px] text-text-muted">
                    {fr ? `… et ${bonnes.length - 20} autres` : `… and ${bonnes.length - 20} more`}
                  </p>
                )}
              </div>
            )}

            {/* Les lignes écartées, avec la raison : elles ne disparaissent
                pas en silence. */}
            {mauvaises.length > 0 && (
              <details className="rounded-xl border border-outline px-3.5 py-2">
                <summary className="cursor-pointer text-[12px] text-text-secondary">
                  {fr ? `Voir les ${mauvaises.length} ligne(s) ignorée(s)` : `See the ${mauvaises.length} skipped row(s)`}
                </summary>
                <ul className="mt-2 space-y-0.5">
                  {mauvaises.slice(0, 30).map((l) => (
                    <li key={l.ligne} className="text-[11.5px] text-text-muted">
                      {fr ? `Ligne ${l.ligne}` : `Row ${l.ligne}`} — {messageProbleme(l.probleme, fr)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-[12.5px]" onClick={onFermer}>
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={enCours || bonnes.length === 0 || tropGrand}
            onClick={() => { void importer(); }}
            className="btn-primary text-[12.5px] disabled:opacity-50"
          >
            {enCours
              ? (fr ? 'Import en cours…' : 'Importing…')
              : (fr ? `Importer ${bonnes.length || ''}`.trim() : `Import ${bonnes.length || ''}`.trim())}
          </button>
        </div>
      </div>
    </Modal>
  );
}
