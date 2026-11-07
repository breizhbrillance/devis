/* « Nouvel événement », à la FamilyWall (v92, 7 novembre 2026) — côté écran.

   Ce que ces essais gardent :
   — « + Nouveau » ouvre un formulaire dans l'ordre de FamilyWall : titre,
     de / à, toute la journée, couleur, participant, récurrence, jusqu'au,
     où, description ;
   — « Jamais » envoie un chantier ponctuel (chantierNeuf), avec la durée
     tirée de « de » et « à » ;
   — « Toutes les semaines » envoie un contrat (recurrentNeuf) sur le jour de
     la date ; cocher un second jour passe en « Personnalisée » ;
   — « Tous les jours de la semaine » coche du lundi au vendredi ;
   — « Tous les 2 mois, le 3e jeudi » envoie RANG et intervalle 2 ;
   — taper un titre puis toucher une pastille ne l'efface pas ;
   — la fiche d'un passage de contrat dit son rythme, « Modifier les
     suivants » rouvre le formulaire rempli et envoie recurrentModif à partir
     de ce passage ; « Arrêter ici » demande confirmation puis recurrentStop ;
   — la liste des contrats sépare ceux en cours des terminés ;
   — un refus du bureau (doublon) se lit à l'écran. */
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
/* Le prochain jeudi, pour un passage de contrat à venir. */
const jeudi = (() => { const d = new Date(); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7)); return iso(d); })();

const recu = [];
let refusSuivant = null;
const TABLEAU = { ok: true, maj: Date.now(), fenetre: 90, chiffres: {}, parCommercial: [], devis: [],
  prestataires: ['MAXIME', 'SIMON LG', 'VICTOR'], commerciaux: ['SIMON LG'],
  horizon: dans(56),
  recurrents: [
    { id: 'R-003', client: 'AXA THEIX', adresse: 'Rue des Sports', cp: '56450', ville: 'Theix-Noyalo',
      acces: '', frequence: 'QUINZAINE', jour: 'JEUDI', jourMois: '', intervalle: '', heure: '10:30', duree: 60,
      prestataire: 'MAXIME', debut: '2026-09-10', fin: '', actif: true, nature: 'ENTRETIEN',
      prestations: 'Entretien des locaux', exclusions: [] },
    { id: 'R-009', client: 'CIMEO', frequence: 'HEBDO', jour: 'LUNDI', heure: '14:00', duree: 300,
      prestataire: 'MAXIME', debut: '2025-11-17', fin: '2026-04-27', actif: true, nature: 'ENTRETIEN' }
  ],
  chantiers: [
    { id: 'CH-0101', numero: '', client: 'AXA THEIX', adresse: 'Rue des Sports', cp: '56450', ville: 'Theix-Noyalo',
      acces: '', date: jeudi, heure: '10:30', prestataire: 'MAXIME', statut: 'PLANIFIE', arrivee: 0, depart: 0,
      minutes: 0, signalement: '', note: 'Entretien des locaux', nature: 'ENTRETIEN',
      recurrent: 'R-003|' + jeudi, duree: 60 }
  ] };

