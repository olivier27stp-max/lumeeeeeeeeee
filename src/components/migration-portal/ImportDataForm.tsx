// Formulaire « Importer vos données » du portail de migration (/migration/invite/:token).
// Une colonne, gros titres : une case à cocher et une zone de dépôt par catégorie, analyse
// immédiate avec « N clients détectés » (éléments uniques, pas lignes), doublons internes et
// lignes à corriger, catégorie déclarée qui fait foi sur la détection, puis « Continuer »
// vers la correspondance des colonnes (parcours existant). Rien ici ne déclenche l'import.
import { useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import {
  deletePortalFile, getPortalFileSummary, setPortalCategories, setPortalFileCategory, uploadPortalFile,
  type PortalFile, type PortalFileSummary, type PortalSession,
} from '../../lib/migrationPortalApi';

/** Catégories du formulaire : clé = MigrationCategory côté serveur. */
interface CategorieForm { key: string; fr: string; en: string; hintFr: string; hintEn: string; unitFr: [string, string]; unitEn: [string, string] }

export const CATEGORIES_PRINCIPALES: CategorieForm[] = [
  { key: 'clients', fr: 'Clients', en: 'Clients', hintFr: 'Nom, entreprise, courriel, téléphone, adresse.', hintEn: 'Name, company, email, phone, address.', unitFr: ['client', 'clients'], unitEn: ['client', 'clients'] },
  { key: 'properties', fr: 'Propriétés des clients', en: 'Client properties', hintFr: 'Adresses de service rattachées à un client.', hintEn: 'Service addresses attached to a client.', unitFr: ['propriété', 'propriétés'], unitEn: ['property', 'properties'] },
  { key: 'jobs', fr: 'Jobs ponctuels', en: 'One-off jobs', hintFr: 'Travaux uniques, avec leur numéro, client, dates et montant.', hintEn: 'One-time jobs with number, client, dates and amount.', unitFr: ['job', 'jobs'], unitEn: ['job', 'jobs'] },
  { key: 'recurring_jobs', fr: 'Plans de service récurrents', en: 'Recurring service plans', hintFr: 'Contrats d’entretien répétés (export « Recurring jobs »). Importés comme jobs récurrents ; la cadence reste dans les notes.', hintEn: 'Repeating maintenance plans ("Recurring jobs" export). Imported as recurring jobs; the cadence is kept in the notes.', unitFr: ['plan récurrent', 'plans récurrents'], unitEn: ['recurring plan', 'recurring plans'] },
  { key: 'visits', fr: 'Visites', en: 'Visits', hintFr: 'Rendez-vous planifiés, rattachés à un job par son numéro.', hintEn: 'Scheduled visits, attached to a job by its number.', unitFr: ['visite', 'visites'], unitEn: ['visit', 'visits'] },
  { key: 'invoices', fr: 'Factures', en: 'Invoices', hintFr: 'Une facture par numéro, même si le fichier a une ligne par service.', hintEn: 'One invoice per number, even when the file has one row per line item.', unitFr: ['facture', 'factures'], unitEn: ['invoice', 'invoices'] },
  { key: 'quotes', fr: 'Soumissions', en: 'Quotes', hintFr: 'Devis envoyés, approuvés ou convertis.', hintEn: 'Quotes sent, approved or converted.', unitFr: ['soumission', 'soumissions'], unitEn: ['quote', 'quotes'] },
];

export const CATEGORIES_AUTRES: CategorieForm[] = [
  { key: 'payments', fr: 'Paiements', en: 'Payments', hintFr: 'Encaissements rattachés à une facture par son numéro (montant, date, mode).', hintEn: 'Payments attached to an invoice by number (amount, date, method).', unitFr: ['paiement', 'paiements'], unitEn: ['payment', 'payments'] },
  { key: 'services', fr: 'Produits et services', en: 'Products and services', hintFr: 'Catalogue : nom, prix, taxable.', hintEn: 'Catalog: name, price, taxable.', unitFr: ['article', 'articles'], unitEn: ['item', 'items'] },
  { key: 'taxes', fr: 'Taxes', en: 'Taxes', hintFr: 'Nom, taux, région (TPS, TVQ…).', hintEn: 'Name, rate, region.', unitFr: ['taxe', 'taxes'], unitEn: ['tax', 'taxes'] },
  { key: 'billing_addresses', fr: 'Adresses de facturation', en: 'Billing addresses', hintFr: 'Quand l’adresse de facturation diffère de l’adresse de service.', hintEn: 'When billing differs from the service address.', unitFr: ['adresse', 'adresses'], unitEn: ['address', 'addresses'] },
];

const TOUTES = [...CATEGORIES_PRINCIPALES, ...CATEGORIES_AUTRES];
const ACCEPT = '.csv,.xlsx,.xls';

const PARSE_ERROR_FR: Record<string, string> = {
  empty_file: 'Le fichier est vide.',
  truncated: 'Fichier trop long : plus de 50 000 lignes, seules les premières ont été lues. Scindez l’export en plusieurs fichiers (idéalement moins de 20 000 lignes chacun).',
  binary_content: 'Ce n’est pas un fichier texte CSV.',
  not_excel: 'Ce n’est pas un classeur Excel valide.',
  excel_unreadable: 'Classeur Excel illisible.',
  download_failed: 'Téléchargement impossible, réessayez.',
  columns_insert_failed: 'Analyse interrompue, réessayez.',
  staging_insert_failed: 'Analyse interrompue, réessayez.',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function libelleCategorie(key: string | null | undefined, fr: boolean): string {
  const c = TOUTES.find((x) => x.key === key);
  return c ? (fr ? c.fr : c.en) : (key ?? '—');
}

/** Fichiers d'une catégorie : la zone de dépôt fait foi ; sinon la détection. */
function fichiersDe(files: PortalFile[], key: string): PortalFile[] {
  return files.filter((f) => f.kind === 'data' && ((f.category_declared ?? f.category_detected) === key));
}

interface EnvoiLocal { id: string; name: string; category: string; size: number }

export function ImportDataForm({ fr, token, session, files, onChanged, onContinue }: {
  fr: boolean; token: string; session: PortalSession; files: PortalFile[]; onChanged: () => void; onContinue: () => void;
}) {
  const qc = useQueryClient();
  const [envois, setEnvois] = useState<EnvoiLocal[]>([]);
  const [autresOuvert, setAutresOuvert] = useState(() => CATEGORIES_AUTRES.some((c) => fichiersDe(files, c.key).length > 0 || session.categories.includes(c.key)));
  const [cochees, setCochees] = useState<string[]>(() => session.categories ?? []);
  const canUpload = session.can_upload;

  // Résumés des fichiers analysés (une requête par fichier, mise en cache tant que le fichier ne change pas).
  const analysés = files.filter((f) => f.kind === 'data' && f.parse_status === 'parsed' && f.security_status !== 'rejected');
  const resumes = useQueries({
    queries: analysés.map((f) => ({
      queryKey: ['migration-portal-file-summary', token, f.id, f.row_count, f.category_declared ?? f.category_detected],
      queryFn: () => getPortalFileSummary(token, f.id),
      staleTime: 5 * 60_000,
      retry: 1,
    })),
  });
  const resumeParFichier = useMemo(() => {
    const m = new Map<string, PortalFileSummary | undefined>();
    analysés.forEach((f, i) => m.set(f.id, resumes[i]?.data));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépend des données des requêtes
  }, [analysés.map((f) => f.id).join(','), resumes.map((r) => r.dataUpdatedAt).join(',')]);

  async function cocher(key: string, on: boolean) {
    const next = on ? Array.from(new Set([...cochees, key])) : cochees.filter((k) => k !== key);
    if (next.length === 0) { toast.message(fr ? 'Gardez au moins une catégorie.' : 'Keep at least one category.'); return; }
    setCochees(next);
    try { await setPortalCategories(token, next); } catch (err: any) { toast.error(err?.message ?? 'Erreur'); setCochees(cochees); }
  }

  async function deposer(key: string, list: FileList | File[] | null) {
    const arr = Array.from(list ?? []);
    if (arr.length === 0) return;
    if (!cochees.includes(key)) void cocher(key, true);
    for (const file of arr) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setEnvois((e) => [...e, { id: localId, name: file.name, category: key, size: file.size }]);
      try {
        await uploadPortalFile(token, file, key);
        toast.success(fr ? `${file.name} reçu — analyse en cours` : `${file.name} received — analyzing`);
      } catch (err: any) {
        toast.error(`${file.name} : ${err?.message ?? (fr ? 'téléversement impossible' : 'upload failed')}`);
      } finally {
        setEnvois((e) => e.filter((x) => x.id !== localId));
      }
    }
    onChanged();
  }

  async function retirer(f: PortalFile) {
    try {
      await deletePortalFile(token, f.id);
      qc.removeQueries({ queryKey: ['migration-portal-file-summary', token, f.id] });
      toast.success(fr ? 'Fichier retiré' : 'File removed');
      onChanged();
    } catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
  }

  async function remplacer(f: PortalFile, key: string, list: FileList | null) {
    if (!list || list.length === 0) return;
    await retirer(f);
    await deposer(key, list);
  }

  async function reclasser(f: PortalFile, category: string) {
    try {
      await setPortalFileCategory(token, f.id, category);
      toast.success(fr ? `Classé sous « ${libelleCategorie(category, fr)} » — nouvelle analyse` : `Filed under "${libelleCategorie(category, fr)}" — re-analyzing`);
      onChanged();
    } catch (err: any) { toast.error(err?.message ?? 'Erreur'); }
  }

  const totalParCategorie = (key: string): number =>
    fichiersDe(files, key).reduce((acc, f) => acc + (resumeParFichier.get(f.id)?.unique ?? 0), 0);
  const nbAnalyses = analysés.length;
  const enCours = envois.length > 0 || files.some((f) => f.parse_status === 'parsing' || f.parse_status === 'pending');

  const bloc = (c: CategorieForm) => (
    <CategorieBloc
      key={c.key}
      c={c}
      fr={fr}
      cochee={cochees.includes(c.key)}
      canUpload={canUpload}
      fichiers={fichiersDe(files, c.key)}
      envois={envois.filter((e) => e.category === c.key)}
      resumes={resumeParFichier}
      onCocher={(on) => void cocher(c.key, on)}
      onDeposer={(list) => void deposer(c.key, list)}
      onRetirer={(f) => void retirer(f)}
      onRemplacer={(f, list) => void remplacer(f, c.key, list)}
      onReclasser={(f, cat) => void reclasser(f, cat)}
      onVoirCorrespondance={onContinue}
    />
  );

  return (
    <section className="rounded-xl border border-[#e6e2d8] bg-white shadow-sm">
      <div className="px-5 pt-6 pb-2 sm:px-7">
        <h2 className="text-[24px] sm:text-[28px] font-bold text-[#1a1a1a] leading-tight">{fr ? 'Importer vos données' : 'Import your data'}</h2>
        <p className="mt-1 text-[15px] text-[#6b675e]">{fr ? 'Quelles données souhaitez-vous importer ?' : 'Which data would you like to import?'}</p>
        <p className="mt-2 text-[12.5px] text-[#a09a8c]">
          {fr
            ? 'Cochez une catégorie, déposez un ou plusieurs fichiers CSV ou Excel : l’analyse démarre tout de suite. Rien n’est importé avant votre approbation.'
            : 'Tick a category, drop one or more CSV or Excel files: analysis starts right away. Nothing is imported before your approval.'}
        </p>
        {!canUpload && (
          <p className="mt-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[13px] px-3 py-2">
            {fr ? 'Le dépôt de fichiers n’est pas disponible à cette étape.' : 'File upload is not available at this stage.'}
          </p>
        )}
      </div>

      <div className="px-5 sm:px-7 py-4 space-y-3">
        {CATEGORIES_PRINCIPALES.map(bloc)}
      </div>

      <div className="px-5 sm:px-7 pb-4">
        <button type="button" onClick={() => setAutresOuvert((o) => !o)} className="w-full flex items-center gap-2 text-left py-2">
          {autresOuvert ? <ChevronDown size={16} className="text-[#8a8578]" /> : <ChevronRight size={16} className="text-[#8a8578]" />}
          <span className="text-[17px] font-semibold text-[#1a1a1a]">{fr ? 'Autres données' : 'Other data'}</span>
          <span className="text-[12px] text-[#a09a8c]">{fr ? 'paiements, catalogue, taxes, adresses de facturation' : 'payments, catalog, taxes, billing addresses'}</span>
        </button>
        {autresOuvert && <div className="space-y-3 mt-1">{CATEGORIES_AUTRES.map(bloc)}</div>}
      </div>

      <div className="px-5 sm:px-7 py-4 border-t border-[#f0ece2] flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="text-[13px] text-[#6b675e] flex-1 min-w-0">
          {nbAnalyses === 0
            ? (fr ? 'Aucun fichier analysé pour l’instant.' : 'No file analyzed yet.')
            : (fr ? 'Détecté : ' : 'Detected: ') + TOUTES.filter((c) => totalParCategorie(c.key) > 0).map((c) => `${totalParCategorie(c.key)} ${(fr ? c.unitFr : c.unitEn)[totalParCategorie(c.key) > 1 ? 1 : 0]}`).join(' · ')}
          {enCours && <span className="ml-2 inline-flex items-center gap-1 text-[#8a8578]"><Loader2 size={12} className="animate-spin" /> {fr ? 'analyse en cours' : 'analyzing'}</span>}
        </div>
        <button
          type="button"
          disabled={nbAnalyses === 0}
          onClick={onContinue}
          className="h-11 px-6 rounded-md bg-[#d8d0c2] text-black hover:bg-[#cabfad] text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {fr ? 'Continuer' : 'Continue'}
        </button>
      </div>
    </section>
  );
}

function CategorieBloc({ c, fr, cochee, canUpload, fichiers, envois, resumes, onCocher, onDeposer, onRetirer, onRemplacer, onReclasser, onVoirCorrespondance }: {
  c: CategorieForm; fr: boolean; cochee: boolean; canUpload: boolean; fichiers: PortalFile[]; envois: EnvoiLocal[];
  resumes: Map<string, PortalFileSummary | undefined>;
  onCocher: (on: boolean) => void; onDeposer: (list: FileList | File[] | null) => void; onRetirer: (f: PortalFile) => void;
  onRemplacer: (f: PortalFile, list: FileList | null) => void; onReclasser: (f: PortalFile, category: string) => void; onVoirCorrespondance: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ouvert = cochee || fichiers.length > 0 || envois.length > 0;
  const total = fichiers.reduce((acc, f) => acc + (resumes.get(f.id)?.unique ?? 0), 0);
  const unit = (fr ? c.unitFr : c.unitEn)[total > 1 ? 1 : 0];

  return (
    <div className={`rounded-lg border ${ouvert ? 'border-[#d8d0c2] bg-[#fbfaf7]' : 'border-[#e6e2d8] bg-white'} p-4`}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" aria-label={fr ? c.fr : c.en} checked={cochee} onChange={(e) => onCocher(e.target.checked)} disabled={!canUpload && !cochee} className="mt-1 h-5 w-5 accent-[#8a8578]" />
        <span className="flex-1 min-w-0">
          <span className="block text-[18px] font-semibold text-[#1a1a1a] leading-snug">{fr ? c.fr : c.en}</span>
          <span className="block text-[12.5px] text-[#8a8578] mt-0.5">{fr ? c.hintFr : c.hintEn}</span>
        </span>
        {total > 0 && <span className="shrink-0 text-[13px] font-semibold text-emerald-700 whitespace-nowrap">{total} {unit}</span>}
      </label>

      {ouvert && (
        <div className="mt-3 space-y-2">
          {canUpload && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); onDeposer(e.dataTransfer.files); }}
              className={`flex items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-4 cursor-pointer transition-colors text-[13px] ${dragging ? 'border-[#b9ae99] bg-[#f4f1ea]' : 'border-[#e6e2d8] bg-white hover:bg-[#f4f1ea]'}`}
            >
              <UploadCloud size={18} className="text-[#8a8578]" />
              <span className="text-[#6b675e]">{fr ? 'Déposer un fichier CSV ou Excel, ou cliquer pour choisir' : 'Drop a CSV or Excel file, or click to choose'}</span>
              <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" aria-label={fr ? `Fichiers ${c.fr}` : `${c.en} files`} onChange={(e) => { onDeposer(e.target.files); e.target.value = ''; }} />
            </div>
          )}
          {envois.map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-md border border-[#e6e2d8] bg-white px-3 py-2 text-[13px]">
              <Loader2 size={14} className="animate-spin text-[#8a8578]" />
              <span className="truncate font-medium text-[#444]">{e.name}</span>
              <span className="text-[#a09a8c]">{formatBytes(e.size)} · {fr ? 'téléversement…' : 'uploading…'}</span>
            </div>
          ))}
          {fichiers.map((f) => (
            <FichierLigne key={f.id} f={f} c={c} fr={fr} canUpload={canUpload} resume={resumes.get(f.id)} onRetirer={() => onRetirer(f)} onRemplacer={(list) => onRemplacer(f, list)} onReclasser={(cat) => onReclasser(f, cat)} onVoirCorrespondance={onVoirCorrespondance} />
          ))}
        </div>
      )}
    </div>
  );
}

