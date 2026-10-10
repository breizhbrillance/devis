/* Le commercial ne choisit pas les prix du catalogue : ce que l'écran laisse
   faire, et ce qu'il ne laisse pas faire. La ligne libre est la seule porte,
   elle est à part et elle est signalée — voir tlibre.mjs. */
import {chromium} from 'playwright';
import {lancer, recu} from './srvco.mjs';
import {ajouterUne, poserQte, cocher, ouvrirBloc, allerRemise} from './presta.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8271; await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p=await c.newPage();
const err=[]; p.on('pageerror',e=>err.push(String(e)));
const ok=[],ko=[];
const T=(n,v,d)=>{ (v?ok:ko).push(n+(v?'':'  → '+JSON.stringify(d))); };

await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
await p.waitForTimeout(500);

/* connexion */
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }

/* un client, puis l'écran des prestations */
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chCHA'); await p.waitForTimeout(300);
await p.fill('#cSociete','MAIRIE DE TEST'); await p.fill('#cContact','Jean Test');
await p.fill('#cAdresse','1 rue du Test'); await p.fill('#cCp','56250'); await p.fill('#cVille','Monterblanc');
await p.click('#bSuiv'); await p.waitForTimeout(500);
T('on arrive à l\'écran des prestations', await p.isVisible('#e3'));

/* ---------- 1. rien ne s'invente sur cet écran ---------- */
T('plus de fenêtre de catalogue à ouvrir',
  await p.evaluate(()=>typeof ouvrirCatalogue === 'undefined'));
T('le catalogue est affiché en entier',
  (await p.$$('#lignes .grp:not(.lib)')).length === 3,
  (await p.$$('#lignes .grp:not(.lib)')).length);
T('chaque prestation du classeur a sa ligne',
  (await p.$$('#lignes .pres')).length === 3, (await p.$$('#lignes .pres')).length);
/* La ligne libre existe, mais elle est à part : elle ne se glisse pas au
   milieu du catalogue, et aucun prix du catalogue ne devient saisissable. */
T('le bloc « Ligne libre » est le dernier de la liste',
  await p.evaluate(()=>{
    const g=[...document.querySelectorAll('#lignes .grp')];
    return g.length>0 && g[g.length-1].classList.contains('lib');
  }));
T('aucun champ de prix dans les blocs du catalogue',
  await p.evaluate(()=>[...document.querySelectorAll('#lignes .grp:not(.lib) input')]
    .every(e=>e.classList.contains('q'))));

/* ---------- 2. une quantité posée fait la ligne ---------- */
await ajouterUne(p, 0);
T('la prestation entre au devis', await p.evaluate(()=>LIGNES.length) === 1);

const l0 = await p.evaluate(()=>LIGNES[0]);
T('elle arrive avec le prix du catalogue', l0.pu === 2.5, l0);
T('elle garde sa référence', l0.reference === 'REF-0001', l0);
T('elle garde son unité', l0.unite === 'm²', l0);
T('elle garde sa catégorie', l0.categorie === 'Vitrerie', l0);

/* ---------- 3. ce que la ligne laisse saisir ---------- */
const saisie = await p.evaluate(()=>{
  const r = document.getElementById('pr0');
  return [...r.querySelectorAll('input,select,textarea')].map(e=>e.className+':'+e.type);
});
T('un seul champ par prestation, la quantité',
  saisie.length === 1 && /q/.test(saisie[0]), saisie);
const vu0 = await p.innerText('#pr0');
T('le prix est montré, pas saisi', /2,50/.test(vu0), vu0);
T('l\'unité est montrée, pas saisie', /m²/.test(vu0), vu0);
T('aucune TVA à régler sur la ligne', !/TVA/i.test(vu0), vu0);
T('aucun poste à retaper', !/poste/i.test(vu0), vu0);
T('aucune remise sur la ligne', !/remise/i.test(vu0), vu0);

/* ---------- 4. un forfait se coche ---------- */
T('le forfait n\'a pas de champ de quantité',
  await p.evaluate(()=>!document.querySelector('#pr2 input.q')));
await cocher(p, 2);
T('coché, le forfait entre au devis avec une quantité de 1',
  await p.evaluate(()=>{ const l=LIGNES.find(x=>x.reference==='REF-0003'); return l && l.qte===1; }));
