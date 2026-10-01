/* Entretien des locaux ou fin de chantier : le choix, la fréquence, et le
   devis mensualisé qui en découle. */
import {chromium} from 'playwright';
import {lancer, recu} from './srvco.mjs';
import {CHROME} from './chemins.mjs';
import {poserQte} from './presta.mjs';
const PORT = 8299; await lancer(PORT);
const b = await chromium.launch({executablePath:CHROME});
const c = await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
const ok = [], ko = [];
const T = (n, v, d) => { (v?ok:ko).push(n + (v?'':'  → ' + JSON.stringify(d))); };
const vis = (id) => p.evaluate(x => { const e = document.getElementById(x);
  return !!e && !e.classList.contains('hide'); }, id);

await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
await p.waitForTimeout(500);
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }

/* ---------- 1. la question ne se pose qu'au professionnel ---------- */
T('au départ, aucune nature demandée', !(await vis('blocNature')));
await p.click('#chPART'); await p.waitForTimeout(400);
T('un particulier passe directement au client', await p.isVisible('#e2'));
T('et on ne lui demande rien sur la nature', !(await vis('blocNature')));
await p.click('#bPrec'); await p.waitForTimeout(400);

await p.click('#chPRO'); await p.waitForTimeout(400);
T('un professionnel ne passe plus tout seul', await p.isVisible('#e1'));
T('la question de la nature apparaît', await vis('blocNature'));
T('les deux choix sont proposés',
  (await p.innerText('#blocNature')).includes('Entretien des locaux') &&
  (await p.innerText('#blocNature')).includes('fin de chantier'));
T('la fréquence reste cachée tant qu\'on n\'a pas choisi', !(await vis('blocFreq')));

/* ---------- 2. on ne passe pas sans répondre ---------- */
T('sans nature choisie, la barre du bas reste absente', !(await vis('bar')));
await p.evaluate(()=>suivant());   // comme si on forçait le passage
await p.waitForTimeout(400);
T('et on ne quitte pas l\'écran',
  await p.isVisible('#e1') && /entretien|fin de chantier/i.test(await p.innerText('#erreur')),
  await p.innerText('#erreur'));

/* ---------- 3. fin de chantier : rien ne change ---------- */
await p.click('#chCHA'); await p.waitForTimeout(500);
T('une fin de chantier emmène au client', await p.isVisible('#e2'));
T('elle ne demande aucune fréquence', await p.evaluate(()=>PASSAGES) === 0);
await p.click('#bPrec'); await p.waitForTimeout(400);

/* ---------- 4. entretien : on reste, la fréquence s'ouvre ---------- */
await p.click('#chENT'); await p.waitForTimeout(500);
T('un entretien garde le commercial sur l\'écran', await p.isVisible('#e1'));
T('et ouvre le champ de fréquence', await vis('blocFreq'));
T('un « Continuer » apparaît pour valider la fréquence', await vis('bar'));
T('la nature est retenue', await p.evaluate(()=>NATURE) === 'ENTRETIEN');
T('on peut passer sans l\'avoir remplie',
  await (async()=>{ await p.click('#bSuiv'); await p.waitForTimeout(500);
    return await p.isVisible('#e2'); })());

/* ---------- 5. le devis, sans fréquence ---------- */
await p.fill('#cSociete','MAIRIE DE PLOEREN'); await p.fill('#cContact','Mme Le Gall');
await p.fill('#cAdresse','1 place de la Mairie'); await p.fill('#cCp','56880'); await p.fill('#cVille','Ploeren');
await p.click('#bSuiv'); await p.waitForTimeout(600);
await poserQte(p, 0, 120);            // 120 m² à 2,50 € = 300 € le passage
await p.click('#bSuiv'); await p.waitForTimeout(700);
T('l\'écran de validation réclame la fréquence', await vis('cFreq'));
await p.click('#bSuiv'); await p.waitForTimeout(700);
T('et le devis ne s\'enregistre pas sans elle',
  await p.isVisible('#e4') && /passages par mois/i.test(await p.innerText('#erreur')),
  await p.innerText('#erreur'));

