import React, { useState } from 'react';
import { X, Trash2, ZoomIn } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';

interface GalleryImage {
  url: string;
  name?: string;
}

interface ImageGalleryProps {
  images: GalleryImage[];
  onDelete?: (url: string) => void;
}

export default function ImageGallery({ images, onDelete }: ImageGalleryProps) {
  const { t } = useTranslation();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  if (images.length === 0) {
    return (
      <div className="rounded-xl border border-outline bg-surface-secondary/30 p-8 text-center">
        <p className="text-[13px] text-text-tertiary">{t.common.noImagesFound}</p>
      </div>
    );
  }

  return (
    <>
      {/* Thumbnail Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {images.map((img, idx) => (
          <div
            key={img.url + idx}
            className="group relative aspect-square rounded-xl border border-outline overflow-hidden bg-surface-secondary"
          >
            <img
              src={img.url}
              alt={img.name || `Image ${idx + 1}`}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => setLightboxUrl(img.url)}
                className="p-2 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <ZoomIn size={16} />
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(img.url)}
                  className="p-2 rounded-lg bg-black/50 text-white hover:bg-danger/80 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            {/* Name label */}
            {img.name && (
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                <p className="text-[10px] text-white truncate">{img.name}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X size={20} />
          </button>
          <img
            src={lightboxUrl}
            alt={t.common.fullSize}
            className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
