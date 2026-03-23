/* Presentation Mode — navigate through frames as slides */

import React, { useCallback, memo } from 'react';
import { ChevronLeft, ChevronRight, X, Maximize2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../i18n';

interface FrameInfo {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PresentationModeProps {
  frames: FrameInfo[];
  currentIndex: number;
  language: string;
  onNavigate: (index: number) => void;
  onExit: () => void;
}

function PresentationMode({ frames, currentIndex, language, onNavigate, onExit }: PresentationModeProps) {
  const fr = language === 'fr';

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  }, [currentIndex, onNavigate]);

  const handleNext = useCallback(() => {
    if (currentIndex < frames.length - 1) onNavigate(currentIndex + 1);
  }, [currentIndex, frames.length, onNavigate]);

  if (frames.length === 0) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center">
        <div className="bg-surface rounded-xl p-6 text-center max-w-sm">
          <Maximize2 size={32} className="mx-auto text-text-tertiary mb-3" />
          <p className="text-[14px] text-text-primary font-semibold mb-2">
            {t.noteCanvas.noFramesFound}
          </p>
          <p className="text-[12px] text-text-secondary mb-4">
            {fr
              ? 'Ajoutez des frames au canvas pour utiliser le mode presentation.'
              : 'Add frames to the canvas to use presentation mode.'}
          </p>
          <button onClick={onExit} className="btn-primary text-[12px] px-4 py-2">
            {t.noteCanvas.close}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Dark overlay */}
      <div className="fixed inset-0 z-[190] bg-black/40 pointer-events-none" />

      {/* Bottom controls */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 bg-surface/95 backdrop-blur-sm border border-outline rounded-xl shadow-2xl px-4 py-2.5">
          {/* Prev */}
          <button
            onClick={handlePrev}
            disabled={currentIndex <= 0}
            className={cn(
              'p-2 rounded-lg transition-colors',
              currentIndex <= 0
                ? 'text-text-tertiary/40 cursor-not-allowed'
                : 'text-text-primary hover:bg-surface-secondary',
            )}
          >
            <ChevronLeft size={20} />
          </button>

          {/* Frame indicators */}
          <div className="flex items-center gap-2">
            {frames.map((frame, i) => (
              <button
                key={frame.id}
                onClick={() => onNavigate(i)}
                className={cn(
                  'transition-all rounded-full',
                  i === currentIndex
                    ? 'w-8 h-2.5 bg-blue-500'
                    : 'w-2.5 h-2.5 bg-gray-300 hover:bg-gray-400',
                )}
                title={frame.label}
              />
            ))}
          </div>

          {/* Next */}
          <button
            onClick={handleNext}
            disabled={currentIndex >= frames.length - 1}
            className={cn(
              'p-2 rounded-lg transition-colors',
              currentIndex >= frames.length - 1
                ? 'text-text-tertiary/40 cursor-not-allowed'
                : 'text-text-primary hover:bg-surface-secondary',
            )}
          >
            <ChevronRight size={20} />
          </button>

          {/* Divider */}
          <div className="w-px h-6 bg-outline mx-1" />

          {/* Slide info */}
          <span className="text-[12px] text-text-secondary tabular-nums min-w-[40px] text-center">
            {currentIndex + 1} / {frames.length}
          </span>

          {/* Exit */}
          <button
            onClick={onExit}
            className="p-2 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title={t.noteCanvas.exit}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Current frame label */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
        <div className="bg-surface/90 backdrop-blur-sm border border-outline rounded-lg shadow-lg px-4 py-1.5">
          <span className="text-[13px] font-semibold text-text-primary">
            {frames[currentIndex]?.label || `Frame ${currentIndex + 1}`}
          </span>
        </div>
      </div>
    </>
  );
}

export default memo(PresentationMode);
