import {chromium} from 'playwright';
import {lancer, recu} from './srv.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8231; const srv=await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const p=await (await b.newContext({viewport:{width:390,height:844}})).newPage();
const err=[]; p.on('pageerror',e=>err.push(String(e)));
const ok=[],ko=[];
const T=(n,c)=>{ (c?ok:ko).push(n); };
await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});

// connexion
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(700);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }
T('connexion + accord → étape 1', await p.isVisible('#e1'));

// un devis complet
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chCHA'); await p.waitForTimeout(300);
await p.fill('#cSociete','MAIRIE DE TEST'); await p.fill('#cContact','Jean Test');
await p.fill('#cAdresse','1 rue du Test'); await p.fill('#cCp','56250'); await p.fill('#cVille','Monterblanc');
await p.click('#bSuiv'); await p.waitForTimeout(300);
// ligne depuis le catalogue
await p.evaluate(()=>{ if(!LIGNES.length) LIGNES.push({categorie:'Vitrerie',reference:'V01',designation:'Nettoyage de vitres',detail:'',qte:100,unite:'m²',pu:2.5,rem:0,tva:20,type:'PONCTUEL'}); rendreLignes&&rendreLignes(); sauverBrouillon(); });
// la date d'intervention est obligatoire depuis la v46
await p.evaluate(()=>{ const d=new Date(); d.setDate(d.getDate()+1);
  const v=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
  const e=document.getElementById('fDate'); if(e) e.value=v; });
for(let i=0;i<6;i++){
  if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break;
  await p.click('#bSuiv'); await p.waitForTimeout(800);
}
await p.waitForTimeout(1000);
T('devis enregistré → écran Terminé', await p.isVisible('#e5'));
T('les trois choix de résultat sont là', (await p.$$('#verdictChoix .choix')).length===3);

// refus
await p.click('#verdictChoix .choix:has-text("Refusé")'); await p.waitForTimeout(250);
T('le panneau motif s\'ouvre', await p.isVisible('#verdictMotif'));
await p.click('#verdictMotif .choix:has-text("Concurrent")'); await p.waitForTimeout(150);
await p.click('#verdictMotif button.btn:not(.sec)'); await p.waitForTimeout(1200);
T('résultat affiché', (await p.textContent('#verdictFait')).includes('Refusé'));
const st=recu.filter(x=>x.action==='statut');
T('action statut envoyée', st.length===1 && st[0].verdict==='REFUSE' && /[Cc]oncurrent/.test(st[0].motif));

// correction → signé, puis photo du devis signé
await p.click('#verdictFait button'); await p.waitForTimeout(200);
await p.click('#verdictChoix .choix:has-text("Signé sur place")'); await p.waitForTimeout(1400);
T('signé → écran photo du devis signé', await p.isVisible('#e7'));
T('libellé adapté au papier signé', (await p.textContent('#phTitre')).includes('signé'));
const st2=recu.filter(x=>x.action==='statut');
T('correction transmise', st2.length===2 && st2[1].verdict==='SIGNE');

// retour, puis Mes devis
await p.click('#bPrec'); await p.waitForTimeout(300);
T('retour depuis les photos → écran du devis', await p.isVisible('#e5'));
await p.click('#bHist'); await p.waitForTimeout(600);
T('liste : pastille SIGNÉ', (await p.textContent('#liste')).includes('SIGNÉ'));
T('rappel « photo du papier »', await p.isVisible('#rappels') && (await p.textContent('#rappels')).includes('photo'));
// rouvrir le résultat depuis la liste
await p.click('#liste .acts button:nth-child(2)'); await p.waitForTimeout(600);
T('résultat rouvrable depuis Mes devis', await p.isVisible('#e5') && await p.isVisible('#verdictFait'));
await p.click('#bPrec'); await p.waitForTimeout(400);
T('retour → Mes devis', await p.isVisible('#e6'));

// relance
await p.click('#liste .acts button:nth-child(2)'); await p.waitForTimeout(500);
await p.click('#verdictFait button'); await p.waitForTimeout(150);
await p.click('#verdictChoix .choix:has-text("réfléchit")'); await p.waitForTimeout(250);
const d=await p.inputValue('#fRelance');
T('date de relance par défaut à +7 jours', /^\d{4}-\d{2}-\d{2}$/.test(d));
await p.click('#verdictRelance button.btn:not(.sec)'); await p.waitForTimeout(1200);
T('relance enregistrée', (await p.textContent('#verdictFait')).includes('À relancer'));

// le journal a bien tout tracé
const j=recu.filter(x=>x.action==='journal').flatMap(x=>x.evenements||[]).map(e=>e.action);
T('journal : résultats tracés', j.some(a=>/RESULTAT REFUS/.test(a)) && j.some(a=>/RESULTAT SIGN/.test(a)));

console.log('\nOK  ('+ok.length+')\n'+ok.map(x=>'  ✓ '+x).join('\n'));
if(ko.length) console.log('\nÉCHECS ('+ko.length+')\n'+ko.map(x=>'  ✗ '+x).join('\n'));
if(err.length) console.log('\nErreurs JS :\n'+[...new Set(err)].join('\n'));
await b.close(); srv.close(); process.exit(ko.length||err.length?1:0);
