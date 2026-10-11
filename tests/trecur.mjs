/* Les contrats récurrents (v65) — onglet RECURRENTS et génération du planning.

   Un chantier naît normalement d'un devis signé. Ceux-là viennent d'un
   engagement pris ailleurs : le client qu'on nettoie tous les jeudis depuis
   des années. L'onglet décrit la série, le classeur pose les chantiers des
   semaines qui viennent.

   Ce que ces essais gardent :
   — les trois rythmes : toutes les semaines, une semaine sur deux, le n du
     mois — et le 31 qui tombe le 30 dans un mois de trente jours ;
   — la quinzaine comptée depuis le début de la série, pas depuis aujourd'hui :
     sans ancrage, la semaine paire change de sens à chaque génération ;
   — l'horizon, et rien au-delà ;
   — l'idempotence : deux passages de suite ne posent pas deux fois le même
     passage, et une date déplacée à la main n'est jamais reprise ;
   — une série arrêtée annule ses passages à venir, mais pas ceux qui sont
     passés ni celui que le salarié a déjà commencé ;
   — le chantier arrive bien sur le téléphone du salarié, avec sa fiche de
     travail, alors qu'aucun devis ne le porte.

   L'horloge est figée : une suite qui dépend du jour où on la lance finit
   toujours par rougir une nuit. */
import { creer, lire, charger, horloge, sansInterface } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };

/* Lundi 12 octobre 2026, 7 h du matin. */
horloge(new Date(2026, 9, 12, 7, 0, 0));
sansInterface(true);

const jour = (a, m, j) => new Date(a, m - 1, j, 0, 0, 0, 0);
const iso = (d) => {
  const x = new Date(d);
  return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2);
};

const EN_R = ['ID', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'FREQUENCE', 'JOUR',
  'JOUR_MOIS', 'HEURE', 'DUREE_MIN', 'PRESTATAIRE', 'DEBUT', 'FIN', 'ACTIF',
  'PRESTATIONS', 'NOTE'];
const R = (o) => EN_R.map(h => o[h] !== undefined ? o[h] : '');

const EN_C = ['ID', 'NUMERO', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'DATE', 'HEURE',
  'PRESTATAIRE', 'STATUT', 'ARRIVEE', 'DEPART', 'MINUTES', 'PRESTATIONS_FAITES',
  'SIGNALEMENT', 'PHOTOS', 'NOTE', 'CREE_LE', 'DUREE_PREVUE_MIN', 'LOT', 'RECURRENT'];
const C = (o) => EN_C.map(h => o[h] !== undefined ? o[h] : '');

function poser(series, chantiers) {
  creer('RECURRENTS', [EN_R].concat(series.map(R)));
  creer('CHANTIERS', [EN_C].concat((chantiers || []).map(C)));
  creer('DEVIS', [['NUMERO', 'DATE', 'COMMERCIAL', 'CLIENT', 'TOTAL_HT', 'STATUT', 'SIGNE']]);
  creer('LIGNES', [['NUMERO', 'ORDRE', 'CATEGORIE', 'REFERENCE', 'DESIGNATION', 'DETAIL',
    'QTE', 'UNITE', 'PU_HT', 'REMISE_PCT', 'TYPE', 'TVA', 'TOTAL_HT']]);
  creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['societe_nom', 'BREIZH BRILLANCE', '']]);
  creer('JOURNAL', [['HORODATAGE', 'MOMENT', 'COMMERCIAL', 'ACTION', 'DETAIL', 'NUMERO',
    'APPAREIL', 'SOURCE']]);
  creer('PRESTATAIRES', [['NOM', 'EMAIL', 'CODE', 'ACTIF', 'TELEPHONE'],
    ['MAXIME', 'm@bb.fr', 'kw7!', 'OUI', '0600000001']]);
  creer('ADMINS', [['NOM', 'EMAIL', 'CODE', 'ACTIF'], ['SIMON DIRECTION', 'd@bb.fr', 'qx4$', 'OUI']]);
  creer('COMMERCIAUX', [['NOM', 'EMAIL', 'CODE', 'ACTIF'], ['SIMON LG', 's@bb.fr', 'ab1!', 'OUI']]);
  creer('CATALOGUE', [['CATEGORIE', 'DESIGNATION', 'DETAIL', 'UNITE', 'PU_HT', 'TVA', 'TYPE',
    'ACTIF', 'REFERENCE']]);
  creer('ABSENCES', [['PRESTATAIRE', 'DU', 'AU']]);
  return charger(CODE_GS);
}

