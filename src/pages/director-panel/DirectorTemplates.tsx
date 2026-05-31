import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { PageHeader } from '../../components/ui';
import { BUILT_IN_TEMPLATES } from '../../lib/director-panel/config/templates';
import { TEMPLATE_IMAGES } from '../../lib/director-panel/config/template-images';
import type { BuiltInTemplate } from '../../types/director';

export default function DirectorTemplates() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [previewTemplate, setPreviewTemplate] = useState<BuiltInTemplate | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title={t.directorPanel.templatesTitle} subtitle={t.directorPanel.templatesSubtitle} icon={Layout} iconColor="purple" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {BUILT_IN_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => setPreviewTemplate(tpl)}
            className="group section-card overflow-hidden text-left hover:shadow-md transition-shadow"
          >
            <div className="h-[140px] bg-surface-tertiary overflow-hidden">
              {TEMPLATE_IMAGES[tpl.id] ? (
                <img
                  src={TEMPLATE_IMAGES[tpl.id]}
                  alt={tpl.title}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Layout className="w-8 h-8 text-text-tertiary" />
                </div>
              )}
            </div>
            <div className="p-4">
              <p className="text-[13px] font-semibold text-text-primary">{tpl.title}</p>
              <p className="text-[12px] text-text-tertiary mt-1 line-clamp-2">{tpl.description}</p>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-text-tertiary">
                <span>{tpl.nodes.length} {t.directorPanel.nodes}</span>
                <span className="text-outline">&bull;</span>
                <span>{tpl.edges.length} {t.directorPanel.connections}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setPreviewTemplate(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-surface border border-outline shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="relative h-[220px] bg-surface-tertiary overflow-hidden">
              {TEMPLATE_IMAGES[previewTemplate.id] ? (
                <img
                  src={TEMPLATE_IMAGES[previewTemplate.id]}
                  alt={previewTemplate.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Layout className="w-12 h-12 text-text-tertiary" />
                </div>
              )}
              <button
                onClick={() => setPreviewTemplate(null)}
                className="absolute top-3 right-3 p-1.5 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-[15px] font-semibold text-text-primary">{previewTemplate.title}</h3>
                <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-medium capitalize">
                  {previewTemplate.category}
                </span>
              </div>
              <p className="text-[12px] text-text-secondary leading-relaxed">{previewTemplate.description}</p>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-text-tertiary">
                <span>{previewTemplate.nodes.length} {t.directorPanel.nodes}</span>
                <span className="text-outline">&bull;</span>
                <span>{previewTemplate.edges.length} {t.directorPanel.connections}</span>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setPreviewTemplate(null)} className="glass-button text-[12px]">{t.directorPanel.cancel}</button>
                <button
                  onClick={() => navigate(`/director-panel/flows/new?template=${previewTemplate.id}`)}
                  className="glass-button-primary text-[12px]"
                >
                  {t.directorPanel.launchTemplate}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
