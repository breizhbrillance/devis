/* Le journal d'appels sur le téléphone (v61).

   Quatrième onglet du module Phoning : ce que le commercial a fait, groupé par
   jour. Trois sources se superposent — ce qui attend d'être envoyé, ce que cet
   appareil a gardé, ce que le bureau renvoie — et c'est leur fusion qui est
   délicate : le même appel ne doit jamais compter deux fois, et ce que le
   bureau sait (la société, la note) doit compléter ce que l'appareil ignore
   sans effacer ce qu'il est seul à savoir.

   Ce que ces essais gardent :
   — l'onglet existe et s'ouvre, l'écran est honnête quand il est vide ;
   — un résultat noté apparaît aussitôt, marqué « à envoyer » tant qu'il n'est
     pas parti ;
   — le groupement par jour dit « Aujourd'hui » et « Hier » comme on les dit ;
   — le même appel vu par l'appareil et par le bureau ne fait qu'une ligne ;
   — un appui sur une ligne rouvre la fiche du prospect, et une ligne dont le
     prospect a quitté la liste n'est pas un bouton ;
   — hors connexion, l'écran montre ce que l'appareil a gardé plutôt que rien.
*/
import { chromium } from 'playwright';
import { lancer, prospects, configSup, histoServi, modeHisto, modeAppel } from './srvco.mjs';
import { CHROME } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, v, d) => { (v ? ok : ko).push(n + (v ? '' : '  → ' + JSON.stringify(d))); };
const rate = [];

const TOUJOURS = { lun:'00:00-23:59', mar:'00:00-23:59', mer:'00:00-23:59', jeu:'00:00-23:59',
                   ven:'00:00-23:59', sam:'00:00-23:59', dim:'00:00-23:59' };
/* « Il y a 26 heures » tombait avant-hier dès qu'on passait minuit : l'essai
   cherchait « Hier » et trouvait une date. On compte en jours, à midi, pour
   que le groupement soit le même à 9 h du matin et à 0 h 30. */
const JOURS = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

prospects.push(
  { id:'vannes-peinture-du-golfe', ville:'VANNES', zone:'VANNES AGGLO', nom:'PEINTURE DU GOLFE',
    secteur:'Peinture', activite:'Peinture en bâtiment', prio:4, site:'', dirigeant:'Yann Le Roy',
    tels:[{t:'+33297112233', l:'02 97 11 22 33'}], mail:'', adresse:'1 rue des Arts',
    effectif:'5', info:'', src:'', h:TOUJOURS,
    statut:'', note:'', rappel:'', dernier:'', appels:0, par:'', maj:'' },
  { id:'vannes-atelier-couleurs', ville:'VANNES', zone:'VANNES AGGLO', nom:'ATELIER COULEURS',
    secteur:'Coiffure / beauté', activite:'Coiffure', prio:9, site:'', dirigeant:'Marie Danic',
    tels:[{t:'+33297445566', l:'02 97 44 55 66'}], mail:'', adresse:'2 quai', effectif:'3',
    info:'', src:'', h:TOUJOURS,
    statut:'', note:'', rappel:'', dernier:'', appels:0, par:'', maj:'' },
  { id:'auray-deco-bretonne', ville:'AURAY', nom:'DECO BRETONNE', dirigeant:'Paul Guen',
    tels:[{t:'+33601020304', l:'06 01 02 03 04'}], mail:'', adresse:'4 venelle', effectif:'2',
    info:'', src:'', h:TOUJOURS,
    statut:'', note:'', rappel:'', dernier:'', appels:0, par:'', maj:'' }
);
configSup.prospection = true;

/* Ce que le bureau garde : un appel d'hier sur un prospect de la liste, et un
   appel d'avant-hier sur un prospect qui n'y est plus — le commercial doit
   quand même le voir, sans pouvoir rouvrir une fiche qui n'existe pas. */
histoServi.push(
  { t: JOURS(1), id:'auray-deco-bretonne', societe:'DECO BRETONNE', commune:'AURAY',
    resultat:'interesse', note:'rappeler en janvier', rappel:'' },
  { t: JOURS(2), id:'parti-de-la-liste', societe:'ANCIENNE SARL', commune:'LORIENT',
    resultat:'refus', note:'', rappel:'' }
);

const PORT = 8383; await lancer(PORT);
const b = await chromium.launch({ executablePath: CHROME });
const c = await b.newContext({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, locale:'fr-FR' });
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));

async function clic(sel) {
  try { await p.click(sel, { timeout: 6000 }); return true; }
  catch (e) { rate.push('clic ' + sel); return false; }
}
const texte = async (sel) => (await p.evaluate((s) => {
  const e = document.querySelector(s); return e ? e.textContent.trim() : '';
}, sel)) || '';
const lignes = () => p.evaluate(() =>
  [...document.querySelectorAll('#prJournal .prLigne')].map(e => ({
    nom: (e.querySelector('b') || {}).textContent || '',
    sous: (e.querySelectorAll('span span')[0] || {}).textContent || '',
    etiq: (e.querySelector('.prEtiq') || {}).textContent || '',
    bouton: e.tagName === 'BUTTON'
  })));
