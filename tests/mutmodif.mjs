/* Réinjection des défauts de « Modifier un devis » (v62). Chaque mutant doit
   faire rougir sa suite. On travaille sur une copie : le dossier d'origine
   n'est jamais écrit. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-modif';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = {};
for (const f of ['Code.gs', 'app.js', 'index.html']) lu[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

const mutants = [
  ['app.js', 'tmodif', 'le bouton Modifier', 'this)">Modifier</button>', 'this)">X</button>'],
  ['app.js', 'tmodif', 'le refus d\'un devis signé',
   "if(estSigne(e)){\n      return erreur(", "if(false){\n      return erreur("],
  ['app.js', 'tmodif', 'le devis garde son numéro',
   'var devis = {\n      numero: numModif ||', 'var devis = {\n      numero: false ||'],
  ['app.js', 'tmodif', 'la mise à jour de la fiche plutôt qu\'une création',
   'if(enModification()) return enregistrerModification(b, envoi, moi, secours, devis, pdf64);', ''],
  ['app.js', 'tmodif', 'les prix d\'origine conservés',
   '    recalerLibreSeq();\n    REMISE = {valeur: Number(d.remise) || 0, muet: false};',
   '    LIGNES.forEach(function(l){ var pr = prestationRef(l.reference); if(pr) l.pu = (Number(pr.pu)||0) + 1; });\n    recalerLibreSeq();\n    REMISE = {valeur: Number(d.remise) || 0, muet: false};'],
  ['app.js', 'tmodif', 'la révision envoyée au bureau',
   'enr.revision = true;', 'enr.revision = false;'],
  ['app.js', 'tmodif', 'la fermeture de la modification après enregistrement',
   'MODIF = null; majBandeauModif();\n      lsj(\'brouillon\', null);', "lsj('brouillon', null);"],
  ['app.js', 'tmodif', 'la modification gardée dans le brouillon',
   'modif:MODIF});', 'modif:null});'],
  ['app.js', 'tmodif', 'la modification reprise au redémarrage',
   "MODIF = (b.modif && b.modif.id) ? {id:b.modif.id, numero:b.modif.numero || ''} : null;",
   'MODIF = null;'],
  ['app.js', 'tmodif', 'le bandeau limité au parcours',
   'var ici = enModification() && ETAPE >= 1 && ETAPE <= 4;', 'var ici = enModification();'],
  ['app.js', 'tmodif', 'la date de création conservée',
   'enr.modifieLe = Date.now();', 'enr.modifieLe = Date.now(); enr.cree = Date.now();'],
  ['app.js', 'tmodif', 'le refus si le devis a été signé entre-temps',
   'if(estSigne(enr) && !devis.signature){', 'if(false){'],
  ['app.js', 'tmodif', 'la question qui annonce une modification',
   "demander(enMod ? 'Reprendre la modification en cours ?' : 'Reprendre le devis en cours ?',",
   "demander('Reprendre le devis en cours ?',"],
  ['index.html', 'tmodif', 'le bandeau de modification',
   '<div id="bandModif" class="bandModif hide">', '<div id="bandModifX" class="bandModif hide">'],
  ['Code.gs', 'trevis', 'l\'adresse réécrite par la révision',
   "ADRESSE: c.adresse || '', CP: c.cp || '', VILLE: c.ville || '',\n    REMISE_PCT:", '    REMISE_PCT:'],
  ['Code.gs', 'trevis', 'la nature réécrite par la révision',
   'NATURE: natureDevis_(devis.nature),\n    ETAT_SITE: etatSite_(devis.etatSite),\n    KM_AGENCE: kmR,',
   'ETAT_SITE: etatSite_(devis.etatSite),\n    KM_AGENCE: kmR,'],
  ['Code.gs', 'trevis', 'la date souhaitée réécrite',
   'DATE_SOUHAITEE: jourValide_(devis.dateSouhaitee),\n    NATURE:', '    NATURE:'],
  ['Code.gs', 'trevis', 'la distance réservée aux natures de secteur',
   "var kmR = majorableKm_(devis.nature) ? kmDevis_(devis, communes) : '';",
   'var kmR = kmDevis_(devis, communes);'],
  ['Code.gs', 'trevis', 'le refus de réviser un devis signé',
   'if (d.revision && !dejaSigne && !devis.signature) {', 'if (d.revision) {']
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