const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
await page.route('**/macros/s/**', async (route) => {
  const d = JSON.parse(route.request().postData() || '{}');
  recu.push(d);
  let rep = { ok: true };
  if (d.action === 'tableau') rep = TABLEAU;
  else if (d.action === 'config' || d.action === 'connexion') rep = { ok: true, nom: 'SIMON DIRECTION', role: 'ADMIN',
    config: { maj: Date.now(), role: 'ADMIN', reglages: { societe_nom: 'BREIZH BRILLANCE' } } };
  else if (refusSuivant) { rep = refusSuivant; refusSuivant = null; }
  else if (d.action === 'recurrentNeuf') rep = { ok: true, ids: ['R-010'], poses: 8 };
  else if (d.action === 'recurrentModif') rep = { ok: true, ids: ['R-011'], poses: 4, enPlace: false };
  else if (d.action === 'recurrentStop') rep = { ok: true, retires: 3, fin: dans(6) };
  else if (d.action === 'chantierNeuf') rep = { ok: true, id: 'CH-0200', statut: 'PLANIFIE' };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rep) });
});
await page.addInitScript(() => {
  localStorage.setItem('moi', JSON.stringify({ nom: 'SIMON DIRECTION', code: 'qx4$', role: 'ADMIN',
    jusqu: Date.now() + 29 * 86400000 }));
  localStorage.setItem('cfg', JSON.stringify({ maj: Date.now(), role: 'ADMIN', reglages: { societe_nom: 'BREIZH BRILLANCE' } }));
});
page.on('pageerror', e => ko.push('erreur JS : ' + e.message));
await page.goto('http://localhost:' + PORT + '/index.html');
await page.waitForTimeout(800);
const dernier = (a) => recu.filter(x => x.action === a).slice(-1)[0];
const vu = async (sel) => page.locator(sel).first().isVisible().catch(() => false);

/* Aller au tableau, onglet chantiers. */
await page.evaluate(() => { try { ecranAdmin(); ongletAdmin('chantiers'); } catch (e) {} });
await page.waitForTimeout(600);
T('le tableau du gérant s\'ouvre', await vu('#eAd1'), null);
T('le bouton « + Nouveau » est là', await page.getByRole('button', { name: '+ Nouveau', exact: true }).isVisible());
T('le bouton « Contrats » est là', await page.getByRole('button', { name: 'Contrats', exact: true }).isVisible());

/* ---------- 1. le formulaire ---------- */
await page.getByRole('button', { name: '+ Nouveau', exact: true }).click();
await page.waitForTimeout(300);
T('le titre de l\'écran est « Nouvel événement »', (await page.textContent('#hTitre')) === 'Nouvel événement', await page.textContent('#hTitre'));
const ordre = await page.evaluate(() => Array.from(document.querySelectorAll('#adFiche label, #adFiche .ctTitre'))
  .map(e => e.classList.contains('ctTitre') ? 'Titre' : e.textContent.trim()).filter(Boolean));
const attendu = ['Titre', 'De', 'À', 'Toute la journée', 'Couleur', 'Participant', 'Récurrence', 'Où ?'];
T('l\'ordre est celui de FamilyWall', attendu.every((x, i) => ordre.indexOf(x) >= 0 && (i === 0 || ordre.indexOf(x) > ordre.indexOf(attendu[i - 1]))), ordre);
T('la récurrence vaut « Jamais » par défaut', (await page.inputValue('#ct_rec')) === 'JAMAIS');
T('« Jusqu\'au » n\'apparaît pas tant qu\'on ne répète pas', !(await vu('#ct_jusqua')));

/* ---------- 2. un ponctuel ---------- */
await page.fill('#ct_client', 'REE MR ROOSEN');
await page.locator('.ctCoul', { hasText: 'Remise en état' }).click();
T('toucher une couleur garde le titre tapé', (await page.inputValue('#ct_client')) === 'REE MR ROOSEN');
await page.locator('.ctAva', { hasText: 'MAXIME' }).click();
await page.fill('#ct_date', dans(6)); await page.dispatchEvent('#ct_date', 'change');
await page.fill('#ct_heure', '14:00'); await page.dispatchEvent('#ct_heure', 'change');
await page.fill('#ct_fin', '16:30'); await page.dispatchEvent('#ct_fin', 'change');
await page.fill('#ct_adresse', '4 impasse de la Fontaine');
await page.fill('#ct_note', 'Récupérer les clés');
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(500);
let e = dernier('chantierNeuf');
T('« Jamais » envoie un chantier ponctuel', !!e && !dernier('recurrentNeuf'), recu.map(x => x.action));
T('avec client, date, heure, durée (2 h 30), salarié, nature, adresse, note',
  e && e.client === 'REE MR ROOSEN' && e.date === dans(6) && e.heure === '14:00' && Number(e.duree) === 150 &&
  e.prestataire === 'MAXIME' && e.nature === 'REMISE' && e.adresse === '4 impasse de la Fontaine' && e.note === 'Récupérer les clés', e);
