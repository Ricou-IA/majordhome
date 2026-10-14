/**
 * SiteUrlSetting — adresse du site boutique (settings.webshop.site_url).
 * Sert au lien « Voir sur le site » et à l'aperçu des photos stockées dans le dépôt du site.
 */
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Globe, Loader2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { inputClass } from '@apps/artisan/components/FormFields';

export default function SiteUrlSetting({ canEdit }) {
  const { settings, save, isSaving } = useOrgSettings();
  const current = settings?.webshop?.site_url ?? '';
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);

  const handleSave = async () => {
    let url = value.trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      await save({ webshop: { ...(settings?.webshop ?? {}), site_url: url || null } });
      toast.success('Adresse du site enregistrée');
    } catch (err) {
      toast.error(`Enregistrement impossible : ${err.message}`);
    }
  };

  if (!canEdit && !current) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Globe className="w-4 h-4 text-secondary-400 shrink-0" />
      <span className="text-secondary-500 shrink-0">Site boutique</span>
      {canEdit ? (
        <>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://www.mayer-energie.fr"
            className={`${inputClass} max-w-xs py-1.5`}
          />
          {value.trim().replace(/\/+$/, '') !== current && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Enregistrer'}
            </button>
          )}
        </>
      ) : (
        <a href={current} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{current}</a>
      )}
    </div>
  );
}
