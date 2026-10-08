/* La prospection téléphonique, côté classeur (v56).

   Le commercial appelle en chaîne depuis son téléphone. Trois endroits se
   partagent le travail et ces essais gardent la frontière entre eux :

   — le FICHIER DE PROSPECTION (un autre classeur, un onglet par commune) est
     la source des coordonnées. L'import les recopie dans PROSPECTS **sans
     jamais écraser le suivi** : un statut posé la semaine dernière doit
     survivre à un réimport, sans quoi le commercial rappellerait des gens
     qu'il vient d'avoir ;
   — PROSPECTS porte l'état courant, APPELS garde chaque tentative. Un statut
     se corrige, un journal non : c'est lui qui dira un jour pourquoi un
     prospect a été classé « pas intéressé » ;
   — un prestataire n'a rien à faire là : la cloison des droits est la même que
     pour les devis, et elle se vérifie ici aussi.

   Le reste tient à des détails qui coûtent cher en vrai : un numéro mal
   converti n'appelle personne, une clé instable détache le suivi de sa ligne,
   un lot renvoyé après une coupure de réseau compterait deux appels.
*/
import { creer, lire, creerExt, lireExt, videExt, idExterne, charger,
         videProprietes, horloge } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };

const ID_SRC = 'SHEET-PROSPECTION';
const EN_P = ['ID','COMMUNE','SOCIETE','DIRIGEANT','TEL','MAIL','ADRESSE','EFFECTIF',
  'SOURCE_HORAIRES','LUN','MAR','MER','JEU','VEN','SAM','DIM','COMMENTAIRE',
  'STATUT','NOTE','RAPPEL_LE','DERNIER_APPEL','NB_APPELS','COMMERCIAL','MAJ_LE'];
const EN_A = ['HORODATAGE','COMMERCIAL','ID_PROSPECT','SOCIETE','COMMUNE',
  'RESULTAT','NOTE','RAPPEL_LE','APPAREIL'];
const cp = (n) => EN_P.indexOf(n);
const ca = (n) => EN_A.indexOf(n);

/* La forme réelle des onglets de Simon : deux lignes de titre, l'en-tête en
   troisième, et la colonne TEL qui porte parfois deux numéros séparés par « / ». */
function communeSrc(lignes) {
  return [['TABLEAU PROSPECT PEINTURE', '', '', '', '', '', '', ''],
          ['', '', '', '', '', '', '', ''],
          ['NOM DE LA SOCIETE', 'NOM DIRIGEANT(s)', 'TEL', 'MAIL', 'ADRESSE POSTALE',
           'EFFECTIF', 'STATUT', 'COMMENTAIRE', 'SOURCE HORAIRES',
           'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']].concat(lignes);
}

function socle(reglagesSup) {
  videExt(); videProprietes(); idExterne(ID_SRC);
  creer('PROSPECTS', [EN_P]);
  creer('APPELS', [EN_A]);
  creer('COMMERCIAUX', [['NOM','EMAIL','CODE','ACTIF','INITIALES'],
                        ['SIMON LG','simon@test.fr','ab1!','OUI','SLG']]);
  creer('PRESTATAIRES', [['NOM','EMAIL','CODE','ACTIF','TELEPHONE','JOURS','PLAGES','HEURES_SEMAINE'],
                         ['MAXIME T','max@test.fr','kw7!','OUI','','','','']]);
  creer('ADMINS', [['NOM','EMAIL','CODE','ACTIF']]);
  creer('JOURNAL', [['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);
  creer('REGLAGES', [['CLE','VALEUR','NOTE'],
    ['societe_nom','BREIZH BRILLANCE',''],
    ['prospection_active','OUI',''],
    ['prospection_fichier_id', ID_SRC, ''],
    ['prospection_entete_ligne','3',''],
    ['prospection_relance_heures','3','']].concat(reglagesSup || []));

  creerExt('VANNES', communeSrc([
    ['PEINTURE DU GOLFE','Yann Le Roy','02 97 11 22 33','contact@golfe.fr','1 rue des Arts','5','','Devanture refaite','releve',
     '08:00-12:00 / 13:30-18:00','08:00-12:00 / 13:30-18:00','08:00-12:00','08:00-12:00 / 13:30-18:00','08:00-12:00 / 13:30-17:00','Fermé','Fermé'],
    ['ATELIER COULEURS','Marie Danic','0297445566 / 06 12 34 56 78','','2 quai','3','','','', '','','','','','',''],
    ['SANS NUMERO SARL','','','rien@test.fr','3 place','1','','','', '','','','','','','']
  ]));
  creerExt('AURAY', communeSrc([
    ['DECO BRETONNE','Paul Guen','06 01 02 03 04','p@deco.fr','4 venelle','2','','','',
     '09:00-12:00','09:00-12:00','09:00-12:00','09:00-12:00','09:00-12:00','','']
  ]));
  return charger(CODE_GS);
}

const COM = { nom: 'SIMON LG', role: 'COMMERCIAL' };
const rep = (g, o) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(o) } }));
const parId = (id) => lire('PROSPECTS').find(r => String(r[cp('ID')]) === id);

