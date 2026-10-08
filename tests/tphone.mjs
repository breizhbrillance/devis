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
const EN_P = ['ID','SIREN','COMMUNE','ZONE','SOCIETE','SECTEUR','ACTIVITE','DIRIGEANT',
  'TEL','MAIL','SITE','ADRESSE','EFFECTIF','PRIORITE',
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
    ['prospection_onglet','',''],
    ['prospection_entete_ligne','3',''],
    ['prospection_avec_tel','NON',''],
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
/* Indexation sûre : un essai qui plante ne dit rien, c'est celui qui porte la
   règle qui doit rougir. */
const V = (r, n) => (r || [])[cp(n)];

let lg, lr;

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
T('les quatre lignes des deux communes sont lues', r.lus === 4, r);
T('quatre prospects sont rangés', r.lignes === 4, r.lignes);
T('dont un sans numéro', r.sansTel === 1, r.sansTel);
T('et tous sont neufs la première fois', r.nouveaux === 4 && r.gardes === 0, r);
let p = parId(g.cleProspect_('VANNES', 'PEINTURE DU GOLFE'));
T('la société est recopiée', p && String(V(p,'SOCIETE')) === 'PEINTURE DU GOLFE', p && V(p,'SOCIETE'));
T('la commune vient du nom de l\'onglet', p && String(V(p,'COMMUNE')) === 'VANNES', p && V(p,'COMMUNE'));
T('le dirigeant aussi', p && String(V(p,'DIRIGEANT')) === 'Yann Le Roy', p && V(p,'DIRIGEANT'));
T('les horaires du lundi sont là',
  p && /08:00-12:00/.test(String(V(p,'LUN'))), p && V(p,'LUN'));
T('le samedi fermé est gardé tel quel', p && String(V(p,'SAM')) === 'Fermé', p && V(p,'SAM'));
T('le commentaire suit', p && /Devanture/.test(String(V(p,'COMMENTAIRE'))), p && V(p,'COMMENTAIRE'));
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
T('le nouveau numéro remplace l\'ancien', p && String(V(p,'TEL')) === '02 97 99 88 77', p && V(p,'TEL'));
T('le statut posé par le commercial est conservé', p && String(V(p,'STATUT')) === 'rdv', p && V(p,'STATUT'));
T('sa note aussi', p && /RDV mardi/.test(String(V(p,'NOTE'))), p && V(p,'NOTE'));
T('et le compte des appels', p && Number(V(p,'NB_APPELS')) === 3, p && V(p,'NB_APPELS'));

/* Deux fois le même nom dans la même commune : une seule ligne, sinon le
   commercial appellerait deux fois la même entreprise. */
g = socle();
videExt(); idExterne(ID_SRC);
creerExt('VANNES', communeSrc([
  ['PEINTURE DU GOLFE','Yann','02 97 11 22 33','premier@golfe.fr','','','','','','','','','','','',''],
  ['PEINTURE DU GOLFE','Yann','02 97 11 22 33','y@golfe.fr','1 rue','','','','','','','','','','','']
]));
r = g.importerProspects_();
T('un nom en double dans la commune ne fait qu\'une ligne', r.lignes === 1, r.lignes);
p = parId(g.cleProspect_('VANNES', 'PEINTURE DU GOLFE'));
T('la seconde ligne comble ce qui manquait à la première',
  String(V(p,'ADRESSE')) === '1 rue', V(p,'ADRESSE'));
T('sans écraser ce que la première portait déjà',
  String(V(p,'MAIL')) === 'premier@golfe.fr', V(p,'MAIL'));

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
T('le statut est posé sur le prospect', String(V(p,'STATUT')) === 'nrp', V(p,'STATUT'));
T('la note aussi', String(V(p,'NOTE')) === 'personne', V(p,'NOTE'));
T('le compteur d\'appels passe à 1', Number(V(p,'NB_APPELS')) === 1, V(p,'NB_APPELS'));
T('et le nom de celui qui a appelé est gardé',
  String(V(p,'COMMERCIAL')) === 'SIMON LG', V(p,'COMMERCIAL'));
T('une ligne est ajoutée au journal des appels', lire('APPELS').length === 2, lire('APPELS').length);
T('elle porte le résultat', String(lire('APPELS')[1][ca('RESULTAT')]) === 'nrp', lire('APPELS')[1]);
T('et la société, pour se relire sans croiser deux onglets',
  String(lire('APPELS')[1][ca('SOCIETE')]) === 'PEINTURE DU GOLFE', lire('APPELS')[1][ca('SOCIETE')]);

/* Un rappel porte sa date ; les autres résultats n'en portent pas. */
const T1 = '2026-10-08T10:00:00.000Z', RAP = '2026-10-09T08:00:00.000Z';
g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'rappel', note: '', t: T1, rappel: RAP }] }, COM);
p = parId(ID_GOLFE);
T('un rappel enregistre sa date', V(p,'RAPPEL_LE') instanceof Date &&
  V(p,'RAPPEL_LE').toISOString() === RAP, String(V(p,'RAPPEL_LE')));
