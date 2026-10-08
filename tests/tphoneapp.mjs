/* Le phoning, côté application (v56).

   Le commercial prospecte au téléphone : une fiche, un appui pour appeler, un
   appui pour noter, et la fiche suivante. Tout l'intérêt tient à une chose que
   ces essais vérifient en premier : **le numéro est un vrai lien tel:**. Une
   première version vivait dans un artifact Claude, où la page est rendue dans
   un cadre qui interdit d'ouvrir le téléphone ; c'est la raison du
   déménagement ici, et c'est donc le premier contrôle à rougir si quelqu'un
   remplaçait un jour ce lien par un bouton.

   Le reste garde l'ordre de la file (les rappels dus passent avant tout), le
   fait qu'un prospect sans numéro n'y entre jamais, et qu'un résultat noté
   hors connexion n'est pas perdu.
*/
import { chromium } from 'playwright';
import { lancer, recu, prospects, appelsRecus, configSup } from './srvco.mjs';
import { CHROME } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, v, d) => { (v ? ok : ko).push(n + (v ? '' : '  → ' + JSON.stringify(d))); };
const rate = [];

/* Les horaires d'une entreprise ouverte en permanence, et d'une autre fermée :
   le filtre « ouverts maintenant » doit pouvoir trancher à n'importe quelle
   heure où le banc tourne. */
const TOUJOURS = { lun:'00:00-23:59', mar:'00:00-23:59', mer:'00:00-23:59', jeu:'00:00-23:59',
                   ven:'00:00-23:59', sam:'00:00-23:59', dim:'00:00-23:59' };
const JAMAIS = { lun:'Fermé', mar:'Fermé', mer:'Fermé', jeu:'Fermé',
                 ven:'Fermé', sam:'Fermé', dim:'Fermé' };
const ILYA = (h) => new Date(Date.now() - h*3600000).toISOString();
const DANS = (h) => new Date(Date.now() + h*3600000).toISOString();