T('le pas le dit', (await p.innerText('#pr2 .pas')).replace(/\s|−|\+/g, '') === '1',
  await p.innerText('#pr2 .pas'));
await cocher(p, 2);
T('décoché, il ressort du devis',
  await p.evaluate(()=>!LIGNES.some(x=>x.reference==='REF-0003')));

/* ---------- 5. une quantité à zéro retire la ligne ---------- */
await poserQte(p, 0, 0);
T('quantité vidée : plus de ligne', await p.evaluate(()=>LIGNES.length) === 0);
await poserQte(p, 0, 100);
T('quantité reposée : la ligne revient', await p.evaluate(()=>LIGNES.length) === 1);
T('le total de ligne est juste', await p.evaluate(()=>montantL(LIGNES[0])) === 250,
  await p.evaluate(()=>montantL(LIGNES[0])));
T('une quantité négative est ramenée à zéro',
  await p.evaluate(()=>{ poser('R:REF-0001', -5); return LIGNES.length; }) === 0);
await poserQte(p, 0, 100);

/* ---------- 6. par la porte de derrière ---------- */
T('poser refuse une prestation inconnue du catalogue',
  await p.evaluate(()=>{ const n=LIGNES.length; poser('R:INVENTEE', 3); return LIGNES.length===n; }));
T('une ligne libre ne peut pas se faire passer pour une prestation du catalogue',
  await p.evaluate(()=>{
    const l = ajouterLigneLibre();
    const imposteur = (l.reference === 'R:REF-0001') || !estLigneLibre(l);
    LIGNES.splice(LIGNES.indexOf(l), 1);
    return !imposteur;
  }));

/* ---------- 7. le plafond de remise tient ---------- */
await allerRemise(p);
T('le bloc de remise est là', await p.isVisible('#cRem'));
T('son étiquette ne révèle pas le plafond de l\'entreprise',
  !/max/i.test(await p.innerText('#cRem')), await p.innerText('#cRem'));
await p.fill('#remG','50'); await p.waitForTimeout(400);
T('une remise de 50 % est ramenée à 10',
  await p.evaluate(()=>REMISE.valeur) === 10, await p.evaluate(()=>REMISE.valeur));
T('et le plafond est reporté sur la ligne',
  await p.evaluate(()=>LIGNES[0].rem) === 10, await p.evaluate(()=>LIGNES[0].rem));
await p.fill('#remG','7'); await p.waitForTimeout(400);
T('une remise sous le plafond passe',
  await p.evaluate(()=>REMISE.valeur) === 7, await p.evaluate(()=>REMISE.valeur));
T('le total suit la remise',
  await p.evaluate(()=>totaux().ht) === 232.5, await p.evaluate(()=>totaux().ht));
T('le brut reste le brut',
  await p.evaluate(()=>totaux().brut) === 250, await p.evaluate(()=>totaux().brut));
T('la remise affichée est la différence exacte',
  await p.evaluate(()=>totaux().remise) === 17.5, await p.evaluate(()=>totaux().remise));
await p.evaluate(()=>{ setRemiseGlobale('90'); });
await p.waitForTimeout(300);
T('setRemiseGlobale plafonne même sans passer par le champ',
  await p.evaluate(()=>REMISE.valeur) === 10, await p.evaluate(()=>REMISE.valeur));

/* ---------- 8. plafond à zéro : le bloc disparaît ---------- */
await p.evaluate(()=>{ CFG.reglages.remise_max = '0'; setRemiseGlobale('0'); ecranRemise(); });
await p.waitForTimeout(300);
T('plafond à 0 : plus de bloc de remise',
  await p.evaluate(()=>document.getElementById('cRem').classList.contains('hide')));
await p.evaluate(()=>{ setRemiseGlobale('5'); });
T('plafond à 0 : une remise imposée par la porte de derrière est annulée',
  await p.evaluate(()=>REMISE.valeur) === 0, await p.evaluate(()=>REMISE.valeur));
T('et les lignes repassent au plein tarif',
  await p.evaluate(()=>LIGNES.every(l=>!l.rem)));

await b.close();
console.log('\n=== PRIX VERROUILLÉS (écran) : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
console.log('\nerreurs JS : '+(err.length?err.join(' | '):'aucune'));
process.exit(ko.length?1:0);
