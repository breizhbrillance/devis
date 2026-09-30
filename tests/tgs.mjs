import {creer, lire, charger, courriers} from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };
const j=(n)=>{ const d=new Date(); d.setDate(d.getDate()+n); d.setHours(0,0,0,0); return d; };

const EN_D=['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','SIRET_CLIENT','TVA_CLIENT','CONTACT',
 'TELEPHONE','EMAIL','ADRESSE','CP','VILLE','TOTAL_HT_PONCTUEL','TOTAL_HT_MENSUEL','TOTAL_HT','TOTAL_TVA',
 'TOTAL_TTC','REMISE_PCT','STATUT','SIGNE','SIGNATAIRE','VALIDITE','LIEN_PDF','PHOTOS','NOTES','RECU_LE',
 'ID_APPAREIL','ID_DEVIS','OBJET','LOGEMENT_PLUS_2_ANS','TAUX_TVA','DELAI','MOTIF_REFUS','RELANCE_LE',
 'DATE_STATUT','PREUVE_SIGNATURE','NOTE_COMMERCIAL'];
const L=(o)=>EN_D.map(h=>o[h]!==undefined?o[h]:'');
creer('DEVIS',[EN_D,
 L({NUMERO:'DEV-2026-SL-0001',DATE:j(-10),COMMERCIAL:'SIMON LG',CLIENT:'SYNDIC ARMOR',TYPE_CLIENT:'PROFESSIONNEL',
    SIRET_CLIENT:'812 345 678 00019',TVA_CLIENT:'FR25812345678',EMAIL:'a@b.fr',TELEPHONE:'0600',
    TOTAL_HT:1000,TOTAL_HT_MENSUEL:1000,TOTAL_TVA:200,TOTAL_TTC:1200,STATUT:'SIGNE',TAUX_TVA:20,
    VALIDITE:j(20),DATE_STATUT:j(-9),LIEN_PDF:'https://drive/1',PREUVE_SIGNATURE:''}),
 L({NUMERO:'DEV-2026-SL-0002',DATE:j(-8),COMMERCIAL:'SIMON LG',CLIENT:'MME POLLARD',TYPE_CLIENT:'PARTICULIER',
    TOTAL_HT:500,TOTAL_TVA:50,TOTAL_TTC:550,STATUT:'A RELANCER',TAUX_TVA:10,VALIDITE:j(22),
    RELANCE_LE:j(-1),TELEPHONE:'0611'}),
 L({NUMERO:'DEV-2026-SL-0003',DATE:j(-40),COMMERCIAL:'SIMON LG',CLIENT:'CABINET X',
    TOTAL_HT:800,TOTAL_TVA:160,TOTAL_TTC:960,STATUT:'REMIS',TAUX_TVA:20,VALIDITE:j(-10)}),
 L({NUMERO:'DEV-2026-LM-0001',DATE:j(-5),COMMERCIAL:'LEA M',CLIENT:'BOULANGERIE',
    TOTAL_HT:300,TOTAL_TVA:60,TOTAL_TTC:360,STATUT:'REFUSE',TAUX_TVA:20,VALIDITE:j(25),
    MOTIF_REFUS:'Trop cher',DATE_STATUT:j(-4)}),
 L({NUMERO:'DEV-2026-LM-0002',DATE:j(-4),COMMERCIAL:'LEA M',CLIENT:'GARAGE DU PORT',
    TOTAL_HT:200,TOTAL_TVA:40,TOTAL_TTC:240,STATUT:'REMIS',TAUX_TVA:20,VALIDITE:j(26)}),
 L({NUMERO:'DEV-2026-LM-0003',DATE:j(-3),COMMERCIAL:'LEA M',CLIENT:'EHPAD LES PINS',
    TOTAL_HT:2000,TOTAL_HT_MENSUEL:2000,TOTAL_TVA:400,TOTAL_TTC:2400,STATUT:'SIGNE',TAUX_TVA:20,
    VALIDITE:j(27),DATE_STATUT:j(-2),PREUVE_SIGNATURE:'https://drive/signe'})]);

const EN_L=['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE','PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT'];
creer('LIGNES',[EN_L,
 ['DEV-2026-SL-0001',1,'Bureaux','B01','Nettoyage de bureaux','3 passages/semaine',100,'m²/mois',10,0,'MENSUEL',20,1000],
 ['DEV-2026-LM-0003',1,'Santé','S01','Entretien complet','7j/7',1,'forfait',2000,0,'MENSUEL',20,2000],
 ['DEV-2026-LM-0003',2,'Vitrerie','V01','Vitrerie extérieure','',50,'m²',3,10,'PONCTUEL',20,135]]);

creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF'],
 ['SIMON LG','simon@test.fr','ab1!','OUI'],['LEA M','lea@test.fr','cd2#','OUI']]);
creer('REGLAGES',[['CLE','VALEUR','NOTE'],
 ['societe_nom','BREIZH BRILLANCE',''],['rappel_sans_resultat_jours','2',''],
 ['recap_email','gerant@test.fr',''],['recap_jour', String(new Date().getDay()||7),'']]);
