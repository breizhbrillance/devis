/* L'éloignement du client, côté téléphone (v51).

   Le devis se chiffre chez le client, souvent sans réseau : la distance vient
   d'une table de communes que le bureau envoie à la connexion, et le
   commercial peut la corriger. La majoration ne s'écrit nulle part sur le
   devis — elle relève les prix unitaires.

   Deux pièges valent qu'on les surveille. D'abord LIGNES, la liste de travail,
   doit garder les prix du catalogue : si l'éloignement s'y inscrivait, chaque
   recalcul majorerait un prix déjà majoré. Ensuite un devis dupliqué repart de
   prix déjà relevés : sans précaution, le client paierait son éloignement deux
   fois. */
import {chromium} from 'playwright';
import {lancer, configSup, reglagesSup} from './srvco.mjs';
import {CHROME} from './chemins.mjs';
import {poserQte} from './presta.mjs';

const ok=[],ko=[]; const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };

configSup.initiales = 'SLG';
configSup.communes = {'56000 VANNES':3, '56250 MONTERBLANC':12, '56400 AURAY':20};
reglagesSup.majoration_km_eur = '0,90';
reglagesSup.majoration_km_franchise = '10';
reglagesSup.majoration_km_arrondi = '0,10';

const PORT = 8482; await lancer(PORT);
const b = await chromium.launch({executablePath:CHROME});
const ctx = await b.newContext({viewport:{width:390,height:820},hasTouch:true,isMobile:true,locale:'fr-FR'});
const p = await ctx.newPage();
const err=[]; p.on('pageerror', e => err.push(String(e)));

await p.goto(`http://127.0.0.1:${PORT}/index.html`, {waitUntil:'networkidle'});
await p.waitForTimeout(600);
await p.fill('#fCommercial','Simon LG'); await p.fill('#fCode','ab1!');
await p.click('#bCo'); await p.waitForTimeout(900);
if(await p.isVisible('#eAccord')){ await p.click('#bAccord'); await p.waitForTimeout(300); }

/* ---------- 1. la clé d'une commune et la table ---------- */
const cle = (cp, v) => p.evaluate(o => cleCommune(o.cp, o.v), {cp, v});
T('code postal et ville font la clé', await cle('56400','Auray') === '56400 AURAY');
T('les accents ne comptent pas', await cle('56250','Séné') === '56250 SENE');
T('les tirets deviennent des espaces', await cle('56000','Saint-Avé') === '56000 SAINT AVE');
T('le téléphone et le classeur normalisent pareil', await cle(' 56400 ','  auray ') === '56400 AURAY');

const tb = (cp, v) => p.evaluate(o => kmTable(o.cp, o.v), {cp, v});
T('une commune connue donne sa distance', await tb('56400','Auray') === 20);
T('l\'orthographe de la ville n\'empêche rien', await tb('56400','AURAY-SUR-MER') === 20);
T('une commune inconnue ne donne rien', await tb('29000','Quimper') === -1);

/* ---------- 2. le champ n'existe que sur un entretien ---------- */
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chREM'); await p.waitForTimeout(400);
await p.fill('#cSociete','MAIRIE DE PLOEREN'); await p.fill('#cAdresse','1 place');
await p.fill('#cCp','56400'); await p.fill('#cVille','Auray'); await p.waitForTimeout(400);
T('sur une remise en état, aucune distance à saisir', !(await p.isVisible('#blocKm')));
T('et aucun supplément', await p.evaluate(() => supplementKm()) === 0);
/* Même une distance forcée ne doit rien majorer hors entretien : c'est la
   nature qui commande, pas le champ. */
const forcee = await p.evaluate(() => {
  KM = '20'; KM_AUTO = false;
  const r = {sup:supplementKm(), taux:tauxSupKm()};
  KM = ''; KM_AUTO = true;
  return r;
});
T('une distance forcée ne majore pas une remise en état', forcee.sup === 0, forcee);
T('et ne relève aucun prix', forcee.taux === 0, forcee);

