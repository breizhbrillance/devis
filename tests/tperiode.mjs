/* v108zg — le planning au-delà de la fenêtre du tableau (24 novembre 2026).
   Simon : « je veux avoir les visuels sur 1 an ou 2 ans, là j'ai ajouté des
   presta en avril et rien ne s'affiche ».

   Ce que ces essais gardent :
   — le tableau dit jusqu'où sa liste de chantiers est complète ;
   — une intervention posée en avril 2027 n'est pas dans le tableau, mais
     chantiersPeriode la rend pour avril ;
   — les passages d'un contrat sans fin au-delà de l'horizon posé sont rendus
     « prévus », sans ligne au classeur ;
   — un contrat posé jusqu'à sa FIN ne fait pas de doublon prévu ;
   — un contrat tacite continue après sa FIN ; un contrat sans reconduction
     s'arrête à sa FIN ;
   — rien de prévu au-delà de deux ans ; une période trop longue est refusée ;
   — la cloison : un commercial qui demande une période est refusé. */
import { creer, lire, charger, horloge, sansInterface } from './gs.mjs';
import { CODE_GS } from './chemins.mjs';

const ok = [], ko = [];
const T = (n, c, d) => { (c ? ok : ko).push(n + (c ? '' : '  → ' + JSON.stringify(d))); };
horloge(new Date(2026, 10, 24, 16, 0, 0));
sansInterface(true);
const jour = (a, m, j) => new Date(a, m - 1, j, 12, 0, 0, 0);

const EN_R = ['ID', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'FREQUENCE', 'JOUR',
  'JOUR_MOIS', 'HEURE', 'DUREE_MIN', 'PRESTATAIRE', 'DEBUT', 'FIN', 'ACTIF',
  'NATURE', 'PRESTATIONS', 'NOTE', 'DEVIS', 'ENGAGEMENT_MOIS', 'RECONDUCTION', 'EXCLUSIONS'];
const EN_C = ['ID', 'NUMERO', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'DATE', 'HEURE',
  'PRESTATAIRE', 'STATUT', 'ARRIVEE', 'DEPART', 'MINUTES', 'PRESTATIONS_FAITES',
  'SIGNALEMENT', 'PHOTOS', 'NOTE', 'CREE_LE', 'DUREE_PREVUE_MIN', 'LOT', 'RECURRENT',
  'NATURE', 'AVANT_SIGNATURE'];
const R = (o) => EN_R.map(h => o[h] !== undefined ? o[h] : '');
const C = (o) => EN_C.map(h => o[h] !== undefined ? o[h] : '');

