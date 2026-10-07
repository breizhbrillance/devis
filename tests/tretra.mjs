/* Le formulaire de rétractation, et d'où vient le client (v54).

   Jusqu'ici le formulaire accompagnait tout devis de particulier, sans
   condition. Simon voulait le retirer sur les appels entrants. Le texte dit
   autre chose : l'article L221-1 du Code de la consommation définit le contrat
   hors établissement comme celui conclu en présence des deux parties ailleurs
   que dans l'établissement, « y compris à la suite d'une sollicitation du
   consommateur ». Qui a appelé le premier n'y change rien ; ce qui compte,
   c'est OÙ le client signe.

   D'où deux questions séparées sur l'écran de validation :
   — l'origine (prospection ou appel entrant), qui ne sert qu'au suivi et
     n'enlève jamais rien au client ;
   — le lieu de signature, qui commande le formulaire, et qu'on ne pose qu'à un
     particulier puisque lui seul a ce droit.

   Ce que ces essais gardent :
   — un particulier qui signe chez lui a toujours son formulaire, quelle que
     soit l'origine du contact. C'est le point qui protège Simon ;
   — à l'agence, le formulaire et la mention « hors établissement » tombent
     ensemble — l'un sans l'autre serait un document qui se contredit ;
   — un professionnel n'en a jamais, et on ne lui pose pas la question ;
   — les deux choix partent au classeur et s'y rangent dans leurs colonnes ;
   — par défaut, et sur un brouillon d'avant la question, on est du côté qui
     garde le droit au client.
*/
import { chromium } from 'playwright';
import { lancer, recu, reglagesSup } from './srvco.mjs';
import { CHROME } from './chemins.mjs';
import { ajouterUne } from './presta.mjs';

const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();

/* La mention légale vient du classeur : sans elle, le PDF n'a rien à dire sur
   le contrat hors établissement et l'essai ne prouverait rien. */
reglagesSup.mentions_particulier =
  'Contrat conclu hors établissement : le client particulier dispose d\'un délai de rétractation ' +
  'de 14 jours à compter de la signature (art. L221-18 du Code de la consommation).';

const PORT = 8361; await lancer(PORT);
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
const cache = (sel) => p.evaluate((s) => {
  const e = document.querySelector(s);
  return !e || e.classList.contains('hide') || e.getBoundingClientRect().height === 0;
}, sel);
const allume = (sel) => p.evaluate((s) => {
  const e = document.querySelector(s);
  return !!(e && e.classList.contains('on'));
}, sel);
const texte = async (sel) => (await p.evaluate((s) => {
  const e = document.querySelector(s); return e ? e.textContent.trim() : '';
}, sel)) || '';

await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil:'networkidle' });
await p.waitForTimeout(500);
await remplir('#fCommercial', 'Simon LG'); await remplir('#fCode', 'ab1!');
await clic('#bCo'); await p.waitForTimeout(900);
if (await p.isVisible('#eAccord')) { await clic('#bAccord'); await p.waitForTimeout(300); }

/* Mener un devis jusqu'à l'écran de validation. */
async function jusquAValidation(type) {
  await clic(type === 'PART' ? '#chPART' : '#chPRO'); await p.waitForTimeout(300);
  await clic('#chREM'); await p.waitForTimeout(500);
  if (type === 'PART') {
    await remplir('#cContact', 'Marie Dupont');
  } else {
    await remplir('#cSociete', 'MAIRIE DE TEST'); await remplir('#cContact', 'Jean Test');
  }
  await remplir('#cAdresse', '3 rue des Lilas');
  await remplir('#cCp', '56250'); await remplir('#cVille', 'Monterblanc');
  if (type === 'PART') {
    await clic('#ageOui'); await p.waitForTimeout(250);
  }
  await clic('#bSuiv'); await p.waitForTimeout(700);
  await ajouterUne(p, 0);
  await clic('#bSuiv'); await p.waitForTimeout(700);
}

/* Le devis tel qu'il sortirait du devis en cours, lu dans la visionneuse de
   l'application. L'objet est assemblé ici comme l'application l'assemble pour
   l'envoi ; que l'envoi réel porte bien les deux champs est vérifié à part,
   sur ce que le faux bureau reçoit. */
