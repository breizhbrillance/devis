/* La vitrerie, quatrième nature de devis (v53).

   Jusqu'ici les vitrages se vendaient au milieu d'un entretien : le devis de
   l'ÉTANCHEITE MORBIHANNAISE porte 2 passages par mois de ménage et une
   section « VITRAGES : 1 passage par mois ». Un devis ne portant qu'un nombre
   de passages, le second chiffre était perdu et la planification créait deux
   chantiers de vitres au lieu d'un. D'où la règle : les vitrages font un devis
   à part.

   Ce que ces essais gardent :
   — la nature VITRERIE existe et se reconnaît, écrite au singulier comme au
     pluriel, sans casser les trois autres ;
   — une vitrerie se vend au contrat (passages > 0, total mensualisé, autant de
     chantiers que de passages) ou en une fois (un seul chantier) ;
   — le contrôle des tarifs refuse une ligne de vitrerie sur un entretien, et
     une ligne d'entretien sur une vitrerie. C'est le seul garde-fou : si la
     colonne NATURES cessait d'être lue, le mélange reviendrait en silence ;
   — la majoration d'éloignement reste réservée à l'entretien.
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

/* Le catalogue tel qu'il sera en ligne : six prestations de vitrerie, reprises
   du modèle duplicable « DEVIS NETTOYAGE VITRAGES ET MENUISERIES », et deux
   d'entretien pour éprouver le mélange. REF-0001 est l'ancienne ligne de
   vitres, vendue en fin de chantier et en remise en état : elle reste là où
   elle était. */
