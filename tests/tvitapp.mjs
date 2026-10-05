/* La vitrerie sur le téléphone (v53).

   Quatrième carte à l'étape 1 : « Vitrages et menuiseries ». Elle se vend au
   contrat ou en une seule fois, et c'est le champ « Passages par mois » laissé
   vide qui dit « une fois ». De ce seul champ dépendent le total mensualisé,
   le nombre de passages envoyé au bureau et, derrière, les chantiers créés.

   Ce que ces essais gardent :
   — la carte existe, et choisir la vitrerie ouvre la fréquence avec les mots
     qui lui vont (sur un entretien la fréquence est obligatoire, ici non) ;
   — vide, le devis est ponctuel : « Total HT » et rien de mensuel ;
   — rempli, il se mensualise exactement comme un entretien ;
   — le catalogue ne propose les vitrages que sur un devis de vitrerie, et ne
     les propose plus sur un entretien ;
   — ce qui part au bureau porte la nature et le bon nombre de passages.
*/
import { chromium } from 'playwright';
import { lancer, recu, catalogueSup, reglagesSup, configSup } from './srvco.mjs';
import { CHROME } from './chemins.mjs';
import { poserQte, cocher } from './presta.mjs';

const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();

/* Le catalogue de la vitrerie, tel qu'il sera en ligne, et deux prestations
   d'entretien pour éprouver que les natures ne se mélangent pas. */
catalogueSup.push(
  { categorie:'Vitrages et menuiseries', reference:'REF-0030',
    designation:'Mise en place du matériel et sécurisation de la zone d\'intervention',
    unite:'forfait', pu:10, tva:20, type:'PONCTUEL', natures:['VITRERIE'] },
  { categorie:'Vitrages et menuiseries', reference:'REF-0031',
    designation:'Vitrages intérieurs', unite:'m²', pu:4, tva:20, type:'PONCTUEL', natures:['VITRERIE'] },
  { categorie:'Vitrages et menuiseries', reference:'REF-0032',
    designation:'Vitrages extérieurs', unite:'m²', pu:4, tva:20, type:'PONCTUEL', natures:['VITRERIE'] },
  { categorie:'Vitrages et menuiseries', reference:'REF-0035',
    designation:'Nettoyage des vitrages, huisseries, rails et verrières',
    unite:'forfait', pu:55, tva:20, type:'PONCTUEL', natures:['VITRERIE'] },
  { categorie:'Sols', reference:'REF-0016', designation:'Aspiration des sols',
    unite:'m²', pu:0.15, tva:20, type:'MENSUEL', natures:['ENTRETIEN'] });

/* Le barème d'éloignement de Simon, et la table des communes que le bureau
   envoie au téléphone. Vannes est à 3 km de l'agence : dans la tranche
   gratuite, donc les prix du modèle duplicable restent ceux du catalogue.
   Auray est à 20 km : là, les prix montent. */
reglagesSup.majoration_km_bareme = '10:0 ; 20:0,70 ; 50:0,80 ; *:0,90';
reglagesSup.majoration_km_arrondi = '0,10';
configSup.communes = { '56000 VANNES': 3, '56400 AURAY': 20 };

const PORT = 8347; await lancer(PORT);
const b = await chromium.launch({ executablePath: CHROME });
const c = await b.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, locale:'fr-FR' });
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
const ok = [], ko = [];
const T = (n, v, d) => { (v ? ok : ko).push(n + (v ? '' : '  → ' + JSON.stringify(d))); };

const vu = () => p.evaluate(() => CATV.map(x => x.reference));
const texte = (sel) => p.evaluate((s) => { const e = document.querySelector(s);
  return e ? e.textContent.trim() : null; }, sel);
const cache = (sel) => p.evaluate((s) => { const e = document.querySelector(s);
  return !e || e.classList.contains('hide'); }, sel);

/* Un essai qui doit rougir ne doit pas planter. Si l'écran ne présente plus le
   bouton ou le champ attendu, on le note et l'on continue : c'est à l'essai
   suivant — celui qui porte la règle — de dire ce qui manque. Sans cela, un
   défaut dans la carte de la vitrerie arrêterait la suite au lieu de la faire
   rougir, et l'on ne saurait pas ce qui a cassé. */
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
const lire = async (sel) => (await texte(sel)) || '';

await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'networkidle' });
await p.waitForTimeout(500);
await remplir('#fCommercial', 'Simon LG'); await remplir('#fCode', 'ab1!');
await clic('#bCo'); await p.waitForTimeout(900);
if (await p.isVisible('#eAccord')) { await clic('#bAccord'); await p.waitForTimeout(300); }