const jours = () => p.evaluate(() =>
  [...document.querySelectorAll('#prJournal .prJJour')].map(e => e.textContent.trim()));

await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'networkidle' });
await p.waitForTimeout(500);
await p.fill('#fCommercial', 'Simon LG'); await p.fill('#fCode', 'ab1!');
await clic('#bCo'); await p.waitForTimeout(900);
if (await p.isVisible('#eAccord')) { await clic('#bAccord'); await p.waitForTimeout(300); }
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(600);
await clic('#ongP'); await p.waitForTimeout(1200);

/* ---------- 1. l'onglet existe ---------- */
T('le module propose un quatrième onglet', await p.isVisible('#prOngJ'));
T('il s\'appelle Journal', (await texte('#prOngJ')) === 'Journal', await texte('#prOngJ'));
T('les trois autres sont toujours là',
  (await p.isVisible('#prOngA')) && (await p.isVisible('#prOngL')) && (await p.isVisible('#prOngR')));

/* On repart d'un téléphone vierge pour voir l'écran vide, puis on le remplit. */
await p.evaluate(() => { PR.file = []; PR.hist = {}; PR.journal = []; PR.journalMaj = ''; });
await clic('#prOngJ'); await p.waitForTimeout(400);
T('l\'onglet s\'ouvre sur la vue Journal', !(await p.evaluate(() =>
  document.getElementById('prVueJournal').classList.contains('hide'))));
T('et la file d\'appels se cache', await p.evaluate(() =>
  document.getElementById('prVueAppels').classList.contains('hide')));

/* ---------- 2. ce que le bureau garde ---------- */
await p.evaluate(() => prChargerJournal()); await p.waitForTimeout(900);
let l = await lignes();
T('les deux appels gardés par le bureau s\'affichent', l.length === 2, l);
T('le plus récent est en tête', /DECO BRETONNE/.test(l[0].nom), l.map(x => x.nom));
T('le résultat est écrit en toutes lettres', l[0].etiq === 'Intéressé', l[0].etiq);
T('la note du bureau accompagne la ligne', /rappeler en janvier/.test(l[0].sous), l[0].sous);
T('la commune aussi', /AURAY/.test(l[0].sous), l[0].sous);
T('une ligne dont le prospect est encore dans la liste est un bouton', l[0].bouton === true, l[0]);
T('une ligne dont le prospect a quitté la liste n\'en est pas un',
  l[1].bouton === false, l[1]);
T('mais elle reste lisible', /ANCIENNE SARL/.test(l[1].nom), l[1].nom);

let j = await jours();
T('les jours sont annoncés', j.length >= 1, j);
T('et nommés comme on les dit', j.some(x => /Hier/.test(x)), j);
T('chaque jour dit combien d\'appels il porte', /appel/.test(j[0]), j[0]);

/* ---------- 3. un appel noté à l'instant ---------- */
/* L'envoi part dans la foulée de la saisie : pour voir une ligne « à envoyer »,
   il faut que le bureau refuse, comme quand le commercial est dans une zone
   sans réseau. C'est le cas qui compte — le journal doit tenir sans bureau. */
modeAppel.v = 'refus';
/* L'enchainement automatique ouvre un lien tel: que le navigateur d'essai
   ne sait pas suivre, et le clic suivant s'y perd. Les autres suites du
   phoning le coupent pour la meme raison. */
await p.evaluate(() => { PR.auto = false; });
await clic('#prOngA'); await p.waitForTimeout(500);
await p.evaluate(() => { PR.courant = 'vannes-peinture-du-golfe'; prRendre(); });
await p.waitForTimeout(400);
await p.evaluate(() => { const n = document.getElementById('prNote'); if (n) n.value = 'standard ferme'; });
await p.evaluate(() => prResultat('nrp')); await p.waitForTimeout(900);
T('le résultat est pris et reste à envoyer',
  await p.evaluate(() => PR.file.length) === 1, await p.evaluate(() => PR.file.length));
await clic('#prOngJ'); await p.waitForTimeout(700);
l = await lignes();
T('il apparaît aussitôt en tête du journal', /PEINTURE DU GOLFE/.test(l[0].nom), l.map(x => x.nom));
T('avec le bon résultat', l[0].etiq === 'Pas de réponse', l[0].etiq);
T('et la note tapée', /standard ferme/.test(l[0].sous), l[0].sous);
T('rangé sous le jour en cours',
  (await jours())[0].indexOf('Aujourd') === 0, await jours());
T('marqué « à envoyer » tant qu\'il n\'est pas parti',
  /envoyer/.test(l[0].sous), l[0].sous);