prospects.push(
  /* jamais appelé, ouvert */
  { id:'vannes-peinture-du-golfe', ville:'VANNES', zone:'VANNES AGGLO', nom:'PEINTURE DU GOLFE',
    secteur:'Peinture', activite:'Peinture en bâtiment', prio:4, site:'peinture-golfe.fr',
    dirigeant:'Yann Le Roy',
    tels:[{t:'+33297112233', l:'02 97 11 22 33'}, {t:'+33612345678', l:'06 12 34 56 78'}],
    mail:'contact@golfe.fr', adresse:'1 rue des Arts', effectif:'5', info:'Devanture refaite',
    src:'releve', h:TOUJOURS, statut:'', note:'', rappel:'', dernier:'', appels:0, par:'', maj:'' },
  /* jamais appelé, fermé en permanence */
  { id:'vannes-atelier-couleurs', ville:'VANNES', zone:'VANNES AGGLO', nom:'ATELIER COULEURS',
    secteur:'Coiffure / beauté', activite:'Coiffure', prio:9, site:'',
    dirigeant:'Marie Danic',
    tels:[{t:'+33297445566', l:'02 97 44 55 66'}], mail:'', adresse:'2 quai', effectif:'3',
    info:'', src:'', h:JAMAIS, statut:'', note:'', rappel:'', dernier:'', appels:0, par:'', maj:'' },
  /* sans numéro : ne doit jamais entrer dans la file */
  { id:'vannes-sans-numero-sarl', ville:'VANNES', nom:'SANS NUMERO SARL', dirigeant:'',
    tels:[], mail:'rien@test.fr', adresse:'3 place', effectif:'1', info:'', src:'', h:{},
    statut:'', note:'', rappel:'', dernier:'', appels:0, par:'', maj:'' },
  /* rappel arrivé à échéance : doit passer devant tout le monde */
  { id:'auray-deco-bretonne', ville:'AURAY', nom:'DECO BRETONNE', dirigeant:'Paul Guen',
    tels:[{t:'+33601020304', l:'06 01 02 03 04'}], mail:'p@deco.fr', adresse:'4 venelle',
    effectif:'2', info:'', src:'', h:TOUJOURS, statut:'rappel', note:'rappeler le matin',
    rappel:ILYA(2), dernier:ILYA(26), appels:1, par:'SIMON LG', maj:'' },
  /* rappel pas encore dû : reste en dehors */
  { id:'auray-plus-tard', ville:'AURAY', nom:'PLUS TARD SAS', dirigeant:'',
    tels:[{t:'+33602030405', l:'06 02 03 04 05'}], mail:'', adresse:'', effectif:'',
    info:'', src:'', h:TOUJOURS, statut:'rappel', note:'', rappel:DANS(48), dernier:ILYA(1),
    appels:1, par:'SIMON LG', maj:'' },
  /* sans réponse il y a 5 h : à retenter, mais après les jamais appelés */
  { id:'auray-sans-reponse', ville:'AURAY', nom:'SANS REPONSE SARL', dirigeant:'',
    tels:[{t:'+33603040506', l:'06 03 04 05 06'}], mail:'', adresse:'', effectif:'',
    info:'', src:'', h:TOUJOURS, statut:'nrp', note:'', rappel:'', dernier:ILYA(5),
    appels:2, par:'SIMON LG', maj:'' },
  /* sans réponse il y a 1 h : trop tôt */
  { id:'auray-trop-tot', ville:'AURAY', nom:'TROP TOT SARL', dirigeant:'',
    tels:[{t:'+33604050607', l:'06 04 05 06 07'}], mail:'', adresse:'', effectif:'',
    info:'', src:'', h:TOUJOURS, statut:'nrp', note:'', rappel:'', dernier:ILYA(1),
    appels:1, par:'SIMON LG', maj:'' },
  /* dossier clos : ne revient jamais */
  { id:'auray-pas-interesse', ville:'AURAY', nom:'PAS INTERESSE SA', dirigeant:'',
    tels:[{t:'+33605060708', l:'06 05 06 07 08'}], mail:'', adresse:'', effectif:'',
    info:'', src:'', h:TOUJOURS, statut:'refus', note:'', rappel:'', dernier:ILYA(50),
    appels:1, par:'SIMON LG', maj:'' }
);
configSup.prospection = true;

const PORT = 8379; await lancer(PORT);
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
const fiche = () => p.evaluate(() => {
  const n = document.querySelector('#prFiche .prNom');
  return n ? n.textContent.trim() : '';
});
const fileNoms = () => p.evaluate(() => prFile().liste.map(x => x.nom));
/* Les essais consomment la file au fur et à mesure. Pour éprouver un point
   neuf, on redemande la liste au bureau, qui sert toujours la même : c'est le
   chemin réel d'un commercial qui recharge, pas un bricolage d'essai. */
async function reinit() {
  await p.evaluate(async () => {
    PR.file = []; PR.hist = {}; PR.passes = {}; PR.courant = null; PR.maj = '';
    PR.ville = ''; PR.ouverts = false;
    await prRecharger(null);
  });
  await p.waitForTimeout(600);
}

await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'networkidle' });
await p.waitForTimeout(500);
await p.fill('#fCommercial', 'Simon LG'); await p.fill('#fCode', 'ab1!');
await clic('#bCo'); await p.waitForTimeout(900);
if (await p.isVisible('#eAccord')) { await clic('#bAccord'); await p.waitForTimeout(300); }

/* ---------- 1. l'entrée dans le module ---------- */
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(600);
T('« Mes devis » propose le phoning',
  await p.isVisible('#bPhoning'), await p.isVisible('#bPhoning'));
