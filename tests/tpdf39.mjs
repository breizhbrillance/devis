/* Le devis imprimé, v39 : plus de colonne de remise par ligne, et la remise
   lue une seule fois en bas. On extrait le texte du PDF avec la visionneuse
   déjà embarquée dans l'application. */
import {chromium} from 'playwright';
import {lancer} from './srvco.mjs';
import { CHROME } from './chemins.mjs';
const PORT = 8293; await lancer(PORT);
const b = await chromium.launch({executablePath:CHROME});
const c = await b.newContext({viewport:{width:390,height:844}});
const p = await c.newPage();
const err = []; p.on('pageerror', e => err.push(String(e)));
const ok = [], ko = [];
const T = (n, v, d) => { (v?ok:ko).push(n + (v?'':'  → ' + JSON.stringify(d))); };

await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
await p.waitForTimeout(800);
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(1000);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }

/* Le texte d'un devis fabriqué de bout en bout, remise comprise. */
async function texteDu(remise){
  return await p.evaluate(async (rem) => {
    const lignes = [
      {categorie:'Vitrerie', reference:'REF-0001', designation:'Nettoyage de vitres',
       detail:'Hall 20 m²', qte:20, unite:'m²', pu:2.5, rem:rem, tva:20, type:'PONCTUEL'},
      {categorie:'Finitions', reference:'REF-0003', designation:'Contrôle qualité',
       detail:'', qte:1, unite:'forfait', pu:40, rem:rem, tva:20, type:'PONCTUEL'}
    ];
    const net = lignes.reduce((s,l)=>s + Math.round(l.qte*l.pu*(1-l.rem/100)*100)/100, 0);
    const devis = {
      numero:'DEV-2026-SL-0009', date:new Date().toISOString(),
      validite:new Date(Date.now()+30*86400000).toISOString(),
      commercial:'SIMON LG',
      client:{type:'PRO', societe:'MAIRIE DE TEST', contact:'Jean Test',
              adresse:'1 rue', cp:'56250', ville:'Monterblanc', siret:'', tva:'', tel:'', email:''},
      lignes:lignes, objet:'Fin de chantier', delai:'sous 15 jours',
      remise:rem, notes:'', signataire:'', signature:'', signeLe:0,
      totaux:{ht:Math.round(net*100)/100, tva:Math.round(net*20)/100,
              ttc:Math.round(net*120)/100, htPonctuel:Math.round(net*100)/100,
              htMensuel:0, parTaux:{20:Math.round(net*20)/100}}
    };
    const b64 = PDF.base64(devis, CFG.reglages);
    // la visionneuse de l'application sait déjà lire un PDF
    await chargerLecteur();
    const bin = atob(b64.split(',').pop());
    const oct = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
    const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
    let txt = '';
    for(let n=1; n<=doc.numPages; n++){
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      txt += tc.items.map(i=>i.str).join(' ') + '\n';
    }
    return {texte:txt, pages:doc.numPages};
  }, remise);
}

/* ---------- sans remise ---------- */
const sans = await texteDu(0);
T('le PDF sort sans erreur', sans.pages >= 1, sans.pages);
T('la colonne « % Rem » a disparu de l\'en-tête',
  !/%\s*Rem/.test(sans.texte), sans.texte.slice(0, 400));
T('les autres colonnes sont toujours là',
  /Désignation/.test(sans.texte) && /Quantité/.test(sans.texte) &&
  /PU Vente/.test(sans.texte) && /TVA/.test(sans.texte) && /Montant HT/.test(sans.texte));
T('sans remise, aucun sous-total parasite',
  !/Sous-total HT/.test(sans.texte));
T('le total HT est le plein tarif', /90,00/.test(sans.texte), sans.texte.slice(-500));
T('le détail de la calculette s\'imprime', /Hall 20/.test(sans.texte));

/* ---------- avec remise ---------- */
const avec = await texteDu(7);
T('avec remise, le sous-total brut apparaît', /Sous-total HT/.test(avec.texte));
T('le brut est bien le plein tarif', /90,00/.test(avec.texte), avec.texte.slice(-600));
T('la remise est nommée avec son taux', /Remise\s*\(\s*7,00\s*%\s*\)/.test(avec.texte),
  avec.texte.slice(-600));
T('la remise est chiffrée et retranchée', /-\s*6,30/.test(avec.texte), avec.texte.slice(-600));
T('le total HT est le montant remisé', /83,70/.test(avec.texte), avec.texte.slice(-600));
T('la TVA porte sur le montant remisé', /16,74/.test(avec.texte), avec.texte.slice(-600));
T('le total TTC est juste', /100,44/.test(avec.texte), avec.texte.slice(-600));
T('la remise n\'est écrite qu\'une fois',
  (avec.texte.match(/Remise/g) || []).length === 1, avec.texte.match(/Remise/g));
T('les montants de ligne restent bruts', /50,00/.test(avec.texte) && /40,00/.test(avec.texte),
  avec.texte.slice(0, 900));
T('le devis tient toujours sur une page', avec.pages === 1, avec.pages);

/* ---------- un devis d'avant la v39, sans le champ remise ---------- */
const vieux = await p.evaluate(async () => {
  const lignes = [
    {categorie:'Vitrerie', reference:'REF-0001', designation:'Nettoyage de vitres',
     detail:'', qte:20, unite:'m²', pu:2.5, rem:5, tva:20, type:'PONCTUEL'}
  ];
  const net = 47.5;
  const devis = {
    numero:'DEV-2025-SL-0001', date:new Date().toISOString(),
    validite:new Date().toISOString(), commercial:'SIMON LG',
    client:{type:'PRO', societe:'ANCIEN', contact:'X', adresse:'1 rue', cp:'56000',
            ville:'VANNES', siret:'', tva:'', tel:'', email:''},
    lignes:lignes, objet:'', delai:'', notes:'', signataire:'', signature:'', signeLe:0,
    // remise absente, comme dans les devis enregistrés avant la v39
    totaux:{ht:net, tva:9.5, ttc:57, htPonctuel:net, htMensuel:0, parTaux:{20:9.5}}
  };
  const b64 = PDF.base64(devis, CFG.reglages);
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map(i=>i.str).join(' ');
});
T('un ancien devis sort encore juste', /47,50/.test(vieux), vieux.slice(-500));
T('sa remise est retrouvée depuis les lignes', /Sous-total HT/.test(vieux), vieux.slice(-500));
T('sans taux affiché, puisque le devis ne le portait pas',
  /Remise/.test(vieux) && !/Remise\s*\(/.test(vieux), vieux.slice(-500));

await b.close();
console.log('\n=== LE DEVIS IMPRIMÉ (v39) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length ? 1 : 0);
