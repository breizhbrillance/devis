/* « Faire signer le client » après coup : le devis est sorti, le client signe
   sur le téléphone, le PDF est refait avec la signature et repart au bureau. */
import {chromium} from 'playwright';
import {lancer, recu} from './srvco.mjs';
import {ajouterUne, poserQte, cocher, ouvrirBloc, allerRemise} from './presta.mjs';
import { CHROME } from './chemins.mjs';

/* Une date d'intervention est obligatoire depuis la v46 : on prend demain,
   pour que l'épreuve ne tombe jamais sur une date déjà passée. */
const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();
const PORT=8321; await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p=await c.newPage();
const err=[]; p.on('pageerror',e=>err.push(String(e)));
const ok=[],ko=[];
const T=(n,v,d)=>{ (v?ok:ko).push(n+(v?'':'  → '+JSON.stringify(d))); };
const vis=(id)=>p.evaluate(x=>{ const e=document.getElementById(x); return !!e && !e.classList.contains('hide'); }, id);

await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
await p.waitForTimeout(500);
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chCHA'); await p.waitForTimeout(300);
await p.fill('#cSociete','SYNDIC ARMOR'); await p.fill('#cContact','Mme Le Gall');
await p.fill('#cAdresse','12 rue Nicolazic'); await p.fill('#cCp','56000'); await p.fill('#cVille','VANNES');
await p.click('#bSuiv'); await p.waitForTimeout(500);
await poserQte(p, 0, 50);
await p.click('#bSuiv'); await p.waitForTimeout(600);
await p.fill('#fDate', DEMAIN); await p.fill('#fDelai','sous 15 jours');
await p.click('#bSuiv'); await p.waitForTimeout(1800);

T('le devis est enregistré, on est sur l\'écran de fin', await vis('e5'));
T('une carte « Signature du client » apparaît',
  /signature du client/i.test(await p.innerText('#e5')), (await p.innerText('#e5')).slice(0,200));
T('le bouton « Faire signer le client » est proposé',
  await p.isVisible('#blocSignature button:has-text("Faire signer le client")'));

const avant = await p.evaluate(()=>({pdf:(DERNIER.pdf||'').length, sig:!!(DERNIER.devis||{}).signature,
                                     statut:DERNIER.statut, verdict:DERNIER.verdict}));
T('à ce stade, rien n\'est signé', avant.sig === false && !avant.verdict, avant);
T('et le PDF existe déjà', avant.pdf > 20000, avant);

/* ---------- le client signe ---------- */
await p.click('#blocSignature button:has-text("Faire signer le client")');
await p.waitForTimeout(700);
T('le cadre de signature s\'ouvre', await vis('sigOverlay'));
T('le numéro du devis est rappelé', /DEV-/.test(await p.textContent('#soNom')), await p.textContent('#soNom'));
T('le nom du signataire est demandé, prérempli avec le contact',
  (await vis('soNomChamp')) && /Le Gall/.test(await p.inputValue('#soSignataire')),
  await p.inputValue('#soSignataire'));
T('la mention « Bon pour accord » est annoncée au client',
  /Bon pour accord/.test(await p.innerText('#sigOverlay')));

const boite = await p.evaluate(()=>{ const r=document.getElementById('sig').getBoundingClientRect();
  return {x:r.x,y:r.y,w:r.width,h:r.height}; });
const cdp = await p.context().newCDPSession(p);
{
  const x0=boite.x+30, y0=boite.y+boite.h/2, pts=[];
  for(let i=0;i<=10;i++) pts.push({x:x0+i*(boite.w-60)/10, y:y0+(i%2?-20:20)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pts[0].x,y:pts[0].y}]});
  for(const q of pts.slice(1)){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:q.x,y:q.y}]}); await p.waitForTimeout(18); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(200);
}
await p.fill('#soSignataire','Mme Le Gall, gérante');
await p.click('button:has-text("Valider la signature")');
await p.waitForTimeout(2000);

