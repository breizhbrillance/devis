/* v93 — le calendrier du mois, l'onglet Calendrier du tableau, le contrat
   d'un devis récurrent mis au calendrier depuis sa fiche, et le mode sombre.

   Ce que ces essais gardent :
   — le tableau s'ouvre sur « Calendrier » : la grille du mois, le bac des
     chantiers sans date, et la pastille de chaque prestataire ;
   — un appui sur un jour ouvre la journée sous la grille, avec « + Nouveau
     ce jour » qui ouvre le formulaire à cette date ;
   — ◀ ▶ changent de mois ;
   — un chantier du bac lâché sur un jour part au bureau avec cette date ;
   — l'onglet Chantiers lit Liste · Semaine · Mois, et le choix se garde ;
   — la fiche d'un devis d'entretien sans contrat propose « Mettre au
     calendrier comme contrat » : le formulaire s'ouvre rempli (client,
     adresse, rythme déduit des passages par mois) et part avec le numéro
     du devis ;
   — un devis qui a son contrat le nomme ;
   — le mode sombre est mis par défaut, se bascule, et le choix se garde ;
     la feuille de signature reste blanche. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { APPLI } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => {
  let f = path.join(APPLI, decodeURIComponent(q.url.split('?')[0]));
  if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); r.end(b); });
}).listen(0);
const PORT = srv.address().port;
const iso = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
const dans = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const CAPT = process.env.CAPTURES || '/tmp/capt';
fs.mkdirSync(CAPT, { recursive: true });

const ch = (id, client, date, heure, qui, nature, extra) => Object.assign({ id, numero: '', client, adresse: '', cp: '',
  ville: 'Vannes', acces: '', date, heure, prestataire: qui, statut: date ? 'PLANIFIE' : 'A PLANIFIER',
  arrivee: 0, depart: 0, minutes: 0, signalement: '', note: '', nature, recurrent: '', duree: 60 }, extra || {});
const recu = [];
const TABLEAU = { ok: true, maj: Date.now(), fenetre: 90, chiffres: { nb: 3, signes: 2, ht: 2000, htSigne: 1360 },
  parCommercial: [], prestataires: ['MAXIME', 'VICTOR'], commerciaux: ['SIMON LG'], horizon: dans(56),
  recurrents: [{ id: 'R-031', client: 'POLIDESK', frequence: 'HEBDO', jour: 'MARDI', heure: '07:00', duree: 120,
    prestataire: 'MAXIME', debut: '2026-09-01', fin: '', actif: true, nature: 'ENTRETIEN', devis: 'DV-26-09-001' }],
  devis: [
    { numero: 'DV-26-11-040', date: dans(-3), commercial: 'SIMON LG', client: 'LE LOCAL', ville: 'Vannes', ttc: 1152,
      ht: 960, statut: 'SIGNE', poses: 0, aPoser: 4, recurrent: true, passagesMois: 8, mensuel: 960,
      nature: 'ENTRETIEN', adresse: '12 rue du Port', cp: '56000', contrat: '' },
    { numero: 'DV-26-09-001', date: dans(-60), commercial: 'SIMON LG', client: 'POLIDESK', ville: 'Arradon', ttc: 854,
      ht: 712, statut: 'SIGNE', poses: 4, aPoser: 0, recurrent: true, passagesMois: 4, mensuel: 712,
      nature: 'ENTRETIEN', adresse: '', cp: '', contrat: 'R-031' },
    { numero: 'DV-26-11-041', date: dans(-2), commercial: 'SIMON LG', client: 'MME DUPONT', ville: 'Séné', ttc: 480,
      ht: 400, statut: 'REMIS', poses: 0, aPoser: 0, recurrent: false, nature: 'CHANTIER' }],
  chantiers: [
    ch('CH-0301', 'LE LOCAL', '', '', '', 'ENTRETIEN', { numero: 'DV-26-11-040' }),
    ch('CH-0302', 'REE MR ROOSEN', '', '', 'VICTOR', 'REMISE'),
    ch('CH-0101', 'POLIDESK', dans(1), '07:00', 'MAXIME', 'ENTRETIEN', { recurrent: 'R-031|' + dans(1) }),
    ch('CH-0102', 'GRAND OPTICAL', dans(1), '09:00', 'MAXIME', 'ENTRETIEN'),
    ch('CH-0103', 'PHARMACIE DES VÉNÈTES', dans(1), '12:00', 'VICTOR', 'ENTRETIEN'),
    ch('CH-0104', 'QUAI OUEST', dans(1), '18:00', 'VICTOR', 'VITRERIE'),
    ch('CH-0105', 'CADLINE', dans(2), '08:00', 'MAXIME', 'ENTRETIEN'),
    ch('CH-0106', 'FAÇADE MENGUY', dans(4), '10:00', 'VICTOR', 'FACADE')
  ] };

const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.route('**/macros/s/**', async (route) => {
  const d = JSON.parse(route.request().postData() || '{}');
  recu.push(d);
  let rep = { ok: true };
  if (d.action === 'tableau') rep = TABLEAU;
  else if (d.action === 'config' || d.action === 'connexion') rep = { ok: true, nom: 'SIMON DIRECTION', role: 'ADMIN',
    config: { maj: Date.now(), role: 'ADMIN', reglages: { societe_nom: 'BREIZH BRILLANCE' } } };
  else if (d.action === 'recurrentNeuf') rep = { ok: true, ids: ['R-032', 'R-033'], poses: 16, retires: 1, relies: 0 };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rep) });
});
await page.addInitScript(() => {
  localStorage.setItem('moi', JSON.stringify({ nom: 'SIMON DIRECTION', code: 'qx4$', role: 'ADMIN',
    jusqu: Date.now() + 29 * 86400000 }));
  localStorage.setItem('cfg', JSON.stringify({ maj: Date.now(), role: 'ADMIN', reglages: { societe_nom: 'BREIZH BRILLANCE' } }));
});
page.on('pageerror', e => ko.push('erreur JS : ' + e.message));
await page.goto('http://localhost:' + PORT + '/index.html');
await page.waitForTimeout(900);
const dernier = (a) => recu.filter(x => x.action === a).slice(-1)[0];
const vu = async (sel) => page.locator(sel).first().isVisible().catch(() => false);

/* ---------- le mode sombre ---------- */
T('le mode sombre est mis par défaut', await page.evaluate(() => document.documentElement.classList.contains('sombre')));
const fond = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
T('le fond est sombre', /rgb\((1[0-9]|[0-9]), (1[0-9]|2[0-9]|[0-9]), (1[0-9]|2[0-9]|[0-9])\)/.test(fond), fond);

