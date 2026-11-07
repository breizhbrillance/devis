/* Créer, modifier, arrêter un contrat depuis l'appli (v92, 7 novembre 2026).

   Ce que ces essais gardent :
   — une fiche « le lundi et le jeudi » fait deux séries, numérotées à la
     suite des existantes, et le planning est posé tout de suite ;
   — aucun doublon : la même série déjà écrite est refusée en la nommant ;
   — les refus : sans client, rythme inconnu, fin avant le début, salarié
     inconnu, heure illisible ;
   — modifier « à partir de » ferme l'ancienne série la veille et reprend
     sur un vrai passage : une quinzaine ne change pas de semaine ;
   — un passage pointé n'est jamais retiré ;
   — arrêter retire les passages à venir, garde les précédents, et la nuit
     suivante ne les repose pas ;
   — la cloison : un commercial qui appelle ces actions est refusé ;
   — le tableau du gérant porte les contrats, l'horizon et la clé de chaque
     passage. */
import { creer, lire, charger, horloge, sansInterface } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };

/* Lundi 9 novembre 2026, 7 h. */
horloge(new Date(2026, 10, 9, 7, 0, 0));
sansInterface(true);

const jour = (a, m, j) => new Date(a, m - 1, j, 12, 0, 0, 0);
const iso = (d) => { const x = new Date(d);
  return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); };

const EN_R = ['ID', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'FREQUENCE', 'JOUR',
  'JOUR_MOIS', 'HEURE', 'DUREE_MIN', 'PRESTATAIRE', 'DEBUT', 'FIN', 'ACTIF',
  'NATURE', 'PRESTATIONS', 'NOTE'];
const EN_C = ['ID', 'NUMERO', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'DATE', 'HEURE',
  'PRESTATAIRE', 'STATUT', 'ARRIVEE', 'DEPART', 'MINUTES', 'PRESTATIONS_FAITES',
  'SIGNALEMENT', 'PHOTOS', 'NOTE', 'CREE_LE', 'DUREE_PREVUE_MIN', 'LOT', 'RECURRENT',
  'NATURE', 'AVANT_SIGNATURE'];
const R = (o) => EN_R.map(h => o[h] !== undefined ? o[h] : '');

function poser(series) {
  creer('RECURRENTS', [EN_R].concat((series || []).map(R)));
  creer('CHANTIERS', [EN_C]);
  creer('DEVIS', [['NUMERO', 'DATE', 'COMMERCIAL', 'CLIENT', 'TOTAL_HT', 'STATUT', 'SIGNE']]);
  creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['societe_nom', 'BREIZH BRILLANCE', '']]);
  creer('JOURNAL', [['HORODATAGE', 'MOMENT', 'COMMERCIAL', 'ACTION', 'DETAIL', 'NUMERO',
    'APPAREIL', 'SOURCE']]);
  creer('PRESTATAIRES', [['NOM', 'EMAIL', 'CODE', 'ACTIF', 'TELEPHONE'],
    ['MAXIME', 'm@bb.fr', 'kw7!', 'OUI', '0600000001']]);
  creer('ADMINS', [['NOM', 'EMAIL', 'CODE', 'ACTIF', 'INITIALES'], ['SIMON DIRECTION', 'd@bb.fr', 'qx4$', 'OUI', 'SD']]);
  creer('COMMERCIAUX', [['NOM', 'EMAIL', 'CODE', 'ACTIF'], ['SIMON LG', 's@bb.fr', 'ab1!', 'OUI']]);
  creer('CATALOGUE', [['CATEGORIE', 'DESIGNATION', 'DETAIL', 'UNITE', 'PU_HT', 'TVA', 'TYPE', 'ACTIF', 'REFERENCE']]);
  creer('ABSENCES', [['PRESTATAIRE', 'DU', 'AU']]);
  return charger(CODE_GS);
}
const chantiers = () => lire('CHANTIERS').slice(1).map(l => {
  const o = {}; EN_C.forEach((h, i) => { o[h] = l[i]; }); return o; }).filter(o => String(o.ID || '').trim());