const textePdf = () => p.evaluate(async () => {
  const devis = {
    numero:'DEV-26-10/ ESSA/ SLG-01', date:new Date().toISOString(),
    validite:new Date(Date.now() + 30*86400000).toISOString(), commercial:'SIMON LG',
    client: lireClient(), lignes: lignesDevis(),
    objet: val('fObjet'), delai: val('fDelai'),
    nature: NATURE || 'CHANTIER', passages: estRecurrent() ? PASSAGES : 0,
    origine: ORIGINE, lieuSignature: TYPE === 'PART' ? LIEU : '',
    remise: REMISE.valeur, notes: val('fNotes'),
    signataire:'', signature:'', signeLe:0, totaux: totaux()
  };
  const b64 = PDF.base64(devis, CFG.reglages);
  await chargerLecteur();
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({ data: oct }).promise;
  let t = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    t += (await pg.getTextContent()).items.map(i => i.str).join(' ') + '\n';
  }
  return { texte: t, pages: doc.numPages };
});

/* ---------- 1. un particulier : les deux questions ---------- */
await jusquAValidation('PART');
T('la carte « Ce client » est à l\'écran de validation', !(await cache('#cOrigine')));
T('la prospection est choisie par défaut', await allume('#orPROS'));
T('et l\'appel entrant ne l\'est pas', !(await allume('#orENTR')));
T('la question du lieu est posée à un particulier', !(await cache('#blocLieu')));
T('« chez lui » est choisi par défaut', await allume('#liCLI'));
T('la note annonce le formulaire',
  /formulaire de rétractation/i.test(await texte('#noteLieu')), await texte('#noteLieu'));
T('et les 14 jours', /14 jours/.test(await texte('#noteLieu')), await texte('#noteLieu'));

/* ---------- 2. chez lui, le formulaire sort ---------- */
let pdf = await textePdf();
T('le devis d\'un particulier qui signe chez lui porte le formulaire',
  /FORMULAIRE DE RÉTRACTATION/.test(pdf.texte), pdf.texte.slice(-700));
T('et la mention du contrat hors établissement',
  /hors établissement/i.test(pdf.texte), pdf.texte.slice(-700));

/* ---------- 3. l'appel entrant n'enlève rien ---------- */
/* C'est le cœur de l'affaire : un client qui a appelé garde son droit. */
await clic('#orENTR'); await p.waitForTimeout(350);
T('l\'appel entrant est retenu', await allume('#orENTR'));
T('et le lieu reste « chez lui »', await allume('#liCLI'));
pdf = await textePdf();
T('un appel entrant signé chez le client garde son formulaire',
  /FORMULAIRE DE RÉTRACTATION/.test(pdf.texte), pdf.texte.slice(-700));
T('et sa mention hors établissement',
  /hors établissement/i.test(pdf.texte), pdf.texte.slice(-700));

/* ---------- 4. à l'agence, le formulaire tombe ---------- */
await clic('#liAGE'); await p.waitForTimeout(350);
T('« à l\'agence » est retenu', await allume('#liAGE'));
T('et « chez lui » ne l\'est plus', !(await allume('#liCLI')));
T('la note prévient que le formulaire ne sortira pas',
  /Pas de formulaire/i.test(await texte('#noteLieu')), await texte('#noteLieu'));
T('et met en garde contre l\'usage facile',
  /vraiment/i.test(await texte('#noteLieu')), await texte('#noteLieu'));
const sansF = await textePdf();
T('le devis signé à l\'agence ne porte pas le formulaire',
  !/FORMULAIRE DE RÉTRACTATION/.test(sansF.texte), sansF.texte.slice(-700));
T('ni la mention « hors établissement », qui serait fausse',
  !/hors établissement/i.test(sansF.texte), sansF.texte.slice(-700));
T('le formulaire tenait une page entière : elle disparaît avec lui',
  sansF.pages === pdf.pages - 1, { avec: pdf.pages, sans: sansF.pages });
T('le reste du devis est intact',
  /DEVIS/.test(sansF.texte) && /Total TTC/.test(sansF.texte), sansF.texte.slice(0, 200));

/* ---------- 5. ce qui part au bureau ---------- */
await remplir('#fDate', DEMAIN);
await remplir('#fSignataire', 'Marie Dupont');
await p.evaluate(() => { const cv = document.querySelector('#sig canvas') || document.querySelector('canvas');
  if (!cv) return; const r = cv.getBoundingClientRect();
  const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { clientX:r.left+x, clientY:r.top+y, bubbles:true, pointerId:1 }));
  ev('pointerdown', 10, 20); ev('pointermove', 60, 40); ev('pointerup', 110, 25); });
await p.waitForTimeout(300);
let avant = recu.length;
await clic('#bSuiv'); await p.waitForTimeout(2500);
let env = recu.slice(avant).map(x => x.devis).filter(Boolean).pop();
T('le devis est parti', !!env, recu.slice(avant).map(x => x.action));
T('l\'origine du contact l\'accompagne', env && env.origine === 'ENTRANT', env && env.origine);
T('le lieu de signature aussi', env && env.lieuSignature === 'AGENCE', env && env.lieuSignature);