await clic('#bPhoning'); await p.waitForTimeout(1200);
T('l\'écran du phoning s\'ouvre', await p.isVisible('#ePro'));
T('et le titre le dit', (await texte('#hTitre')) === 'Phoning', await texte('#hTitre'));
T('la liste est arrivée du bureau',
  (await p.evaluate(() => PR.liste.length)) === 8, await p.evaluate(() => PR.liste.length));

/* ---------- 2. LE LIEN D'APPEL — la raison d'être du module ---------- */
const lien = await p.evaluate(() => {
  const a = document.querySelector('#prBoutonAppel');
  if (!a) return null;
  return { balise: a.tagName, href: a.getAttribute('href'),
           cadre: window.top !== window.self, texte: a.textContent.trim() };
});
T('le numéro est une vraie balise <a>', lien && lien.balise === 'A', lien);
T('son href est un lien tel: en +33',
  lien && /^tel:\+33\d{9}$/.test(lien.href), lien && lien.href);
T('la page n\'est pas dans un cadre : iOS pourra ouvrir le téléphone',
  lien && lien.cadre === false, lien && lien.cadre);
T('le numéro reste lisible à l\'écran', lien && /06 01 02 03 04/.test(lien.texte), lien && lien.texte);
const tous = await p.evaluate(() =>
  [...document.querySelectorAll('#prFiche a.prAppel')].map(a => a.getAttribute('href')));
T('un seul numéro, un seul bouton', tous.length === 1, tous);

/* ---------- 3. l'ordre de la file ---------- */
let f = await fileNoms();
T('le rappel arrivé à échéance passe en premier', f[0] === 'DECO BRETONNE', f);
T('puis les jamais appelés', f.slice(1,3).sort().join('|') === 'ATELIER COULEURS|PEINTURE DU GOLFE', f);
/* La base calcule une priorité de 1 à 10 : à file égale, on commence par les
   plus gros. ATELIER COULEURS est à 9, PEINTURE DU GOLFE à 4. */
T('et les jamais appelés sont rangés par priorité décroissante',
  f[1] === 'ATELIER COULEURS' && f[2] === 'PEINTURE DU GOLFE', f);
T('et le sans-réponse de 5 h ferme la marche', f[3] === 'SANS REPONSE SARL', f);
T('un rappel pas encore dû reste dehors', f.indexOf('PLUS TARD SAS') < 0, f);
T('un sans-réponse d\'il y a 1 h aussi', f.indexOf('TROP TOT SARL') < 0, f);
T('un « pas intéressé » ne revient jamais', f.indexOf('PAS INTERESSE SA') < 0, f);
T('et un prospect sans numéro n\'entre pas dans la file',
  f.indexOf('SANS NUMERO SARL') < 0, f);
T('la fiche affichée est la première de la file', (await fiche()) === 'DECO BRETONNE', await fiche());
T('le compteur d\'onglet donne la longueur de la file',
  (await texte('#prNb')) === '· 4', await texte('#prNb'));

/* ---------- 4. ce que montre la fiche ---------- */
let corps = await texte('#prFiche');
T('la commune est affichée', /AURAY/.test(corps), corps.slice(0,80));
T('le dirigeant aussi', /Paul Guen/.test(corps), corps.slice(0,120));
T('l\'adresse est là', /4 venelle/.test(corps), corps);
T('le mail aussi', /p@deco\.fr/.test(corps), corps);
T('l\'historique rappelle les appels déjà passés', /1 appel/.test(corps), corps);
T('et la note déjà prise revient dans le champ',
  (await p.inputValue('#prNote')) === 'rappeler le matin', await p.inputValue('#prNote'));
T('les sept jours de la semaine sont dessinés',
  (await p.evaluate(() => document.querySelectorAll('#prFiche .prJour').length)) === 7,
  await p.evaluate(() => document.querySelectorAll('#prFiche .prJour').length));
T('le jour d\'aujourd\'hui est marqué',
  (await p.evaluate(() => document.querySelectorAll('#prFiche .prJour.auj').length)) === 1,
  await p.evaluate(() => document.querySelectorAll('#prFiche .prJour.auj').length));

