/* Réinjection des défauts du gérant maître de son planning (v70). Chaque
   mutant doit faire rougir sa suite. On travaille sur une copie : le dossier
   d'origine n'est jamais écrit.

   Par tranches : « node mutgestion.mjs 0 5 ». */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = '/mnt/user-data/outputs/devis-nettoyage-pwa';
const TMP = '/tmp/mut-gestion';
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(SRC, TMP, { recursive: true });

const lu = {};
for (const f of ['Code.gs', 'app.js', 'index.html']) lu[f] = fs.readFileSync(path.join(SRC, f), 'utf8');

const mutants = [
  ['Code.gs', 'tgestion', 'l\'annulation qui pose vraiment ANNULE',
   "    majChantier_(id, { STATUT: 'ANNULE' });", "    majChantier_(id, {});"],
  ['Code.gs', 'tgestion', 'le refus d\'annuler un chantier déjà pointé',
   "    if (avant.ARRIVEE && String(avant.ARRIVEE).trim()) {\n      return { ok: false, erreur: 'ce chantier a déjà été pointé : il ne peut plus être annulé' };\n    }\n",
   ''],
  ['Code.gs', 'tgestion', 'le statut recalculé au rétablissement',
   "    var st = (avant.DATE && String(avant.PRESTATAIRE || '').trim()) ? 'PLANIFIE' : 'A PLANIFIER';",
   "    var st = 'PLANIFIE';"],
  ['Code.gs', 'tgestion', 'les champs d\'identité recopiés',
   "  champsIdentiteChantier_().forEach(function (f) {\n    if (d[f.env] !== undefined) v[f.col] = String(d[f.env] || '');\n  });",
   ''],
  ['Code.gs', 'tgestion', 'un champ absent de l\'envoi laissé tranquille',
   "    if (d[f.env] !== undefined) v[f.col] = String(d[f.env] || '');",
   "    v[f.col] = String(d[f.env] || '');"],
  ['Code.gs', 'tgestion', 'l\'identifiant du chantier neuf pris au plus grand',
   "  var id = 'CH-' + ('000' + prochainNumChantier_(sh, cId)).slice(-4);",
   "  var id = 'CH-' + ('000' + sh.getLastRow()).slice(-4);"],
  ['Code.gs', 'tgestion', 'le client obligatoire à la création',
   "  if (!client) return { ok: false, erreur: 'il faut au moins un nom de client' };", ''],
  ['Code.gs', 'tgestion', 'le prestataire vérifié à la création',
   "    if (!connu) return { ok: false, erreur: 'ce prestataire n\\'est pas dans la liste' };\n  }\n\n  var date = String(d.date || '').trim()",
   "  }\n\n  var date = String(d.date || '').trim()"],
  ['Code.gs', 'tgestion', 'le statut du chantier neuf selon ce qu\'on en sait',
   "    STATUT: (date && qui) ? 'PLANIFIE' : 'A PLANIFIER',",
   "    STATUT: 'PLANIFIE',"],
  ['Code.gs', 'tgestion', 'le lot qui dit ce qui n\'est pas passé',
   "    else refus.push(id + ' : ' + ((r && r.erreur) || 'refusé'));", '    else {}'],
  ['Code.gs', 'tgestion', 'le plafond du lot',
   "  if (ids.length > 60) return { ok: false, erreur: 'trop de chantiers d\\'un coup (60 au plus)' };",
   ''],
  ['Code.gs', 'tgestion', 'le lot vide refusé',
   "  if (!ids.length) return { ok: false, erreur: 'aucun chantier choisi' };", ''],
  ['Code.gs', 'tgestion', 'la nature saisie qui ne se devine pas',
   "  if (d.nature !== undefined) v.NATURE = natureChoisie_(d.nature);",
   "  if (d.nature !== undefined) v.NATURE = natureOuVide_(d.nature);"],
  ['Code.gs', 'tgestion', 'les deux actions neuves ouvertes au gérant',
   "         'chantierNeuf', 'lotChantiers',\n         'prospects', 'appel', 'historique']",
   "         'prospects', 'appel', 'historique']"],
  ['Code.gs', 'tgestion', 'les deux actions neuves déclarées',
   "                   'chantierNeuf', 'lotChantiers',\n", ''],
  ['Code.gs', 'tgestion', 'le chantier annulé retiré du planning du salarié',
   "    if (String(o.STATUT || '').toUpperCase().trim() === 'ANNULE') continue;", ''],
  ['Code.gs', 'tgestion', 'le chantier annulé servi quand même au gérant',
   "      statut: String(o.STATUT || 'A PLANIFIER'),\n      arrivee: Number(o.ARRIVEE) || 0, depart: Number(o.DEPART) || 0,",
   "      statut: 'A PLANIFIER',\n      arrivee: Number(o.ARRIVEE) || 0, depart: Number(o.DEPART) || 0,"],
  ['app.js', 'tadmapp', 'les annulés tenus hors de la liste ordinaire',
   "    if(estAnnule(c)) return false;", ''],
  ['app.js', 'tadmapp', 'la confirmation avant d\'annuler',
   "  demander('Annuler ce chantier ?',\n           'Il disparaîtra des téléphones. La ligne reste au classeur, et tu pourras ' +\n           'le rétablir.', 'Annuler le chantier').then(function(oui){\n    if(oui) poserAnnulation(true, btn);\n  });",
   "  poserAnnulation(true, btn);"],
  ['app.js', 'tadmapp', 'l\'appui qui coche au lieu d\'ouvrir la fiche',
   "      (AD_SEL ? 'choisirChantier(\\'' + ech(c.id) + '\\')' : 'ficheChantier(\\'' + ech(c.id) + '\\')') + '\">' +",
   "      ('ficheChantier(\\'' + ech(c.id) + '\\')') + '\">' +"],
  ['app.js', 'tadmapp', 'le deuxième appui qui retire',
   "  if(AD_CHOIX[id]) delete AD_CHOIX[id]; else AD_CHOIX[id] = true;",
   "  AD_CHOIX[id] = true;"],
  ['app.js', 'tadmapp', 'l\'heure laissée hors de l\'envoi quand elle est vide',
   "    if(heure) env.heure = heure;", "    env.heure = heure;"],
  ['app.js', 'tadmapp', 'le lot retenu tant que rien n\'est choisi',
   "  if(!annuler && !date && !heure && AD_LOT_PRESTA === null){\n    return erreur('Choisis au moins une date, une heure ou un prestataire.');\n  }",
   ''],
  ['app.js', 'tadmapp', 'le client exigé avant de créer',
   "  if(!String(c.client || '').trim()) return erreur('Il faut au moins un nom de client.');",
   ''],
  ['app.js', 'tadmapp', 'les champs d\'identité envoyés au bureau',
   "  return { client: val('adClient'), adresse: val('adAdresse'), cp: val('adCp'),\n           ville: val('adVille'), acces: val('adAcces'), note: val('adNote'),\n           nature: AD_NATURE, date: val('adDate'), heure: val('adHeure'),\n           prestataire: AD_PRESTA };",
   "  return { date: val('adDate'), heure: val('adHeure'), prestataire: AD_PRESTA };"],
  ['app.js', 'tadmapp', 'la nature choisie sur la fiche',
   "           nature: AD_NATURE, date: val('adDate'), heure: val('adHeure'),",
   "           nature: '', date: val('adDate'), heure: val('adHeure'),"],
  ['index.html', 'tadmapp', 'le bouton du nouveau chantier',
   '<button class="btn sec sm" style="flex:1" onclick="nouveauChantier()">+ Nouveau chantier</button>',
   '<button class="btn sec sm hide" style="flex:1" onclick="nouveauChantier()">+ Nouveau chantier</button>'],
  ['index.html', 'tadmapp', 'la carte prise qui se voit',
   '  .card.adPris{border-color:var(--acc-b);background:var(--acc-f)}',
   '  .card.adPrisX{border-color:var(--acc-b);background:var(--acc-f)}']
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
