/* L'éloignement du client, côté classeur (v52).

   Sur un contrat d'entretien, et sur lui seul, chaque kilomètre au-delà de la
   franchise ajoute des euros au prix d'un passage. La majoration ne s'écrit
   pas sur le devis : elle est fondue dans les prix unitaires.

   C'est ce dernier point qui demande le plus d'attention. Le contrôle des
   tarifs est le garde-fou qui empêche un commercial de bricoler un prix ; en
   relevant les prix, on lui apprend à attendre autre chose que le catalogue.
   S'il devenait trop indulgent, plus rien ne protégerait la grille. Les essais
   ci-dessous vérifient donc les deux sens : le prix relevé passe, et tout
   autre prix est signalé. */
import {creer, lire, charger} from './gs.mjs';
import {CODE_GS} from './chemins.mjs';
const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };

const EN_D=['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','SIRET_CLIENT','TVA_CLIENT','CONTACT',
 'TELEPHONE','EMAIL','ADRESSE','CP','VILLE','TOTAL_HT_PONCTUEL','TOTAL_HT_MENSUEL','TOTAL_HT','TOTAL_TVA',
 'TOTAL_TTC','REMISE_PCT','STATUT','SIGNE','SIGNATAIRE','VALIDITE','LIEN_PDF','PHOTOS','NOTES','RECU_LE',
 'ID_APPAREIL','ID_DEVIS','OBJET','LOGEMENT_PLUS_2_ANS','TAUX_TVA','DELAI','MOTIF_REFUS','RELANCE_LE',
 'DATE_STATUT','PREUVE_SIGNATURE','NOTE_COMMERCIAL','CONTROLE_TARIF','PASSAGES_MOIS','NATURE',
 'DATE_SOUHAITEE','ETAT_SITE','NUMERO_ORIGINE','KM_AGENCE'];
const COM = {nom:'SIMON LG', email:'simon@test.fr'};

