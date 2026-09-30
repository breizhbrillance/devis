/* Le devis signé se dit signé, et le PDF s'affiche dans l'application. */
import {chromium} from 'playwright';
import {lancer, recu} from './srvco.mjs';
import {ajouterUne, poserQte, cocher, ouvrirBloc, allerRemise} from './presta.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8351; await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p=await c.newPage();
const err=[]; p.on('pageerror',e=>err.push(String(e)));
const ok=[],ko=[]; const T=(n,v,d)=>{ (v?ok:ko).push(n+(v?'':'  → '+JSON.stringify(d))); };
const vis=(id)=>p.evaluate(x=>{const e=document.getElementById(x);return !!e && !e.classList.contains('hide');},id);
const cdp=await p.context().newCDPSession(p);
async function tracer(){
  const bo=await p.evaluate(()=>{const r=document.getElementById('sig').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  const pts=[]; const x0=bo.x+30,y0=bo.y+bo.h/2;
  for(let i=0;i<=8;i++) pts.push({x:x0+i*(bo.w-60)/8,y:y0+(i%2?-20:20)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pts[0].x,y:pts[0].y}]});
  for(const q of pts.slice(1)){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:q.x,y:q.y}]}); await p.waitForTimeout(15); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(200);
}
await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.fill('#cSociete','SYNDIC ARMOR'); await p.fill('#cContact','Mme Le Gall');
await p.fill('#cAdresse','12 rue'); await p.fill('#cCp','56000'); await p.fill('#cVille','VANNES');
await p.click('#bSuiv'); await p.waitForTimeout(500);
await ajouterUne(p, 0);
await p.click('#bSuiv'); await p.waitForTimeout(600);

/* ---------- signature à l'étape 4 ---------- */
await p.fill('#fSignataire','Mme Le Gall');
await p.click('button:has-text("Signature à l\'écran")'); await p.waitForTimeout(600);
await tracer();
await p.click('button:has-text("Valider la signature")'); await p.waitForTimeout(500);
T('l\'aperçu de la signature s\'affiche', await vis('sigFaite'));
await p.fill('#fDelai','octobre');
await p.click('#bSuiv'); await p.waitForTimeout(2200);

T('le devis est enregistré comme SIGNÉ', await p.evaluate(()=>DERNIER.verdict)==='SIGNE',
  await p.evaluate(()=>DERNIER.verdict));
T('l\'heure de la signature est gardée', await p.evaluate(()=>Number((DERNIER.devis||{}).signeLe)) > 0);
T('l\'écran de fin annonce le devis signé, avec l\'heure',
  /Signé le \d{2}\/\d{2}\/\d{4} à \d{2}h\d{2}/.test(await p.innerText('#blocSignature')),
  await p.innerText('#blocSignature'));
T('il ne redemande plus le résultat', !(await vis('verdictChoix')));
T('le résultat affiché est « Signé »', /Résultat : Signé/.test(await p.innerText('#verdictFait')),
  await p.innerText('#verdictFait'));
T('le résultat part au bureau', recu.some(x=>x.action==='statut' && x.verdict==='SIGNE'),
  recu.filter(x=>x.action==='statut').map(x=>x.verdict));
T('aucun écran photo ne s\'est ouvert', !(await vis('e7')));

/* ---------- la visionneuse ---------- */
T('le bouton dit « Voir le devis »', await p.isVisible('#e5 button:has-text("Voir le devis")'));
await p.click('#e5 button:has-text("Voir le devis")'); await p.waitForTimeout(1500);
T('le PDF s\'ouvre dans l\'application', await vis('pdfOverlay'));
T('le numéro du devis est rappelé, avec sa mention signé',
  /DEV-.*· signé/.test(await p.textContent('#poNum')), await p.textContent('#poNum'));
await p.waitForTimeout(2500);
const pages = await p.evaluate(()=>[...document.querySelectorAll('#poPages canvas')].map(c=>({w:c.width,h:c.height,vu:Math.round(c.getBoundingClientRect().width)})));
T('le devis est dessiné dans la page, pas dans un cadre', pages.length >= 1, pages);
T('chaque page est rendue en haute définition pour l\'impression',
  pages.every(x=>x.w>1400 && x.h>2000), pages);
T('elle occupe la largeur de l\'écran', pages.every(x=>x.vu>300), pages);
T('ce n\'est pas une page blanche', await p.evaluate(()=>{
  const c=document.querySelector('#poPages canvas'); const d=c.getContext('2d').getImageData(0,0,c.width,Math.min(600,c.height)).data;
  let n=0; for(let i=0;i<d.length;i+=40) if(d[i]<230) n++; return n>200; }));
T('rien n\'a été téléchargé', (await p.evaluate(()=>document.querySelectorAll('a[download]').length)) === 0);
T('un bouton « Imprimer » et un bouton « Envoyer »',
  (await p.isVisible('#pdfOverlay button:has-text("Imprimer")')) &&
  (await p.isVisible('#pdfOverlay button:has-text("Envoyer")')));
const imprime = await p.evaluate(()=>{ let appele=false; window.print=function(){appele=true;}; imprimerVu(); return appele; });
T('« Imprimer » ouvre bien la fenêtre d\'impression du système', imprime === true);
T('à l\'impression, seules les pages du devis restent', await p.evaluate(()=>{
  const r=[...document.styleSheets].flatMap(f=>{ try{return [...f.cssRules];}catch(e){return [];} })
    .filter(x=>x.media && String(x.media.mediaText).indexOf('print')>=0);
  return r.length>0 && /pdfOverlay/.test(r.map(x=>x.cssText).join(' ')); }));
await p.click('#pdfOverlay button:has-text("Fermer")'); await p.waitForTimeout(500);
T('« Fermer » referme et ramène au devis', !(await vis('pdfOverlay')) && await vis('e5'));
T('le lien temporaire est relâché', await p.evaluate(()=>PDF_URL === null));

/* ---------- depuis Mes devis ---------- */
await p.click('#bHist'); await p.waitForTimeout(900);
const liste = await p.innerText('#liste');
T('la liste porte la pastille SIGNÉ', /SIGNÉ/.test(liste), liste.slice(0,120));
T('elle annonce la date de signature', /Signé le \d{2}\/\d{2}\/\d{4}/.test(liste), liste.slice(0,200));
T('plus de « À RENSEIGNER »', !/RENSEIGNER/.test(liste), liste.slice(0,120));
T('aucune photo de papier réclamée', !/Photo du devis signé manquante/.test(liste));
T('le bouton dit « Voir le PDF »', await p.isVisible('#liste button:has-text("Voir le PDF")'));
await p.click('#liste button:has-text("Voir le PDF")'); await p.waitForTimeout(1500);
T('le PDF s\'ouvre aussi depuis la liste', await vis('pdfOverlay'));
await p.click('#pdfOverlay button:has-text("Fermer")'); await p.waitForTimeout(400);

/* ---------- la visionneuse ne bloque pas l'écran de connexion ---------- */
await p.click('#liste button:has-text("Voir le PDF")'); await p.waitForTimeout(1200);
await p.evaluate(()=>ecranConnexion(''));
await p.waitForTimeout(500);
T('un retour à la connexion referme la visionneuse', !(await vis('pdfOverlay')));
T('et les champs répondent',
  await p.evaluate(()=>{ const c=document.getElementById('fCommercial'); c.focus(); return document.activeElement===c; }));

await b.close();
console.log('\n=== DEVIS SIGNE ET VISIONNEUSE : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
console.log('\nerreurs JS : '+(err.length?err.join(' | '):'aucune'));
process.exit(ko.length?1:0);