T('le compteur monte à 2', Number(V(p,'NB_APPELS')) === 2, V(p,'NB_APPELS'));
g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'refus', note: '', t: '2026-10-08T11:00:00.000Z' }] }, COM);
p = parId(ID_GOLFE);
T('un refus efface la date de rappel qui traînait', !V(p,'RAPPEL_LE'), String(V(p,'RAPPEL_LE')));
/* Le téléphone peut très bien envoyer une date de rappel avec un autre
   résultat : il garde la dernière saisie en mémoire. Seul « rappel » doit la
   retenir, sinon le prospect reviendrait dans la file alors qu'il a dit non. */
g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'refus', note: '',
                                  t: '2026-10-08T12:00:00.000Z', rappel: RAP }] }, COM);
p = parId(ID_GOLFE);
T('et une date de rappel envoyée avec un refus est ignorée',
  !V(p,'RAPPEL_LE'), String(V(p,'RAPPEL_LE')));
T('le journal des appels garde les quatre tentatives', lire('APPELS').length === 5, lire('APPELS').length);

/* Un lot renvoyé après une coupure ne compte pas deux fois. */
g = socle();
g.importerProspects_();
g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'nrp', note: '', t: T0 }] }, COM);
r = g.enregistrerAppels_({ appels: [{ id: ID_GOLFE, resultat: 'nrp', note: '', t: T0 }] }, COM);
T('le même résultat renvoyé est reconnu', r.recus === 1, r);
T('et n\'ajoute pas de ligne au journal des appels', lire('APPELS').length === 2, lire('APPELS').length);
T('ni ne compte un appel de plus', Number(V(parId(ID_GOLFE),'NB_APPELS')) === 1,
  V(parId(ID_GOLFE),'NB_APPELS'));

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
T('et c\'est bien lui qui est posé', String(V(parId(ID_GOLFE),'STATUT')) === 'msg',
  V(parId(ID_GOLFE),'STATUT'));
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
T('le premier prospect est à jour', String(V(parId(ID_GOLFE),'STATUT')) === 'interesse',
  V(parId(ID_GOLFE),'STATUT'));
T('le second aussi', String(V(parId(ID_DECO),'STATUT')) === 'rdv', V(parId(ID_DECO),'STATUT'));
T('et les autres prospects n\'ont pas bougé',
  lire('PROSPECTS').slice(1).filter(x => String(V(x,'STATUT'))).length === 2,
  lire('PROSPECTS').slice(1).map(x => V(x,'STATUT')));

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
T('rien n\'a été écrit malgré tout', !String(V(parId(ID_GOLFE),'STATUT')),
  V(parId(ID_GOLFE),'STATUT'));
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


/* ---------- 9. LA BASE GLOBALE : un seul onglet, une colonne VILLE ----------
   « BASE PROSPECTS BB » ne range pas les prospects par onglet : tout est dans
   un onglet BASE, chaque ligne portant sa commune, son secteur, sa priorité,
   son SIREN et déjà des colonnes de suivi. C'est la forme que Simon veut
   appeler ; celle du tableau peinture reste acceptée. */
