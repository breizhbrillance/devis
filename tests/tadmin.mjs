/* L'espace d'administration côté classeur : le troisième rôle, ce qu'il voit,
   ce qu'il peut poser, et ce qui lui reste interdit. */
import {creer, lire, charger} from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok=[],ko=[];
const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };
const j=(n)=>{ const d=new Date(); d.setDate(d.getDate()+n); d.setHours(12,0,0,0); return d; };

const EN_D=['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','ADRESSE','CP','VILLE',
 'TOTAL_HT','TOTAL_HT_MENSUEL','TOTAL_TTC','STATUT','SIGNE','MOTIF_REFUS','RELANCE_LE',
 'LIEN_PDF','PREUVE_SIGNATURE','NOTE_COMMERCIAL','PASSAGES_MOIS'];
const L=(o)=>EN_D.map(h=>o[h]!==undefined?o[h]:'');
creer('DEVIS',[EN_D,
 L({NUMERO:'DEV-2026-SL-0001',DATE:j(-3),COMMERCIAL:'SIMON LG',CLIENT:'MAIRIE DE PLOEREN',
    VILLE:'Ploeren',TOTAL_HT:800,TOTAL_TTC:960,STATUT:'SIGNE',SIGNE:'OUI',
    LIEN_PDF:'https://drive/1',PREUVE_SIGNATURE:'https://drive/1'}),
 L({NUMERO:'DEV-2026-SL-0002',DATE:j(-2),COMMERCIAL:'SIMON LG',CLIENT:'EHPAD LES PINS',
    VILLE:'Vannes',TOTAL_HT:2000,TOTAL_HT_MENSUEL:2000,TOTAL_TTC:2400,STATUT:'SIGNE',SIGNE:'OUI',
    LIEN_PDF:'https://drive/2'}),
 L({NUMERO:'DEV-2026-LM-0001',DATE:j(-1),COMMERCIAL:'LEA M',CLIENT:'GARAGE DU PORT',
    VILLE:'Vannes',TOTAL_HT:500,TOTAL_TTC:600,STATUT:'REFUSE',MOTIF_REFUS:'Trop cher'}),
 L({NUMERO:'DEV-2026-LM-0002',DATE:j(-1),COMMERCIAL:'LEA M',CLIENT:'BOULANGERIE',
    VILLE:'Auray',TOTAL_HT:300,TOTAL_TTC:360,STATUT:'A RELANCER',RELANCE_LE:j(2)}),
 L({NUMERO:'DEV-2025-SL-0009',DATE:j(-400),COMMERCIAL:'SIMON LG',CLIENT:'VIEUX CLIENT',
    TOTAL_HT:9999,TOTAL_TTC:11999,STATUT:'SIGNE',SIGNE:'OUI'})]);

creer('LIGNES',[['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE',
 'PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT'],
 ['DEV-2026-SL-0001',1,'Vitrerie','REF-0006','Nettoyage des menuiseries','12 ouvrants',24,'m2',4,0,'PONCTUEL',20,96]]);

creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF'],
 ['SIMON LG','simon@bb.fr','ab1!','OUI'],['LEA M','lea@bb.fr','cd2#','OUI'],
 ['SIMON DIRECTION','direction@bb.fr','qx4$','OUI']]);
creer('PRESTATAIRES',[['NOM','EMAIL','CODE','ACTIF','TELEPHONE'],
 ['MARIE K','marie@bb.fr','kw7!','OUI','0600000001'],
 ['YANN P','yann@bb.fr','zp3#','OUI','0600000002']]);
creer('ADMINS',[['NOM','EMAIL','CODE','ACTIF'],
 ['SIMON DIRECTION','direction@bb.fr','qx4$','OUI'],
 ['ANCIEN ASSOCIE','vieux@bb.fr','mm9%','NON']]);
creer('REGLAGES',[['CLE','VALEUR','NOTE'],
 ['societe_nom','BREIZH BRILLANCE',''],['passages_mois_defaut','4',''],['remise_max','10','']]);
