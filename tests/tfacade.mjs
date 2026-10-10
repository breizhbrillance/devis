/* La façade, cinquième nature de devis (v60).

   Le devis type relevé chez un concurrent tient en trois lignes : nettoyage de
   façade au m², pulvérisation d'antimousse au m², forfait nacelle à la
   journée. Sur 108 m², cela fait 1 609,20 + 421,20 + 450 = 2 480,40 € HT, et
   2 728,44 € TTC à 10 % — le taux du logement de plus de deux ans.

   Ce que ces essais gardent :
   — la nature FACADE existe et se reconnaît, accentuée ou non, sans casser les
     quatre autres ;
   — une façade ne se vend jamais au contrat : aucun nombre de passages ne la
     rend récurrente, contrairement à la vitrerie ;
   — l'éloignement la majore, comme l'entretien et la vitrerie : l'équipe part
     de l'agence et y revient, même pour une intervention unique ;
   — le contrôle des tarifs refuse une ligne de façade sur un entretien et une
     ligne d'entretien sur une façade. C'est le seul garde-fou : si la colonne
     NATURES cessait d'être lue, le mélange reviendrait en silence ;
   — et la nacelle, forfait à la journée, ne se laisse pas rogner plus que le
     reste.
*/
import { creer, lire, charger } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };

const EN_D = ['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','SIRET_CLIENT','TVA_CLIENT','CONTACT',
 'TELEPHONE','EMAIL','ADRESSE','CP','VILLE','TOTAL_HT_PONCTUEL','TOTAL_HT_MENSUEL','TOTAL_HT','TOTAL_TVA',
 'TOTAL_TTC','REMISE_PCT','STATUT','SIGNE','SIGNATAIRE','VALIDITE','LIEN_PDF','PHOTOS','NOTES','RECU_LE',
 'ID_APPAREIL','ID_DEVIS','OBJET','LOGEMENT_PLUS_2_ANS','TAUX_TVA','DELAI','MOTIF_REFUS','RELANCE_LE',
 'DATE_STATUT','PREUVE_SIGNATURE','NOTE_COMMERCIAL','CONTROLE_TARIF','PASSAGES_MOIS','NATURE',
 'DATE_SOUHAITEE','ETAT_SITE','NUMERO_ORIGINE','KM_AGENCE'];

/* Le catalogue tel qu'il sera en ligne : les trois lignes de façade, une de
   vitrerie et une d'entretien pour éprouver que les natures ne se mélangent
   pas. La TVA inscrite n'est qu'un repli ; c'est l'application qui tranche. */
const CAT = [
  ['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES'],
  ['Sols','Aspiration des sols','','m2',0.15,20,'MENSUEL','OUI','REF-0016','ENTRETIEN'],
  ['Vitrages et menuiseries','Vitrages intérieurs','','m²',4,20,'PONCTUEL','OUI','REF-0031','VITRERIE'],
  ['Nettoyage de façade','Nettoyage de façade','Mise en sécurité du chantier • protection de la maison et de ses abords • pulvérisation du nettoyant sans chlore • passage du nettoyeur réglé au jet plat • finition et nettoyage du chantier','m²',14.90,10,'PONCTUEL','OUI','REF-0036','FACADE'],
  ['Nettoyage de façade','Pulvérisation d\'antimousse végétale, non-retour de mousse garanti 2 ans','','m²',3.90,10,'PONCTUEL','OUI','REF-0037','FACADE'],
  ['Nettoyage de façade','Forfait nacelle à la journée','','journée(s)',450,10,'PONCTUEL','OUI','REF-0038','FACADE']
];

