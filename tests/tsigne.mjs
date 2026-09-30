/* Côté classeur : le devis revient signé après coup. Le PDF vierge cède la
   place au PDF signé, la ligne passe en SIGNE, et la photo du papier n'est
   plus réclamée. */
import {creer, lire, charger, drive} from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };

const EN_D=['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','SIRET_CLIENT','TVA_CLIENT','CONTACT',
 'TELEPHONE','EMAIL','ADRESSE','CP','VILLE','TOTAL_HT_PONCTUEL','TOTAL_HT_MENSUEL','TOTAL_HT','TOTAL_TVA',
 'TOTAL_TTC','REMISE_PCT','STATUT','SIGNE','SIGNATAIRE','VALIDITE','LIEN_PDF','PHOTOS','NOTES','RECU_LE',
 'ID_APPAREIL','ID_DEVIS','OBJET','LOGEMENT_PLUS_2_ANS','TAUX_TVA','DELAI','MOTIF_REFUS','RELANCE_LE',
 'DATE_STATUT','PREUVE_SIGNATURE','NOTE_COMMERCIAL','CONTROLE_TARIF','PASSAGES_MOIS'];
creer('DEVIS',[EN_D]);
creer('LIGNES',[['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE','PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF'],['SIMON LG','simon@test.fr','ab1!','OUI']]);
creer('PRESTATAIRES',[['NOM','EMAIL','CODE','ACTIF','TELEPHONE'],['MARIE K','m@test.fr','kw7!','OUI','06']]);
creer('REGLAGES',[['CLE','VALEUR','NOTE'],
 ['societe_nom','BREIZH BRILLANCE',''],['passages_mois_defaut','4',''],['remise_max','10','']]);
creer('JOURNAL',[['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);

const g = charger(CODE_GS);
const COM = {nom:'SIMON LG', email:'simon@test.fr', role:'COMMERCIAL'};

const devis = (extra)=>Object.assign({
  numero:'DEV-2026-SL-0007', date:new Date().toISOString(),
  validite:new Date(Date.now()+30*86400000).toISOString(),
  commercial:'SIMON LG',
  client:{type:'PRO', societe:'SYNDIC ARMOR', contact:'Mme Le Gall',
          adresse:'12 rue Nicolazic', cp:'56000', ville:'VANNES'},
  lignes:[{categorie:'Vitrerie', reference:'REF-0001', designation:'Nettoyage de vitres',
           qte:50, unite:'m2', pu:3, rem:0, type:'PONCTUEL', tva:20}],
  totaux:{ht:150, tva:30, ttc:180, htPonctuel:150, htMensuel:0},
  objet:'', delai:'sous 15 jours', notes:'', signataire:'', signature:''
}, extra||{});

const envoi = (dv)=>({id:'d-7', nom:'SIMON LG', code:'ab1!', appareil:'APP-1',
                      devis:dv, pdf:'AAAA', nomFichier:'Devis-DEV-2026-SL-0007.pdf'});

const colonne = (nom)=>{ const d=lire('DEVIS'); const i=d[0].indexOf(nom); return d[1] ? d[1][i] : undefined; };
const journal = ()=>lire('JOURNAL').slice(1).map(r=>String(r[3]));

/* ---------- 1. le devis arrive, non signé ---------- */
const r1 = g.enregistrer_(envoi(devis()), COM);
T('le devis est enregistré', r1 && r1.ok === true && lire('DEVIS').length === 2, r1);
T('il est REMIS, pas signé', colonne('STATUT') === 'REMIS' && colonne('SIGNE') === 'NON',
  {statut:colonne('STATUT'), signe:colonne('SIGNE')});
const pdf1 = colonne('LIEN_PDF');
T('son PDF est rangé dans le Drive', /\/d\/ID1\//.test(String(pdf1)), pdf1);
T('aucune preuve de signature', !String(colonne('PREUVE_SIGNATURE')||''), colonne('PREUVE_SIGNATURE'));

/* ---------- 2. le même devis revient signé ---------- */
const signe = devis({signataire:'Mme Le Gall, gérante', signature:'data:image/png;base64,AAA',
                     signeLe: Date.now()});
const r2 = g.enregistrer_(envoi(signe), COM);
T('le bureau ne le prend pas pour un doublon', r2 && r2.ok === true && r2.signe === true, r2);
T('aucune ligne en double', lire('DEVIS').length === 2, lire('DEVIS').length - 1);
T('la ligne passe en SIGNE', colonne('STATUT') === 'SIGNE' && colonne('SIGNE') === 'OUI',
  {statut:colonne('STATUT'), signe:colonne('SIGNE')});
T('le signataire est retenu', String(colonne('SIGNATAIRE')).indexOf('Le Gall') >= 0, colonne('SIGNATAIRE'));
T('la date du statut est posée', colonne('DATE_STATUT') instanceof Date, String(colonne('DATE_STATUT')));

const pdf2 = colonne('LIEN_PDF');
T('le lien du PDF pointe sur un nouveau fichier', pdf2 !== pdf1 && /\/d\/ID2\//.test(String(pdf2)), pdf2);
T('le PDF signé sert de preuve de signature', colonne('PREUVE_SIGNATURE') === pdf2,
  {preuve:colonne('PREUVE_SIGNATURE'), pdf:pdf2});
T('le PDF vierge est parti à la corbeille', drive()['ID1'] && drive()['ID1'].corbeille === true, drive());
T('le PDF signé, lui, est bien là', drive()['ID2'] && drive()['ID2'].corbeille === false, drive());
T('le journal garde trace de la signature',
  journal().indexOf('DEVIS SIGNE RECU') >= 0, journal());

/* ---------- 3. les chantiers naissent du devis signé ---------- */
const ch = lire('CHANTIERS');
T('un chantier est né du devis signé', ch && ch.length === 2, ch ? ch.length-1 : 'onglet absent');

/* ---------- 4. un nouveau renvoi ne refait rien ---------- */
const avant = Object.keys(drive()).length;
const r3 = g.enregistrer_(envoi(signe), COM);
T('le devis déjà signé est reconnu comme doublon', r3 && r3.doublon === true, r3);
T('aucun fichier créé pour rien', Object.keys(drive()).length === avant,
  {avant, apres:Object.keys(drive()).length});
T('toujours une seule ligne', lire('DEVIS').length === 2, lire('DEVIS').length - 1);
T('toujours un seul chantier', lire('CHANTIERS').length === 2, lire('CHANTIERS').length - 1);

/* ---------- 5. le rappel du matin ne réclame plus la photo ---------- */
const bilan = g.aFaireParCommercial_();
const b = bilan['SIMON LG'] || {sansPreuve:[]};
T('le rappel du matin ne réclame aucune photo de papier',
  b.sansPreuve.length === 0, b.sansPreuve);
T('et il ne réclame pas non plus de résultat',
  b.sansResultat.length === 0, b.sansResultat);

console.log('\n=== DEVIS SIGNE APRES COUP (classeur) : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
process.exit(ko.length?1:0);
