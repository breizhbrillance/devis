/* L'espace prestataire vu du téléphone : l'aiguillage à la connexion, le
   planning, la fiche, le pointage — réseau coupé compris. */
import {chromium} from 'playwright';
import {lancer, recu, chantiers} from './srvag.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8301; await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const ok=[],ko=[]; const err=[];
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
  await p.click('#bCo'); await p.waitForTimeout(1200);
  if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(800); }
}
const visible = (p,id)=>p.evaluate(x=>{
  const e=document.getElementById(x); return !!e && !e.classList.contains('hide');
}, id);

/* ---------- 1. le commercial arrive chez lui ---------- */
{ const {c,p}=await ouvrir();
  await connecter(p,'Simon LG','ab1!');
  T('un commercial arrive sur la saisie d\'un devis', await visible(p,'e1'));
  T('il ne voit pas le planning', !(await visible(p,'eAg1')));
  T('son rôle est retenu',
    await p.evaluate(()=>JSON.parse(sessionStorage.getItem('moi')).role) === 'COMMERCIAL');
  await c.close(); }

/* ---------- 2. l'agent arrive chez lui ---------- */
const {c,p} = await ouvrir();
await connecter(p,'Marie K','kw7!');
T('un agent arrive sur son planning', await visible(p,'eAg1'));
T('il ne voit jamais l\'écran de saisie d\'un devis', !(await visible(p,'e1')));
T('son rôle est retenu',
  await p.evaluate(()=>JSON.parse(sessionStorage.getItem('moi')).role) === 'PRESTATAIRE');
T('le bandeau annonce son planning',
  (await p.textContent('#hTitre')).indexOf('planning') >= 0, await p.textContent('#hTitre'));

/* ---------- 3. rien des tarifs n'est arrivé sur l'appareil ---------- */
const stock = await p.evaluate(()=>{
  let tout = '';
  try{ for(let i=0;i<localStorage.length;i++) tout += localStorage.getItem(localStorage.key(i)); }catch(e){}
  try{ tout += sessionStorage.getItem('moi') || ''; }catch(e){}
  return tout;
});
T('aucun catalogue dans la mémoire du téléphone',
  !/catalogue/i.test(stock), stock.slice(0,160));
T('aucun prix, aucun SIRET', !/991 595 711|"pu"|PU_HT/.test(stock), stock.slice(0,160));
T('CFG ne contient pas de catalogue',
  await p.evaluate(()=>!(CFG && CFG.catalogue)), await p.evaluate(()=>Object.keys(CFG||{})));
T('mais il a bien le nom de la société',
  await p.evaluate(()=>(CFG&&CFG.reglages||{}).societe_nom) === 'BREIZH BRILLANCE');

/* ---------- 4. le planning ---------- */
await p.waitForTimeout(900);
T('ses deux chantiers sont affichés',
  (await p.$$('#agListe .card')).length === 2, (await p.$$('#agListe .card')).length);
const liste = await p.innerText('#agListe');
T('le client et la ville apparaissent', /MAIRIE DE PLOEREN/.test(liste) && /Ploeren/.test(liste), liste.slice(0,200));
T('l\'heure apparaît', /09:00/.test(liste), liste.slice(0,200));
T('le jour est écrit en clair', /demain/i.test(liste), liste.slice(0,120));
T('le chantier fait porte sa pastille', /FAIT/.test(liste), liste.slice(0,200));
T('aucun montant dans le planning', !/€/.test(liste), liste.slice(0,200));

/* ---------- 5. la fiche ---------- */
T('le chantier à venir est en tête, celui d\'hier plus bas',
  (await p.innerText('#agListe')).indexOf('MAIRIE DE PLOEREN') <
  (await p.innerText('#agListe')).indexOf('EHPAD'),
  await p.innerText('#agListe'));
T('les chantiers passés sont annoncés comme tels',
  /d\u00e9j\u00e0 pass\u00e9s/i.test(await p.innerText('#agListe')),
  await p.innerText('#agListe'));
await p.click('#agListe .card:has-text("MAIRIE DE PLOEREN")'); await p.waitForTimeout(500);
T('la fiche s\'ouvre', await visible(p,'eAg2'));
T('le client est en titre', (await p.textContent('#agClient')) === 'MAIRIE DE PLOEREN');
T('l\'adresse est complète', /1 place de la Mairie/.test(await p.innerText('#agAdresse')));
T('le code d\'accès est mis en évidence',
  await visible(p,'agAcces') && /1975/.test(await p.innerText('#agAcces')));
const fiche = await p.innerText('#agTaches');
T('les deux prestations sont listées', /menuiseries/i.test(fiche) && /sols/i.test(fiche), fiche);
T('avec quantité et détail', /24 m2/.test(fiche) && /12 ouvrants/.test(fiche), fiche);
T('AUCUN prix sur la fiche de travail', !/€|prix|montant/i.test(fiche), fiche);

