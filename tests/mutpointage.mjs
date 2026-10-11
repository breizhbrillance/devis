/* Réinjection des défauts du pointage discret (v69). Chaque mutant doit faire
   rougir sa suite. On travaille sur une copie : le dossier d'origine n'est
   jamais écrit.

   Par tranches : « node mutpointage.mjs 0 3 ». */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-pointage';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = {};
for (const f of ['app.js', 'index.html']) lu[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

const mutants = [
  ['app.js', 'tagent', 'l\'heure d\'arrivée tenue hors de l\'écran du salarié',
   "  else if(!dep) info.textContent = 'Arrivée enregistrée. Appuie en partant.';",
   "  else if(!dep) info.textContent = 'Arrivé à ' + heureLisible(arr) + '.';"],
  ['app.js', 'tagent', 'les deux heures tenues hors de l\'écran une fois fini',
   "  else info.textContent = 'Pointage enregistré.';",
   "  else info.textContent = 'Arrivé à ' + heureLisible(arr) + ', parti à ' + heureLisible(dep) + '.';"],
  ['app.js', 'tagent', 'la durée sur place tenue hors de l\'écran',
   "  var d = $('agDuree');\n  d.classList.add('hide');\n  d.textContent = '';",
   "  var d = $('agDuree');\n  d.classList.toggle('hide', !(arr && dep));\n  if(arr && dep) d.textContent = 'Durée sur place : ' + dureeLisible(c.minutes);"],
  ['app.js', 'tagent', 'la confirmation que l\'appui a été pris',
   "  else if(!dep) info.textContent = 'Arrivée enregistrée. Appuie en partant.';\n  else info.textContent = 'Pointage enregistré.';",
   "  else info.textContent = '';"],
  ['app.js', 'tagent', 'la confirmation mise en évidence',
   "  info.classList.toggle('ok', !!arr);", "  info.classList.toggle('ok', false);"],
  ['app.js', 'tadmapp', 'l\'heure d\'arrivée gardée pour le gérant',
   "      (c.arrivee ? '<div class=\"mini\" style=\"margin-top:10px\">Arrivé à ' + heureLisible(c.arrivee) +\n        (c.depart ? ', parti à ' + heureLisible(c.depart) + ' · ' + dureeLisible(c.minutes) : '') +\n        '</div>' : '') +",
   ''],
  ['app.js', 'tadmapp', 'la durée gardée pour le gérant',
   "        (c.depart ? ', parti à ' + heureLisible(c.depart) + ' · ' + dureeLisible(c.minutes) : '') +",
   "        '' +"]
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
