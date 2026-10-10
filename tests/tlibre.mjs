/* La ligne libre : ce que le catalogue ne porte pas encore, écrit et chiffré
   par le commercial devant le client. Elle ne perce pas le verrouillage des
   tarifs — elle porte une référence réservée, le bureau la voit passer, et
   l'éloignement ne la touche pas. */
import {chromium} from 'playwright';
import {lancer, recu, reglagesSup} from './srvco.mjs';
import {poserQte} from './presta.mjs';
import { CHROME } from './chemins.mjs';

reglagesSup.majoration_km_bareme = '10:0 ; *:0,90';
reglagesSup.majoration_km_arrondi = '0,10';
reglagesSup.majoration_tres_sale = '20';
reglagesSup.remise_max = '10';

const PORT = 8286; await lancer(PORT);
const b = await chromium.launch({executablePath:CHROME});
const c = await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
const ok = [], ko = [];
const T = (n,v,d) => { (v?ok:ko).push(n + (v?'':'  → ' + JSON.stringify(d))); };
/* Un champ qui a disparu est un défaut à signaler, pas une épreuve qui plante :
   sans ça, un mutant casserait la suite au lieu de la faire rougir. */
const ecrire = async (sel, v) => {
  try { await p.fill(sel, v, {timeout:2500}); return true; } catch(e){ return false; }
};
const texte = async (sel) => {
  try { return await p.innerText(sel, {timeout:2500}); } catch(e){ return ''; }
};
const cliquer = async (sel) => {
  try { await p.click(sel, {timeout:2500}); return true; } catch(e){ return false; }
};

await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
await p.waitForTimeout(500);
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }

await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chCHA'); await p.waitForTimeout(300);
await p.fill('#cSociete','MAIRIE DE TEST'); await p.fill('#cContact','Jean Test');
await p.fill('#cAdresse','1 rue du Test'); await p.fill('#cCp','56250'); await p.fill('#cVille','Monterblanc');
await p.click('#bSuiv'); await p.waitForTimeout(500);

/* ---------- 1. le bloc est là, et il n'ajoute rien tout seul ---------- */
T('le bloc « Ligne libre » est présent', await p.isVisible('#grpLibre'));
T('aucune ligne tant qu\'on ne la demande pas', await p.evaluate(()=>LIGNES.length) === 0);
T('le bouton dit à quoi ça sert',
  /catalogue ne porte pas encore/i.test(await texte('#grpLibre')),
  await texte('#grpLibre'));

/* ---------- 2. l'ajouter, l'écrire, la chiffrer ---------- */
T('le bouton d\'ajout répond', await cliquer('#grpLibre .btnLib'));
await p.waitForTimeout(250);
let l = await p.evaluate(()=>LIGNES[0] || {});
T('une ligne libre entre au devis', await p.evaluate(()=>LIGNES.length) === 1);
T('elle porte la référence réservée', l.reference === 'LIBRE-1', l);
T('elle naît vide et à zéro', l.designation === '' && l.pu === 0 && l.qte === 1, l);
T('le champ d\'intitulé a le curseur',
  await p.evaluate(()=>document.activeElement && document.activeElement.classList.contains('libD')));

const ecrits = [
  await ecrire('#lbLIBRE-1 .libD','Débarras de la cave'),
  await ecrire('#lbLIBRE-1 .libQ','3'),
  await ecrire('#lbLIBRE-1 .libU','heure'),
  await ecrire('#lbLIBRE-1 .libP','45')];
T('la ligne se remplit à l\'écran, sous sa référence', ecrits.every(Boolean), ecrits);
await p.waitForTimeout(300);
l = await p.evaluate(()=>LIGNES[0] || {});
T('l\'intitulé est repris', l.designation === 'Débarras de la cave', l);
T('la quantité est reprise', l.qte === 3, l);
T('l\'unité est reprise', l.unite === 'heure', l);
T('le prix est repris', l.pu === 45, l);
T('le total de la ligne s\'affiche',
  /135/.test(await texte('#lbLIBRE-1 .libT')), await texte('#lbLIBRE-1 .libT'));
T('elle compte dans le total du devis',
  await p.evaluate(()=>totaux().ht) === 135, await p.evaluate(()=>totaux().ht));
T('une virgule décimale est acceptée',
  await p.evaluate(()=>{ setLibre('LIBRE-1','pu','45,50'); const v=(LIGNES[0]||{}).pu;
                         setLibre('LIBRE-1','pu','45'); return v; }) === 45.5);
