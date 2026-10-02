/* La liste fixe des prestations (v39) : l'accordéon, les quantités, les
   forfaits, la remise unique, et la reprise d'un brouillon écrit avant elle. */
import {chromium} from 'playwright';
import {lancer, recu} from './srvco.mjs';
import {ajouterUne, poserQte, cocher, ouvrirBloc, allerRemise} from './presta.mjs';
import { CHROME } from './chemins.mjs';

/* Une date d'intervention est obligatoire depuis la v46 : on prend demain,
   pour que l'épreuve ne tombe jamais sur une date déjà passée. */
const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();
const PORT = 8291; await lancer(PORT);
const b = await chromium.launch({executablePath:CHROME});
const c = await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
const ok = [], ko = [];
const T = (n, v, d) => { (v?ok:ko).push(n + (v?'':'  → ' + JSON.stringify(d))); };

async function connexion(){
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
  await p.waitForTimeout(500);
  await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
  await p.click('#bCo'); await p.waitForTimeout(900);
  if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }
}
/* Rouvrir l'application sans se reconnecter : la session tient déjà. */
async function recharger(){
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
  await p.waitForTimeout(900);
}
async function client(){
  await p.click('#chPRO'); await p.waitForTimeout(250);
  await p.click('#chCHA'); await p.waitForTimeout(300);
  await p.fill('#cSociete','MAIRIE DE TEST'); await p.fill('#cContact','Jean Test');
  await p.fill('#cAdresse','1 rue'); await p.fill('#cCp','56250'); await p.fill('#cVille','Monterblanc');
  await p.click('#bSuiv'); await p.waitForTimeout(600);
}

await connexion();
await client();

/* ---------- 1. ce qu'on voit en arrivant ---------- */
T('on arrive sur les prestations', await p.isVisible('#e3'));
T('les trois catégories sont là',
  (await p.$$('#lignes .grp')).length === 3, (await p.$$('#lignes .grp')).length);
T('toutes fermées au départ',
  await p.evaluate(()=>[...document.querySelectorAll('#lignes .grp')].every(g=>!g.classList.contains('on'))));
T('aucune prestation visible tant que rien n\'est ouvert',
  await p.evaluate(()=>[...document.querySelectorAll('#lignes .pres')]
    .every(e=>e.getBoundingClientRect().height === 0)));
T('plus de bouton pour ouvrir un catalogue',
  !(await p.evaluate(()=>[...document.querySelectorAll('#e3 button')]
    .some(x=>/ajouter une prestation/i.test(x.textContent)))));
T('le titre de la catégorie est lisible',
  /Vitrerie/.test(await p.innerText('#grp0')), await p.innerText('#grp0'));

/* ---------- 2. l'accordéon ---------- */
await p.click('#grp0 .grpT'); await p.waitForTimeout(300);
T('un appui ouvre la catégorie',
  await p.evaluate(()=>document.getElementById('grp0').classList.contains('on')));
T('et sa prestation devient visible', await p.isVisible('#pr0'));
T('les autres restent fermées',
  await p.evaluate(()=>!document.getElementById('grp1').classList.contains('on')));
await p.click('#grp1 .grpT'); await p.waitForTimeout(300);
T('deux catégories peuvent rester ouvertes ensemble',
  await p.evaluate(()=>document.getElementById('grp0').classList.contains('on') &&
                       document.getElementById('grp1').classList.contains('on')));
await p.click('#grp0 .grpT'); await p.waitForTimeout(300);
T('un second appui referme',
  await p.evaluate(()=>!document.getElementById('grp0').classList.contains('on')));

/* ---------- 3. poser une quantité ---------- */
await poserQte(p, 0, 24);
T('la ligne entre au devis', await p.evaluate(()=>LIGNES.length) === 1);
T('avec la quantité saisie', await p.evaluate(()=>LIGNES[0].qte) === 24);
T('le total de la ligne s\'affiche', /60,00/.test(await p.innerText('#tt0')),
  await p.innerText('#tt0'));
T('la ligne est mise en évidence',
  await p.evaluate(()=>document.getElementById('pr0').classList.contains('on')));
T('la barre du bas suit', /60,00/.test(await p.innerText('#bTot')), await p.innerText('#bTot'));

/* ---------- 4. le compteur de la catégorie ---------- */
T('le compteur apparaît sur le titre',
  await p.evaluate(()=>!document.getElementById('cpt0').classList.contains('hide')));
T('il dit combien de lignes et combien d\'argent',
  /1/.test(await p.innerText('#cpt0')) && /60,00/.test(await p.innerText('#cpt0')),
  await p.innerText('#cpt0'));
await poserQte(p, 0, 0);
T('quantité effacée : la ligne sort du devis', await p.evaluate(()=>LIGNES.length) === 0);
T('et le compteur disparaît',
  await p.evaluate(()=>document.getElementById('cpt0').classList.contains('hide')));
T('le total de ligne redevient un tiret',
  (await p.innerText('#tt0')).trim() === '—', await p.innerText('#tt0'));

