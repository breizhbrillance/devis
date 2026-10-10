/* La façade sur le téléphone (v60).

   Cinquième carte à l'étape 1 : « Nettoyage de façade ». Trois lignes, reprises
   du devis type relevé par Simon : nettoyage et antimousse au m², nacelle à la
   journée. Elle ne se vend qu'en une fois — aucune fréquence à saisir — mais
   l'équipe part de l'agence, donc l'éloignement la majore.

   Ce que ces essais gardent :
   — la carte existe, pour le professionnel comme pour le particulier, et la
     choisir n'ouvre aucune fréquence ;
   — le catalogue ne propose les trois lignes de façade que sur un devis de
     façade, et ne les propose plus ailleurs ;
   — le devis type se rechiffre à l'identique : 2 480,40 € HT, 2 728,44 € TTC
     à 10 % pour un logement de plus de deux ans ;
   — l'éloignement relève les prix, sans faire apparaître de ligne de
     déplacement ;
   — et le papier porte « Nettoyage de façade » en objet, le détail des cinq
     étapes sous la première ligne, et aucun total mensuel.
*/
import { chromium } from 'playwright';
import { lancer, recu, catalogueSup, reglagesSup, configSup } from './srvco.mjs';
import { CHROME } from './chemins.mjs';
import { poserQte } from './presta.mjs';

const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();

const DET = 'Mise en sécurité du chantier • protection de la maison et de ses abords • ' +
            'pulvérisation du nettoyant sans chlore • passage du nettoyeur réglé au jet plat • ' +
            'finition et nettoyage du chantier';

catalogueSup.push(
  { categorie:'Nettoyage de façade', reference:'REF-0036', designation:'Nettoyage de façade',
    detail:DET, unite:'m²', pu:14.90, tva:10, type:'PONCTUEL', natures:['FACADE'] },
  { categorie:'Nettoyage de façade', reference:'REF-0037',
    designation:'Pulvérisation d\'antimousse végétale, non-retour de mousse garanti 2 ans',
    unite:'m²', pu:3.90, tva:10, type:'PONCTUEL', natures:['FACADE'] },
  { categorie:'Nettoyage de façade', reference:'REF-0038', designation:'Forfait nacelle à la journée',
    unite:'journée(s)', pu:450, tva:10, type:'PONCTUEL', natures:['FACADE'] },
  { categorie:'Vitrages et menuiseries', reference:'REF-0031', designation:'Vitrages intérieurs',
    unite:'m²', pu:4, tva:20, type:'PONCTUEL', natures:['VITRERIE'] },
  { categorie:'Sols', reference:'REF-0016', designation:'Aspiration des sols',
    unite:'m²', pu:0.15, tva:20, type:'MENSUEL', natures:['ENTRETIEN'] });

reglagesSup.majoration_km_bareme = '10:0 ; 20:0,70 ; 50:0,80 ; *:0,90';
reglagesSup.majoration_km_arrondi = '0,10';
configSup.communes = { '56000 VANNES': 3, '56140 MISSIRIAC': 32 };

const PORT = 8351; await lancer(PORT);
const b = await chromium.launch({ executablePath: CHROME });
const c = await b.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, locale:'fr-FR' });
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
const ok = [], ko = [];
const T = (n, v, d) => { (v ? ok : ko).push(n + (v ? '' : '  → ' + JSON.stringify(d))); };

/* Un essai qui doit rougir ne doit pas planter : si l'écran ne présente plus
   le bouton attendu, on le note et l'on continue, pour que ce soit l'essai qui
   porte la règle qui rougisse, et non le banc qui s'arrête. */
const rate = [];
async function clic(sel) {
  try { await p.click(sel, { timeout: 6000 }); return true; }
  catch (e) { rate.push('clic ' + sel); return false; }
}
async function remplir(sel, v) {
  try { await p.fill(sel, String(v), { timeout: 6000 }); return true; }
  catch (e) { rate.push('saisie ' + sel); return false; }
}
async function sans(fn) {
  try { await fn(); return true; }
  catch (e) { rate.push(String(e).split('\n')[0].slice(0, 80)); return false; }
}
const vu = () => p.evaluate(() => CATV.map(x => x.reference));
const texte = (sel) => p.evaluate((s) => { const e = document.querySelector(s);
  return e ? e.textContent.trim() : null; }, sel);
