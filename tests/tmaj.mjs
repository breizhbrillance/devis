/* La majoration pour état des lieux, côté classeur (v48), et la grille par
   défaut alignée sur le classeur.

   La majoration n'est pas au catalogue : c'est un pourcentage du reste du devis.
   Le classeur la recalcule donc lui-même, avec ses deux taux, et signale tout
   montant qui ne correspond à aucun. Sans cela, la ligne serait soit rejetée
   comme « hors catalogue » à chaque devis, soit une porte ouverte pour gonfler
   ou raboter un total. */
import {creer, lire, charger} from './gs.mjs';
import {CODE_GS} from './chemins.mjs';
const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };

const EN_D=['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','SIRET_CLIENT','TVA_CLIENT','CONTACT',
 'TELEPHONE','EMAIL','ADRESSE','CP','VILLE','TOTAL_HT_PONCTUEL','TOTAL_HT_MENSUEL','TOTAL_HT','TOTAL_TVA',
 'TOTAL_TTC','REMISE_PCT','STATUT','SIGNE','SIGNATAIRE','VALIDITE','LIEN_PDF','PHOTOS','NOTES','RECU_LE',
 'ID_APPAREIL','ID_DEVIS','OBJET','LOGEMENT_PLUS_2_ANS','TAUX_TVA','DELAI','MOTIF_REFUS','RELANCE_LE',
 'DATE_STATUT','PREUVE_SIGNATURE','NOTE_COMMERCIAL','CONTROLE_TARIF','PASSAGES_MOIS','NATURE','DATE_SOUHAITEE'];
const EN_C=['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE','PRESTATAIRE','STATUT',
 'ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT','PHOTOS','NOTE','CREE_LE','DUREE_PREVUE_MIN','LOT'];
