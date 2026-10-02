/* L'état du site (v48).

   Le commercial ne peut pas retoucher un prix : la grille est verrouillée. Mais
   un site très sale prend plus de temps que le même site propre. Il le dit donc
   sur l'écran de validation — normal, sale, très sale — et le devis porte une
   ligne à part, « Majoration pour état des lieux », calculée sur le reste.

   Ce que ces contrôles gardent : la majoration n'entre jamais dans LIGNES (qui
   ne contient que du catalogue), elle ne se compte jamais deux fois, elle passe
   sous la remise comme le reste, et elle n'existe pas sur un entretien. */
import {chromium} from 'playwright';
import {lancer, recu, reglagesSup} from './srvco.mjs';
import {CHROME} from './chemins.mjs';
import {poserQte} from './presta.mjs';

const DEMAIN = (() => { const d = new Date(); d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); })();

const ok = [], ko = [];
const T = (n, v, d) => { (v?ok:ko).push(n + (v?'':'  → ' + JSON.stringify(d))); };

const PORT = 8348; await lancer(PORT);
const b = await chromium.launch({executablePath:CHROME});
const ouvrir = async () => {
  const c = await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:'fr-FR'});
  const p = await c.newPage();
  p.on('pageerror', e => err.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
  await p.waitForTimeout(500);
  await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
  await p.click('#bCo'); await p.waitForTimeout(900);
  if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }
  return p;
};
const err = [];

/* Un devis pro de fin de chantier, 100 m² de vitres à 2,50 € : 250 € HT. */
async function jusquaValidation(p, nature = '#chCHA'){
  await p.evaluate(()=>nouveauDevis()); await p.waitForTimeout(400);
  await p.click('#chPRO'); await p.waitForTimeout(250);
  await p.click(nature); await p.waitForTimeout(400);
  if(nature === '#chENT'){ await p.fill('#fPassages','4'); await p.waitForTimeout(200);
                           await p.click('#bSuiv'); await p.waitForTimeout(400); }
  await p.fill('#cSociete','MAIRIE DE TEST'); await p.fill('#cContact','Jean Test');
  await p.fill('#cAdresse','1 rue'); await p.fill('#cCp','56250'); await p.fill('#cVille','Monterblanc');
  await p.click('#bSuiv'); await p.waitForTimeout(600);
  await poserQte(p, 0, 100);
  await p.click('#bSuiv'); await p.waitForTimeout(700);
}
const tot = (p) => p.evaluate(()=>totaux());
const recap = (p) => p.innerText('#recap');

/* ---------- 1. un classeur sans majoration : rien ne change ---------- */
let p = await ouvrir();
await jusquaValidation(p);
T('sans réglage de majoration, le bloc « État du site » n\'apparaît pas',
  !(await p.isVisible('#cEtat')));
T('et le total est celui des prestations', (await tot(p)).ht === 250, await tot(p));
await p.evaluate(()=>setEtat('TRES_SALE')); await p.waitForTimeout(200);
T('même forcé, un état sans taux ne majore rien', (await tot(p)).ht === 250, await tot(p));
await p.context().close();

/* ---------- 2. le classeur fixe 15 % et 30 % ---------- */
reglagesSup.majoration_sale = '15'; reglagesSup.majoration_tres_sale = '30';
p = await ouvrir();
await jusquaValidation(p);
T('le bloc « État du site » est là', await p.isVisible('#cEtat'));
T('« Normal » est choisi au départ',
  await p.evaluate(()=>document.getElementById('etN').classList.contains('on') && ETAT === 'NORMAL'));
T('les deux taux du classeur sont affichés',
  /\+15 %/.test(await p.innerText('#etS')) && /\+30 %/.test(await p.innerText('#etT')),
  [await p.innerText('#etS'), await p.innerText('#etT')]);
T('au départ, le total est celui des prestations', (await tot(p)).ht === 250, await tot(p));

await p.click('#etS'); await p.waitForTimeout(300);
let t = await tot(p);
T('« Sale » ajoute 15 % : 250 + 37,50 = 287,50 € HT', t.ht === 287.5, t);
T('la TVA suit', t.tva === 57.5 && t.ttc === 345, t);
T('le récapitulatif montre la majoration sur sa ligne', /État des lieux\s*37,50/.test(await recap(p)), await recap(p));
T('et le poste des prestations n\'a pas bougé', /Vitrerie\s*250,00/.test(await recap(p)), await recap(p));
T('la barre du bas suit', /287,50/.test(await p.innerText('#bTot')), await p.innerText('#bTot'));
T('le bouton « Sale » est allumé, les autres éteints',
  await p.evaluate(()=>etS.classList.contains('on') && !etN.classList.contains('on') && !etT.classList.contains('on')));