const cache = (sel) => p.evaluate((s) => { const e = document.querySelector(s);
  return !e || e.classList.contains('hide'); }, sel);
const lire = async (sel) => (await texte(sel)) || '';
const rang = (ref) => p.evaluate((r) => CATV.findIndex(x => x.reference === r), ref);
/* La distance se saisit à l'étape du client. Depuis l'étape des prestations,
   on revient la poser et l'on repasse à l'étape suivante, comme le ferait un
   doigt : c'est le seul chemin qu'offre l'écran. */
async function poserKm(km) {
  if (await p.evaluate(() => ETAPE) !== 2) { await clic('#bPrec'); await p.waitForTimeout(500); }
  await remplir('#cKm', String(km)); await p.waitForTimeout(450);
}
async function revenirAuxPrestations() { await clic('#bSuiv'); await p.waitForTimeout(800); }

await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'networkidle' });
await p.waitForTimeout(500);
await remplir('#fCommercial', 'Simon LG'); await remplir('#fCode', 'ab1!');
await clic('#bCo'); await p.waitForTimeout(900);
if (await p.isVisible('#eAccord')) { await clic('#bAccord'); await p.waitForTimeout(300); }

/* ---------- 1. la carte ---------- */
await clic('#chPRO'); await p.waitForTimeout(300);
T('la carte de la façade est proposée au professionnel', await p.isVisible('#chFAC'));
T('et son intitulé parle de nettoyage de façade',
  /façade/i.test(await lire('#chFAC')), await lire('#chFAC'));
T('il annonce l\'antimousse et la nacelle',
  /antimousse/i.test(await lire('#chFAC')) && /nacelle/i.test(await lire('#chFAC')),
  await lire('#chFAC'));
T('et qu\'elle est facturée une fois', /une fois/i.test(await lire('#chFAC')), await lire('#chFAC'));
await clic('#chPART'); await p.waitForTimeout(300);
T('elle est proposée au particulier aussi — c\'est son premier client',
  await p.isVisible('#chFAC'));
T('alors que l\'entretien des locaux ne l\'est toujours pas', await cache('#chENT'));

/* ---------- 2. aucune fréquence à saisir ---------- */
await clic('#chFAC'); await p.waitForTimeout(500);
T('la façade est retenue', await p.evaluate(() => NATURE) === 'FACADE',
  await p.evaluate(() => NATURE));
T('elle n\'ouvre aucune fréquence', await cache('#blocFreq'));
T('et l\'application passe droit au client',
  await p.evaluate(() => ETAPE) === 2, await p.evaluate(() => ETAPE));
T('elle n\'est jamais récurrente',
  await p.evaluate(() => estRecurrent()) === false);
T('même si un nombre de passages traîne d\'un devis précédent',
  await p.evaluate(() => { setPassages(4); const r = estRecurrent(); setPassages(''); return r; }) === false);
T('mais l\'équipe part de l\'agence : elle est majorable',
  await p.evaluate(() => estMajorableKm()) === true);
T('et elle porte un nom lisible',
  await p.evaluate(() => libelleNature('FACADE')) === 'Nettoyage de façade',
  await p.evaluate(() => libelleNature('FACADE')));

/* ---------- 3. le catalogue selon la nature ---------- */
/* Le logement des Payen a plus de deux ans : la TVA passe à 10 %, comme sur le
   devis type. C'est l'application qui le décide, pas le catalogue. */
await clic('#ageOui'); await p.waitForTimeout(300);
await remplir('#cContact', 'Yves et Anne Test');
await remplir('#cAdresse', '12 rue de la Grée');
await remplir('#cCp', '56140'); await remplir('#cVille', 'Missiriac');
await p.waitForTimeout(500);
T('Missiriac, connue du bureau, inscrit sa distance toute seule',
  await p.evaluate(() => KM) === '32', await p.evaluate(() => KM));