T('le cadre se referme', !(await vis('sigOverlay')));
const apres = await p.evaluate(()=>({pdf:(DERNIER.pdf||'').length,
  sig:String((DERNIER.devis||{}).signature||'').slice(0,22),
  signataire:(DERNIER.devis||{}).signataire, quand:(DERNIER.devis||{}).signeLe,
  verdict:DERNIER.verdict}));
T('la signature est attachée au devis', /^data:image\/png;base64/.test(apres.sig), apres.sig);
T('le signataire saisi est retenu', /Le Gall, gérante/.test(String(apres.signataire)), apres.signataire);
T('l\'heure de signature est enregistrée', Number(apres.quand) > 0, apres.quand);
T('le PDF a été refabriqué, signature comprise', apres.pdf > avant.pdf, {avant:avant.pdf, apres:apres.pdf});
T('le devis passe en « signé » sans qu\'on ait à le dire', apres.verdict === 'SIGNE', apres.verdict);

T('l\'écran annonce le devis signé, avec l\'heure',
  /Devis signé par le client/.test(await p.innerText('#blocSignature')) &&
  /Signé le \d{2}\/\d{2}\/\d{4} à \d{2}h\d{2}/.test(await p.innerText('#blocSignature')),
  await p.innerText('#blocSignature'));
T('le bouton « Faire signer » a disparu',
  !(await p.isVisible('#blocSignature button:has-text("Faire signer le client")')));
T('le résultat du rendez-vous est déjà rempli',
  /Résultat : Signé/.test(await p.innerText('#verdictFait')), await p.innerText('#verdictFait'));
T('aucun écran de photo ne s\'est ouvert', !(await vis('e7')));

/* ---------- ce qui repart au bureau ---------- */
const syncs = recu.filter(x=>x.action==='sync');
T('le devis est reparti au bureau une seconde fois', syncs.length >= 2, syncs.length);
const dernier = syncs[syncs.length-1];
T('avec le même identifiant de devis — pas un doublon',
  syncs.length >= 2 && dernier.id === syncs[0].id, {a:syncs[0] && syncs[0].id, b:dernier && dernier.id});
T('avec la signature', /^data:image\/png/.test(String((dernier.devis||{}).signature||'')),
  String((dernier.devis||{}).signature||'').slice(0,30));
T('avec un PDF plus lourd que le premier',
  String(dernier.pdf||'').length > String(syncs[0].pdf||'').length,
  {a:String(syncs[0].pdf||'').length, b:String(dernier.pdf||'').length});
T('le résultat « signé » part aussi', recu.some(x=>x.action==='statut' && x.verdict==='SIGNE'),
  recu.filter(x=>x.action==='statut').map(x=>x.verdict));
T('le journal porte la signature',
  recu.some(x=>x.action==='journal' && (x.evenements||[]).some(e=>/SIGNATURE CLIENT/.test(e.action))),
  'aucun événement SIGNATURE CLIENT');

/* ---------- dans « Mes devis » ---------- */
await p.click('#bHist'); await p.waitForTimeout(900);
const liste = await p.innerText('#liste');
T('la liste annonce le devis signé', /Signé le \d{2}\/\d{2}\/\d{4}/.test(liste), liste.slice(0,300));
T('aucune photo de papier n\'est réclamée', !/Photo du devis signé manquante/.test(liste), liste.slice(0,300));
T('le rappel « sans photo » ne se déclenche pas',
  !/sans photo du papier/.test(await p.innerText('#e6')), await p.innerText('#e6'));
T('le bouton « Signer » n\'est plus proposé sur ce devis',
  !(await p.isVisible('#liste button:has-text("Signer")')));

