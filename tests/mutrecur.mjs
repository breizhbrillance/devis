/* Réinjection des défauts des contrats récurrents (v65). Chaque mutant doit
   faire rougir la suite. On travaille sur une copie : le dossier d'origine
   n'est jamais écrit.

   Par tranches : « node mutrecur.mjs 0 8 ». */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-recur';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = { 'Code.gs': fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8') };

const mutants = [
  ['l\'idempotence', '      if (deja[cle]) return;', ''],
  ['la clé qui porte la date', "var cle = id + '|' + isoJour_(d);", "var cle = id;"],
  ['la quinzaine ancrée sur le début de la série',
   '    ancre = new Date(debut);', '    ancre = new Date(d0);'],
  ['le 31 ramené au dernier jour du mois',
   'ok = (d.getDate() === Math.min(jourMois, dernier));', 'ok = (d.getDate() === jourMois);'],
  ['l\'horizon réglable',
   'horizon.setDate(horizon.getDate() + semainesRecurrents_(reg) * 7);',
   'horizon.setDate(horizon.getDate() + 365);'],
  ['la série arrêtée qui ne pose plus rien',
   "return String(r.ID || '').trim() && String(r.ACTIF || '').toUpperCase().trim() !== 'NON';",
   "return String(r.ID || '').trim();"],
  ['la série sans identifiant écartée',
   "return String(r.ID || '').trim() && String(r.ACTIF || '').toUpperCase().trim() !== 'NON';",
   "return String(r.ACTIF || '').toUpperCase().trim() !== 'NON';"],
  ['le chantier sans salarié qui reste à planifier',
   "STATUT: String(r.PRESTATAIRE || '').trim() ? 'PLANIFIE' : 'A PLANIFIER',",
   "STATUT: 'PLANIFIE',"],
  ['l\'accès recopié sur le chantier',
   "        ACCES: String(r.ACCES || ''),\n", "        ACCES: '',\n"],
  ['la fiche de travail recopiée',
   "        NOTE: String(r.PRESTATIONS || r.NOTE || ''),", "        NOTE: '',"],
  ['la durée recopiée',
   "DUREE_PREVUE_MIN: Math.round(Number(r.DUREE_MIN) || 0) || '',",
   "DUREE_PREVUE_MIN: '',"],
  ['le début de série respecté', '  if (debut && debut > d0) d0 = debut;', ''],
  ['la fin de série respectée', '  if (fin && fin < d1) d1 = fin;', ''],
  ['le passage déjà commencé qu\'on ne touche pas',
   "    if (cArr >= 0 && String(l[cArr] || '').trim()) continue;     // déjà pointé",
   '    if (false) continue;'],
  ['le passé qu\'on ne réécrit pas',
   '    if (!dl || isNaN(dl.getTime()) || dl < aujourd) continue;',
   '    if (!dl || isNaN(dl.getTime())) continue;'],
  ['le ménage des séries arrêtées',
   '    var morte = !etat || !etat.actif || (etat.fin && dl > etat.fin);',
   '    var morte = false;'],
  ['le jour de la semaine mal écrit, refusé',
   '  return -1;\n}\n\n/** Le jour, à minuit', '  return 1;\n}\n\n/** Le jour, à minuit'],
  ['l\'heure écrite lisiblement', 'DATE: d, HEURE: heureTexte_(r.HEURE),',
   "DATE: d, HEURE: String(r.HEURE || ''),"],
  ['l\'heure relue par l\'écran du salarié',
   "      heure: heureTexte_(o.HEURE),\n      statut: String(o.STATUT || 'PLANIFIE'),",
   "      heure: String(o.HEURE || ''),\n      statut: String(o.STATUT || 'PLANIFIE'),"],
  ['la génération au rappel quotidien',
   '  try { genererRecurrents_(); }\n', '  try { }\n']
];

const d0 = Number(process.argv[2] || 0);
const d1 = Number(process.argv[3] || mutants.length);

let survivants = [];
for (const [nom, de, vers] of mutants.slice(d0, d1)) {
  const orig = lu['Code.gs'];
  const n = orig.split(de).length - 1;
  if (n !== 1) { console.log('⚠ ' + nom + ' : ' + n + ' occurrence(s), mutant non posé'); continue; }
  fs.writeFileSync(path.join(TMP, 'Code.gs'), orig.replace(de, vers));
  let sortie = '';
  try {
    sortie = execFileSync('node', ['trecur.mjs'],
      { env: { ...process.env, DEVIS_APPLI: TMP }, encoding: 'utf8', timeout: 180000 });
  } catch (e) { sortie = (e.stdout || '') + (e.stderr || ''); }
  fs.writeFileSync(path.join(TMP, 'Code.gs'), orig);
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
