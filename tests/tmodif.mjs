/* Modifier un devis déjà établi, sur le téléphone (v62).

   Simon, 10 octobre 2026 : « j'aimerais que le commercial puisse modifier un
   devis quand il est déjà fait, avant d'être signé ». Trois décisions prises
   avant d'écrire, et ce sont elles que ces essais gardent :

   — **le devis garde son numéro**. Une seule affaire, une seule ligne au
     classeur : le devis repart marqué « révision », comme la remise de la v55 ;
   — **tout est modifiable**, parce qu'on repasse par les écrans ordinaires ;
   — **les prix ne bougent pas**. C'est là que « Modifier » se sépare de
     « Dupliquer » : dupliquer ouvre une affaire neuve et repart du catalogue
     du jour, modifier reprend un devis déjà annoncé au client. Si ce contrôle
     rougit, un prix a changé dans le dos du commercial.

   Le reste tient à des détails qui coûtent cher en vrai : un second devis créé
   au lieu d'une correction, un bandeau manquant qui laisse croire qu'on en
   fait un neuf, une modification interrompue qui repart de zéro, un devis
   signé entre-temps qu'on écraserait quand même.
*/
import { chromium } from 'playwright';
import { lancer, recu, reglagesSup } from './srvco.mjs';
import { CHROME } from './chemins.mjs';
import { poserQte } from './presta.mjs';

const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();

reglagesSup.remise_max = '20';

const PORT = 8396; await lancer(PORT);
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
const texte = async (sel) => (await p.evaluate((s) => {
  const e = document.querySelector(s); return e ? e.textContent.trim() : '';
}, sel)) || '';
const cache = (sel) => p.evaluate((s) => {
  const e = document.querySelector(s);
  return !e || e.classList.contains('hide');
}, sel);
const boutons = (id) => p.evaluate((i) => {
  const b = [...document.querySelectorAll('#liste .hist .acts button')]
    .filter(e => (e.getAttribute('onclick') || '').indexOf(i) >= 0);
  return b.map(e => e.textContent.trim());
}, id);

await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'networkidle' });
await p.waitForTimeout(500);
await remplir('#fCommercial', 'Simon LG'); await remplir('#fCode', 'ab1!');
await clic('#bCo'); await p.waitForTimeout(900);
if (await p.isVisible('#eAccord')) { await clic('#bAccord'); await p.waitForTimeout(300); }

/* Un devis de 200 € HT : 80 m² de vitres à 2,50 €. Chiffres ronds, contrôles
   lisibles. */
async function unDevis() {
  await clic('#chPRO'); await p.waitForTimeout(300);
  await clic('#chCHA'); await p.waitForTimeout(500);
  await remplir('#cSociete', 'MAIRIE DE TEST'); await remplir('#cContact', 'Jean Test');
  await remplir('#cAdresse', '1 rue'); await remplir('#cCp', '56250'); await remplir('#cVille', 'Monterblanc');
  await clic('#bSuiv'); await p.waitForTimeout(700);
  await poserQte(p, 0, 80);
  await clic('#bSuiv'); await p.waitForTimeout(800);
  await remplir('#fDate', DEMAIN);
  await remplir('#fSignataire', 'Jean Test');
  await clic('#bSuiv'); await p.waitForTimeout(2500);
}

await unDevis();
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(900);
const id = await p.evaluate(async () => (await DB.tous())[0].id);
const numAvant = await p.evaluate(async (i) => ((await DB.get(i)) || {}).numero, id);
const pdfAvant = await p.evaluate(async (i) => ((await DB.get(i)) || {}).pdf || '', id);
const creeAvant = await p.evaluate(async (i) => ((await DB.get(i)) || {}).cree, id);

/* ---------- 1. le bouton ---------- */
let bs = await boutons(id);
T('un devis non signé propose « Modifier »', bs.indexOf('Modifier') >= 0, bs);
T('il propose toujours « Signer »', bs.indexOf('Signer') >= 0, bs);
T('et « Dupliquer », qui est autre chose', bs.indexOf('Dupliquer') >= 0, bs);

/* ---------- 2. ce que l'ouverture ramène ---------- */
await p.evaluate((i) => ouvrirModification(i), id); await p.waitForTimeout(1200);
T('on arrive à l\'étape du client',
  await p.evaluate(() => ETAPE) === 2, await p.evaluate(() => ETAPE));
T('le bandeau de modification est visible', !(await cache('#bandModif')));
T('et il nomme le devis repris',
  (await texte('#bandModifNum')) === numAvant, await texte('#bandModifNum'));
T('le client est pré-rempli',
  (await p.inputValue('#cSociete')) === 'MAIRIE DE TEST', await p.inputValue('#cSociete'));
