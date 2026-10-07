/* Lance tout le banc d'essai et compte les points.

   Les suites du classeur sont rapides (faux bureau Google en mémoire).
   Celles de l'application ouvrent un vrai Chromium et prennent chacune
   une à deux minutes : elles tournent donc une par une, pas en parallèle,
   sinon les ports d'essai se marchent dessus.

   Usage :  node tests/tous.mjs            tout
            node tests/tous.mjs classeur   seulement le serveur
            node tests/tous.mjs appli      seulement l'application
            node tests/tous.mjs tliste     une suite précise
*/
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));

const CLASSEUR = ['tgs', 'tsigne', 'ttarif', 'tpresta', 'tadmin', 'tdate', 'tcontrat', 'tplan', 'tplan47', 'tmaj', 'tmail', 'tnum', 'tkm', 'tvit'];
const APPLI = ['tco', 'tchamps', 'tv', 'tnote', 'verif24', 'tplafond', 'tprix',
               'tclavier', 'tagent', 'tsign', 'tsign2', 'tvue', 'tadmapp',
               'tliste', 'tpdf39', 'tnature', 'tcatnat', 'tetat', 'tnumapp', 'tkmapp', 'tvitapp', 'tforfait', 'tretra'];

const arg = (process.argv[2] || '').toLowerCase();
let suites;
if (arg === 'classeur') suites = CLASSEUR;
else if (arg === 'appli') suites = APPLI;
else if (arg) suites = [arg.replace(/\.mjs$/, '')];
else suites = CLASSEUR.concat(APPLI);

function lancer(nom) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [path.join(ICI, nom + '.mjs')], { cwd: ICI });
    let sortie = '';
    p.stdout.on('data', (d) => { sortie += d; });
    p.stderr.on('data', (d) => { sortie += d; });
    p.on('close', (code) => {
      const verts = (sortie.match(/✓/g) || []).length;
      const rouges = (sortie.match(/✗/g) || []).length;
      res({ nom, verts, rouges, code, sortie });
    });
  });
}

let totalV = 0, totalR = 0;
const casses = [];

for (const nom of suites) {
  const r = await lancer(nom);
  totalV += r.verts; totalR += r.rouges;
  const etat = r.rouges ? 'ROUGE' : (r.code === 0 ? 'ok' : 'PLANTE');
  console.log(
    nom.padEnd(12) + String(r.verts).padStart(4) + ' au vert' +
    (r.rouges ? '   ' + r.rouges + ' au rouge' : '') +
    '   ' + etat
  );
  if (r.rouges || r.code !== 0) casses.push(r);
}

console.log('\n' + '-'.repeat(46));
console.log('TOTAL : ' + totalV + ' au vert, ' + totalR + ' au rouge');

for (const r of casses) {
  console.log('\n===== ' + r.nom + ' =====');
  const lignes = r.sortie.split('\n').filter(l => /✗|Error|error/.test(l));
  console.log(lignes.slice(0, 12).join('\n') || r.sortie.slice(-1200));
}

process.exit(casses.length ? 1 : 0);
