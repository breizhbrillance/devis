/* Une remise posée sur un devis déjà établi (v55).

   Le commercial remet son devis, le client négocie une semaine plus tard.
   Jusqu'ici il fallait tout ressaisir — et deux saisies ne tombent pas
   forcément sur le même chiffre. Depuis « Mes devis », il pose la remise sur
   le devis existant : même numéro, mêmes lignes, mêmes prix, seule la remise
   change. Le PDF est refait et le bureau reçoit le nouveau montant.

   Décision de Simon : **uniquement les devis qui ne sont pas signés.** Un
   client qui a signé a accepté un montant ; on ne le change pas dans son dos.
   Pour reprendre un devis signé, il y a « Dupliquer ».

   Ce que ces essais gardent :
   — le bouton n'apparaît pas sur un devis signé, et la fonction refuse même
     si on l'appelle quand même (un devis peut être signé sur un autre
     appareil pendant que la fenêtre est ouverte) ;
   — le plafond du bureau tient ici comme à l'établissement ;
   — ce que l'écran annonce est exactement ce qui est enregistré : même
     arithmétique des deux côtés, parce que c'est la même fonction ;
   — la remise descend sur chaque ligne, sans quoi le classeur et le PDF, qui
     calculent ligne à ligne, ne tomberaient pas sur le même euro ;
   — le devis repart au bureau marqué « révision », faute de quoi le serveur
     le prendrait pour un doublon et garderait l'ancien prix ;
   — le numéro ne change pas : c'est le même devis, moins cher.
*/
import { chromium } from 'playwright';
import { lancer, recu, reglagesSup } from './srvco.mjs';
import { CHROME } from './chemins.mjs';
import { ajouterUne, poserQte } from './presta.mjs';

const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();

reglagesSup.remise_max = '20';

const PORT = 8372; await lancer(PORT);
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
const ouvert = (sel) => p.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && (e.open || e.hasAttribute('open')));
}, sel);
/* Les boutons d'une carte de la liste, pour un devis donné. */
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

/* Un devis de 200 € HT : 80 m² de vitres à 2,50 €. Les chiffres ronds rendent
   les contrôles lisibles — 10 % de remise font 20 € pile. */
/* Une image de signature minuscule mais valide : le PDF l'incorpore vraiment. */
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

/* ---------- 1. le bouton est là, sur un devis non signé ---------- */
let b1 = await boutons(id);
T('un devis non signé propose « Remise »', b1.indexOf('Remise') >= 0, b1);
T('il propose aussi « Signer »', b1.indexOf('Signer') >= 0, b1);

/* ---------- 2. ce que la fenêtre annonce ---------- */
await clic('#liste .hist .acts button:has-text("Remise")'); await p.waitForTimeout(900);
T('la fenêtre s\'ouvre', await ouvert('#dlgRem'));
T('elle nomme le client', (await texte('#remDqui')) === 'MAIRIE DE TEST', await texte('#remDqui'));
T('elle rappelle le numéro et le montant d\'aujourd\'hui',
  /240,00/.test(await texte('#remDnum')), await texte('#remDnum'));
T('la remise part de celle du devis', (await p.inputValue('#remDpct')) === '0',
  await p.inputValue('#remDpct'));
T('avant : 240 € TTC', (await texte('#remDavant')).replace(/\s/g, ' ') === '240,00 €',
  await texte('#remDavant'));

await remplir('#remDpct', '10'); await p.waitForTimeout(400);
T('à 10 %, le nouveau total est annoncé : 216 €',
  (await texte('#remDapres')).replace(/\s/g, ' ') === '216,00 €', await texte('#remDapres'));
T('et la remise, 24 € TTC', /24,00/.test(await texte('#remDgain')), await texte('#remDgain'));

/* ---------- 3. le plafond du bureau ---------- */
await remplir('#remDpct', '50'); await p.waitForTimeout(500);
T('une remise au-dessus du plafond est ramenée à 20 %',
  /^20/.test(await p.inputValue('#remDpct')), await p.inputValue('#remDpct'));
T('et le total suit le plafond, pas la saisie',
  (await texte('#remDapres')).replace(/\s/g, ' ') === '192,00 €', await texte('#remDapres'));

/* ---------- 4. appliquer ---------- */
await remplir('#remDpct', '10'); await p.waitForTimeout(400);
const annonce = await texte('#remDapres');
/* L'empreinte du PDF d'avant : le devis révisé doit en porter un autre, sans
   quoi le client recevrait un papier au vieux prix. */
const pdfAvant = await p.evaluate(async (i) => ((await DB.get(i)) || {}).pdf || '', id);
const avant = recu.length;
await clic('#remDok'); await p.waitForTimeout(3000);
T('la fenêtre se referme', !(await ouvert('#dlgRem')));

const env = recu.slice(avant).filter(x => x.action === 'sync').pop();
T('le devis repart au bureau', !!env, recu.slice(avant).map(x => x.action));
T('marqué comme une révision — sans quoi le bureau le croirait en double',
  env && env.revision === true, env && env.revision);