T('son adresse aussi',
  (await p.inputValue('#cVille')) === 'Monterblanc', await p.inputValue('#cVille'));
T('la nature est reprise', await p.evaluate(() => NATURE) === 'CHANTIER',
  await p.evaluate(() => NATURE));
T('les lignes sont là', await p.evaluate(() => LIGNES.length) === 1,
  await p.evaluate(() => LIGNES.length));
T('avec leur quantité', await p.evaluate(() => LIGNES[0].qte) === 80,
  await p.evaluate(() => (LIGNES[0]||{}).qte));
T('et leur prix d\'origine — c\'est ce qui distingue Modifier de Dupliquer',
  await p.evaluate(() => LIGNES[0].pu) === 2.5, await p.evaluate(() => (LIGNES[0]||{}).pu));
T('l\'application sait qu\'elle modifie',
  await p.evaluate(() => enModification()) === true);

/* ---------- 3. le bandeau ne suit que le parcours ---------- */
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(600);
T('sur « Mes devis », le bandeau s\'efface', await cache('#bandModif'),
  await texte('#bandModif'));
await p.evaluate(() => etape(3)); await p.waitForTimeout(600);
T('de retour dans le devis, il revient', !(await cache('#bandModif')));

/* ---------- 4. modifier, puis enregistrer ---------- */
await poserQte(p, 0, 120);             // 120 m² au lieu de 80 : 300 € HT
await clic('#bSuiv'); await p.waitForTimeout(800);
T('le total suit la nouvelle quantité',
  (await p.evaluate(() => totaux())).ht === 300, await p.evaluate(() => totaux()));
await remplir('#fDate', DEMAIN);
const avant = recu.length;
await clic('#bSuiv'); await p.waitForTimeout(3000);

const tous = await p.evaluate(async () => (await DB.tous()).map(x => ({ id:x.id, num:x.numero })));
T('aucun second devis n\'a été créé', tous.length === 1, tous);
T('c\'est bien la même fiche', tous[0].id === id, [tous[0].id, id]);
T('et elle garde son numéro', tous[0].num === numAvant, [tous[0].num, numAvant]);

const maj = await p.evaluate(async (i) => {
  const e = await DB.get(i);
  return { ht: e.devis.totaux.ht, qte: e.devis.lignes[0].qte, pu: e.devis.lignes[0].pu,
           cree: e.cree, modifieLe: e.modifieLe || 0,
           pdfLong: (e.pdf || '').length, pdfFin: (e.pdf || '').slice(-60),
           photos: (e.photos || []).length };
}, id);
T('le devis enregistré porte la nouvelle quantité', maj.qte === 120, maj);
T('et le nouveau total : 300 € HT', maj.ht === 300, maj);
T('le prix unitaire n\'a pas bougé', maj.pu === 2.5, maj);
T('le PDF a été refait', maj.pdfFin !== pdfAvant.slice(-60),
  [maj.pdfLong, pdfAvant.length]);
T('la date de création est conservée', maj.cree === creeAvant, [maj.cree, creeAvant]);
T('et la date de modification est notée', maj.modifieLe > 0, maj.modifieLe);

const env = recu.slice(avant).filter(x => x.action === 'sync').pop();
T('le devis repart au bureau', !!env, recu.slice(avant).map(x => x.action));
T('marqué « révision », pour remplacer et non ajouter', env && env.revision === true, env && env.revision);
T('sous le même numéro', env && env.devis.numero === numAvant, env && env.devis.numero);
T('avec les 120 m²', env && env.devis.lignes[0].qte === 120, env && env.devis.lignes[0].qte);
T('et le même identifiant de devis', env && env.id === id, env && env.id);

/* ---------- 5. l'écran de fin le dit ---------- */
/* Le journal de l'appareil part au bureau puis se vide : c'est donc côté
   bureau qu'on vérifie la trace, là où Simon la lira. */
const traces = recu.filter(x => x.action === 'journal')
  .reduce((a, x) => a.concat(x.evenements || []), []);
T('le bureau reçoit la trace de la modification',
  traces.some(e => e.action === 'DEVIS MODIFIE' && /TTC/.test(e.detail || '')),
  traces.map(e => e.action));
T('et elle porte le numéro du devis',
  traces.some(e => e.action === 'DEVIS MODIFIE' && e.numero === numAvant),
  traces.filter(e => e.action === 'DEVIS MODIFIE').map(e => e.numero));
T('et affiche le numéro inchangé', (await texte('#okNum')) === numAvant, await texte('#okNum'));
T('la modification est refermée',
  await p.evaluate(() => enModification()) === false);

