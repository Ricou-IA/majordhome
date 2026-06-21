/**
 * csv.js — conversion generique d'un tableau d'objets en CSV (RFC 4180).
 * Separateur virgule, fin de ligne CRLF. Champs contenant , " ou saut de ligne -> entoures de "",
 * guillemets internes doubles. null/undefined -> chaine vide ; objets -> JSON.stringify.
 *
 * @param {Array<object>} rows
 * @param {Array<{key: string, label: string}>} columns
 * @returns {string}
 */
export function toCsv(rows, columns) {
  const esc = (val) => {
    if (val === null || val === undefined) return '';
    const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => esc(row[c.key])).join(',')).join('\r\n');
  return body ? header + '\r\n' + body : header;
}
