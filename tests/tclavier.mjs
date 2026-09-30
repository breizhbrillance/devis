/* Le signe % est-il vraiment tapable au clavier, touche par touche ? */
import {chromium} from 'playwright';
import {lancer} from './srvco.mjs';
import {ajouterUne, poserQte, cocher, ouvrirBloc, allerRemise} from './presta.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8297; await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const c=await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p=await c.newPage();
const ok=[],ko=[]; const T=(n,v,d)=>{ (v?ok:ko).push(n+(v?'':'  → '+JSON.stringify(d))); };
await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.fill('#cSociete','X'); await p.fill('#cContact','Y'); await p.fill('#cAdresse','1 rue');
await p.fill('#cCp','56250'); await p.fill('#cVille','Z');
await p.click('#bSuiv'); await p.waitForTimeout(500);
await ajouterUne(p, 0);
await allerRemise(p);

const champ = p.locator('#remG');
await champ.click(); await p.keyboard.press('Control+a'); await p.keyboard.press('Delete');
await p.keyboard.type('5'); await p.waitForTimeout(350);
T('« 5 » frappé touche par touche : le message s\'affiche',
  await p.evaluate(()=>!document.getElementById('plafG').classList.contains('hide')));
await p.keyboard.type('%'); await p.waitForTimeout(350);
T('le caractère % reste bien dans le champ',
  (await champ.inputValue()) === '5%', await champ.inputValue());
T('et le message se tait aussitôt',
  await p.evaluate(()=>document.getElementById('plafG').classList.contains('hide')));
T('la remise vaut toujours 5', await p.evaluate(()=>LIGNES[0].rem) === 5,
  await p.evaluate(()=>LIGNES[0].rem));
await p.keyboard.press('Backspace'); await p.waitForTimeout(350);
T('on efface le signe : le message revient',
  await p.evaluate(()=>!document.getElementById('plafG').classList.contains('hide')));

await b.close();
console.log('\n=== LE SIGNE AU CLAVIER : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x)); ko.forEach(x=>console.log('  ✗ '+x));
process.exit(ko.length?1:0);