const CAT = [
  ['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES'],
  ['Sols','Aspiration des sols','','m2',0.15,20,'MENSUEL','OUI','REF-0016','ENTRETIEN'],
  ['Sols','Lavage humide des sols','','m2',0.20,20,'MENSUEL','OUI','REF-0017','ENTRETIEN'],
  ['Vitrerie','Nettoyage de vitres','','m2',3,20,'PONCTUEL','OUI','REF-0001','CHANTIER,REMISE'],
  ['Vitrages et menuiseries','Mise en place du matériel et sécurisation de la zone d\'intervention','','forfait',10,20,'PONCTUEL','OUI','REF-0030','VITRERIE'],
  ['Vitrages et menuiseries','Vitrages intérieurs','','m²',4,20,'PONCTUEL','OUI','REF-0031','VITRERIE'],
  ['Vitrages et menuiseries','Vitrages extérieurs','','m²',4,20,'PONCTUEL','OUI','REF-0032','VITRERIE'],
  ['Vitrages et menuiseries','Nettoyage des menuiseries, rails et appuis de fenêtre','','m²',5,20,'PONCTUEL','OUI','REF-0033','VITRERIE'],
  ['Vitrages et menuiseries','Dépoussiérage et nettoyage des volets roulants','','m²',3,20,'PONCTUEL','OUI','REF-0034','VITRERIE'],
  ['Vitrages et menuiseries','Nettoyage des vitrages, huisseries, rails et verrières','','forfait',55,20,'PONCTUEL','OUI','REF-0035','VITRERIE']
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

/* Le modèle duplicable, chiffré comme le devis I-26-08-45 : 170 € HT. */
const mise = { reference:'REF-0030', categorie:'Vitrages et menuiseries',
  designation:'Mise en place du matériel et sécurisation de la zone d\'intervention',
  qte:1, unite:'forfait', pu:10, rem:0, tva:20, type:'PONCTUEL' };
const vitInt = (q) => ({ reference:'REF-0031', categorie:'Vitrages et menuiseries',
  designation:'Vitrages intérieurs', qte:q, unite:'m²', pu:4, rem:0, tva:20, type:'PONCTUEL' });
const vitExt = (q) => ({ reference:'REF-0032', categorie:'Vitrages et menuiseries',
  designation:'Vitrages extérieurs', qte:q, unite:'m²', pu:4, rem:0, tva:20, type:'PONCTUEL' });
const asp = { reference:'REF-0016', categorie:'Sols', designation:'Aspiration des sols',
  qte:50, unite:'m2', pu:0.15, rem:0, tva:20, type:'MENSUEL' };

const client = (cp, ville) => ({ type:'PRO', societe:'ETANCHEITE MORBIHANNAISE', contact:'Jean',
  adresse:'4 allée', cp:cp, ville:ville, siret:'', tva:'', tel:'', email:'' });

/* L'enveloppe que le téléphone envoie. Les totaux sont ceux de l'application :
   c'est elle qui décide ce qui est mensuel, le classeur ne fait que recopier.
   Une vitrerie vendue au contrat se mensualise comme un entretien. */
let nSerie = 0;
function envoi(d) {
  const lignes = d.lignes;
  const ht = Math.round(lignes.reduce((s, l) => s + l.qte * l.pu, 0) * 100) / 100;
  const rec = String(d.nature).toUpperCase() === 'ENTRETIEN' ||
              (String(d.nature).toUpperCase() === 'VITRERIE' && Number(d.passages) > 0);
  const tva = Math.round(ht * 0.2 * 100) / 100;
  return { id:'id-' + (++nSerie), appareil:'tel-1', nom:'SIMON LG', code:'ab1!',
    devis: {
      numero:'DEV-26-10/ ETMO/ SLG-0' + nSerie, date:new Date().toISOString(),
      validite:new Date().toISOString(), commercial:'SIMON LG',
      remise:0, notes:'', signataire:'', signature:'', signeLe:0,
      nature:d.nature, passages:d.passages === undefined ? 0 : d.passages,
      km: d.km === undefined ? '' : d.km,
      client: d.client || client('56000','Vannes'), lignes: lignes,
      totaux:{ ht:ht, tva:tva, ttc:Math.round((ht + tva) * 100) / 100,
               htPonctuel: rec ? 0 : ht, htMensuel: rec ? ht : 0, parTaux:{ 20:tva } }
    } };
}

/* ---------- 1. la nature se reconnaît ---------- */
let g = socle();
T('« VITRERIE » est une nature', g.natureDevis_('VITRERIE') === 'VITRERIE', g.natureDevis_('VITRERIE'));
T('« vitrages » au pluriel aussi', g.natureDevis_('vitrages') === 'VITRERIE', g.natureDevis_('vitrages'));
T('« Vitrage » au singulier aussi', g.natureDevis_('Vitrage') === 'VITRERIE', g.natureDevis_('Vitrage'));
T('l\'entretien n\'a pas bougé', g.natureDevis_('ENTRETIEN') === 'ENTRETIEN');
T('la remise en état non plus', g.natureDevis_('remise en etat') === 'REMISE');
T('et l\'inconnu reste un chantier', g.natureDevis_('bonjour') === 'CHANTIER');
T('la vitrerie a un nom lisible',
  g.natureLisible_('VITRERIE') === 'Vitrages et menuiseries', g.natureLisible_('VITRERIE'));
T('chaque nature a le sien',
  [g.natureLisible_('ENTRETIEN'), g.natureLisible_('REMISE'), g.natureLisible_('CHANTIER')]
    .join(' | ') === 'Entretien des locaux | Remise en état | Nettoyage de fin de chantier',
  [g.natureLisible_('ENTRETIEN'), g.natureLisible_('REMISE'), g.natureLisible_('CHANTIER')]);

/* ---------- 2. récurrente ou ponctuelle, au choix ---------- */
T('un entretien se répète toujours', g.recurrentDevis_('ENTRETIEN', 0) === true);
T('même sans passages inscrits', g.recurrentDevis_('ENTRETIEN', '') === true);
T('une vitrerie à 1 passage se répète', g.recurrentDevis_('VITRERIE', 1) === true);
T('une vitrerie à 2 passages aussi', g.recurrentDevis_('VITRERIE', 2) === true);
T('une vitrerie sans passage est ponctuelle', g.recurrentDevis_('VITRERIE', 0) === false);
T('une vitrerie à passages vides aussi', g.recurrentDevis_('VITRERIE', '') === false);
T('un chantier ne se répète jamais', g.recurrentDevis_('CHANTIER', 4) === false);
T('une remise en état non plus', g.recurrentDevis_('REMISE', 4) === false);

/* ---------- 3. le catalogue connaît la nature ---------- */
T('VITRERIE est une nature de catalogue acceptée',
  g.naturesCatalogue_('VITRERIE').join(',') === 'VITRERIE', g.naturesCatalogue_('VITRERIE'));
T('les quatre natures passent',
  g.naturesCatalogue_('ENTRETIEN,VITRERIE,CHANTIER,REMISE').length === 4,
  g.naturesCatalogue_('ENTRETIEN,VITRERIE,CHANTIER,REMISE'));
T('une nature inventée est écartée',
  g.naturesCatalogue_('VITRERIE,PISCINE').join(',') === 'VITRERIE',
  g.naturesCatalogue_('VITRERIE,PISCINE'));
const parRef = (() => { const o = {}; g.lireCatalogue_().forEach(p => { o[p.reference] = p; }); return o; })();
const ref = (r) => parRef[r] || {};
T('les six prestations de vitrerie sont au catalogue',
  Object.keys(parRef).filter(r => (ref(r).natures || []).indexOf('VITRERIE') >= 0).length === 6,
  Object.keys(parRef).filter(r => (ref(r).natures || []).indexOf('VITRERIE') >= 0));
T('la mise en place est un forfait à 10 €',
  ref('REF-0030').pu === 10 && ref('REF-0030').unite === 'forfait', ref('REF-0030'));
T('les vitrages intérieurs sont à 4 € le m²', ref('REF-0031').pu === 4, ref('REF-0031'));
T('les menuiseries à 5 €', ref('REF-0033').pu === 5, ref('REF-0033'));
T('les volets roulants à 3 €', ref('REF-0034').pu === 3, ref('REF-0034'));
T('le forfait tout compris à 55 €', ref('REF-0035').pu === 55, ref('REF-0035'));
T('l\'ancienne ligne de vitres reste au chantier et à la remise',
  (ref('REF-0001').natures || []).join(',') === 'CHANTIER,REMISE', ref('REF-0001'));

/* ---------- 4. les natures ne se mélangent pas ---------- */
g = socle();
const ctrl = (d) => g.controlerTarifs_(d, g.lireReglages_(), g.lireCommunes_());
T('un devis de vitrerie bien chiffré passe',
  ctrl({ nature:'VITRERIE', passages:0, client:client('56000','Vannes'),
         lignes:[mise, vitInt(20), vitExt(20)] }) === '',
  ctrl({ nature:'VITRERIE', passages:0, client:client('56000','Vannes'),
         lignes:[mise, vitInt(20), vitExt(20)] }));
let m = ctrl({ nature:'ENTRETIEN', passages:2, client:client('56000','Vannes'),
               lignes:[asp, vitInt(20)] });
T('des vitrages sur un entretien sont refusés', /ne se vend pas/.test(m), m);
T('et le message nomme la nature du devis', /Entretien des locaux/.test(m), m);
T('et dit où la prestation se vend', /VITRERIE/.test(m), m);
m = ctrl({ nature:'VITRERIE', passages:1, client:client('56000','Vannes'),
           lignes:[mise, asp] });
T('de l\'aspiration sur une vitrerie est refusée aussi', /ne se vend pas/.test(m), m);
T('et le message nomme la vitrerie', /Vitrages et menuiseries/.test(m), m);
T('une prestation de fin de chantier reste refusée sur une vitrerie',
  /ne se vend pas/.test(ctrl({ nature:'VITRERIE', passages:0, client:client('56000','Vannes'),
    lignes:[{ reference:'REF-0001', categorie:'Vitrerie', designation:'Nettoyage de vitres',
              qte:10, unite:'m2', pu:3, rem:0, tva:20, type:'PONCTUEL' }] })),
  ctrl({ nature:'VITRERIE', passages:0, client:client('56000','Vannes'),
    lignes:[{ reference:'REF-0001', categorie:'Vitrerie', designation:'Nettoyage de vitres',
              qte:10, unite:'m2', pu:3, rem:0, tva:20, type:'PONCTUEL' }] }));
T('un prix bricolé sur une vitrerie est toujours vu',
  /prix 6 au lieu de 4/.test(ctrl({ nature:'VITRERIE', passages:0, client:client('56000','Vannes'),
    lignes:[Object.assign({}, vitInt(20), { pu:6 })] })),
  ctrl({ nature:'VITRERIE', passages:0, client:client('56000','Vannes'),
    lignes:[Object.assign({}, vitInt(20), { pu:6 })] }));

/* ---------- 5. l'éloignement vaut aussi pour la vitrerie ---------- */
/* L'équipe part de l'agence de Vannes et y revient : le camion roule autant
   pour un passage de vitres que pour un passage de ménage. Simon a tranché —
   toute vitrerie est majorée, au contrat comme en une seule fois. Un chantier
   et une remise en état, non : ils sont chiffrés au cas par cas. */
g = socle();
let reg = g.lireReglages_(), communes = g.lireCommunes_();
T('l\'entretien se vend sur un secteur', g.majorableKm_('ENTRETIEN') === true);
T('la vitrerie aussi', g.majorableKm_('VITRERIE') === true);
T('la fin de chantier, non', g.majorableKm_('CHANTIER') === false);
T('la remise en état non plus', g.majorableKm_('REMISE') === false);
const supp = (nature) => g.supplementKm_({ nature:nature, km:20, client:client('56400','Auray') },
                                         reg, communes);
T('un entretien à 20 km est majoré', supp('ENTRETIEN') > 0, supp('ENTRETIEN'));
T('une vitrerie à 20 km l\'est du même montant',
  supp('VITRERIE') === supp('ENTRETIEN'), [supp('VITRERIE'), supp('ENTRETIEN')]);
T('une remise en état ne l\'est pas', supp('REMISE') === 0, supp('REMISE'));
T('une fin de chantier non plus', supp('CHANTIER') === 0, supp('CHANTIER'));

/* Le taux de relèvement des prix : c'est lui qui atteint vraiment le devis.
   Il lui faut les lignes et le catalogue, sinon il vaut zéro quoi qu'il arrive
   et l'essai ne prouverait rien. */
const catRef = (() => { const o = {}; g.lireCatalogue_().forEach(p => { o[p.reference] = p; }); return o; })();
const taux = (nature, lignes, passages) => g.tauxSupKm_(
  { nature:nature, passages:passages === undefined ? 0 : passages,
    km:20, client:client('56400','Auray'), lignes:lignes }, reg, catRef, communes);
T('les prix d\'un entretien à 20 km sont relevés',
  taux('ENTRETIEN', [asp]) > 0, taux('ENTRETIEN', [asp]));
T('ceux d\'une vitrerie au contrat aussi',
  taux('VITRERIE', [mise, vitInt(20)], 1) > 0, taux('VITRERIE', [mise, vitInt(20)], 1));
T('et ceux d\'une vitrerie vendue en une fois également',
  taux('VITRERIE', [mise, vitInt(20)], 0) > 0, taux('VITRERIE', [mise, vitInt(20)], 0));
T('une remise en état garde les prix du catalogue',
  taux('REMISE', [{ reference:'REF-0001', categorie:'Vitrerie', designation:'Nettoyage de vitres',
                    qte:10, unite:'m2', pu:3, rem:0, tva:20, type:'PONCTUEL' }]) === 0,
  taux('REMISE', [{ reference:'REF-0001', categorie:'Vitrerie', designation:'Nettoyage de vitres',
                    qte:10, unite:'m2', pu:3, rem:0, tva:20, type:'PONCTUEL' }]));

/* Le contrôle des tarifs doit attendre les prix relevés, et eux seuls : c'est
   lui qui empêche un commercial de bricoler un prix. Trop indulgent, la grille
   ne serait plus protégée. */
const releveVit = () => {
  const t = taux('VITRERIE', [mise, vitInt(20), vitExt(20)], 0);
  return [mise, vitInt(20), vitExt(20)].map(l =>
    Object.assign({}, l, { pu: g.prixAttendu_(l.pu, t, reg) }));
};
T('une vitrerie à 20 km chiffrée aux prix relevés passe',
  ctrl({ nature:'VITRERIE', passages:0, km:20, client:client('56400','Auray'),
         lignes:releveVit() }) === '',
  ctrl({ nature:'VITRERIE', passages:0, km:20, client:client('56400','Auray'),
         lignes:releveVit() }));
T('et chiffrée aux prix du catalogue, elle est signalée',
  /prix .* au lieu de/.test(ctrl({ nature:'VITRERIE', passages:0, km:20,
    client:client('56400','Auray'), lignes:[mise, vitInt(20), vitExt(20)] })),
  ctrl({ nature:'VITRERIE', passages:0, km:20, client:client('56400','Auray'),
         lignes:[mise, vitInt(20), vitExt(20)] }));
T('une distance inventée sur une vitrerie est signalée aussi',
  /distance 95 km au lieu de 20 km/.test(ctrl({ nature:'VITRERIE', passages:0, km:95,
    client:client('56400','Auray'), lignes:releveVit() })),
  ctrl({ nature:'VITRERIE', passages:0, km:95, client:client('56400','Auray'),
         lignes:releveVit() }));
T('la distance d\'une vitrerie est enregistrée', (() => {
  g.enregistrer_(envoi({ nature:'VITRERIE', passages:0, km:20,
    client: client('56400','Auray'), lignes:[mise, vitInt(20)] }));
  return Number(lire('DEVIS')[1][EN_D.indexOf('KM_AGENCE')]) === 20;
})(), lire('DEVIS')[1] && lire('DEVIS')[1][EN_D.indexOf('KM_AGENCE')]);

/* ---------- 6. ce que le classeur enregistre ---------- */
g = socle();
let r = g.enregistrer_(envoi({ nature:'VITRERIE', passages:0,
  lignes:[mise, vitInt(20), vitExt(20)] }));
let d = lire('DEVIS')[1];
T('le devis est enregistré', r && r.ok === true, r);
T('sa nature est la vitrerie', d[EN_D.indexOf('NATURE')] === 'VITRERIE', d[EN_D.indexOf('NATURE')]);
T('une vitrerie ponctuelle compte en ponctuel',
  d[EN_D.indexOf('TOTAL_HT_PONCTUEL')] === 170, d[EN_D.indexOf('TOTAL_HT_PONCTUEL')]);
T('et rien en mensuel', d[EN_D.indexOf('TOTAL_HT_MENSUEL')] === 0, d[EN_D.indexOf('TOTAL_HT_MENSUEL')]);
T('le total est celui du modèle duplicable : 170 € HT',
  d[EN_D.indexOf('TOTAL_HT')] === 170, d[EN_D.indexOf('TOTAL_HT')]);
T('aucun écart de tarif n\'est signalé',
  String(d[EN_D.indexOf('CONTROLE_TARIF')]).indexOf('ne se vend pas') < 0, d[EN_D.indexOf('CONTROLE_TARIF')]);

g = socle();
g.enregistrer_(envoi({ nature:'VITRERIE', passages:1,
  lignes:[{ reference:'REF-0035', categorie:'Vitrages et menuiseries',
            designation:'Nettoyage des vitrages, huisseries, rails et verrières',
            qte:1, unite:'forfait', pu:55, rem:0, tva:20, type:'MENSUEL' }] }));
d = lire('DEVIS')[1];
T('une vitrerie au contrat inscrit ses passages',
  Number(d[EN_D.indexOf('PASSAGES_MOIS')]) === 1, d[EN_D.indexOf('PASSAGES_MOIS')]);
T('et son total compte en mensuel',
  d[EN_D.indexOf('TOTAL_HT_MENSUEL')] === 55, d[EN_D.indexOf('TOTAL_HT_MENSUEL')]);
T('comme la section vitrages du devis I-26-09-8 : 55 € par mois',
  d[EN_D.indexOf('TOTAL_HT')] === 55, d[EN_D.indexOf('TOTAL_HT')]);

/* ---------- 7. les chantiers qui en découlent ---------- */
function signe(nature, passages, lignes) {
  g = socle();
  g.enregistrer_(envoi({ nature:nature, passages:passages, lignes:lignes }));
  const num = String(lire('DEVIS')[1][0]);
  const f = lire('DEVIS');
  f[1][EN_D.indexOf('STATUT')] = 'SIGNE';
  f[1][EN_D.indexOf('SIGNE')] = 'OUI';
  creer('DEVIS', f);
  g.genererChantiers_(num);
  return lire('CHANTIERS').length - 1;
}
T('une vitrerie ponctuelle donne une intervention',
  signe('VITRERIE', 0, [mise, vitInt(20), vitExt(20)]) === 1,
  lire('CHANTIERS').slice(1).map(x => x[7]));
T('une vitrerie à 1 passage par mois donne un chantier',
  signe('VITRERIE', 1, [mise, vitInt(20)]) === 1, lire('CHANTIERS').length - 1);
T('une vitrerie à 2 passages en donne deux',
  signe('VITRERIE', 2, [mise, vitInt(20)]) === 2, lire('CHANTIERS').length - 1);
T('un entretien à 4 passages en donne toujours quatre',
  signe('ENTRETIEN', 4, [asp]) === 4, lire('CHANTIERS').length - 1);

console.log('\n=== LA VITRERIE, QUATRIÈME NATURE (v53) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
