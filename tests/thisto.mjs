/* Le journal d'appels du commercial, côté classeur (v61).

   Simon, 10 octobre 2026 : « je veux que le commercial puisse voir son
   historique d'appels passés ». L'onglet APPELS garde déjà une ligne par
   tentative, jamais réécrite ; il suffisait de la rendre au téléphone. Mais
   « son » historique veut dire quelque chose de précis, et c'est ce que ces
   essais gardent :

   — un commercial ne reçoit que SES appels, jamais ceux d'un collègue. C'est
     le seul garde-fou : le suivi des prospects est commun à l'équipe, le
     journal ne l'est pas ;
   — les plus récents d'abord, et bornés — la feuille grossit d'une ligne par
     appel et portera un jour des dizaines de milliers de lignes ;
   — « complet » dit la vérité : faux quand le bureau en garde davantage, pour
     que l'écran puisse écrire « les plus récents » au lieu de laisser croire
     à un journal entier ;
   — un prestataire n'y a pas droit, comme pour le reste du phoning.
*/
import { creer, lire, charger, videProprietes } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };

const EN_P = ['ID','SIREN','COMMUNE','ZONE','SOCIETE','SECTEUR','ACTIVITE','DIRIGEANT',
  'TEL','MAIL','SITE','ADRESSE','EFFECTIF','PRIORITE',
  'SOURCE_HORAIRES','LUN','MAR','MER','JEU','VEN','SAM','DIM','COMMENTAIRE',
  'STATUT','NOTE','RAPPEL_LE','DERNIER_APPEL','NB_APPELS','COMMERCIAL','MAJ_LE'];
const EN_A = ['HORODATAGE','COMMERCIAL','ID_PROSPECT','SOCIETE','COMMUNE',
  'RESULTAT','NOTE','RAPPEL_LE','APPAREIL'];

const JOUR = 86400000;
const ilYA = (ms) => new Date(Date.now() - ms);

/* Une ligne d'APPELS telle que le classeur l'écrit : la date est un vrai
   objet Date, comme Sheets la rend, pas une chaîne. */
const appel = (quand, com, id, societe, res, note) =>
  [quand, com, id, societe, 'VANNES', res, note || '', '', 'tel-1'];

function socle(lignesAppels) {
  videProprietes();
  creer('PROSPECTS', [EN_P,
    ['P-1','','VANNES','VANNES AGGLO','PEINTURE DU GOLFE','BTP','','Yann',
     '+33297112233','','','1 rue','5',8, '','','','','','','','','', '','','','',0,'',''],
    ['P-2','','VANNES','VANNES AGGLO','ATELIER COULEURS','BTP','','Marie',
     '+33297445566','','','2 quai','3',6, '','','','','','','','','', '','','','',0,'','']]);
  creer('APPELS', [EN_A].concat(lignesAppels || []));
  creer('COMMERCIAUX', [['NOM','EMAIL','CODE','ACTIF','INITIALES'],
                        ['SIMON LG','simon@test.fr','ab1!','OUI','SLG'],
                        ['CLAIRE B','claire@test.fr','zz2!','OUI','CB']]);
  creer('PRESTATAIRES', [['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE'],
                         ['MAXIME T','max@test.fr','kw7!','OUI','','','','']]);
  creer('ADMINS', [['NOM','EMAIL','CODE','ACTIF'], ['PATRON','p@test.fr','qx4$','OUI']]);
  creer('JOURNAL', [['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  creer('REGLAGES', [['CLE','VALEUR','NOTE'], ['societe_nom','BREIZH BRILLANCE',''],
    ['prospection_active','OUI',''], ['prospection_relance_heures','3','']]);
  return charger(CODE_GS);
}

const rep = (g, o) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(o) } }));
const moi = (g, sup) => rep(g, Object.assign({ action: 'historique', nom: 'SIMON LG', code: 'ab1!' }, sup || {}));

/* ---------- 1. chacun son journal ---------- */
let g = socle([
  appel(ilYA(1 * 3600000), 'SIMON LG', 'P-1', 'PEINTURE DU GOLFE', 'nrp', ''),
  appel(ilYA(2 * 3600000), 'CLAIRE B', 'P-2', 'ATELIER COULEURS', 'rdv', 'mardi 9 h'),
  appel(ilYA(3 * 3600000), 'SIMON LG', 'P-2', 'ATELIER COULEURS', 'interesse', 'rappeler en janvier')
]);
let x = moi(g);
T('le journal revient', x.ok === true, x);
T('il ne porte que mes deux appels', x.appels.length === 2, x.appels.map(a => a.societe));
T('celui de ma collègue n\'y est pas',
  !x.appels.some(a => a.resultat === 'rdv'), x.appels);
T('le plus récent est en tête',
  x.appels[0].societe === 'PEINTURE DU GOLFE', x.appels.map(a => a.societe));
T('chaque ligne porte de quoi s\'afficher seule',
  x.appels[1].id === 'P-2' && x.appels[1].societe === 'ATELIER COULEURS' &&
  x.appels[1].commune === 'VANNES' && x.appels[1].resultat === 'interesse' &&
  x.appels[1].note === 'rappeler en janvier', x.appels[1]);
T('l\'horodatage est une date lisible par le téléphone',
  !isNaN(new Date(x.appels[0].t).getTime()), x.appels[0].t);
