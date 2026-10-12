/* L'espace d'administration vu du téléphone : l'aiguillage, le tableau, les
   deux listes, la planification, la correction d'un résultat, et le hors-réseau. */
import {chromium} from 'playwright';
import {lancer, recu, tableau} from './srvad.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8391; await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const err=[]; const ok=[],ko=[];
const T=(n,v,d)=>{ (v?ok:ko).push(n+(v?'':'  → '+JSON.stringify(d))); };

async function ouvrir(){
  const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const p=await c.newPage();
  p.on('pageerror',e=>err.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
  await p.waitForTimeout(500);
  return {c,p};
}
async function connecter(p, nom, code){
  await p.fill('#fCommercial',nom); await p.fill('#fCode',code);
  await p.click('#bCo'); await p.waitForTimeout(1400);
  if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(900); }
}
/* Un clic sur un bouton absent doit faire ROUGIR la suite, pas la faire
   planter : c'est l'essai porteur de la règle qui doit parler. */
const rate = [];
async function cliquer(p, sel){
  try { await p.click(sel, { timeout: 5000 }); return true; }
  catch(e){ rate.push(sel); return false; }
}
async function ecrire(p, sel, v){
  try { await p.fill(sel, v, { timeout: 5000 }); return true; }
  catch(e){ rate.push(sel); return false; }
}
const lire = async (p, sel) => { try { return await p.inputValue(sel, { timeout: 5000 }); }
  catch(e){ rate.push(sel); return ''; } };
const vis=(p,id)=>p.evaluate(x=>{const e=document.getElementById(x);return !!e && !e.classList.contains('hide');},id);

/* ---------- 1. chacun chez soi ---------- */
{ const {c,p}=await ouvrir();
  await connecter(p,'Simon LG','ab1!');
  T('un commercial arrive toujours sur la saisie', await vis(p,'e1'));
  T('il ne voit pas le tableau', !(await vis(p,'eAd1')));
  const cc = await p.evaluate(()=>({classe:document.body.classList.contains('admin'),
    bandeau:getComputedStyle(document.querySelector('header')).backgroundColor}));
  T('et son application reste bleue', cc.classe === false && cc.bandeau === 'rgb(0, 76, 146)', cc);
  await c.close(); }

const {c,p} = await ouvrir();
await connecter(p,'Simon Direction','qx4$');
await p.waitForTimeout(1200);
T('un admin arrive sur le tableau', await vis(p,'eAd1'));
T('il ne voit ni la saisie ni le planning',
  !(await vis(p,'e1')) && !(await vis(p,'eAg1')));
T('son rôle est retenu',
  await p.evaluate(()=>JSON.parse(sessionStorage.getItem('moi')).role) === 'ADMIN');
T('le bandeau annonce le tableau',
  /tableau/i.test(await p.textContent('#hTitre')), await p.textContent('#hTitre'));
T('aucun catalogue n\'est descendu sur l\'appareil',
  await p.evaluate(()=>!(CFG && CFG.catalogue)), await p.evaluate(()=>Object.keys(CFG||{})));

/* ---------- la couleur dit de quel côté on est ---------- */
const couleur = ()=>p.evaluate(()=>({
  classe: document.body.classList.contains('admin'),
  bandeau: getComputedStyle(document.querySelector('header')).backgroundColor,
  acc: getComputedStyle(document.body).getPropertyValue('--acc').trim()
}));
let cou = await couleur();
T('l\'espace admin porte la marque rouge', cou.classe === true, cou);
T('le bandeau est rouge, pas bleu',
  cou.bandeau === 'rgb(140, 29, 24)', cou);
T('la variable d\'accent a bien basculé', cou.acc.toUpperCase() === '#8C1D18', cou);

