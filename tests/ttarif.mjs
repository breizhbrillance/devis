/* Le verrouillage des tarifs, côté classeur : référence du catalogue remplie
   toute seule, contrôle du prix reçu, plafond de remise. */
import {creer, lire, charger} from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok=[],ko=[];
const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };

/* Un catalogue SANS colonne REFERENCE : c'est l'état du classeur de Simon. */
creer('CATALOGUE',[
 ['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF'],
 ['Vitrerie','Vitrerie extérieure','','m²',3,20,'PONCTUEL','OUI'],
 ['Bureaux','Nettoyage de bureaux','','m²/mois',10,20,'MENSUEL','OUI'],
 ['Sols','Décapage','','m²',6,20,'PONCTUEL','OUI'],
 ['Ancien','Prestation retirée','','forfait',99,20,'PONCTUEL','NON']]);

creer('REGLAGES',[['CLE','VALEUR','NOTE'],
 ['societe_nom','BREIZH BRILLANCE',''],
 ['remise_max','10','']]);

creer('DEVIS',[['NUMERO','DATE','COMMERCIAL','CONTROLE_TARIF']]);
creer('LIGNES',[['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL',
                 'QTE','UNITE','PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF'],['SIMON LG','s@t.fr','ab1!','OUI']]);
creer('JOURNAL',[['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);

const g = charger(CODE_GS);

/* ---------- 1. la colonne REFERENCE se crée et se remplit ---------- */
g.majStructure_();
let cat = lire('CATALOGUE');
const iRef = cat[0].indexOf('REFERENCE');
T('REFERENCE ajoutée au catalogue', iRef >= 0, cat[0]);
T('REFERENCE ajoutée À LA FIN, sans déplacer les colonnes existantes',
  cat[0].slice(0,8).join('|') === 'CATEGORIE|DESIGNATION|DETAIL|UNITE|PU_HT|TVA|TYPE|ACTIF', cat[0]);
const refs = cat.slice(1).map(r=>r[iRef]);
T('chaque prestation reçoit une référence', refs.every(x=>String(x).trim()), refs);
T('les références sont uniques', new Set(refs).size === refs.length, refs);
T('les prix n\'ont pas bougé', cat[1][4]===3 && cat[2][4]===10 && cat[3][4]===6,
  cat.slice(1).map(r=>r[4]));

/* ---------- 2. une deuxième migration ne réécrit rien ---------- */
g.majStructure_();
const refs2 = lire('CATALOGUE').slice(1).map(r=>r[iRef]);
T('une seconde migration laisse les références intactes',
  refs2.join('|') === refs.join('|'), {refs, refs2});

/* ---------- 3. le catalogue rend bien la référence ---------- */
const lu = g.lireCatalogue_();
T('lireCatalogue_ rend une référence par prestation',
  lu.length===3 && lu.every(p=>p.reference), lu.map(p=>p.reference));
T('la prestation inactive reste exclue', lu.length===3, lu.length);

const refVitrerie = lu.find(p=>p.designation==='Vitrerie extérieure').reference;
const refBureaux  = lu.find(p=>p.designation==='Nettoyage de bureaux').reference;
const reg = g.lireReglages_();

/* ---------- 4. un devis conforme ne déclenche rien ---------- */
T('devis au tarif du catalogue : aucun écart',
  g.controlerTarifs_({lignes:[
    {reference:refVitrerie, designation:'Vitrerie extérieure', qte:50, pu:3, rem:0},
    {reference:refBureaux,  designation:'Nettoyage de bureaux', qte:100, pu:10, rem:10}
  ]}, reg) === '',
  g.controlerTarifs_({lignes:[{reference:refVitrerie,designation:'x',qte:1,pu:3,rem:0}]}, reg));

/* ---------- 5. un prix modifié est signalé ---------- */
let r = g.controlerTarifs_({lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:50, pu:1, rem:0}]}, reg);
T('prix baissé : signalé', /prix 1 au lieu de 3/.test(r), r);
T('prix baissé : la ligne est nommée', /Vitrerie extérieure/.test(r), r);
T('le message commence par un avertissement lisible', /^À VÉRIFIER/.test(r), r);

r = g.controlerTarifs_({lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:50, pu:30, rem:0}]}, reg);
T('prix gonflé aussi : signalé', /prix 30 au lieu de 3/.test(r), r);