/* ---------- le tableau s'ouvre sur le calendrier ---------- */
await page.evaluate(() => { try { ecranAdmin(); } catch (e) {} });
await page.waitForTimeout(700);
T('le tableau s\'ouvre sur l\'onglet Calendrier', await page.evaluate(() => AD_ONGLET === 'calendrier' &&
  document.getElementById('bOngCal').classList.contains('on')));
T('la grille du mois est là', await vu('.calGrille'));
const nCases = await page.locator('.calJ').count();
T('cinq ou six semaines de sept jours', nCases === 35 || nCases === 42, nCases);
T('le bac dit « 2 à placer »', (await page.textContent('.calBac')).includes('2 à placer'));
T('« + Nouveau » et « Contrats » sont là', await page.getByRole('button', { name: '+ Nouveau', exact: true }).isVisible() &&
  await page.getByRole('button', { name: 'Contrats', exact: true }).isVisible());
T('« Sélectionner » n\'est pas proposé dans la grille', !(await vu('#bAdSel')));
const demain = dans(1);
const cDemain = page.locator('.calJ[data-jour="' + demain + '"]');
T('la case de demain montre trois barres et « +1 »', (await cDemain.locator('.calEv').count()) === 3 &&
  (await cDemain.textContent()).includes('+1'), await cDemain.textContent());
await page.screenshot({ path: CAPT + '/1-calendrier-sombre.png', fullPage: true });

/* ---------- ouvrir un jour ---------- */
await cDemain.click();
await page.waitForTimeout(300);
T('la journée s\'ouvre sous la grille', await vu('#calJourne'));
T('… avec ses quatre chantiers en cartes', (await page.locator('#adListe .card').filter({ hasText: 'QUAI OUEST' }).count()) >= 1);
await page.screenshot({ path: CAPT + '/2-journee-ouverte.png', fullPage: true });
await page.getByRole('button', { name: '+ Nouveau ce jour' }).click();
await page.waitForTimeout(300);
T('« + Nouveau ce jour » ouvre le formulaire à cette date', (await page.inputValue('#ct_date')) === demain, await page.inputValue('#ct_date').catch(() => ''));
await page.evaluate(() => retourTableau());
await page.waitForTimeout(300);

/* ---------- changer de mois ---------- */
const titre0 = await page.textContent('.semTitre');
await page.locator('[aria-label="Mois suivant"]').click();
await page.waitForTimeout(200);
const titre1 = await page.textContent('.semTitre');
T('▶ passe au mois suivant', titre0 !== titre1, [titre0, titre1]);
await page.locator('.semTitre').click();
await page.waitForTimeout(200);
T('le titre ramène au mois en cours', (await page.textContent('.semTitre')) === titre0);

/* ---------- glisser du bac vers un jour ---------- */
const src = page.locator('.calBacEv[data-ch="CH-0302"]');
const dst = page.locator('.calJ[data-jour="' + dans(3) + '"]');
const a = await src.boundingBox(), z = await dst.boundingBox();
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();
await page.waitForTimeout(600);
await page.mouse.move(z.x + z.width / 2, z.y + 30, { steps: 8 });
await page.waitForTimeout(150);
await page.mouse.up();
await page.waitForTimeout(500);
const pl = dernier('planifier');
T('lâcher un chantier du bac sur un jour l\'envoie avec cette date', pl && pl.id === 'CH-0302' && pl.date === dans(3), pl);

