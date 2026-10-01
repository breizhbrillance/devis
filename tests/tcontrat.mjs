/* La nature du devis commande le nombre de chantiers.

   Jusqu'ici le classeur décidait d'après le type des lignes, et le nombre de
   passages n'était jamais transmis : tout contrat donnait 4 chantiers, celui
   à 2 passages comme celui à 12. */
import { creer, lire, charger } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok = [], ko = [];
const T = (n, c, d) => { (c?ok:ko).push(n + (c?'':'  → ' + JSON.stringify(d))); };

const EN_D = ['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','ADRESSE','CP','VILLE',
 'TOTAL_HT','TOTAL_HT_MENSUEL','TOTAL_TTC','STATUT','SIGNE','NOTE_COMMERCIAL',
 'PASSAGES_MOIS','NATURE'];
const L = (o) => EN_D.map(h => o[h] !== undefined ? o[h] : '');

creer('DEVIS', [EN_D,
  L({NUMERO:'DEV-A', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'MAIRIE',
     ADRESSE:'1 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:720, TOTAL_HT_MENSUEL:720,
     TOTAL_TTC:864, STATUT:'SIGNE', SIGNE:'OUI', PASSAGES_MOIS:6, NATURE:'ENTRETIEN'}),
  L({NUMERO:'DEV-B', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'CAD LINE',
     ADRESSE:'6 rue', CP:'56860', VILLE:'SENE', TOTAL_HT:300, TOTAL_TTC:360,
     STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER'}),
  // un devis d'avant la nature : seul le type des lignes le dit
  L({NUMERO:'DEV-C', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'ANCIEN CONTRAT',
     ADRESSE:'3 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:400, TOTAL_TTC:480,
     STATUT:'SIGNE', SIGNE:'OUI', PASSAGES_MOIS:3}),
  // et un autre, sans rien du tout : une intervention
  L({NUMERO:'DEV-D', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'ANCIEN PONCTUEL',
     ADRESSE:'4 rue', CP:'56000', VILLE:'VANNES', TOTAL_HT:200, TOTAL_TTC:240,
     STATUT:'SIGNE', SIGNE:'OUI'})]);

const EN_L = ['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE',
 'PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT'];
creer('LIGNES', [EN_L,
 ['DEV-A',1,'Sols','REF-1','Lavage des sols','',100,'m2',1.2,0,'PONCTUEL',20,120],
 ['DEV-B',1,'Vitrerie','REF-2','Nettoyage de vitres','',120,'m2',2.5,0,'PONCTUEL',20,300],
 ['DEV-C',1,'Bureaux','REF-3','Entretien de bureaux','',100,'m2/mois',1.2,0,'MENSUEL',20,120],
 ['DEV-D',1,'Vitrerie','REF-2','Nettoyage de vitres','',80,'m2',2.5,0,'PONCTUEL',20,200]]);

creer('COMMERCIAUX', [['NOM','EMAIL','CODE','ACTIF'], ['SIMON LG','s@bb.fr','ab1!','OUI']]);
creer('PRESTATAIRES', [['NOM','EMAIL','CODE','ACTIF','TELEPHONE']]);
creer('ADMINS', [['NOM','EMAIL','CODE','ACTIF']]);
creer('REGLAGES', [['CLE','VALEUR','NOTE'],
 ['societe_nom','BREIZH BRILLANCE',''], ['passages_mois_defaut','4','']]);
creer('JOURNAL', [['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
creer('CHANTIERS', [['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE',
 'PRESTATAIRE','STATUT','ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT',
 'PHOTOS','NOTE','CREE_LE']]);
creer('CATALOGUE', [['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE']]);

const g = charger(CODE_GS);
const compte = (num) => lire('CHANTIERS').slice(1).filter(r => String(r[1]) === num).length;

/* ---------- un contrat d'entretien ---------- */
g.genererChantiers_('DEV-A');
T('un entretien à 6 passages crée 6 chantiers', compte('DEV-A') === 6, compte('DEV-A'));
T('ils portent tous le client du devis',
  lire('CHANTIERS').slice(1).filter(r => String(r[1]) === 'DEV-A').every(r => String(r[2]) === 'MAIRIE'));
T('ils naissent sans date ni salarié',
  lire('CHANTIERS').slice(1).filter(r => String(r[1]) === 'DEV-A')
    .every(r => !String(r[7]).trim() && !String(r[9]).trim()));
T('et tous à planifier',
  lire('CHANTIERS').slice(1).filter(r => String(r[1]) === 'DEV-A')
    .every(r => String(r[10]) === 'A PLANIFIER'));

/* ---------- une fin de chantier ---------- */
g.genererChantiers_('DEV-B');
T('une fin de chantier n\'en crée qu\'un', compte('DEV-B') === 1, compte('DEV-B'));

/* ---------- la règle d'avant, pour les devis déjà signés ---------- */
g.genererChantiers_('DEV-C');
T('un ancien devis à lignes mensuelles suit encore son nombre de passages',
  compte('DEV-C') === 3, compte('DEV-C'));
g.genererChantiers_('DEV-D');
T('un ancien devis ponctuel n\'en crée toujours qu\'un', compte('DEV-D') === 1, compte('DEV-D'));

/* ---------- on ne génère pas deux fois ---------- */
g.genererChantiers_('DEV-A');
T('rejouer la génération ne double rien', compte('DEV-A') === 6, compte('DEV-A'));

/* ---------- le défaut du classeur ne s'applique plus qu'à défaut ---------- */
T('le réglage par défaut ne sert plus quand le devis dit combien',
  compte('DEV-A') !== 4 && compte('DEV-C') !== 4,
  {A: compte('DEV-A'), C: compte('DEV-C')});

console.log('\n=== NATURE DU DEVIS (classeur) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