T('et tout tient : « complet » est vrai', x.complet === true, x);

/* ---------- 2. un journal vide n'est pas une erreur ---------- */
g = socle([]);
x = moi(g);
T('sans aucun appel, la réponse reste bonne', x.ok === true && x.appels.length === 0, x);
g = socle([appel(ilYA(3600000), 'CLAIRE B', 'P-1', 'PEINTURE DU GOLFE', 'nrp', '')]);
x = moi(g);
T('avec seulement les appels d\'une collègue, le mien est vide',
  x.ok === true && x.appels.length === 0, x);

/* ---------- 3. les bornes ---------- */
/* Le classeur ne rend ni tout ni n'importe quoi : il s'arrête au nombre de
   lignes que l'écran peut montrer, et n'exhume pas l'an dernier. */
const beaucoup = [];
for (let i = 0; i < 420; i++) {
  beaucoup.push(appel(new Date(Date.now() - i * 60000), 'SIMON LG', 'P-1', 'PEINTURE DU GOLFE', 'nrp', ''));
}
g = socle(beaucoup);
x = moi(g);
T('au-delà du plafond, on ne renvoie que le haut de la pile',
  x.appels.length === 300, x.appels.length);
T('et « complet » devient faux', x.complet === false, x.complet);
T('ce sont bien les plus récents',
  new Date(x.appels[0].t) > new Date(x.appels[299].t), [x.appels[0].t, x.appels[299].t]);
T('le téléphone peut en demander moins',
  moi(g, { max: 25 }).appels.length === 25, moi(g, { max: 25 }).appels.length);
T('mais jamais plus que le plafond',
  moi(g, { max: 5000 }).appels.length === 300, moi(g, { max: 5000 }).appels.length);

g = socle([
  appel(ilYA(2 * JOUR), 'SIMON LG', 'P-1', 'PEINTURE DU GOLFE', 'nrp', ''),
  appel(ilYA(200 * JOUR), 'SIMON LG', 'P-2', 'ATELIER COULEURS', 'refus', 'trop vieux')
]);
x = moi(g);
T('un appel d\'il y a deux jours est rendu', x.appels.length === 1, x.appels);
T('celui d\'il y a deux cents jours, non',
  !x.appels.some(a => a.note === 'trop vieux'), x.appels);
T('l\'écran sait sur combien de jours il regarde', x.jours === 60, x.jours);

/* ---------- 4. la cloison des droits ---------- */
g = socle([appel(ilYA(3600000), 'SIMON LG', 'P-1', 'PEINTURE DU GOLFE', 'nrp', '')]);
x = rep(g, { action: 'historique', nom: 'MAXIME T', code: 'kw7!' });
T('un prestataire n\'a pas de journal d\'appels',
  x.ok === false && /autoris/i.test(x.erreur || ''), x);
x = rep(g, { action: 'historique', nom: 'SIMON LG', code: 'xx9!' });
T('un code faux est refusé', x.ok === false, x);
x = rep(g, { action: 'historique', nom: 'PATRON', code: 'qx4$' });
T('le patron y a droit, et ne voit que les siens',
  x.ok === true && x.appels.length === 0, x);

/* ---------- 5. ce que le téléphone vient d'envoyer s'y retrouve ---------- */
/* La boucle complète : le commercial note un résultat, il part au classeur,
   et il doit revenir dans son journal. Sans cela, l'écran mentirait dès le
   premier appel. */
g = socle([]);
const quand = new Date().toISOString();
x = rep(g, { action: 'appel', nom: 'SIMON LG', code: 'ab1!', appareil: 'tel-1',
             appels: [{ id: 'P-1', resultat: 'rdv', note: 'jeudi 14 h', t: quand }] });
T('le résultat est accepté', x.ok === true && x.recus === 1, x);
x = moi(g);
T('et il apparaît aussitôt dans le journal', x.appels.length === 1, x.appels);
T('avec sa note et son résultat',
  x.appels[0].resultat === 'rdv' && x.appels[0].note === 'jeudi 14 h', x.appels[0]);
T('et la société, que le téléphone n\'avait pas envoyée',
  x.appels[0].societe === 'PEINTURE DU GOLFE', x.appels[0]);
/* Le même lot renvoyé après une coupure ne doit pas doubler la ligne. */
rep(g, { action: 'appel', nom: 'SIMON LG', code: 'ab1!', appareil: 'tel-1',
         appels: [{ id: 'P-1', resultat: 'rdv', note: 'jeudi 14 h', t: quand }] });
T('un lot renvoyé deux fois ne double pas le journal',
  moi(g).appels.length === 1, moi(g).appels.length);

/* ---------- 6. une feuille abîmée ne fait pas tomber le téléphone ---------- */
g = socle([]);
creer('APPELS', [['AUTRE', 'COLONNES'], ['x', 'y']]);
x = moi(g);
T('un onglet APPELS aux colonnes changées est dit, pas planté',
  x.ok === false && /APPELS/.test(x.erreur || ''), x);
creer('APPELS', [EN_A]);
T('et l\'onglet remis en ordre, le journal repart',
  moi(g).ok === true, moi(g));

console.log('\n=== LE JOURNAL D\'APPELS (classeur, v61) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