/* ---------- 2. les chiffres ---------- */
const ch = await p.innerText('#adChiffres');
T('le nombre de devis s\'affiche', /Devis établis\s*4/i.test(ch.replace(/\n/g,' ')), ch);
T('le taux de transformation est calculé', /50 %/.test(ch), ch);
T('le montant devisé est là', /3[\s\u202f]600,00/.test(ch), ch);
T('le montant signé aussi', /2[\s\u202f]800,00/.test(ch), ch);
T('le récurrent mensuel est distingué', /2[\s\u202f]000,00.*récurrent/s.test(ch), ch);
T('la date du rafraîchissement est affichée',
  /Mis à jour le \d{2}\/\d{2}\/\d{4} à \d{2}h\d{2}/.test(await p.textContent('#adMaj')),
  await p.textContent('#adMaj'));

/* ---------- 3. la liste des devis ---------- */
let liste = await p.innerText('#adListe');
T('les devis des deux commerciaux sont là',
  /MAIRIE DE PLOEREN/.test(liste) && /GARAGE DU PORT/.test(liste), liste.slice(0,200));
T('chaque devis porte sa pastille', /SIGNÉ/.test(liste) && /REFUSÉ/.test(liste), liste.slice(0,300));
T('le motif du refus se lit sans ouvrir la fiche', /Trop cher/.test(liste), liste.slice(0,400));
T('la date de relance aussi', /Relance le \d{2}\/\d{2}\/\d{4}/.test(liste), liste.slice(0,400));

await p.click('#adFiltres .puce:has-text("LEA M")'); await p.waitForTimeout(400);
liste = await p.innerText('#adListe');
T('le filtre par commercial ne garde que les siens',
  /GARAGE DU PORT/.test(liste) && !/MAIRIE DE PLOEREN/.test(liste), liste.slice(0,200));
T('et rappelle son bilan', /2 devis · 0 signés/.test(liste), liste.slice(0,150));
await p.click('#adFiltres .puce:has-text("Tout le monde")'); await p.waitForTimeout(400);

/* ---------- 4. la fiche d'un devis ---------- */
await p.click('#adListe .card:has-text("MAIRIE DE PLOEREN")'); await p.waitForTimeout(500);
T('la fiche du devis s\'ouvre', await vis(p,'eAd2'));
const fd = await p.innerText('#adFiche');
T('elle porte le client et le numéro', /MAIRIE DE PLOEREN/.test(fd) && /DEV-2026-SL-0001/.test(fd), fd.slice(0,200));
T('elle dit qui l\'a établi', /Établi par SIMON LG/.test(fd), fd.slice(0,300));
T('les totaux HT et TTC sont donnés', /800,00/.test(fd) && /960,00/.test(fd), fd.slice(0,300));
T('le PDF est atteignable',
  await p.isVisible('#adFiche a:has-text("Voir le devis")'));
T('le lien pointe sur le Drive',
  /drive\.google\.com/.test(await p.getAttribute('#adFiche a', 'href')),
  await p.getAttribute('#adFiche a', 'href'));
T('un devis sans PDF le dit', true);

/* ---------- 5. corriger un résultat ---------- */
await p.click('#adFiche button:has-text("Retour au tableau")'); await p.waitForTimeout(500);
await p.click('#adListe .card:has-text("GARAGE DU PORT")'); await p.waitForTimeout(500);
T('le devis refusé s\'ouvre', /GARAGE DU PORT/.test(await p.innerText('#adFiche')));
await p.click('#adFiche .choix:has-text("À relancer")'); await p.waitForTimeout(500);
T('une relance sans date est refusée',
  /date de relance/i.test(await p.textContent('#erreur')), await p.textContent('#erreur'));
await p.fill('#adRelance','2026-11-15');
await p.click('#adFiche .choix:has-text("À relancer")'); await p.waitForTimeout(900);
T('la correction part au bureau',
  recu.some(x=>x.action==='statut' && x.numero==='DEV-2026-LM-0001' && x.verdict==='RELANCE'),
  recu.filter(x=>x.action==='statut'));
