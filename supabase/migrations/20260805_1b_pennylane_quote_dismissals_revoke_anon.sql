-- 20260805_1b_pennylane_quote_dismissals_revoke_anon.sql
-- Suite de 20260805_1_pennylane_quote_dismissals.sql : la vue publique
-- héritait des GRANT par défaut du schéma public (anon = mêmes privilèges
-- que authenticated, y compris DELETE/INSERT/UPDATE). RLS bloquerait déjà
-- anon en pratique (auth.uid() NULL => aucune ligne org_id matchée), mais
-- on retire aussi le GRANT lui-même par défense en profondeur (convention
-- CLAUDE.md : REVOKE anon sur tout nouvel objet exposé côté public).
-- Additif : ne touche à rien d'autre que ses propres privilèges anon.

REVOKE ALL ON public.majordhome_pennylane_quote_dismissals FROM anon;
