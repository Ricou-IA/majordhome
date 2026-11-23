import { cn } from '@lib/utils';
import { couleurAvatar, initiales } from '@/lib/avatarCouleur';

const TAILLES = {
  24: 'h-6 w-6 rounded-full text-[11px]',
  32: 'h-8 w-8 rounded-full text-xs',
  56: 'h-14 w-14 rounded-xl text-base',
};

/**
 * Avatar : initiales blanches sur une teinte. `couleur` (hex) quand on la connaît — la couleur d'une
 * personne au planning — sinon une teinte stable dérivée de `id` (à défaut, du nom).
 */
export function Avatar({ nom, couleur, id, taille = 32, className }) {
  const fond = couleur || couleurAvatar(id ?? nom);
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: fond }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold text-white',
        TAILLES[taille] || TAILLES[32],
        className,
      )}
    >
      {initiales(nom)}
    </span>
  );
}

export default Avatar;