const series = () => lire('RECURRENTS').slice(1).map(l => {
  const o = {}; EN_R.forEach((h, i) => { o[h] = l[i]; }); return o; }).filter(o => String(o.ID || '').trim());
const de = (id) => chantiers().filter(c => String(c.RECURRENT).split('|')[0] === id);
const journal = () => lire('JOURNAL').slice(1).map(l => l[3]);

const ANCIENNE = { ID: 'R-007', CLIENT: 'MME BENJAMIN', FREQUENCE: 'MENSUEL', JOUR_MOIS: 6,
  PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 10, 1), ACTIF: 'OUI', NATURE: 'ENTRETIEN' };
const FICHE = { client: 'CABINET KINE DU PORT', adresse: '3 quai Est', cp: '56000', ville: 'Vannes',
  acces: 'Badge à l\'accueil', frequence: 'HEBDO', jours: [1, 4], debut: '2026-11-09',
  heure: '8:00', duree: 90, prestataire: 'maxime', nature: 'ENTRETIEN',
  prestations: 'Sols, sanitaires, poubelles' };

/* ---------- 1. créer : deux jours, deux séries ---------- */
let g = poser([ANCIENNE]);
let r = g.recurrentNeuf_(Object.assign({}, FICHE), { nom: 'SIMON DIRECTION' });
T('la création répond oui', r.ok, r);
T('« lundi et jeudi » font deux séries, numérotées après R-007',
  JSON.stringify(r.ids) === '["R-008","R-009"]', r.ids);
const s8 = series().filter(s => s.ID === 'R-008')[0] || {};
const s9 = series().filter(s => s.ID === 'R-009')[0] || {};
T('la première est le lundi, la seconde le jeudi', s8.JOUR === 'LUNDI' && s9.JOUR === 'JEUDI', [s8.JOUR, s9.JOUR]);
T('l\'heure est remise au propre (8:00 → 08:00)', s8.HEURE === '08:00', s8.HEURE);
T('le salarié est écrit comme dans la liste', s8.PRESTATAIRE === 'MAXIME', s8.PRESTATAIRE);
T('rythme, durée, nature, prestations et accès sont écrits',
  s8.FREQUENCE === 'HEBDO' && Number(s8.DUREE_MIN) === 90 && s8.NATURE === 'ENTRETIEN' &&
  s8.PRESTATIONS === 'Sols, sanitaires, poubelles' && s8.ACCES === 'Badge à l\'accueil', s8);
T('le début est une vraie date', s8.DEBUT instanceof Date && iso(s8.DEBUT) === '2026-11-09', s8.DEBUT);
T('le planning est posé tout de suite, sans attendre la nuit', r.poses > 0 && de('R-008').length === 9, [r.poses, de('R-008').length]);
T('le premier lundi est aujourd\'hui', de('R-008').some(c => iso(c.DATE) === '2026-11-09'), de('R-008').map(c => iso(c.DATE)));
T('les passages portent heure, salarié, durée et fiche de travail',
  de('R-009').every(c => c.HEURE === '08:00' && c.PRESTATAIRE === 'MAXIME' &&
    Number(c.DUREE_PREVUE_MIN) === 90 && c.NOTE === 'Sols, sanitaires, poubelles' && c.STATUT === 'PLANIFIE'),
  de('R-009')[0]);
T('le journal dit « CONTRAT CREE »', journal().indexOf('CONTRAT CREE') >= 0, journal());

/* ---------- 2. pas de doublon ---------- */
const avant = chantiers().length;
r = g.recurrentNeuf_(Object.assign({}, FICHE, { client: 'Cabinet Kiné du Port', jours: [4] }), {});
T('la même série déjà écrite est refusée', !r.ok && r.existe === 'R-009', r);
T('et rien n\'est écrit', series().length === 3 && chantiers().length === avant, [series().length, chantiers().length]);
r = g.recurrentNeuf_(Object.assign({}, FICHE, { jours: [4], heure: '14:00' }), {});
T('le même client à une autre heure est accepté', r.ok && r.ids[0] === 'R-010', r);

