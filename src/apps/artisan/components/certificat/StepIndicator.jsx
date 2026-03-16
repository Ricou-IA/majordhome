/**
 * StepIndicator.jsx - Certificat d'Entretien
 * ============================================================================
 * Stepper visuel horizontal. Pastilles numérotées avec labels.
 * Optimisé tablette : touch targets 48px, scroll horizontal si besoin.
 * ============================================================================
 */

import { Check } from 'lucide-react';

const COLORS = {
  completed: '#1B4F72',
  current: '#E67E22',
  upcoming: '#D1D5DB',
};

export function StepIndicator({ steps, currentIndex, onStepClick }) {
  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="flex items-center justify-between min-w-max gap-1 px-1">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isClickable = index < currentIndex;

          return (
            <div key={step.id} className="flex items-center flex-1 min-w-0">
              {/* Pastille */}
              <button
                type="button"
                onClick={() => isClickable && onStepClick?.(index)}
                disabled={!isClickable}
                className="flex flex-col items-center gap-1 min-w-[56px] transition-colors"
                style={{ cursor: isClickable ? 'pointer' : 'default' }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors shrink-0"
                  style={{
                    backgroundColor: isCompleted
                      ? COLORS.completed
                      : isCurrent
                        ? COLORS.current
                        : COLORS.upcoming,
                    color: isCompleted || isCurrent ? '#fff' : '#6B7280',
                  }}
                >
                  {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
                </div>
                <span
                  className="text-[10px] leading-tight text-center truncate max-w-[64px]"
                  style={{
                    fontWeight: isCurrent ? 700 : 400,
                    color: isCurrent ? COLORS.current : isCompleted ? COLORS.completed : '#9CA3AF',
                  }}
                >
                  {step.label}
                </span>
              </button>

              {/* Connecteur */}
              {index < steps.length - 1 && (
                <div
                  className="flex-1 h-0.5 mx-1 rounded-full min-w-[12px]"
                  style={{
                    backgroundColor: isCompleted ? COLORS.completed : COLORS.upcoming,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