/* Les lignes de CHANTIERS posées par la génération, en objets. */
const poses = () => lire('CHANTIERS').slice(1).map(l => {
  const o = {}; EN_C.forEach((h, i) => { o[h] = l[i]; }); return o;
}).filter(o => String(o.RECURRENT || '').trim());

const HEBDO_JEUDI = {
  ID: 'R-001', CLIENT: 'LOCAUX QUAI OUEST', ADRESSE: '5 Rue Joseph Le Brix',
  CP: '56000', VILLE: 'Vannes', ACCES: 'Clé sous le pot',
  FREQUENCE: 'HEBDO', JOUR: 'JEUDI', HEURE: '11:30', DUREE_MIN: 60,
  PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 8, 27), ACTIF: 'OUI',
  PRESTATIONS: 'Sols, sanitaires, poubelles'
};

/* ---------- 1. toutes les semaines ---------- */
let g = poser([HEBDO_JEUDI]);
let b = g.genererRecurrents_();
let p = poses();
T('la série est lue', b.series === 1, b);
T('huit semaines d\'avance donnent huit passages', b.poses === 8 && p.length === 8, b);
T('tous un jeudi', p.every(x => new Date(x.DATE).getDay() === 4), p.map(x => iso(x.DATE)));
T('le premier est le jeudi qui vient', iso(p[0].DATE) === '2026-10-15', iso(p[0].DATE));
T('le dernier tient dans l\'horizon', iso(p[7].DATE) === '2026-12-03', iso(p[7].DATE));
/* En jours entiers, pas en millisecondes : la dernière nuit d'octobre dure
   vingt-cinq heures et une soustraction brute tomberait à côté. */
const ecart = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
T('espacés de sept jours',
  p.every((x, i) => i === 0 || ecart(x.DATE, p[i - 1].DATE) === 7),
  p.map(x => iso(x.DATE)));
T('et le changement d\'heure ne décale pas le jour',
  p.map(x => iso(x.DATE)).indexOf('2026-10-29') >= 0, p.map(x => iso(x.DATE)));

/* ---------- 2. ce que porte le chantier ---------- */
const un = p[0];
T('le client est repris', un.CLIENT === 'LOCAUX QUAI OUEST', un.CLIENT);
T('l\'adresse aussi', un.ADRESSE === '5 Rue Joseph Le Brix' && un.VILLE === 'Vannes', un);
T('l\'accès suit — le salarié doit pouvoir entrer', un.ACCES === 'Clé sous le pot', un.ACCES);
T('l\'heure est posée', String(un.HEURE) === '11:30', un.HEURE);
T('la durée prévue aussi', Number(un.DUREE_PREVUE_MIN) === 60, un.DUREE_PREVUE_MIN);
T('le salarié est affecté', un.PRESTATAIRE === 'MAXIME', un.PRESTATAIRE);
T('le chantier est donc planifié, pas à planifier', un.STATUT === 'PLANIFIE', un.STATUT);
T('aucun devis derrière', String(un.NUMERO) === '', un.NUMERO);
T('la fiche de travail vient de la série',
  un.NOTE === 'Sols, sanitaires, poubelles', un.NOTE);
T('la clé dit de quelle occurrence il vient',
  un.RECURRENT === 'R-001|2026-10-15', un.RECURRENT);
T('les identifiants se suivent', un.ID === 'CH-0001' && p[1].ID === 'CH-0002',
  [un.ID, p[1].ID]);

/* ---------- 3. deux passages ne doublent pas ---------- */
b = g.genererRecurrents_();
T('une seconde génération n\'ajoute rien', b.poses === 0, b);
T('et le planning n\'a pas grossi', poses().length === 8, poses().length);

/* ---------- 4. une date déplacée à la main n'est pas reprise ---------- */
const d = lire('CHANTIERS');
d[1][EN_C.indexOf('DATE')] = jour(2026, 10, 16);          // le gérant décale au vendredi
d[1][EN_C.indexOf('PRESTATAIRE')] = 'SIMON';
b = g.genererRecurrents_();
T('un passage déplacé ne revient pas à sa date d\'origine', b.poses === 0, b);
T('le déplacement tient', iso(lire('CHANTIERS')[1][EN_C.indexOf('DATE')]) === '2026-10-16',
  iso(lire('CHANTIERS')[1][EN_C.indexOf('DATE')]));
T('le salarié changé à la main le reste',
  lire('CHANTIERS')[1][EN_C.indexOf('PRESTATAIRE')] === 'SIMON',
  lire('CHANTIERS')[1][EN_C.indexOf('PRESTATAIRE')]);