/* On la ramène dans la tranche gratuite pour retrouver exactement les chiffres
   du papier ; l'éloignement a sa propre épreuve, plus bas. */
await poserKm(3);
await clic('#bSuiv'); await p.waitForTimeout(800);
let refs = await vu();
T('les trois prestations de façade sont proposées',
  ['REF-0036','REF-0037','REF-0038'].every(r => refs.indexOf(r) >= 0), refs);
T('les vitrages, réservés à la vitrerie, ne le sont pas',
  refs.indexOf('REF-0031') < 0, refs);
T('l\'aspiration des sols, réservée à l\'entretien, non plus',
  refs.indexOf('REF-0016') < 0, refs);
T('les prestations sans nature imposée restent proposées',
  refs.indexOf('REF-0001') >= 0, refs);
T('le champ de la distance est offert sur une façade', !(await cache('#blocKm')));

/* ---------- 4. le devis type, rechiffré ---------- */
/* Missiriac est à 32 km : l'éloignement relève les prix. On le neutralise pour
   retrouver exactement les chiffres du papier, puis on le remet. */
await sans(async () => poserQte(p, await rang('REF-0036'), 108));
await sans(async () => poserQte(p, await rang('REF-0037'), 108));
/* La nacelle se compte en journées, pas en forfaits : le commercial y tape un
   chiffre comme sur les deux autres lignes. */
await sans(async () => poserQte(p, await rang('REF-0038'), 1));
let t = await p.evaluate(() => totaux());
T('le total HT du devis type tombe juste : 2 480,40 €', t.ht === 2480.40, t);
T('il est compté en ponctuel, pas en mensuel',
  t.htPonctuel === 2480.40 && t.htMensuel === 0, t);
T('la TVA est celle du logement de plus de deux ans : 248,04 €', t.tva === 248.04, t);
T('et le TTC est celui du papier : 2 728,44 €', t.ttc === 2728.44, t);
const lgn = await p.evaluate(() => lignesDevis().map(l => ({ r:l.reference, q:l.qte, pu:l.pu })));
T('les trois lignes y sont, et elles seules', lgn.length === 3, lgn);
T('108 m² de nettoyage à 14,90 €',
  lgn.some(l => l.r === 'REF-0036' && l.q === 108 && l.pu === 14.90), lgn);
T('108 m² d\'antimousse à 3,90 €',
  lgn.some(l => l.r === 'REF-0037' && l.q === 108 && l.pu === 3.90), lgn);
T('une journée de nacelle à 450 €',
  lgn.some(l => l.r === 'REF-0038' && l.q === 1 && l.pu === 450), lgn);

/* ---------- 5. l'éloignement ---------- */
await poserKm(32); await revenirAuxPrestations();
const loin = await p.evaluate(() => ({ sup: supplementKm(),
  lignes: lignesDevis().map(l => ({ r:l.reference, pu:l.pu })),
  des: lignesDevis().map(l => l.designation).join(' | ') }));
/* La ligne peut manquer si la façade a disparu du catalogue : on ne plante
   pas, on rougit. */
const puNet = (loin.lignes.find(l => l.r === 'REF-0036') || {}).pu;
T('à 32 km, le supplément n\'est plus nul', loin.sup > 0, loin.sup);
T('le prix du m² de nettoyage monte au-dessus du catalogue',
  puNet > 14.90, loin.lignes);
T('et il reste un prix présentable, pas une suite de centimes',
  puNet !== undefined && Math.abs(puNet * 10 - Math.round(puNet * 10)) < 0.001, loin.lignes);
T('aucune ligne « déplacement » n\'apparaît au devis',
  !/[Dd]éplacement|[Tt]rajet|km/.test(loin.des), loin.des);
await poserKm(3); await revenirAuxPrestations();
T('ramené dans la tranche gratuite, le total retrouve les 2 480,40 €',
  (await p.evaluate(() => totaux())).ht === 2480.40, await p.evaluate(() => totaux()));

