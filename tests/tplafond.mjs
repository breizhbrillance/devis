/* Le rappel « Remise maximale accordée » : quand il s'affiche, quand il se tait,
   et le fait que le signe % soit l'interrupteur. Plafond du banc d'essai : 10 %. */
import {chromium} from 'playwright';
import {lancer} from './srvco.mjs';
import {ajouterUne, poserQte, cocher, ouvrirBloc, allerRemise} from './presta.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8281; await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p=await c.newPage();
const err=[]; p.on('pageerror',e=>err.push(String(e)));
const ok=[],ko=[];
const T=(n,v,d)=>{ (v?ok:ko).push(n+(v?'':'  → '+JSON.stringify(d))); };

await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
await p.waitForTimeout(500);
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.fill('#cSociete','MAIRIE DE TEST'); await p.fill('#cContact','Jean Test');
await p.fill('#cAdresse','1 rue'); await p.fill('#cCp','56250'); await p.fill('#cVille','Monterblanc');
await p.click('#bSuiv'); await p.waitForTimeout(500);
await ajouterUne(p, 0);
// La remise porte sur le devis entier : elle se saisit à l'étape suivante,
// à côté du total, et non plus sur chaque ligne.
await allerRemise(p);

const champ = p.locator('#remG');
const visible = ()=>p.evaluate(()=>{
  const e=document.getElementById('plafG');
  return !!e && !e.classList.contains('hide');
});
const texte = ()=>p.evaluate(()=>{
  const e=document.getElementById('plafG');
  return e ? e.textContent.trim() : '(absent)';
});
async function taper(v){ await champ.fill(v); await p.waitForTimeout(350); }

/* ---------- au départ ---------- */
T('le champ remise accepte du texte',
  await champ.evaluate(e=>e.getAttribute('type')) === 'text');
T('aucun pavé numérique imposé : le signe % reste atteignable au clavier',
  await champ.evaluate(e=>e.getAttribute('inputmode')) === null,
  await champ.evaluate(e=>e.getAttribute('inputmode')));
T('l\'étiquette ne révèle plus le plafond de l\'entreprise',
  !/max/i.test(await p.innerText('#cRem')),
  await p.innerText('#cRem'));
T('aucun rappel au départ', !(await visible()), await texte());

/* ---------- une remise modeste, sans le signe ---------- */
await taper('3');
T('3 sans signe : la remise est prise', await p.evaluate(()=>REMISE.valeur) === 3);
T('3 sans signe : elle est reportée sur la ligne',
  await p.evaluate(()=>LIGNES[0].rem) === 3);
T('3 sans signe : le rappel s\'affiche — le maximum dépend du chantier', await visible());

/* ---------- 3 avec le signe : muet ---------- */
await taper('3 %');
T('3 % : le rappel se tait', !(await visible()));

/* ---------- au plafond de l'entreprise, sans le signe ---------- */
await taper('10');
T('10 sans signe : le rappel s\'affiche', await visible());
T('le texte est celui montré au client',
  (await texte()) === 'Remise maximale accordée', await texte());

/* ---------- au plafond, avec le signe ---------- */
await taper('10 %');
T('10 % : la remise est la même', await p.evaluate(()=>LIGNES[0].rem) === 10,
  await p.evaluate(()=>LIGNES[0].rem));
T('10 % : le rappel se tait', !(await visible()));
T('le signe est mémorisé sur la ligne', await p.evaluate(()=>LIGNES[0].remMuet) === true);

/* ---------- le signe collé au nombre ---------- */
await taper('10%');
T('« 10% » sans espace : le rappel se tait aussi', !(await visible()));

/* ---------- au-delà du plafond ---------- */
await taper('40');
T('40 sans signe : ramené au plafond', await p.evaluate(()=>LIGNES[0].rem) === 10,
  await p.evaluate(()=>LIGNES[0].rem));
T('40 sans signe : le rappel explique le ramené', await visible());
T('le champ affiche la valeur corrigée', (await champ.inputValue()).indexOf('10') === 0,
  await champ.inputValue());

await taper('40 %');
T('40 % : ramené au plafond aussi', await p.evaluate(()=>LIGNES[0].rem) === 10);
T('40 % : et le rappel reste muet', !(await visible()));

/* ---------- on redescend ---------- */
await taper('2');
T('2 sans signe : le rappel revient', await visible());
T('et le signe est oublié', await p.evaluate(()=>LIGNES[0].remMuet) === false);
await taper('0');
T('remise à zéro : aucun rappel, il n\'aurait pas de sens', !(await visible()));

/* ---------- la virgule ---------- */
await taper('5,5');
T('« 5,5 » est compris comme 5,5', await p.evaluate(()=>LIGNES[0].rem) === 5.5,
  await p.evaluate(()=>LIGNES[0].rem));
await taper('5,5 %');
T('« 5,5 % » : valeur juste et rappel muet',
  await p.evaluate(()=>LIGNES[0].rem) === 5.5 && !(await visible()),
  await p.evaluate(()=>LIGNES[0].rem));

/* ---------- saisie vide ou absurde ---------- */
await taper('');
T('champ vidé : remise à 0, pas de rappel',
  await p.evaluate(()=>LIGNES[0].rem) === 0 && !(await visible()));
await taper('abc');
T('texte absurde : remise à 0, aucune erreur',
  await p.evaluate(()=>LIGNES[0].rem) === 0);
await taper('-8');
T('valeur négative : ramenée à 0',
  await p.evaluate(()=>LIGNES[0].rem) === 0, await p.evaluate(()=>LIGNES[0].rem));

/* ---------- le calcul ne dépend pas du signe ---------- */
await taper('10');
const avec = await p.evaluate(()=>montantL(LIGNES[0]));
await taper('10 %');
const sans = await p.evaluate(()=>montantL(LIGNES[0]));
T('le signe ne change pas le montant de la ligne', avec === sans, {avec, sans});

/* ---------- le rappel survit à un redessin ---------- */
await taper('10');
await p.evaluate(()=>ecranRemise());
await p.waitForTimeout(300);
T('après redessin, le rappel est toujours là', await visible());
await taper('10 %');
await p.evaluate(()=>ecranRemise());
await p.waitForTimeout(300);
T('après redessin, le silence est respecté', !(await visible()));
T('après redessin, le champ réaffiche le signe',
  /%/.test(await p.locator('#remG').inputValue()),
  await p.locator('#remG').inputValue());

/* ---------- lisible à bout de bras ---------- */
await taper('10');
const style = await p.evaluate(()=>{
  const e=document.getElementById('plafG'); const s=getComputedStyle(e);
  return {taille:parseFloat(s.fontSize), couleur:s.color, gras:s.fontWeight};
});
T('le rappel fait au moins 14 px', style.taille >= 14, style);
T('le rappel est rouge', /rgb\(185, 28, 28\)/.test(style.couleur), style.couleur);

/* ---------- plafond à zéro ---------- */
await p.evaluate(()=>{ CFG.reglages.remise_max='0'; setRemiseGlobale('0'); ecranRemise(); });
await p.waitForTimeout(300);
T('plafond à 0 : le bloc de remise disparaît',
  await p.evaluate(()=>document.getElementById('cRem').classList.contains('hide')));
T('plafond à 0 : plus aucune remise sur les lignes',
  await p.evaluate(()=>LIGNES.every(l=>!l.rem)));

await b.close();
console.log('\n=== RAPPEL DU PLAFOND : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
console.log('\nerreurs JS : '+(err.length?err.join(' | '):'aucune'));
process.exit(ko.length?1:0);