function socle() {
  creer('DEVIS', [EN_D]);
  creer('LIGNES', [['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE','PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
  creer('COMMERCIAUX', [['NOM','EMAIL','CODE','ACTIF','INITIALES'], ['SIMON LG','simon@test.fr','ab1!','OUI','SLG']]);
  creer('PRESTATAIRES', [['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE']]);
  creer('ADMINS', [['NOM','EMAIL','CODE','ACTIF']]);
  creer('CHANTIERS', [['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE','PRESTATAIRE','STATUT','ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT','PHOTOS','NOTE','CREE_LE','DUREE_PREVUE_MIN','LOT']]);
  creer('ABSENCES', [['PRESTATAIRE','DU','AU']]);
  creer('COMMUNES', [['CP','VILLE','KM','SOURCE','CALCULE_LE'],
    ['56000','VANNES',3,'MAPS',''], ['56400','AURAY',20,'MAPS','']]);
  creer('CATALOGUE', CAT);
  creer('REGLAGES', [['CLE','VALEUR','NOTE'], ['societe_nom','BREIZH BRILLANCE',''],
    ['remise_max','10',''], ['planification_auto','NON',''], ['envoyer_mail_bureau','NON',''],
    ['majoration_tres_sale','30',''], ['taux_horaire_vente','35',''],
    ['majoration_km_bareme','10:0 ; 20:0,70 ; 50:0,80 ; *:0,90',''],
    ['majoration_km_arrondi','0,10',''],
    ['agence_adresse','39 avenue de Verdun, 56000 Vannes','']]);
  creer('JOURNAL', [['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  return charger(CODE_GS);
}

/* Les trois lignes du devis type, sur 108 m². */
const net = (q) => ({ reference:'REF-0036', categorie:'Nettoyage de façade',
  designation:'Nettoyage de façade', qte:q, unite:'m²', pu:14.90, rem:0, tva:10, type:'PONCTUEL' });
const anti = (q) => ({ reference:'REF-0037', categorie:'Nettoyage de façade',
  designation:'Pulvérisation d\'antimousse végétale, non-retour de mousse garanti 2 ans',
  qte:q, unite:'m²', pu:3.90, rem:0, tva:10, type:'PONCTUEL' });
const nacelle = { reference:'REF-0038', categorie:'Nettoyage de façade',
  designation:'Forfait nacelle à la journée', qte:1, unite:'journée(s)', pu:450,
  rem:0, tva:10, type:'PONCTUEL' };
const asp = { reference:'REF-0016', categorie:'Sols', designation:'Aspiration des sols',
  qte:50, unite:'m2', pu:0.15, rem:0, tva:20, type:'MENSUEL' };
const vitInt = (q) => ({ reference:'REF-0031', categorie:'Vitrages et menuiseries',
  designation:'Vitrages intérieurs', qte:q, unite:'m²', pu:4, rem:0, tva:20, type:'PONCTUEL' });

const client = (cp, ville) => ({ type:'PART', societe:'', contact:'Yves Test',
  adresse:'12 rue de la Grée', cp:cp, ville:ville, siret:'', tva:'', tel:'', email:'' });

/* ---------- 1. la nature se reconnaît ---------- */
let g = socle();
T('« FACADE » est une nature', g.natureDevis_('FACADE') === 'FACADE', g.natureDevis_('FACADE'));
T('« façade » avec sa cédille aussi', g.natureDevis_('façade') === 'FACADE', g.natureDevis_('façade'));
T('« Façades » au pluriel aussi', g.natureDevis_('Façades') === 'FACADE', g.natureDevis_('Façades'));
T('les espaces autour ne gênent pas', g.natureDevis_('  FACADE  ') === 'FACADE');
T('l\'entretien n\'a pas bougé', g.natureDevis_('ENTRETIEN') === 'ENTRETIEN');
T('la vitrerie non plus', g.natureDevis_('vitrages') === 'VITRERIE');
T('la remise en état non plus', g.natureDevis_('remise en etat') === 'REMISE');
T('et l\'inconnu reste un chantier', g.natureDevis_('toiture') === 'CHANTIER');
T('la façade a un nom lisible',
  g.natureLisible_('FACADE') === 'Nettoyage de façade', g.natureLisible_('FACADE'));
T('et les quatre autres gardent le leur',
  [g.natureLisible_('ENTRETIEN'), g.natureLisible_('VITRERIE'),
   g.natureLisible_('REMISE'), g.natureLisible_('CHANTIER')].join(' | ') ===
  'Entretien des locaux | Vitrages et menuiseries | Remise en état | Nettoyage de fin de chantier',
  [g.natureLisible_('ENTRETIEN'), g.natureLisible_('VITRERIE'),
   g.natureLisible_('REMISE'), g.natureLisible_('CHANTIER')]);
T('chacun des cinq noms est distinct',
  new Set(['ENTRETIEN','VITRERIE','FACADE','REMISE','CHANTIER'].map(g.natureLisible_)).size === 5);

/* ---------- 2. une façade ne se vend jamais au contrat ---------- */
/* La vitrerie se vend au contrat ou en une fois ; une façade se refait tous
   les quelques années. Aucun nombre de passages ne doit la mensualiser : si
   elle le devenait, le total serait divisé par le mois et la planification
   créerait douze chantiers au lieu d'un. */
T('une façade sans passage est ponctuelle', g.recurrentDevis_('FACADE', 0) === false);
T('à 1 passage, elle l\'est encore', g.recurrentDevis_('FACADE', 1) === false);
T('à 12 passages aussi', g.recurrentDevis_('FACADE', 12) === false);
T('alors qu\'une vitrerie à 1 passage se répète', g.recurrentDevis_('VITRERIE', 1) === true);
T('et qu\'un entretien se répète toujours', g.recurrentDevis_('ENTRETIEN', 0) === true);

/* ---------- 3. le catalogue connaît la nature ---------- */
T('FACADE est une nature de catalogue acceptée',
  g.naturesCatalogue_('FACADE').join(',') === 'FACADE', g.naturesCatalogue_('FACADE'));
T('les cinq natures passent ensemble',
  g.naturesCatalogue_('ENTRETIEN,VITRERIE,FACADE,CHANTIER,REMISE').length === 5,
  g.naturesCatalogue_('ENTRETIEN,VITRERIE,FACADE,CHANTIER,REMISE'));
T('une nature inventée est toujours écartée',
  g.naturesCatalogue_('FACADE,TOITURE').join(',') === 'FACADE',
  g.naturesCatalogue_('FACADE,TOITURE'));
const parRef = (() => { const o = {}; g.lireCatalogue_().forEach(p => { o[p.reference] = p; }); return o; })();
const ref = (r) => parRef[r] || {};
T('les trois prestations de façade sont au catalogue',
  Object.keys(parRef).filter(r => (ref(r).natures || []).indexOf('FACADE') >= 0).length === 3,
  Object.keys(parRef).filter(r => (ref(r).natures || []).indexOf('FACADE') >= 0));
T('le nettoyage est à 14,90 € le m²',
  ref('REF-0036').pu === 14.90 && ref('REF-0036').unite === 'm²', ref('REF-0036'));
T('l\'antimousse à 3,90 € le m²',
  ref('REF-0037').pu === 3.90 && ref('REF-0037').unite === 'm²', ref('REF-0037'));
T('la nacelle est un forfait à 450 € la journée',
  ref('REF-0038').pu === 450 && /journ/.test(ref('REF-0038').unite), ref('REF-0038'));
T('et le nettoyage porte le détail de ses cinq étapes',
  (String(ref('REF-0036').detail).match(/•/g) || []).length === 4, ref('REF-0036').detail);
T('l\'antimousse annonce la garantie de deux ans',
  /garanti 2 ans/.test(ref('REF-0037').designation), ref('REF-0037').designation);

/* ---------- 4. les natures ne se mélangent pas ---------- */
g = socle();
const ctrl = (d) => g.controlerTarifs_(d, g.lireReglages_(), g.lireCommunes_());
const devisType = { nature:'FACADE', passages:0, client:client('56140','Missiriac'),
  lignes:[net(108), anti(108), nacelle] };
T('le devis type, chiffré au catalogue, passe sans réserve',
  ctrl(devisType) === '', ctrl(devisType));
let m = ctrl({ nature:'ENTRETIEN', passages:2, client:client('56000','Vannes'),
               lignes:[asp, net(108)] });
T('du nettoyage de façade sur un entretien est refusé', /ne se vend pas/.test(m), m);
T('et le message nomme la nature du devis', /Entretien des locaux/.test(m), m);
T('et dit où la prestation se vend', /FACADE/.test(m), m);
m = ctrl({ nature:'FACADE', passages:0, client:client('56000','Vannes'),
           lignes:[net(108), asp] });
T('de l\'aspiration sur une façade est refusée aussi', /ne se vend pas/.test(m), m);
T('et le message nomme la façade', /Nettoyage de façade/.test(m), m);
m = ctrl({ nature:'FACADE', passages:0, client:client('56000','Vannes'),
           lignes:[net(108), vitInt(20)] });
T('des vitrages sur une façade sont refusés aussi', /ne se vend pas/.test(m), m);

/* ---------- 5. les prix de la façade restent verrouillés ---------- */
T('un prix bricolé sur le nettoyage est vu',
  /prix 20 au lieu de 14.9/.test(ctrl({ nature:'FACADE', passages:0,
    client:client('56000','Vannes'), lignes:[Object.assign({}, net(108), { pu:20 })] })),
  ctrl({ nature:'FACADE', passages:0, client:client('56000','Vannes'),
    lignes:[Object.assign({}, net(108), { pu:20 })] }));
T('une nacelle bradée est vue aussi',
  /prix 200 au lieu de 450/.test(ctrl({ nature:'FACADE', passages:0,
    client:client('56000','Vannes'), lignes:[Object.assign({}, nacelle, { pu:200 })] })),
  ctrl({ nature:'FACADE', passages:0, client:client('56000','Vannes'),
    lignes:[Object.assign({}, nacelle, { pu:200 })] }));
T('une remise au-delà du plafond est vue',
  /remise/i.test(ctrl({ nature:'FACADE', passages:0, client:client('56000','Vannes'),
    lignes:[Object.assign({}, net(108), { rem:25 })] })),
  ctrl({ nature:'FACADE', passages:0, client:client('56000','Vannes'),
    lignes:[Object.assign({}, net(108), { rem:25 })] }));

/* ---------- 6. l'éloignement vaut aussi pour la façade ---------- */
/* L'équipe part de l'agence de Vannes et y revient. Une façade ne se vend
   qu'en une fois, mais le camion roule quand même : Simon a tranché, elle est
   majorée comme l'entretien et la vitrerie. */
g = socle();
const reg = g.lireReglages_(), communes = g.lireCommunes_();
T('l\'entretien se vend sur un secteur', g.majorableKm_('ENTRETIEN') === true);
T('la vitrerie aussi', g.majorableKm_('VITRERIE') === true);
T('la façade aussi', g.majorableKm_('FACADE') === true);
T('la fin de chantier, non', g.majorableKm_('CHANTIER') === false);
T('la remise en état non plus', g.majorableKm_('REMISE') === false);
const supp = (nature) => g.supplementKm_({ nature:nature, km:20, client:client('56400','Auray') },
                                         reg, communes);
T('une façade à 20 km est majorée', supp('FACADE') > 0, supp('FACADE'));
T('du même montant qu\'un entretien',
  supp('FACADE') === supp('ENTRETIEN'), [supp('FACADE'), supp('ENTRETIEN')]);
T('une remise en état ne l\'est toujours pas', supp('REMISE') === 0, supp('REMISE'));

const catRef = (() => { const o = {}; g.lireCatalogue_().forEach(p => { o[p.reference] = p; }); return o; })();
const taux = (nature, lignes) => g.tauxSupKm_(
  { nature:nature, passages:0, km:20, client:client('56400','Auray'), lignes:lignes },
  reg, catRef, communes);
T('les prix d\'une façade à 20 km sont relevés',
  taux('FACADE', [net(108), anti(108), nacelle]) > 0,
  taux('FACADE', [net(108), anti(108), nacelle]));
T('et la même façade à Vannes, dans la tranche gratuite, ne l\'est pas',
  g.tauxSupKm_({ nature:'FACADE', passages:0, km:3, client:client('56000','Vannes'),
    lignes:[net(108), anti(108), nacelle] }, reg, catRef, communes) === 0,
  g.tauxSupKm_({ nature:'FACADE', passages:0, km:3, client:client('56000','Vannes'),
    lignes:[net(108), anti(108), nacelle] }, reg, catRef, communes));

/* ---------- 7. l'arithmétique du devis type ---------- */
/* Les chiffres du papier relevé, recalculés : s'ils bougent, c'est que le
   catalogue a bougé, et ce n'est pas au banc d'essai de le décider. */
const htType = Math.round((108 * 14.90 + 108 * 3.90 + 450) * 100) / 100;
T('108 m² de nettoyage font 1 609,20 €', Math.round(108 * 14.90 * 100) / 100 === 1609.20);
T('108 m² d\'antimousse font 421,20 €', Math.round(108 * 3.90 * 100) / 100 === 421.20);
T('le total HT du devis type est 2 480,40 €', htType === 2480.40, htType);
T('et son TTC à 10 % est 2 728,44 €',
  Math.round(htType * 1.10 * 100) / 100 === 2728.44, Math.round(htType * 1.10 * 100) / 100);

/* ---------- 8. une façade signée donne une intervention, pas douze ---------- */
let nSerie = 0;
function envoi(nature, passages, lignes) {
  const ht = Math.round(lignes.reduce((s, l) => s + l.qte * l.pu, 0) * 100) / 100;
  const rec = g.recurrentDevis_(nature, passages);
  const tva = Math.round(ht * 0.10 * 100) / 100;
  return { id:'id-' + (++nSerie), appareil:'tel-1', nom:'SIMON LG', code:'ab1!',
    devis: { numero:'DEV-26-10/ PAYE/ SLG-0' + nSerie, date:new Date().toISOString(),
      validite:new Date().toISOString(), commercial:'SIMON LG',
      remise:0, notes:'', signataire:'Yves Test', signature:'x', signeLe:Date.now(),
      nature:nature, passages:passages, km:'', client:client('56140','Missiriac'),
      lignes:lignes,
      totaux:{ ht:ht, tva:tva, ttc:Math.round((ht + tva) * 100) / 100,
               htPonctuel: rec ? 0 : ht, htMensuel: rec ? ht : 0, parTaux:{ 10:tva } } } };
}
function signe(nature, passages, lignes) {
  g = socle();
  g.enregistrer_(envoi(nature, passages, lignes));
  const num = String(lire('DEVIS')[1][0]);
  const f = lire('DEVIS');
  f[1][EN_D.indexOf('STATUT')] = 'SIGNE';
  f[1][EN_D.indexOf('SIGNE')] = 'OUI';
  creer('DEVIS', f);
  g.genererChantiers_(num);
  return lire('CHANTIERS').length - 1;
}
T('une façade signée donne une seule intervention',
  signe('FACADE', 0, [net(108), anti(108), nacelle]) === 1, lire('CHANTIERS').length - 1);
T('même avec un nombre de passages parasite, elle n\'en donne qu\'une',
  signe('FACADE', 4, [net(108), anti(108), nacelle]) === 1, lire('CHANTIERS').length - 1);
const der = lire('DEVIS').slice(1).pop();
T('le devis enregistré porte la nature FACADE',
  der[EN_D.indexOf('NATURE')] === 'FACADE', der[EN_D.indexOf('NATURE')]);
T('et son total est compté en ponctuel, pas en mensuel',
  Number(der[EN_D.indexOf('TOTAL_HT_MENSUEL')]) === 0 &&
  Number(der[EN_D.indexOf('TOTAL_HT_PONCTUEL')]) === 2480.40,
  [der[EN_D.indexOf('TOTAL_HT_PONCTUEL')], der[EN_D.indexOf('TOTAL_HT_MENSUEL')]]);
T('les trois lignes sont au classeur',
  lire('LIGNES').slice(1).filter(l => l[0] === der[0]).length === 3,
  lire('LIGNES').slice(1).filter(l => l[0] === der[0]).map(l => l[3]));
T('le contrôle des tarifs ne signale rien',
  String(der[EN_D.indexOf('CONTROLE_TARIF')] || '').indexOf('VÉRIFIER') < 0,
  der[EN_D.indexOf('CONTROLE_TARIF')]);

console.log('\n=== LA FAÇADE, CINQUIÈME NATURE (v60) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
