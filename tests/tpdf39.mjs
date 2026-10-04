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

/* ---------- l'interlocuteur ne s'imprime pas chez un professionnel ---------- */
const lire = (cl, sign, sig) => p.evaluate(async (o) => {
  const lignes = [{categorie:'Vitrerie', reference:'REF-0001', designation:'Nettoyage de vitres',
    detail:'', qte:10, unite:'m²', pu:2.5, rem:0, tva:20, type:'PONCTUEL'}];
  const devis = {
    numero:'DEV-2026-SL-0010', date:new Date().toISOString(),
    validite:new Date(Date.now()+30*86400000).toISOString(), commercial:'SIMON LG',
    client:o.cl, lignes:lignes, objet:'', delai:'sous 15 jours', remise:0, notes:'',
    signataire:o.sign || '', signature:o.sig || '', signeLe:o.sig ? Date.now() : 0,
    totaux:{ht:25, tva:5, ttc:30, htPonctuel:25, htMensuel:0, parTaux:{20:5}}
  };
  const b64 = PDF.base64(devis, CFG.reglages);
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  let txt = '';
  for(let n=1; n<=doc.numPages; n++){
    const tc = await (await doc.getPage(n)).getTextContent();
    txt += tc.items.map(i=>i.str).join(' ') + '\n';
  }
  return txt;
}, {cl:cl, sign:sign, sig:sig});

const pro = await lire({type:'PRO', societe:'MAIRIE DE PLOEREN', contact:'Mme Le Gall',
  adresse:'1 place de la Mairie', cp:'56880', ville:'Ploeren',
  siret:'21560177700015', tva:'', tel:'0297000000', email:'mairie@ploeren.bzh'});
T('chez un professionnel, la société est imprimée', /MAIRIE DE PLOEREN/.test(pro));
T('mais pas le nom de l\'interlocuteur', !/Le Gall/.test(pro), pro.slice(0, 700));
T('l\'adresse du client reste', /place de la Mairie/.test(pro));
T('son téléphone reste', /0297000000/.test(pro));
T('son SIRET reste', /21560177700015/.test(pro));

/* Chez un particulier, cette personne EST le client : elle doit rester. */
const part = await lire({type:'PART', societe:'', contact:'Madame Hervé',
  adresse:'3 allée des Chênes', cp:'56000', ville:'Vannes',
  siret:'', tva:'', tel:'0600000000', email:''});
T('chez un particulier, le nom du client est bien imprimé',
  /Hervé/.test(part), part.slice(0, 700));
T('et son adresse aussi', /allée des Chênes/.test(part));
T('le bordereau de rétractation le nomme aussi',
  (part.match(/Hervé/g) || []).length >= 2, (part.match(/Hervé/g) || []).length);

/* Le signataire, lui, se nomme : c'est tout l'objet d'une signature.
   Le bloc de signature n'apparaît que si le client a vraiment signé. */
const trait = await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 60;
  const x = c.getContext('2d'); x.lineWidth = 3; x.beginPath();
  x.moveTo(10, 40); x.lineTo(180, 20); x.stroke();
  return c.toDataURL('image/png');
});
const signe = await lire({type:'PRO', societe:'MAIRIE DE PLOEREN', contact:'Mme Le Gall',
  adresse:'1 place de la Mairie', cp:'56880', ville:'Ploeren',
  siret:'', tva:'', tel:'', email:''}, 'Mme Le Gall, maire', trait);
T('le nom du signataire s\'imprime quand il est renseigné',
  /Le Gall, maire/.test(signe), signe.slice(-600));
T('et le devis porte la mention « Bon pour accord »',
  /Bon pour accord/.test(signe), signe.slice(-600));

/* Sans nom de signataire saisi, la ligne de signature reprend l'interlocuteur :
   c'est voulu, un devis signé doit nommer qui a signé. Mais il ne doit
   apparaître QUE là, et jamais dans le bloc client en haut de page. */