T('avec la date choisie',
  (recu.filter(x=>x.action==='statut').pop()||{}).relance === '2026-11-15');
T('le bureau a changé le statut',
  tableau.devis.find(d=>d.numero==='DEV-2026-LM-0001').statut === 'A RELANCER');
await p.waitForTimeout(900);
T('et l\'écran le dit sans attendre',
  /À RELANCER/.test(await p.innerText('#adFiche')), (await p.innerText('#adFiche')).slice(0,200));

/* ---------- 6. les chantiers ---------- */
await p.click('#adFiche button:has-text("Retour au tableau")'); await p.waitForTimeout(600);
await p.click('#bOngChantiers'); await p.waitForTimeout(500);
liste = await p.innerText('#adListe');
T('les chantiers de tous les prestataires sont là',
  /MAIRIE DE PLOEREN/.test(liste) && /EHPAD LES PINS/.test(liste), liste.slice(0,250));
T('ceux à planifier sont annoncés en tête',
  /1 chantier à planifier/.test(liste), liste.slice(0,150));
T('un chantier sans date le dit', /Sans date/.test(liste), liste.slice(0,300));
T('un problème signalé se voit dans la liste', /Problème signalé/.test(liste), liste.slice(0,400));

/* Le salarié ne voit plus ses heures de pointage depuis la v69. Le gérant,
   lui, doit continuer à les voir : c'est sur elles qu'il facture et qu'il
   corrige une durée. L'essai le garde des deux côtés. */
await p.click('#adFiltres .puce:has-text("YANN P")'); await p.waitForTimeout(400);
await p.click('#adListe .card:has-text("EHPAD")'); await p.waitForTimeout(600);
const fPointe = await p.innerText('#adFiche');
T('le gérant voit l\'heure d\'arrivée du salarié',
  /Arrivé à \d{1,2}h\d{2}/.test(fPointe), fPointe.slice(0, 300));
T('et son heure de départ', /parti à \d{1,2}h\d{2}/.test(fPointe), fPointe.slice(0, 300));
T('et la durée pointée', /1 h 15|75 min/.test(fPointe), fPointe.slice(0, 300));
await p.click('#adFiche button:has-text("Retour au tableau")'); await p.waitForTimeout(600);
await p.click('#adFiltres .puce:has-text("YANN P")'); await p.waitForTimeout(400);

await p.click('#adFiltres .puce:has-text("MARIE K")'); await p.waitForTimeout(400);
liste = await p.innerText('#adListe');
T('le filtre par prestataire fonctionne',
  /EHPAD/.test(liste) && !/MAIRIE DE PLOEREN/.test(liste), liste.slice(0,200));
await p.click('#adFiltres .puce:has-text("non affectés")'); await p.waitForTimeout(400);
T('le filtre « non affectés » isole ce qui reste à faire',
  /MAIRIE DE PLOEREN/.test(await p.innerText('#adListe')) &&
  !/EHPAD/.test(await p.innerText('#adListe')), await p.innerText('#adListe'));

/* ---------- 7. planifier ---------- */
await p.click('#adListe .card:has-text("MAIRIE DE PLOEREN")'); await p.waitForTimeout(500);
const fc = await p.innerText('#adFiche');
T('la fiche du chantier s\'ouvre', await vis(p,'eAd2'));
/* Depuis la v70 l'accès est un champ, pas un encadré : le gérant le corrige
   au lieu de seulement le lire. Il doit donc s'y retrouver tel quel. */
T('l\'accès au site est là, et modifiable',
  (await p.inputValue('#adAcces')) === 'Code portail 1975', await p.inputValue('#adAcces'));
T('les prestataires sont proposés',
  (await p.$$('#adFiche .puce')).length >= 3, (await p.$$('#adFiche .puce')).length);