/* ---------- 6. ce qui part au bureau ---------- */
await clic('#bSuiv'); await p.waitForTimeout(700);
T('le devis ponctuel affiche « Total HT »',
  /Total HT/.test(await lire('#recap')) && !/Total mensuel/.test(await lire('#recap')),
  (await lire('#recap')).slice(0, 400));
await remplir('#fDate', DEMAIN);
await remplir('#fSignataire', 'Yves Test');
await p.evaluate(() => { const cv = document.querySelector('#sig canvas') || document.querySelector('canvas');
  if (!cv) return; const r = cv.getBoundingClientRect();
  const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { clientX:r.left+x, clientY:r.top+y, bubbles:true, pointerId:1 }));
  ev('pointerdown', 10, 20); ev('pointermove', 60, 40); ev('pointermove', 110, 25); ev('pointerup', 110, 25); });
await p.waitForTimeout(300);
const avant = recu.length;
await clic('#bSuiv'); await p.waitForTimeout(2500);
const env = recu.slice(avant).map(x => x.devis).filter(Boolean).pop();
T('le devis est bien parti', !!env, recu.slice(avant).map(x => x.action));
T('il porte la nature FACADE', env && env.nature === 'FACADE', env && env.nature);
T('et aucun passage mensuel', env && Number(env.passages) === 0, env && env.passages);
T('ses trois lignes de façade y sont',
  env && env.lignes.length === 3 && env.lignes.every(l => /REF-003[678]/.test(l.reference)),
  env && env.lignes.map(l => l.reference));
T('le détail des cinq étapes voyage avec la première ligne',
  env && /jet plat/.test(env.lignes.find(l => l.reference === 'REF-0036').detail || ''),
  env && env.lignes.find(l => l.reference === 'REF-0036').detail);

/* ---------- 7. et sur une vitrerie, plus de façade ---------- */
await p.evaluate(() => nouveauDevis()); await p.waitForTimeout(700);
await clic('#chPRO'); await p.waitForTimeout(300);
await clic('#chVIT'); await p.waitForTimeout(400);
await clic('#bSuiv'); await p.waitForTimeout(600);
await remplir('#cSociete', 'MAIRIE DE VANNES'); await remplir('#cContact', 'Jean Test');
await remplir('#cAdresse', '1 place'); await remplir('#cCp', '56000'); await remplir('#cVille', 'Vannes');
await clic('#bSuiv'); await p.waitForTimeout(800);
refs = await vu();
T('sur une vitrerie, aucune prestation de façade n\'est proposée',
  !refs.some(r => /REF-003[678]/.test(r)), refs);
T('mais les vitrages, eux, le sont', refs.indexOf('REF-0031') >= 0, refs);

/* ---------- 8. une façade déjà chiffrée quitte le devis si la nature change --- */
/* Le piège : une ligne comptée au total sans s'afficher nulle part. */
await p.evaluate(() => nouveauDevis()); await p.waitForTimeout(700);
await clic('#chPART'); await p.waitForTimeout(300);
await clic('#chFAC'); await p.waitForTimeout(500);
await clic('#ageOui'); await p.waitForTimeout(300);
await remplir('#cContact', 'Yves Test'); await remplir('#cAdresse', '12 rue');
await remplir('#cCp', '56000'); await remplir('#cVille', 'Vannes');
await clic('#bSuiv'); await p.waitForTimeout(800);
await sans(async () => poserQte(p, await rang('REF-0036'), 50));
T('la façade est chiffrée', (await p.evaluate(() => totaux())).ht > 0,
  await p.evaluate(() => totaux()));
await p.evaluate(() => choisirNature('REMISE')); await p.waitForTimeout(600);
T('passée en remise en état, la ligne de façade a quitté le devis',
  await p.evaluate(() => LIGNES.filter(l => /REF-003[678]/.test(l.reference || '')).length) === 0,
  await p.evaluate(() => LIGNES.map(l => l.reference)));