/* ---------- 5. l'ordre des lignes suit le catalogue ---------- */
await cocher(p, 2);                       // le forfait, en dernier au catalogue
await poserQte(p, 1, 10);                 // les bureaux, au milieu
await poserQte(p, 0, 24);                 // la vitrerie, en premier
T('trois lignes au devis', await p.evaluate(()=>LIGNES.length) === 3);
T('elles sont rangées comme le catalogue, pas comme la saisie',
  (await p.evaluate(()=>LIGNES.map(l=>l.reference))).join(',') === 'REF-0001,REF-0002,REF-0003',
  await p.evaluate(()=>LIGNES.map(l=>l.reference)));

/* ---------- 6. le forfait ---------- */
T('le forfait est entré avec une quantité de 1',
  await p.evaluate(()=>LIGNES.find(l=>l.reference==='REF-0003').qte) === 1);
T('son unité est bien un forfait',
  await p.evaluate(()=>LIGNES.find(l=>l.reference==='REF-0003').unite) === 'forfait');
T('la ligne du forfait n\'a pas de champ de quantité',
  await p.evaluate(()=>!document.querySelector('#pr2 input.q')));

/* ---------- 7. l'état des blocs survit à un aller-retour ---------- */
const ouverts = await p.evaluate(()=>[...document.querySelectorAll('#lignes .grp')]
  .map(g=>g.classList.contains('on')));
await p.click('#bSuiv'); await p.waitForTimeout(600);
await p.click('#bPrec'); await p.waitForTimeout(600);
T('les catégories ouvertes le sont restées',
  JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('#lignes .grp')]
    .map(g=>g.classList.contains('on')))) === JSON.stringify(ouverts), ouverts);
T('les quantités sont toujours là',
  await p.evaluate(()=>document.querySelector('#pr0 input.q').value) === '24',
  await p.evaluate(()=>document.querySelector('#pr0 input.q').value));

/* ---------- 8. la calculette de surface ---------- */
await ouvrirBloc(p, 0);
await p.click('#pr0 .lienM2'); await p.waitForTimeout(400);
T('la calculette s\'ouvre sur une prestation', await p.isVisible('#dlgSurf'));
const piece = p.locator('#surfL .piece').first();
await piece.locator('input').nth(0).fill('Hall');
await piece.locator('input').nth(1).fill('5');
await piece.locator('input').nth(2).fill('4');
await p.waitForTimeout(300);
await p.click('button:has-text("Reporter dans la quantité")'); await p.waitForTimeout(500);
T('la surface calculée devient la quantité',
  await p.evaluate(()=>LIGNES[0].qte) === 20, await p.evaluate(()=>LIGNES[0].qte));
T('le détail pièce par pièce est repris',
  /Hall/.test(await p.evaluate(()=>LIGNES[0].detail)), await p.evaluate(()=>LIGNES[0].detail));
T('le total de la ligne est repeint', /50,00/.test(await p.innerText('#tt0')),
  await p.innerText('#tt0'));
T('le forfait n\'a pas de calculette',
  await p.evaluate(()=>!document.querySelector('#pr2 .lienM2')));

/* ---------- 9. la remise unique ---------- */
await allerRemise(p);
T('le bloc de remise est sur l\'écran de validation', await p.isVisible('#cRem'));
await p.fill('#remG','10'); await p.waitForTimeout(400);
T('la remise est reportée sur toutes les lignes',
  await p.evaluate(()=>LIGNES.every(l=>l.rem === 10)),
  await p.evaluate(()=>LIGNES.map(l=>l.rem)));
const tot = await p.evaluate(()=>totaux());
T('le brut est la somme sans remise', tot.brut === 50 + 12 + 40, tot);
T('le net est le brut moins 10 %', tot.ht === 91.8, tot);
T('la remise affichée est la différence exacte', tot.remise === 10.2, tot);
const recapTxt = await p.innerText('#recap');
T('le récapitulatif montre le sous-total', /Sous-total HT/.test(recapTxt), recapTxt);
T('il montre la remise, une seule fois',
  (recapTxt.match(/Remise/g) || []).length === 1, recapTxt);
T('il montre le total remisé', /91,80/.test(recapTxt), recapTxt);
T('les sous-totaux par poste sont bruts', /50,00/.test(recapTxt), recapTxt);
await p.fill('#remG','0'); await p.waitForTimeout(400);
T('remise remise à zéro : plus de ligne de remise',
  !/Sous-total HT/.test(await p.innerText('#recap')));

/* ---------- 10. l'étape refuse de passer à vide ---------- */
await p.click('#bPrec'); await p.waitForTimeout(500);
await p.evaluate(()=>{ LIGNES = []; rendreLignes(); });
await p.click('#bSuiv'); await p.waitForTimeout(400);
T('sans aucune prestation, on ne passe pas',
  await p.isVisible('#e3') && /au moins une prestation/i.test(await p.innerText('#erreur')),
  await p.innerText('#erreur'));