await p.fill('#adDate','2026-10-12');
await p.fill('#adHeure','08:30');
await p.click('#adFiche .puce:has-text("MARIE K")'); await p.waitForTimeout(400);
await p.click('#adFiche button:has-text("Enregistrer")'); await p.waitForTimeout(1500);
T('la planification part au bureau',
  recu.some(x=>x.action==='planifier' && x.id==='CH-0001' && x.prestataire==='MARIE K'),
  recu.filter(x=>x.action==='planifier'));
T('avec la date et l\'heure',
  (recu.filter(x=>x.action==='planifier').pop()||{}).date === '2026-10-12' &&
  (recu.filter(x=>x.action==='planifier').pop()||{}).heure === '08:30');
T('le bureau a posé le chantier',
  tableau.chantiers.find(c=>c.id==='CH-0001').statut === 'PLANIFIE');
T('on revient au tableau', await vis(p,'eAd1'));
await p.waitForTimeout(1200);
T('le chantier n\'est plus annoncé à planifier',
  !/1 chantier à planifier/.test(await p.innerText('#adListe')), await p.innerText('#adListe'));

/* ---------- 8. un prestataire inconnu est refusé par le bureau ---------- */
const avant = tableau.chantiers.find(c=>c.id==='CH-0002').prestataire;
const refus = await p.evaluate(async ()=>{
  const moi = JSON.parse(sessionStorage.getItem('moi'));
  return await poster({action:'planifier', nom:moi.nom, code:moi.code,
                       id:'CH-0002', prestataire:'QUELQU UN'});
});
T('le bureau refuse un nom qui n\'est pas dans la liste',
  refus && refus.ok === false, refus);
T('et rien n\'a bougé', tableau.chantiers.find(c=>c.id==='CH-0002').prestataire === avant);

/* ---------- 9. hors réseau ---------- */
await c.setOffline(true);
await p.evaluate(()=>Object.defineProperty(navigator,'onLine',{get:()=>false, configurable:true}));
await p.waitForTimeout(300);
T('le tableau reste affiché sans réseau', await vis(p,'eAd1'));
T('et il est gardé sur l\'appareil',
  await p.evaluate(()=>{ const t=lsj('tableau'); return !!(t && t.devis && t.devis.length); }));
await p.click('#eAd1 button:has-text("Actualiser")'); await p.waitForTimeout(700);
T('« Actualiser » hors réseau le dit sans mentir',
  /Hors connexion/.test(await p.textContent('#erreur')), await p.textContent('#erreur'));
await p.click('#bOngDevis'); await p.waitForTimeout(400);
T('et n\'efface pas ce qui était affiché',
  /EHPAD|MAIRIE/.test(await p.innerText('#adListe')), (await p.innerText('#adListe')).slice(0,150));

await p.click('#bOngChantiers'); await p.waitForTimeout(500);
await p.click('#adListe .card:has-text("EHPAD")'); await p.waitForTimeout(600);
T('une fiche de chantier s\'ouvre quand même', await vis(p,'eAd2'));
await p.click('#adFiche button:has-text("Enregistrer")'); await p.waitForTimeout(600);
T('planifier hors réseau est refusé proprement',
  /besoin du réseau/.test(await p.textContent('#erreur')), await p.textContent('#erreur'));
const avantH = recu.length;
await p.waitForTimeout(400);
T('et rien n\'est parti', recu.length === avantH, recu.length - avantH);
await c.setOffline(false);
await p.evaluate(()=>Object.defineProperty(navigator,'onLine',{get:()=>true, configurable:true}));
await p.click('#adFiche button:has-text("Retour au tableau")'); await p.waitForTimeout(600);
await p.click('#eAd1 button:has-text("Actualiser")'); await p.waitForTimeout(1500);

/* ---------- 10. corriger un chantier (v70) ----------
   Une adresse fausse envoie l'équipe au mauvais endroit, et jusqu'ici elle ne
   se réparait que dans le classeur. */
