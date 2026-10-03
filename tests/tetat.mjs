/* L'état du site (v48, simplifié en v49).

   Le commercial ne peut pas retoucher un prix : la grille est verrouillée. Mais
   un site très sale prend plus de temps que le même site propre. Il coche donc
   « Site très sale » sur l'écran de validation, et le devis porte une ligne à
   part, « Majoration pour état des lieux », calculée sur le reste.

   Décision de Simon, v49 : UNE seule option. Plus de « normal » ni de « sale » ;
   rien n'est majoré tant que la coche n'est pas mise, et elle vaut 30 %.

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

/* ---------- 2. le classeur fixe 30 % ----------
   On laisse exprès l'ancien réglage du palier « sale » : il doit être ignoré. */
reglagesSup.majoration_sale = '15'; reglagesSup.majoration_tres_sale = '30';
p = await ouvrir();
T('à l\'ouverture de l\'appli, rien n\'est coché', await p.evaluate(()=>ETAT === 'NORMAL'), await p.evaluate(()=>ETAT));
await jusquaValidation(p);
T('le bloc « État du site » est là', await p.isVisible('#cEtat'));
T('il ne propose qu\'une seule option', await p.evaluate(()=>document.querySelectorAll('#cEtat button').length) === 1,
  await p.evaluate(()=>[...document.querySelectorAll('#cEtat button')].map(b=>b.id)));
T('les boutons « Normal » et « Sale » n\'existent plus',
  await p.evaluate(()=>!document.getElementById('etN') && !document.getElementById('etS')));
T('elle s\'appelle « Site très sale » et affiche le taux du classeur',
  /Site très sale/.test(await p.innerText('#etT')) && /\+30 %/.test(await p.innerText('#etT')), await p.innerText('#etT'));
T('elle n\'est pas cochée au départ',
  await p.evaluate(()=>!etT.classList.contains('on') && etT.getAttribute('aria-pressed') === 'false' && ETAT === 'NORMAL'));
T('non cochée, le total est celui des prestations : rien n\'est majoré', (await tot(p)).ht === 250, await tot(p));
T('et aucune ligne de majoration n\'existe',
  await p.evaluate(()=>!lignesDevis().some(l=>l.reference === 'MAJ-ETAT')) && !/État des lieux/.test(await recap(p)));

await p.click('#etT'); await p.waitForTimeout(300);
let t = await tot(p);
T('cochée, elle ajoute 30 % : 250 + 75 = 325 € HT', t.ht === 325, t);
T('la TVA suit', t.tva === 65 && t.ttc === 390, t);
T('le récapitulatif montre la majoration sur sa ligne', /État des lieux\s*75,00/.test(await recap(p)), await recap(p));
T('et le poste des prestations n\'a pas bougé', /Vitrerie\s*250,00/.test(await recap(p)), await recap(p));
T('la barre du bas suit', /325,00/.test(await p.innerText('#bTot')), await p.innerText('#bTot'));
T('le bouton est allumé',
  await p.evaluate(()=>etT.classList.contains('on') && etT.getAttribute('aria-pressed') === 'true' && ETAT === 'TRES_SALE'));
T('la majoration n\'est PAS rangée dans les prestations',
  await p.evaluate(()=>LIGNES.length === 1 && !LIGNES.some(l=>l.reference === 'MAJ-ETAT')),
  await p.evaluate(()=>LIGNES.map(l=>l.reference)));

await p.click('#etT'); await p.waitForTimeout(300);
T('un second appui la retire', (await tot(p)).ht === 250 && !/État des lieux/.test(await recap(p)) &&
  await p.evaluate(()=>!etT.classList.contains('on') && ETAT === 'NORMAL'), [await tot(p), await recap(p)]);
T('le calcul lui-même ignore un état « sale » : il n\'a plus de taux',
  await p.evaluate(()=>{ ETAT = 'SALE'; const h = totaux().ht; ETAT = 'NORMAL'; return h; }) === 250);
await p.evaluate(()=>setEtat('SALE')); await p.waitForTimeout(200);
T('l\'ancien palier « sale » n\'existe plus : il ne majore rien, même avec son réglage au classeur',
  (await tot(p)).ht === 250 && await p.evaluate(()=>ETAT === 'NORMAL'), await tot(p));

