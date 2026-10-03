/* Le numéro d'un devis (v50), côté classeur.

       devis remis     DEV-26-11/ POSK/ SLG-03
       devis signé     DEV-26-12/ POSK/ SLG-01/ S

   Deux choses s'éprouvent ici. D'abord la forme : les lettres du client, les
   initiales, le rang, le suffixe. Ensuite — et c'est le plus important — ce
   qui arrive au reste du classeur quand un devis change de numéro en signant :
   ses lignes et ses chantiers doivent suivre, et un téléphone qui parle encore
   de l'ancien numéro doit être compris. Un devis introuvable après une
   signature, c'est un chantier qui ne naît pas. */
import {creer, lire, charger, horloge} from './gs.mjs';
import {CODE_GS} from './chemins.mjs';
const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };

const EN_D=['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','SIRET_CLIENT','TVA_CLIENT','CONTACT',
 'TELEPHONE','EMAIL','ADRESSE','CP','VILLE','TOTAL_HT_PONCTUEL','TOTAL_HT_MENSUEL','TOTAL_HT','TOTAL_TVA',
 'TOTAL_TTC','REMISE_PCT','STATUT','SIGNE','SIGNATAIRE','VALIDITE','LIEN_PDF','PHOTOS','NOTES','RECU_LE',
 'ID_APPAREIL','ID_DEVIS','OBJET','LOGEMENT_PLUS_2_ANS','TAUX_TVA','DELAI','MOTIF_REFUS','RELANCE_LE',
 'DATE_STATUT','PREUVE_SIGNATURE','NOTE_COMMERCIAL','CONTROLE_TARIF','PASSAGES_MOIS','NATURE',
 'DATE_SOUHAITEE','ETAT_SITE','NUMERO_ORIGINE'];
const EN_C=['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE','PRESTATAIRE','STATUT',
 'ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT','PHOTOS','NOTE','CREE_LE','DUREE_PREVUE_MIN','LOT'];
const COM = {nom:'SIMON LG', email:'simon@test.fr'};