await cliquer(p, '#bOngChantiers'); await p.waitForTimeout(500);
await cliquer(p, '#adListe .card:has-text("MAIRIE DE PLOEREN")'); await p.waitForTimeout(600);
T('le client est modifiable', await p.isVisible('#adClient'));
T('l\'adresse aussi', await p.isVisible('#adAdresse'));
T('l\'accès aussi', await p.isVisible('#adAcces'));
T('et le champ porte ce que le bureau avait envoyé',
  (await lire(p, '#adAcces')) === 'Code portail 1975', await lire(p, '#adAcces'));
await ecrire(p, '#adAdresse', '2 place de la Mairie');
await ecrire(p, '#adAcces', 'Nouveau code 2026');
await ecrire(p, '#adNote', 'Prevoir l escabeau');
await cliquer(p, '#adFiche .puce:has-text("Vitrages")'); await p.waitForTimeout(300);
await cliquer(p, '#adFiche button:has-text("Enregistrer")'); await p.waitForTimeout(1500);
const envC = recu.filter(x=>x.action==='planifier').pop() || {};
T('la correction part au bureau', envC.adresse === '2 place de la Mairie', envC.adresse);
T('avec l\'accès', envC.acces === 'Nouveau code 2026', envC.acces);
T('avec la note', envC.note === 'Prevoir l escabeau', envC.note);
T('et la nature choisie', envC.nature === 'VITRERIE', envC.nature);
T('le bureau l\'a bien prise',
  tableau.chantiers.find(c=>c.id==='CH-0001').adresse === '2 place de la Mairie',
  tableau.chantiers.find(c=>c.id==='CH-0001').adresse);
T('un chantier sans client est retenu sur l\'écran', await (async ()=>{
  await cliquer(p, '#adListe .card:has-text("MAIRIE")'); await p.waitForTimeout(500);
  await ecrire(p, '#adClient', '  ');
  await cliquer(p, '#adFiche button:has-text("Enregistrer")'); await p.waitForTimeout(600);
  const msg = await p.textContent('#erreur');
  await cliquer(p, '#adFiche button:has-text("Retour au tableau")'); await p.waitForTimeout(500);
  return /client/.test(msg);
})());

/* ---------- 11. annuler un chantier ---------- */
await cliquer(p, '#adListe .card:has-text("EHPAD LES PINS")'); await p.waitForTimeout(600);
T('le bouton d\'annulation est là',
  await p.isVisible('#adFiche button:has-text("Annuler ce chantier")'));
await cliquer(p, '#adFiche button:has-text("Annuler ce chantier")'); await p.waitForTimeout(500);
/* La confirmation est celle de l'application : dans une PWA installée, celle
   du navigateur peut répondre « non » toute seule. */
const conf = () => p.evaluate(()=>{ const d=document.getElementById('dlgConf'); return !!(d && d.open); });
T('une confirmation est demandée, et c\'est celle de l\'application', await conf());
T('elle dit ce qui va se passer',
  /téléphones/.test(await p.textContent('#confTexte')), await p.textContent('#confTexte'));
await cliquer(p, '#confOui'); await p.waitForTimeout(1500);
const envA = recu.filter(x=>x.action==='planifier' && x.annuler).pop();
T('l\'annulation part au bureau', !!envA, recu.filter(x=>x.annuler));
T('le bureau l\'a annulé',
  tableau.chantiers.find(c=>c.id==='CH-0002').statut === 'ANNULE',
  tableau.chantiers.find(c=>c.id==='CH-0002').statut);
await p.waitForTimeout(600);
/* Un chantier annulé ne se mêle pas aux autres : il n'est plus du travail à
   faire, et le voir dans la liste ferait croire qu'il tient encore. Deux
   chantiers portent le nom de l'EHPAD : on compte les cartes, un simple
   « le nom a disparu » serait faux. */
const cartesEhpad = () => p.evaluate(() =>
  [...document.querySelectorAll('#adListe .card')].filter(e => /EHPAD/.test(e.textContent)).length);
