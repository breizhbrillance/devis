/* La grille de référence : ce qu'elle porte, et ce qu'elle ne porte plus.

   Le banc complet de la v63 à la v77 a été perdu avec le conteneur de la
   session ; cette suite reprend, sur la grille, ce qui doit tenir aujourd'hui —
   et d'abord les retraits demandés par Simon, qui sont ce qu'un catalogue
   oublie le plus facilement.

   Une référence retirée ne se réattribue JAMAIS : une ligne de devis déjà
   établie la porte, et la réemployer changerait le sens d'un devis signé.
*/
import { creer, charger } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };

creer('REGLAGES', [['CLE','VALEUR','NOTE'], ['societe_nom','BREIZH BRILLANCE','']]);
creer('CATALOGUE', [['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES','PU_COMPLEMENT']]);
creer('COMMERCIAUX', [['NOM','EMAIL','CODE','ACTIF'], ['SIMON LG','s@t.fr','ab1!','OUI']]);
creer('JOURNAL', [['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);

const g = charger(CODE_GS);
const G = g.CATALOGUE_DEFAUT_;
const refs = G.map(l => l[8]);
const aNature = (l, n) => String(l[9] || '').split(/[^A-Z]+/).indexOf(n) >= 0;

/* ---------- les retraits ---------- */
/* REF-0019 : les tablettes de commande d'un restaurant (devis particulier).
   REF-0035 : le forfait vitrerie tout compris, qui doublonnait avec le détail.
   REF-0018 : le dépoussiérage des lustres et luminaires, retiré le 26 octobre
   2026 — Simon l'avait d'abord gardé à 6,20 €, il ne le vend plus. */
[['REF-0019', 'les tablettes de commande'],
 ['REF-0035', 'le forfait vitrerie tout compris'],
 ['REF-0018', 'le dépoussiérage des lustres et luminaires']
].forEach(function (x) {
  T(x[1] + ' a quitté la grille', refs.indexOf(x[0]) < 0, refs.filter(r => r === x[0]));
});
T('et aucun luminaire ne traîne sous un autre nom',
  G.every(l => !/lustre|luminaire/i.test(String(l[1]))),
  G.filter(l => /lustre|luminaire/i.test(String(l[1]))).map(l => l[8]));
T('aucune référence retirée n\'est réattribuée : les trous restent',
  new Set(refs).size === refs.length &&
  ['REF-0018','REF-0019','REF-0035'].every(r => refs.indexOf(r) < 0), refs.length);

/* ---------- ce qui doit rester ---------- */
T('la grille compte 40 prestations', G.length === 40, G.length);
T('toutes ont une référence', refs.every(r => /^REF-00\d\d$/.test(r)),
  refs.filter(r => !/^REF-00\d\d$/.test(r)));
T('la dernière posée est REF-0043',
  Math.max.apply(null, refs.map(r => Number(r.slice(4)))) === 43, refs.slice(-2));

/* Le canapé et ses deux prix (16 octobre 2026). */
const canape = G.find(l => l[8] === 'REF-0042');
T('le canapé est au catalogue', !!canape, 'absent');
T('à 150 € seul et 70 € en complément',
  canape && canape[4] === 150 && canape[10] === 70, canape && [canape[4], canape[10]]);
T('il ne se vend pas sur un contrat d\'entretien',
  canape && !aNature(canape, 'ENTRETIEN'), canape && canape[9]);

/* Les deux nacelles, une par métier, au même prix (19 octobre 2026). */
const nac = G.filter(l => /nacelle/i.test(String(l[1])));
T('deux nacelles, une par catégorie', nac.length === 2, nac.map(l => [l[8], l[0]]));
T('au même prix à la journée',
  nac.every(l => l[4] === 450 && /journ/.test(String(l[3]))), nac.map(l => [l[3], l[4]]));
T('aucune ne se vend sur les deux natures à la fois',
  nac.every(l => !(aNature(l, 'FACADE') && aNature(l, 'VITRERIE'))), nac.map(l => l[9]));

/* Les prix d'entretien corrigés par Simon le 12 octobre 2026. */
const sols = { 'REF-0026': 0.10, 'REF-0027': 0.10, 'REF-0028': 0.15 };
Object.keys(sols).forEach(function (r) {
  const l = G.find(x => x[8] === r);
  T('les sols d\'entretien tiennent leur prix (' + r + ')',
    l && l[4] === sols[r] && l[3] === 'm2', l && [l[3], l[4]]);
});

/* La grille s'écrit telle quelle dans un classeur. */
const grille = g.grilleComplete_();
T('toutes les lignes ont la largeur des en-têtes',
  grille.every(l => l.length === g.ENTETES_CATALOGUE_.length),
  [...new Set(grille.map(l => l.length))]);
creer('CATALOGUE', [g.ENTETES_CATALOGUE_, ...grille]);
const lu2 = g.lireCatalogue_();
T('et elle se relit entière', lu2.length === G.length, [lu2.length, G.length]);
T('sans luminaire', lu2.every(p => !/lustre|luminaire/i.test(p.designation)),
  lu2.filter(p => /lustre|luminaire/i.test(p.designation)).map(p => p.reference));

console.log('\n=== LA GRILLE DE REFERENCE : ' + ok.length + ' au vert, ' +
            ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