/* ---------- 1. la carte ---------- */
await clic('#chPRO'); await p.waitForTimeout(300);
T('la carte de la vitrerie est proposée au professionnel', await p.isVisible('#chVIT'));
T('et son intitulé dit qu\'elle fait un devis à part',
  /devis séparé/i.test(await texte('#chVIT b, #chVIT')), await texte('#chVIT'));
await clic('#chPART'); await p.waitForTimeout(300);
T('elle est proposée au particulier aussi', await p.isVisible('#chVIT'));
T('alors que l\'entretien des locaux ne l\'est pas', await cache('#chENT'));
await clic('#chPRO'); await p.waitForTimeout(300);

/* ---------- 2. la fréquence, et ce qu'elle dit ---------- */
T('sans nature choisie, pas de fréquence à saisir', await cache('#blocFreq'));
/* Une remise en état n'a aucune fréquence : l'application passe droit à
   l'étape du client. On revient alors en arrière pour la suite. */
await clic('#chREM'); await p.waitForTimeout(400);
T('une remise en état n\'en demande pas', await cache('#blocFreq'));
T('et l\'application passe droit au client',
  await p.evaluate(() => ETAPE) === 2, await p.evaluate(() => ETAPE));
await clic('#bPrec'); await p.waitForTimeout(400);
T('de retour à l\'étape 1, la barre du bas n\'a rien à offrir', await cache('#bar'));
await clic('#chVIT'); await p.waitForTimeout(400);
T('choisir la vitrerie ne saute pas l\'étape 1',
  await p.evaluate(() => ETAPE) === 1, await p.evaluate(() => ETAPE));
T('la vitrerie est retenue', await p.evaluate(() => NATURE) === 'VITRERIE',
  await p.evaluate(() => NATURE));
T('la fréquence s\'ouvre', !(await cache('#blocFreq')));
T('et la barre du bas revient, pour continuer', !(await cache('#bar')));
T('le libellé dit que le champ peut rester vide',
  /vide\s*:\s*une seule fois/i.test(await texte('#lFreq')), await texte('#lFreq'));
T('et l\'explication dessous aussi',
  /une seule fois/i.test(await texte('#mFreq')), await texte('#mFreq'));
await clic('#chENT'); await p.waitForTimeout(400);
T('sur un entretien, le libellé reste celui d\'avant',
  (await texte('#lFreq')) === 'Passages par mois', await texte('#lFreq'));
