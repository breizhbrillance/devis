/* Le gérant maître de son planning (v70).

   Jusqu'ici il ne pouvait que poser une date, une heure et un prestataire.
   Une adresse fausse, un chantier décommandé, un dépannage à caser : tout
   cela se réparait dans le classeur, à la main.

   Ce que ces essais gardent :
   — on annule, on n'efface pas : la ligne reste, et un passage de contrat
     récurrent annulé ne revient pas à la génération suivante ;
   — un chantier déjà pointé ne s'annule plus : son temps part en facturation ;
   — un chantier annulé se rétablit, et reprend le statut que sa date lui donne ;
   — l'identité du chantier (client, adresse, accès) se corrige, et un champ
     absent de l'envoi n'est pas touché ;
   — un chantier créé à la main ressemble en tout point aux autres, NUMERO mis
     à part, et reçoit un ID qui ne télescope personne ;
   — le lot applique le même geste à plusieurs, avec les mêmes garde-fous, et
     dit ce qui n'est pas passé ;
   — la cloison tient : ni le commercial ni le salarié n'y touchent.
*/
import { creer, lire, charger, sansInterface, horloge } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };
const j = (n) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d; };
const iso = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
                   '-' + ('0' + d.getDate()).slice(-2);

sansInterface(true);

const EN_C = ['ID', 'NUMERO', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'DATE', 'HEURE',
  'PRESTATAIRE', 'STATUT', 'ARRIVEE', 'DEPART', 'MINUTES', 'PRESTATIONS_FAITES',
  'SIGNALEMENT', 'PHOTOS', 'NOTE', 'CREE_LE', 'DUREE_PREVUE_MIN', 'LOT', 'RECURRENT',
  'NATURE'];
const C = (o) => EN_C.map(h => o[h] !== undefined ? o[h] : '');