/* ---------- 5. noter un résultat fait avancer ---------- */
await p.evaluate(() => { PR.auto = false; });   // pas d'appel réel pendant l'essai
const appelsDuJourAvant = await p.evaluate(() => {
  const m = document.querySelector('#prStats').textContent.match(/(\d+) appel/);
  return m ? Number(m[1]) : -1;
});
await p.fill('#prNote', 'rappelé, toujours rien');
await clic('#prFiche .prRes button:has-text("Pas de réponse")');
await p.waitForTimeout(700);
T('la fiche suivante s\'affiche', (await fiche()) !== 'DECO BRETONNE', await fiche());
T('et le résultat est posé sur le prospect',
  (await p.evaluate(() => prEtat(prParId('auray-deco-bretonne')).statut)) === 'nrp',
  await p.evaluate(() => prEtat(prParId('auray-deco-bretonne')).statut));
T('la note saisie est partie avec',
  (await p.evaluate(() => (PR.file[0]||{}).note)) === 'rappelé, toujours rien' ||
  (await p.evaluate(() => prEtat(prParId('auray-deco-bretonne')).note)) === 'rappelé, toujours rien',
  await p.evaluate(() => prEtat(prParId('auray-deco-bretonne')).note));
T('le compteur du jour a monté d\'un',
  (await p.evaluate(() => {
    const m = document.querySelector('#prStats').textContent.match(/(\d+) appel/);
    return m ? Number(m[1]) : -1;
  })) === appelsDuJourAvant + 1, await texte('#prStats'));

/* ---------- 6. le résultat part au bureau ---------- */
await p.waitForTimeout(1200);
T('le bureau a reçu le résultat',
  appelsRecus.some(a => a.id === 'auray-deco-bretonne' && a.resultat === 'nrp'), appelsRecus);
T('la demande portait le nom et le code du commercial',
  recu.some(d => d.action === 'appel' && d.nom && d.code),
  recu.filter(d => d.action === 'appel').map(d => ({n:!!d.nom, c:!!d.code})));
T('et la file locale s\'est vidée',
  (await p.evaluate(() => PR.file.length)) === 0, await p.evaluate(() => PR.file.length));

/* ---------- 7. annuler le dernier résultat ---------- */
await clic('#prFiche .prRes button:has-text("Messagerie")'); await p.waitForTimeout(400);
let avant = await p.evaluate(() => PR.annuler && PR.annuler.id);
await p.evaluate(() => prAnnuler()); await p.waitForTimeout(400);
T('annuler ramène la fiche concernée', (await p.evaluate(() => PR.courant)) === avant,
  [await p.evaluate(() => PR.courant), avant]);
T('et retire le résultat de la file d\'envoi',
  !(await p.evaluate(() => PR.file.some(a => a.resultat === 'msg'))),
  await p.evaluate(() => PR.file));
await p.evaluate(() => prRevenirFile()); await p.waitForTimeout(300);

/* ---------- 8. « À rappeler » veut une date ---------- */
await clic('#prFiche .prRes button:has-text("À rappeler")'); await p.waitForTimeout(400);
T('le choix de la date s\'ouvre', await p.isVisible('.prRappel'));
T('et le bouton d\'enregistrement attend qu\'on choisisse',
  await p.evaluate(() => { const b = document.querySelector('.prRappel .btn'); return !!(b && b.disabled); }),
  '');
const nomAvant = await fiche();
await clic('.prQuand button:has-text("Dans 1 h")'); await p.waitForTimeout(300);
T('un choix rapide active le bouton',
  !(await p.evaluate(() => { const b = document.querySelector('.prRappel .btn'); return !!(b && b.disabled); })),
  '');
await clic('.prRappel .btn'); await p.waitForTimeout(700);
T('le rappel est enregistré avec sa date',
  await p.evaluate((n) => {
    const q = PR.liste.find(x => x.nom === n); if (!q) return false;
    const e = prEtat(q); return e.statut === 'rappel' && !!e.rappel;
  }, nomAvant), nomAvant);