T('et l\'explication annonce que la question reviendra',
  /revient avant d\'enregistrer/i.test(await texte('#mFreq')), await texte('#mFreq'));
await clic('#chVIT'); await p.waitForTimeout(400);

/* ---------- 3. récurrente ou ponctuelle ---------- */
T('sans passage saisi, la vitrerie est ponctuelle',
  await p.evaluate(() => estRecurrent()) === false, await p.evaluate(() => PASSAGES));
await remplir('#fPassages', '1'); await p.waitForTimeout(400);
T('un passage par mois la rend récurrente',
  await p.evaluate(() => estRecurrent()) === true, await p.evaluate(() => PASSAGES));
await remplir('#fPassages', ''); await p.waitForTimeout(400);
T('le champ vidé la rend ponctuelle de nouveau',
  await p.evaluate(() => estRecurrent()) === false, await p.evaluate(() => PASSAGES));
T('un entretien est récurrent même sans passage saisi', await p.evaluate(() => {
  const avant = NATURE; choisirNature('ENTRETIEN'); setPassages('');
  const r = estRecurrent(); choisirNature(avant); return r; }) === true);

/* ---------- 4. le catalogue selon la nature ---------- */
async function client(soc) {
  await remplir('#cSociete', soc); await remplir('#cContact', 'Jean Test');
  await remplir('#cAdresse', '4 allée'); await remplir('#cCp', '56000'); await remplir('#cVille', 'Vannes');
  await clic('#bSuiv'); await p.waitForTimeout(700);
}
await clic('#chVIT'); await p.waitForTimeout(300);
await clic('#bSuiv'); await p.waitForTimeout(600);
await client('ETANCHEITE MORBIHANNAISE');
let refs = await vu();
T('les quatre prestations de vitrerie sont proposées',
  ['REF-0030','REF-0031','REF-0032','REF-0035'].every(r => refs.indexOf(r) >= 0), refs);
T('l\'aspiration des sols, réservée à l\'entretien, ne l\'est pas',
  refs.indexOf('REF-0016') < 0, refs);
T('les prestations sans nature imposée restent proposées',
  refs.indexOf('REF-0001') >= 0 && refs.indexOf('REF-0003') >= 0, refs);
/* L'équipe part de l'agence pour une vitrerie comme pour un entretien : le
   champ de la distance s'ouvre, et la commune connue le remplit toute seule. */
T('le champ de la distance est offert sur une vitrerie', !(await cache('#blocKm')));
T('et Vannes, connue du bureau, s\'y inscrit seule',
  await p.evaluate(() => KM) === '3', await p.evaluate(() => KM));
T('à 3 km, on est dans la tranche gratuite',
  await p.evaluate(() => supplementKm()) === 0, await p.evaluate(() => supplementKm()));

/* ---------- 5. le modèle duplicable, chiffré ---------- */
const rang = (ref) => p.evaluate((r) => CATV.findIndex(x => x.reference === r), ref);
await sans(async () => cocher(p, await rang('REF-0030')));   // un forfait : on le coche, on ne le chiffre pas
await sans(async () => poserQte(p, await rang('REF-0031'), 20));
await sans(async () => poserQte(p, await rang('REF-0032'), 20));
let t = await p.evaluate(() => totaux());
T('le total du modèle duplicable tombe juste : 170 € HT', t.ht === 170, t);
T('et il est compté en ponctuel', t.htPonctuel === 170 && t.htMensuel === 0, t);
await clic('#bSuiv'); await p.waitForTimeout(700);
T('le devis ponctuel affiche « Total HT »',
  /Total HT/.test(await lire('#recap')) && !/Total mensuel/.test(await lire('#recap')),
  (await lire('#recap')).slice(0, 400));

/* ---------- 6. la même vitrerie vendue au contrat ---------- */
await p.evaluate(() => setPassages(1)); await p.waitForTimeout(500);
t = await p.evaluate(() => totaux());
T('vendue au contrat, elle se mensualise', t.htMensuel === 170 && t.htPonctuel === 0, t);
T('et elle annonce un passage par mois', t.passages === 1, t);
T('le récapitulatif parle alors d\'un total mensuel',
  /Total mensuel HT/.test(await lire('#recap')), (await lire('#recap')).slice(0, 400));
T('et d\'un total TTC par mois',
  /Total TTC par mois/.test(await lire('#recap')), (await lire('#recap')).slice(0, 400));
await p.evaluate(() => setPassages(2)); await p.waitForTimeout(500);
t = await p.evaluate(() => totaux());
T('à deux passages, le mois vaut deux fois le passage',
  t.htMensuel === 340 && t.parPassage === 170, t);
T('et la TVA est celle du mois, pas d\'un passage', t.tva === 68, t);

/* ---------- 7. ce qui part au bureau ---------- */
await remplir('#fDate', DEMAIN);
await remplir('#fSignataire', 'Jean Test');
await p.evaluate(() => { const cv = document.querySelector('#sig canvas') || document.querySelector('canvas');
  if (!cv) return; const r = cv.getBoundingClientRect();
  const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { clientX:r.left+x, clientY:r.top+y, bubbles:true, pointerId:1 }));
  ev('pointerdown', 10, 20); ev('pointermove', 60, 40); ev('pointermove', 110, 25); ev('pointerup', 110, 25); });
await p.waitForTimeout(300);
const avant = recu.length;
await clic('#bSuiv'); await p.waitForTimeout(2500);
const env = recu.slice(avant).map(x => x.devis).filter(Boolean).pop();
T('le devis est bien parti', !!env, recu.slice(avant).map(x => x.action));
T('il porte la nature VITRERIE', env && env.nature === 'VITRERIE', env && env.nature);
T('et les deux passages par mois', env && Number(env.passages) === 2, env && env.passages);
T('la distance part avec le devis', env && Number(env.km) === 3, env && env.km);
T('ses trois lignes de vitrerie y sont',
  env && env.lignes.length === 3 &&
  env.lignes.every(l => /REF-003/.test(l.reference)), env && env.lignes.map(l => l.reference));

/* ---------- 8. et sur un entretien, plus de vitrages ---------- */
await p.evaluate(() => nouveauDevis()); await p.waitForTimeout(700);
await clic('#chPRO'); await p.waitForTimeout(300);
await clic('#chENT'); await p.waitForTimeout(300);
await remplir('#fPassages', '2'); await p.waitForTimeout(300);
await clic('#bSuiv'); await p.waitForTimeout(600);
await client('ETANCHEITE MORBIHANNAISE');
refs = await vu();
T('sur un entretien, aucune prestation de vitrerie n\'est proposée',
  !refs.some(r => /REF-003/.test(r)), refs);
