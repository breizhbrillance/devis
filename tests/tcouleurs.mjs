/* Le planning en couleurs (v67).

   Cinq natures de devis, cinq couleurs. Ce qui compte n'est pas qu'elles
   soient jolies, c'est qu'elles ne mentent pas : une nature inconnue ne reçoit
   pas de teinte au hasard, et la couleur ne porte jamais l'information toute
   seule — la pastille écrit la nature, parce qu'un planning se lit en plein
   soleil, sur un écran sale, par quelqu'un qui distingue mal le vert du rouge.

   Ce que ces essais gardent :
   — chaque nature reçoit sa couleur, et toujours la même ;
   — deux natures n'ont jamais la même ;
   — un chantier sans nature reste gris et sans pastille ;
   — la pastille écrit la nature en toutes lettres ;
   — l'heure reste visible, et la pastille d'état n'a pas disparu.
*/
import { chromium } from 'playwright';
import { lancer, configSup, planningServi } from './srvco.mjs';
import { CHROME } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, v, d) => { (v ? ok : ko).push(n + (v ? '' : '  → ' + JSON.stringify(d))); };
const rate = [];

configSup.prospection = true;
configSup.planning = true;

const J = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
};
const C = (id, client, date, heure, nature, statut) => ({
  id, client, adresse: '', cp: '56000', ville: 'Vannes', acces: '', date, heure,
  statut: statut || 'PLANIFIE', nature, arrivee: 0, depart: 0, minutes: 0,
  faites: [], signalement: '', note: '', taches: [] });

planningServi.push(
  C('CH-1', 'LE LOCAL', J(0), '08:00', 'ENTRETIEN'),
  C('CH-2', 'MENGUY ARCHITECTES', J(1), '07:00', 'VITRERIE'),
  C('CH-3', 'MME GUYOT', J(2), '09:00', 'CHANTIER'),
  C('CH-4', 'M. SARAZIN', J(3), '11:30', 'REMISE'),
  C('CH-5', 'COPROPRIÉTÉ CABELLO', J(4), '08:00', 'FACADE'),
  C('CH-6', 'AIRBNB STÉPHANE', J(5), '12:15', ''),
  C('CH-7', 'PHARMACIE DES VÉNÈTES', J(6), '13:00', 'ENTRETIEN', 'FAIT'));

const PORT = 8403; await lancer(PORT);
const b = await chromium.launch({ executablePath: CHROME });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
  isMobile: true, locale: 'fr-FR' });
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
async function clic(sel) {
  try { await p.click(sel, { timeout: 6000 }); return true; }
  catch (e) { rate.push('clic ' + sel); return false; }
}

await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
await p.fill('#fCommercial', 'Simon LG'); await p.fill('#fCode', 'ab1!');
await clic('#bCo'); await p.waitForTimeout(900);
if (await p.isVisible('#eAccord')) { await clic('#bAccord'); await p.waitForTimeout(300); }
await clic('#ongPl'); await p.waitForTimeout(1500);

/* Ce que chaque carte porte, lu sur l'écran rendu et non dans le code. */
const cartes = () => p.evaluate(() =>
  [...document.querySelectorAll('#agListe .chC')].map(e => {
    const s = getComputedStyle(e);
    const pastille = e.querySelector('.chNat');
    const heure = e.querySelector('.chH');
    return {
      client: (e.querySelector('.chTete b') || {}).textContent || '',
      bande: s.borderLeftColor,
      largeur: s.borderLeftWidth,
      nature: pastille ? pastille.textContent.trim() : null,
      fond: pastille ? getComputedStyle(pastille).backgroundColor : null,
      heure: heure ? heure.textContent.trim() : null,
      encre: heure ? getComputedStyle(heure).color : null,
      etat: (e.querySelector('.vb') || {}).textContent || ''
    };
  }));

let l = await cartes();
const par = {}; l.forEach(x => { par[x.client] = x; });