/* ---------- 3. les refus ---------- */
const refus = (o) => g.recurrentNeuf_(Object.assign({}, FICHE, o), {});
T('sans client : refusé', !refus({ client: '  ' }).ok);
T('rythme inconnu : refusé', !refus({ frequence: 'ANNUEL' }).ok);
T('fin avant le début : refusé', !refus({ fin: '2026-11-01' }).ok);
T('salarié inconnu : refusé', !refus({ prestataire: 'PERSONNE X' }).ok);
T('heure illisible : refusé', !refus({ heure: '25:00' }).ok);
T('sans date de début : refusé', !refus({ debut: '' }).ok);
T('hebdomadaire sans jour valable : refusé', !refus({ jours: ['xyz'] }).ok);

/* ---------- 4. le mensuel ---------- */
r = g.recurrentNeuf_(Object.assign({}, FICHE, { client: 'SYNDIC ARMOR', frequence: 'MENSUEL',
  jours: [], debut: '2026-11-30', jourMois: 31 }), {});
const sm = series().filter(s => s.ID === (r.ids || [])[0])[0] || {};
T('un mensuel garde son quantième et n\'a pas de jour de semaine',
  r.ok && Number(sm.JOUR_MOIS) === 31 && sm.JOUR === '', sm);
T('le 31 tombe le 30 novembre', de(sm.ID).some(c => iso(c.DATE) === '2026-11-30'), de(sm.ID).map(c => iso(c.DATE)));

/* ---------- 5. modifier une quinzaine sans changer de semaine ---------- */
g = poser([{ ID: 'R-001', CLIENT: 'AXA THEIX', FREQUENCE: 'QUINZAINE', JOUR: 'MARDI',
  HEURE: '10:30', DUREE_MIN: 60, PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 11, 3), ACTIF: 'OUI',
  NATURE: 'ENTRETIEN' }]);
g.genererRecurrents_();
const datesAvant = de('R-001').map(c => iso(c.DATE)).sort();
T('la quinzaine tombe le 17 novembre, puis tous les quinze jours', datesAvant[0] === '2026-11-17', datesAvant);
r = g.recurrentModif_({ id: 'R-001', aPartirDe: '2026-11-09', client: 'AXA THEIX', frequence: 'QUINZAINE',
  jours: [2], debut: '2026-11-03', heure: '11:00', duree: 45, prestataire: 'MAXIME', nature: 'ENTRETIEN' }, {});
T('la modification répond oui, par une série neuve', r.ok && !r.enPlace && r.ids[0] === 'R-002', r);
const vieille = series().filter(s => s.ID === 'R-001')[0];
T('l\'ancienne série est close la veille', vieille && iso(vieille.FIN) === '2026-11-08', vieille && vieille.FIN);
const neuve = series().filter(s => s.ID === 'R-002')[0] || {};
T('la neuve reprend sur un vrai passage (17 novembre), pas aujourd\'hui',
  iso(neuve.DEBUT) === '2026-11-17', neuve.DEBUT);
const datesApres = de('R-002').map(c => iso(c.DATE)).sort();
T('les mêmes dates, à la nouvelle heure', JSON.stringify(datesApres) === JSON.stringify(datesAvant) &&
  de('R-002').every(c => c.HEURE === '11:00' && Number(c.DUREE_PREVUE_MIN) === 45), [datesAvant, datesApres]);
T('aucun passage de l\'ancienne série ne reste à venir', de('R-001').length === 0, de('R-001').length);
g.genererRecurrents_();
T('la nuit suivante ne repose rien', de('R-001').length === 0 && de('R-002').length === datesAvant.length,
  [de('R-001').length, de('R-002').length]);

/* ---------- 6. un passage pointé n'est jamais retiré ---------- */
g = poser([{ ID: 'R-001', CLIENT: 'QUAI OUEST', FREQUENCE: 'HEBDO', JOUR: 'LUNDI', HEURE: '07:00',
  PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 9, 1), ACTIF: 'OUI' }]);
g.genererRecurrents_();
{
  const t = lire('CHANTIERS'); const cA = EN_C.indexOf('ARRIVEE'), cR = EN_C.indexOf('RECURRENT');
  t.forEach((l, i) => { if (i && l[cR] === 'R-001|2026-11-09') l[cA] = new Date(2026, 10, 9, 7, 2).getTime(); });
}
r = g.recurrentModif_({ id: 'R-001', aPartirDe: '2026-11-09', client: 'QUAI OUEST', frequence: 'HEBDO',
  jours: [1], debut: '2026-09-01', heure: '06:30', prestataire: 'MAXIME' }, {});