function socle(reglages = [['majoration_sale','15',''],['majoration_tres_sale','30','']]){
  creer('DEVIS',[EN_D]);
  creer('LIGNES',[['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE','PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
  creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF'],['SIMON LG','simon@test.fr','ab1!','OUI']]);
  creer('PRESTATAIRES',[['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE'],
                        ['MAXIME','m@test.fr','kw7!','OUI','','MA,ME,JE,VE,SA','08:00-12:00,14:00-17:00',35]]);
  creer('ADMINS',[['NOM','EMAIL','CODE','ACTIF']]);
  creer('CHANTIERS',[EN_C]);
  creer('ABSENCES',[['PRESTATAIRE','DU','AU']]);
  creer('CATALOGUE',[['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES'],
    ['Vitrerie','Nettoyage de vitres','','m2',3,20,'PONCTUEL','OUI','REF-0001','CHANTIER,REMISE'],
    ['Sols','Lavage des sols','','m2',0.5,20,'PONCTUEL','OUI','REF-0002','CHANTIER,REMISE']]);
  creer('REGLAGES',[['CLE','VALEUR','NOTE'],['societe_nom','BREIZH BRILLANCE',''],
    ['remise_max','10',''],['planification_auto','NON',''], ...reglages]);
  creer('JOURNAL',[['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  return charger(CODE_GS);
}
const vitres = {reference:'REF-0001', categorie:'Vitrerie', designation:'Nettoyage de vitres', qte:50, unite:'m2', pu:3, rem:0, tva:20, type:'PONCTUEL'};
const sols   = {reference:'REF-0002', categorie:'Sols', designation:'Lavage des sols', qte:100, unite:'m2', pu:0.5, rem:0, tva:20, type:'PONCTUEL'};
const maj = (pu, extra) => Object.assign({reference:'MAJ-ETAT', categorie:'État des lieux',
  designation:'Majoration pour état des lieux', qte:1, unite:'forfait', pu, rem:0, tva:20, type:'PONCTUEL'}, extra||{});

/* ---------- 1. le contrôle des prix ---------- */
let g = socle(); let reg = g.lireReglages_();
const ctl = (lignes, nature) => g.controlerTarifs_({lignes, nature: nature || 'CHANTIER'}, reg);
T('sans majoration, un devis au tarif ne déclenche rien', ctl([vitres, sols]) === '', ctl([vitres, sols]));
T('30 % de 200 € = 60 € : la majoration « très sale » est acceptée', ctl([vitres, sols, maj(60)]) === '', ctl([vitres, sols, maj(60)]));
T('15 % de 200 € = 30 € : l\'ancien palier « sale » est refusé, même avec son réglage resté au classeur',
  /majoration de 30/.test(ctl([vitres, sols, maj(30)])), ctl([vitres, sols, maj(30)]));
T('elle n\'est plus rangée parmi les « hors catalogue »', !/hors catalogue/.test(ctl([vitres, sols, maj(60)])));
let r = ctl([vitres, sols, maj(100)]);
T('une majoration de 50 % est signalée', /majoration de 100/.test(r), r);
T('le message rappelle le taux permis et la base', /\(30 % de 200 €\)/.test(r), r);
r = ctl([vitres, sols, maj(10)]);
T('une majoration rabotée est signalée aussi', /majoration de 10/.test(r), r);
r = ctl([vitres, sols, maj(30, {qte:2})]);
T('deux fois 30 € font bien 60 € : le montant compte, pas la façon de l\'écrire', r === '', r);
r = ctl([vitres, sols, maj(60), maj(60)]);
T('deux lignes de majoration : la seconde est signalée', /comptée deux fois/.test(r), r);
T('la base ne compte pas la majoration elle-même',
  ctl([vitres, maj(45)]) === '' && /majoration/.test(ctl([vitres, maj(58.5)])),
  [ctl([vitres, maj(45)]), ctl([vitres, maj(58.5)])]);
r = ctl([vitres, maj(45)], 'ENTRETIEN');
T('une majoration sur un contrat d\'entretien est signalée', /contrat d'entretien/.test(r), r);
r = ctl([Object.assign({}, vitres, {pu:1}), maj(15)]);
T('les autres lignes restent contrôlées', /prix 1 au lieu de 3/.test(r), r);
r = ctl([vitres, maj(45, {rem:25})]);
T('et la remise de la ligne de majoration reste plafonnée', /remise 25 %/.test(r), r);
r = ctl([vitres, {reference:'XX-1', designation:'Autre chose', qte:1, pu:5, rem:0}]);
T('une vraie ligne hors catalogue est toujours signalée', /hors catalogue/.test(r), r);

g = socle([]); reg = g.lireReglages_();
r = g.controlerTarifs_({lignes:[vitres, maj(45)], nature:'CHANTIER'}, reg);
T('un classeur sans taux n\'accepte aucune majoration', /aucun/.test(r), r);
T('un pourcentage illisible vaut zéro', g.pourcentReglage_('abc') === 0 && g.pourcentReglage_('') === 0 &&
  g.pourcentReglage_('12,5') === 12.5 && g.pourcentReglage_('250') === 100);

/* ---------- 2. l'enregistrement ---------- */
g = socle();
const devis = (extra)=>Object.assign({
  numero:'DEV-2026-SL-0011', date:new Date().toISOString(),
  validite:new Date(Date.now()+30*86400000).toISOString(), commercial:'SIMON LG',
  client:{type:'PRO', societe:'SYNDIC ARMOR', contact:'Mme Le Gall', adresse:'12 rue Nicolazic', cp:'56000', ville:'VANNES'},
  lignes:[vitres, maj(45, {designation:'Majoration pour état des lieux (+30 %)'})],
  totaux:{ht:195, tva:39, ttc:234, htPonctuel:195, htMensuel:0},
  nature:'CHANTIER', etatSite:'TRES_SALE', objet:'', delai:'', notes:'', signataire:'', signature:''}, extra||{});
const COM = {nom:'SIMON LG', email:'simon@test.fr', role:'COMMERCIAL'};
const r1 = g.enregistrer_({id:'d-11', nom:'SIMON LG', code:'ab1!', appareil:'APP-1', devis:devis(), pdf:'AAAA', nomFichier:'d.pdf'}, COM);
const D = lire('DEVIS'); const col = (n) => D[1] ? D[1][D[0].indexOf(n)] : undefined;
T('le devis majoré est enregistré', r1 && r1.ok === true, r1);
T('la colonne ETAT_SITE a été créée', D[0].includes('ETAT_SITE'), D[0]);
T('et porte ce que le commercial a coché', col('ETAT_SITE') === 'TRES_SALE', col('ETAT_SITE'));
T('le contrôle des prix ne signale rien', String(col('CONTROLE_TARIF') || '') === '', col('CONTROLE_TARIF'));
T('le total reçu est gardé', col('TOTAL_HT') === 195, col('TOTAL_HT'));
const LG = lire('LIGNES').slice(1);
T('les deux lignes sont dans l\'onglet LIGNES', LG.length === 2 && LG[1][3] === 'MAJ-ETAT', LG.map(l=>l[3]));
T('un état inconnu vaut NORMAL', g.etatSite_('n\'importe quoi') === 'NORMAL' && g.etatSite_('') === 'NORMAL');
T('l\'ancien « SALE » aussi', g.etatSite_('SALE') === 'NORMAL', g.etatSite_('SALE'));
T('« très sale » s\'écrit de plusieurs façons', g.etatSite_('tres sale') === 'TRES_SALE' && g.etatSite_('TRES-SALE') === 'TRES_SALE');

/* ---------- 3. le salarié ne voit pas la majoration comme une tâche ---------- */
lire('CHANTIERS').push(EN_C.map(h => ({ID:'CH-0001', NUMERO:col('NUMERO'), CLIENT:'SYNDIC ARMOR',
  DATE:new Date(Date.now()+86400000), HEURE:'08:00', PRESTATAIRE:'MAXIME', STATUT:'PLANIFIE'})[h] ?? ''));
const pl = g.planningDe_('MAXIME');
T('Maxime voit son chantier', pl.length === 1, pl.length);
T('avec la prestation à faire', pl[0] && pl[0].taches.some(t => t.designation === 'Nettoyage de vitres'), pl[0] && pl[0].taches);
T('mais pas la ligne de majoration : ce n\'est pas un travail à cocher',
  pl[0] && !pl[0].taches.some(t => /Majoration/.test(t.designation)) && pl[0].taches.length === 1, pl[0] && pl[0].taches);
T('et toujours sans un seul montant', pl[0] && !JSON.stringify(pl[0]).match(/"pu"|\b45\b|195/), pl[0]);

/* ---------- 4. les réglages et la grille par défaut ---------- */
const cles = g.REGLAGES_DEFAUT_.map(x => x[0]);
T('le taux « très sale » est dans les réglages par défaut, à 30 %',
  cles.includes('majoration_tres_sale') && g.REGLAGES_DEFAUT_.find(x=>x[0]==='majoration_tres_sale')[1] === '30');
T('le palier « sale » n\'y est plus', !cles.includes('majoration_sale'), cles.filter(k=>/majoration/.test(k)));
g = socle([]); g.majStructure_();
T('la mise à jour de structure l\'ajoute à un classeur qui ne l\'a pas, et n\'ajoute pas l\'ancien palier',
  !lire('REGLAGES').some(l => l[0] === 'majoration_sale') &&
  lire('REGLAGES').some(l => l[0] === 'majoration_tres_sale' && String(l[1]) === '30'), lire('REGLAGES').map(l=>l[0]));

const G = g.CATALOGUE_DEFAUT_;
T('la grille par défaut compte 29 prestations', G.length === 29, G.length);
T('de dix colonnes chacune', G.every(l => l.length === 10), G.filter(l => l.length !== 10));
const refs = G.map(l => l[8]);
T('aux références uniques, de REF-0001 à REF-0029',
  new Set(refs).size === 29 && refs.slice().sort().join() === Array.from({length:29},(_, i)=>'REF-00'+('0'+(i+1)).slice(-2)).join(), refs);
T('aucune prestation ne se vend plus dans les trois natures', G.every(l => String(l[9]).trim() !== ''), G.filter(l=>!l[9]));
const ent = G.filter(l => l[9] === 'ENTRETIEN');
T('quatorze tâches d\'entretien, toutes à cocher', ent.length === 14 && ent.every(l => l[3] === 'forfait'), ent.length);
T('pour 73,20 € par passage', Math.round(ent.reduce((s,l)=>s+l[4],0)*100)/100 === 73.2, ent.reduce((s,l)=>s+l[4],0));
T('le nettoyage vapeur est placé juste avant le lavage humide',
  refs.indexOf('REF-0015') + 1 === refs.indexOf('REF-0004'), refs.slice(0, 6));
T('et juste après le décapage', refs.indexOf('REF-0003') + 1 === refs.indexOf('REF-0015'), refs.slice(0, 6));
T('le décapage reste réservé à la fin de chantier, la vapeur à la remise en état',
  G.find(l=>l[8]==='REF-0003')[9] === 'CHANTIER' && G.find(l=>l[8]==='REF-0015')[9] === 'REMISE');
/* La grille chargée dans un classeur se relit telle quelle. */
creer('CATALOGUE',[['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES'], ...G.map(l=>l.slice())]);
const lu = g.lireCatalogue_();
const pour = (n) => lu.filter(p => !p.natures.length || p.natures.includes(n)).length;
T('relue, elle donne 14 lignes par nature', pour('ENTRETIEN') === 14 && pour('CHANTIER') === 14 && pour('REMISE') === 14,
  [pour('ENTRETIEN'), pour('CHANTIER'), pour('REMISE')]);

console.log('\n=== MAJORATION ET GRILLE (classeur) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
