import React, { useCallback, useState } from 'react';
import { Download, Loader2, ChevronDown, ChevronRight, FileSpreadsheet, Users, Receipt, Wallet, Package } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import BackToSettings from '../components/ui/BackToSettings';
import { supabase } from '../lib/supabase';

type Kind = 'customers' | 'invoices' | 'payments' | 'items';

interface CardConfig {
  kind: Kind;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  withRange: boolean;
}

const CARDS: CardConfig[] = [
  { kind: 'customers', icon: Users, withRange: false },
  { kind: 'invoices', icon: Receipt, withRange: true },
  { kind: 'payments', icon: Wallet, withRange: true },
  { kind: 'items', icon: Package, withRange: false },
];

async function downloadCsv(kind: Kind, from: string, to: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || '';
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/quickbooks-export/${kind}.csv${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  // Filename from Content-Disposition or fallback
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || `lume-quickbooks-${kind}.csv`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function QuickBooksExport() {
  const { t, language } = useTranslation();
  const isFr = language === 'fr';
  const tr = (t as any).quickbooks || {};

  const [loading, setLoading] = useState<Record<Kind, boolean>>({
    customers: false, invoices: false, payments: false, items: false,
  });
  const [lastExported, setLastExported] = useState<Record<Kind, string | null>>({
    customers: null, invoices: null, payments: null, items: null,
  });
  const [from, setFrom] = useState<Record<Kind, string>>({ customers: '', invoices: '', payments: '', items: '' });
  const [to, setTo] = useState<Record<Kind, string>>({ customers: '', invoices: '', payments: '', items: '' });
  const [howOpen, setHowOpen] = useState(false);

  const labelFor = (kind: Kind) => {
    const titles: Record<Kind, { en: string; fr: string }> = {
      customers: { en: 'Customers', fr: 'Clients' },
      invoices: { en: 'Invoices', fr: 'Factures' },
      payments: { en: 'Payments', fr: 'Paiements' },
      items: { en: 'Items & Services', fr: 'Articles et services' },
    };
    const k = tr[kind]?.title || (isFr ? titles[kind].fr : titles[kind].en);
    return k;
  };

  const descFor = (kind: Kind) => {
    const descs: Record<Kind, { en: string; fr: string }> = {
      customers: {
        en: 'Export all active clients in QBO Customer Import format.',
        fr: 'Exportez tous les clients actifs au format Import client QBO.',
      },
      invoices: {
        en: 'Export sent, partial and paid invoices with line items.',
        fr: 'Exportez les factures envoyées, partielles et payées avec leurs lignes.',
      },
      payments: {
        en: 'Export successful payments to record in QuickBooks.',
        fr: 'Exportez les paiements réussis pour les enregistrer dans QuickBooks.',
      },
      items: {
        en: 'Export your services / products catalog.',
        fr: 'Exportez votre catalogue de services / produits.',
      },
    };
    return tr[kind]?.description || (isFr ? descs[kind].fr : descs[kind].en);
  };

  const onDownload = useCallback(async (kind: Kind) => {
    setLoading(prev => ({ ...prev, [kind]: true }));
    try {
      await downloadCsv(kind, from[kind] || '', to[kind] || '');
      setLastExported(prev => ({ ...prev, [kind]: new Date().toISOString() }));
      toast.success(isFr ? 'Téléchargement démarré' : 'Download started');
    } catch (err: any) {
      toast.error(err?.message || (isFr ? 'Échec de l\'export' : 'Export failed'));
    } finally {
      setLoading(prev => ({ ...prev, [kind]: false }));
    }
  }, [from, to, isFr]);

  return (
    <div className="px-8 py-6 max-w-5xl">
      <BackToSettings />

      <div className="flex items-center gap-3 mb-2">
        <div className="w-11 h-11 rounded-2xl bg-surface-secondary flex items-center justify-center">
          <FileSpreadsheet size={22} className="text-text-tertiary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">
            {tr.title || (isFr ? 'Export QuickBooks' : 'QuickBooks Export')}
          </h1>
          <p className="text-sm text-text-tertiary">
            {tr.subtitle || (isFr
              ? 'Exportez vos données Lume CRM au format CSV compatible QuickBooks. Importez ces fichiers dans QuickBooks Desktop ou Online.'
              : 'Export your Lume CRM data in QuickBooks-compatible CSV format. Import these files into QuickBooks Desktop or Online.')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {CARDS.map(({ kind, icon: Icon, withRange }) => (
          <div key={kind} className="rounded-2xl border border-border-secondary bg-surface-primary p-5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-surface-secondary flex items-center justify-center shrink-0">
                <Icon size={18} className="text-text-tertiary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{labelFor(kind)}</div>
                <div className="text-xs text-text-tertiary">{descFor(kind)}</div>
              </div>
            </div>

            {withRange && (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-text-tertiary">{isFr ? 'Du' : 'From'}</span>
                  <input
                    type="date"
                    value={from[kind]}
                    onChange={(e) => setFrom(prev => ({ ...prev, [kind]: e.target.value }))}
                    className="bg-surface-secondary border border-border-secondary rounded-lg px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-text-tertiary">{isFr ? 'Au' : 'To'}</span>
                  <input
                    type="date"
                    value={to[kind]}
                    onChange={(e) => setTo(prev => ({ ...prev, [kind]: e.target.value }))}
                    className="bg-surface-secondary border border-border-secondary rounded-lg px-2 py-1 text-sm"
                  />
                </label>
              </div>
            )}

            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-text-tertiary">
                {lastExported[kind]
                  ? `${isFr ? 'Dernier export' : 'Last exported'}: ${new Date(lastExported[kind]!).toLocaleString()}`
                  : (isFr ? 'Jamais exporté' : 'Not yet exported')}
              </span>
              <button
                type="button"
                onClick={() => onDownload(kind)}
                disabled={loading[kind]}
                className="inline-flex items-center gap-2 rounded-lg bg-primary text-on-primary px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              >
                {loading[kind] ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {isFr ? 'Télécharger CSV' : 'Download CSV'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* How to import */}
      <div className="mt-8 rounded-2xl border border-border-secondary bg-surface-primary">
        <button
          type="button"
          onClick={() => setHowOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 text-left"
        >
          <span className="font-medium">
            {tr.howTitle || (isFr ? 'Comment importer dans QuickBooks' : 'How to import into QuickBooks')}
          </span>
          {howOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {howOpen && (
          <div className="px-5 pb-5 text-sm text-text-secondary space-y-4">
            <div>
              <div className="font-medium mb-1">QuickBooks Online</div>
              <ol className="list-decimal pl-5 space-y-1">
                <li>{isFr ? 'Connectez-vous à QuickBooks Online.' : 'Sign in to QuickBooks Online.'}</li>
                <li>{isFr ? 'Allez dans Paramètres (engrenage) → Importer des données.' : 'Go to Settings (gear) → Import Data.'}</li>
                <li>{isFr ? 'Choisissez Clients, Articles ou Factures et téléversez le CSV correspondant.' : 'Pick Customers, Items or Invoices and upload the matching CSV.'}</li>
                <li>{isFr ? 'Faites correspondre les colonnes, vérifiez et confirmez l\'import.' : 'Map the columns, review and confirm the import.'}</li>
              </ol>
            </div>
            <div>
              <div className="font-medium mb-1">QuickBooks Desktop</div>
              <ol className="list-decimal pl-5 space-y-1">
                <li>{isFr ? 'Ouvrez QuickBooks Desktop.' : 'Open QuickBooks Desktop.'}</li>
                <li>{isFr ? 'Fichier → Utilitaires → Importer → Fichiers Excel (ou IIF).' : 'File → Utilities → Import → Excel Files (or IIF).'}</li>
                <li>{isFr ? 'Sélectionnez le CSV exporté et associez les colonnes au modèle QB.' : 'Select the exported CSV and map columns to the QB template.'}</li>
              </ol>
            </div>
            <div className="text-xs text-text-tertiary">
              {isFr
                ? 'Note: ce format est aussi accepté par Wave Accounting (Clients et Articles principalement). Xero requiert un format différent — non couvert en V1.'
                : 'Note: this format is also accepted by Wave Accounting (Customers and Items mainly). Xero needs a different format — not covered in V1.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
