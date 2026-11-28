// ops/aspirateur/erreurs.mjs — erreur porteuse d'un code de src/lib/aspirateur/codes.js (copie lib/codes.js).
export class CodeErreur extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'CodeErreur';
    this.code = code;
  }
}