/* ---------- 1. les numéros ---------- */
let g = socle();
let t = g.telsProspect_('02 97 11 22 33');
T('un numéro français devient composable', t.length === 1 && t[0].t === '+33297112233', t);
T('et reste lisible pour le commercial', t[0].l === '02 97 11 22 33', t[0].l);
t = g.telsProspect_('0297445566 / 06 12 34 56 78');
T('deux numéros séparés par « / » font deux boutons', t.length === 2, t);
T('le second est bien le portable', t[1] && t[1].t === '+33612345678', t[1]);
T('un numéro collé est réécrit avec ses espaces',
  g.telsProspect_('0297445566')[0].l === '02 97 44 55 66', g.telsProspect_('0297445566')[0].l);
T('un international en 00 passe en +', g.telsProspect_('0033297112233')[0].t === '+33297112233',
  g.telsProspect_('0033297112233'));
T('un déjà en +33 ne bouge pas', g.telsProspect_('+33297112233')[0].t === '+33297112233',
  g.telsProspect_('+33297112233'));
T('neuf chiffres sans le zéro sont complétés', g.telsProspect_('297112233')[0].t === '+33297112233',
  g.telsProspect_('297112233'));
T('une cellule vide ne donne aucun bouton', g.telsProspect_('').length === 0, g.telsProspect_(''));
T('un reste de texte trop court non plus', g.telsProspect_('voir site').length === 0,
  g.telsProspect_('voir site'));
T('un numéro tronqué est écarté plutôt que composé faux',
  g.telsProspect_('02 97 11').length === 0, g.telsProspect_('02 97 11'));

/* ---------- 2. la clé ---------- */
T('la clé ignore la casse et les accents',
  g.cleProspect_('VANNES', 'Peinture du Golfé') === g.cleProspect_('vannes', 'PEINTURE DU GOLFE'),
  [g.cleProspect_('VANNES', 'Peinture du Golfé'), g.cleProspect_('vannes', 'PEINTURE DU GOLFE')]);
T('mais pas la commune',
  g.cleProspect_('VANNES', 'DUPONT') !== g.cleProspect_('AURAY', 'DUPONT'), '');
T('et elle ne garde que des caractères sûrs',
  /^[a-z0-9-]+$/.test(g.cleProspect_('SAINT-AVÉ', 'S.A.R.L. « Peinture » & Fils')),
  g.cleProspect_('SAINT-AVÉ', 'S.A.R.L. « Peinture » & Fils'));

