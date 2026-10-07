/* La bannière en bas de chaque courriel (classeur, Version 23).

   Demande de Simon : « sur n'importe quel mail qui parte, il y ait ma bannière
   en bas ». Le mot qui compte est « n'importe quel » : il y a neuf courriels
   différents dans le script, et il suffirait d'en oublier un. Ils passent donc
   tous par une seule fonction, et un contrôle vérifie dans le code lui-même
   qu'il n'existe aucun autre chemin d'envoi. */
import fs from 'node:fs';
import {creer, lire, charger, courriers, horloge} from './gs.mjs';
import {CODE_GS} from './chemins.mjs';
horloge(new Date(2026, 9, 5, 10, 0, 0));           // lundi 5 octobre 2026
const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };

const URL = 'https://breizhbrillance.github.io/devis/banniere.jpg';
const EN_D=['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','SIRET_CLIENT','TVA_CLIENT','CONTACT',
 'TELEPHONE','EMAIL','ADRESSE','CP','VILLE','TOTAL_HT_PONCTUEL','TOTAL_HT_MENSUEL','TOTAL_HT','TOTAL_TVA',
 'TOTAL_TTC','REMISE_PCT','STATUT','SIGNE','SIGNATAIRE','VALIDITE','LIEN_PDF','PHOTOS','NOTES','RECU_LE',
 'ID_APPAREIL','ID_DEVIS','OBJET','LOGEMENT_PLUS_2_ANS','TAUX_TVA','DELAI','MOTIF_REFUS','RELANCE_LE',
 'DATE_STATUT','PREUVE_SIGNATURE','NOTE_COMMERCIAL','CONTROLE_TARIF','PASSAGES_MOIS','NATURE','DATE_SOUHAITEE','ETAT_SITE'];
const L = (o) => EN_D.map(h => o[h] !== undefined ? o[h] : '');
const EN_C=['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE','PRESTATAIRE','STATUT',
 'ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT','PHOTOS','NOTE','CREE_LE','DUREE_PREVUE_MIN','LOT'];
const D = (a, m, j) => new Date(a, m - 1, j, 12, 0, 0);

