/* L'objet du devis, rempli tout seul (26 octobre 2026).

   L'objet s'imprime en titre, tout en haut : « DEVIS — ENTRETIEN DES LOCAUX ».
   Le commercial le tapait à la main devant le client, et l'oubliait parfois :
   le devis sortait alors sous un titre nu. Il se remplit maintenant à partir de
   la nature choisie.

   Ce que ces essais gardent :
   — chaque nature pose son objet, dans les mêmes mots que le classeur et le
     planning ;
   — changer de nature change l'objet, tant que le commercial n'a rien écrit ;
   — dès qu'il a écrit quelque chose, plus rien ne l'efface — un titre choisi
     devant le client ne doit pas disparaître d'un revers de pastille ;
   — l'objet part au bureau et s'imprime en titre du devis.
*/
import {chromium} from 'playwright';
import {lancer, recu} from './srvco.mjs';
import {CHROME} from './chemins.mjs';
import {poserQte} from './presta.mjs';

const PORT = 8401; await lancer(PORT);
const b = await chromium.launch({executablePath:CHROME});
const c = await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
const ok = [], ko = [];
const T = (n, v, d) => { (v?ok:ko).push(n + (v?'':'  → ' + JSON.stringify(d))); };

await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
await p.waitForTimeout(500);
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(1000);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(400); }

/* Le champ vit sur l'écran des prestations : on le LIT de partout, on n'y
   ÉCRIT que là-bas. */
const objet = () => p.inputValue('#fObjet');
/* Une fin de chantier, une remise en état et une façade emmènent aussitôt au
   client ; l'entretien et la vitrerie restent sur place, il leur manque une
   fréquence. On revient donc d'un pas seulement quand il le faut. */
async function choisir(id){
  while(!(await p.isVisible('#blocNature'))){
    await p.click('#bPrec'); await p.waitForTimeout(450);
  }
  await p.click(id); await p.waitForTimeout(650);
}
async function remplirClient(nom){
  await p.fill('#cSociete', nom); await p.fill('#cContact','Jean Test');
  await p.fill('#cAdresse','1 rue du Test'); await p.fill('#cCp','56250');
  await p.fill('#cVille','Monterblanc');
  await p.click('#bSuiv'); await p.waitForTimeout(800);
}

/* ---------- 1. chaque nature pose son objet ---------- */
await p.click('#chPRO'); await p.waitForTimeout(300);
await choisir('#chCHA');
T('une fin de chantier s\'intitule toute seule',
  (await objet()) === 'Nettoyage de fin de chantier', await objet());
await choisir('#chREM');
T('une remise en état aussi', (await objet()) === 'Remise en état', await objet());
await choisir('#chFAC');
T('la façade aussi', (await objet()) === 'Nettoyage de façade', await objet());
await choisir('#chVIT');
T('la vitrerie aussi', (await objet()) === 'Vitrages et menuiseries', await objet());
await choisir('#chENT');
T('et l\'entretien des locaux', (await objet()) === 'Entretien des locaux', await objet());

/* Les mots sont ceux du classeur : le devis, le tableau du gérant et la fiche
   du salarié doivent nommer la même chose de la même façon. */
T('l\'objet est le libellé de la nature, pas un texte à part',
  await p.evaluate(() => objetAuto() === libelleNature(NATURE)));

/* ---------- 2. ce que le commercial écrit est intouchable ---------- */
await choisir('#chREM');
await remplirClient('MAIRIE OBJET');
T('on arrive aux prestations', await p.isVisible('#e3'));
T('et l\'objet y est déjà', (await objet()) === 'Remise en état', await objet());

await p.fill('#fObjet', 'Nettoyage maison fin de chantier');
await p.waitForTimeout(300);
await choisir('#chCHA');
T('un objet écrit à la main survit au changement de nature',
  (await objet()) === 'Nettoyage maison fin de chantier', await objet());
await p.click('#bSuiv'); await p.waitForTimeout(800);   // retour aux prestations
T('il tient aussi en revenant sur l\'écran des prestations',
  (await objet()) === 'Nettoyage maison fin de chantier', await objet());

/* Vidé, il redevient automatique : c'est le moyen de reprendre la main. */
await p.fill('#fObjet', ''); await p.waitForTimeout(250);
await choisir('#chREM');
T('vidé, il se remplit de nouveau', (await objet()) === 'Remise en état', await objet());

/* ---------- 2 bis. le filet de l'écran des prestations ----------
   Un brouillon commencé avant cette version, ou repris sans titre, n'a pas à
   sortir sous un « DEVIS » nu : l'objet se repose en arrivant sur l'écran des
   prestations, sans qu'on ait retouché la nature. */
await p.evaluate(() => { const e = document.getElementById('fObjet'); if(e) e.value = ''; });
T('on peut se retrouver sans objet', (await objet()) === '', await objet());
/* On repasse par le client puis on revient : c'est le chemin d'un brouillon
   repris. On le fait par la navigation de l'application elle-même, pour ne pas
   dépendre de quel bouton est visible à quel moment. */
await p.evaluate(() => { etape(2); });
await p.waitForTimeout(500);
T('on est bien reparti du client', await p.isVisible('#e2'));
await p.evaluate(() => { etape(3); });
await p.waitForTimeout(700);
T('revenir aux prestations repose l\'objet', (await objet()) === 'Remise en état',
  await objet());

/* ---------- 3. il part au bureau et s'imprime ---------- */
await p.click('#bSuiv'); await p.waitForTimeout(800);
await poserQte(p, 0, 25);
await p.waitForTimeout(300);
recu.length = 0;
for(let i = 0; i < 4; i++){
  if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break;
  await p.click('#bSuiv'); await p.waitForTimeout(1400);
}
await p.waitForTimeout(1200);
const envoi = recu.find(x => x && x.devis);
T('le devis part au bureau', !!envoi, recu.length);
T('et il porte son objet', envoi && envoi.devis.objet === 'Remise en état',
  envoi && envoi.devis.objet);

const texte = envoi ? await p.evaluate(async (d) => {
  const b64 = PDF.base64(d, CFG.reglages);
  await chargerLecteur();
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map(i=>i.str).join(' ');
}, envoi.devis) : '';
T('le PDF le porte en titre, en majuscules',
  /DEVIS\s*-\s*REMISE EN [EÉ]TAT/i.test(texte), texte.slice(0, 220));

/* ---------- 4. un devis neuf repart propre ---------- */
await p.evaluate(() => { nouveauDevis(); });
await p.waitForTimeout(1000);
T('un devis neuf n\'a plus d\'objet', (await objet()) === '', await objet());
await p.click('#chPRO'); await p.waitForTimeout(300);
await choisir('#chCHA');
T('et il se remplit dès le choix de la nature',
  (await objet()) === 'Nettoyage de fin de chantier', await objet());

T('aucune erreur de page', err.length === 0, err.slice(0,3));

await c.close(); await b.close();
console.log('\n=== L\'OBJET DU DEVIS, REMPLI TOUT SEUL : ' + ok.length + ' au vert, ' +
            ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
