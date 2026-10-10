/* Les mêmes défauts, mais côté classeur : ttarif.mjs doit les voir. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const GS = '/mnt/user-data/outputs/devis-nettoyage-pwa/Code.gs';
const original = fs.readFileSync(GS, 'utf8');
const remettre = () => { try { fs.writeFileSync(GS, original); } catch (e) {} };
process.on('SIGINT', () => { remettre(); process.exit(130); });
process.on('SIGTERM', () => { remettre(); process.exit(143); });

const TOUS = [
  ['la ligne libre redevient « hors catalogue »',
   "    } else if (estLigneLibre_(l)) {", "    } else if (false) {"],
  ['le signalement ne dit plus ni le nom ni le montant',
   "      ecarts.push('ligne ' + (i + 1) + ' : ligne libre « ' + (l.designation || 'sans nom') +\n                  ' », ' + (Number(l.qte) || 0) + ' ' + (l.unite || '') +\n                  ' à ' + (Number(l.pu) || 0) + ' € = ' + mL + ' €');",
   "      ecarts.push('ligne ' + (i + 1) + ' : ligne libre');"],
  ['la ligne libre majore l\'état des lieux côté classeur',
   "    if (estLigneLibre_(l)) return;\n    base += Math.round", "    base += Math.round"],
  ['le préfixe réservé est reconnu n\'importe où dans la référence',
   "  return String((l && l.reference) || '').trim().indexOf(REF_LIBRE_) === 0;",
   "  return String((l && l.reference) || '').trim().indexOf(REF_LIBRE_) >= 0;"],
  ['le plafond de remise ne s\'applique plus',
   "    var rem = Number(l.rem) || 0;\n    if (rem > max + 0.001) {", "    var rem = 0;\n    if (rem > max + 0.001) {"],
];
const abimes = TOUS.filter(([, a]) => original.split(a).length - 1 !== 1);
if (abimes.length) { abimes.forEach(([n]) => console.log('⚠ motif absent : ' + n)); process.exit(2); }

let vus = 0, manques = [];
for (const [nom, avant, apres] of TOUS) {
  fs.writeFileSync(GS, original.replace(avant, apres));
  const r = spawnSync(process.execPath, ['ttarif.mjs'],
    { cwd: process.cwd() + '/tests', encoding: 'utf8', timeout: 120000,
      env: Object.assign({}, process.env, { DEVIS_APPLI: '/mnt/user-data/outputs/devis-nettoyage-pwa' }) });
  const rouges = (r.stdout.match(/✗/g) || []).length;
  if (rouges) { vus++; console.log('  vu    ' + nom + '  (' + rouges + ' au rouge)'); }
  else manques.push(nom + '  → ' + (r.status === 0 ? 'passe inaperçu' : 'PLANTE'));
  fs.writeFileSync(GS, original);
}
remettre();
console.log('\n' + vus + ' / ' + TOUS.length + ' défauts repérés');
manques.forEach(m => console.log('  MANQUÉ ' + m));
process.exit(manques.length ? 1 : 0);
