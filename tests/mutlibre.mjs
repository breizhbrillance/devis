/* Réinjecte un défaut à la fois dans la ligne libre et vérifie que tlibre.mjs
   le voit. Le banc doit mordre sur chacun : sans ça, il ne protège rien. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const DOSSIER = '/mnt/user-data/outputs/devis-nettoyage-pwa/';
const SUITE = process.argv[2] || 'tlibre';
/* Un mutant peut viser app.js (par défaut) ou un autre fichier de l'appli. */
const lu = {};
const fichier = m => DOSSIER + (m[3] || 'app.js');
const source = m => (lu[fichier(m)] = lu[fichier(m)] || fs.readFileSync(fichier(m), 'utf8'));

/* Un harnais interrompu en plein mutant laisse le défaut dans le fichier, et
   la fois suivante le prend pour l'original : le banc verdit alors sur du code
   faux. On refuse de démarrer si l'un des motifs d'origine manque déjà, et on
   remet le fichier en place même sur Ctrl-C. */
const remettre = () => {
  Object.keys(lu).forEach(f => { try { fs.writeFileSync(f, lu[f]); } catch (e) {} });
};
process.on('SIGINT', () => { remettre(); process.exit(130); });
process.on('SIGTERM', () => { remettre(); process.exit(143); });
process.on('uncaughtException', e => { remettre(); throw e; });

const TOUS = [
  ['la référence réservée n\'est plus posée',
   "    reference:REF_LIBRE + LIBRE_SEQ};", "    reference:''};"],
  ['toutes les lignes libres partagent la même référence',
   "function ajouterLigneLibre(){\n  LIBRE_SEQ++;", "function ajouterLigneLibre(){\n  LIBRE_SEQ = 1;"],
  ['le compteur ne se recale pas sur un brouillon repris',
   "    if(n > max) max = n;", "    if(false) max = n;"],
  ['l\'éloignement gonfle aussi le prix décidé sur place',
   "    if(!taux || estLigneLibre(l)) return l;", "    if(!taux) return l;"],
  ['la ligne libre entre dans l\'assiette de l\'éloignement',
   "    if(String(l.reference||'') === REF_MAJ || estLigneLibre(l)) return;",
   "    if(String(l.reference||'') === REF_MAJ) return;"],
  ['la ligne libre majore l\'état des lieux',
   "  LIGNES.forEach(function(l){ if(!estLigneLibre(l)) base += brutL(l); });",
   "  LIGNES.forEach(function(l){ base += brutL(l); });"],
  ['la ligne libre retombe dans « hors catalogue »',
   "    return !estLigneLibre(l) && !connues[clePresta(l)];", "    return !connues[clePresta(l)];"],
  ['un prix négatif n\'est plus ramené à zéro',
   "    if(!isFinite(n) || n < 0) n = 0;\n    l[champ] = n;", "    if(!isFinite(n)) n = 0;\n    l[champ] = n;"],
  ['une ligne libre sans intitulé passe à l\'écran suivant',
   "    var vide = libreIncomplete();\n    if(vide) return erreur(vide + ' Complète-la ou retire-la.');", ""],
  ['le total de la ligne ne se rafraîchit plus',
   "  var t = $('ltt' + ref);\n  if(t) t.textContent = eur(montantL(l));", "  var t = null;\n  if(t) t.textContent = '';"],
  ['le bloc de la ligne libre disparaît de l\'écran',
   "  h += blocLibre();", ""],
  ['la référence interne part chez le client sur le PDF',
   "        if (refL && refL.indexOf('LIBRE-') !== 0) {", "        if (refL) {", 'pdf.js'],
  ['retirer une ligne libre ne retire rien',
   "  LIGNES.splice(LIGNES.indexOf(l), 1);\n  rendreLignes(); sauverBrouillon();\n}\n/* Une ligne libre sans intitulé",
   "  rendreLignes(); sauverBrouillon();\n}\n/* Une ligne libre sans intitulé"],
];
TOUS.forEach(source);
const abimes = TOUS.filter(m => source(m).split(m[1]).length - 1 !== 1);
if (abimes.length) {
  console.log('Le fichier ne contient pas ses motifs d\'origine — un harnais a été interrompu :');
  abimes.forEach(([n]) => console.log('  ⚠ ' + n));
  console.log('Répare app.js avant de relancer.');
  process.exit(2);
}

const mutants = TOUS.slice(Number(process.argv[3]||0), Number(process.argv[4]||99));

let vus = 0, manques = [];
for (const m of mutants) {
  const [nom, avant, apres] = m;
  const f = fichier(m), orig = source(m);
  if (orig.split(avant).length - 1 !== 1) { manques.push(nom + '  (motif introuvable ou multiple)'); continue; }
  fs.writeFileSync(f, orig.replace(avant, apres));
  const r = spawnSync(process.execPath, [SUITE + '.mjs'],
    { cwd: process.cwd() + '/tests', encoding: 'utf8', timeout: 400000,
      env: Object.assign({}, process.env, { DEVIS_APPLI: '/mnt/user-data/outputs/devis-nettoyage-pwa' }) });
  const rouges = (r.stdout.match(/✗/g) || []).length;
  if (rouges) { vus++; console.log('  vu    ' + nom + '  (' + rouges + ' au rouge)'); }
  else manques.push(nom + '  → ' + (r.status === 0 ? 'passe inaperçu' : 'PLANTE'));
  fs.writeFileSync(f, orig);
}
remettre();
console.log('\n' + vus + ' / ' + mutants.length + ' défauts repérés');
manques.forEach(m => console.log('  MANQUÉ ' + m));
process.exit(manques.length ? 1 : 0);
