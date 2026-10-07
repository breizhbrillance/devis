/* Le devis révisé, côté classeur (v55).

   Un devis déjà reçu revient avec une remise posée après coup. Le serveur
   reconnaît les devis déjà reçus par leur ID_DEVIS et répond « doublon » sans
   rien écrire — c'est ce qui empêche un renvoi de créer deux lignes. Un devis
   révisé emprunte le même chemin : s'il n'était pas traité à part, le bureau
   garderait l'ancien prix, et le tableau de bord comme « À facturer »
   compteraient un montant que le client ne paiera pas.

   Ce que ces essais gardent :
   — la ligne de DEVIS reçoit les nouveaux montants, et une seule ligne ;
   — les LIGNES sont **remplacées**, pas ajoutées : sinon le devis en aurait
     deux jeux et tout serait compté double ;
   — un devis signé ne se révise pas, même si un téléphone le demande ;
   — un renvoi ordinaire, lui, reste un doublon sans effet ;
   — le contrôle des tarifs est refait, et c'est lui qui tient le plafond de
     remise : un téléphone bricolé ne passe pas.
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
 'DATE_SOUHAITEE','ETAT_SITE','NUMERO_ORIGINE','KM_AGENCE','ORIGINE','LIEU_SIGNATURE'];
const EN_L = ['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE','PU_HT',
 'REMISE_PCT','TYPE','TVA','TOTAL_HT'];
const col = (n) => EN_D.indexOf(n);

function socle() {
  creer('DEVIS', [EN_D]);
  creer('LIGNES', [EN_L]);
  creer('COMMERCIAUX', [['NOM','EMAIL','CODE','ACTIF','INITIALES'],
                        ['SIMON LG','simon@test.fr','ab1!','OUI','SLG']]);
  creer('PRESTATAIRES', [['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE']]);
  creer('ADMINS', [['NOM','EMAIL','CODE','ACTIF']]);
  creer('CHANTIERS', [['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE','PRESTATAIRE','STATUT','ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT','PHOTOS','NOTE','CREE_LE','DUREE_PREVUE_MIN','LOT']]);
  creer('ABSENCES', [['PRESTATAIRE','DU','AU']]);
  creer('COMMUNES', [['CP','VILLE','KM','SOURCE','CALCULE_LE'], ['56250','MONTERBLANC',12,'MAPS','']]);
  creer('CATALOGUE', [['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES'],
    ['Vitrerie','Nettoyage de vitres','','m2',2.5,20,'PONCTUEL','OUI','REF-0001','CHANTIER,REMISE']]);
  creer('REGLAGES', [['CLE','VALEUR','NOTE'], ['societe_nom','BREIZH BRILLANCE',''],
    ['remise_max','20',''], ['planification_auto','NON',''], ['envoyer_mail_bureau','NON',''],
    ['majoration_tres_sale','30','']]);
  creer('JOURNAL', [['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  return charger(CODE_GS);
}

const COM = { nom: 'SIMON LG', email: 'simon@test.fr' };

/* 80 m² de vitres à 2,50 € = 200 € HT, 240 € TTC. Une remise de 10 % donne
   180 € HT et 216 € TTC : des chiffres qu'on vérifie de tête. */