function poser() {
  creer('COMMERCIAUX', [['NOM', 'EMAIL', 'CODE', 'ACTIF', 'INITIALES'],
    ['SIMON LG', 'simon@bb.fr', 'ab1!', 'OUI', 'SLG']]);
  creer('ADMINS', [['NOM', 'EMAIL', 'CODE', 'ACTIF'], ['SIMON H', 'h@bb.fr', 'qx4$', 'OUI']]);
  creer('PRESTATAIRES', [['NOM', 'EMAIL', 'CODE', 'ACTIF', 'TELEPHONE', 'JOURS', 'PLAGES',
    'HEURES_SEMAINE', 'PLANIFIABLE'],
    ['MAXIME', 'm@bb.fr', 'kw7!', 'OUI', '', 'LU,MA,ME,JE,VE', '08:00-17:00', 35, ''],
    ['YANN P', 'y@bb.fr', 'pz2!', 'OUI', '', 'LU,MA,ME,JE,VE', '08:00-17:00', 35, '']]);
  creer('CHANTIERS', [EN_C,
    C({ ID: 'CH-0001', CLIENT: 'LE LOCAL', ADRESSE: '14 Alle de Noyalo', CP: '56450',
        VILLE: 'Theix-Noyalo', ACCES: 'Cle sous le pot', DATE: j(3), HEURE: '08:00',
        PRESTATAIRE: 'MAXIME', STATUT: 'PLANIFIE', NOTE: 'Entretien des locaux',
        NATURE: 'ENTRETIEN', RECURRENT: 'R-001|' + iso(j(3)) }),
    C({ ID: 'CH-0002', CLIENT: 'AXA THEIX', VILLE: 'Theix', DATE: j(4), HEURE: '10:30',
        PRESTATAIRE: 'MAXIME', STATUT: 'PLANIFIE', NATURE: 'ENTRETIEN' }),
    C({ ID: 'CH-0003', CLIENT: 'DEJA COMMENCE', VILLE: 'Vannes', DATE: j(-1), HEURE: '09:00',
        PRESTATAIRE: 'YANN P', STATUT: 'EN COURS', ARRIVEE: new Date(), NATURE: 'CHANTIER' }),
    C({ ID: 'CH-0012', CLIENT: 'SANS DATE', VILLE: 'Vannes', STATUT: 'A PLANIFIER' })]);
  creer('DEVIS', [['NUMERO', 'DATE', 'COMMERCIAL', 'CLIENT', 'TOTAL_HT', 'STATUT', 'SIGNE', 'NATURE']]);
  creer('LIGNES', [['NUMERO', 'ORDRE', 'CATEGORIE', 'REFERENCE', 'DESIGNATION', 'DETAIL',
    'QTE', 'UNITE', 'PU_HT', 'REMISE_PCT', 'TYPE', 'TVA', 'TOTAL_HT']]);
  creer('CATALOGUE', [['CATEGORIE', 'DESIGNATION', 'DETAIL', 'UNITE', 'PU_HT', 'TVA', 'TYPE',
    'ACTIF', 'REFERENCE']]);
  creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['societe_nom', 'BREIZH BRILLANCE', '']]);
  creer('JOURNAL', [['HORODATAGE', 'MOMENT', 'COMMERCIAL', 'ACTION', 'DETAIL', 'NUMERO',
    'APPAREIL', 'SOURCE']]);
  creer('COMMUNES', [['CP', 'VILLE', 'KM', 'SOURCE', 'CALCULE_LE']]);
  creer('ABSENCES', [['PRESTATAIRE', 'DU', 'AU']]);
  creer('RECURRENTS', [['ID', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'FREQUENCE',
    'JOUR', 'JOUR_MOIS', 'HEURE', 'DUREE_MIN', 'PRESTATAIRE', 'DEBUT', 'FIN', 'ACTIF',
    'PRESTATIONS', 'NOTE', 'NATURE'],
    ['R-001', 'LE LOCAL', '14 Alle de Noyalo', '56450', 'Theix-Noyalo', '', 'HEBDO',
     'JEUDI', '', '08:00', 60, 'MAXIME', j(-30), '', 'OUI', 'Entretien des locaux', '',
     'ENTRETIEN']]);
  return charger(CODE_GS);
}

const rep = (g, o) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(o) } }));
const ADMIN = { nom: 'SIMON H', code: 'qx4$' };
const envoi = (o) => Object.assign({ nom: ADMIN.nom, code: ADMIN.code }, o);
const lignes = () => lire('CHANTIERS').slice(1).filter(l => String(l[0]).trim());
const parId = () => { const m = {}; lignes().forEach(l => {
  const o = {}; EN_C.forEach((h, i) => o[h] = l[i]); m[o.ID] = o; }); return m; };
const journal = (a) => lire('JOURNAL').slice(1).filter(l => String(l[3]) === a).length;

/* ---------- 1. annuler ---------- */
let g = poser();
let avant = lignes().length;
let r = rep(g, envoi({ action: 'planifier', id: 'CH-0002', annuler: true }));
T('l\'annulation passe', r.ok === true, r);
T('le statut dit ANNULE', r.statut === 'ANNULE', r.statut);
T('la ligne n\'est pas effacée', lignes().length === avant, [lignes().length, avant]);
T('et le classeur le porte', String((parId()['CH-0002']||{}).STATUT) === 'ANNULE',
  (parId()['CH-0002']||{}).STATUT);
T('l\'annulation est tracée', journal('CHANTIER ANNULE') === 1, journal('CHANTIER ANNULE'));

/* Ce que l'annulation doit produire, et qui est tout l'intérêt de ne pas
   effacer : le salarié ne le voit plus. */
T('le chantier annulé quitte le planning du salarié',
  !g.planningDe_('MAXIME').some(c => c.id === 'CH-0002'),
  g.planningDe_('MAXIME').map(c => c.id));
T('l\'autre chantier de Maxime y est toujours',
  g.planningDe_('MAXIME').some(c => c.id === 'CH-0001'),
  g.planningDe_('MAXIME').map(c => c.id));

