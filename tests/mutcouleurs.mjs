/* Réinjection des défauts du planning en couleurs (v67). Chaque mutant doit
   faire rougir sa suite. On travaille sur une copie : le dossier d'origine
   n'est jamais écrit.

   Par tranches : « node mutcouleurs.mjs 0 6 ». */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-couleurs';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = {};
for (const f of ['Code.gs', 'app.js', 'index.html']) lu[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

const mutants = [
  ['Code.gs', 'trecur', 'la nature de la série recopiée sur le chantier',
   "LOT: '', RECURRENT: cle, NATURE: natureOuVide_(r.NATURE)",
   "LOT: '', RECURRENT: cle, NATURE: ''"],
  ['Code.gs', 'trecur', 'la nature vide qui le reste',
   "function natureOuVide_(v) {\n  return String(v || '').trim() ? natureDevis_(v) : '';\n}",
   'function natureOuVide_(v) {\n  return natureDevis_(v);\n}'],
  ['Code.gs', 'tplancom', 'la nature servie au téléphone',
   '      nature: natureChantier_(o, parNature),\n', ''],
  ['Code.gs', 'tplancom', 'le repli sur le devis pour les chantiers anciens',
   "  var num = String(o.NUMERO || '').trim();\n  if (!num || !parNumero) return '';\n  return natureOuVide_(parNumero[num]);",
   "  return '';"],
  ['Code.gs', 'tplancom', 'la nature servie au gérant',
   "      signalement: String(o.SIGNALEMENT || ''), note: String(o.NOTE || ''),\n      nature: natureChantier_(o, natures)",
   "      signalement: String(o.SIGNALEMENT || ''), note: String(o.NOTE || '')"],
  ['app.js', 'tcouleurs', 'la couleur posée sur la carte',
   "(n ? 'style=\"--nT:' + n.t + ';--nF:' + n.f + ';--nI:' + n.i + '\"' : '') +",
   "'' +"],
  ['app.js', 'tcouleurs', 'la pastille qui écrit la nature',
   "(n ? '<span class=\"chNat\">' + ech(n.nom) + '</span>' : '') +", "'' +"],
  ['app.js', 'tcouleurs', 'la nature inconnue laissée sans couleur',
   "  return NATURES_VUE[String(v == null ? '' : v).toUpperCase().trim()] || null;",
   '  return NATURES_VUE[String(v == null ? \'\' : v).toUpperCase().trim()] || NATURES_VUE.CHANTIER;'],
  ['app.js', 'tcouleurs', 'deux natures qui ne partagent pas une couleur',
   "  VITRERIE:  { nom: 'Vitrages',        t: '#1baf7a', f: '#d8f2e8', i: '#0a6d4a' },",
   "  VITRERIE:  { nom: 'Vitrages',        t: '#2a78d6', f: '#dfeafa', i: '#1b5aa8' },"],
  ['app.js', 'tcouleurs', 'une teinte de carte assez claire pour le texte',
   "  FACADE:    { nom: 'Façade',          t: '#eda100', f: '#fbecd1', i: '#8a5e00' }",
   "  FACADE:    { nom: 'Façade',          t: '#eda100', f: '#eda100', i: '#8a5e00' }"],
  ['app.js', 'tcouleurs', 'la pastille d\'état gardée',
   '                 badgeChantier(x) +\n', ''],
  ['index.html', 'tcouleurs', 'la bande de couleur',
   'padding-left:16px;border-left:6px solid var(--nT, var(--line))',
   'padding-left:16px;border-left:0'],
  ['index.html', 'tcouleurs', 'la teinte posée sur toute la carte',
   '       background:var(--nF, var(--card));\n', ''],
  ['index.html', 'tcouleurs', 'le contour de la carte teintée',
   '       border-top-color:var(--nT, var(--line));\n', ''],
  ['index.html', 'tcouleurs', 'l\'encre de l\'heure',
   '.chH{font-size:17px;color:var(--nI, var(--txt));margin-right:7px;',
   '.chH{font-size:17px;color:var(--txt);margin-right:7px;'],
  ['index.html', 'tcouleurs', 'le fond blanc de la pastille',
   "         background:#fff;color:var(--nI, var(--mut));",
   "         background:var(--nF, #eef0f3);color:var(--nI, var(--mut));"],
  ['index.html', 'tcouleurs', 'le liseré de la pastille',
   '         border:1px solid var(--nT, var(--line));\n', ''],
  ['index.html', 'tcouleurs', 'la pastille d\'état rendue au blanc',
   '  .chC .vb-a{background:#fff}', '  .chC .vb-z{background:#fff}']
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