T('il quitte la liste des chantiers', (await cartesEhpad()) === 1, await cartesEhpad());
await cliquer(p, '#adFiltres .puce:has-text("annulés")'); await p.waitForTimeout(500);
T('mais on le retrouve derrière sa pastille',
  (await cartesEhpad()) === 1 && /EHPAD LES PINS/.test(await p.innerText('#adListe')),
  (await p.innerText('#adListe')).slice(0,200));
await cliquer(p, '#adListe .card:has-text("EHPAD")'); await p.waitForTimeout(600);
T('sa fiche propose de le rétablir',
  await p.isVisible('#adFiche button:has-text("Rétablir")'));
await cliquer(p, '#adFiche button:has-text("Rétablir")'); await p.waitForTimeout(1500);
T('le rétablissement ne demande rien, il ne casse rien', !(await conf()));
T('et le bureau l\'a repris',
  tableau.chantiers.find(c=>c.id==='CH-0002').statut === 'PLANIFIE',
  tableau.chantiers.find(c=>c.id==='CH-0002').statut);

/* Un chantier déjà pointé ne s'annule pas : son temps part en facturation. */
await cliquer(p, '#adFiltres .puce:has-text("Tout le monde")'); await p.waitForTimeout(400);
await cliquer(p, '#adListe .card:has-text("EHPAD")'); await p.waitForTimeout(600);
const fPointee = await p.innerText('#adFiche');
if(/pointé/.test(fPointee)){
  T('un chantier pointé dit pourquoi il ne s\'annule pas',
    !(await p.isVisible('#adFiche button:has-text("Annuler ce chantier")')), fPointee.slice(0,200));
}
await cliquer(p, '#adFiche button:has-text("Retour au tableau")'); await p.waitForTimeout(500);

/* ---------- 12. créer un chantier à la main ---------- */
const avantN = tableau.chantiers.length;
await cliquer(p, '#eAd1 button:has-text("+ Nouveau chantier")'); await p.waitForTimeout(600);
T('l\'écran de création s\'ouvre', await vis(p,'eAd2'));
T('il n\'y a pas de pointage à montrer sur un chantier qui n\'existe pas',
  !/Arrivé à/.test(await p.innerText('#adFiche')));
const avantEnvoi = recu.filter(x=>x.action==='chantierNeuf').length;
await cliquer(p, '#adFiche button:has-text("Créer le chantier")'); await p.waitForTimeout(700);
T('sans client, la création est retenue sur l\'écran',
  /client/.test(await p.textContent('#erreur')), await p.textContent('#erreur'));
/* Retenue SUR L'ÉCRAN : rien ne doit partir au bureau. Un envoi que le serveur
   refuse donnerait le même message, et masquerait une garde disparue. */
T('et rien n\'est même parti au bureau',
  recu.filter(x=>x.action==='chantierNeuf').length === avantEnvoi,
  recu.filter(x=>x.action==='chantierNeuf').length - avantEnvoi);
T('aucun chantier créé', tableau.chantiers.length === avantN, tableau.chantiers.length);
await ecrire(p, '#adClient', 'M. HERON');
await ecrire(p, '#adAdresse', '3 rue des Lilas');
await ecrire(p, '#adVille', 'Vannes');
await ecrire(p, '#adNote', 'Debarras du garage');
await ecrire(p, '#adDate', '2026-10-20');
await ecrire(p, '#adHeure', '14:00');
await cliquer(p, '#adFiche .puce:has-text("YANN P")'); await p.waitForTimeout(300);
await cliquer(p, '#adFiche .puce:has-text("Remise en état")'); await p.waitForTimeout(300);
await cliquer(p, '#adFiche button:has-text("Créer le chantier")'); await p.waitForTimeout(1800);
T('le chantier est créé', tableau.chantiers.length === avantN + 1, tableau.chantiers.length);
const neuf = tableau.chantiers[tableau.chantiers.length-1];
T('avec son client', neuf.client === 'M. HERON', neuf.client);
T('sa personne et sa date', neuf.prestataire === 'YANN P' && neuf.date === '2026-10-20', neuf);
T('sa nature', neuf.nature === 'REMISE', neuf.nature);
T('et il est planifié', neuf.statut === 'PLANIFIE', neuf.statut);
T('on revient au tableau', await vis(p,'eAd1'));
await p.waitForTimeout(1200);
T('il apparaît dans la liste', /M. HERON/.test(await p.innerText('#adListe')),
  (await p.innerText('#adListe')).slice(0,200));

