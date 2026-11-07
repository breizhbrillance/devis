/* v93 — un devis récurrent signé, mis au calendrier comme contrat depuis sa
   fiche (demande de Simon, 7 novembre 2026 : « quand un devis récurrent est
   signé, je puisse l'ajouter directement dans le calendrier »).

   Ce que ces essais gardent :
   — la série porte le numéro du devis et son mensuel dans la NOTE ;
   — les interventions du devis restées sans date sont retirées : la série
     les remplace, sans doublon ;
   — celle déjà datée un jour où la série passe reçoit la clé de la série,
     et la génération ne pose pas un second passage ce jour-là ;
   — celle datée un autre jour reste, et une intervention commencée n'est
     jamais touchée ;
   — un devis ne fait qu'un contrat : la seconde demande est refusée ;
   — le tableau du gérant dit, pour chaque devis, s'il est récurrent, son
     rythme et le contrat qui le porte. */
import { creer, lire, charger, horloge, sansInterface } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };

horloge(new Date(2026, 10, 9, 7, 0, 0));      // lundi 9 novembre 2026
sansInterface(true);
const jour = (a, m, j) => new Date(a, m - 1, j, 12, 0, 0, 0);
const iso = (d) => { const x = new Date(d);
  return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); };

const EN_R = ['ID', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'FREQUENCE', 'JOUR', 'JOUR_MOIS',
  'HEURE', 'DUREE_MIN', 'PRESTATAIRE', 'DEBUT', 'FIN', 'ACTIF', 'NATURE', 'PRESTATIONS', 'NOTE',
  'EXCLUSIONS', 'INTERVALLE', 'DEVIS'];
const EN_C = ['ID', 'NUMERO', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'DATE', 'HEURE',
  'PRESTATAIRE', 'STATUT', 'ARRIVEE', 'DEPART', 'MINUTES', 'PRESTATIONS_FAITES',
  'SIGNALEMENT', 'PHOTOS', 'NOTE', 'CREE_LE', 'DUREE_PREVUE_MIN', 'LOT', 'RECURRENT',
  'NATURE', 'AVANT_SIGNATURE'];
const EN_D = ['NUMERO', 'NUMERO_ORIGINE', 'DATE', 'COMMERCIAL', 'CLIENT', 'ADRESSE', 'CP', 'VILLE',
  'NATURE', 'PASSAGES_MOIS', 'TOTAL_HT', 'TOTAL_HT_MENSUEL', 'TOTAL_TTC', 'STATUT', 'SIGNE'];
const C = (o) => EN_C.map(h => o[h] !== undefined ? o[h] : '');

function poser(chs) {
  creer('RECURRENTS', [EN_R]);
  creer('CHANTIERS', [EN_C].concat(chs.map(C)));
  creer('DEVIS', [EN_D,
    ['DV-26-11-040', '', jour(2026, 11, 2), 'SIMON LG', 'LE LOCAL', '12 rue du Port', '56000', 'Vannes',
     'ENTRETIEN', 4, 960, 960, 1152, 'SIGNE', 'OUI'],
    ['DV-26-11-041', '', jour(2026, 11, 3), 'SIMON LG', 'MME DUPONT', '1 rue A', '56000', 'Vannes',
     'CHANTIER', 0, 400, 0, 480, 'SIGNE', 'OUI']]);
  creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['societe_nom', 'BREIZH BRILLANCE', '']]);
  creer('JOURNAL', [['HORODATAGE', 'MOMENT', 'COMMERCIAL', 'ACTION', 'DETAIL', 'NUMERO', 'APPAREIL', 'SOURCE']]);
  creer('PRESTATAIRES', [['NOM', 'EMAIL', 'CODE', 'ACTIF', 'TELEPHONE'], ['MAXIME', 'm@bb.fr', 'kw7!', 'OUI', '06']]);
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

const N = 'DV-26-11-040';
let g = poser([
  { ID: 'CH-0101', NUMERO: N, CLIENT: 'LE LOCAL', NATURE: 'ENTRETIEN' },                         // sans date
  { ID: 'CH-0102', NUMERO: N, CLIENT: 'LE LOCAL', NATURE: 'ENTRETIEN' },                         // sans date
  { ID: 'CH-0103', NUMERO: N, CLIENT: 'LE LOCAL', DATE: jour(2026, 11, 16), HEURE: '18:00',
    PRESTATAIRE: 'MAXIME', NATURE: 'ENTRETIEN' },                                                 // un lundi
  { ID: 'CH-0104', NUMERO: N, CLIENT: 'LE LOCAL', DATE: jour(2026, 11, 18), HEURE: '18:00',
    PRESTATAIRE: 'MAXIME', NATURE: 'ENTRETIEN' },                                                 // un mercredi
  { ID: 'CH-0105', NUMERO: N, CLIENT: 'LE LOCAL', STATUT: 'EN COURS', NATURE: 'ENTRETIEN' },       // commencé
  { ID: 'CH-0200', NUMERO: 'DV-26-11-041', CLIENT: 'MME DUPONT', NATURE: 'CHANTIER' }            // un autre devis
]);