/* ---------- 4. parti au bureau, il ne double pas ---------- */
const n1 = (await lignes()).length;
T('le journal porte maintenant trois appels', n1 === 3, n1);
modeAppel.v = 'ok';
await p.evaluate(() => prPousser()); await p.waitForTimeout(1200);
await p.evaluate(() => prRendreJournal()); await p.waitForTimeout(200);
l = await lignes();
T('la file est vide une fois l\'envoi passé',
  await p.evaluate(() => PR.file.length) === 0, await p.evaluate(() => PR.file.length));
T('une fois envoyé, il ne compte toujours qu\'une fois', l.length === n1, l.map(x => x.nom));
T('et il n\'est plus marqué « à envoyer »', !/envoyer/.test(l[0].sous), l[0].sous);
T('sa note survit à l\'envoi, sans rien redemander au bureau',
  /standard ferme/.test(l[0].sous), l[0].sous);

/* Le bureau renvoie maintenant ce même appel : toujours une seule ligne. */
const local = await p.evaluate(() => PR.hist['vannes-peinture-du-golfe'][0].t);
await p.evaluate((t) => {
  PR.journal = PR.journal.concat([{ t: t, id: 'vannes-peinture-du-golfe',
    societe: 'PEINTURE DU GOLFE', commune: 'VANNES', resultat: 'nrp',
    note: 'standard fermé', rappel: '' }]);
  prRendreJournal();
}, local);
await p.waitForTimeout(300);
T('le même appel vu des deux côtés ne fait qu\'une ligne',
  (await lignes()).length === n1, (await lignes()).map(x => x.nom));

/* La seconde près, pas la milliseconde : le classeur arrondit en écrivant. */
await p.evaluate((t) => {
  const d = new Date(t); d.setMilliseconds(d.getMilliseconds() === 0 ? 400 : 0);
  PR.journal = PR.journal.concat([{ t: d.toISOString(), id: 'vannes-peinture-du-golfe',
    societe: 'PEINTURE DU GOLFE', commune: 'VANNES', resultat: 'nrp', note: '', rappel: '' }]);
  prRendreJournal();
}, local);
await p.waitForTimeout(300);
T('une milliseconde d\'écart ne crée pas de doublon',
  (await lignes()).length === n1, (await lignes()).map(x => x.nom));

/* ---------- 5. rouvrir la fiche depuis le journal ---------- */
await clic('#prOngJ'); await p.waitForTimeout(400);
await p.evaluate(() => {
  const b = [...document.querySelectorAll('#prJournal button.prLigne')]
    .find(e => /PEINTURE DU GOLFE/.test(e.textContent));
  if (b) b.click();
});
await p.waitForTimeout(700);
T('un appui ramène à la file d\'appels',
  await p.evaluate(() => PR.onglet) === 'appels', await p.evaluate(() => PR.onglet));
T('et sur la bonne fiche',
  await p.evaluate(() => PR.courant) === 'vannes-peinture-du-golfe',
  await p.evaluate(() => PR.courant));
T('la fiche affiche bien ce prospect',
  /PEINTURE DU GOLFE/.test(await texte('#prFiche .prNom')), await texte('#prFiche .prNom'));

/* ---------- 6. hors connexion ---------- */
await p.evaluate(() => { PR.journalMaj = ''; });
modeHisto.v = 'refus';
await clic('#prOngJ'); await p.waitForTimeout(900);
l = await lignes();
T('le bureau refusant, le journal de l\'appareil reste affiché',
  l.length > 0 && /PEINTURE DU GOLFE/.test(l[0].nom), l.map(x => x.nom));
modeHisto.v = 'ok';

/* ---------- 7. l'écran dit d'où il parle ---------- */
await clic('#prOngJ'); await p.waitForTimeout(900);
let etat = await texte('#prJEtat');
T('l\'état compte les appels', /\d+ appels?/.test(etat), etat);
T('et dit quand le bureau a été relu', /bureau relu/.test(etat), etat);
modeHisto.complet = false;
await p.evaluate(() => prChargerJournal()); await p.waitForTimeout(1000);
await p.evaluate(() => prRendreJournal()); await p.waitForTimeout(200);
etat = await texte('#prJEtat');
T('quand le bureau en garde davantage, l\'écran ne le cache pas',
  /plus récents/.test(etat), etat);
modeHisto.complet = true;

/* ---------- 8. un journal vide le dit ---------- */
await p.evaluate(() => { PR.file = []; PR.hist = {}; PR.journal = []; prRendreJournal(); });
await p.waitForTimeout(300);
T('un journal vide est annoncé, pas laissé blanc',
  /Aucun appel/.test(await texte('#prJournal')), await texte('#prJournal'));
T('et il explique où les appels apparaîtront',
  /onglet Appels/.test(await texte('#prJournal')), await texte('#prJournal'));

T('aucune erreur JavaScript', err.length === 0, err);
T('aucun bouton attendu ne manquait', rate.length === 0, rate);

console.log('\n=== LE JOURNAL D\'APPELS SUR LE TÉLÉPHONE (v61) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
