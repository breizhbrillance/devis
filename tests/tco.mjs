/* Tous les chemins de l'écran de connexion, et le message exact affiché. */
import {chromium} from 'playwright';
import {lancer, recu, mode} from './srvco.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8244; await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const ok=[],ko=[]; const err=[];
const T=(n,c,det)=>{ (c?ok:ko).push(n+(c?'':'   → '+det)); };

async function neuf(){
  const c=await b.newContext({viewport:{width:390,height:844}});
  const p=await c.newPage();
  p.on('pageerror',e=>err.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
  return {c,p};
}
async function essai(p,nom,code,attente){
  await p.fill('#fCommercial',nom); await p.fill('#fCode',code);
  await p.click('#bCo'); await p.waitForTimeout(attente||1200);
  const e=await p.$('#erreur');
  const vis=e && !(await e.getAttribute('class')||'').includes('hide');
  return { msg: vis ? (await p.textContent('#erreur')).trim() : '',
           accord: await p.isVisible('#eAccord'),
           e1: await p.isVisible('#e1'),
           bouton: (await p.textContent('#bCo')).trim() };
}

/* ---- 1. le chemin normal ---- */
{ mode.co='ok'; const {c,p}=await neuf();
  const r=await essai(p,'Simon LG','ab1!');
  T('connexion valide → écran d\'accord ou étape 1', r.accord||r.e1, JSON.stringify(r));
  T('aucun message d\'erreur au passage', r.msg==='', r.msg);
  T('le bouton est rendu', r.bouton==='Se connecter', r.bouton);
  await c.close(); }

/* ---- 2. champs vides ---- */
{ const {c,p}=await neuf();
  let r=await essai(p,'','', 400);
  T('nom vide → « Saisis ton nom. »', r.msg==='Saisis ton nom.', r.msg);
  r=await essai(p,'Simon LG','',400);
  T('code vide → « Saisis ton code. »', r.msg==='Saisis ton code.', r.msg);
  await c.close(); }

/* ---- 3. LE PIÈGE : un code sans caractère spécial ---- */
{ mode.co='ok'; const {c,p}=await neuf();
  const avant=recu.length;
  const REGLE=/ne respecte pas la règle/i;
  const r=await essai(p,'Simon LG','1234',800);
  T('code « 1234 » : la vraie raison est dite', REGLE.test(r.msg), r.msg);
  T('… et le bureau n\'est même pas appelé', recu.length===avant, 'appels: '+(recu.length-avant));
  const r2=await essai(p,'Simon LG','Simon56',800);
  T('code « Simon56 » : la vraie raison est dite', REGLE.test(r2.msg), r2.msg);
  const r3=await essai(p,'Simon LG','a1!',800);
  T('code de 3 caractères : la vraie raison est dite', REGLE.test(r3.msg), r3.msg);
  const r4=await essai(p,'Simon LG','1234',800);
  T('un code mal formé ne compte pas comme un essai raté',
    !/Prochain essai|Réessaie dans/.test(r4.msg), r4.msg);
  await c.close(); }

/* ---- 4. le blocage après trois essais ---- */
{ mode.co='refus'; const {c,p}=await neuf();
  let r;
  for(let i=0;i<3;i++) r=await essai(p,'Simon LG','zz9!',900);
  T('3 essais → un délai est annoncé', /Prochain essai dans/.test(r.msg), r.msg);
  const r4=await essai(p,'Simon LG','zz9!',500);
  T('pendant le délai → « Réessaie dans N secondes »', /Réessaie dans \d+ seconde/.test(r4.msg), r4.msg);
  await c.close(); }

/* ---- 5. le bureau refuse (nom inconnu / mauvais code) ---- */
{ mode.co='refus'; const {c,p}=await neuf();
  const r=await essai(p,'Inconnu X','ab1!');
  T('refus du bureau → « Nom ou code incorrect. »', r.msg.startsWith('Nom ou code incorrect.'), r.msg);
  await c.close(); }

/* ---- 6. trop d'essais côté bureau ---- */
{ mode.co='trop'; const {c,p}=await neuf();
  const r=await essai(p,'Simon LG','ab1!');
  T('blocage du bureau → le quart d\'heure est dit', /quart d'heure|essais/i.test(r.msg), r.msg);
  await c.close(); }

/* ---- 7. le bureau ne répond pas (panne, 500, page HTML) ---- */
for(const m of ['panne','erreur500','html']){
  mode.co=m; const {c,p}=await neuf();
  const r=await essai(p,'Simon LG','ab1!',3000);
  T('bureau injoignable ('+m+') → message lisible, sans jargon',
    r.msg!=='' && !/token|JSON|undefined|\[object/i.test(r.msg), r.msg);
  T('bureau injoignable ('+m+') → première connexion expliquée',
    /réseau|échoué|Réessaie/i.test(r.msg), r.msg);
  T('bureau injoignable ('+m+') → le bouton n\'est pas resté bloqué',
    r.bouton==='Se connecter', r.bouton);
  await c.close();
}

/* ---- 8. hors connexion, appareil neuf ---- */
{ mode.co='ok'; const c=await b.newContext({viewport:{width:390,height:844}});
  const p=await c.newPage(); p.on('pageerror',e=>err.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
  await p.evaluate(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));
  const r=await essai(p,'Simon LG','ab1!',900);
  T('appareil neuf + hors réseau → « il faut du réseau »', /réseau/i.test(r.msg), r.msg);
  await c.close(); }

/* ---- 9. hors connexion, appareil déjà connu ---- */
{ mode.co='ok'; const c=await b.newContext({viewport:{width:390,height:844}});
  const p=await c.newPage(); p.on('pageerror',e=>err.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
  let r=await essai(p,'Simon LG','ab1!');           // première fois, en ligne
  T('première connexion en ligne réussie', r.accord||r.e1, JSON.stringify(r));
  const emp=await p.evaluate(()=>{ try{ return !!localStorage.getItem('verif'); }catch(e){ return false; } });
  T('l\'appareil garde de quoi vérifier tout seul', emp, 'clés: '+await p.evaluate(()=>Object.keys(localStorage).join(',')));

  await p.evaluate(()=>{ try{ sessionStorage.clear(); }catch(e){} });
  await p.reload({waitUntil:'networkidle'});
  await p.waitForSelector('#fCommercial',{state:'visible',timeout:8000}).catch(()=>{});
  await p.evaluate(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));
  r=await essai(p,'Simon LG','ab1!',900);
  T('appareil connu + hors réseau → ça passe quand même', r.accord||r.e1, JSON.stringify(r));

  await p.evaluate(()=>{ try{ sessionStorage.clear(); }catch(e){} });
  await p.reload({waitUntil:'networkidle'});
  await p.waitForSelector('#fCommercial',{state:'visible',timeout:8000}).catch(()=>{});
  await p.evaluate(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}));
  r=await essai(p,'Simon LG','zz9!',900);
  T('appareil connu + mauvais code hors réseau → refusé', /incorrect/i.test(r.msg), r.msg);
  await c.close(); }

/* ---- 10. le nom, tel qu'on le tape ---- */
{ mode.co='ok'; const {c,p}=await neuf();
  const r=await essai(p,'  simon lg  ','ab1!');
  T('nom en minuscules avec espaces → accepté', r.accord||r.e1, JSON.stringify(r));
  await c.close(); }

/* ---- 11. l'œil qui montre le code ---- */
{ const {c,p}=await neuf();
  T('le code est masqué au départ', await p.getAttribute('#fCode','type')==='password');
  const oeil=await p.$('#bOeil, [onclick*="basculerCode"]');
  if(oeil){ await oeil.click(); await p.waitForTimeout(150);
    T('l\'œil montre le code', await p.getAttribute('#fCode','type')==='text'); }
  else T('l\'œil montre le code', false, 'bouton introuvable');
  await c.close(); }

await b.close();
console.log('\n=== CONNEXION : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
console.log('\nerreurs JS : '+(err.length?err.join('\n'):'aucune'));
process.exit(ko.length?1:0);
