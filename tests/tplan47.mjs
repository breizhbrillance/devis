/* La planification, version 47 : ce que l'audit avait trouvé de faux.

   Cinq défauts reproduits sur le banc avant d'être corrigés :
   · un chantier de 7 h 15 envoyait le salarié le lendemain pour un quart d'heure ;
   · huit passages par mois s'étalaient sur huit semaines ;
   · un rendez-vous se posait le 11 novembre, ou pendant les congés du salarié ;
   · deux chantiers dans la journée s'enchaînaient sans une minute de route ;
   · un devis refusé après coup gardait ses rendez-vous au planning.

   Chaque section vérifie le comportement corrigé ET ce qu'il ne doit pas
   abîmer au passage. */
import { creer, lire, charger, courriers, horloge, itineraires, demandesMaps } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
/* Le bureau vit le vendredi 2 octobre 2026. */
horloge(new Date(2026, 9, 2, 10, 0, 0));

const ok = [], ko = [];
const T = (n, c, d) => { (c?ok:ko).push(n + (c?'':'  → ' + JSON.stringify(d))); };

const EN_D = ['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','ADRESSE','CP','VILLE',
 'TOTAL_HT','TOTAL_HT_MENSUEL','TOTAL_TTC','STATUT','SIGNE','NOTE_COMMERCIAL',
 'PASSAGES_MOIS','NATURE','DATE_SOUHAITEE','MOTIF_REFUS','DATE_STATUT','RELANCE_LE','VALIDITE'];
const L = (o) => EN_D.map(h => o[h] !== undefined ? o[h] : '');
const EN_C = ['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE',
 'PRESTATAIRE','STATUT','ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT',
 'PHOTOS','NOTE','CREE_LE','DUREE_PREVUE_MIN','LOT'];
const iso = (d) => d instanceof Date
  ? d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2) : '';
const D = (a, m, j) => new Date(a, m - 1, j, 12, 0, 0);
const JSEM = ['dim','lun','mar','mer','jeu','ven','sam'];

const MAXIME = ['MAXIME','m@bb.fr','kw7!','OUI','','MA,ME,JE,VE,SA','08:00-12:00,14:00-17:00',35];
const LEA    = ['LEA','l@bb.fr','qx4$','OUI','','MA,ME,JE,VE,SA','08:00-12:00,14:00-17:00',35];
const base = {DATE:new Date(2026, 9, 1), COMMERCIAL:'SIMON LG', ADRESSE:'1 rue', CP:'56000',
              VILLE:'VANNES', STATUT:'SIGNE', SIGNE:'OUI'};