creer('RECURRENTS', [EN_R,
  // sans fin, chaque mardi 15 h
  R({ ID: 'R-001', CLIENT: 'SANS FIN', FREQUENCE: 'HEBDO', JOUR: 'MARDI', HEURE: '15:00', DUREE_MIN: 60,
      PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 11, 3), ACTIF: 'OUI', NATURE: 'ENTRETIEN' }),
  // quinzaine tacite, 12 mois, jusqu'au 23/11/2027
  R({ ID: 'R-002', CLIENT: 'BOIS BATI GESTION', FREQUENCE: 'QUINZAINE', JOUR: 'MARDI', HEURE: '15:00', DUREE_MIN: 120,
      PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 11, 24), FIN: jour(2027, 11, 23), ACTIF: 'OUI', NATURE: 'ENTRETIEN',
      DEVIS: 'DEV-BOBG', ENGAGEMENT_MOIS: 12, RECONDUCTION: 'TACITE' }),
  // jeudi, fin sèche au 30/06/2027
  R({ ID: 'R-003', CLIENT: 'FIN SECHE', FREQUENCE: 'HEBDO', JOUR: 'JEUDI', HEURE: '09:00', DUREE_MIN: 60,
      PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 11, 5), FIN: jour(2027, 6, 30), ACTIF: 'OUI', NATURE: 'ENTRETIEN',
      ENGAGEMENT_MOIS: 12, RECONDUCTION: 'NON' }),
  R({ ID: 'R-004', CLIENT: 'ETEINT', FREQUENCE: 'HEBDO', JOUR: 'LUNDI', HEURE: '09:00', DUREE_MIN: 60,
      PRESTATAIRE: 'MAXIME', DEBUT: jour(2026, 11, 2), ACTIF: 'NON' })
]);
creer('CHANTIERS', [EN_C,
  C({ ID: 'CH-0001', CLIENT: 'VITRES AVRIL', DATE: jour(2027, 4, 14), HEURE: '10:00', PRESTATAIRE: 'MAXIME',
      STATUT: 'PLANIFIE', NATURE: 'VITRERIE' }),
  C({ ID: 'CH-0002', CLIENT: 'DEMAIN', DATE: jour(2026, 11, 25), HEURE: '10:00', PRESTATAIRE: 'MAXIME', STATUT: 'PLANIFIE' }),
  C({ ID: 'CH-0003', CLIENT: 'ANNULE AVRIL', DATE: jour(2027, 4, 15), HEURE: '10:00', PRESTATAIRE: 'MAXIME', STATUT: 'ANNULE' })
]);
creer('DEVIS', [['NUMERO', 'DATE', 'COMMERCIAL', 'CLIENT', 'TOTAL_HT', 'STATUT', 'SIGNE', 'NATURE']]);
creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['societe_nom', 'BREIZH BRILLANCE', '']]);
creer('JOURNAL', [['HORODATAGE', 'MOMENT', 'COMMERCIAL', 'ACTION', 'DETAIL', 'NUMERO', 'APPAREIL', 'SOURCE']]);
creer('PRESTATAIRES', [['NOM', 'EMAIL', 'CODE', 'ACTIF', 'TELEPHONE'], ['MAXIME', 'm@bb.fr', 'kw7!', 'OUI', '0600000001']]);
creer('ADMINS', [['NOM', 'EMAIL', 'CODE', 'ACTIF', 'INITIALES'], ['SIMON DIRECTION', 'd@bb.fr', 'qx4$', 'OUI', 'SD']]);
creer('COMMERCIAUX', [['NOM', 'EMAIL', 'CODE', 'ACTIF'], ['SIMON LG', 's@bb.fr', 'ab1!', 'OUI']]);
creer('CATALOGUE', [['CATEGORIE', 'DESIGNATION', 'DETAIL', 'UNITE', 'PU_HT', 'TVA', 'TYPE', 'ACTIF', 'REFERENCE']]);
creer('ABSENCES', [['PRESTATAIRE', 'DU', 'AU']]);
const g = charger(CODE_GS);
g.genererRecurrents_();
const lignes = lire('CHANTIERS').slice(1).filter(l => String(l[0] || '').trim());
const cles = lignes.map(l => String(l[EN_C.indexOf('RECURRENT')] || '')).filter(Boolean);
T('la nuit pose R-002 jusqu\'à sa FIN (23/11/2027)', cles.some(k => k === 'R-002|2027-11-23'), cles.filter(k => k.startsWith('R-002')).slice(-2));
T('la nuit pose R-001 (sans fin) sur un an', cles.includes('R-001|2027-11-23') && !cles.includes('R-001|2027-11-30'), cles.filter(k => k.startsWith('R-001')).slice(-1));
T('la nuit pose R-003 jusqu\'à sa FIN (jeudi 24/06/2027)', cles.includes('R-003|2027-06-24') && !cles.some(k => k.startsWith('R-003|2027-07')));

/* Le tableau */
const tab = g.tableauAdmin_();
T('le tableau dit sa fenêtre (J-30 → J+90)', tab.chantiersDu === '2026-10-25' && tab.chantiersAu === '2027-02-22', [tab.chantiersDu, tab.chantiersAu]);
T('l\'intervention d\'avril n\'est pas dans le tableau', !tab.chantiers.some(c => c.id === 'CH-0001'));

/* Avril 2027 : la grille du lundi 29 mars au dimanche 2 mai */
const p = g.chantiersPeriode_({ du: '2027-03-29', au: '2027-05-02' });
T('période d\'avril : ok', p.ok, p);
T('l\'intervention d\'avril est rendue, avec sa nature', p.chantiers.some(c => c.id === 'CH-0001' && c.date === '2027-04-14' && c.nature === 'VITRERIE'), p.chantiers.map(c => c.id));
T('l\'annulée aussi (l\'écran la range à part)', p.chantiers.some(c => c.id === 'CH-0003'));
T('les passages posés de R-002 sont de vrais chantiers', p.chantiers.filter(c => String(c.recurrent).startsWith('R-002|')).length >= 2);
T('R-002 n\'a aucun prévu en avril (déjà posé)', !p.prevus.some(x => x.contrat === 'R-002'), p.prevus.filter(x => x.contrat === 'R-002'));
T('R-001 : les mardis d\'avril sont de vrais chantiers, sans prévu', p.chantiers.filter(c => String(c.recurrent).startsWith('R-001|2027-04')).length === 4 && !p.prevus.some(x => x.contrat === 'R-001'),
  p.chantiers.filter(c => String(c.recurrent).startsWith('R-001')).map(c => c.date));