/* ---------- 6. la fréquence posée, le devis se mensualise ---------- */
await p.fill('#fPassages4','4'); await p.waitForTimeout(600);
const t = await p.evaluate(()=>totaux());
T('le prix d\'un passage est conservé', t.parPassage === 300, t);
T('le total HT devient le montant du mois', t.ht === 1200, t);
T('la TVA suit', t.tva === 240, t);
T('et le TTC aussi', t.ttc === 1440, t);
T('le montant est porté comme récurrent', t.htMensuel === 1200 && t.htPonctuel === 0, t);
const recap = await p.innerText('#recap');
T('le récapitulatif montre le prix d\'un passage', /Prix d'un passage/.test(recap), recap);
T('il montre le nombre de passages', /Passages par mois/.test(recap), recap);
T('et annonce un total mensuel',
  /Total mensuel HT/.test(recap) && /1\s200,00/.test(recap), recap);
T('la barre du bas précise « par mois »',
  /par mois/.test(await p.innerText('#bTotL')), await p.innerText('#bTotL'));

/* ---------- 7. ce qui part au bureau ---------- */
await p.fill('#fDelai','à partir du 6 octobre');
recu.length = 0;
for(let i = 0; i < 4; i++){
  if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break;
  await p.click('#bSuiv'); await p.waitForTimeout(1300);
}
await p.waitForTimeout(1200);
const envoi = recu.find(x => x && x.devis);
T('le devis part au bureau', !!envoi);
T('il annonce sa nature', envoi && envoi.devis.nature === 'ENTRETIEN', envoi && envoi.devis.nature);
T('et son nombre de passages', envoi && Number(envoi.devis.passages) === 4, envoi && envoi.devis.passages);
T('ses totaux sont mensuels', envoi && envoi.devis.totaux.ht === 1200, envoi && envoi.devis.totaux);

/* ---------- 8. le devis imprimé ---------- */
const texte = await p.evaluate(async (d) => {
  const b64 = PDF.base64(d, CFG.reglages);
  await chargerLecteur();
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map(i=>i.str).join(' ');
}, envoi.devis);
T('le PDF affiche le prix d\'un passage', /Prix d'un passage HT/.test(texte), texte.slice(-600));
T('il affiche la fréquence', /Passages par mois\s*4/.test(texte.replace(/\s+/g,' ')), texte.slice(-600));
T('le total HT y est mensuel', /Total mensuel HT/.test(texte) && /1 200,00/.test(texte), texte.slice(-600));
T('et le TTC annonce le mois', /Total TTC \/ mois/.test(texte) && /1 440,00/.test(texte), texte.slice(-600));

/* ---------- 9. une fin de chantier reste ce qu'elle était ---------- */
await p.evaluate(()=>nouveauDevis()); await p.waitForTimeout(700);
await p.click('#chPRO'); await p.waitForTimeout(300);
await p.click('#chCHA'); await p.waitForTimeout(500);
await p.fill('#cSociete','CAD LINE'); await p.fill('#cContact','X');
await p.fill('#cAdresse','6 rue'); await p.fill('#cCp','56860'); await p.fill('#cVille','Séné');
await p.click('#bSuiv'); await p.waitForTimeout(600);
await poserQte(p, 0, 120);
await p.click('#bSuiv'); await p.waitForTimeout(700);
T('pas de bloc de fréquence sur une fin de chantier', !(await vis('cFreq')));
const t2 = await p.evaluate(()=>totaux());
T('son total n\'est pas multiplié', t2.ht === 300, t2);
T('et il n\'est pas compté comme récurrent', t2.htMensuel === 0, t2);
T('le récapitulatif ne parle pas de passages',
  !/Prix d'un passage/.test(await p.innerText('#recap')));

await b.close();
console.log('\n=== NATURE DU DEVIS (écran) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length ? 1 : 0);
