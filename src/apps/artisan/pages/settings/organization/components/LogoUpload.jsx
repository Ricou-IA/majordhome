// Logo de l'entreprise (réglage `logo_url`) : téléversé dans le compartiment public `org-branding`, sous le
// dossier de l'organisation (org_admin seul, migration 20261121_8). Enregistré dès l'envoi : l'adresse change à
// chaque téléversement, pour que les e-mails et les navigateurs ne gardent pas l'ancienne image.
// Un logo réglé avant cet écran peut venir d'une adresse extérieure (site de l'entreprise) : il s'affiche, et
// se remplace ici.
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { storageService } from '@services/storage.service';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { COMPARTIMENT_LOGO, LOGO_MAX_OCTETS, LOGO_TYPES, cheminLogo, logoHeberge } from '@/lib/organisation/liaisonHesiasun';

const BASE_STOCKAGE = import.meta.env.VITE_SUPABASE_URL || '';

/**
 * @param {{ orgId: string|undefined, onChange?: () => void }} p  onChange : appelé après un enregistrement réussi
 */
export default function LogoUpload({ orgId, onChange }) {
  const { settings, save } = useOrgSettings();
  const fichier = useRef(null);
  const [occupe, setOccupe] = useState(false);
  const logoUrl = typeof settings?.logo_url === 'string' ? settings.logo_url : '';
  const heberge = logoHeberge(logoUrl, { baseStockage: BASE_STOCKAGE, orgId });

  const enregistrer = async (url, message) => {
    await save({ logo_url: url });
    // L'ancien fichier ne sert plus (seulement s'il était hébergé ici : on ne touche jamais une adresse extérieure).
    if (heberge) await storageService.deleteFile(COMPARTIMENT_LOGO, heberge);
    toast.success(message);
    onChange?.();
  };

  const handleFichier = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !orgId) return;
    const ext = LOGO_TYPES[file.type];
    if (!ext) { toast.error('Formats acceptés : PNG, JPG ou WebP'); return; }
    if (file.size > LOGO_MAX_OCTETS) { toast.error('Image trop lourde : 2 Mo maximum'); return; }

    setOccupe(true);
    try {
      const { path, error } = await storageService.uploadFile(COMPARTIMENT_LOGO, cheminLogo(orgId, ext, Date.now()), file, { contentType: file.type });
      if (error || !path) throw new Error(error?.message || 'téléversement refusé');
      const url = storageService.getPublicUrl(COMPARTIMENT_LOGO, path);
      if (!url) throw new Error('adresse du logo introuvable');
      await enregistrer(url, 'Logo enregistré');
    } catch (err) {
      toast.error(`Le logo n’a pas pu être enregistré : ${err.message}`);
    } finally {
      setOccupe(false);
    }
  };

  const handleRetirer = async () => {
    setOccupe(true);
    try {
      await enregistrer('', 'Logo retiré');
    } catch (err) {
      toast.error(`Le logo n’a pas pu être retiré : ${err.message}`);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="flex items-start gap-4 flex-wrap">
      <div className="w-48 h-24 border border-dashed border-secondary-300 rounded-md bg-white flex items-center justify-center overflow-hidden">
        {logoUrl
          ? <img src={logoUrl} alt="Logo de l’entreprise" className="max-h-full max-w-full object-contain p-2" />
          : <span className="flex flex-col items-center gap-1 text-xs text-secondary-400"><ImageIcon className="w-5 h-5" />Aucun logo</span>}
      </div>
      <div className="flex flex-col gap-2">
        <input ref={fichier} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFichier} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fichier.current?.click()} disabled={occupe || !orgId} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
            {occupe ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {logoUrl ? 'Remplacer' : 'Téléverser'}
          </button>
          {logoUrl && (
            <button type="button" onClick={handleRetirer} disabled={occupe} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              <Trash2 className="w-4 h-4" /> Retirer
            </button>
          )}
        </div>
        <p className="text-xs text-secondary-500">PNG, JPG ou WebP, 2 Mo maximum. Un fond blanc ou transparent se lit mieux sur vos documents.</p>
        {logoUrl && !heberge && (
          <p className="text-xs text-secondary-600 max-w-sm">Ce logo vient d’une adresse extérieure. Téléversez-le ici pour le tenir dans Majord’home.</p>
        )}
      </div>
    </div>
  );
}
