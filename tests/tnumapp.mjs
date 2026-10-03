/* Le numéro d'un devis (v50), côté téléphone.

       devis remis     DEV-26-11/ POSK/ SLG-03
       devis signé     DEV-26-12/ POSK/ SLG-01/ S

   C'est le téléphone qui numérote, et il le fait hors connexion : le bureau ne
   peut pas lui donner le numéro au moment venu. Tout se joue donc ici — la
   forme, le rang qui avance, le changement de numéro quand le client signe, et
   le nom du fichier, où les barres n'ont pas leur place. */
import {chromium} from 'playwright';
import {lancer, configSup} from './srvco.mjs';
import {CHROME} from './chemins.mjs';
import {poserQte} from './presta.mjs';

const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };

/* Le mois courant, calculé maintenant : l'essai ne doit pas rougir en
   changeant de mois. */
const now = new Date();
const AA = String(now.getFullYear()).slice(-2);
const MM = ('0'+(now.getMonth()+1)).slice(-2);
const DEBUT = 'DEV-'+AA+'-'+MM+'/ ';

configSup.initiales = 'SLG';          // ce que le bureau impose à ce commercial
const PORT = 8471; await lancer(PORT);
const b = await chromium.launch({executablePath:CHROME});
const ctx = await b.newContext({viewport:{width:390,height:780},hasTouch:true,isMobile:true,locale:'fr-FR'});
const p = await ctx.newPage();
const err=[]; p.on('pageerror', e => err.push(String(e)));

await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
await p.waitForTimeout(600);
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }

/* ---------- 1. les lettres du client ---------- */
const lc = (n) => p.evaluate(x => lettresClient(x), n);
T('deux premières et deux dernières lettres', await lc('POKESHOP') === 'POOP');
T('les espaces ne comptent pas', await lc('MAIRIE DE PLOEREN') === 'MAEN', await lc('MAIRIE DE PLOEREN'));
T('les accents non plus', await lc('Pôle Santé') === 'POTE', await lc('Pôle Santé'));
T('ni la ponctuation', await lc("L'ATELIER-DU-PROPRE") === 'LARE', await lc("L'ATELIER-DU-PROPRE"));
T('ni les chiffres', await lc('ETS 2000') === 'ETSX', await lc('ETS 2000'));
T('un nom trop court est complété par des X', await lc('LE') === 'LEXX');
T('un nom vide donne quatre X', await lc('') === 'XXXX');
T('le téléphone et le classeur lisent le même nom de la même façon',
  await lc('MAIRIE DE PLOEREN') === 'MAEN');

/* Le nom retenu : la raison sociale chez un professionnel, la personne chez un
   particulier — c'est elle, le client. */
const nc = (c) => p.evaluate(x => nomClient(x), c);
T('chez un professionnel, c\'est la raison sociale',
  await nc({type:'PRO', societe:'MAIRIE DE PLOEREN', contact:'Mme Le Gall'}) === 'MAIRIE DE PLOEREN');
T('chez un particulier, c\'est la personne',
  await nc({type:'PART', societe:'', contact:'Madame Hervé'}) === 'Madame Hervé');
T('un professionnel sans raison sociale retombe sur son contact',
  await nc({type:'PRO', societe:'', contact:'Jean Test'}) === 'Jean Test');

/* ---------- 2. les initiales ---------- */
T('celles que le bureau impose l\'emportent sur le nom',
  await p.evaluate(() => initialesMoi('Simon LG')) === 'SLG');
T('sans consigne du bureau, elles viennent du nom',
  await p.evaluate(() => { const g = CFG.initiales; CFG.initiales = '';
    const r = initialesMoi('Simon Le Goff'); CFG.initiales = g; return r; }) === 'SLG');
T('celles d\'un numéro déjà écrit se retrouvent',
  await p.evaluate(() => initialesDuNumero('DEV-26-11/ POSK/ SLG-03')) === 'SLG');
T('y compris sur un numéro signé',
  await p.evaluate(() => initialesDuNumero('DEV-26-12/ POSK/ SLG-01/ S')) === 'SLG');
T('un ancien numéro n\'en donne aucune',
  await p.evaluate(() => initialesDuNumero('DEV-2026-SL-0009')) === '');

/* ---------- 3. la forme du numéro et le rang qui avance ---------- */
const suivant = (client, signe) =>
  p.evaluate(o => prochainNumero('Simon LG', o.c, o.s), {c:client, s:!!signe});
let n1 = await suivant('MAIRIE DE PLOEREN');
T('le numéro commence par le préfixe, l\'année et le mois', n1.indexOf(DEBUT) === 0, n1);
T('puis les lettres du client, puis les initiales',
  n1 === DEBUT + 'MAEN/ SLG-01', n1);
