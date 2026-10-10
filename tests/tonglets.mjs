/* La barre d'onglets du bas (v63).

   Le phoning était au bout d'un chemin : accueil → Mes devis → descendre →
   bouton. Il devient un lieu, à côté du devis en cours et des devis faits,
   atteignable d'un appui depuis n'importe lequel des trois.

   Ce que ces essais gardent :
   — la barre est là où elle doit être, et seulement là : les trois lieux ;
   — elle s'efface pendant la saisie d'un devis, pendant la modification d'un
     devis déjà établi, et sur les écrans qui ne sont pas du commercial ;
   — elle n'existe pas pour qui n'a pas la prospection, et ces commerciaux-là
     retrouvent exactement l'appli d'avant, bouton « Retour » compris ;
   — l'onglet du lieu où l'on est est allumé, les deux autres éteints ;
   — l'onglet « Devis » reprend le devis en cours là où il en était : il n'en
     commence pas un neuf, qui effacerait la saisie entamée ;
   — une fois le devis terminé, il ne ramène plus dans un devis fini ;
   — elle ne cache ni le bouton « Continuer », qui se pose au-dessus d'elle,
     ni le bas du contenu.
*/
import { chromium } from 'playwright';
import { lancer, prospects, configSup } from './srvco.mjs';
import { CHROME } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, v, d) => { (v ? ok : ko).push(n + (v ? '' : '  → ' + JSON.stringify(d))); };
const rate = [];

const TOUJOURS = { lun:'00:00-23:59', mar:'00:00-23:59', mer:'00:00-23:59', jeu:'00:00-23:59',
                   ven:'00:00-23:59', sam:'00:00-23:59', dim:'00:00-23:59' };
prospects.push(
  { id:'vannes-peinture-du-golfe', ville:'VANNES', zone:'VANNES AGGLO', nom:'PEINTURE DU GOLFE',
    secteur:'Peinture', activite:'Peinture en bâtiment', prio:4, site:'', dirigeant:'Yann Le Roy',
    tels:[{t:'+33297112233', l:'02 97 11 22 33'}], mail:'', adresse:'1 rue des Arts',
    effectif:'5', info:'', src:'', h:TOUJOURS,
    statut:'', note:'', rappel:'', dernier:'', appels:0, par:'', maj:'' }
);
configSup.prospection = true;

const PORT = 8390; await lancer(PORT);
const b = await chromium.launch({ executablePath: CHROME });
const c = await b.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, locale:'fr-FR' });
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));

async function clic(sel) {
  try { await p.click(sel, { timeout: 6000 }); return true; }
  catch (e) { rate.push('clic ' + sel); return false; }
}
const visible = (sel) => p.isVisible(sel);
const allume = (sel) => p.evaluate((s) =>
  document.querySelector(s).classList.contains('on'), sel);
/* Quel écran est à l'écran : une seule section sans « hide ». */
const ecran = () => p.evaluate(() =>
  ['eCo','eAccord','e1','e2','e3','e4','e5','e6','e7','ePro','eAg1','eAg2','eAd1','eAd2']
    .filter(k => !document.getElementById(k).classList.contains('hide')));

await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'networkidle' });
await p.waitForTimeout(500);

/* ---------- 0. avant la connexion ---------- */
T('la barre n\'est pas là sur l\'écran de connexion', !(await visible('#ongl')));

await p.fill('#fCommercial', 'Simon LG'); await p.fill('#fCode', 'ab1!');
await clic('#bCo'); await p.waitForTimeout(900);
if (await p.isVisible('#eAccord')) { await clic('#bAccord'); await p.waitForTimeout(300); }

/* ---------- 1. elle est là dès l'accueil ---------- */
T('la barre apparaît dès le premier écran', await visible('#ongl'));
T('elle porte trois lieux', await p.evaluate(() =>
  document.querySelectorAll('#ongl button').length) === 3);
