/* La planification automatique.

   Un devis signé ne produisait que des fiches sans jour ni personne. Il pose
   maintenant ses rendez-vous tout seul, et prévient le gérant. Ce qui est
   éprouvé ici : la durée déduite du montant, le découpage d'un chantier plus
   long qu'une journée, les jours non travaillés sautés, le salarié le moins
   chargé, l'espacement hebdomadaire d'un contrat, et surtout ce que l'appli
   ne doit PAS faire — réécrire une date posée à la main par le gérant. */
import { creer, lire, charger, courriers } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok = [], ko = [];
const T = (n, c, d) => { (c?ok:ko).push(n + (c?'':'  → ' + JSON.stringify(d))); };

const EN_D = ['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','ADRESSE','CP','VILLE',
 'TOTAL_HT','TOTAL_HT_MENSUEL','TOTAL_TTC','STATUT','SIGNE','NOTE_COMMERCIAL',
 'PASSAGES_MOIS','NATURE','DATE_SOUHAITEE'];
const L = (o) => EN_D.map(h => o[h] !== undefined ? o[h] : '');

const EN_C = ['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE',
 'PRESTATAIRE','STATUT','ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT',
 'PHOTOS','NOTE','CREE_LE','DUREE_PREVUE_MIN','LOT'];

/* Un mardi, pour que les dates de l'épreuve ne dépendent pas du jour où elle
   tourne : le 6 octobre 2026 est un mardi. */
const DEPART = new Date(2026, 9, 6, 12, 0, 0);
const jour = (d) => d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);
const JSEM = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];

function socle(prestataires) {
  creer('REGLAGES', [['CLE','VALEUR','NOTE'],
    ['societe_nom','BREIZH BRILLANCE',''],
    ['taux_horaire_planning','30',''],
    ['passages_mois_defaut','4',''],
    ['recap_email','gerant@bb.fr','']]);
  creer('COMMERCIAUX', [['NOM','EMAIL','CODE','ACTIF'], ['SIMON LG','s@bb.fr','ab1!','OUI']]);
  creer('PRESTATAIRES', [['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE'],
    ...prestataires]);
  creer('ADMINS', [['NOM','EMAIL','CODE','ACTIF']]);
  creer('JOURNAL', [['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  creer('CHANTIERS', [EN_C]);
  creer('CATALOGUE', [['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES']]);
  creer('LIGNES', [['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE',
    'PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
}
const MAXIME = ['MAXIME','m@bb.fr','kw7!','OUI','','MA,ME,JE,VE,SA','08:00-12:00,14:00-17:00',35];
const LEA    = ['LEA','l@bb.fr','qx4$','OUI','','MA,ME,JE,VE,SA','08:00-12:00,14:00-17:00',35];

const fiches = (num) => lire('CHANTIERS').slice(1)
  .filter(r => String(r[1]) === num)
  .map(r => ({id:r[0], date:r[7], heure:r[8], qui:r[9], statut:r[10], min:r[19], lot:r[20]}));

/* ---------- 1. la durée se déduit du montant ---------- */
socle([MAXIME]);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-1', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'CAD LINE',
     ADRESSE:'6 rue', CP:'56860', VILLE:'SENE', TOTAL_HT:210, TOTAL_TTC:252,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER', DATE_SOUHAITEE:DEPART})]);
let g = charger(CODE_GS);
T('le taux horaire du classeur est lu', g.tauxHorairePlanning_({taux_horaire_planning:'30'}) === 30);
T('un taux absent retombe sur 30 €/h', g.tauxHorairePlanning_({}) === 30);
T('210 € HT à 30 €/h font sept heures', g.minutesPour_(210, 30) === 420, g.minutesPour_(210, 30));
T('la durée s\'arrondit au quart d\'heure', g.minutesPour_(100, 30) === 195, g.minutesPour_(100, 30));
T('et ne descend jamais sous la demi-heure', g.minutesPour_(5, 30) === 30, g.minutesPour_(5, 30));

g.genererChantiers_('DEV-1');
let f = fiches('DEV-1');
T('une fin de chantier de 7 h tient en une fiche', f.length === 1, f.length);
T('sa durée prévue est portée', f[0] && f[0].min === 420, f[0]);
T('elle naît sans date', f[0] && !f[0].date);

/* ---------- 2. elle se pose au premier jour travaillé ---------- */
let bilan = g.poserPlanning_('DEV-1', 'SIMON LG', '');
f = fiches('DEV-1');
T('la fiche est posée', !!(f[0] && f[0].date), f[0]);
T('au jour demandé, qui est travaillé', f[0] && jour(f[0].date) === '2026-10-06', f[0] && jour(f[0].date));
T('à Maxime', f[0] && f[0].qui === 'MAXIME', f[0]);
T('à huit heures', f[0] && f[0].heure === '08:00', f[0]);
T('et son statut suit', f[0] && f[0].statut === 'PLANIFIE', f[0]);
T('le bilan dit ce qu\'il a posé', bilan.poses.length === 1 && !bilan.refuses.length, bilan);
T('le gérant est prévenu', courriers().some(m => /DEV-1/.test(m.subject||'')),
  courriers().map(m => m.subject));
T('et le journal en garde trace',
  lire('JOURNAL').slice(1).some(r => String(r[3]) === 'CHANTIERS PLANIFIES'),
  lire('JOURNAL').slice(1).map(r => r[3]));

/* ---------- 3. un jour non travaillé est sauté ---------- */
socle([MAXIME]);
const DIMANCHE = new Date(2026, 9, 11, 12, 0, 0);   // Maxime ne travaille ni dimanche ni lundi
T('le 11 octobre 2026 est bien un dimanche', JSEM[DIMANCHE.getDay()] === 'dimanche');
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-2', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'MAIRIE',
     ADRESSE:'1 place', CP:'56880', VILLE:'PLOEREN', TOTAL_HT:105, TOTAL_TTC:126,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'REMISE', DATE_SOUHAITEE:DIMANCHE})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-2'); g.poserPlanning_('DEV-2', 'SIMON LG', '');
f = fiches('DEV-2');
T('le dimanche et le lundi sont sautés', f[0] && jour(f[0].date) === '2026-10-13', f[0] && jour(f[0].date));
T('on tombe bien un mardi', f[0] && JSEM[f[0].date.getDay()] === 'mardi');

/* ---------- 4. un chantier plus long qu'une journée se découpe ---------- */
socle([MAXIME]);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-3', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'SYNDIC',
     ADRESSE:'2 quai', CP:'56000', VILLE:'VANNES', TOTAL_HT:600, TOTAL_TTC:720,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'REMISE', DATE_SOUHAITEE:DEPART})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-3');
f = fiches('DEV-3');
T('600 € HT font vingt heures, donc trois journées', f.length === 3, f.length);
T('les deux premières sont pleines', f[0].min === 420 && f[1].min === 420, f.map(x=>x.min));
T('la troisième porte le reste', f[2].min === 360, f.map(x=>x.min));
T('le total fait bien vingt heures',
  f.reduce((s,x)=>s+x.min,0) === 1200, f.reduce((s,x)=>s+x.min,0));
T('chaque fiche sait où elle en est', f.map(x=>x.lot).join(' ') === '1/3 2/3 3/3', f.map(x=>x.lot));
g.poserPlanning_('DEV-3', 'SIMON LG', '');
f = fiches('DEV-3');
T('les trois journées se suivent',
  jour(f[0].date) === '2026-10-06' && jour(f[1].date) === '2026-10-07' && jour(f[2].date) === '2026-10-08',
  f.map(x=>jour(x.date)));
T('c\'est la même personne les trois jours',
  f.every(x => x.qui === 'MAXIME'), f.map(x=>x.qui));

/* ---------- 5. un contrat d'entretien espace ses passages ---------- */
socle([MAXIME]);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-4', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'MAIRIE DE PLOEREN',
     ADRESSE:'1 place', CP:'56880', VILLE:'PLOEREN', TOTAL_HT:420, TOTAL_HT_MENSUEL:420,
     TOTAL_TTC:504, STATUT:'SIGNE', SIGNE:'OUI', NATURE:'ENTRETIEN', PASSAGES_MOIS:4,
     DATE_SOUHAITEE:DEPART})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-4');