T('et le total est retombé à zéro',
  (await p.evaluate(() => totaux())).ht === 0, await p.evaluate(() => totaux()));

/* ---------- 9. le devis de façade imprimé ---------- */
/* Le client ne lit que ce papier. On le produit et on le relit avec la
   visionneuse de l'application, comme pour la vitrerie. */
const pdf = await p.evaluate(async (det) => {
  const lignes = [
    { categorie:'Nettoyage de façade', reference:'REF-0036', designation:'Nettoyage de façade',
      detail:det, qte:108, unite:'m²', pu:14.90, rem:0, tva:10, type:'PONCTUEL' },
    { categorie:'Nettoyage de façade', reference:'REF-0037',
      designation:'Pulvérisation d\'antimousse végétale, non-retour de mousse garanti 2 ans',
      detail:'', qte:108, unite:'m²', pu:3.90, rem:0, tva:10, type:'PONCTUEL' },
    { categorie:'Nettoyage de façade', reference:'REF-0038',
      designation:'Forfait nacelle à la journée', detail:'', qte:1, unite:'journée(s)',
      pu:450, rem:0, tva:10, type:'PONCTUEL' }
  ];
  const ht = 2480.40;
  const devis = {
    numero:'DEV-26-10/ PAYE/ SLG-01', date:new Date().toISOString(),
    validite:new Date(Date.now() + 30*86400000).toISOString(), commercial:'SIMON LG',
    client:{ type:'PART', societe:'', contact:'Yves et Anne Test', adresse:'12 rue de la Grée',
             cp:'56140', ville:'Missiriac', siret:'', tva:'', tel:'', email:'' },
    lignes:lignes, objet:'', delai:'', nature:'FACADE', passages:0,
    remise:0, notes:'', signataire:'', signature:'', signeLe:0,
    totaux:{ ht:ht, tva:248.04, ttc:2728.44, htPonctuel:ht, htMensuel:0,
             parTaux:{ 10:248.04 }, passages:1 }
  };
  const b64 = PDF.base64(devis, CFG.reglages);
  await chargerLecteur();
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({ data: oct }).promise;
  let txt = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    txt += (await pg.getTextContent()).items.map(i => i.str).join(' ') + '\n';
  }
  return { texte: txt, pages: doc.numPages };
}, DET);
T('le devis de façade s\'imprime', pdf.pages >= 1, pdf.pages);
T('l\'objet annonce un nettoyage de façade',
  /Objet\s*:\s*Nettoyage de façade/.test(pdf.texte), pdf.texte.slice(0, 600));
T('il ne parle d\'aucune fréquence',
  !/passage par mois|passages par mois/.test(pdf.texte), pdf.texte.slice(0, 600));
T('son total est un total simple',
  /Total HT/.test(pdf.texte) && !/Total mensuel HT/.test(pdf.texte), pdf.texte.slice(-600));
T('les 2 480,40 € y sont', /2\s*480,40/.test(pdf.texte), pdf.texte.slice(-600));
T('la TVA à 10 % aussi : 248,04 €', /248,04/.test(pdf.texte), pdf.texte.slice(-600));
T('et le TTC du papier : 2 728,44 €', /2\s*728,44/.test(pdf.texte), pdf.texte.slice(-600));
T('la nacelle est imprimée à 450 €', /450,00/.test(pdf.texte), pdf.texte.slice(-900));
T('le détail des cinq étapes est imprimé sous la première ligne',
  /jet plat/.test(pdf.texte) && /sans chlore/.test(pdf.texte), pdf.texte.slice(0, 1400));
T('et la garantie de deux ans de l\'antimousse se lit',
  /garanti 2 ans/.test(pdf.texte), pdf.texte.slice(0, 1400));

T('aucune erreur JavaScript', err.length === 0, err);
T('aucun bouton ni champ attendu ne manquait à l\'écran', rate.length === 0, rate);

console.log('\n=== LA FAÇADE SUR LE TÉLÉPHONE (v60) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
