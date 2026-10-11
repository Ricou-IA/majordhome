/**
 * modalClasses.js — gabarit « téléphone » des modales
 * ============================================================================
 * Sous le breakpoint Tailwind `sm` (< 640 px), une modale de bureau rétrécie
 * perd ses marges, garde des coins arrondis sur un panneau qui touche les
 * bords, et ses boutons sortent de la portée du pouce. Ces constantes
 * transforment le panneau en plein écran et collent le pied d'actions en bas,
 * zone de sécurité iOS comprise. À partir de `sm`, elles ne font RIEN : le
 * rendu bureau et tablette (rendue en 1024 px, jamais sous `sm`) est inchangé.
 *
 * Pourquoi des variantes `max-sm:` et pas une classe CSS : une classe de
 * `@layer components` perdrait contre `rounded-xl` / `max-h-*` posés sur le
 * même élément (la couche utilities vient après). Les variantes `max-sm:` sont
 * émises après les utilitaires de base de la même couche et gagnent proprement.
 *
 * Usage : s'ajoute aux classes existantes, sans les retirer.
 *   <div className={`relative bg-white rounded-xl max-w-lg ${MODAL_PANEL_PHONE}`}>
 *     …
 *     <div className={`px-5 py-3 border-t ${MODAL_FOOTER_PHONE}`}>
 */

/** Panneau : plein écran sous `sm` (fixe, 100dvh, sans coins ni plafond de hauteur). */
export const MODAL_PANEL_PHONE =
  'max-sm:fixed max-sm:inset-0 max-sm:w-full max-sm:max-w-none max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none';

/** Pied d'actions : sans coins, padding bas = 1rem + zone de sécurité iOS (barre d'accueil). */
export const MODAL_FOOTER_PHONE =
  'max-sm:rounded-none max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]';