f = fiches('DEV-4');
T('quatre passages, quatre fiches', f.length === 4, f.length);
T('chacune vaut le quart du mois', f.every(x => x.min === 210), f.map(x=>x.min));
g.poserPlanning_('DEV-4', 'SIMON LG', '');
f = fiches('DEV-4');
T('les passages sont espacés d\'une semaine',
  f.map(x=>jour(x.date)).join(' ') === '2026-10-06 2026-10-13 2026-10-20 2026-10-27',
  f.map(x=>jour(x.date)));
T('toujours le même jour de la semaine',
  f.every(x => JSEM[x.date.getDay()] === 'mardi'), f.map(x=>JSEM[x.date.getDay()]));

/* ---------- 6. le moins chargé de la semaine ---------- */
socle([MAXIME, LEA]);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-5', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'A',
     ADRESSE:'1 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:210, TOTAL_TTC:252,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER', DATE_SOUHAITEE:DEPART}),
  L({NUMERO:'DEV-6', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'B',
     ADRESSE:'2 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:210, TOTAL_TTC:252,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER', DATE_SOUHAITEE:DEPART})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-5'); g.poserPlanning_('DEV-5', 'SIMON LG', '');
g.genererChantiers_('DEV-6'); g.poserPlanning_('DEV-6', 'SIMON LG', '');
const q5 = fiches('DEV-5')[0], q6 = fiches('DEV-6')[0];
T('deux chantiers d\'une journée ne vont pas à la même personne',
  q5.qui !== q6.qui, [q5.qui, q6.qui]);
T('et pas plus de sept heures par personne et par jour',
  jour(q5.date) === '2026-10-06' && jour(q6.date) === '2026-10-06',
  [jour(q5.date), jour(q6.date)]);

/* ---------- 7. ce que l'appli ne touche pas ---------- */
socle([MAXIME]);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-7', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'C',
     ADRESSE:'3 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:210, TOTAL_TTC:252,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER', DATE_SOUHAITEE:DEPART})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-7');