/* ---------- 5. une semaine sur deux, ancrée sur le début ---------- */
g = poser([{
  ID: 'R-002', CLIENT: 'LOCAUX ETANCHEITE MORBIHANAISE', VILLE: 'Saint-Avé',
  FREQUENCE: 'QUINZAINE', JOUR: 'SAMEDI', HEURE: '09:00', DUREE_MIN: 30,
  /* Début un samedi dont la parité ne tombe PAS sur le premier samedi qui
     suit aujourd'hui : sans ancrage sur le début, la génération poserait le
     17 au lieu du 24, et le client serait nettoyé la mauvaise semaine. */
  PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 9, 26), ACTIF: 'OUI'
}]);
g.genererRecurrents_();
p = poses();
T('une semaine sur deux donne moitié moins de passages', p.length === 4, p.map(x => iso(x.DATE)));
T('tous un samedi', p.every(x => new Date(x.DATE).getDay() === 6), p.map(x => iso(x.DATE)));
T('espacés de quatorze jours',
  p.every((x, i) => i === 0 || ecart(x.DATE, p[i - 1].DATE) === 14),
  p.map(x => iso(x.DATE)));
T('la parité suit le début de la série, pas la date du jour',
  iso(p[0].DATE) === '2026-10-24', iso(p[0].DATE));
T('la durée d\'une demi-heure est gardée', Number(p[0].DUREE_PREVUE_MIN) === 30, p[0].DUREE_PREVUE_MIN);

/* ---------- 6. le n du mois ---------- */
g = poser([{
  ID: 'R-003', CLIENT: 'VITRAGES MME BENJAMIN', VILLE: 'Elven',
  FREQUENCE: 'MENSUEL', JOUR_MOIS: 6, HEURE: '09:00', DUREE_MIN: 120,
  PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 5, 6), ACTIF: 'OUI'
}]);
g.genererRecurrents_();
p = poses();
T('un passage par mois sur l\'horizon', p.length === 2, p.map(x => iso(x.DATE)));
T('le 6 de chaque mois',
  p.map(x => iso(x.DATE)).join(' ') === '2026-11-06 2026-12-06', p.map(x => iso(x.DATE)));

/* Le 31 dans un mois qui ne l'a pas : le passage ne saute pas, il tombe le
   dernier jour. Février et mars se suivent dans l'horizon de huit semaines. */
horloge(new Date(2026, 1, 1, 7, 0, 0));                   // 1er février 2026
g = poser([{
  ID: 'R-004', CLIENT: 'FIN DE MOIS', FREQUENCE: 'MENSUEL', JOUR_MOIS: 31,
  HEURE: '08:00', DUREE_MIN: 60, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 1, 1), ACTIF: 'OUI'
}]);
g.genererRecurrents_();
p = poses();
T('« le 31 » tombe le 28 en février', p.map(x => iso(x.DATE)).join(' ') === '2026-02-28',
  p.map(x => iso(x.DATE)));

horloge(new Date(2026, 2, 1, 7, 0, 0));                   // 1er mars 2026
g = poser([{
  ID: 'R-004', CLIENT: 'FIN DE MOIS', FREQUENCE: 'MENSUEL', JOUR_MOIS: 31,
  HEURE: '08:00', DUREE_MIN: 60, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 1, 1), ACTIF: 'OUI'
}]);
/* Huit semaines n'attrapent qu'un seul passage mensuel : on allonge pour voir
   deux fins de mois de suite. */
lire('REGLAGES').push(['recurrents_semaines', '12', '']);
g.genererRecurrents_();
p = poses();
T('il tombe le 31 en mars et le 30 en avril',
  p.map(x => iso(x.DATE)).join(' ') === '2026-03-31 2026-04-30', p.map(x => iso(x.DATE)));
horloge(new Date(2026, 9, 12, 7, 0, 0));

/* ---------- 7. début à venir, fin passée ---------- */
g = poser([
  { ID: 'R-005', CLIENT: 'PAS ENCORE', FREQUENCE: 'HEBDO', JOUR: 'MARDI', HEURE: '08:00',
    DUREE_MIN: 60, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 11, 10), ACTIF: 'OUI' },
  { ID: 'R-006', CLIENT: 'TERMINE', FREQUENCE: 'HEBDO', JOUR: 'VENDREDI', HEURE: '17:30',
    DUREE_MIN: 90, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 5, 8), FIN: jour(2026, 8, 21),
    ACTIF: 'OUI' }
]);
g.genererRecurrents_();
p = poses();
T('une série qui n\'a pas commencé ne pose rien avant son début',
  p.filter(x => x.CLIENT === 'PAS ENCORE').every(x => new Date(x.DATE) >= jour(2026, 11, 10)),
  p.filter(x => x.CLIENT === 'PAS ENCORE').map(x => iso(x.DATE)));