/* ---------- un second devis, signé hors réseau ---------- */
await p.evaluate(()=>{ nouveauDevis(); }); await p.waitForTimeout(400);
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chCHA'); await p.waitForTimeout(300);
await p.fill('#cSociete','GARAGE DU PORT'); await p.fill('#cContact','M. Prigent');
await p.fill('#cAdresse','4 quai'); await p.fill('#cCp','56000'); await p.fill('#cVille','VANNES');
await p.click('#bSuiv'); await p.waitForTimeout(500);
await ajouterUne(p, 0);
await p.click('#bSuiv'); await p.waitForTimeout(500);
await p.fill('#fDate', DEMAIN); await p.fill('#fDelai','octobre');
await p.click('#bSuiv'); await p.waitForTimeout(1800);

await p.evaluate(()=>{ Object.defineProperty(navigator,'onLine',{get:()=>false, configurable:true});
                       window.__fetch = window.fetch;
                       window.fetch = function(){ return Promise.reject(new Error('hors reseau')); }; });
const avant2 = recu.length;
await p.click('#blocSignature button:has-text("Faire signer le client")');
await p.waitForTimeout(700);
{
  const bo = await p.evaluate(()=>{ const r=document.getElementById('sig').getBoundingClientRect();
    return {x:r.x,y:r.y,w:r.width,h:r.height}; });
  const x0=bo.x+30, y0=bo.y+bo.h/2, pts=[];
  for(let i=0;i<=8;i++) pts.push({x:x0+i*(bo.w-60)/8, y:y0+(i%2?-18:18)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pts[0].x,y:pts[0].y}]});
  for(const q of pts.slice(1)){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:q.x,y:q.y}]}); await p.waitForTimeout(18); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
await p.click('button:has-text("Valider la signature")');
await p.waitForTimeout(1500);
T('hors réseau, la signature est quand même prise',
  await p.evaluate(()=>!!(DERNIER.devis||{}).signature));
T('rien n\'est parti, forcément', recu.length === avant2, recu.length - avant2);
T('l\'écran le dit sans mentir',
  /repart au bureau au prochain envoi/.test(await p.innerText('#blocSignature')),
  await p.innerText('#blocSignature'));

await p.evaluate(()=>{ window.fetch = window.__fetch;
  Object.defineProperty(navigator,'onLine',{get:()=>true, configurable:true}); });
const etats = await p.evaluate(()=>DB.tous().then(l=>l.map(x=>
  ((x.devis.client||{}).societe||'?')+':'+x.statut+':'+(x.devis.signature?'signé':'vierge'))));
console.log('ETATS AVANT RENVOI', etats);
await p.evaluate(()=>synchroniser(true));
await p.waitForTimeout(2500);
T('au retour du réseau, le devis signé part tout seul',
  recu.filter(x=>x.action==='sync').some(x=>/GARAGE/.test(String((x.devis||{}).client&&x.devis.client.societe||'')) &&
                                             String((x.devis||{}).signature||'').indexOf('data:image')===0),
  recu.filter(x=>x.action==='sync').map(x=>((x.devis||{}).client||{}).societe+':'+(x.devis.signature?'signé':'vierge')));

/* ---------- on ne signe pas deux fois ---------- */
const doubles = await p.evaluate(async ()=>{
  const l = await DB.tous(); const e = l.find(x=>/GARAGE/.test((x.devis.client||{}).societe||''));
  ouvrirSignatureDevis(e.id);
  await new Promise(r=>setTimeout(r,500));
  return {ouvert: !document.getElementById('sigOverlay').classList.contains('hide'),
          message: document.getElementById('erreur').textContent};
});
T('un devis déjà signé ne se resigne pas', doubles.ouvert === false, doubles);
T('et l\'application dit pourquoi', /déjà signé/.test(doubles.message), doubles.message);

await b.close();
console.log('\n=== FAIRE SIGNER LE CLIENT : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
console.log('\nerreurs JS : '+(err.length?err.join(' | '):'aucune'));
process.exit(ko.length?1:0);