T('le passage commencé ce matin reste là', de('R-001').some(c => c.RECURRENT === 'R-001|2026-11-09'),
  de('R-001').map(c => c.RECURRENT));
T('et la série neuve ne le double pas', !de(r.ids[0]).some(c => iso(c.DATE) === '2026-11-09'),
  de(r.ids[0]).map(c => iso(c.DATE)));

/* ---------- 7. modifier en place une série qui n'a pas commencé ---------- */
g = poser([{ ID: 'R-001', CLIENT: 'NOUVEAU CLIENT', FREQUENCE: 'HEBDO', JOUR: 'VENDREDI', HEURE: '09:00',
  PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 11, 20), ACTIF: 'OUI' }]);
g.genererRecurrents_();
r = g.recurrentModif_({ id: 'R-001', aPartirDe: '2026-11-09', client: 'NOUVEAU CLIENT', frequence: 'HEBDO',
  jours: [3], debut: '2026-11-18', heure: '09:00', prestataire: 'MAXIME' }, {});
T('une série pas encore commencée est réécrite en place (même numéro)', r.ok && r.enPlace && r.ids[0] === 'R-001', r);
T('elle passe au mercredi, sans reste du vendredi',
  de('R-001').length > 0 && de('R-001').every(c => new Date(c.DATE).getDay() === 3), de('R-001').map(c => iso(c.DATE)));
T('une seule série dans l\'onglet', series().length === 1, series().length);

/* ---------- 8. arrêter ---------- */
g = poser([{ ID: 'R-001', CLIENT: 'PHARMACIE', FREQUENCE: 'HEBDO', JOUR: 'JEUDI', HEURE: '13:00',
  PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 9, 1), ACTIF: 'OUI' }]);
g.genererRecurrents_();
r = g.recurrentStop_({ id: 'R-001', aPartirDe: '2026-11-26' }, {});
const ph = series()[0];
T('l\'arrêt répond oui et dit le dernier jour', r.ok && r.fin === '2026-11-25', r);
T('la fin est écrite, la série reste active jusque-là', iso(ph.FIN) === '2026-11-25' && ph.ACTIF === 'OUI', ph);
T('les jeudis d\'avant restent (12 et 19 novembre)',
  de('R-001').map(c => iso(c.DATE)).sort().join() === '2026-11-12,2026-11-19', de('R-001').map(c => iso(c.DATE)));
T('les suivants sont retirés, pas annulés', !chantiers().some(c => c.STATUT === 'ANNULE'), r.retires);
g.genererRecurrents_();
T('la nuit suivante ne les repose pas', de('R-001').length === 2, de('R-001').length);
T('le journal dit « CONTRAT ARRETE »', journal().indexOf('CONTRAT ARRETE') >= 0);

g = poser([{ ID: 'R-001', CLIENT: 'PAS ENCORE', FREQUENCE: 'HEBDO', JOUR: 'LUNDI', PRESTATAIRE: 'MAXIME',
  DEBUT: jour(2026, 12, 7), ACTIF: 'OUI' }]);
g.recurrentStop_({ id: 'R-001', aPartirDe: '2026-11-09' }, {});
T('arrêtée avant son premier passage, la série est éteinte', series()[0].ACTIF === 'NON', series()[0].ACTIF);
T('un contrat inconnu se dit', !g.recurrentStop_({ id: 'R-404' }, {}).ok);

/* ---------- 9. la cloison ---------- */
g = poser([]);
const appel = (o) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(o) } }));
let rep = appel(Object.assign({ action: 'recurrentNeuf', nom: 'SIMON LG', code: 'ab1!' }, FICHE));
T('un commercial ne crée pas de contrat', !rep.ok && series().length === 0, rep);
T('et le refus part au journal', journal().indexOf('ACTION REFUSEE') >= 0);
rep = appel({ action: 'recurrentStop', nom: 'MAXIME', code: 'kw7!', id: 'R-001' });
T('un salarié n\'arrête pas de contrat', !rep.ok, rep);
rep = appel(Object.assign({ action: 'recurrentNeuf', nom: 'SIMON DIRECTION', code: 'qx4$' }, FICHE));
T('le gérant, lui, crée', rep.ok && series().length === 2, rep);

