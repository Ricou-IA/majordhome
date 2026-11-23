import { Fragment, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { logger } from '@lib/logger';
import { cn } from '@lib/utils';
import { Button } from './button';

/**
 * En-tête de page (DA § 10) : fil d'Ariane facultatif (fiches), titre H1 28 px,
 * sous-titre d'une ligne, actions à droite alignées sur le titre (DA § 6).
 * Les actions gardent leur ordre ; l'action principale (`variant: 'primary'`, une
 * seule par écran) est rendue en dernier, la plus à droite. Une entrée falsy est
 * ignorée, ce qui permet `[droit && { … }]`.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.subtitle]
 * @param {Array<{ label: string, to?: string }>} [props.breadcrumb]
 * @param {Array<{ label: string, onClick?: Function, to?: string, variant?: string, icon?: React.ComponentType }|false|null>} [props.actions]
 */
export function PageHeader({ title, subtitle, breadcrumb, actions = [], className }) {
  const liste = actions.filter(Boolean);
  const principales = liste.filter((a) => a.variant === 'primary');
  const ordonnees = [...liste.filter((a) => a.variant !== 'primary'), ...principales];

  useEffect(() => {
    if (principales.length > 1) logger.warn('PageHeader : plusieurs actions principales');
  }, [principales.length]);

  return (
    <div className={cn('min-w-0', className)}>
      {breadcrumb?.length > 0 && (
        <nav aria-label="Fil d'Ariane" className="mb-2 flex flex-wrap items-center gap-1 text-body-sm text-secondary-500">
          {breadcrumb.map((etape, index) => (
            <Fragment key={`${etape.label}-${index}`}>
              {index > 0 && <ChevronRight className="h-4 w-4 shrink-0 text-secondary-400" aria-hidden="true" />}
              {etape.to ? (
                <Link to={etape.to} className="hover:text-secondary-900">{etape.label}</Link>
              ) : (
                <span className="text-secondary-700">{etape.label}</span>
              )}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-title text-secondary-900">{title}</h1>
          {subtitle && <p className="mt-1 truncate text-body-sm text-secondary-500">{subtitle}</p>}
        </div>
        {ordonnees.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {ordonnees.map((action) => {
              const Icone = action.icon;
              const contenu = (
                <>
                  {Icone && <Icone aria-hidden="true" />}
                  {action.label}
                </>
              );
              const variant = action.variant || 'secondary';
              return action.to ? (
                <Button key={action.label} asChild variant={variant}>
                  <Link to={action.to}>{contenu}</Link>
                </Button>
              ) : (
                <Button key={action.label} type="button" variant={variant} onClick={action.onClick}>
                  {contenu}
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
