/* Réinjection des défauts de l'objet automatique et du retrait de REF-0018
   (26 octobre 2026). Copie de travail, jamais l'original.
   Par tranches : « node mutobjet.mjs 0 4 ». */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-objet';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = {};
for (const f of ['app.js', 'Code.gs']) lu[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

const mutants = [
  ['app.js', 'tobjet', 'l\'objet posé au choix de la nature',
   "  majNature();\n  poserObjet();", "  majNature();"],
  ['app.js', 'tobjet', 'l\'objet qui suit la nature, et non un texte figé',
   "function objetAuto(){ return NATURE ? libelleNature(NATURE) : ''; }",
   "function objetAuto(){ return NATURE ? 'Devis de nettoyage' : ''; }"],
  ['app.js', 'tobjet', 'ce que le commercial a écrit, laissé intact',
   "  if(!estObjetAuto(e.value)) return;        // le commercial a écrit : on se tait",
   "  ;"],
  ['app.js', 'tobjet', 'le champ vide reconnu comme libre',
   "  if(!t) return true;                       // vide : à nous", "  if(!t) return false;"],
  ['app.js', 'tobjet', 'l\'objet reposé en arrivant sur les prestations',
   "  if(n===3){ poserObjet(); rendreLignes(); }", "  if(n===3){ rendreLignes(); }"],
  ['app.js', 'tobjet', 'le devis neuf qui repart sans objet',
   "'fSignataire','fNotes','fObjet','fDelai','fDate']",
   "'fSignataire','fNotes','fDelai','fDate']"],

  /* --- le retrait du dépoussiérage des luminaires --- */
  ['Code.gs', 'tgrille', 'REF-0018 retirée de la grille',
   "  /* REF-0018, « Dépoussiérage des lustres et luminaires » à 6,20 € en forfait,",
   "  ['Bureaux et espaces de travail', 'Dépoussiérage des lustres et luminaires', '', 'forfait', 6.20, 20, 'PONCTUEL', 'OUI', 'REF-0018', 'ENTRETIEN'],\n  /* REF-0018, « Dépoussiérage des lustres et luminaires » à 6,20 € en forfait,"],
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
      { env: { ...process.env, DEVIS_APPLI: TMP }, encoding: 'utf8', timeout: 400000 });
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