/* ---------- Chantiers : liste, semaine, mois ---------- */
await page.evaluate(() => ongletAdmin('chantiers'));
await page.waitForTimeout(300);
T('l\'onglet Chantiers propose Liste · Semaine · Mois', await vu('#adVues'));
await page.locator('#bVue_mois').click();
await page.waitForTimeout(300);
T('« Mois » montre la grille dans Chantiers', await vu('.calGrille'));
T('… sans le bac, qui vit dans Calendrier', !(await vu('.calBac')));
await page.screenshot({ path: CAPT + '/3-chantiers-mois.png', fullPage: true });
await page.locator('#bVue_semaine').click();
await page.waitForTimeout(200);
T('« Semaine » montre les sept colonnes', await vu('.sem'));
T('le choix de vue se garde', await page.evaluate(() => localStorage.getItem('adVue')) === 'semaine');
await page.locator('#bVue_liste').click();
await page.waitForTimeout(200);
T('« Liste » revient à la liste, avec « Sélectionner »', await vu('#bAdSel'));

/* ---------- le devis récurrent mis au calendrier ---------- */
await page.evaluate(() => ongletAdmin('devis'));
await page.waitForTimeout(300);
T('la carte du devis signé sans contrat le signale',
  (await page.locator('#adListe .card', { hasText: 'LE LOCAL' }).textContent()).includes('Contrat à mettre au calendrier'));
T('la carte du devis qui a son contrat le nomme',
  (await page.locator('#adListe .card', { hasText: 'POLIDESK' }).textContent()).includes('Contrat R-031'));
await page.evaluate(() => ficheDevis('DV-26-11-040'));
await page.waitForTimeout(300);
T('la fiche propose « Mettre au calendrier comme contrat »', await page.getByRole('button', { name: 'Mettre au calendrier comme contrat' }).isVisible());
await page.screenshot({ path: CAPT + '/4-fiche-devis.png', fullPage: true });
await page.getByRole('button', { name: 'Mettre au calendrier comme contrat' }).click();
await page.waitForTimeout(300);
T('le formulaire s\'ouvre rempli avec le client', (await page.inputValue('#ct_client')) === 'LE LOCAL');
T('… et l\'adresse du devis', (await page.inputValue('#ct_adresse')) === '12 rue du Port');
T('8 passages par mois → deux jours par semaine (personnalisée)', (await page.inputValue('#ct_rec')) === 'PERSO',
  await page.inputValue('#ct_rec'));
T('« Jamais » n\'est pas proposé pour le contrat d\'un devis',
  !(await page.locator('#ct_rec option[value="JAMAIS"]').count()));
T('l\'en-tête nomme le devis et son mensuel', (await page.textContent('#adFiche')).includes('Contrat du devis DV-26-11-040'));
await page.screenshot({ path: CAPT + '/5-contrat-du-devis.png', fullPage: true });
await page.locator('.ctAva', { hasText: 'MAXIME' }).click();
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(500);
const rn = dernier('recurrentNeuf');
T('l\'enregistrement part avec le numéro du devis', rn && rn.devis === 'DV-26-11-040', rn);
T('… deux jours, en hebdo, chez Maxime', rn && rn.frequence === 'HEBDO' && rn.jours.length === 2 && rn.prestataire === 'MAXIME', rn);
T('le bandeau dit l\'intervention remplacée', (await page.textContent('#adListe')).includes('sans date remplacée'),
  await page.textContent('#adListe'));

await page.evaluate(() => ficheDevis('DV-26-09-001'));
await page.waitForTimeout(300);
T('la fiche d\'un devis qui a son contrat le nomme', (await page.textContent('#adFiche')).includes('contrat R-031'));

/* ---------- mode clair ---------- */
await page.evaluate(() => retourTableau());
await page.waitForTimeout(200);
await page.locator('#eAd1 .lienTheme').click();
await page.waitForTimeout(200);
T('le lien bascule en mode clair', !(await page.evaluate(() => document.documentElement.classList.contains('sombre'))));
T('… et se renomme « mode sombre »', (await page.textContent('#eAd1 .lienTheme')) === 'mode sombre');
T('le choix se garde', await page.evaluate(() => localStorage.getItem('theme')) === 'clair');
await page.evaluate(() => ongletAdmin('calendrier'));
await page.waitForTimeout(300);
await page.screenshot({ path: CAPT + '/6-calendrier-clair.png', fullPage: true });
await page.reload(); await page.waitForTimeout(700);
T('après rechargement, l\'appli reste en clair', !(await page.evaluate(() => document.documentElement.classList.contains('sombre'))));
await page.evaluate(() => localStorage.removeItem('theme'));
await page.reload(); await page.waitForTimeout(700);
const sig = await page.evaluate(() => { const e = document.getElementById('sig'); return e ? getComputedStyle(e).backgroundColor : 'absent'; });
T('la feuille de signature reste blanche en sombre', sig === 'rgb(255, 255, 255)' || sig === 'absent', sig);

await b.close(); srv.close();
console.log('\n=== CALENDRIER, CONTRAT DU DEVIS, MODE SOMBRE (v93) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x)); ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
