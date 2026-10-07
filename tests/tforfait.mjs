/* Compter les forfaits (v54).

   Jusqu'ici un forfait était tout ou rien : une coche, quantité 1. Quatre
   cuisines se chiffraient donc comme une seule, et le devis sortait au quart
   du prix. Simon l'a vu : « imagine y'a 4 cuisines ».

   La règle retenue, qui ménage l'entretien : tant que le forfait n'est pas au
   devis, une seule cible — « Ajouter », un tapotement vaut 1, comme avant.
   Dès qu'il y est, la cible devient un pas « − n + ». Les 14 tâches d'un
   contrat d'entretien se cochent donc aussi vite qu'avant, et une remise en
   état compte ses pièces.

   Ce que ces essais gardent :
   — un tapotement sur « Ajouter » pose toujours 1, jamais 0 ni 2 ;
   — le pas monte, descend, et à zéro la prestation quitte le devis ;
   — la quantité se répercute partout : total de la ligne, badge de catégorie,
     barre du bas, ce qui part au bureau, et le devis imprimé ;
   — le pas se vise au pouce (44 px), comme la coche qu'il remplace ;
   — les bornes : jamais de quantité négative, jamais plus de 99 ;
   — un forfait au devis ne se saisit plus au clavier : si le champ de quantité
     revenait, le commercial pourrait y taper 0,5 cuisine.
*/
import { chromium } from 'playwright';
import { lancer, recu, catalogueSup } from './srvco.mjs';
import { CHROME } from './chemins.mjs';
import { ouvrirBloc, poserQte } from './presta.mjs';

const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();

/* Deux forfaits d'une remise en état, et une surface pour vérifier qu'elle
   garde son champ de saisie. */
catalogueSup.push(
  { categorie:'Remise en état de la cuisine', reference:'REF-0008',
    designation:'Nettoyage intérieur de la cuisine', unite:'forfait', pu:30, tva:10,
    type:'PONCTUEL', natures:['CHANTIER','REMISE'] },
  { categorie:'Remise en état de la cuisine', reference:'REF-0009',
    designation:'Nettoyage extérieur de la cuisine', unite:'forfait', pu:20, tva:10,
    type:'PONCTUEL', natures:['CHANTIER','REMISE'] },
  { categorie:'Remise en état de la cuisine', reference:'REF-0040',
    designation:'Aspiration complète des sols', unite:'m2', pu:0.40, tva:10,
    type:'PONCTUEL', natures:['CHANTIER','REMISE'] });

const PORT = 8352; await lancer(PORT);
const b = await chromium.launch({ executablePath: CHROME });
const c = await b.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, locale:'fr-FR' });
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
const ok = [], ko = [];
const T = (n, v, d) => { (v ? ok : ko).push(n + (v ? '' : '  → ' + JSON.stringify(d))); };

const rate = [];
async function clic(sel) {
  try { await p.click(sel, { timeout: 6000 }); return true; }
  catch (e) { rate.push('clic ' + sel); return false; }
}
async function remplir(sel, v) {
  try { await p.fill(sel, String(v), { timeout: 6000 }); return true; }
  catch (e) { rate.push('saisie ' + sel); return false; }
}
const visible = (sel) => p.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && e.getBoundingClientRect().height > 0);
}, sel);
const texte = async (sel) => (await p.evaluate((s) => {
  const e = document.querySelector(s); return e ? e.textContent.trim() : '';
}, sel)) || '';
const qteDe = (ref) => p.evaluate((r) => {
  const l = lignesDevis().find(x => x.reference === r);
  return l ? Number(l.qte) : 0;
}, ref);