/* ---------- 3. l'import ---------- */
let r = g.importerProspects_();
T('les deux communes sont lues', r.onglets === 2 && r.total === 2, r);
T('quatre prospects sont rangés', r.lignes === 4, r.lignes);
T('dont un sans numéro', r.sansTel === 1, r.sansTel);
T('l\'import va jusqu\'au bout', r.reste === 0, r.reste);
let p = parId(g.cleProspect_('VANNES', 'PEINTURE DU GOLFE'));
T('la société est recopiée', p && String(p[cp('SOCIETE')]) === 'PEINTURE DU GOLFE', p && p[cp('SOCIETE')]);
T('la commune vient du nom de l\'onglet', p && String(p[cp('COMMUNE')]) === 'VANNES', p && p[cp('COMMUNE')]);
T('le dirigeant aussi', p && String(p[cp('DIRIGEANT')]) === 'Yann Le Roy', p && p[cp('DIRIGEANT')]);
T('les horaires du lundi sont là',
  p && /08:00-12:00/.test(String(p[cp('LUN')])), p && p[cp('LUN')]);
T('le samedi fermé est gardé tel quel', p && String(p[cp('SAM')]) === 'Fermé', p && p[cp('SAM')]);
T('le commentaire suit', p && /Devanture/.test(String(p[cp('COMMENTAIRE')])), p && p[cp('COMMENTAIRE')]);
T('un prospect sans numéro entre quand même dans la liste',
  !!parId(g.cleProspect_('VANNES', 'SANS NUMERO SARL')), lire('PROSPECTS').map(x => x[0]));
T('l\'import est noté au journal',
  lire('JOURNAL').some(x => String(x[3]) === 'PROSPECTS IMPORTES'), lire('JOURNAL').map(x => x[3]));

/* ---------- 4. le suivi survit à un réimport ---------- */
let ligne = lire('PROSPECTS').findIndex(x => String(x[0]) === g.cleProspect_('AURAY', 'DECO BRETONNE'));
let d = lire('PROSPECTS');
d[ligne][cp('STATUT')] = 'rdv';
d[ligne][cp('NOTE')] = 'RDV mardi 14 h';
d[ligne][cp('NB_APPELS')] = 3;
d[ligne][cp('COMMERCIAL')] = 'SIMON LG';
creer('PROSPECTS', d);
/* Entre-temps, le fichier de prospection a été corrigé : nouveau numéro. */
videExt(); idExterne(ID_SRC);
creerExt('AURAY', communeSrc([
  ['DECO BRETONNE','Paul Guen','02 97 99 88 77','p@deco.fr','4 venelle','2','','','','','','','','','','']
]));
r = g.importerProspects_();
p = parId(g.cleProspect_('AURAY', 'DECO BRETONNE'));
T('le réimport ne crée pas de doublon', lire('PROSPECTS').length === 5, lire('PROSPECTS').length);
T('le nouveau numéro remplace l\'ancien', p && String(p[cp('TEL')]) === '02 97 99 88 77', p && p[cp('TEL')]);
T('le statut posé par le commercial est conservé', p && String(p[cp('STATUT')]) === 'rdv', p && p[cp('STATUT')]);
T('sa note aussi', p && /RDV mardi/.test(String(p[cp('NOTE')])), p && p[cp('NOTE')]);
T('et le compte des appels', p && Number(p[cp('NB_APPELS')]) === 3, p && p[cp('NB_APPELS')]);

/* Deux fois le même nom dans la même commune : une seule ligne, sinon le
   commercial appellerait deux fois la même entreprise. */
g = socle();
videExt(); idExterne(ID_SRC);
creerExt('VANNES', communeSrc([
  ['PEINTURE DU GOLFE','Yann','02 97 11 22 33','','','','','','','','','','','','',''],
  ['PEINTURE DU GOLFE','Yann','02 97 11 22 33','y@golfe.fr','1 rue','','','','','','','','','','','']
]));
r = g.importerProspects_();
T('un nom en double dans la commune ne fait qu\'une ligne', r.lignes === 1, r.lignes);
p = parId(g.cleProspect_('VANNES', 'PEINTURE DU GOLFE'));
T('et c\'est la plus complète qui reste', p && String(p[cp('MAIL')]) === 'y@golfe.fr', p && p[cp('MAIL')]);