T('la remise du devis est posée', env && Number(env.devis.remise) === 10, env && env.devis.remise);
T('elle est descendue sur la ligne',
  env && Number(env.devis.lignes[0].rem) === 10, env && env.devis.lignes[0]);
T('le total envoyé est celui qui était annoncé à l\'écran',
  env && ('' + env.devis.totaux.ttc) === '216', { annonce: annonce, envoye: env && env.devis.totaux.ttc });
T('le HT aussi : 180 €', env && env.devis.totaux.ht === 180, env && env.devis.totaux);
T('la remise lue au total vaut 20 € HT', env && env.devis.totaux.remise === 20, env && env.devis.totaux);
T('le brut ne bouge pas : la remise ne change pas les prix',
  env && env.devis.totaux.brut === 200, env && env.devis.totaux);
T('un PDF neuf accompagne le devis', env && typeof env.pdf === 'string' && env.pdf.length > 1000,
  env && (env.pdf || '').length);
T('et ce n\'est pas celui d\'avant : il porte le nouveau prix',
  env && env.pdf !== pdfAvant, { avant: pdfAvant.length, apres: env && (env.pdf || '').length });
T('le nouveau total s\'y lit', await p.evaluate(async (b64) => {
  await chargerLecteur();
  const bin = atob(String(b64).split(',').pop());
  const oct = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({ data: oct }).promise;
  const t = (await (await doc.getPage(1)).getTextContent()).items.map(x => x.str).join(' ');
  return /216,00/.test(t) && !/240,00/.test(t);
}, env && env.pdf), 'le PDF envoyé');

const apres = await p.evaluate(async (i) => {
  const e = await DB.get(i);
  return { numero: e.numero, remise: e.devis.remise, ttc: e.devis.totaux.ttc,
           statut: e.statut, rev: !!e.revision, qte: e.devis.lignes[0].qte,
           pu: e.devis.lignes[0].pu };
}, id);
T('le devis garde son numéro : c\'est le même devis, moins cher',
  /SLG-01$/.test(apres.numero) || !/\/ S$/.test(apres.numero), apres.numero);
T('ses quantités et ses prix n\'ont pas bougé',
  apres.qte === 80 && apres.pu === 2.5, apres);
T('la marque de révision est retirée une fois le devis parti',
  apres.rev === false, apres);

/* ---------- 5. la même remise deux fois ---------- */
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(800);
await clic('#liste .hist .acts button:has-text("Remise")'); await p.waitForTimeout(800);
T('la fenêtre repart de la remise en place', (await p.inputValue('#remDpct')) === '10',
  await p.inputValue('#remDpct'));
const avant2 = recu.length;
await clic('#remDok'); await p.waitForTimeout(1500);
T('reposer la même remise ne renvoie rien au bureau',
  recu.slice(avant2).filter(x => x.action === 'sync').length === 0,
  recu.slice(avant2).map(x => x.action));
T('et le commercial est prévenu que rien n\'a changé',
  /déjà à 10/.test(await texte('#erreur')) || /rien/.test(await texte('#erreur')), await texte('#erreur'));

/* ---------- 5 bis. le plafond tient aussi au moment d'appliquer ---------- */
/* Un champ rempli sans passer par la saisie — un doigt qui colle, un navigateur
   qui restaure un formulaire — ne doit pas faire sauter le plafond. */
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(800);
await clic('#liste .hist .acts button:has-text("Remise")'); await p.waitForTimeout(800);
await p.evaluate(() => { document.getElementById('remDpct').value = '40'; });
const avantP = recu.length;
await clic('#remDok'); await p.waitForTimeout(3000);
const envP = recu.slice(avantP).filter(x => x.action === 'sync').pop();
T('une remise de 40 % posée sans saisie est ramenée au plafond',
  envP && Number(envP.devis.remise) === 20, envP && envP.devis.remise);
T('et le total suit le plafond : 192 €',
  envP && envP.devis.totaux.ttc === 192, envP && envP.devis.totaux);

/* ---------- 5 ter. un contrat d'entretien reste mensualisé ---------- */
await p.evaluate(() => nouveauDevis()); await p.waitForTimeout(700);
await clic('#chPRO'); await p.waitForTimeout(300);
await clic('#chENT'); await p.waitForTimeout(400);
await remplir('#fPassages', '4'); await p.waitForTimeout(300);
await clic('#bSuiv'); await p.waitForTimeout(600);
await remplir('#cSociete', 'CONTRAT TEST'); await remplir('#cContact', 'Jean');
await remplir('#cAdresse', '1 rue'); await remplir('#cCp', '56250'); await remplir('#cVille', 'Monterblanc');
await clic('#bSuiv'); await p.waitForTimeout(700);
await poserQte(p, 1, 100);                    // 100 m²/mois à 1,20 € = 120 € le passage
await clic('#bSuiv'); await p.waitForTimeout(800);
await remplir('#fDate', DEMAIN); await remplir('#fSignataire', 'Jean');
await clic('#bSuiv'); await p.waitForTimeout(2500);
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(900);
const idC = await p.evaluate(async () => (await DB.tous()).sort((a, b) => b.cree - a.cree)[0].id);
const moisAvant = await p.evaluate(async (i) => (await DB.get(i)).devis.totaux, idC);
T('le contrat part bien mensualisé', moisAvant.htMensuel === 480 && moisAvant.passages === 4,
  moisAvant);
