/* La signature à l'écran : ouvrir le cadre, tracer, valider, la retrouver
   dans l'aperçu puis dans le devis enregistré et dans le PDF. */
import {chromium} from 'playwright';
import {lancer, recu} from './srvco.mjs';
import {ajouterUne, poserQte, cocher, ouvrirBloc, allerRemise} from './presta.mjs';
import { CHROME } from './chemins.mjs';

/* Une date d'intervention est obligatoire depuis la v46 : on prend demain,
   pour que l'épreuve ne tombe jamais sur une date déjà passée. */
const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();
const PORT=8311; await lancer(PORT);
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
await p.fill('#cSociete','MAIRIE DE TEST'); await p.fill('#cContact','Jean Test');
await p.fill('#cAdresse','1 rue'); await p.fill('#cCp','56250'); await p.fill('#cVille','Monterblanc');
await p.click('#bSuiv'); await p.waitForTimeout(500);
await poserQte(p, 0, 50);
await p.click('#bSuiv'); await p.waitForTimeout(600);

T('on est bien sur le récapitulatif', await vis('e4'));
T('le bouton « Signature à l\'écran » est là',
  await p.isVisible('button:has-text("Signature à l\'écran")'));
T('rien n\'est signé au départ', await vis('sigVide') && !(await vis('sigFaite')));

/* ---------- ouverture du cadre ---------- */
await p.fill('#fSignataire','Jean Test, maire');
await p.click('button:has-text("Signature à l\'écran")');
await p.waitForTimeout(600);
T('le cadre de signature s\'ouvre', await vis('sigOverlay'));
T('le nom du signataire est rappelé au client',
  /Jean Test/.test(await p.textContent('#soNom')), await p.textContent('#soNom'));

const boite = await p.evaluate(()=>{
  const r=document.getElementById('sig').getBoundingClientRect();
  return {x:r.x, y:r.y, w:r.width, h:r.height,
          cw:document.getElementById('sig').width, ch:document.getElementById('sig').height};
});
T('le canvas a une taille exploitable', boite.w > 100 && boite.h > 80 && boite.cw > 100, boite);
T('le canvas ne laisse pas le doigt faire défiler la page',
  await p.evaluate(()=>getComputedStyle(document.getElementById('sig')).touchAction) === 'none',
  await p.evaluate(()=>getComputedStyle(document.getElementById('sig')).touchAction));

/* ---------- on trace, au doigt ---------- */
async function tracerDoigt(){
  const x0 = boite.x + 30, y0 = boite.y + boite.h/2;
  await p.touchscreen.tap(x0, y0).catch(()=>{});
  const cdp = await p.context().newCDPSession(p);
  const pts = [];
  for(let i=0;i<=10;i++) pts.push({x:x0 + i*(boite.w-60)/10, y:y0 + (i%2?-22:22)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pts[0].x,y:pts[0].y}]});
  for(const q of pts.slice(1)){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:q.x,y:q.y}]});
    await p.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(200);
}
await tracerDoigt();

const encre = await p.evaluate(()=>{
  const cv=document.getElementById('sig');
  const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>10) n++;
  return n;
});
T('le doigt laisse une trace sur le canvas', encre > 200, {pixels:encre});
T('l\'appli sait qu\'il y a un tracé', await p.evaluate(()=>SIG && SIG.vide === false),
  await p.evaluate(()=>SIG ? SIG.vide : 'SIG absent'));

/* ---------- validation ---------- */
await p.click('button:has-text("Valider la signature")'); await p.waitForTimeout(500);
T('le cadre se referme', !(await vis('sigOverlay')));
T('l\'aperçu de la signature s\'affiche', await vis('sigFaite'));
T('l\'invitation à signer a disparu', !(await vis('sigVide')));
T('l\'image est bien une image', /^data:image\/png;base64,/.test(
  await p.evaluate(()=>document.getElementById('sigApercu').getAttribute('src')||'')));
T('signatureValide() dit vrai', await p.evaluate(()=>signatureValide()) === true);

/* ---------- elle suit jusqu'au devis enregistré ---------- */
await p.fill('#fDate', DEMAIN); await p.fill('#fDelai','Semaine du 6 octobre');
await p.click('#bSuiv'); await p.waitForTimeout(1500);
T('le devis est enregistré', await vis('e5'));
const env = recu.filter(x=>x.action==='sync').pop();
T('la signature part au bureau',
  !!(env && env.devis && /^data:image\/png/.test(String(env.devis.signature||''))),
  env ? String((env.devis||{}).signature||'').slice(0,40) : 'rien recu');
T('le nom du signataire part aussi',
  !!(env && /Jean Test/.test(String(env.devis.signataire||''))),
  env ? (env.devis||{}).signataire : 'rien');

/* ---------- et jusqu'au PDF ---------- */
const dossier = await p.evaluate(async ()=>{
  const l = await DB.tous();
  const e = l[l.length-1];
  return {pdf: (e.pdf||'').length, sig: String((e.devis||{}).signature||'').slice(0,30),
          nom: e.nomFichier||'', signataire: (e.devis||{}).signataire||''};
});
T('le PDF a bien ete fabrique', dossier.pdf > 20000, dossier);
T('le devis garde la signature sur l\'appareil', /^data:image\/png/.test(dossier.sig), dossier.sig);
T('et le nom du signataire', /Jean Test/.test(dossier.signataire), dossier.signataire);

await b.close();
console.log('\n=== SIGNATURE : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
console.log('\nerreurs JS : '+(err.length?err.join(' | '):'aucune'));
process.exit(ko.length?1:0);
