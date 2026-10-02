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

/* ---------- 1. la question se pose aux deux, pas dans les mêmes termes ------ */
T('au départ, aucune nature demandée', !(await vis('blocNature')));

await p.click('#chPART'); await p.waitForTimeout(400);
T('un particulier ne passe plus tout seul au client', await p.isVisible('#e1'));
T('on lui demande la nature', await vis('blocNature'));
T('l\'entretien des locaux ne lui est pas proposé', !(await vis('chENT')));
T('la fin de chantier, si', await vis('chCHA'));
T('la remise en état aussi', await vis('chREM'));
T('et aucune barre du bas tant qu\'il n\'a pas choisi', !(await vis('bar')));

await p.click('#chREM'); await p.waitForTimeout(500);
T('une remise en état chez un particulier emmène au client', await p.isVisible('#e2'));
T('la nature est retenue', await p.evaluate(()=>NATURE) === 'REMISE');
T('elle ne demande aucune fréquence', await p.evaluate(()=>PASSAGES) === 0);
await p.click('#bPrec'); await p.waitForTimeout(400);

await p.click('#chPRO'); await p.waitForTimeout(400);
T('un professionnel ne passe pas tout seul non plus', await p.isVisible('#e1'));
T('la question de la nature reste posée', await vis('blocNature'));
T('les trois choix lui sont proposés',
  (await vis('chENT')) && (await vis('chCHA')) && (await vis('chREM')));
T('ils portent les bons noms',
  (await p.innerText('#blocNature')).includes('Entretien des locaux') &&
  (await p.innerText('#blocNature')).includes('fin de chantier') &&
  (await p.innerText('#blocNature')).includes('Remise en état'));
T('la remise en état choisie chez un particulier vaut encore',
  await p.evaluate(()=>NATURE) === 'REMISE');
T('la fréquence reste cachée tant qu\'on n\'a pas pris l\'entretien', !(await vis('blocFreq')));

/* ---------- 1 bis. passer du professionnel au particulier ---------- */
await p.click('#chENT'); await p.waitForTimeout(400);
T('l\'entretien se choisit chez un professionnel', await p.evaluate(()=>NATURE) === 'ENTRETIEN');
await p.fill('#fPassages','4'); await p.waitForTimeout(300);
await p.click('#chPART'); await p.waitForTimeout(400);
T('repasser au particulier efface l\'entretien', await p.evaluate(()=>NATURE) === null);
T('et la fréquence qui allait avec', await p.evaluate(()=>PASSAGES) === 0);
T('le champ de fréquence disparaît', !(await vis('blocFreq')));
await p.click('#chPRO'); await p.waitForTimeout(400);

/* ---------- 2. on ne passe pas sans répondre ---------- */
T('sans nature choisie, la barre du bas reste absente', !(await vis('bar')));
await p.evaluate(()=>suivant());   // comme si on forçait le passage
await p.waitForTimeout(400);
T('et on ne quitte pas l\'écran',
  await p.isVisible('#e1') && /entretien|fin de chantier|remise en état/i.test(await p.innerText('#erreur')),
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
const lirePdf = (d) => p.evaluate(async (d) => {
  const b64 = PDF.base64(d, CFG.reglages);
  await chargerLecteur();
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map(i=>i.str).join(' ');
}, d);
const texte = await lirePdf(envoi.devis);
T('le PDF affiche le prix d\'un passage', /Prix d'un passage HT/.test(texte), texte.slice(-600));
T('il affiche la fréquence', /Passages par mois\s*4/.test(texte.replace(/\s+/g,' ')), texte.slice(-600));
T('le total HT y est mensuel', /Total mensuel HT/.test(texte) && /1 200,00/.test(texte), texte.slice(-600));
T('et le TTC annonce le mois', /Total TTC \/ mois/.test(texte) && /1 440,00/.test(texte), texte.slice(-600));
T('le devis imprimé annonce son objet',
  /Objet\s*:\s*Entretien des locaux/.test(texte.replace(/\s+/g,' ')), texte.slice(0,400));
T('et la fréquence y figure en toutes lettres',
  /4 passages par mois/.test(texte.replace(/\s+/g,' ')), texte.slice(0,400));

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
const txtCha = await lirePdf({...envoi.devis, nature:'CHANTIER', passages:0,
                              totaux:t2, lignes:envoi.devis.lignes});
T('une fin de chantier imprime son objet',
  /Objet\s*:\s*Nettoyage de fin de chantier/.test(txtCha.replace(/\s+/g,' ')), txtCha.slice(0,400));
T('sans parler de passages', !/passages par mois/.test(txtCha), txtCha.slice(0,400));
const txtVieux = await lirePdf({...envoi.devis, nature:'', passages:0});
T('un devis d\'avant la nature n\'affiche aucun objet',
  !/Objet\s*:/.test(txtVieux.replace(/\s+/g,' ')), txtVieux.slice(0,400));

/* ---------- 10. une remise en état se compte comme une intervention ------- */
await p.evaluate(()=>nouveauDevis()); await p.waitForTimeout(700);
T('un nouveau devis repose la question', !(await vis('blocNature')));
await p.click('#chPRO'); await p.waitForTimeout(300);
await p.click('#chREM'); await p.waitForTimeout(500);
await p.fill('#cSociete','SYNDIC DU PORT'); await p.fill('#cContact','Y');
await p.fill('#cAdresse','2 quai'); await p.fill('#cCp','56000'); await p.fill('#cVille','Vannes');
await p.click('#bSuiv'); await p.waitForTimeout(600);
await poserQte(p, 0, 120);
await p.click('#bSuiv'); await p.waitForTimeout(700);
T('pas de bloc de fréquence sur une remise en état', !(await vis('cFreq')));
const t3 = await p.evaluate(()=>totaux());
T('son total n\'est pas multiplié', t3.ht === 300, t3);
T('et il n\'est pas compté comme récurrent', t3.htMensuel === 0, t3);
await p.fill('#fDelai','semaine 42');
recu.length = 0;
for(let i = 0; i < 4; i++){
  if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break;
  await p.click('#bSuiv'); await p.waitForTimeout(1300);
}
await p.waitForTimeout(1200);
const envoi3 = recu.find(x => x && x.devis);
T('le devis part au bureau', !!envoi3);
T('il annonce une remise en état',
  envoi3 && envoi3.devis.nature === 'REMISE', envoi3 && envoi3.devis.nature);
T('et aucun passage mensuel',
  envoi3 && Number(envoi3.devis.passages) === 0, envoi3 && envoi3.devis.passages);
const txtRem = await lirePdf(envoi3.devis);
T('le devis imprimé annonce une remise en état',
  /Objet\s*:\s*Remise en état/.test(txtRem.replace(/\s+/g,' ')), txtRem.slice(0,400));
T('et ne parle ni de passages ni de mois',
  !/passages par mois/.test(txtRem) && !/Total mensuel/.test(txtRem), txtRem.slice(-500));

await b.close();
console.log('\n=== NATURE DU DEVIS (écran) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length ? 1 : 0);