T('le tableau dit « Chantier créé »', (await page.textContent('#adListe')).indexOf('Chantier créé') >= 0);

/* ---------- 3. toutes les semaines ---------- */
await page.getByRole('button', { name: '+ Nouveau', exact: true }).click();
await page.fill('#ct_client', 'LOCAUX POWUP');
await page.fill('#ct_date', jeudi); await page.dispatchEvent('#ct_date', 'change');
await page.selectOption('#ct_rec', 'SEMAINE');
await page.waitForTimeout(150);
const coches = () => page.evaluate(() => Array.from(document.querySelectorAll('.ctJ.on')).map(x => x.getAttribute('aria-label')));
T('« Toutes les semaines » coche le jour de la date (jeudi)', JSON.stringify(await coches()) === '["jeudi"]', await coches());
T('« Jusqu\'au » apparaît, sans échéance', await vu('#ct_jusqua') && (await page.textContent('#adFiche')).indexOf('Pas d\'échéance') >= 0);
T('le titre a survécu au changement de récurrence', (await page.inputValue('#ct_client')) === 'LOCAUX POWUP');
await page.locator('.ctJ[aria-label="lundi"]').click();
T('cocher un second jour passe en « Personnalisée »', (await page.inputValue('#ct_rec')) === 'PERSO');
await page.fill('#ct_heure', '07:15'); await page.dispatchEvent('#ct_heure', 'change');
await page.locator('.ctAva', { hasText: 'VICTOR' }).click();
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(500);
e = dernier('recurrentNeuf');
T('un contrat part au bureau', !!e, recu.map(x => x.action));
T('toutes les semaines, lundi et jeudi, depuis la date, à 07:15, VICTOR',
  e && e.frequence === 'HEBDO' && JSON.stringify(e.jours) === '[1,4]' && e.debut === jeudi && e.heure === '07:15' &&
  e.prestataire === 'VICTOR' && e.fin === '', e);
T('le tableau dit « Contrat créé (R-010) · 8 passages posés »',
  (await page.textContent('#adListe')).indexOf('Contrat créé (R-010) · 8 passages posés') >= 0);

/* ---------- 4. jours ouvrés, 2 semaines, 2 mois ---------- */
await page.getByRole('button', { name: '+ Nouveau', exact: true }).click();
await page.fill('#ct_client', 'X');
await page.selectOption('#ct_rec', 'OUVRES');
T('« Tous les jours de la semaine » coche du lundi au vendredi',
  JSON.stringify(await coches()) === '["lundi","mardi","mercredi","jeudi","vendredi"]', await coches());
await page.selectOption('#ct_rec', 'QUINZAINE');
T('« Toutes les 2 semaines » revient au jour de la date', (await coches()).length === 1);
await page.fill('#ct_date', '2026-11-19'); await page.dispatchEvent('#ct_date', 'change');
await page.selectOption('#ct_rec', 'MOIS2');
await page.waitForTimeout(100);
T('« Tous les 2 mois » propose « le 19 » et « le 3e jeudi »',
  (await page.textContent('#adFiche')).indexOf('le 19 du mois') >= 0 && (await page.textContent('#adFiche')).indexOf('le 3e jeudi du mois') >= 0);
await page.locator('.puce', { hasText: 'le 3e jeudi du mois' }).click();
await page.fill('#ct_jusqua', '2027-11-30');
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(500);
e = dernier('recurrentNeuf');
T('le 3e jeudi, tous les 2 mois, jusqu\'au 30/11/2027', e && e.frequence === 'MENSUEL' && e.mensuel === 'RANG' &&
  Number(e.intervalle) === 2 && e.fin === '2027-11-30' && e.debut === '2026-11-19', e);

