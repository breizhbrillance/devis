/* Réinjection des défauts du planning du commercial (v66). Chaque mutant doit
   faire rougir sa suite. On travaille sur une copie : le dossier d'origine
   n'est jamais écrit.

   Par tranches : « node mutplancom.mjs 0 7 ». */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-plancom';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = {};
for (const f of ['Code.gs', 'app.js', 'index.html']) lu[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

const mutants = [
  ['Code.gs', 'tplancom', 'le droit au planning annoncé à l\'application',
   'planning: aussiPrestataire_(com && com.nom)', 'planning: false'],
  ['Code.gs', 'tplancom', 'le droit au planning refusé à qui n\'est pas prestataire',
   'planning: aussiPrestataire_(com && com.nom)', 'planning: true'],
  ['Code.gs', 'tplancom', 'les deux actions ouvertes au commercial qui pose des chantiers',
   "      permis = permis.concat(['planning', 'chantier']);\n", ''],
  ['Code.gs', 'tplancom', 'la cloison : seulement s\'il est vraiment prestataire',
   "    if (!admin && !agent && aussiPrestataire_(com.nom)) {",
   '    if (!admin && !agent) {'],
  ['Code.gs', 'tplancom', 'le nom rapproché sans tenir compte de la casse',
   "  var n = normNom_(nom), oui = false;\n  lirePrestataires_().forEach(function (p) { if (normNom_(p.nom) === n) oui = true; });",
   "  var n = String(nom || ''), oui = false;\n  lirePrestataires_().forEach(function (p) { if (String(p.nom) === n) oui = true; });"],
  ['Code.gs', 'tplancom', 'PLANIFIABLE tenu hors de la répartition automatique',
   "             (iPlan < 0 || String(r[iPlan]).toUpperCase().trim() !== 'NON');",
   '             true;'],
  ['Code.gs', 'tplancom', 'PLANIFIABLE vide qui vaut oui',
   "             (iPlan < 0 || String(r[iPlan]).toUpperCase().trim() !== 'NON');",
   "             (iPlan >= 0 && String(r[iPlan]).toUpperCase().trim() === 'OUI');"],
  ['app.js', 'tonglets', 'l\'écran du planning reconnu comme un lieu',
   "var ONGLET_ECRAN = { e1:'devis', e6:'liste', ePro:'phoning', eAg1:'planning' };",
   "var ONGLET_ECRAN = { e1:'devis', e6:'liste', ePro:'phoning' };"],
  ['app.js', 'tonglets', 'la barre posée pour le seul planning',
   "  if(!(CFG && (CFG.prospection || CFG.planning))) return false;",
   '  if(!(CFG && CFG.prospection)) return false;'],
  ['app.js', 'tonglets', 'l\'onglet Planning montré selon le droit',
   "  $('ongPl').classList.toggle('hide', !(CFG && CFG.planning));",
   "  $('ongPl').classList.toggle('hide', false);"],
  ['app.js', 'tonglets', 'l\'onglet Phoning montré selon le droit',
   "  $('ongP').classList.toggle('hide', !(CFG && CFG.prospection));",
   "  $('ongP').classList.toggle('hide', false);"],
  ['app.js', 'tonglets', 'l\'onglet Planning allumé là où l\'on est',
   "  $('ongPl').classList.toggle('on', ou === 'planning');",
   "  $('ongPl').classList.toggle('on', false);"],
  ['app.js', 'tonglets', 'l\'onglet Planning qui ouvre le planning',
   'function ongletPlanning(){ ecranPlanning(); }',
   'function ongletPlanning(){ ouvrirHistorique(); }'],
  ['index.html', 'tonglets', 'le bouton du quatrième lieu',
   '<button id="ongPl" class="hide" onclick="ongletPlanning()">',
   '<button id="ongPlX" class="hide" onclick="ongletPlanning()">']
];

const d0 = Number(process.argv[2] || 0);
const d1 = Number(process.argv[3] || mutants.length);

let survivants = [];
for (const [fichier, suite, nom, de, vers] of mutants.slice(d0, d1)) {
  const orig = lu[fichier];
  const n = orig.split(de).length - 1;
  if (n !== 1) { console.log('⚠ ' + nom + ' : ' + n + ' occurrence(s), mutant non posé'); continue; }
  fs.writeFileSync(path.join(TMP, fichier), orig.replace(de, vers));
  let sortie = '';
  try {
    sortie = execFileSync('node', [suite + '.mjs'],
      { env: { ...process.env, DEVIS_APPLI: TMP }, encoding: 'utf8', timeout: 300000 });
  } catch (e) { sortie = (e.stdout || '') + (e.stderr || ''); }
  fs.writeFileSync(path.join(TMP, fichier), orig);
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