await p.evaluate(() => nouveauDevis());
await p.waitForTimeout(300);
await p.click('#chPRO'); await p.waitForTimeout(250);
await p.click('#chENT'); await p.waitForTimeout(400);
await p.fill('#fPassages','4'); await p.waitForTimeout(200);
await p.click('#bSuiv'); await p.waitForTimeout(600);
await p.fill('#cSociete','MAIRIE DE PLOEREN'); await p.fill('#cAdresse','1 place');
await p.fill('#cCp','56400'); await p.fill('#cVille','Auray'); await p.waitForTimeout(500);
T('sur un entretien, la distance est demandée', await p.isVisible('#blocKm'));
T('et remplie d\'après la commune', await p.inputValue('#cKm') === '20', await p.inputValue('#cKm'));
T('la note dit ce que ça coûte au client',
  /environ 9,00\s*€ de plus par passage/.test(await p.textContent('#kmNote')),
  await p.textContent('#kmNote'));

/* ---------- 3. le supplément ---------- */
T('à 20 km, dix kilomètres facturés font 9 €',
  await p.evaluate(() => supplementKm()) === 9);
const poser = async (km) => { await p.fill('#cKm', String(km)); await p.waitForTimeout(250); };
await poser(10);
T('à dix kilomètres, rien', await p.evaluate(() => supplementKm()) === 0);
T('et la note le dit', /compris/.test(await p.textContent('#kmNote')), await p.textContent('#kmNote'));
await poser(11);
T('onze kilomètres, 0,90 €', await p.evaluate(() => supplementKm()) === 0.9);
await poser(12.5);
T('les demi-kilomètres comptent', await p.evaluate(() => supplementKm()) === 2.25);
await poser('');
T('sans distance, pas de supplément', await p.evaluate(() => supplementKm()) === 0);
T('et la note invite à la saisir', /saisir/.test(await p.textContent('#kmNote')), await p.textContent('#kmNote'));
await poser(20);
T('une distance saisie à la main est retenue', await p.evaluate(() => kmDevis()) === 20);

/* Le pas d'arrondi : au dixième d'euro à partir d'un euro, au centime en
   dessous — un prix au m² bondirait d'un tiers sinon. */
const pas = await p.evaluate(() => [pasArrondi(4), pasArrondi(1), pasArrondi(0.99), pasArrondi(0.15)]);
T('un prix d\'un euro et plus s\'arrondit au dixième', pas[0] === 0.1 && pas[1] === 0.1, pas);
T('un prix au m² s\'arrondit au centime', pas[2] === 0.01 && pas[3] === 0.01, pas);
T('le téléphone et le classeur arrondissent pareil',
  JSON.stringify(await p.evaluate(() => [prixAvecKm(0.15, 0.1636), prixAvecKm(0.20, 0.1636),
                                         prixAvecKm(1, 0.1636), prixAvecKm(2, 0.1636),
                                         prixAvecKm(4, 0.1636)]))
  === JSON.stringify([0.17, 0.23, 1.2, 2.3, 4.7]),
  await p.evaluate(() => [prixAvecKm(0.15, 0.1636), prixAvecKm(0.20, 0.1636),
                          prixAvecKm(1, 0.1636), prixAvecKm(2, 0.1636), prixAvecKm(4, 0.1636)]));
T('un taux nul laisse le prix du catalogue',
  await p.evaluate(() => prixAvecKm(0.15, 0)) === 0.15);

/* Une commune que le bureau ne connaît pas : rien ne se remplit tout seul. */
await p.fill('#cCp','29000'); await p.fill('#cVille','Quimper'); await p.waitForTimeout(400);
T('changer pour une commune inconnue garde ce qui a été saisi',
  await p.inputValue('#cKm') === '20', await p.inputValue('#cKm'));
await p.fill('#cCp','56000'); await p.fill('#cVille','Vannes'); await p.waitForTimeout(400);
T('une distance saisie n\'est pas écrasée par la table',
  await p.inputValue('#cKm') === '20', await p.inputValue('#cKm'));
await p.fill('#cCp','56400'); await p.fill('#cVille','Auray'); await p.waitForTimeout(400);

/* ---------- 4. les prix relevés ---------- */
await p.click('#bSuiv'); await p.waitForTimeout(700);
await poserQte(p, 0, 100);
await p.click('#bSuiv'); await p.waitForTimeout(800);