/* ---------- 6. abandonner ---------- */
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(700);
await p.evaluate((i) => ouvrirModification(i), id); await p.waitForTimeout(1000);
await remplir('#cSociete', 'NOM QUI NE DOIT PAS RESTER');
await p.evaluate(() => abandonnerModification()); await p.waitForTimeout(900);
T('abandonner ramène à « Mes devis »',
  await p.evaluate(() => ETAPE) === 6, await p.evaluate(() => ETAPE));
T('et ne modifie rien',
  (await p.evaluate(async (i) => (await DB.get(i)).devis.client.societe, id)) === 'MAIRIE DE TEST',
  await p.evaluate(async (i) => (await DB.get(i)).devis.client.societe, id));
T('la modification est bien close',
  await p.evaluate(() => enModification()) === false);

/* ---------- 7. une modification interrompue reprend où elle en était ---------- */
await p.evaluate((i) => ouvrirModification(i), id); await p.waitForTimeout(1000);
await remplir('#cContact', 'Marie Reprise'); await p.waitForTimeout(400);
await p.evaluate(() => sauverBrouillon());
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1800);
T('au retour, l\'application propose de reprendre la modification',
  /modification/i.test(await texte('#confTitre')), await texte('#confTitre'));
T('et le dit avec le numéro du devis',
  (await texte('#confTexte')).indexOf(numAvant) >= 0, await texte('#confTexte'));
await clic('#confOui'); await p.waitForTimeout(1200);
T('au retour, l\'application sait qu\'une modification court',
  await p.evaluate(() => enModification()) === true,
  await p.evaluate(() => ({ modif: MODIF })));
T('et c\'est le bon devis',
  await p.evaluate(() => (MODIF || {}).numero) === numAvant,
  await p.evaluate(() => (MODIF || {}).numero));
await p.evaluate(() => { MODIF = null; nouveauDevis(); }); await p.waitForTimeout(500);

/* ---------- 8. signé pendant qu'on le modifiait ----------

   Le cas qui coûterait le plus cher : le commercial ouvre la modification,
   puis fait signer le client depuis un autre écran — ou le bureau enregistre
   la signature — avant qu'il n'ait enregistré. Si l'enregistrement passait
   quand même, un devis accepté par le client changerait de montant dans son
   dos. On relit la fiche juste avant d'écrire, et l'on refuse. */
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(700);
await p.evaluate((i) => ouvrirModification(i), id); await p.waitForTimeout(1000);
await p.evaluate(() => etape(3)); await p.waitForTimeout(500);
await poserQte(p, 0, 999);
await clic('#bSuiv'); await p.waitForTimeout(800);
await remplir('#fDate', DEMAIN);
/* La signature arrive pendant la modification, sans passer par cet écran. */
await p.evaluate(async (i) => {
  const e = await DB.get(i);
  e.devis.signature = 'data:image/png;base64,AAAA';
  e.devis.signataire = 'Jean Test';
  e.devis.signeLe = Date.now();
  e.verdict = 'SIGNE';
  await DB.put(e);
}, id);
const avant8 = recu.length;
await clic('#bSuiv'); await p.waitForTimeout(2500);
T('l\'enregistrement est refusé', /sign/i.test(await texte('#erreur')), await texte('#erreur'));
T('et le devis garde ses 120 m², pas les 999',
  await p.evaluate(async (i) => (await DB.get(i)).devis.lignes[0].qte, id) === 120,
  await p.evaluate(async (i) => (await DB.get(i)).devis.lignes[0].qte, id));
T('rien n\'est reparti au bureau',
  recu.slice(avant8).filter(x => x.action === 'sync').length === 0,
  recu.slice(avant8).map(x => x.action));
await p.evaluate(() => { MODIF = null; nouveauDevis(); }); await p.waitForTimeout(500);

/* ---------- 9. un devis signé ne se modifie pas ---------- */
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(800);
bs = await boutons(id);
T('un devis signé ne propose plus « Modifier »', bs.indexOf('Modifier') < 0, bs);
T('ni « Signer » ni « Remise » non plus',
  bs.indexOf('Signer') < 0 && bs.indexOf('Remise') < 0, bs);
T('mais « Dupliquer » reste, pour en faire un neuf', bs.indexOf('Dupliquer') >= 0, bs);
/* Et même en forçant l'appel, l'application refuse. */
await p.evaluate((i) => ouvrirModification(i), id); await p.waitForTimeout(900);
T('forcer l\'ouverture sur un devis signé est refusé',
  await p.evaluate(() => enModification()) === false);
T('et l\'écran le dit', /sign/i.test(await texte('#erreur')), await texte('#erreur'));

T('aucune erreur JavaScript', err.length === 0, err);
T('aucun bouton ni champ attendu ne manquait', rate.length === 0, rate);

console.log('\n=== MODIFIER UN DEVIS (v62) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
