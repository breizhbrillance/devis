/* Réinjection des défauts de la façade (v60) : chaque mutant doit faire rougir
   sa suite. Rien n'est jamais écrit dans le dossier d'origine — on travaille
   sur une copie complète, et DEVIS_APPLI pointe dessus. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-facade';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = {};
for (const f of ['Code.gs', 'app.js', 'pdf.js', 'index.html']) {
  lu[f] = fs.readFileSync(path.join(SRC, f), 'utf8');
}

/* [fichier, suite qui doit rougir, nom du défaut, texte d'origine, remplacement] */
const mutants = [
  ['Code.gs', 'tfacade', 'la nature FACADE reconnue',
   "  if (n === 'FACADE' || n === 'FAÇADE' || n === 'FACADES' || n === 'FAÇADES') return 'FACADE';\n", ''],
  ['Code.gs', 'tfacade', 'le nom lisible de la façade',
   "  if (n === 'FACADE') return 'Nettoyage de façade';\n", ''],
  ['Code.gs', 'tfacade', 'l\'éloignement sur une façade',
   "return n === 'ENTRETIEN' || n === 'VITRERIE' || n === 'FACADE';",
   "return n === 'ENTRETIEN' || n === 'VITRERIE';"],
  ['Code.gs', 'tfacade', 'FACADE acceptée comme nature de catalogue',
   "m !== 'REMISE' && m !== 'FACADE') return;", "m !== 'REMISE') return;"],
  ['Code.gs', 'tfacade', 'la façade jamais vendue au contrat',
   "  if (n !== 'VITRERIE') return false;", "  if (n !== 'VITRERIE' && n !== 'FACADE') return false;"],
  ['Code.gs', 'tmaj', 'le prix du nettoyage de façade',
   "'m²', 14.90, 10, 'PONCTUEL', 'OUI', 'REF-0036'", "'m²', 14.00, 10, 'PONCTUEL', 'OUI', 'REF-0036'"],
  ['Code.gs', 'tmaj', 'le prix de l\'antimousse',
   "'m²', 3.90, 10, 'PONCTUEL', 'OUI', 'REF-0037'", "'m²', 4.90, 10, 'PONCTUEL', 'OUI', 'REF-0037'"],
  ['Code.gs', 'tmaj', 'la nacelle comptée à la journée',
   "'journée(s)', 450, 10, 'PONCTUEL', 'OUI', 'REF-0038'",
   "'forfait', 450, 10, 'PONCTUEL', 'OUI', 'REF-0038'"],
  ['Code.gs', 'tmaj', 'le détail des cinq étapes',
   "'Mise en sécurité du chantier • protection de la maison et de ses abords • pulvérisation du nettoyant sans chlore • passage du nettoyeur réglé au jet plat • finition et nettoyage du chantier'",
   "''"],
  ['app.js', 'tfacapp', 'estFacade()',
   "function estFacade(){ return NATURE === 'FACADE'; }",
   "function estFacade(){ return false; }"],
  ['app.js', 'tfacapp', 'l\'éloignement sur une façade, côté téléphone',
   "function estMajorableKm(){ return estEntretien() || estVitrerie() || estFacade(); }",
   "function estMajorableKm(){ return estEntretien() || estVitrerie(); }"],
  ['app.js', 'tfacapp', 'le nom lisible de la façade, côté téléphone',
   "  if(n === 'FACADE')    return 'Nettoyage de façade';\n", ''],
  ['app.js', 'tfacapp', 'la façade jamais récurrente, côté téléphone',
   "  return estEntretien() || (estVitrerie() && PASSAGES > 0);",
   "  return estEntretien() || ((estVitrerie() || estFacade()) && PASSAGES > 0);"],
  ['index.html', 'tfacapp', 'la carte de la façade à l\'étape 1',
   '<button class="choix" id="chFAC" onclick="choisirNature(\'FACADE\')">',
   '<button class="choix hide" id="chFACx" onclick="choisirNature(\'FACADE\')">'],
  ['pdf.js', 'tfacapp', 'l\'objet « Nettoyage de façade » sur le papier',
   "                  : natD === 'FACADE'    ? 'Nettoyage de façade'\n", '']
];

let survivants = [];
for (const [fichier, suite, nom, de, vers] of mutants) {
  const orig = lu[fichier];
  const n = orig.split(de).length - 1;
  if (n !== 1) { console.log('⚠ ' + nom + ' : ' + n + ' occurrence(s), mutant non posé'); continue; }
  fs.writeFileSync(path.join(TMP, fichier), orig.replace(de, vers));
  let sortie = '';
  try {
    sortie = execFileSync('node', [suite + '.mjs'],
      { env: { ...process.env, DEVIS_APPLI: TMP }, encoding: 'utf8', timeout: 300000 });
  } catch (e) { sortie = (e.stdout || '') + (e.stderr || ''); }
  fs.writeFileSync(path.join(TMP, fichier), orig);     // on repose l'original
  const m = sortie.match(/(\d+) au vert, (\d+) au rouge/);
  const rouges = m ? Number(m[2]) : -1;
  const plante = !m;
  console.log((rouges > 0 || plante ? '✓' : '✗ SURVIVANT') + ' [' + suite + '] ' + nom +
              ' → ' + (plante ? 'la suite casse' : rouges + ' au rouge'));
  if (rouges === 0 && !plante) survivants.push(nom);
}
console.log('\n' + (survivants.length ? 'Survivants : ' + survivants.join(' ; ') : 'Aucun survivant.'));
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(survivants.length ? 1 : 0);