T('la majoration n\'est PAS rangée dans les prestations',
  await p.evaluate(()=>LIGNES.length === 1 && !LIGNES.some(l=>l.reference === 'MAJ-ETAT')),
  await p.evaluate(()=>LIGNES.map(l=>l.reference)));

await p.click('#etT'); await p.waitForTimeout(300);
T('« Très sale » ajoute 30 % : 325 € HT, et non 30 % par-dessus les 15',
  (await tot(p)).ht === 325, await tot(p));
await p.click('#etN'); await p.waitForTimeout(300);
T('« Normal » retire la majoration', (await tot(p)).ht === 250 && !/État des lieux/.test(await recap(p)),
  [await tot(p), await recap(p)]);

/* ---------- 3. la remise porte sur le devis entier, majoration comprise ---------- */
await p.click('#etS'); await p.waitForTimeout(200);
await p.fill('#remG','10'); await p.waitForTimeout(400);
t = await tot(p);
T('10 % de remise sur 287,50 € : 258,75 € HT', t.ht === 258.75, t);
T('la remise affichée est de 28,75 €', t.remise === 28.75, t);

/* ---------- 4. revenir aux prestations ne double rien ---------- */
await p.click('#bPrec'); await p.waitForTimeout(400);
T('de retour sur les prestations, aucun bloc « hors catalogue »',
  !(await p.evaluate(()=>!!document.getElementById('grpHors'))));
await poserQte(p, 0, 200);                       // 200 m² : 500 € de prestations
await p.click('#bSuiv'); await p.waitForTimeout(700);
t = await tot(p);
T('la majoration se recalcule sur les nouvelles quantités : (500 + 75) × 0,9 = 517,50 €',
  t.ht === 517.5, t);
T('l\'état choisi est resté « Sale »', await p.evaluate(()=>ETAT === 'SALE' && etS.classList.contains('on')));

/* ---------- 5. le brouillon garde l'état, pas la ligne ---------- */
const br = await p.evaluate(()=>{ sauverBrouillon(); return lsj('brouillon'); });
T('le brouillon note l\'état du site', br.etat === 'SALE', br.etat);
T('et ne contient que les prestations', br.lignes.length === 1 && br.lignes[0].reference !== 'MAJ-ETAT',
  br.lignes.map(l=>l.reference));
/* Un brouillon abîmé, où la majoration se serait glissée dans les lignes. */
await p.evaluate((b0)=>{ const b = JSON.parse(JSON.stringify(b0));
  b.lignes.push({categorie:'État des lieux', designation:'Majoration', qte:1, unite:'forfait',
                 pu:75, rem:10, tva:20, type:'PONCTUEL', reference:'MAJ-ETAT'});
  nouveauDevis(); restaurer(b); etape(4); }, br);
await p.waitForTimeout(500);
t = await tot(p);
T('repris, le brouillon retrouve l\'état « Sale »', await p.evaluate(()=>ETAT === 'SALE'));
T('et la majoration n\'est comptée qu\'une fois', t.ht === 517.5, t);
T('les prestations ne contiennent toujours que du catalogue',
  await p.evaluate(()=>LIGNES.length === 1), await p.evaluate(()=>LIGNES.map(l=>l.reference)));

/* ---------- 6. ce qui part au bureau ---------- */
await p.fill('#fDate', DEMAIN);
recu.length = 0;
for(let i = 0; i < 4; i++){
  if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break;
  await p.click('#bSuiv'); await p.waitForTimeout(1300);
}
await p.waitForTimeout(1200);
const envoi = recu.find(x => x && x.devis);
T('le devis part au bureau', !!envoi);
const lg = envoi ? envoi.devis.lignes : [];
T('avec deux lignes : la prestation, puis la majoration', lg.length === 2 && lg[1].reference === 'MAJ-ETAT',
  lg.map(l=>l.reference));
T('la majoration vaut 15 % des prestations : 75 €', lg[1] && lg[1].pu === 75 && lg[1].qte === 1, lg[1]);
T('elle dit son taux en toutes lettres', lg[1] && /Majoration pour état des lieux \(\+15 %\)/.test(lg[1].designation), lg[1]);
T('elle porte la remise du devis', lg[1] && lg[1].rem === 10, lg[1]);
T('et le taux de TVA du devis', lg[1] && lg[1].tva === 20, lg[1]);
T('le prix de la prestation, lui, est resté celui du catalogue', lg[0] && lg[0].pu === 2.5, lg[0]);
T('l\'état du site est transmis', envoi && envoi.devis.etatSite === 'SALE', envoi && envoi.devis.etatSite);
T('le total envoyé est celui de l\'écran', envoi && envoi.devis.totaux.ht === 517.5, envoi && envoi.devis.totaux);