function FichierLigne({ f, c, fr, canUpload, resume, onRetirer, onRemplacer, onReclasser, onVoirCorrespondance }: {
  f: PortalFile; c: CategorieForm; fr: boolean; canUpload: boolean; resume: PortalFileSummary | undefined;
  onRetirer: () => void; onRemplacer: (list: FileList | null) => void; onReclasser: (category: string) => void; onVoirCorrespondance: () => void;
}) {
  const [details, setDetails] = useState(false);
  const remplaceRef = useRef<HTMLInputElement | null>(null);
  const rejete = f.security_status === 'rejected';
  const enAnalyse = !rejete && (f.parse_status === 'parsing' || f.parse_status === 'pending');
  const echec = rejete || f.parse_status === 'failed';
  const analyse = !rejete && f.parse_status === 'parsed';
  const declared = f.category_declared ?? null;
  const detected = f.category_detected ?? null;
  const desaccord = !!declared && !!detected && declared !== detected && !(declared === 'recurring_jobs' && detected === 'jobs');
  const unit = (fr ? c.unitFr : c.unitEn)[(resume?.unique ?? 0) > 1 ? 1 : 0];
  const aCorriger = (resume?.invalid ?? 0) + (resume?.needs_review ?? 0) + (resume?.required_missing?.length ?? 0);
  const motifErreur = echec ? (PARSE_ERROR_FR[f.parse_error ?? ''] ?? (rejete ? (fr ? 'Fichier refusé par le contrôle de sécurité.' : 'File rejected by the security check.') : (fr ? 'Analyse impossible.' : 'Analysis failed.'))) : null;

  return (
    <div className={`rounded-md border ${echec ? 'border-red-200 bg-red-50/40' : 'border-[#e6e2d8] bg-white'} px-3 py-2.5 text-[13px]`}>
      <div className="flex items-center gap-2 flex-wrap">
        {enAnalyse ? <Loader2 size={14} className="animate-spin text-[#8a8578] shrink-0" /> : echec ? <AlertCircle size={14} className="text-red-600 shrink-0" /> : <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />}
        <span className="truncate font-medium text-[#1a1a1a] min-w-0 flex-1">{f.original_name}</span>
        <span className="text-[#a09a8c] whitespace-nowrap">{formatBytes(f.size_bytes)}</span>
        {canUpload && (
          <span className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={() => remplaceRef.current?.click()} aria-label={fr ? 'Remplacer le fichier' : 'Replace file'} title={fr ? 'Remplacer' : 'Replace'} className="h-7 w-7 inline-flex items-center justify-center rounded text-[#8a8578] hover:text-[#1a1a1a] hover:bg-[#f4f1ea]"><RefreshCw size={14} /></button>
            <input ref={remplaceRef} type="file" accept={ACCEPT} className="hidden" aria-label={fr ? 'Remplacer le fichier' : 'Replace file'} onChange={(e) => { onRemplacer(e.target.files); e.target.value = ''; }} />
            <button type="button" onClick={onRetirer} aria-label={fr ? 'Retirer le fichier' : 'Remove file'} title={fr ? 'Retirer' : 'Remove'} className="h-7 w-7 inline-flex items-center justify-center rounded text-[#8a8578] hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
          </span>
        )}
      </div>

      {enAnalyse && <p className="mt-1 text-[#8a8578]">{fr ? 'Analyse en cours…' : 'Analyzing…'}</p>}
      {motifErreur && <p className="mt-1 text-red-700">{motifErreur}</p>}

      {analyse && (
        <div className="mt-1.5">
          {resume ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-semibold text-emerald-800">
                {resume.identifiers_ok
                  ? `${resume.unique} ${unit} ${fr ? 'détecté' + (resume.unique > 1 ? 's' : '') : 'detected'}`
                  : `${resume.rows} ${fr ? 'lignes lues' : 'rows read'}`}
              </span>
              {resume.internal_duplicates > 0 && <span className="text-[12px] text-[#6b675e]">· {resume.internal_duplicates} {fr ? 'doublon(s) interne(s) regroupé(s)' : 'internal duplicate(s) merged'}</span>}
              {aCorriger > 0 && <span className="text-[12px] text-amber-700 font-medium">· {aCorriger} {fr ? 'à corriger' : 'to fix'}</span>}
              <button type="button" onClick={() => setDetails((d) => !d)} className="text-[12px] text-[#6b675e] underline ml-auto">{details ? (fr ? 'Masquer' : 'Hide') : (fr ? 'Détails' : 'Details')}</button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 text-[#8a8578]"><Loader2 size={12} className="animate-spin" /> {fr ? 'Calcul du résumé…' : 'Computing summary…'}</span>
          )}

          {desaccord && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-[12.5px] flex items-center gap-2 flex-wrap">
              <AlertCircle size={14} className="shrink-0" />
              <span className="flex-1 min-w-0">
                {fr
                  ? `Déposé sous « ${libelleCategorie(declared, fr)} », mais les colonnes ressemblent à « ${libelleCategorie(detected, fr)} ».`
                  : `Filed under "${libelleCategorie(declared, fr)}", but the columns look like "${libelleCategorie(detected, fr)}".`}
              </span>
              {canUpload && detected && (
                <button type="button" onClick={() => onReclasser(detected)} className="h-8 px-3 rounded-md bg-white border border-amber-300 hover:bg-amber-100 font-medium whitespace-nowrap">
                  {fr ? `Classer sous « ${libelleCategorie(detected, fr)} »` : `File under "${libelleCategorie(detected, fr)}"`}
                </button>
              )}
            </div>
          )}

          {resume && !resume.identifiers_ok && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-[12.5px]">
              {fr
                ? `Impossible de reconnaître les éléments uniques : aucune colonne mappée vers ${resume.identifier_labels.join(', ')}. `
                : `Unique items cannot be recognized: no column mapped to ${resume.identifier_labels.join(', ')}. `}
              <button type="button" onClick={onVoirCorrespondance} className="underline font-medium">{fr ? 'Corriger la correspondance des champs' : 'Fix the field mapping'}</button>
            </div>
          )}

          {details && resume && (
            <ul className="mt-2 space-y-1 text-[12.5px] text-[#444]">
              <li>· {fr ? 'Lignes lues' : 'Rows read'} : {resume.rows} — {fr ? 'éléments distincts' : 'distinct items'} : {resume.unique}</li>
              {resume.internal_duplicates > 0 && <li>· {fr ? 'Doublons internes' : 'Internal duplicates'} : {resume.internal_duplicates} ({fr ? 'même courriel, téléphone ou numéro : une seule fiche sera créée' : 'same email, phone or number: a single record will be created'})</li>}
              {resume.invalid > 0 && (
                <li>· {fr ? 'Lignes à corriger' : 'Rows to fix'} : {resume.invalid}
                  {resume.invalid_reasons.length > 0 && <span className="text-[#8a8578]"> — {resume.invalid_reasons.map((r) => `${r.reason} ×${r.count}`).join(', ')}</span>}
                </li>
              )}
              {resume.required_missing.length > 0 && <li className="text-amber-800">· {fr ? 'Champs obligatoires sans colonne' : 'Required fields without a column'} : {resume.required_missing.join(', ')}</li>}
              {resume.needs_review > 0 && (
                <li className="text-amber-800">· {resume.needs_review} {fr ? 'colonne(s) à confirmer' : 'column(s) to confirm'} — <button type="button" onClick={onVoirCorrespondance} className="underline">{fr ? 'vérifier la correspondance' : 'check the mapping'}</button></li>
              )}
              {resume.invalid === 0 && resume.needs_review === 0 && resume.required_missing.length === 0 && <li className="text-emerald-700">· {fr ? 'Rien à corriger dans ce fichier.' : 'Nothing to fix in this file.'}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