T('un prix négatif est ramené à zéro',
  await p.evaluate(()=>{ setLibre('LIBRE-1','pu','-10'); const v=(LIGNES[0]||{}).pu;
                         setLibre('LIBRE-1','pu','45'); return v; }) === 0);

/* ---------- 3. elle n'est pas « hors catalogue » ---------- */
T('aucun bloc « hors catalogue » ne s\'ouvre',
  !(await p.isVisible('#grpHors')));
T('lignesHorsCatalogue l\'ignore',
  await p.evaluate(()=>lignesHorsCatalogue().length) === 0,
  await p.evaluate(()=>LIGNES.map(x=>x.reference+'/'+x.designation)));

/* ---------- 4. deux lignes libres ne se télescopent pas ---------- */
await cliquer('#grpLibre .btnLib'); await p.waitForTimeout(250);
const ecrits2 = [
  await ecrire('#lbLIBRE-2 .libD','Évacuation en déchèterie'),
  await ecrire('#lbLIBRE-2 .libP','80')];
T('la seconde ligne a sa propre référence à l\'écran', ecrits2.every(Boolean), ecrits2);
await p.waitForTimeout(300);
T('deux lignes libres font deux lignes', await p.evaluate(()=>LIGNES.length) === 2);
T('leurs références diffèrent',
  await p.evaluate(()=>LIGNES.length === 2 && LIGNES[0].reference !== LIGNES[1].reference),
  await p.evaluate(()=>LIGNES.map(x=>x.reference)));
T('écrire dans la seconde ne touche pas la première',
  await p.evaluate(()=>(LIGNES[0]||{}).designation) === 'Débarras de la cave');
T('le compteur du bloc les compte', (await texte('#grpLibre .cpt')).trim() === '2',
  await texte('#grpLibre .cpt'));

/* ---------- 5. une prestation du catalogue cohabite ---------- */
await poserQte(p, 0, 100);
T('la prestation du catalogue entre aussi', await p.evaluate(()=>LIGNES.length) === 3);
T('elle garde le prix du catalogue',
  await p.evaluate(()=>(LIGNES.find(x=>x.reference==='REF-0001')||{}).pu) === 2.5);
T('les lignes libres passent après le catalogue',
  await p.evaluate(()=>{ ordonnerLignes();
    return LIGNES.map(x=>x.reference).join('|'); }) === 'REF-0001|LIBRE-1|LIBRE-2',
  await p.evaluate(()=>LIGNES.map(x=>x.reference).join('|')));

/* ---------- 6. la remise et la TVA du devis s'y posent ---------- */
await p.evaluate(()=>{ setRemiseGlobale('7'); });
await p.waitForTimeout(300);
T('la remise du devis descend sur la ligne libre',
  await p.evaluate(()=>(LIGNES.find(x=>x.reference==='LIBRE-1')||{}).rem) === 7);
T('une remise au-dessus du plafond y est plafonnée aussi',
  await p.evaluate(()=>{ setRemiseGlobale('90');
    return (LIGNES.find(x=>x.reference==='LIBRE-1')||{}).rem; }) === 10);
await p.evaluate(()=>{ setRemiseGlobale('0'); });

/* ---------- 7. l'éloignement ne la gonfle pas ---------- */
await p.evaluate(()=>{ NATURE='ENTRETIEN'; PASSAGES=1; KM='30'; KM_AUTO=false; });
const km = await p.evaluate(()=>{
  const ls = lignesDevis();
  return {taux:tauxSupKm(), sup:supplementKm(),
          cat:(ls.find(x=>x.reference==='REF-0001')||{}).pu,
          libre:(ls.find(x=>x.reference==='LIBRE-1')||{}).pu};
});
T('l\'éloignement relève bien le prix du catalogue', km.taux > 0 && km.cat > 2.5, km);
T('mais il laisse le prix de la ligne libre intact', km.libre === 45, km);
/* Le supplément est une somme à récupérer : il se répartit sur les seules
   lignes qu'il peut relever. S'il se diluait aussi dans la ligne libre, le
   déplacement ne serait plus payé — et le classeur, qui compte autrement,
   signalerait un écart de prix sur chaque devis. */
T('et il se répartit sur le seul catalogue, sans se diluer dans la ligne libre',
  Math.abs(km.taux - km.sup / 250) < 1e-9, km);