const signeSansNom = await lire({type:'PRO', societe:'MAIRIE DE PLOEREN', contact:'Mme Le Gall',
  adresse:'1 place de la Mairie', cp:'56880', ville:'Ploeren',
  siret:'', tva:'', tel:'', email:''}, '', trait);
T('signé sans nom saisi : la ligne de signature nomme l\'interlocuteur',
  /Bon pour accord\s*»\s*—\s*Mme Le Gall/.test(signeSansNom), signeSansNom.slice(-500));
T('et il n\'apparaît qu\'une seule fois, nulle part ailleurs',
  (signeSansNom.match(/Le Gall/g) || []).length === 1,
  (signeSansNom.match(/Le Gall/g) || []).length);
T('le bloc client, lui, ne porte que la société',
  /PLOEREN\s+1 place de la Mairie/.test(signeSansNom.slice(0, 1200)),
  signeSansNom.slice(0, 1200).slice(-300));

/* ---------- v49 : la ligne de titres du tableau est un bandeau bleu ----------
   On dessine la page et on regarde les points : le fond du bandeau doit être
   au bleu de la marque, et les titres écrits en blanc dessus. */
const bandeau = await p.evaluate(async () => {
  const lignes = [];
  for(let i = 0; i < 46; i++) lignes.push({categorie:'Vitrerie', reference:'REF-0001',
    designation:'Nettoyage de vitres ' + (i + 1), detail:'', qte:10, unite:'m²', pu:2.5,
    rem:0, tva:20, type:'PONCTUEL'});
  const devis = {
    numero:'DEV-2026-SL-0011', date:new Date().toISOString(),
    validite:new Date(Date.now()+30*86400000).toISOString(), commercial:'SIMON LG',
    client:{type:'PRO', societe:'MAIRIE DE PLOEREN', contact:'', adresse:'1 place de la Mairie',
            cp:'56880', ville:'Ploeren', siret:'', tva:'', tel:'', email:''},
    lignes:lignes, objet:'', delai:'sous 15 jours', remise:0, notes:'',
    signataire:'', signature:'', signeLe:0,
    totaux:{ht:1150, tva:230, ttc:1380, htPonctuel:1150, htMensuel:0, parTaux:{20:230}}
  };
  const b64 = PDF.base64(devis, CFG.reglages);
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  const E = 3, res = [];
  let image = '';
  for(let n = 1; n <= doc.numPages; n++){
    const page = await doc.getPage(n);
    const vp = page.getViewport({scale:E});
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    const cx = cv.getContext('2d');
    await page.render({canvasContext:cx, viewport:vp}).promise;
    if(n === 1) image = cv.toDataURL('image/png');
    const tc = await page.getTextContent();
    const it = tc.items.find(i => i.str === 'Référence');
    if(!it){ res.push(null); continue; }
    const pt = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const x0 = Math.round(pt[0]), y0 = Math.round(pt[1]);
    // le fond : juste à gauche du mot, à mi-hauteur des lettres
    const f = cx.getImageData(x0 - 4, y0 - 6, 1, 1).data;
    // tout au bout à droite du bandeau, sous « Montant HT »
    const d = cx.getImageData(Math.round(vp.width - 16 * E * 72 / 25.4 / 1), y0 - 6, 1, 1).data;
    // l'encre : le point le plus clair parmi les lettres du mot
    const z = cx.getImageData(x0, y0 - 16, 90, 18).data;
    let clair = 0;
    for(let k = 0; k < z.length; k += 4) clair = Math.max(clair, Math.min(z[k], z[k+1], z[k+2]));
    // juste sous le bandeau, la page redevient claire
    const s = cx.getImageData(x0 - 4, y0 + 22, 1, 1).data;
    res.push({fond:[f[0],f[1],f[2]], droite:[d[0],d[1],d[2]], clair:clair, sous:[s[0],s[1],s[2]]});
  }
  return {pages:doc.numPages, res:res, image:image};
});
const bleu = c => c && Math.abs(c[0] - 0) <= 6 && Math.abs(c[1] - 76) <= 6 && Math.abs(c[2] - 146) <= 6;
T('le devis long tient sur plusieurs pages', bandeau.pages >= 2, bandeau.pages);
T('page 1 : le bandeau des titres est au bleu de la marque',
  bandeau.res[0] && bleu(bandeau.res[0].fond), bandeau.res[0]);
