import {chromium} from 'playwright';
import {lancer, recu, mode} from './srv2.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8271, srv=await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const ctx=await b.newContext({viewport:{width:360,height:740},deviceScaleFactor:2});
const p=await ctx.newPage();
const jsErr=[]; p.on('pageerror',e=>jsErr.push(String(e)));
const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };
mode.sync='ok';
await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(1000);
if(await p.isVisible('#eAccord')) { await p.click('#bAccord'); await p.waitForTimeout(300); }
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chCHA'); await p.waitForTimeout(300);
await p.fill('#cSociete','SYNDIC ARMOR'); await p.fill('#cContact','Mme Le Gall');
await p.fill('#cAdresse','12 rue Nicolazic'); await p.fill('#cCp','56000'); await p.fill('#cVille','VANNES');
await p.evaluate(()=>{ LIGNES=[{categorie:'Vitrerie',reference:'V01',designation:'Nettoyage de vitres',
  detail:'',qte:100,unite:'m²',pu:2.5,rem:0,tva:20,type:'PONCTUEL'}]; rendreLignes(); sauverBrouillon(); });
for(let i=0;i<6;i++){ if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break; await p.click('#bSuiv'); await p.waitForTimeout(700); }
await p.waitForTimeout(1200);

T('champ note présent sur l\'écran de fin', await p.isVisible('#verdictNote'));
T('bouton d\'enregistrement caché au départ', !(await p.isVisible('#bNote')));

// note seule, sans résultat
await p.fill('#verdictNote','Gardien joignable le matin. Concurrent en place : Onet, fin de contrat en mars.');
await p.waitForTimeout(300);
T('le bouton apparaît dès qu\'on écrit', await p.isVisible('#bNote'));
await p.click('#bNote'); await p.waitForTimeout(1500);
T('bouton reparti après enregistrement', !(await p.isVisible('#bNote')));
let st = recu.filter(x=>x.action==='statut');
T('note seule envoyée au bureau', st.length===1 && !st[0].verdict && /Onet/.test(st[0].note||''), st[0]);

// puis un résultat : la note suit
await p.click('#verdictChoix .choix:has-text("réfléchit")'); await p.waitForTimeout(300);
await p.click('#verdictRelance button.btn:not(.sec)'); await p.waitForTimeout(1500);
st = recu.filter(x=>x.action==='statut');
T('le résultat emporte la note', st.length===2 && st[1].verdict==='RELANCE' && /Onet/.test(st[1].note||''), st[1]);
T('note toujours affichée après le résultat',
  (await p.inputValue('#verdictNote')).includes('Onet'));

// la liste montre la note, et le bouton s'appelle « Résultat »
await p.click('#bHist'); await p.waitForTimeout(900);
const liste = (await p.textContent('#liste')).replace(/\s+/g,' ');
T('bouton « Résultat » sans point d\'interrogation',
  liste.includes('Résultat') && !liste.includes('Résultat ?'), liste.slice(0,160));
T('note visible dans la liste', liste.includes('Onet'), liste.slice(0,220));
await p.screenshot({path:'img/v25-liste.png'});

// on rouvre depuis la liste et on complète la note
await p.locator('#liste button:has-text("Résultat")').first().click(); await p.waitForTimeout(800);
T('note rechargée à la réouverture', (await p.inputValue('#verdictNote')).includes('Onet'));
await p.fill('#verdictNote','Gardien joignable le matin. Rappeler après le 15.');
await p.waitForTimeout(250);
await p.click('#bNote'); await p.waitForTimeout(1500);
st = recu.filter(x=>x.action==='statut');
T('note corrigée renvoyée', st.length===3 && /Rappeler après le 15/.test(st[2].note||''), st[2]);
await p.screenshot({path:'img/v25-note.png'});

const j = recu.filter(x=>x.action==='journal').flatMap(x=>x.evenements||[]).map(e=>e.action);
T('journal : la note est tracée', j.some(a=>/NOTE ENREGISTREE/.test(a)), j);

console.log('OK  ('+ok.length+')\n'+ok.map(x=>'  ✓ '+x).join('\n'));
if(ko.length) console.log('\nÉCHECS ('+ko.length+')\n'+ko.map(x=>'  ✗ '+x).join('\n'));
console.log('\nerreurs JS :', jsErr.length?[...new Set(jsErr)]:'aucune');
await b.close(); srv.close(); process.exit(ko.length||jsErr.length?1:0);