/* ---------- 10. le tableau du gérant ---------- */
const tab = g.tableauAdmin_();
T('le tableau porte les contrats', Array.isArray(tab.recurrents) && tab.recurrents.length === 2, tab.recurrents);
const c0 = (tab.recurrents || [])[0] || {};
T('chaque contrat dit son rythme, son jour, son heure, son début',
  c0.frequence === 'HEBDO' && c0.jour === 'LUNDI' && c0.heure === '08:00' && c0.debut === '2026-11-09' && c0.actif === true, c0);
T('le tableau dit jusqu\'où les passages sont posés (8 semaines)', tab.horizon === '2027-01-04', tab.horizon);
T('chaque passage porte la clé de son contrat',
  (tab.chantiers || []).filter(c => c.recurrent).length === (tab.chantiers || []).length && (tab.chantiers || []).length > 0,
  (tab.chantiers || [])[0]);


/* ---------- 11. les dates sautées, un mois sur deux, le 3e jeudi ---------- */
const EN_R2 = EN_R.concat(['EXCLUSIONS', 'INTERVALLE']);
function poser2(series) {
  const gg = poser([]);
  creer('RECURRENTS', [EN_R2].concat(series.map(o => EN_R2.map(h => o[h] !== undefined ? o[h] : ''))));
  return gg;
}
const dates = (id) => de(id).map(c => iso(c.DATE)).sort();
g = poser2([{ ID: 'R-001', CLIENT: 'GRAND OPTICAL', FREQUENCE: 'MENSUEL', JOUR_MOIS: 18, HEURE: '09:30',
  PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 6, 18), ACTIF: 'OUI', EXCLUSIONS: '2026-11-18, 18/12/2026' }]);
g.genererRecurrents_();
T('une date sautée n\'est pas posée (18 novembre, 18 décembre)', dates('R-001').length === 0, dates('R-001'));
horloge(new Date(2026, 11, 20, 7, 0, 0));
g = charger(CODE_GS);           // l'horloge se lit au chargement
g.genererRecurrents_();
T('le mois suivant revient (18 janvier)', dates('R-001').indexOf('2027-01-18') >= 0, dates('R-001'));
horloge(new Date(2026, 10, 9, 7, 0, 0));

g = poser2([{ ID: 'R-001', CLIENT: 'HEN A CARS VITRAGES', FREQUENCE: 'MENSUEL', JOUR_MOIS: 6, INTERVALLE: 2,
  HEURE: '12:15', PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 10, 6), ACTIF: 'OUI' }]);
horloge(new Date(2026, 10, 1, 7, 0, 0));
g = charger(CODE_GS);
creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['recurrents_semaines', '20', '']]);
g.genererRecurrents_();
T('un mois sur deux depuis octobre : décembre et février, pas novembre ni janvier',
  dates('R-001').join() === '2026-12-06,2027-02-06', dates('R-001'));

g = poser2([{ ID: 'R-001', CLIENT: 'HERON VITRAGES', FREQUENCE: 'MENSUEL', JOUR: 'MERCREDI', JOUR_MOIS: 2,
  INTERVALLE: 2, HEURE: '14:00', PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 11, 11), ACTIF: 'OUI',
  EXCLUSIONS: '2026-11-11, 2027-01-13' }]);
g = charger(CODE_GS);
creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['recurrents_semaines', '30', '']]);
g.genererRecurrents_();
T('le 2e mercredi, un mois sur deux, moins les dates sautées : 10 mars et 12 mai',
  dates('R-001').join() === '2027-03-10,2027-05-12', dates('R-001'));
g = poser2([{ ID: 'R-001', CLIENT: 'DERNIER', FREQUENCE: 'MENSUEL', JOUR: 'VENDREDI', JOUR_MOIS: 5,
  PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 11, 1), ACTIF: 'OUI' }]);