/* Un onglet sans colonne société est ignoré sans faire tomber l'import. */
g = socle();
creerExt('NOTES', [['Remarques'], [''], ['Divers'], ['à faire']]);
r = g.importerProspects_();
T('un onglet qui n\'est pas une commune est ignoré', r.lignes === 4, r.lignes);

/* Le fichier doit être accessible : sinon on le dit, on n'invente rien. */
g = socle();
idExterne('UN-AUTRE-FICHIER');
let boum = '';
try { g.importerProspects_(); } catch (e) { boum = String(e.message || e); }
T('un fichier de prospection inaccessible lève une erreur parlante',
  /autorisation/i.test(boum), boum);
T('et rien n\'est écrit dans PROSPECTS', lire('PROSPECTS').length === 1, lire('PROSPECTS').length);

/* ---------- 5. ce que reçoit le téléphone ---------- */
g = socle();
g.importerProspects_();
r = g.listeProspects_({});
T('la liste complète part au téléphone', r.ok && r.prospects.length === 4, r.prospects && r.prospects.length);
T('elle est annoncée comme complète', r.complet === true, r.complet);
T('le délai de relance l\'accompagne', r.relanceHeures === 3, r.relanceHeures);
let q = r.prospects.find(x => x.nom === 'PEINTURE DU GOLFE');
T('les numéros arrivent déjà composables',
  q && q.tels.length === 1 && q.tels[0].t === '+33297112233', q && q.tels);
T('les horaires arrivent par jour',
  q && q.h && /08:00/.test(q.h.lun) && /ferm/i.test(q.h.sam), q && q.h);
T('un prospect sans numéro part quand même, pour l\'onglet Liste',
  r.prospects.some(x => x.nom === 'SANS NUMERO SARL' && !x.tels.length), '');

/* « depuis » ne renvoie que ce qui a bougé : 957 prospects ne repassent pas
   le réseau à chaque synchronisation. */
let apres = new Date(Date.now() + 1000).toISOString();
r = g.listeProspects_({ depuis: apres });
T('rien n\'a bougé depuis : rien ne repart', r.prospects.length === 0, r.prospects.length);
T('et ce n\'est pas annoncé comme une liste complète', r.complet === false, r.complet);

/* Le module se coupe depuis le classeur. */
g = socle([['prospection_active','NON','']]);
g.importerProspects_();
r = g.listeProspects_({});
T('prospection_active à NON ne renvoie aucun prospect', r.prospects.length === 0, r.prospects.length);
T('et le dit clairement', r.actif === false, r.actif);

/* ---------- 6. un résultat d'appel ---------- */
g = socle();
g.importerProspects_();
const ID_GOLFE = g.cleProspect_('VANNES', 'PEINTURE DU GOLFE');
const T0 = '2026-10-08T09:30:00.000Z';
r = g.enregistrerAppels_({ appareil: 'tel-1', appels: [
  { id: ID_GOLFE, resultat: 'nrp', note: 'personne', t: T0 }
] }, COM);
T('le résultat est reçu', r.ok && r.recus === 1, r);
p = parId(ID_GOLFE);
T('le statut est posé sur le prospect', String(p[cp('STATUT')]) === 'nrp', p[cp('STATUT')]);
T('la note aussi', String(p[cp('NOTE')]) === 'personne', p[cp('NOTE')]);
T('le compteur d\'appels passe à 1', Number(p[cp('NB_APPELS')]) === 1, p[cp('NB_APPELS')]);
T('et le nom de celui qui a appelé est gardé',
  String(p[cp('COMMERCIAL')]) === 'SIMON LG', p[cp('COMMERCIAL')]);
T('une ligne est ajoutée au journal des appels', lire('APPELS').length === 2, lire('APPELS').length);
T('elle porte le résultat', String(lire('APPELS')[1][ca('RESULTAT')]) === 'nrp', lire('APPELS')[1]);
T('et la société, pour se relire sans croiser deux onglets',
  String(lire('APPELS')[1][ca('SOCIETE')]) === 'PEINTURE DU GOLFE', lire('APPELS')[1][ca('SOCIETE')]);

