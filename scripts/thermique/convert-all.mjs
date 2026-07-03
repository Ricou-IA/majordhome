// Orchestrateur : rejoue toutes les conversions (usage : node scripts/thermique/convert-all.mjs)
const steps = [
  './convert-materiaux.mjs',
  './convert-communes.mjs',
  './convert-coefficients-b.mjs',
  './convert-menuiseries.mjs',
  './convert-parois-types.mjs',
  './convert-u-defauts.mjs',
  './convert-pac.mjs',
];
for (const step of steps) {
  console.log(`\n=== ${step} ===`);
  try {
    await import(step);
  } catch (err) {
    console.warn(`⚠ ${step} sauté : ${err.message}`);
  }
}