function baseGlobale(lignes) {
  return [['BASE PROSPECTS BB - V3'], [''],
          ['NOM DE LA SOCIETE','SECTEUR','ACTIVITÉ','VILLE','ZONE','ADRESSE POSTALE',
           'NOM DIRIGEANT(s)','TEL','MAIL','SITE WEB','EFFECTIF','PRIORITÉ','STATUT',
           'COMMERCIAL','DERNIER CONTACT','NB APPELS','DATE DE RELANCE',
           'COMMENTAIRE / HISTORIQUE','NE PLUS CONTACTER','TYPE','SIREN','SOURCE',
           'NB À LA MÊME ADRESSE']].concat(lignes);
}
function socleBase(reglagesSup) {
  const g = socle(([['prospection_onglet','BASE',''],
                    ['prospection_avec_tel','OUI','']]).concat(reglagesSup || []));
  videExt(); idExterne(ID_SRC);
  creerExt('SOMMAIRE', [['ne pas lire']]);
  creerExt('BASE', baseGlobale([
    ['CABINET COLIN','Experts-comptables','Expertise comptable','VANNES','VANNES AGGLO',
     '36 BD DE LA RESISTANCE','GILLES LE SQUER','02 97 26 73 00','','cabinet-colin.fr','50-99','10',
     '','','','','','Société · Siège','','Société','876680166','Annuaire','11'],
    ['DOCTEUR MARTIN','Médecins / maisons de santé','Médecine générale','VANNES','VANNES AGGLO',
     '2 RUE DU PORT','JEAN MARTIN','02 97 11 22 33 / 06 12 34 56 78','m@test.fr','','3-5','4',
     '','','','','','','','Société','123456789','Annuaire','1'],
    ['SALON CIseaux','Coiffure / beauté','Coiffure','AURAY','AURAY QUIBERON',
     '5 PLACE','MARIE DANIC','02 97 44 55 66','','','1-2','3',
     '','','','','','','','Société','234567891','Annuaire','1'],
    ['GARAGE SANS TEL','Automobile','Réparation','AURAY','AURAY QUIBERON',
     '9 ROUTE','','','','','6-9','5','','','','','','','','Société','345678912','Annuaire','1'],
    ['CLIENT FACHE','Avocats / notaires / huissiers','Avocat','VANNES','VANNES AGGLO',
     '1 RUE','','02 97 99 00 11','','','3-5','6','','','','','','','OUI','Société','456789123','Annuaire','1'],
    ['DEJA VU SARL','Paramédical','Kiné','VANNES','VANNES AGGLO',
     '7 AVENUE','PAUL GUEN','02 97 77 88 99','p@kine.fr','','1-2','2',
     'RDV pris','SIMON LG','2026-10-01','2','','note a la main','','Société','567891234','Annuaire','1']
  ]));
  return g;
}

g = socleBase();
r = g.importerProspects_();
T('seul l\'onglet BASE est lu', r.lus === 6, r);
T('les appelables sont retenus', r.lignes === 4, r);
T('celui qui n\'a pas de numéro est écarté', r.sansTel === 1, r.sansTel);
T('et celui marqué « ne plus contacter » aussi', r.nePlus === 1, r.nePlus);
T('aucune trace du « ne plus contacter » dans PROSPECTS',
  !lire('PROSPECTS').some(x => /FACHE/.test(String(V(x,'SOCIETE')))),
  lire('PROSPECTS').map(x => V(x,'SOCIETE')));

p = parId('s876680166');
T('la clé est le SIREN quand il existe', !!p, lire('PROSPECTS').map(x => x[0]));
T('la commune vient de la colonne VILLE, pas du nom de l\'onglet',
  p && String(V(p,'COMMUNE')) === 'VANNES', p && V(p,'COMMUNE'));
T('la zone est gardée', p && String(V(p,'ZONE')) === 'VANNES AGGLO', p && V(p,'ZONE'));
T('le secteur aussi', p && String(V(p,'SECTEUR')) === 'Experts-comptables', p && V(p,'SECTEUR'));
T('et l\'activité', p && String(V(p,'ACTIVITE')) === 'Expertise comptable', p && V(p,'ACTIVITE'));
T('la priorité est un nombre', p && Number(V(p,'PRIORITE')) === 10, p && V(p,'PRIORITE'));
T('le site est repris', p && String(V(p,'SITE')) === 'cabinet-colin.fr', p && V(p,'SITE'));
T('le SIREN est gardé en clair', p && String(V(p,'SIREN')) === '876680166', p && V(p,'SIREN'));

/* Un suivi déjà noté à la main dans la base est repris à la découverte. */
p = parId('s567891234');
T('un statut écrit en toutes lettres est compris', p && String(V(p,'STATUT')) === 'rdv', p && V(p,'STATUT'));
T('avec le commercial qui l\'a posé', p && String(V(p,'COMMERCIAL')) === 'SIMON LG', p && V(p,'COMMERCIAL'));
T('et le nombre d\'appels', p && Number(V(p,'NB_APPELS')) === 2, p && V(p,'NB_APPELS'));

/* Deux numéros séparés par « / » dans la base : deux boutons au téléphone. */
r = g.listeProspects_({});
q = r.prospects.find(x => x.nom === 'DOCTEUR MARTIN');
T('les deux numéros du médecin partent au téléphone', q && q.tels.length === 2, q && q.tels);
T('la priorité part avec', q && q.prio === 4, q && q.prio);
T('le secteur aussi', q && q.secteur === 'Médecins / maisons de santé', q && q.secteur);

/* Une fois le phoning commencé, c'est PROSPECTS qui fait foi. */
g.enregistrerAppels_({ appels: [{ id: 's567891234', resultat: 'refus', note: 'non merci',
                                  t: '2026-10-08T09:00:00.000Z' }] }, COM);
r = g.importerProspects_();
p = parId('s567891234');
T('un réimport ne remet pas le vieux statut de la base',
  String(V(p,'STATUT')) === 'refus', V(p,'STATUT'));