/* Un rappel porte sa date ; les autres résultats n'en portent pas. */
const T1 = '2026-10-08T10:00:00.000Z', RAP = '2026-10-09T08:00:00.000Z';
g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'rappel', note: '', t: T1, rappel: RAP }] }, COM);
p = parId(ID_GOLFE);
T('un rappel enregistre sa date', p[cp('RAPPEL_LE')] instanceof Date &&
  p[cp('RAPPEL_LE')].toISOString() === RAP, String(p[cp('RAPPEL_LE')]));
T('le compteur monte à 2', Number(p[cp('NB_APPELS')]) === 2, p[cp('NB_APPELS')]);
g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'refus', note: '', t: '2026-10-08T11:00:00.000Z' }] }, COM);
p = parId(ID_GOLFE);
T('un refus efface la date de rappel qui traînait', !p[cp('RAPPEL_LE')], String(p[cp('RAPPEL_LE')]));
/* Le téléphone peut très bien envoyer une date de rappel avec un autre
   résultat : il garde la dernière saisie en mémoire. Seul « rappel » doit la
   retenir, sinon le prospect reviendrait dans la file alors qu'il a dit non. */
g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'refus', note: '',
                                  t: '2026-10-08T12:00:00.000Z', rappel: RAP }] }, COM);
p = parId(ID_GOLFE);
T('et une date de rappel envoyée avec un refus est ignorée',
  !p[cp('RAPPEL_LE')], String(p[cp('RAPPEL_LE')]));
T('le journal des appels garde les quatre tentatives', lire('APPELS').length === 5, lire('APPELS').length);

/* Un lot renvoyé après une coupure ne compte pas deux fois. */
g = socle();
g.importerProspects_();
g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'nrp', note: '', t: T0 }] }, COM);
r = g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'nrp', note: '', t: T0 }] }, COM);
T('le même résultat renvoyé est reconnu', r.recus === 1, r);
T('et n\'ajoute pas de ligne au journal des appels', lire('APPELS').length === 2, lire('APPELS').length);
T('ni ne compte un appel de plus', Number(parId(ID_GOLFE)[cp('NB_APPELS')]) === 1,
  parId(ID_GOLFE)[cp('NB_APPELS')]);

/* Ce que le téléphone envoie n'est pas cru sur parole. */
g = socle();
g.importerProspects_();
r = g.enregistrerAppels_({ appels: [
  { id: ID_GOLFE, resultat: 'gagne', note: '', t: T0 },
  { id: 'prospect-inexistant', resultat: 'nrp', note: '', t: T0 },
  { id: ID_GOLFE, resultat: 'msg', note: '', t: T1 }
] }, COM);
T('un résultat inventé est refusé', r.refuses.indexOf(ID_GOLFE) >= 0, r.refuses);
T('un prospect inconnu aussi', r.refuses.indexOf('prospect-inexistant') >= 0, r.refuses);
T('mais le résultat valable du même lot passe', r.recus === 1, r);
T('et c\'est bien lui qui est posé', String(parId(ID_GOLFE)[cp('STATUT')]) === 'msg',
  parId(ID_GOLFE)[cp('STATUT')]);
T('une seule ligne au journal des appels', lire('APPELS').length === 2, lire('APPELS').length);

/* Deux appels dans le même lot, deux prospects : les deux lignes bougent. */
g = socle();
g.importerProspects_();
const ID_DECO = g.cleProspect_('AURAY', 'DECO BRETONNE');
r = g.enregistrerAppels_({ appels: [
  { id: ID_GOLFE, resultat: 'interesse', note: 'à relancer', t: T0 },
  { id: ID_DECO, resultat: 'rdv', note: '', t: T1 }
] }, COM);
T('un lot de deux passe en une fois', r.recus === 2, r);
T('le premier prospect est à jour', String(parId(ID_GOLFE)[cp('STATUT')]) === 'interesse',
  parId(ID_GOLFE)[cp('STATUT')]);