function socle(devis = [], chantiers = []){
  creer('DEVIS',[EN_D, ...devis]);
  creer('LIGNES',[['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE','PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
  creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF'],['SIMON LG','simon@test.fr','ab1!','OUI']]);
  creer('PRESTATAIRES',[['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE']]);
  creer('ADMINS',[['NOM','EMAIL','CODE','ACTIF']]);
  creer('CHANTIERS',[EN_C, ...chantiers]);
  creer('ABSENCES',[['PRESTATAIRE','DU','AU']]);
  creer('CATALOGUE',[['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES'],
    ['Vitrerie','Nettoyage de vitres','','m2',3,20,'PONCTUEL','OUI','REF-0001','CHANTIER,REMISE']]);
  creer('REGLAGES',[['CLE','VALEUR','NOTE'],['societe_nom','BREIZH BRILLANCE',''],
    ['prefixe_devis','DEV',''],['planification_auto','NON',''],['envoyer_mail_bureau','NON','']]);
  creer('JOURNAL',[['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  return charger(CODE_GS);
}

/* ---------- 1. lire et écrire un numéro ---------- */
let g = socle();
let p = g.numeroLire_('DEV-26-11/ POSK/ SLG-03');
T('un numéro de devis remis se lit', !!p, p);
T('on y lit l\'année et le mois', p && p.an === '26' && p.mois === '11', p);
T('les lettres du client', p && p.client === 'POSK', p);
T('les initiales du commercial', p && p.initiales === 'SLG', p);
T('le rang, en nombre', p && p.rang === 3, p);
T('et qu\'il n\'est pas signé', p && p.signe === false, p);
let ps = g.numeroLire_('DEV-26-12/ POSK/ SLG-01/ S');
T('un numéro de devis signé se lit aussi', !!ps && ps.signe === true, ps);
T('son mois est celui de la signature', ps && ps.mois === '12', ps);
T('réécrit, un numéro revient identique',
  g.numeroEcrire_(p) === 'DEV-26-11/ POSK/ SLG-03', g.numeroEcrire_(p));
T('réécrit, un numéro signé revient identique',
  g.numeroEcrire_(ps) === 'DEV-26-12/ POSK/ SLG-01/ S', g.numeroEcrire_(ps));
T('le rang garde ses deux chiffres sous dix',
  g.numeroEcrire_({prefixe:'DEV',an:'26',mois:'01',client:'ABCD',initiales:'SL',rang:7,signe:false})
  === 'DEV-26-01/ ABCD/ SL-07');
T('et s\'allonge au-delà de quatre-vingt-dix-neuf',
  g.numeroEcrire_({prefixe:'DEV',an:'26',mois:'01',client:'ABCD',initiales:'SL',rang:104,signe:false})
  === 'DEV-26-01/ ABCD/ SL-104');

/* Les numéros d'avant ne suivent pas cette forme : il faut le savoir, c'est
   ce qui les protège d'une renumérotation. */
T('un ancien numéro ne se lit pas comme la forme en service',
  g.numeroLire_('DEV-2026-SL-0009') === null);
T('ni un numéro inventé', g.numeroLire_('bonjour') === null);
T('ni un numéro à qui il manque le rang', g.numeroLire_('DEV-26-11/ POSK/ SLG') === null);

/* ---------- 2. les lettres du client ---------- */
T('deux premières et deux dernières lettres', g.lettresClient_('POKESHOP') === 'POOP',
  g.lettresClient_('POKESHOP'));
T('les espaces ne comptent pas', g.lettresClient_('MAIRIE DE PLOEREN') === 'MAEN',
  g.lettresClient_('MAIRIE DE PLOEREN'));
T('les accents non plus', g.lettresClient_('Pôle Santé') === 'POTE', g.lettresClient_('Pôle Santé'));
T('ni la ponctuation', g.lettresClient_("L'ATELIER-DU-PROPRE") === 'LARE',
  g.lettresClient_("L'ATELIER-DU-PROPRE"));
T('ni les chiffres', g.lettresClient_('ETS 2000') === 'ETSX', g.lettresClient_('ETS 2000'));
T('un nom de quatre lettres se retrouve entier', g.lettresClient_('DUPO') === 'DUPO',
  g.lettresClient_('DUPO'));
T('un nom trop court est complété par des X', g.lettresClient_('LE') === 'LEXX', g.lettresClient_('LE'));
T('un nom vide donne quatre X', g.lettresClient_('') === 'XXXX');
T('un nom sans aucune lettre aussi', g.lettresClient_('56 / 2026') === 'XXXX', g.lettresClient_('56 / 2026'));

/* ---------- 3. les initiales du commercial ----------
   Devinées du nom, sauf si la colonne INITIALES de l'onglet COMMERCIAUX en
   impose d'autres : « SIMON LG » donne SL, et Simon veut lire SLG. */
T('les initiales viennent des mots du nom', g.initialesDe_('Simon Le Goff') === 'SLG');
T('trois au plus', g.initialesDe_('Jean Paul Marie Dupont') === 'JPM', g.initialesDe_('Jean Paul Marie Dupont'));
T('un nom sans initiale lisible retombe sur XX', g.initialesDe_('123') === 'XX');
T('« SIMON LG » ne donnerait que SL', g.initialesDe_('SIMON LG') === 'SL', g.initialesDe_('SIMON LG'));
T('la colonne INITIALES l\'emporte', g.initialesDe_('SIMON LG', 'SLG') === 'SLG');
T('elle est mise en capitales et nettoyée', g.initialesDe_('SIMON LG', ' s.l.g ') === 'SLG',
  g.initialesDe_('SIMON LG', ' s.l.g '));
T('vide, elle laisse deviner', g.initialesDe_('Simon Le Goff', '   ') === 'SLG');
T('le commercial lu au classeur porte ses initiales imposées', (() => {
  creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF','INITIALES'],
                       ['SIMON LG','simon@test.fr','ab1!','OUI','SLG']]);
  const l = g.lireCommerciaux_();
  return l.length === 1 && l[0].initiales === 'SLG';
})());
T('et celles de son nom si la colonne est vide', (() => {
  creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF','INITIALES'],
                       ['SIMON LG','simon@test.fr','ab1!','OUI','']]);
  return g.lireCommerciaux_()[0].initiales === 'SL';
})());
T('un onglet sans la colonne marche encore', (() => {
  creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF'],
                       ['SIMON LG','simon@test.fr','ab1!','OUI']]);
  return g.lireCommerciaux_()[0].initiales === 'SL';
})());