T('nommés Devis, Mes devis et Phoning', await p.evaluate(() =>
  [...document.querySelectorAll('#ongl button span')].map(e => e.textContent.trim()).join('|')
) === 'Devis|Mes devis|Phoning');
T('l\'onglet du devis est allumé', await allume('#ongD'));
T('les deux autres ne le sont pas', !(await allume('#ongL')) && !(await allume('#ongP')));
T('le corps réserve la place de la barre', await p.evaluate(() =>
  document.body.classList.contains('avecOnglets')));

/* ---------- 2. un appui mène au phoning ---------- */
await clic('#ongP'); await p.waitForTimeout(1200);
T('un seul appui ouvre le phoning', (await ecran()).join() === 'ePro', await ecran());
T('et l\'onglet Phoning s\'allume', await allume('#ongP'));
T('celui du devis s\'éteint', !(await allume('#ongD')));
T('le titre suit', (await p.evaluate(() =>
  document.getElementById('hTitre').textContent.trim())) === 'Phoning');
T('le vieux « Retour » n\'encombre plus le bas de l\'écran',
  !(await visible('#bar')));

/* ---------- 3. et un autre aux devis faits ---------- */
await clic('#ongL'); await p.waitForTimeout(800);
T('un appui ramène aux devis faits', (await ecran()).join() === 'e6', await ecran());
T('l\'onglet Mes devis s\'allume', await allume('#ongL'));
T('le vieux bouton Phoning du bas de liste a cédé la place',
  !(await p.evaluate(() => !!document.getElementById('bPhoning'))));
T('le « Retour » cède la place lui aussi', !(await visible('#bar')));

/* Une longue liste de devis : le bas de l'écran doit rester lisible une fois
   déroulé jusqu'en bas, et non glisser derrière la barre. */
await p.evaluate(() => { document.getElementById('liste').innerHTML =
  '<div style="height:1600px"></div>'; });
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await p.waitForTimeout(300);
const bas = await p.evaluate(() => {
  const pied = document.getElementById('majCat').closest('.mini').getBoundingClientRect();
  const o = document.getElementById('ongl').getBoundingClientRect();
  return { pied: Math.round(pied.bottom), barre: Math.round(o.top),
           deroule: Math.round(window.scrollY) };
});
T('la liste se déroule bien jusqu\'au bout', bas.deroule > 100, bas);
T('et son bas ne passe pas sous la barre', bas.pied <= bas.barre, bas);

/* ---------- 4. l'onglet Devis reprend, il ne recommence pas ---------- */
await clic('#ongD'); await p.waitForTimeout(500);
T('l\'onglet Devis ramène au devis', (await ecran()).join() === 'e1', await ecran());

await clic('#chPRO'); await p.waitForTimeout(200);
await clic('#chCHA'); await p.waitForTimeout(400);
T('la saisie a bien commencé', (await ecran()).join() === 'e2', await ecran());
T('pendant la saisie, la barre s\'efface', !(await visible('#ongl')));
T('et le corps ne lui réserve plus de place', !(await p.evaluate(() =>
  document.body.classList.contains('avecOnglets'))));

await p.fill('#cSociete', 'GARAGE DU PORT');
await p.fill('#cVille', 'VANNES');
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(600);
T('on peut partir voir ses devis en pleine saisie', (await ecran()).join() === 'e6');
T('et la barre revient', await visible('#ongl'));
await clic('#ongP'); await p.waitForTimeout(1000);
T('puis passer au phoning', (await ecran()).join() === 'ePro', await ecran());

await clic('#ongD'); await p.waitForTimeout(600);
T('l\'onglet Devis rend le devis à l\'étape où il en était',
  (await ecran()).join() === 'e2', await ecran());
T('sans rien effacer de ce qui était saisi',
  (await p.inputValue('#cSociete')) === 'GARAGE DU PORT', await p.inputValue('#cSociete'));
T('la commune non plus', (await p.inputValue('#cVille')) === 'VANNES');

