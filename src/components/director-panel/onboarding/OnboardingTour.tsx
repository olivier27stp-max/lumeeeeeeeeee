import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { cn } from '../../../lib/utils';

// ─── Tour Step Definition ────────────────────────────────────────────────────

export type TourStep = {
  /** CSS selector for the target element to highlight */
  target?: string;
  /** Title of the step */
  title: string;
  /** Description / instruction */
  content: string;
  /** Position of the tooltip relative to the target */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** Optional action label (e.g. "Try it!") */
  actionLabel?: string;
  /** Optional callback when action is clicked */
  onAction?: () => void;
};

type OnboardingTourProps = {
  steps: TourStep[];
  tourKey: string; // localStorage key to track completion
  onComplete?: () => void;
  onSkip?: () => void;
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function OnboardingTour({ steps, tourKey, onComplete, onSkip }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Check if tour was already completed
  useEffect(() => {
    const done = localStorage.getItem(`onboarding:${tourKey}`);
    if (!done) setVisible(true);
  }, [tourKey]);

  // Position tooltip near target element
  const positionTooltip = useCallback(() => {
    const step = steps[currentStep];
    if (!step) return;

    if (!step.target || step.placement === 'center') {
      // Center on screen
      setHighlightRect(null);
      setTooltipPos({
        top: window.innerHeight / 2 - 120,
        left: window.innerWidth / 2 - 180,
      });
      return;
    }

    const el = document.querySelector(step.target);
    if (!el) {
      setHighlightRect(null);
      setTooltipPos({ top: window.innerHeight / 2 - 120, left: window.innerWidth / 2 - 180 });
      return;
    }

    const rect = el.getBoundingClientRect();
    setHighlightRect(rect);

    const gap = 12;
    const placement = step.placement || 'bottom';
    let top = 0;
    let left = 0;

    switch (placement) {
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - 180;
        break;
      case 'top':
        top = rect.top - gap - 180;
        left = rect.left + rect.width / 2 - 180;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - 90;
        left = rect.right + gap;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - 90;
        left = rect.left - gap - 360;
        break;
    }

    // Clamp to viewport
    top = Math.max(8, Math.min(top, window.innerHeight - 220));
    left = Math.max(8, Math.min(left, window.innerWidth - 370));

    setTooltipPos({ top, left });
  }, [currentStep, steps]);

  useEffect(() => {
    if (!visible) return;
    positionTooltip();
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
    return () => {
      window.removeEventListener('resize', positionTooltip);
      window.removeEventListener('scroll', positionTooltip, true);
    };
  }, [visible, positionTooltip]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const handleComplete = () => {
    localStorage.setItem(`onboarding:${tourKey}`, 'true');
    setVisible(false);
    onComplete?.();
  };

  const handleSkip = () => {
    localStorage.setItem(`onboarding:${tourKey}`, 'true');
    setVisible(false);
    onSkip?.();
  };

  if (!visible || steps.length === 0) return null;

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;
  const isFirst = currentStep === 0;

  return (
    <>
      {/* Backdrop overlay */}
      <div className="fixed inset-0 z-[9998]" onClick={handleSkip}>
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <mask id="onboarding-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {highlightRect && (
                <rect
                  x={highlightRect.left - 4}
                  y={highlightRect.top - 4}
                  width={highlightRect.width + 8}
                  height={highlightRect.height + 8}
                  rx="8"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0,0,0,0.6)"
            mask="url(#onboarding-mask)"
          />
        </svg>

        {/* Highlight border */}
        {highlightRect && (
          <div
            className="absolute rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-transparent pointer-events-none animate-pulse"
            style={{
              top: highlightRect.top - 4,
              left: highlightRect.left - 4,
              width: highlightRect.width + 8,
              height: highlightRect.height + 8,
            }}
          />
        )}
      </div>

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className="fixed z-[9999] w-[360px] rounded-xl bg-surface border border-outline shadow-lg overflow-hidden"
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-[11px] font-medium text-text-tertiary">
              Step {currentStep + 1} of {steps.length}
            </span>
          </div>
          <button
            onClick={handleSkip}
            className="p-1 rounded-md hover:bg-surface-tertiary text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          <h3 className="text-[14px] font-semibold text-text-primary mb-1.5">{step.title}</h3>
          <p className="text-[13px] text-text-secondary leading-relaxed">{step.content}</p>
        </div>

        {/* Action button */}
        {step.actionLabel && (
          <div className="px-4 pb-2">
            <button
              onClick={step.onAction}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              {step.actionLabel}
            </button>
          </div>
        )}

        {/* Progress bar */}
        <div className="h-0.5 bg-surface-tertiary mx-4">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={handleSkip}
            className="text-[12px] text-text-tertiary hover:text-text-primary transition-colors"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={handlePrev}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium text-text-secondary hover:bg-surface-tertiary transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium bg-primary text-white hover:opacity-90 transition-colors"
            >
              {isLast ? 'Get started' : 'Next'}
              {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Reset tour (for testing) ────────────────────────────────────────────────

export function resetTour(tourKey: string) {
  localStorage.removeItem(`onboarding:${tourKey}`);
}
