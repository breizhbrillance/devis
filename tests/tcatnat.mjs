/* Le catalogue selon la nature du devis.

   Le décapage de la laitance ne se vend qu'en fin de chantier, le nettoyage
   vapeur des sols qu'en remise en état, et tout le reste partout. La colonne
   NATURES du CATALOGUE le dit ; vide, la prestation se vend dans les trois.

   Le piège que ces contrôles gardent : une prestation déjà chiffrée puis
   retirée du catalogue par un changement de nature. Si elle restait dans le
   devis, elle serait comptée au total sans s'afficher nulle part. */
import {chromium} from 'playwright';
import {lancer, recu, catalogueSup} from './srvco.mjs';
import {CHROME} from './chemins.mjs';
import {poserQte} from './presta.mjs';

catalogueSup.push(
  {categorie:'Finitions', reference:'REF-0004', designation:'Décapage au décapant laitance',
   unite:'m²', pu:0.5, tva:20, type:'PONCTUEL', natures:['CHANTIER']},
  {categorie:'Finitions', reference:'REF-0005', designation:'Nettoyage vapeur des sols',
   unite:'m²', pu:0.5, tva:20, type:'PONCTUEL', natures:['REMISE']},
  {categorie:'Finitions', reference:'REF-0006', designation:'Passage mensuel de courtoisie',
   unite:'forfait', pu:12, tva:20, type:'PONCTUEL', natures:['ENTRETIEN']});

const PORT = 8333; await lancer(PORT);
const b = await chromium.launch({executablePath:CHROME});
const c = await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
const ok = [], ko = [];
const T = (n, v, d) => { (v?ok:ko).push(n + (v?'':'  → ' + JSON.stringify(d))); };

/* Ce que le commercial lit vraiment à l'écran, bloc « Finitions » ouvert. */
const designations = () => p.evaluate(() =>
  [...document.querySelectorAll('#lignes .pres .d b')].map(e => e.textContent.trim()));

await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
await p.waitForTimeout(500);
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }

async function client(){
  await p.fill('#cSociete','MAIRIE DE TEST'); await p.fill('#cContact','Jean Test');
  await p.fill('#cAdresse','1 rue'); await p.fill('#cCp','56250'); await p.fill('#cVille','Monterblanc');
  await p.click('#bSuiv'); await p.waitForTimeout(600);
}

/* ---------- 1. une fin de chantier ---------- */
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chCHA'); await p.waitForTimeout(400);
await client();
let d = await designations();
T('la fin de chantier montre le décapage', d.includes('Décapage au décapant laitance'), d);
T('elle cache le nettoyage vapeur', !d.includes('Nettoyage vapeur des sols'), d);
T('elle cache ce qui est réservé à l\'entretien',
  !d.includes('Passage mensuel de courtoisie'), d);
T('et garde les prestations sans mention',
  d.includes('Nettoyage de vitres') && d.includes('Contrôle qualité'), d);

/* ---------- 2. une remise en état ---------- */
await p.evaluate(()=>nouveauDevis()); await p.waitForTimeout(500);
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chREM'); await p.waitForTimeout(400);
await client();
d = await designations();
T('la remise en état montre le nettoyage vapeur', d.includes('Nettoyage vapeur des sols'), d);
T('elle cache le décapage', !d.includes('Décapage au décapant laitance'), d);
T('et garde les prestations sans mention',
  d.includes('Nettoyage de vitres') && d.includes('Contrôle qualité'), d);

/* ---------- 3. un entretien ---------- */
await p.evaluate(()=>nouveauDevis()); await p.waitForTimeout(500);
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chENT'); await p.waitForTimeout(400);
await p.fill('#fPassages','4'); await p.waitForTimeout(200);
await p.click('#bSuiv'); await p.waitForTimeout(400);
await client();
d = await designations();
T('l\'entretien montre ce qui lui est réservé',
  d.includes('Passage mensuel de courtoisie'), d);
T('et cache les deux prestations d\'intervention',
  !d.includes('Décapage au décapant laitance') && !d.includes('Nettoyage vapeur des sols'), d);