/* ---------- 7. le devis imprimé ---------- */
const texte = await p.evaluate(async (devis) => {
  const b64 = PDF.base64(devis, CFG.reglages);
  await chargerLecteur();
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  let txt = '';
  for(let n=1; n<=doc.numPages; n++){
    const tc = await (await doc.getPage(n)).getTextContent();
    txt += tc.items.map(i=>i.str).join(' ') + '\n';
  }
  return txt.replace(/\s+/g, ' ');
}, envoi.devis);
T('le devis imprimé porte la ligne de majoration', /Majoration pour état des lieux \(\+15 %\)/.test(texte), texte.slice(0, 900));
T('sous son propre poste', /ÉTAT DES LIEUX/.test(texte), texte.slice(0, 900));
T('avec son montant', /75,00/.test(texte), texte.slice(0, 900));
T('et le total remisé', /517,50/.test(texte), texte.slice(0, 1200));

/* ---------- 8. un nouveau devis repart de « Normal » ---------- */
await jusquaValidation(p);
T('le devis suivant repart de « Normal »', await p.evaluate(()=>ETAT === 'NORMAL') && (await tot(p)).ht === 250,
  await tot(p));

/* ---------- 9. un entretien n'a pas de majoration ---------- */
await jusquaValidation(p, '#chENT');
T('sur un entretien, le bloc n\'apparaît pas', !(await p.isVisible('#cEtat')));
const avant = (await tot(p)).ht;
await p.evaluate(()=>setEtat('TRES_SALE')); await p.waitForTimeout(200);
T('et même forcé, l\'état ne majore pas un contrat', (await tot(p)).ht === avant, [avant, await tot(p)]);
T('aucune ligne de majoration ne partirait',
  await p.evaluate(()=>!lignesDevis().some(l=>l.reference === 'MAJ-ETAT')));

/* ---------- 10. reprendre un ancien devis majoré ---------- */
await p.evaluate(async ()=>{
  await DB.put({id:'ANCIEN', numero:'DEV-2026-SL-0001', devis:{
    numero:'DEV-2026-SL-0001', etatSite:'TRES_SALE', objet:'', delai:'', notes:'',
    client:{type:'PRO', societe:'SYNDIC', contact:'M. X', adresse:'2 rue', cp:'56000', ville:'Vannes'},
    lignes:[{categorie:'Vitrerie', reference:'REF-0001', designation:'Nettoyage de vitres', qte:40,
             unite:'m²', pu:2.5, rem:0, tva:20, type:'PONCTUEL'},
            {categorie:'État des lieux', reference:'MAJ-ETAT', designation:'Majoration pour état des lieux (+25 %)',
             qte:1, unite:'forfait', pu:25, rem:0, tva:20, type:'PONCTUEL'}]}});
  dupliquer('ANCIEN');
});
await p.waitForTimeout(900);
T('repris, l\'ancien devis ne ramène que ses prestations',
  await p.evaluate(()=>LIGNES.length === 1 && LIGNES[0].reference === 'REF-0001'),
  await p.evaluate(()=>LIGNES.map(l=>l.reference)));
T('il garde l\'état noté à l\'époque', await p.evaluate(()=>ETAT === 'TRES_SALE'));
T('et sa majoration est recalculée au taux d\'aujourd\'hui : 100 + 30 = 130 €',
  await p.evaluate(()=>{ NATURE = 'CHANTIER'; return totaux().ht; }) === 130,
  await p.evaluate(()=>totaux()));
await p.context().close();

/* ---------- 11. un seul taux au classeur ---------- */
reglagesSup.majoration_tres_sale = '0';
p = await ouvrir();
await jusquaValidation(p);
T('un taux à zéro retire son bouton', (await p.isVisible('#etS')) && !(await p.isVisible('#etT')));
await p.evaluate(()=>{ ETAT = 'TRES_SALE'; ecranEtat(); calculer(); }); await p.waitForTimeout(200);
T('et un état qui n\'a plus de taux retombe sur « Normal »',
  await p.evaluate(()=>ETAT === 'NORMAL') && (await tot(p)).ht === 250, await tot(p));

await b.close();
console.log('\n=== ÉTAT DU SITE : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length || err.length ? 1 : 0);
