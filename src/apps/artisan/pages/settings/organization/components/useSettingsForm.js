// src/apps/artisan/pages/settings/organization/components/useSettingsForm.js
// État de formulaire d'un onglet de Settings → Organisation, branché sur useOrgSettings().
// Les onglets restent montés (une saisie survit au changement d'onglet) : quand les
// settings changent parce qu'un AUTRE onglet a enregistré, un formulaire en cours de
// saisie n'est pas écrasé — seul un formulaire non modifié se recale sur la base.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrgSettings } from '@hooks/useOrgSettings';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @template T
 * @param {(settings: Record<string, unknown>) => T} pick  fonction stable (niveau module)
 */
export function useSettingsForm(pick) {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => pick({}));
  const [initial, setInitial] = useState(() => pick({}));
  const formRef = useRef(form);
  const initialRef = useRef(initial);
  formRef.current = form;
  initialRef.current = initial;

  useEffect(() => {
    const next = pick(settings || {});
    const wasClean = same(formRef.current, initialRef.current);
    setInitial(next);
    if (wasClean) setForm(next);
  }, [settings, pick]);

  const isDirty = useMemo(() => !same(form, initial), [form, initial]);

  return { form, setForm, initial, setInitial, isDirty, settings, save, isSaving, isLoading };
}