function enveloppe(remise, signe, revision) {
  const pu = 2.5, qte = 80;
  const net = Math.round(qte * pu * (1 - remise / 100) * 100) / 100;
  const tva = Math.round(net * 20) / 100;
  return {
    id: 'd-essai-1', appareil: 'tel-1', nom: 'SIMON LG', code: 'ab1!',
    revision: !!revision,
    devis: {
      numero: 'DEV-26-10/ MATE/ SLG-01', date: new Date().toISOString(),
      validite: new Date().toISOString(), commercial: 'SIMON LG',
      remise: remise, notes: '', signataire: signe ? 'Jean Test' : '',
      signature: signe ? 'data:image/png;base64,AAAA' : '', signeLe: signe ? Date.now() : 0,
      nature: 'CHANTIER', passages: 0,
      client: { type:'PRO', societe:'MAIRIE DE TEST', contact:'Jean Test', adresse:'1 rue',
                cp:'56250', ville:'Monterblanc', siret:'', tva:'', tel:'', email:'' },
      lignes: [{ reference:'REF-0001', categorie:'Vitrerie', designation:'Nettoyage de vitres',
                 qte: qte, unite:'m2', pu: pu, rem: remise, tva:20, type:'PONCTUEL' }],
      totaux: { ht: net, tva: tva, ttc: Math.round((net + tva) * 100) / 100,
                htPonctuel: net, htMensuel: 0, brut: 200,
                remise: Math.round((200 - net) * 100) / 100,
                parTaux: { 20: tva }, passages: 1 }
    }
  };
}

/* ---------- 1. le devis d'origine ---------- */
let g = socle();
let r = g.enregistrer_(enveloppe(0, false, false), COM);
T('le devis est reçu', r && r.ok === true && !r.doublon, r);
T('une seule ligne au DEVIS', lire('DEVIS').length === 2, lire('DEVIS').length);
T('à 240 € TTC', lire('DEVIS')[1][col('TOTAL_TTC')] === 240, lire('DEVIS')[1][col('TOTAL_TTC')]);
T('et une ligne de prestation', lire('LIGNES').length === 2, lire('LIGNES').length);

/* ---------- 2. un renvoi ordinaire reste sans effet ---------- */
r = g.enregistrer_(enveloppe(0, false, false), COM);
T('un renvoi à l\'identique est reconnu comme doublon', r && r.doublon === true, r);
T('et n\'ajoute pas de ligne', lire('DEVIS').length === 2, lire('DEVIS').length);

/* ---------- 3. la révision ---------- */
r = g.enregistrer_(enveloppe(10, false, true), COM);
T('le devis révisé n\'est pas pris pour un doublon', r && r.revise === true, r);
T('il garde son numéro', r && r.numero === 'DEV-26-10/ MATE/ SLG-01', r && r.numero);
let d = lire('DEVIS');
T('le DEVIS n\'a toujours qu\'une ligne', d.length === 2, d.length);
T('son total TTC est descendu à 216 €', d[1][col('TOTAL_TTC')] === 216, d[1][col('TOTAL_TTC')]);
T('son HT à 180 €', d[1][col('TOTAL_HT')] === 180, d[1][col('TOTAL_HT')]);
T('sa TVA à 36 €', d[1][col('TOTAL_TVA')] === 36, d[1][col('TOTAL_TVA')]);
T('et la remise est notée : 10 %', Number(d[1][col('REMISE_PCT')]) === 10, d[1][col('REMISE_PCT')]);
T('le contrôle des tarifs ne signale rien',
  !String(d[1][col('CONTROLE_TARIF')]).trim(), d[1][col('CONTROLE_TARIF')]);

let l = lire('LIGNES');
T('les lignes sont remplacées, pas ajoutées', l.length === 2, l.map(x => x[0]));
T('la ligne porte la nouvelle remise', Number(l[1][EN_L.indexOf('REMISE_PCT')]) === 10,
  l[1][EN_L.indexOf('REMISE_PCT')]);
T('et son montant net : 180 €', l[1][EN_L.indexOf('TOTAL_HT')] === 180,
  l[1][EN_L.indexOf('TOTAL_HT')]);
T('sa quantité et son prix n\'ont pas bougé',
  l[1][EN_L.indexOf('QTE')] === 80 && l[1][EN_L.indexOf('PU_HT')] === 2.5, l[1]);
T('le journal garde trace de la révision',
  lire('JOURNAL').some(x => String(x[3]) === 'DEVIS REVISE'),
  lire('JOURNAL').map(x => x[3]));