// le gérant a posé lui-même une date et un nom
const sh = lire('CHANTIERS');
const ligne = sh.findIndex(r => String(r[1]) === 'DEV-7');
sh[ligne][7] = new Date(2026, 9, 20, 12, 0, 0);
sh[ligne][9] = 'MAXIME';
g.poserPlanning_('DEV-7', 'SIMON LG', '');
f = fiches('DEV-7');
T('une date posée à la main n\'est pas réécrite',
  jour(f[0].date) === '2026-10-20', f[0] && jour(f[0].date));

/* Les deux garde-fous séparément : une date sans nom, un nom sans date. Testés
   ensemble, l'un masquait l'autre et l'on pouvait en retirer un sans que rien
   ne tombe au rouge. */
socle([MAXIME]);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-7B', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'C2',
     ADRESSE:'3 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:210, TOTAL_TTC:252,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER', DATE_SOUHAITEE:DEPART})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-7B');
let sh2 = lire('CHANTIERS');
let l2 = sh2.findIndex(r => String(r[1]) === 'DEV-7B');
sh2[l2][7] = new Date(2026, 9, 20, 12, 0, 0);     // une date, pas de nom
g.poserPlanning_('DEV-7B', 'SIMON LG', '');
f = fiches('DEV-7B');
T('une date seule, posée à la main, reste la sienne',
  jour(f[0].date) === '2026-10-20', f[0] && jour(f[0].date));
T('et l\'appli ne lui colle pas non plus de salarié',
  !f[0].qui, f[0] && f[0].qui);

socle([MAXIME]);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-7C', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'C3',
     ADRESSE:'3 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:210, TOTAL_TTC:252,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER', DATE_SOUHAITEE:DEPART})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-7C');
sh2 = lire('CHANTIERS');
l2 = sh2.findIndex(r => String(r[1]) === 'DEV-7C');
sh2[l2][9] = 'MAXIME';                            // un nom, pas de date
g.poserPlanning_('DEV-7C', 'SIMON LG', '');
f = fiches('DEV-7C');
T('un salarié choisi à la main n\'est pas remplacé',
  f[0].qui === 'MAXIME', f[0] && f[0].qui);
T('et l\'appli ne lui pose pas de date dans le dos',
  !f[0].date, f[0] && f[0].date);

/* ---------- 8. quand rien n'est possible ---------- */
socle([]);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-8', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'D',
     ADRESSE:'4 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:210, TOTAL_TTC:252,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER', DATE_SOUHAITEE:DEPART})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-8');
bilan = g.poserPlanning_('DEV-8', 'SIMON LG', '');
T('sans salarié actif, rien n\'est posé', bilan.poses.length === 0, bilan);
T('et le motif est dit', /salarié/.test(bilan.motif || ''), bilan.motif);
T('la fiche reste à planifier', fiches('DEV-8')[0].statut === 'A PLANIFIER', fiches('DEV-8')[0]);
T('le gérant est prévenu quand même',
  courriers().some(m => /DEV-8/.test(m.subject||'')), courriers().map(m=>m.subject));

/* ---------- 9. la semaine ne déborde pas ---------- */
socle([MAXIME]);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-9', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'E',
     ADRESSE:'5 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:1260, TOTAL_TTC:1512,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'REMISE', DATE_SOUHAITEE:DEPART})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-9'); g.poserPlanning_('DEV-9', 'SIMON LG', '');
f = fiches('DEV-9');
T('1 260 € HT font 42 h, soit six journées', f.length === 6, f.length);
const parSemaine = {};
f.forEach(x => { const c = g.cleSemaine_(x.date); parSemaine[c] = (parSemaine[c]||0) + x.min; });
T('aucune semaine ne dépasse les 35 heures contractuelles',
  Object.values(parSemaine).every(v => v <= 2100), parSemaine);
T('le travail déborde donc sur la semaine suivante',
  Object.keys(parSemaine).length === 2, parSemaine);

/* ---------- 10. l'interrupteur du classeur ----------
   Une automatisation qui pose des rendez-vous chez des clients doit pouvoir
   être coupée sans toucher au code. */
socle([MAXIME]);
const rg = lire('REGLAGES');
rg.push(['planification_auto','NON','']);
creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-10', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'F',
     ADRESSE:'6 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:600, TOTAL_TTC:720,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'REMISE', DATE_SOUHAITEE:DEPART})]);
g = charger(CODE_GS);
g.genererChantiers_('DEV-10');
bilan = g.poserPlanning_('DEV-10', 'SIMON LG', '');
f = fiches('DEV-10');
T('coupée, la planification ne découpe plus en journées', f.length === 1, f.length);
T('mais la durée reste calculée, pour information', f[0].min === 1200, f[0]);
T('aucune date n\'est posée', !f[0].date, f[0]);
T('la fiche reste à planifier', f[0].statut === 'A PLANIFIER', f[0]);
T('et le motif le dit', /coup/.test(bilan.motif || ''), bilan.motif);

console.log('\n=== PLANIFICATION (classeur) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