await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'networkidle' });
await p.waitForTimeout(500);
await remplir('#fCommercial', 'Simon LG'); await remplir('#fCode', 'ab1!');
await clic('#bCo'); await p.waitForTimeout(900);
if (await p.isVisible('#eAccord')) { await clic('#bAccord'); await p.waitForTimeout(300); }
await clic('#chPRO'); await p.waitForTimeout(300);
await clic('#chREM'); await p.waitForTimeout(500);
await remplir('#cSociete', 'SYNDIC DU PORT'); await remplir('#cContact', 'Jean Test');
await remplir('#cAdresse', '2 quai'); await remplir('#cCp', '56250'); await remplir('#cVille', 'Monterblanc');
await clic('#bSuiv'); await p.waitForTimeout(800);

const rang = (ref) => p.evaluate((r) => CATV.findIndex(x => x.reference === r), ref);
const iCui = await rang('REF-0008');
const iExt = await rang('REF-0009');
const iSol = await rang('REF-0040');
await ouvrirBloc(p, iCui);

/* ---------- 1. tant que le forfait n'est pas au devis ---------- */
T('un forfait absent du devis propose « Ajouter »',
  (await texte('#pr' + iCui + ' .coche')) === 'Ajouter', await texte('#pr' + iCui + ' .coche'));
T('et aucun pas n\'encombre la ligne', !(await visible('#pr' + iCui + ' .pas')));
T('son montant est un tiret', (await texte('#tt' + iCui)) === '—', await texte('#tt' + iCui));

/* ---------- 2. un tapotement vaut un ---------- */
await clic('#pr' + iCui + ' .coche'); await p.waitForTimeout(350);
T('« Ajouter » pose exactement une cuisine', await qteDe('REF-0008') === 1, await qteDe('REF-0008'));
T('le pas remplace la coche', await visible('#pr' + iCui + ' .pas'));
T('et la coche a disparu', !(await visible('#pr' + iCui + ' .coche')));
T('le pas affiche 1', (await texte('#pr' + iCui + ' .nb')) === '1', await texte('#pr' + iCui + ' .nb'));
T('le montant de la ligne est celui d\'une cuisine',
  (await texte('#tt' + iCui)).replace(/\s/g, ' ') === '30,00 €', await texte('#tt' + iCui));

/* ---------- 3. quatre cuisines ---------- */
for (let k = 0; k < 3; k++) { await clic('#pr' + iCui + ' .pm:last-child'); await p.waitForTimeout(250); }
T('trois « + » donnent quatre cuisines', await qteDe('REF-0008') === 4, await qteDe('REF-0008'));
T('le pas le dit', (await texte('#pr' + iCui + ' .nb')) === '4', await texte('#pr' + iCui + ' .nb'));
T('et la ligne vaut quatre fois trente euros',
  (await texte('#tt' + iCui)).replace(/\s/g, ' ') === '120,00 €', await texte('#tt' + iCui));
T('la barre du bas suit',
  /120,00/.test(await texte('#bTot')), await texte('#bTot'));
let t = await p.evaluate(() => totaux());
T('le total HT aussi', t.ht === 120, t);
T('et la TVA porte sur les quatre, pas sur une', t.tva === 24, t);

/* ---------- 4. le badge de la catégorie ---------- */
await clic('#pr' + iExt + ' .coche'); await p.waitForTimeout(350);
const badge = await p.evaluate((n) => {
  const k = CATS.indexOf(n); const e = document.getElementById('cpt' + k);
  return e ? e.textContent.trim() : '';
}, 'Remise en état de la cuisine');
T('le badge de la catégorie compte deux lignes et 140 €',
  /^2 · 140,00/.test(badge.replace(/\s/g, ' ')), badge);

/* ---------- 5. descendre, et retirer ---------- */
for (let k = 0; k < 2; k++) { await clic('#pr' + iCui + ' .pm:first-child'); await p.waitForTimeout(250); }
T('deux « − » ramènent à deux cuisines', await qteDe('REF-0008') === 2, await qteDe('REF-0008'));
for (let k = 0; k < 2; k++) { await clic('#pr' + iCui + ' .pm:first-child'); await p.waitForTimeout(250); }
T('à zéro, la cuisine quitte le devis', await qteDe('REF-0008') === 0, await qteDe('REF-0008'));
T('et « Ajouter » revient', (await texte('#pr' + iCui + ' .coche')) === 'Ajouter',
  await texte('#pr' + iCui + ' .coche'));