let n2 = await suivant('MAIRIE DE PLOEREN');
T('le devis suivant prend le rang d\'après', n2 === DEBUT + 'MAEN/ SLG-02', n2);
let n3 = await suivant('AUTRE CLIENT');
T('un autre client ne remet pas le rang à un : c\'est lui qui rend le numéro unique',
  n3 === DEBUT + 'AUNT/ SLG-03', n3);
T('deux devis n\'ont donc jamais le même numéro', n1 !== n2 && n2 !== n3);

let s1 = await suivant('MAIRIE DE PLOEREN', true);
T('un devis signé finit par le suffixe', s1 === DEBUT + 'MAEN/ SLG-01/ S', s1);
T('sa série est à part : le rang repart à un', s1.indexOf('-01/ S') > 0, s1);
let s2 = await suivant('MAIRIE DE PLOEREN', true);
T('et avance de son côté', s2 === DEBUT + 'MAEN/ SLG-02/ S', s2);
T('sans toucher à celle des devis remis',
  await suivant('MAIRIE DE PLOEREN') === DEBUT + 'MAEN/ SLG-04', n1);

T('un numéro signé se reconnaît', await p.evaluate(x => estNumeroSigne(x), s1) === true);
T('un numéro remis ne se prend pas pour signé', await p.evaluate(x => estNumeroSigne(x), n1) === false);
T('la forme en service est reconnue', await p.evaluate(x => estNumeroCourant(x), n1) === true);
T('un ancien numéro ne l\'est pas',
  await p.evaluate(() => estNumeroCourant('DEV-2026-SL-0009')) === false);

/* Le bureau dit où en sont les séries : un téléphone réinstallé ne redonne pas
   un rang déjà pris. */
T('les compteurs du bureau font avancer le téléphone', await p.evaluate(o => {
  CFG.compteurs = {}; CFG.compteurs[o.serie] = 12;
  alignerCompteurs();
  return prochainNumero('Simon LG', 'MAIRIE DE PLOEREN');
}, {serie:'DEV-'+AA+'-'+MM+'/ SLG'}) === DEBUT + 'MAEN/ SLG-13');