T('et dit de combien',
  lire('JOURNAL').some(x => String(x[3]) === 'DEVIS REVISE' && /10 %/.test(String(x[4]))),
  lire('JOURNAL').filter(x => String(x[3]) === 'DEVIS REVISE').map(x => x[4]));

/* ---------- 4. réviser deux fois ---------- */
r = g.enregistrer_(enveloppe(20, false, true), COM);
d = lire('DEVIS');
T('une deuxième révision passe aussi', r && r.revise === true, r);
T('le total suit : 192 € TTC', d[1][col('TOTAL_TTC')] === 192, d[1][col('TOTAL_TTC')]);
T('toujours une seule ligne au DEVIS', d.length === 2, d.length);
T('et une seule ligne de prestation', lire('LIGNES').length === 2, lire('LIGNES').length);

/* ---------- 5. le plafond de remise tient ---------- */
g = socle();
g.enregistrer_(enveloppe(0, false, false), COM);
r = g.enregistrer_(enveloppe(40, false, true), COM);
d = lire('DEVIS');
T('une remise au-dessus du plafond est enregistrée mais signalée',
  /remise 40 % au lieu de 20 % maximum/.test(String(d[1][col('CONTROLE_TARIF')])),
  d[1][col('CONTROLE_TARIF')]);
T('et l\'écart est porté au journal',
  lire('JOURNAL').some(x => String(x[3]) === 'ECART TARIF'),
  lire('JOURNAL').map(x => x[3]));

/* ---------- 6. un devis signé ne se révise pas ---------- */
g = socle();
g.enregistrer_(enveloppe(0, false, false), COM);
let f = lire('DEVIS');
f[1][col('SIGNE')] = 'OUI';
f[1][col('STATUT')] = 'SIGNE';
creer('DEVIS', f);
r = g.enregistrer_(enveloppe(10, false, true), COM);
d = lire('DEVIS');
T('la révision d\'un devis signé est refusée', r && r.doublon === true && !r.revise, r);
T('son total n\'a pas bougé', d[1][col('TOTAL_TTC')] === 240, d[1][col('TOTAL_TTC')]);
T('sa remise non plus', Number(d[1][col('REMISE_PCT')]) === 0, d[1][col('REMISE_PCT')]);
T('et rien n\'est noté au journal',
  !lire('JOURNAL').some(x => String(x[3]) === 'DEVIS REVISE'),
  lire('JOURNAL').map(x => x[3]));

/* Même refus quand c'est le devis lui-même qui porte la signature : un
   téléphone pourrait envoyer les deux à la fois. */
g = socle();
g.enregistrer_(enveloppe(0, false, false), COM);
r = g.enregistrer_(enveloppe(10, true, true), COM);
d = lire('DEVIS');
T('un devis qui arrive signé ET révisé est traité comme une signature',
  d[1][col('SIGNE')] === 'OUI', d[1][col('SIGNE')]);
T('et sa remise n\'est pas appliquée par la révision',
  Number(d[1][col('REMISE_PCT')]) === 0, d[1][col('REMISE_PCT')]);

/* ---------- 7. remplacerLignes_ toute seule ---------- */
g = socle();
g.enregistrer_(enveloppe(0, false, false), COM);
T('remplacerLignes_ ne touche pas aux lignes d\'un autre devis', (() => {
  const li = lire('LIGNES');
  li.push(['DEV-AUTRE', 1, 'Vitrerie', 'REF-0001', 'Nettoyage de vitres', '',
           10, 'm2', 2.5, 0, 'PONCTUEL', 20, 25]);
  creer('LIGNES', li);
  g.remplacerLignes_('DEV-26-10/ MATE/ SLG-01', enveloppe(10, false, true).devis);
  const ap = lire('LIGNES');
  return ap.length === 3 && ap.some(x => String(x[0]) === 'DEV-AUTRE');
})(), lire('LIGNES').map(x => x[0]));

console.log('\n=== LE DEVIS RÉVISÉ, CÔTÉ CLASSEUR (v55) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