/* Un classeur neuf à chaque épreuve : réglages, salariés, absences, devis. */
function socle({gens = [MAXIME], reglages = [], absences = [], devis = [], routes = null} = {}) {
  creer('REGLAGES', [['CLE','VALEUR','NOTE'],
    ['societe_nom','BREIZH BRILLANCE',''], ['taux_horaire_planning','30',''],
    ['passages_mois_defaut','4',''], ['recap_email','gerant@bb.fr',''], ...reglages]);
  creer('COMMERCIAUX', [['NOM','EMAIL','CODE','ACTIF'], ['SIMON LG','s@bb.fr','ab1!','OUI']]);
  creer('PRESTATAIRES', [['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE'], ...gens]);
  creer('ADMINS', [['NOM','EMAIL','CODE','ACTIF']]);
  creer('JOURNAL', [['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  creer('CHANTIERS', [EN_C]);
  creer('ABSENCES', [['PRESTATAIRE','DU','AU'], ...absences]);
  creer('CATALOGUE', [['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES']]);
  creer('LIGNES', [['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE',
    'PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
  creer('DEVIS', [EN_D, ...devis.map(d => L({...base, ...d}))]);
  courriers().length = 0;
  itineraires(routes);          // null : Google Maps ne répond pas, le forfait s'applique
  return charger(CODE_GS);
}
const fiches = (num) => lire('CHANTIERS').slice(1)
  .filter(r => String(r[1]) === num)
  .map(r => ({id:r[0], date:r[7], heure:r[8], qui:r[9], statut:r[10], arrivee:r[11],
              note:String(r[17]||''), min:r[19], lot:r[20]}));
const poser = (g, num) => { g.genererChantiers_(num); return g.poserPlanning_(num, 'SIMON LG', ''); };
const actions = () => lire('JOURNAL').slice(1).map(r => String(r[3]));

/* =====================================================================
   1. SOUS HUIT HEURES, UNE SEULE JOURNÉE DE SEPT HEURES
   ===================================================================== */
let g = socle({devis:[{NUMERO:'R1', CLIENT:'A', TOTAL_HT:217.5, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'R1');
let f = fiches('R1');
T('7 h 15 de travail calculé tiennent en une seule fiche', f.length === 1, f.map(x=>x.min));
T('portée à sept heures, pas à 7 h 15', f[0] && f[0].min === 420, f[0] && f[0].min);
T('sans numéro de lot, puisqu\'il n\'y a qu\'un jour', f[0] && f[0].lot === '', f[0] && f[0].lot);
T('posée le jour demandé', f[0] && iso(f[0].date) === '2026-10-06', f[0] && iso(f[0].date));

g = socle({devis:[{NUMERO:'R2', CLIENT:'A', TOTAL_HT:232.5, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'R2'); f = fiches('R2');
T('7 h 45 : toujours une seule journée de sept heures',
  f.length === 1 && f[0].min === 420, f.map(x=>x.min));

g = socle({devis:[{NUMERO:'R3', CLIENT:'A', TOTAL_HT:240, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'R3'); f = fiches('R3');
T('à huit heures pile, la seconde journée existe', f.length === 2, f.map(x=>x.min));
T('et porte l\'heure qui reste', f[1] && f[1].min === 60, f.map(x=>x.min));

g = socle({devis:[{NUMERO:'R4', CLIENT:'A', TOTAL_HT:637.5, NATURE:'REMISE', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'R4'); f = fiches('R4');
T('trois journées et un quart d\'heure font trois journées',
  f.length === 3 && f.every(x => x.min === 420), f.map(x=>x.min));
T('numérotées 1/3, 2/3, 3/3', f.map(x=>x.lot).join(' ') === '1/3 2/3 3/3', f.map(x=>x.lot));

g = socle({devis:[{NUMERO:'R5', CLIENT:'A', TOTAL_HT:600, NATURE:'REMISE', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'R5'); f = fiches('R5');
T('un vrai reste de six heures garde sa journée',
  f.map(x=>x.min).join(' ') === '420 420 360', f.map(x=>x.min));

g = socle({reglages:[['reliquat_ignore_min','0','']],
           devis:[{NUMERO:'R6', CLIENT:'A', TOTAL_HT:217.5, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'R6'); f = fiches('R6');
T('le seuil se règle dans le classeur : à zéro, l\'ancien découpage revient',
  f.map(x=>x.min).join(' ') === '420 15', f.map(x=>x.min));

g = socle({devis:[{NUMERO:'R7', CLIENT:'A', TOTAL_HT:870, TOTAL_HT_MENSUEL:870, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:4, DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'R7'); f = fiches('R7');
T('la règle vaut aussi pour chaque passage d\'un contrat',
  f.length === 4 && f.every(x => x.min === 420), f.map(x=>x.min));

/* =====================================================================
   2. LA VRAIE FRÉQUENCE D'UN CONTRAT
   ===================================================================== */
g = socle({devis:[{NUMERO:'F8', CLIENT:'B', TOTAL_HT:800, TOTAL_HT_MENSUEL:800, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:8, DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'F8'); f = fiches('F8');
T('huit passages, huit fiches posées', f.length === 8 && f.every(x => x.date), f.length);
T('ils tiennent en quatre semaines, pas en huit',
  f.length === 8 && iso(f[7].date) <= '2026-11-02', f.map(x=>iso(x.date)));
T('deux par semaine, toujours les deux mêmes jours',
  f.map(x=>JSEM[x.date.getDay()]).join(' ') === 'mar sam mar sam mar sam mar sam',
  f.map(x=>JSEM[x.date.getDay()]));
T('aux dates attendues',
  f.map(x=>iso(x.date)).join(' ') ===
  '2026-10-06 2026-10-10 2026-10-13 2026-10-17 2026-10-20 2026-10-24 2026-10-27 2026-10-31',
  f.map(x=>iso(x.date)));
T('le client voit la même personne', f.every(x => x.qui === 'MAXIME'), f.map(x=>x.qui));

g = socle({devis:[{NUMERO:'F8M', CLIENT:'B', TOTAL_HT:800, TOTAL_HT_MENSUEL:800, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:8, DATE_SOUHAITEE:D(2026,10,7)}]});
poser(g, 'F8M'); f = fiches('F8M');
T('parti d\'un mercredi, le second jour recule au samedi plutôt que de coller au suivant',
  f.map(x=>JSEM[x.date.getDay()]).join(' ') === 'mer sam mer sam mer sam mer sam',
  f.map(x=>JSEM[x.date.getDay()] + ' ' + iso(x.date)));

g = socle({devis:[{NUMERO:'F2', CLIENT:'B', TOTAL_HT:200, TOTAL_HT_MENSUEL:200, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:2, DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'F2'); f = fiches('F2');
T('deux passages par mois : un tous les quinze jours',
  f.map(x=>iso(x.date)).join(' ') === '2026-10-06 2026-10-20', f.map(x=>iso(x.date)));

g = socle({devis:[{NUMERO:'F4', CLIENT:'B', TOTAL_HT:420, TOTAL_HT_MENSUEL:420, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:4, DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'F4'); f = fiches('F4');
T('quatre passages : inchangé, un par semaine le même jour',
  f.map(x=>iso(x.date)).join(' ') === '2026-10-06 2026-10-13 2026-10-20 2026-10-27',
  f.map(x=>iso(x.date)));

g = socle({devis:[{NUMERO:'F12', CLIENT:'B', TOTAL_HT:600, TOTAL_HT_MENSUEL:600, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:12, DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'F12'); f = fiches('F12');
T('douze passages : jamais deux le même jour',
  new Set(f.map(x=>iso(x.date))).size === 12, f.map(x=>iso(x.date)));
T('et tous dans les quatre semaines', f.every(x => iso(x.date) <= '2026-11-03'), f.map(x=>iso(x.date)));

g = socle({devis:[{NUMERO:'F20', CLIENT:'B', TOTAL_HT:1000, TOTAL_HT_MENSUEL:1000, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:20, DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'F20'); f = fiches('F20');
T('vingt passages : un par jour travaillé, jamais deux le même jour',
  f.length === 20 && new Set(f.map(x=>iso(x.date))).size === 20, f.map(x=>iso(x.date)));

/* Le gérant a posé lui-même le premier passage : les autres s'y accrochent. */
g = socle({devis:[{NUMERO:'F4H', CLIENT:'B', TOTAL_HT:420, TOTAL_HT_MENSUEL:420, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:4, DATE_SOUHAITEE:D(2026,10,6)}]});
g.genererChantiers_('F4H');
{ const sh = lire('CHANTIERS'); const l = sh.findIndex(r => String(r[1]) === 'F4H');
  sh[l][7] = D(2026,10,9); sh[l][9] = 'MAXIME'; }
g.poserPlanning_('F4H', 'SIMON LG', ''); f = fiches('F4H');
T('un premier passage posé à la main n\'est pas déplacé', iso(f[0].date) === '2026-10-09', iso(f[0].date));
T('et les suivants prennent son jour de la semaine',
  f.slice(1).map(x=>iso(x.date)).join(' ') === '2026-10-16 2026-10-23 2026-10-30',
  f.map(x=>iso(x.date)));

/* =====================================================================
   3. LES JOURS FÉRIÉS
   ===================================================================== */
g = socle();
T('Pâques 2026 tombe le 5 avril', iso(g.paques_(2026)) === '2026-04-05', iso(g.paques_(2026)));
T('Pâques 2027 le 28 mars', iso(g.paques_(2027)) === '2027-03-28', iso(g.paques_(2027)));
T('Pâques 2025 le 20 avril', iso(g.paques_(2025)) === '2025-04-20', iso(g.paques_(2025)));
const fer = g.joursFeries_(2026);
T('onze jours fériés dans l\'année', Object.keys(fer).length === 11, Object.keys(fer));
T('dont le lundi de Pâques, l\'Ascension et le lundi de Pentecôte',
  !!fer['2026-04-06'] && !!fer['2026-05-14'] && !!fer['2026-05-25'], fer);
T('et les jours fixes', ['2026-01-01','2026-05-01','2026-05-08','2026-07-14','2026-08-15',
  '2026-11-01','2026-11-11','2026-12-25'].every(k => !!fer[k]), fer);

g = socle({devis:[{NUMERO:'J1', CLIENT:'C', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,11,11)}]});
poser(g, 'J1'); f = fiches('J1');
T('le 11 novembre 2026 est un mercredi, jour travaillé de Maxime', JSEM[D(2026,11,11).getDay()] === 'mer');
T('rien n\'est posé le 11 novembre', iso(f[0].date) !== '2026-11-11', iso(f[0].date));
T('le chantier glisse au lendemain', iso(f[0].date) === '2026-11-12', iso(f[0].date));

g = socle({devis:[{NUMERO:'J2', CLIENT:'C', TOTAL_HT:600, NATURE:'REMISE', DATE_SOUHAITEE:D(2026,11,10)}]});
poser(g, 'J2'); f = fiches('J2');
T('un chantier de trois jours enjambe le férié',
  f.map(x=>iso(x.date)).join(' ') === '2026-11-10 2026-11-12 2026-11-13', f.map(x=>iso(x.date)));

g = socle({devis:[{NUMERO:'J3', CLIENT:'C', TOTAL_HT:420, TOTAL_HT_MENSUEL:420, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:4, DATE_SOUHAITEE:D(2026,10,21)}]});
poser(g, 'J3'); f = fiches('J3');
T('le passage hebdomadaire qui tombe le 11 novembre est avancé à la veille',
  f.map(x=>iso(x.date)).join(' ') === '2026-10-21 2026-10-28 2026-11-04 2026-11-10',
  f.map(x=>iso(x.date)));

g = socle({reglages:[['travail_jours_feries','OUI','']],
           devis:[{NUMERO:'J4', CLIENT:'C', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,11,11)}]});
poser(g, 'J4'); f = fiches('J4');
T('le réglage permet de travailler les jours fériés', iso(f[0].date) === '2026-11-11', iso(f[0].date));

/* =====================================================================
   4. LES ABSENCES
   ===================================================================== */
g = socle();
T('l\'onglet ABSENCES ne porte aucun motif : qui, du, au',
  g.ENTETES_ABSENCES_.join(',') === 'PRESTATAIRE,DU,AU', g.ENTETES_ABSENCES_);
{ // l'onglet se crée tout seul sur un classeur qui ne l'a pas
  creer('ABSENCES', []); g = charger(CODE_GS); g.majStructure_();
  T('la mise à jour de structure pose ses en-têtes',
    (lire('ABSENCES')[0] || []).join(',') === 'PRESTATAIRE,DU,AU', lire('ABSENCES')[0]); }

g = socle({absences:[['MAXIME', D(2026,10,6), D(2026,10,9)]],
           devis:[{NUMERO:'A1', CLIENT:'D', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'A1'); f = fiches('A1');
T('Maxime en congé du 6 au 9 : rien ne lui est posé ces jours-là',
  iso(f[0].date) > '2026-10-09', iso(f[0].date));
T('son chantier arrive le samedi 10, premier jour de retour', iso(f[0].date) === '2026-10-10', iso(f[0].date));

g = socle({gens:[MAXIME, LEA], absences:[['Maxime', D(2026,10,6), D(2026,10,9)]],
           devis:[{NUMERO:'A2', CLIENT:'D', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'A2'); f = fiches('A2');
T('avec une collègue présente, le chantier garde sa date', iso(f[0].date) === '2026-10-06', iso(f[0].date));
T('et va à celle qui est là', f[0].qui === 'LEA', f[0].qui);

g = socle({gens:[MAXIME, LEA], absences:[['', D(2026,10,6), D(2026,10,10)]],
           devis:[{NUMERO:'A3', CLIENT:'D', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'A3'); f = fiches('A3');
T('une ligne sans nom ferme la maison pour tout le monde', iso(f[0].date) === '2026-10-13', iso(f[0].date));

g = socle({gens:[MAXIME, LEA], absences:[['TOUS', D(2026,10,6), '']],
           devis:[{NUMERO:'A4', CLIENT:'D', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'A4'); f = fiches('A4');
T('« TOUS » aussi, et une fin vide vaut une seule journée', iso(f[0].date) === '2026-10-07', iso(f[0].date));

g = socle({absences:[['MAXIME', '06/10/2026', '07/10/2026']],
           devis:[{NUMERO:'A5', CLIENT:'D', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'A5'); f = fiches('A5');
T('une date tapée en texte est comprise', iso(f[0].date) === '2026-10-08', iso(f[0].date));

g = socle({absences:[['MAXIME', D(2026,10,7), D(2026,10,6)]],
           devis:[{NUMERO:'A6', CLIENT:'D', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'A6'); f = fiches('A6');
T('deux dates saisies à l\'envers sont remises à l\'endroit', iso(f[0].date) === '2026-10-08', iso(f[0].date));

/* Une absence saisie APRÈS coup : l'appli ne déplace pas, elle prévient. */
g = socle({devis:[{NUMERO:'A7', CLIENT:'GARAGE DU PORT', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'A7');
T('sans absence, aucun conflit n\'est signalé', g.conflitsPlanning_().length === 0, g.conflitsPlanning_());
lire('ABSENCES').push(['MAXIME', D(2026,10,5), D(2026,10,8)]);
let conf = g.conflitsPlanning_();
T('l\'absence saisie après coup fait remonter le rendez-vous', conf.length === 1, conf);
T('avec la raison', conf[0] && /MAXIME absent/.test(conf[0].motif), conf[0]);
courriers().length = 0;
let auto = g.automateQuotidien();
T('l\'automate du jour le compte', auto.conflits === 1, auto);
T('et l\'écrit au gérant', courriers().some(m => /à replacer/.test(m.subject || '') && /GARAGE DU PORT/.test(m.body || '')),
  courriers().map(m => m.subject));
T('mais la date n\'a pas bougé : c\'est un engagement pris', iso(fiches('A7')[0].date) === '2026-10-06',
  iso(fiches('A7')[0].date));

/* =====================================================================
   5. LE TRAJET AU FORFAIT, QUAND GOOGLE MAPS NE RÉPOND PAS
   ===================================================================== */
g = socle({devis:[
  {NUMERO:'T1', CLIENT:'E1', ADRESSE:'1 rue',  TOTAL_HT:60, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'T2', CLIENT:'E2', ADRESSE:'2 rue',  TOTAL_HT:60, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'T3', CLIENT:'E3', ADRESSE:'3 rue',  TOTAL_HT:60, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'T4', CLIENT:'E4', ADRESSE:'4 rue',  TOTAL_HT:60, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
T('le trajet vaut trente minutes par défaut', g.trajetMinutes_({}) === 30, g.trajetMinutes_({}));
T('et zéro reste un réglage permis', g.trajetMinutes_({trajet_minutes:'0'}) === 0);
poser(g, 'T1'); poser(g, 'T2'); poser(g, 'T3'); poser(g, 'T4');
const t = ['T1','T2','T3','T4'].map(n => fiches(n)[0]);
T('le premier chantier de deux heures commence à huit heures',
  iso(t[0].date) === '2026-10-06' && t[0].heure === '08:00', t[0]);
T('le deuxième commence à 10 h 30, pas à 10 h : une demi-heure de route',
  iso(t[1].date) === '2026-10-06' && t[1].heure === '10:30', t[1]);
T('le troisième tient encore dans la journée, routes comprises',
  iso(t[2].date) === '2026-10-06' && t[2].heure === '15:00', t[2]);
T('le quatrième ne tient plus : huit heures de travail seul auraient passé, pas avec les routes',
  iso(t[3].date) === '2026-10-07' && t[3].heure === '08:00', t[3]);

g = socle({devis:[
  {NUMERO:'T5', CLIENT:'E5', ADRESSE:'5 rue',  TOTAL_HT:120, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'T6', CLIENT:'E6', ADRESSE:'6 rue',  TOTAL_HT:90,  NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'T5'); poser(g, 'T6');
T('quatre heures puis trois heures ne font plus une journée de sept : il manque la route',
  iso(fiches('T6')[0].date) === '2026-10-07', iso(fiches('T6')[0].date));

g = socle({reglages:[['trajet_minutes','0','']], devis:[
  {NUMERO:'T7', CLIENT:'E7', ADRESSE:'7 rue',  TOTAL_HT:120, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'T8', CLIENT:'E8', ADRESSE:'8 rue',  TOTAL_HT:90,  NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'T7'); poser(g, 'T8');
T('le trajet réglé à zéro, les deux tiennent le même jour',
  iso(fiches('T8')[0].date) === '2026-10-06' && fiches('T8')[0].heure === '14:00', fiches('T8')[0]);

g = socle({devis:[{NUMERO:'T9', CLIENT:'E9', TOTAL_HT:600, NATURE:'REMISE', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'T9');
T('les journées d\'un même chantier ne se comptent pas de trajet entre elles',
  fiches('T9').map(x=>iso(x.date)+' '+x.heure).join(' · ') ===
  '2026-10-06 08:00 · 2026-10-07 08:00 · 2026-10-08 08:00', fiches('T9').map(x=>iso(x.date)+' '+x.heure));

/* =====================================================================
   6. UN DEVIS QUI N'EST PLUS SIGNÉ REND SES CRÉNEAUX
   ===================================================================== */
g = socle({devis:[
  {NUMERO:'X1', CLIENT:'HOTEL DU GOLFE', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6), STATUT:'REMIS', SIGNE:''},
  {NUMERO:'X2', CLIENT:'AUTRE', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
let r = g.enregistrerStatut_({numero:'X1', verdict:'SIGNE', quand:Date.now()}, {nom:'SIMON LG'});
f = fiches('X1');
T('signé, le devis est posé au planning', f.length === 1 && iso(f[0].date) === '2026-10-06' && f[0].qui === 'MAXIME', f[0]);
T('Maxime le voit sur son téléphone', g.planningDe_('MAXIME').length === 1, g.planningDe_('MAXIME').length);
courriers().length = 0;
r = g.enregistrerStatut_({numero:'X1', verdict:'REFUSE', motif:'Trop cher', quand:Date.now()}, {nom:'SIMON LG'});
f = fiches('X1');
T('refusé après coup, la réponse dit qu\'un chantier est annulé', r.ok && r.annules === 1, r);
T('la fiche passe à ANNULE', f[0].statut === 'ANNULE', f[0].statut);
T('sa date est retirée', !f[0].date, f[0].date);
T('son salarié aussi', !f[0].qui, f[0].qui);
T('la note garde le rendez-vous qu\'il faut décommander',
  /était prévu le 06\/10\/2026 avec MAXIME/.test(f[0].note), f[0].note);
T('Maxime ne le voit plus', g.planningDe_('MAXIME').length === 0, g.planningDe_('MAXIME'));
T('l\'écran d\'administration non plus',
  !g.tableauAdmin_().chantiers.some(c => c.numero === 'X1'), g.tableauAdmin_().chantiers.map(c=>c.numero));
T('le journal en garde trace', actions().includes('CHANTIERS ANNULES'), actions());
T('le gérant est prévenu, avec la date et le nom',
  courriers().some(m => /X1 annulé/.test(m.subject || '') && /06\/10\/2026 — MAXIME/.test(m.body || '')),
  courriers().map(m => m.subject + ' | ' + m.body));
poser(g, 'X2');
T('la place est rendue : un autre chantier prend le créneau',
  iso(fiches('X2')[0].date) === '2026-10-06' && fiches('X2')[0].heure === '08:00', fiches('X2')[0]);

/* Le client se ravise : le devis est signé de nouveau. */
r = g.enregistrerStatut_({numero:'X1', verdict:'SIGNE', quand:Date.now()}, {nom:'SIMON LG'});
f = fiches('X1');
T('re-signé, le devis ne crée pas une seconde fiche', f.length === 1, f.length);
T('la fiche annulée est reposée', f[0].statut === 'PLANIFIE' && !!f[0].date && f[0].qui === 'MAXIME', f[0]);
T('sur un créneau libre, pas par-dessus l\'autre chantier', iso(f[0].date) === '2026-10-07', iso(f[0].date));
T('et la mention d\'annulation a quitté la note', !/Annulé/.test(f[0].note), f[0].note);

/* Un chantier commencé n'est jamais annulé. */
g = socle({devis:[{NUMERO:'X3', CLIENT:'F', TOTAL_HT:600, NATURE:'REMISE', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'X3');
{ const sh = lire('CHANTIERS'); const l = sh.findIndex(x => String(x[1]) === 'X3');
  sh[l][11] = new Date(2026, 9, 6, 8, 2, 0); sh[l][10] = 'EN COURS'; }
r = g.enregistrerStatut_({numero:'X3', verdict:'REFUSE', motif:'Litige', quand:Date.now()}, {nom:'SIMON LG'});
f = fiches('X3');
T('la journée où le salarié a pointé reste intacte',
  f[0].statut === 'EN COURS' && iso(f[0].date) === '2026-10-06' && f[0].qui === 'MAXIME', f[0]);
T('les deux journées à venir sont annulées',
  f[1].statut === 'ANNULE' && f[2].statut === 'ANNULE' && r.annules === 2, f.map(x=>x.statut));

/* Le pointage fait foi, même si le statut n'a pas suivi. */
g = socle({devis:[{NUMERO:'X3B', CLIENT:'F', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'X3B');
{ const sh = lire('CHANTIERS'); const l = sh.findIndex(x => String(x[1]) === 'X3B');
  sh[l][11] = new Date(2026, 9, 6, 8, 2, 0); }       // arrivée pointée, statut resté PLANIFIE
r = g.enregistrerStatut_({numero:'X3B', verdict:'REFUSE', motif:'Litige', quand:Date.now()}, {nom:'SIMON LG'});
T('une arrivée pointée protège la fiche, même si son statut dit encore PLANIFIE',
  fiches('X3B')[0].statut === 'PLANIFIE' && !!fiches('X3B')[0].date && r.annules === 0, [fiches('X3B')[0], r]);

/* Une relance ne défait qu'une signature. */
g = socle({devis:[{NUMERO:'X4', CLIENT:'G', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'X4');
r = g.enregistrerStatut_({numero:'X4', verdict:'RELANCE', relance:'2026-10-20', quand:Date.now()}, {nom:'SIMON LG'});
T('un devis signé repassé « à relancer » rend aussi son créneau',
  fiches('X4')[0].statut === 'ANNULE' && r.annules === 1, [fiches('X4')[0].statut, r]);

g = socle({devis:[{NUMERO:'X5', CLIENT:'H', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6), STATUT:'REMIS', SIGNE:''}]});
lire('CHANTIERS').push(EN_C.map(h => ({ID:'CH-0900', NUMERO:'X5', CLIENT:'H', DATE:D(2026,10,9),
  PRESTATAIRE:'MAXIME', STATUT:'PLANIFIE', DUREE_PREVUE_MIN:210})[h] ?? ''));
r = g.enregistrerStatut_({numero:'X5', verdict:'RELANCE', relance:'2026-10-20', quand:Date.now()}, {nom:'SIMON LG'});
T('une relance sur un devis jamais signé ne touche pas un chantier posé à la main',
  fiches('X5')[0].statut === 'PLANIFIE' && iso(fiches('X5')[0].date) === '2026-10-09' && r.annules === 0,
  [fiches('X5')[0], r]);

/* Une fiche annulée par le gérant lui-même reste annulée. */
g = socle({devis:[{NUMERO:'X6', CLIENT:'I', TOTAL_HT:420, TOTAL_HT_MENSUEL:420, NATURE:'ENTRETIEN',
                   PASSAGES_MOIS:4, DATE_SOUHAITEE:D(2026,10,6)}]});
g.genererChantiers_('X6');
{ const sh = lire('CHANTIERS'); const l = sh.findIndex(x => String(x[1]) === 'X6'); sh[l + 1][10] = 'ANNULE'; }
g.poserPlanning_('X6', 'SIMON LG', ''); f = fiches('X6');
T('un passage annulé à la main n\'est ni reposé ni réactivé',
  f[1].statut === 'ANNULE' && !f[1].date, f[1]);
T('les trois autres sont posés', f.filter(x => x.statut === 'PLANIFIE').length === 3, f.map(x=>x.statut));

/* Le gérant écrit ANNULE lui-même et laisse la date et le nom en place. */
g = socle({devis:[{NUMERO:'X6B', CLIENT:'I', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'X6B');
T('avant, Maxime voit le chantier', g.planningDe_('MAXIME').length === 1);
{ const sh = lire('CHANTIERS'); const l = sh.findIndex(x => String(x[1]) === 'X6B'); sh[l][10] = 'ANNULE'; }
T('annulé à la main, il quitte son téléphone même avec la date et le nom restés',
  g.planningDe_('MAXIME').length === 0, g.planningDe_('MAXIME'));

/* Le filet du soir : STATUT changé à la main dans le classeur. */
g = socle({devis:[{NUMERO:'X7', CLIENT:'J', TOTAL_HT:210, NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'X7');
{ const sh = lire('DEVIS'); const l = sh.findIndex(x => String(x[0]) === 'X7'); sh[l][EN_D.indexOf('STATUT')] = 'REFUSE'; }
T('sur le moment, rien ne se passe : personne n\'a prévenu l\'appli', fiches('X7')[0].statut === 'PLANIFIE');
courriers().length = 0;
auto = g.automateQuotidien();
T('l\'automate du jour annule le chantier', auto.annules === 1 && fiches('X7')[0].statut === 'ANNULE',
  [auto, fiches('X7')[0].statut]);
T('et prévient le gérant', courriers().some(m => /X7 annulé/.test(m.subject || '')), courriers().map(m=>m.subject));
courriers().length = 0;
auto = g.automateQuotidien();
T('le lendemain, il n\'annule ni ne prévient une seconde fois',
  auto.annules === 0 && !courriers().some(m => /annulé/.test(m.subject || '')), [auto, courriers().map(m=>m.subject)]);

/* =====================================================================
   7. L'ITINÉRAIRE CALCULÉ ENTRE LES DEUX ADRESSES
   ===================================================================== */
/* Un faux réseau routier du Morbihan : la ville d'arrivée décide de la durée. */
const reseau = (o, d) => {
  const de = /VANNES/.test(o) ? 'V' : /LORIENT/.test(o) ? 'L' : /AURAY/.test(o) ? 'A' : /BREST/.test(o) ? 'B' : '?';
  const a  = /VANNES/.test(d) ? 'V' : /LORIENT/.test(d) ? 'L' : /AURAY/.test(d) ? 'A' : /BREST/.test(d) ? 'B' : '?';
  const t = { VV:8, VL:47, LV:47, VA:22, AV:22, LA:33, AL:33, VB:500, BV:500 };
  return t[de + a] ?? null;
};
const deux = (extra = {}, d2 = {}) => socle({routes: reseau, ...extra, devis:[
  {NUMERO:'I1', CLIENT:'G1', ADRESSE:'12 rue des Lilas', CP:'56000', VILLE:'VANNES', TOTAL_HT:60,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'I2', CLIENT:'G2', ADRESSE:'4 quai des Indes', CP:'56100', VILLE:'LORIENT', TOTAL_HT:60,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6), ...d2}]});

g = deux(); poser(g, 'I1'); let b2 = poser(g, 'I2');
const nDemandes = demandesMaps().filter(q => /VANNES/.test(q[0]) && /LORIENT/.test(q[1])).length;
T('le premier chantier de la journée ne compte aucune route', fiches('I1')[0].heure === '08:00', fiches('I1')[0]);
T('Vannes → Lorient : 47 minutes de route, arrondies à 50',
  g.trajetEntre_({trajet:30, calcule:true, routes:{}}, '12 rue des Lilas, 56000 VANNES, France',
                 '4 quai des Indes, 56100 LORIENT, France') === 50);
T('le second chantier commence à 10 h 50 : deux heures de travail, puis la route',
  iso(fiches('I2')[0].date) === '2026-10-06' && fiches('I2')[0].heure === '10:50', fiches('I2')[0]);
T('Google Maps a reçu les deux adresses entières, code postal et ville compris',
  demandesMaps().some(q => q[0] === '12 rue des Lilas, 56000 VANNES, France' &&
                           q[1] === '4 quai des Indes, 56100 LORIENT, France'), demandesMaps());
T('le compte rendu porte la route', b2.poses[0] && b2.poses[0].route === 50, b2.poses);
T('et le courriel au gérant la dit',
  courriers().some(m => /I2/.test(m.subject || '') && /après 50 min de route/.test(m.body || '')),
  courriers().map(m => m.body));
T('le même trajet n\'est demandé qu\'une fois par signature',
  nDemandes === 1, nDemandes);

g = deux({}, {ADRESSE:'30 avenue Wilson', CP:'56000', VILLE:'VANNES'}); poser(g, 'I1'); poser(g, 'I2');
T('deux rues de la même ville : 8 minutes arrondies à 10, départ à 10 h 10',
  fiches('I2')[0].heure === '10:10', fiches('I2')[0]);

g = deux({}, {ADRESSE:'12 Rue des Lilas ', CP:'56000', VILLE:'Vannes'}); poser(g, 'I1'); poser(g, 'I2');
T('la même adresse, écrite autrement : aucune route, départ à 10 h',
  fiches('I2')[0].heure === '10:00', fiches('I2')[0]);
T('et Google Maps n\'est même pas interrogé', demandesMaps().length === 0, demandesMaps());

g = deux({routes: null}); poser(g, 'I1'); poser(g, 'I2');
T('Google Maps muet : le forfait de trente minutes prend le relais, départ à 10 h 30',
  fiches('I2')[0].heure === '10:30', fiches('I2')[0]);
T('et la planification ne s\'arrête pas pour autant', fiches('I2')[0].statut === 'PLANIFIE', fiches('I2')[0]);

g = deux({routes: () => null}); poser(g, 'I1'); poser(g, 'I2');
T('aucune route trouvée entre les deux adresses : forfait aussi', fiches('I2')[0].heure === '10:30', fiches('I2')[0]);

g = deux({reglages:[['trajet_calcule','NON','']]}); poser(g, 'I1'); poser(g, 'I2');
T('le calcul coupé dans les réglages : forfait', fiches('I2')[0].heure === '10:30', fiches('I2')[0]);
T('sans une seule demande à Google Maps', demandesMaps().length === 0, demandesMaps());

g = deux({}, {ADRESSE:'', CP:'56100', VILLE:'LORIENT'}); poser(g, 'I1'); poser(g, 'I2');
T('une fiche sans rue : forfait, plutôt qu\'un itinéraire vers le centre-ville',
  fiches('I2')[0].heure === '10:30' && demandesMaps().length === 0, [fiches('I2')[0], demandesMaps()]);

g = deux({}, {ADRESSE:'1 rue de Siam', CP:'29200', VILLE:'BREST'}); poser(g, 'I1'); poser(g, 'I2');
T('un trajet de plus de trois heures est une adresse mal comprise : forfait',
  fiches('I2')[0].heure === '10:30', fiches('I2')[0]);
T('et le journal le signale', actions().includes('TRAJET IGNORE'), actions());

/* La route peut faire déborder la journée, là où le forfait la laissait tenir. */
g = socle({routes: reseau, devis:[
  {NUMERO:'I3', CLIENT:'G3', ADRESSE:'12 rue des Lilas', CP:'56000', VILLE:'VANNES', TOTAL_HT:120,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'I4', CLIENT:'G4', ADRESSE:'4 quai des Indes', CP:'56100', VILLE:'LORIENT', TOTAL_HT:75,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'I3'); poser(g, 'I4');
T('4 h à Vannes, 50 min de route, 2 h 30 à Lorient : la journée de 7 h ne suffit plus',
  iso(fiches('I4')[0].date) === '2026-10-07' && fiches('I4')[0].heure === '08:00', fiches('I4')[0]);
g = socle({routes: null, devis:[
  {NUMERO:'I3', CLIENT:'G3', ADRESSE:'12 rue des Lilas', CP:'56000', VILLE:'VANNES', TOTAL_HT:120,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'I4', CLIENT:'G4', ADRESSE:'4 quai des Indes', CP:'56100', VILLE:'LORIENT', TOTAL_HT:75,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'I3'); poser(g, 'I4');
T('alors qu\'au forfait de trente minutes elle tenait : c\'est bien la route calculée qui décide',
  iso(fiches('I4')[0].date) === '2026-10-06', fiches('I4')[0]);

/* Le troisième chantier part du dernier de la journée, pas du premier. */
g = socle({routes: reseau, devis:[
  {NUMERO:'I5', CLIENT:'G5', ADRESSE:'12 rue des Lilas', CP:'56000', VILLE:'VANNES', TOTAL_HT:30,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'I6', CLIENT:'G6', ADRESSE:'4 quai des Indes', CP:'56100', VILLE:'LORIENT', TOTAL_HT:30,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)},
  {NUMERO:'I7', CLIENT:'G7', ADRESSE:'2 place de la Mairie', CP:'56400', VILLE:'AURAY', TOTAL_HT:30,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
poser(g, 'I5'); poser(g, 'I6');
itineraires(reseau);                         // on repart d'un compteur de demandes vide
poser(g, 'I7');
T('Vannes 8 h, Lorient 9 h 50, puis Auray : 1 h + 50 + 1 h + 35 de route = 11 h 25',
  fiches('I7')[0].heure === '11:25', ['I5','I6','I7'].map(n => fiches(n)[0].heure));
T('la route demandée part de Lorient, le dernier chantier de la journée',
  demandesMaps().some(q => /LORIENT/.test(q[0]) && /AURAY/.test(q[1])) &&
  !demandesMaps().some(q => /VANNES/.test(q[0]) && /AURAY/.test(q[1])), demandesMaps());

/* Des fiches écrites dans le désordre : c'est l'heure qui dit laquelle est la dernière. */
g = socle({routes: reseau, devis:[
  {NUMERO:'I8', CLIENT:'G8', ADRESSE:'2 place de la Mairie', CP:'56400', VILLE:'AURAY', TOTAL_HT:30,
   NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]});
const posee = (id, heure, adresse, cp, ville) => EN_C.map(h => ({ID:id, NUMERO:'MAIN', CLIENT:'X',
  ADRESSE:adresse, CP:cp, VILLE:ville, DATE:D(2026,10,6), HEURE:heure, PRESTATAIRE:'MAXIME',
  STATUT:'PLANIFIE', DUREE_PREVUE_MIN:60})[h] ?? '');
lire('CHANTIERS').push(posee('CH-0801', '10:00', '4 quai des Indes', '56100', 'LORIENT'));
lire('CHANTIERS').push(posee('CH-0802', '08:00', '12 rue des Lilas', '56000', 'VANNES'));
poser(g, 'I8');
T('la fiche de 10 h est écrite avant celle de 8 h : la route part quand même de celle de 10 h',
  demandesMaps().some(q => /LORIENT/.test(q[0]) && /AURAY/.test(q[1])) &&
  !demandesMaps().some(q => /VANNES/.test(q[0]) && /AURAY/.test(q[1])), demandesMaps());

console.log('\n=== PLANIFICATION v47 (classeur) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