/* ---------- 1. toutes les cartes sont là ---------- */
T('les sept chantiers s\'affichent', l.length === 7, l.length);
T('chacun avec une bande de couleur à gauche',
  l.every(x => x.largeur === '5px'), l.map(x => x.largeur));

/* ---------- 2. chaque nature a sa couleur, et sa pastille ---------- */
const ATTENDU = {
  'LE LOCAL':               ['rgb(42, 120, 214)', 'Entretien'],
  'MENGUY ARCHITECTES':     ['rgb(27, 175, 122)', 'Vitrages'],
  'MME GUYOT':              ['rgb(235, 104, 52)', 'Fin de chantier'],
  'M. SARAZIN':             ['rgb(98, 80, 214)',  'Remise en état'],
  'COPROPRIÉTÉ CABELLO':    ['rgb(237, 161, 0)',  'Façade']
};
Object.keys(ATTENDU).forEach(function (cl) {
  const x = par[cl] || {};
  T(cl.toLowerCase() + ' : la bande est à la couleur de sa nature',
    x.bande === ATTENDU[cl][0], { rendu: x.bande, attendu: ATTENDU[cl][0] });
  T(cl.toLowerCase() + ' : la pastille écrit la nature',
    x.nature === ATTENDU[cl][1], { rendu: x.nature, attendu: ATTENDU[cl][1] });
});

/* ---------- 3. deux natures ne partagent jamais une couleur ---------- */
const bandes = Object.keys(ATTENDU).map(cl => par[cl].bande);
T('les cinq couleurs sont distinctes', new Set(bandes).size === 5, bandes);
const pastilles = Object.keys(ATTENDU).map(cl => par[cl].fond);
T('les cinq fonds de pastille aussi', new Set(pastilles).size === 5, pastilles);

/* ---------- 4. l'inconnu reste gris ---------- */
const sans = par['AIRBNB STÉPHANE'];
T('un chantier sans nature n\'a pas de pastille', sans.nature === null, sans.nature);
T('et sa bande ne prend aucune des cinq couleurs',
  bandes.indexOf(sans.bande) < 0, sans.bande);
T('elle reste celle des traits de l\'application',
  sans.bande === 'rgb(226, 229, 234)', sans.bande);

/* ---------- 5. ce qu'on ne voulait pas perdre ---------- */
T('l\'heure est toujours là', par['LE LOCAL'].heure === '08:00', par['LE LOCAL'].heure);
T('et elle prend l\'encre de sa nature',
  par['LE LOCAL'].encre === 'rgb(27, 90, 168)', par['LE LOCAL'].encre);
T('une heure sans nature garde l\'encre ordinaire',
  sans.encre === 'rgb(17, 24, 39)', sans.encre);
T('la pastille d\'état n\'a pas disparu',
  par['LE LOCAL'].etat === 'À FAIRE', par['LE LOCAL'].etat);
T('un chantier fait le dit toujours',
  par['PHARMACIE DES VÉNÈTES'].etat === 'FAIT', par['PHARMACIE DES VÉNÈTES'].etat);
T('la couleur de la nature ne dépend pas de l\'état',
  par['PHARMACIE DES VÉNÈTES'].bande === ATTENDU['LE LOCAL'][0],
  par['PHARMACIE DES VÉNÈTES'].bande);

/* ---------- 6. un appui ouvre toujours le chantier ---------- */
await p.evaluate(() => {
  const e = [...document.querySelectorAll('#agListe .chC')]
    .find(x => /MENGUY/.test(x.textContent));
  if (e) e.click();
});
await p.waitForTimeout(800);
T('la carte reste un bouton', !(await p.evaluate(() =>
  document.getElementById('eAg2').classList.contains('hide'))));

T('aucune erreur JavaScript', err.length === 0, err);
T('aucun bouton attendu ne manquait', rate.length === 0, rate);

console.log('\n=== LE PLANNING EN COULEURS (v67) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