/* ---------- 4. la série et les compteurs ---------- */
T('la série ignore le client : c\'est le rang qui rend le numéro unique',
  g.numeroSerie_(g.numeroLire_('DEV-26-11/ POSK/ SLG-03')) === 'DEV-26-11/ SLG',
  g.numeroSerie_(g.numeroLire_('DEV-26-11/ POSK/ SLG-03')));
T('deux clients différents partagent donc la même série',
  g.numeroSerie_(g.numeroLire_('DEV-26-11/ AAAA/ SLG-01')) ===
  g.numeroSerie_(g.numeroLire_('DEV-26-11/ ZZZZ/ SLG-02')));
T('la série signée est à part',
  g.numeroSerie_(g.numeroLire_('DEV-26-11/ POSK/ SLG-03/ S')) === 'DEV-26-11/ SLG/ S');
T('un autre mois est une autre série',
  g.numeroSerie_(g.numeroLire_('DEV-26-12/ POSK/ SLG-01')) === 'DEV-26-12/ SLG');
T('un autre commercial aussi',
  g.numeroSerie_(g.numeroLire_('DEV-26-11/ POSK/ KL-01')) === 'DEV-26-11/ KL');

const L = (num, client) => [num, new Date(), 'SIMON LG', client || 'MAIRIE DE PLOEREN'];
g = socle([L('DEV-26-11/ POSK/ SLG-01'), L('DEV-26-11/ AAAA/ SLG-04'),
           L('DEV-26-11/ BBBB/ KL-02'), L('DEV-26-12/ POSK/ SLG-01/ S'),
           L('DEV-2026-SL-0009')]);
let c = g.compteurs_();
T('le compteur d\'une série retient le plus grand rang', c['DEV-26-11/ SLG'] === 4, c);
T('chaque commercial a le sien', c['DEV-26-11/ KL'] === 2, c);
T('la série signée a le sien', c['DEV-26-12/ SLG/ S'] === 1, c);
T('un ancien numéro n\'entre dans aucune série', Object.keys(c).length === 3, c);

/* ---------- 5. le numéro que prend un devis en signant ---------- */
g = socle([L('DEV-26-11/ POSK/ SLG-01')]);
let reg = g.lireReglages_();
let n = g.numeroSigne_('MAIRIE DE PLOEREN', 'SIMON LG', new Date('2026-12-04T10:00:00'), '', null, reg,
                   'DEV-26-11/ POSK/ SLG-01');
