import {chromium} from 'playwright';
import {lancer, recu, mode} from './srv2.mjs';
import fs from 'node:fs';
import {ajouterUne, poserQte, cocher, ouvrirBloc, allerRemise} from './presta.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8266, srv=await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const ctx=await b.newContext({viewport:{width:320,height:640},deviceScaleFactor:2});
const p=await ctx.newPage();
const jsErr=[]; p.on('pageerror',e=>jsErr.push(String(e)));
const natif=[]; p.on('dialog', async d=>{ natif.push(d.type()+':'+d.message().slice(0,40)); await d.dismiss(); });
const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };
const msg=()=>p.evaluate(()=>{const e=document.getElementById('erreur');
  return (e&&!e.classList.contains('hide'))?e.textContent.trim():'';});
const ecran=()=>p.evaluate(()=>{const s=[...document.querySelectorAll('section')]
  .find(x=>!x.classList.contains('hide'));return s?s.id:'?';});

mode.sync='ok';
await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(1000);
if(await p.isVisible('#eAccord')) { await p.click('#bAccord'); await p.waitForTimeout(300); }

// 1. bornes sur les quantités
await p.click('#chPRO'); await p.waitForTimeout(200);
await p.fill('#cSociete','SYNDIC ARMOR'); await p.fill('#cContact','Mme Le Gall');
await p.fill('#cAdresse','12 rue Nicolazic'); await p.fill('#cCp','56000'); await p.fill('#cVille','VANNES');
await p.click('#bSuiv'); await p.waitForTimeout(400);
await poserQte(p, 0, 24);
const qte = p.locator('#pr0 input.q');
await qte.fill('-5'); await p.waitForTimeout(250);
T('quantité négative ramenée à 0',
  (await p.evaluate(()=>LIGNES.length))===0 && (await qte.inputValue())==='',
  await p.evaluate(()=>LIGNES.length));
await qte.fill('24'); await p.waitForTimeout(250);
T('on peut toujours taper une décimale', await (async()=>{ await qte.fill('0.5'); await p.waitForTimeout(250);
  return (await p.evaluate(()=>LIGNES[0].qte))===0.5; })());
await qte.fill('24'); await p.waitForTimeout(250);

// 2. montant insécable
T('montant insécable dans la barre',
  / €/.test(await p.evaluate(()=>document.getElementById('bTot').textContent)),
  await p.evaluate(()=>document.getElementById('bTot').textContent));

// 3. les cibles se visent au pouce
const hQ = await p.evaluate(()=>document.querySelector('#pr0 input.q').getBoundingClientRect().height);
T('champ de quantité ≥ 40 px', hQ>=40, hQ);
const hT = await p.evaluate(()=>document.querySelector('#lignes .grpT').getBoundingClientRect().height);
T('titre de catégorie ≥ 44 px', hT>=44, hT);
await ouvrirBloc(p, 2);
const hC = await p.evaluate(()=>{ const e=document.querySelector('#pr2 .coche');
  return e ? e.getBoundingClientRect().height : 0; });
T('coche de forfait ≥ 44 px', hC>=44, hC);

// 3 bis. la remise, au plafond du bureau
await p.click('#bSuiv'); await p.waitForTimeout(600);
const rem = p.locator('#remG');
await rem.fill('150'); await p.waitForTimeout(250);
T('remise ramenée au plafond du bureau',
  (await p.evaluate(()=>LIGNES[0].rem))===10, await p.evaluate(()=>LIGNES[0].rem));
await rem.fill('0'); await p.waitForTimeout(250);
await p.click('#bPrec'); await p.waitForTimeout(400);

// 4. e-mail douteux signalé puis laissé passer
await p.click('#bPrec'); await p.waitForTimeout(300);
await p.fill('#cEmail','pas-un-email'); await p.click('#bSuiv'); await p.waitForTimeout(400);
T('e-mail incomplet signalé', /e-mail/.test(await msg()) && await ecran()==='e2', await msg());
await p.click('#bSuiv'); await p.waitForTimeout(400);
T('deuxième appui : on passe quand même', await ecran()==='e3');
await p.click('#bPrec'); await p.waitForTimeout(250);
await p.fill('#cEmail','contact@syndic-armor.fr'); await p.click('#bSuiv'); await p.waitForTimeout(400);

// 5. enregistrement + panne serveur
mode.sync='html';
for(let i=0;i<5;i++){ if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break; await p.click('#bSuiv'); await p.waitForTimeout(700); }
await p.waitForTimeout(1500);
const etat = (await p.textContent('#okEtat')).trim();
T('panne serveur : message lisible', !/JSON|token|<|Failed|TypeError/.test(etat), etat);
T('panne serveur : message rassurant', /rien n'est perdu/i.test(etat), etat);

// 6. le détail technique est parti au journal
const j = recu.filter(x=>x.action==='journal').flatMap(x=>x.evenements||[]);
T('détail technique tracé au journal', j.some(e=>/ENVOI ECHOUE/.test(e.action)),
  j.map(e=>e.action));

// 7. « Mes devis » : pas de bouton vers l'écran courant, ⟳ nommé
await p.click('#bHist'); await p.waitForTimeout(800);
T('bouton « Mes devis » masqué sur Mes devis', !(await p.isVisible('#bHist')));
const acts = (await p.textContent('#liste .acts')).replace(/\s+/g,' ').trim();
T('plus de symbole ⟳ seul', !acts.includes('⟳') && /Renvoyer/.test(acts), acts);
const liste = await p.textContent('#liste');
T('montant non coupé dans la liste', liste.includes(' € TTC') || / €/.test(liste),
  liste.replace(/\s+/g,' ').slice(0,120));

// 8. accès retiré depuis Mes devis
mode.sync='refus';
await p.evaluate(()=>{ DB.tous().then(l=>l.forEach(e=>{e.statut='attente'; DB.put(e);})); });
await p.waitForTimeout(400);
await p.evaluate(()=>synchroniser(true)); await p.waitForTimeout(2500);
T('accès retiré → retour à la connexion', await ecran()==='eCo', await ecran());
T('accès retiré → message affiché', /accès/i.test(await msg()), await msg());

// 9. plus aucune fenêtre du navigateur
T('aucun dialogue natif', natif.length===0, natif);

console.log('OK  ('+ok.length+')\n'+ok.map(x=>'  ✓ '+x).join('\n'));
if(ko.length) console.log('\nÉCHECS ('+ko.length+')\n'+ko.map(x=>'  ✗ '+x).join('\n'));
console.log('\nerreurs JS :', jsErr.length?[...new Set(jsErr)]:'aucune');
await b.close(); srv.close(); process.exit(ko.length||jsErr.length?1:0);