creer('JOURNAL',[['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);

const g = charger(CODE_GS);

// 1. À FACTURER
const n = g.majAFacturer_();
const f = lire('A FACTURER');
const enF = f[0], row = (num)=>f.slice(1).find(r=>r[enF.indexOf('NUMERO')]===num);
T('À facturer : seuls les devis signés', n===2 && f.length===3, {n, lignes:f.length-1});
const r3 = row('DEV-2026-LM-0003');
T('À facturer : totaux repris', r3 && r3[enF.indexOf('TOTAL_HT')]===2000 && r3[enF.indexOf('TOTAL_TTC')]===2400);
T('À facturer : prestations resaisissables',
  r3 && /Entretien complet/.test(r3[enF.indexOf('PRESTATIONS')]) &&
        /50 m² × Vitrerie extérieure/.test(r3[enF.indexOf('PRESTATIONS')]) &&
        /− 10 %/.test(r3[enF.indexOf('PRESTATIONS')]), r3&&r3[enF.indexOf('PRESTATIONS')]);
T('À facturer : lien du devis signé', r3 && r3[enF.indexOf('DEVIS_SIGNE')]==='https://drive/signe');
T('À facturer : SIRET et TVA du client repris',
  row('DEV-2026-SL-0001')[enF.indexOf('TVA_CLIENT')]==='FR25812345678');
T('À facturer : case FACTURE décochée au départ', row('DEV-2026-SL-0001')[enF.indexOf('FACTURE')]===false);

// 2. la case cochée survit à un rafraîchissement
f[1][enF.indexOf('FACTURE')] = true;
const numCoche = f[1][enF.indexOf('NUMERO')];
g.majAFacturer_();
const f2 = lire('A FACTURER'), row2=(num)=>f2.slice(1).find(r=>r[enF.indexOf('NUMERO')]===num);
T('À facturer : la case cochée est conservée', row2(numCoche)[enF.indexOf('FACTURE')]===true);

// 3. expiration
const exp = g.expirer_();
const d = lire('DEVIS'), cS=EN_D.indexOf('STATUT');
const dev=(num)=>d.slice(1).find(r=>r[0]===num);
T('expire : le devis périmé sans réponse passe à EXPIRE',
  exp===1 && dev('DEV-2026-SL-0003')[cS]==='EXPIRE', {exp});
T('expire : un devis signé n\'est jamais touché', dev('DEV-2026-SL-0001')[cS]==='SIGNE');
T('expire : un devis refusé n\'est jamais touché', dev('DEV-2026-LM-0001')[cS]==='REFUSE');
T('expire : une relance encore valable reste à relancer', dev('DEV-2026-SL-0002')[cS]==='A RELANCER');

// 4. ce que chacun doit faire
const t = g.aFaireParCommercial_();
T('à faire : relance échue signalée', t['SIMON LG'].relances.length===1 &&
  /DEV-2026-SL-0002/.test(t['SIMON LG'].relances[0]));
T('à faire : devis signé sans photo du papier signalé',
  t['SIMON LG'].sansPreuve.length===1 && t['LEA M'].sansPreuve.length===0);
T('à faire : devis remis sans résultat signalé',
  t['LEA M'].sansResultat.length===1 && /GARAGE/.test(t['LEA M'].sansResultat[0]));

// 5. tableau de bord
g.majTableauDeBord_();
const b = lire('TABLEAU DE BORD').map(l=>l.map(x=>String(x)));
const val=(lib)=>{ const l=b.find(r=>r[0]===lib); return l?l[1]:null; };
T('bord : nombre de devis', val('Devis établis')==='6', val('Devis établis'));
T('bord : devis signés', val('Devis signés')==='2');
T('bord : taux de transformation', val('Taux de transformation')==='33.3 %', val('Taux de transformation'));
T('bord : récurrent mensuel signé',
  b.some(r=>r[3]==='Récurrent mensuel HT signé' && r[4]==='3000'), b.find(r=>r[3]==='Récurrent mensuel HT signé'));
T('bord : motif de refus compté', b.some(r=>r[0]==='Trop cher' && r[1]==='1'));
T('bord : ligne par commercial', b.some(r=>r[0]==='LEA M' && r[1]==='3' && r[2]==='1'));

// 6. rappels : aux commerciaux et au gérant, jamais au client
g.automateQuotidien();
const m = courriers();
const dests = m.map(x=>x.to);
T('rappel : un message par commercial concerné', dests.includes('simon@test.fr') && dests.includes('lea@test.fr'));
T('rappel : récapitulatif au gérant', dests.includes('gerant@test.fr'));
T('rappel : aucun message à un client', !dests.some(x=>/a@b\.fr/.test(x)), dests);
const mSimon = m.find(x=>x.to==='simon@test.fr');
T('rappel : contenu utile pour Simon',
  /RELANCER/.test(mSimon.body) && /DEV-2026-SL-0002/.test(mSimon.body) &&
  /PHOTO DU PAPIER/.test(mSimon.body), mSimon&&mSimon.body);

// 7. résultat reçu du téléphone
const res = g.enregistrerStatut_({numero:'DEV-2026-LM-0002', verdict:'REFUSE', motif:'Concurrent',
                                  quand:Date.now()}, {nom:'LEA M'});
const d3 = lire('DEVIS');
const l2 = d3.slice(1).find(r=>r[0]==='DEV-2026-LM-0002');
T('résultat : refus enregistré', res.ok && l2[cS]==='REFUSE' &&
  l2[EN_D.indexOf('MOTIF_REFUS')]==='Concurrent', res);
T('résultat : date du statut posée', l2[EN_D.indexOf('DATE_STATUT')] instanceof Date);
const res2 = g.enregistrerStatut_({numero:'DEV-2026-LM-0002', verdict:'SIGNE', quand:Date.now()}, {nom:'LEA M'});
const l2b = lire('DEVIS').slice(1).find(r=>r[0]==='DEV-2026-LM-0002');
T('résultat : correction possible, motif effacé',
  res2.ok && l2b[cS]==='SIGNE' && l2b[EN_D.indexOf('MOTIF_REFUS')]==='' &&
  l2b[EN_D.indexOf('SIGNE')]==='OUI');
T('résultat : un devis inconnu est refusé, pas inventé',
  g.enregistrerStatut_({numero:'DEV-INEXISTANT', verdict:'SIGNE'},{nom:'LEA M'}).ok===false);
T('résultat : un verdict inconnu est refusé',
  g.enregistrerStatut_({numero:'DEV-2026-LM-0002', verdict:'PEUT-ETRE'},{nom:'LEA M'}).ok===false);
const journal = lire('JOURNAL').slice(1).map(r=>r[3]);
T('journal : les résultats et l\'automate sont tracés',
  journal.some(a=>/RESULTAT REFUSE/.test(a)) && journal.some(a=>/DEVIS EXPIRE/.test(a)) &&
  journal.some(a=>/AUTOMATE QUOTIDIEN/.test(a)), journal);

// 8. la note du commercial
const rn = g.enregistrerStatut_({numero:'DEV-2026-SL-0001', note:'Gardien joignable le matin.'}, {nom:'SIMON LG'});
const dn = lire('DEVIS').slice(1).find(r=>r[0]==='DEV-2026-SL-0001');
T('note seule acceptée sans résultat', rn.ok && dn[EN_D.indexOf('NOTE_COMMERCIAL')]==='Gardien joignable le matin.', rn);
T('note seule ne touche pas au statut', dn[cS]==='SIGNE', dn[cS]);
const rn2 = g.enregistrerStatut_({numero:'DEV-2026-SL-0001', verdict:'REFUSE', motif:'Trop cher',
                                  note:'Revoir au printemps.', quand:Date.now()}, {nom:'SIMON LG'});
const dn2 = lire('DEVIS').slice(1).find(r=>r[0]==='DEV-2026-SL-0001');
T('résultat + note ensemble', rn2.ok && dn2[cS]==='REFUSE' &&
  dn2[EN_D.indexOf('NOTE_COMMERCIAL')]==='Revoir au printemps.', dn2[EN_D.indexOf('NOTE_COMMERCIAL')]);
T('ni résultat ni note : refusé',
  g.enregistrerStatut_({numero:'DEV-2026-SL-0001'},{nom:'SIMON LG'}).ok===false);
g.majAFacturer_();
const f3 = lire('A FACTURER');
T('« À facturer » porte une colonne note', f3[0].includes('NOTE_COMMERCIAL'), f3[0]);
const jn = lire('JOURNAL').slice(1).map(r=>r[3]);
T('journal : note du commercial tracée', jn.some(a=>/NOTE DU COMMERCIAL/.test(a)), jn.slice(-4));

// 9. en-tête de « À facturer » réparé quand le script gagne une colonne
creer('A FACTURER', [['DATE_SIGNATURE','NUMERO','COMMERCIAL','CLIENT','TYPE_CLIENT','SIRET_CLIENT',
  'TVA_CLIENT','CONTACT','EMAIL','TELEPHONE','ADRESSE','CP','VILLE','TAUX_TVA','TOTAL_HT','TOTAL_TVA',
  'TOTAL_TTC','PRESTATIONS','LIEN_PDF','DEVIS_SIGNE','FACTURE']]);   // ancien en-tête, sans la note
g.majAFacturer_();
const fh = lire('A FACTURER')[0];
T('en-tête « À facturer » remis à niveau',
  fh.join('|') === ['DATE_SIGNATURE','NUMERO','COMMERCIAL','CLIENT','TYPE_CLIENT','SIRET_CLIENT',
   'TVA_CLIENT','CONTACT','EMAIL','TELEPHONE','ADRESSE','CP','VILLE','TAUX_TVA','TOTAL_HT','TOTAL_TVA',
   'TOTAL_TTC','PRESTATIONS','NOTE_COMMERCIAL','LIEN_PDF','DEVIS_SIGNE','FACTURE'].join('|'), fh);

console.log('\nOK  ('+ok.length+')\n'+ok.map(x=>'  ✓ '+x).join('\n'));
if(ko.length) console.log('\nÉCHECS ('+ko.length+')\n'+ko.map(x=>'  ✗ '+x).join('\n'));
process.exit(ko.length?1:0);