T('il porte le mois de la signature, pas celui du devis', /^DEV-26-12\//.test(n), n);
T('il porte les lettres du client', /\/ MAEN\//.test(n), n);
T('il garde les initiales que portait déjà le devis', /\/ SLG-/.test(n), n);
T('il finit par le suffixe signé', /\/ S$/.test(n), n);
T('et commence au premier rang de la série signée', n === 'DEV-26-12/ MAEN/ SLG-01/ S', n);
T('sans numéro d\'avant lisible, les initiales viennent du nom',
  g.numeroSigne_('MAIRIE DE PLOEREN', 'Simon Le Goff', new Date('2026-12-04T10:00:00'), '', null, reg, 'DEV-2026-SL-0009')
  === 'DEV-26-12/ MAEN/ SLG-01/ S',
  g.numeroSigne_('MAIRIE DE PLOEREN', 'Simon Le Goff', new Date('2026-12-04T10:00:00'), '', null, reg, 'DEV-2026-SL-0009'));

g = socle([L('DEV-26-12/ MAEN/ SLG-01/ S'), L('DEV-26-12/ MAEN/ SLG-02/ S')]);
reg = g.lireReglages_();
n = g.numeroSigne_('MAIRIE DE PLOEREN', 'SIMON LG', new Date('2026-12-04T10:00:00'), '', null, reg,
                   'DEV-26-11/ POSK/ SLG-01');
T('les rangs déjà pris sont sautés', n === 'DEV-26-12/ MAEN/ SLG-03/ S', n);
n = g.numeroSigne_('MAIRIE DE PLOEREN', 'SIMON LG', new Date('2026-12-04T10:00:00'),
                   'DEV-26-12/ MAEN/ SLG-09/ S', null, reg, 'DEV-26-11/ POSK/ SLG-01');
T('le numéro proposé par le téléphone est gardé s\'il est libre',
  n === 'DEV-26-12/ MAEN/ SLG-09/ S', n);
n = g.numeroSigne_('MAIRIE DE PLOEREN', 'SIMON LG', new Date('2026-12-04T10:00:00'),
                   'DEV-26-12/ MAEN/ SLG-02/ S', null, reg, 'DEV-26-11/ POSK/ SLG-01');
T('mais pas s\'il est déjà pris par un autre devis',
  n === 'DEV-26-12/ MAEN/ SLG-03/ S', n);

/* ---------- 6. renommer : tout ce qui désigne le devis suit ---------- */
g = socle([L('DEV-26-11/ POSK/ SLG-01')],
          [['C-1','DEV-26-11/ POSK/ SLG-01','MAIRIE DE PLOEREN'],
           ['C-2','DEV-26-11/ POSK/ SLG-01','MAIRIE DE PLOEREN'],
           ['C-3','DEV-26-11/ AUTRE/ SLG-02','AUTRE CLIENT']]);
lire('LIGNES').push(['DEV-26-11/ POSK/ SLG-01', 1, 'Vitrerie', 'REF-0001', 'Nettoyage de vitres']);
lire('LIGNES').push(['DEV-26-11/ POSK/ SLG-01', 2, 'Vitrerie', 'REF-0001', 'Nettoyage de vitres']);
lire('LIGNES').push(['DEV-26-11/ AUTRE/ SLG-02', 1, 'Vitrerie', 'REF-0001', 'Nettoyage de vitres']);
T('le devis est renommé',
  g.renommerDevis_('DEV-26-11/ POSK/ SLG-01', 'DEV-26-12/ POSK/ SLG-01/ S',
                   'DEV-26-11/ POSK/ SLG-01', 'SIMON LG', 'tel') === true);
let d = lire('DEVIS');
T('la ligne du devis porte le nouveau numéro', d[1][0] === 'DEV-26-12/ POSK/ SLG-01/ S', d[1][0]);
T('et garde l\'ancien dans NUMERO_ORIGINE',
  d[1][EN_D.indexOf('NUMERO_ORIGINE')] === 'DEV-26-11/ POSK/ SLG-01',
  d[1][EN_D.indexOf('NUMERO_ORIGINE')]);
let lg = lire('LIGNES');
T('ses lignes suivent', lg[1][0] === 'DEV-26-12/ POSK/ SLG-01/ S' &&
  lg[2][0] === 'DEV-26-12/ POSK/ SLG-01/ S', [lg[1][0], lg[2][0]]);
T('celles d\'un autre devis ne bougent pas', lg[3][0] === 'DEV-26-11/ AUTRE/ SLG-02', lg[3][0]);
let ch = lire('CHANTIERS');
T('ses chantiers suivent', ch[1][1] === 'DEV-26-12/ POSK/ SLG-01/ S' &&
  ch[2][1] === 'DEV-26-12/ POSK/ SLG-01/ S', [ch[1][1], ch[2][1]]);
T('ceux d\'un autre devis ne bougent pas', ch[3][1] === 'DEV-26-11/ AUTRE/ SLG-02', ch[3][1]);
let j = lire('JOURNAL');
T('le journal garde la trace du changement',
  j.some(r => String(r[3]) === 'NUMERO CHANGE' && /DEV-26-11\/ POSK\/ SLG-01/.test(String(r[4]))),
  j.map(r => [r[3], r[4]]));
T('un devis inconnu ne se renomme pas',
  g.renommerDevis_('DEV-26-11/ RIEN/ SLG-09', 'DEV-26-12/ RIEN/ SLG-09/ S') === false);
T('un renommage sur place ne fait rien',
  g.renommerDevis_('DEV-26-12/ POSK/ SLG-01/ S', 'DEV-26-12/ POSK/ SLG-01/ S') === false);

/* ---------- 7. retrouver un devis par son ancien numéro ---------- */
T('le bureau retrouve le devis renommé par son ancien numéro',
  g.majDevis_('DEV-26-11/ POSK/ SLG-01', {NOTE_COMMERCIAL:'retrouvé'}) === true);
T('et c\'est bien la bonne ligne qu\'il écrit',
  lire('DEVIS')[1][EN_D.indexOf('NOTE_COMMERCIAL')] === 'retrouvé',
  lire('DEVIS')[1][EN_D.indexOf('NOTE_COMMERCIAL')]);
T('un numéro qui n\'a jamais existé reste introuvable',
  g.majDevis_('DEV-26-11/ ZZZZ/ SLG-77', {NOTE_COMMERCIAL:'x'}) === false);

/* ---------- 8. le résultat « signé » renomme le devis ---------- */
function socleStatut(){
  const gg = socle([L('DEV-26-11/ POSK/ SLG-01')]);
  lire('DEVIS')[1][EN_D.indexOf('STATUT')] = 'REMIS';
  lire('DEVIS')[1][EN_D.indexOf('NATURE')] = 'CHANTIER';
  lire('LIGNES').push(['DEV-26-11/ POSK/ SLG-01', 1, 'Vitrerie', 'REF-0001', 'Nettoyage de vitres',
                       '', 50, 'm2', 3, 0, 'PONCTUEL', 20, 150]);
  return gg;
}
horloge('2026-12-04T09:00:00');
g = socleStatut();
let r = g.enregistrerStatut_({numero:'DEV-26-11/ POSK/ SLG-01', verdict:'SIGNE',
                              quand:new Date('2026-12-04T10:00:00').getTime()}, COM);
T('le devis est accepté', r.ok === true, r);
T('le classeur rend le nouveau numéro', r.numero === 'DEV-26-12/ MAEN/ SLG-01/ S', r);
T('il dit aussi lequel était l\'ancien', r.numeroOrigine === 'DEV-26-11/ POSK/ SLG-01', r);
d = lire('DEVIS');
T('la ligne porte le numéro signé', d[1][0] === 'DEV-26-12/ MAEN/ SLG-01/ S', d[1][0]);
T('le statut est bien passé à SIGNE', d[1][EN_D.indexOf('STATUT')] === 'SIGNE');
T('les lignes du devis ont suivi', lire('LIGNES')[1][0] === 'DEV-26-12/ MAEN/ SLG-01/ S',
  lire('LIGNES')[1][0]);
T('les chantiers sont nés sous le nouveau numéro',
  lire('CHANTIERS').slice(1).every(c2 => c2[1] === 'DEV-26-12/ MAEN/ SLG-01/ S'),
  lire('CHANTIERS').slice(1).map(c2 => c2[1]));
T('et il y en a', lire('CHANTIERS').length > 1, lire('CHANTIERS').length);

/* Le téléphone peut renvoyer le résultat : il parle encore de l'ancien numéro. */
r = g.enregistrerStatut_({numero:'DEV-26-11/ POSK/ SLG-01', verdict:'SIGNE',
                          quand:new Date('2026-12-04T10:00:00').getTime()}, COM);
T('un renvoi avec l\'ancien numéro est compris', r.ok === true, r);
T('et ne renomme pas une deuxième fois', lire('DEVIS')[1][0] === 'DEV-26-12/ MAEN/ SLG-01/ S',
  lire('DEVIS')[1][0]);
T('le classeur ne compte pas deux fois les chantiers', r.chantiers === 0, r);

/* ---------- 9. un devis qui n'est plus signé reprend son numéro ---------- */
r = g.enregistrerStatut_({numero:'DEV-26-12/ MAEN/ SLG-01/ S', verdict:'REFUSE',
                          motif:'Trop cher', quand:Date.now()}, COM);
T('le refus est enregistré', r.ok === true, r);
T('le devis reprend le numéro d\'avant la signature',
  r.numero === 'DEV-26-11/ POSK/ SLG-01', r);
d = lire('DEVIS');
T('la ligne aussi', d[1][0] === 'DEV-26-11/ POSK/ SLG-01', d[1][0]);
T('et NUMERO_ORIGINE est vidé', !String(d[1][EN_D.indexOf('NUMERO_ORIGINE')] || ''),
  d[1][EN_D.indexOf('NUMERO_ORIGINE')]);
T('ses chantiers annulés ont suivi le retour',
  lire('CHANTIERS').slice(1).every(c2 => c2[1] === 'DEV-26-11/ POSK/ SLG-01'),
  lire('CHANTIERS').slice(1).map(c2 => c2[1]));
T('et ils sont bien annulés',
  lire('CHANTIERS').slice(1).every(c2 => String(c2[EN_C.indexOf('STATUT')]) === 'ANNULE'),
  lire('CHANTIERS').slice(1).map(c2 => c2[EN_C.indexOf('STATUT')]));

/* ---------- 10. les anciens numéros ne sont pas renumérotés ---------- */
g = socle([['DEV-2026-SL-0009', new Date(), 'SIMON LG', 'MAIRIE DE PLOEREN']]);
lire('DEVIS')[1][EN_D.indexOf('STATUT')] = 'REMIS';
lire('DEVIS')[1][EN_D.indexOf('NATURE')] = 'CHANTIER';
r = g.enregistrerStatut_({numero:'DEV-2026-SL-0009', verdict:'SIGNE', quand:Date.now()}, COM);
T('un devis d\'avant la règle est signé sans changer de numéro',
  r.ok === true && lire('DEVIS')[1][0] === 'DEV-2026-SL-0009', [r, lire('DEVIS')[1][0]]);
T('et le classeur ne prétend pas l\'avoir renommé', !r.numeroOrigine, r);

/* ---------- 11. un numéro déjà pris est décalé à l'enregistrement ---------- */
const devisEnvoye = (numero, id, client) => ({
  id: id, appareil:'tel-1', nom:'SIMON LG', code:'ab1!',
  devis:{ numero:numero, date:new Date().toISOString(), validite:new Date().toISOString(),
    commercial:'SIMON LG', nature:'CHANTIER',
    client:{type:'PRO', societe: client || 'MAIRIE DE PLOEREN', contact:'', adresse:'1 rue',
            cp:'56880', ville:'Ploeren', siret:'', tva:'', tel:'', email:''},
    lignes:[{reference:'REF-0001', categorie:'Vitrerie', designation:'Nettoyage de vitres',
             qte:50, unite:'m2', pu:3, rem:0, tva:20, type:'PONCTUEL'}],
    remise:0, notes:'', signataire:'', signature:'', signeLe:0,
    totaux:{ht:150, tva:30, ttc:180, htPonctuel:150, htMensuel:0, parTaux:{20:30}} }
});
g = socle();
g.enregistrer_(devisEnvoye('DEV-26-11/ MAEN/ SLG-01', 'id-1'), COM);
r = g.enregistrer_(devisEnvoye('DEV-26-11/ MAEN/ SLG-01', 'id-2'), COM);
T('deux devis différents ne gardent pas le même numéro',
  r.numero === 'DEV-26-11/ MAEN/ SLG-02', r);
T('le mois et le client ne bougent pas pour autant', /^DEV-26-11\/ MAEN\//.test(r.numero), r);
T('le devis renuméroté note le numéro imprimé chez le client',
  /DEV-26-11\/ MAEN\/ SLG-01/.test(String(lire('DEVIS')[2][EN_D.indexOf('NOTES')])),
  lire('DEVIS')[2][EN_D.indexOf('NOTES')]);
T('le même devis renvoyé deux fois ne crée pas de ligne de plus',
  g.enregistrer_(devisEnvoye('DEV-26-11/ MAEN/ SLG-01', 'id-1'), COM).doublon === true &&
  lire('DEVIS').length === 3, lire('DEVIS').length);

/* ---------- 12. le devis qui revient signé ---------- */
g = socle();
g.enregistrer_(devisEnvoye('DEV-26-11/ MAEN/ SLG-01', 'id-1'), COM);
let envoi = devisEnvoye('DEV-26-12/ MAEN/ SLG-01/ S', 'id-1');
envoi.devis.signature = 'data:image/png;base64,AA';
envoi.devis.signataire = 'Mme Le Gall';
envoi.devis.signeLe = new Date('2026-12-04T10:00:00').getTime();
r = g.enregistrer_(envoi, COM);
T('le devis signé qui revient est reconnu', r.signe === true, r);
T('il prend le numéro signé que le téléphone a imprimé',
  r.numero === 'DEV-26-12/ MAEN/ SLG-01/ S', r);
T('le classeur rappelle d\'où il vient', r.numeroOrigine === 'DEV-26-11/ MAEN/ SLG-01', r);
d = lire('DEVIS');
T('une seule ligne pour ce devis', d.length === 2, d.length);
T('elle porte le numéro signé', d[1][0] === 'DEV-26-12/ MAEN/ SLG-01/ S', d[1][0]);
T('et l\'ancien dans NUMERO_ORIGINE',
  d[1][EN_D.indexOf('NUMERO_ORIGINE')] === 'DEV-26-11/ MAEN/ SLG-01',
  d[1][EN_D.indexOf('NUMERO_ORIGINE')]);
T('ses lignes ont suivi', lire('LIGNES')[1][0] === 'DEV-26-12/ MAEN/ SLG-01/ S',
  lire('LIGNES')[1][0]);

/* Deux téléphones peuvent proposer le même numéro signé le même mois. */
g = socle();
g.enregistrer_(devisEnvoye('DEV-26-11/ MAEN/ SLG-01', 'id-1'), COM);
g.enregistrer_(devisEnvoye('DEV-26-11/ MAEN/ SLG-02', 'id-2'), COM);
const sig = (id) => { const e = devisEnvoye('DEV-26-12/ MAEN/ SLG-01/ S', id);
  e.devis.signature = 'data:image/png;base64,AA';
  e.devis.signeLe = new Date('2026-12-04T10:00:00').getTime(); return e; };
g.enregistrer_(sig('id-1'), COM);
r = g.enregistrer_(sig('id-2'), COM);
T('le second devis signé ne vole pas le numéro du premier',
  r.numero === 'DEV-26-12/ MAEN/ SLG-02/ S', r);
T('les deux lignes portent deux numéros différents',
  lire('DEVIS')[1][0] !== lire('DEVIS')[2][0],
  [lire('DEVIS')[1][0], lire('DEVIS')[2][0]]);

/* ---------- 13. le numéro dans un nom de fichier ---------- */
T('les barres deviennent des tirets',
  g.numeroFichier_('DEV-26-11/ POSK/ SLG-03') === 'DEV-26-11-POSK-SLG-03',
  g.numeroFichier_('DEV-26-11/ POSK/ SLG-03'));
T('le suffixe signé aussi',
  g.numeroFichier_('DEV-26-12/ POSK/ SLG-01/ S') === 'DEV-26-12-POSK-SLG-01-S',
  g.numeroFichier_('DEV-26-12/ POSK/ SLG-01/ S'));
T('il ne reste aucune espace', !/\s/.test(g.numeroFichier_('DEV-26-12/ POSK/ SLG-01/ S')));
T('un ancien numéro traverse sans rien perdre',
  g.numeroFichier_('DEV-2026-SL-0009') === 'DEV-2026-SL-0009');

horloge(null);
console.log('\n=== LE NUMÉRO DU DEVIS (v50) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