T('page 1 : le bandeau va jusqu\'au bord droit du tableau',
  bandeau.res[0] && bleu(bandeau.res[0].droite), bandeau.res[0]);
T('page 1 : les titres sont écrits en blanc',
  bandeau.res[0] && bandeau.res[0].clair >= 245, bandeau.res[0]);
T('page 1 : sous le bandeau, la page redevient claire',
  bandeau.res[0] && Math.min.apply(null, bandeau.res[0].sous) >= 230, bandeau.res[0]);
T('page 2 : le bandeau repris en haut de page est bleu lui aussi',
  bandeau.res[1] && bleu(bandeau.res[1].fond) && bandeau.res[1].clair >= 245, bandeau.res[1]);
if(process.env.IMAGE_BANDEAU){
  const fs = await import('fs');
  fs.writeFileSync(process.env.IMAGE_BANDEAU, Buffer.from(bandeau.image.split(',').pop(), 'base64'));
}

/* ---------- v51 : un titre de poste rejeté en haut de page reste lisible ----
   Le bandeau de titres repris en haut de chaque page s'écrit en blanc. Si la
   couleur n'était pas remise avant le titre du poste, celui-ci s'écrirait en
   blanc sur blanc : invisible, et le client ne saurait plus ce qu'il lit.

   Le défaut ne se montre que si c'est le TITRE qui provoque le saut de page,
   pas la ligne ni le sous-total d'avant. On balaie donc plusieurs longueurs de
   devis : l'une d'elles tombe forcément sur ce cas. */
const titres = await p.evaluate(async () => {
  const lire = async (n, cale) => {
    const lignes = [];
    for(let i = 0; i < n; i++) lignes.push({categorie:'Vitrerie', reference:'REF-0001',
      designation:'Nettoyage de vitres ' + (i + 1),
      detail:(cale && i === 0) ? 'Hall et cage d\'escalier' : '',
      qte:10, unite:'m²', pu:2.5, rem:0, tva:20, type:'PONCTUEL'});
    lignes.push({categorie:'Finitions', reference:'REF-0003', designation:'Contrôle qualité',
      detail:'', qte:1, unite:'forfait', pu:40, rem:0, tva:20, type:'PONCTUEL'});
    const devis = {
      numero:'DEV-2026-SL-0012', date:new Date().toISOString(),
      validite:new Date(Date.now()+30*86400000).toISOString(), commercial:'SIMON LG',
      client:{type:'PRO', societe:'MAIRIE DE PLOEREN', contact:'', adresse:'1 place de la Mairie',
              cp:'56880', ville:'Ploeren', siret:'', tva:'', tel:'', email:''},
      lignes:lignes, objet:'', delai:'', remise:0, notes:'',
      signataire:'', signature:'', signeLe:0,
      totaux:{ht:25*n+40, tva:(25*n+40)*0.2, ttc:(25*n+40)*1.2,
              htPonctuel:25*n+40, htMensuel:0, parTaux:{20:(25*n+40)*0.2}}
    };
    const b64 = PDF.base64(devis, CFG.reglages);
    const bin = atob(b64.split(',').pop());
    const oct = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
    const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
    const E = 3;
    for(let k = 1; k <= doc.numPages; k++){
      const page = await doc.getPage(k);
      const tc = await page.getTextContent();
      const it = tc.items.find(i => /FINITIONS/.test(i.str));
      if(!it) continue;
      const vp = page.getViewport({scale:E});
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      const cx = cv.getContext('2d');
      await page.render({canvasContext:cx, viewport:vp}).promise;
      const pt = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      /* Au-dessus de la ligne de base seulement : le soulignement du titre est
         tracé en bleu quoi qu'il arrive, et masquerait un texte invisible. */
      const z = cx.getImageData(Math.round(pt[0]), Math.round(pt[1]) - 14, 110, 11).data;
      let sombre = 255, encre = null, encres = 0;
      for(let j = 0; j < z.length; j += 4){
        const m = Math.max(z[j], z[j+1], z[j+2]);
        if(m < 200) encres++;
        if(m < sombre){ sombre = m; encre = [z[j], z[j+1], z[j+2]]; }
      }
      return {n:n, cale:!!cale, page:k, pages:doc.numPages, haut:Math.round(pt[1]),
              sombre:sombre, encre:encre, encres:encres};
    }
    return {n:n, cale:!!cale, page:0};
  };
  const out = [];
  for(let n = 34; n <= 46; n++){ out.push(await lire(n, false)); out.push(await lire(n, true)); }
  return out;
});
const vus = titres.filter(x => x.page >= 2);
T('un titre de poste finit par être rejeté en page suivante', vus.length > 0, titres.map(x => x.page));
/* Celui qui est tout en haut de la page : c'est lui qui suit le bandeau blanc. */
const hauts = vus.filter(x => x.haut < 300);
T('et l\'un d\'eux se retrouve juste sous le bandeau de titres', hauts.length > 0,
  vus.map(x => [x.n, x.cale, x.haut]));