/* ---------- 2. l'écran du gérant le range à part ---------- */
let tab = g.tableauAdmin_();
let vuA = tab.chantiers.filter(c => c.id === 'CH-0002')[0];
T('le gérant le reçoit quand même', !!vuA, tab.chantiers.map(c => c.id));
T('avec son statut, pour qu\'il puisse le rétablir', vuA && vuA.statut === 'ANNULE',
  vuA && vuA.statut);

/* ---------- 3. un passage récurrent annulé ne revient pas ---------- */
g = poser();
rep(g, envoi({ action: 'planifier', id: 'CH-0001', annuler: true }));
const n1 = lignes().length;
g.genererRecurrents_();
const apres = parId();
T('la génération ne repose pas le passage annulé',
  String((apres['CH-0001']||{}).STATUT) === 'ANNULE', (apres['CH-0001']||{}).STATUT);
T('et n\'en crée pas un double pour la même date',
  lignes().filter(l => String(l[21]) === 'R-001|' + iso(j(3))).length === 1,
  lignes().filter(l => String(l[21]) === 'R-001|' + iso(j(3))).length);

/* ---------- 4. un chantier pointé ne s'annule pas ---------- */
g = poser();
r = rep(g, envoi({ action: 'planifier', id: 'CH-0003', annuler: true }));
T('l\'annulation d\'un chantier pointé est refusée', r.ok === false, r);
T('et le refus dit pourquoi', /point/.test(String(r.erreur)), r.erreur);
T('le chantier garde son statut', String((parId()['CH-0003']||{}).STATUT) === 'EN COURS',
  (parId()['CH-0003']||{}).STATUT);

/* ---------- 5. rétablir ---------- */
g = poser();
rep(g, envoi({ action: 'planifier', id: 'CH-0002', annuler: true }));
r = rep(g, envoi({ action: 'planifier', id: 'CH-0002', retablir: true }));
T('le rétablissement passe', r.ok === true, r);
T('il reprend PLANIFIE, puisqu\'il a sa date et sa personne',
  r.statut === 'PLANIFIE' && String((parId()['CH-0002']||{}).STATUT) === 'PLANIFIE',
  [r.statut, (parId()['CH-0002']||{}).STATUT]);
T('et il revient sur le téléphone du salarié',
  g.planningDe_('MAXIME').some(c => c.id === 'CH-0002'),
  g.planningDe_('MAXIME').map(c => c.id));
rep(g, envoi({ action: 'planifier', id: 'CH-0012', annuler: true }));
r = rep(g, envoi({ action: 'planifier', id: 'CH-0012', retablir: true }));
T('un chantier sans date rétabli repart « à planifier »', r.statut === 'A PLANIFIER', r.statut);

/* ---------- 6. corriger l'identité ---------- */
g = poser();
r = rep(g, envoi({ action: 'planifier', id: 'CH-0001',
  client: 'LE LOCAL (bureau)', adresse: '16 Allee de Noyalo', cp: '56450',
  ville: 'Theix-Noyalo', acces: 'Nouveau code 4521', note: 'Penser aux vitres' }));
T('la correction passe', r.ok === true, r);
let c1 = parId()['CH-0001'] || {};
T('le client est corrigé', String(c1.CLIENT) === 'LE LOCAL (bureau)', c1.CLIENT);
T('l\'adresse aussi', String(c1.ADRESSE) === '16 Allee de Noyalo', c1.ADRESSE);
T('l\'accès aussi', String(c1.ACCES) === 'Nouveau code 4521', c1.ACCES);
T('la note aussi', String(c1.NOTE) === 'Penser aux vitres', c1.NOTE);
T('la date n\'a pas bougé, elle n\'était pas dans l\'envoi',
  String(c1.HEURE) === '08:00' && !!c1.DATE, [c1.HEURE, !!c1.DATE]);