/* ---------- 6. les centimes ne créent pas de faux écarts ---------- */
r = g.controlerTarifs_({lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:50, pu:3.001, rem:0}]}, reg);
T('un millième d\'écart n\'est pas une alerte', r === '', r);

/* ---------- 7. la remise est plafonnée ---------- */
r = g.controlerTarifs_({lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:50, pu:3, rem:40}]}, reg);
T('remise au-delà du plafond : signalée', /remise 40 % au lieu de 10 %/.test(r), r);

r = g.controlerTarifs_({lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:50, pu:3, rem:10}]}, reg);
T('remise pile au plafond : acceptée', r === '', r);

/* ---------- 8. plafond à zéro : aucune remise ---------- */
creer('REGLAGES',[['CLE','VALEUR','NOTE'],['societe_nom','BB',''],['remise_max','0','']]);
const reg0 = g.lireReglages_();
r = g.controlerTarifs_({lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:50, pu:3, rem:5}]}, reg0);
T('plafond à 0 : toute remise est signalée', /remise 5 %/.test(r), r);

/* ---------- 9. plafond absent : on ne suppose rien de généreux ---------- */
creer('REGLAGES',[['CLE','VALEUR','NOTE'],['societe_nom','BB','']]);
const regVide = g.lireReglages_();
r = g.controlerTarifs_({lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:50, pu:3, rem:5}]}, regVide);
T('réglage absent : la remise est refusée par défaut, pas autorisée', /remise 5 %/.test(r), r);

/* ---------- 10. ligne hors catalogue ---------- */
creer('REGLAGES',[['CLE','VALEUR','NOTE'],['societe_nom','BB',''],['remise_max','10','']]);
const regN = g.lireReglages_();
r = g.controlerTarifs_({lignes:[
  {reference:'', designation:'Prestation inventée', qte:1, pu:500, rem:0}]}, regN);
T('prestation inconnue : signalée comme hors catalogue', /hors catalogue/.test(r), r);

/* ---------- 11. vieille ligne sans référence mais au bon nom ---------- */
r = g.controlerTarifs_({lignes:[
  {reference:'', designation:'Vitrerie extérieure', qte:50, pu:3, rem:0}]}, regN);
T('devis d\'avant la référence : retrouvé par sa désignation, aucun faux positif', r === '', r);

r = g.controlerTarifs_({lignes:[
  {reference:'', designation:'VITRERIE EXTERIEURE', qte:50, pu:1, rem:0}]}, regN);
T('même sans accents ni casse, l\'écart de prix est vu', /prix 1 au lieu de 3/.test(r), r);

/* ---------- 12. plusieurs écarts sur un même devis ---------- */
r = g.controlerTarifs_({lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:50, pu:1, rem:0},
  {reference:refBureaux,  designation:'Nettoyage de bureaux', qte:10, pu:10, rem:50}]}, regN);
T('deux anomalies : les deux sont dites', /prix 1/.test(r) && /remise 50/.test(r), r);
T('la ligne 1 et la ligne 2 sont distinguées', /ligne 1/.test(r) && /ligne 2/.test(r), r);

/* ---------- 13. devis vide ---------- */
T('devis sans ligne : pas d\'alerte', g.controlerTarifs_({lignes:[]}, regN) === '', 'x');
T('devis sans le champ lignes : pas d\'erreur', g.controlerTarifs_({}, regN) === '', 'x');

console.log('\n=== TARIFS VERROUILLÉS : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
process.exit(ko.length?1:0);