g = charger(CODE_GS);
creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['recurrents_semaines', '9', '']]);
g.genererRecurrents_();
T('le rang 5 veut dire le dernier vendredi (27 novembre, 25 décembre)',
  dates('R-001').join() === '2026-11-27,2026-12-25', dates('R-001'));
horloge(new Date(2026, 10, 9, 7, 0, 0));

g = poser2([]);
g = charger(CODE_GS);
r = g.recurrentNeuf_(Object.assign({}, FICHE, { frequence: 'MENSUEL', mensuel: 'RANG', jours: [],
  debut: '2026-11-19', intervalle: 2 }), {});
const sr = series().filter(s => s.ID === (r.ids || [])[0])[0] || {};
const sr2 = lire('RECURRENTS').slice(1).map(l => { const o = {}; EN_R2.forEach((h, i) => { o[h] = l[i]; }); return o; })[0] || {};
T('la fiche « le 3e jeudi, tous les 2 mois » écrit JEUDI, rang 3, intervalle 2',
  r.ok && sr2.JOUR === 'JEUDI' && Number(sr2.JOUR_MOIS) === 3 && Number(sr2.INTERVALLE) === 2, [r, sr2]);

/* ---------- 12. un devis récurrent signé devient un contrat ---------- */
const EN_R3 = EN_R2.concat(['DEVIS']);
const EN_D = ['NUMERO', 'DATE', 'COMMERCIAL', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'TOTAL_HT', 'TOTAL_HT_MENSUEL',
  'STATUT', 'SIGNE', 'NATURE', 'PASSAGES_MOIS', 'NUMERO_ORIGINE', 'NOTE_COMMERCIAL'];
const devis = (o) => EN_D.map(h => o[h] !== undefined ? o[h] : '');
const ch = (o) => EN_C.map(h => o[h] !== undefined ? o[h] : '');
function signe(passages, dates, extra) {
  g = poser([]);
  creer('RECURRENTS', [EN_R3]);
  creer('DEVIS', [EN_D, devis(Object.assign({ NUMERO: 'DEV-26-11/ CAKI/ SLG-04/ S', DATE: jour(2026, 11, 9),
    CLIENT: 'CABINET KINE', ADRESSE: '3 quai Est', CP: '56000', VILLE: 'Vannes', TOTAL_HT: 213.2, TOTAL_HT_MENSUEL: 213.2,
    STATUT: 'SIGNE', SIGNE: 'OUI', NATURE: 'ENTRETIEN', PASSAGES_MOIS: passages, NOTE_COMMERCIAL: 'Badge accueil',
    NUMERO_ORIGINE: 'DEV-26-11/ CAKI/ SLG-04' }, extra || {}))]);
  creer('CHANTIERS', [EN_C].concat(dates.map((d, i) => ch({ ID: 'CH-' + (300 + i), NUMERO: 'DEV-26-11/ CAKI/ SLG-04/ S',
    CLIENT: 'CABINET KINE', DATE: d[0], HEURE: d[1], PRESTATAIRE: d[2] || 'MAXIME', STATUT: 'PLANIFIE',
    DUREE_PREVUE_MIN: 60, NATURE: 'ENTRETIEN' }))));
  g = charger(CODE_GS);
  return g.contratDepuisDevis_('DEV-26-11/ CAKI/ SLG-04/ S', 'SIMON DIRECTION');
}
const lesSeries = () => lire('RECURRENTS').slice(1).map(l => { const o = {}; EN_R3.forEach((h, i) => { o[h] = l[i]; }); return o; })
  .filter(o => String(o.ID || '').trim());
let ids = signe(4, [[jour(2026, 11, 12), '09:00'], [jour(2026, 11, 19), '09:00'], [jour(2026, 11, 26), '09:00'], [jour(2026, 12, 3), '09:00']]);
let sx = lesSeries()[0] || {};
T('4 passages par mois signés : une série toutes les semaines, le jeudi à 09:00, MAXIME',
  JSON.stringify(ids) === '["R-001"]' && sx.FREQUENCE === 'HEBDO' && sx.JOUR === 'JEUDI' && sx.HEURE === '09:00' &&
  sx.PRESTATAIRE === 'MAXIME' && Number(sx.DUREE_MIN) === 60, [ids, sx]);