await p.evaluate((i) => ouvrirRemiseDevis(i), idC); await p.waitForTimeout(900);
await remplir('#remDpct', '10'); await p.waitForTimeout(400);
T('la fenêtre annonce le mois remisé : 518,40 € TTC',
  (await texte('#remDapres')).replace(/\s/g, ' ') === '518,40 €', await texte('#remDapres'));
const avantC = recu.length;
await clic('#remDok'); await p.waitForTimeout(3000);
const envC = recu.slice(avantC).filter(x => x.action === 'sync').pop();
T('le contrat révisé reste mensualisé',
  envC && envC.devis.totaux.htMensuel === 432 && envC.devis.totaux.htPonctuel === 0,
  envC && envC.devis.totaux);
T('et ses quatre passages sont toujours comptés',
  envC && envC.devis.totaux.passages === 4, envC && envC.devis.totaux);
T('le prix d\'un passage est celui du passage remisé',
  envC && envC.devis.totaux.parPassage === 108, envC && envC.devis.totaux);

/* ---------- 6. un devis signé n'y a pas droit ---------- */
await p.evaluate(() => nouveauDevis()); await p.waitForTimeout(700);
await unDevis();
/* On le fait signer par le chemin de l'application elle-même, celui qu'emprunte
   « Signer » depuis la liste : le devis change de numéro et son PDF est refait. */
const idS = await p.evaluate(async () => (await DB.tous())
  .filter(e => !(e.devis || {}).signature)
  .sort((a, b) => b.cree - a.cree)[0].id);
await p.evaluate(async (a) => {
  await appliquerSignature(a.id, a.img, 'Jean Test');
}, { id: idS, img: SIGNATURE });
await p.waitForTimeout(1500);
await p.evaluate(() => ouvrirHistorique()); await p.waitForTimeout(900);
T('le devis signé est bien signé',
  await p.evaluate(async (i) => !!((await DB.get(i)) || {}).devis.signature, idS), idS);
const b2 = await boutons(idS);
T('un devis signé ne propose pas « Remise »', b2.indexOf('Remise') < 0, b2);
T('ni « Signer »', b2.indexOf('Signer') < 0, b2);
T('mais il propose toujours « Dupliquer »', b2.indexOf('Dupliquer') >= 0, b2);

/* Et si on appelle la fonction quand même — un devis peut avoir été signé sur
   un autre appareil pendant que la liste était affichée. */
const avant3 = recu.length;
await p.evaluate((i) => ouvrirRemiseDevis(i), idS);
await p.waitForTimeout(900);
T('appelée sur un devis signé, la fenêtre ne s\'ouvre pas', !(await ouvert('#dlgRem')));
T('et le refus est expliqué', /signé/i.test(await texte('#erreur')), await texte('#erreur'));
T('rien n\'est reparti au bureau',
  recu.slice(avant3).filter(x => x.action === 'sync').length === 0,
  recu.slice(avant3).map(x => x.action));
const sigIntact = await p.evaluate(async (i) => {
  const e = await DB.get(i);
  if (!e) return { absent: true };
  return { remise: Number(e.devis.remise) || 0, ttc: e.devis.totaux.ttc,
           signe: !!e.devis.signature };
}, idS);
T('le devis signé est intact',
  sigIntact.signe === true && sigIntact.remise === 0 && sigIntact.ttc === 240, sigIntact);

/* ---------- 7. l'arithmétique est la même des deux côtés ---------- */
T('totauxDe sur les lignes d\'un devis retombe sur ses totaux', await p.evaluate(async (i) => {
  const e = await DB.get(i);
  if (!e) return false;
  const t = totauxDe(e.devis.lignes, Number(e.devis.passages) > 0, Number(e.devis.passages) || 0);
  return t.ttc === e.devis.totaux.ttc && t.ht === e.devis.totaux.ht;
}, idS));
T('un devis récurrent garde sa mensualisation après remise', await p.evaluate(() => {
  const lignes = [{ categorie:'Sols', reference:'REF-9', designation:'Lavage', qte:1,
                    unite:'forfait', pu:100, rem:0, tva:20, type:'PONCTUEL' }];
  const sans = totauxDe(lignes, true, 4);
  const avec = totauxDe(lignes.map(l => Object.assign({}, l, { rem:10 })), true, 4);
  // 100 € le passage, 4 passages : 400 € le mois, 360 après 10 %.
  return sans.ht === 400 && avec.ht === 360 && avec.htMensuel === 360 && avec.htPonctuel === 0;
}));

T('aucune erreur JavaScript', err.length === 0, err);
T('aucun bouton attendu ne manquait à l\'écran', rate.length === 0, rate);

console.log('\n=== REMISE SUR UN DEVIS DÉJÀ ÉTABLI (v55) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
