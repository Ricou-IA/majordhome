import { Button } from './button';

/**
 * État vide (DA § 7) : icône Lucide 40 px dans un cercle `secondary-100`, une phrase
 * qui dit ce qui manque, une précision facultative, un bouton d'action.
 * `secondaryAction` (facultatif) se place à gauche de l'action, en bouton secondaire.
 *
 * @param {Object} props
 * @param {React.ComponentType} props.icon  icône Lucide
 * @param {React.ReactNode} props.message
 * @param {React.ReactNode} [props.detail]
 * @param {{ label: string, onClick: Function, icon?: React.ComponentType }} [props.action]
 * @param {{ label: string, onClick: Function, icon?: React.ComponentType }} [props.secondaryAction]
 */
export function EmptyState({ icon: Icone, message, detail, action, secondaryAction }) {
  const IconeAction = action?.icon;
  const IconeSecondaire = secondaryAction?.icon;
  return (
    <div className="py-12 text-center">
      {Icone && (
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-secondary-100">
          <Icone className="h-10 w-10 text-secondary-400" strokeWidth={1.75} aria-hidden="true" />
        </div>
      )}
      <p className="font-display text-section text-secondary-900">{message}</p>
      {detail && <p className="mx-auto mt-2 max-w-sm text-body-sm text-secondary-500">{detail}</p>}
      {(action || secondaryAction) && (
        <div className="mt-6 flex items-center justify-center gap-3">
          {secondaryAction && (
            <Button variant="secondary" onClick={secondaryAction.onClick}>
              {IconeSecondaire && <IconeSecondaire aria-hidden="true" />}
              {secondaryAction.label}
            </Button>
          )}
          {action && (
            <Button variant="primary" onClick={action.onClick}>
              {IconeAction && <IconeAction aria-hidden="true" />}
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
