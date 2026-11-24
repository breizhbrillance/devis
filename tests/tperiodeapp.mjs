/* v108zg — l'écran : le planning au-delà de la fenêtre du tableau.
   — en avançant de cinq mois, l'appli demande la grille au bureau
     (chantiersPeriode), une seule fois ;
   — l'intervention d'avril s'affiche dans sa case, et sa fiche s'ouvre ;
   — les passages prévus d'un contrat s'affichent en pointillé, sans prise ;
   — la journée d'un passage prévu propose de modifier le contrat ;
   — la semaine les montre aussi, et l'appui ne casse rien ;
   — dans la fenêtre du tableau, rien n'est demandé. */
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
const moisPlus = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d; };
const M5 = moisPlus(5), m5 = iso(M5).slice(0, 7);
const j14 = m5 + '-14', j15 = m5 + '-15';
const ch = (id, client, date, extra) => Object.assign({ id, numero: '', client, adresse: '', cp: '', ville: 'Vannes',
  acces: '', date, heure: '10:00', prestataire: 'MAXIME', statut: date ? 'PLANIFIE' : 'A PLANIFIER', arrivee: 0,
  depart: 0, minutes: 0, signalement: '', note: '', nature: 'ENTRETIEN', recurrent: '', suiteDe: '', lot: '',
  fiche: '', ferie: '', duree: 60, tel: '', contactTel: '' }, extra || {});
const TABLEAU = { ok: true, maj: Date.now(), fenetre: 90, chantiersDu: dans(-30), chantiersAu: dans(90),
  chiffres: { nb: 0, signes: 0, ht: 0, htSigne: 0 }, parCommercial: [], devis: [],
  chantiers: [ch('CH-0001', 'DEMAIN', dans(1))], prestataires: ['MAXIME'], commerciaux: [],
  aFaireIgnores: { cles: [] }, absences: [], clients: [],
  recurrents: [{ id: 'R-001', client: 'SANS FIN', frequence: 'HEBDO', jour: 'MARDI', heure: '15:00', actif: true,
    debut: dans(-20), fin: '', prestataire: 'MAXIME' }], horizon: dans(56) };
const recu = [];
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.route('**/macros/s/**', async (route) => {
  const d = JSON.parse(route.request().postData() || '{}');
  recu.push(d);
  let rep = { ok: true };
  if (d.action === 'tableau') rep = TABLEAU;
  else if (d.action === 'version') rep = { ok: true, v: '1' };
  else if (d.action === 'config' || d.action === 'connexion') rep = { ok: true, nom: 'SIMON DIRECTION', role: 'ADMIN',
    config: { maj: Date.now(), role: 'ADMIN', reglages: { societe_nom: 'BREIZH BRILLANCE' } } };
  else if (d.action === 'chantiersPeriode') {
    const prevus = [];
    for (let x = new Date(d.du + 'T12:00:00'); iso(x) <= d.au; x.setDate(x.getDate() + 1)) {
      if (x.getDay() === 2) prevus.push({ id: 'P|R-001|' + iso(x), prevu: true, recurrent: 'R-001|' + iso(x), contrat: 'R-001',
        client: 'SANS FIN', ville: 'Vannes', date: iso(x), heure: '15:00', prestataire: 'MAXIME', nature: 'ENTRETIEN', duree: 60, reconduction: false });
    }
    rep = { ok: true, du: d.du, au: d.au, chantiers: [ch('CH-0900', 'VITRES AVRIL', j14, { nature: 'VITRERIE' }),
      ch('CH-0901', 'ANNULE', j15, { statut: 'ANNULE' })], prevus };
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rep) });
});
await page.addInitScript(() => {
  localStorage.setItem('moi', JSON.stringify({ nom: 'SIMON DIRECTION', code: 'qx4$', role: 'ADMIN', jusqu: Date.now() + 29 * 86400000 }));
  localStorage.setItem('cfg', JSON.stringify({ maj: Date.now(), role: 'ADMIN', reglages: { societe_nom: 'BREIZH BRILLANCE' } }));
});
page.on('pageerror', e => ko.push('erreur JS : ' + e.message));
await page.goto('http://localhost:' + PORT + '/index.html');
await page.waitForTimeout(900);
await page.evaluate(() => { try { ecranAdmin(); } catch (e) {} });
await page.waitForTimeout(500);
await page.evaluate(() => chargerTableau());
await page.waitForTimeout(500);
await page.evaluate(() => { ongletAdmin('chantiers'); vueChantiers('mois'); });
await page.waitForTimeout(400);
const nP = () => recu.filter(x => x.action === 'chantiersPeriode').length;
T('le mois en cours ne demande rien', nP() === 0, nP());
T('demain est dans sa case', (await page.locator('.calEv[data-ch="CH-0001"]').count()) === 1);
for (let i = 0; i < 5; i++) { await page.evaluate(() => moisBouger(1)); await page.waitForTimeout(150); }
await page.waitForTimeout(800);
const dem = recu.filter(x => x.action === 'chantiersPeriode');
T('cinq mois plus loin, la grille est demandée au bureau', dem.some(x => x.du <= m5 + '-01' && x.au >= m5 + '-28'), dem.map(x => x.du + '→' + x.au));
T('chaque grille est demandée une seule fois', new Set(dem.map(x => x.du + x.au)).size === dem.length, dem.length);
T('l\'intervention du 14 est dans sa case', (await page.locator('.calJ[data-jour="' + j14 + '"] .calEv[data-ch="CH-0900"]').count()) === 1);
T('l\'annulée n\'est pas dans la grille', (await page.locator('.calEv[data-ch="CH-0901"]').count()) === 0);
const nPrev = await page.locator('.calEv.calPrevu').count();
T('les mardis du contrat sont en pointillé', nPrev >= 4, nPrev);
T('un prévu n\'a pas de prise (pas de data-ch)', (await page.locator('.calEv.calPrevu[data-ch]').count()) === 0);
const compte = await page.textContent('.semCompte');
T('le compte du mois parle des prévus', /prévu/.test(compte) && /1 chantier/.test(compte), compte);
T('le titre est bien le 5e mois', await page.evaluate((p) => moisVu() === p, m5));
await page.screenshot({ path: '/tmp/capt_mois.png', fullPage: true });

