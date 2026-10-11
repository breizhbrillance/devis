/* Le planning du commercial qui pose lui-même des chantiers (v66).

   Un commercial établit des devis ; un salarié fait les chantiers. Mais le
   patron commercial pose aussi ses vitrages : il lui faut son planning sur
   son téléphone, sans cesser d'être commercial.

   Ce que ces essais gardent :
   — son rôle ne change pas : il garde ses devis, il n'hérite pas des droits
     du salarié au-delà de son planning et de son pointage ;
   — la cloison tient : un commercial absent des prestataires se voit refuser
     l'action, et le refus est tracé ;
   — son planning ne contient que les chantiers à son nom ;
   — la colonne PLANIFIABLE le tient hors de la répartition automatique : il
     voit son planning, mais l'application ne lui pose rien d'elle-même ;
   — une fiche d'avant cette colonne garde sa place dans la répartition.
*/
import { creer, lire, charger, sansInterface } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };
const j = (n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d; };

sansInterface(true);

const EN_P = ['NOM', 'EMAIL', 'CODE', 'ACTIF', 'TELEPHONE', 'JOURS', 'PLAGES',
  'HEURES_SEMAINE', 'PLANIFIABLE'];
const P = (o) => EN_P.map(h => o[h] !== undefined ? o[h] : '');

const EN_C = ['ID', 'NUMERO', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'DATE', 'HEURE',
  'PRESTATAIRE', 'STATUT', 'ARRIVEE', 'DEPART', 'MINUTES', 'PRESTATIONS_FAITES',
  'SIGNALEMENT', 'PHOTOS', 'NOTE', 'CREE_LE', 'DUREE_PREVUE_MIN', 'LOT', 'RECURRENT',
  'NATURE'];
const C = (o) => EN_C.map(h => o[h] !== undefined ? o[h] : '');

function poser(prestataires) {
  creer('COMMERCIAUX', [['NOM', 'EMAIL', 'CODE', 'ACTIF', 'INITIALES'],
    ['SIMON LG', 'simon@bb.fr', 'ab1!', 'OUI', 'SLG'],
    ['TITEMA R', 'titema@bb.fr', 'zz9!', 'OUI', 'TR']]);
  creer('ADMINS', [['NOM', 'EMAIL', 'CODE', 'ACTIF'], ['SIMON H', 'h@bb.fr', 'qx4$', 'OUI']]);
  creer('PRESTATAIRES', [EN_P].concat(prestataires.map(P)));
  creer('CHANTIERS', [EN_C,
    C({ ID: 'CH-0001', CLIENT: 'MENGUY ARCHITECTES', ADRESSE: '1 Allée Jules Verne',
        CP: '56610', VILLE: 'Arradon', DATE: j(3), HEURE: '07:00',
        PRESTATAIRE: 'SIMON LG', STATUT: 'PLANIFIE', NOTE: 'Locaux et vitrages',
        NATURE: 'VITRERIE' }),
    C({ ID: 'CH-0002', CLIENT: 'LE LOCAL', ADRESSE: '14 Allée de Noyalo', CP: '56450',
        VILLE: 'Theix-Noyalo', DATE: j(2), HEURE: '08:00',
        PRESTATAIRE: 'MAXIME', STATUT: 'PLANIFIE', NATURE: 'ENTRETIEN' }),
    C({ ID: 'CH-0003', NUMERO: 'DEV-2026-SL-0009', CLIENT: 'ANCIEN CLIENT',
        VILLE: 'Vannes', DATE: j(4), HEURE: '10:00',
        PRESTATAIRE: 'SIMON LG', STATUT: 'PLANIFIE' }),
    C({ ID: 'CH-0004', CLIENT: 'SANS RIEN', VILLE: 'Vannes', DATE: j(5), HEURE: '15:00',
        PRESTATAIRE: 'SIMON LG', STATUT: 'PLANIFIE' })]);
  /* Un devis ancien, dont le chantier a été posé avant la colonne NATURE :
     sa couleur doit quand même arriver, reprise du devis. */
  creer('DEVIS', [['NUMERO', 'DATE', 'COMMERCIAL', 'CLIENT', 'TOTAL_HT', 'STATUT', 'SIGNE', 'NATURE'],
    ['DEV-2026-SL-0009', j(-10), 'SIMON LG', 'ANCIEN CLIENT', 900, 'SIGNE', 'OUI', 'REMISE']]);
  creer('LIGNES', [['NUMERO', 'ORDRE', 'CATEGORIE', 'REFERENCE', 'DESIGNATION', 'DETAIL',
    'QTE', 'UNITE', 'PU_HT', 'REMISE_PCT', 'TYPE', 'TVA', 'TOTAL_HT']]);
  creer('CATALOGUE', [['CATEGORIE', 'DESIGNATION', 'DETAIL', 'UNITE', 'PU_HT', 'TVA', 'TYPE',
    'ACTIF', 'REFERENCE']]);
  creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['societe_nom', 'BREIZH BRILLANCE', '']]);
  creer('JOURNAL', [['HORODATAGE', 'MOMENT', 'COMMERCIAL', 'ACTION', 'DETAIL', 'NUMERO',
    'APPAREIL', 'SOURCE']]);
  creer('COMMUNES', [['CP', 'VILLE', 'KM', 'SOURCE', 'CALCULE_LE']]);
  creer('ABSENCES', [['PRESTATAIRE', 'DU', 'AU']]);
  creer('RECURRENTS', [['ID', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'FREQUENCE',
    'JOUR', 'JOUR_MOIS', 'HEURE', 'DUREE_MIN', 'PRESTATAIRE', 'DEBUT', 'FIN', 'ACTIF',
    'PRESTATIONS', 'NOTE']]);
  return charger(CODE_GS);
}