/* ---------- 6. un professionnel ---------- */
await p.evaluate(() => nouveauDevis()); await p.waitForTimeout(700);
await jusquAValidation('PRO');
T('on demande l\'origine à un professionnel aussi', !(await cache('#cOrigine')));
T('mais pas où il signe : il n\'a pas ce droit', await cache('#blocLieu'));
T('la prospection est de nouveau le choix par défaut', await allume('#orPROS'));
const pro = await textePdf();
T('un devis professionnel ne porte jamais le formulaire',
  !/FORMULAIRE DE RÉTRACTATION/.test(pro.texte), pro.texte.slice(-500));
await remplir('#fDate', DEMAIN);
await remplir('#fSignataire', 'Jean Test');
await p.evaluate(() => { const cv = document.querySelector('#sig canvas') || document.querySelector('canvas');
  if (!cv) return; const r = cv.getBoundingClientRect();
  const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { clientX:r.left+x, clientY:r.top+y, bubbles:true, pointerId:1 }));
  ev('pointerdown', 10, 20); ev('pointermove', 60, 40); ev('pointerup', 110, 25); });
await p.waitForTimeout(300);
avant = recu.length;
await clic('#bSuiv'); await p.waitForTimeout(2500);
env = recu.slice(avant).map(x => x.devis).filter(Boolean).pop();
T('son origine part quand même au classeur', env && env.origine === 'PROSPECTION', env && env.origine);
T('et son lieu de signature reste vide', env && env.lieuSignature === '', env && env.lieuSignature);

/* ---------- 7. ce qu'on choisit quand on ne sait pas ---------- */
T('un lieu inconnu vaut « chez le client »', await p.evaluate(() => {
  const avant = LIEU;
  setLieu('n\'importe quoi');
  const r = LIEU;
  setLieu(avant);
  return r;
}) === 'CLIENT');
T('une origine inconnue vaut « prospection »', await p.evaluate(() => {
  const avant = ORIGINE;
  setOrigine('autre chose');
  const r = ORIGINE;
  setOrigine(avant);
  return r;
}) === 'PROSPECTION');
/* Un brouillon enregistré avant la v54 ne porte ni origine ni lieu. On reprend
   le brouillon courant, on lui retire les deux champs, et on le relit. */
T('un brouillon d\'avant la question garde le formulaire au client', await p.evaluate(() => {
  ORIGINE = 'ENTRANT'; LIEU = 'AGENCE'; TYPE = 'PART';
  // un brouillon d'avant la v54 : ni origine, ni lieu
  restaurer({ lignes: [], client: { type: 'PART' }, remise: { valeur: 0, muet: false } });
  return LIEU === 'CLIENT' && ORIGINE === 'PROSPECTION' && avecRetractation();
}));
T('et un devis envoyé sans lieu du tout le garde aussi', await p.evaluate(async () => {
  const d = { numero:'DEV-26-10/ DUPO/ SLG-09', date:new Date().toISOString(),
    validite:new Date(Date.now()+30*86400000).toISOString(), commercial:'SIMON LG',
    client:{ type:'PART', societe:'', contact:'Marie Dupont', adresse:'3 rue',
             cp:'56250', ville:'Monterblanc', siret:'', tva:'', tel:'', email:'' },
    lignes:[{ categorie:'Vitrerie', reference:'REF-0001', designation:'Nettoyage de vitres',
              detail:'', qte:10, unite:'m²', pu:2.5, rem:0, tva:10, type:'PONCTUEL' }],
    objet:'', delai:'', nature:'REMISE', passages:0, remise:0, notes:'',
    signataire:'', signature:'', signeLe:0,
    totaux:{ ht:25, tva:2.5, ttc:27.5, htPonctuel:25, htMensuel:0, parTaux:{ 10:2.5 }, passages:1 } };
  const b64 = PDF.base64(d, CFG.reglages);      // aucun lieuSignature dans l'objet
  await chargerLecteur();
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({ data: oct }).promise;
  let t = '';
  for (let n = 1; n <= doc.numPages; n++) {
    t += (await (await doc.getPage(n)).getTextContent()).items.map(i => i.str).join(' ');
  }
  return /FORMULAIRE DE RÉTRACTATION/.test(t);
}));

T('aucune erreur JavaScript', err.length === 0, err);
T('aucun bouton attendu ne manquait à l\'écran', rate.length === 0, rate);

console.log('\n=== RÉTRACTATION ET ORIGINE DU CLIENT (v54) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
await b.close();
process.exit(ko.length ? 1 : 0);