function socle(communes = [['56000','VANNES',3,'MAPS',''],
                           ['56250','MONTERBLANC',12,'MAPS',''],
                           ['56400','AURAY',20,'MAPS','']],
               reglages = [['majoration_km_bareme','10:0 ; 20:0,70 ; 50:0,80 ; *:0,90',''],
                           ['majoration_km_arrondi','0,10',''],
                           ['agence_adresse','39 avenue de Verdun, 56000 Vannes','']]){
  creer('DEVIS',[EN_D]);
  creer('LIGNES',[['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE','PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
  creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF','INITIALES'],['SIMON LG','simon@test.fr','ab1!','OUI','SLG']]);
  creer('PRESTATAIRES',[['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE']]);
  creer('ADMINS',[['NOM','EMAIL','CODE','ACTIF']]);
  creer('CHANTIERS',[['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE','PRESTATAIRE','STATUT','ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT','PHOTOS','NOTE','CREE_LE','DUREE_PREVUE_MIN','LOT']]);
  creer('ABSENCES',[['PRESTATAIRE','DU','AU']]);
  creer('COMMUNES',[['CP','VILLE','KM','SOURCE','CALCULE_LE'], ...communes]);
  creer('CATALOGUE',[['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES'],
    ['Sols','Aspiration des sols','','m2',0.15,20,'MENSUEL','OUI','REF-0016','ENTRETIEN'],
    ['Sols','Lavage humide des sols','','m2',0.20,20,'MENSUEL','OUI','REF-0017','ENTRETIEN'],
    ['Vitrerie','Nettoyage de vitres','','m2',3,20,'PONCTUEL','OUI','REF-0001','CHANTIER,REMISE']]);
  creer('REGLAGES',[['CLE','VALEUR','NOTE'],['societe_nom','BREIZH BRILLANCE',''],
    ['remise_max','10',''],['planification_auto','NON',''],['envoyer_mail_bureau','NON',''],
    ['majoration_tres_sale','30',''], ...reglages]);
  creer('JOURNAL',[['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  return charger(CODE_GS);
}

/* 50 m² aspirés + 50 m² lavés = 7,50 + 10,00 = 17,50 € le passage, au catalogue. */
const asp = (pu) => ({reference:'REF-0016', categorie:'Sols', designation:'Aspiration des sols',
  qte:50, unite:'m2', pu:pu, rem:0, tva:20, type:'MENSUEL'});
const lav = (pu) => ({reference:'REF-0017', categorie:'Sols', designation:'Lavage humide des sols',
  qte:50, unite:'m2', pu:pu, rem:0, tva:20, type:'MENSUEL'});
const client = (cp, ville) => ({type:'PRO', societe:'MAIRIE DE PLOEREN', contact:'', adresse:'1 place',
  cp:cp, ville:ville, siret:'', tva:'', tel:'', email:''});
const devisEnt = (cp, ville, km, lignes) => ({
  nature:'ENTRETIEN', passages:4, km:km, client:client(cp, ville),
  lignes:lignes || [asp(0.15), lav(0.20)]
});

/* ---------- 1. la clé d'une commune ---------- */
let g = socle();
T('code postal et ville font la clé', g.cleCommune_('56400','Auray') === '56400 AURAY',
  g.cleCommune_('56400','Auray'));
T('les accents ne comptent pas', g.cleCommune_('56250','Séné') === '56250 SENE', g.cleCommune_('56250','Séné'));
T('les tirets deviennent des espaces',
  g.cleCommune_('56000','Saint-Avé') === '56000 SAINT AVE', g.cleCommune_('56000','Saint-Avé'));
T('les espaces en trop sont retirés',
  g.cleCommune_(' 56000 ','  Vannes  ') === '56000 VANNES', g.cleCommune_(' 56000 ','  Vannes  '));
T('un code postal mal tapé garde ses cinq chiffres',
  g.cleCommune_('56 400','Auray') === '56400 AURAY', g.cleCommune_('56 400','Auray'));
T('rien du tout ne donne pas de clé', g.cleCommune_('','') === '');

/* ---------- 2. la table des communes ---------- */
let c = g.lireCommunes_();
T('la table se lit', c['56400 AURAY'] === 20, c);
T('toutes les communes y sont', Object.keys(c).length === 3, c);
T('une commune connue donne sa distance', g.kmTable_('56400','Auray') === 20);
T('l\'orthographe de la ville n\'empêche rien si le code postal est bon',
  g.kmTable_('56400','auray-sur-mer') === 20, g.kmTable_('56400','auray-sur-mer'));
T('une commune inconnue ne donne rien', g.kmTable_('29000','Quimper') === -1);
T('une ligne sans kilomètre n\'entre pas dans la table', (() => {
  const gg = socle([['56000','VANNES',3,'MAPS',''],['35000','RENNES','','','']]);
  const t = gg.lireCommunes_();
  return !t.hasOwnProperty('35000 RENNES') && t['56000 VANNES'] === 3;
})());

/* ---------- 3. le supplément ---------- */
g = socle();
let reg = g.lireReglages_();
const sup = (d) => g.supplementKm_(d, reg, g.lireCommunes_());
/* Le barème : 10 km gratuits, puis 0,70 € du km jusqu'à 20, 0,80 jusqu'à 50,
   0,90 au-delà. Les tranches se cumulent. */
T('le barème se lit', g.baremeKm_(reg).length === 4, g.baremeKm_(reg));
T('ses tranches sont dans l\'ordre',
  g.baremeKm_(reg).map(x => x.jusqua).join(' ') === '10 20 50 Infinity',
  g.baremeKm_(reg).map(x => x.jusqua));
T('et leurs tarifs lus avec la virgule',
  g.baremeKm_(reg).map(x => x.taux).join(' ') === '0 0.7 0.8 0.9',
  g.baremeKm_(reg).map(x => x.taux));
T('un barème vide ne donne rien', g.baremeKm_({}).length === 0);
T('une tranche mal écrite est ignorée, pas fatale',
  g.baremeKm_({majoration_km_bareme:'10:0 ; bonjour ; 20:0,70'}).length === 2,
  g.baremeKm_({majoration_km_bareme:'10:0 ; bonjour ; 20:0,70'}));
T('l\'étoile vaut « au-delà »',
  (g.baremeKm_({majoration_km_bareme:'*:0,90'})[0] || {}).jusqua === Infinity,
  g.baremeKm_({majoration_km_bareme:'*:0,90'}));
T('le plus aussi',
  (g.baremeKm_({majoration_km_bareme:'+:0,90'})[0] || {}).jusqua === Infinity,
  g.baremeKm_({majoration_km_bareme:'+:0,90'}));
T('sans elle, la dernière tranche du barème de Simon manquerait',
  g.baremeKm_(reg).filter(x => x.jusqua === Infinity).length === 1, g.baremeKm_(reg));
T('les tranches données dans le désordre sont remises en ordre',
  g.baremeKm_({majoration_km_bareme:'50:0,80 ; 10:0 ; *:0,90 ; 20:0,70'})
    .map(x => x.taux).join(' ') === '0 0.7 0.8 0.9',
  g.baremeKm_({majoration_km_bareme:'50:0,80 ; 10:0 ; *:0,90 ; 20:0,70'}).map(x => x.taux));

T('dans les dix premiers kilomètres, rien', sup(devisEnt('56000','Vannes', 3)) === 0);
T('juste à dix, rien non plus', sup(devisEnt('56250','X', 10)) === 0);
T('à 15 km : cinq kilomètres à 0,70 €', sup(devisEnt('56250','X', 15)) === 3.5,
  sup(devisEnt('56250','X', 15)));
T('à 20 km : dix kilomètres à 0,70 €', sup(devisEnt('56400','Auray', 20)) === 7,
  sup(devisEnt('56400','Auray', 20)));
T('à 30 km : 7 € puis dix kilomètres à 0,80 €', sup(devisEnt('56250','X', 30)) === 15,
  sup(devisEnt('56250','X', 30)));
T('à 50 km : 7 € puis trente kilomètres à 0,80 €', sup(devisEnt('56250','X', 50)) === 31,
  sup(devisEnt('56250','X', 50)));
T('à 60 km : et dix de plus à 0,90 €', sup(devisEnt('56250','X', 60)) === 40,
  sup(devisEnt('56250','X', 60)));
T('les demi-kilomètres comptent', sup(devisEnt('56250','X', 12.5)) === 1.75,
  sup(devisEnt('56250','X', 12.5)));

/* Aucun saut aux frontières : c'est tout l'intérêt des tranches cumulées. */
T('passer de 19,9 à 20,1 km ne fait pas bondir le prix',
  Math.abs(sup(devisEnt('56250','X', 20.1)) - sup(devisEnt('56250','X', 19.9))) < 0.2,
  [sup(devisEnt('56250','X', 19.9)), sup(devisEnt('56250','X', 20.1))]);
T('ni de 49,9 à 50,1 km',
  Math.abs(sup(devisEnt('56250','X', 50.1)) - sup(devisEnt('56250','X', 49.9))) < 0.2,
  [sup(devisEnt('56250','X', 49.9)), sup(devisEnt('56250','X', 50.1))]);
T('le supplément ne décroît jamais quand on s\'éloigne', (() => {
  var p0 = -1;
  for(var k = 0; k <= 80; k += 0.5){
    var v = sup(devisEnt('56250','X', k));
    if(v < p0 - 1e-9) return false;
    p0 = v;
  }
  return true;
})());

T('une remise en état n\'est jamais majorée',
  sup(Object.assign(devisEnt('56400','Auray', 20), {nature:'REMISE'})) === 0);
T('une fin de chantier non plus',
  sup(Object.assign(devisEnt('56400','Auray', 20), {nature:'CHANTIER'})) === 0);
T('sans distance au devis, c\'est la table qui parle',
  sup(devisEnt('56400','Auray', '')) === 7, sup(devisEnt('56400','Auray', '')));
T('ni distance ni commune connue : rien', sup(devisEnt('29000','Quimper', '')) === 0);
T('la distance du devis l\'emporte sur la table',
  sup(devisEnt('56400','Auray', 30)) === 15, sup(devisEnt('56400','Auray', 30)));
T('un barème vidé retire la majoration', (() => {
  const gg = socle(undefined, [['majoration_km_bareme','',''],['majoration_km_arrondi','0,10','']]);
  return gg.supplementKm_(devisEnt('56400','Auray', 20), gg.lireReglages_(), gg.lireCommunes_()) === 0;
})());
T('sans tranche ouverte, les kilomètres du bout ne sont pas comptés', (() => {
  const gg = socle(undefined, [['majoration_km_bareme','10:0 ; 20:0,70',''],
                               ['majoration_km_arrondi','0,10','']]);
  return gg.supplementKm_(devisEnt('56250','X', 60), gg.lireReglages_(), gg.lireCommunes_()) === 7;
})());

/* ---------- 4. le supplément et le taux ---------- */
g = socle(); reg = g.lireReglages_();
const sup2 = (d) => g.supplementKm_(d, reg, g.lireCommunes_());
T('le supplément visé à 20 km vaut 7 €',
  sup2(devisEnt('56400','Auray', 20)) === 7, sup2(devisEnt('56400','Auray', 20)));
T('dans la franchise, rien', sup2(devisEnt('56000','Vannes', 3)) === 0);
T('une remise en état n\'est jamais majorée',
  sup2(Object.assign(devisEnt('56400','Auray', 20), {nature:'REMISE'})) === 0);

const cat = {}; g.lireCatalogue_().forEach(p2 => { if(p2.reference) cat[p2.reference] = p2; });
let taux = g.tauxSupKm_(devisEnt('56400','Auray', 20), reg, cat, g.lireCommunes_());
T('le taux vise le passage majoré du supplément',
  Math.abs(17.5 * (1 + taux) - 24.5) < 0.001, [taux, 17.5 * (1 + taux)]);
T('sans supplément, pas de taux',
  g.tauxSupKm_(devisEnt('56000','Vannes', 3), reg, cat, g.lireCommunes_()) === 0);

/* Le pas d'arrondi : au dixième d'euro à partir d'un euro, au centime en
   dessous — sinon un prix au m² bondirait d'un tiers. */
T('un prix d\'un euro et plus s\'arrondit au dixième',
  g.pasArrondi_(4, reg) === 0.1 && g.pasArrondi_(1, reg) === 0.1,
  [g.pasArrondi_(4, reg), g.pasArrondi_(1, reg)]);
T('un prix au m² s\'arrondit au centime',
  g.pasArrondi_(0.15, reg) === 0.01 && g.pasArrondi_(0.99, reg) === 0.01);
T('sans réglage, tout reste au centime', g.pasArrondi_(4, {}) === 0.01);

T('un prix relevé ne traîne jamais plus de deux décimales',
  [0.15, 0.20, 1, 2, 4].every(x => {
    var v = g.prixAttendu_(x, taux, reg);
    return Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
  }), [0.15, 0.20, 1, 2, 4].map(x => g.prixAttendu_(x, taux, reg)));
T('un prix d\'un euro et plus tombe sur un dixième',
  [1, 2, 4].every(x => {
    var v = g.prixAttendu_(x, taux, reg);
    return Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
  }), [1, 2, 4].map(x => g.prixAttendu_(x, taux, reg)));
T('un taux nul laisse le prix du catalogue intact',
  g.prixAttendu_(0.15, 0, reg) === 0.15 && g.prixAttendu_(4, 0, reg) === 4);

/* L'arrondi reprend d'une main ce qu'il donne de l'autre : l'écart doit rester
   petit, et surtout ne pas exploser sur les petits prix. */
T('le passage majoré tombe à quelques dizaines de centimes de la cible', (() => {
  var reel = Math.round((50 * g.prixAttendu_(0.15, taux, reg) +
                         50 * g.prixAttendu_(0.20, taux, reg)) * 100) / 100;
  return Math.abs(reel - 24.5) <= 1;
})(), Math.round((50 * g.prixAttendu_(0.15, taux, reg) +
                 50 * g.prixAttendu_(0.20, taux, reg)) * 100) / 100);

/* ---------- 5. le contrôle des tarifs ---------- */
const ctl = (d) => g.controlerTarifs_(d, reg, g.lireCommunes_());
const releve = (km) => {
  var t = g.tauxSupKm_(devisEnt('56400','Auray', km), reg, cat, g.lireCommunes_());
  return [asp(g.prixAttendu_(0.15, t, reg)), lav(g.prixAttendu_(0.20, t, reg))];
};
T('un entretien éloigné aux prix relevés passe sans rien signaler',
  ctl(devisEnt('56400','Auray', 20, releve(20))) === '',
  ctl(devisEnt('56400','Auray', 20, releve(20))));
let r = ctl(devisEnt('56400','Auray', 20));
T('les prix du catalogue bruts sont refusés sur un client éloigné', /prix 0.15/.test(r), r);
T('et le message dit que l\'éloignement est compris', /éloignement compris/.test(r), r);
T('un devis proche garde les prix du catalogue',
  ctl(devisEnt('56000','Vannes', 3)) === '', ctl(devisEnt('56000','Vannes', 3)));
T('un prix relevé est refusé chez un client proche',
  /prix 0\./.test(ctl(devisEnt('56000','Vannes', 3, releve(20)))),
  ctl(devisEnt('56000','Vannes', 3, releve(20))));
T('un prix inventé reste refusé, éloignement ou pas',
  /prix 0.5/.test(ctl(devisEnt('56400','Auray', 20, [asp(0.5), releve(20)[1]]))),
  ctl(devisEnt('56400','Auray', 20, [asp(0.5), releve(20)[1]])));
T('une remise en état garde les prix du catalogue même loin',
  g.controlerTarifs_({nature:'REMISE', client:client('56400','Auray'), km:20,
    lignes:[{reference:'REF-0001', designation:'Nettoyage de vitres', qte:10, pu:3, rem:0, tva:20}]},
    reg, g.lireCommunes_()) === '');

/* La distance saisie par le commercial contre celle que le classeur connaît. */
r = ctl(devisEnt('56400','Auray', 30, releve(30)));
T('une distance qui s\'écarte de la table est signalée', /distance 30 km au lieu de 20 km/.test(r), r);
r = ctl(devisEnt('56400','Auray', 20.5, releve(20.5)));
T('un demi-kilomètre d\'écart ne dérange personne', !/distance/.test(r), r);
T('une commune inconnue ne déclenche aucun reproche de distance',
  !/distance/.test(g.controlerTarifs_(devisEnt('29000','Quimper', 40,
    [asp(0.15), lav(0.20)]), reg, g.lireCommunes_())),
  g.controlerTarifs_(devisEnt('29000','Quimper', 40, [asp(0.15), lav(0.20)]), reg, g.lireCommunes_()));

/* ---------- 6. ce que le téléphone reçoit ---------- */
g = socle();
let cfg = g.config_({nom:'SIMON LG', initiales:'SLG'});
T('la table des communes part au téléphone', cfg.communes['56400 AURAY'] === 20, cfg.communes);
T('le barème part au téléphone avec les réglages',
  cfg.reglages.majoration_km_bareme === '10:0 ; 20:0,70 ; 50:0,80 ; *:0,90' &&
  cfg.reglages.majoration_km_arrondi === '0,10',
  [cfg.reglages.majoration_km_bareme, cfg.reglages.majoration_km_arrondi]);
T('l\'adresse de l\'agence n\'est pas un secret', !!cfg.reglages.agence_adresse, cfg.reglages.agence_adresse);

/* ---------- 7. l'enregistrement ---------- */
const envoi = (d) => ({id:'id-'+Math.random(), appareil:'tel-1', nom:'SIMON LG', code:'ab1!',
  devis: Object.assign({
    numero:'DEV-26-10/ MAEN/ SLG-01', date:new Date().toISOString(),
    validite:new Date().toISOString(), commercial:'SIMON LG',
    remise:0, notes:'', signataire:'', signature:'', signeLe:0,
    totaux:{ht:106, tva:21.2, ttc:127.2, htPonctuel:0, htMensuel:106, parTaux:{20:21.2}}
  }, d)});

g = socle();
let res = g.enregistrer_(envoi(devisEnt('56400','Auray', 20, releve(20))), COM);
T('le devis est accepté', res.ok === true, res);
let d = lire('DEVIS');
T('la distance est enregistrée', d[1][EN_D.indexOf('KM_AGENCE')] === 20,
  d[1][EN_D.indexOf('KM_AGENCE')]);
T('et rien n\'est signalé au contrôle', !String(d[1][EN_D.indexOf('CONTROLE_TARIF')]),
  d[1][EN_D.indexOf('CONTROLE_TARIF')]);

g = socle();
g.enregistrer_(envoi({nature:'REMISE', passages:0, client:client('56400','Auray'),
  lignes:[{reference:'REF-0001', categorie:'Vitrerie', designation:'Nettoyage de vitres',
           qte:10, unite:'m2', pu:3, rem:0, tva:20, type:'PONCTUEL'}]}), COM);
T('une remise en état n\'enregistre aucune distance',
  String(lire('DEVIS')[1][EN_D.indexOf('KM_AGENCE')]) === '',
  lire('DEVIS')[1][EN_D.indexOf('KM_AGENCE')]);

/* Une commune que la table ne connaît pas y entre, avec le chiffre du
   commercial : le prochain devis n'aura plus à le ressaisir. */
g = socle();
g.enregistrer_(envoi(devisEnt('29000','Quimper', 95,
  releve(95))), COM);
let cm = lire('COMMUNES');
T('la commune inconnue entre dans la table', cm.length === 5, cm.map(x => x[1]));
T('avec la distance saisie', (cm[4]||[])[2] === 95, cm[4]);
T('et l\'on sait d\'où vient le chiffre', (cm[4]||[])[3] === 'COMMERCIAL', cm[4]);
g.enregistrer_(envoi(devisEnt('29000','Quimper', 95,
  releve(95))), COM);
T('un second devis de la même commune ne la redouble pas',
  lire('COMMUNES').length === 5, lire('COMMUNES').map(x => x[1]));
g.enregistrer_(envoi(devisEnt('56400','Auray', 20, releve(20))), COM);
T('une commune déjà connue n\'est pas réécrite',
  lire('COMMUNES').length === 5, lire('COMMUNES').map(x => x[1]));

console.log('\n=== L\'ÉLOIGNEMENT DU CLIENT (v52) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