const MAXIME = { NOM: 'MAXIME', EMAIL: 'm@bb.fr', CODE: 'kw7!', ACTIF: 'OUI',
  JOURS: 'LU,MA,ME,JE,VE', PLAGES: '08:00-12:00,14:00-17:00', HEURES_SEMAINE: 35 };
const SIMON_PRESTA = { NOM: 'SIMON LG', EMAIL: 'simon@bb.fr', CODE: 'ab1!', ACTIF: 'OUI',
  JOURS: 'LU,MA,ME,JE,VE', PLAGES: '08:00-18:00', HEURES_SEMAINE: 35, PLANIFIABLE: 'NON' };

const rep = (g, o) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(o) } }));
const refus = (g) => lire('JOURNAL').slice(1).filter(l => String(l[3]) === 'ACTION REFUSEE').length;

/* ---------- 1. un commercial qui ne fait pas de chantiers ---------- */
let g = poser([MAXIME]);
let r = rep(g, { action: 'connexion', nom: 'SIMON LG', code: 'ab1!' });
T('il se connecte', r.ok === true, r);
T('son rôle est commercial', r.config.role === 'COMMERCIAL', r.config.role);
T('et l\'application ne lui ouvre pas de planning', r.config.planning === false, r.config.planning);
r = rep(g, { action: 'planning', nom: 'SIMON LG', code: 'ab1!' });
T('l\'action planning lui est refusée', r.ok === false, r);
T('le refus dit pourquoi', /non autorisée/.test(String(r.erreur)), r.erreur);
T('et il est tracé au journal', refus(g) === 1, refus(g));

/* ---------- 2. le même, inscrit aussi parmi les prestataires ---------- */
g = poser([MAXIME, SIMON_PRESTA]);
r = rep(g, { action: 'connexion', nom: 'SIMON LG', code: 'ab1!' });
T('son rôle reste commercial', r.config.role === 'COMMERCIAL', r.config.role);
T('mais l\'application lui ouvre son planning', r.config.planning === true, r.config.planning);
T('il garde son catalogue de commercial', Array.isArray(r.config.catalogue), typeof r.config.catalogue);

r = rep(g, { action: 'planning', nom: 'SIMON LG', code: 'ab1!' });
T('l\'action planning passe', r.ok === true, r);
T('elle ne rend que les chantiers à son nom',
  r.chantiers.length === 3 && r.chantiers.every(c => c.client !== 'LE LOCAL'),
  r.chantiers.map(c => c.client));
T('avec l\'heure lisible', r.chantiers[0].heure === '07:00', r.chantiers[0].heure);
T('celui de Maxime ne lui est pas servi',
  !r.chantiers.some(c => c.client === 'LE LOCAL'), r.chantiers.map(c => c.client));

/* ---------- 2 bis. la nature voyage avec le chantier ---------- */
const parId = {}; r.chantiers.forEach(c => { parId[c.id] = c; });
T('le chantier porte sa nature', parId['CH-0001'].nature === 'VITRERIE',
  parId['CH-0001'] && parId['CH-0001'].nature);
T('un chantier pos\u00e9 avant la colonne la reprend de son devis',
  parId['CH-0003'].nature === 'REMISE', parId['CH-0003'].nature);
T('et sans devis ni colonne, elle reste vide plut\u00f4t que devin\u00e9e',
  parId['CH-0004'].nature === '', parId['CH-0004'].nature);
const tab = g.tableauAdmin_();
const parIdA = {}; tab.chantiers.forEach(c => { parIdA[c.id] = c; });
T('l\'\u00e9cran du g\u00e9rant re\u00e7oit la nature lui aussi',
  parIdA['CH-0001'].nature === 'VITRERIE' && parIdA['CH-0002'].nature === 'ENTRETIEN',
  [parIdA['CH-0001'].nature, parIdA['CH-0002'].nature]);
T('avec le m\u00eame repli sur le devis',
  parIdA['CH-0003'].nature === 'REMISE', parIdA['CH-0003'].nature);

