/* Réinjection des défauts de la barre d'onglets (v63). Chaque mutant doit
   faire rougir sa suite. On travaille sur une copie : le dossier d'origine
   n'est jamais écrit. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-onglets';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = {};
for (const f of ['app.js', 'index.html']) lu[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

const mutants = [
  ['index.html', 'la barre elle-même', '<nav class="ongl hide" id="ongl">', '<nav class="ongl hide" id="onglX">'],
  ['index.html', 'le troisième lieu', '<button id="ongP" onclick="ouvrirPhoning()">', '<button id="ongP" class="hide" onclick="ouvrirPhoning()">'],
  ['index.html', 'la place réservée en bas du corps',
   'body.avecOnglets{padding-bottom:180px}', 'body.avecOnglets{padding-bottom:0}'],
  ['index.html', '« Continuer » posé au-dessus des onglets',
   'body.avecOnglets .bar{bottom:calc(58px + env(safe-area-inset-bottom))}',
   'body.avecOnglets .bar{bottom:0}'],
  ['app.js', 'la barre réservée à qui prospecte',
   'if(!(CFG && CFG.prospection)) return false;', 'if(false) return false;'],
  ['app.js', 'la barre effacée pendant une modification',
   'if(enModification()) return false;', 'if(false) return false;'],
  ['app.js', 'les trois seuls écrans qui la portent',
   "var ONGLET_ECRAN = { e1:'devis', e6:'liste', ePro:'phoning' };",
   "var ONGLET_ECRAN = { e1:'devis', e2:'devis', e5:'devis', e6:'liste', e7:'devis', ePro:'phoning', eAd1:'devis', eAg1:'devis' };"],
  ['app.js', 'la barre posée à chaque changement d\'écran',
   '  try{ document.body.classList.toggle(\'admin\', estAdmin()); }catch(e){}\n  majOnglets();',
   '  try{ document.body.classList.toggle(\'admin\', estAdmin()); }catch(e){}'],
  ['app.js', 'l\'onglet allumé là où l\'on est',
   "$('ongP').classList.toggle('on', ou === 'phoning');",
   "$('ongP').classList.toggle('on', false);"],
  ['app.js', 'l\'onglet du devis allumé sur le devis',
   "$('ongD').classList.toggle('on', ou === 'devis');",
   "$('ongD').classList.toggle('on', false);"],
  ['app.js', 'la place réservée au bon moment',
   "document.body.classList.toggle('avecOnglets', ici);",
   "document.body.classList.toggle('avecOnglets', false);"],
  ['app.js', 'le devis repris là où il en était',
   'etape(ETAPE_DEVIS >= 1 && ETAPE_DEVIS <= 4 ? ETAPE_DEVIS : 1);', 'etape(1);'],
  ['app.js', 'l\'étape du devis retenue',
   'if(n>=1 && n<=4) ETAPE_DEVIS = n;', ''],
  ['app.js', 'l\'étape oubliée une fois le devis terminé',
   "  ETAPE_DEVIS = 1;              // le devis est fait : l'onglet n'y ramène plus\n", ''],
  ['app.js', 'le « Retour » retiré là où les onglets sont',
   "if(ongletsIci()){ $('bar').classList.add('hide'); return; }", ''],
  ['app.js', 'l\'onglet Devis qui ne recommence pas un devis neuf',
   'function ongletDevis(){\n  etape(', 'function ongletDevis(){\n  nouveauDevis(); return etape(']
];

/* Par tranches : « node mutonglets.mjs 0 6 » n'en pose que six, pour tenir
   sous le délai de l'outil qui lance la commande. Un harnais tué en route
   laisserait le défaut dans la copie — ici la copie est jetée à la fin, mais
   le découpage évite aussi d'attendre dix minutes sans rien voir. */
const d0 = Number(process.argv[2] || 0);
const d1 = Number(process.argv[3] || mutants.length);

let survivants = [];
for (const [fichier, nom, de, vers] of mutants.slice(d0, d1)) {
  const orig = lu[fichier];
  const n = orig.split(de).length - 1;
  if (n !== 1) { console.log('⚠ ' + nom + ' : ' + n + ' occurrence(s), mutant non posé'); continue; }
  fs.writeFileSync(path.join(TMP, fichier), orig.replace(de, vers));
  let sortie = '';
  try {
    sortie = execFileSync('node', ['tonglets.mjs'],
      { env: { ...process.env, DEVIS_APPLI: TMP }, encoding: 'utf8', timeout: 300000 });
  } catch (e) { sortie = (e.stdout || '') + (e.stderr || ''); }
  fs.writeFileSync(path.join(TMP, fichier), orig);
  const m = sortie.match(/(\d+) au vert, (\d+) au rouge/);
  const rouges = m ? Number(m[2]) : -1;
  const plante = !m;
  console.log((rouges > 0 || plante ? '✓' : '✗ SURVIVANT') + ' ' + nom +
              ' → ' + (plante ? 'la suite casse' : rouges + ' au rouge'));
  if (rouges === 0 && !plante) survivants.push(nom);
}
console.log('\n' + (survivants.length ? 'Survivants : ' + survivants.join(' ; ') : 'Aucun survivant.'));
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(survivants.length ? 1 : 0);
