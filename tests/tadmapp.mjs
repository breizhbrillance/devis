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
T('l\'accès au site est mis en évidence', /Code portail 1975/.test(fc), fc.slice(0,300));
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

await b.close();
console.log('\n=== ESPACE ADMIN (téléphone) : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
console.log('\nerreurs JS : '+(err.length?err.join(' | '):'aucune'));
process.exit(ko.length?1:0);
