/**
 * Encadres.jsx - Import d'articles
 * Messages encadrés de l'import : information (neutre), attention (ambre), alerte (rouge). Présentation seule.
 */

import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

const STYLES = {
  info: { icone: Info, classe: 'text-secondary-700 bg-white border-secondary-200', couleurIcone: 'text-secondary-500' },
  attention: { icone: AlertTriangle, classe: 'text-st-attente bg-st-attente-bg border-st-attente/30', couleurIcone: '' },
  alerte: { icone: AlertCircle, classe: 'text-st-alerte bg-st-alerte-bg border-st-alerte/30', couleurIcone: '' },
};

/**
 * @param {{ ton?: 'info'|'attention'|'alerte', role?: string, children: React.ReactNode, action?: React.ReactNode }} props
 */
export function Encadre({ ton = 'info', role, children, action }) {
  const { icone: Icone, classe, couleurIcone } = STYLES[ton] || STYLES.info;
  return (
    <div role={role} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm border rounded-lg px-4 py-3 ${classe}`}>
      <p className="flex items-start gap-2">
        <Icone className={`w-4 h-4 mt-0.5 shrink-0 ${couleurIcone}`} aria-hidden="true" />
        <span>{children}</span>
      </p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export default Encadre;