/* ---------- 3. il pointe comme un salarié ---------- */
r = rep(g, { action: 'chantier', nom: 'SIMON LG', code: 'ab1!',
             id: 'CH-0001', champ: 'arrivee' });
T('le pointage lui est ouvert', r.ok !== false || !/non autorisée/.test(String(r.erreur)), r);

/* ---------- 4. il n'hérite pas du reste ---------- */
r = rep(g, { action: 'sync', nom: 'SIMON LG', code: 'ab1!', devis: null });
T('il garde l\'envoi de devis, qui est son métier',
  !/non autorisée/.test(String(r.erreur || '')), r.erreur);
r = rep(g, { action: 'tableau', nom: 'SIMON LG', code: 'ab1!' });
T('il n\'atteint pas le tableau du gérant', r.ok === false, r);
T('et ce refus est tracé aussi', refus(g) === 1, refus(g));

/* ---------- 5. un salarié ne gagne rien au passage ---------- */
r = rep(g, { action: 'planning', nom: 'MAXIME', code: 'kw7!' });
T('le salarié garde son planning', r.ok === true, r);
T('et il n\'y voit que ses chantiers',
  r.chantiers.length === 1 && r.chantiers[0].client === 'LE LOCAL',
  r.chantiers.map(c => c.client));
r = rep(g, { action: 'sync', nom: 'MAXIME', code: 'kw7!', devis: null });
T('mais il n\'envoie toujours pas de devis', r.ok === false, r);

/* ---------- 6. PLANIFIABLE tient hors de la répartition automatique ---------- */
let gens = g.prestatairesPlanning_();
T('la répartition automatique ne retient que Maxime',
  gens.length === 1 && gens[0].nom === 'MAXIME', gens.map(x => x.nom));

/* Le même, PLANIFIABLE laissé vide : les fiches d'avant la colonne gardent
   leur place, sinon la planification s'arrêterait du jour au lendemain. */
g = poser([MAXIME, Object.assign({}, SIMON_PRESTA, { PLANIFIABLE: '' })]);
gens = g.prestatairesPlanning_();
T('PLANIFIABLE vide vaut oui', gens.length === 2, gens.map(x => x.nom));

g = poser([MAXIME, Object.assign({}, SIMON_PRESTA, { PLANIFIABLE: 'OUI' })]);
gens = g.prestatairesPlanning_();
T('et OUI aussi', gens.length === 2, gens.map(x => x.nom));

/* Mis à NON, il garde pourtant son planning : les deux choses sont distinctes. */
g = poser([MAXIME, SIMON_PRESTA]);
r = rep(g, { action: 'connexion', nom: 'SIMON LG', code: 'ab1!' });
T('hors répartition, il voit quand même son planning', r.config.planning === true, r.config);

/* ---------- 7. un salarié inactif ne compte pas ---------- */
g = poser([MAXIME, Object.assign({}, SIMON_PRESTA, { ACTIF: 'NON' })]);
r = rep(g, { action: 'connexion', nom: 'SIMON LG', code: 'ab1!' });
T('une fiche de prestataire désactivée ne lui ouvre pas de planning',
  r.config.planning === false, r.config.planning);
r = rep(g, { action: 'planning', nom: 'SIMON LG', code: 'ab1!' });
T('et l\'action lui est refusée', r.ok === false, r);

/* ---------- 8. une fiche sans code n'ouvre rien ---------- */
/* Un commercial qui pose des chantiers n'a pas besoin d'un second code : il
   entre par sa fiche de commercial. Sa ligne de prestataire reste donc sans
   code — et une ligne sans code ne doit laisser entrer personne. */
g = poser([MAXIME, Object.assign({}, SIMON_PRESTA, { NOM: 'PAUL SANS CODE', CODE: '' })]);
r = rep(g, { action: 'connexion', nom: 'PAUL SANS CODE', code: '' });
T('une fiche sans code n\'ouvre pas le compte, même avec un code vide',
  r.ok === false && r.refus === true, r);
r = rep(g, { action: 'connexion', nom: 'PAUL SANS CODE', code: 'nimporte' });
T('ni avec n\'importe quel code', r.ok === false && r.refus === true, r);
T('et le refus est le même que pour un nom inconnu',
  /Nom ou code incorrect/.test(String(r.erreur)), r.erreur);
r = rep(g, { action: 'connexion', nom: 'MAXIME', code: 'kw7!' });
T('les fiches qui ont un code s\'ouvrent toujours', r.ok === true, r);

/* ---------- 9. l'homonymie, écrite autrement ---------- */
g = poser([MAXIME, Object.assign({}, SIMON_PRESTA, { NOM: 'Simon LG' })]);
r = rep(g, { action: 'connexion', nom: 'SIMON LG', code: 'ab1!' });
T('la casse ne fait pas deux personnes', r.config.planning === true, r.config.planning);

console.log('\n=== LE PLANNING DU COMMERCIAL (v66) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
