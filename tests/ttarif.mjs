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

/* ---------- 10 bis. la ligne libre : attendue, pas refusée ---------- */
r = g.controlerTarifs_({lignes:[
  {reference:'LIBRE-1', designation:'Débarras de la cave', qte:3, unite:'heure', pu:45, rem:0}]}, regN);
T('une ligne libre n\'est pas traitée en « hors catalogue »', !/hors catalogue/.test(r), r);
T('elle est signalée nommément au bureau', /ligne libre/.test(r) && /Débarras de la cave/.test(r), r);
T('avec son prix et son montant', /45 €/.test(r) && /135 €/.test(r), r);
T('et le devis n\'est pas refusé pour autant : c\'est un signalement',
  r.indexOf('À VÉRIFIER') === 0, r);
r = g.controlerTarifs_({lignes:[
  {reference:'LIBRE-1', designation:'Débarras', qte:1, pu:100, rem:50}]}, regN);
T('le plafond de remise s\'applique quand même à une ligne libre',
  /remise 50 %/.test(r), r);
/* La référence réservée se lit au début, pas n'importe où : sinon une
   référence inventée qui la contient ouvrirait la même porte sans le dire. */
r = g.controlerTarifs_({lignes:[
  {reference:'X-LIBRE-1', designation:'Prestation inventée', qte:1, pu:900, rem:0}]}, regN);
T('une référence qui contient le préfixe sans commencer par lui reste hors catalogue',
  /hors catalogue/.test(r) && !/ligne libre/.test(r), r);
/* L'assiette de la majoration d'état des lieux ignore la ligne libre : son
   prix a été décidé sur place. Les deux côtés doivent compter pareil. */
creer('REGLAGES',[['CLE','VALEUR','NOTE'],['societe_nom','BB',''],
                  ['remise_max','10',''],['majoration_tres_sale','20','']]);
const regMaj = g.lireReglages_();
r = g.controlerTarifs_({nature:'CHANTIER', lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:100, pu:3, rem:0},
  {reference:'LIBRE-1', designation:'Débarras', qte:1, pu:500, rem:0},
  {reference:'MAJ-ETAT', designation:'Majoration pour état des lieux (+20 %)',
   qte:1, pu:60, rem:0}]}, regMaj);
T('la majoration se calcule sur le catalogue seul, pas sur la ligne libre',
  !/majoration de/.test(r), r);
r = g.controlerTarifs_({nature:'CHANTIER', lignes:[
  {reference:refVitrerie, designation:'Vitrerie extérieure', qte:100, pu:3, rem:0},
  {reference:'LIBRE-1', designation:'Débarras', qte:1, pu:500, rem:0},
  {reference:'MAJ-ETAT', designation:'Majoration pour état des lieux (+20 %)',
   qte:1, pu:160, rem:0}]}, regMaj);
T('une majoration gonflée de la ligne libre est donc bien vue',
  /majoration de 160/.test(r), r);
creer('REGLAGES',[['CLE','VALEUR','NOTE'],['societe_nom','BB',''],['remise_max','10','']]);

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