/* ---------- 5. un refus du bureau ---------- */
await page.getByRole('button', { name: '+ Nouveau', exact: true }).click();
await page.fill('#ct_client', 'AXA THEIX'); await page.selectOption('#ct_rec', 'SEMAINE');
refusSuivant = { ok: false, erreur: 'ce contrat existe déjà (R-003)' };
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(500);
T('un doublon refusé se lit à l\'écran, la fiche reste ouverte',
  (await page.textContent('#erreur')).indexOf('existe déjà (R-003)') >= 0 && await vu('#ct_client'), await page.textContent('#erreur'));
T('sans titre, rien ne part', await (async () => { const n = recu.length; await page.fill('#ct_client', '');
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(200); return recu.length === n; })());
await page.getByRole('button', { name: 'Annuler' }).click();

/* ---------- 6. la fiche d'un passage de contrat ---------- */
await page.evaluate(() => ficheChantier('CH-0101'));
await page.waitForTimeout(300);
const fiche = await page.textContent('#adFiche');
T('la fiche dit « Contrat R-003 » et son rythme', fiche.indexOf('Contrat R-003') >= 0 &&
  fiche.indexOf('Toutes les 2 semaines, le jeudi à 10:30') >= 0, fiche.slice(0, 300));
T('et que la fiche ne change que ce passage', fiche.indexOf('ne change que ce passage') >= 0);
await page.getByRole('button', { name: 'Modifier les suivants' }).click();
await page.waitForTimeout(300);
T('« Modifier les suivants » rouvre le formulaire rempli',
  (await page.inputValue('#ct_client')) === 'AXA THEIX' && (await page.inputValue('#ct_rec')) === 'QUINZAINE' &&
  (await page.inputValue('#ct_heure')) === '10:30' && (await page.inputValue('#ct_fin')) === '11:30', await page.inputValue('#ct_rec'));
T('il dit à partir de quel passage', (await page.textContent('#adFiche')).indexOf('à partir du') >= 0);
T('« Jamais » n\'est pas proposé pour un contrat', !(await page.locator('#ct_rec option[value="JAMAIS"]').count()));
await page.fill('#ct_heure', '11:00'); await page.dispatchEvent('#ct_heure', 'change');
T('déplacer le début déplace la fin d\'autant (12:00)', (await page.inputValue('#ct_fin')) === '12:00', await page.inputValue('#ct_fin'));
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(500);
e = dernier('recurrentModif');
T('la modification part avec le contrat et la date du passage', e && e.id === 'R-003' && e.aPartirDe === jeudi &&
  e.heure === '11:00' && Number(e.duree) === 60 && e.frequence === 'QUINZAINE' && JSON.stringify(e.jours) === '[4]', e);

await page.evaluate(() => ficheChantier('CH-0101'));
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Arrêter ici' }).click();
await page.waitForTimeout(200);
T('arrêter demande confirmation', await vu('#dlgConf'));
await page.click('#confOui');
await page.waitForTimeout(500);
e = dernier('recurrentStop');
T('l\'arrêt part avec la date du passage', e && e.id === 'R-003' && e.aPartirDe === jeudi, e);

/* ---------- 7. la liste des contrats ---------- */
await page.evaluate(() => { ecranAdmin(); ongletAdmin('chantiers'); });
await page.getByRole('button', { name: 'Contrats', exact: true }).click();
await page.waitForTimeout(300);
const lc = await page.textContent('#adFiche');
T('la liste des contrats sépare en cours et terminés', lc.indexOf('En cours (1)') >= 0 && lc.indexOf('Terminés (1)') >= 0, lc.slice(0, 200));

await b.close(); srv.close();
console.log('\n=== NOUVEL ÉVÉNEMENT, À LA FAMILYWALL (v92) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