/* ---------- 4. un particulier ---------- */
await p.evaluate(()=>nouveauDevis()); await p.waitForTimeout(500);
await p.click('#chPART'); await p.waitForTimeout(250);
await p.click('#chREM'); await p.waitForTimeout(400);
await p.fill('#cContact','Mme Test');
await p.fill('#cAdresse','2 rue'); await p.fill('#cCp','56250'); await p.fill('#cVille','Monterblanc');
await p.click('#ageOui'); await p.waitForTimeout(200);
await p.click('#bSuiv'); await p.waitForTimeout(600);
d = await designations();
T('un particulier en remise en état voit le nettoyage vapeur',
  d.includes('Nettoyage vapeur des sols'), d);
T('et pas le décapage', !d.includes('Décapage au décapant laitance'), d);

/* ---------- 5. changer de nature retire ce qui ne se vend plus ---------- */
await p.evaluate(()=>nouveauDevis()); await p.waitForTimeout(500);
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chCHA'); await p.waitForTimeout(400);
await client();
// on chiffre une prestation commune et une prestation propre à la fin de chantier
await poserQte(p, 0, 100);                       // vitres, 100 m² à 2,50 = 250 €
const rangDecap = await p.evaluate(() =>
  [...document.querySelectorAll('#lignes .pres .d b')]
    .findIndex(e => e.textContent.trim() === 'Décapage au décapant laitance'));
await poserQte(p, rangDecap, 200);               // décapage, 200 m² à 0,50 = 100 €
let t = await p.evaluate(()=>totaux());
T('les deux prestations sont au devis', t.ht === 350, t);
T('le décapage est bien dans les lignes',
  await p.evaluate(()=>LIGNES.some(l=>/Décapage/.test(l.designation))));

await p.click('#bPrec'); await p.waitForTimeout(300);
await p.click('#bPrec'); await p.waitForTimeout(400);
T('on est revenu au premier écran', await p.isVisible('#e1'));
await p.click('#chREM'); await p.waitForTimeout(600);
T('le décapage a quitté le devis',
  await p.evaluate(()=>!LIGNES.some(l=>/Décapage/.test(l.designation))),
  await p.evaluate(()=>LIGNES.map(l=>l.designation)));
T('la prestation commune est restée',
  await p.evaluate(()=>LIGNES.some(l=>/vitres/i.test(l.designation))),
  await p.evaluate(()=>LIGNES.map(l=>l.designation)));
t = await p.evaluate(()=>totaux());
T('le total a suivi', t.ht === 250, t);
T('la barre du bas aussi', /250,00/.test(await p.innerText('#bTot')), await p.innerText('#bTot'));

/* ---------- 6. la ligne retirée ne part pas au bureau ----------
   Choisir une nature d'intervention emmène directement au client : on est
   déjà sur l'écran 2, un seul « Continuer » suffit pour revoir la liste. */
T('choisir la nature a ramené au client', await p.isVisible('#e2'));
await p.click('#bSuiv'); await p.waitForTimeout(600);
d = await designations();
T('le décapage a disparu de l\'écran', !d.includes('Décapage au décapant laitance'), d);
T('aucun bloc « hors catalogue » n\'est apparu',
  !(await p.evaluate(()=>!!document.getElementById('grpHors'))));
await p.click('#bSuiv'); await p.waitForTimeout(700);
await p.fill('#fDelai','semaine 44');
recu.length = 0;
for(let i = 0; i < 4; i++){
  if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break;
  await p.click('#bSuiv'); await p.waitForTimeout(1300);
}
await p.waitForTimeout(1200);
const envoi = recu.find(x => x && x.devis);
T('le devis part au bureau', !!envoi);
T('il ne porte que la prestation commune',
  envoi && envoi.devis.lignes.length === 1, envoi && envoi.devis.lignes.map(l=>l.designation));
T('et son total est celui de l\'écran',
  envoi && envoi.devis.totaux.ht === 250, envoi && envoi.devis.totaux);

await b.close();
console.log('\n=== CATALOGUE SELON LA NATURE : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length ? 1 : 0);