/* la journée d'un mardi prévu */
const mardi = await page.locator('.calEv.calPrevu').first().evaluate(e => e.closest('.calJ').getAttribute('data-jour'));
await page.locator('.calJ[data-jour="' + mardi + '"]').click();
await page.waitForTimeout(300);
T('la journée montre le passage prévu', (await page.locator('.calPrevuC').count()) === 1);
T('et propose de modifier le contrat', (await page.locator('.calPrevuC button').textContent()).includes('Modifier le contrat'));
await page.screenshot({ path: '/tmp/capt_jour.png', fullPage: true });

/* la fiche de l'intervention d'avril */
await page.locator('.calJ[data-jour="' + j14 + '"]').click();
await page.waitForTimeout(300);
await page.evaluate(() => ficheChantier('CH-0900'));
await page.waitForTimeout(400);
T('la fiche de l\'intervention lointaine s\'ouvre', await page.evaluate(() => AD_FICHE && AD_FICHE.cle === 'CH-0900'));
await page.evaluate(() => { try { retourAdmin(); } catch (e) { montrer('eAd1'); peindreTableau(); } });
await page.waitForTimeout(300);

/* la semaine */
await page.evaluate((j) => semaineDuJour(j), j14);
await page.waitForTimeout(900);
const sPrev = await page.locator('.semEv.semPrevu').count();
T('la semaine montre le mardi prévu', sPrev === 1, sPrev);
T('et l\'intervention du 14', (await page.locator('.semEv[data-ch="CH-0900"]').count()) === 1);
T('la semaine est servie par la grille déjà reçue', recu.filter(x => x.action === 'chantiersPeriode').length === dem.length, recu.filter(x => x.action === 'chantiersPeriode').length);
await page.locator('.semEv.semPrevu').click();
await page.waitForTimeout(300);
T('l\'appui sur un prévu dit ce que c\'est', (await page.textContent('#annonceV108x')).includes('Passage prévu du contrat R-001'));
await page.screenshot({ path: '/tmp/capt_sem.png', fullPage: true });

/* un rafraîchissement du tableau garde le mois lointain */
TABLEAU.maj = Date.now() + 5;
await page.evaluate(() => { vueChantiers('mois'); chargerTableau(); });
await page.waitForTimeout(1200);
T('après rafraîchissement, l\'intervention lointaine reste là', (await page.locator('.calEv[data-ch="CH-0900"]').count()) === 1);
T('et la grille est redemandée une fois', recu.filter(x => x.action === 'chantiersPeriode').length === dem.length + 1, recu.filter(x => x.action === 'chantiersPeriode').length);

await b.close(); srv.close();
console.log(ok.length + '/' + (ok.length + ko.length) + ' essais passés');
ko.forEach(k => console.log('  ÉCHEC ' + k));
process.exit(ko.length ? 1 : 0);