T('aucun titre n\'est écrit en blanc sur blanc',
  vus.every(x => x.sombre < 200), vus.map(x => [x.n, x.cale, x.haut, x.sombre]));
T('chacun porte de l\'encre sur toute sa longueur',
  vus.every(x => x.encres > 80), vus.map(x => [x.n, x.encres]));
T('et tous sont au bleu de la marque',
  vus.every(x => x.encre && Math.abs(x.encre[0]) <= 60 && Math.abs(x.encre[1] - 76) <= 60 &&
                 Math.abs(x.encre[2] - 146) <= 60), vus.map(x => [x.n, x.cale, x.encre]));

/* ---------- v51 : un contrat d'entretien se lit au mois -----------------
   Les lignes d'un entretien sont celles d'UN passage, mais le devis se vend
   au mois. Le total HT et le TTC sont déjà mensuels ; si la TVA et le
   sous-total restaient au passage, le client lirait trois chiffres qui ne
   tombent pas ensemble, et la remise d'un contrat n'apparaîtrait nulle part. */
const mois = async (passages, remise) => p.evaluate(async (o) => {
  const lignes = [
    {categorie:'Entretien des sols', reference:'REF-0016', designation:'Aspiration des sols',
     detail:'', qte:50, unite:'m²', pu:0.15, rem:o.remise, tva:20, type:'MENSUEL'},
    {categorie:'Déplacement', reference:'DEP-KM', designation:'Déplacement sur site',
     detail:'Site à 20 km de l’agence', qte:1, unite:'forfait', pu:10, rem:0,
     tva:20, type:'MENSUEL'}
  ];
  const brutP = 7.5 + 10;
  const netP = Math.round((7.5 * (1 - o.remise / 100) + 10) * 100) / 100;
  const ht = Math.round(netP * o.passages * 100) / 100;
  const devis = {
    numero:'DEV-26-10/ MAEN/ SLG-03', date:new Date().toISOString(),
    validite:new Date(Date.now()+30*86400000).toISOString(), commercial:'SIMON LG',
    nature:'ENTRETIEN', passages:o.passages,
    client:{type:'PRO', societe:'MAIRIE DE PLOEREN', contact:'', adresse:'1 place',
            cp:'56400', ville:'Auray', siret:'', tva:'', tel:'', email:''},
    lignes:lignes, objet:'', delai:'', remise:o.remise, notes:'',
    signataire:'', signature:'', signeLe:0,
    totaux:{ht:ht, tva:Math.round(ht*20)/100, ttc:Math.round(ht*120)/100,
            htPonctuel:0, htMensuel:ht, parTaux:{20:Math.round(ht*20)/100}}
  };
  const b64 = PDF.base64(devis, CFG.reglages);
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  let txt = '';
  for(let n=1; n<=doc.numPages; n++){
    const tc = await (await doc.getPage(n)).getTextContent();
    txt += tc.items.map(i=>i.str).join(' ') + '\n';
  }
  return {texte:txt.replace(/\s+/g,' '), ht:ht, brutP:brutP, netP:netP};
}, {passages:passages, remise:remise});