/* ---------- 6. le pointage ---------- */
T('« J\'arrive » est proposé', await visible(p,'bAgArrive'));
T('« J\'ai terminé » ne l\'est pas encore', !(await visible(p,'bAgFini')));
await p.click('#bAgArrive'); await p.waitForTimeout(700);
T('après l\'arrivée, le bouton disparaît', !(await visible(p,'bAgArrive')));
T('et « J\'ai terminé » apparaît', await visible(p,'bAgFini'));
T('l\'heure d\'arrivée est affichée',
  /Arrivé à \d{2}h\d{2}/.test(await p.textContent('#agPointInfo')),
  await p.textContent('#agPointInfo'));
T('l\'arrivée est partie au bureau',
  recu.some(x=>x.action==='chantier' && x.arrivee && x.id==='CH-0001'),
  recu.filter(x=>x.action==='chantier').map(x=>Object.keys(x)));

/* ---------- 7. cocher les prestations ---------- */
await p.click('#agTaches input[type=checkbox]'); await p.waitForTimeout(600);
T('une prestation cochée remonte',
  recu.some(x=>x.action==='chantier' && x.faites && x.faites.indexOf('REF-0006')>=0),
  recu.filter(x=>x.faites).map(x=>x.faites));

/* ---------- 8. le départ ---------- */
await p.click('#bAgFini'); await p.waitForTimeout(700);
T('le chantier est terminé', !(await visible(p,'bAgFini')));
T('la durée s\'affiche', await visible(p,'agDuree'), await p.textContent('#agDuree'));
T('le départ est parti au bureau',
  recu.some(x=>x.action==='chantier' && x.depart), 'aucun départ reçu');
T('le bureau a marqué le chantier FAIT',
  chantiers.find(x=>x.id==='CH-0001').statut === 'FAIT');

/* ---------- 9. hors réseau, le pointage tient quand même ---------- */
await p.click('button:has-text("Retour au planning")'); await p.waitForTimeout(500);
await p.evaluate(()=>Object.defineProperty(navigator,'onLine',{get:()=>false, configurable:true}));
await p.evaluate(()=>{ window.fetch = function(){ return Promise.reject(new Error('hors reseau')); }; });

await p.click('#agListe .card:has-text("EHPAD")'); await p.waitForTimeout(500);
const avant = recu.length;
await p.evaluate(()=>{ CHANTIER.arrivee = 0; CHANTIER.depart = 0; CHANTIER.statut='PLANIFIE'; peindreChantier(); });
await p.waitForTimeout(300);
await p.click('#bAgArrive'); await p.waitForTimeout(700);
T('hors réseau, l\'heure d\'arrivée est prise quand même',
  /Arrivé à \d{2}h\d{2}/.test(await p.textContent('#agPointInfo')),
  await p.textContent('#agPointInfo'));
T('rien n\'est parti, forcément', recu.length === avant, recu.length - avant);
T('le pointage est gardé sur l\'appareil',
  await p.evaluate(()=>DB.cTous().then(l=>l.some(c=>c.aEnvoyer && c.aEnvoyer.arrivee))));

/* ---------- 10. au retour du réseau, ça part tout seul ---------- */
await p.evaluate(()=>{ delete window.fetch; });
await p.reload({waitUntil:'networkidle'});
await p.waitForTimeout(2500);
T('la session tient au rechargement : l\'agent retrouve son planning',
  await visible(p,'eAg1'));
T('le pointage différé est remonté au bureau',
  recu.some(x=>x.action==='chantier' && x.id==='CH-0002' && x.arrivee),
  recu.filter(x=>x.action==='chantier').map(x=>x.id+':'+(x.arrivee?'arr':'')));
T('plus rien en attente sur l\'appareil',
  await p.evaluate(()=>DB.cTous().then(l=>l.every(c=>!c.aEnvoyer || !Object.keys(c.aEnvoyer).length))));

/* ---------- 11. le signalement ---------- */
await p.click('#agListe .card:has-text("EHPAD")'); await p.waitForTimeout(500);
await p.fill('#agNote','Local ferme, personne sur place');
await p.click('button:has-text("Signaler un problème")'); await p.waitForTimeout(500);
T('une confirmation est demandée', await p.evaluate(()=>document.getElementById('dlgConf').open));
await p.click('#confOui'); await p.waitForTimeout(800);
T('le signalement part au bureau',
  recu.some(x=>x.action==='chantier' && /Local ferme/.test(String(x.signalement||''))),
  recu.filter(x=>x.signalement).map(x=>x.signalement));
T('et il s\'affiche sur la fiche',
  /Local ferme/.test(await p.innerText('#agSignal')), await p.innerText('#agSignal'));

/* ---------- 12. l'agent n'a aucun accès aux outils du commercial ---------- */
const refus = await p.evaluate(async ()=>{
  const moi = JSON.parse(sessionStorage.getItem('moi'));
  const r = await poster({action:'sync', nom:moi.nom, code:moi.code, devis:{}});
  return r;
});
T('le bureau refuse une action de commercial à un agent',
  refus && refus.ok === false && /autoris/.test(String(refus.erreur||'')), refus);

await b.close();
console.log('\n=== ESPACE PRESTATAIRE (téléphone) : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
console.log('\nerreurs JS : '+(err.length?err.join(' | '):'aucune'));
process.exit(ko.length?1:0);