await p.evaluate(()=>{ KM=''; KM_AUTO=true; NATURE='CHANTIER'; PASSAGES=0; });

/* ---------- 8. la majoration d'état des lieux ne la majore pas ---------- */
const maj = await p.evaluate(()=>{
  const e = ETAT; ETAT = 'TRES_SALE';
  const m = ligneMajoration();
  ETAT = e;
  return m ? m.pu : 0;
});
T('la majoration ne porte que sur le catalogue', maj === 50, maj);   // 20 % de 250 €

/* ---------- 9. une ligne libre bâclée bloque la suite ---------- */
await cliquer('#grpLibre .btnLib'); await p.waitForTimeout(250);
await p.click('#bSuiv'); await p.waitForTimeout(400);
T('une ligne libre sans intitulé retient le commercial sur l\'écran',
  await p.isVisible('#e3'));
T('et le lui dit', /intitulé/i.test(await p.innerText('body')));
await p.evaluate(()=>{ retirerLibre('LIBRE-3'); });
await p.waitForTimeout(250);
T('retirée, elle disparaît du devis',
  await p.evaluate(()=>LIGNES.some(x=>x.reference==='LIBRE-3')) === false);
T('et de l\'écran', !(await p.isVisible('#lbLIBRE-3')));

/* ---------- 10. le brouillon la rend telle quelle ---------- */
const avant = await p.evaluate(()=>JSON.stringify(LIGNES));
await p.reload({waitUntil:'networkidle'}); await p.waitForTimeout(1200);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }
if(await p.isVisible('#dlgConf')){ await p.click('#confOui'); await p.waitForTimeout(900); }
await p.waitForTimeout(400);
T('les lignes libres reviennent du brouillon',
  await p.evaluate(()=>JSON.stringify(LIGNES)) === avant,
  await p.evaluate(()=>LIGNES.map(x=>x.reference+':'+x.designation)));
T('et le compteur repart au-dessus, sans réutiliser une référence prise',
  await p.evaluate(()=>{ const l = ajouterLigneLibre(); const r = l.reference;
    LIGNES.splice(LIGNES.indexOf(l),1); return r; }) === 'LIBRE-3');

/* ---------- 11. sur le devis imprimé ---------- */
const pdf = await p.evaluate(async () => {
  const devis = {
    numero:'DEV-2026-SL-0042', date:new Date().toISOString(),
    validite:new Date(Date.now()+30*86400000).toISOString(), commercial:'SIMON LG',
    client:{type:'PRO', societe:'MAIRIE DE TEST', contact:'Jean Test',
            adresse:'1 rue', cp:'56250', ville:'Monterblanc', siret:'', tva:'', tel:'', email:''},
    lignes:[
      {categorie:'Vitrerie', reference:'REF-0001', designation:'Nettoyage de vitres',
       detail:'', qte:20, unite:'m²', pu:2.5, rem:0, tva:20, type:'PONCTUEL'},
      {categorie:'Prestations complémentaires', reference:'LIBRE-1',
       designation:'Débarras de la cave', detail:'', qte:3, unite:'heure',
       pu:45, rem:0, tva:20, type:'PONCTUEL'}],
    objet:'Fin de chantier', delai:'', remise:0, notes:'', signataire:'',
    signature:'', signeLe:0,
    totaux:{ht:185, tva:37, ttc:222, htPonctuel:185, htMensuel:0, parTaux:{20:37}}
  };
  const b64 = PDF.base64(devis, CFG.reglages);
  await chargerLecteur();
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  let txt = '';
  for(let n=1; n<=doc.numPages; n++){
    txt += (await (await doc.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ') + '\n';
  }
  return txt;
});
T('la ligne libre s\'imprime sur le devis', /Débarras de la cave/.test(pdf), pdf.slice(0,300));
T('avec sa quantité, son unité et son prix',
  /heure/.test(pdf) && /45,0000/.test(pdf) && /135,00/.test(pdf), pdf.slice(0,600));
/* La référence LIBRE-1 est une étiquette pour le bureau, pas pour le client :
   elle n'a rien à faire sur un document commercial. */
T('mais son étiquette interne ne part pas chez le client', !/LIBRE-1/.test(pdf), pdf.slice(0,600));
T('la référence du catalogue, elle, s\'imprime toujours', /REF-0001/.test(pdf), pdf.slice(0,600));

await b.close();
console.log('\n=== LA LIGNE LIBRE : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length ? 1 : 0);