T('le second aussi', String(parId(ID_DECO)[cp('STATUT')]) === 'rdv', parId(ID_DECO)[cp('STATUT')]);
T('et les autres prospects n\'ont pas bougé',
  lire('PROSPECTS').slice(1).filter(x => String(x[cp('STATUT')])).length === 2,
  lire('PROSPECTS').slice(1).map(x => x[cp('STATUT')]));

/* ---------- 7. la cloison des droits ---------- */
g = socle();
g.importerProspects_();
let x = rep(g, { action: 'prospects', nom: 'SIMON LG', code: 'ab1!' });
T('un commercial peut demander ses prospects', x.ok === true && x.prospects.length === 4, x.ok);
x = rep(g, { action: 'prospects', nom: 'MAXIME T', code: 'kw7!' });
T('un prestataire ne le peut pas', x.ok === false && /autorisée/.test(String(x.erreur)), x);
x = rep(g, { action: 'appel', nom: 'MAXIME T', code: 'kw7!',
             appels: [{ id: ID_GOLFE, resultat: 'refus', note: '', t: T0 }] });
T('et il ne peut pas noter d\'appel', x.ok === false, x);
T('rien n\'a été écrit malgré tout', !String(parId(ID_GOLFE)[cp('STATUT')]),
  parId(ID_GOLFE)[cp('STATUT')]);
T('le refus est tracé', lire('JOURNAL').some(y => String(y[3]) === 'ACTION REFUSEE'),
  lire('JOURNAL').map(y => y[3]));
x = rep(g, { action: 'appel', nom: 'SIMON LG', code: 'xx9!',
             appels: [{ id: ID_GOLFE, resultat: 'refus', note: '', t: T0 }] });
T('un mauvais code ne passe pas non plus', x.ok === false && x.refus === true, x);

/* ---------- 8. le report dans le fichier de prospection ---------- */
g = socle();
g.importerProspects_();
g.enregistrerAppels_({ appels: [
  { id: ID_GOLFE, resultat: 'rdv', note: '', t: T0 },
  { id: ID_DECO, resultat: 'refus', note: '', t: T1 }
] }, COM);
r = g.reporterStatuts_();
T('les deux statuts sont reportés', r.ecrits === 2, r);
let v = lireExt('VANNES');
T('et en toutes lettres, pas en code', String(v[3][6]) === 'RDV pris', v[3][6]);
T('le reste de la ligne n\'a pas bougé',
  String(v[3][0]) === 'PEINTURE DU GOLFE' && String(v[3][2]) === '02 97 11 22 33', v[3]);
T('un prospect jamais appelé reste vide', String(v[5][6] || '') === '', v[5][6]);
T('l\'autre commune est servie aussi', String(lireExt('AURAY')[3][6]) === 'Pas intéressé',
  lireExt('AURAY')[3][6]);
T('le report est noté au journal',
  lire('JOURNAL').some(y => String(y[3]) === 'STATUTS REPORTES'), lire('JOURNAL').map(y => y[3]));
r = g.reporterStatuts_();
T('reporter deux fois n\'écrit rien de plus', r.ecrits === 0, r);

/* Un onglet sans colonne STATUT est laissé intact, et on le dit. */
g = socle();
videExt(); idExterne(ID_SRC);
creerExt('VANNES', [['x'], [''],
  ['NOM DE LA SOCIETE', 'TEL'],
  ['PEINTURE DU GOLFE', '02 97 11 22 33']]);
g.importerProspects_();
g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'rdv', note: '', t: T0 }] }, COM);
r = g.reporterStatuts_();
T('une commune sans colonne STATUT est signalée', r.sansColonne === 1, r);
T('et rien n\'y est écrit', lireExt('VANNES')[3].length === 2, lireExt('VANNES')[3]);

console.log('\n=== LA PROSPECTION TÉLÉPHONIQUE, CÔTÉ CLASSEUR (v56) : ' +
            ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