/* ---------- 13. déplacer plusieurs chantiers d'un coup ---------- */
await cliquer(p, '#bAdSel'); await p.waitForTimeout(500);
T('le mode sélection s\'annonce',
  /Appuie sur les chantiers/.test(await p.innerText('#adLot')), await p.innerText('#adLot'));
await cliquer(p, '#adListe .card:has-text("MAIRIE DE PLOEREN")'); await p.waitForTimeout(400);
T('un appui coche au lieu d\'ouvrir la fiche', await vis(p,'eAd1'));
/* Lu sur l'écran rendu, pas sur la classe : une règle CSS renommée laisserait
   la classe en place et la carte grise. */
const prises = () => p.evaluate(() => {
  const fond = [...document.querySelectorAll('#adListe .card')]
    .map(e => getComputedStyle(e).backgroundColor);
  const ordinaire = fond.filter(c => c === 'rgb(255, 255, 255)').length;
  return { total: fond.length, teintees: fond.length - ordinaire };
});
T('et la carte le montre, teintée', (await prises()).teintees === 1, await prises());
await cliquer(p, '#adListe .card:has-text("M. HERON")'); await p.waitForTimeout(400);
T('deux chantiers choisis', /2 chantiers choisis/.test(await p.innerText('#adLot')),
  await p.innerText('#adLot'));
await cliquer(p, '#adListe .card:has-text("M. HERON")'); await p.waitForTimeout(400);
T('un deuxième appui le retire', /1 chantier choisi/.test(await p.innerText('#adLot')),
  await p.innerText('#adLot'));
await cliquer(p, '#adListe .card:has-text("M. HERON")'); await p.waitForTimeout(400);
await cliquer(p, '#adLot button:has-text("Appliquer")'); await p.waitForTimeout(600);
T('sans rien choisir, le déplacement est retenu',
  /au moins une date/.test(await p.textContent('#erreur')), await p.textContent('#erreur'));
await ecrire(p, '#adLotDate', '2026-11-03');
await cliquer(p, '#adLot .puce:has-text("MARIE K")'); await p.waitForTimeout(300);
await cliquer(p, '#adLot button:has-text("Appliquer")'); await p.waitForTimeout(1800);
const envL = recu.filter(x=>x.action==='lotChantiers').pop() || {};
T('le lot part au bureau', (envL.ids||[]).length === 2, envL.ids);
T('avec la date', envL.date === '2026-11-03', envL.date);
T('avec le prestataire', envL.prestataire === 'MARIE K', envL.prestataire);
T('l\'heure n\'y est pas, elle n\'a pas été choisie', envL.heure === undefined, envL.heure);
T('les deux chantiers ont bougé',
  tableau.chantiers.filter(c=>c.date==='2026-11-03' && c.prestataire==='MARIE K').length === 2,
  tableau.chantiers.filter(c=>c.date==='2026-11-03').map(c=>c.client));
T('le mode sélection se referme tout seul',
  (await p.textContent('#bAdSel')) === 'Sélectionner', await p.textContent('#bAdSel'));

T('aucun bouton attendu ne manquait', rate.length === 0, rate);

await b.close();
console.log('\n=== ESPACE ADMIN (téléphone) : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
console.log('\nerreurs JS : '+(err.length?err.join(' | '):'aucune'));
process.exit(ko.length?1:0);