T('mais l\'aspiration des sols, elle, l\'est', refs.indexOf('REF-0016') >= 0, refs);

/* ---------- 8 bis. une vitrerie loin de l'agence ---------- */
/* Vannes était dans la tranche gratuite. Auray est à 20 km : le trajet se paie,
   fondu dans les prix unitaires — le client ne voit aucune ligne de
   déplacement, seulement des prix un peu plus hauts. */
await p.evaluate(() => nouveauDevis()); await p.waitForTimeout(700);
await clic('#chPRO'); await p.waitForTimeout(300);
await clic('#chVIT'); await p.waitForTimeout(400);
await clic('#bSuiv'); await p.waitForTimeout(600);
await remplir('#cSociete', 'MAIRIE D\'AURAY'); await remplir('#cContact', 'Jean Test');
await remplir('#cAdresse', '1 place'); await remplir('#cCp', '56400'); await remplir('#cVille', 'Auray');
await p.waitForTimeout(500);
T('la distance d\'Auray est reconnue', await p.evaluate(() => KM) === '20', await p.evaluate(() => KM));
T('et le supplément n\'est plus nul',
  await p.evaluate(() => supplementKm()) > 0, await p.evaluate(() => supplementKm()));
await clic('#bSuiv'); await p.waitForTimeout(700);
await sans(async () => poserQte(p, await rang('REF-0031'), 20));
const loin = await p.evaluate(() => ({ pu: lignesDevis()[0].pu, t: totaux() }));
T('le prix du m² de vitrage monte au-dessus du catalogue',
  loin.pu > 4, loin.pu);
T('et il reste un prix présentable, pas une suite de centimes',
  Math.abs(loin.pu * 10 - Math.round(loin.pu * 10)) < 0.001, loin.pu);
T('aucune ligne « déplacement » n\'apparaît au devis',
  !/[Dd]éplacement|[Tt]rajet|km/.test(await p.evaluate(() =>
    lignesDevis().map(l => l.designation).join(' | '))),
  await p.evaluate(() => lignesDevis().map(l => l.designation)));

/* ---------- 9. le devis de vitrerie imprimé ---------- */
/* Le client ne lit que ce papier : c'est là que la nature et la fréquence
   doivent se voir. On lit le PDF avec la visionneuse de l'application. */