let m = await mois(4, 0);
T('le prix d\'un passage est imprimé', /Prix d'un passage HT 17,50/.test(m.texte), m.texte.slice(-700));
T('le nombre de passages aussi', /Passages par mois 4/.test(m.texte), m.texte.slice(-700));
T('le total mensuel est celui des quatre passages', /Total mensuel HT 70,00/.test(m.texte), m.texte.slice(-700));
T('la TVA imprimée est celle du mois, pas celle d\'un passage',
  /TVA \( 20 % \) 14,00/.test(m.texte), m.texte.slice(-700));
T('et le TTC mensuel tombe avec les deux autres',
  /Total TTC \/ mois 84,00/.test(m.texte), m.texte.slice(-700));

m = await mois(1, 0);
T('un seul passage par mois reste juste lui aussi',
  /Total mensuel HT 17,50/.test(m.texte) && /TVA \( 20 % \) 3,50/.test(m.texte),
  m.texte.slice(-700));

m = await mois(4, 10);
T('la remise d\'un contrat d\'entretien apparaît bien',
  /Sous-total HT/.test(m.texte), m.texte.slice(-800));
T('le sous-total remisé est celui du mois', /Sous-total HT 70,00/.test(m.texte), m.texte.slice(-800));
T('la remise est chiffrée au mois', /- 3,00/.test(m.texte), m.texte.slice(-800));
T('le total mensuel est bien le montant remisé',
  /Total mensuel HT 67,00/.test(m.texte), m.texte.slice(-800));
T('et la TVA suit', /TVA \( 20 % \) 13,40/.test(m.texte), m.texte.slice(-800));

/* Une intervention, elle, n'a qu'un seul montant : rien ne doit être multiplié. */
const ponctuel = await p.evaluate(async () => {
  const lignes = [{categorie:'Vitrerie', reference:'REF-0001', designation:'Nettoyage de vitres',
    detail:'', qte:20, unite:'m²', pu:2.5, rem:0, tva:20, type:'PONCTUEL'}];
  const devis = {numero:'DEV-26-10/ MAEN/ SLG-04', date:new Date().toISOString(),
    validite:new Date().toISOString(), commercial:'SIMON LG', nature:'REMISE', passages:0,
    client:{type:'PRO', societe:'A', contact:'', adresse:'1', cp:'56400', ville:'Auray',
            siret:'', tva:'', tel:'', email:''},
    lignes:lignes, objet:'', delai:'', remise:0, notes:'', signataire:'', signature:'', signeLe:0,
    totaux:{ht:50, tva:10, ttc:60, htPonctuel:50, htMensuel:0, parTaux:{20:10}}};
  const b64 = PDF.base64(devis, CFG.reglages);
  const bin = atob(b64.split(',').pop());
  const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map(i=>i.str).join(' ').replace(/\s+/g,' ');
});
T('une intervention garde un total HT simple', /Total HT 50,00/.test(ponctuel), ponctuel.slice(-500));
T('sa TVA n\'est pas multipliée', /TVA \( 20 % \) 10,00/.test(ponctuel), ponctuel.slice(-500));
T('et elle ne parle pas de passages', !/Passages par mois/.test(ponctuel), ponctuel.slice(-500));

await b.close();
console.log('\n=== LE DEVIS IMPRIMÉ (v39) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length ? 1 : 0);
