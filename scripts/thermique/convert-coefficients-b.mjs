// Conversion Coefficients-b.txt -> src/apps/thermique/data/coefficients-b.json
import { SRC_ROOT, readSource, writeDataJson } from './lib/sourceFiles.js';
import { parseCoefB } from './lib/parseCoefB.js';

console.log(`source : ${SRC_ROOT}/Coefficients-b.txt`);
const categories = parseCoefB(readSource('Coefficients-b.txt'));
if (categories.length < 4) throw new Error('Parser coefficients-b à vérifier');
writeDataJson('coefficients-b.json',
  { source: 'C:\\Thermique\\Coefficients-b.txt', license: 'regulatory-table' },
  { categories });
