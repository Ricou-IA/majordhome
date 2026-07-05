// src/apps/thermique/components/wizard/CanvasErrorBoundary.jsx
// Error boundary du canevas de dessin (dette ciblée du plan 3, Task 12 (b)) : les helpers
// géométriques (`boiteEnglobante`, `normalisePolygone`, `intervalleAxial`…) THROW 'thermique:'
// sur un dessin corrompu — le wizard doit encaisser sans écran blanc. Class component obligatoire
// (React n'a pas d'équivalent hook pour componentDidCatch). Le bouton « Réessayer » reset l'état
// d'erreur : utile après correction du dessin en amont (ex. « Nouvelle » ou restauration de
// brouillon) — si le dessin est toujours corrompu, le fallback réapparaît au render suivant.
import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { logger } from '@lib/logger';

export class CanvasErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    logger.error('[thermique] PlanCanvas a crashé', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 h-full min-h-[240px] p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
          <p className="text-sm text-secondary-700">Le plan n’a pas pu être affiché.</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-secondary-700 border border-secondary-300 rounded-lg hover:bg-secondary-50"
          >
            <RotateCcw className="w-4 h-4" /> Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default CanvasErrorBoundary;