/* ---------- 5. « Continuer » se pose au-dessus, pas derrière ---------- */
await p.evaluate(() => etape(1)); await p.waitForTimeout(300);
await clic('#chPRO'); await p.waitForTimeout(200);
await clic('#chENT'); await p.waitForTimeout(300);
await p.evaluate(() => etape(1)); await p.waitForTimeout(400);
const deux = await p.evaluate(() => {
  const o = document.getElementById('ongl').getBoundingClientRect();
  const r = document.getElementById('bar').getBoundingClientRect();
  return { barVisible: !document.getElementById('bar').classList.contains('hide'),
           onglVisible: !document.getElementById('ongl').classList.contains('hide'),
           barBas: Math.round(r.bottom), onglHaut: Math.round(o.top) };
});
T('à l\'étape où « Continuer » apparaît, les deux barres coexistent',
  deux.barVisible && deux.onglVisible, deux);
T('et « Continuer » se pose au-dessus des onglets, jamais derrière',
  deux.barBas <= deux.onglHaut + 1, deux);

/* ---------- 6. un devis terminé ne se rouvre pas par l'onglet ---------- */
/* Le devis est mené jusqu'aux prestations : si l'étape atteinte n'était pas
   oubliée en le terminant, l'onglet rouvrirait un devis fini à l'étape 3. */
await p.evaluate(() => etape(3)); await p.waitForTimeout(300);
await p.evaluate(() => { montrerTermine(); }); await p.waitForTimeout(300);
T('l\'écran Terminé n\'a pas la barre', !(await visible('#ongl')));
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(500);
await clic('#ongD'); await p.waitForTimeout(400);
T('après un devis terminé, l\'onglet Devis repart du début',
  (await ecran()).join() === 'e1', await ecran());

/* ---------- 7. pendant une modification, pas d'échappatoire ---------- */
await p.evaluate(() => { MODIF = { id:'devis-essai', numero:'SLG-2610-001' }; etape(2); });
await p.waitForTimeout(400);
T('pendant la modification d\'un devis, la barre disparaît', !(await visible('#ongl')));
await p.evaluate(() => { etape(1); }); await p.waitForTimeout(300);
T('même revenu à la première étape', !(await visible('#ongl')));
await p.evaluate(() => { ouvrirHistorique(); }); await p.waitForTimeout(400);
T('même sur la liste des devis', !(await visible('#ongl')));
T('le « Retour » reprend alors sa place', await visible('#bar'));
await p.evaluate(() => { MODIF = null; nouveauDevis(); }); await p.waitForTimeout(400);
T('la modification abandonnée, la barre revient', await visible('#ongl'));

/* ---------- 8. sans la prospection, rien ne change ---------- */
await p.evaluate(() => { CFG.prospection = false; ouvrirHistorique(); });
await p.waitForTimeout(400);
T('sans la prospection, pas de barre du tout', !(await visible('#ongl')));
T('et le bouton Retour est là comme avant', await visible('#bar'));
await p.evaluate(() => { etape(1); }); await p.waitForTimeout(300);
T('le premier écran non plus n\'a rien de nouveau', !(await visible('#ongl')));
T('et le corps ne réserve pas de place pour rien', !(await p.evaluate(() =>
  document.body.classList.contains('avecOnglets'))));
await p.evaluate(() => { CFG.prospection = true; etape(1); }); await p.waitForTimeout(300);
T('la prospection rendue, la barre revient', await visible('#ongl'));

/* ---------- 9. les photos et les écrans des autres métiers ---------- */
await p.evaluate(() => { montrer('e7'); }); await p.waitForTimeout(200);
T('l\'écran des photos n\'a pas la barre', !(await visible('#ongl')));
await p.evaluate(() => { montrer('eAd1'); }); await p.waitForTimeout(200);
T('l\'écran du gérant non plus', !(await visible('#ongl')));
await p.evaluate(() => { montrer('eAg1'); }); await p.waitForTimeout(200);
T('celui du prestataire non plus', !(await visible('#ongl')));

T('aucune erreur JavaScript', err.length === 0, err);
T('aucun bouton attendu ne manquait', rate.length === 0, rate);

console.log('\n=== LA BARRE D\'ONGLETS DU BAS (v63) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