/* ---------- 3. la remise porte sur le devis entier, majoration comprise ---------- */
await p.click('#etT'); await p.waitForTimeout(200);
await p.fill('#remG','10'); await p.waitForTimeout(400);
t = await tot(p);
T('10 % de remise sur 325 € : 292,50 € HT', t.ht === 292.5, t);
T('la remise affichée est de 32,50 €', t.remise === 32.5, t);

/* ---------- 4. revenir aux prestations ne double rien ---------- */
await p.click('#bPrec'); await p.waitForTimeout(400);
T('de retour sur les prestations, aucun bloc « hors catalogue »',
  !(await p.evaluate(()=>!!document.getElementById('grpHors'))));
await poserQte(p, 0, 200);                       // 200 m² : 500 € de prestations
await p.click('#bSuiv'); await p.waitForTimeout(700);
t = await tot(p);
T('la majoration se recalcule sur les nouvelles quantités : (500 + 150) × 0,9 = 585 €',
  t.ht === 585, t);
T('la coche est restée mise', await p.evaluate(()=>ETAT === 'TRES_SALE' && etT.classList.contains('on')));

/* ---------- 5. le brouillon garde l'état, pas la ligne ---------- */
const br = await p.evaluate(()=>{ sauverBrouillon(); return lsj('brouillon'); });
T('le brouillon note l\'état du site', br.etat === 'TRES_SALE', br.etat);
T('et ne contient que les prestations', br.lignes.length === 1 && br.lignes[0].reference !== 'MAJ-ETAT',
  br.lignes.map(l=>l.reference));
/* Un brouillon abîmé, où la majoration se serait glissée dans les lignes. */
await p.evaluate((b0)=>{ const b = JSON.parse(JSON.stringify(b0));
  b.lignes.push({categorie:'État des lieux', designation:'Majoration', qte:1, unite:'forfait',
                 pu:150, rem:10, tva:20, type:'PONCTUEL', reference:'MAJ-ETAT'});
  nouveauDevis(); restaurer(b); etape(4); }, br);
await p.waitForTimeout(500);
t = await tot(p);
T('repris, le brouillon retrouve la coche', await p.evaluate(()=>ETAT === 'TRES_SALE' && etT.classList.contains('on')));
T('et la majoration n\'est comptée qu\'une fois', t.ht === 585, t);
T('les prestations ne contiennent toujours que du catalogue',
  await p.evaluate(()=>LIGNES.length === 1), await p.evaluate(()=>LIGNES.map(l=>l.reference)));
/* Un brouillon de la v48, resté sur le palier « sale » qui n'existe plus. */
await p.evaluate((b0)=>{ const b = JSON.parse(JSON.stringify(b0)); b.etat = 'SALE';
  nouveauDevis(); restaurer(b); etape(4); }, br);
await p.waitForTimeout(500);
T('un brouillon resté sur « sale » revient sans majoration : 500 × 0,9 = 450 €',
  (await tot(p)).ht === 450 && await p.evaluate(()=>ETAT === 'NORMAL' && !etT.classList.contains('on')), await tot(p));
await p.click('#etT'); await p.waitForTimeout(300);

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
T('la majoration vaut 30 % des prestations : 150 €', lg[1] && lg[1].pu === 150 && lg[1].qte === 1, lg[1]);
T('elle dit son taux en toutes lettres', lg[1] && /Majoration pour état des lieux \(\+30 %\)/.test(lg[1].designation), lg[1]);
T('elle porte la remise du devis', lg[1] && lg[1].rem === 10, lg[1]);
T('et le taux de TVA du devis', lg[1] && lg[1].tva === 20, lg[1]);
T('le prix de la prestation, lui, est resté celui du catalogue', lg[0] && lg[0].pu === 2.5, lg[0]);
T('l\'état du site est transmis', envoi && envoi.devis.etatSite === 'TRES_SALE', envoi && envoi.devis.etatSite);
T('le total envoyé est celui de l\'écran', envoi && envoi.devis.totaux.ht === 585, envoi && envoi.devis.totaux);

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
T('le devis imprimé porte la ligne de majoration', /Majoration pour état des lieux \(\+30 %\)/.test(texte), texte.slice(0, 900));
T('sous son propre poste', /ÉTAT DES LIEUX/.test(texte), texte.slice(0, 900));
T('avec son montant', /150,00/.test(texte), texte.slice(0, 900));
T('et le total remisé', /585,00/.test(texte), texte.slice(0, 1200));

/* Un devis non coché ne porte rien de tout cela. */
await jusquaValidation(p);
T('le devis suivant repart sans coche', await p.evaluate(()=>ETAT === 'NORMAL' && !etT.classList.contains('on')) && (await tot(p)).ht === 250,
  await tot(p));