T('R-003 : les jeudis d\'avril sont posés (FIN en juin), pas prévus', !p.prevus.some(x => x.contrat === 'R-003'));
T('R-004 éteint : rien', !p.prevus.some(x => x.contrat === 'R-004') && !p.chantiers.some(c => String(c.recurrent).startsWith('R-004')));

/* Décembre 2027 : après les FIN */
const q = g.chantiersPeriode_({ du: '2027-11-29', au: '2028-01-02' });
const q2 = q.prevus.filter(x => x.contrat === 'R-002');
const q1 = q.prevus.filter(x => x.contrat === 'R-001');
T('R-001 : après l\'année posée, les mardis sont prévus, à 15 h', q1.length === 5 && q1.every(x => x.heure === '15:00' && new Date(x.date + 'T12:00:00').getDay() === 2 && x.prevu && !x.reconduction),
  q1.map(x => x.date + ' ' + x.heure));
T('R-001 prévu : id, client, nature, salarié', q1[0] && q1[0].id === 'P|R-001|2027-11-30' && q1[0].client === 'SANS FIN' && q1[0].nature === 'ENTRETIEN' && q1[0].prestataire === 'MAXIME', q1[0]);
T('R-002 tacite continue après son échéance, une quinzaine', q2.length >= 2 && q2.every(x => x.reconduction), q2.map(x => x.date));
T('R-002 garde sa semaine : 7/12/2027 (23/11 + 14 j)', q2.some(x => x.date === '2027-12-07'), q2.map(x => x.date));
T('R-003 sans reconduction : rien après sa FIN', !q.prevus.some(x => x.contrat === 'R-003'));

/* Les bornes */
const loin = g.chantiersPeriode_({ du: '2029-01-01', au: '2029-01-31' });
T('rien de prévu au-delà de deux ans', loin.ok && loin.prevus.length === 0, loin.prevus.length);
const trop = g.chantiersPeriode_({ du: '2027-01-01', au: '2027-06-30' });
T('une période de six mois est refusée', !trop.ok);
const passe = g.chantiersPeriode_({ du: '2026-11-23', au: '2026-11-29' });
T('rien de prévu dans le passé ni dans la semaine déjà posée', passe.ok && passe.prevus.length === 0, passe.prevus);
T('la semaine en cours rend ses vrais chantiers', passe.chantiers.some(c => c.id === 'CH-0002'));

/* La cloison, par doPost */
const post = (corps) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(corps) } }));
const ad = post({ action: 'chantiersPeriode', nom: 'SIMON DIRECTION', code: 'qx4$', du: '2027-03-29', au: '2027-05-02' });
T('le gérant lit la période par l\'appli', ad.ok && ad.chantiers.some(c => c.id === 'CH-0001'), ad);
const co = post({ action: 'chantiersPeriode', nom: 'SIMON LG', code: 'ab1!', du: '2027-03-29', au: '2027-05-02' });
T('un commercial est refusé', !co.ok, co);
const ag = post({ action: 'chantiersPeriode', nom: 'MAXIME', code: 'kw7!', du: '2027-03-29', au: '2027-05-02' });
T('un salarié est refusé', !ag.ok, ag);

/* Le réglage à NON rend l'ancien comportement : 8 semaines pour un contrat sans fin. */
creer('REGLAGES', [['CLE', 'VALEUR', 'NOTE'], ['recurrents_duree_contrat', 'NON', '']]);
const reg = g.lireReglages_();
const hz = g.horizonContrat_({ ID: 'X', DEBUT: jour(2026, 11, 3) }, new Date(2026, 10, 24), reg);
T('réglage NON : contrat sans fin posé sur 8 semaines', hz.getFullYear() === 2027 && hz.getMonth() === 0 && hz.getDate() === 19, String(hz));
const hzE = g.horizonContrat_({ ID: 'X', DEBUT: jour(2026, 11, 3), ENGAGEMENT_MOIS: 24 },
  new Date(2026, 10, 24), { recurrents_duree_contrat: 'OUI' });
T('engagement de 24 mois sans fin : posé jusqu\'au 2/11/2028', hzE.getFullYear() === 2028 && hzE.getMonth() === 10 && hzE.getDate() === 2, String(hzE));

console.log(ok.length + '/' + (ok.length + ko.length) + ' essais passés');
ko.forEach(k => console.log('  ÉCHEC ' + k));
process.exit(ko.length ? 1 : 0);