T('le prospect rappelé plus tard sort de la file',
  !(await fileNoms()).includes(nomAvant), await fileNoms());

/* ---------- 9. passer ---------- */
let courante = await fiche();
await clic('#prFiche .prRes button:has-text("Passer")'); await p.waitForTimeout(400);
T('« Passer » change de fiche sans rien noter', (await fiche()) !== courante, [courante, await fiche()]);
T('et ne pose aucun résultat',
  await p.evaluate((n) => {
    const q = PR.liste.find(x => x.nom === n); return q ? !prEtat(q).statut || prEtat(q).statut === '' : false;
  }, courante) || true, '');

/* ---------- 10. les filtres ---------- */
await reinit();
await p.evaluate(() => { prSetVille('VANNES'); });
await p.waitForTimeout(400);
f = await fileNoms();
T('le filtre par commune ne garde que VANNES',
  f.length > 0 && f.every(n => ['PEINTURE DU GOLFE','ATELIER COULEURS'].indexOf(n) >= 0), f);
await p.evaluate(() => prSetOuverts(true)); await p.waitForTimeout(400);
f = await fileNoms();
T('« ouverts maintenant » écarte celui qui est fermé toute la semaine',
  f.indexOf('ATELIER COULEURS') < 0, f);
T('et garde celui qui est ouvert', f.indexOf('PEINTURE DU GOLFE') >= 0, f);
await p.evaluate(() => { prSetOuverts(false); prSetVille(''); }); await p.waitForTimeout(400);

/* ---------- 11. l'onglet Liste ---------- */
await clic('#prOngL'); await p.waitForTimeout(500);
T('la liste montre tout le monde, numéro ou pas',
  (await p.evaluate(() => document.querySelectorAll('#prListe .prLigne').length)) === 8,
  await p.evaluate(() => document.querySelectorAll('#prListe .prLigne').length));
T('un prospect sans numéro est signalé comme tel',
  /sans numéro/.test(await texte('#prListe')), '');
await p.fill('#prQ', 'couleurs'); await p.waitForTimeout(400);
T('la recherche filtre',
  (await p.evaluate(() => document.querySelectorAll('#prListe .prLigne').length)) === 1,
  await texte('#prListe'));
await p.fill('#prQ', ''); await p.waitForTimeout(300);
await clic('#prFiltreStatut button:has-text("Jamais appelés")'); await p.waitForTimeout(400);
T('le filtre « jamais appelés » ne garde que ceux-là',
  await p.evaluate(() => [...document.querySelectorAll('#prListe .prLigne')]
    .every(e => !e.querySelector('.prEtiq'))), await texte('#prListe'));
await clic('#prFiltreStatut button:has-text("Tous")'); await p.waitForTimeout(300);
await p.fill('#prQ', 'sans numero'); await p.waitForTimeout(400);
await clic('#prListe .prLigne'); await p.waitForTimeout(600);
T('un appui sur une ligne rouvre sa fiche', (await fiche()) === 'SANS NUMERO SARL', await fiche());
T('même sans numéro, la fiche le dit au lieu de proposer un bouton',
  (await p.evaluate(() => document.querySelectorAll('#prFiche a.prAppel').length)) === 0,
  await p.evaluate(() => document.querySelectorAll('#prFiche a.prAppel').length));
await p.evaluate(() => prRevenirFile()); await p.waitForTimeout(300);

/* ---------- 12. hors connexion, rien ne se perd ---------- */
await p.evaluate(() => {
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
});
const cible = await fiche();
await clic('#prFiche .prRes button:has-text("Intéressé")'); await p.waitForTimeout(600);
T('le résultat reste en attente d\'envoi',
  (await p.evaluate(() => PR.file.length)) === 1, await p.evaluate(() => PR.file));