T('et compte la ligne comme déjà connue', r.gardes === 4 && r.nouveaux === 0, r);

/* Un prospect retiré de la base ne disparaît pas : il peut avoir un RDV. */
videExt(); idExterne(ID_SRC);
creerExt('BASE', baseGlobale([
  ['CABINET COLIN','Experts-comptables','Expertise comptable','VANNES','VANNES AGGLO',
   '36 BD DE LA RESISTANCE','GILLES LE SQUER','02 97 26 73 00','','','50-99','10',
   '','','','','','','','Société','876680166','Annuaire','11']
]));
r = g.importerProspects_();
T('un prospect retiré de la base reste dans PROSPECTS', r.disparus === 3, r);
T('avec son historique', String(V(parId('s567891234'),'STATUT')) === 'refus',
  V(parId('s567891234'),'STATUT'));

/* ---------- 10. le report des cinq colonnes de suivi ---------- */
g = socleBase();
g.importerProspects_();
g.enregistrerAppels_({ appels: [
  { id: 's876680166', resultat: 'rdv', note: 'mardi 10 h', t: '2026-10-08T09:00:00.000Z' },
  { id: 's234567891', resultat: 'rappel', note: '', t: '2026-10-08T09:30:00.000Z',
    rappel: '2026-10-10T08:00:00.000Z' }
] }, COM);
r = g.reporterStatuts_();
/* Trois et non deux : le prospect dont la base portait déjà « RDV pris » est
   reporté lui aussi, sa date de contact passant du texte à une vraie date. */
T('les prospects qui portent un suivi sont reportés', r.ecrits === 3, r);
v = lireExt('BASE');
lg = v.findIndex(x => String(x[0]) === 'CABINET COLIN');
T('le statut est écrit en toutes lettres', String(v[lg][12]) === 'RDV pris', v[lg][12]);
T('le commercial aussi', String(v[lg][13]) === 'SIMON LG', v[lg][13]);
T('la date du dernier contact est une vraie date', v[lg][14] instanceof Date, String(v[lg][14]));
T('le nombre d\'appels est reporté', Number(v[lg][15]) === 1, v[lg][15]);
T('et le commentaire écrit à la main n\'est pas touché',
  String(v[lg][17]) === 'Société · Siège', v[lg][17]);
lr = v.findIndex(x => String(x[0]) === 'SALON CIseaux');
T('la date de relance d\'un rappel est reportée', v[lr][16] instanceof Date, String(v[lr][16]));
T('alors que le RDV n\'en a pas', !v[lg][16], String(v[lg][16]));
T('le report nomme les colonnes qu\'il a touchées',
  r.colonnes.indexOf('STATUT') >= 0 && r.colonnes.indexOf('NB APPELS') >= 0, r.colonnes);
r = g.reporterStatuts_();
T('reporter deux fois de suite n\'écrit rien de plus', r.ecrits === 0, r);

/* Le filtre d'onglet protège le reste du fichier. */
g = socleBase();
creerExt('AUTRE', baseGlobale([
  ['CABINET COLIN','x','x','VANNES','x','x','x','02 97 26 73 00','','','','1',
   '','','','','','','','Société','876680166','Annuaire','1']
]));
r = g.importerProspects_();
T('un second onglet n\'est pas lu quand prospection_onglet le nomme', r.lus === 6, r);

/* Sans filtre d'onglet, les deux formes cohabitent dans le même fichier. */
g = socle([['prospection_onglet','',''],['prospection_avec_tel','OUI','']]);
videExt(); idExterne(ID_SRC);
creerExt('BASE', baseGlobale([
  ['CABINET COLIN','Experts-comptables','Expertise comptable','VANNES','VANNES AGGLO',
   '36 BD','GILLES LE SQUER','02 97 26 73 00','','','50-99','10',
   '','','','','','','','Société','876680166','Annuaire','11']
]));
creerExt('PLOERMEL', communeSrc([
  ['PEINTURE DU LAC','Yves Le Gall','02 97 55 44 33','','1 rue','2','','','','','','','','','','']
]));
r = g.importerProspects_();
T('les deux formes de fichier cohabitent', r.lignes === 2, r);
T('celui de la base garde sa commune de colonne',
  !!parId('s876680166') && String(V(parId('s876680166'),'COMMUNE')) === 'VANNES',
  parId('s876680166') && V(parId('s876680166'),'COMMUNE'));
T('et celui de l\'onglet par commune prend le nom de l\'onglet',
  lire('PROSPECTS').some(x => String(V(x,'COMMUNE')) === 'PLOERMEL'),
  lire('PROSPECTS').map(x => V(x,'COMMUNE')));

console.log('\n=== LA PROSPECTION TÉLÉPHONIQUE, CÔTÉ CLASSEUR (v57) : ' +
            ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