function socle(banniere = URL, devis = []){
  creer('DEVIS',[EN_D, ...devis.map(L)]);
  creer('LIGNES',[['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE','PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT']]);
  creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF'],['SIMON LG','simon@test.fr','ab1!','OUI']]);
  creer('PRESTATAIRES',[['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE'],
                        ['MAXIME','m@test.fr','kw7!','OUI','','MA,ME,JE,VE,SA','08:00-12:00,14:00-17:00',35]]);
  creer('ADMINS',[['NOM','EMAIL','CODE','ACTIF']]);
  creer('CHANTIERS',[EN_C]);
  creer('ABSENCES',[['PRESTATAIRE','DU','AU']]);
  creer('CATALOGUE',[['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE','NATURES'],
    ['Vitrerie','Nettoyage de vitres','','m2',3,20,'PONCTUEL','OUI','REF-0001','CHANTIER,REMISE']]);
  creer('REGLAGES',[['CLE','VALEUR','NOTE'],['societe_nom','BREIZH BRILLANCE',''],['societe_tel','06 73 35 76 05',''],
    ['remise_max','10',''],['recap_email','gerant@bb.fr',''],['email_copie','copie@bb.fr',''],
    ['taux_horaire_planning','30',''], ...(banniere === null ? [] : [['banniere_url', banniere, '']])]);
  creer('JOURNAL',[['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  creer('A FACTURER',[]); creer('TABLEAU DE BORD',[]);
  courriers().length = 0;
  return charger(CODE_GS);
}
const IMG = new RegExp('<img src="' + URL.replace(/[.\/]/g, '\\$&') + '"');
const porte = (m) => IMG.test(String(m.htmlBody || ''));
const dernier = (re) => courriers().filter(m => re.test(m.subject || '')).pop();
const COM = {nom:'SIMON LG', email:'simon@test.fr', role:'COMMERCIAL'};
const vitres = {reference:'REF-0001', categorie:'Vitrerie', designation:'Nettoyage de vitres', qte:70, unite:'m2', pu:3, rem:0, tva:20, type:'PONCTUEL'};
const devisRecu = (extra)=>Object.assign({
  numero:'DEV-2026-SL-0021', date:new Date().toISOString(), validite:new Date(Date.now()+30*86400000).toISOString(),
  commercial:'SIMON LG', nature:'CHANTIER', dateSouhaitee:'2026-10-06',
  client:{type:'PRO', societe:'SYNDIC ARMOR', contact:'Mme Le Gall', email:'client@armor.fr',
          adresse:'12 rue Nicolazic', cp:'56000', ville:'VANNES'},
  lignes:[vitres], totaux:{ht:210, tva:42, ttc:252, htPonctuel:210, htMensuel:0},
  objet:'', delai:'', notes:'', signataire:'', signature:''}, extra||{});

/* ---------- 1. les deux courriels d'un devis reçu ---------- */
let g = socle();
g.enregistrer_({id:'d-21', nom:'SIMON LG', code:'ab1!', appareil:'A', envoyerClient:true,
                devis:devisRecu(), pdf:'AAAA', nomFichier:'d.pdf'}, COM);
let m = dernier(/^Devis DEV-2026-SL-0021/);
T('le devis part au client', !!m && m.to === 'client@armor.fr', m && m.to);
T('avec la bannière en bas', !!m && porte(m), m && m.htmlBody);
T('après le texte, pas avant', !!m && m.htmlBody.indexOf('Je reste à votre disposition') < m.htmlBody.indexOf('<img'), m && m.htmlBody);
T('le PDF est toujours joint', !!m && (m.attachments || []).length === 1, m && m.attachments);
T('la copie au bureau et l\'adresse de réponse sont gardées', !!m && /copie@bb\.fr/.test(m.cc) && m.replyTo === 'simon@test.fr', m && [m.cc, m.replyTo]);
T('la bannière est une image de 600 px qui se réduit sur un téléphone',
  !!m && /width="600"/.test(m.htmlBody) && /max-width:600px/.test(m.htmlBody), m && m.htmlBody);
T('et dit le nom de la maison à qui ne charge pas les images', !!m && /alt="BREIZH BRILLANCE"/.test(m.htmlBody), m && m.htmlBody);

g = socle();
g.enregistrer_({id:'d-22', nom:'SIMON LG', code:'ab1!', appareil:'A',
                devis:devisRecu({numero:'DEV-2026-SL-0022'}), pdf:'AAAA', nomFichier:'d.pdf'}, COM);
m = dernier(/^Devis DEV-2026-SL-0022/);
T('sans envoi au client, la copie au bureau part quand même', !!m && /copie@bb\.fr/.test(m.to), m && m.to);
T('avec la bannière', !!m && porte(m), m && m.htmlBody);

/* ---------- 2. le planning après une signature ---------- */
g = socle(URL, [{NUMERO:'P1', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'HOTEL DU GOLFE', ADRESSE:'1 rue', CP:'56000',
  VILLE:'VANNES', TOTAL_HT:210, TOTAL_TTC:252, STATUT:'REMIS', SIGNE:'NON', NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]);
g.enregistrerStatut_({numero:'P1', verdict:'SIGNE', quand:Date.now()}, {nom:'SIMON LG'});
m = dernier(/^Planning — devis P1$/);
T('le courriel de planning part au gérant', !!m && m.to === 'gerant@bb.fr', m && m.to);
T('avec la bannière', !!m && porte(m), m && m.htmlBody);
T('le texte brut part aussi, pour une messagerie sans HTML', !!m && /intervention\(s\) posée/.test(m.body || ''), m && m.body);
T('les sauts de ligne sont gardés dans la version mise en forme', !!m && /posée\(s\) :<br>/.test(m.htmlBody), m && m.htmlBody);
T('et l\'adresse du classeur y est cliquable', !!m && /<a href="https:\/\/docs\.google\.com\/x">/.test(m.htmlBody), m && m.htmlBody);

/* ---------- 3. le devis annulé ---------- */
courriers().length = 0;
g.enregistrerStatut_({numero:'P1', verdict:'REFUSE', motif:'Trop cher', quand:Date.now()}, {nom:'SIMON LG'});
m = dernier(/P1 annulé/);
T('le courriel d\'annulation part', !!m);
T('avec la bannière', !!m && porte(m), m && m.htmlBody);

/* ---------- 4. les interventions à replacer ---------- */
g = socle(URL, [{NUMERO:'P2', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'GARAGE', ADRESSE:'2 rue', CP:'56000',
  VILLE:'VANNES', TOTAL_HT:210, TOTAL_TTC:252, STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]);
g.genererChantiers_('P2'); g.poserPlanning_('P2', 'SIMON LG', '');
lire('ABSENCES').push(['MAXIME', D(2026,10,6), D(2026,10,8)]);
courriers().length = 0;
g.signalerConflits_(g.lireReglages_());
m = dernier(/à replacer/);
T('le courriel « à replacer » part', !!m);
T('avec la bannière', !!m && porte(m), m && m.htmlBody);

/* ---------- 5. le rappel au commercial et le récapitulatif ---------- */
g = socle(URL, [{NUMERO:'P3', DATE:D(2026,9,20), COMMERCIAL:'SIMON LG', CLIENT:'MAIRIE', TOTAL_HT:100, TOTAL_TTC:120,
  STATUT:'REMIS', SIGNE:'NON', VALIDITE:D(2026,11,20)}]);
lire('REGLAGES').push(['recap_jour','1','']);       // le bureau vit un lundi
g.automateQuotidien();
m = dernier(/^Tes devis à suivre/);
T('le rappel au commercial part', !!m && m.to === 'simon@test.fr', courriers().map(x=>x.subject));
T('avec la bannière', !!m && porte(m), m && m.htmlBody);
m = dernier(/récapitulatif de la semaine/);
T('le récapitulatif de la semaine part', !!m && m.to === 'gerant@bb.fr', courriers().map(x=>x.subject));
T('avec la bannière', !!m && porte(m), m && m.htmlBody);

/* ---------- 6. « n'importe quel mail » : aucun autre chemin d'envoi ---------- */
const src = fs.readFileSync(CODE_GS, 'utf8');
const envois = src.match(/MailApp\.sendEmail\(/g) || [];
T('le script n\'appelle MailApp.sendEmail qu\'à un seul endroit', envois.length === 1, envois.length);
const corpsFonction = src.slice(src.indexOf('function envoyerMail_('), src.indexOf('function corpsMail_('));
T('et cet endroit est la fonction qui pose la bannière',
  /MailApp\.sendEmail\(/.test(corpsFonction) && /banniereHtml_\(reg\)/.test(corpsFonction));
T('aucun autre service d\'envoi n\'est utilisé', !/GmailApp\./.test(src));
/* Neuf depuis la v55 : un devis révisé repart au client s'il avait reçu le
   premier, et à défaut une note au bureau. Le compte est là pour qu'on ne
   puisse pas en ajouter un dixième sans y penser. */
T('neuf courriels différents passent par elle', (src.match(/envoyerMail_\(\{/g) || []).length === 9,
  (src.match(/envoyerMail_\(\{/g) || []).length);

/* ---------- 7. quand il n'y a pas de bannière ---------- */
for (const [quoi, valeur] of [['un réglage vide', ''], ['une adresse qui n\'est pas en https', 'http://exemple.fr/b.jpg'],
                              ['une adresse farfelue', 'javascript:alert(1)'], ['une adresse avec des guillemets', 'https://x.fr/a.jpg" onerror="x']]) {
  g = socle(valeur, [{NUMERO:'P4', DATE:new Date(), COMMERCIAL:'SIMON LG', CLIENT:'X', ADRESSE:'1 rue', CP:'56000', VILLE:'VANNES',
    TOTAL_HT:210, TOTAL_TTC:252, STATUT:'SIGNE', SIGNE:'OUI', NATURE:'CHANTIER', DATE_SOUHAITEE:D(2026,10,6)}]);
  g.genererChantiers_('P4'); g.poserPlanning_('P4', 'SIMON LG', '');
  m = dernier(/^Planning — devis P4$/);
  T(quoi + ' : le courriel part quand même, sans image', !!m && !/<img/.test(m.htmlBody) && /posée/.test(m.htmlBody), m && m.htmlBody);
}

/* ---------- 8. le texte mis en forme ---------- */
g = socle();
const h = g.texteEnHtml_('Client : DUPONT & FILS <urgent>\n"vite"\nhttps://exemple.fr/a?b=1&c=2');
T('les caractères spéciaux d\'un nom de client ne cassent pas le courriel',
  /DUPONT &amp; FILS &lt;urgent&gt;/.test(h) && /&quot;vite&quot;/.test(h), h);
T('une adresse web reste entière dans son lien', /<a href="https:\/\/exemple\.fr\/a\?b=1&amp;c=2">/.test(h), h);
T('un texte vide ne donne pas « undefined »', !/undefined|null/.test(g.texteEnHtml_(undefined)), g.texteEnHtml_(undefined));

/* ---------- 9. le réglage ---------- */
const def = g.REGLAGES_DEFAUT_.find(x => x[0] === 'banniere_url');
T('le réglage banniere_url existe, avec l\'adresse de la bannière', !!def && def[1] === URL, def);
g = socle(null); g.majStructure_();
T('la mise à jour de structure l\'ajoute à un classeur qui ne l\'a pas',
  lire('REGLAGES').some(l => l[0] === 'banniere_url' && l[1] === URL), lire('REGLAGES').map(l=>l[0]));

console.log('\n=== BANNIÈRE DES COURRIELS (classeur) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