await p.fill('#fDate', DEMAIN);
recu.length = 0;
for(let i = 0; i < 4; i++){
  if(await p.isVisible('#e5')) break;
  if(!(await p.isVisible('#bSuiv'))) break;
  await p.click('#bSuiv'); await p.waitForTimeout(1300);
}
await p.waitForTimeout(1200);
const sans = recu.find(x => x && x.devis);
T('sans la coche, le devis part avec sa seule prestation', !!sans && sans.devis.lignes.length === 1 &&
  sans.devis.lignes[0].reference !== 'MAJ-ETAT', sans && sans.devis.lignes.map(l=>l.reference));
T('au prix du catalogue, sans un euro de plus', !!sans && sans.devis.totaux.ht === 250 && sans.devis.etatSite === 'NORMAL',
  sans && [sans.devis.totaux.ht, sans.devis.etatSite]);

/* ---------- 9. un entretien n'a pas de majoration ---------- */
await jusquaValidation(p, '#chENT');
T('sur un entretien, le bloc n\'apparaît pas', !(await p.isVisible('#cEtat')));
const avant = (await tot(p)).ht;
await p.evaluate(()=>setEtat('TRES_SALE')); await p.waitForTimeout(200);
T('et même forcé, l\'état ne majore pas un contrat', (await tot(p)).ht === avant, [avant, await tot(p)]);
T('aucune ligne de majoration ne partirait',
  await p.evaluate(()=>!lignesDevis().some(l=>l.reference === 'MAJ-ETAT')));

/* ---------- 10. reprendre un ancien devis majoré ---------- */
const ancien = (etat) => p.evaluate(async (e)=>{
  await DB.put({id:'ANCIEN', numero:'DEV-2026-SL-0001', devis:{
    numero:'DEV-2026-SL-0001', etatSite:e, objet:'', delai:'', notes:'',
    client:{type:'PRO', societe:'SYNDIC', contact:'M. X', adresse:'2 rue', cp:'56000', ville:'Vannes'},
    lignes:[{categorie:'Vitrerie', reference:'REF-0001', designation:'Nettoyage de vitres', qte:40,
             unite:'m²', pu:2.5, rem:0, tva:20, type:'PONCTUEL'},
            {categorie:'État des lieux', reference:'MAJ-ETAT', designation:'Majoration pour état des lieux (+25 %)',
             qte:1, unite:'forfait', pu:25, rem:0, tva:20, type:'PONCTUEL'}]}});
  dupliquer('ANCIEN');
}, etat);
await ancien('TRES_SALE'); await p.waitForTimeout(900);
T('repris, l\'ancien devis ne ramène que ses prestations',
  await p.evaluate(()=>LIGNES.length === 1 && LIGNES[0].reference === 'REF-0001'),
  await p.evaluate(()=>LIGNES.map(l=>l.reference)));
T('il garde la coche notée à l\'époque', await p.evaluate(()=>ETAT === 'TRES_SALE'));
T('et sa majoration est recalculée au taux d\'aujourd\'hui : 100 + 30 = 130 €',
  await p.evaluate(()=>{ NATURE = 'CHANTIER'; return totaux().ht; }) === 130,
  await p.evaluate(()=>totaux()));
await ancien('SALE'); await p.waitForTimeout(900);
T('un ancien devis « sale » est repris sans majoration : 100 €',
  await p.evaluate(()=>{ NATURE = 'CHANTIER'; return ETAT === 'NORMAL' && LIGNES.length === 1 && totaux().ht === 100; }),
  await p.evaluate(()=>[ETAT, totaux().ht]));
await p.context().close();

/* ---------- 11. le taux à zéro au classeur ---------- */
reglagesSup.majoration_tres_sale = '0';
p = await ouvrir();
await jusquaValidation(p);
T('un taux à zéro retire le bloc entier, même si l\'ancien réglage « sale » est resté',
  !(await p.isVisible('#cEtat')));
await p.evaluate(()=>{ ETAT = 'TRES_SALE'; ecranEtat(); calculer(); }); await p.waitForTimeout(200);
T('et une coche qui n\'a plus de taux tombe',
  await p.evaluate(()=>ETAT === 'NORMAL') && (await tot(p)).ht === 250, await tot(p));

await b.close();
console.log('\n=== ÉTAT DU SITE : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length || err.length ? 1 : 0);
