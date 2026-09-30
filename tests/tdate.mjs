/* Les dates du classeur, à l'heure du classeur.
   Une cellule de date vaut minuit. Convertie en UTC, minuit à Paris est la
   veille à 22 h : tout le tableau de bord affichait des dates en avance d'un
   jour. Ce banc pose des dates à minuit, exactement comme le tableur. */
import {creer, lire, charger} from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok = [], ko = [];
const T = (n, c, d) => { (c?ok:ko).push(n + (c?'':'  → ' + JSON.stringify(d))); };

/* minuit local, comme une cellule de date du tableur */
const minuit = (n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(0,0,0,0); return d; };
const iso = (d) => d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2);

const EN_D = ['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','ADRESSE','CP','VILLE',
 'TOTAL_HT','TOTAL_HT_MENSUEL','TOTAL_TTC','STATUT','SIGNE','MOTIF_REFUS','RELANCE_LE',
 'LIEN_PDF','PREUVE_SIGNATURE','NOTE_COMMERCIAL','PASSAGES_MOIS'];
const L = (o) => EN_D.map(h => o[h] !== undefined ? o[h] : '');

creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-2026-SL-0001', DATE:minuit(-1), COMMERCIAL:'SIMON LG', CLIENT:'MAIRIE DE PLOEREN',
     VILLE:'Ploeren', TOTAL_HT:800, TOTAL_TTC:960, STATUT:'A RELANCER', RELANCE_LE:minuit(3)})]);
creer('LIGNES', [['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE',
 'PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
creer('COMMERCIAUX', [['NOM','EMAIL','CODE','ACTIF'], ['SIMON LG','s@bb.fr','ab1!','OUI']]);
creer('PRESTATAIRES', [['NOM','EMAIL','CODE','ACTIF','TELEPHONE'],
 ['MARIE K','m@bb.fr','kw7!','OUI','0600000001']]);
creer('ADMINS', [['NOM','EMAIL','CODE','ACTIF'], ['SIMON DIRECTION','d@bb.fr','qx4$','OUI']]);
creer('REGLAGES', [['CLE','VALEUR','NOTE'], ['societe_nom','BREIZH BRILLANCE','']]);
creer('JOURNAL', [['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
creer('CHANTIERS', [['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE',
 'PRESTATAIRE','STATUT','ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT',
 'PHOTOS','NOTE','CREE_LE'],
 ['CH-0001','DEV-2026-SL-0001','MAIRIE DE PLOEREN','1 place de la Mairie','56880','Ploeren','',
  minuit(1), '09:00', 'MARIE K', 'PLANIFIE', 0,0,0,'','','','', new Date()]]);
creer('CATALOGUE', [['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE']]);

const g = charger(CODE_GS);
const tab = g.tableauAdmin_();

/* ---------- le tableau de bord ---------- */
const d0 = tab.devis[0];
T('la date d\'un devis est celle de la cellule, pas celle de Greenwich',
  d0.date === iso(minuit(-1)), {rendu:d0.date, attendu:iso(minuit(-1))});
T('la date de relance aussi',
  d0.relance === iso(minuit(3)), {rendu:d0.relance, attendu:iso(minuit(3))});
const c0 = tab.chantiers[0];
T('la date d\'un chantier aussi',
  c0.date === iso(minuit(1)), {rendu:c0.date, attendu:iso(minuit(1))});

/* ---------- le planning d'un salarié, déjà juste, doit le rester ---------- */
const pl = g.planningDe_('MARIE K');
T('le planning du salarié donne la même date',
  pl.length === 1 && pl[0].date === iso(minuit(1)), pl.map(x => x.date));
T('les deux écrans parlent du même jour',
  pl[0].date === c0.date, {planning:pl[0].date, tableau:c0.date});

/* ---------- et rien n'est décalé d'un jour ---------- */
T('aucune date ne précède la veille de ce qu\'elle devrait être',
  d0.date !== iso(minuit(-2)) && c0.date !== iso(minuit(0)),
  {devis:d0.date, chantier:c0.date});

console.log('\n=== LES DATES DU CLASSEUR : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