async function textePdf(passages) {
  return await p.evaluate(async (nbP) => {
    const lignes = [
      { categorie:'Vitrages et menuiseries', reference:'REF-0030',
        designation:'Mise en place du matériel et sécurisation de la zone d\'intervention',
        detail:'', qte:1, unite:'forfait', pu:10, rem:0, tva:20, type:'PONCTUEL' },
      { categorie:'Vitrages et menuiseries', reference:'REF-0031',
        designation:'Vitrages intérieurs', detail:'Bureaux 20 m²',
        qte:20, unite:'m²', pu:4, rem:0, tva:20, type:'PONCTUEL' },
      { categorie:'Vitrages et menuiseries', reference:'REF-0032',
        designation:'Vitrages extérieurs', detail:'Façade 20 m²',
        qte:20, unite:'m²', pu:4, rem:0, tva:20, type:'PONCTUEL' }
    ];
    const ht = 170, rec = nbP > 0, mois = rec ? ht * nbP : ht;
    const devis = {
      numero:'DEV-26-10/ ETMO/ SLG-03', date:new Date().toISOString(),
      validite:new Date(Date.now() + 30*86400000).toISOString(), commercial:'SIMON LG',
      client:{ type:'PRO', societe:'ETANCHEITE MORBIHANNAISE', contact:'Jean Test',
               adresse:'4 allée', cp:'56000', ville:'Vannes', siret:'', tva:'', tel:'', email:'' },
      lignes:lignes, objet:'', delai:'', nature:'VITRERIE', passages:nbP,
      remise:0, notes:'', signataire:'', signature:'', signeLe:0,
      totaux:{ ht:ht, tva:Math.round(mois*20)/100, ttc:Math.round(mois*120)/100,
               htPonctuel: rec ? 0 : ht, htMensuel: rec ? ht : 0,
               parTaux:{ 20: Math.round(ht*20)/100 }, passages: rec ? nbP : 1 }
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
  }, passages);
}
const unFois = await textePdf(0);
T('le devis de vitrerie s\'imprime', unFois.pages >= 1, unFois.pages);
T('l\'objet annonce des vitrages et menuiseries',
  /Objet\s*:\s*Vitrages et menuiseries/.test(unFois.texte), unFois.texte.slice(0, 600));
T('vendu en une fois, il ne parle d\'aucune fréquence',
  !/passage par mois|passages par mois/.test(unFois.texte), unFois.texte.slice(0, 600));
T('et son total est un total simple',
  /Total HT/.test(unFois.texte) && !/Total mensuel HT/.test(unFois.texte), unFois.texte.slice(-500));
T('les 170 € du modèle duplicable y sont', /170,00/.test(unFois.texte), unFois.texte.slice(-500));
const auMois = await textePdf(1);
T('vendu au contrat, l\'objet annonce le passage mensuel',
  /Vitrages et menuiseries\s*—\s*1 passage par mois/.test(auMois.texte), auMois.texte.slice(0, 600));
T('et le total devient mensuel',
  /Total mensuel HT/.test(auMois.texte) && /Total TTC \/ mois/.test(auMois.texte),
  auMois.texte.slice(-500));
const deuxMois = await textePdf(2);
T('à deux passages, le pluriel est respecté',
  /2 passages par mois/.test(deuxMois.texte), deuxMois.texte.slice(0, 600));
T('et le mois vaut deux passages : 340 €',
  /340,00/.test(deuxMois.texte), deuxMois.texte.slice(-600));
T('la TVA imprimée est celle du mois : 68 €',
  /68,00/.test(deuxMois.texte), deuxMois.texte.slice(-600));

/* ---------- 10. le cadre des totaux contient ses intitulés ---------- */
/* « Total TTC / mois » est le plus long des intitulés. Il mordait le bord
   gauche du cadre bleu sur tout devis mensualisé, entretien compris. On le
   mesure sur le PDF réellement produit — où commence le texte, contre le bord
   du cadre, qui est à 118 mm — et non sur une largeur recalculée à côté, qui
   ne prouverait rien de ce qui s'imprime. */
const MM = 72 / 25.4;              // un millimètre, en points PDF
async function placeDesIntitules(nbP) {
  return await p.evaluate(async (n) => {
    const lignes = [{ categorie:'Vitrages et menuiseries', reference:'REF-0031',
      designation:'Vitrages intérieurs', detail:'', qte:20, unite:'m²', pu:4,
      rem:0, tva:20, type:'PONCTUEL' }];
    const ht = 80, rec = n > 0, mois = rec ? ht * n : ht;
    const devis = { numero:'DEV-26-10/ ETMO/ SLG-04', date:new Date().toISOString(),
      validite:new Date(Date.now()+30*86400000).toISOString(), commercial:'SIMON LG',
      client:{ type:'PRO', societe:'ETANCHEITE MORBIHANNAISE', contact:'', adresse:'4 allée',
               cp:'56000', ville:'Vannes', siret:'', tva:'', tel:'', email:'' },
      lignes:lignes, objet:'', delai:'', nature:'VITRERIE', passages:n,
      remise:0, notes:'', signataire:'', signature:'', signeLe:0,
      totaux:{ ht:ht, tva:Math.round(mois*20)/100, ttc:Math.round(mois*120)/100,
               htPonctuel: rec ? 0 : ht, htMensuel: rec ? ht : 0,
               parTaux:{ 20: Math.round(ht*20)/100 }, passages: rec ? n : 1 } };
    const b64 = PDF.base64(devis, CFG.reglages);
    await chargerLecteur();
    const bin = atob(b64.split(',').pop());
    const oct = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
    const doc = await window.pdfjsLib.getDocument({ data: oct }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items;
    const out = {};
    items.forEach((it) => { const t = it.str.trim();
      if (t && out[t] === undefined) out[t] = Math.round(it.transform[4] * 10) / 10; });
    return out;
  }, nbP);
}
const BORD = Math.round(118 * MM * 10) / 10;     // le bord gauche du cadre bleu
let où = await placeDesIntitules(1);
T('« Total TTC / mois » commence dans le cadre bleu',
  où['Total TTC / mois'] >= BORD, { x: où['Total TTC / mois'], bord: BORD });
T('« Prix d\'un passage HT » aussi',
  où['Prix d\'un passage HT'] >= BORD, { x: où['Prix d\'un passage HT'], bord: BORD });
T('« Total mensuel HT » aussi',
  où['Total mensuel HT'] >= BORD, { x: où['Total mensuel HT'], bord: BORD });
où = await placeDesIntitules(0);
T('et « Total TTC », sur un devis vendu en une fois',
  où['Total TTC'] >= BORD, { x: où['Total TTC'], bord: BORD });

T('aucune erreur JavaScript', err.length === 0, err);
T('aucun bouton ni champ attendu ne manquait à l\'écran', rate.length === 0, rate);

console.log('\n=== LA VITRERIE SUR LE TÉLÉPHONE (v53) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
