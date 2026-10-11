/**
 * useDeviceClass — catégorie d'appareil mesurée au démarrage par
 * `initDeviceViewport()` (src/lib/deviceViewport.js), exposée aux composants.
 *
 * La mesure repose sur `screen.width/height` et le user-agent, stables pour
 * toute la vie de la page : pas d'abonnement resize, une lecture suffit.
 * Point unique pour « sur téléphone / sur appareil mobile, faire autrement »,
 * à préférer à un `window.innerWidth` recalculé localement (sur tablette le
 * viewport est forcé à 1024 px : innerWidth mentirait).
 */
import { useMemo } from 'react';
import { getDeviceClass } from '@lib/deviceViewport';

/**
 * @returns {{ deviceClass: 'desktop'|'tablet'|'phone', isPhone: boolean, isMobileDevice: boolean }}
 *   `isMobileDevice` = téléphone OU tablette (appareil tenu en main, utilisateur en déplacement).
 */
export function useDeviceClass() {
  return useMemo(() => {
    const deviceClass = getDeviceClass();
    return {
      deviceClass,
      isPhone: deviceClass === 'phone',
      isMobileDevice: deviceClass === 'phone' || deviceClass === 'tablet',
    };
  }, []);
}
