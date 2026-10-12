/**
 * useCertificatsSignedUrl.js — URL signée d'un fichier du bucket `certificats`.
 * ============================================================================
 * Photos de plaque signalétique (certificat, équipement) et PDF : un chemin
 * Storage → une URL signée (1 an), résolue à la demande. `state` :
 * 'none' (pas de chemin) | 'loading' | 'ok' | 'error'.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { certificatsService } from '@services/certificats.service';

/**
 * @param {string|null|undefined} path
 * @returns {{ url: string|null, state: 'none'|'loading'|'ok'|'error' }}
 */
export function useCertificatsSignedUrl(path) {
  const [url, setUrl] = useState(null);
  const [state, setState] = useState(path ? 'loading' : 'none');

  useEffect(() => {
    let actif = true;
    if (!path) { setUrl(null); setState('none'); return undefined; }
    setState('loading');
    certificatsService.getSignedUrl(path).then(({ data, error }) => {
      if (!actif) return;
      if (error || !data) { setUrl(null); setState('error'); return; }
      setUrl(data);
      setState('ok');
    });
    return () => { actif = false; };
  }, [path]);

  return { url, state };
}