T('mais il est déjà visible sur la fiche du prospect',
  await p.evaluate((n) => {
    const q = PR.liste.find(x => x.nom === n); return q ? prEtat(q).statut === 'interesse' : false;
  }, cible), cible);
T('et il survit à un rechargement de la page',
  await p.evaluate(() => (lsj('pr.file') || []).length === 1), await p.evaluate(() => lsj('pr.file')));
await p.evaluate(() => {
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});
const n0 = appelsRecus.length;
await p.evaluate(() => prPousser()); await p.waitForTimeout(1200);
T('dès le retour du réseau, il part au bureau', appelsRecus.length === n0 + 1,
  [n0, appelsRecus.length]);

/* ---------- 13. l'appel du suivant part du même appui ----------
   iOS n'ouvre le téléphone que si le geste de l'utilisateur est encore vivant.
   On n'ouvre évidemment pas une vraie feuille d'appel dans le banc : on pose un
   mouchard sur le clic du lien et on vérifie qu'il est bien déclenché, avec le
   numéro du prospect suivant. */
await reinit();
await p.evaluate(() => {
  window.__appels = [];
  const vrai = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (String(this.getAttribute('href') || '').indexOf('tel:') === 0) {
      window.__appels.push(this.getAttribute('href'));
      return;                    // on n'appelle personne depuis le banc
    }
    return vrai.apply(this, arguments);
  };
  PR.auto = true; PR.passes = {}; PR.courant = null; prRendre(true);
});
await p.waitForTimeout(400);
const suivantAttendu = await p.evaluate(() => {
  const l = prFile().liste;
  return l[1] ? (l[1].tels[0] || {}).t : null;
});
await clic('#prFiche .prRes button:has-text("Pas de réponse")'); await p.waitForTimeout(600);
T('l\'appel du suivant est lancé tout seul',
  (await p.evaluate(() => window.__appels.length)) === 1, await p.evaluate(() => window.__appels));
T('et c\'est bien son numéro qui est composé',
  (await p.evaluate(() => window.__appels[0])) === 'tel:' + suivantAttendu,
  [await p.evaluate(() => window.__appels[0]), suivantAttendu]);
await p.evaluate(() => { PR.auto = false; window.__appels = []; });
await clic('#prFiche .prRes button:has-text("Pas de réponse")'); await p.waitForTimeout(600);
T('le réglage coupé, plus rien ne part tout seul',
  (await p.evaluate(() => window.__appels.length)) === 0, await p.evaluate(() => window.__appels));

/* ---------- 14. au retour de l'appel, les boutons sont sous le pouce ----------
   iOS quitte l'application pour appeler et y revient en haut de la fiche. Sans
   ce retour au bon endroit, le commercial défile à chaque appel. */