/* ---------- 11. reprise d'un brouillon écrit avant la remise unique ---------- */
await p.evaluate(()=>{
  // Un brouillon de la v38 : remise portée par les lignes, et une prestation
  // qui n'existe plus au catalogue.
  localStorage.setItem('brouillon', JSON.stringify({
    client:{type:'PRO',societe:'ANCIEN CLIENT',contact:'X',adresse:'1 rue',cp:'56000',ville:'VANNES'},
    lignes:[
      {categorie:'Finitions',reference:'REF-0003',designation:'Contrôle qualité',detail:'',
       qte:1,unite:'forfait',pu:40,rem:7,tva:20,type:'PONCTUEL'},
      {categorie:'Vitrerie',reference:'REF-0001',designation:'Nettoyage de vitres',detail:'',
       qte:12,unite:'m²',pu:2.5,rem:3,tva:20,type:'PONCTUEL'},
      {categorie:'Disparu',reference:'REF-9999',designation:'Prestation retirée',detail:'',
       qte:2,unite:'pièce(s)',pu:15,rem:0,tva:20,type:'PONCTUEL'}
    ],
    objet:'Ancien devis', plus2ans:null, taux:20, delai:'', notes:''
  }));
});
await recharger();
if(await p.isVisible('#dlgConf')){ await p.click('#confOui'); await p.waitForTimeout(900); }
T('le brouillon d\'avant est repris sur la fiche client', await p.isVisible('#e2'));
T('le client repris est le bon',
  (await p.inputValue('#cSociete')) === 'ANCIEN CLIENT', await p.inputValue('#cSociete'));
await p.click('#bSuiv'); await p.waitForTimeout(700);
T('et on retrouve la liste des prestations', await p.isVisible('#e3'));
T('la remise la plus forte des lignes devient la remise du devis',
  await p.evaluate(()=>REMISE.valeur) === 7, await p.evaluate(()=>REMISE.valeur));
T('elle est reportée sur toutes les lignes, même celle à 3 %',
  await p.evaluate(()=>LIGNES.every(l=>l.rem === 7)),
  await p.evaluate(()=>LIGNES.map(l=>l.rem)));
T('les lignes reprises sont remises dans l\'ordre du catalogue',
  (await p.evaluate(()=>LIGNES.map(l=>l.reference))).join(',') === 'REF-0001,REF-0003,REF-9999',
  await p.evaluate(()=>LIGNES.map(l=>l.reference)));
T('les quantités reprises s\'affichent dans la liste',
  await p.evaluate(()=>document.querySelector('#pr0 input.q').value) === '12',
  await p.evaluate(()=>document.querySelector('#pr0 input.q').value));
T('le forfait repris est coché',
  (await p.innerText('#pr2 .coche')).trim() === 'Inclus', await p.innerText('#pr2 .coche'));
T('la prestation disparue du catalogue n\'est pas effacée en silence',
  await p.isVisible('#grpHors'));
T('elle est nommée', /Prestation retirée/.test(await p.innerText('#grpHors')),
  await p.innerText('#grpHors'));
T('et on dit pourquoi elle est là',
  /ne figure plus au catalogue/.test(await p.innerText('#grpHors')));
await p.click('#grpHors .coche'); await p.waitForTimeout(400);
T('on peut la retirer',
  await p.evaluate(()=>!LIGNES.some(l=>l.reference==='REF-9999')));
T('et le bloc disparaît avec elle', !(await p.isVisible('#grpHors')));

/* ---------- 12. le devis enregistré porte sa remise ---------- */
await p.click('#bSuiv'); await p.waitForTimeout(600);
await p.fill('#fDate', DEMAIN); await p.fill('#fDelai','sous 15 jours');
recu.length = 0;
for(let i = 0; i < 4; i++){
  if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break;
  await p.click('#bSuiv'); await p.waitForTimeout(1200);
}
await p.waitForTimeout(1200);
const envoi = recu.find(x => x && x.devis);
T('le devis est parti au bureau', !!envoi);
T('il porte la remise du devis', envoi && Number(envoi.devis.remise) === 7,
  envoi && envoi.devis.remise);
T('chaque ligne porte le même taux',
  envoi && envoi.devis.lignes.every(l => Number(l.rem) === 7),
  envoi && envoi.devis.lignes.map(l => l.rem));
T('le total envoyé est le total remisé',
  envoi && Math.abs(envoi.devis.totaux.ht - 65.1) < 0.01,
  envoi && envoi.devis.totaux);
T('le PDF a bien été fabriqué', !!(envoi && envoi.pdf && envoi.pdf.length > 5000),
  envoi && (envoi.pdf || '').length);

/* ---------- 13. un devis neuf repart à zéro ---------- */
await p.evaluate(()=>nouveauDevis()); await p.waitForTimeout(800);
T('la remise est remise à zéro', await p.evaluate(()=>REMISE.valeur) === 0);
T('les catégories sont refermées', await p.evaluate(()=>Object.keys(GRP).length === 0));

await b.close();
console.log('\n=== LISTE FIXE DES PRESTATIONS : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length ? 1 : 0);