const etat = await p.evaluate(() => ({
  sup:supplementKm(), taux:tauxSupKm(),
  travail:LIGNES.map(l => [l.reference, l.qte, l.pu]),
  envoi:lignesDevis().map(l => [l.reference, l.qte, l.pu]),
  t:totaux()
}));
T('le supplément visé vaut 9 € le passage', etat.sup === 9, etat);
T('la liste de travail garde les prix du catalogue', etat.travail[0][2] === 2.5, etat.travail);
T('aucune ligne n\'est ajoutée au devis', etat.envoi.length === 1, etat.envoi);
/* 2,50 € est au-dessus d'un euro : le prix s'arrondit au dixième, donc 2,60 €
   et non 2,59 €. Le passage monte de 10 € au lieu des 9 € visés — c'est ce que
   coûte une grille lisible, et l'écart reste petit. */
T('c\'est le prix unitaire qui porte l\'éloignement', etat.envoi[0][2] === 2.6, etat.envoi);
T('le passage monte d\'à peu près le supplément',
  Math.abs(etat.t.parPassage - 259) <= 1, etat.t);
T('et le mois suit les passages', etat.t.ht === etat.t.parPassage * 4, etat.t);
T('un second calcul ne majore pas une seconde fois',
  (await p.evaluate(() => { calculer(); calculer(); return totaux().parPassage; }))
  === etat.t.parPassage);

/* La nature commande, même avec des prestations chiffrées et un client loin. */
const horsEnt = await p.evaluate(() => {
  const n = NATURE; NATURE = 'REMISE';
  const r = lignesDevis().map(l => l.pu);
  NATURE = n; calculer();
  return r;
});
T('une intervention, même loin et déjà chiffrée, garde le prix du catalogue',
  horsEnt[0] === 2.5, horsEnt);

await p.evaluate(() => { KM = '5'; KM_AUTO = false; calculer(); });
T('rapproché de l\'agence, le prix retombe au catalogue',
  await p.evaluate(() => lignesDevis()[0].pu) === 2.5);
T('et le passage retombe au tarif', await p.evaluate(() => totaux().parPassage) === 250);
await p.evaluate(() => { KM = '20'; KM_AUTO = false; calculer(); });

/* ---------- 5. le devis transporte sa distance ---------- */
await p.fill('#fDate', new Date(Date.now()+7*86400000).toISOString().slice(0,10));
await p.click('#bSuiv'); await p.waitForTimeout(2500);
const enr = await p.evaluate(() => DB.tous().then(t => {
  const e = t[t.length-1];
  return {km:e.devis.km, nature:e.devis.nature, passages:e.devis.passages,
          lignes:e.devis.lignes.map(l => [l.reference, l.qte, l.pu]), ht:e.devis.totaux.ht, id:e.id};
}));
T('le devis part avec sa distance', enr.km === 20, enr);
T('une seule ligne, aux prix relevés', enr.lignes.length === 1 && enr.lignes[0][2] === 2.6, enr);
T('le total envoyé comprend l\'éloignement', enr.ht === 1040, enr);

/* ---------- 6. dupliquer ne majore pas deux fois ---------- */
await p.evaluate(id => dupliquer(id), enr.id);
await p.waitForTimeout(1200);
const dup = await p.evaluate(() => ({
  travail:LIGNES.map(l => [l.reference, l.pu]),
  km:String(KM), nature:NATURE, passages:PASSAGES,
  envoi:lignesDevis().map(l => [l.reference, l.pu]),
  t:totaux()
}));
T('le devis dupliqué repart des prix du catalogue', dup.travail[0][1] === 2.5, dup);
T('il garde la nature entretien', dup.nature === 'ENTRETIEN', dup);
T('et le nombre de passages', dup.passages === 4, dup);
T('il retrouve la distance', dup.km === '20', dup);
T('les prix envoyés sont relevés une fois, pas deux', dup.envoi[0][1] === 2.6, dup);
T('et le total du devis dupliqué est le même que l\'original', dup.t.ht === 1040, dup);

await b.close();
console.log('\n=== L\'ÉLOIGNEMENT, CÔTÉ TÉLÉPHONE (v51) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
console.log('\nerreurs JS : ' + (err.length ? err.join(' | ') : 'aucune'));
process.exit(ko.length ? 1 : 0);