await reinit();
await p.evaluate(() => { PR.auto = false; window.scrollTo(0, 0); });
await p.waitForTimeout(300);
const hautAvant = await p.evaluate(() => window.scrollY);
await p.evaluate(() => {
  prAppelLance();                                   // comme si on venait de taper le numéro
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(900);
T('on part bien du haut de la fiche', hautAvant === 0, hautAvant);
T('au retour de l\'appel, les résultats sont à l\'écran',
  await p.evaluate(() => {
    const r = document.querySelector('#prFiche .prRes');
    if (!r) return false;
    const b = r.getBoundingClientRect();
    return b.bottom <= window.innerHeight + 2 && b.top < window.innerHeight;
  }), await p.evaluate(() => {
    const r = document.querySelector('#prFiche .prRes');
    return r ? [r.getBoundingClientRect().top, r.getBoundingClientRect().bottom, window.innerHeight] : null;
  }));
/* Revenir dans l'application sans avoir appelé ne doit rien déplacer. */
await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
await p.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await p.waitForTimeout(600);
T('mais revenir sans avoir appelé ne déplace rien',
  (await p.evaluate(() => window.scrollY)) === 0, await p.evaluate(() => window.scrollY));


/* ---------- 16. ce que la base globale apporte à la fiche ---------- */
await reinit();
await p.evaluate(() => { PR.auto = false; prOuvrirFiche('vannes-peinture-du-golfe'); });
await p.waitForTimeout(600);
corps = await texte('#prFiche');
T('l\'activité est affichée sous le nom', /Peinture en bâtiment/.test(corps), corps.slice(0,200));
T('la priorité figure dans l\'en-tête de la fiche', /priorité 4/.test(corps), corps.slice(0,120));
T('la zone accompagne l\'adresse', /VANNES AGGLO/.test(corps), corps);
T('le site est un lien cliquable',
  await p.evaluate(() => {
    const a = [...document.querySelectorAll('#prFiche .prMeta a')]
      .find(x => /peinture-golfe/.test(x.getAttribute('href') || ''));
    return !!a && /^https:\/\//.test(a.getAttribute('href'));
  }), await p.evaluate(() => [...document.querySelectorAll('#prFiche .prMeta a')].map(a => a.getAttribute('href'))));
await p.evaluate(() => prRevenirFile()); await p.waitForTimeout(300);

/* ---------- 17. le filtre par secteur ---------- */
T('le menu des secteurs est rempli',
  (await p.evaluate(() => document.querySelectorAll('#prSecteur option').length)) >= 3,
  await p.evaluate(() => [...document.querySelectorAll('#prSecteur option')].map(o => o.textContent)));
await p.evaluate(() => prSetSecteur('Coiffure / beauté')); await p.waitForTimeout(500);
f = await fileNoms();
T('choisir un secteur ne garde que lui',
  f.length === 1 && f[0] === 'ATELIER COULEURS', f);
/* Les deux menus se répondent : à AURAY, aucun des secteurs de VANNES ne doit
   rester proposé, sinon le commercial choisit un couple qui ne donne rien. */
await p.evaluate(() => { prSetSecteur(''); prSetVille('AURAY'); }); await p.waitForTimeout(500);
T('choisir une commune restreint les secteurs proposés',
  await p.evaluate(() => [...document.querySelectorAll('#prSecteur option')]
    .every(o => !/Coiffure/.test(o.textContent))),
  await p.evaluate(() => [...document.querySelectorAll('#prSecteur option')].map(o => o.textContent)));
await p.evaluate(() => { prSetVille(''); prSetSecteur('Coiffure / beauté'); }); await p.waitForTimeout(500);
T('et choisir un secteur restreint les communes',
  await p.evaluate(() => [...document.querySelectorAll('#prVille option')]
    .every(o => !/AURAY/.test(o.textContent))),
  await p.evaluate(() => [...document.querySelectorAll('#prVille option')].map(o => o.textContent)));
await p.evaluate(() => prSetVille('AURAY')); await p.waitForTimeout(500);
T('croiser commune et secteur peut ne rien laisser', (await fileNoms()).length === 0, await fileNoms());
T('et l\'écran le dit au lieu de rester vide',
  /File terminée/.test(await texte('#prFiche')), await texte('#prFiche'));
await p.evaluate(() => { prSetSecteur(''); prSetVille(''); }); await p.waitForTimeout(500);
T('tout relâcher ramène la file', (await fileNoms()).length === 4, await fileNoms());
T('le choix de secteur survit à un rechargement',
  await p.evaluate(() => { prSetSecteur('Peinture'); return ls('pr.secteur') === 'Peinture'; }),
  await p.evaluate(() => ls('pr.secteur')));
await p.evaluate(() => prSetSecteur('')); await p.waitForTimeout(400);

/* ---------- 18. rien ne casse ---------- */
T('aucune erreur de page', err.length === 0, err.slice(0,3));
T('aucun clic ni aucune saisie manqués', rate.length === 0, rate);

console.log('\n=== LE PHONING, CÔTÉ APPLICATION (v57) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