T('la série porte le devis, le client, l\'accès, le montant mensuel dans la note',
  sx.DEVIS === 'DEV-26-11/ CAKI/ SLG-04/ S' && sx.CLIENT === 'CABINET KINE' && sx.ACCES === 'Badge accueil' &&
  String(sx.NOTE).indexOf('213,20 € HT par mois') >= 0, sx);
T('les passages du premier mois reçoivent la clé du contrat',
  chantiers().filter(c => String(c.ID).startsWith('CH-3')).every(c => String(c.RECURRENT).startsWith('R-001|')), chantiers().map(c => c.RECURRENT));
const jeudis = chantiers().map(c => iso(c.DATE)).sort();
T('aucun jeudi en double, et la suite est posée (au-delà du 3 décembre)',
  new Set(jeudis).size === jeudis.length && jeudis.some(d => d > '2026-12-03'), jeudis);
T('signé deux fois, un seul contrat', g.contratDepuisDevis_('DEV-26-11/ CAKI/ SLG-04/ S') === null && lesSeries().length === 1);

ids = signe(2, [[jour(2026, 11, 10), '07:00'], [jour(2026, 11, 24), '07:00']]);
sx = lesSeries()[0] || {};
T('2 passages par mois : toutes les deux semaines, le mardi', sx.FREQUENCE === 'QUINZAINE' && sx.JOUR === 'MARDI', sx);
T('la quinzaine suit les passages posés (8 décembre, pas le 1er)',
  de('R-001').map(c => iso(c.DATE)).indexOf('2026-12-08') >= 0 && de('R-001').map(c => iso(c.DATE)).indexOf('2026-12-01') < 0,
  de('R-001').map(c => iso(c.DATE)));

ids = signe(8, [[jour(2026, 11, 9), '07:30', 'VICTOR'], [jour(2026, 11, 12), '09:00'], [jour(2026, 11, 16), '07:30', 'VICTOR'],
  [jour(2026, 11, 19), '09:00'], [jour(2026, 11, 23), '07:30', 'VICTOR'], [jour(2026, 11, 26), '09:00'],
  [jour(2026, 11, 30), '07:30', 'VICTOR'], [jour(2026, 12, 3), '09:00']]);
const ss2 = lesSeries();
T('8 passages par mois : deux séries, lundi (VICTOR 07:30) et jeudi (MAXIME 09:00)',
  ss2.length === 2 && ss2[0].JOUR === 'LUNDI' && ss2[0].PRESTATAIRE === 'VICTOR' && ss2[0].HEURE === '07:30' &&
  ss2[1].JOUR === 'JEUDI' && ss2[1].PRESTATAIRE === 'MAXIME', ss2.map(s => [s.JOUR, s.PRESTATAIRE, s.HEURE]));

ids = signe(4, [[jour(2026, 11, 12), '09:00'], [jour(2026, 11, 19), '09:00'], [jour(2026, 11, 27), '09:00'], [jour(2026, 12, 3), '09:00']]);
sx = lesSeries()[0] || {};
T('un passage du premier mois posé un autre jour (vendredi 27) : le jeudi 26 est exclu, pas doublé',
  String(sx.EXCLUSIONS).indexOf('2026-11-26') >= 0 && !de('R-001').some(c => iso(c.DATE) === '2026-11-26'), [sx.EXCLUSIONS]);

ids = signe(4, [], { NATURE: 'CHANTIER' });
T('un devis ponctuel ne fait pas de contrat', ids === null && lesSeries().length === 0, ids);
ids = signe(4, []);
T('sans passage daté, pas de contrat, et le journal le dit', ids === null && journal().indexOf('CONTRAT A ECRIRE') >= 0, journal());

horloge(null);
console.log('\n=== CRÉER ET CONDUIRE UN CONTRAT (v92) : ' + ok.length + ' au vert, ' + ko.length + ' au rouge ===');
ok.forEach(x => console.log('  ✓ ' + x));
ko.forEach(x => console.log('  ✗ ' + x));
process.exit(ko.length ? 1 : 0);