T('et elle en pose après', p.some(x => x.CLIENT === 'PAS ENCORE'), p.map(x => x.CLIENT));
T('une série terminée ne pose plus rien',
  !p.some(x => x.CLIENT === 'TERMINE'), p.map(x => x.CLIENT));

/* ---------- 8. sans salarié, le chantier remonte à planifier ---------- */
g = poser([{
  ID: 'R-007', CLIENT: 'SANS PERSONNE', FREQUENCE: 'HEBDO', JOUR: 'LUNDI', HEURE: '08:00',
  DUREE_MIN: 60, DEBUT: jour(2026, 9, 1), ACTIF: 'OUI'
}]);
g.genererRecurrents_();
p = poses();
T('sans salarié, le passage reste à planifier',
  p.length > 0 && p.every(x => x.STATUT === 'A PLANIFIER'), p.map(x => x.STATUT));

/* ---------- 9. une série arrêtée fait le ménage ---------- */
g = poser([{
  ID: 'R-008', CLIENT: 'OKALYS', FREQUENCE: 'HEBDO', JOUR: 'VENDREDI', HEURE: '17:30',
  DUREE_MIN: 90, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 5, 8), ACTIF: 'OUI'
}], [
  { ID: 'CH-9001', CLIENT: 'OKALYS', DATE: jour(2026, 10, 2), HEURE: '17:30',
    PRESTATAIRE: 'MAXIME', STATUT: 'FAIT', RECURRENT: 'R-008|2026-10-02' },
  { ID: 'CH-9002', CLIENT: 'OKALYS', DATE: jour(2026, 10, 16), HEURE: '17:30',
    PRESTATAIRE: 'MAXIME', STATUT: 'EN COURS', ARRIVEE: new Date(2026, 9, 16, 17, 32),
    RECURRENT: 'R-008|2026-10-16' },
  { ID: 'CH-9003', CLIENT: 'OKALYS', DATE: jour(2026, 10, 23), HEURE: '17:30',
    PRESTATAIRE: 'MAXIME', STATUT: 'PLANIFIE', RECURRENT: 'R-008|2026-10-23' }
]);
/* La série passe à ACTIF = NON, comme le ferait le gérant. */
lire('RECURRENTS')[1][EN_R.indexOf('ACTIF')] = 'NON';
b = g.genererRecurrents_();
const parId = {};
lire('CHANTIERS').slice(1).forEach(l => { parId[l[0]] = l[EN_C.indexOf('STATUT')]; });
T('une série arrêtée ne pose plus de passage', b.poses === 0, b);
T('le passage à venir est annulé', parId['CH-9003'] === 'ANNULE', parId);
T('celui qui est déjà commencé n\'est pas touché', parId['CH-9002'] === 'EN COURS', parId);
T('et le passé reste le passé', parId['CH-9001'] === 'FAIT', parId);
T('le bilan compte l\'annulation', b.annules === 1, b);

/* ---------- 10. l'horizon est réglable ---------- */
g = poser([HEBDO_JEUDI]);
lire('REGLAGES').push(['recurrents_semaines', '2', '']);
g.genererRecurrents_();
T('deux semaines d\'horizon donnent deux passages', poses().length === 2,
  poses().map(x => iso(x.DATE)));

/* ---------- 11. le chantier arrive sur le téléphone du salarié ---------- */
g = poser([HEBDO_JEUDI]);
g.genererRecurrents_();
const pl = g.planningDe_('MAXIME');
T('le salarié voit ses passages récurrents', pl.length === 8, pl.length);
T('avec la bonne date', pl[0].date === '2026-10-15', pl[0].date);
T('avec le client', pl[0].client === 'LOCAUX QUAI OUEST', pl[0].client);
T('avec l\'accès', pl[0].acces === 'Clé sous le pot', pl[0].acces);
T('sa fiche de travail n\'est pas vide, faute de devis',
  /Sols/.test(pl[0].note), pl[0].note);
T('et aucune tâche fantôme n\'est inventée', pl[0].taches.length === 0, pl[0].taches);

/* ---------- 12. le gérant les voit aussi ---------- */
const tab = g.tableauAdmin_();
T('le tableau du gérant porte les chantiers récurrents',
  tab.chantiers.filter(c => c.client === 'LOCAUX QUAI OUEST').length >= 1,
  tab.chantiers.length);