T('le pas s\'efface', !(await visible('#pr' + iCui + ' .pas')));
/* Taper trois fois « − » sur une seule cuisine : les deux derniers tapotements
   ne trouvent plus de bouton, et c'est bien ce qu'on veut vérifier. Ils ne
   comptent donc pas comme des cibles manquées. */
T('on ne descend jamais sous zéro', await (async () => {
  await clic('#pr' + iCui + ' .coche'); await p.waitForTimeout(300);
  const marque = rate.length;
  for (let k = 0; k < 3; k++) {
    await clic('#pr' + iCui + ' .pm:first-child'); await p.waitForTimeout(220);
  }
  rate.length = marque;
  return await qteDe('REF-0008') === 0;
})(), await qteDe('REF-0008'));

/* ---------- 6. les bornes ---------- */
/* Deux tapotements sur « − » plus vite que le redessin : le second trouve
   encore le bouton d'avant. Le compte ne doit pas devenir négatif, sans quoi
   la ligne compterait en moins dans le total. C'est poser() qui tient ce
   plancher, pas le pas — l'essai vérifie le résultat, pas qui s'en charge. */
T('un « − » de trop ne rend pas la quantité négative', await p.evaluate((i) => {
  const cle = clePresta(presta(i));
  poser(cle, 1); pasForfait(i, -1); pasForfait(i, -1);
  return qteDe(cle);
}, iCui) === 0);
T('la quantité d\'un forfait ne dépasse pas 99', await p.evaluate((i) => {
  const cle = clePresta(presta(i));
  poser(cle, 99); pasForfait(i, 1);
  return qteDe(cle);
}, iCui) === 99);
T('un pas sur une ligne qui n\'existe pas ne casse rien', await p.evaluate(() => {
  try { pasForfait(9999, 1); return true; } catch (e) { return false; }
}));
await p.evaluate((i) => { poser(clePresta(presta(i)), 0); redessinerPresta(i); majBarre(); }, iCui);
await p.waitForTimeout(300);

/* ---------- 7. une surface garde son champ ---------- */
await ouvrirBloc(p, iSol);
T('une prestation au m² garde son champ de saisie',
  await visible('#pr' + iSol + ' input.q'), iSol);
T('et n\'a ni coche ni pas',
  !(await visible('#pr' + iSol + ' .coche')) && !(await visible('#pr' + iSol + ' .pas')));
await poserQte(p, iSol, 50);
T('on y saisit toujours un nombre à virgule', await qteDe('REF-0040') === 50, await qteDe('REF-0040'));
T('un forfait au devis n\'offre plus de champ au clavier', await (async () => {
  await clic('#pr' + iCui + ' .coche'); await p.waitForTimeout(300);
  return !(await visible('#pr' + iCui + ' input.q'));
})());

/* ---------- 8. le pas se vise au pouce ---------- */
const mesures = await p.evaluate((i) => {
  const pas = document.querySelector('#pr' + i + ' .pas');
  const moins = document.querySelector('#pr' + i + ' .pm');
  const ligne = document.getElementById('pr' + i);
  if (!pas || !moins || !ligne) return { absent: true, haut: 0, boutonHaut: 0,
                                         boutonLarge: 0, deborde: false };
  const r = pas.getBoundingClientRect(), m = moins.getBoundingClientRect();
  return { haut: Math.round(r.height), boutonHaut: Math.round(m.height),
           boutonLarge: Math.round(m.width),
           deborde: r.right > ligne.getBoundingClientRect().right };
}, iCui);
T('le pas est bien à l\'écran', !mesures.absent, mesures);
T('le pas fait 44 px de haut, comme la coche', mesures.haut >= 44, mesures);
T('ses boutons aussi', mesures.boutonHaut >= 44, mesures);
T('ils sont assez larges pour un pouce', mesures.boutonLarge >= 26, mesures);
T('et le pas ne déborde pas de la ligne', !mesures.deborde, mesures);