creer('JOURNAL',[['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
creer('CHANTIERS',[['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE',
 'PRESTATAIRE','STATUT','ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT',
 'PHOTOS','NOTE','CREE_LE'],
 ['CH-0001','DEV-2026-SL-0001','MAIRIE DE PLOEREN','1 place de la Mairie','56880','Ploeren',
  'Code portail 1975','','','', 'A PLANIFIER',0,0,0,'','','','',new Date()],
 ['CH-0002','DEV-2026-SL-0002','EHPAD LES PINS','4 rue des Pins','56000','Vannes','',
  j(1),'09:00','MARIE K','PLANIFIE',0,0,0,'','','','',new Date()],
 ['CH-0003','DEV-2026-SL-0002','EHPAD LES PINS','4 rue des Pins','56000','Vannes','',
  j(-2),'14:00','YANN P','FAIT',Date.now()-90000000,Date.now()-86400000,75,'','','','',new Date()]]);

const g = charger(CODE_GS);
const journal = ()=>lire('JOURNAL').slice(1).map(r=>String(r[3]));
const rep = (o)=>JSON.parse(g.doPost({postData:{contents:JSON.stringify(o)}}));

/* ---------- 1. qui est qui ---------- */
T('un admin actif est reconnu comme ADMIN',
  (g.trouverPersonne_('Simon Direction')||{}).role === 'ADMIN',
  g.trouverPersonne_('Simon Direction'));
T('un admin désactivé n\'existe plus', g.trouverPersonne_('ANCIEN ASSOCIE') === null);
T('un commercial reste commercial',
  (g.trouverPersonne_('SIMON LG')||{}).role === 'COMMERCIAL');
T('un nom présent dans les deux onglets ouvre le tableau, pas la saisie',
  (g.trouverPersonne_('SIMON DIRECTION')||{}).role === 'ADMIN',
  g.trouverPersonne_('SIMON DIRECTION'));
T('un prestataire reste prestataire',
  (g.trouverPersonne_('MARIE K')||{}).role === 'PRESTATAIRE');

/* ---------- 2. ce que l'admin reçoit à la connexion ---------- */
const ca = g.configAdmin_();
T('sa configuration ne contient aucun catalogue', !ca.catalogue, Object.keys(ca));
T('ni aucun compteur de numérotation', !ca.compteurs, Object.keys(ca));
T('elle porte les commerciaux, pour les filtres',
  ca.commerciaux.length === 3 && ca.commerciaux.indexOf('LEA M') >= 0, ca.commerciaux);
T('et les prestataires, pour la planification',
  ca.prestataires.length === 2 && ca.prestataires.indexOf('YANN P') >= 0, ca.prestataires);
T('le rôle est annoncé', ca.role === 'ADMIN');

/* ---------- 3. la cloison des rôles ---------- */
const refus = rep({action:'sync', nom:'SIMON DIRECTION', code:'qx4$', devis:{}});
T('un admin ne peut pas déposer un devis',
  refus.ok === false && /autoris/.test(String(refus.erreur||'')), refus);
const refus2 = rep({action:'tableau', nom:'SIMON LG', code:'ab1!'});
T('un commercial ne peut pas lire le tableau',
  refus2.ok === false && /autoris/.test(String(refus2.erreur||'')), refus2);
const refus3 = rep({action:'planifier', nom:'MARIE K', code:'kw7!', id:'CH-0001'});
T('un prestataire ne peut pas planifier',
  refus3.ok === false && /autoris/.test(String(refus3.erreur||'')), refus3);
T('chaque refus est inscrit au journal',
  journal().filter(a=>a==='ACTION REFUSEE').length === 3, journal());

/* ---------- 4. le tableau ---------- */
const t = rep({action:'tableau', nom:'SIMON DIRECTION', code:'qx4$'});
T('l\'admin obtient son tableau', t.ok === true);
T('les devis de tous les commerciaux y sont',
  t.devis.length === 4 && new Set(t.devis.map(d=>d.commercial)).size === 2,
  t.devis.map(d=>d.numero+':'+d.commercial));
T('un devis trop ancien reste dehors',
  !t.devis.some(d=>d.numero === 'DEV-2025-SL-0009'), t.devis.map(d=>d.numero));
T('les plus récents en tête', t.devis[0].date >= t.devis[t.devis.length-1].date,
  t.devis.map(d=>d.date));
T('le motif de refus remonte',
  (t.devis.find(d=>d.numero==='DEV-2026-LM-0001')||{}).motif === 'Trop cher');
T('la date de relance aussi',
  /^\d{4}-\d{2}-\d{2}$/.test((t.devis.find(d=>d.numero==='DEV-2026-LM-0002')||{}).relance||''),
  (t.devis.find(d=>d.numero==='DEV-2026-LM-0002')||{}).relance);
T('le lien du PDF est fourni',
  (t.devis.find(d=>d.numero==='DEV-2026-SL-0001')||{}).pdf === 'https://drive/1');

T('les chiffres comptent les devis de la fenêtre',
  t.chiffres.nb === 4 && t.chiffres.signes === 2, t.chiffres);
T('le montant devisé est juste', t.chiffres.ht === 3600, t.chiffres);
T('le montant signé aussi', t.chiffres.htSigne === 2800, t.chiffres);
T('le récurrent mensuel signé est isolé', t.chiffres.mensuelSigne === 2000, t.chiffres);
T('le détail par commercial est là, le meilleur en tête',
  t.parCommercial.length === 2 && t.parCommercial[0].nom === 'SIMON LG', t.parCommercial);
T('et il ne mélange pas les deux',
  t.parCommercial.find(x=>x.nom==='LEA M').signes === 0, t.parCommercial);

T('les chantiers de tous les prestataires y sont',
  t.chantiers.length === 3, t.chantiers.map(c=>c.id+':'+c.prestataire));
T('celui qui n\'est pas planifié arrive en tête',
  t.chantiers[0].id === 'CH-0001' && !t.chantiers[0].date, t.chantiers.map(c=>c.id));
T('l\'accès au site est transmis',
  /1975/.test(t.chantiers[0].acces), t.chantiers[0].acces);
T('un chantier fait porte sa durée',
  (t.chantiers.find(c=>c.id==='CH-0003')||{}).minutes === 75);
T('la liste des prestataires accompagne le tableau',
  t.prestataires.length === 2, t.prestataires);

/* ---------- 5. planifier ---------- */
let r = rep({action:'planifier', nom:'SIMON DIRECTION', code:'qx4$',
             id:'CH-0001', date:'2026-10-12', heure:'08:30', prestataire:'marie k'});
T('la planification est acceptée', r.ok === true, r);
T('le chantier quitte « à planifier »', r.statut === 'PLANIFIE', r);
let ch = lire('CHANTIERS');
const ligne = (id)=>{ const en=ch[0]; const l=ch.slice(1).find(x=>x[en.indexOf('ID')]===id); const o={}; en.forEach((h,i)=>o[h]=l[i]); return o; };
let c1 = ligne('CH-0001');
T('la date est posée', c1.DATE instanceof Date && c1.DATE.toISOString().slice(0,10)==='2026-10-12',
  String(c1.DATE));
T('l\'heure aussi', c1.HEURE === '08:30');
T('le nom est écrit tel qu\'il figure dans PRESTATAIRES', c1.PRESTATAIRE === 'MARIE K', c1.PRESTATAIRE);
T('le statut est à jour dans la feuille', c1.STATUT === 'PLANIFIE');
T('le journal garde trace de la planification',
  journal().indexOf('CHANTIER PLANIFIE') >= 0, journal());

T('le chantier apparaît alors sur le bon téléphone',
  g.planningDe_('MARIE K').some(c=>c.id==='CH-0001'),
  g.planningDe_('MARIE K').map(c=>c.id));
T('et sur aucun autre',
  !g.planningDe_('YANN P').some(c=>c.id==='CH-0001'));

/* ---------- 6. ce que la planification refuse ---------- */
r = rep({action:'planifier', nom:'SIMON DIRECTION', code:'qx4$',
         id:'CH-0001', prestataire:'QUELQU UN'});
T('un prestataire inconnu est refusé', r.ok === false && /liste/.test(String(r.erreur||'')), r);
ch = lire('CHANTIERS');
T('et rien n\'a bougé', ligne('CH-0001').PRESTATAIRE === 'MARIE K');

r = rep({action:'planifier', nom:'SIMON DIRECTION', code:'qx4$', id:'CH-9999', date:'2026-10-12'});
T('un chantier inexistant est refusé', r.ok === false, r);

r = rep({action:'planifier', nom:'SIMON DIRECTION', code:'qx4$', id:'CH-0001', date:''});
ch = lire('CHANTIERS');
T('retirer la date remet le chantier à planifier',
  ligne('CH-0001').STATUT === 'A PLANIFIER', ligne('CH-0001').STATUT);
T('et il disparaît du téléphone du prestataire',
  !g.planningDe_('MARIE K').some(c=>c.id==='CH-0001'));

/* ---------- 7. corriger un résultat ---------- */
r = rep({action:'statut', nom:'SIMON DIRECTION', code:'qx4$',
         numero:'DEV-2026-LM-0001', verdict:'SIGNE', quand:Date.now()});
T('l\'admin peut corriger le résultat d\'un devis', r.ok !== false, r);
const d1 = lire('DEVIS')[0].indexOf('STATUT');
T('le devis refusé est passé en signé',
  lire('DEVIS').slice(1).find(l=>l[0]==='DEV-2026-LM-0001')[d1] === 'SIGNE');
T('la correction est tracée au nom de l\'admin',
  lire('JOURNAL').slice(1).some(l=>String(l[3])==='RESULTAT SIGNE' && String(l[2])==='SIMON DIRECTION'),
  lire('JOURNAL').slice(1).map(l=>l[2]+':'+l[3]));

/* ---------- 8. la structure se crée toute seule ---------- */
T('l\'onglet ADMINS a ses colonnes',
  lire('ADMINS')[0].join(',') === 'NOM,EMAIL,CODE,ACTIF', lire('ADMINS')[0]);

console.log('\n=== ESPACE ADMIN (classeur) : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
process.exit(ko.length?1:0);