T('sans numéro de devis',
  tab.chantiers.filter(c => c.client === 'LOCAUX QUAI OUEST').every(c => c.numero === ''),
  tab.chantiers.filter(c => c.client === 'LOCAUX QUAI OUEST').map(c => c.numero));

/* ---------- 13. une série sans identifiant est ignorée ---------- */
g = poser([{ ID: '', CLIENT: 'SANS ID', FREQUENCE: 'HEBDO', JOUR: 'LUNDI', HEURE: '08:00',
  DUREE_MIN: 60, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 9, 1), ACTIF: 'OUI' }]);
b = g.genererRecurrents_();
T('une ligne sans identifiant ne pose rien', b.poses === 0 && b.series === 0, b);

/* ---------- 14. une fréquence incomprise ne pose rien non plus ---------- */
g = poser([{ ID: 'R-009', CLIENT: 'FLOU', FREQUENCE: 'QUAND ON PEUT', JOUR: 'LUNDI',
  HEURE: '08:00', DUREE_MIN: 60, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 9, 1), ACTIF: 'OUI' }]);
b = g.genererRecurrents_();
T('une fréquence inconnue ne pose rien plutôt que n\'importe quoi', b.poses === 0, b);
T('mais la série est bien comptée comme lue', b.series === 1, b);

/* ---------- 15. un jour mal écrit ---------- */
g = poser([{ ID: 'R-010', CLIENT: 'JOUR FLOU', FREQUENCE: 'HEBDO', JOUR: 'jeu',
  HEURE: '08:00', DUREE_MIN: 60, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 9, 1), ACTIF: 'OUI' }]);
b = g.genererRecurrents_();
T('« jeu » vaut jeudi', b.poses === 8, b);
g = poser([{ ID: 'R-011', CLIENT: 'JOUR FAUX', FREQUENCE: 'HEBDO', JOUR: 'tous les jours',
  HEURE: '08:00', DUREE_MIN: 60, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 9, 1), ACTIF: 'OUI' }]);
b = g.genererRecurrents_();
T('un jour qui ne veut rien dire ne pose rien', b.poses === 0, b);

/* ---------- 16. l'heure reste une heure ---------- */
/* Le tableur range « 08:00 » comme une date du 30 décembre 1899. Recopiée
   telle quelle, elle arrivait sur l'écran du gérant sous la forme
   « Sat Dec 30 1899 08:00:00 GMT+0009 ». */
g = poser([Object.assign({}, HEBDO_JEUDI, { HEURE: new Date(1899, 11, 30, 11, 30) })]);
g.genererRecurrents_();
p = poses();
T('une heure venue d\'une cellule de temps est écrite lisiblement',
  String(p[0].HEURE) === '11:30', p[0].HEURE);
T('et l\'écran du salarié la lit telle quelle',
  g.planningDe_('MAXIME')[0].heure === '11:30', g.planningDe_('MAXIME')[0].heure);
T('celui du gérant aussi',
  g.tableauAdmin_().chantiers.filter(c => c.heure === '11:30').length === 8,
  g.tableauAdmin_().chantiers.map(c => c.heure));

/* Et une heure posée à la main dans le tableur par le gérant, qui reste une
   cellule de temps, se lit de la même façon des deux côtés. */
g = poser([], [{ ID: 'CH-7001', CLIENT: 'POSE A LA MAIN', DATE: jour(2026, 10, 20),
  HEURE: new Date(1899, 11, 30, 9, 0), PRESTATAIRE: 'MAXIME', STATUT: 'PLANIFIE' }]);
T('une heure tapée à la main dans le tableur se lit sur le téléphone',
  g.planningDe_('MAXIME')[0].heure === '09:00', g.planningDe_('MAXIME')[0].heure);
T('et sur l\'écran du gérant',
  g.tableauAdmin_().chantiers[0].heure === '09:00', g.tableauAdmin_().chantiers[0].heure);

/* ---------- 17. la nuit avance l'horizon toute seule ---------- */
/* Sans cela l'horizon se viderait semaine après semaine et le salarié
   finirait par ne plus rien voir sur son téléphone. */
g = poser([HEBDO_JEUDI]);
try { g.automateQuotidien(); } catch (e) { /* le reste de l'automate ne nous regarde pas */ }
T('le rappel quotidien pose le planning récurrent au passage',
  poses().length === 8, poses().length);

horloge(null);
console.log('\n=== LES CONTRATS RÉCURRENTS (v65) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