/* ---------- 9. ce qui part au bureau, et ce qui s'imprime ---------- */
await p.evaluate((i) => { poser(clePresta(presta(i)), 4); redessinerPresta(i); majBarre(); }, iCui);
await p.waitForTimeout(300);
await clic('#bSuiv'); await p.waitForTimeout(700);
/* 4 cuisines à 30 € + le nettoyage extérieur à 20 € + 50 m² aspirés à 0,40 €
   = 160 €. Sans la quantité, le même devis sortirait à 70 €. */
T('le récapitulatif compte les quatre cuisines dans le total',
  /160,00/.test(await texte('#recap')), (await texte('#recap')).slice(0, 300));
await remplir('#fDate', DEMAIN);
await remplir('#fSignataire', 'Jean Test');
await p.evaluate(() => { const cv = document.querySelector('#sig canvas') || document.querySelector('canvas');
  if (!cv) return; const r = cv.getBoundingClientRect();
  const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { clientX:r.left+x, clientY:r.top+y, bubbles:true, pointerId:1 }));
  ev('pointerdown', 10, 20); ev('pointermove', 60, 40); ev('pointerup', 110, 25); });
await p.waitForTimeout(300);
const avant = recu.length;
await clic('#bSuiv'); await p.waitForTimeout(2500);
const env = recu.slice(avant).map(x => x.devis).filter(Boolean).pop();
T('le devis est parti', !!env, recu.slice(avant).map(x => x.action));
const lCui = env && env.lignes.find(l => l.reference === 'REF-0008');
T('la ligne envoyée porte la quantité 4', lCui && Number(lCui.qte) === 4, lCui);
T('et son unité reste le forfait', lCui && /forfait/i.test(lCui.unite), lCui);
T('le total envoyé compte les quatre cuisines, l\'extérieur et les sols',
  env && env.totaux.ht === 160, env && env.totaux);

/* Le devis imprimé : c'est le seul document que le client lit. */
const impr = await p.evaluate(async () => {
  const lignes = [{ categorie:'Remise en état de la cuisine', reference:'REF-0008',
    designation:'Nettoyage intérieur de la cuisine', detail:'', qte:4, unite:'forfait',
    pu:30, rem:0, tva:10, type:'PONCTUEL' }];
  const devis = { numero:'DEV-26-10/ SYPO/ SLG-01', date:new Date().toISOString(),
    validite:new Date(Date.now()+30*86400000).toISOString(), commercial:'SIMON LG',
    client:{ type:'PRO', societe:'SYNDIC DU PORT', contact:'', adresse:'2 quai',
             cp:'56250', ville:'Monterblanc', siret:'', tva:'', tel:'', email:'' },
    lignes:lignes, objet:'', delai:'', nature:'REMISE', passages:0,
    remise:0, notes:'', signataire:'', signature:'', signeLe:0,
    totaux:{ ht:120, tva:12, ttc:132, htPonctuel:120, htMensuel:0, parTaux:{ 10:12 }, passages:1 } };
  const b64 = PDF.base64(devis, CFG.reglages);
  await chargerLecteur();
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({ data: oct }).promise;
  const items = (await (await doc.getPage(1)).getTextContent()).items;
  return items.map(i => i.str).join(' ');
});
T('le devis imprimé affiche la quantité 4', /\b4,00\b/.test(impr), impr.slice(0, 400));
T('et le montant de quatre cuisines', /120,00/.test(impr), impr.slice(-400));

T('aucune erreur JavaScript', err.length === 0, err);
T('aucun bouton attendu ne manquait à l\'écran', rate.length === 0, rate);

console.log('\n=== COMPTER LES FORFAITS (v54) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