T('le salarié reçoit la nouvelle adresse',
  (g.planningDe_('MAXIME').filter(c => c.id === 'CH-0001')[0] || {}).adresse === '16 Allee de Noyalo',
  g.planningDe_('MAXIME').filter(c => c.id === 'CH-0001')[0]);

/* Un champ vidé exprès doit le rester : c'est la différence entre « absent de
   l'envoi » et « envoyé vide ». */
r = rep(g, envoi({ action: 'planifier', id: 'CH-0001', acces: '' }));
T('un accès vidé exprès est bien effacé', String((parId()['CH-0001']||{}).ACCES) === '',
  (parId()['CH-0001']||{}).ACCES);
T('et le client n\'a pas été effacé au passage',
  String((parId()['CH-0001']||{}).CLIENT) === 'LE LOCAL (bureau)', (parId()['CH-0001']||{}).CLIENT);

/* La nature se corrige aussi : c'est elle qui colore le planning. */
r = rep(g, envoi({ action: 'planifier', id: 'CH-0001', nature: 'VITRERIE' }));
T('la nature se corrige', String((parId()['CH-0001']||{}).NATURE) === 'VITRERIE',
  (parId()['CH-0001']||{}).NATURE);
r = rep(g, envoi({ action: 'planifier', id: 'CH-0001', nature: 'N IMPORTE QUOI' }));
T('une nature inconnue ne s\'écrit pas', String((parId()['CH-0001']||{}).NATURE) === '',
  (parId()['CH-0001']||{}).NATURE);

/* ---------- 7. créer un chantier à la main ---------- */
g = poser();
avant = lignes().length;
r = rep(g, envoi({ action: 'chantierNeuf', client: 'M. HERON', adresse: '3 rue des Lilas',
  cp: '56000', ville: 'Vannes', acces: 'Portail bleu', date: iso(j(6)), heure: '14:00',
  prestataire: 'YANN P', note: 'Debarras du garage', nature: 'REMISE' }));
T('la création passe', r.ok === true, r);
T('une ligne de plus', lignes().length === avant + 1, [lignes().length, avant]);
/* CH-0012 existe déjà : le nouvel ID doit partir de là, pas du nombre de
   lignes, sinon il écraserait un chantier existant. */
T('l\'ID suit le plus grand déjà posé', r.id === 'CH-0013', r.id);
let neuf = parId()[r.id] || {};
T('il est planifié, date et personne posées', String(neuf.STATUT) === 'PLANIFIE', neuf.STATUT);
T('sans numéro de devis', String(neuf.NUMERO) === '', neuf.NUMERO);
T('avec son accès', String(neuf.ACCES) === 'Portail bleu', neuf.ACCES);
T('avec sa nature', String(neuf.NATURE) === 'REMISE', neuf.NATURE);
T('et la note qui tiendra lieu de fiche de travail',
  String(neuf.NOTE) === 'Debarras du garage', neuf.NOTE);
T('il arrive sur le téléphone du salarié',
  g.planningDe_('YANN P').some(c => c.id === r.id), g.planningDe_('YANN P').map(c => c.id));
T('la création est tracée', journal('CHANTIER CREE') === 1, journal('CHANTIER CREE'));

r = rep(g, envoi({ action: 'chantierNeuf', client: 'SANS PERSONNE', date: iso(j(6)) }));
T('sans prestataire, il reste à planifier', r.statut === 'A PLANIFIER', r.statut);
r = rep(g, envoi({ action: 'chantierNeuf', client: '   ' }));
T('sans client, c\'est refusé', r.ok === false && /client/.test(String(r.erreur)), r);
r = rep(g, envoi({ action: 'chantierNeuf', client: 'X', prestataire: 'QUELQU UN' }));
T('un prestataire inconnu est refusé',
  r.ok === false && /liste/.test(String(r.erreur)), r);