/* ---------- le tableau, avant ---------- */
let tab = g.tableauAdmin_();
let dv = (tab.devis || []).filter(x => x.numero === N)[0] || {};
T('le tableau dit que le devis d\'entretien est récurrent', dv.recurrent === true, dv);
T('… avec son rythme, son mensuel, sa nature et son adresse',
  dv.passagesMois === 4 && dv.mensuel === 960 && dv.nature === 'ENTRETIEN' && dv.adresse === '12 rue du Port', dv);
T('… et sans contrat pour l\'instant', dv.contrat === '', dv.contrat);
const dv2 = (tab.devis || []).filter(x => x.numero === 'DV-26-11-041')[0] || {};
T('un devis de fin de chantier n\'est pas récurrent', dv2.recurrent === false, dv2.recurrent);

/* ---------- mettre au calendrier ---------- */
const FICHE = { client: 'LE LOCAL', adresse: '12 rue du Port', cp: '56000', ville: 'Vannes',
  frequence: 'HEBDO', jours: [1], debut: '2026-11-09', heure: '18:00', duree: 120,
  prestataire: 'MAXIME', nature: 'ENTRETIEN', devis: N };
let r = g.recurrentNeuf_(Object.assign({}, FICHE), { nom: 'SIMON DIRECTION' });
T('la création répond oui', r.ok, r);
const s = series()[0] || {};
T('la série porte le numéro du devis', s.DEVIS === N, s.DEVIS);
T('… et son mensuel dans la note', /960,00 € HT par mois/.test(String(s.NOTE)), s.NOTE);
T('deux interventions sans date retirées', r.retires === 2, r);
T('une intervention datée un lundi rattachée', r.relies === 1, r);

const ch = chantiers();
T('les deux sans date ont disparu', !ch.some(c => c.ID === 'CH-0101' || c.ID === 'CH-0102'), ch.map(c => c.ID));
const c103 = ch.filter(c => c.ID === 'CH-0103')[0] || {};
T('celle du lundi 16 porte la clé de la série', c103.RECURRENT === s.ID + '|2026-11-16', c103.RECURRENT);
const le16 = ch.filter(c => iso(c.DATE) === '2026-11-16' && c.CLIENT === 'LE LOCAL');
T('aucun second passage le lundi 16', le16.length === 1, le16.map(c => c.ID));
const c104 = ch.filter(c => c.ID === 'CH-0104')[0] || {};
T('celle du mercredi reste, sans clé', c104.ID && !String(c104.RECURRENT || '').trim(), c104);
T('celle déjà commencée n\'est pas touchée', ch.some(c => c.ID === 'CH-0105' && !String(c.RECURRENT || '').trim()));
T('l\'autre devis n\'est pas touché', ch.some(c => c.ID === 'CH-0200'));
const lundis = ch.filter(c => String(c.RECURRENT).split('|')[0] === s.ID).map(c => iso(c.DATE)).sort();
T('les lundis suivants sont posés par la série', lundis.indexOf('2026-11-09') >= 0 && lundis.indexOf('2026-11-23') >= 0, lundis);

/* ---------- un devis, un contrat ---------- */
r = g.recurrentNeuf_(Object.assign({}, FICHE, { heure: '07:00' }), { nom: 'SIMON DIRECTION' });
T('une seconde demande pour le même devis est refusée', !r.ok && r.existe === s.ID, r);
r = g.recurrentNeuf_(Object.assign({}, FICHE, { devis: 'DV-00-00-000', heure: '06:00' }), { nom: 'SIMON DIRECTION' });
T('un devis inconnu est refusé', !r.ok && /introuvable/.test(r.erreur), r);

/* ---------- le tableau, après ---------- */
tab = g.tableauAdmin_();
dv = (tab.devis || []).filter(x => x.numero === N)[0] || {};
T('le tableau dit quel contrat porte le devis', dv.contrat === s.ID, dv.contrat);
const rc = (tab.recurrents || []).filter(x => x.id === s.ID)[0] || {};
T('le contrat dit de quel devis il vient', rc.devis === N, rc.devis);

/* ---------- la cloison ---------- */
const appel = (o) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(o) } }));
const rc2 = appel(Object.assign({ action: 'recurrentNeuf', nom: 'SIMON LG', code: 'ab1!', appareil: 'x' },
  FICHE, { devis: 'DV-26-11-041' }));
T('un commercial ne peut pas créer de contrat', !rc2.ok, rc2);

console.log(ok.length + ' points tenus' + (ko.length ? ', ' + ko.length + ' cassés :' : '.'));
ko.forEach(k => console.log('  ✗ ' + k));
process.exit(ko.length ? 1 : 0);