/* ---------- 4. le nom du fichier ---------- */
const nf = (numero) => p.evaluate(x => PDF.nomFichier({numero:x, client:{societe:'MAIRIE DE PLOEREN'}}), numero);
T('aucune barre dans le nom du fichier', !/\//.test(await nf(DEBUT+'MAEN/ SLG-01')), await nf(DEBUT+'MAEN/ SLG-01'));
T('aucune espace non plus', !/\s/.test(await nf(DEBUT+'MAEN/ SLG-01')), await nf(DEBUT+'MAEN/ SLG-01'));
T('le numéro reste lisible dedans',
  /DEV-\d\d-\d\d-MAEN-SLG-01/.test(await nf(DEBUT+'MAEN/ SLG-01')), await nf(DEBUT+'MAEN/ SLG-01'));
T('le suffixe signé survit au nom de fichier',
  /-SLG-01-S-/.test(await nf(DEBUT+'MAEN/ SLG-01/ S')), await nf(DEBUT+'MAEN/ SLG-01/ S'));
T('un ancien numéro traverse sans rien perdre',
  /Devis-DEV-2026-SL-0009-/.test(await nf('DEV-2026-SL-0009')), await nf('DEV-2026-SL-0009'));

/* ---------- 5. un devis fabriqué de bout en bout ---------- */
await p.evaluate(() => { CFG.compteurs = {}; Object.keys(localStorage)
  .filter(k => k.indexOf('seq_') === 0).forEach(k => localStorage.removeItem(k)); });
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chREM'); await p.waitForTimeout(400);
await p.fill('#cSociete','MAIRIE DE PLOEREN'); await p.fill('#cContact','Mme Le Gall');
await p.fill('#cAdresse','1 place de la Mairie'); await p.fill('#cCp','56880'); await p.fill('#cVille','Ploeren');
await p.click('#bSuiv'); await p.waitForTimeout(600);
await poserQte(p, 0, 100);
await p.click('#bSuiv'); await p.waitForTimeout(700);
/* La date de début est obligatoire depuis la v46 : sans elle, rien ne part. */
await p.fill('#fDate', new Date(Date.now()+7*86400000).toISOString().slice(0,10));
await p.click('#bSuiv'); await p.waitForTimeout(2500);
const affiche = (await p.textContent('#okNum') || '').trim();
T('le devis est bien enregistré', !!affiche,
  await p.evaluate(() => (document.querySelector('.err,#err,#msg')||{}).textContent || ''));
T('le numéro affiché au commercial a la bonne forme',
  affiche === DEBUT + 'MAEN/ SLG-01', affiche);

const enr = await p.evaluate(() => DB.tous().then(t => {
  const e = t[t.length-1];
  return {numero:e.numero, dansDevis:e.devis.numero, nomFichier:e.nomFichier,
          id:e.id, signe:!!e.devis.signature, origine:e.numeroOrigine||''};
}));
T('le devis enregistré porte ce numéro', enr.numero === affiche, enr);
T('et son devis aussi : c\'est lui qui part au bureau', enr.dansDevis === affiche, enr);
T('le fichier du PDF ne porte aucune barre', !/\//.test(enr.nomFichier), enr.nomFichier);
T('rien n\'indique une signature', enr.signe === false && !enr.origine, enr);

/* Le numéro imprimé sur le PDF est bien celui-là. */
const texte = await p.evaluate(async (id) => {
  const e = await DB.get(id);
  await chargerLecteur();
  const bin = atob(e.pdf); const oct = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) oct[i] = bin.charCodeAt(i);
  const doc = await window.pdfjsLib.getDocument({data:oct}).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map(i => i.str).join(' ');
}, enr.id);
T('le PDF remis au client porte ce numéro',
  texte.replace(/\s+/g,' ').indexOf(affiche.replace(/\s+/g,' ')) >= 0,
  texte.slice(0, 300));

/* ---------- 6. le client signe après coup : le devis change de numéro ---------- */
const apres = await p.evaluate(async (id) => {
  const trait = (() => { const c = document.createElement('canvas'); c.width=200; c.height=60;
    const x = c.getContext('2d'); x.lineWidth=3; x.beginPath(); x.moveTo(10,40); x.lineTo(180,20);
    x.stroke(); return c.toDataURL('image/png'); })();
  await appliquerSignature(id, trait, 'Mme Le Gall');
  const e = await DB.get(id);
  return {numero:e.numero, dansDevis:e.devis.numero, origine:e.numeroOrigine||'',
          nomFichier:e.nomFichier, verdict:e.verdict, statut:e.statut};
}, enr.id);
T('le devis signé prend un numéro signé', /\/ S$/.test(apres.numero), apres);
T('il garde les initiales du commercial', apres.numero.indexOf('/ SLG-') > 0, apres);
T('il garde les lettres du client', apres.numero.indexOf('/ MAEN/') > 0, apres);
T('le mois est celui de la signature', apres.numero.indexOf(DEBUT) === 0, apres);
T('le devis qui part au bureau porte le nouveau numéro',
  apres.dansDevis === apres.numero, apres);
T('l\'ancien numéro est gardé : c\'est celui de l\'exemplaire déjà remis',
  apres.origine === affiche, apres);
T('le PDF signé est renommé avec lui', apres.nomFichier.indexOf('-S-') > 0 ||
  /-01-S/.test(apres.nomFichier), apres.nomFichier);
T('le devis repart au bureau', apres.statut === 'attente', apres);
T('et il est marqué signé', apres.verdict === 'SIGNE', apres);

/* Signer deux fois ne redonne pas encore un autre numéro. */
const encore = await p.evaluate(async (id) => {
  const e0 = await DB.get(id);
  await appliquerSignature(id, e0.devis.signature, 'Mme Le Gall');
  const e = await DB.get(id);
  return {numero:e.numero, origine:e.numeroOrigine||''};
}, enr.id);
T('resigner ne change pas une deuxième fois le numéro',
  encore.numero === apres.numero, [encore, apres]);
T('ni l\'ancien numéro gardé', encore.origine === affiche, encore);

/* Un devis d'avant la règle garde son numéro en signant. */
const vieux = await p.evaluate(async () => {
  const t = await DB.tous(); const src = t[t.length-1];
  const e = JSON.parse(JSON.stringify(src));
  e.id = 'vieux-1'; e.numero = 'DEV-2026-SL-0009'; e.devis.numero = 'DEV-2026-SL-0009';
  e.devis.signature = ''; e.devis.signeLe = 0; e.numeroOrigine = '';
  await DB.put(e);
  await appliquerSignature('vieux-1', 'data:image/png;base64,AA', 'Mme Le Gall');
  const f = await DB.get('vieux-1');
  return {numero:f.numero, origine:f.numeroOrigine||''};
});
T('un devis d\'avant la règle n\'est pas renuméroté en signant',
  vieux.numero === 'DEV-2026-SL-0009', vieux);
T('et rien ne prétend qu\'il l\'a été', !vieux.origine, vieux);

await b.close();
console.log('\n=== LE NUMÉRO DU DEVIS, CÔTÉ TÉLÉPHONE (v50) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length ? 1 : 0);
