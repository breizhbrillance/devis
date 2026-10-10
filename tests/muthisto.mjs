/* Réinjection des défauts du journal d'appels (v61). Chaque mutant doit faire
   rougir sa suite. Rien n'est écrit dans le dossier d'origine : on travaille
   sur une copie, et DEVIS_APPLI pointe dessus. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-histo';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = {};
for (const f of ['Code.gs', 'app.js', 'index.html']) lu[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

const mutants = [
  ['Code.gs', 'thisto', 'le journal n\'est que le mien',
   "if (String(r[col.COMMERCIAL] || '').trim() !== com.nom) continue;", ''],
  ['Code.gs', 'thisto', 'le tri du plus récent au plus ancien',
   "trouves.sort(function (a, b) { return a.t < b.t ? 1 : a.t > b.t ? -1 : 0; });", ''],
  ['Code.gs', 'thisto', 'le plafond du nombre de lignes rendues',
   'var coupe = trouves.length > max;', 'var coupe = false;'],
  ['Code.gs', 'thisto', 'la borne d\'ancienneté',
   'if (t < limite) { ecartes = true; continue; }', ''],
  ['Code.gs', 'thisto', 'une vieille ligne n\'arrête pas la lecture',
   'if (t < limite) { ecartes = true; continue; }', 'if (t < limite) { ecartes = true; break; }'],
  ['Code.gs', 'thisto', 'le plafond demandé par le téléphone',
   'Math.min(Number(d && d.max) || HISTO_MAX_, HISTO_MAX_)', '(Number(d && d.max) || HISTO_MAX_)'],
  ['Code.gs', 'thisto', 'le refus d\'un onglet APPELS abîmé',
   "if (col.HORODATAGE == null || col.COMMERCIAL == null) {", 'if (false) {'],
  ['Code.gs', 'thisto', 'l\'action autorisée au seul commercial',
   "'prospects', 'appel', 'historique'];\n    if (permis.indexOf(d.action) < 0)",
   "'prospects', 'appel', 'historique', 'historique'];\n    if (false)"],
  ['app.js', 'thistoapp', 'la fusion sans doublon',
   'if(vus[c] != null){', 'if(false){'],
  ['app.js', 'thistoapp', 'l\'arrondi à la seconde',
   "return id + '|' + (isNaN(d.getTime()) ? String(t) : Math.floor(d.getTime()/1000));",
   "return id + '|' + (isNaN(d.getTime()) ? String(t) : d.getTime());"],
  ['app.js', 'thistoapp', 'les résultats pas encore partis dans le journal',
   'PR.file.forEach(function(a){\n    var p = prParId(a.id);\n    poser({t:a.t, id:a.id, resultat:a.resultat,',
   'PR.file.slice(0,0).forEach(function(a){\n    var p = prParId(a.id);\n    poser({t:a.t, id:a.id, resultat:a.resultat,'],
  ['app.js', 'thistoapp', 'ce que l\'appareil a gardé',
   'Object.keys(PR.hist).forEach(function(id){', 'Object.keys({}).forEach(function(id){'],
  ['app.js', 'thistoapp', 'le tri du journal, côté téléphone',
   'out.sort(function(a, b){ return (new Date(b.t)) - (new Date(a.t)); });', ''],
  ['app.js', 'thistoapp', 'la note gardée sur l\'appareil',
   '{t:a.t, r:code, n:note}', '{t:a.t, r:code}'],
  ['app.js', 'thistoapp', 'la ligne morte quand le prospect a quitté la liste',
   "h += p\n      ? '<button class=\"prLigne\"", "h += true\n      ? '<button class=\"prLigne\""],
  ['app.js', 'thistoapp', 'le groupement par jour',
   "if(titre !== jour){", 'if(false){'],
  ['app.js', 'thistoapp', '« Aujourd\'hui » et « Hier »',
   "if(ecart === 0) return 'Aujourd\\'hui';", ''],
  ['app.js', 'thistoapp', 'le journal qui survit au refus du bureau',
   'PR.journal = r.appels || [];', 'PR.journal = r.appels || []; PR.hist = {}; PR.file = [];'],
  ['app.js', 'thistoapp', 'l\'aveu que le bureau en garde davantage',
   "(tronque || !PR.journalComplet ? ' (les plus récents)' : '')", "''"],
  ['index.html', 'thistoapp', 'l\'onglet Journal',
   '<button id="prOngJ" onclick="prOnglet(\'journal\')">Journal</button>', '']
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