/* ---------- 8. le lot ---------- */
g = poser();
r = rep(g, envoi({ action: 'lotChantiers', ids: ['CH-0001', 'CH-0002'],
                   date: iso(j(9)), prestataire: 'YANN P' }));
T('le lot passe', r.ok === true && r.faits === 2, r);
let m = parId();
T('les deux ont changé de personne',
  String((m['CH-0001']||{}).PRESTATAIRE) === 'YANN P' && String((m['CH-0002']||{}).PRESTATAIRE) === 'YANN P',
  [(m['CH-0001']||{}).PRESTATAIRE, (m['CH-0002']||{}).PRESTATAIRE]);
T('et de date', String((m['CH-0001']||{}).DATE).slice(0, 15) === String(j(9)).slice(0, 15),
  [String((m['CH-0001']||{}).DATE), String(j(9))]);
T('leur heure n\'a pas bougé, elle n\'était pas dans l\'envoi',
  String((m['CH-0001']||{}).HEURE) === '08:00' && String((m['CH-0002']||{}).HEURE) === '10:30',
  [(m['CH-0001']||{}).HEURE, (m['CH-0002']||{}).HEURE]);
T('ils ont quitté le planning de Maxime',
  g.planningDe_('MAXIME').length === 0, g.planningDe_('MAXIME').map(c => c.id));

/* Le lot applique les mêmes garde-fous que l'unité : un chantier pointé
   résiste, et son refus se dit au lieu de se perdre dans le nombre. */
r = rep(g, envoi({ action: 'lotChantiers', ids: ['CH-0001', 'CH-0003'], annuler: true }));
T('le lot annule ce qu\'il peut', r.faits === 1, r);
T('et dit ce qui a résisté', (r.refus||[]).length === 1 && /CH-0003/.test((r.refus||[])[0]||''), r.refus);
m = parId();
T('le chantier pointé garde son statut', String((m['CH-0003']||{}).STATUT) === 'EN COURS',
  (m['CH-0003']||{}).STATUT);
T('l\'autre est bien annulé', String((m['CH-0001']||{}).STATUT) === 'ANNULE', (m['CH-0001']||{}).STATUT);

r = rep(g, envoi({ action: 'lotChantiers', ids: [] }));
/* Le refus doit se dire. Sans message, la boucle vide rend « ok: false » elle
   aussi, et l'écran n'aurait rien à afficher. */
T('un lot vide est refusé', r.ok === false, r);
T('et il dit pourquoi', /aucun chantier/.test(String(r.erreur)), r.erreur);
r = rep(g, envoi({ action: 'lotChantiers', ids: new Array(61).fill('CH-0001'), date: iso(j(9)) }));
T('un lot démesuré est refusé', r.ok === false && /60/.test(String(r.erreur)), r);

/* ---------- 9. la cloison ---------- */
g = poser();
const refus0 = () => lire('JOURNAL').slice(1).filter(l => String(l[3]) === 'ACTION REFUSEE').length;
r = rep(g, { action: 'chantierNeuf', nom: 'SIMON LG', code: 'ab1!', client: 'X' });
T('un commercial ne crée pas de chantier', r.ok === false, r);
T('le refus dit pourquoi', /non autorisée/.test(String(r.erreur)), r.erreur);
r = rep(g, { action: 'lotChantiers', nom: 'MAXIME', code: 'kw7!', ids: ['CH-0001'], annuler: true });
T('un salarié n\'annule pas les chantiers', r.ok === false, r);
r = rep(g, { action: 'planifier', nom: 'MAXIME', code: 'kw7!', id: 'CH-0001', annuler: true });
T('ni par l\'action planifier', r.ok === false, r);
T('le chantier est intact', String((parId()['CH-0001']||{}).STATUT) === 'PLANIFIE',
  (parId()['CH-0001']||{}).STATUT);
T('les trois refus sont tracés', refus0() === 3, refus0());

console.log('\n=== LE GERANT MAITRE DE SON PLANNING (v70) : ' + ok.length + ' au vert, ' +
            ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
