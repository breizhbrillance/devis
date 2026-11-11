/****************************************************************
 * DEVIS NETTOYAGE — Backend Google Apps Script
 * À coller dans le Google Sheet (Extensions > Apps Script).
 *
 * Rôle : servir le catalogue à l'application mobile, et recevoir
 * les devis que les téléphones envoient quand ils retrouvent du réseau.
 * L'application, elle, est hébergée à part et fonctionne hors connexion.
 *
 * Onglets : REGLAGES, CATALOGUE, COMMERCIAUX, DEVIS, LIGNES
 ****************************************************************/

var SH = {
  REGLAGES: 'REGLAGES',
  CATALOGUE: 'CATALOGUE',
  COMMERCIAUX: 'COMMERCIAUX',
  DEVIS: 'DEVIS',
  LIGNES: 'LIGNES',
  JOURNAL: 'JOURNAL',
  FACTURER: 'A FACTURER',
  /* Les factures préparées chez Henrri. « A FACTURER » dit ce qui reste à
     facturer ; FACTURES garde ce qui est parti, et c'est elle qui empêche
     d'envoyer deux fois la même mensualité. */
  FACTURES: 'FACTURES',
  BORD: 'TABLEAU DE BORD',
  PRESTATAIRES: 'PRESTATAIRES',
  CHANTIERS: 'CHANTIERS',
  ADMINS: 'ADMINS',
  ABSENCES: 'ABSENCES',
  COMMUNES: 'COMMUNES',
  /* La prospection téléphonique. PROSPECTS porte une ligne par entreprise à
     appeler : les coordonnées recopiées du fichier de prospection, et le suivi
     que les commerciaux y ajoutent au fil des appels. APPELS garde chaque
     tentative, pour qu'un statut ne soit jamais le seul témoin de ce qui s'est
     passé — un « pas intéressé » posé par erreur se relit dans le journal. */
  PROSPECTS: 'PROSPECTS',
  APPELS: 'APPELS',
  /* Les contrats d'entretien qui reviennent tout seuls. Un chantier naît
     normalement d'un devis signé ; ceux-là viennent d'un engagement pris
     avant l'application, ou sans devis dans l'application. L'onglet décrit la
     série — qui, où, quel jour, à quelle heure, à quel rythme — et le classeur
     en tire les chantiers des semaines qui viennent. */
  RECURRENTS: 'RECURRENTS'
};

/* Les prospects sont communs à toute l'équipe (choix de Simon, 8 octobre 2026) :
   un prospect appelé par l'un sort de la file de l'autre. La colonne COMMERCIAL
   dit qui a appelé en dernier, elle n'attribue rien.
   ID est la clé : « commune-societe » mis à plat. Il ne change pas quand on
   réimporte le fichier de prospection, c'est ce qui permet de recopier les
   coordonnées sans perdre le suivi. */
var ENTETES_PROSPECTS_ = [
  'ID', 'SIREN', 'COMMUNE', 'ZONE', 'SOCIETE', 'SECTEUR', 'ACTIVITE', 'DIRIGEANT',
  'TEL', 'MAIL', 'SITE', 'ADRESSE', 'EFFECTIF', 'PRIORITE',
  'SOURCE_HORAIRES', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM', 'COMMENTAIRE',
  'STATUT', 'NOTE', 'RAPPEL_LE', 'RDV_LE', 'DERNIER_APPEL', 'NB_APPELS', 'COMMERCIAL', 'MAJ_LE'
];

/* Une ligne par tentative, jamais réécrite. */
var ENTETES_APPELS_ = [
  'HORODATAGE', 'COMMERCIAL', 'ID_PROSPECT', 'SOCIETE', 'COMMUNE',
  'RESULTAT', 'NOTE', 'RAPPEL_LE', 'APPAREIL', 'RDV_LE'
];

/* Les sept résultats possibles d'un appel, et rien d'autre : le téléphone ne
   peut pas inventer un statut, et un code inconnu est refusé côté serveur. */
var RESULTATS_APPEL_ = ['nrp', 'msg', 'rappel', 'interesse', 'rdv', 'refus', 'faux'];

/* Les agents qui exécutent le travail. Feuille séparée des COMMERCIAUX : ce ne
   sont pas les mêmes gens, pas les mêmes droits, et surtout pas les mêmes
   données envoyées à leur téléphone. */
/* JOURS, PLAGES et HEURES_SEMAINE décrivent la disponibilité du salarié ; sans
   elles, le planning ne saurait pas quel jour poser quoi. Vides, on retombe sur
   du lundi au vendredi, 8h-12h / 14h-17h, 35 heures. */
/* PLANIFIABLE : l'application a-t-elle le droit de lui poser du travail
   d'elle-même, quand un devis est signé ? OUI par défaut, et NON pour
   quelqu'un qui fait des chantiers sans être sur le planning tournant — le
   gérant qui dépanne, le commercial qui pose lui-même ses vitrages. Celui-là
   voit son planning sur son téléphone, mais rien ne s'y ajoute tout seul. */
var ENTETES_PRESTATAIRES_ = ['NOM', 'EMAIL', 'CODE', 'ACTIF', 'TELEPHONE',
                             'JOURS', 'PLAGES', 'HEURES_SEMAINE', 'PLANIFIABLE'];
/* Les comptes qui voient tout : les plannings de chacun, les devis de chacun,
   et les chiffres. Mêmes colonnes que les deux autres populations, pour que
   la façon d'ajouter ou de retirer quelqu'un ne change jamais. */
/* INITIALES : depuis la v82 le gerant etablit lui-meme des devis depuis son
   tableau, et un numero de devis porte les initiales de qui l'a fait. Vide,
   elles se devinent du nom, comme pour un commercial. */
var ENTETES_ADMINS_ = ['NOM', 'EMAIL', 'CODE', 'ACTIF', 'INITIALES'];

/* Les jours où l'on ne pose rien : congés d'un salarié, ou fermeture de la
   maison quand PRESTATAIRE est vide ou vaut TOUS. Volontairement sans motif :
   le planning a besoin de savoir QUAND quelqu'un est absent, jamais POURQUOI,
   et un motif d'absence n'a rien à faire dans un classeur partagé. */
var ENTETES_ABSENCES_ = ['PRESTATAIRE', 'DU', 'AU'];

/* Une ligne par intervention. Naît d'un devis signé, se remplit sur le terrain. */
var ENTETES_CHANTIERS_ = [
  'ID', 'NUMERO', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES',
  'DATE', 'HEURE', 'PRESTATAIRE', 'STATUT',
  'ARRIVEE', 'DEPART', 'MINUTES', 'PRESTATIONS_FAITES', 'SIGNALEMENT',
  'PHOTOS', 'NOTE', 'CREE_LE',
  /* DUREE_PREVUE_MIN : ce que l'appli a calculé, en minutes, et que le gérant
     peut corriger. MINUTES, juste au-dessus, est tout autre chose : le temps
     réellement pointé par le salarié. LOT dit « 2/3 » quand un chantier a été
     découpé sur plusieurs journées. */
  /* RECURRENT porte la clé de l'occurrence qui a produit ce chantier,
     « R-001|2026-10-16 ». C'est elle qui empêche la génération de le poser
     deux fois, et elle seule : la date et le client ne suffiraient pas, un
     client pouvant avoir deux passages le même jour. Vide sur un chantier
     né d'un devis. */
  /* NATURE : entretien, vitrages, fin de chantier, remise en état, façade.
     Elle vivait sur le devis seul ; un chantier récurrent n'en avait donc
     aucune. Recopiée ici à la création, elle sert à colorer le planning. */
  /* AVANT_SIGNATURE : « OUI » sur un chantier que le gérant a posé sans
     attendre que le devis soit déclaré signé. Un commercial ne déclare pas
     toujours la signature le jour même, et le client, lui, attend sa date.
     Cette marque ne change rien pour le salarié — il voit un chantier comme un
     autre, savoir si le papier est signé n'est pas son affaire. Elle sert au
     gérant, qui voit d'un coup d'œil ce qui n'est pas encore fermé, et elle
     retient l'annulation automatique : un devis refusé emporte les chantiers
     nés d'une signature, jamais ceux-là, que le gérant décide lui-même de
     garder ou non. Effacée le jour où le devis est enfin signé. */
  'DUREE_PREVUE_MIN', 'LOT', 'RECURRENT', 'NATURE', 'AVANT_SIGNATURE',
  /* v101 — la fiche chantier jointe par le gérant (PDF ou photo) : FICHE porte
     le lien Drive, FICHE_NOM le nom du fichier. Le salarié la lit par l'appli,
     jamais par un lien public : elle porte des codes d'accès et des adresses. */
  'FICHE', 'FICHE_NOM'
];

/* La série récurrente. JOUR vaut LUNDI..DIMANCHE pour les fréquences
   hebdomadaires ; JOUR_MOIS vaut 1 à 31 pour la fréquence mensuelle.
   FREQUENCE : HEBDO, QUINZAINE (une semaine sur deux, comptée depuis DEBUT),
   MENSUEL. FIN vide = sans terme. PRESTATIONS est la fiche de travail : sans
   devis derrière, c'est le seul endroit où dire au salarié ce qu'il fait. */
var ENTETES_RECURRENTS_ = [
  'ID', 'CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES',
  'FREQUENCE', 'JOUR', 'JOUR_MOIS', 'HEURE', 'DUREE_MIN',
  'PRESTATAIRE', 'DEBUT', 'FIN', 'ACTIF', 'NATURE', 'PRESTATIONS', 'NOTE',
  /* Ajoutées le 7 novembre 2026, pour reprendre FamilyWall tel qu'il est :
     EXCLUSIONS, les dates sautées (« 2026-12-06, 2027-02-06 ») — un passage
     déplacé à la main dans FamilyWall laisse un trou dans la série ;
     INTERVALLE, tous les combien de mois pour un MENSUEL (vide = 1, 2 = un
     mois sur deux, compté depuis le mois du DÉBUT). Et un MENSUEL qui porte
     un JOUR lit JOUR_MOIS comme un rang : JEUDI + 3 = le 3e jeudi du mois,
     JEUDI + 5 = le dernier. */
  'EXCLUSIONS', 'INTERVALLE',
  /* Le devis d'où vient le contrat, quand il vient d'un devis signé : c'est
     lui qui empêche d'écrire deux fois le même contrat. */
  'DEVIS',
  /* v101 — la fiche chantier du contrat, recopiée sur chaque passage. */
  'FICHE', 'FICHE_NOM',
  /* v103 — l'engagement : durée en mois et reconduction (TACITE / NON). */
  'ENGAGEMENT_MOIS', 'RECONDUCTION'
];

/* A PLANIFIER : le devis est signé, personne ni date encore posés.
   PLANIFIE : date et agent en place, l'agent le voit dans son planning.
   EN COURS : l'agent a pointé son arrivée.
   FAIT : il a pointé son départ.
   PROBLEME : il a signalé quelque chose — le chantier reste à regarder.
   ANNULE : le devis n'est plus signé, ou le gérant a retiré le passage. La
   fiche reste dans la feuille pour mémoire, mais ne compte plus nulle part. */
var STATUTS_CHANTIER_ = ['A PLANIFIER', 'PLANIFIE', 'EN COURS', 'FAIT', 'PROBLEME', 'ANNULE'];

/* RDV est une nature de CHANTIER, jamais une nature de DEVIS : on ne vend pas
   un rendez-vous. Elle n'entre donc ni dans « naturesCatalogue_ » ni dans
   « natureDevis_ », et un devis ne peut pas la porter. Elle existe pour que le
   commercial pose sur son planning ce qui l'occupe vraiment — une visite, un
   relevé — sans que cela ressemble à du ménage à faire.
   Un rendez-vous n'entre pas davantage dans « À FACTURER », qui se construit
   depuis les devis signés et ignore CHANTIERS. */
var NATURE_RDV_ = 'RDV';

var ENTETES_JOURNAL_ = [
  'HORODATAGE', 'MOMENT', 'COMMERCIAL', 'ACTION', 'DETAIL', 'NUMERO', 'APPAREIL', 'SOURCE'
];

/* ============================ MENU ============================ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Devis')
    .addItem('1. Initialiser le fichier', 'initialiser')
    .addItem('2. Afficher l\'adresse de synchronisation', 'afficherLien')
    .addItem('3. Vérifier les codes des commerciaux', 'verifierCodes')
    .addItem('4. Proposer un code conforme', 'proposerCode')
    .addItem('5. Tester (devis fictif)', 'testerDevis')
    .addItem('6. Mettre à jour la structure du fichier', 'majStructure')
    .addItem('7. Charger la grille de prix', 'chargerGrillePrix')
    .addItem('7 bis. Compléter le catalogue (ajouter les nouveautés)', 'completerCatalogue')
    .addItem('8. Purger le journal des actions', 'purgerJournal')
    .addItem('9. Mesurer la distance des communes', 'mesurerCommunes')
    .addSeparator()
    .addItem('10. Rafraîchir « À facturer » et le tableau de bord', 'rafraichirSuivi')
    .addItem('11. Activer le rappel quotidien aux commerciaux', 'activerAutomate')
    .addItem('12. Arrêter le rappel quotidien', 'arreterAutomate')
    .addSeparator()
    .addItem('13. Importer les prospects à appeler', 'importerProspects')
    .addItem('14. Reporter les statuts dans le fichier de prospection', 'reporterStatuts')
    .addItem('15. Mettre à jour la base de prospects maintenant', 'majBaseProspects')
    .addItem('16. Activer la mise à jour automatique (lun/mer/ven)', 'activerMajProspects')
    .addItem('17. Arrêter la mise à jour automatique', 'arreterMajProspects')
    .addSeparator()
    .addItem('18. Poser le planning des contrats récurrents', 'genererRecurrents')
    .addSeparator()
    .addItem('19. Connecter Henrri (facturation)', 'connecterHenrri')
    .addItem('20. Tester la connexion Henrri', 'testerHenrri')
    .addItem('21. Oublier les clés Henrri', 'oublierHenrri')
    .addSeparator()
    .addItem('22. Connecter les notifications', 'connecterNotifications')
    .addItem('23. Tester une notification', 'testerNotification')
    .addItem('24. Oublier la clé des notifications', 'oublierNotifications')
    .addSeparator()
    .addItem('25. Connecter Pennylane (facturation)', 'connecterPennylane')
    .addItem('26. Tester la connexion Pennylane', 'testerPennylane')
    .addItem('27. Oublier la clé Pennylane', 'oublierPennylane')
    .addItem('28. Remplir l\'onglet CONTRATS (depuis RECURRENTS)', 'menuConstruireContrats')
    .addItem('29. Brouillons Pennylane : les contrats du mois', 'menuBrouillonsContrats')
    .addItem('30. Brouillons Pennylane : les chantiers terminés', 'menuBrouillonsPonctuels')
    .addItem('31. Activer la préparation automatique des brouillons', 'activerPreparationAuto')
    .addItem('32. Arrêter la préparation automatique', 'arreterPreparationAuto')
    .addItem('33. Importer les téléphones des clients (Pennylane, Henrri)', 'importerTelephones')
    .addItem('34. Reprendre les contrats en place comme devis signés', 'reprendreContratsEnDevis')
    .addItem('35. Autoriser l\'envoi des mails par Gmail', 'autoriserEnvoiGmail')
    .addToUi();
}

function afficherLien() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url
    ? 'Adresse à coller dans le fichier config.js de l\'application :\n\n' + url
    : 'Pas encore déployé : Déployer > Nouveau déploiement > Application Web.');
}

/* ===================== CODES DES COMMERCIAUX =====================
   Règle : au moins 4 caractères, dont un chiffre et un caractère spécial.
   L'application refuse tout code qui ne la respecte pas.               */

function codeConforme_(c) {
  c = String(c);
  return c.length >= 4 && /[0-9]/.test(c) && /[^A-Za-z0-9]/.test(c);
}

/** Surligne les codes non conformes dans l'onglet COMMERCIAUX. */
function verifierCodes() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.COMMERCIAUX);
  if (!sh || sh.getLastRow() < 2) return;
  var n = sh.getLastRow() - 1;
  var plage = sh.getRange(2, 3, n, 1);
  var codes = plage.getValues();
  var fonds = [], mauvais = [];
  codes.forEach(function (r, i) {
    var ok = codeConforme_(r[0]);
    fonds.push([ok ? null : '#fde2e1']);
    if (!ok) mauvais.push(sh.getRange(i + 2, 1).getValue() + ' (ligne ' + (i + 2) + ')');
  });
  plage.setBackgrounds(fonds);
  SpreadsheetApp.getUi().alert(mauvais.length
    ? 'Codes à corriger (4 caractères minimum, dont un chiffre et un caractère spécial) :\n\n• ' +
      mauvais.join('\n• ') + '\n\nCes commerciaux ne pourront pas se connecter tant que leur code n\'est pas conforme.'
    : 'Tous les codes respectent la règle.');
}

/** Génère un code conforme, facile à dicter au téléphone. */
function proposerCode() {
  SpreadsheetApp.getUi().alert('Code proposé : ' + genererCode_() +
    '\n\nCopie-le dans la colonne CODE du commercial concerné, puis transmets-le lui.');
}

function genererCode_() {
  var lettres = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // sans I ni O, pour éviter les confusions
  var chiffres = '23456789';
  var speciaux = '!?*#&-+';
  function pioche(s) { return s.charAt(Math.floor(Math.random() * s.length)); }
  var c = [pioche(lettres), pioche(lettres).toLowerCase(), pioche(chiffres), pioche(speciaux), pioche(chiffres)];
  return c.join('');
}

/* ======================= INITIALISATION ======================= */

function initialiser() {
  var ss = SpreadsheetApp.getActive();

  creerOnglet_(ss, SH.REGLAGES, ['CLE', 'VALEUR', 'COMMENTAIRE']);
  creerOnglet_(ss, SH.CATALOGUE, ENTETES_CATALOGUE_);
  creerOnglet_(ss, SH.COMMERCIAUX, ENTETES_COMMERCIAUX_);
  creerOnglet_(ss, SH.PRESTATAIRES, ENTETES_PRESTATAIRES_);
  creerOnglet_(ss, SH.ADMINS, ENTETES_ADMINS_);
  creerOnglet_(ss, SH.CHANTIERS, ENTETES_CHANTIERS_);
  creerOnglet_(ss, SH.DEVIS, ENTETES_DEVIS_);
  creerOnglet_(ss, SH.LIGNES, ENTETES_LIGNES_);
  creerOnglet_(ss, SH.JOURNAL, ENTETES_JOURNAL_);

  var reg = ss.getSheetByName(SH.REGLAGES);
  if (reg.getLastRow() < 2) {
    reg.getRange(2, 1, REGLAGES_DEFAUT_.length, 3).setValues(REGLAGES_DEFAUT_);
    reg.setColumnWidth(1, 190); reg.setColumnWidth(2, 340); reg.setColumnWidth(3, 330);
  }
  if (!String(lireReglages_().sel_codes || '').trim()) {
    ecrireReglage_('sel_codes', Utilities.getUuid());
  }

  var cat = ss.getSheetByName(SH.CATALOGUE);
  if (cat.getLastRow() < 2) {
    var grille0 = grilleComplete_();
    cat.getRange(2, 1, grille0.length, ENTETES_CATALOGUE_.length).setValues(grille0);
    cat.setColumnWidth(2, 260); cat.setColumnWidth(3, 300);
  }

  var com = ss.getSheetByName(SH.COMMERCIAUX);
  if (com.getLastRow() < 2) com.getRange(2, 1, 1, 4).setValues([['Commercial 1', '', genererCode_(), 'OUI']]);

  SpreadsheetApp.getUi().alert(
    'Fichier initialisé.\n\n' +
    '1) REGLAGES : tes infos de société (elles s\'impriment sur le devis).\n' +
    '2) CATALOGUE : tes prestations et tes prix.\n' +
    '3) COMMERCIAUX : un par ligne, avec son code personnel\n   (4 caractères minimum, dont un chiffre et un caractère spécial).\n\n' +
    'Ensuite : Déployer > Nouveau déploiement > Application Web ' +
    '(exécuter en tant que Moi, accès Tout le monde).'
  );
}

function creerOnglet_(ss, nom, entetes) {
  var sh = ss.getSheetByName(nom) || ss.insertSheet(nom);
  if (sh.getLastRow() === 0 || String(sh.getRange(1, 1).getValue()).trim() === '') {
    sh.getRange(1, 1, 1, entetes.length).setValues([entetes])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* Le TELEPHONE du commercial : c'est celui qui part dans le mot adresse au
   client avec son devis, pour qu'il rappelle celui qui est venu chez lui.
   Vide, c'est le numero de la societe (reglage societe_tel) qui sert. */
var ENTETES_COMMERCIAUX_ = ['NOM', 'EMAIL', 'CODE', 'ACTIF', 'INITIALES', 'TELEPHONE'];

var ENTETES_DEVIS_ = [
  'NUMERO', 'DATE', 'COMMERCIAL', 'CLIENT', 'TYPE_CLIENT', 'SIRET_CLIENT', 'TVA_CLIENT',
  'CONTACT', 'TELEPHONE', 'EMAIL', 'ADRESSE', 'CP', 'VILLE',
  'TOTAL_HT_PONCTUEL', 'TOTAL_HT_MENSUEL', 'TOTAL_HT', 'TOTAL_TVA', 'TOTAL_TTC',
  'REMISE_PCT', 'STATUT', 'SIGNE', 'SIGNATAIRE', 'VALIDITE', 'LIEN_PDF', 'PHOTOS', 'NOTES',
  'RECU_LE', 'ID_APPAREIL', 'ID_DEVIS', 'OBJET', 'LOGEMENT_PLUS_2_ANS', 'TAUX_TVA', 'DELAI',
  'DATE_SOUHAITEE',
  'MOTIF_REFUS', 'RELANCE_LE', 'DATE_STATUT', 'PREUVE_SIGNATURE', 'NOTE_COMMERCIAL',
  'CONTROLE_TARIF', 'PASSAGES_MOIS', 'NATURE',
  /* TRES_SALE ou NORMAL : ce que le commercial a coché sur place, et qui
     justifie la ligne de majoration du devis. */
  'ETAT_SITE',
  /* Le numéro que portait le devis avant d'être signé : en signant, il en
     reçoit un neuf (mois de signature, suffixe / S). C'est par cette colonne
     qu'on retrouve le devis quand le client rappelle avec le numéro de
     l'exemplaire qu'il a reçu avant de signer. */
  'NUMERO_ORIGINE',
  /* Distance routière entre l'agence et le client, en kilomètres. Elle ne sert
     que sur un contrat d'entretien, où chaque passage est un trajet. */
  'KM_AGENCE',
  /* PROSPECTION ou ENTRANT : d'où vient ce client. Ne commande rien ; sert à
     savoir ce que la prospection de terrain rapporte vraiment. */
  'ORIGINE',
  /* CLIENT ou AGENCE : où le devis a été signé. C'est lui, et non l'origine de
     l'appel, qui fait le contrat hors établissement et commande le formulaire
     de rétractation du devis imprimé (art. L221-1 du Code de la consommation,
     « y compris à la suite d'une sollicitation du consommateur »). Vide sur un
     devis professionnel, qui n'ouvre pas ce droit. */
  'LIEU_SIGNATURE',
  /* v103 — la durée d'engagement d'un contrat (mois, vide = sans engagement)
     et sa reconduction (TACITE ou NON). */
  'ENGAGEMENT_MOIS', 'RECONDUCTION',
  /* v106 — « Entretien des locaux (sans contrat) » : mêmes prestations, mais
     quelques passages vendus comme une intervention, jamais un contrat. */
  'SANS_CONTRAT',
  /* v108e — « 2026-11-20 09:00 » : où le commercial verrait l'intervention.
     Interne : ne s'imprime pas, proposé en premier au placement. */
  'PLACEMENT_SUGGERE'
];

/* Les états qu'un devis peut prendre, dans l'ordre de la vie réelle.
   REMIS : imprimé et laissé au client, résultat encore inconnu.
   SIGNE : accepté — la preuve est la photo du papier signé.
   A RELANCER : le client réfléchit, une date de relance est posée.
   REFUSE : perdu, avec son motif. EXPIRE : validité dépassée sans réponse. */
var STATUTS_ = ['REMIS', 'SIGNE', 'A RELANCER', 'REFUSE', 'EXPIRE'];

/* Les communes du secteur et leur distance routière depuis l'agence. Le
   téléphone reçoit cette table à la connexion : il chiffre le devis chez le
   client, souvent sans réseau, et ne peut pas interroger Google Maps à ce
   moment-là. SOURCE dit d'où vient le chiffre — MAPS, ou le commercial qui
   l'a saisi pour une commune que la table ne connaissait pas encore. */
var ENTETES_COMMUNES_ = ['CP', 'VILLE', 'KM', 'SOURCE', 'CALCULE_LE'];

var ENTETES_LIGNES_ = [
  'NUMERO', 'ORDRE', 'CATEGORIE', 'REFERENCE', 'DESIGNATION', 'DETAIL', 'QTE', 'UNITE',
  'PU_HT', 'REMISE_PCT', 'TYPE', 'TVA', 'TOTAL_HT'
];

/**
 * Ajoute ce qui manque à un fichier déjà en service, sans toucher aux données :
 * les colonnes client professionnel, et les réglages apparus après coup.
 * Appelée automatiquement à chaque devis reçu — elle ne fait rien si tout est là.
 */
function majStructure() {
  majStructure_();
  SpreadsheetApp.getUi().alert('Structure à jour.');
}

function majStructure_() {
  var ss = SpreadsheetApp.getActive();
  var shD = ss.getSheetByName(SH.DEVIS);
  if (shD && shD.getLastColumn() > 0) {
    var en = shD.getRange(1, 1, 1, shD.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    if (en.indexOf('TYPE_CLIENT') < 0) {
      var apres = en.indexOf('CLIENT') >= 0 ? en.indexOf('CLIENT') + 1 : shD.getLastColumn();
      shD.insertColumnsAfter(apres, 3);
      shD.getRange(1, apres + 1, 1, 3)
        .setValues([['TYPE_CLIENT', 'SIRET_CLIENT', 'TVA_CLIENT']])
        .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
      en = shD.getRange(1, 1, 1, shD.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); });
    }
    // toute colonne prévue et encore absente est ajoutée à la fin,
    // sans jamais déplacer celles qui portent déjà des données
    ENTETES_DEVIS_.forEach(function (h) {
      if (en.indexOf(h) >= 0) return;
      var c = shD.getLastColumn() + 1;
      shD.getRange(1, c).setValue(h)
        .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
      en.push(h);
    });
  }
  // Les deux onglets de l'espace prestataire, créés s'ils manquent.
  creerOnglet_(ss, SH.PRESTATAIRES, ENTETES_PRESTATAIRES_);
  creerOnglet_(ss, SH.ADMINS, ENTETES_ADMINS_);
  creerOnglet_(ss, SH.CHANTIERS, ENTETES_CHANTIERS_);
  creerOnglet_(ss, SH.ABSENCES, ENTETES_ABSENCES_);
  creerOnglet_(ss, SH.COMMUNES, ENTETES_COMMUNES_);
  creerOnglet_(ss, SH.PROSPECTS, ENTETES_PROSPECTS_);
  creerOnglet_(ss, SH.APPELS, ENTETES_APPELS_);
  creerOnglet_(ss, SH.RECURRENTS, ENTETES_RECURRENTS_);
  [[SH.PRESTATAIRES, ENTETES_PRESTATAIRES_], [SH.CHANTIERS, ENTETES_CHANTIERS_],
   [SH.RECURRENTS, ENTETES_RECURRENTS_],
   [SH.ADMINS, ENTETES_ADMINS_], [SH.COMMUNES, ENTETES_COMMUNES_],
   [SH.PROSPECTS, ENTETES_PROSPECTS_], [SH.APPELS, ENTETES_APPELS_],
   [SH.COMMERCIAUX, ENTETES_COMMERCIAUX_]]
    .forEach(function (o) {
      var sh2 = ss.getSheetByName(o[0]);
      if (!sh2 || sh2.getLastColumn() === 0) return;
      var en2 = sh2.getRange(1, 1, 1, sh2.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); });
      o[1].forEach(function (h) {
        if (en2.indexOf(h) >= 0) return;
        var c = sh2.getLastColumn() + 1;
        sh2.getRange(1, c).setValue(h)
          .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
        en2.push(h);
      });
    });

  // Le catalogue porte une REFERENCE : c'est elle qui permet au classeur de
  // retrouver le tarif officiel d'une ligne reçue. Elle est ajoutée à la fin,
  // jamais insérée, et remplie automatiquement là où elle manque.
  var shC = ss.getSheetByName(SH.CATALOGUE);
  if (shC && shC.getLastColumn() > 0) {
    var enC = shC.getRange(1, 1, 1, shC.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    var iRef = enC.indexOf('REFERENCE');
    if (iRef < 0) {
      iRef = shC.getLastColumn();
      shC.getRange(1, iRef + 1).setValue('REFERENCE')
        .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    }
    if (shC.getLastRow() > 1) {
      var nL = shC.getLastRow() - 1;
      var plage = shC.getRange(2, iRef + 1, nL, 1);
      var refs = plage.getValues();
      var vus = {}, change = false;
      refs.forEach(function (r) { var x = String(r[0]).trim(); if (x) vus[x] = true; });
      for (var i = 0; i < nL; i++) {
        if (String(refs[i][0]).trim()) continue;
        var k = 1, cand;
        do { cand = 'REF-' + ('000' + k).slice(-4); k++; } while (vus[cand]);
        vus[cand] = true; refs[i][0] = cand; change = true;
      }
      if (change) plage.setValues(refs);
    }

    /* NATURES dit à quelles natures de devis la prestation appartient
       (ENTRETIEN, VITRERIE, FACADE, CHANTIER, REMISE, séparées par des virgules).
       Vide, elle se vend dans toutes : c'est le cas de presque tout le
       catalogue, et c'est pourquoi la colonne peut rester vide sans rien
       casser. */
    if (enC.indexOf('NATURES') < 0) {
      var iNat = shC.getLastColumn();
      shC.getRange(1, iNat + 1).setValue('NATURES')
        .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
      enC.push('NATURES');
    }

    /* PU_COMPLEMENT : le prix quand la prestation s'ajoute à une autre.
       Laissée vide, la prestation n'a qu'un prix et rien ne change pour elle. */
    if (enC.indexOf('PU_COMPLEMENT') < 0) {
      var iComp = shC.getLastColumn();
      shC.getRange(1, iComp + 1).setValue('PU_COMPLEMENT')
        .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
      enC.push('PU_COMPLEMENT');
    }
  }

  var shL = ss.getSheetByName(SH.LIGNES);
  if (shL && shL.getLastColumn() > 0) {
    var enL = shL.getRange(1, 1, 1, shL.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    ENTETES_LIGNES_.forEach(function (h) {
      if (enL.indexOf(h) >= 0) return;
      var c = shL.getLastColumn() + 1;
      shL.getRange(1, c).setValue(h)
        .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
      enL.push(h);
    });
  }

  creerOnglet_(ss, SH.JOURNAL, ENTETES_JOURNAL_);
  creerOnglet_(ss, SH.FACTURER, ENTETES_FACTURER_);
  creerOnglet_(ss, SH.FACTURES, ENTETES_FACTURES_);

  // Liste déroulante sur STATUT : le gérant peut corriger un état à la main
  // sans risquer une faute de frappe que les comptes ne reconnaîtraient pas.
  try {
    if (shD) {
      var enS = shD.getRange(1, 1, 1, shD.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); });
      var cS = enS.indexOf('STATUT');
      if (cS >= 0) {
        shD.getRange(2, cS + 1, Math.max(shD.getMaxRows() - 1, 1), 1).setDataValidation(
          SpreadsheetApp.newDataValidation().requireValueInList(STATUTS_, true)
            .setAllowInvalid(true).build());
      }
    }
  } catch (eS) {}

  formaterDates_(ss);

  var reg = lireReglages_(), shR = ss.getSheetByName(SH.REGLAGES);
  if (shR) {
    REGLAGES_DEFAUT_.forEach(function (r) {
      if (!(r[0] in reg)) shR.appendRow(r);
    });
    // Réglages d'identité laissés vides : on y met la valeur par défaut.
    // Volontairement limité à cette liste, pour ne jamais réécrire un texte vidé exprès.
    var aRemplir = ['societe_tel', 'societe_email', 'societe_site', 'societe_capital',
                    'banque_nom', 'banque_iban', 'banque_bic', 'conditions_paiement',
                    'paiement_pct', 'clause_reserve', 'mentions_penalites',
                    'mention_manuscrite', 'bordereau_retractation', 'delai_paiement_jours',
                    'texte_information', 'version_information', 'journal_retention_mois'];
    REGLAGES_DEFAUT_.forEach(function (r) {
      if (aRemplir.indexOf(r[0]) < 0) return;
      if (String(reg[r[0]] === undefined ? '' : reg[r[0]]).trim() !== '') return;
      ecrireReglage_(r[0], r[1]);
    });
  }
}

var REGLAGES_DEFAUT_ = [
  ['societe_nom', 'MA SOCIETE DE NETTOYAGE', 'Nom imprimé en haut du devis'],
  ['societe_forme', 'SARL au capital de 0 €', 'Forme juridique + capital'],
  ['societe_adresse', '1 rue Exemple', ''],
  ['societe_cp_ville', '56000 Vannes', ''],
  ['societe_tel', '+33 6 73 35 76 05', ''],
  ['societe_email', 'breizhbrillance@gmail.com', ''],
  ['societe_site', 'breizhbrillance.fr', 'Site imprimé sous l\'e-mail'],
  ['societe_capital', '1 818 €', 'Imprimé sous le SIRET'],
  ['societe_siret', '000 000 000 00000', 'Obligatoire sur un devis'],
  ['societe_tva', 'FR69991595711', 'N° TVA intracommunautaire — à faire confirmer par le comptable'],
  ['societe_rcs', 'RCS Vannes 000 000 000', ''],
  ['tva_defaut', '20', 'Taux de TVA par défaut en %'],
  ['remise_max', '20', 'Remise maximale que le commercial peut accorder, en % — 0 pour l\'interdire'],
  /* L'App ID d'OneSignal. Public : il figure dans le code de l'application.
     La clé d'API, elle, ne vit jamais ici — voir « 22. Connecter les
     notifications ». */
  ['onesignal_app_id', '', 'Notifications : App ID OneSignal — posé par le menu « 22 »'],
  ['passages_mois_defaut', '4', 'Contrat mensuel : nombre de passages créés par mois si le devis ne le précise pas'],
  ['recurrents_semaines', '8',
   'Contrats récurrents (onglet ' + 'RECURRENTS' + ') : combien de semaines de planning sont posées devant soi'],
  ['pointage_retention_mois', '36', 'Durée de conservation des pointages arrivée/départ, en mois'],
  ['texte_information_agent', 'L\'application enregistre, à chaque utilisation : les connexions, l\'heure d\'arrivée et l\'heure de départ de chaque chantier, les prestations cochées, les photos prises et les signalements.\n\nCes informations servent au suivi des interventions, à la preuve du travail effectué auprès des clients, et au décompte du temps de travail. Elles sont conservées {mois} mois, puis effacées.\n\nConformément au règlement général sur la protection des données, tu peux demander à consulter les informations qui te concernent et faire rectifier une erreur, en écrivant à breizhbrillance@gmail.com.', 'Texte affiché à chaque connexion d\'un agent — {mois} est remplacé par pointage_retention_mois'],
  ['validite_jours', '30', 'Durée de validité du devis en jours'],
  ['delai_paiement_jours', '30', 'Délai de paiement porté sur la facture préparée dans Henrri, en jours'],
  ['conditions_reglement', 'Paiement à 30 jours à réception de facture. Pénalités de retard : 3 fois le taux d\'intérêt légal. Indemnité forfaitaire de recouvrement : 40 €.', 'Bas de devis'],
  ['mentions_bas', 'Devis gratuit. Il doit être retourné daté et signé avec la mention « Bon pour accord ».', 'Bas de devis'],
  ['mentions_particulier', 'Contrat conclu hors établissement : le client particulier dispose d\'un délai de rétractation de 14 jours à compter de la signature (art. L221-18 du Code de la consommation), sans motif ni pénalité. À faire valider par votre conseil.', 'Imprimé uniquement sur les devis aux particuliers'],
  ['prefixe_devis', 'DEV', 'Numéro : DEV-2026-KL-0001 (KL = initiales du commercial)'],
  ['dossier_racine_id', '', 'Dossier Drive racine — rempli automatiquement'],
  ['email_copie', '', 'Adresse qui reçoit une copie de chaque devis'],
  ['taux_horaire_planning', '30',
   'Taux horaire de vente (€/h) : sert à déduire la durée d\'un chantier de son montant'],
  ['planification_auto', 'OUI',
   'NON : les chantiers naissent « A PLANIFIER » et c\'est le bureau qui pose dates et salariés'],
  ['reliquat_ignore_min', '60',
   'Un reste de chantier plus court que cette durée (minutes) n\'ouvre pas une journée de plus : sous 8 h, une seule journée de 7 h'],
  ['trajet_calcule', 'OUI',
   'OUI : la route entre deux chantiers d\'une même journée est calculée par Google Maps, d\'une adresse à l\'autre. NON : on compte toujours trajet_minutes'],
  ['trajet_minutes', '30',
   'Temps de route compté, en minutes, quand l\'itinéraire ne peut pas être calculé (adresse manquante, Google Maps muet)'],
  ['signature_mail', 'CORDIALEMENT,\n\nSimon - BREIZH BRILLANCE',
   'Signature ajoutée sous les mails aux clients (devis, factures), avant le bandeau'],
  ['noms_documents', 'TITEMA=Simon',
   'Le nom imprimé sur les devis et les factures pour un compte : COMPTE=Nom ; COMPTE2=Nom2'],
  ['commissions', 'CONTRAT_PART=5;CONTRAT_PRO=6;RENOUV_PART=2;RENOUV_PRO=3;RENOUV_MAX=3;VITRERIE_PART=6;VITRERIE_PRO=7;CHANTIER=8;REMISE=8;FACADE=8;BASE_CONTRAT_MOIS=12',
   'Taux de commission des commerciaux, en %. Contrat : sur la 1re année'],
  ['equipe_par_jour', '',
   'Qui fait les passages selon le jour : LUNDI=VICTOR;SAMEDI=MAXIME;AUTRES=MAXIME, VICTOR. Vide : la série décide'],
  ['travail_jours_feries', 'NON',
   'OUI : l\'appli pose aussi des chantiers les jours fériés'],
  ['majoration_tres_sale', '30',
   'Majoration en % quand le commercial coche « site très sale » — 0 pour retirer la coche'],
  ['agence_adresse', '39 avenue de Verdun, 56000 Vannes',
   'D\'où partent les tournées — sert à mesurer la distance des communes'],
  ['majoration_km_bareme', '10:0 ; 20:0,70 ; 50:0,80 ; *:0,90',
   'Entretien : barème au km, par tranches cumulées — « jusqu\'à ce km : tarif », * pour au-delà. Vide : aucune majoration'],
  ['majoration_km_arrondi', '0,10',
   'Entretien : les prix relevés de l\'éloignement sont arrondis à ce pas, à partir d\'un euro (au centime en dessous)'],
  ['banniere_url', 'https://breizhbrillance.github.io/devis/banniere.jpg',
   'Image placée en bas de tous les courriels envoyés par l\'appli — vide : aucune bannière'],
  ['banque_nom', 'CMB Saint Avé', 'Coordonnées bancaires imprimées sur le devis'],
  ['banque_iban', 'FR76 1558 9569 3900 1258 9684 096', ''],
  ['banque_bic', 'CMBRFR2BXXX', ''],
  ['paiement_pct', '100', 'Part à régler — « 100 % soit 1 210,83 € : … »'],
  ['conditions_paiement', 'Paiement comptant.', 'Suite de la ligne ci-dessus'],
  ['clause_reserve', 'CLAUSE DE RÉSERVE DE PROPRIÉTÉ : Conformément à la loi 80.335 du 12 mai 1980, nous réservons la propriété des produits et marchandises, objets des présents débits, jusqu\'au paiement de l\'intégralité du prix et de ses accessoires. En cas de non paiement total ou partiel du prix de l\'échéance pour quelque cause que ce soit, de convention expresse, nous nous réservons la faculté, sans formalités, de reprendre matériellement possession de ces produits ou marchandises à vos frais, risques et périls.', 'Bas de page'],
  ['mentions_penalites', 'Pénalité de retard : 3 fois le taux d\'intérêt légal après date d\'échéance. Escompte pour règlement anticipé : 0 % (sauf condition particulière définie dans les conditions de règlement). Le montant de l\'indemnité forfaitaire pour frais de recouvrement prévue au douzième alinéa de l\'article L441-6 est fixé à 40 euros en matière commerciale.', 'Bas de page'],
  ['mentions_credit_impot', '', 'Crédit d\'impôt services à la personne — à ne remplir qu\'une fois la déclaration SAP obtenue'],
  ['journal_retention_mois', '6', 'Durée de conservation du journal des actions, en mois'],
  ['recap_email', '', 'Adresse qui reçoit le récapitulatif — vide : le propriétaire du fichier'],
  ['rappel_sans_resultat_jours', '2', 'Au bout de combien de jours un devis sans résultat est rappelé'],
  ['recap_jour', '1', 'Jour du récapitulatif hebdomadaire — 1 lundi … 7 dimanche'],
  ['texte_information', 'L\'application enregistre, à chaque utilisation : les connexions et les tentatives de connexion, la création et la signature des devis, l\'ajout de photos, le partage des documents. Chaque enregistrement porte la date, l\'heure, le nom du commercial et l\'appareil utilisé.\n\nCes informations servent au suivi commercial, à la traçabilité des devis remis aux clients et à la sécurité de l\'accès aux tarifs de l\'entreprise. Elles sont conservées {mois} mois, puis effacées. Seule la direction de BREIZH BRILLANCE y a accès.\n\nConformément au règlement général sur la protection des données, tu peux demander à consulter les informations qui te concernent et faire rectifier une erreur, en écrivant à breizhbrillance@gmail.com.', 'Texte affiché à chaque connexion — {mois} est remplacé par la durée de conservation'],
  ['version_information', '1', 'À incrémenter dès que le texte ci-dessus change : chacun devra l\'accepter de nouveau'],
  ['assurance_rc', '', 'Assurance responsabilité civile professionnelle : assureur, adresse, couverture géographique'],
  ['mediateur', '', 'Médiateur de la consommation : nom, adresse et site — obligatoire face à un particulier'],
  ['mention_manuscrite', 'Bon pour accord', 'Mention que le client recopie avant de signer'],
  ['bordereau_retractation', 'OUI', 'Formulaire de rétractation en dernière page des devis aux particuliers'],
  ['prospection_active', 'OUI', 'Affiche le module Phoning dans l\'application des commerciaux'],
  ['prospection_fichier_id', '1ojIjgENOZb39JReWI0Cwq-nzlD51Wme5W4pSlYVr4Bg', 'Identifiant du Google Sheet de prospection — « BASE PROSPECTS BB »'],
  ['prospection_onglet', 'BASE', 'Onglet à lire dans ce fichier — vide pour lire tous les onglets (un par commune)'],
  ['prospection_entete_ligne', '3', 'Ligne d\'en-tête dans le fichier de prospection'],
  ['prospection_avec_tel', 'OUI', 'N\'importer que les établissements qui ont un numéro — les autres ne sont pas appelables'],
  ['prospection_relance_heures', '3', 'Heures à attendre avant de retenter un prospect qui n\'a pas répondu'],
  ['prospection_maj_active', 'OUI', 'Mise à jour automatique de la base de prospects (lundi, mercredi, vendredi) — NON pour la suspendre sans retirer le déclencheur'],
  ['prospection_maj_departement', '56', 'Département interrogé dans l\'annuaire des entreprises'],
  ['prospection_effectif_min_btp', '6', 'Le BTP n\'entre qu\'à partir de ce nombre de salariés — la peinture (43.34Z) entre en entier'],
  ['sel_codes', '', 'Généré automatiquement — ne pas modifier']
];

/* La grille telle qu'elle est dans le classeur depuis le 3 octobre 2026 : quinze
   prestations d'intervention, puis quatorze tâches d'entretien au prix d'un
   passage. « Charger la grille de prix » remet exactement ceci ; si le classeur
   a évolué depuis, c'est lui qui a raison, pas cette liste. */
/* PU_COMPLEMENT : le prix de la prestation quand elle s'ajoute à une autre.
   Vide ou zéro, la prestation n'a qu'un prix. C'est le déplacement qui se paie
   une fois : un canapé vaut 150 € quand on se déplace pour lui seul, 70 € quand
   on est déjà chez le client pour autre chose. */
var ENTETES_CATALOGUE_ = ['CATEGORIE', 'DESIGNATION', 'DETAIL', 'UNITE', 'PU_HT',
                          'TVA', 'TYPE', 'ACTIF', 'REFERENCE', 'NATURES', 'PU_COMPLEMENT'];

/* Les lignes peuvent avoir 10 ou 11 colonnes : celles qui n'ont pas de prix de
   complément s'arrêtent à NATURES, et c'est l'écriture qui complète. */
function grilleComplete_() {
  return CATALOGUE_DEFAUT_.map(function (r) {
    var l = r.slice();
    while (l.length < ENTETES_CATALOGUE_.length) l.push('');
    return l;
  });
}

var CATALOGUE_DEFAUT_ = [
  ['Remise en état des sols', 'Nettoyage approfondi des plinthes et angles', '', 'm2', 0.20, 10, 'PONCTUEL', 'OUI', 'REF-0001', 'CHANTIER,REMISE'],
  ['Remise en état des sols', 'Aspiration complète des sols', '', 'm2', 0.40, 10, 'PONCTUEL', 'OUI', 'REF-0002', 'CHANTIER,REMISE'],
  ['Remise en état des sols', 'Décapage des sols au décapant laitance', '', 'm2', 0.50, 10, 'PONCTUEL', 'OUI', 'REF-0003', 'CHANTIER'],
  ['Remise en état des sols', 'Nettoyage vapeur des sols', '', 'm2', 0.50, 10, 'PONCTUEL', 'OUI', 'REF-0015', 'REMISE'],
  ['Remise en état des sols', 'Lavage humide et désinfection des sols', '', 'm2', 0.45, 10, 'PONCTUEL', 'OUI', 'REF-0004', 'CHANTIER,REMISE'],
  ['Nettoyage des vitrages et menuiseries', 'Nettoyage des vitrages intérieurs/extérieurs', '', 'm2', 8, 10, 'PONCTUEL', 'OUI', 'REF-0005', 'CHANTIER,REMISE'],
  ['Nettoyage des vitrages et menuiseries', 'Nettoyage complet des menuiseries, cadres et rails', '', 'm2', 4, 10, 'PONCTUEL', 'OUI', 'REF-0006', 'CHANTIER,REMISE'],
  ['Nettoyage des vitrages et menuiseries', 'Nettoyage des volets roulants', '', 'm2', 2, 10, 'PONCTUEL', 'OUI', 'REF-0007', 'CHANTIER,REMISE'],
  ['Remise en état de la cuisine', 'Nettoyage intérieur de la cuisine', '', 'forfait', 30, 10, 'PONCTUEL', 'OUI', 'REF-0008', 'CHANTIER,REMISE'],
  ['Remise en état de la cuisine', 'Nettoyage extérieur de la cuisine', '', 'forfait', 20, 10, 'PONCTUEL', 'OUI', 'REF-0009', 'CHANTIER,REMISE'],
  ['Chambres et pièces diverses', 'Nettoyage intérieur/extérieur des étagères, meubles, moulures et surfaces en relief', '', 'pièce(s)', 10, 10, 'PONCTUEL', 'OUI', 'REF-0010', 'CHANTIER,REMISE'],
  ['Nettoyage des sanitaires et pièces d\'eau', 'Nettoyage et désinfection WC et lavabos', '', 'pièce(s)', 40, 10, 'PONCTUEL', 'OUI', 'REF-0011', 'CHANTIER,REMISE'],
  ['Nettoyage des sanitaires et pièces d\'eau', 'Nettoyage robinetteries et faïences', '', 'pièce(s)', 15, 10, 'PONCTUEL', 'OUI', 'REF-0012', 'CHANTIER,REMISE'],
  ['Nettoyage des sanitaires et pièces d\'eau', 'Nettoyage parois vitrées', '', 'pièce(s)', 30, 10, 'PONCTUEL', 'OUI', 'REF-0013', 'CHANTIER,REMISE'],
  ['Finitions générales et livraison', 'Contrôle qualité et reprises générales', '', 'forfait', 10, 10, 'PONCTUEL', 'OUI', 'REF-0014', 'CHANTIER,REMISE'],
  ['Bureaux et espaces de travail', 'Nettoyage et désinfection des bureaux, tables, chaises et points de contact', '', 'bureau(x)', 2, 20, 'PONCTUEL', 'OUI', 'REF-0016', 'ENTRETIEN'],
  ['Bureaux et espaces de travail', 'Dépoussiérage et suppression des traces sur matériel informatique, casiers et étagères', '', 'bureau(x)', 1, 20, 'PONCTUEL', 'OUI', 'REF-0017', 'ENTRETIEN'],
  /* REF-0018, « Dépoussiérage des lustres et luminaires » à 6,20 € en forfait,
     a été RETIRÉE le 26 octobre 2026 à la demande de Simon. Elle venait du
     devis type d'entretien et il l'avait d'abord gardée à ce prix, le
     12 octobre ; il ne la vend plus. Comme REF-0019 et REF-0035 avant elle,
     **sa référence ne se réattribue jamais** : un devis déjà établi la porte,
     et la réemployer changerait le sens d'un devis signé. */
  ['Cuisine et espace repas', 'Nettoyage et désinfection des surfaces extérieures', '', 'forfait', 4, 20, 'PONCTUEL', 'OUI', 'REF-0041', 'ENTRETIEN'],
  ['Cuisine et espace repas', 'Désinfection des ustensiles de cuisine et du plan de travail', '', 'forfait', 1.50, 20, 'PONCTUEL', 'OUI', 'REF-0020', 'ENTRETIEN'],
  ['Cuisine et espace repas', 'Nettoyage des micro-ondes : points de contact extérieurs et intérieur', '', 'forfait', 1.50, 20, 'PONCTUEL', 'OUI', 'REF-0021', 'ENTRETIEN'],
  ['Cuisine et espace repas', 'Nettoyage de l\'armoire réfrigérée : points de contact extérieurs et étages intérieurs', '', 'forfait', 1.50, 20, 'PONCTUEL', 'OUI', 'REF-0022', 'ENTRETIEN'],
  ['Sanitaires', 'Vérification et désinfection des robinets et bondes', '', 'forfait', 2, 20, 'PONCTUEL', 'OUI', 'REF-0023', 'ENTRETIEN'],
  ['Sanitaires', 'Nettoyage et désinfection des cuvettes et abattants de toilettes', '', 'pièce(s)', 4, 20, 'PONCTUEL', 'OUI', 'REF-0024', 'ENTRETIEN'],
  ['Sanitaires', 'Désinfection complète des lavabos, miroirs et plans de travail', '', 'pièce(s)', 4, 20, 'PONCTUEL', 'OUI', 'REF-0025', 'ENTRETIEN'],
  ['Sanitaires', 'Nettoyage et désinfection de la douche', '', 'pièce(s)', 4, 20, 'PONCTUEL', 'OUI', 'REF-0040', 'ENTRETIEN'],
  /* Les sols se mesurent, ils ne se cochent pas : un plateau de bureaux de
     300 m² et un cabinet de 40 m² ne demandent pas le même temps. L'unité et
     la forme viennent du devis type d'entretien (DEVIS-I-26-09-2) ; les prix
     ont été abaissés par Simon le 12 octobre 2026 au soir, en dessous de ceux
     de ce devis — c'est sa décision commerciale, pas un relevé. */
  ['Sols et surfaces', 'Dépoussiérage et détachage des plinthes, murs, plafonds et rebords de fenêtre', '', 'm2', 0.10, 20, 'PONCTUEL', 'OUI', 'REF-0026', 'ENTRETIEN'],
  ['Sols et surfaces', 'Aspiration des sols', '', 'm2', 0.10, 20, 'PONCTUEL', 'OUI', 'REF-0027', 'ENTRETIEN'],
  ['Sols et surfaces', 'Lavage humide des sols avec désinfection', '', 'm2', 0.15, 20, 'PONCTUEL', 'OUI', 'REF-0028', 'ENTRETIEN'],
  /* Elle se multiplie par le nombre de poubelles. Sur le devis type elle était
     offerte : c'était un geste commercial, pas un tarif — Simon la facture. */
  ['Déchets', 'Rotation des poubelles', '', 'pièce(s)', 0.50, 20, 'PONCTUEL', 'OUI', 'REF-0039', 'ENTRETIEN'],
  ['Contrôle', 'Contrôle visuel et hygiénique après chaque intervention', '', 'forfait', 1, 20, 'PONCTUEL', 'OUI', 'REF-0029', 'ENTRETIEN'],

  /* Le canapé, relevé du devis I-26-10-21 du 16 octobre 2026 : 65 € de
     pré-traitement, 35 € de brossage, 50 € d'extraction, soit 150 € HT pour un
     déplacement qui ne sert qu'à lui. Les trois étapes tiennent en une ligne et
     se lisent dans le détail : le client doit voir le travail, et le prix doit
     pouvoir basculer d'un seul coup, sans arithmétique à refaire.
     La onzième colonne est ce basculement : 70 € dès qu'une autre prestation
     figure au devis, parce que le déplacement est alors déjà payé. */
  ['Textiles et ameublement', 'Nettoyage d\'un canapé 1 ou 2 places',
   'Pré-traitement et application d\'un shampoing textile sur l\'assise, le dossier, ' +
   'les accoudoirs et les coussins ; brossage manuel en profondeur à la brosse à poils ' +
   'doux ; extraction par injection-aspiration, assainissement du textile et détachage. ' +
   'Les taches anciennes ou incrustées ne peuvent faire l\'objet d\'une garantie de résultat.',
   'forfait', 150, 20, 'PONCTUEL', 'OUI', 'REF-0042', 'CHANTIER,REMISE', 70],
  /* Vitrages et menuiseries : un devis à part, jamais mêlé à un entretien —
     les vitres ne passent pas à la même fréquence que les sols. La grille est
     celle du modèle « duplicable » de Simon.

     REF-0035, « Nettoyage des vitrages, huisseries, rails et verrières » à
     55 € en forfait, a été RETIRÉE le 19 octobre 2026 à la demande de Simon.
     Elle faisait double emploi avec le détail au mètre carré qui la précède :
     un même devis pouvait porter le forfait ET les lignes qui le composent,
     et facturer deux fois le même travail. Comme REF-0019 avant elle, **sa
     référence ne se réattribue jamais** : une ligne de devis déjà établie la
     porte, et la réemployer changerait le sens d'un devis signé. */
  ['Vitrages et menuiseries', 'Mise en place du matériel et sécurisation de la zone d\'intervention', '', 'forfait', 10, 20, 'PONCTUEL', 'OUI', 'REF-0030', 'VITRERIE'],
  ['Vitrages et menuiseries', 'Vitrages intérieurs', '', 'm²', 4, 20, 'PONCTUEL', 'OUI', 'REF-0031', 'VITRERIE'],
  ['Vitrages et menuiseries', 'Vitrages extérieurs', '', 'm²', 4, 20, 'PONCTUEL', 'OUI', 'REF-0032', 'VITRERIE'],
  ['Vitrages et menuiseries', 'Nettoyage des menuiseries, rails et appuis de fenêtre', '', 'm²', 5, 20, 'PONCTUEL', 'OUI', 'REF-0033', 'VITRERIE'],
  ['Vitrages et menuiseries', 'Dépoussiérage et nettoyage des volets roulants', '', 'm²', 3, 20, 'PONCTUEL', 'OUI', 'REF-0034', 'VITRERIE'],
  /* Façade : un chantier à part, comme la vitrerie. Le nettoyage et l'antimousse
     se chiffrent au mètre carré de mur traité ; la nacelle se loue à la journée et
     ne suit donc pas la surface. La TVA inscrite ici n'est qu'un repli : sur le
     terrain l'appli applique 10 % au logement de plus de deux ans, 20 % sinon. */
  ['Nettoyage de façade', 'Nettoyage de façade', 'Mise en sécurité du chantier • protection de la maison et de ses abords • pulvérisation du nettoyant sans chlore • passage du nettoyeur réglé au jet plat • finition et nettoyage du chantier', 'm²', 14.90, 10, 'PONCTUEL', 'OUI', 'REF-0036', 'FACADE'],
  ['Nettoyage de façade', "Pulvérisation d'antimousse végétale, non-retour de mousse garanti 2 ans", '', 'm²', 3.90, 10, 'PONCTUEL', 'OUI', 'REF-0037', 'FACADE'],
  ['Nettoyage de façade', 'Forfait nacelle à la journée', '', 'journée(s)', 450, 10, 'PONCTUEL', 'OUI', 'REF-0038', 'FACADE'],

  /* Les terrasses (28 octobre 2026). Elles se vendent avec la façade — même
     chantier, même machine, même journée — et portent donc la même nature :
     un seul devis peut couvrir le mur et le sol. Leur catégorie est à part
     pour que le commercial les retrouve d'un coup d'œil dans la liste, et la
     TVA est celle des travaux sur logement de plus de deux ans, comme la
     façade. Le prix au m² est plus bas qu'en façade : on travaille au sol,
     sans échafaudage ni nacelle. */
  ['Nettoyage de terrasse', 'Nettoyage de terrasse au nettoyeur haute pression',
   'Mise en sécurité de la zone • protection des abords et des plantations • pulvérisation du nettoyant sans chlore • passage du nettoyeur réglé selon le support • rinçage et remise en ordre du chantier',
   'm²', 8, 10, 'PONCTUEL', 'OUI', 'REF-0044', 'FACADE'],
  ['Nettoyage de terrasse', "Pulvérisation d'antimousse végétale sur la terrasse", '',
   'm²', 2.90, 10, 'PONCTUEL', 'OUI', 'REF-0045', 'FACADE'],
  ['Nettoyage de terrasse', 'Imperméabilisation de la terrasse (traitement hydrofuge)', '',
   'm²', 8, 10, 'PONCTUEL', 'OUI', 'REF-0046', 'FACADE'],

  /* La nacelle de la vitrerie (19 octobre 2026). Une verrière ou un pignon vitré
     se nettoient depuis la même machine qu'une façade, au même prix à la
     journée — mais Simon la veut dans les deux catégories, chacune sous son
     propre intitulé : sur un devis de vitrerie elle se lit sous « Vitrages et
     menuiseries », pas sous « Nettoyage de façade ».
     D'où deux lignes et deux références plutôt qu'une ligne à deux natures.
     Elles ne se croisent jamais : un devis est de vitrerie OU de façade, jamais
     les deux, et chacune ne se vend que sur la sienne. Même prix des deux
     côtés : c'est la même nacelle, elle se loue au même tarif. */
  ['Vitrages et menuiseries', 'Forfait nacelle à la journée', '', 'journée(s)', 450, 20, 'PONCTUEL', 'OUI', 'REF-0043', 'VITRERIE']
];

/** Remplace le contenu du CATALOGUE par la grille de prix de référence. */
/* Les prestations de la grille que le classeur n'a pas encore, ajoutées à la
   suite — et rien d'autre. « Charger la grille de prix » remplace tout : il
   efface les lignes désactivées, qu'on garde exprès, et les prix que le gérant
   a pu ajuster ici. Cette entrée-là ne touche à aucune ligne existante : elle
   compare par REFERENCE et n'écrit que ce qui manque. C'est par elle que
   passent les ajouts au catalogue. */
function completerCatalogue() {
  /* L'alerte n'est pas le travail : elle n'existe que depuis le menu du
     classeur. Lancée depuis l'éditeur, SpreadsheetApp.getUi() lève, et une
     fonction qui l'appelle en premier n'aurait alors rien fait du tout. On
     fait donc le travail, et on en rend compte à la fin — à l'écran si
     quelqu'un regarde, dans le journal d'exécution sinon. */
  function dire(m) {
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) { /* lancé depuis l'éditeur */ }
  }

  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CATALOGUE);
  if (!sh) return dire('Onglet CATALOGUE introuvable. Lance d\'abord « 1. Initialiser le fichier ».');

  var en = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cRef = en.indexOf('REFERENCE');
  if (cRef < 0) return dire('Le CATALOGUE n\'a pas de colonne REFERENCE.\n\n' +
                            'Lance « 6. Mettre à jour la structure du fichier », puis réessaie.');

  var deja = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, cRef + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var v = String(r[0]).trim();
      if (v) deja[v] = 1;
    });
  }

  /* On écrit par nom de colonne : le classeur d'un ancien fichier peut avoir
     ses colonnes dans un autre ordre, ou en porter d'autres. */
  var manque = grilleComplete_().filter(function (l) {
    return !deja[String(l[ENTETES_CATALOGUE_.indexOf('REFERENCE')]).trim()];
  });
  if (!manque.length) return dire('Le catalogue est déjà complet : aucune prestation à ajouter.');

  var large = Math.max(en.length, 1);
  var rows = manque.map(function (l) {
    return en.map(function (h) {
      var i = ENTETES_CATALOGUE_.indexOf(h);
      return i >= 0 ? l[i] : '';
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, large).setValues(rows);

  var noms = manque.map(function (l) {
    return '• ' + l[ENTETES_CATALOGUE_.indexOf('REFERENCE')] + ' — ' +
           l[ENTETES_CATALOGUE_.indexOf('DESIGNATION')];
  }).join('\n');
  dire(manque.length + ' prestation' + (manque.length > 1 ? 's ajoutées' : ' ajoutée') +
       ' à la fin du catalogue :\n\n' + noms +
       '\n\nAucune ligne existante n\'a été touchée.');
}

function chargerGrillePrix() {
  var ui = SpreadsheetApp.getUi();
  var rep = ui.alert('Remplacer le catalogue ?',
    'Les ' + CATALOGUE_DEFAUT_.length + ' prestations de la grille de prix vont remplacer le contenu ' +
    'actuel de l\'onglet CATALOGUE.\n\nLes anciennes lignes seront effacées (annulable par Ctrl+Z ' +
    'ou par l\'historique des versions du classeur).\n\nContinuer ?', ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;

  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CATALOGUE);
  if (!sh) return ui.alert('Onglet CATALOGUE introuvable. Lance d\'abord « 1. Initialiser le fichier ».');
  var grille = grilleComplete_();
  var large = Math.max(ENTETES_CATALOGUE_.length, sh.getLastColumn());
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, large).clearContent();
  sh.getRange(1, 1, 1, ENTETES_CATALOGUE_.length).setValues([ENTETES_CATALOGUE_])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.getRange(2, 1, grille.length, ENTETES_CATALOGUE_.length).setValues(grille);
  sh.setColumnWidth(1, 250); sh.setColumnWidth(2, 340); sh.setColumnWidth(3, 200);
  ui.alert(CATALOGUE_DEFAUT_.length + ' prestations chargées.\n\n' +
    'Le taux de TVA indiqué ici n\'est qu\'une valeur de repli : sur le terrain, ' +
    'l\'application applique 20 % pour un professionnel, 10 % ou 20 % pour un particulier ' +
    'selon l\'âge du logement.');
}

/* ============================ API ============================ */

function reponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * GET : ne publie plus rien.
 * Le catalogue, les réglages et la liste des commerciaux ne sortent qu'après
 * vérification du nom et du code, par POST. Avant, l'adresse — qui est publique,
 * puisqu'elle figure dans l'application — laissait lire les empreintes des codes
 * et le grain de sel qui sert à les calculer : de quoi retrouver un code court
 * en quelques secondes hors ligne.
 */
function doGet(e) {
  var rel = relaisMigration_();
  if (rel) return relayer_(rel, e, false);
  return reponse_({ ok: true, service: 'devis', message: 'Service en ligne. Identification requise.' });
}

/** Nom comparé sans tenir compte de la casse, des accents ni des espaces en trop. */
function normNom_(s) {
  s = String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  return s.replace(/[àáâäã]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
          .replace(/[òóôöõ]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/[ç]/g, 'c');
}

/* v98 — plusieurs intervenants sur une intervention. Demande de Simon :
   « Victor et Maxime forment un binôme pour 95 % des prestations ». La colonne
   PRESTATAIRE garde les noms séparés par une virgule (« MAXIME, VICTOR ») :
   le classeur reste lisible à l'œil, et une case à un seul nom ne change pas.
   Toute comparaison « est-ce son chantier ? » passe par quiContient_. */
function nomsQui_(s) {
  var vus = {};
  return String(s == null ? '' : s).split(/\s*[,;\/+]\s*/).map(function (x) {
    return String(x).trim();
  }).filter(function (x) {
    var k = normNom_(x); if (!k || vus[k]) return false; vus[k] = true; return true;
  });
}
function quiContient_(s, nom) {
  var n = normNom_(nom);
  if (!n) return false;
  return nomsQui_(s).some(function (x) { return normNom_(x) === n; });
}
/* Les noms tels qu'écrits dans PRESTATAIRES, ou une erreur si l'un d'eux n'y
   est pas — sinon l'intervention n'apparaîtrait sur aucun téléphone. */
function quiConnus_(s) {
  var noms = nomsQui_(s), gens = lirePrestataires_(), out = [];
  for (var i = 0; i < noms.length; i++) {
    var n = normNom_(noms[i]), trouve = '';
    gens.forEach(function (p) { if (normNom_(p.nom) === n) trouve = p.nom; });
    if (!trouve) return { ok: false, erreur: noms[i] + ' n\'est pas dans la liste des prestataires' };
    out.push(trouve);
  }
  return { ok: true, valeur: out.join(', ') };
}

/* Actif ou non, dans une colonne tenue à la main.

   « NON » écrit en toutes lettres, mais aussi une case à cocher décochée : le
   tableur la rend sous la forme FALSE, que l'ancien test laissait passer pour
   un OUI. Le gérant décochait la case d'un salarié parti, et le téléphone de
   celui-ci continuait d'ouvrir le planning — sans bruit, c'est le pire genre
   de panne. Depuis la v85 la connexion tient trente jours : cette colonne est
   devenue le seul moyen de couper un appareil, elle doit répondre.

   Vide vaut actif : les fiches écrites avant que la colonne existe gardent
   leur place. */
function estActif_(v) {
  var s = String(v == null ? '' : v).trim().toUpperCase();
  return s !== 'NON' && s !== 'FALSE' && s !== 'NO' && s !== 'N' && s !== '0';
}

/* Le nom figure-t-il quelque part, mais désactivé ? Posée seulement quand un
   refus vient de tomber, pour en écrire la vraie raison au journal : « code
   refusé » et « accès coupé » ne se réparent pas de la même façon, et le
   gérant doit pouvoir lire laquelle des deux s'est produite. La réponse rendue
   au téléphone, elle, ne change pas d'un mot — un appareil trouvé ne doit pas
   apprendre quels noms existent chez BB. */
function personneInactive_(nom) {
  var n = normNom_(nom);
  if (!n) return false;
  var feuilles = [SH.ADMINS, SH.COMMERCIAUX, SH.PRESTATAIRES];
  for (var i = 0; i < feuilles.length; i++) {
    var sh = SpreadsheetApp.getActive().getSheetByName(feuilles[i]);
    if (!sh || sh.getLastRow() < 2) continue;
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
    for (var j = 0; j < v.length; j++) {
      if (normNom_(v[j][0]) === n && !estActif_(v[j][3])) return true;
    }
  }
  return false;
}

function trouverCommercial_(nom) {
  var n = normNom_(nom), out = null;
  lireCommerciaux_().forEach(function (c) { if (normNom_(c.nom) === n) out = c; });
  return out;
}

/**
 * Freine les essais répétés sur un même nom : 10 échecs par quart d'heure.
 * Sans ça, l'adresse étant publique, un code court se teste en ligne.
 */
function essaisRestants_(nom) {
  var cache = CacheService.getScriptCache();
  var cle = 'essais_' + normNom_(nom);
  return { cache: cache, cle: cle, n: Number(cache.get(cle) || 0) };
}
function noterEchec_(nom) {
  var e = essaisRestants_(nom);
  e.cache.put(e.cle, String(e.n + 1), 900);
}
function tropDEssais_(nom) {
  return essaisRestants_(nom).n >= 10;
}

/** Ce que l'application reçoit une fois le commercial reconnu. */
function config_(com) {
  var reg = lireReglages_();
  delete reg.sel_codes;
  delete reg.dossier_racine_id;
  delete reg.dossier_drive_id;
  delete reg.email_copie;
  return {
    maj: new Date().toISOString(),
    role: 'COMMERCIAL',
    /* Les initiales que porteront les numéros de ce commercial : le téléphone
       numérote hors connexion, il ne peut pas les demander au moment venu. */
    initiales: (com && com.initiales) || '',
    /* La distance des communes du secteur : le téléphone chiffre l'entretien
       chez le client, souvent sans réseau, et ne peut pas la demander. */
    communes: lireCommunes_(),
    compteurs: compteurs_(),    // dernier rang par série : évite qu'un
    reglages: reg,              // téléphone réinstallé reparte au rang 01
    catalogue: lireCatalogue_(),
    /* Le module de prospection téléphonique s'affiche ou non. La liste des
       prospects, elle, ne voyage pas ici : elle est trop grosse pour être
       rechargée à chaque connexion, et se demande par l'action « prospects ». */
    prospection: String(reg.prospection_active || 'OUI').toUpperCase() !== 'NON',
    /* Ce commercial fait-il aussi des chantiers ? Si oui, l'application lui
       ouvre son planning, en plus de ses devis. */
    planning: aussiPrestataire_(com && com.nom)
  };
}

/* ================================================================
   v108v — RAPIDITÉ
   ================================================================
   Simon : « quand je valide un devis ou autre y'a bien 1 minute de latence
   pour que je vois et les autres voient aussi ». Trois causes : les
   téléphones ne relisaient le serveur que toutes les deux minutes, le
   tableau se recalculait en entier (9 à 11 s) à chaque lecture, et rien ne
   disait aux autres qu'il y avait du neuf.
   1. Un numéro de version des données, en mémoire du script : toute action
      qui écrit le change. Les téléphones le demandent toutes les 15 s — un
      appel minuscule, sans lecture du classeur — et ne rechargent que s'il a
      bougé.
   2. Les lectures lourdes (tableau, planning, mes devis, commissions,
      statistiques) sont gardées en mémoire, sous cette version : tant que
      rien n'a changé, la réponse part toute faite.
   3. Pendant une lecture, chaque onglet n'est lu qu'une fois.            */
var VERSION_CLE_ = 'DONNEES_V';
var LECTURES_ = ['connexion', 'config', 'journal', 'planning', 'tableau', 'prospects',
                 'historique', 'facturation', 'mesDevis', 'devisArchive', 'suggestions',
                 'ficheLire', 'commissions', 'elementsPaie', 'etatNotifs', 'essaiNotif',
                 'disposSalaries', 'statsSociete'];
var MEMO_ONGLETS_ = null;          // { nomOnglet: valeurs } pendant une lecture seule

function versionDonnees_() {
  try {
    var c = CacheService.getScriptCache(), v = c.get(VERSION_CLE_);
    if (!v) { v = String(Date.now()); c.put(VERSION_CLE_, v, 21600); }
    return v;
  } catch (e) { return '0'; }
}

/* Ce qui vient d'être écrit est rendu lisible aux autres exécutions tout de
   suite (flush), puis la version change : les téléphones rechargent. */
function donneesChangees_() {
  try { SpreadsheetApp.flush(); } catch (e0) {}
  nouvelleVersion_();
}
function nouvelleVersion_() {
  try {
    var c = CacheService.getScriptCache();
    var v = Math.max(Date.now(), Number(c.get(VERSION_CLE_) || 0) + 1);
    c.put(VERSION_CLE_, String(v), 21600);
  } catch (e) {}
}

/* Une modification faite à la main dans le classeur compte aussi. */
function onEdit(e) { nouvelleVersion_(); }

function texteJson_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}

function cleCache_(texte) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, texte, Utilities.Charset.UTF_8);
  return 'R' + Utilities.base64EncodeWebSafe(b).replace(/=+$/, '');
}

function cacheLire_(cle) {
  try {
    var c = CacheService.getScriptCache();
    var n = Number(c.get(cle + 'n') || 0);
    if (!n) return null;
    var ks = [];
    for (var i = 0; i < n; i++) ks.push(cle + 'p' + i);
    var m = c.getAll(ks), s = '';
    for (var j = 0; j < n; j++) { if (m[ks[j]] == null) return null; s += m[ks[j]]; }
    var blob = Utilities.newBlob(Utilities.base64Decode(s), 'application/x-gzip');
    return Utilities.ungzip(blob).getDataAsString('UTF-8');
  } catch (e) { return null; }
}

function cacheEcrire_(cle, json, ttl) {
  try {
    var z = Utilities.gzip(Utilities.newBlob(json, 'application/json'));
    var s = Utilities.base64Encode(z.getBytes());
    var T = 90000, o = {}, n = Math.ceil(s.length / T);
    if (n > 20) return false;                        // plus de 1,8 Mo : on ne garde pas
    for (var i = 0; i < n; i++) o[cle + 'p' + i] = s.substr(i * T, T);
    var c = CacheService.getScriptCache();
    c.putAll(o, ttl || 600);
    c.put(cle + 'n', String(n), ttl || 600);
    return true;
  } catch (e) { return false; }
}

/* La réponse d'une lecture lourde : toute faite si les données n'ont pas
   bougé depuis, sinon calculée puis gardée. Deux téléphones qui la demandent
   au même moment : le second attend quelques secondes le calcul du premier
   plutôt que de refaire le même. */
function enCache_(quoi, fn) {
  var v = versionDonnees_();
  var cle = cleCache_(quoi + '|' + v + '|' + isoJour_(new Date()));
  var s = cacheLire_(cle);
  if (s) return texteJson_(s);
  var c = CacheService.getScriptCache();
  if (c.get(cle + 'g')) {
    for (var i = 0; i < 24; i++) {
      Utilities.sleep(500);
      s = cacheLire_(cle);
      if (s) return texteJson_(s);
      if (!c.get(cle + 'g')) break;
    }
  }
  try { c.put(cle + 'g', '1', 30); } catch (e) {}
  var obj = fn();
  var json = JSON.stringify(obj);
  if (obj && obj.ok !== false) cacheEcrire_(cle, json, 600);
  try { c.remove(cle + 'g'); } catch (e2) {}
  return texteJson_(json);
}

/* Ce qui, dans la demande, change la réponse : tout sauf l'identité. */
function paramsCache_(d) {
  var o = {};
  Object.keys(d || {}).sort().forEach(function (k) {
    if (k === 'nom' || k === 'code' || k === 'appareil') return;
    o[k] = d[k];
  });
  return JSON.stringify(o);
}

/* Les listes de personnes, lues à chaque appel pour vérifier le code : gardées
   en mémoire sous la version des données (une modification à la main du
   classeur la change, par onEdit). */
function personnesEnCache_(quoi, fn) {
  try {
    var c = CacheService.getScriptCache();
    var cle = 'P_' + quoi + '_' + versionDonnees_();
    var s = c.get(cle);
    if (s) return JSON.parse(s);
    var l = fn();
    try { c.put(cle, JSON.stringify(l), 900); } catch (e1) {}
    return l;
  } catch (e) { return fn(); }
}

/** POST {action:'sync', nom, code, devis, pdf(base64)} */
var PERF_ = null, T0_DOPOST_ = 0;
function perf_(k) { if (!PERF_) return; var t = Date.now(); PERF_.push(k + ' ' + (t - PERF_.t)); PERF_.t = t; }
function doPost(e) {
  var rel = relaisMigration_();
  if (rel) return relayer_(rel, e, true);
  T0_DOPOST_ = Date.now();
  /* v108v — la question « y a-t-il du neuf ? », posée toutes les 15 s par
     chaque téléphone : répondue avant toute lecture du classeur. Le numéro
     ne dit rien des données elles-mêmes. */
  var corps0 = (e && e.postData && e.postData.contents) || '';
  if (corps0.length < 400 && corps0.indexOf('"version"') >= 0) {
    try {
      var dv = JSON.parse(corps0);
      if (dv && dv.action === 'version') return reponse_({ ok: true, v: versionDonnees_() });
    } catch (eV) {}
  }
  var lock = LockService.getScriptLock();
  var aSignaler = false;
  MEMO_ONGLETS_ = null;
  try {
    var d = JSON.parse(e.postData.contents);
    /* v99 — la page de signature du client : pas de nom ni de code, c'est le
       jeton signé du lien qui ouvre (et seulement ce devis-là). */
    if (d.action === 'devisPublic') return reponse_(devisPublic_(d));
    if (d.action === 'signerDistance') {
      lock.waitLock(30000);
      aSignaler = true;
      return reponse_(signerDistance_(d));
    }
    var actions = ['connexion', 'config', 'sync', 'photo', 'journal', 'statut',
                   'planning', 'chantier', 'tableau', 'planifier',
                   'chantierNeuf', 'lotChantiers',
                   'recurrentNeuf', 'recurrentModif', 'recurrentStop',
                   'rdvNeuf', 'monChantier',
                   'prospects', 'appel', 'historique',
                   'facturation', 'facturer', 'facturesMois', 'facturerAppli', 'marquerFacturee', 'refaireFacture',
                   'mesDevis', 'devisArchive',
                   'poserDevis', 'suggestions', 'lienSignature',
                   'ficheJointe', 'ficheRetirer', 'ficheLire', 'aFaireRemise', 'recurrentRenouveler',
                   'absenceAjouter', 'absenceRetirer', 'commissions',
                   'elementsPaie', 'etatNotifs', 'essaiNotif', 'telClient', 'disposSalaries', 'statsSociete', 'lierDevis', 'envoyerFacture', 'contratsMaj'];
    if (actions.indexOf(d.action) < 0) return reponse_({ ok: false, erreur: 'action inconnue' });

    // Un seul et même refus, que le nom soit inconnu ou le code faux.
    if (tropDEssais_(d.nom)) {
      return reponse_({ ok: false, refus: true, erreur: 'Trop d\'essais. Réessaie dans un quart d\'heure.' });
    }
    var com = trouverPersonne_(d.nom);
    /* Une fiche sans code laissait entrer avec n'importe quel code : la
       condition ne se déclenchait que si un code était inscrit. Une ligne
       ajoutée en vitesse, un code effacé par erreur, et le compte s'ouvrait à
       qui connaissait le nom. Sans code, on refuse. */
    if (!com || !com.code || String(d.code || '') !== com.code) {
      noterEchec_(d.nom);
      // On ne journalise que les noms qui existent : sinon, n'importe qui
      // pourrait remplir le journal en essayant des noms au hasard.
      if (com) {
        tracerServeur_(com.nom, 'CODE REFUSE', '', '', d.appareil || '');
      } else if (personneInactive_(d.nom)) {
        /* Le compte existe mais il a été désactivé : c'est une coupure voulue,
           pas une tentative d'intrusion. Le téléphone, lui, reçoit le même
           refus que les autres et efface sa session. */
        tracerServeur_(String(d.nom || '').trim(), 'ACCES COUPE',
                       'compte désactivé au classeur', '', d.appareil || '');
      }
      return reponse_({ ok: false, refus: true, erreur: 'Nom ou code incorrect' });
    }

    // La cloison entre les deux métiers. Un agent ne peut pas appeler les
    // actions du commercial, et réciproquement : ce n'est pas l'écran qui
    // protège, c'est cette liste.
    var agent = com.role === 'PRESTATAIRE';
    var admin = com.role === 'ADMIN';
    var permis = admin
      ? ['connexion', 'config', 'journal', 'tableau', 'planifier', 'statut',
         'chantierNeuf', 'lotChantiers',
         /* Un contrat engage l'équipe chaque semaine : le gérant seul le crée,
            le modifie ou l'arrête. */
         'recurrentNeuf', 'recurrentModif', 'recurrentStop',
         /* Le gerant etablit ses propres devis depuis son tableau : « sync »
            est ce qui les depose, « photo » ce qui porte la signature. */
         'sync', 'photo',
         'prospects', 'appel', 'historique',
         /* Facturer engage l'entreprise : ces trois actions sont au gérant
            seul. Un commercial qui les appelle se voit refusé, et le refus
            part au journal. */
         'facturation', 'facturer', 'facturesMois', 'facturerAppli', 'marquerFacturee', 'refaireFacture',
         /* Poser le travail d'un devis que le commercial n'a pas encore
            déclaré signé : c'est un engagement pris sur la parole du client,
            il revient au gérant seul. */
         'poserDevis', 'suggestions', 'lienSignature',
         /* La fiche chantier : le gérant la joint, la remplace, la retire. */
         'ficheJointe', 'ficheRetirer', 'ficheLire',
         /* Remettre « À faire » à zéro : un écran à lui. */
         'aFaireRemise', 'recurrentRenouveler',
         /* v104 — les congés des salariés, saisis par le gérant. */
         'absenceAjouter', 'absenceRetirer',
         'mesDevis', 'devisArchive', 'commissions',
         /* v108 — les éléments de paie du mois ; v108e — l'état des notifications. */
         'elementsPaie', 'etatNotifs', 'essaiNotif', 'telClient', 'disposSalaries', 'statsSociete', 'lierDevis', 'envoyerFacture', 'contratsMaj']
      : agent
        ? ['connexion', 'config', 'photo', 'journal', 'planning', 'chantier', 'ficheLire', 'essaiNotif']
        : ['connexion', 'config', 'sync', 'photo', 'journal', 'statut',
           'prospects', 'appel', 'historique',
           /* Ses devis à lui, relus dans le classeur : l'action filtre sur
              son nom, elle ne sait pas rendre ceux d'un autre. */
           'mesDevis', 'devisArchive', 'lienSignature',
           /* v107 — son chiffre, ses commissions et le total de la société. */
           'commissions', 'essaiNotif'];
    /* Le commercial qui fait aussi des chantiers lit son planning et pointe.
       On ne lui ouvre que ces deux actions, et seulement s'il figure vraiment
       parmi les prestataires : c'est la liste qui protège, pas l'écran. Et
       « planning » ne rend jamais que les chantiers à son nom. */
    if (!admin && !agent && aussiPrestataire_(com.nom)) {
      permis = permis.concat(['planning', 'chantier', 'rdvNeuf', 'monChantier', 'ficheLire']);
    }
    if (permis.indexOf(d.action) < 0) {
      tracerServeur_(com.nom, 'ACTION REFUSEE', d.action, '', d.appareil || '');
      return reponse_({ ok: false, erreur: 'action non autorisée pour ce compte' });
    }
    /* v108v — une lecture lit chaque onglet une fois ; une écriture, elle,
       change la version des données en partant (voir finally). */
    if (LECTURES_.indexOf(d.action) >= 0) MEMO_ONGLETS_ = {};
    else aSignaler = true;

    if (d.action === 'connexion') {
      tracerServeur_(com.nom, 'CONNEXION VALIDEE', com.role, '', d.appareil || '');
      return reponse_({ ok: true, nom: com.nom, role: com.role,
                        config: configPour_(com.role, com) });
    }
    if (d.action === 'planning') {
      return enCache_('planning|' + com.nom, function () {
        return { ok: true, chantiers: planningDe_(com.nom) };
      });
    }
    if (d.action === 'chantier') return reponse_(enregistrerChantier_(d, com));
    if (d.action === 'ficheLire') return reponse_(lireFiche_(d, com));
    if (d.action === 'aFaireRemise') return reponse_(remiseAFaire_(com, d));
    if (d.action === 'recurrentRenouveler') { lock.waitLock(30000); return reponse_(recurrentRenouveler_(d, com)); }
    if (d.action === 'absenceAjouter' || d.action === 'absenceRetirer') {
      lock.waitLock(30000);
      return reponse_(d.action === 'absenceAjouter' ? absenceAjouter_(d, com) : absenceRetirer_(d, com));
    }
    if (d.action === 'ficheJointe' || d.action === 'ficheRetirer') {
      lock.waitLock(30000);
      return reponse_(d.action === 'ficheJointe' ? joindreFiche_(d, com) : retirerFiche_(d, com));
    }
    if (d.action === 'journal') {
      var evs = (d.evenements || []).slice(0, 300).map(function (e) {
        return { t: e.t, nom: e.nom || com.nom, action: e.action, detail: e.detail,
                 numero: e.numero, appareil: d.appareil || '', source: 'APPAREIL' };
      });
      tracer_(evs);
      return reponse_({ ok: true, recus: evs.length });
    }
    if (d.action === 'config') {
      return reponse_({ ok: true, config: configPour_(com.role, com) });
    }
    if (d.action === 'tableau') {
      /* v106 — le temps de chaque partie du tableau, au journal d'exécution
         (Apps Script › Exécutions) : pour savoir où passent les secondes. */
      return enCache_('tableau', function () {
        PERF_ = [String(Date.now() - T0_DOPOST_) + ' ms avant']; PERF_.t = Date.now();
        var tab = tableauAdmin_();
        tab.perf = PERF_.join(' · ') + ' · total ' + (Date.now() - T0_DOPOST_) + ' ms';
        console.log('tableau ' + tab.perf);
        PERF_ = null;
        return tab;
      });
    }
    /* v105 — l'appli n'attend plus la réponse pour fermer la fiche : deux
       créations peuvent donc partir coup sur coup. Le verrou évite qu'elles
       prennent le même numéro CH-, et qu'une ligne réécrite d'un bloc
       (majChantier_) en écrase une autre. */
    if (d.action === 'planifier') { lock.waitLock(30000); return reponse_(planifierChantier_(d, com)); }
    if (d.action === 'poserDevis') return reponse_(poserAvantSignature_(d, com));
    if (d.action === 'chantierNeuf') {
      if (!devisObligatoireOk_(d)) return reponse_({ ok: false, sansDevis: true, erreur: 'relie l\'intervention à un devis (champ « Devis lié »)' });
      lock.waitLock(30000); return reponse_(creerChantier_(d, com));
    }
    if (d.action === 'lierDevis') { lock.waitLock(30000); return reponse_(lierDevis_(d, com)); }
    if (d.action === 'envoyerFacture') { lock.waitLock(30000); return reponse_(envoyerFactureMain_(d, com)); }
    if (d.action === 'contratsMaj') { lock.waitLock(30000); return reponse_(contratsMaj_(d, com)); }
    if (d.action === 'lotChantiers') return reponse_(lotChantiers_(d, com));
    if (d.action === 'recurrentNeuf' || d.action === 'recurrentModif' || d.action === 'recurrentStop') {
      /* Le verrou : deux créations en même temps prendraient le même numéro
         de série, et la génération lit CHANTIERS avant d'y écrire. */
      lock.waitLock(30000);
      if (d.action === 'recurrentNeuf') {
        if (!devisObligatoireOk_(d)) return reponse_({ ok: false, sansDevis: true, erreur: 'relie le contrat à son devis (champ « Devis lié »)' });
        return reponse_(recurrentNeuf_(d, com));
      }
      if (d.action === 'recurrentModif') return reponse_(recurrentModif_(d, com));
      return reponse_(recurrentStop_(d, com));
    }
    if (d.action === 'rdvNeuf') return reponse_(rdvCommercial_(d, com));
    if (d.action === 'monChantier') return reponse_(monChantier_(d, com));
    if (d.action === 'photo') return reponse_(enregistrerPhoto_(d));
    if (d.action === 'statut') return reponse_(enregistrerStatut_(d, com));
    if (d.action === 'facturation') {
      return reponse_(d.v >= 98 ? facturationAppli_(d.periode) : etatFacturation_(d.periode));
    }
    if (d.action === 'facturerAppli') {
      lock.waitLock(30000);
      return reponse_(facturerDepuisAppli_(d, com));
    }
    if (d.action === 'marquerFacturee') {
      lock.waitLock(30000);
      return reponse_(marquerFacturee_(d, com));
    }
    if (d.action === 'refaireFacture') {
      lock.waitLock(30000);
      return reponse_(refaireFacture_(d, com));
    }
    if (d.action === 'facturer') {
      lock.waitLock(30000);
      return reponse_(preparerFacture_(d, com));
    }
    if (d.action === 'facturesMois') {
      lock.waitLock(30000);
      return reponse_(facturesDuMois_(d, com));
    }
    if (d.action === 'mesDevis') return enCache_('mesDevis|' + com.nom + '|' + paramsCache_(d), function () { return mesDevis_(d, com); });
    if (d.action === 'commissions') return enCache_('commissions|' + com.nom + '|' + paramsCache_(d), function () { return commissions_(d, com); });
    if (d.action === 'elementsPaie') return reponse_(elementsPaie_(d));
    if (d.action === 'etatNotifs') return reponse_(etatNotifs_());
    if (d.action === 'telClient') return reponse_(telClientPoser_(d, com));
    if (d.action === 'disposSalaries') return reponse_(disposSalaries_(d));
    if (d.action === 'statsSociete') return enCache_('stats|' + paramsCache_(d), function () { return statsSociete_(d); });
    /* v108l — « que je puisse vérifier les notifs sur mon téléphone » : une
       notification d'essai envoyée à soi-même, et la réponse du service. */
    if (d.action === 'essaiNotif') {
      var rE = notifier_(com.nom, 'Essai de notification', 'Si tu lis ceci, ce téléphone reçoit bien les notifications.');
      tracerServeur_(com.nom, 'NOTIFICATION ESSAI', rE.ok ? 'partie' : String(rE.erreur || 'ratée'), '', d.appareil || '');
      return reponse_({ ok: true, envoye: !!rE.ok, erreur: rE.ok ? '' : String(rE.erreur || ''), aucun: !!rE.aucun });
    }
    if (d.action === 'suggestions') return reponse_(suggestionsPlacement_(d));
    if (d.action === 'lienSignature') return reponse_(lienSignatureAppli_(d, com));
    if (d.action === 'devisArchive') return reponse_(devisArchive_(d, com));
    if (d.action === 'prospects') return reponse_(listeProspects_(d));
    if (d.action === 'historique') return reponse_(historiqueAppels_(d, com));
    /* Les résultats d'appel arrivent par lots : le commercial passe des heures
       sans réseau, et renvoie tout d'un coup. Le verrou protège le compteur de
       tentatives, qui se lit avant de se réécrire. */
    if (d.action === 'appel') {
      lock.waitLock(30000);
      return reponse_(enregistrerAppels_(d, com));
    }

    lock.waitLock(30000);
    var res = enregistrer_(d, com);
    return reponse_(res);
  } catch (err) {
    return reponse_({ ok: false, erreur: String(err && err.message || err) });
  } finally {
    MEMO_ONGLETS_ = null;
    if (aSignaler) donneesChangees_();
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/* ====================== LE NUMÉRO D'UN DEVIS ======================
   Forme décidée par Simon le 3 octobre 2026 :

       devis remis     DEV-26-11/ POSK/ SLG-03
       devis signé     DEV-26-12/ POSK/ SLG-01/ S

   DEV  préfixe réglable (prefixe_devis)
   26-11  année et mois : celui de l'ÉTABLISSEMENT sur un devis remis, celui de
          la SIGNATURE sur un devis signé — le numéro change donc en signant
   POSK  deux premières et deux dernières lettres du client (raison sociale
         pour un professionnel, nom pour un particulier)
   SLG   initiales du commercial
   03    rang du commercial dans le mois
   / S   signé

   Le rang est ce qui rend le numéro unique : deux devis du même mois, du même
   commercial, portent deux rangs différents quel que soit le client. Les
   lettres du client ne comptent donc pas dans la série qui porte le compteur.

   En signant, le devis reçoit un numéro neuf, pris dans la série signée du
   mois de signature ; l'ancien reste dans NUMERO_ORIGINE et au journal, pour
   le retrouver si le client rappelle avec le numéro de son premier exemplaire.

   Les anciens numéros (DEV-2026-SL-0009) ne sont pas touchés : ils ne se
   lisent pas avec cette forme, et tout ce qui suit les laisse tels quels. */

var NUM_FORME_ = /^(.+)-(\d{2})-(\d{2})\/ ([A-Z]+)\/ ([A-Z]+)-(\d+)(\/ S)?$/;

/** Les morceaux d'un numéro, ou null si ce n'est pas la forme en service. */
function numeroLire_(numero) {
  var m = String(numero || '').trim().match(NUM_FORME_);
  if (!m) return null;
  return { prefixe: m[1], an: m[2], mois: m[3], client: m[4],
           initiales: m[5], rang: Number(m[6]), signe: !!m[7] };
}

/** Le numéro écrit, à partir de ses morceaux. */
function numeroEcrire_(p) {
  return p.prefixe + '-' + p.an + '-' + p.mois + '/ ' + p.client + '/ ' +
         p.initiales + '-' + (p.rang < 10 ? '0' + p.rang : String(p.rang)) +
         (p.signe ? '/ S' : '');
}

/** La série qui porte le compteur : ni le client, ni le rang. */
function numeroSerie_(p) {
  return p.prefixe + '-' + p.an + '-' + p.mois + '/ ' + p.initiales +
         (p.signe ? '/ S' : '');
}

/** Deux premières et deux dernières lettres du client. */
function lettresClient_(nom) {
  var s = String(nom || '');
  if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return 'XXXX';
  if (s.length < 4) return (s + 'XXXX').slice(0, 4);
  return s.slice(0, 2) + s.slice(-2);
}

/**
 * Initiales du commercial. Celles de la colonne INITIALES si elle est remplie,
 * sinon la première lettre de chaque mot de son nom, trois au plus.
 */
function initialesDe_(nom, imposees) {
  var f = String(imposees || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (f) return f;
  var p = String(nom || '').trim().split(/\s+/).map(function (m) { return m.charAt(0); }).join('');
  return (p.toUpperCase().replace(/[^A-Z]/g, '') || 'XX').slice(0, 3);
}

/** Un numéro qui ne passe pas dans un nom de fichier : les barres gênent. */
function numeroFichier_(numero) {
  return String(numero || '').replace(/\s*\/\s*/g, '-').replace(/\s+/g, '');
}

/** Plus grand rang déjà utilisé, par série. */
function compteurs_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.DEVIS);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var p = numeroLire_(r[0]);
    if (!p) return;
    var serie = numeroSerie_(p);
    if (!out[serie] || p.rang > out[serie]) out[serie] = p.rang;
  });
  return out;
}

/** Tous les numéros déjà pris dans le classeur. */
function numerosPris_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.DEVIS);
  var pris = {};
  if (!sh || sh.getLastRow() < 2) return pris;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var k = String(r[0]).trim();
    if (k) pris[k] = true;
  });
  return pris;
}

/**
 * Le numéro que prend un devis en devenant signé : mois de la signature,
 * série signée, premier rang libre. Le téléphone en propose un (c'est celui
 * qu'il a imprimé sur le PDF signé) : on le garde s'il est libre et de la
 * bonne forme, sinon on en attribue un à la suite.
 */
function numeroSigne_(client, commercial, quand, propose, pris, reg, reference) {
  pris = pris || numerosPris_();
  var p = numeroLire_(propose);
  if (p && p.signe && !pris[String(propose).trim()]) return String(propose).trim();

  /* Le numéro que le devis portait déjà dit quel préfixe et quelles initiales
     sont les siens : ils valent mieux que ce qu'on devinerait du nom. */
  var ref = numeroLire_(reference) || p;
  var d = quand ? new Date(quand) : new Date();
  var base = {
    prefixe: ref ? ref.prefixe : String((reg || {}).prefixe_devis || 'DEV'),
    an: String(d.getFullYear()).slice(-2),
    mois: ('0' + (d.getMonth() + 1)).slice(-2),
    client: lettresClient_(client),
    initiales: ref ? ref.initiales : initialesDe_(commercial),
    rang: 1, signe: true
  };
  while (pris[numeroEcrire_(base)]) base.rang++;
  return numeroEcrire_(base);
}

/**
 * Le devis change de numéro. Tout ce qui le désigne suit : ses lignes, ses
 * chantiers. Le journal garde les deux numéros, et NUMERO_ORIGINE dit d'où il
 * vient — c'est par là qu'on retrouve le devis si le client rappelle avec le
 * numéro de son premier exemplaire.
 */
function renommerDevis_(ancien, nouveau, origine, qui, appareil) {
  ancien = String(ancien || '').trim();
  nouveau = String(nouveau || '').trim();
  if (!ancien || !nouveau || ancien === nouveau) return false;
  var ss = SpreadsheetApp.getActive();

  var shD = ss.getSheetByName(SH.DEVIS);
  if (!shD || shD.getLastRow() < 2) return false;
  var en = shD.getRange(1, 1, 1, shD.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cNum = en.indexOf('NUMERO'), cOri = en.indexOf('NUMERO_ORIGINE');
  if (cNum < 0) return false;
  var nums = shD.getRange(2, cNum + 1, shD.getLastRow() - 1, 1).getValues();
  var trouve = false;
  for (var i = 0; i < nums.length; i++) {
    if (String(nums[i][0]).trim() !== ancien) continue;
    shD.getRange(i + 2, cNum + 1).setValue(nouveau);
    if (cOri >= 0) shD.getRange(i + 2, cOri + 1).setValue(origine === undefined ? ancien : origine);
    trouve = true;
    break;
  }
  if (!trouve) return false;

  // Les lignes du devis et ses chantiers portent le numéro : ils suivent.
  [SH.LIGNES, SH.CHANTIERS].forEach(function (nom) {
    var sh = ss.getSheetByName(nom);
    if (!sh || sh.getLastRow() < 2) return;
    var e = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    var c = e.indexOf('NUMERO');
    if (c < 0) return;
    var v = sh.getRange(2, c + 1, sh.getLastRow() - 1, 1).getValues();
    for (var k = 0; k < v.length; k++) {
      if (String(v[k][0]).trim() === ancien) sh.getRange(k + 2, c + 1).setValue(nouveau);
    }
  });

  tracerServeur_(qui || 'SYSTEME', 'NUMERO CHANGE', 'ancien ' + ancien, nouveau, appareil || '');
  return true;
}

/**
 * Un devis déjà reçu revient signé. On refait le rangement du PDF — celui du
 * téléphone porte maintenant la signature — et on met la ligne à jour.
 *
 * Le PDF vierge ne disparaît pas sans filet : il part à la corbeille du Drive,
 * d'où il reste récupérable. Le lien de la feuille, lui, pointe aussitôt sur
 * la version signée, qui sert à la fois de devis et de preuve : la photo du
 * papier n'a plus lieu d'être réclamée.
 */
/**
 * Un devis déjà reçu revient avec une remise posée après coup.
 *
 * Le commercial l'a accordée depuis « Mes devis », sur un devis qu'il avait
 * déjà remis au client. Le numéro ne change pas — c'est le même devis, moins
 * cher — mais tout ce qui porte un montant doit suivre : la ligne de DEVIS,
 * ses LIGNES, et le PDF du Drive, que le client va recevoir à nouveau.
 *
 * Le contrôle des tarifs est refait entièrement, et c'est lui qui tient le
 * plafond de remise : un téléphone bricolé qui enverrait 60 % se ferait
 * signaler comme n'importe quel prix inventé.
 */
function reviserDevisRecu_(ligne, col, d, devis, reg, com) {
  var numero = String(ligne[col.NUMERO]);
  var ss = SpreadsheetApp.getActive();
  var communes = lireCommunes_();
  var controle = controlerTarifs_(devis, reg, communes);
  var t = devis.totaux || {};

  var pct = Number(devis.remise) || 0;

  var ancien = String(col.LIEN_PDF != null ? (ligne[col.LIEN_PDF] || '') : '');
  var lien = ancien;
  if (d.pdf) {
    var blob = Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf',
      d.nomFichier || ('Devis ' + numeroFichier_(numero) + '.pdf'));
    lien = dossierDevis_(reg, new Date(devis.date), devis.commercial)
             .createFile(blob).getUrl();
    // Comme à la signature : le nouveau fichier est en place avant que
    // l'ancien parte à la corbeille.
    var m = ancien.match(/\/d\/([A-Za-z0-9_-]+)/);
    if (m) {
      try { DriveApp.getFileById(m[1]).setTrashed(true); }
      catch (e) { tracerServeur_('SYSTEME', 'PDF REMPLACE NON RETIRE',
                                 String(e && e.message || e), numero, ''); }
    }
  }

  /* Tout ce qu'une modification peut changer, et pas seulement la remise.
     À l'origine (v55) cette fonction ne servait qu'à poser une remise sur un
     devis déjà établi, et elle ne réécrivait que les totaux. Depuis la v62, le
     commercial peut rouvrir un devis non signé et en changer le client, les
     prestations, la nature ou la date : si le classeur n'en reprenait que les
     totaux, il garderait l'ancienne adresse et l'ancienne nature, et c'est sur
     elles que seraient posés les chantiers.

     Ce qui ne se réécrit pas, et pourquoi : NUMERO et ID_DEVIS identifient la
     ligne ; DATE est celle du devis d'origine, pas de sa correction ; le suivi
     du bureau — STATUT, SIGNE, MOTIF_REFUS, RELANCE_LE, NOTE_COMMERCIAL —
     appartient au bureau et une révision n'a pas à l'effacer. */
  var c = devis.client || {};
  /* La distance ne vaut que pour les natures qui se vendent sur un secteur,
     comme à la création : sur un chantier elle resterait vide. */
  var kmR = majorableKm_(devis.nature) ? kmDevis_(devis, communes) : '';
  var maj = {
    LIEN_PDF: lien,
    CLIENT: c.societe || c.contact || '',
    TYPE_CLIENT: String(c.type || '').toUpperCase() === 'PART' ? 'PARTICULIER' : 'PROFESSIONNEL',
    SIRET_CLIENT: c.siret || '', TVA_CLIENT: c.tva || '',
    CONTACT: c.contact || '', TELEPHONE: c.tel || '', EMAIL: c.email || '',
    ADRESSE: c.adresse || '', CP: c.cp || '', VILLE: c.ville || '',
    REMISE_PCT: Number(devis.remise) || 0,
    TOTAL_HT_PONCTUEL: t.htPonctuel || 0,
    TOTAL_HT_MENSUEL: t.htMensuel || 0,
    TOTAL_HT: t.ht || 0,
    TOTAL_TVA: t.tva || 0,
    TOTAL_TTC: t.ttc || 0,
    VALIDITE: devis.validite ? new Date(devis.validite) : '',
    OBJET: devis.objet || '',
    LOGEMENT_PLUS_2_ANS: (c.plus2ans === true ? 'OUI' : (c.plus2ans === false ? 'NON' : '')),
    TAUX_TVA: tauxPrincipal_(devis),
    DELAI: devis.delai || '',
    DATE_SOUHAITEE: jourValide_(devis.dateSouhaitee),
    NATURE: natureDevis_(devis.nature),
    ETAT_SITE: etatSite_(devis.etatSite),
    KM_AGENCE: kmR,
    ORIGINE: origineDevis_(devis.origine),
    LIEU_SIGNATURE: String(c.type || '').toUpperCase() === 'PART' ? lieuDevis_(devis.lieuSignature) : '',
    PASSAGES_MOIS: Number(devis.passages) || '',
    NOTES: devis.notes || '',
    CONTROLE_TARIF: controle,
    ENGAGEMENT_MOIS: engagementMois_(devis),
    RECONDUCTION: reconductionDevis_(devis),
    SANS_CONTRAT: devis.sansContrat ? 'OUI' : '',
    PLACEMENT_SUGGERE: placementTexte_(devis.placement)
  };
  colonneAssuree_(SH.DEVIS, 'PLACEMENT_SUGGERE');
  colonneAssuree_(SH.DEVIS, 'ENGAGEMENT_MOIS'); colonneAssuree_(SH.DEVIS, 'RECONDUCTION'); colonneAssuree_(SH.DEVIS, 'SANS_CONTRAT');
  majDevis_(numero, maj);

  /* Les lignes aussi : leur remise et leur montant ont changé. On réécrit
     celles de ce devis plutôt que d'en ajouter, sinon le devis en aurait deux
     jeux et « À facturer » compterait tout en double. */
  try { remplacerLignes_(numero, devis); }
  catch (eL) {
    tracerServeur_('SYSTEME', 'LIGNES NON REECRITES',
                   String(eL && eL.message || eL), numero, '');
  }

  tracerServeur_(devis.commercial || com.nom, 'DEVIS REVISE',
                 (pct ? 'remise ' + pct + ' % — ' : '') + (t.ttc || 0) + ' € TTC — ' +
                 ((devis.lignes || []).length) + ' ligne(s)',
                 numero, d.appareil || '');
  if (controle) {
    tracerServeur_(devis.commercial || com.nom, 'ECART TARIF', controle,
                   numero, d.appareil || '');
  }

  /* Le client reçoit le devis révisé s'il avait reçu le premier : sans cela,
     il garderait en main un papier au mauvais prix. */
  try {
    var c = devis.client || {};
    var copie = [];
    if (com && com.email) copie.push(com.email);
    if (reg.email_copie) copie.push(String(reg.email_copie));
    var pj = d.pdf ? [Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf',
      d.nomFichier || ('Devis ' + numeroFichier_(numero) + '.pdf'))] : [];
    var mpR = mailPerso_(d, c);
    if (d.envoyerClient && mpR.a) {
      envoyerMail_({
        to: mpR.a, cc: copie.join(','),
        subject: mpR.sujet || ('Devis ' + numero + ' révisé — ' + (reg.societe_nom || '')),
        name: String(reg.societe_nom || 'Devis'),
        replyTo: (com && com.email) || String(reg.societe_email || ''),
        htmlBody: mpR.texte ? corpsMailPerso_(devis, mpR.texte, reg) : corpsMail_(devis, reg, com, true),
        attachments: pj
      }, reg);
      noterTonDevis_(numero, mpR.ton);
      /* v108o — « je n'ai rien reçu » : le mail était parti, mais rien ne le
         disait au journal. Désormais si. */
      tracerServeur_(devis.commercial || com.nom, 'DEVIS ENVOYE AU CLIENT', 'révisé — ' + mpR.a + (pj.length ? '' : ' (sans PDF)'), numero, d.appareil || '');
    } else if (copie.length) {
      envoyerMail_({
        to: copie.join(','),
        subject: 'Devis ' + numero + ' révisé — ' + (c.societe || c.contact || ''),
        name: String(reg.societe_nom || 'Devis'),
        htmlBody: 'Remise de ' + pct + ' % posée par ' + (devis.commercial || '') +
                  '.<br>Nouveau montant : ' + eur_(t.ttc) + ' TTC.' +
                  (lien ? '<br><a href="' + lien + '">Ouvrir le PDF</a>' : ''),
        attachments: pj
      }, reg);
    }
  } catch (eMail) {
    /* Un mail raté ne doit pas faire échouer la révision — mais il ne doit pas
       disparaître non plus : sans trace, personne ne sait que le client n'a
       rien reçu. */
    tracerServeur_((devis && devis.commercial) || '', 'MAIL RATE',
      'révision du devis ' + numero + ' — ' + String((eMail && eMail.message) || eMail), numero);
  }

  return { ok: true, revise: true, numero: numero, pdfUrl: lien, controle: controle };
}

/** Les lignes d'un devis, remplacées par celles qui arrivent. */
function remplacerLignes_(numero, devis) {
  var shL = SpreadsheetApp.getActive().getSheetByName(SH.LIGNES);
  if (!shL || shL.getLastRow() < 2) return;
  var enL = shL.getRange(1, 1, 1, shL.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cNum = enL.indexOf('NUMERO');
  if (cNum < 0) return;
  var cible = String(numero).trim();
  var vals = shL.getRange(2, 1, shL.getLastRow() - 1, enL.length).getValues();
  // De bas en haut : retirer une ligne ne décale pas celles qu'il reste à voir.
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][cNum]).trim() === cible) shL.deleteRow(i + 2);
  }
  var rows = (devis.lignes || []).map(function (l, idx) {
    var vl = {
      NUMERO: cible, ORDRE: idx + 1, CATEGORIE: l.categorie || '',
      REFERENCE: l.reference || '', DESIGNATION: l.designation || '', DETAIL: l.detail || '',
      QTE: Number(l.qte) || 0, UNITE: l.unite || '', PU_HT: Number(l.pu) || 0,
      REMISE_PCT: Number(l.rem) || 0, TYPE: l.type || 'PONCTUEL', TVA: Number(l.tva) || 0,
      TOTAL_HT: montantLigne_(l)
    };
    return enL.map(function (h) { return vl.hasOwnProperty(h) ? vl[h] : ''; });
  });
  if (rows.length) {
    shL.getRange(shL.getLastRow() + 1, 1, rows.length, enL.length).setValues(rows);
  }
}

function signerDevisRecu_(ligne, col, d, devis, reg, com) {
  var numero = String(ligne[col.NUMERO]);
  var avant = numero;

  /* En signant, le devis change de numéro : mois de la signature, suffixe / S.
     Le téléphone a imprimé le sien sur le PDF signé — on le garde s'il est
     libre, sinon on en donne un à la suite et le téléphone s'alignera. */
  var quandS = devis.signeLe ? new Date(Number(devis.signeLe)) : new Date();
  var pAv = numeroLire_(numero);
  if (pAv && !pAv.signe) {
    var neuf = numeroSigne_(
      String(ligne[col.CLIENT] || ''), devis.commercial || (com && com.nom) || '',
      quandS, devis.numero, numerosPris_(), reg, numero);
    if (neuf !== numero && renommerDevis_(numero, neuf, avant,
                                          devis.commercial || (com && com.nom), d.appareil)) {
      numero = neuf;
    }
  }

  var ancien = String(col.LIEN_PDF != null ? (ligne[col.LIEN_PDF] || '') : '');
  var lien = ancien;

  if (d.pdf) {
    var blob = Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf',
      d.nomFichier || ('Devis ' + numeroFichier_(numero) + '.pdf'));
    lien = dossierDevis_(reg, new Date(devis.date), devis.commercial)
             .createFile(blob).getUrl();
    // L'ancien fichier ne part à la corbeille qu'une fois le nouveau en place :
    // à aucun moment il n'y a zéro exemplaire du devis dans le Drive.
    var m = ancien.match(/\/d\/([A-Za-z0-9_-]+)/);
    if (m) {
      try { DriveApp.getFileById(m[1]).setTrashed(true); }
      catch (e) { tracerServeur_('SYSTEME', 'PDF VIERGE NON RETIRE',
                                 String(e && e.message || e), numero, ''); }
    }
  }

  majDevis_(numero, {
    LIEN_PDF: lien,
    PREUVE_SIGNATURE: lien,          // le devis signé est sa propre preuve
    SIGNE: 'OUI',
    SIGNATAIRE: devis.signataire || '',
    STATUT: 'SIGNE',
    DATE_STATUT: quandS
  });

  tracerServeur_(devis.commercial || com.nom, 'DEVIS SIGNE RECU',
                 'signé à l\'écran' + (devis.signataire ? ' par ' + devis.signataire : ''),
                 numero, d.appareil || '');
  notifierSignature_(numero, String(ligne[col.CLIENT] || ''), ligne[col.TOTAL_HT],
                     devis.commercial || (com && com.nom) || '', com && com.nom, 'signé sur place');

  // Un devis signé fait naître ses interventions ; la fonction ne double pas
  // celles qui existent déjà.
  try {
    var nes = genererChantiers_(numero);
    if (nes) {
      tracerServeur_(devis.commercial || com.nom, 'CHANTIERS CREES',
                     nes + ' à planifier', numero, d.appareil || '');
    }
    /* Le devis est signé pour de bon : ce qui avait été posé d'avance n'a plus
       rien de provisoire. Les dates et les salariés déjà posés, eux, ne bougent
       pas — planifierDevis_ ne touche jamais une ligne déjà datée. */
    marquerAvantSignature_(numero, false);
    poserPlanning_(numero, devis.commercial || com.nom, d.appareil || '');
  } catch (eC) {
    tracerServeur_('SYSTEME', 'CHANTIERS ECHEC', String(eC && eC.message || eC), numero, '');
  }

  return { ok: true, signe: true, numero: numero, numeroOrigine: avant, pdfUrl: lien };
}

function enregistrer_(d, com) {
  var ss = SpreadsheetApp.getActive();
  var reg = lireReglages_();
  var devis = d.devis;
  var shD = ss.getSheetByName(SH.DEVIS);
  var renumerote = '';

  majStructure_();      // colonnes client professionnel ajoutées si le fichier est antérieur

  // On repère les colonnes par leur nom : le fichier peut évoluer sans casser le code.
  var en = shD.getRange(1, 1, 1, shD.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var col = {};
  en.forEach(function (h, i) { if (h) col[h] = i; });

  if (shD.getLastRow() > 1) {
    var lignes = shD.getRange(2, 1, shD.getLastRow() - 1, en.length).getValues();

    // 1. déjà reçu ? on compare l'identifiant unique du devis, pas son numéro
    //    (un téléphone réinstallé peut réémettre le même numéro pour un autre devis)
    for (var i = 0; i < lignes.length; i++) {
      if (d.id && col.ID_DEVIS != null && String(lignes[i][col.ID_DEVIS]) === String(d.id)) {
        // Le même devis revient avec une signature qu'il n'avait pas : le
        // client a signé à l'écran après coup. Ce n'est pas un doublon, c'est
        // le devis signé qui arrive — le PDF vierge cède la place.
        var dejaSigne = col.SIGNE != null &&
                        String(lignes[i][col.SIGNE] || '').toUpperCase() === 'OUI';
        if (devis.signature && !dejaSigne) {
          return signerDevisRecu_(lignes[i], col, d, devis, reg, com);
        }
        /* Le même devis revient avec une remise posée après coup. Ce n'est pas
           un doublon non plus : c'est le devis révisé, et le bureau doit voir
           le nouveau prix, sans quoi le tableau de bord et « À facturer »
           garderaient l'ancien. Un devis déjà signé ne se révise pas : le
           client a accepté un montant, on ne le change pas dans son dos. */
        if (d.revision && !dejaSigne && !devis.signature) {
          return reviserDevisRecu_(lignes[i], col, d, devis, reg, com);
        }
        return { ok: true, doublon: true, numero: String(lignes[i][col.NUMERO]),
                 pdfUrl: String(lignes[i][col.LIEN_PDF] || '') };
      }
    }

    // 2. numéro déjà pris par un AUTRE devis -> on en attribue un libre
    var pris = {};
    lignes.forEach(function (r) { pris[String(r[0])] = true; });
    if (pris[String(devis.numero)]) {
      var pN = numeroLire_(devis.numero);
      if (pN) {
        // On avance le rang jusqu'au premier libre : le mois, le client et la
        // série du commercial ne bougent pas.
        while (pris[numeroEcrire_(pN)]) pN.rang++;
        renumerote = devis.numero;
        devis.numero = numeroEcrire_(pN);
      } else {
        var m = String(devis.numero).match(/^(.+)-(\d+)$/);        // ancienne forme
        if (m) {
          var serie = m[1], n = Number(m[2]);
          while (pris[serie + '-' + ('000' + n).slice(-4)]) n++;
          renumerote = devis.numero;
          devis.numero = serie + '-' + ('000' + n).slice(-4);
        } else {
          renumerote = devis.numero;
          devis.numero = devis.numero + '-B';
        }
      }
    }
  }

  // PDF reçu du téléphone -> Drive
  var lienPdf = '', blob = null;
  if (d.pdf) {
    blob = Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf',
      d.nomFichier || ('Devis ' + numeroFichier_(devis.numero) + '.pdf'));
    lienPdf = dossierDevis_(reg, new Date(devis.date), devis.commercial).createFile(blob).getUrl();
  }

  var c = devis.client || {}, t = devis.totaux || {};
  var communes = lireCommunes_();
  var controleTarif = controlerTarifs_(devis, reg, communes);
  var kmDevis = majorableKm_(devis.nature) ? kmDevis_(devis, communes) : '';
  /* Une commune encore inconnue entre dans la table avec le chiffre du
     commercial : le prochain devis n'aura plus à le ressaisir. */
  if (kmDevis !== '' && kmTable_(c.cp, c.ville, communes) < 0) {
    try { noterCommune_(c.cp, c.ville, kmDevis, 'COMMERCIAL'); } catch (eC2) {}
  }
  var v = {
    NUMERO: devis.numero, DATE: new Date(devis.date), COMMERCIAL: devis.commercial,
    CLIENT: c.societe || c.contact || '',
    TYPE_CLIENT: String(c.type || '').toUpperCase() === 'PART' ? 'PARTICULIER' : 'PROFESSIONNEL',
    SIRET_CLIENT: c.siret || '', TVA_CLIENT: c.tva || '',
    CONTACT: c.contact || '', TELEPHONE: c.tel || '', EMAIL: c.email || '',
    ADRESSE: c.adresse || '', CP: c.cp || '', VILLE: c.ville || '',
    TOTAL_HT_PONCTUEL: t.htPonctuel || 0, TOTAL_HT_MENSUEL: t.htMensuel || 0,
    TOTAL_HT: t.ht || 0, TOTAL_TVA: t.tva || 0, TOTAL_TTC: t.ttc || 0,
    REMISE_PCT: devis.remise || 0,
    STATUT: devis.signature ? 'SIGNE' : 'REMIS',
    SIGNE: devis.signature ? 'OUI' : 'NON',
    DATE_STATUT: devis.signature ? new Date() : '',
    SIGNATAIRE: devis.signataire || '', VALIDITE: new Date(devis.validite), LIEN_PDF: lienPdf,
    NOTES: (devis.notes || '') +
      (renumerote ? ' [numéro d\'origine sur le PDF du client : ' + renumerote + ']' : ''),
    RECU_LE: new Date(), ID_APPAREIL: d.appareil || '', ID_DEVIS: d.id || '',
    OBJET: devis.objet || '',
    LOGEMENT_PLUS_2_ANS: (c.plus2ans === true ? 'OUI' : (c.plus2ans === false ? 'NON' : '')),
    TAUX_TVA: tauxPrincipal_(devis),
    DELAI: devis.delai || '',
    /* La date à partir de laquelle l'intervention peut commencer. Elle était
       noyée dans le texte libre de DELAI : le classeur ne pouvait rien en
       faire. C'est elle qui commande maintenant la pose sur le planning. */
    DATE_SOUHAITEE: jourValide_(devis.dateSouhaitee),
    CONTROLE_TARIF: controleTarif,
    /* La nature vient du devis, pas des lignes : c'est elle qui dit combien de
       chantiers créer. Sans elle, PASSAGES_MOIS restait vide et le classeur
       retombait toujours sur le réglage par défaut, quel que soit le contrat.
       Trois natures possibles ; tout ce qui n'est pas reconnu est une
       intervention unique, c'est le cas le moins coûteux à corriger. */
    NATURE: natureDevis_(devis.nature),
    ETAT_SITE: etatSite_(devis.etatSite),
    KM_AGENCE: kmDevis,
    ORIGINE: origineDevis_(devis.origine),
    LIEU_SIGNATURE: String(c.type || '').toUpperCase() === 'PART' ? lieuDevis_(devis.lieuSignature) : '',
    PASSAGES_MOIS: Number(devis.passages) || '',
    ENGAGEMENT_MOIS: engagementMois_(devis),
    RECONDUCTION: reconductionDevis_(devis),
    SANS_CONTRAT: devis.sansContrat ? 'OUI' : '',
    PLACEMENT_SUGGERE: placementTexte_(devis.placement)
  };
  if (controleTarif) {
    tracerServeur_(devis.commercial || com.nom, 'ECART TARIF', controleTarif,
                   devis.numero, d.appareil || '');
  }
  shD.appendRow(en.map(function (h) { return v.hasOwnProperty(h) ? v[h] : ''; }));

  var shL = ss.getSheetByName(SH.LIGNES);
  var enL = shL.getRange(1, 1, 1, shL.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var rows = (devis.lignes || []).map(function (l, idx) {
    var vl = {
      NUMERO: devis.numero, ORDRE: idx + 1, CATEGORIE: l.categorie || '',
      REFERENCE: l.reference || '', DESIGNATION: l.designation || '', DETAIL: l.detail || '',
      QTE: Number(l.qte) || 0, UNITE: l.unite || '', PU_HT: Number(l.pu) || 0,
      REMISE_PCT: Number(l.rem) || 0, TYPE: l.type || 'PONCTUEL', TVA: Number(l.tva) || 0,
      TOTAL_HT: montantLigne_(l)
    };
    return enL.map(function (h) { return vl.hasOwnProperty(h) ? vl[h] : ''; });
  });
  if (rows.length) shL.getRange(shL.getLastRow() + 1, 1, rows.length, enL.length).setValues(rows);
  /* v108v — le devis est au classeur : les autres le voient dès maintenant,
     sans attendre l'envoi du courriel et de sa pièce jointe. */
  donneesChangees_();

  // e-mails
  try {
    var pj = blob ? [blob] : [];
    var copie = [];
    if (com.email) copie.push(com.email);
    if (reg.email_copie) copie.push(String(reg.email_copie));
    var mp = mailPerso_(d, c);
    if (d.envoyerClient && mp.a) {
      envoyerMail_({
        to: mp.a, cc: copie.join(','),
        subject: mp.sujet || ('Devis ' + devis.numero + ' — ' + (reg.societe_nom || '')),
        name: String(reg.societe_nom || 'Devis'),
        replyTo: com.email || String(reg.societe_email || ''),
        htmlBody: mp.texte ? corpsMailPerso_(devis, mp.texte, reg) : corpsMail_(devis, reg, com),
        attachments: pj
      }, reg);
      noterTonDevis_(devis.numero, mp.ton);
      tracerServeur_(devis.commercial || com.nom, 'DEVIS ENVOYE AU CLIENT',
                     mp.a + (mp.texte ? ' — message personnalisé' : '') + (devis.signature ? '' : ' — lien de signature'),
                     devis.numero, d.appareil || '');
    } else if (copie.length) {
      envoyerMail_({
        to: copie.join(','),
        subject: 'Devis ' + devis.numero + ' — ' + (c.societe || c.contact || ''),
        name: String(reg.societe_nom || 'Devis'),
        htmlBody: 'Devis enregistré par ' + devis.commercial + '.<br>Montant : ' +
                  eur_(t.ttc) + ' TTC.<br>' + (lienPdf ? '<a href="' + lienPdf + '">Ouvrir le PDF</a>' : ''),
        attachments: pj
      }, reg);
    }
  } catch (eMail) {
    /* Même règle : la synchro aboutit, mais l'échec d'envoi s'inscrit au
       journal. Un devis « reçu » dont le client n'a jamais eu le courriel est
       le genre de chose qu'on découvre trois semaines trop tard. */
    tracerServeur_(devis.commercial || '', 'MAIL RATE',
      'devis ' + devis.numero + ' — ' + String((eMail && eMail.message) || eMail), devis.numero);
  }

  if (devis.signature) {
    notifierSignature_(devis.numero, c.societe || c.contact || '', t.ht, devis.commercial || (com && com.nom) || '', com && com.nom, 'signé sur place');
  }
  tracerServeur_(devis.commercial, 'DEVIS RECU',
    (c.societe || c.contact || '') + ' — ' + eur_(t.ttc) + ' TTC' +
    (devis.signature ? ' — signé' : ' — non signé') +
    (renumerote ? ' — renuméroté depuis ' + renumerote : ''),
    devis.numero, d.appareil || '');

  return { ok: true, doublon: false, numero: devis.numero, pdfUrl: lienPdf,
           renumerote: renumerote || undefined };
}

/**
 * Photo prise sur le site, rangée dans le même dossier que le PDF du devis.
 * Elle arrive après le devis, dans un appel séparé : une photo lourde qui
 * n'arrive pas ne doit jamais bloquer l'enregistrement du devis lui-même.
 */
function enregistrerPhoto_(d) {
  if (!d.image) return { ok: false, erreur: 'photo vide' };
  var reg = lireReglages_();
  var dossier = dossierDevis_(reg, new Date(d.date), d.commercial);

  var signee = (String(d.type || '') === 'SIGNE');
  var n = Number(d.index) || 1;
  var nom = 'Devis-' + (numeroFichier_(d.numero) || 'sans-numero') +
            (signee ? '-signe-' : '-photo-') + ('0' + n).slice(-2) + '.jpg';

  // déjà reçue ? (l'appareil peut réessayer après une coupure de réseau)
  var it = dossier.getFilesByName(nom);
  if (it.hasNext()) {
    var dej = it.next();
    if (signee) majDevis_(d.numero, { PREUVE_SIGNATURE: dej.getUrl() });
    return { ok: true, doublon: true, url: dej.getUrl() };
  }

  var blob = Utilities.newBlob(Utilities.base64Decode(d.image), 'image/jpeg', nom);
  var f = dossier.createFile(blob);
  if (signee) majDevis_(d.numero, { PREUVE_SIGNATURE: f.getUrl() });
  else noterPhotos_(d.numero, dossier);
  tracerServeur_(d.commercial || '',
                 signee ? 'PREUVE SIGNATURE RECUE' : 'PHOTO RECUE',
                 (signee ? 'page ' : 'photo ') + n + ' sur ' + (d.total || n),
                 d.numero, d.appareil || '');
  return { ok: true, url: f.getUrl() };
}

/**
 * Écrit quelques cellules d'un devis déjà enregistré, repéré par son numéro.
 * Les colonnes sont désignées par leur nom : l'ordre réel du classeur peut
 * changer, un numéro de colonne codé en dur finirait par écrire à côté.
 */
function majDevis_(numero, valeurs) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.DEVIS);
  if (!sh || sh.getLastRow() < 2) return false;
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cNum = en.indexOf('NUMERO');
  if (cNum < 0) return false;
  var cible = String(numero).trim();
  var nums = sh.getRange(2, cNum + 1, sh.getLastRow() - 1, 1).getValues();
  var ligne = -1;
  for (var i = 0; i < nums.length; i++) {
    if (String(nums[i][0]).trim() === cible) { ligne = i; break; }
  }
  /* Rien à ce numéro : c'est peut-être celui d'avant la signature, que le
     téléphone garde tant qu'il n'a pas reçu le nouveau. */
  var cOri = en.indexOf('NUMERO_ORIGINE');
  if (ligne < 0 && cOri >= 0) {
    var oris = sh.getRange(2, cOri + 1, sh.getLastRow() - 1, 1).getValues();
    for (var j = 0; j < oris.length; j++) {
      if (String(oris[j][0]).trim() === cible) { ligne = j; break; }
    }
  }
  if (ligne < 0) return false;
  for (var k in valeurs) {
    if (!valeurs.hasOwnProperty(k)) continue;
    var c = en.indexOf(k);
    if (c >= 0) sh.getRange(ligne + 2, c + 1).setValue(valeurs[k]);
  }
  return true;
}

/**
 * Résultat du rendez-vous, tel que le commercial l'a saisi sur place.
 * Le devis est signé sur le papier imprimé : sans cette réponse, le classeur
 * ne saurait jamais ce qu'un devis est devenu. Toujours corrigeable : la
 * dernière réponse reçue remplace la précédente, et le journal garde les deux.
 */
function enregistrerStatut_(d, com) {
  var num = String(d.numero || '').trim();
  if (!num) return { ok: false, erreur: 'numéro manquant' };

  var note = String(d.note || '');
  var statut = { SIGNE: 'SIGNE', RELANCE: 'A RELANCER', REFUSE: 'REFUSE' }[String(d.verdict || '')];

  // Le commercial peut n'envoyer qu'une note, sans avoir encore répondu :
  // dans ce cas on n'écrit que la note et on ne touche pas au statut.
  if (!statut && !note) return { ok: false, erreur: 'résultat inconnu' };

  var quand = d.quand ? new Date(Number(d.quand)) : new Date();
  var v = statut ? {
    STATUT: statut,
    DATE_STATUT: quand,
    MOTIF_REFUS: statut === 'REFUSE' ? String(d.motif || '') : '',
    RELANCE_LE: statut === 'A RELANCER' && d.relance ? new Date(d.relance + 'T09:00:00') : '',
    SIGNE: statut === 'SIGNE' ? 'OUI' : 'NON'
  } : {};
  // La note ne s'écrit que si l'envoi en portait une : un résultat transmis
  // seul ne doit pas effacer ce que le commercial avait déjà noté.
  if (d.note !== undefined) v.NOTE_COMMERCIAL = note;
  /* La ligne telle qu'elle est aujourd'hui : son état dit si une « relance »
     défait une signature, et ses coordonnées servent au nouveau numéro. */
  var avant = null, tous = lireDevis_();
  tous.forEach(function (x) { if (String(x.NUMERO).trim() === num) avant = x; });
  if (!avant) {
    /* Le téléphone peut répondre avec le numéro d'avant la signature : c'est
       celui qu'il a en mémoire s'il n'a pas encore reçu le nouveau. */
    tous.forEach(function (x) {
      if (String(x.NUMERO_ORIGINE || '').trim() === num) avant = x;
    });
    if (avant) num = String(avant.NUMERO).trim();
  }
  var statutAvant = avant ? String(avant.STATUT || '').toUpperCase().trim() : '';
  var qui = com ? com.nom : (d.nom || '');
  var numeroAvant = '';

  /* Signer change le numéro : mois de la signature, suffixe / S. Le devis a
     été signé sur le papier — aucun PDF neuf n'arrive, celui du client garde
     donc l'ancien numéro, que NUMERO_ORIGINE conserve. */
  var pNum = numeroLire_(num);
  if (statut === 'SIGNE' && statutAvant && statutAvant !== 'SIGNE' && pNum && !pNum.signe) {
    var neufS = numeroSigne_(avant ? avant.CLIENT : '',
                             (avant && avant.COMMERCIAL) || qui,
                             quand, '', numerosPris_(), lireReglages_(), num);
    if (renommerDevis_(num, neufS, num, qui, d.appareil)) { numeroAvant = num; num = neufS; }
  }

  var trouve = majDevis_(num, v);

  tracerServeur_(com ? com.nom : (d.nom || ''),
                 statut ? ('RESULTAT ' + statut) : 'NOTE DU COMMERCIAL',
                 statut ? (v.MOTIF_REFUS || (d.relance ? 'relance le ' + d.relance : '')) : note.slice(0, 120),
                 num, d.appareil || '');

  // Le devis n'est pas encore arrivé : l'appareil réessaiera au prochain envoi.
  if (!trouve) return { ok: false, erreur: 'devis introuvable dans le classeur' };

  // Un devis signé fait naître les interventions à planifier. La fonction ne
  // fait rien si elles existent déjà : un téléphone qui réessaie ne double pas.
  var nes = 0;
  if (statut === 'SIGNE' && statutAvant !== 'SIGNE') {
    notifierSignature_(num, avant ? avant.CLIENT : '', avant ? avant.TOTAL_HT : '',
                       (avant && avant.COMMERCIAL) || '', com ? com.nom : (d.nom || ''), 'déclaré signé');
  }
  if (statut === 'SIGNE') {
    try {
      nes = genererChantiers_(num);
      if (nes) {
        tracerServeur_(com ? com.nom : (d.nom || ''), 'CHANTIERS CREES',
                       nes + ' à planifier', num, d.appareil || '');
      }
      marquerAvantSignature_(num, false);
      poserPlanning_(num, com ? com.nom : (d.nom || ''), d.appareil || '');
    } catch (eC) {
      tracerServeur_('SYSTEME', 'CHANTIERS ECHEC', String(eC && eC.message || eC),
                     num, '');
    }
  }
  /* Le devis n'est plus signé : ses rendez-vous ne tiennent plus. Un refus les
     retire toujours ; une relance seulement si elle remplace une signature. */
  var annules = 0;
  if (statut === 'REFUSE' || (statut === 'A RELANCER' && statutAvant === 'SIGNE')) {
    try {
      annules = annulerChantiers_(num, statut, qui, d.appareil || '').length;
    } catch (eA) {
      tracerServeur_('SYSTEME', 'ANNULATION ECHEC', String(eA && eA.message || eA), num, '');
    }
  }

  /* Un devis qui n'est plus signé reprend le numéro qu'il portait avant de
     l'être : le suffixe / S ne doit rester sur rien d'autre qu'un devis signé.
     Si quelqu'un a repris ce numéro entre-temps, on n'y touche pas. */
  if (statutAvant === 'SIGNE' && statut && statut !== 'SIGNE') {
    var ori = avant ? String(avant.NUMERO_ORIGINE || '').trim() : '';
    if (ori && !numerosPris_()[ori] && renommerDevis_(num, ori, '', qui, d.appareil)) {
      numeroAvant = num; num = ori;
    }
  }
  return { ok: true, statut: statut || '(note seule)', numero: num,
           numeroOrigine: numeroAvant, chantiers: nes, annules: annules };
}

/* ====================== ESPACE PRESTATAIRE ======================
   Un agent n'est pas un commercial au rabais : il voit un autre outil, et il
   reçoit d'autres données. La frontière est ici, pas dans l'écran — masquer un
   bouton laisserait les tarifs dans son téléphone. */

/**
 * Ce que reçoit un agent à la connexion. Volontairement maigre : le nom de la
 * société pour l'en-tête, et le texte d'information sur ce qui est enregistré.
 * Ni catalogue, ni prix, ni compteurs, ni coordonnées bancaires.
 */
/* ====================== ESPACE D'ADMINISTRATION ======================
   Ce que voit un compte ADMIN : les devis de tous les commerciaux, les
   chantiers de tous les prestataires, et les chiffres qui vont avec. Tout
   part en un seul appel, que l'appareil garde en cache : sur un téléphone,
   trois allers-retours pour afficher un écran, c'est trois occasions de
   tomber en rade de réseau. */

/** Lit un onglet et renvoie ses lignes sous forme d'objets nommés. */
/* v108v — tout l'onglet, en-tête compris ; null s'il est absent ou vide.
   Pendant une lecture seule, lu une fois et gardé pour la suite de l'appel. */
function valeursOnglet_(nom) {
  if (MEMO_ONGLETS_ && MEMO_ONGLETS_.hasOwnProperty(nom)) return MEMO_ONGLETS_[nom];
  var sh = SpreadsheetApp.getActive().getSheetByName(nom), v = null;
  if (sh && sh.getLastRow() >= 2) v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  if (MEMO_ONGLETS_) MEMO_ONGLETS_[nom] = v;
  return v;
}

function objetsDe_(nom) {
  var v = valeursOnglet_(nom);
  if (!v || v.length < 2) return [];
  var en = v[0].map(function (x) { return String(x).trim(); });
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = {};
    en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
    out.push(o);
  }
  return out;
}

function tableauAdmin_() {
  var reg = lireReglages_();
  var jours = Number(reg.admin_fenetre_jours || 90);
  var depuis = new Date(); depuis.setDate(depuis.getDate() - jours); depuis.setHours(0, 0, 0, 0);

  var devis = [], chiffres = { nb: 0, signes: 0, ht: 0, htSigne: 0, mensuelSigne: 0 }, par = {};
  objetsDe_(SH.DEVIS).forEach(function (o) {
    var d = o.DATE ? new Date(o.DATE) : null;
    if (!d || isNaN(d.getTime())) return;
    var st = String(o.STATUT || '').toUpperCase();
    /* v108q — un devis signé plus ancien que la fenêtre reste dans la liste :
       c'est à lui qu'on relie les interventions (« Devis lié »). Il ne compte
       plus dans les chiffres de la période. */
    var vieux = d < depuis;
    if (vieux && st !== 'SIGNE') return;
    var ht = Number(o.TOTAL_HT) || 0;
    var mens = Number(o.TOTAL_HT_MENSUEL) || 0;
    var qui = String(o.COMMERCIAL || '').trim() || '(sans nom)';
    if (!vieux) {
    if (!par[qui]) par[qui] = { nom: qui, nb: 0, signes: 0, ht: 0, htSigne: 0, mensuelSigne: 0 };
    chiffres.nb++; par[qui].nb++;
    chiffres.ht += ht; par[qui].ht += ht;
    }
    if (st === 'SIGNE' && !vieux) {
      chiffres.signes++; par[qui].signes++;
      chiffres.htSigne += ht; par[qui].htSigne += ht;
      chiffres.mensuelSigne += mens; par[qui].mensuelSigne += mens;
    }
    devis.push({
      numero: String(o.NUMERO || ''), date: isoJour_(d),
      commercial: qui, client: String(o.CLIENT || ''), ville: String(o.VILLE || ''),
      ttc: Number(o.TOTAL_TTC) || 0, ht: ht, statut: st || 'REMIS',
      motif: String(o.MOTIF_REFUS || ''),
      relance: o.RELANCE_LE ? isoJour_(o.RELANCE_LE) : '',
      pdf: String(o.LIEN_PDF || ''), signe: String(o.SIGNE || '').toUpperCase() === 'OUI',
      preuve: String(o.PREUVE_SIGNATURE || '') ? true : false,
      note: String(o.NOTE_COMMERCIAL || ''),
      placement: placementLire_(o.PLACEMENT_SUGGERE),
      /* v93 — de quoi mettre un devis d'entretien au calendrier comme contrat,
         sans retaper le client : le rythme, l'adresse, la nature, le mensuel. */
      recurrent: recurrentDevis_(o.NATURE, o.PASSAGES_MOIS, o.SANS_CONTRAT),
      passagesMois: Number(o.PASSAGES_MOIS) || 0,
      mensuel: mens,
      nature: natureOuVide_(o.NATURE),
      adresse: String(o.ADRESSE || ''), cp: String(o.CP || ''),
      historique: devisHistorique_(o), ancien: vieux
    });
  });
  devis.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  if (devis.length > 400) devis = devis.slice(0, 400);
  perf_('devis');

  var hier = new Date(); hier.setDate(hier.getDate() - 30); hier.setHours(0, 0, 0, 0);
  var loin = new Date(); loin.setDate(loin.getDate() + 90);
  var natures = naturesParDevis_();
  var calT = calendrier_(reg);
  var chantiers = [];
  /* Combien de chantiers chaque devis a-t-il déjà, et combien lui restent à
     poser ? Compté avant le filtre de dates, sinon un devis dont les passages
     tombent hors de la fenêtre passerait pour n'en avoir aucun, et l'écran
     proposerait de les reposer.

     Les annulés ne comptent ni d'un côté ni de l'autre : ce n'est plus du
     travail. Un chantier « à poser » est un chantier sans date ou sans
     personne — dans les deux cas il n'apparaît sur aucun téléphone. */
  var parDevis = {}, aPoser = {};
  var TELS = telsClients_();
  objetsDe_(SH.CHANTIERS).forEach(function (o) {
    if (!String(o.ID || '').trim()) return;
    var nd = String(o.NUMERO || '').trim();
    if (nd && String(o.STATUT || '').toUpperCase().trim() !== 'ANNULE') {
      parDevis[nd] = (parDevis[nd] || 0) + 1;
      if (!o.DATE || !String(o.PRESTATAIRE || '').trim()) {
        aPoser[nd] = (aPoser[nd] || 0) + 1;
      }
    }
    /* Une fiche annulée part quand même au gérant, avec son statut : l'écran
       la range derrière sa propre pastille, hors du travail à faire, et c'est
       de là qu'il peut la rétablir. Sans cela, une annulation par erreur ne se
       réparerait que dans le classeur. */
    var d = o.DATE ? new Date(o.DATE) : null;
    var plan = !!(d && !isNaN(d.getTime()));
    // Un chantier sans date est justement celui qu'il faut planifier : il doit
    // remonter, sinon l'écran ne sert à rien.
    if (plan && (d < hier || d > loin)) return;
    chantiers.push({
      id: String(o.ID), numero: String(o.NUMERO || ''), client: String(o.CLIENT || ''),
      adresse: String(o.ADRESSE || ''), cp: String(o.CP || ''), ville: String(o.VILLE || ''),
      acces: String(o.ACCES || ''),
      date: plan ? isoJour_(d) : '',
      heure: heureTexte_(o.HEURE),
      prestataire: String(o.PRESTATAIRE || ''),
      statut: String(o.STATUT || 'A PLANIFIER'),
      arrivee: Number(o.ARRIVEE) || 0, depart: Number(o.DEPART) || 0,
      minutes: Number(o.MINUTES) || 0,
      signalement: String(o.SIGNALEMENT || ''), note: String(o.NOTE || ''),
      nature: natureChantier_(o, natures),
      /* Seul le gérant le reçoit : le planning du salarié, lui, n'en sait
         rien et n'a pas à en savoir. */
      avantSignature: String(o.AVANT_SIGNATURE || '').trim().toUpperCase() === 'OUI',
      /* La clé du contrat d'où vient le passage : c'est elle qui permet à la
         fiche de dire « contrat récurrent » et de proposer d'en modifier la
         suite. */
      recurrent: String(o.RECURRENT || '').trim(),
      fiche: String(o.FICHE || '').trim() ? (String(o.FICHE_NOM || '').trim() || 'Fiche chantier') : '',
      /* Un passage sans date venu d'un férié : le nom du férié et sa date
         d'origine, pour que « À placer » dise pourquoi il est là. */
      ferie: (!o.DATE && String(o.RECURRENT || '').indexOf('|') > 0)
        ? (function () { var iso = String(o.RECURRENT).split('|')[1];
                         var n = nomFerieIso_(iso) || motifAbsence_(calT, iso, o.PRESTATAIRE);
                         return n ? { nom: n, date: iso } : ''; })()
        : '',
      duree: Math.round(Number(o.DUREE_PREVUE_MIN) || 0) || '',
      /* v108n — « le numéro de chaque client sur chaque intervention ». */
      tel: (telDe_(o, TELS) || {}).tel || '',
      contactTel: (telDe_(o, TELS) || {}).contact || ''
    });
  });
  chantiers.sort(function (a, b) {
    if (!a.date && b.date) return -1;               // à planifier d'abord
    if (a.date && !b.date) return 1;
    return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
  });
  /* v93 : le mois entier se lit dans le calendrier — 300 ne tenait plus avec
     les contrats posés sur huit semaines. */
  if (chantiers.length > 900) chantiers = chantiers.slice(0, 900);
  perf_('chantiers');

  /* Le compte ne peut se poser qu'ici : parDevis vient d'être rempli en lisant
     les chantiers, et la liste des devis, elle, a été dressée plus haut. */
  var contratDe = {}, seriesDe = {};
  objetsDe_(SH.RECURRENTS).forEach(function (r) {
    var nd = String(r.DEVIS || '').trim(), id = String(r.ID || '').trim();
    if (nd && id && !contratDe[nd]) contratDe[nd] = id;
    if (nd && id) (seriesDe[nd] = seriesDe[nd] || []).push(id);
  });
  devis.forEach(function (x) {
    x.poses = parDevis[x.numero] || 0;
    x.aPoser = aPoser[x.numero] || 0;
    /* Un contrat repris d'avant l'appli est au calendrier par définition :
       même sans série reliée, il n'a rien à faire dans « À faire ». */
    x.contrat = contratDe[x.numero] || (x.historique ? 'HISTORIQUE' : '');
    x.series = seriesDe[x.numero] || [];
  });

  var liste = [];
  for (var k in par) if (par.hasOwnProperty(k)) liste.push(par[k]);
  liste.sort(function (a, b) { return b.htSigne - a.htSigne; });
  perf_('séries');
  var gensP = lirePrestataires_().map(function (p) { return p.nom; });
  var gensC = lireCommerciaux_().map(function (c) { return c.nom; });
  perf_('équipe');
  var ignT = ignoresAFaire_(), absT = absencesPourAdmin_();
  perf_('à faire+congés');
  var recT = recurrentsPourAdmin_();
  perf_('contrats');
  var cliT = clientsPourAdmin_();
  perf_('clients');

  return {
    ok: true, maj: new Date().getTime(), fenetre: jours,
    chiffres: chiffres, parCommercial: liste,
    devis: devis, chantiers: chantiers,
    prestataires: gensP,
    commerciaux: gensC,
    /* Les contrats, et jusqu'où leurs passages sont déjà posés : au-delà,
       l'écran du gérant les prolonge lui-même en pointillé, comme un agenda
       montre une répétition sans fin. */
    /* v102 — ce que « À faire » a mis de côté lors de la dernière remise à zéro. */
    aFaireIgnores: ignT,
    /* v104 — les congés en cours et à venir : le planning les montre, et les
       dates que l'appli propose les évitent. */
    absences: absT,
    recurrents: recT,
    clients: cliT,
    horizon: (function () {
      var h = new Date(); h.setDate(h.getDate() + semainesRecurrents_(reg) * 7);
      return isoJour_(h);
    })()
  };
}

/**
 * Poser une date, une heure et un prestataire sur un chantier depuis le
 * téléphone. Dès que la date et la personne sont là, le chantier quitte
 * « à planifier » — sinon la colonne dirait le contraire de la réalité.
 */
function planifierChantier_(d, com) {
  var id = String(d.id || '').trim();
  if (!id) return { ok: false, erreur: 'chantier inconnu' };

  var v = {};
  if (d.date !== undefined) v.DATE = String(d.date || '') ? new Date(String(d.date) + 'T12:00:00') : '';
  if (d.heure !== undefined) v.HEURE = String(d.heure || '');
  if (d.prestataire !== undefined) v.PRESTATAIRE = String(d.prestataire || '');
  /* Ce que le gérant corrige à la main : une adresse fausse envoie l'équipe
     au mauvais endroit, et il n'avait jusqu'ici que le classeur pour la
     réparer. Un champ absent de l'envoi n'est pas touché — c'est ce qui
     permet au déplacement en lot de ne poser que la date. */
  champsIdentiteChantier_().forEach(function (f) {
    if (d[f.env] !== undefined) v[f.col] = String(d[f.env] || '');
  });
  if (d.duree !== undefined) {
    var mn = Math.round(Number(d.duree) || 0);
    v.DUREE_PREVUE_MIN = mn > 0 ? mn : '';
  }
  if (d.nature !== undefined) v.NATURE = natureChoisie_(d.nature);

  // Le nom doit exister, sinon le chantier n'apparaîtrait sur aucun téléphone.
  if (v.PRESTATAIRE) {
    var qc = quiConnus_(v.PRESTATAIRE);
    if (!qc.ok) return { ok: false, erreur: qc.erreur };
    v.PRESTATAIRE = qc.valeur;
  }

  var avant = null;
  objetsDe_(SH.CHANTIERS).forEach(function (o) { if (String(o.ID).trim() === id) avant = o; });
  if (!avant) return { ok: false, erreur: 'chantier introuvable' };

  /* Annuler plutôt qu'effacer. La ligne reste : on sait ce qui a été
     décommandé, et un passage de contrat récurrent annulé ne revient pas à la
     génération suivante — alors qu'une ligne supprimée, si.
     Un chantier déjà pointé s'annule aussi depuis le 12 octobre 2026 (demande
     de Simon : « il faut qu'on puisse supprimer des prestations marquées
     comme faites »). **Ses heures ne sont pas effacées** : ARRIVEE, DEPART et
     MINUTES restent dans la ligne, parce que c'est sur elles qu'on paie le
     salarié et qu'on facture le client. Seul le statut change, et le journal
     le dit en toutes lettres, pour que personne ne découvre la disparition
     d'un chantier facturable sans savoir d'où elle vient. */
  if (d.annuler) {
    var pointe = !!(avant.ARRIVEE && String(avant.ARRIVEE).trim());
    majChantier_(id, { STATUT: 'ANNULE' });
    tracerServeur_(com ? com.nom : '', 'CHANTIER ANNULE',
                   String(avant.CLIENT || '') + ' \u00b7 ' +
                   (avant.DATE ? Utilities.formatDate(new Date(avant.DATE), 'Europe/Paris', 'dd/MM/yyyy') : 'sans date') +
                   (pointe ? ' \u00b7 D\u00c9J\u00c0 POINT\u00c9, heures conserv\u00e9es (' +
                             (Number(avant.MINUTES) || 0) + ' min)' : ''),
                   String(avant.NUMERO || ''), d.appareil || '');
    if (avant.DATE && minuit_(new Date(avant.DATE)) >= minuit_(new Date())) {
      prevenirSalaries_(nomsQui_(avant.PRESTATAIRE), 'Intervention annulée',
        String(avant.CLIENT || 'Intervention') + ' — ' + quandLisible_(avant.DATE, avant.HEURE), String(avant.NUMERO || id));
    }
    prevenirAdmins_(com, 'Intervention annulée', String(avant.CLIENT || 'Intervention') + ' — ' + quandLisible_(avant.DATE, avant.HEURE), String(avant.NUMERO || id));
    return { ok: true, id: id, statut: 'ANNULE', pointe: pointe };
  }
  /* Rétabli, il reprend le statut que sa date et son salarié lui donnent. */
  if (d.retablir) {
    var st = (avant.DATE && String(avant.PRESTATAIRE || '').trim()) ? 'PLANIFIE' : 'A PLANIFIER';
    majChantier_(id, { STATUT: st });
    tracerServeur_(com ? com.nom : '', 'CHANTIER RETABLI', String(avant.CLIENT || ''),
                   String(avant.NUMERO || ''), d.appareil || '');
    if (st === 'PLANIFIE') prevenirSalaries_(nomsQui_(avant.PRESTATAIRE), 'Intervention rétablie',
      String(avant.CLIENT || 'Intervention') + ' — ' + quandLisible_(avant.DATE, avant.HEURE), String(avant.NUMERO || id));
    prevenirAdmins_(com, 'Intervention rétablie', String(avant.CLIENT || 'Intervention') + ' — ' + quandLisible_(avant.DATE, avant.HEURE), String(avant.NUMERO || id));
    return { ok: true, id: id, statut: st };
  }

  var dateFinale = v.DATE !== undefined ? v.DATE : avant.DATE;
  var quiFinal = v.PRESTATAIRE !== undefined ? v.PRESTATAIRE : avant.PRESTATAIRE;
  var stAvant = String(avant.STATUT || '').toUpperCase();
  if (dateFinale && String(quiFinal || '').trim()) {
    if (stAvant === 'A PLANIFIER' || stAvant === '') v.STATUT = 'PLANIFIE';
  } else if (stAvant === 'PLANIFIE') {
    v.STATUT = 'A PLANIFIER';      // on lui a retiré sa date ou sa personne
  }

  var ligne = majChantier_(id, v);
  if (!ligne) return { ok: false, erreur: 'chantier introuvable' };

  /* Le téléphone du salarié sonne : un chantier posé sur le planning ne lui
     parvenait jusqu'ici que s'il pensait à ouvrir l'application. On prévient
     à la prise comme au déplacement — une date qui change vaut bien un mot —
     mais jamais quand ni la date ni la personne n'ont bougé. */
  if (String(quiFinal || '').trim() && dateFinale &&
      (v.PRESTATAIRE !== undefined || v.DATE !== undefined || v.HEURE !== undefined)) {
    /* Chacun du binôme reçoit son mot : « nouveau » pour celui qu'on vient
       d'ajouter, « déplacé » pour celui qui y était déjà. */
    var lgN = {
      CLIENT: v.CLIENT !== undefined ? v.CLIENT : avant.CLIENT,
      CP: v.CP !== undefined ? v.CP : avant.CP,
      VILLE: v.VILLE !== undefined ? v.VILLE : avant.VILLE,
      DATE: dateFinale,
      HEURE: v.HEURE !== undefined ? v.HEURE : avant.HEURE,
      NUMERO: avant.NUMERO
    };
    /* v105 — mais seulement si quelque chose a vraiment changé pour lui : la
       fiche renvoie tous ses champs à chaque enregistrement, et une note
       corrigée ne vaut pas une sonnerie. */
    var memeJour = avant.DATE && isoJour_(new Date(avant.DATE)) === isoJour_(new Date(dateFinale));
    var memeHeure = heureTexte_(avant.HEURE) === heureTexte_(lgN.HEURE);
    var aPrevenir = nomsQui_(quiFinal).filter(function (nomN) {
      return !quiContient_(avant.PRESTATAIRE, nomN) || !memeJour || !memeHeure;
    });
    var envois = aPrevenir.map(function (nomN) {
      var neuf = !quiContient_(avant.PRESTATAIRE, nomN) || !avant.DATE;
      return messageChantier_(nomN, lgN, !neuf);
    });
    if (envois.length) var notifs = bilanNotifs_(envois, notifierLot_(envois), String(avant.NUMERO || id));
  }
  /* v108t — celui qu'on retire de l'intervention est prévenu aussi, et les
     autres gérants voient passer chaque changement de date, d'heure ou d'équipe. */
  var aChange = (v.PRESTATAIRE !== undefined && String(v.PRESTATAIRE || '') !== String(avant.PRESTATAIRE || '')) ||
                (v.DATE !== undefined && isoJour_(new Date(v.DATE || 0)) !== isoJour_(new Date(avant.DATE || 0))) ||
                (v.HEURE !== undefined && heureTexte_(v.HEURE) !== heureTexte_(avant.HEURE));
  if (aChange) {
    var retires = nomsQui_(avant.PRESTATAIRE).filter(function (n) { return avant.DATE && !quiContient_(quiFinal, n); });
    if (retires.length) prevenirSalaries_(retires, 'Intervention retirée',
      String(avant.CLIENT || 'Intervention') + ' — ' + quandLisible_(avant.DATE, avant.HEURE) + ' : ce n\'est plus pour toi.', String(avant.NUMERO || id));
    prevenirAdmins_(com, avant.DATE ? 'Intervention déplacée' : 'Intervention planifiée',
      String(avant.CLIENT || 'Intervention') + ' — ' + quandLisible_(dateFinale, v.HEURE !== undefined ? v.HEURE : avant.HEURE) +
      (String(quiFinal || '').trim() ? ' · ' + quiFinal : ' · sans salarié') +
      (avant.DATE && !(v.DATE === undefined || isoJour_(new Date(v.DATE || 0)) === isoJour_(new Date(avant.DATE))) ? ' (était le ' + quandLisible_(avant.DATE, avant.HEURE) + ')' : ''),
      String(avant.NUMERO || id));
  }

  tracerServeur_(com ? com.nom : '', 'CHANTIER PLANIFIE',
                 (v.PRESTATAIRE || quiFinal || '?') + ' \u00b7 ' +
                 (dateFinale ? Utilities.formatDate(new Date(dateFinale), 'Europe/Paris', 'dd/MM/yyyy') : 'sans date') +
                 (v.HEURE ? ' ' + v.HEURE : ''),
                 String(avant.NUMERO || ''), d.appareil || '');

  return { ok: true, id: id, statut: v.STATUT || avant.STATUT, notifs: notifs || [] };
}

/* v108e — « ça déconne les notifications : j'ai créé une intervention puis
   déplacée, 0 notif, mes prestataires non plus ». Quand OneSignal répond que
   personne n'est inscrit sous un nom, rien ne le disait : ni le journal, ni
   l'écran. Désormais chaque envoi rend son bilan à l'appli (qui l'affiche)
   et un nom sans téléphone inscrit laisse une ligne au journal. */
/* v108e — le placement suggéré au devis : { date:'2026-11-20', heure:'09:00' }
   ↔ « 2026-11-20 09:00 » dans la colonne. Du texte, pour que le classeur ne le
   convertisse pas en date à l'heure de minuit. */
function placementTexte_(p) {
  if (!p || typeof p !== 'object') return '';
  var d = String(p.date || '').trim(), h = String(p.heure || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  if (!/^\d{1,2}:\d{2}$/.test(h)) h = '';
  return d + (h ? ' ' + ('0' + h).slice(-5) : '');
}
function placementLire_(v) {
  if (v instanceof Date) return { date: isoJour_(v), heure: '' };
  var m = String(v || '').trim().match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
  return m ? { date: m[1], heure: m[2] ? ('0' + m[2]).slice(-5) : '' } : null;
}

/* v108t — Simon, 11 novembre : « quand je déplace une intervention ou autre,
   les prestataires et les admins sont notifiés ». Les autres gérants (pas
   celui qui fait le changement) reçoivent un mot à chaque création,
   déplacement, annulation, modification ou arrêt de contrat. Réglage
   `notif_admins_planning` = NON pour couper. */
function prevenirAdmins_(com, titre, texte, ref) {
  try {
    if (/^(non|no|0|off)$/i.test(String(lireReglages_().notif_admins_planning || '').trim())) return [];
    var moi = normNom_(com && com.nom || '');
    var envois = lireAdmins_().filter(function (a) { return a.nom && normNom_(a.nom) !== moi; })
      .map(function (a) { return { nom: a.nom, titre: titre, texte: texte + (com && com.nom ? ' · par ' + com.nom : '') }; });
    if (!envois.length) return [];
    return bilanNotifs_(envois, notifierLot_(envois), ref || '');
  } catch (e) { return []; }
}
/* Un mot à chacun des salariés nommés (binôme compris), sans jamais casser l'action. */
function prevenirSalaries_(noms, titre, texte, ref) {
  try {
    var envois = (noms || []).filter(String).map(function (n) { return { nom: n, titre: titre, texte: texte }; });
    if (!envois.length) return [];
    return bilanNotifs_(envois, notifierLot_(envois), ref || '');
  } catch (e) { return []; }
}
function quandLisible_(date, heure) {
  var d = date ? new Date(date) : null;
  var h = heureTexte_(heure);
  return (d && !isNaN(d.getTime()) ? jourFr_(d) : 'date à caler') + (h ? ' à ' + h : '');
}
function bilanNotifs_(envois, res, ref) {
  return envois.map(function (m, i) {
    var r = res[i] || {};
    if (!r.ok) tracerServeur_(m.nom, r.aucun ? 'NOTIFICATION SANS TELEPHONE' : 'NOTIFICATION RATEE',
                              String(r.erreur || ''), ref || '', '');
    return { nom: m.nom, ok: !!r.ok, aucun: !!r.aucun, erreur: r.ok ? '' : String(r.erreur || '') };
  });
}
/* L'état des inscriptions chez OneSignal, pour chacun : le gérant voit d'un
   coup d'œil qui recevra un message (et depuis quel genre d'appareil). */
function etatNotifs_() {
  var c = notifConfig_();
  if (!c.app || !c.cle) return { ok: false, erreur: 'notifications non connectées (clé ou identifiant OneSignal manquant)' };
  var gens = [], vus = {};
  var ajouter = function (l, role) { (l || []).forEach(function (p) { var k = normNom_(p.nom); if (k && !vus[k]) { vus[k] = 1; gens.push({ nom: p.nom, role: role }); } }); };
  try { ajouter(lirePrestataires_(), 'salarié'); } catch (e1) {}
  try { ajouter(lireAdmins_(), 'gérant'); } catch (e2) {}
  try { ajouter(lireCommerciaux_ ? lireCommerciaux_() : [], 'commercial'); } catch (e3) {}
  var req = gens.map(function (g) {
    return { url: 'https://api.onesignal.com/apps/' + encodeURIComponent(c.app) + '/users/by/external_id/' + encodeURIComponent(notifId_(g.nom)),
             method: 'get', headers: { Authorization: 'Key ' + c.cle }, muteHttpExceptions: true };
  });
  var reps = req.length ? UrlFetchApp.fetchAll(req) : [];
  gens.forEach(function (g, i) {
    var r = reps[i], code = r.getResponseCode(), rep = {};
    try { rep = JSON.parse(r.getContentText() || '{}'); } catch (e) {}
    var subs = (rep.subscriptions || []).filter(function (x) { return /Push/i.test(String(x.type || '')); });
    var actives = subs.filter(function (x) { return x.enabled !== false && Number(x.notification_types == null ? 1 : x.notification_types) > 0 && x.token; });
    g.inscrit = code >= 200 && code < 300;
    g.appareils = subs.length;
    g.actifs = actives.length;
    g.types = actives.map(function (x) { return String(x.type || '').replace(/Push$/, ''); }).join(', ');
    var last = 0;
    subs.forEach(function (x) { var t = Number(x.last_active || 0); if (t > last) last = t; });
    g.vu = last ? new Date(last * (last < 1e12 ? 1000 : 1)).toISOString() : '';
    if (!(code >= 200 && code < 300) && code !== 404) g.erreur = 'réponse ' + code;
  });
  return { ok: true, gens: gens };
}

/* Les champs d'identité d'un chantier que le gérant peut corriger, et le nom
   qu'ils portent dans l'envoi. Une seule liste, lue par la correction comme
   par la création : deux listes finiraient par diverger. */
function champsIdentiteChantier_() {
  return [
    { env: 'client',  col: 'CLIENT' },
    { env: 'adresse', col: 'ADRESSE' },
    { env: 'cp',      col: 'CP' },
    { env: 'ville',   col: 'VILLE' },
    { env: 'acces',   col: 'ACCES' },
    { env: 'note',    col: 'NOTE' }
  ];
}

/**
 * Un chantier posé à la main, sans devis derrière : un dépannage, un petit
 * travail, un rattrapage. Il ressemble en tout point à un chantier né d'un
 * devis, NUMERO mis à part — ce qui le fait vivre, c'est son ID.
 */
function creerChantier_(d, com) {
  var client = String(d.client || '').trim();
  if (!client) return { ok: false, erreur: 'il faut au moins un nom de client' };

  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh) return { ok: false, erreur: 'onglet des chantiers absent' };
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cId = en.indexOf('ID');
  if (cId < 0) return { ok: false, erreur: 'colonnes absentes — lancer « Mettre à jour la structure »' };

  var qui = String(d.prestataire || '').trim();
  if (qui) {
    var qc = quiConnus_(qui);
    if (!qc.ok) return { ok: false, erreur: qc.erreur };
    qui = qc.valeur;
  }

  var date = String(d.date || '').trim() ? new Date(String(d.date) + 'T12:00:00') : '';
  if (date && isNaN(date.getTime())) return { ok: false, erreur: 'date illisible' };
  var mn = Math.round(Number(d.duree) || 0);

  /* v99 — « toutes les interventions doivent être reliées à un devis, puis à
     une facture ». Le devis choisi dans le formulaire est vérifié ici. */
  var numLie = '';
  if (String(d.devis || '').trim()) {
    var dvL = devisParNumero_(d.devis);              // v108q : un contrat repris (CTR-…) compte aussi
    if (dvL) numLie = String(dvL.NUMERO).trim();
    if (!numLie) return { ok: false, erreur: 'le devis ' + d.devis + ' est introuvable' };
  }

  var id = 'CH-' + ('000' + prochainNumChantier_(sh, cId)).slice(-4);
  var v = {
    ID: id, NUMERO: numLie,
    CLIENT: client,
    ADRESSE: String(d.adresse || ''), CP: String(d.cp || ''), VILLE: String(d.ville || ''),
    ACCES: String(d.acces || ''),
    DATE: date, HEURE: String(d.heure || ''),
    PRESTATAIRE: qui,
    STATUT: (date && qui) ? 'PLANIFIE' : 'A PLANIFIER',
    ARRIVEE: '', DEPART: '', MINUTES: '',
    PRESTATIONS_FAITES: '', SIGNALEMENT: '', PHOTOS: 0,
    /* Sans devis derrière, la fiche de travail du salarié serait vide : la
       note est tout ce qu'il aura sous les yeux en arrivant. */
    NOTE: String(d.note || ''),
    CREE_LE: new Date(),
    DUREE_PREVUE_MIN: mn > 0 ? mn : '',
    LOT: '', RECURRENT: '', NATURE: natureChoisie_(d.nature)
  };
  sh.appendRow(en.map(function (h) { return v.hasOwnProperty(h) ? v[h] : ''; }));

  tracerServeur_(com ? com.nom : '', 'CHANTIER CREE',
                 client + ' \u00b7 ' + (date ? isoJour_(date) : 'sans date') +
                 (qui ? ' \u00b7 ' + qui : ''), '', d.appareil || '');
  /* v106 — une intervention créée déjà datée et attribuée prévient les
     salariés, comme une intervention qu'on leur attribue ensuite. */
  if (date && qui) {
    try {
      var envoisN = nomsQui_(qui).map(function (n) { return messageChantier_(n, v, false); });
      var notifsN = bilanNotifs_(envoisN, notifierLot_(envoisN), id);
    } catch (eN) {}
  }
  if (v.NATURE !== NATURE_RDV_) prevenirAdmins_(com, 'Nouvelle intervention',
    client + ' — ' + quandLisible_(date, v.HEURE) + (qui ? ' · ' + qui : ' · à placer'), id);
  return { ok: true, id: id, statut: v.STATUT, notifs: notifsN || [] };
}

/**
 * Le même geste sur plusieurs chantiers : tout reporter au lendemain, tout
 * passer à quelqu'un d'autre, tout annuler. Chaque ligne passe par
 * planifierChantier_ : une seule logique, donc les mêmes garde-fous — un
 * chantier déjà pointé reste intouchable, un prestataire inconnu est refusé.
 */
/**
 * Le rendez-vous qu'un commercial pose sur SON emploi du temps (13 octobre
 * 2026). Une visite de prospect, un relevé chez un client, un déplacement :
 * du temps occupé qui n'est pas du ménage, et que personne ne voyait.
 *
 * Deux garde-fous, et ils sont ici plutôt qu'à l'écran :
 * — le prestataire est TOUJOURS celui qui envoie. Ce que le téléphone dit du
 *   nom est ignoré : sans cela, un commercial pourrait poser du travail dans
 *   la journée d'un collègue depuis une requête fabriquée.
 * — la nature est TOUJOURS RDV, et un rendez-vous n'a pas de NUMERO de devis :
 *   il ne doit jamais ressembler à une prestation vendue.
 */
function rdvCommercial_(d, com) {
  if (!com || !com.nom) return { ok: false, erreur: 'compte inconnu' };
  if (!String(d.date || '').trim()) {
    return { ok: false, erreur: 'il faut une date : sans elle, le rendez-vous n\'apparaît nulle part' };
  }
  var e = {
    client: d.client, adresse: d.adresse, cp: d.cp, ville: d.ville,
    note: d.note, date: d.date, heure: d.heure, duree: d.duree,
    appareil: d.appareil,
    prestataire: com.nom,            // imposé, jamais lu de l'envoi
    nature: NATURE_RDV_,             // imposée, jamais lue de l'envoi
    acces: ''
  };
  var r = creerChantier_(e, com);
  if (r && r.ok) {
    tracerServeur_(com.nom, 'RDV POSE',
                   String(d.client || '') + ' \u00b7 ' + String(d.date || '') +
                   (d.heure ? ' ' + d.heure : ''), '', d.appareil || '');
  }
  return r;
}

/**
 * Annuler ou rétablir un chantier de SON propre planning (13 octobre 2026).
 *
 * Simon a tranché : le commercial peut retirer tout ce qui est sur son
 * planning, y compris un chantier que le bureau lui a affecté — il sait
 * mieux que l'écran ce qu'il peut tenir. Ce qui n'est pas négociable, c'est
 * que ce soit SON planning : la ligne est relue au classeur et le nom comparé
 * avant toute écriture. Et comme une annulation d'un chantier affecté est une
 * nouvelle qui concerne le bureau, le journal la nomme pour ce qu'elle est.
 */
function monChantier_(d, com) {
  var id = String(d.id || '').trim();
  if (!id) return { ok: false, erreur: 'chantier inconnu' };
  if (!d.annuler && !d.retablir) return { ok: false, erreur: 'rien à faire sur ce chantier' };

  var avant = null;
  objetsDe_(SH.CHANTIERS).forEach(function (o) { if (String(o.ID).trim() === id) avant = o; });
  if (!avant) return { ok: false, erreur: 'chantier introuvable' };
  if (!quiContient_(avant.PRESTATAIRE, com.nom)) {
    tracerServeur_(com.nom, 'ACTION REFUSEE', 'monChantier sur ' + id, '', d.appareil || '');
    return { ok: false, erreur: 'ce chantier n\'est pas sur ton planning' };
  }

  var r = planifierChantier_({ id: id, annuler: d.annuler, retablir: d.retablir,
                               appareil: d.appareil }, com);
  /* Un rendez-vous que le commercial a posé lui-même et qu'il retire, c'est son
     affaire. Un chantier venu du bureau qu'il décommande, c'est une nouvelle :
     le journal doit la distinguer, sinon elle se perd dans la masse. */
  if (r && r.ok && d.annuler && natureOuVide_(avant.NATURE) !== NATURE_RDV_) {
    tracerServeur_(com.nom, 'CHANTIER DECOMMANDE PAR LE COMMERCIAL',
                   String(avant.CLIENT || '') + ' \u00b7 ' +
                   (avant.DATE ? Utilities.formatDate(new Date(avant.DATE), 'Europe/Paris', 'dd/MM/yyyy') : 'sans date'),
                   String(avant.NUMERO || ''), d.appareil || '');
  }
  return r;
}

function lotChantiers_(d, com) {
  var ids = (d.ids || []).map(function (x) { return String(x || '').trim(); })
    .filter(function (x) { return x; });
  if (!ids.length) return { ok: false, erreur: 'aucun chantier choisi' };
  if (ids.length > 60) return { ok: false, erreur: 'trop de chantiers d\'un coup (60 au plus)' };

  var faits = 0, refus = [];
  ids.forEach(function (id) {
    var un = { id: id, appareil: d.appareil || '' };
    if (d.date !== undefined) un.date = d.date;
    if (d.heure !== undefined) un.heure = d.heure;
    if (d.prestataire !== undefined) un.prestataire = d.prestataire;
    if (d.annuler) un.annuler = true;
    var r = planifierChantier_(un, com);
    if (r && r.ok) faits++;
    else refus.push(id + ' : ' + ((r && r.erreur) || 'refusé'));
  });

  /* On dit ce qui n'est pas passé plutôt que d'annoncer un succès global :
     sur un lot, l'échec d'une seule ligne est invisible autrement. */
  return { ok: faits > 0, faits: faits, refus: refus,
           erreur: faits ? '' : (refus[0] || 'rien n\'a pu être modifié') };
}

/* Un seul endroit décide de ce que chaque métier reçoit à la connexion. */
function configPour_(role, com) {
  if (role === 'PRESTATAIRE') return configPrestataire_();
  if (role === 'ADMIN') return configAdmin_(com);
  return config_(com);
}

/**
 * Ce que reçoit un compte d'administration : de quoi remplir les listes
 * déroulantes, et rien de plus. Les chiffres et les listes viennent de
 * l'action « tableau », qui se rafraîchit à la demande.
 */
/* Depuis la v82 le gerant etablit des devis depuis son tableau : il lui faut
   donc tout ce qu'il faut pour en faire un — catalogue, reglages, communes,
   compteurs — exactement comme a un commercial. On part de sa configuration et
   on y ajoute les listes que l'ecran du tableau remplit. */
function configAdmin_(com) {
  var c = config_(com);
  c.role = 'ADMIN';
  c.commerciaux = lireCommerciaux_().map(function (x) { return x.nom; });
  c.prestataires = lirePrestataires_().map(function (p) { return p.nom; });
  return c;
}

function configPrestataire_() {
  var reg = lireReglages_();
  var mois = String(reg.pointage_retention_mois || '36');
  return {
    maj: new Date().toISOString(),
    role: 'PRESTATAIRE',
    reglages: {
      societe_nom: String(reg.societe_nom || ''),
      texte_information: String(reg.texte_information_agent || '').replace('{mois}', mois),
      version_information: String(reg.version_information || '1') + '-agent'
    }
  };
}

/** Le plus grand numéro de chantier déjà posé, pour en fabriquer un nouveau. */
function prochainNumChantier_(sh, cId) {
  if (sh.getLastRow() < 2) return 1;
  var max = 0;
  sh.getRange(2, cId + 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var m = String(r[0]).match(/^CH-(\d+)$/);
    if (m && Number(m[1]) > max) max = Number(m[1]);
  });
  return max + 1;
}

/* Pose le planning d'un devis et prévient le gérant. On ne laisse jamais une
   planification se faire en silence : ce sont des rendez-vous chez des clients,
   et le gérant doit pouvoir les contester le jour même. */
function poserPlanning_(numero, qui, appareil, avantSignature) {
  var bilan;
  try {
    reactiverChantiers_(numero);
    bilan = planifierDevis_(numero);
  } catch (e) {
    tracerServeur_('SYSTEME', 'PLANIFICATION ECHEC',
                   String(e && e.message || e), numero, appareil || '');
    return { poses: [], refuses: [], motif: 'erreur' };
  }
  /* Un contrat signé devient une série : les mois suivants se poseront
     d'eux-mêmes. Un échec ici ne doit pas défaire la planification. */
  var contrat = null;
  try { contrat = contratDepuisDevis_(numero, qui); }
  catch (eC) {
    tracerServeur_('SYSTEME', 'CONTRAT ECHEC', String(eC && eC.message || eC), numero, appareil || '');
  }
  var reg = lireReglages_();
  var dates = bilan.poses.map(function (p) {
    return '  · ' + isoJour_(p.date) + ' ' + p.heure + ' — ' + p.nom +
           ' — ' + heuresLisibles_(p.minutes) + (p.id ? ' (' + p.id + ')' : '') +
           (p.route ? ' — après ' + p.route + ' min de route depuis le chantier précédent' : '');
  }).join('\n');

  if (bilan.poses.length) {
    tracerServeur_(qui || 'SYSTEME', 'CHANTIERS PLANIFIES',
                   bilan.poses.length + ' posé(s)' +
                   (bilan.refuses.length ? ', ' + bilan.refuses.length + ' sans créneau' : ''),
                   numero, appareil || '');
  }
  if (bilan.refuses.length || bilan.motif) {
    tracerServeur_(qui || 'SYSTEME', 'PLANIFICATION INCOMPLETE',
                   bilan.motif || (bilan.refuses.length + ' chantier(s) sans créneau'),
                   numero, appareil || '');
  }

  var dest = String(reg.recap_email || '').trim() || Session.getEffectiveUser().getEmail();
  var corps = (avantSignature
      ? 'Devis ' + numero + ' — travail posé sans attendre la signature.\n' +
        'Le devis garde son statut : rien d\'autre que le planning n\'a bougé.\n\n'
      : 'Devis ' + numero + ' signé.\n\n') +
    (bilan.poses.length
      ? bilan.poses.length + ' intervention(s) posée(s) :\n' + dates + '\n'
      : (planificationAuto_(reg) ? 'Aucune intervention n\'a pu être posée.\n'
         : 'Les interventions attendent dans le bac « à placer » du Planning de l\'appli : ' +
           'ouvre-les, l\'appli te propose des créneaux.\n')) +
    (bilan.motif && planificationAuto_(reg) ? '\nRien n\'a été planifié : ' + bilan.motif + '.\n' : '') +
    (contrat && contrat.length ? '\nContrat écrit dans l\'onglet ' + SH.RECURRENTS + ' : ' +
      contrat.join(', ') + '. Les mois suivants se posent tout seuls.\n' : '') +
    (bilan.refuses.length
      ? '\n' + bilan.refuses.length + ' intervention(s) sans créneau dans les quatre mois ' +
        'qui viennent : elles restent « A PLANIFIER » dans l\'onglet ' + SH.CHANTIERS + '.\n'
      : '') +
    '\nTu peux tout corriger à la main dans le classeur : l\'appli ne réécrit ' +
    'jamais une date ou un nom que tu as posés.\n' +
    SpreadsheetApp.getActive().getUrl();
  try {
    envoyerMail_({ to: dest, subject: 'Planning — devis ' + numero, body: corps }, reg);
  } catch (e) { /* sans importance : le classeur reste la source */ }
  return bilan;
}

/* ================================================================
   v99 — DES SUGGESTIONS QUAND ON PLACE
   ================================================================
   Le placement automatique est coupé (planificationAuto_) : c'est Simon qui
   choisit le jour et l'heure. L'appli lui propose trois créneaux, calculés
   comme le faisait le placement automatique (salarié le moins chargé, jours
   travaillés, absences, route depuis le chantier précédent), sans rien
   écrire. Il en prend un, ou pas. */
function suggestionsPlacement_(d) {
  var id = String(d.id || '').trim();
  var ch = null;
  objetsDe_(SH.CHANTIERS).forEach(function (o) { if (String(o.ID || '').trim() === id) ch = o; });
  if (!ch) return { ok: false, erreur: 'intervention introuvable' };
  var minutes = Math.round(Number(ch.DUREE_PREVUE_MIN) || 0) || 210;
  var adresse = adresseComplete_(ch.ADRESSE, ch.CP, ch.VILLE);
  var depuis = new Date(); depuis.setDate(depuis.getDate() + 1);
  var num = String(ch.NUMERO || '').trim();
  var duDevis = null;
  if (num) {
    lireDevis_().forEach(function (x) {
      if (String(x.NUMERO || '').trim() !== num) return;
      if (x.DATE_SOUHAITEE instanceof Date && x.DATE_SOUHAITEE > depuis) {
        depuis = new Date(x.DATE_SOUHAITEE.getTime());
      }
      /* v108e — le créneau que le commercial a noté au devis passe devant. */
      var pl = placementLire_(x.PLACEMENT_SUGGERE);
      if (pl) {
        var jP = new Date(pl.date + 'T12:00:00');
        var demain = new Date(); demain.setHours(0, 0, 0, 0);
        if (!isNaN(jP.getTime()) && jP >= demain) duDevis = { date: pl.date, heure: pl.heure, nom: '', route: 0, jour: jourFr_(jP), devis: true };
      }
    });
  }
  var gens = prestatairesPlanning_();
  if (!gens.length) return { ok: true, suggestions: duDevis ? [duDevis] : [], motif: 'aucun salarié décrit dans PRESTATAIRES (jours, plages)' };
  /* La route au forfait : interroger Google Maps pour chaque journée de
     chaque salarié prend plus de temps qu'un téléphone n'en accorde. Une
     suggestion n'a pas besoin de la minute près. */
  var charge = chargeActuelle_(true);
  var out = [];
  for (var k = 0; k < 3; k++) {
    var c = creneauPour_(minutes, depuis, gens, charge, '', 60, adresse);
    if (!c) break;
    out.push({ date: isoJour_(c.date), heure: c.heure, nom: c.nom, route: c.route || 0,
               jour: jourFr_(c.date) });
    depuis = new Date(c.date.getTime()); depuis.setDate(depuis.getDate() + 1);
  }
  if (duDevis) out.unshift(duDevis);
  return { ok: true, id: id, minutes: minutes, suggestions: out };
}

/* « lundi 9 novembre » : Utilities.formatDate écrit les jours dans la langue
   du script (l'anglais), d'où ce petit traducteur. */
function jourFr_(d) {
  var x = new Date(d);
  var j = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var m = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var p = Utilities.formatDate(x, 'Europe/Paris', 'yyyy-MM-dd').split('-');
  var jour = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12);
  return j[jour.getDay()] + ' ' + Number(p[2]) + ' ' + m[Number(p[1]) - 1];
}

/* ===================== HEURES ET DISPONIBILITÉS DES SALARIÉS (v108n) =====
   « Une liste des heures des salariés mensuellement et ce qu'il me reste de
   temps disponible pour placer une intervention, uniquement pour les
   prestataires, vue par les admins. Compter les trajets ; un passage en
   binôme compte pour chacun des deux. »
   - Contrat : HEURES_SEMAINE réparties sur ses JOURS, moins les fériés, ses
     congés et les fermetures.
   - Prévu : la durée prévue de chaque passage où il figure, plus la route
     entre deux chantiers d'une même journée (Google Maps, sinon le forfait).
   - Libre = contrat − prévu.                                                */
function disposSalaries_(d) {
  var reg = lireReglages_(), cal = calendrier_(reg);
  var mois = /^\d{4}-\d{2}$/.test(String(d && d.mois || '')) ? String(d.mois)
    : Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM');
  var a = Number(mois.slice(0, 4)), m = Number(mois.slice(5, 7));
  var nbJours = new Date(a, m, 0).getDate();
  var gens = prestatairesPlanning_();
  var charge = { trajet: trajetMinutes_(reg), calcule: trajetCalcule_(reg), routes: {} };
  var appels = {}, budget = 60;
  var route = function (x, y) {
    if (!x || !y) return charge.trajet;
    var k = cleAdresse_(x) + '>' + cleAdresse_(y);
    if (!appels[k]) { appels[k] = 1; budget--; }
    var calc = charge.calcule;
    if (budget < 0) charge.calcule = false;
    var r = trajetEntre_(charge, x, y);
    charge.calcule = calc;
    return r;
  };
  var parJour = {};
  objetsDe_(SH.CHANTIERS).forEach(function (o) {
    if (!String(o.ID || '').trim() || !o.DATE) return;
    if (String(o.STATUT || '').toUpperCase().trim() === 'ANNULE') return;
    var dt = new Date(o.DATE);
    if (isNaN(dt.getTime()) || dt.getFullYear() !== a || dt.getMonth() !== m - 1) return;
    var iso = isoJour_(dt);
    var min = Math.round(Number(o.DUREE_PREVUE_MIN) || 0) || 60;
    var adr = adresseComplete_(o.ADRESSE, o.CP, o.VILLE);
    var h = heureTexte_(o.HEURE) || '99:99';
    nomsQui_(o.PRESTATAIRE).forEach(function (n) {
      var k = normNom_(n) + '|' + iso;
      (parJour[k] = parJour[k] || []).push({ h: h, min: min, adr: adr });
    });
  });
  var auj = isoJour_(new Date());
  var out = gens.map(function (g) {
    var parJourMin = g.jours.length ? Math.round(g.capaciteSemaine / g.jours.length) : 0;
    var tot = { contrat: 0, travail: 0, trajet: 0, n: 0 }, semaines = {}, jours = [];
    for (var j = 1; j <= nbJours; j++) {
      var dj = new Date(a, m - 1, j, 12), iso = isoJour_(dj);
      var ouvre = g.jours.indexOf(dj.getDay()) >= 0;
      var fer = ouvre && ferie_(cal, dj);
      var abs = ouvre && !fer && (estAbsent_(cal, g.cle, iso) || estAbsent_(cal, '', iso, true));
      var cap = ouvre && !fer && !abs ? parJourMin : 0;
      var l = (parJour[g.cle + '|' + iso] || []).sort(function (x, y) { return x.h < y.h ? -1 : 1; });
      var trav = 0, traj = 0;
      l.forEach(function (x, i) { trav += x.min; if (i > 0) traj += route(l[i - 1].adr, x.adr); });
      tot.contrat += cap; tot.travail += trav; tot.trajet += traj; tot.n += l.length;
      var sk = cleSemaine_(dj);
      semaines[sk] = semaines[sk] || { lundi: sk, contrat: 0, prevu: 0 };
      semaines[sk].contrat += cap; semaines[sk].prevu += trav + traj;
      if (cap || l.length) jours.push({ iso: iso, cap: cap, prevu: trav + traj, n: l.length,
                                        motif: fer ? String(fer.nom || fer) : (abs ? 'congé' : ''), passe: iso < auj });
    }
    return { nom: g.nom, jours: jours, contrat: tot.contrat, travail: tot.travail, trajet: tot.trajet,
             prevu: tot.travail + tot.trajet, libre: tot.contrat - tot.travail - tot.trajet, n: tot.n,
             semaines: Object.keys(semaines).sort().map(function (k) { return semaines[k]; }),
             joursTravail: g.jours, heuresSemaine: Math.round(g.capaciteSemaine / 6) / 10 };
  });
  return { ok: true, mois: mois, salaries: out, trajetForfait: charge.trajet, trajetsEstimes: budget < 0, maj: Date.now() };
}
/* ===================== TÉLÉPHONES DES CLIENTS (v108n) =====================
   « Sur chaque intervention, le numéro de téléphone du client, pour pouvoir
   l'appeler (modification, annulation, ou pour prévenir). » D'où vient le
   numéro, dans l'ordre :
   1. l'onglet TELEPHONES — saisi depuis l'appli (MANUEL) ou importé de
      Pennylane / Henrri (menu 33) ;
   2. le devis du chantier (colonne TELEPHONE), puis le devis le plus récent
      du même client.                                                        */
var SH_TELS_ = 'TELEPHONES';
var ENTETES_TELS_ = ['CLIENT', 'TELEPHONE', 'CONTACT', 'SOURCE', 'MAJ'];

function cleTel_(nom) {
  return sansAccent_(String(nom || '').replace(/\s+[—–-]\s+.*$/, '').replace(/\s*\+\s*.*$/, ''))
    .replace(/[^A-Z0-9]+/g, ' ').trim();
}
function cleTelCourte_(nom) {
  return cleTel_(nom).replace(/^(M ET MME|MME|MR|M|MONSIEUR|MADAME|STE|SARL|SAS|EURL|SCI)\s+/, '').trim();
}
function telLisible_(t) {
  var d = String(t || '').replace(/[^\d+]/g, '');
  if (/^\+33\d{9}$/.test(d)) d = '0' + d.slice(3);
  else if (/^0033\d{9}$/.test(d)) d = '0' + d.slice(4);
  else if (/^33\d{9}$/.test(d)) d = '0' + d.slice(2);
  if (/^0\d{9}$/.test(d)) return d.replace(/(\d{2})(?=\d)/g, '$1 ');
  return String(t || '').trim();
}

function telsClients_() {
  var T = { parNom: {}, parCourt: {}, parNumero: {}, parSerie: {} };
  var poser = function (nom, tel, contact) {
    tel = telLisible_(tel); if (!tel) return;
    var k = cleTel_(nom), c = cleTelCourte_(nom), v = { tel: tel, contact: String(contact || '').trim() };
    if (k && !T.parNom[k]) T.parNom[k] = v;
    if (c && c.length >= 4 && !T.parCourt[c]) T.parCourt[c] = v;
  };
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH_TELS_);
    if (sh && sh.getLastRow() > 1) {
      var rows = objetsDe_(SH_TELS_);
      rows.filter(function (r) { return String(r.SOURCE || '').toUpperCase() === 'MANUEL'; })
        .concat(rows.filter(function (r) { return String(r.SOURCE || '').toUpperCase() !== 'MANUEL'; }))
        .forEach(function (r) { poser(r.CLIENT, r.TELEPHONE, r.CONTACT); });
    }
  } catch (e0) {}
  try {
    var dv = lireDevis_().slice().sort(function (a, b) {
      return (b.DATE instanceof Date ? b.DATE.getTime() : 0) - (a.DATE instanceof Date ? a.DATE.getTime() : 0);
    });
    dv.forEach(function (d) {
      var tel = telLisible_(d.TELEPHONE);
      if (!tel) return;
      var n = String(d.NUMERO || '').trim();
      if (n && !T.parNumero[n]) T.parNumero[n] = { tel: tel, contact: String(d.CONTACT || '').trim() };
      poser(d.CLIENT, tel, d.CONTACT);
    });
  } catch (e1) {}
  try {
    objetsDe_(SH.RECURRENTS).forEach(function (r) {
      var id = String(r.ID || '').trim(), dvn = String(r.DEVIS || '').trim();
      if (id && dvn) T.parSerie[id] = dvn;
    });
  } catch (e2) {}
  return T;
}

function telDe_(o, T) {
  if (!T) return null;
  var man = T.parNom[cleTel_(o.CLIENT)];
  var n = String(o.NUMERO || '').trim();
  var serie = String(o.RECURRENT || '').split('|')[0];
  if (!n && serie && T.parSerie[serie]) n = T.parSerie[serie];
  return man || (n && T.parNumero[n]) || T.parCourt[cleTelCourte_(o.CLIENT)] || null;
}

function ongletTels_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH_TELS_);
  if (!sh) {
    sh = ss.insertSheet(SH_TELS_);
    sh.getRange(1, 1, 1, ENTETES_TELS_.length).setValues([ENTETES_TELS_]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Depuis l'appli (gérant) : poser ou corriger le numéro d'un client. */
function telClientPoser_(d, com) {
  var client = String(d.client || '').trim();
  var tel = telLisible_(d.tel);
  if (!client) return { ok: false, erreur: 'client manquant' };
  var sh = ongletTels_();
  var v = sh.getDataRange().getValues(), k = cleTel_(client), rang = 0;
  for (var i = 1; i < v.length; i++) {
    if (cleTel_(v[i][0]) === k && String(v[i][3]).toUpperCase() === 'MANUEL') { rang = i + 1; break; }
  }
  var ligne = [client.replace(/\s+[—–-]\s+.*$/, ''), tel, String(d.contact || '').trim(), 'MANUEL', new Date()];
  if (rang) sh.getRange(rang, 1, 1, 5).setValues([ligne]); else sh.appendRow(ligne);
  tracerServeur_(com ? com.nom : '', 'TELEPHONE CLIENT', client + ' · ' + (tel || 'effacé'), '', d.appareil || '');
  return { ok: true, tel: tel };
}

/** Menu 33 : les numéros connus de Pennylane et de Henrri. */
function importerTelephones() {
  var r = importerTelephones_();
  try {
    SpreadsheetApp.getUi().alert('Téléphones des clients',
      r.ajoutes + ' numéro(s) ajouté(s) à l\'onglet TELEPHONES.\n\nPennylane : ' + r.pennylane +
      ' client(s) lus, ' + r.pTel + ' avec un numéro' + (r.pErreur ? ' (' + r.pErreur + ')' : '') +
      '.\nHenrri : ' + r.henrri + ' client(s) lus, ' + r.hTel + ' avec un numéro' + (r.hErreur ? ' (' + r.hErreur + ')' : '') + '.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { Logger.log(JSON.stringify(r)); }
  return r;
}
function telDansObjet_(c) {
  var cands = [c.phone, c.mobile, c.phone_number, c.phoneNumber, c.mobilePhone, c.mobile_phone, c.telephone, c.tel];
  (Object.prototype.toString.call(c.contacts) === '[object Array]' ? c.contacts : []).forEach(function (x) {
    if (x) cands.push(x.phone, x.mobile, x.phoneNumber, x.mobilePhone);
  });
  for (var i = 0; i < cands.length; i++) if (String(cands[i] || '').replace(/\D/g, '').length >= 9) return String(cands[i]);
  return '';
}
function contactDansObjet_(c) {
  var x = (Object.prototype.toString.call(c.contacts) === '[object Array]' ? c.contacts[0] : null) || {};
  return String([x.firstName || x.first_name || '', x.lastName || x.last_name || ''].join(' ')).trim();
}
function importerTelephones_() {
  var r = { ajoutes: 0, pennylane: 0, pTel: 0, henrri: 0, hTel: 0, pErreur: '', hErreur: '' };
  var trouves = [];
  try {
    var curseur = '', tours = 0;
    do {
      var q = pennylaneAppel_('get', '/customers?limit=100' + (curseur ? '&cursor=' + encodeURIComponent(curseur) : ''));
      if (!q.ok) { r.pErreur = q.erreur; break; }
      var items = (q.data && q.data.items) || [];
      items.forEach(function (c) {
        r.pennylane++;
        var nom = String(c.name || [c.first_name, c.last_name].join(' ') || '').trim();
        var t = telDansObjet_(c);
        if (nom && t) { r.pTel++; trouves.push([nom, t, contactDansObjet_(c), 'PENNYLANE']); }
      });
      curseur = q.data && q.data.has_more ? String(q.data.next_cursor || '') : '';
    } while (curseur && ++tours < 30);
  } catch (eP) { r.pErreur = String(eP && eP.message || eP).slice(0, 120); }
  try {
    for (var page = 1; page <= 30; page++) {
      var liste = henrriListe_(henrriAppel_('henrri_list_customers', { limit: 100, page: page }));
      if (!liste.length) break;
      var neufs = 0;
      liste.forEach(function (c) {
        r.henrri++; neufs++;
        var nom = String(c.name || c.corporateName || c.tradeName || '').trim();
        var t = telDansObjet_(c);
        if (nom && t) { r.hTel++; trouves.push([nom, t, contactDansObjet_(c), 'HENRRI']); }
      });
      if (neufs < 100) break;
    }
  } catch (eH) { r.hErreur = String(eH && eH.message || eH).slice(0, 120); }
  var sh = ongletTels_();
  var v = sh.getDataRange().getValues(), vus = {};
  for (var i = 1; i < v.length; i++) vus[cleTel_(v[i][0])] = true;
  var aEcrire = [];
  trouves.forEach(function (t) {
    var k = cleTel_(t[0]);
    if (!k || vus[k]) return;
    vus[k] = true;
    aEcrire.push([t[0], telLisible_(t[1]), t[2], t[3], new Date()]);
  });
  if (aEcrire.length) sh.getRange(sh.getLastRow() + 1, 1, aEcrire.length, 5).setValues(aEcrire);
  r.ajoutes = aEcrire.length;
  tracerServeur_('SYSTEME', 'TELEPHONES IMPORTES', JSON.stringify(r).slice(0, 300), '', '');
  return r;
}
 /* ================================================================
   v100 — LE RÉPERTOIRE DES CLIENTS (onglet « Clients » du tableau)
   ================================================================
   Un client par nom (sans accents ni casse) : ses coordonnées tirées de ses
   devis (le plus récent d'abord) et de l'onglet CONTRATS, ses devis, ses
   séries au calendrier. Rien n'est écrit, tout est lu. */
function clientsPourAdmin_() {
  var par = {}, ordre = [];
  var cle = function (n) { return sansAccent_(n).replace(/[^A-Z0-9]+/g, ' ').trim(); };
  var prendre = function (nom) {
    var k = cle(nom);
    if (!k) return null;
    if (!par[k]) { par[k] = { cle: k, nom: String(nom).trim(), contact: '', tel: '', email: '', adresse: '', cp: '', ville: '',
                              siret: '', type: '', facture: '', devis: [], contrats: [] }; ordre.push(k); }
    return par[k];
  };
  var remplir = function (c, champs) {
    for (var f in champs) if (champs.hasOwnProperty(f) && !c[f] && String(champs[f] || '').trim()) c[f] = String(champs[f]).trim();
  };
  var dv = lireDevis_().slice().sort(function (a, b) {
    return (b.DATE instanceof Date ? b.DATE.getTime() : 0) - (a.DATE instanceof Date ? a.DATE.getTime() : 0);
  });
  dv.forEach(function (d) {
    if (devisEssai_(d)) return;
    var c = prendre(d.CLIENT);
    if (!c) return;
    remplir(c, { contact: d.CONTACT, tel: d.TELEPHONE, email: d.EMAIL, adresse: d.ADRESSE, cp: d.CP, ville: d.VILLE,
                 siret: d.SIRET_CLIENT, type: String(d.TYPE_CLIENT || '').toUpperCase().indexOf('PART') === 0 ? 'PART' : 'PRO' });
    c.devis.push({ numero: String(d.NUMERO || ''), date: isoDe_(d.DATE) || '', statut: String(d.STATUT || ''),
                   ht: Number(d.TOTAL_HT) || 0 });
  });
  lireContrats_().forEach(function (o) {
    if (!estActif_(o.ACTIF)) return;
    var c = prendre(o.CONTRAT);
    if (!c) return;
    remplir(c, { facture: o.CLIENT_FACTURE, email: o.EMAIL, adresse: o.ADRESSE, cp: o.CP, ville: o.VILLE, siret: o.SIREN,
                 type: /^O/i.test(String(o.PARTICULIER || '')) ? 'PART' : 'PRO' });
  });
  var auj = isoJour_(new Date());
  objetsDe_(SH.RECURRENTS).forEach(function (r) {
    if (!String(r.ID || '').trim() || !estActif_(r.ACTIF)) return;
    if (r.FIN && isoJour_(new Date(r.FIN)) < auj) return;
    var nom = String(r.CLIENT || '').replace(/\s+[—–-]\s+.*$/, '');   // « LE LOCAL — WC » va chez LE LOCAL
    var c = par[cle(nom)] || prendre(r.CLIENT);
    if (!c) return;
    remplir(c, { adresse: r.ADRESSE, cp: r.CP, ville: r.VILLE });
    var m = contratDeNote_(r.NOTE, r.CLIENT);
    c.contrats.push({ id: String(r.ID), libelle: String(r.CLIENT || ''), rythme: String(r.FREQUENCE || '').toLowerCase() +
                      (r.JOUR ? ' · ' + String(r.JOUR).toLowerCase() : ''), prestataire: String(r.PRESTATAIRE || ''),
                      mensuel: m && m.montant ? m.montant : 0 });
  });
  return ordre.map(function (k) { var c = par[k]; c.devis = c.devis.slice(0, 20); return c; })
    .sort(function (a, b) { return a.nom.localeCompare(b.nom, 'fr'); });
}

/* 450 minutes → « 7 h 30 ». Pour un courriel que l'on lit d'un coup d'œil. */
function heuresLisibles_(min) {
  var m = Math.max(0, Math.round(Number(min) || 0));
  var h = Math.floor(m / 60), r = m % 60;
  if (!h) return r + ' min';
  return h + ' h' + (r ? ' ' + ('0' + r).slice(-2) : '');
}

/* ====================== LA PLANIFICATION ======================
 *
 * Un devis signé ne produisait que des fiches « A PLANIFIER », sans jour ni
 * personne : le gérant devait tout poser à la main. Ce qui suit pose les
 * dates et les salariés, et laisse au gérant le dernier mot — il corrige
 * dans la feuille, rien ne réécrit ce qu'il a changé.
 *
 * Trois inconnues, trois réponses :
 *
 * 1. COMBIEN DE TEMPS ? Faute de pointages, on passe par l'argent : la grille
 *    de prix a été bâtie sur un taux horaire, donc heures = montant ÷ taux.
 *    Le taux est dans REGLAGES (taux_horaire_planning), modifiable sans
 *    toucher au code, et la durée obtenue reste rectifiable à la main sur
 *    chaque fiche. Les premiers pointages diront si le taux est juste.
 *
 * 2. QUAND ? À partir de la date d'intervention portée au devis — une vraie
 *    date depuis la v46 — et jamais avant.
 *
 * 3. QUI ? Le salarié le moins chargé de la semaine visée, parmi ceux dont
 *    le jour est travaillé et dont la journée n'est pas déjà pleine.
 *
 * Depuis la v47 : rien n'est posé un jour férié ni pendant une absence (onglet
 * ABSENCES) ; un second chantier dans la journée compte la route calculée par
 * Google Maps depuis le chantier précédent (forfait si le calcul échoue) ; les
 * passages d'un contrat suivent sa vraie fréquence ; un reste de moins d'une
 * heure n'ouvre pas une journée de plus ; et un devis qui n'est plus signé
 * rend ses créneaux.
 */

/* L'interrupteur du classeur. Posé à NON, l'appli crée les fiches mais ne pose
   ni date ni salarié : on revient au fonctionnement d'avant, sans toucher au
   code. C'est la sortie de secours si la planification se trompe. */
function planificationAuto_(reg) {
  /* v99 — Simon, le 8 novembre : « quand c'est signé, crée juste
     l'intervention et mets-la dans à placer ; à notre échelle je peux encore
     choisir où placer ». Le placement automatique est donc coupé par défaut :
     il ne revient que si REGLAGES porte placement_auto = OUI. L'ancienne clé
     planification_auto n'est plus lue. Pour placer, l'appli propose des
     créneaux (suggestionsPlacement_). */
  return String((reg && reg.placement_auto) || 'NON').toUpperCase().trim() === 'OUI';
}

/* Le taux horaire de vente qui sert à convertir un montant en heures. */
function tauxHorairePlanning_(reg) {
  var t = Number(String((reg && reg.taux_horaire_planning) || '').replace(',', '.'));
  return (isFinite(t) && t > 0) ? t : 30;
}

/* Un montant en minutes de travail, arrondies au quart d'heure. Jamais moins
   d'une demi-heure : un déplacement ne se fait pas pour dix minutes. */
function minutesPour_(montantHt, taux) {
  var m = Number(montantHt) || 0;
  if (m <= 0) return 0;
  var min = m / (taux || 30) * 60;
  min = Math.round(min / 15) * 15;
  return Math.max(30, min);
}

/* « MA,ME,JE,VE,SA » → [2,3,4,5,6] (0 = dimanche, comme getDay()).
   On accepte les noms entiers, les abréviations et n'importe quel séparateur :
   une colonne remplie à la main les mélange toujours. Vide → du lundi au
   vendredi, le cas le plus courant. */
function joursTravailles_(v) {
  var table = [['DIMANCHE', 'DI', 'DIM'], ['LUNDI', 'LU', 'LUN'], ['MARDI', 'MA', 'MAR'],
               ['MERCREDI', 'ME', 'MER'], ['JEUDI', 'JE', 'JEU'],
               ['VENDREDI', 'VE', 'VEN'], ['SAMEDI', 'SA', 'SAM']];
  var brut = String(v || '').toUpperCase()
    .replace(/[ÉÈÊ]/g, 'E').replace(/[À]/g, 'A')
    .split(/[^A-Z]+/).filter(function (x) { return x; });
  var vus = {}, sortie = [];
  brut.forEach(function (mot) {
    for (var j = 0; j < 7; j++) {
      if (table[j].indexOf(mot) >= 0 && !vus[j]) { vus[j] = true; sortie.push(j); }
    }
  });
  if (!sortie.length) return [1, 2, 3, 4, 5];
  return sortie.sort(function (a, b) { return a - b; });
}

/* « 08:00-12:00, 14:00-17:00 » → [{debut:480, fin:720}, {debut:840, fin:1020}],
   en minutes depuis minuit. Vide → la journée type de la maison. */
function plagesTravail_(v) {
  var sortie = [];
  String(v || '').replace(/[hH]/g, ':').split(/[;,]+/).forEach(function (bout) {
    var m = String(bout).match(/(\d{1,2}):?(\d{2})?\s*[-–à]\s*(\d{1,2}):?(\d{2})?/);
    if (!m) return;
    var d = Number(m[1]) * 60 + Number(m[2] || 0);
    var f = Number(m[3]) * 60 + Number(m[4] || 0);
    if (f > d) sortie.push({ debut: d, fin: f });
  });
  if (!sortie.length) return [{ debut: 480, fin: 720 }, { debut: 840, fin: 1020 }];
  return sortie.sort(function (a, b) { return a.debut - b.debut; });
}

function capaciteJour_(plages) {
  var t = 0;
  plages.forEach(function (p) { t += p.fin - p.debut; });
  return t;
}

/* Les salariés tels que le planning les voit : qui travaille quels jours,
   dans quelles plages, et combien d'heures par semaine au plus. */
function prestatairesPlanning_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.PRESTATAIRES);
  if (!sh || sh.getLastRow() < 2) return [];
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var iNom = en.indexOf('NOM'), iActif = en.indexOf('ACTIF');
  var iJours = en.indexOf('JOURS'), iPlages = en.indexOf('PLAGES');
  var iHeures = en.indexOf('HEURES_SEMAINE');
  var iPlan = en.indexOf('PLANIFIABLE');
  if (iNom < 0) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
    .filter(function (r) {
      return String(r[iNom]).trim() &&
             (iActif < 0 || estActif_(r[iActif])) &&
             /* Vide vaut OUI : les fiches d'avant cette colonne gardent leur
                place dans la répartition. */
             (iPlan < 0 || estActif_(r[iPlan]));
    })
    .map(function (r) {
      var plages = plagesTravail_(iPlages >= 0 ? r[iPlages] : '');
      var h = Number(String(iHeures >= 0 ? r[iHeures] : '').replace(',', '.'));
      return {
        nom: String(r[iNom]).trim(),
        /* La charge se compte sous le nom normalisé, parce que la feuille écrit
           « Maxime » ici et « MAXIME » là. Sans cela, l'appli ne voyait jamais
           ce qui était déjà posé et empilait tout sur la même personne. */
        cle: normNom_(r[iNom]),
        jours: joursTravailles_(iJours >= 0 ? r[iJours] : ''),
        plages: plages,
        capaciteJour: capaciteJour_(plages),
        capaciteSemaine: (isFinite(h) && h > 0) ? Math.round(h * 60) : 2100   // 35 h
      };
    });
}

/* Le lundi de la semaine d'une date : c'est la clé qui sert à compter la
   charge hebdomadaire. */
function cleSemaine_(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var j = x.getDay();                       // 0 = dimanche
  x.setDate(x.getDate() - (j === 0 ? 6 : j - 1));
  return isoJour_(x);
}

/* Ce qui est déjà posé : minutes par salarié et par jour, et par semaine.
   On lit la durée prévue quand elle est là, et l'on compte une demi-journée
   par défaut pour une fiche ancienne qui n'en porte pas — mieux vaut un
   planning prudent qu'un salarié en retard toute la journée. */
function chargeActuelle_(auForfait) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  var reg = lireReglages_();
  /* Le trajet et le calendrier voyagent avec la charge : tout ce qui cherche
     un créneau les trouve au même endroit, sans relire le classeur.
     « lieu » retient, par salarié et par jour, l'adresse du dernier chantier
     posé : c'est de là qu'il partira pour le suivant. */
  var charge = { jour: {}, semaine: {}, lieu: {},
                 trajet: trajetMinutes_(reg), calcule: auForfait ? false : trajetCalcule_(reg), routes: {},
                 cal: calendrier_(reg) };
  if (!sh || sh.getLastRow() < 2) return charge;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var iDate = en.indexOf('DATE'), iQui = en.indexOf('PRESTATAIRE');
  var iDur = en.indexOf('DUREE_PREVUE_MIN'), iStatut = en.indexOf('STATUT');
  var iHeure = en.indexOf('HEURE');
  var iAdr = en.indexOf('ADRESSE'), iCp = en.indexOf('CP'), iVille = en.indexOf('VILLE');
  if (iDate < 0 || iQui < 0) return charge;
  var poses = [];
  for (var i = 1; i < v.length; i++) {
    var d = v[i][iDate];
    var lesQui = nomsQui_(v[i][iQui]).map(normNom_);
    if (!lesQui.length || !d || !(d instanceof Date)) continue;
    if (iStatut >= 0 && String(v[i][iStatut]).toUpperCase() === 'ANNULE') continue;
    var min = iDur >= 0 ? Number(v[i][iDur]) : 0;
    if (!isFinite(min) || min <= 0) min = 210;
    var h = iHeure >= 0 ? v[i][iHeure] : '';
    if (h instanceof Date) h = ('0' + h.getHours()).slice(-2) + ':' + ('0' + h.getMinutes()).slice(-2);
    // un binôme occupe la journée de chacun des deux
    lesQui.forEach(function (qui) {
      poses.push({ qui: qui, date: d, iso: isoJour_(d), heure: String(h || ''), min: min,
                   adresse: adresseComplete_(iAdr >= 0 ? v[i][iAdr] : '', iCp >= 0 ? v[i][iCp] : '',
                                             iVille >= 0 ? v[i][iVille] : ''),
                   rang: i });
    });
  }
  /* Dans l'ordre de la journée, pour que la route se compte du chantier de
     8 h vers celui de 14 h et non dans l'ordre où les lignes ont été écrites. */
  poses.sort(function (a, b) {
    if (a.iso !== b.iso) return a.iso < b.iso ? -1 : 1;
    if (a.heure !== b.heure) return a.heure < b.heure ? -1 : 1;
    return a.rang - b.rang;
  });
  /* Les journées passées n'ont plus de créneau à offrir : inutile d'interroger
     Google Maps pour elles, le forfait suffit à compter la semaine en cours. */
  var auj = isoJour_(new Date());
  poses.forEach(function (p) {
    reserver_(charge, p.qui, p.date, p.min, p.adresse, p.iso < auj);
  });
  return charge;
}

/* Le premier créneau possible pour un lot, à partir d'un jour donné.
   Renvoie { date, heure, nom } ou null si rien ne se libère dans l'horizon.
   Le salarié retenu est le moins chargé de sa semaine parmi ceux qui peuvent :
   c'est ce qui égalise les plannings dès qu'il y a plus d'une personne. */
function creneauPour_(minutes, depuis, gens, charge, prefere, horizon, adresse) {
  if (!gens.length) return null;
  var jour = new Date(depuis.getFullYear(), depuis.getMonth(), depuis.getDate(), 12, 0, 0);
  for (var pas = 0; pas < (horizon || 120); pas++) {
    var jSem = jour.getDay(), iso = isoJour_(jour), sem = cleSemaine_(jour);
    /* Un jour férié ou un jour de fermeture ne reçoit rien, pour personne. */
    var ferme = jourFerme_(charge.cal, jour);
    var possibles = ferme ? [] : gens.filter(function (g) {
      if (g.jours.indexOf(jSem) < 0) return false;
      if (estAbsent_(charge.cal, g.cle, iso)) return false;
      var dejaJ = charge.jour[g.cle + '|' + iso] || 0;
      var dejaS = charge.semaine[g.cle + '|' + sem] || 0;
      /* Un deuxième chantier dans la journée, c'est aussi une route à faire,
         du chantier précédent jusqu'à celui-ci : elle prend sur la journée et
         sur la semaine comme du travail. */
      var route = dejaJ > 0 ? trajetEntre_(charge, charge.lieu[g.cle + '|' + iso], adresse) : 0;
      return (dejaJ + route + minutes <= g.capaciteJour) &&
             (dejaS + route + minutes <= g.capaciteSemaine);
    });
    if (possibles.length) {
      /* Le même salarié garde les jours suivants d'un chantier découpé, et les
         passages suivants d'un contrat : le client voit la même personne. */
      var choisi = null;
      if (prefere) {
        possibles.forEach(function (g) { if (g.nom === prefere) choisi = g; });
      }
      if (!choisi) {
        possibles.sort(function (a, b) {
          var ca = charge.semaine[a.cle + '|' + sem] || 0;
          var cb = charge.semaine[b.cle + '|' + sem] || 0;
          if (ca !== cb) return ca - cb;
          return a.nom < b.nom ? -1 : 1;
        });
        choisi = possibles[0];
      }
      /* L'heure de début : la première plage où il reste de la place. On ne
         découpe pas à la minute dans la journée — le salarié s'organise — on
         donne un point de départ honnête. */
      var reste = charge.jour[choisi.cle + '|' + iso] || 0;
      var routeChoisie = reste > 0
        ? trajetEntre_(charge, charge.lieu[choisi.cle + '|' + iso], adresse) : 0;
      reste += routeChoisie;                   // il arrive après la route
      var debut = choisi.plages[0].debut;
      for (var p = 0; p < choisi.plages.length; p++) {
        var large = choisi.plages[p].fin - choisi.plages[p].debut;
        if (reste < large) { debut = choisi.plages[p].debut + reste; break; }
        reste -= large;
      }
      return {
        date: new Date(jour.getTime()),
        heure: ('0' + Math.floor(debut / 60)).slice(-2) + ':' + ('0' + (debut % 60)).slice(-2),
        nom: choisi.nom,
        route: routeChoisie
      };
    }
    jour.setDate(jour.getDate() + 1);
  }
  return null;
}

function reserver_(charge, nom, date, minutes, adresse, auForfait) {
  var k = normNom_(nom);
  var cj = k + '|' + isoJour_(date), cs = k + '|' + cleSemaine_(date);
  /* S'il y a déjà un chantier ce jour-là, celui-ci coûte aussi la route pour
     venir du précédent. */
  var route = 0;
  if ((charge.jour[cj] || 0) > 0) {
    route = auForfait ? (charge.trajet || 0)
                      : trajetEntre_(charge, charge.lieu ? charge.lieu[cj] : '', adresse);
  }
  charge.jour[cj] = (charge.jour[cj] || 0) + route + minutes;
  charge.semaine[cs] = (charge.semaine[cs] || 0) + route + minutes;
  if (charge.lieu) charge.lieu[cj] = adresse || '';
}

/* ---------- la route entre deux chantiers ---------- */

/* L'interrupteur : NON ramène au forfait, sans interroger Google Maps. */
function trajetCalcule_(reg) {
  return String((reg && reg.trajet_calcule) || 'OUI').toUpperCase().trim() !== 'NON';
}

/* « 12 rue des Lilas », « 56000 », « Vannes » → « 12 rue des Lilas, 56000 Vannes, France ».
   Sans rue ni ville, on ne rend rien : mieux vaut le forfait qu'un itinéraire
   calculé vers le centre d'un département. */
function adresseComplete_(adresse, cp, ville) {
  var a = String(adresse === null || adresse === undefined ? '' : adresse).trim();
  var c = String(cp === null || cp === undefined ? '' : cp).trim();
  var v = String(ville === null || ville === undefined ? '' : ville).trim();
  if (!a || (!c && !v)) return '';
  return a + ', ' + (c + ' ' + v).trim() + ', France';
}

/* Deux adresses écrites un peu différemment sont la même porte. */
function cleAdresse_(a) {
  return String(a || '').toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ').trim();
}

/**
 * Minutes de route en voiture d'une adresse à l'autre, par Google Maps,
 * arrondies aux cinq minutes supérieures.
 *
 * Tout ce qui empêche le calcul — adresse manquante, Google Maps muet, quota
 * atteint, résultat invraisemblable — ramène au forfait de REGLAGES : la
 * planification ne doit jamais s'arrêter parce qu'un itinéraire manque.
 */
function trajetEntre_(charge, depuis, vers) {
  var forfait = (charge && charge.trajet) || 0;
  if (!depuis || !vers) return forfait;
  var ka = cleAdresse_(depuis), kb = cleAdresse_(vers);
  if (ka === kb) return 0;                           // même adresse : pas de route
  if (!charge || !charge.calcule) return forfait;
  var cle = ka + ' > ' + kb;
  if (!charge.routes) charge.routes = {};
  if (charge.routes.hasOwnProperty(cle)) return charge.routes[cle];

  /* Le même trajet revient d'une signature à l'autre : six heures de mémoire
     épargnent Google Maps et le temps de réponse du téléphone. */
  var cache = null, cleCache = 'trajet:' + empreinteCourte_(cle);
  try {
    cache = CacheService.getScriptCache();
    var vu = cache.get(cleCache);
    if (vu !== null && vu !== undefined && vu !== '' && isFinite(Number(vu))) {
      return charge.routes[cle] = Number(vu);
    }
  } catch (e) { cache = null; }

  var min = -1;
  try {
    var r = Maps.newDirectionFinder()
      .setOrigin(depuis).setDestination(vers)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .setRegion('fr')
      .getDirections();
    var jambe = r && r.routes && r.routes[0] && r.routes[0].legs && r.routes[0].legs[0];
    if (jambe && jambe.duration && isFinite(Number(jambe.duration.value))) {
      min = Math.ceil(Number(jambe.duration.value) / 60 / 5) * 5;
    }
  } catch (e) { min = -1; }

  if (min < 0) return charge.routes[cle] = forfait;   // pas de réponse : on n'insiste pas
  /* Plus de trois heures entre deux chantiers d'une même journée : c'est une
     adresse mal comprise, pas un trajet. On le dit, et on prend le forfait. */
  if (min > 180) {
    try { tracerServeur_('SYSTEME', 'TRAJET IGNORE', depuis + ' → ' + vers + ' : ' + min + ' min', '', ''); }
    catch (e) {}
    return charge.routes[cle] = forfait;
  }
  try { if (cache) cache.put(cleCache, String(min), 21600); } catch (e) {}
  return charge.routes[cle] = min;
}

/* Une clé de cache courte et stable pour une paire d'adresses. */
function empreinteCourte_(texte) {
  var h = 0, t = String(texte);
  for (var i = 0; i < t.length; i++) { h = ((h << 5) - h + t.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36) + '.' + t.length;
}

/** À lancer depuis l'éditeur : vérifie que Google Maps répond pour ce compte. */
function testerTrajet() {
  var charge = { trajet: 30, calcule: true, routes: {} };
  var a = '3 Le Norvais, 56250 Monterblanc, France', b = 'Place de la République, 56000 Vannes, France';
  var m = trajetEntre_(charge, a, b);
  Logger.log('Trajet calculé : ' + m + ' min de ' + a + ' à ' + b);
  return m;
}

/* ---------- le trajet, les jours fériés, les absences ---------- */

/* Minutes de route entre deux chantiers d'une même journée. Zéro est permis :
   c'est le réglage de quelqu'un qui ne veut pas en tenir compte. */
function trajetMinutes_(reg) {
  var brut = String((reg && reg.trajet_minutes !== undefined) ? reg.trajet_minutes : '').trim();
  if (brut === '') return 30;
  var t = Number(brut.replace(',', '.'));
  return (isFinite(t) && t >= 0) ? Math.round(t) : 30;
}

/* Sous ce nombre de minutes, le reste d'un chantier n'ouvre pas une journée de
   plus. La durée vient du prix, pas d'un chronomètre : envoyer quelqu'un pour
   un quart d'heure sur la foi d'une division serait absurde. */
function reliquatIgnore_(reg) {
  var brut = String((reg && reg.reliquat_ignore_min !== undefined) ? reg.reliquat_ignore_min : '').trim();
  if (brut === '') return 60;
  var t = Number(brut.replace(',', '.'));
  return (isFinite(t) && t >= 0) ? Math.round(t) : 60;
}

/* Le dimanche de Pâques, par le calcul de Meeus : les trois fériés mobiles en
   découlent, et aucune liste n'est à tenir à jour d'une année sur l'autre. */
function paques_(an) {
  var a = an % 19, b = Math.floor(an / 100), c = an % 100;
  var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var mois = Math.floor((h + l - 7 * m + 114) / 31);
  var jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(an, mois - 1, jour, 12, 0, 0);
}

/* Les onze jours fériés de métropole pour une année : { '2026-11-11': 'Armistice 1918', … } */
function joursFeries_(an) {
  var t = {};
  function fixe(m, j, nom) { t[isoJour_(new Date(an, m - 1, j, 12, 0, 0))] = nom; }
  function mobile(decalage, nom) {
    var d = paques_(an); d.setDate(d.getDate() + decalage); t[isoJour_(d)] = nom;
  }
  fixe(1, 1, 'Jour de l\'an'); mobile(1, 'Lundi de Pâques');
  fixe(5, 1, 'Fête du travail'); fixe(5, 8, 'Victoire 1945');
  mobile(39, 'Ascension'); mobile(50, 'Lundi de Pentecôte');
  fixe(7, 14, 'Fête nationale'); fixe(8, 15, 'Assomption');
  fixe(11, 1, 'Toussaint'); fixe(11, 11, 'Armistice 1918'); fixe(12, 25, 'Noël');
  return t;
}

/* Une cellule de date, quelle que soit la façon dont elle a été tapée :
   vraie date, « 12/10/2026 » ou « 2026-10-12 ». Rend '2026-10-12', ou ''. */
function jourDe_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : isoJour_(v);
  var s = String(v === null || v === undefined ? '' : v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

/* L'onglet ABSENCES : une ligne par période. PRESTATAIRE vide ou « TOUS » ferme
   la maison pour tout le monde. AU vide vaut une seule journée. */
function lireAbsences_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.ABSENCES);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim().toUpperCase(); });
  var iQui = en.indexOf('PRESTATAIRE'), iDu = en.indexOf('DU'), iAu = en.indexOf('AU');
  if (iDu < 0) return [];
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var du = jourDe_(v[i][iDu]);
    if (!du) continue;
    var au = (iAu >= 0 ? jourDe_(v[i][iAu]) : '') || du;
    if (au < du) { var x = du; du = au; au = x; }      // dates tapées à l'envers
    var qui = iQui >= 0 ? normNom_(v[i][iQui]) : '';
    if (qui === 'tous' || qui === 'tout le monde' || qui === 'fermeture') qui = '';
    out.push({ cle: qui, du: du, au: au });
  }
  return out;
}

/* Tout ce qui interdit un jour, réuni une fois pour toutes. */
function calendrier_(reg) {
  return {
    feriesTravailles: String((reg && reg.travail_jours_feries) || 'NON').toUpperCase().trim() === 'OUI',
    absences: lireAbsences_(),
    annees: {}
  };
}

/* Le férié d'une date « 2026-11-11 », sans calendrier sous la main. */
function nomFerieIso_(iso) {
  var d = dateIso_(iso);
  if (!d) return '';
  return joursFeries_(d.getFullYear())[isoJour_(d)] || '';
}

/* Le nom du jour férié, ou '' si c'est un jour ordinaire. */
function ferie_(cal, date) {
  if (!cal || cal.feriesTravailles) return '';
  var an = date.getFullYear();
  if (!cal.annees[an]) cal.annees[an] = joursFeries_(an);
  return cal.annees[an][isoJour_(date)] || '';
}

/* Fermé pour tout le monde : férié, ou fermeture inscrite dans ABSENCES. */
function jourFerme_(cal, date) {
  if (!cal) return false;
  if (ferie_(cal, date)) return true;
  return estAbsent_(cal, '', isoJour_(date), true);
}

/* Ce salarié est-il absent ce jour-là ? Avec seulementTous, on ne regarde que
   les fermetures de la maison. */
function estAbsent_(cal, cle, iso, seulementTous) {
  if (!cal || !cal.absences) return false;
  for (var i = 0; i < cal.absences.length; i++) {
    var a = cal.absences[i];
    if (iso < a.du || iso > a.au) continue;
    if (a.cle === '') return true;
    if (!seulementTous && a.cle === cle) return true;
  }
  return false;
}

/* Quelqu'un peut-il travailler ce jour-là ? Sert à choisir le jour d'un
   passage de contrat avant même de regarder la charge. */
function jourOuvrable_(gens, cal, date) {
  if (jourFerme_(cal, date)) return false;
  var j = date.getDay(), iso = isoJour_(date);
  return gens.some(function (g) {
    return g.jours.indexOf(j) >= 0 && !estAbsent_(cal, g.cle, iso);
  });
}

/**
 * Pose sur le planning les chantiers d'un devis qui n'ont ni date ni salarié.
 *
 * Renvoie un compte rendu : ce qui a été posé, ce qui ne l'a pas été. Le gérant
 * le reçoit par courriel ; rien n'est posé en silence.
 *
 * Ne touche jamais une fiche qui porte déjà une date : si le gérant a corrigé
 * à la main, c'est lui qui a raison.
 */
function planifierDevis_(numero) {
  var bilan = { poses: [], refuses: [], motif: '' };
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) { bilan.motif = 'aucun chantier'; return bilan; }

  if (!planificationAuto_(lireReglages_())) {
    bilan.motif = 'planification automatique coupée dans les réglages';
    return bilan;
  }
  var gens = prestatairesPlanning_();
  if (!gens.length) { bilan.motif = 'aucun salarié actif'; return bilan; }

  var devis = null;
  lireDevis_().forEach(function (d) {
    if (String(d.NUMERO).trim() === String(numero).trim()) devis = d;
  });
  if (!devis) { bilan.motif = 'devis introuvable'; return bilan; }

  /* Jamais avant la date promise au client, et jamais dans le passé : un devis
     signé en retard ne fait pas voyager dans le temps. */
  var depuis = devis.DATE_SOUHAITEE instanceof Date ? new Date(devis.DATE_SOUHAITEE) : null;
  var aujourdhui = new Date();
  if (!depuis || depuis < aujourdhui) depuis = aujourdhui;

  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var iNum = en.indexOf('NUMERO'), iDate = en.indexOf('DATE'), iHeure = en.indexOf('HEURE');
  var iQui = en.indexOf('PRESTATAIRE'), iStatut = en.indexOf('STATUT');
  var iDur = en.indexOf('DUREE_PREVUE_MIN'), iLot = en.indexOf('LOT'), iId = en.indexOf('ID');
  var iAdr = en.indexOf('ADRESSE'), iCp = en.indexOf('CP'), iVille = en.indexOf('VILLE');
  if (iNum < 0 || iDate < 0 || iQui < 0) { bilan.motif = 'colonnes manquantes'; return bilan; }

  var charge = chargeActuelle_();
  var recurrent = recurrentDevis_(devis.NATURE, devis.PASSAGES_MOIS, devis.SANS_CONTRAT);
  var prefere = '';
  var curseur = new Date(depuis.getTime());
  var num = String(numero).trim();
  function midi(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0); }
  function debutDePassage(lot) { return !lot || Number(lot.split('/')[0]) === 1; }
  function lotDe(ligne) { return iLot >= 0 ? String(ligne[iLot] || '').trim() : ''; }

  /* Combien de passages ce devis compte-t-il ? C'est ce qui donne le rythme :
     huit passages dans le mois, c'est deux par semaine, pas un par semaine
     pendant deux mois. */
  var passages = 0;
  for (var n = 1; n < v.length; n++) {
    if (String(v[n][iNum]).trim() === num && debutDePassage(lotDe(v[n]))) passages++;
  }
  if (passages < 1) passages = 1;

  var rang = -1;            // le passage en cours, compté depuis zéro
  var ancre = null;         // le jour du premier passage : les autres s'y réfèrent
  var dernier = null;       // le dernier jour occupé par ce devis

  for (var i = 1; i < v.length; i++) {
    if (String(v[i][iNum]).trim() !== num) continue;
    var lot = lotDe(v[i]);
    var debut = debutDePassage(lot);
    if (debut) rang++;

    if (v[i][iDate]) {                               // déjà posé, on n'y touche pas
      if (v[i][iDate] instanceof Date) {
        if (!ancre && rang === 0) ancre = midi(v[i][iDate]);
        if (!dernier || v[i][iDate] > dernier) dernier = midi(v[i][iDate]);
      }
      continue;
    }
    if (iStatut >= 0 && String(v[i][iStatut]).toUpperCase().trim() === 'ANNULE') continue;
    if (String(v[i][iQui]).trim()) continue;         // déjà affecté à la main

    var minutes = iDur >= 0 ? Number(v[i][iDur]) : 0;
    if (!isFinite(minutes) || minutes <= 0) minutes = 210;

    /* Les jours d'un même passage se suivent. Les passages d'un contrat se
       répartissent sur quatre semaines à partir du premier : quatre passages
       tombent le même jour chaque semaine, huit sur deux jours fixes. */
    if (recurrent && debut) {
      var cible = midi(ancre || depuis);
      cible.setDate(cible.getDate() + Math.round(rang * 28 / passages));
      if (cible < depuis) cible = midi(depuis);
      var plancher = dernier ? midi(dernier) : null;
      if (plancher) plancher.setDate(plancher.getDate() + 1);
      if (plancher && cible < plancher) cible = plancher;
      /* Le jour visé n'est pas travaillé : on préfère la veille au lendemain,
         pour ne pas coller ce passage au suivant. */
      for (var recul = 1; recul <= 3 && !jourOuvrable_(gens, charge.cal, cible); recul++) {
        var avant = midi(cible); avant.setDate(avant.getDate() - recul);
        if (avant < midi(depuis) || (plancher && avant < plancher)) break;
        if (jourOuvrable_(gens, charge.cal, avant)) { cible = avant; break; }
      }
      curseur = cible;
    }

    var ou = adresseComplete_(iAdr >= 0 ? v[i][iAdr] : '', iCp >= 0 ? v[i][iCp] : '',
                              iVille >= 0 ? v[i][iVille] : '');
    var c = creneauPour_(minutes, curseur, gens, charge, prefere || null, 120, ou);
    if (!c) {
      bilan.refuses.push({ id: iId >= 0 ? v[i][iId] : '', minutes: minutes });
      continue;
    }
    reserver_(charge, c.nom, c.date, minutes, ou);
    sh.getRange(i + 1, iDate + 1).setValue(c.date);
    if (iHeure >= 0) sh.getRange(i + 1, iHeure + 1).setValue(c.heure);
    sh.getRange(i + 1, iQui + 1).setValue(c.nom);
    if (iStatut >= 0) sh.getRange(i + 1, iStatut + 1).setValue('PLANIFIE');
    bilan.poses.push({ id: iId >= 0 ? v[i][iId] : '', date: c.date, heure: c.heure,
                       nom: c.nom, minutes: minutes, route: c.route || 0 });
    prefere = c.nom;
    if (!ancre && rang === 0) ancre = midi(c.date);
    if (!dernier || c.date > dernier) dernier = midi(c.date);
    /* Le lot suivant d'un même passage part du lendemain ; sinon on repart du
       jour posé. */
    curseur = new Date(c.date.getTime());
    if (lot && Number(lot.split('/')[0]) < Number(lot.split('/')[1])) {
      curseur.setDate(curseur.getDate() + 1);
    }
  }
  return bilan;
}

/* ---------- un devis qui n'est plus signé libère son planning ---------- */

var MARQUE_ANNULATION_ = 'Annulé (devis ';

/**
 * Annule les chantiers d'un devis qui n'ont pas commencé. Un chantier où le
 * salarié a pointé son arrivée n'est jamais touché : le travail a eu lieu, il
 * reste à facturer ou à discuter, pas à effacer.
 *
 * La date et le nom sont retirés de la fiche — c'est ce qui la fait disparaître
 * du téléphone du salarié et rend la place au planning — mais notés dans NOTE,
 * pour que le gérant sache quel rendez-vous il doit décommander.
 */
function annulerChantiers_(numero, motif, qui, appareil) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var iNum = en.indexOf('NUMERO'), iDate = en.indexOf('DATE'), iHeure = en.indexOf('HEURE');
  var iQui = en.indexOf('PRESTATAIRE'), iStatut = en.indexOf('STATUT');
  var iArr = en.indexOf('ARRIVEE'), iNote = en.indexOf('NOTE'), iId = en.indexOf('ID');
  var iAv = en.indexOf('AVANT_SIGNATURE');
  if (iNum < 0 || iStatut < 0) return [];
  var annules = [], laisses = [];
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][iNum]).trim() !== String(numero).trim()) continue;
    var st = String(v[i][iStatut]).toUpperCase().trim();
    if (st !== 'A PLANIFIER' && st !== 'PLANIFIE' && st !== '') continue;
    if (iArr >= 0 && v[i][iArr]) continue;           // il y est allé
    /* Posé par le gérant avant la signature : ce n'est pas la signature qui le
       tenait, ce n'est donc pas son absence qui doit l'emporter. Il reste au
       planning, et le gérant est prévenu qu'il a une décision à prendre. */
    if (iAv >= 0 && String(v[i][iAv] || '').trim().toUpperCase() === 'OUI') {
      laisses.push({ id: iId >= 0 ? String(v[i][iId]) : '',
                     date: iDate >= 0 && v[i][iDate] instanceof Date ? v[i][iDate] : null,
                     nom: iQui >= 0 ? String(v[i][iQui] || '').trim() : '' });
      continue;
    }
    var d = iDate >= 0 && v[i][iDate] instanceof Date ? v[i][iDate] : null;
    var nom = iQui >= 0 ? String(v[i][iQui] || '').trim() : '';
    var trace = MARQUE_ANNULATION_ + (motif || 'non signé') + ') le ' +
      Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy') +
      (d ? ' — était prévu le ' + Utilities.formatDate(d, 'Europe/Paris', 'dd/MM/yyyy') : '') +
      (nom ? ' avec ' + nom : '');
    sh.getRange(i + 1, iStatut + 1).setValue('ANNULE');
    if (iDate >= 0) sh.getRange(i + 1, iDate + 1).setValue('');
    if (iHeure >= 0) sh.getRange(i + 1, iHeure + 1).setValue('');
    if (iQui >= 0) sh.getRange(i + 1, iQui + 1).setValue('');
    if (iNote >= 0) {
      var deja = String(v[i][iNote] || '').trim();
      sh.getRange(i + 1, iNote + 1).setValue(deja ? deja + '\n' + trace : trace);
    }
    annules.push({ id: iId >= 0 ? String(v[i][iId]) : '', date: d, nom: nom });
  }

  if (laisses.length) {
    tracerServeur_(qui || 'SYSTEME', 'CHANTIERS LAISSES',
                   laisses.length + ' posé(s) avant signature, gardé(s) au planning — ' +
                   'devis ' + (motif || 'non signé') + ' : à annuler toi-même si besoin',
                   numero, appareil || '');
    var regL = lireReglages_();
    var destL = String(regL.recap_email || '').trim() || Session.getEffectiveUser().getEmail();
    var corpsL = 'Le devis ' + numero + ' est passé à « ' + (motif || 'non signé') + ' ».\n\n' +
      laisses.length + ' intervention(s) avaient été posée(s) avant la signature. ' +
      'Elles sont RESTÉES au planning, parce que ce n\'est pas la signature qui les ' +
      'tenait :\n' +
      laisses.map(function (a) {
        return '  · ' + (a.date ? Utilities.formatDate(a.date, 'Europe/Paris', 'dd/MM/yyyy')
                                : '(sans date)') +
               (a.nom ? ' — ' + a.nom : '') + (a.id ? ' (' + a.id + ')' : '');
      }).join('\n') +
      '\n\nÀ toi de décider : si le client se retire pour de bon, annule-les depuis ' +
      'ton tableau.\n' + SpreadsheetApp.getActive().getUrl();
    try { envoyerMail_({ to: destL, subject: 'Planning — devis ' + numero +
                         ' : interventions gardées', body: corpsL }, regL); }
    catch (eL) { /* le classeur reste la source */ }
  }

  if (!annules.length) return annules;

  tracerServeur_(qui || 'SYSTEME', 'CHANTIERS ANNULES',
                 annules.length + ' annulé(s) — devis ' + (motif || 'non signé'),
                 numero, appareil || '');

  /* Le gérant n'est dérangé que si un rendez-vous était réellement pris : c'est
     lui qui prévient le client et le salarié. */
  var poses = annules.filter(function (a) { return a.date; });
  if (poses.length) {
    var reg = lireReglages_();
    var dest = String(reg.recap_email || '').trim() || Session.getEffectiveUser().getEmail();
    var corps = 'Le devis ' + numero + ' est passé à « ' + (motif || 'non signé') + ' ».\n\n' +
      poses.length + ' intervention(s) retirée(s) du planning :\n' +
      poses.map(function (a) {
        return '  · ' + Utilities.formatDate(a.date, 'Europe/Paris', 'dd/MM/yyyy') +
               (a.nom ? ' — ' + a.nom : '') + (a.id ? ' (' + a.id + ')' : '');
      }).join('\n') +
      '\n\nLe salarié ne les verra plus sur son téléphone à sa prochaine connexion : ' +
      'préviens-le si la date est proche.\n' + SpreadsheetApp.getActive().getUrl();
    try { envoyerMail_({ to: dest, subject: 'Planning — devis ' + numero + ' annulé', body: corps }, reg); }
    catch (e) { /* le classeur reste la source */ }
  }
  return annules;
}

/* Pose ou retire la marque « posé avant signature » sur tous les chantiers
   d'un devis. Rend le nombre de lignes réellement changées : une marque déjà
   bonne ne se réécrit pas, pour ne pas faire travailler le classeur pour rien. */
function marquerAvantSignature_(numero, oui) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) return 0;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var iNum = en.indexOf('NUMERO'), iAv = en.indexOf('AVANT_SIGNATURE');
  if (iNum < 0 || iAv < 0) return 0;
  var vise = oui ? 'OUI' : '';
  var n = 0;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][iNum]).trim() !== String(numero).trim()) continue;
    if (String(v[i][iAv] || '').trim().toUpperCase() === vise) continue;
    sh.getRange(i + 1, iAv + 1).setValue(vise);
    n++;
  }
  return n;
}

/* Le travail posé sans attendre la signature.

   Un chantier naît normalement d'un devis signé. Mais le commercial ne déclare
   pas toujours la signature en temps et en heure, et pendant ce temps le client
   attend sa date et le salarié n'a rien à faire. Le gérant peut donc poser le
   planning d'un devis qui n'est pas encore marqué signé.

   Ce n'est pas une signature : le devis garde son statut, son numéro, et son
   absence de preuve. Rien d'autre ne bouge que les chantiers. */
function poserAvantSignature_(d, com) {
  var num = String(d.numero || '').trim();
  if (!num) return { ok: false, erreur: 'numéro de devis manquant' };

  var devis = null;
  lireDevis_().forEach(function (x) {
    if (String(x.NUMERO).trim() === num) devis = x;
  });
  if (!devis) return { ok: false, erreur: 'devis introuvable' };

  var st = String(devis.STATUT || '').toUpperCase().trim();
  if (st === 'SIGNE') {
    return { ok: false, erreur: 'ce devis est signé : son planning est déjà posé' };
  }
  if (st === 'REFUSE') {
    return { ok: false, erreur: 'ce devis a été refusé — corrige d\'abord son résultat' };
  }

  /* genererChantiers_ ne fait rien si les lignes existent déjà : on peut donc
     rappeler cette action pour compléter un planning laissé à moitié posé. */
  var nes = genererChantiers_(num);
  marquerAvantSignature_(num, true);
  var bilan = poserPlanning_(num, com.nom, d.appareil || '', true);

  tracerServeur_(com.nom, 'CHANTIERS POSES AVANT SIGNATURE',
                 nes + ' créé(s), ' + bilan.poses.length + ' planifié(s)' +
                 (bilan.motif ? ' — ' + bilan.motif : ''),
                 num, d.appareil || '');

  return { ok: true, crees: nes, poses: bilan.poses.length,
           refuses: bilan.refuses.length, motif: bilan.motif || '' };
}

/* Un devis refusé puis finalement signé : ses fiches annulées par l'appli
   redeviennent « A PLANIFIER », et la planification les repose. Une fiche que
   le gérant a annulée lui-même ne porte pas la marque et reste annulée. */
function reactiverChantiers_(numero) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) return 0;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var iNum = en.indexOf('NUMERO'), iStatut = en.indexOf('STATUT'), iNote = en.indexOf('NOTE');
  if (iNum < 0 || iStatut < 0 || iNote < 0) return 0;
  var n = 0;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][iNum]).trim() !== String(numero).trim()) continue;
    if (String(v[i][iStatut]).toUpperCase().trim() !== 'ANNULE') continue;
    var note = String(v[i][iNote] || '');
    if (note.indexOf(MARQUE_ANNULATION_) < 0) continue;
    var garde = note.split('\n').filter(function (l) {
      return l.indexOf(MARQUE_ANNULATION_) !== 0;
    }).join('\n');
    sh.getRange(i + 1, iStatut + 1).setValue('A PLANIFIER');
    sh.getRange(i + 1, iNote + 1).setValue(garde);
    n++;
  }
  return n;
}

/* Le filet du soir : un devis passé à REFUSE à la main dans le classeur ne
   déclenche rien sur le moment. L'automate quotidien rattrape. */
function annulerRefuses_() {
  var n = 0;
  lireDevis_().forEach(function (d) {
    if (String(d.STATUT || '').toUpperCase().trim() !== 'REFUSE') return;
    n += annulerChantiers_(String(d.NUMERO).trim(), 'REFUSE', 'SYSTEME', '').length;
  });
  return n;
}

/* Les rendez-vous déjà posés qu'une absence ou un jour férié rend impossibles.
   L'appli ne les déplace pas — ce sont des engagements pris auprès de clients —
   elle les signale. */
function conflitsPlanning_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) return [];
  var cal = calendrier_(lireReglages_());
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var iDate = en.indexOf('DATE'), iQui = en.indexOf('PRESTATAIRE'), iStatut = en.indexOf('STATUT');
  var iId = en.indexOf('ID'), iClient = en.indexOf('CLIENT');
  if (iDate < 0 || iQui < 0) return [];
  var auj = isoJour_(new Date()), out = [];
  for (var i = 1; i < v.length; i++) {
    var d = v[i][iDate];
    if (!(d instanceof Date) || isoJour_(d) < auj) continue;
    var st = iStatut >= 0 ? String(v[i][iStatut]).toUpperCase().trim() : '';
    if (st !== 'PLANIFIE' && st !== 'A PLANIFIER' && st !== '') continue;
    var nom = String(v[i][iQui] || '').trim();
    var pourquoi = ferie_(cal, d);
    if (!pourquoi && estAbsent_(cal, '', isoJour_(d), true)) pourquoi = 'fermeture';
    if (!pourquoi && nom) nomsQui_(nom).forEach(function (n1) {
      if (!pourquoi && estAbsent_(cal, normNom_(n1), isoJour_(d))) pourquoi = n1 + ' absent';
    });
    if (!pourquoi) continue;
    out.push({ id: iId >= 0 ? String(v[i][iId]) : '', date: d, nom: nom,
               client: iClient >= 0 ? String(v[i][iClient]) : '', motif: pourquoi });
  }
  return out;
}

function signalerConflits_(reg) {
  var c = conflitsPlanning_();
  if (!c.length) return 0;
  var dest = String(reg.recap_email || '').trim() || Session.getEffectiveUser().getEmail();
  var corps = c.length + ' intervention(s) posée(s) un jour où elle(s) ne peu(ven)t pas avoir lieu :\n\n' +
    c.map(function (x) {
      return '  · ' + Utilities.formatDate(x.date, 'Europe/Paris', 'dd/MM/yyyy') + ' — ' +
             x.client + (x.nom ? ' — ' + x.nom : '') + ' — ' + x.motif + (x.id ? ' (' + x.id + ')' : '');
    }).join('\n') +
    '\n\nL\'appli ne déplace pas un rendez-vous déjà pris : change la date ou le salarié ' +
    'dans l\'onglet ' + SH.CHANTIERS + '.\n' + SpreadsheetApp.getActive().getUrl();
  try { envoyerMail_({ to: dest, subject: 'Planning — ' + c.length + ' intervention(s) à replacer', body: corps }, reg); }
  catch (e) {}
  return c.length;
}

/* ENTRETIEN (contrat régulier, mensualisé), VITRERIE (vitrages et menuiseries,
   au contrat ou en une fois), FACADE (nettoyage de façade et antimousse),
   CHANTIER (fin de chantier) ou REMISE (remise en état). Les trois dernières
   sont des interventions uniques : elles ne diffèrent que par ce qu'on y fait,
   et par le nom sur le devis. */
function natureDevis_(v) {
  var n = String(v || '').toUpperCase().trim();
  if (n === 'ENTRETIEN') return 'ENTRETIEN';
  if (n === 'VITRERIE' || n === 'VITRAGE' || n === 'VITRAGES') return 'VITRERIE';
  if (n === 'FACADE' || n === 'FAÇADE' || n === 'FACADES' || n === 'FAÇADES') return 'FACADE';
  if (n === 'REMISE' || n === 'REMISE EN ETAT' || n === 'REMISE_EN_ETAT') return 'REMISE';
  return 'CHANTIER';
}

/* La nature telle qu'on la range dans une colonne : vide reste vide. Sans
   cette précaution, « natureDevis_ » rendrait « CHANTIER » pour une cellule
   non renseignée, et tout le planning serait orange. */
function natureOuVide_(v) {
  var n = String(v || '').trim();
  if (!n) return '';
  /* RDV n'est pas une nature de devis : « natureDevis_ » rendrait CHANTIER
     pour elle, et le rendez-vous du commercial passerait pour une fin de
     chantier à faire, en orange sur le planning. Elle se lit donc avant. */
  if (n.toUpperCase() === NATURE_RDV_) return NATURE_RDV_;
  return natureDevis_(n);
}

/* La nature telle que le gérant la choisit à l'écran. Ici on ne devine pas :
   « natureDevis_ » rend CHANTIER pour tout ce qu'elle ne reconnaît pas, ce qui
   est juste pour un devis — la nature y est toujours l'une des cinq — mais
   faux pour une valeur saisie. Une faute de frappe laisserait un chantier en
   orange sans que personne ne l'ait demandé : elle ne laisse rien. */
function natureChoisie_(v) {
  var n = String(v || '').toUpperCase().trim();
  if (!n) return '';
  return ['ENTRETIEN', 'VITRERIE', 'CHANTIER', 'REMISE', 'FACADE', NATURE_RDV_].indexOf(n) >= 0 ? n : '';
}


/** Le nom que le devis et les messages donnent à une nature. */
function natureLisible_(v) {
  var n = natureDevis_(v);
  if (n === 'ENTRETIEN') return 'Entretien des locaux';
  if (n === 'VITRERIE') return 'Vitrages et menuiseries';
  if (n === 'REMISE') return 'Remise en état';
  if (n === 'FACADE') return 'Nettoyage de façade';
  return 'Nettoyage de fin de chantier';
}

/**
 * Le devis se répète-t-il dans le mois ? Un entretien, toujours. Une vitrerie,
 * seulement si le commercial l'a vendue au contrat : les vitrages se vendent
 * aussi bien en une fois, et c'est le nombre de passages qui le dit.
 *
 * C'est cette question, et non la nature seule, qui commande la mensualisation
 * du total, le nombre de chantiers créés et la planification.
 */
/**
 * Cette nature se vend-elle sur un secteur, loin de l'agence ? L'entretien des
 * locaux, la vitrerie et la façade, oui : l'équipe part de Vannes et y revient,
 * et le trajet se paie. Un chantier et une remise en état sont des
 * interventions chiffrées au cas par cas, le déplacement y est déjà dans le
 * prix.
 *
 * La vitrerie compte qu'elle soit vendue au contrat ou en une seule fois : le
 * camion roule autant pour un passage que pour douze. La façade ne se vend
 * qu'en une fois, mais le camion roule quand même.
 */
function majorableKm_(nature) {
  var n = natureDevis_(nature);
  return n === 'ENTRETIEN' || n === 'VITRERIE' || n === 'FACADE';
}

/* D'où vient le client. Tout ce qui n'est pas « appel entrant » est de la
   prospection : un champ vide vient d'un téléphone d'avant la question, et
   c'est bien ce que ses commerciaux faisaient alors. */
function origineDevis_(v) {
  return String(v || '').toUpperCase().trim() === 'ENTRANT' ? 'ENTRANT' : 'PROSPECTION';
}

/* Où le devis a été signé. Vide ou inconnu : chez le client — c'est le cas
   courant, et c'est le côté qui garde le droit de rétractation au client. */
function lieuDevis_(v) {
  return String(v || '').toUpperCase().trim() === 'AGENCE' ? 'AGENCE' : 'CLIENT';
}

function recurrentDevis_(nature, passages, sansContrat) {
  /* v106 — un entretien « sans contrat » n'est jamais un contrat. */
  if (sansContrat === true || /^OUI$/i.test(String(sansContrat || '').trim())) return false;
  var n = natureDevis_(nature);
  if (n === 'ENTRETIEN') return true;
  if (n !== 'VITRERIE') return false;
  return (Number(passages) || 0) > 0;
}

/**
 * Un devis vient d'être signé : on crée les chantiers qui en découlent.
 *
 * Un devis ponctuel donne UNE intervention. Un contrat mensuel en donne autant
 * que le nombre de passages inscrit sur le devis (colonne PASSAGES_MOIS), ou à
 * défaut la valeur du réglage. Les lignes naissent sans date et sans agent :
 * c'est le bureau qui construit le planning.
 *
 * La fonction est idempotente — un même devis ne génère ses chantiers qu'une
 * fois, même si le résultat est renvoyé deux fois par un téléphone entêté.
 */
/** Un devis dont le client est Breizh Brillance elle-même : un essai. */
function devisEssai_(d) {
  var nom = sansAccent_(String(d && d.CLIENT || '')).replace(/[^A-Z0-9]/g, '');
  if (!nom) return false;
  /* v106 — le nom de la société est lu une fois par exécution : le tableau
     appelait cette fonction pour chaque devis, et relisait REGLAGES à chaque
     fois (200 lectures, une quinzaine de secondes par actualisation). */
  if (SOC_ESSAI_ === null) SOC_ESSAI_ = sansAccent_(String(lireReglages_().societe_nom || 'BREIZH BRILLANCE')).replace(/[^A-Z0-9]/g, '');
  return nom === SOC_ESSAI_ || nom === 'BREIZHBRILLANCE';
}
var SOC_ESSAI_ = null;

function genererChantiers_(numero) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.CHANTIERS);
  if (!sh) return 0;
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cId = en.indexOf('ID'), cNum = en.indexOf('NUMERO');
  if (cId < 0 || cNum < 0) return 0;

  // déjà fait ?
  if (sh.getLastRow() > 1) {
    var vus = sh.getRange(2, cNum + 1, sh.getLastRow() - 1, 1).getValues();
    for (var j = 0; j < vus.length; j++) {
      if (String(vus[j][0]).trim() === String(numero).trim()) return 0;
    }
  }

  var devis = null;
  lireDevis_().forEach(function (d) {
    if (String(d.NUMERO).trim() === String(numero).trim()) devis = d;
  });
  if (!devis) return 0;
  /* v95 : un devis au nom de la maison est un essai. Il ne pose rien au
     planning (26 interventions d'essai à 8 h y étaient arrivées ainsi). */
  if (devisEssai_(devis)) return 0;

  var reg = lireReglages_();
  var lignes = lignesParDevis_()[String(numero).trim()] || [];

  /* C'est la nature du devis qui commande. Les devis établis avant qu'elle
     existe n'en portent pas : on retombe alors sur l'ancienne règle, le type
     des lignes, pour qu'un contrat signé hier produise les mêmes chantiers
     qu'aujourd'hui. */
  var nature = String(devis.NATURE || '').toUpperCase().trim();
  var recurrent = recurrentDevis_(nature, devis.PASSAGES_MOIS, devis.SANS_CONTRAT);
  if (!nature) {
    recurrent = lignes.some(function (l) {
      return String(l.TYPE || '').toUpperCase() === 'MENSUEL';
    });
  }

  /* v106 — Simon, 9 novembre : « quand je choisis récurrent pour le devis,
     mets juste dans À faire une fois Mettre au calendrier et je
     confirmerai ». Un contrat signé ne fabrique plus une fiche « à placer »
     par passage du mois (22 pour un 5 fois par semaine) : il ne crée rien
     ici. « À faire » propose de le mettre au calendrier ; la fiche du devis
     pré-remplit le rythme, et la série posée remplit le planning. */
  if (recurrent) return 0;
  var combien = 1;
  if (recurrent) {
    combien = Number(String(devis.PASSAGES_MOIS || '').replace(',', '.')) ||
              Number(String(reg.passages_mois_defaut || '4').replace(',', '.')) || 4;
    if (combien > 31) combien = 31;
  }
  /* v97 — un devis récurrent compte ses passages sur 52 semaines : 4,33 par
     mois pour un passage hebdomadaire. La durée d'un passage se calcule sur
     cette moyenne exacte ; le nombre de fiches à poser, lui, est entier. */
  var moyenneMois = combien;
  combien = Math.max(1, Math.round(combien));

  /* Combien de temps ? Le montant divisé par le taux horaire de vente. Pour un
     contrat, le total du devis est celui du mois : un passage en vaut la part.
     Et un chantier plus long qu'une journée se découpe en journées, parce
     qu'une fiche qui déborde ne tient sur aucun planning. */
  var taux = tauxHorairePlanning_(reg);
  var htTotal = Number(devis.TOTAL_HT) || 0;
  var minutesPassage = minutesPour_(recurrent && moyenneMois > 0 ? htTotal / moyenneMois : htTotal, taux);
  var gens = prestatairesPlanning_();
  var journee = 420;                         // 7 h, à défaut de salarié décrit
  gens.forEach(function (g) { if (g.capaciteJour > journee) journee = g.capaciteJour; });
  /* Le découpage en journées n'a de sens que si l'appli pose elle-même les
     dates. Planification coupée, on laisse une fiche par passage avec sa durée
     entière : c'est le bureau qui décide comment l'étaler. */
  var parts = 1, derniere = minutesPassage;
  if (planificationAuto_(reg)) {
    parts = Math.max(1, Math.ceil(minutesPassage / journee));
    derniere = minutesPassage - (parts - 1) * journee;
    /* Un reste trop court n'ouvre pas une journée de plus : 7 h 15 de travail
       calculé, c'est une journée de 7 h sur le planning, pas une journée et un
       déplacement d'un quart d'heure le lendemain. */
    if (parts > 1 && derniere < reliquatIgnore_(reg)) { parts--; derniere = journee; }
  }
  var lots = [];
  for (var q = 0; q < parts; q++) {
    /* Une seule part avec la planification coupée : elle porte la durée
       entière, même si elle dépasse une journée. */
    lots.push({ minutes: q < parts - 1 ? journee : derniere,
                lot: parts > 1 ? (q + 1) + '/' + parts : '' });
  }

  var suivant = prochainNumChantier_(sh, cId);
  var maintenant = new Date();
  var acces = String(devis.NOTE_COMMERCIAL || '').trim();   // codes, gardien, où sont les clés
  var rows = [], rang = 0;
  for (var k = 0; k < combien; k++) {
    for (var p = 0; p < lots.length; p++) {
      var v = {
        ID: 'CH-' + ('000' + (suivant + rang)).slice(-4),
        NUMERO: devis.NUMERO,
        CLIENT: devis.CLIENT,
        ADRESSE: devis.ADRESSE, CP: devis.CP, VILLE: devis.VILLE,
        ACCES: acces,
        DATE: '', HEURE: '', PRESTATAIRE: '',
        STATUT: 'A PLANIFIER',
        ARRIVEE: '', DEPART: '', MINUTES: '',
        PRESTATIONS_FAITES: '', SIGNALEMENT: '', PHOTOS: 0, NOTE: '',
        CREE_LE: maintenant,
        DUREE_PREVUE_MIN: lots[p].minutes, LOT: lots[p].lot,
        NATURE: natureOuVide_(devis.NATURE)
      };
      rows.push(en.map(function (h) { return v.hasOwnProperty(h) ? v[h] : ''; }));
      rang++;
    }
  }
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, en.length).setValues(rows);
  return rows.length;
}

/* ====================== LES CONTRATS RÉCURRENTS ======================
   Un chantier naît normalement d'un devis signé. Ceux-ci viennent d'ailleurs :
   d'un engagement pris avant l'application, ou d'un client qu'on nettoie
   chaque semaine depuis des années sans qu'un devis l'ait jamais dit ici.
   L'onglet RECURRENTS décrit la série — qui, où, quel jour, à quelle heure, à
   quel rythme — et le classeur en tire les chantiers des semaines qui
   viennent.

   Pourquoi générer plutôt que coller une fois pour toutes : un planning figé
   sur un an est périmé au premier changement d'horaire, et personne ne
   réécrit trois cents lignes à la main. On garde donc la règle, et on pose
   devant soi juste ce qu'il faut pour travailler.

   Ce que la génération ne fait jamais : réécrire un chantier déjà posé. Elle
   n'ajoute que les occurrences absentes, reconnues par la clé RECURRENT
   « R-001|2026-10-16 ». Le gérant peut donc déplacer une date, changer le
   salarié, annuler un passage : rien ne le reprendra. */

var RECURRENTS_SEMAINES_ = 8;
var JOURS_SEMAINE_ = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];

/** Combien de semaines on pose devant soi. */
function semainesRecurrents_(reg) {
  var n = Number(String((reg && reg.recurrents_semaines) || '').replace(',', '.'));
  if (!isFinite(n) || n < 1) n = RECURRENTS_SEMAINES_;
  if (n > 52) n = 52;
  return Math.round(n);
}

/** « jeudi », « JEU », « Jeudi matin » → 4. Rien de reconnu → -1. */
function jourSemaineNum_(t) {
  var n = normNom_(t);
  if (!n) return -1;
  for (var i = 0; i < JOURS_SEMAINE_.length; i++) {
    if (n.indexOf(normNom_(JOURS_SEMAINE_[i]).slice(0, 3)) === 0) return i;
  }
  return -1;
}

/** Le jour, à minuit, débarrassé de l'heure — pour comparer des dates. */
function minuit_(d) {
  var x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}

/** « 2026-12-06, 06/02/2027 » → { '2026-12-06': true, '2027-02-06': true }. */
function datesExclues_(v) {
  var out = {};
  if (v instanceof Date) { out[isoJour_(v)] = true; return out; }
  String(v || '').split(/[,;\s]+/).forEach(function (s) {
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/) || null, d = null;
    if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    var m2 = !m && s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m2) d = new Date(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1]), 12);
    if (d && !isNaN(d.getTime())) out[isoJour_(d)] = true;
  });
  return out;
}

/** Les occurrences d'une série entre deux dates incluses. */
function occurrencesRecurrent_(r, du, au) {
  var freq = String(r.FREQUENCE || '').toUpperCase().trim();
  var debut = r.DEBUT ? minuit_(r.DEBUT) : null;
  var fin = r.FIN ? minuit_(r.FIN) : null;
  if (debut && isNaN(debut.getTime())) debut = null;
  if (fin && isNaN(fin.getTime())) fin = null;

  var d0 = minuit_(du), d1 = minuit_(au);
  if (debut && debut > d0) d0 = debut;
  if (fin && fin < d1) d1 = fin;
  if (d0 > d1) return [];

  var jour = jourSemaineNum_(r.JOUR);
  var jourMois = Math.round(Number(r.JOUR_MOIS) || 0);
  var exclues = datesExclues_(r.EXCLUSIONS);
  var pas = Math.round(Number(r.INTERVALLE) || 1);
  if (pas < 1 || pas > 12) pas = 1;
  /* Le mois de référence d'un « un mois sur deux » : celui du début. */
  var moisRef = debut ? debut.getFullYear() * 12 + debut.getMonth() : null;

  /* La quinzaine se compte depuis le DÉBUT de la série, pas depuis
     aujourd'hui : sans ancrage, la semaine paire changerait de sens à chaque
     génération et le client serait nettoyé deux fois, puis pas du tout. */
  var ancre = null;
  if (freq === 'QUINZAINE') {
    if (!debut || jour < 0) return [];
    ancre = new Date(debut);
    while (ancre.getDay() !== jour) ancre.setDate(ancre.getDate() + 1);
  }

  var out = [];
  for (var d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    var ok = false;
    if (freq === 'HEBDO') {
      ok = (jour >= 0 && d.getDay() === jour);
    } else if (freq === 'QUINZAINE') {
      ok = (d.getDay() === jour && d >= ancre &&
            Math.round((minuit_(d) - ancre) / 86400000 / 7) % 2 === 0);
    } else if (freq === 'MENSUEL') {
      var bonMois = pas === 1 || moisRef === null ||
        ((d.getFullYear() * 12 + d.getMonth() - moisRef) % pas === 0);
      var dernier = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      if (!bonMois) {
        ok = false;
      } else if (jour >= 0 && jourMois >= 1 && jourMois <= 5) {
        /* Le 3e jeudi : le bon jour de la semaine, dans la bonne semaine du
           mois. Le 5e veut dire le dernier, qu'il y en ait quatre ou cinq. */
        if (d.getDay() === jour) {
          var rang = Math.floor((d.getDate() - 1) / 7) + 1;
          ok = jourMois === 5 ? (d.getDate() + 7 > dernier) : rang === jourMois;
        }
      } else if (jourMois >= 1 && jourMois <= 31) {
        /* Le 31 d'un mois de trente jours tombe le 30 : un contrat « le 31 »
           ne saute pas février. */
        ok = (d.getDate() === Math.min(jourMois, dernier));
      }
    }
    if (ok && exclues[isoJour_(d)]) ok = false;
    if (ok) out.push(new Date(d));
  }
  return out;
}

/**
 * Pose les chantiers des contrats récurrents sur les semaines qui viennent.
 * Idempotente : deux passages de suite ne créent rien la seconde fois.
 * Renvoie { poses, annules, series }.
 */
function genererRecurrents_() {
  var bilan = { poses: 0, annules: 0, series: 0, motif: '' };
  try { bilan.reconduits = reconduireContrats_(); } catch (eRc) { bilan.reconduits = 0; }
  var ss = SpreadsheetApp.getActive();
  var shR = ss.getSheetByName(SH.RECURRENTS);
  var sh = ss.getSheetByName(SH.CHANTIERS);
  if (!shR || !sh) { bilan.motif = 'onglet absent'; return bilan; }

  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cId = en.indexOf('ID'), cRec = en.indexOf('RECURRENT');
  var cDate = en.indexOf('DATE'), cStatut = en.indexOf('STATUT'), cArr = en.indexOf('ARRIVEE');
  var cQui = en.indexOf('PRESTATAIRE');
  if (cId < 0 || cRec < 0 || cDate < 0 || cStatut < 0) {
    bilan.motif = 'colonnes absentes — lancer « Mettre à jour la structure »';
    return bilan;
  }

  var reg = lireReglages_();
  var aujourd = minuit_(new Date());
  var horizon = new Date(aujourd);
  horizon.setDate(horizon.getDate() + semainesRecurrents_(reg) * 7);

  var v = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() : [];
  var deja = {};
  v.forEach(function (r, i) {
    var k = String(r[cRec] || '').trim();
    if (k) deja[k] = { rang: i + 2, ligne: r };
  });

  var series = objetsDe_(SH.RECURRENTS).filter(function (r) {
    return String(r.ID || '').trim() && estActif_(r.ACTIF);
  });
  bilan.series = series.length;

  var suivant = prochainNumChantier_(sh, cId);
  var maintenant = new Date();
  var rows = [], rang = 0;
  /* v101 — « enlève les jours fériés des potentielles interventions et
     mets-les à poser au calendrier ». Un passage qui tombe un férié n'est
     pas posé ce jour-là : il part sans date dans « À placer », avec sa clé
     (la date d'origine), pour que le gérant le replace et que la nuit ne le
     repose pas. */
  var cal = calendrier_(reg);
  bilan.feries = 0;
  var regleQ = regleEquipe_(reg);

  /* v108l — « planifie les interventions suivant le contrat, ne t'arrête pas
     à janvier : adapte-toi à la vraie durée du contrat ». Un contrat qui a une
     date de FIN est posé jusqu'à elle (trois ans au plus) ; sans FIN, on garde
     l'horizon des réglages. La reconduction tacite repousse la FIN, et la
     génération suivante pose l'année d'après. */
  var plafond = new Date(aujourd); plafond.setFullYear(plafond.getFullYear() + 3);
  function horizonDe_(r) {
    var f = r.FIN ? minuit_(r.FIN) : null;
    if (!f || isNaN(f.getTime())) return horizon;
    if (f > plafond) f = plafond;
    return f > horizon ? f : horizon;
  }
  series.forEach(function (r) {
    var id = String(r.ID).trim();
    occurrencesRecurrent_(r, aujourd, horizonDe_(r)).forEach(function (d) {
      var cle = id + '|' + isoJour_(d);
      if (deja[cle]) return;
      var fer = ferie_(cal, d);
      if (fer) bilan.feries++;
      /* v104 — les congés. L'équipe du jour, moins qui est en congé : un
         binôme dont l'un est absent part avec l'autre seul ; si personne ne
         reste, ou si la maison est fermée, le passage va dans « À placer »,
         comme un férié. */
      var isoD = isoJour_(d);
      var equipe = (regleQ && equipeRemplacable_(regleQ, r.PRESTATAIRE) && equipeDuJour_(regleQ, d))
        ? equipeDuJour_(regleQ, d) : String(r.PRESTATAIRE || '');
      var ferme = estAbsent_(cal, '', isoD, true);
      var presents = nomsQui_(equipe).filter(function (n) { return !estAbsent_(cal, normNom_(n), isoD); });
      var tousAbsents = nomsQui_(equipe).length > 0 && !presents.length;
      if (ferme || tousAbsents) bilan.absences = (bilan.absences || 0) + 1;
      /* v105 — Simon, 9 novembre : « pour les jours fériés, laisse les
         prestations d'origine sur le planning, je m'occupe de les bouger moi-
         même en appelant les clients ». Un férié ne retire plus rien : le
         passage est posé à sa date, le planning affiche « Férié », et « À
         faire » rappelle d'appeler le client. Seuls un congé ou une fermeture
         envoient encore dans « À placer ». */
      var aPlacer = ferme || tousAbsents;
      var v2 = {
        ID: 'CH-' + ('000' + (suivant + rang)).slice(-4),
        NUMERO: '',
        CLIENT: String(r.CLIENT || ''),
        ADRESSE: String(r.ADRESSE || ''), CP: String(r.CP || ''), VILLE: String(r.VILLE || ''),
        ACCES: String(r.ACCES || ''),
        DATE: aPlacer ? '' : d, HEURE: heureTexte_(r.HEURE),
        PRESTATAIRE: aPlacer ? equipe : presents.join(', '),
        /* Date et salarié posés : le chantier est planifié, il part sur le
           téléphone. Sans salarié, il reste à planifier et remonte en tête de
           l'écran du gérant. Un férié : à placer. */
        STATUT: (!aPlacer && presents.length) ? 'PLANIFIE' : 'A PLANIFIER',
        ARRIVEE: '', DEPART: '', MINUTES: '',
        PRESTATIONS_FAITES: '', SIGNALEMENT: '', PHOTOS: 0,
        /* Sans devis derrière, la fiche de travail du salarié serait vide :
           ce que dit la série est tout ce qu'il aura. */
        NOTE: String(r.PRESTATIONS || r.NOTE || ''),
        CREE_LE: maintenant,
        DUREE_PREVUE_MIN: Math.round(Number(r.DUREE_MIN) || 0) || '',
        LOT: '', RECURRENT: cle, NATURE: natureOuVide_(r.NATURE),
        FICHE: String(r.FICHE || ''), FICHE_NOM: String(r.FICHE_NOM || '')
      };
      rows.push(en.map(function (h) { return v2.hasOwnProperty(h) ? v2[h] : ''; }));
      rang++;
    });
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, en.length).setValues(rows);
    bilan.poses = rows.length;
  }

  /* Ménage : une série arrêtée ne doit pas laisser des passages derrière elle.
     On n'annule que ce qui est à venir et que personne n'a commencé — et
     seulement parce que la série s'est arrêtée, jamais parce que la date ne
     tombe plus juste : le gérant a le droit de déplacer un passage. */
  var vivantes = {};
  objetsDe_(SH.RECURRENTS).forEach(function (r) {
    var id = String(r.ID || '').trim();
    if (!id) return;
    var fin = r.FIN ? minuit_(r.FIN) : null;
    if (fin && isNaN(fin.getTime())) fin = null;
    vivantes[id] = {
      actif: estActif_(r.ACTIF),
      fin: fin
    };
  });
  bilan.ferieRetires = 0;
  for (var k in deja) {
    if (!deja.hasOwnProperty(k)) continue;
    var id2 = k.split('|')[0];
    var etat = vivantes[id2];
    var l = deja[k].ligne;
    var dl = l[cDate] ? minuit_(l[cDate]) : null;
    if (!l[cDate]) {
      /* Un passage sans date (un férié à replacer) d'une série arrêtée depuis
         ne doit pas traîner dans « À placer ». */
      var dk = dateIso_(k.split('|')[1]);
      var mort = !etat || !etat.actif || (etat.fin && dk && minuit_(dk) > etat.fin);
      /* v105 — les fériés mis de côté par les v101 à v104 reviennent à leur
         date d'origine (Simon appelle lui-même les clients). Un passage que
         l'équipe ne peut pas faire (congé, fermeture) reste dans « À placer ». */
      if (!mort && dk && minuit_(dk) >= aujourd && nomFerieIso_(k.split('|')[1]) &&
          String(l[cStatut] || '').toUpperCase().trim() === 'A PLANIFIER' &&
          !(cArr >= 0 && String(l[cArr] || '').trim())) {
        var quiF = cQui >= 0 ? String(l[cQui] || '') : '';
        var isoK = k.split('|')[1];
        var bloque = estAbsent_(cal, '', isoK, true) ||
          (nomsQui_(quiF).length && nomsQui_(quiF).every(function (n) { return estAbsent_(cal, normNom_(n), isoK); }));
        if (!bloque) {
          sh.getRange(deja[k].rang, cDate + 1).setValue(dk);
          if (quiF.trim()) sh.getRange(deja[k].rang, cStatut + 1).setValue('PLANIFIE');
          bilan.feriesRemis = (bilan.feriesRemis || 0) + 1;
          continue;
        }
      }
      if (mort && dk && minuit_(dk) >= aujourd &&
          String(l[cStatut] || '').toUpperCase().trim() !== 'ANNULE' &&
          !(cArr >= 0 && String(l[cArr] || '').trim())) {
        sh.getRange(deja[k].rang, cStatut + 1).setValue('ANNULE');
        bilan.annules++;
      }
      continue;
    }
    if (!dl || isNaN(dl.getTime()) || dl < aujourd) continue;
    if (String(l[cStatut] || '').toUpperCase().trim() === 'ANNULE') continue;
    if (cArr >= 0 && String(l[cArr] || '').trim()) continue;     // déjà pointé
    var morte = !etat || !etat.actif || (etat.fin && dl > etat.fin);
    if (!morte) continue;      // v105 : un férié posé reste à sa date
    sh.getRange(deja[k].rang, cStatut + 1).setValue('ANNULE');
    bilan.annules++;
  }

  if (bilan.poses || bilan.annules || bilan.feriesRemis) {
    tracerServeur_('SYSTEME', 'PLANNING RECURRENT',
      bilan.poses + ' posé(s) dont ' + bilan.feries + ' un jour férié, ' +
      bilan.annules + ' annulé(s), ' + (bilan.feriesRemis || 0) + ' férié(s) remis à leur date, ' +
      bilan.series + ' série(s)', '', '');
  }
  return bilan;
}

/** Depuis le menu : pose le planning récurrent et dit ce qui a bougé. */
function genererRecurrents() {
  majStructure_();
  var b = genererRecurrents_();
  SpreadsheetApp.getUi().alert(
    b.motif ? 'Rien fait : ' + b.motif :
    b.series + ' contrat(s) récurrent(s) lus.\n\n' +
    b.poses + ' chantier(s) ajouté(s) dans l\'onglet ' + SH.CHANTIERS + '.\n' +
    b.annules + ' passage(s) à venir annulé(s), série arrêtée.\n\n' +
    'Les chantiers déjà posés ne sont jamais réécrits : une date déplacée ou ' +
    'un salarié changé à la main le restent.');
}


/* ================== UN DEVIS RÉCURRENT SIGNÉ DEVIENT UN CONTRAT ==================
   Demande de Simon, 7 novembre 2026 : « à partir des devis signés, ajoute-les
   automatiquement au classeur ». Jusque-là, un contrat d'entretien signé ne
   posait que les passages de son premier mois (répartis sur 28 jours) : le
   mois suivant, plus rien, sauf à écrire la série à la main dans RECURRENTS.

   Le contrat se lit sur ce que la planification vient de poser : les jours de
   la semaine, l'heure et le salarié des premiers passages. Le rythme vient du
   nombre de passages par mois du devis — 1 : tous les mois ; 2 : toutes les
   deux semaines ; 4 : toutes les semaines ; 8 : deux jours par semaine, etc.

   Les passages du premier mois, déjà posés, deviennent les premiers passages
   du contrat (ils reçoivent sa clé) : la génération ne les double pas. Une
   date que la série aurait posée dans ce premier mois sans qu'un passage y
   soit est notée en EXCLUSIONS, pour la même raison. */

/** Le nombre de passages par mois → le rythme et le nombre de jours par semaine. */
function rythmeDesPassages_(n) {
  n = Math.round(Number(n) || 0);
  if (n <= 1) return { frequence: 'MENSUEL', jours: 1 };
  if (n <= 3) return { frequence: 'QUINZAINE', jours: Math.max(1, Math.round(n / 2.17)) };
  return { frequence: 'HEBDO', jours: Math.max(1, Math.min(7, Math.round(n / 4.33))) };
}

function contratDepuisDevis_(numero, qui) {
  var num = String(numero || '').trim();
  if (!num) return null;
  var ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(SH.RECURRENTS)) majStructure_();
  var shR = ss.getSheetByName(SH.RECURRENTS);
  var enR = shR.getRange(1, 1, 1, shR.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  if (enR.indexOf('DEVIS') < 0) { majStructure_(); }

  /* Déjà fait : un devis ne fait qu'un contrat, même signé deux fois. */
  var deja = objetsDe_(SH.RECURRENTS).some(function (r) {
    return String(r.DEVIS || '').trim() === num;
  });
  if (deja) return null;

  var devis = null;
  lireDevis_().forEach(function (d) {
    var n = String(d.NUMERO || '').trim(), o = String(d.NUMERO_ORIGINE || '').trim();
    if (n === num || o === num) devis = d;
  });
  if (!devis) return null;
  if (!recurrentDevis_(devis.NATURE, devis.PASSAGES_MOIS, devis.SANS_CONTRAT)) return null;

  /* Les passages posés du premier mois, dans l'ordre. */
  var shC = ss.getSheetByName(SH.CHANTIERS);
  var enC = shC.getRange(1, 1, 1, shC.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cNum = enC.indexOf('NUMERO'), cDate = enC.indexOf('DATE'), cRec = enC.indexOf('RECURRENT');
  var cSt = enC.indexOf('STATUT'), cLot = enC.indexOf('LOT');
  if (cRec < 0) { majStructure_(); return null; }
  var v = shC.getLastRow() > 1 ? shC.getRange(2, 1, shC.getLastRow() - 1, shC.getLastColumn()).getValues() : [];
  var numeros = [num, String(devis.NUMERO || '').trim(), String(devis.NUMERO_ORIGINE || '').trim()];
  var passages = [];
  v.forEach(function (l, i) {
    if (numeros.indexOf(String(l[cNum] || '').trim()) < 0) return;
    if (String(l[cRec] || '').trim()) return;
    if (cSt >= 0 && String(l[cSt] || '').toUpperCase().trim() === 'ANNULE') return;
    if (cLot >= 0 && /^[2-9]/.test(String(l[cLot] || ''))) return;     // la suite d'une journée découpée
    var d = l[cDate] ? new Date(l[cDate]) : null;
    if (!d || isNaN(d.getTime())) return;
    var o = {};
    enC.forEach(function (h, c) { o[h] = l[c]; });
    o._rang = i + 2; o._date = minuit_(d);
    passages.push(o);
  });
  if (!passages.length) return null;     // v106 : Simon le met au calendrier depuis « À faire »
  passages.sort(function (a, b) { return a._date - b._date; });

  var r = rythmeDesPassages_(devis.PASSAGES_MOIS);
  var jours = [], modeles = {};
  passages.forEach(function (p) {
    var j = p._date.getDay();
    if (jours.indexOf(j) < 0 && jours.length < r.jours) { jours.push(j); modeles[j] = p; }
  });
  if (r.frequence === 'MENSUEL') jours = [-1];

  var premier = passages[0]._date, dernier = passages[passages.length - 1]._date;
  var mensuel = Number(devis.TOTAL_HT_MENSUEL) || Number(devis.TOTAL_HT) || 0;
  var base = {
    CLIENT: String(devis.CLIENT || ''), ADRESSE: String(devis.ADRESSE || ''),
    CP: String(devis.CP || ''), VILLE: String(devis.VILLE || ''),
    ACCES: String(devis.NOTE_COMMERCIAL || '').trim(),
    FREQUENCE: r.frequence, JOUR_MOIS: r.frequence === 'MENSUEL' ? premier.getDate() : '',
    DEBUT: new Date(premier.getFullYear(), premier.getMonth(), premier.getDate(), 12),
    FIN: finEngagement_(devis), ACTIF: 'OUI', NATURE: natureOuVide_(devis.NATURE),
    ENGAGEMENT_MOIS: Math.round(Number(devis.ENGAGEMENT_MOIS) || 0) || '',
    RECONDUCTION: String(devis.RECONDUCTION || '').toUpperCase().trim(),
    PRESTATIONS: natureLisible_(devis.NATURE),
    NOTE: 'Devis ' + num + (mensuel ? ' — ' + String(mensuel.toFixed(2)).replace('.', ',') + ' € HT par mois' : ''),
    DEVIS: num
  };

  var ids = [];
  (jours.length ? jours : [-1]).forEach(function (j) {
    var m = j >= 0 ? modeles[j] : passages[0];
    var s = {};
    for (var k in base) if (base.hasOwnProperty(k)) s[k] = base[k];
    s.HEURE = heureTexte_(m.HEURE);
    s.DUREE_MIN = Math.round(Number(m.DUREE_PREVUE_MIN) || 0) || '';
    s.PRESTATAIRE = String(m.PRESTATAIRE || '');

    /* Le premier mois : chaque date de la série rencontre un passage déjà posé
       (il reçoit la clé) ou devient une exclusion. */
    var fin1 = new Date(dernier);
    var occ = occurrencesRecurrent_({ FREQUENCE: s.FREQUENCE, JOUR: j >= 0 ? JOURS_SEMAINE_[j] : '',
                                      JOUR_MOIS: s.JOUR_MOIS, DEBUT: s.DEBUT }, premier, fin1);
    var exclues = [], aCle = [];
    occ.forEach(function (d) {
      var p = passages.filter(function (x) { return !x._pris && x._date.getTime() === minuit_(d).getTime(); })[0];
      if (p) { p._pris = true; aCle.push({ rang: p._rang, iso: isoJour_(d) }); }
      else exclues.push(isoJour_(d));
    });
    s.EXCLUSIONS = exclues.join(', ');
    s.JOUR = j >= 0 ? JOURS_SEMAINE_[j] : '';
    var id = ecrireSeries_(s, [j])[0];
    ids.push(id);
    aCle.forEach(function (a) { shC.getRange(a.rang, cRec + 1).setValue(id + '|' + a.iso); });
  });

  genererRecurrents_();
  tracerServeur_(qui || 'SYSTEME', 'CONTRAT CREE',
                 base.CLIENT + ' · ' + ids.join(', ') + ' · ' + r.frequence + ' (depuis le devis)', num, '');
  return ids;
}

/* ================ CRÉER ET CONDUIRE UN CONTRAT DEPUIS L'APPLI ================
   Demande de Simon, 7 novembre 2026 : « j'aimerais qu'on puisse créer un
   chantier récurrent directement sur l'application (en tant qu'admin) —
   prends exemple sur FamilyWall ». Jusque-là, un contrat s'écrivait à la main
   dans l'onglet RECURRENTS, et rien ne l'arrêtait ni ne le modifiait ailleurs.

   Trois gestes, ceux d'un agenda :
   — créer : une ligne par jour de la semaine choisi (« le lundi et le
     jeudi » fait deux séries, puisqu'une série n'a qu'un JOUR), puis le
     planning des semaines qui viennent est posé tout de suite, sans attendre
     la nuit ;
   — modifier « tous les suivants » : la série est close la veille, et une
     série neuve reprend à partir de la date choisie. Le passé garde ce qu'il
     était — c'est là qu'on a pointé et facturé ;
   — arrêter : la série est close la veille de la date choisie.

   Ce qui a été posé d'avance et que personne n'a commencé est RETIRÉ, pas
   annulé : ces passages n'ont jamais eu lieu, ils n'ont rien à faire sous la
   pastille « annulés ». Et une fois la série close, la génération de la nuit
   ne peut plus les reposer. Un passage déjà pointé n'est jamais touché. */

var FREQUENCES_ = ['HEBDO', 'QUINZAINE', 'MENSUEL'];

/** Ce que le gérant voit de ses contrats. */
function recurrentsPourAdmin_() {
  return objetsDe_(SH.RECURRENTS).filter(function (r) {
    return String(r.ID || '').trim();
  }).map(function (r) {
    var deb = r.DEBUT ? new Date(r.DEBUT) : null;
    var fin = r.FIN ? new Date(r.FIN) : null;
    return {
      id: String(r.ID).trim(), client: String(r.CLIENT || ''),
      adresse: String(r.ADRESSE || ''), cp: String(r.CP || ''), ville: String(r.VILLE || ''),
      acces: String(r.ACCES || ''),
      frequence: String(r.FREQUENCE || '').toUpperCase().trim(),
      jour: (function () { var j = jourSemaineNum_(r.JOUR); return j < 0 ? '' : JOURS_SEMAINE_[j]; })(),
      jourMois: Math.round(Number(r.JOUR_MOIS) || 0) || '',
      intervalle: Math.round(Number(r.INTERVALLE) || 0) || '',
      exclusions: Object.keys(datesExclues_(r.EXCLUSIONS)).sort(),
      note: String(r.NOTE || ''),
      heure: heureTexte_(r.HEURE),
      duree: Math.round(Number(r.DUREE_MIN) || 0) || '',
      prestataire: String(r.PRESTATAIRE || ''),
      debut: deb && !isNaN(deb.getTime()) ? isoJour_(deb) : '',
      fin: fin && !isNaN(fin.getTime()) ? isoJour_(fin) : '',
      actif: estActif_(r.ACTIF),
      nature: natureOuVide_(r.NATURE),
      prestations: String(r.PRESTATIONS || r.NOTE || ''),
      devis: String(r.DEVIS || '').trim(),
      engagement: Math.round(Number(r.ENGAGEMENT_MOIS) || 0) || 0,
      reconduction: String(r.RECONDUCTION || '').toUpperCase().trim(),
      fiche: String(r.FICHE || '').trim() ? (String(r.FICHE_NOM || '').trim() || 'Fiche chantier') : ''
    };
  });
}

/** « 2026-11-12 » → la date à midi ; rien ou illisible → null. */
function dateIso_(t) {
  var s = String(t || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var d = new Date(s + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

/** « 8:00 », « 08h00 », « 8 h » → « 08:00 » ; vide → '' ; illisible → null. */
function heureNette_(t) {
  var s = String(t == null ? '' : t).trim();
  if (!s) return '';
  var m = s.match(/^(\d{1,2})\s*[:hH]\s*(\d{0,2})$/);
  if (!m) return null;
  var h = Number(m[1]), mn = Number(m[2] || 0);
  if (h > 23 || mn > 59) return null;
  return ('0' + h).slice(-2) + ':' + ('0' + mn).slice(-2);
}

/**
 * Relit et vérifie ce que la fiche envoie. Rend { ok, s } ou { ok:false, erreur }.
 * s porte des valeurs prêtes à écrire, et jours la liste des jours (0 à 6).
 */
function lireFicheRecurrent_(d) {
  var client = String(d.client || '').trim();
  if (!client) return { ok: false, erreur: 'il faut un nom de client' };

  var freq = String(d.frequence || '').toUpperCase().trim();
  if (FREQUENCES_.indexOf(freq) < 0) return { ok: false, erreur: 'rythme inconnu' };

  var debut = dateIso_(d.debut);
  if (!debut) return { ok: false, erreur: 'il faut la date du premier passage' };
  var fin = String(d.fin || '').trim() ? dateIso_(d.fin) : null;
  if (String(d.fin || '').trim() && !fin) return { ok: false, erreur: 'date de fin illisible' };
  if (fin && minuit_(fin) < minuit_(debut)) {
    return { ok: false, erreur: 'la fin tombe avant le premier passage' };
  }

  var jours = [], jourMois = '', intervalle = '';
  if (freq === 'MENSUEL') {
    var pas = Math.round(Number(d.intervalle) || 1);
    if (pas < 1 || pas > 12) return { ok: false, erreur: 'intervalle de mois illisible' };
    intervalle = pas > 1 ? pas : '';
    if (String(d.mensuel || '').toUpperCase() === 'RANG') {
      /* « Le 3e jeudi » : le jour et le rang se lisent sur la date du premier
         passage. Un jeudi qui tombe dans les sept derniers jours du mois et
         au-delà du 4e devient « le dernier ». */
      var q = debut.getDate();
      var rang = Math.floor((q - 1) / 7) + 1;
      jours = [debut.getDay()];
      jourMois = rang > 4 ? 5 : rang;
    } else {
      jourMois = Math.round(Number(d.jourMois) || debut.getDate());
      if (jourMois < 1 || jourMois > 31) return { ok: false, erreur: 'jour du mois illisible' };
      jours = [-1];
    }
  } else {
    var brut = Array.isArray(d.jours) ? d.jours : (d.jours ? [d.jours] : [debut.getDay()]);
    brut.forEach(function (j) {
      var n = typeof j === 'number' ? j : jourSemaineNum_(j);
      if (n >= 0 && n <= 6 && jours.indexOf(n) < 0) jours.push(n);
    });
    if (!jours.length) return { ok: false, erreur: 'choisis au moins un jour de la semaine' };
    jours.sort();
  }

  var heure = heureNette_(d.heure);
  if (heure === null) return { ok: false, erreur: 'heure illisible' };
  var duree = Math.round(Number(d.duree) || 0);
  if (duree < 0 || duree > 24 * 60) return { ok: false, erreur: 'durée illisible' };

  var qui = String(d.prestataire || '').trim();
  if (qui) {
    var qc = quiConnus_(qui);
    if (!qc.ok) return { ok: false, erreur: qc.erreur };
    qui = qc.valeur;
  }

  return { ok: true, jours: jours, s: {
    CLIENT: client,
    ADRESSE: String(d.adresse || '').trim(), CP: String(d.cp || '').trim(),
    VILLE: String(d.ville || '').trim(), ACCES: String(d.acces || '').trim(),
    FREQUENCE: freq, JOUR_MOIS: jourMois, INTERVALLE: intervalle, HEURE: heure,
    DUREE_MIN: duree > 0 ? duree : '',
    PRESTATAIRE: qui, DEBUT: debut, FIN: fin || '', ACTIF: 'OUI',
    NATURE: natureChoisie_(d.nature) === NATURE_RDV_ ? '' : natureChoisie_(d.nature),
    PRESTATIONS: String(d.prestations || d.note || '').trim()
  } };
}

/** Le prochain numéro de série : R-008 après R-007, même si une ligne manque. */
function prochainNumRecurrent_() {
  var max = 0;
  objetsDe_(SH.RECURRENTS).forEach(function (r) {
    var m = String(r.ID || '').match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max + 1;
}

/** Une série qui dit déjà la même chose — même client, rythme, jour, heure. */
function serieJumelle_(s, jour, sauf) {
  var t = null;
  objetsDe_(SH.RECURRENTS).forEach(function (r) {
    if (t || !String(r.ID || '').trim() || String(r.ID).trim() === sauf) return;
    if (!estActif_(r.ACTIF)) return;
    var fin = r.FIN ? minuit_(r.FIN) : null;
    if (fin && !isNaN(fin.getTime()) && fin < minuit_(new Date())) return;
    if (normNom_(r.CLIENT) !== normNom_(s.CLIENT)) return;
    if (String(r.FREQUENCE || '').toUpperCase().trim() !== s.FREQUENCE) return;
    if (s.FREQUENCE === 'MENSUEL') {
      if (Math.round(Number(r.JOUR_MOIS) || 0) !== Number(s.JOUR_MOIS)) return;
      if (jourSemaineNum_(r.JOUR) !== jour) return;
      if ((Math.round(Number(r.INTERVALLE) || 1)) !== (Number(s.INTERVALLE) || 1)) return;
    } else if (jourSemaineNum_(r.JOUR) !== jour) return;
    if (heureNette_(heureTexte_(r.HEURE)) !== s.HEURE) return;
    t = String(r.ID).trim();
  });
  return t;
}

/** Écrit les séries d'une fiche, une par jour. Rend la liste des ID posés. */
function ecrireSeries_(s, jours) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.RECURRENTS);
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var num = prochainNumRecurrent_(), ids = [];
  jours.forEach(function (j, i) {
    var v = {};
    for (var k in s) if (s.hasOwnProperty(k)) v[k] = s[k];
    v.ID = 'R-' + ('00' + (num + i)).slice(-3);
    v.JOUR = j >= 0 ? JOURS_SEMAINE_[j] : '';
    sh.appendRow(en.map(function (h) { return v.hasOwnProperty(h) ? v[h] : ''; }));
    ids.push(v.ID);
  });
  return ids;
}

/**
 * Retire de CHANTIERS les passages d'une série, à partir d'une date, que
 * personne n'a commencés. Un passage se reconnaît à sa clé RECURRENT ; on
 * regarde la date de la clé ET la date posée, pour qu'un passage déplacé à la
 * main d'un côté ou de l'autre de la date soit traité comme il le mérite.
 */
function retirerPassages_(id, aPartir) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) return 0;
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cRec = en.indexOf('RECURRENT'), cDate = en.indexOf('DATE');
  var cArr = en.indexOf('ARRIVEE'), cSt = en.indexOf('STATUT');
  if (cRec < 0) return 0;
  var seuil = minuit_(aPartir);
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var rangs = [];
  v.forEach(function (l, i) {
    var cle = String(l[cRec] || '').trim();
    if (cle.split('|')[0] !== id) return;
    if (cArr >= 0 && String(l[cArr] || '').trim()) return;          // pointé
    var st = cSt >= 0 ? String(l[cSt] || '').toUpperCase().trim() : '';
    if (st === 'FAIT' || st === 'EN COURS') return;
    var dCle = dateIso_(cle.split('|')[1]);
    var dPose = l[cDate] ? minuit_(l[cDate]) : null;
    var apres = (dCle && minuit_(dCle) >= seuil) ||
                (dPose && !isNaN(dPose.getTime()) && dPose >= seuil);
    if (apres) rangs.push(i + 2);
  });
  for (var k = rangs.length - 1; k >= 0; k--) sh.deleteRow(rangs[k]);
  return rangs.length;
}

/** Les jours où une série garde un passage commencé, à partir d'une date. */
function passagesGardes_(id, aPartir) {
  var out = {}, seuil = minuit_(aPartir);
  objetsDe_(SH.CHANTIERS).forEach(function (o) {
    var cle = String(o.RECURRENT || '').trim();
    if (cle.split('|')[0] !== id) return;
    if (String(o.STATUT || '').toUpperCase().trim() === 'ANNULE') return;
    var d = o.DATE ? minuit_(o.DATE) : dateIso_(cle.split('|')[1]);
    if (d && !isNaN(d.getTime()) && minuit_(d) >= seuil) out[isoJour_(d)] = true;
  });
  return out;
}

/** La ligne d'une série dans RECURRENTS : { rang, en, ligne } ou null. */
function ligneSerie_(id) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.RECURRENTS);
  if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var cId = en.indexOf('ID');
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][cId] || '').trim() === id) {
      var o = {};
      en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
      return { sh: sh, rang: i + 1, en: en, o: o };
    }
  }
  return null;
}

function ecrireCase_(L, col, valeur) {
  var c = L.en.indexOf(col);
  if (c >= 0) L.sh.getRange(L.rang, c + 1).setValue(valeur);
}

/** Le premier passage de la série tombant le jour donné ou après. */
function prochainPassage_(o, depuis) {
  var au = new Date(depuis); au.setDate(au.getDate() + 62);
  var l = occurrencesRecurrent_(o, depuis, au);
  return l.length ? l[0] : null;
}

/** Créer un contrat depuis l'appli. */
function recurrentNeuf_(d, com) {
  var f = lireFicheRecurrent_(d);
  if (!f.ok) return f;
  if (!SpreadsheetApp.getActive().getSheetByName(SH.RECURRENTS)) majStructure_();

  /* Pas de doublon : la même chose déjà écrite, même client, même rythme, même
     jour et même heure, est refusée en nommant la série qui la porte. */
  for (var i = 0; i < f.jours.length; i++) {
    var jum = serieJumelle_(f.s, f.jours[i], '');
    if (jum) return { ok: false, erreur: 'ce contrat existe déjà (' + jum + ')', existe: jum };
  }

  /* v93 — le contrat d'un devis signé, mis au calendrier depuis sa fiche. Un
     devis ne fait qu'un contrat ; la série porte son numéro et son mensuel. */
  var numDevis = String(d.devis || '').trim(), devisLu = null;
  if (numDevis) {
    var shR0 = SpreadsheetApp.getActive().getSheetByName(SH.RECURRENTS);
    var en0 = shR0.getRange(1, 1, 1, shR0.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    if (en0.indexOf('DEVIS') < 0) majStructure_();
    var dejaR = objetsDe_(SH.RECURRENTS).filter(function (r) {
      return String(r.DEVIS || '').trim() === numDevis;
    })[0];
    /* v108q — un contrat peut avoir plusieurs créneaux (lundi + jeudi) : le
       second se pose sur le même devis quand le gérant l'a confirmé. */
    if (dejaR && !d.ajoutContrat) return { ok: false, erreur: 'ce devis a déjà son contrat (' + String(dejaR.ID).trim() + ')',
                        existe: String(dejaR.ID).trim() };
    devisLu = devisParNumero_(numDevis);
    if (!devisLu) return { ok: false, erreur: 'devis introuvable' };
    numDevis = String(devisLu.NUMERO).trim();
    var mens = Number(devisLu.TOTAL_HT_MENSUEL) || Number(devisLu.TOTAL_HT) || 0;
    f.s.DEVIS = numDevis;
    f.s.NOTE = 'Devis ' + numDevis +
      (mens ? ' — ' + String(mens.toFixed(2)).replace('.', ',') + ' € HT par mois' : '');
    /* v106 — « quand c'est récurrent, c'est automatiquement un contrat » :
       l'engagement du devis, ou un an par défaut, reconduit tacitement sauf
       si le devis dit le contraire. La série court donc sur l'année (et se
       prolonge seule à l'échéance). */
    var emD = Math.round(Number(devisLu.ENGAGEMENT_MOIS) || 0) || 12;
    var recD = String(devisLu.RECONDUCTION || '').toUpperCase().trim() || 'TACITE';
    if (!f.s.FIN) {
      var fe = new Date(f.s.DEBUT.getFullYear(), f.s.DEBUT.getMonth() + emD, f.s.DEBUT.getDate() - 1, 12);
      f.s.FIN = fe;
    }
    f.s.ENGAGEMENT_MOIS = emD; f.s.RECONDUCTION = recD;
    colonneAssuree_(SH.RECURRENTS, 'ENGAGEMENT_MOIS'); colonneAssuree_(SH.RECURRENTS, 'RECONDUCTION');
  }

  var ids = ecrireSeries_(f.s, f.jours);
  var rattache = { retires: 0, relies: 0 };
  if (devisLu) rattache = rattacherDevisAuContrat_(devisLu, ids);
  var b = genererRecurrents_();
  tracerServeur_(com ? com.nom : '', 'CONTRAT CREE',
                 f.s.CLIENT + ' · ' + ids.join(', ') + ' · ' + f.s.FREQUENCE +
                 (numDevis ? ' (devis ' + numDevis + ')' : ''), numDevis, d.appareil || '');
  nomsQui_(f.s.PRESTATAIRE).forEach(function (nomN) {
    try {
      notifier_(nomN, 'Nouveau contrat',
                f.s.CLIENT + (f.s.HEURE ? ' · ' + f.s.HEURE : '') +
                ' · à partir du ' + Utilities.formatDate(f.s.DEBUT, 'Europe/Paris', 'dd/MM'), '');
    } catch (eN) {}
  });
  prevenirAdmins_(com, 'Nouveau contrat', f.s.CLIENT + ' · à partir du ' + Utilities.formatDate(f.s.DEBUT, 'Europe/Paris', 'dd/MM') +
    (f.s.PRESTATAIRE ? ' · ' + f.s.PRESTATAIRE : ''), numDevis || ids.join(','));
  return { ok: true, ids: ids, poses: b.poses || 0,
           retires: rattache.retires, relies: rattache.relies };
}

/**
 * Les interventions qu'un devis récurrent signé avait laissées dans CHANTIERS
 * passent au contrat qu'on vient d'écrire :
 * — sans date et jamais commencées : retirées, la série les remplace ;
 * — datées un jour où la série passe : elles reçoivent la clé de la série,
 *   pour que la génération ne pose pas un second passage le même jour ;
 * — datées un autre jour : laissées telles quelles, ce sont de vraies
 *   interventions prévues avec le client.
 * Un passage commencé ou pointé n'est jamais touché.
 */
function rattacherDevisAuContrat_(devis, ids) {
  var out = { retires: 0, relies: 0 };
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) return out;
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cNum = en.indexOf('NUMERO'), cDate = en.indexOf('DATE'), cRec = en.indexOf('RECURRENT');
  var cSt = en.indexOf('STATUT'), cArr = en.indexOf('ARRIVEE');
  if (cNum < 0 || cRec < 0) return out;
  var numeros = [String(devis.NUMERO || '').trim(), String(devis.NUMERO_ORIGINE || '').trim()]
    .filter(function (x) { return x; });

  /* Les jours de passage de chaque série, sur l'horizon déjà posable. */
  var series = objetsDe_(SH.RECURRENTS).filter(function (r) {
    return ids.indexOf(String(r.ID || '').trim()) >= 0;
  });
  var jusqua = new Date(); jusqua.setDate(jusqua.getDate() + 120);
  var jours = {};
  series.forEach(function (r) {
    var deb = r.DEBUT ? new Date(r.DEBUT) : new Date();
    occurrencesRecurrent_(r, deb, jusqua).forEach(function (dt) {
      var k = isoJour_(dt);
      if (!jours[k]) jours[k] = String(r.ID).trim();
    });
  });

  var v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var aRetirer = [];
  v.forEach(function (l, i) {
    if (numeros.indexOf(String(l[cNum] || '').trim()) < 0) return;
    if (String(l[cRec] || '').trim()) return;
    var st = cSt >= 0 ? String(l[cSt] || '').toUpperCase().trim() : '';
    if (st === 'ANNULE' || st === 'FAIT' || st === 'EN COURS') return;
    if (cArr >= 0 && String(l[cArr] || '').trim()) return;
    var dt = l[cDate] ? new Date(l[cDate]) : null;
    if (!dt || isNaN(dt.getTime())) { aRetirer.push(i + 2); return; }
    var k = isoJour_(dt);
    if (jours[k]) {
      sh.getRange(i + 2, cRec + 1).setValue(jours[k] + '|' + k);
      out.relies++;
    }
  });
  for (var j = aRetirer.length - 1; j >= 0; j--) sh.deleteRow(aRetirer[j]);
  out.retires = aRetirer.length;
  return out;
}

/**
 * Modifier un contrat « à partir de » une date. Si la date tombe au début de
 * la série ou avant, la série est réécrite en place (même ID) ; sinon elle
 * est close la veille et une série neuve prend le relais.
 */
function recurrentModif_(d, com) {
  var id = String(d.id || '').trim();
  var L = ligneSerie_(id);
  if (!L) return { ok: false, erreur: 'contrat introuvable' };
  var f = lireFicheRecurrent_(d);
  if (!f.ok) return f;

  var auj = minuit_(new Date());
  var depuis = dateIso_(d.aPartirDe) || new Date();
  if (minuit_(depuis) < auj) depuis = new Date(auj);
  var debutAncien = L.o.DEBUT ? minuit_(L.o.DEBUT) : null;
  if (debutAncien && isNaN(debutAncien.getTime())) debutAncien = null;

  for (var i = 0; i < f.jours.length; i++) {
    var jum = serieJumelle_(f.s, f.jours[i], id);
    if (jum) return { ok: false, erreur: 'ce contrat existe déjà (' + jum + ')', existe: jum };
  }

  /* Même rythme et même jour : la nouvelle série reprend sur un vrai passage
     de l'ancienne. Sans cela, une quinzaine reprise « à partir d'aujourd'hui »
     changerait de semaine et le client serait sauté une fois. */
  var memeCadence = f.jours.length === 1 &&
    String(L.o.FREQUENCE || '').toUpperCase().trim() === f.s.FREQUENCE &&
    (f.s.FREQUENCE === 'MENSUEL'
      ? Math.round(Number(L.o.JOUR_MOIS) || 0) === Number(f.s.JOUR_MOIS) &&
        jourSemaineNum_(L.o.JOUR) === f.jours[0] &&
        Math.round(Number(L.o.INTERVALLE) || 1) === (Number(f.s.INTERVALLE) || 1)
      : jourSemaineNum_(L.o.JOUR) === f.jours[0]);
  var debutNeuf = minuit_(f.s.DEBUT) > minuit_(depuis) ? f.s.DEBUT : new Date(depuis);
  if (memeCadence) {
    var p = prochainPassage_(L.o, depuis);
    if (p && minuit_(p) > minuit_(debutNeuf)) debutNeuf = p;
  }

  var retires = retirerPassages_(id, depuis), ids;
  var enPlace = !debutAncien || debutAncien >= minuit_(depuis);

  /* Un passage déjà commencé reste à sa place (retirerPassages_ ne le touche
     pas). La série neuve ne doit pas en poser un second le même jour : son
     premier passage est repoussé d'autant. */
  if (!enPlace) {
    var gardes = passagesGardes_(id, depuis);
    for (var g = 0; g < 12; g++) {
      var essai = {};
      for (var k0 in f.s) if (f.s.hasOwnProperty(k0)) essai[k0] = f.s[k0];
      essai.DEBUT = debutNeuf;
      essai.JOUR = f.jours[0] >= 0 ? JOURS_SEMAINE_[f.jours[0]] : '';
      var premier = prochainPassage_(essai, debutNeuf);
      if (!premier || !gardes[isoJour_(premier)]) break;
      var apres = new Date(premier); apres.setDate(apres.getDate() + 1);
      debutNeuf = memeCadence ? (prochainPassage_(L.o, apres) || apres) : apres;
    }
  }
  if (enPlace) {
    /* Rien n'a encore eu lieu avant la date : on réécrit la série elle-même. */
    var s = f.s;
    s.DEBUT = memeCadence ? debutNeuf : f.s.DEBUT;
    ['CLIENT', 'ADRESSE', 'CP', 'VILLE', 'ACCES', 'FREQUENCE', 'JOUR_MOIS', 'INTERVALLE', 'HEURE',
     'DUREE_MIN', 'PRESTATAIRE', 'DEBUT', 'FIN', 'ACTIF', 'NATURE', 'PRESTATIONS']
      .forEach(function (k) { ecrireCase_(L, k, s[k]); });
    ecrireCase_(L, 'JOUR', f.jours[0] >= 0 ? JOURS_SEMAINE_[f.jours[0]] : '');
    ids = [id];
    if (f.jours.length > 1) ids = ids.concat(ecrireSeries_(s, f.jours.slice(1)));
  } else {
    var veille = new Date(depuis); veille.setDate(veille.getDate() - 1); veille.setHours(12, 0, 0, 0);
    ecrireCase_(L, 'FIN', veille);
    /* v108m — l'ancienne série est close : elle ne doit plus jamais être
       reconduite (sinon elle renaît et double la nouvelle). */
    ecrireCase_(L, 'RECONDUCTION', 'NON');
    f.s.DEBUT = debutNeuf;
    /* Les dates sautées suivent la série : un trou posé exprès ne doit pas se
       refermer parce qu'on a changé l'heure. */
    if (String(L.o.EXCLUSIONS || '').trim()) f.s.EXCLUSIONS = L.o.EXCLUSIONS;
    ids = ecrireSeries_(f.s, f.jours);
  }

  var b = genererRecurrents_();
  tracerServeur_(com ? com.nom : '', 'CONTRAT MODIFIE',
                 f.s.CLIENT + ' · ' + id + (enPlace ? ' réécrit' : ' → ' + ids.join(', ')) +
                 ' · à partir du ' + isoJour_(depuis) + ' · ' + retires + ' passage(s) reposé(s)',
                 '', d.appareil || '');
  var equipe = nomsQui_(L.o.PRESTATAIRE).concat(nomsQui_(f.s.PRESTATAIRE).filter(function (n) { return !quiContient_(L.o.PRESTATAIRE, n); }));
  var quoiM = f.s.CLIENT + ' · à partir du ' + Utilities.formatDate(depuis, 'Europe/Paris', 'dd/MM') +
    (f.s.HEURE ? ' · ' + heureTexte_(f.s.HEURE) : '') + (f.s.PRESTATAIRE ? ' · ' + f.s.PRESTATAIRE : '');
  prevenirSalaries_(equipe, 'Contrat modifié', quoiM + ' (regarde ton planning)', id);
  prevenirAdmins_(com, 'Contrat modifié', quoiM, id);
  return { ok: true, ids: ids, enPlace: enPlace, retires: retires, poses: b.poses || 0 };
}

/** Arrêter un contrat : plus aucun passage à partir de la date donnée. */
function recurrentStop_(d, com) {
  var id = String(d.id || '').trim();
  var L = ligneSerie_(id);
  if (!L) return { ok: false, erreur: 'contrat introuvable' };
  var auj = minuit_(new Date());
  var depuis = dateIso_(d.aPartirDe) || new Date();
  if (minuit_(depuis) < auj) depuis = new Date(auj);
  var veille = new Date(depuis); veille.setDate(veille.getDate() - 1); veille.setHours(12, 0, 0, 0);
  var debut = L.o.DEBUT ? minuit_(L.o.DEBUT) : null;

  ecrireCase_(L, 'FIN', veille);
  /* v108m — un contrat arrêté n'est plus reconduit. */
  ecrireCase_(L, 'RECONDUCTION', 'NON');
  /* Une série qui n'aurait jamais eu un seul passage est éteinte : une FIN
     tombée avant son DÉBUT se lirait mal dans le classeur. */
  if (debut && !isNaN(debut.getTime()) && minuit_(veille) < debut) ecrireCase_(L, 'ACTIF', 'NON');
  var retires = retirerPassages_(id, depuis);
  tracerServeur_(com ? com.nom : '', 'CONTRAT ARRETE',
                 String(L.o.CLIENT || '') + ' · ' + id + ' · dernier jour ' + isoJour_(veille) +
                 ' · ' + retires + ' passage(s) retiré(s)', '', d.appareil || '');
  var quoiS = String(L.o.CLIENT || '') + ' · plus de passage à partir du ' + Utilities.formatDate(depuis, 'Europe/Paris', 'dd/MM');
  prevenirSalaries_(nomsQui_(L.o.PRESTATAIRE), 'Contrat arrêté', quoiS, id);
  prevenirAdmins_(com, 'Contrat arrêté', quoiS, id);
  return { ok: true, retires: retires, fin: isoJour_(veille) };
}

/* La nature d'un chantier. La colonne d'abord ; à défaut celle de son devis,
   pour que les chantiers posés avant cette colonne gardent leur couleur. Un
   chantier sans devis et sans nature n'en a aucune, et c'est une réponse. */
function natureChantier_(o, parNumero) {
  var n = natureOuVide_(o.NATURE);
  if (n) return n;
  var num = String(o.NUMERO || '').trim();
  if (!num || !parNumero) return '';
  return natureOuVide_(parNumero[num]);
}

/* Les natures des devis, par numéro : une seule lecture pour tout l'écran. */
function naturesParDevis_() {
  var out = {};
  lireDevis_().forEach(function (d) {
    var n = String(d.NUMERO || '').trim();
    if (n) out[n] = d.NATURE;
  });
  return out;
}

/** Les chantiers d'un agent : ceux à venir, et les trente derniers jours. */
function planningDe_(nom) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var moi = normNom_(nom);

  var hier = new Date(); hier.setDate(hier.getDate() - 30); hier.setHours(0, 0, 0, 0);
  var loin = new Date(); loin.setDate(loin.getDate() + 60);

  var parDevis = lignesParDevis_();
  var parNature = naturesParDevis_();
  var TELS = telsClients_();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = {};
    en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
    if (!String(o.ID || '').trim()) continue;
    if (!quiContient_(o.PRESTATAIRE, moi)) continue;
    if (String(o.STATUT || '').toUpperCase().trim() === 'ANNULE') continue;
    if (!o.DATE) continue;                       // pas encore planifié
    var d = new Date(o.DATE);
    if (isNaN(d.getTime()) || d < hier || d > loin) continue;

    // La fiche de travail : ce qui a été vendu, SANS UN SEUL MONTANT.
    var taches = (parDevis[String(o.NUMERO).trim()] || []).filter(function (l) {
      /* La majoration est une ligne de prix, pas un travail à cocher. */
      return String(l.REFERENCE || '').trim() !== REF_MAJORATION_;
    }).map(function (l) {
      return {
        ref: String(l.REFERENCE || ''),
        designation: String(l.DESIGNATION || ''),
        detail: String(l.DETAIL || ''),
        qte: Number(l.QTE) || 0,
        unite: String(l.UNITE || '')
      };
    });

    out.push({
      id: String(o.ID).trim(),
      client: String(o.CLIENT || ''),
      adresse: String(o.ADRESSE || ''), cp: String(o.CP || ''), ville: String(o.VILLE || ''),
      acces: String(o.ACCES || ''),
      date: Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      heure: heureTexte_(o.HEURE),
      statut: String(o.STATUT || 'PLANIFIE'),
      arrivee: o.ARRIVEE ? new Date(o.ARRIVEE).getTime() : 0,
      depart: o.DEPART ? new Date(o.DEPART).getTime() : 0,
      minutes: Number(o.MINUTES) || 0,
      faites: String(o.PRESTATIONS_FAITES || '').split('|').filter(function (x) { return x; }),
      signalement: String(o.SIGNALEMENT || ''),
      note: String(o.NOTE || ''),
      nature: natureChantier_(o, parNature),
      taches: taches,
      fiche: String(o.FICHE || '').trim() ? (String(o.FICHE_NOM || '').trim() || 'Fiche chantier') : '',
      tel: (telDe_(o, TELS) || {}).tel || '',
      contactTel: (telDe_(o, TELS) || {}).contact || ''
    });
  }
  out.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  return out;
}

/** Écrit dans la ligne d'un chantier, repérée par son ID. */
function majChantier_(id, valeurs) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) return null;
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cId = en.indexOf('ID');
  if (cId < 0) return null;
  var ids = sh.getRange(2, cId + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() !== String(id).trim()) continue;
    /* v105 — une seule écriture pour toute la ligne touchée (de la première à
       la dernière colonne modifiée), au lieu d'un appel par case : la fiche
       envoie une dizaine de champs, et chaque setValue coûtait son aller-retour
       au classeur. Les cases du milieu non modifiées sont réécrites telles
       qu'elles viennent d'être lues, sous le verrou. */
    var cols = [];
    for (var k in valeurs) {
      if (!valeurs.hasOwnProperty(k)) continue;
      var c = en.indexOf(k);
      if (c >= 0) cols.push(c);
    }
    if (!cols.length) return i + 2;
    var c0 = Math.min.apply(null, cols), c1 = Math.max.apply(null, cols);
    var plage = sh.getRange(i + 2, c0 + 1, 1, c1 - c0 + 1);
    var ligne = plage.getValues()[0];
    var formules = plage.getFormulas()[0];
    var aFormule = formules.some(function (f) { return !!f; });
    for (var k2 in valeurs) {
      if (!valeurs.hasOwnProperty(k2)) continue;
      var c2 = en.indexOf(k2);
      if (c2 >= 0) ligne[c2 - c0] = valeurs[k2];
    }
    if (aFormule) {
      /* Une formule au milieu : on n'écrase rien, case par case comme avant. */
      for (var k3 in valeurs) {
        if (!valeurs.hasOwnProperty(k3)) continue;
        var c3 = en.indexOf(k3);
        if (c3 >= 0) sh.getRange(i + 2, c3 + 1).setValue(valeurs[k3]);
      }
    } else plage.setValues([ligne]);
    return i + 2;
  }
  return null;
}

/**
 * Ce que l'agent renvoie du terrain : son arrivée, son départ, les prestations
 * cochées, un signalement. Chaque envoi porte l'heure prise par l'appareil, pour
 * qu'un pointage fait hors connexion reste juste une fois remonté.
 */
function enregistrerChantier_(d, personne) {
  var id = String(d.id || '').trim();
  if (!id) return { ok: false, erreur: 'chantier manquant' };

  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh) return { ok: false, erreur: 'onglet CHANTIERS absent' };
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var ligne = null, actuel = {};
  var cId = en.indexOf('ID');
  if (cId >= 0 && sh.getLastRow() > 1) {
    var tout = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    for (var i = 0; i < tout.length; i++) {
      if (String(tout[i][cId]).trim() !== id) continue;
      ligne = i + 2;
      en.forEach(function (h, c) { if (h) actuel[h] = tout[i][c]; });
      break;
    }
  }
  if (!ligne) return { ok: false, erreur: 'chantier introuvable' };

  // Un agent ne touche qu'à ses propres chantiers.
  if (!quiContient_(actuel.PRESTATAIRE, personne.nom)) {
    return { ok: false, erreur: 'ce chantier ne vous est pas affecté' };
  }

  var v = {}, actions = [];

  if (d.arrivee) {
    v.ARRIVEE = new Date(Number(d.arrivee));
    v.STATUT = 'EN COURS';
    actions.push('ARRIVEE');
  }
  if (d.depart) {
    var dep = new Date(Number(d.depart));
    v.DEPART = dep;
    var arr = v.ARRIVEE || (actuel.ARRIVEE ? new Date(actuel.ARRIVEE) : null);
    if (arr) v.MINUTES = Math.max(0, Math.round((dep.getTime() - arr.getTime()) / 60000));
    v.STATUT = 'FAIT';
    actions.push('DEPART');
  }
  if (d.faites !== undefined) {
    v.PRESTATIONS_FAITES = (d.faites || []).join('|');
    actions.push('PRESTATIONS');
  }
  if (d.note !== undefined) { v.NOTE = String(d.note || ''); actions.push('NOTE'); }
  if (d.signalement) {
    v.SIGNALEMENT = String(d.signalement);
    // On ne dégrade pas un chantier déjà terminé : le signalement s'ajoute.
    if (String(v.STATUT || actuel.STATUT || '') !== 'FAIT') v.STATUT = 'PROBLEME';
    actions.push('SIGNALEMENT');
  }
  if (!actions.length) return { ok: false, erreur: 'rien à enregistrer' };

  majChantier_(id, v);
  tracerServeur_(personne.nom, 'CHANTIER ' + actions.join('+'),
                 (v.MINUTES !== undefined ? v.MINUTES + ' min · ' : '') +
                 String(v.SIGNALEMENT || '').slice(0, 120),
                 actuel.NUMERO || id, d.appareil || '');
  return { ok: true, id: id, statut: v.STATUT || actuel.STATUT || '' };
}

/** Compte les photos rattachées à un devis et l'écrit dans la colonne PHOTOS. */
function noterPhotos_(numero, dossier) {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SH.DEVIS);
    if (!sh || sh.getLastRow() < 2) return;
    var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    var cNum = en.indexOf('NUMERO'), cPh = en.indexOf('PHOTOS');
    if (cNum < 0 || cPh < 0) return;

    var n = 0, it = dossier.getFiles();
    while (it.hasNext()) {
      if (it.next().getName().indexOf('Devis-' + numero + '-photo-') === 0) n++;   // hors -signe-
    }
    var nums = sh.getRange(2, cNum + 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < nums.length; i++) {
      if (String(nums[i][0]) === String(numero)) {
        sh.getRange(i + 2, cPh + 1).setValue(n + ' photo' + (n > 1 ? 's' : ''));
        return;
      }
    }
  } catch (e) { /* le comptage ne doit jamais faire échouer l'envoi */ }
}

/* ============================ JOURNAL ============================
   Deux origines. APPAREIL : ce que le téléphone déclare avoir fait, y compris
   hors connexion — utile, mais écrit par l'appareil. SERVEUR : ce que le
   classeur constate lui-même à la réception, qui ne dépend d'aucun téléphone.
   La colonne SOURCE permet de faire la différence. */
function tracer_(lignes) {
  if (!lignes || !lignes.length) return;
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(SH.JOURNAL);
    if (!sh) { sh = creerOnglet_(ss, SH.JOURNAL, ENTETES_JOURNAL_); formaterDates_(ss); }
    var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    var recu = new Date();
    var rows = lignes.map(function (l) {
      var v = {
        HORODATAGE: recu,
        MOMENT: l.t ? new Date(Number(l.t)) : recu,
        COMMERCIAL: String(l.nom || ''),
        ACTION: String(l.action || ''),
        DETAIL: String(l.detail || '').slice(0, 300),
        NUMERO: String(l.numero || ''),
        APPAREIL: String(l.appareil || ''),
        SOURCE: String(l.source || 'APPAREIL')
      };
      return en.map(function (h) { return v.hasOwnProperty(h) ? v[h] : ''; });
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, en.length).setValues(rows);
  } catch (e) { /* le journal ne doit jamais faire échouer une opération */ }
}

/**
 * Les dates sont enregistrées à la seconde près, mais une colonne au format
 * « date » n'affiche que le jour. On impose donc le format complet.
 */
function formaterDates_(ss) {
  try {
    [[SH.JOURNAL, ['HORODATAGE', 'MOMENT'], 'dd/mm/yyyy HH:mm:ss', 145],
     [SH.DEVIS,   ['RECU_LE', 'DATE_STATUT'], 'dd/mm/yyyy HH:mm',  130],
     [SH.DEVIS,   ['RELANCE_LE'],           'dd/mm/yyyy',          105],
     [SH.FACTURER, ['DATE_SIGNATURE'],      'dd/mm/yyyy',          105],
     [SH.FACTURES, ['CREE_LE'],              'dd/mm/yyyy HH:mm',    130]
    ].forEach(function (cfg) {
      var sh = ss.getSheetByName(cfg[0]);
      if (!sh || sh.getLastColumn() < 1) return;
      var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); });
      cfg[1].forEach(function (nom) {
        var i = en.indexOf(nom);
        if (i < 0) return;
        sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat(cfg[2]);
        sh.setColumnWidth(i + 1, cfg[3]);
      });
    });
  } catch (e) { /* un souci de mise en forme ne doit rien interrompre */ }
}

/** Raccourci pour une seule ligne constatée par le serveur. */
function tracerServeur_(nom, action, detail, numero, appareil) {
  tracer_([{ t: Date.now(), nom: nom, action: action, detail: detail,
             numero: numero, appareil: appareil, source: 'SERVEUR' }]);
}

/** Efface les lignes du journal plus anciennes que la durée de conservation. */
function purgerJournal() {
  var mois = Number(lireReglages_().journal_retention_mois) || 6;
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.JOURNAL);
  if (!sh || sh.getLastRow() < 2) {
    return SpreadsheetApp.getUi().alert('Journal vide.');
  }
  var limite = new Date();
  limite.setMonth(limite.getMonth() - mois);
  var dates = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  var n = 0;
  while (n < dates.length && dates[n][0] instanceof Date && dates[n][0] < limite) n++;
  if (!n) {
    return SpreadsheetApp.getUi().alert('Rien à effacer : aucune ligne de plus de ' + mois + ' mois.');
  }
  sh.deleteRows(2, n);
  SpreadsheetApp.getUi().alert(n + ' ligne(s) de plus de ' + mois + ' mois effacée(s) du journal.');
}

/* ========================== LECTURES ========================== */

function lireReglages_() {
  var out = {};
  var v = valeursOnglet_(SH.REGLAGES);
  if (!v) return out;
  v.slice(1).forEach(function (r) {
    if (String(r[0]).trim()) out[String(r[0]).trim()] = r.length > 1 ? r[1] : '';
  });
  return out;
}

function lireCatalogue_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CATALOGUE);
  if (!sh || sh.getLastRow() < 2) return [];
  var large = Math.max(10, sh.getLastColumn());
  return sh.getRange(2, 1, sh.getLastRow() - 1, large).getValues()
    .filter(function (r) { return String(r[1]).trim() && estActif_(r[7]); })
    .map(function (r) {
      return {
        categorie: String(r[0] || 'Divers'), designation: String(r[1]),
        detail: String(r[2] || ''), unite: String(r[3] || ''),
        pu: Number(r[4]) || 0, tva: Number(r[5]) || 20,
        type: String(r[6] || '').toUpperCase() === 'MENSUEL' ? 'MENSUEL' : 'PONCTUEL',
        reference: String(r[8] || '').trim(),
        natures: naturesCatalogue_(r[9]),
        puComplement: Number(r[10]) || 0
      };
    });
}

/* « 2026-10-06 » → le 6 octobre 2026 à midi, heure du classeur. Midi et non
   minuit : une date du calendrier n'a pas d'heure, et minuit bascule d'un jour
   au moindre décalage. Tout le reste renvoie une chaîne vide. */
function jourValide_(v) {
  var m = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? '' : d;
}

/* « ENTRETIEN, REMISE » → ['ENTRETIEN','REMISE']. Vide, ou rien de reconnu :
   tableau vide, et la prestation se vend dans toutes les natures. On accepte
   la virgule, le point-virgule, la barre oblique et l'espace comme séparateurs,
   parce qu'une colonne remplie à la main les mélange toujours. */
function naturesCatalogue_(v) {
  var vus = {}, sortie = [];
  String(v || '').toUpperCase().split(/[^A-Z]+/).forEach(function (m) {
    if (m !== 'ENTRETIEN' && m !== 'VITRERIE' && m !== 'CHANTIER' && m !== 'REMISE' && m !== 'FACADE') return;
    if (vus[m]) return;
    vus[m] = true; sortie.push(m);
  });
  return sortie;
}

/* Les agents actifs. Même forme que lireCommerciaux_, autre population. */
function lirePrestataires_() { return personnesEnCache_('S', lirePrestataires_Brut_); }
function lirePrestataires_Brut_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.PRESTATAIRES);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return String(r[0]).trim() && estActif_(r[3]); })
    .map(function (r) {
      return { nom: String(r[0]).trim(), email: String(r[1] || '').trim(),
               code: String(r[2] || '').trim(), role: 'PRESTATAIRE' };
    });
}

/* Un commercial peut faire des chantiers lui-même. Son rôle reste commercial —
   il établit des devis — mais son planning doit lui parvenir. On le reconnaît
   à sa présence parmi les prestataires actifs, sous le même nom. */
function aussiPrestataire_(nom) {
  var n = normNom_(nom), oui = false;
  lirePrestataires_().forEach(function (p) { if (normNom_(p.nom) === n) oui = true; });
  return oui;
}

/**
 * Qui se connecte. On cherche d'abord parmi les commerciaux, puis parmi les
 * agents. Le rôle qui sort d'ici commande tout le reste : les données envoyées
 * à l'appareil, et les actions autorisées.
 */
function trouverPersonne_(nom) {
  var n = normNom_(nom), out = null;
  // Un compte d'administration l'emporte sur les deux autres : quelqu'un qui
  // figure aussi parmi les commerciaux ouvre le tableau, pas la saisie. Sans
  // cette priorité, le patron qui a gardé sa ligne de commercial n'atteindrait
  // jamais son espace.
  lireAdmins_().forEach(function (p) { if (normNom_(p.nom) === n) out = p; });
  if (out) return out;
  var c = trouverCommercial_(nom);
  if (c) { c.role = 'COMMERCIAL'; return c; }
  lirePrestataires_().forEach(function (p) { if (normNom_(p.nom) === n) out = p; });
  return out;
}

/* Les comptes d'administration actifs. */
function lireAdmins_() { return personnesEnCache_('A', lireAdmins_Brut_); }
function lireAdmins_Brut_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.ADMINS);
  if (!sh || sh.getLastRow() < 2) return [];
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim().toUpperCase(); });
  var cIni = en.indexOf('INITIALES');
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
    .filter(function (r) { return String(r[0]).trim() && estActif_(r[3]); })
    .map(function (r) {
      var ini = cIni >= 0 ? String(r[cIni] || '').trim() : '';
      return { nom: String(r[0]).trim(), email: String(r[1] || '').trim(),
               code: String(r[2] || '').trim(), role: 'ADMIN',
               initiales: initialesDe_(r[0], ini) };
    });
}

function lireCommerciaux_() { return personnesEnCache_('C', lireCommerciaux_Brut_); }
function lireCommerciaux_Brut_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.COMMERCIAUX);
  if (!sh || sh.getLastRow() < 2) return [];
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim().toUpperCase(); });
  var cIni = en.indexOf('INITIALES');
  var cTel = en.indexOf('TELEPHONE');
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
    .filter(function (r) { return String(r[0]).trim() && estActif_(r[3]); })
    .map(function (r) {
      /* Les initiales du numéro de devis. Devinées à partir du nom, sauf si la
         colonne INITIALES en impose d'autres : « SIMON LG » donne SL, alors que
         Simon veut lire SLG sur ses devis — personne ne devine cela. */
      var ini = cIni >= 0 ? String(r[cIni] || '').trim() : '';
      return { nom: String(r[0]).trim(), email: String(r[1] || '').trim(),
               code: String(r[2] || '').trim(), initiales: initialesDe_(r[0], ini),
               tel: cTel >= 0 ? String(r[cTel] || '').trim() : '' };
    });
}

function ecrireReglage_(cle, valeur) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.REGLAGES);
  for (var i = 2; i <= sh.getLastRow(); i++) {
    if (String(sh.getRange(i, 1).getValue()).trim() === cle) { sh.getRange(i, 2).setValue(valeur); return; }
  }
  sh.appendRow([cle, valeur, '']);
}

var MOIS_ = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
             'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Le dossier racine de l'archivage (créé au besoin, puis mémorisé). */
function racineDevis_(reg) {
  var id = String(reg.dossier_racine_id || '').trim();
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName('DEVIS NETTOYAGE');
  var racine = it.hasNext() ? it.next() : DriveApp.createFolder('DEVIS NETTOYAGE');
  ecrireReglage_('dossier_racine_id', racine.getId());
  return racine;
}

function sousDossier_(parent, nom) {
  nom = String(nom || '').trim() || 'Sans nom';
  var it = parent.getFoldersByName(nom);
  return it.hasNext() ? it.next() : parent.createFolder(nom);
}

/**
 * Rangement : DEVIS NETTOYAGE / 2026 / 09 - septembre / SIMON H /
 * Le classement suit la DATE DU DEVIS, pas celle de la réception : un devis
 * signé hors connexion le 30 et remonté le 1er reste dans le bon mois.
 */
function dossierDevis_(reg, date, commercial) {
  var d = (date instanceof Date && !isNaN(date)) ? date : new Date();
  var dossier = racineDevis_(reg);
  dossier = sousDossier_(dossier, String(d.getFullYear()));
  dossier = sousDossier_(dossier, ('0' + (d.getMonth() + 1)).slice(-2) + ' - ' + MOIS_[d.getMonth()]);
  dossier = sousDossier_(dossier, commercial || 'Sans commercial');
  return dossier;
}

/**
 * Une date de cellule, écrite « aaaa-mm-jj » à l'heure du classeur.
 *
 * toISOString() renvoie la date UTC : une cellule du 30 septembre, lue par un
 * script réglé sur Paris, y devient le 29 septembre. Tout le tableau de bord
 * affichait ainsi des dates en avance d'un jour sur la réalité.
 */
/* L'heure d'une cellule. Le tableur range « 08:00 » comme une date du
   30 décembre 1899 à 8 h : la passer à String() donnerait
   « Sat Dec 30 1899 08:00:00 GMT+0009 » sur l'écran du gérant. */
function heureTexte_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(v == null ? '' : v).trim();
}

function isoJour_(d) {
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/** Montant HT d'une ligne, remise de ligne déduite. */
/**
 * Compare chaque ligne reçue au tarif officiel du catalogue, via sa REFERENCE.
 *
 * On ne réécrit RIEN : si le client a signé le papier, le prix imprimé est celui
 * qui a été convenu, et le classeur n'a pas à le contredire après coup. On se
 * contente de dire ce qui ne colle pas, pour que le bureau tranche.
 *
 * Deux causes possibles à un écart, et elles se ressemblent de l'extérieur :
 * un appareil resté longtemps hors connexion travaille avec un catalogue
 * périmé ; ou quelqu'un a modifié le devis avant l'envoi.
 */
var REF_MAJORATION_ = 'MAJ-ETAT';
/* Une ligne écrite et chiffrée par le commercial devant le client, pour ce que
   le catalogue ne porte pas encore. Elle n'est pas « hors catalogue » : elle
   est attendue, et signalée nommément dans CONTROLE_TARIF pour que le bureau
   la lise, décide, et l'ajoute au catalogue si elle revient. */
var REF_LIBRE_ = 'LIBRE-';
function estLigneLibre_(l) {
  return String((l && l.reference) || '').trim().indexOf(REF_LIBRE_) === 0;
}

/* Un pourcentage de REGLAGES, borné entre 0 et 100. Illisible ou vide : zéro. */
function pourcentReglage_(v) {
  var n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.').trim());
  if (!isFinite(n) || n < 0) return 0;
  return n > 100 ? 100 : n;
}

/* TRES_SALE ou NORMAL ; tout le reste — y compris l'ancien « SALE » — vaut NORMAL. */
function etatSite_(v) {
  var e = String(v || '').toUpperCase().trim().replace(/[ -]+/g, '_');
  return e === 'TRES_SALE' ? e : 'NORMAL';
}

/* ====================== LA DISTANCE DEPUIS L'AGENCE ======================
   Décision de Simon (3 octobre 2026) : sur un contrat d'entretien, et sur lui
   seul, chaque kilomètre au-delà de 10 km ajoute 0,90 € au prix d'un passage.

   Pourquoi là et pas ailleurs : un entretien, ce sont des passages répétés, et
   chaque passage est un trajet. Les agents partent de l'agence et enchaînent
   un secteur dans la journée ; ramené au client, le trajet revient donc à peu
   près à un aller simple, soit environ 0,88 € du kilomètre entre le temps de
   route et le véhicule. Les dix premiers kilomètres sont compris dans le prix
   de base ; au-delà, le client paie ce que son éloignement coûte en plus.

   La majoration ne s'écrit pas sur le devis : elle est fondue dans les prix
   unitaires, relevés tous du même pourcentage. C'est ce qui explique que
   controlerTarifs_ n'attende pas le prix du catalogue tel quel, mais le prix
   du catalogue relevé de ce pourcentage.

   La distance vient de l'onglet COMMUNES, que le téléphone reçoit à la
   connexion : il chiffre chez le client, souvent sans réseau. Le commercial
   peut la corriger ; le classeur compare alors sa saisie à la table et le
   signale si les deux divergent. */

function nombreReglage_(v) {
  var n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.').trim());
  return isFinite(n) && n >= 0 ? n : 0;
}

/** La clé d'une commune : code postal et ville, sans accent ni casse. */
function cleCommune_(cp, ville) {
  var c = String(cp || '').replace(/\D/g, '').slice(0, 5);
  var v = String(ville || '');
  if (v.normalize) v = v.normalize('NFD').replace(/[̀-ͯ]/g, '');
  v = v.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  if (!c && !v) return '';
  return c + ' ' + v;
}

/** La table des communes, prête pour le téléphone : { '56000 VANNES': 0 }. */
function lireCommunes_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.COMMUNES);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim().toUpperCase(); });
  var cCp = en.indexOf('CP'), cV = en.indexOf('VILLE'), cK = en.indexOf('KM');
  if (cCp < 0 || cV < 0 || cK < 0) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function (r) {
    var cle = cleCommune_(r[cCp], r[cV]);
    var km = Number(String(r[cK] === undefined ? '' : r[cK]).replace(',', '.'));
    if (cle && isFinite(km) && km >= 0 && String(r[cK]).trim() !== '') out[cle] = km;
  });
  return out;
}

/** La distance que le classeur connaît pour ce client, ou -1. */
function kmTable_(cp, ville, communes) {
  communes = communes || lireCommunes_();
  var cle = cleCommune_(cp, ville);
  if (cle && communes.hasOwnProperty(cle)) return communes[cle];
  /* Même code postal, autre orthographe de la ville : on retombe dessus. */
  var cp5 = String(cp || '').replace(/\D/g, '').slice(0, 5);
  if (cp5) {
    for (var k in communes) {
      if (communes.hasOwnProperty(k) && k.indexOf(cp5 + ' ') === 0) return communes[k];
    }
  }
  return -1;
}

/** La distance retenue pour un devis : celle qu'il porte, sinon la table. */
function kmDevis_(devis, communes) {
  var c = (devis && devis.client) || {};
  var k = Number(String(devis && devis.km !== undefined ? devis.km : '').replace(',', '.'));
  if (isFinite(k) && k >= 0 && String(devis && devis.km).trim() !== '') return k;
  var t = kmTable_(c.cp, c.ville, communes);
  return t >= 0 ? t : 0;
}

/**
 * Le barème au kilomètre, lu dans un seul réglage :
 *
 *     10:0 ; 20:0,70 ; 50:0,80 ; *:0,90
 *
 * « jusqu'à 10 km : rien ; de 10 à 20 : 0,70 € du km ; de 20 à 50 : 0,80 ;
 * au-delà : 0,90 ». Les tranches se cumulent, comme un barème d'impôt : un
 * client à 30 km paie 10 km à 0,70 € puis 10 km à 0,80 €, soit 15 €. Aucun
 * saut aux frontières, et une tranche se change sans toucher au code.
 *
 * La dernière tranche doit porter * — sans elle, les kilomètres au-delà de la
 * dernière borne ne seraient pas comptés.
 */
function baremeKm_(reg) {
  var txt = String((reg || {}).majoration_km_bareme || '').trim();
  if (!txt) return [];
  var out = [];
  txt.split(/[;\n]+/).forEach(function (m) {
    var p = String(m).split(':');
    if (p.length < 2) return;
    var borne = String(p[0]).trim();
    var taux = Number(String(p[1]).replace(',', '.').trim());
    if (!isFinite(taux) || taux < 0) return;
    var jusqua = /^[*+]|illimit/i.test(borne)
      ? Infinity
      : Number(borne.replace(',', '.'));
    if (jusqua !== Infinity && (!isFinite(jusqua) || jusqua < 0)) return;
    out.push({ jusqua: jusqua, taux: taux });
  });
  out.sort(function (a, b) { return a.jusqua - b.jusqua; });
  return out;
}

/** Les euros ajoutés à UN passage par l'éloignement du client. */
function supplementKm_(devis, reg, communes) {
  if (!majorableKm_(devis && devis.nature)) return 0;
  var bareme = baremeKm_(reg);
  if (!bareme.length) return 0;
  var km = kmDevis_(devis, communes);
  var bas = 0, total = 0;
  for (var i = 0; i < bareme.length && bas < km; i++) {
    var haut = Math.min(bareme[i].jusqua, km);
    if (haut > bas) total += (haut - bas) * bareme[i].taux;
    bas = bareme[i].jusqua;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Le pas d'arrondi d'un prix relevé. Au dixième d'euro à partir d'un euro :
 * c'est ce qui donne une grille lisible. Au centime en dessous, parce qu'un
 * prix au m² vaut quelques centimes — l'arrondir au dixième le ferait bondir
 * d'un tiers, et le supplément n'aurait plus aucun rapport avec la distance.
 */
function pasArrondi_(pu, reg) {
  var p = nombreReglage_((reg || {}).majoration_km_arrondi);
  if (!(p > 0)) return 0.01;
  return Math.abs(Number(pu) || 0) >= 1 ? p : 0.01;
}

/**
 * Le pourcentage dont les prix unitaires sont relevés. Il se déduit du
 * supplément et du prix catalogue des prestations : relever chaque prix de ce
 * pourcentage fait monter le passage d'à peu près le supplément — « à peu
 * près » parce que l'arrondi reprend d'une main ce qu'il donne de l'autre,
 * de quelques dizaines de centimes au plus.
 */
function tauxSupKm_(devis, reg, cat, communes) {
  var sup = supplementKm_(devis, reg, communes);
  if (!(sup > 0)) return 0;
  var base = 0;
  ((devis && devis.lignes) || []).forEach(function (l) {
    if (String(l.reference || '').trim() === REF_MAJORATION_) return;
    var p = cat[String(l.reference || '').trim()];
    if (!p) return;
    base += (Number(l.qte) || 0) * (Number(p.pu) || 0);
  });
  if (!(base > 0)) return 0;
  return sup / base;
}

/** Le prix unitaire attendu sur le devis, éloignement compris et arrondi. */
function prixAttendu_(pu, taux, reg) {
  var pas = pasArrondi_(pu, reg);
  var v = (Number(pu) || 0) * (1 + (taux || 0));
  return Math.round(Math.round(v / pas) * pas * 100) / 100;
}

/** La distance routière agence → commune, en kilomètres, ou -1. */
function kmDepuisAgence_(cp, ville, reg) {
  var depart = String((reg || {}).agence_adresse || '').trim();
  var arrivee = String(cp || '').trim() + ' ' + String(ville || '').trim() + ', France';
  if (!depart || !String(ville || '').trim()) return -1;
  try {
    var r = Maps.newDirectionFinder()
      .setOrigin(depart).setDestination(arrivee)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .setRegion('fr')
      .getDirections();
    var jambe = r && r.routes && r.routes[0] && r.routes[0].legs && r.routes[0].legs[0];
    if (jambe && jambe.distance && isFinite(Number(jambe.distance.value))) {
      return Math.round(Number(jambe.distance.value) / 100) / 10;   // au dixième de km
    }
  } catch (e) {}
  return -1;
}

/**
 * Ajoute une commune à la table, si elle n'y est pas déjà. Appelée quand un
 * devis arrive d'une commune inconnue : la table se remplit toute seule au fil
 * des clients, et Simon n'a qu'à vérifier les kilomètres mesurés.
 */
function noterCommune_(cp, ville, km, source) {
  var cle = cleCommune_(cp, ville);
  if (!cle || !String(ville || '').trim()) return false;
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.COMMUNES);
  if (!sh) return false;
  if (sh.getLastRow() > 1) {
    var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim().toUpperCase(); });
    var cCp = en.indexOf('CP'), cV = en.indexOf('VILLE');
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    for (var i = 0; i < v.length; i++) {
      if (cleCommune_(v[i][cCp], v[i][cV]) === cle) return false;
    }
  }
  sh.appendRow([String(cp || ''), String(ville || ''),
                (km >= 0 ? km : ''), source || '', new Date()]);
  return true;
}

/**
 * Mesure la distance des communes qui n'en ont pas encore. Les villes des
 * devis déjà reçus sont ajoutées à la table au passage : un seul appui et le
 * secteur est couvert.
 */
function mesurerCommunes() {
  var ui = SpreadsheetApp.getUi();
  majStructure_();
  var reg = lireReglages_();
  if (!String(reg.agence_adresse || '').trim()) {
    ui.alert('Renseigne d\'abord le réglage agence_adresse dans l\'onglet REGLAGES.');
    return;
  }

  // les communes vues sur les devis, ajoutées si elles manquent
  lireDevis_().forEach(function (d) { noterCommune_(d.CP, d.VILLE, -1, ''); });

  var sh = SpreadsheetApp.getActive().getSheetByName(SH.COMMUNES);
  if (!sh || sh.getLastRow() < 2) {
    ui.alert('Aucune commune à mesurer : la table est vide et aucun devis n\'en nomme.');
    return;
  }
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim().toUpperCase(); });
  var cCp = en.indexOf('CP'), cV = en.indexOf('VILLE'), cK = en.indexOf('KM'),
      cS = en.indexOf('SOURCE'), cD = en.indexOf('CALCULE_LE');
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var faits = 0, rates = [];
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][cK]).trim() !== '') continue;        // déjà mesurée ou saisie
    var km = kmDepuisAgence_(v[i][cCp], v[i][cV], reg);
    if (km < 0) { rates.push(String(v[i][cV] || v[i][cCp])); continue; }
    sh.getRange(i + 2, cK + 1).setValue(km);
    if (cS >= 0) sh.getRange(i + 2, cS + 1).setValue('MAPS');
    if (cD >= 0) sh.getRange(i + 2, cD + 1).setValue(new Date());
    faits++;
  }
  ui.alert('Communes mesurées : ' + faits +
           (rates.length ? '\n\nSans réponse de Google Maps : ' + rates.join(', ') +
                           '\nÉcris leur distance à la main dans la colonne KM.' : '') +
           '\n\nLes kilomètres déjà écrits n\'ont pas été touchés.');
}

/* ====================== LE TARIF DE COMPLÉMENT ======================

   Une prestation peut porter deux prix : celui qu'elle vaut seule, et celui
   qu'elle vaut quand on est déjà chez le client pour autre chose. Le canapé en
   est le premier cas : 150 € HT pour un déplacement qui ne sert qu'à lui,
   70 € dès qu'il s'ajoute à une autre mission. Ce n'est pas une remise, c'est
   un déplacement qu'on ne facture pas deux fois.

   La règle, et c'est mot pour mot la même dans l'application : le prix de
   complément s'applique dès que le devis porte au moins UNE AUTRE prestation
   payante — une autre référence, une désignation renseignée, un montant
   supérieur à zéro. Une ligne libre compte : c'est une vraie mission, décidée
   sur place. La majoration pour état des lieux ne compte pas : elle n'est pas
   une mission, c'est un pourcentage du reste du devis.

   Les deux côtés doivent en juger pareil, sinon le classeur signalerait un
   écart de tarif à chaque canapé vendu avec autre chose.
   ==================================================================== */
function autrePrestationPayante_(lignes, ref) {
  for (var i = 0; i < (lignes || []).length; i++) {
    var l = lignes[i];
    var r = String(l.reference || '').trim();
    if (r && r === String(ref || '').trim()) continue;
    if (r === REF_MAJORATION_) continue;
    if (!String(l.designation || '').trim()) continue;
    if (Math.round((Number(l.qte) || 0) * (Number(l.pu) || 0) * 100) / 100 <= 0) continue;
    return true;
  }
  return false;
}

/** Le prix du catalogue que cette prestation doit porter sur CE devis. */
function puCatalogue_(p, lignes) {
  var base = Number(p && p.pu) || 0;
  var comp = Number(p && p.puComplement) || 0;
  if (!comp) return base;
  return autrePrestationPayante_(lignes, p.reference) ? comp : base;
}

function controlerTarifs_(devis, reg, communes) {
  var lignes = (devis && devis.lignes) || [];
  if (!lignes.length) return '';

  var cat = {}, parNom = {};
  lireCatalogue_().forEach(function (p) {
    if (p.reference) cat[p.reference] = p;
    parNom[normNom_(p.designation)] = p;
  });

  /* Les prix d'un entretien sont relevés de l'éloignement du client : ce n'est
     pas le prix du catalogue qu'on attend, mais ce prix relevé puis arrondi. */
  var tauxKm = tauxSupKm_(devis, reg, cat, communes);

  var max = Number(String(reg.remise_max === undefined ? 0 : reg.remise_max).replace(',', '.'));
  if (!isFinite(max) || max < 0) max = 0;
  if (max > 100) max = 100;

  /* La majoration pour état des lieux n'est pas au catalogue : c'est un
     pourcentage du reste du devis. On la recalcule ici, avec le taux du
     classeur, et l'on signale tout montant qui ne tombe pas dessus. Il n'y a
     qu'un taux — « site très sale » — depuis que Simon a retiré le palier
     intermédiaire : un ancien réglage majoration_sale est ignoré. */
  var base = 0;
  lignes.forEach(function (l) {
    if (String(l.reference || '').trim() === REF_MAJORATION_) return;
    /* Une ligne libre ne majore pas l'état des lieux : son prix a été décidé
       sur place, il porte déjà ce qu'il doit porter. */
    if (estLigneLibre_(l)) return;
    base += Math.round((Number(l.qte) || 0) * (Number(l.pu) || 0) * 100) / 100;
  });
  var tauxPermis = [pourcentReglage_(reg.majoration_tres_sale)]
    .filter(function (x) { return x > 0; });
  var majorations = 0;

  var ecarts = [];
  lignes.forEach(function (l, i) {
    var rang = 'ligne ' + (i + 1) + ' (' + (l.designation || 'sans nom') + ')';
    var ref = String(l.reference || '').trim();
    var p = ref ? cat[ref] : parNom[normNom_(l.designation || '')];

    if (ref === REF_MAJORATION_) {
      majorations++;
      var montant = Math.round((Number(l.qte) || 0) * (Number(l.pu) || 0) * 100) / 100;
      var juste = tauxPermis.some(function (t) {
        return Math.abs(montant - Math.round(base * t) / 100) <= 0.011;
      });
      if (majorations > 1) ecarts.push(rang + ' : majoration comptée deux fois');
      else if (natureDevis_(devis.nature) === 'ENTRETIEN') {
        ecarts.push(rang + ' : majoration sur un contrat d\'entretien');
      } else if (!juste) {
        ecarts.push(rang + ' : majoration de ' + montant + ' € qui ne correspond pas au taux du classeur (' +
                    (tauxPermis.length ? tauxPermis[0] + ' %' : 'aucun') + ' de ' + base + ' €)');
      }
    } else if (estLigneLibre_(l)) {
      /* On ne la refuse pas — c'est tout l'intérêt — mais le bureau doit la
         voir : intitulé, quantité et prix, en clair, dans CONTROLE_TARIF. */
      var mL = Math.round((Number(l.qte) || 0) * (Number(l.pu) || 0) * 100) / 100;
      ecarts.push('ligne ' + (i + 1) + ' : ligne libre « ' + (l.designation || 'sans nom') +
                  ' », ' + (Number(l.qte) || 0) + ' ' + (l.unite || '') +
                  ' à ' + (Number(l.pu) || 0) + ' € = ' + mL + ' €');
    } else if (!p) {
      ecarts.push(rang + ' : hors catalogue');
    } else {
      var attendu = prixAttendu_(puCatalogue_(p, lignes), tauxKm, reg), recu = Number(l.pu) || 0;
      if (Math.abs(attendu - recu) > 0.005) {
        ecarts.push(rang + ' : prix ' + recu + ' au lieu de ' + attendu +
                    (tauxKm > 0 ? ' (éloignement compris)' : ''));
      }
      /* Chaque prestation dit dans quelles natures elle se vend. Les vitrages
         ne se mêlent pas à un entretien : ils ne passent pas à la même
         fréquence, et un devis ne porte qu'un nombre de passages. */
      if (p.natures && p.natures.length &&
          p.natures.indexOf(natureDevis_(devis.nature)) < 0) {
        ecarts.push(rang + ' : ne se vend pas sur un devis « ' +
                    natureLisible_(devis.nature) + ' » (' + p.natures.join(', ') + ')');
      }
    }

    var rem = Number(l.rem) || 0;
    if (rem > max + 0.001) {
      ecarts.push(rang + ' : remise ' + rem + ' % au lieu de ' + max + ' % maximum');
    }
  });

  /* La distance saisie par le commercial contre celle que le classeur connaît :
     c'est elle qui fixe le supplément, elle ne doit pas être inventée. */
  if (majorableKm_(devis.nature) &&
      String(devis.km === undefined || devis.km === null ? '' : devis.km).trim() !== '') {
    var c = devis.client || {};
    var vue = kmTable_(c.cp, c.ville, communes);
    var dite = Number(String(devis.km).replace(',', '.'));
    if (vue >= 0 && isFinite(dite) && Math.abs(vue - dite) > 1.01) {
      ecarts.push('distance ' + dite + ' km au lieu de ' + vue + ' km pour ' +
                  (c.cp || '') + ' ' + (c.ville || ''));
    }
  }

  if (!ecarts.length) return '';
  return 'À VÉRIFIER — ' + ecarts.join(' ; ');
}

function montantLigne_(l) {
  return Math.round((Number(l.qte) || 0) * (Number(l.pu) || 0) *
                    (1 - (Number(l.rem) || 0) / 100) * 100) / 100;
}

/** Taux de TVA le plus représenté dans le devis, pour la colonne de suivi. */
function tauxPrincipal_(devis) {
  var par = {}, meilleur = '', max = -1;
  (devis.lignes || []).forEach(function (l) {
    var t = Number(l.tva) || 0;
    par[t] = (par[t] || 0) + montantLigne_(l);
    if (par[t] > max) { max = par[t]; meilleur = t; }
  });
  return meilleur === '' ? '' : meilleur + ' %';
}

function eur_(n) {
  var v = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).split('.');
  return v[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + v[1] + ' €';
}

/* ====================== MES DEVIS, DEPUIS LE BUREAU ======================
   L'écran « Mes devis » du commercial ne lisait que la mémoire du téléphone.
   Un appareil neuf, un cache vidé, ou simplement la purge des trente jours, et
   il n'avait plus rien sous les yeux alors que le classeur, lui, gardait tout.
   Ces deux actions lui rendent SES devis — jamais ceux d'un autre — sans
   jamais le laisser écrire par-dessus le travail fait sur l'autre appareil :
   il consulte, il lit le PDF, il pose le résultat (par l'action « statut »,
   déjà en place) et il duplique. Modifier et signer restent à l'appareil qui
   porte le devis. */

/** L'identifiant Drive caché dans un lien de fichier. */
function idDrive_(url) {
  var m = /[-\w]{25,}/.exec(String(url || ''));
  return m ? m[0] : '';
}

/** La liste légère : de quoi peindre l'écran, pas un octet de plus. */
function mesDevis_(d, com) {
  var mois = Number(d.mois) || 12;
  if (mois < 1) mois = 1;
  if (mois > 120) mois = 120;
  var depuis = new Date();
  depuis.setMonth(depuis.getMonth() - mois);
  depuis.setHours(0, 0, 0, 0);

  var moi = normNom_(com.nom);
  /* Le gerant ne recoit la maison entiere que s'il la demande : son ecran
     « Mes devis » montre les siens, son tableau montre le reste. */
  var tout = String(com.role || '') === 'ADMIN' && !!d.tous;
  var out = [];
  objetsDe_(SH.DEVIS).forEach(function (o) {
    var num = String(o.NUMERO || '').trim();
    if (!num) return;
    if (!tout && normNom_(o.COMMERCIAL) !== moi) return;
    var dt = o.DATE ? new Date(o.DATE) : null;
    if (!dt || isNaN(dt.getTime()) || dt < depuis) return;
    out.push({
      numero: num,
      numeroOrigine: String(o.NUMERO_ORIGINE || '').trim(),
      date: isoJour_(dt),
      commercial: String(o.COMMERCIAL || '').trim(),
      client: String(o.CLIENT || ''),
      contact: String(o.CONTACT || ''),
      cp: String(o.CP || ''),
      ville: String(o.VILLE || ''),
      ht: Number(o.TOTAL_HT) || 0,
      ttc: Number(o.TOTAL_TTC) || 0,
      mensuel: Number(o.TOTAL_HT_MENSUEL) || 0,
      statut: String(o.STATUT || '').toUpperCase() || 'REMIS',
      signe: String(o.SIGNE || '').toUpperCase() === 'OUI',
      motif: String(o.MOTIF_REFUS || ''),
      relance: o.RELANCE_LE ? isoJour_(o.RELANCE_LE) : '',
      note: String(o.NOTE_COMMERCIAL || ''),
      objet: String(o.OBJET || ''),
      nature: String(o.NATURE || ''),
      validite: o.VALIDITE ? isoJour_(o.VALIDITE) : '',
      pdf: String(o.LIEN_PDF || '').trim() ? true : false,
      /* v103 — pour le chiffre et la commission du commercial. */
      typeClient: /^PART/i.test(String(o.TYPE_CLIENT || '')) ? 'PART' : 'PRO',
      passages: Number(o.PASSAGES_MOIS) || 0,
      signeLe: o.DATE_STATUT instanceof Date && String(o.STATUT || '').toUpperCase() === 'SIGNE' ? isoJour_(o.DATE_STATUT) : '',
      engagement: Math.round(Number(o.ENGAGEMENT_MOIS) || 0) || 0
    });
  });
  out.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  var tronque = out.length > 400;
  if (tronque) out = out.slice(0, 400);
  return { ok: true, devis: out, mois: mois, tronque: tronque, maj: Date.now() };
}

/** Le détail d'un devis : ses lignes pour le dupliquer, son PDF pour le lire. */
function devisArchive_(d, com) {
  var num = String(d.numero || '').trim();
  if (!num) return { ok: false, erreur: 'numéro manquant' };

  var cible = null;
  objetsDe_(SH.DEVIS).forEach(function (o) {
    var n = String(o.NUMERO || '').trim();
    var a = String(o.NUMERO_ORIGINE || '').trim();
    if (n === num || (a && a === num)) cible = o;
  });
  if (!cible) return { ok: false, erreur: 'devis introuvable' };

  /* Les devis des autres ne regardent personne. Le refus part au journal :
     une demande pareille n'arrive pas par hasard. */
  if (String(com.role || '') !== 'ADMIN' && normNom_(cible.COMMERCIAL) !== normNom_(com.nom)) {
    tracerServeur_(com.nom, 'DEVIS D UN AUTRE REFUSE', num, '', d.appareil || '');
    return { ok: false, erreur: 'ce devis n\'est pas le vôtre' };
  }

  var vrai = String(cible.NUMERO || '').trim();
  var lignes = [];
  objetsDe_(SH.LIGNES).forEach(function (l) {
    if (String(l.NUMERO || '').trim() !== vrai) return;
    lignes.push({
      categorie: String(l.CATEGORIE || ''), reference: String(l.REFERENCE || ''),
      designation: String(l.DESIGNATION || ''), detail: String(l.DETAIL || ''),
      qte: Number(l.QTE) || 0, unite: String(l.UNITE || ''),
      pu: Number(l.PU_HT) || 0, rem: Number(l.REMISE_PCT) || 0,
      type: String(l.TYPE || 'PONCTUEL'), tva: Number(l.TVA) || 0,
      ordre: Number(l.ORDRE) || 0
    });
  });
  lignes.sort(function (a, b) { return a.ordre - b.ordre; });

  var p2a = cible.LOGEMENT_PLUS_2_ANS;
  var res = {
    ok: true, numero: vrai, lignes: lignes,
    client: {
      type: String(cible.TYPE_CLIENT || 'PRO').toUpperCase() === 'PART' ? 'PART' : 'PRO',
      societe: String(cible.CLIENT || ''), siret: String(cible.SIRET_CLIENT || ''),
      tva: String(cible.TVA_CLIENT || ''), contact: String(cible.CONTACT || ''),
      tel: String(cible.TELEPHONE || ''), email: String(cible.EMAIL || ''),
      adresse: String(cible.ADRESSE || ''), cp: String(cible.CP || ''),
      ville: String(cible.VILLE || ''),
      plus2ans: (p2a === '' || p2a === undefined || p2a === null)
        ? null : (String(p2a).toUpperCase() === 'OUI')
    },
    objet: String(cible.OBJET || ''), nature: String(cible.NATURE || ''),
    passages: Number(cible.PASSAGES_MOIS) || 0,
    etatSite: String(cible.ETAT_SITE || 'NORMAL'),
    delai: String(cible.DELAI || ''), notes: String(cible.NOTES || ''),
    /* v108e — de quoi rouvrir le devis pour le MODIFIER depuis la fiche du
       tableau, sur un téléphone qui ne l'a pas établi. L'identifiant est ce
       qui fait remplacer la ligne au lieu d'en ajouter une : sans lui, la
       correction deviendrait un second devis. */
    idDevis: String(cible.ID_DEVIS || ''),
    placement: placementLire_(cible.PLACEMENT_SUGGERE),
    commercial: String(cible.COMMERCIAL || ''),
    statut: String(cible.STATUT || ''),
    signe: String(cible.SIGNE || '').toUpperCase() === 'OUI' || String(cible.STATUT || '').toUpperCase() === 'SIGNE',
    date: cible.DATE instanceof Date ? cible.DATE.toISOString() : String(cible.DATE || ''),
    remise: Number(cible.REMISE_PCT) || 0,
    km: (cible.KM_AGENCE === '' || cible.KM_AGENCE === undefined || cible.KM_AGENCE === null)
      ? '' : Number(cible.KM_AGENCE),
    origine: origineDevis_(cible.ORIGINE),
    lieuSignature: String(cible.LIEU_SIGNATURE || ''),
    dateSouhaitee: cible.DATE_SOUHAITEE instanceof Date ? isoJour_(cible.DATE_SOUHAITEE)
      : (/^\d{4}-\d{2}-\d{2}/.test(String(cible.DATE_SOUHAITEE || '')) ? String(cible.DATE_SOUHAITEE).slice(0, 10) : ''),
    sansContrat: /^OUI$/i.test(String(cible.SANS_CONTRAT || '').trim()),
    engagement: Number(cible.ENGAGEMENT_MOIS) > 0
      ? { mois: Number(cible.ENGAGEMENT_MOIS), tacite: String(cible.RECONDUCTION || '').toUpperCase() !== 'NON' }
      : null,
    totaux: {
      htPonctuel: Number(cible.TOTAL_HT_PONCTUEL) || 0, htMensuel: Number(cible.TOTAL_HT_MENSUEL) || 0,
      ht: Number(cible.TOTAL_HT) || 0, tva: Number(cible.TOTAL_TVA) || 0, ttc: Number(cible.TOTAL_TTC) || 0
    }
  };

  /* Le PDF ne part que si on le demande : il pèse, et l'écran n'en a besoin
     qu'au moment où le commercial veut le lire. Le classeur va le chercher sur
     le Drive du gérant, dont le commercial n'a pas la clé — c'est pour cela
     que le fichier passe par ici plutôt que par un lien. */
  if (d.pdf) {
    var id = idDrive_(cible.LIEN_PDF);
    if (!id) {
      res.erreurPdf = 'aucun PDF archivé pour ce devis';
    } else {
      try {
        var f = DriveApp.getFileById(id);
        res.pdf = Utilities.base64Encode(f.getBlob().getBytes());
        res.nomFichier = f.getName();
      } catch (ePdf) {
        res.erreurPdf = 'le PDF archivé n\'a pas pu être lu';
      }
    }
  }
  return res;
}

/* ====================== LES NOTIFICATIONS ======================
   Un chantier posé sur le planning n'atteignait le salarié que s'il pensait à
   ouvrir l'application. Ces notifications-là font sonner son téléphone, par
   OneSignal — un service d'envoi, parce qu'un classeur Google ne sait pas
   parler au système de notifications d'un téléphone.

   Deux identifiants, et ils ne vivent pas au même endroit :
   • l'App ID est PUBLIC — il figure dans le code de l'application, que
     n'importe qui peut lire. Il est donc dans les réglages du classeur.
   • la clé d'API est SECRÈTE — qui l'a peut écrire à tous les téléphones
     inscrits. Elle ne doit jamais entrer ici : ce fichier est publié sur un
     dépôt public. Elle vit dans les propriétés du script, posée par le gérant
     lui-même avec « 22. Connecter les notifications ».

   Le salarié est visé par son nom normalisé — « agent 1 » — que l'application
   déclare à OneSignal en s'ouvrant. Le même calcul des deux côtés, sinon le
   message part dans le vide. */
var NOTIF_URL_ = 'https://api.onesignal.com/notifications?c=push';
var NOTIF_CLE_ = 'ONESIGNAL_CLE';

/** L'identifiant sous lequel un téléphone s'est annoncé. */
function notifId_(nom) { return normNom_(nom); }

function notifConfig_() {
  var reg = lireReglages_();
  return {
    app: String(reg.onesignal_app_id || '').trim(),
    cle: String(PropertiesService.getScriptProperties().getProperty(NOTIF_CLE_) || '').trim()
  };
}

/**
 * Fait sonner le téléphone d'une personne. Rend { ok, erreur } et ne lève
 * jamais : une notification qui ne part pas ne doit pas empêcher un chantier
 * d'être planifié. Un échec part au journal, pour qu'il ne passe pas inaperçu.
 */
/* Le service dit-il, d'une manière ou d'une autre, que le message n'a trouvé
   personne ? Un nom qu'il ne connaît pas arrive sous « invalid_aliases », des
   appareils désabonnés sous une phrase anglaise, et les deux viennent avec un
   code 200 : sans cette lecture, un échec passerait pour un envoi. */
function notifPersonne_(rep) {
  if (!rep) return true;
  var e = rep.errors;
  if (!e) return false;
  if (e.invalid_aliases || e.invalid_external_user_ids || e.invalid_player_ids) return true;
  if (e.length) {
    for (var i = 0; i < e.length; i++) {
      if (/not subscribed|no subscribers|invalid/i.test(String(e[i] || ''))) return true;
    }
  }
  return false;
}

/* v105 — plusieurs notifications en même temps (UrlFetchApp.fetchAll) : un
   binôme recevait ses deux mots l'un après l'autre, et le gérant attendait
   les deux allers-retours vers OneSignal avant que sa fiche se ferme.
   liste : [{ nom, titre, texte, lien }] → un résultat par élément. */
function notifierLot_(liste) {
  var c = notifConfig_();
  if (!c.app || !c.cle) return liste.map(function () { return { ok: false, erreur: 'notifications non connectées' }; });
  var req = [], ou = [];
  var res = liste.map(function (m, i) {
    var qui = notifId_(m.nom);
    if (!qui) return { ok: false, erreur: 'personne sans nom' };
    var corps = { app_id: c.app, include_aliases: { external_id: [qui] }, target_channel: 'push',
                  headings: { en: String(m.titre || '') }, contents: { en: String(m.texte || '') } };
    if (m.lien) corps.url = String(m.lien);
    req.push({ url: NOTIF_URL_, method: 'post', contentType: 'application/json',
               headers: { Authorization: 'Key ' + c.cle }, payload: JSON.stringify(corps), muteHttpExceptions: true });
    ou.push(i);
    return null;
  });
  if (!req.length) return res;
  var reps;
  try { reps = UrlFetchApp.fetchAll(req); }
  catch (e) { ou.forEach(function (i) { res[i] = { ok: false, erreur: String(e && e.message || e) }; }); return res; }
  reps.forEach(function (r, k) { res[ou[k]] = lireReponseNotif_(r); });
  return res;
}
function lireReponseNotif_(r) {
  var code = r.getResponseCode(), rep = {};
  try { rep = JSON.parse(r.getContentText() || '{}'); } catch (e) {}
  if (code >= 200 && code < 300) {
    if (notifPersonne_(rep)) return { ok: false, erreur: 'personne inscrit sous ce nom', aucun: true };
    var n = Number(rep.recipients || 0);
    if (rep.id || n) return { ok: true, recus: n, id: String(rep.id || '') };
    return { ok: false, erreur: 'personne inscrit sous ce nom', aucun: true };
  }
  var msg = (rep.errors && rep.errors[0]) ||
            (rep.errors && rep.errors.invalid_aliases ? 'nom inconnu du service' : '') || ('refus ' + code);
  return { ok: false, erreur: String(msg) };
}

function notifier_(nom, titre, texte, lien) {
  /* Un binôme (« MAXIME, VICTOR ») : un message à chacun, envoyés ensemble. */
  var plusieurs = nomsQui_(nom);
  if (plusieurs.length > 1) {
    var r0 = { ok: true };
    notifierLot_(plusieurs.map(function (n1) { return { nom: n1, titre: titre, texte: texte, lien: lien }; }))
      .forEach(function (r1) { if (!r1.ok) r0 = r1; });
    return r0;
  }
  var c = notifConfig_();
  if (!c.app || !c.cle) return { ok: false, erreur: 'notifications non connectées' };
  var qui = notifId_(nom);
  if (!qui) return { ok: false, erreur: 'personne sans nom' };

  var corps = {
    app_id: c.app,
    include_aliases: { external_id: [qui] },
    target_channel: 'push',
    headings: { en: String(titre || '') },
    contents: { en: String(texte || '') }
  };
  if (lien) corps.url = String(lien);

  try {
    var r = UrlFetchApp.fetch(NOTIF_URL_, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Key ' + c.cle },
      payload: JSON.stringify(corps),
      muteHttpExceptions: true
    });
    var code = r.getResponseCode();
    var rep = {};
    try { rep = JSON.parse(r.getContentText() || '{}'); } catch (e) {}
    /* OneSignal répond 200 même quand personne n'est visé. Encore faut-il lire
       la bonne chose : deux générations d'API se croisent ici. L'ancienne
       rendait « recipients » ; celle-ci (?c=push) rend un identifiant de
       message, et signale un nom qu'elle ne connaît pas par
       « errors.invalid_aliases ». Compter « recipients » comme avant faisait
       annoncer « personne n'est inscrit » alors que la notification était bel
       et bien partie — c'est ce qui a fait croire, le 29 octobre, que rien ne
       marchait. */
    if (code >= 200 && code < 300) {
      if (notifPersonne_(rep)) {
        return { ok: false, erreur: 'personne inscrit sous ce nom', aucun: true };
      }
      var n = Number(rep.recipients || 0);
      if (rep.id || n) return { ok: true, recus: n, id: String(rep.id || '') };
      return { ok: false, erreur: 'personne inscrit sous ce nom', aucun: true };
    }
    var msg = (rep.errors && rep.errors[0]) ||
              (rep.errors && rep.errors.invalid_aliases ? 'nom inconnu du service' : '') ||
              ('refus ' + code);
    return { ok: false, erreur: String(msg) };
  } catch (e) {
    return { ok: false, erreur: String(e && e.message || e) };
  }
}

/* Le mot envoyé quand un chantier est posé ou déplacé. Il dit ce qu'il faut
   pour s'organiser, et rien de plus : ni montant, ni code de portail. */
function messageChantier_(nom, ligne, deplace) {
  var d = ligne.DATE ? new Date(ligne.DATE) : null;
  var jour = (d && !isNaN(d.getTime())) ? jourFr_(d) : 'date à caler';
  var h = heureTexte_(ligne.HEURE);
  var ou = [String(ligne.CP || ''), String(ligne.VILLE || '')].filter(String).join(' ').trim();
  return { nom: nom, titre: deplace ? 'Chantier déplacé' : 'Nouveau chantier',
           texte: String(ligne.CLIENT || 'Chantier') + ' — ' + jour + (h ? ' à ' + h : '') + (ou ? ' · ' + ou : '') };
}
function notifierChantier_(nom, ligne, deplace) {
  if (!nom || !ligne) return;
  var d = ligne.DATE ? new Date(ligne.DATE) : null;
  var jour = (d && !isNaN(d.getTime()))
    ? jourFr_(d)
    : 'date à caler';
  var h = heureTexte_(ligne.HEURE);
  var ou = [String(ligne.CP || ''), String(ligne.VILLE || '')].filter(String).join(' ').trim();
  var r = notifier_(nom,
    deplace ? 'Chantier déplacé' : 'Nouveau chantier',
    String(ligne.CLIENT || 'Chantier') + ' — ' + jour + (h ? ' à ' + h : '') +
    (ou ? ' · ' + ou : ''));
  if (!r.ok && !r.aucun) {
    tracerServeur_(nom, 'NOTIFICATION RATEE', String(r.erreur || ''),
                   String(ligne.NUMERO || ''), '');
  }
  return r;
}

/* ---- le menu ---- */
function connecterNotifications() {
  var ui = SpreadsheetApp.getUi();
  var reg = lireReglages_();

  var r1 = ui.prompt('Notifications (1/2) — l\'App ID',
    'Colle l\'App ID de ton application OneSignal.\n\n' +
    'Il se lit dans OneSignal : Paramètres → Clés et identifiants.\n' +
    'Ce n\'est pas un secret : il figure déjà dans le code de l\'application.\n\n' +
    (reg.onesignal_app_id ? 'Actuel : ' + reg.onesignal_app_id : ''),
    ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var app = String(r1.getResponseText() || '').trim();

  var r2 = ui.prompt('Notifications (2/2) — la clé d\'API',
    'Colle la clé d\'API REST (même page, « Clé API »).\n\n' +
    'Celle-ci EST un secret : elle ne sera écrite ni dans le classeur ni dans ' +
    'le code, mais dans les propriétés du script, que toi seul peux lire.',
    ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var cle = String(r2.getResponseText() || '').trim();

  if (!app || !cle) { ui.alert('Il manque l\'un des deux. Rien n\'a été enregistré.'); return; }
  ecrireReglage_('onesignal_app_id', app);
  PropertiesService.getScriptProperties().setProperty(NOTIF_CLE_, cle);
  ui.alert('Notifications connectées.\n\n' +
    'Chaque personne doit encore ouvrir l\'application et accepter les ' +
    'notifications sur son téléphone. Sur iPhone, l\'application doit d\'abord ' +
    'être ajoutée à l\'écran d\'accueil.\n\n' +
    'Essaie ensuite avec « 23. Tester une notification ».');
}

function testerNotification() {
  var ui = SpreadsheetApp.getUi();
  var c = notifConfig_();
  if (!c.app || !c.cle) {
    return ui.alert('Rien à essayer : lance d\'abord « 22. Connecter les notifications ».');
  }
  var r = ui.prompt('Tester une notification',
    'À quel nom ? Écris-le comme dans l\'onglet COMMERCIAUX, PRESTATAIRES ou ADMINS.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var nom = String(r.getResponseText() || '').trim();
  if (!nom) return;

  var res = notifier_(nom, 'Essai', 'Si tu lis ceci, les notifications marchent.');
  if (res.ok) {
    ui.alert(res.recus
      ? 'Partie à ' + res.recus + ' téléphone' + (res.recus > 1 ? 's' : '') + '.'
      : 'Partie. Le service ne dit plus combien de téléphones l\'ont reçue : ' +
        'pour le compte exact, regarde « Messages » sur le tableau de bord OneSignal.');
  } else if (res.aucun) {
    ui.alert('Personne n\'est inscrit sous « ' + nom + ' ».\n\n' +
      'Cette personne doit ouvrir l\'application, se connecter sous ce nom, ' +
      'puis accepter les notifications.\n' +
      'Sur iPhone : ajouter d\'abord l\'application à l\'écran d\'accueil.');
  } else {
    ui.alert('Échec : ' + res.erreur);
  }
}

function oublierNotifications() {
  var ui = SpreadsheetApp.getUi();
  var rep = ui.alert('Oublier la clé des notifications ?',
    'Plus aucune notification ne partira tant que tu n\'auras pas reconnecté. ' +
    'L\'App ID, lui, reste dans les réglages.', ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().deleteProperty(NOTIF_CLE_);
  ui.alert('Clé oubliée.');
}

/* ====================== PENNYLANE ======================
   Décision de Simon, 7 novembre 2026 : les factures se feront désormais dans
   Pennylane, plus dans Henrri. Le plan Essentiel ouvre l'API de la société
   (jeton « Company API », v2).

   Ce bloc ne pose que la liaison : brancher le jeton, l'essayer, l'oublier.
   Il ne crée ni client ni facture. Le jeton est un secret : il vit dans les
   propriétés du script, jamais dans ce fichier (le dépôt GitHub est public),
   jamais dans une cellule, jamais au journal. */

var PENNYLANE_CLE_ = 'PENNYLANE_JETON';
var PENNYLANE_API_ = 'https://app.pennylane.com/api/external/v2';

function pennylaneJeton_() {
  return String(PropertiesService.getScriptProperties().getProperty(PENNYLANE_CLE_) || '').trim();
}

/**
 * Un appel à l'API Pennylane. Rend toujours un objet, ne lève jamais :
 * { ok, code, data, erreur }. Le jeton ne ressort dans aucune réponse.
 */
function pennylaneAppel_(methode, chemin, corps) {
  var jeton = pennylaneJeton_();
  if (!jeton) return { ok: false, code: 0, data: null, erreur: 'Pennylane n\'est pas connecté' };
  var opt = {
    method: String(methode || 'get').toLowerCase(),
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + jeton, Accept: 'application/json' }
  };
  if (corps !== undefined && corps !== null) {
    opt.contentType = 'application/json';
    opt.payload = JSON.stringify(corps);
  }
  var rep;
  try {
    rep = UrlFetchApp.fetch(PENNYLANE_API_ + chemin, opt);
  } catch (e) {
    return { ok: false, code: 0, data: null,
             erreur: 'Pennylane ne répond pas (' + String(e && e.message || e).replace(jeton, '…') + ')' };
  }
  var code = rep.getResponseCode(), txt = rep.getContentText() || '', data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (eJ) { data = null; }
  if (code >= 200 && code < 300) return { ok: true, code: code, data: data, erreur: '' };
  var msg = (data && (data.message || data.error || (data.errors && JSON.stringify(data.errors)))) ||
            txt.slice(0, 200);
  if (code === 401) msg = 'jeton refusé (expiré, supprimé ou mal copié)';
  if (code === 403) msg = 'le jeton n\'a pas le droit de faire cela (portée manquante)' +
                          (msg ? ' — ' + msg : '');
  if (code === 429) msg = 'trop de demandes d\'un coup, réessaie dans quelques secondes';
  return { ok: false, code: code, data: data, erreur: String(msg || ('erreur ' + code)).replace(jeton, '…') };
}

/** Ce que l'API dit d'elle-même : la société, l'utilisateur, les portées. */
function pennylaneQuiSuisJe_() {
  var r = pennylaneAppel_('get', '/me');
  if (!r.ok) return r;
  var d = r.data || {};
  var soc = d.company || {}, u = d.user || {};
  return { ok: true, societe: String(soc.name || ''), idSociete: soc.id || '',
           siren: String(soc.reg_no || ''), utilisateur: [u.first_name, u.last_name].filter(String).join(' ') ||
           String(u.email || ''), portees: d.scopes || [] };
}

function connecterPennylane() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Connecter Pennylane',
    'Dans Pennylane : Paramètres → Connectivité → Développeurs → « Générer un token API ».\n' +
    'Nom conseillé : « Appli devis BB ». Coche en lecture ET écriture au moins : ' +
    'clients (customers), factures clients (customer invoices) et produits ; ' +
    'pas de date d\'expiration.\n\n' +
    'Pennylane ne montre le jeton qu\'une fois : colle-le ici.\n' +
    'Il sera rangé dans les propriétés du script, que toi seul peux lire — ' +
    'ni dans le classeur, ni dans le code.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var jeton = String(r.getResponseText() || '').replace(/^Bearer\s+/i, '').trim();
  if (!jeton) { ui.alert('Rien n\'a été collé. Rien n\'a été enregistré.'); return; }

  var props = PropertiesService.getScriptProperties();
  var ancien = props.getProperty(PENNYLANE_CLE_);
  props.setProperty(PENNYLANE_CLE_, jeton);
  var q = pennylaneQuiSuisJe_();
  if (!q.ok) {
    /* Un jeton refusé n'écrase pas celui qui marchait. */
    if (ancien) props.setProperty(PENNYLANE_CLE_, ancien); else props.deleteProperty(PENNYLANE_CLE_);
    ui.alert('Pennylane a refusé ce jeton : ' + q.erreur + '.\n\nRien n\'a été changé.');
    return;
  }
  tracerServeur_('SYSTEME', 'PENNYLANE CONNECTE', q.societe, '', '');
  ui.alert('Pennylane est connecté.\n\nSociété : ' + q.societe +
    (q.siren ? ' (SIREN ' + q.siren + ')' : '') +
    '\n\nLance « 26. Tester la connexion Pennylane » pour voir ce que le jeton a le droit de faire.');
}

/**
 * L'essai : qui suis-je, puis une lecture des clients et des factures. Ne
 * crée rien et n'envoie rien.
 */
function essaiPennylane_() {
  var out = { ok: false, lignes: [] };
  if (!pennylaneJeton_()) { out.lignes.push('Pennylane n\'est pas connecté : lance d\'abord le menu 25.'); return out; }
  var q = pennylaneQuiSuisJe_();
  if (!q.ok) { out.lignes.push('Connexion refusée : ' + q.erreur); return out; }
  out.ok = true;
  out.lignes.push('Connecté à : ' + q.societe + (q.siren ? ' (SIREN ' + q.siren + ')' : ''));
  if (q.utilisateur) out.lignes.push('Jeton créé par : ' + q.utilisateur);
  if (q.portees && q.portees.length) out.lignes.push('Droits : ' + q.portees.join(', '));

  var essais = [
    { mot: 'Clients', chemin: '/customers?limit=3' },
    { mot: 'Factures clients', chemin: '/customer_invoices?limit=3' },
    { mot: 'Produits', chemin: '/products?limit=3' }
  ];
  essais.forEach(function (e) {
    var r = pennylaneAppel_('get', e.chemin);
    if (!r.ok) { out.lignes.push('✗ ' + e.mot + ' : ' + r.erreur); out.manque = true; return; }
    var items = (r.data && (r.data.items || r.data.data)) || [];
    out.lignes.push('✓ ' + e.mot + ' : lecture possible' +
      (items.length ? ' (ex. ' + items.slice(0, 3).map(function (x) {
        return String(x.label || x.name || x.invoice_number || x.id || '');
      }).filter(String).join(', ') + ')' : ' (aucun pour l\'instant)'));
  });
  return out;
}

function testerPennylane() {
  var ui = SpreadsheetApp.getUi();
  var r = essaiPennylane_();
  ui.alert(r.ok ? 'Pennylane répond' : 'Pennylane ne répond pas comme prévu',
    r.lignes.join('\n') +
    (r.manque ? '\n\nUne lecture refusée veut dire qu\'une case manquait à la création du jeton : ' +
      'regénère-en un avec ces droits, puis relance le menu 25.' : '') +
    '\n\nCet essai ne crée et n\'envoie rien.', ui.ButtonSet.OK);
}

function oublierPennylane() {
  var ui = SpreadsheetApp.getUi();
  var rep = ui.alert('Oublier la clé Pennylane ?',
    'Le classeur ne pourra plus rien préparer dans Pennylane tant que tu n\'auras pas reconnecté. ' +
    'Pour couper vraiment le jeton, supprime-le aussi dans Pennylane (Développeurs).', ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().deleteProperty(PENNYLANE_CLE_);
  tracerServeur_('SYSTEME', 'PENNYLANE OUBLIE', '', '', '');
  ui.alert('Clé oubliée.');
}

/* ====================== LES BROUILLONS DE FACTURE DANS PENNYLANE ======================
   Demande de Simon, 7 novembre 2026. Ce que le module fait, et ne fait pas :

   — un chantier ponctuel terminé (tous ses passages pointés FAIT) devient une
     facture BROUILLON dans Pennylane, avec les lignes du devis signé ;
   — chaque contrat d'entretien devient, une fois par mois, une facture
     BROUILLON au forfait lissé sur 52 semaines, avec la phrase qui l'explique
     au client (« 1 passage par semaine × 52 semaines ÷ 12 mois = 4,33
     passages par mois en moyenne ») ;
   — rien n'est finalisé, rien n'est envoyé. Simon relit et valide dans
     Pennylane. L'envoi automatique n'existe pas dans ce code : il viendra
     quand ses associés seront prévenus.

   Les contrats se lisent dans l'onglet CONTRATS, une ligne par prestation
   facturée (LE LOCAL en a trois : les locaux du lundi, ceux du jeudi, les
   vitrages). Le menu 28 le remplit à partir des notes de RECURRENTS, sans
   jamais écraser ce que Simon y a corrigé.

   Un doublon est impossible deux fois : la ligne de FACTURES, et la
   référence externe (BB-…) que Pennylane refuse de voir deux fois et qu'on
   cherche avant de créer. */

var SH_CONTRATS_ = 'CONTRATS';
var ENTETES_CONTRATS_ = [
  'CONTRAT', 'LIGNE', 'MENSUEL_HT', 'TVA', 'RYTHME', 'SERIES', 'ACTIF',
  'CLIENT_FACTURE', 'SIREN', 'EMAIL', 'ADRESSE', 'CP', 'VILLE', 'PARTICULIER',
  'ID_PENNYLANE', 'NOTE'
];

/** Le taux de TVA tel que Pennylane le nomme. */
function pennylaneTva_(taux) {
  var t = Math.round((Number(String(taux).replace(',', '.')) || 0) * 10) / 10;
  if (t === 20) return 'FR_200';
  if (t === 10) return 'FR_100';
  if (t === 5.5) return 'FR_55';
  if (t === 2.1) return 'FR_21';
  if (t === 0) return 'exempt';
  throw new Error('taux de TVA inconnu : ' + taux + ' %');
}

/** Un nombre écrit à la française, deux décimales au plus : 4,33. */
function nbFr_(x) {
  var n = Math.round(Number(x) * 100) / 100;
  return String(n).replace('.', ',');
}
function prixApi_(x) { return (Math.round(Number(x) * 100) / 100).toFixed(2); }
function sansAccent_(s) {
  return String(s || '').toUpperCase()
    .replace(/[ÀÂÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÎÏ]/g, 'I')
    .replace(/[ÔÖ]/g, 'O').replace(/[ÙÛÜ]/g, 'U').replace(/Ç/g, 'C');
}
function slugRef_(s) {
  return sansAccent_(s).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

/** Une liste Pennylane, filtrée : [{field, operator, value}]. */
function pennylaneListe_(chemin, filtre, limite) {
  var q = '?limit=' + (limite || 20) +
          (filtre ? '&filter=' + encodeURIComponent(JSON.stringify(filtre)) : '');
  var r = pennylaneAppel_('get', chemin + q);
  if (!r.ok) throw new Error('Pennylane : ' + r.erreur);
  return (r.data && r.data.items) || [];
}

/**
 * Retrouve le client dans Pennylane, ou le crée. L'ordre : l'identifiant déjà
 * connu, puis le SIREN (deux sociétés peuvent avoir le même nom, jamais le
 * même SIREN), puis le nom exact, puis le nom sans accents ni casse.
 * c = { nom, siren, email, adresse, cp, ville, particulier, idConnu }
 */
function pennylaneClient_(c) {
  var nom = String(c.nom || '').trim();
  if (!nom) throw new Error('le client n\'a pas de nom');
  if (c.idConnu) return { id: Number(c.idConnu), neuf: false };
  var siren = String(c.siren || '').replace(/\D/g, '').slice(0, 9);

  if (siren.length === 9) {
    var parSiren = pennylaneListe_('/customers', [{ field: 'reg_no', operator: 'eq', value: siren }], 5);
    if (parSiren.length) return { id: Number(parSiren[0].id), neuf: false };
  }
  var exact = pennylaneListe_('/customers', [{ field: 'name', operator: 'eq', value: nom }], 5);
  if (exact.length) return { id: Number(exact[0].id), neuf: false };
  /* Le nom sans accents ni casse : « ÉTANCHÉITÉ » au classeur, « ETANCHEITE »
     chez le comptable. On cherche par le premier mot, écrit des deux façons. */
  var debut = nom.split(/\s+/)[0];
  if (debut.length >= 3) {
    var cible = sansAccent_(nom).replace(/[^A-Z0-9]/g, '');
    var essais = [debut];
    if (sansAccent_(debut) !== debut) essais.push(sansAccent_(debut));
    for (var e = 0; e < essais.length; e++) {
      var proches = pennylaneListe_('/customers', [{ field: 'name', operator: 'start_with', value: essais[e] }], 50);
      for (var i = 0; i < proches.length; i++) {
        if (sansAccent_(proches[i].name).replace(/[^A-Z0-9]/g, '') === cible) {
          return { id: Number(proches[i].id), neuf: false };
        }
      }
    }
  }

  var adresse = String(c.adresse || '').trim(), cp = String(c.cp || '').trim(), ville = String(c.ville || '').trim();
  if (!adresse || !cp || !ville) {
    throw new Error('il manque l\'adresse de facturation de ' + nom + ' (adresse, code postal et ville)');
  }
  var corps = { billing_address: { address: adresse, postal_code: cp, city: ville, country_alpha2: 'FR' },
                payment_conditions: 'upon_receipt' };
  var mail = String(c.email || '').trim();
  if (mail) corps.emails = [mail];
  var r;
  if (c.particulier) {
    var mots = nom.replace(/^(M\.|MME|MR|MONSIEUR|MADAME)\s+/i, '').split(/\s+/);
    corps.first_name = mots.length > 1 ? mots[0] : '-';
    corps.last_name = mots.length > 1 ? mots.slice(1).join(' ') : mots[0];
    r = pennylaneAppel_('post', '/individual_customers', corps);
  } else {
    corps.name = nom;
    if (siren.length === 9) corps.reg_no = siren;
    r = pennylaneAppel_('post', '/company_customers', corps);
  }
  if (!r.ok || !r.data || !r.data.id) throw new Error('création du client refusée : ' + r.erreur);
  return { id: Number(r.data.id), neuf: true };
}

/** Le texte de bas de facture : comment payer. */
function piedFacture_() {
  var reg = lireReglages_();
  var iban = String(reg.banque_iban || '').trim(), bic = String(reg.banque_bic || '').trim();
  return 'Règlement par chèque ou par virement' +
    (iban ? ' — IBAN ' + iban + (bic ? ' · BIC ' + bic : '') : '') + '.';
}

/**
 * Crée un brouillon de facture, ou rend celui qui existe déjà sous cette
 * référence. o = { client:{…}, ref, sujet, description, lignes:[{libelle,
 * prix, tva, qte, detail}] }
 */
function pennylaneBrouillon_(o) {
  var deja = pennylaneListe_('/customer_invoices', [{ field: 'external_reference', operator: 'eq', value: o.ref }], 1);
  if (deja.length) return { deja: true, facture: deja[0], client: null };
  var client = pennylaneClient_(o.client);
  var reg = lireReglages_();
  var jours = Number(reg.delai_paiement_jours);
  if (!(jours >= 0)) jours = 30;
  var auj = new Date();
  var corps = {
    draft: true, customer_id: client.id,
    date: iso10_(auj), deadline: iso10_(new Date(auj.getTime() + jours * 86400000)),
    external_reference: o.ref, currency: 'EUR', language: 'fr_FR', sale_type: 'services',
    pdf_invoice_subject: o.sujet, pdf_invoice_free_text: piedFacture_(),
    invoice_lines: o.lignes.map(function (l) {
      var x = { label: String(l.libelle).slice(0, 500), quantity: Number(l.qte) || 1,
                raw_currency_unit_price: prixApi_(l.prix), unit: 'piece', vat_rate: pennylaneTva_(l.tva) };
      if (l.detail) x.description = String(l.detail).slice(0, 2000);
      return x;
    })
  };
  if (o.description) corps.pdf_description = String(o.description).slice(0, 5000);
  var r = pennylaneAppel_('post', '/customer_invoices', corps);
  if (!r.ok || !r.data || !r.data.id) throw new Error('facture refusée par Pennylane : ' + r.erreur);
  return { deja: false, facture: r.data, client: client };
}

function totauxPennylane_(f) {
  var ht = Number(f.currency_amount_before_tax || f.amount_before_tax || 0);
  var tva = Number(f.currency_tax || f.tax || 0);
  var ttc = Number(f.currency_amount || f.amount || 0);
  return { ht: ht, tva: tva, ttc: ttc };
}

/* ---------------- le ponctuel ---------------- */

function preparerFacturePennylane_(d, com) {
  var num = String(d.numero || '').trim();
  var devis = null;
  lireDevis_().forEach(function (x) { if (String(x.NUMERO || '').trim() === num) devis = x; });
  if (!devis) return { ok: false, erreur: 'Devis ' + num + ' introuvable.' };
  if (String(devis.STATUT || '').toUpperCase() !== 'SIGNE') {
    return { ok: false, erreur: 'Le devis ' + num + ' n\'est pas signé.' };
  }
  if (recurrentDevis_(devis.NATURE, devis.PASSAGES_MOIS, devis.SANS_CONTRAT)) {
    return { ok: false, erreur: 'C\'est un contrat d\'entretien : il se facture chaque mois depuis ' +
                                'l\'onglet CONTRATS (menu 29), pas ici.' };
  }
  if ((facturesFaites_()[num] || {})['']) {
    var dj = facturesFaites_()[num][''];
    return { ok: false, deja: true, erreur: 'Déjà préparée (brouillon Pennylane ' +
             String(dj.ID_PENNYLANE || dj.ID_HENRRI) + ').' };
  }
  var vu = null;
  etatFacturation_('').ponctuels.forEach(function (x) { if (x.numero === num) vu = x; });
  if (vu && !vu.pret && !d.force) {
    return { ok: false, pasPret: true,
             erreur: vu.chantiers === 0 ? 'Aucun passage n\'est encore posé au planning pour ce devis.'
               : 'Il reste ' + (vu.chantiers - vu.faits) + ' passage(s) non terminé(s) sur ' + vu.chantiers + '.' };
  }
  var lignes = (lignesParDevis_()[num] || []).slice().sort(function (a, b) {
    return (Number(a.ORDRE) || 0) - (Number(b.ORDRE) || 0);
  });
  if (!lignes.length) return { ok: false, erreur: 'Ce devis n\'a aucune ligne de prestation.' };
  var attendu = 0;
  lignes.forEach(function (l) { attendu += Number(l.TOTAL_HT) || 0; });
  attendu = Math.round(attendu * 100) / 100;

  var res = null, erreur = '';
  try {
    res = pennylaneBrouillon_({
      ref: 'BB-' + num,
      client: { nom: String(devis.CLIENT || ''), siren: devis.SIRET_CLIENT, email: devis.EMAIL,
                adresse: devis.ADRESSE, cp: devis.CP, ville: devis.VILLE,
                particulier: String(devis.TYPE_CLIENT || '').toUpperCase().indexOf('PART') === 0 },
      sujet: 'Facture — ' + String(devis.OBJET || 'prestation de nettoyage').slice(0, 120),
      description: 'Prestation réalisée selon le devis ' + num +
        (devis.SIGNATAIRE ? ', signé par ' + String(devis.SIGNATAIRE) : '') + '.',
      lignes: lignes.map(function (l) {
        return { libelle: libelleFacture_(l, false, ''), prix: Number(l.TOTAL_HT) || 0, tva: Number(l.TVA) || 0, qte: 1 };
      })
    });
  } catch (e) { erreur = String(e && e.message || e); }
  return finirFacturePennylane_(res, erreur, {
    num: num, client: String(devis.CLIENT || ''), type: 'PONCTUEL', periode: '', passages: 1,
    attendu: attendu, com: com, appareil: d.appareil, force: d.force && vu && !vu.pret
  });
}

/* ====================== v108o — LES ÉLÉMENTS DE PAIE PARTENT TOUT SEULS ======================
   Simon, 11 novembre 2026 : « pour la paie oui » — chaque début de mois, les
   éléments variables du mois écoulé (jours d'absence des salariés, commission
   brute des commerciaux, pas le détail des heures) partent par mail au
   cabinet comptable, depuis contact@. Le 1er à partir de 9 h ; les 2 et 3
   rattrapent un envoi raté. Destinataire : réglage paie_email (Lexia) ; tant
   qu'il est vide, le mail va à contact@ pour être transféré. Réglage
   paie_envoi_auto = NON pour couper. */
function envoyerPaieAuto_(maintenant) {
  var now = maintenant || new Date();
  var j = now.getDate();
  if (j > 3 || (j === 1 && now.getHours() < 9)) return { envoye: false };
  var reg = lireReglages_();
  if (/^(non|no|0|off)$/i.test(String(reg.paie_envoi_auto || '').trim())) return { envoye: false, motif: 'coupé' };
  var prec = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  var mois = Utilities.formatDate(prec, 'Europe/Paris', 'yyyy-MM');
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('PAIE_ENVOYEE_' + mois)) return { envoye: false, motif: 'déjà fait' };
  var p = elementsPaie_({ mois: mois });
  var maison = String(reg.email_expediteur || 'contact@breizhbrillance.fr').trim();
  var dest = String(reg.paie_email || '').trim();
  var verifie = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dest);
  var lisible = function (iso) { var x = String(iso || '').split('-'); return x.length === 3 ? x[2] + '/' + x[1] : iso; };
  var per = function (q) { return q.du === q.au ? 'le ' + lisible(q.du) : 'du ' + lisible(q.du) + ' au ' + lisible(q.au); };
  var t = 'Bonjour,\n\nVoici les éléments variables de paie de BREIZH BRILLANCE pour ' + moisLisible_(mois) + '.\n\n' +
    'Salariés — jours d\'absence (jours ouvrables) :\n';
  (p.salaries || []).forEach(function (x) {
    t += '- ' + x.nom + ' : ' + x.jours + ' jour' + (x.jours > 1 ? 's' : '') +
      ((x.periodes || []).length ? ' (' + x.periodes.map(per).join(', ') + ')' : '') + '\n';
  });
  if ((p.fermetures || []).length) t += '- Fermeture de l\'entreprise : ' + p.fermetures.map(per).join(', ') + ' (comptée pour chacun)\n';
  t += '\nCommerciaux — commission brute du mois :\n';
  t += (p.commerciaux || []).length
    ? p.commerciaux.map(function (c) { return '- ' + c.nom + ' : ' + eur_(Number(c.commission) || 0); }).join('\n')
    : '- aucune commission';
  t += '\n\nBonne journée,';
  envoyerMail_({
    to: verifie ? dest : maison,
    bcc: verifie ? maison : '',
    subject: (verifie ? '' : '[À transmettre au comptable] ') + 'Éléments de paie — ' + moisLisible_(mois) + ' — BREIZH BRILLANCE',
    name: String(reg.societe_nom || 'BREIZH BRILLANCE'),
    htmlBody: corpsMailPerso_(null, t, reg)
  }, reg);
  props.setProperty('PAIE_ENVOYEE_' + mois, new Date().toISOString());
  tracerServeur_('SYSTEME', 'ELEMENTS DE PAIE ENVOYES', moisLisible_(mois) + ' · à ' + (verifie ? dest : maison + ' (réglage paie_email vide)'), '', '');
  return { envoye: true, a: verifie ? dest : maison, mois: mois };
}
/* ====================== v108o — LES FACTURES PARTENT TOUTES SEULES ======================
   Simon, 11 novembre 2026 : « factures envoyées seules, je suis d'accord » —
   et : « beaucoup de devis n'ont pas été signés via l'appli ; à partir
   d'aujourd'hui on fait tout avec l'appli ». Donc :
   - seuls les devis SIGNÉS DANS L'APPLI à partir du réglage
     factures_auto_depuis (11/11/2026 par défaut) partent tout seuls ; tout le
     reste (anciens devis, prix lu dans une note, contrats venus de Henrri)
     reste en brouillon, comme avant, à vérifier à la main ;
   - il faut une adresse e-mail et aucun écart entre Pennylane et le devis ;
   - la facture est FINALISÉE dans Pennylane (numéro définitif), puis le PDF
     part par mail depuis contact@, au texte habituel ;
   - réglage factures_envoi_auto = NON pour tout couper.
   Une facture finalisée ne s'efface plus : elle ne se corrige que par un
   avoir. C'est pourquoi chaque condition qui manque laisse le brouillon et
   l'écrit au journal (FACTURE LAISSEE EN BROUILLON) plutôt que d'envoyer. */
function devisDuContrat_(lignesContrat) {
  var ids = [];
  (lignesContrat || []).forEach(function (l) {
    String(l.SERIES || '').split(/[\s,;]+/).forEach(function (x) { x = x.trim(); if (x) ids.push(x); });
  });
  if (!ids.length) return '';
  var trouve = '';
  objetsDe_(SH.RECURRENTS).forEach(function (r) {
    if (!trouve && ids.indexOf(String(r.ID || '').trim()) >= 0 && String(r.DEVIS || '').trim()) trouve = String(r.DEVIS).trim();
  });
  return trouve;
}

function envoiAutoFacture_(r, numDevis, ctx) {
  var reg = lireReglages_();
  if (/^(non|no|0|off)$/i.test(String(reg.factures_envoi_auto || '').trim())) return { envoye: false, motif: 'coupé' };
  var motif = '';
  var devis = null;
  if (numDevis) lireDevis_().forEach(function (x) { if (String(x.NUMERO || '').trim() === String(numDevis).trim()) devis = x; });
  var depuis = new Date(String(reg.factures_auto_depuis || '2026-11-11') + 'T00:00:00');
  if (isNaN(depuis.getTime())) depuis = new Date(2026, 10, 11);
  if (!devis) motif = 'pas de devis signé dans l\'appli';
  else if (String(devis.STATUT || '').toUpperCase() !== 'SIGNE') motif = 'devis non signé';
  else if (!(devis.DATE instanceof Date) || devis.DATE < depuis) motif = 'devis antérieur au ' + Utilities.formatDate(depuis, 'Europe/Paris', 'dd/MM/yyyy');
  var email = String((ctx && ctx.email) || (devis && devis.EMAIL) || '').trim();
  if (!motif && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) motif = 'pas d\'adresse e-mail';
  if (!motif && r.ecart) motif = 'écart de montant : ' + r.ecart;
  if (!motif && !r.idPennylane) motif = 'identifiant Pennylane manquant';
  var client = String((ctx && ctx.contrat) || (devis && devis.CLIENT) || '');
  if (motif) {
    tracerServeur_('SYSTEME', 'FACTURE LAISSEE EN BROUILLON', client + ' · ' + motif, numDevis || '', '');
    return { envoye: false, motif: motif };
  }
  return envoyerFactureFinale_(r, email, client, numDevis, ctx, devis, null, reg);
}

/* Finalise le brouillon Pennylane, récupère le PDF et l'envoie au client.
   mail = { sujet, texte, ton } quand le gérant a choisi son texte (envoi à la
   main depuis l'onglet Factures) ; sinon le texte de Simon, au tu si le devis
   a été envoyé au tu. */
function envoyerFactureFinale_(r, email, client, numDevis, ctx, devis, mail, reg) {
  reg = reg || lireReglages_();
  var id = encodeURIComponent(String(r.idPennylane));
  var fin = pennylaneAppel_('put', '/customer_invoices/' + id + '/finalize');
  if (!fin.ok) {
    tracerServeur_('SYSTEME', 'FACTURE LAISSEE EN BROUILLON', client + ' · finalisation refusée : ' + fin.erreur, numDevis || '', '');
    return { envoye: false, motif: fin.erreur };
  }
  var f = fin.data || {}, url = '';
  for (var essai = 0; essai < 5; essai++) {
    url = String(f.public_file_url || f.file_url || f.pdf_url || '');
    if (url && f.invoice_number) break;
    Utilities.sleep(3000);
    var g = pennylaneAppel_('get', '/customer_invoices/' + id);
    if (g.ok && g.data) f = g.data;
  }
  var numero = String(f.invoice_number || '');
  var ttc = Number(f.currency_amount || f.amount || r.ttc || 0);
  var pieces = [];
  if (url) {
    try {
      var rep = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      if (rep.getResponseCode() === 200) pieces.push(rep.getBlob().setName('Facture-' + (numero || r.idPennylane) + '.pdf'));
    } catch (eP) {}
  }
  if (!pieces.length) {
    majEtatFacture_(r.idPennylane, 'FINALISEE — PDF À ENVOYER', numero, 'PDF introuvable chez Pennylane : à envoyer à la main.');
    tracerServeur_('SYSTEME', 'FACTURE FINALISEE SANS ENVOI', client + ' · ' + numero + ' · PDF introuvable', numDevis || '', '');
    return { envoye: false, finalisee: true, motif: 'PDF introuvable' };
  }
  var contrat = !!(ctx && (ctx.mois || ctx.contrat));
  var tu = false;   // v108t — « que du vouvoiement, c'est plus simple »
  var texte = (mail && String(mail.texte || '').trim()) || texteFacture_(contrat, tu, reg);
  var sujet = (mail && String(mail.sujet || '').trim()) ||
    ('Votre facture ' + (numero ? 'n° ' + numero + ' ' : '') + '— ' + String(reg.societe_nom || 'BREIZH BRILLANCE'));
  envoyerMail_({
    to: email,
    subject: sujet,
    name: String(reg.societe_nom || 'BREIZH BRILLANCE'),
    htmlBody: corpsMailPerso_(null, texte, reg),
    attachments: pieces
  }, reg);
  majEtatFacture_(r.idPennylane, 'ENVOYEE', numero, 'envoyée à ' + email + ' le ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm') +
    (mail && mail.texte ? ' (texte choisi)' : ''));
  tracerServeur_(mail ? 'GERANT' : 'SYSTEME', 'FACTURE ENVOYEE', client + ' · ' + numero + ' · ' + (ttc ? eur_(ttc) + ' TTC · ' : '') + email, numDevis || '', '');
  return { envoye: true, numero: numero, a: email };
}

/* v108s — l'onglet Factures : « Envoyer par mail » sur un brouillon Pennylane,
   avec le texte choisi (vous / tu / personnalisé). */
function envoyerFactureMain_(d, com) {
  var idP = String(d.idPennylane || '').trim();
  if (!idP) return { ok: false, erreur: 'facture Pennylane inconnue' };
  var a = String(d.a || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) return { ok: false, sansEmail: true, erreur: 'adresse e-mail du client manquante ou invalide' };
  var ligne = null;
  objetsDe_(SH.FACTURES).forEach(function (o) { if (String(o.ID_PENNYLANE || '').trim() === idP) ligne = o; });
  if (!ligne) return { ok: false, erreur: 'cette facture n\'est pas dans l\'onglet FACTURES' };
  if (/ENVOYEE/i.test(String(ligne.ETAT || ''))) return { ok: false, erreur: 'cette facture est déjà envoyée' };
  var numDevis = String(ligne.NUMERO_DEVIS || '').trim();
  var devis = numDevis ? devisParNumero_(numDevis) : null;
  var contrat = /CONTRAT/i.test(String(ligne.TYPE || ''));
  var r = { idPennylane: idP, ttc: num_(ligne.TOTAL_TTC) };
  var out = envoyerFactureFinale_(r, a, String(ligne.CLIENT || ''), numDevis, contrat ? { contrat: String(ligne.CLIENT || ''), mois: String(ligne.PERIODE || '') } : null,
                                  devis, { sujet: d.sujet, texte: d.texte, ton: d.ton });
  if (out.envoye && devis) noterTonDevis_(String(devis.NUMERO).trim(), /^tu$/i.test(String(d.ton || '')) ? 'TU' : (/^vous$/i.test(String(d.ton || '')) ? 'VOUS' : 'PERSO'));
  return { ok: !!out.envoye, envoye: !!out.envoye, numero: out.numero || '', a: a, erreur: out.envoye ? '' : (out.motif || 'envoi impossible'), finalisee: !!out.finalisee };
}

function majEtatFacture_(idPennylane, etat, numero, note) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.FACTURES);
  if (!sh || sh.getLastRow() < 2) return;
  var v = sh.getDataRange().getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var iId = en.indexOf('ID_PENNYLANE'), iE = en.indexOf('ETAT'), iN = en.indexOf('NUMERO_FACTURE'), iNo = en.indexOf('NOTE');
  for (var i = v.length - 1; i >= 1; i--) {
    if (String(v[i][iId] || '').trim() !== String(idPennylane)) continue;
    if (iE >= 0) sh.getRange(i + 1, iE + 1).setValue(etat);
    if (iN >= 0 && numero) sh.getRange(i + 1, iN + 1).setValue(numero);
    if (iNo >= 0 && note) sh.getRange(i + 1, iNo + 1).setValue(note);
    return;
  }
}
/** Écrit la ligne de FACTURES et le journal, et rend la réponse. */
function finirFacturePennylane_(res, erreur, x) {
  var f = res && res.facture || {}, tot = res ? totauxPennylane_(f) : { ht: 0, tva: 0, ttc: 0 };
  var ecart = (res && tot.ht && Math.abs(tot.ht - x.attendu) >= 0.01)
    ? 'Pennylane compte ' + nb_(tot.ht) + ' € HT, attendu ' + nb_(x.attendu) + ' €' : '';
  if (!(res && res.deja)) {
    ecrireFacture_({
      CREE_LE: new Date(), NUMERO_DEVIS: x.num, CLIENT: x.client, TYPE: x.type, PERIODE: x.periode,
      PASSAGES: x.passages, TOTAL_HT: tot.ht || x.attendu, TOTAL_TVA: tot.tva, TOTAL_TTC: tot.ttc,
      ID_PENNYLANE: f.id || '', ID_CLIENT_PENNYLANE: res && res.client ? res.client.id : '',
      NUMERO_FACTURE: f.invoice_number || '',
      ETAT: erreur ? 'ECHEC' : 'BROUILLON PENNYLANE', ECART: ecart,
      CREE_PAR: x.com ? x.com.nom : 'AUTOMATIQUE',
      NOTE: erreur ? erreur.slice(0, 400) : (x.force ? 'préparée avant la fin du chantier' : '')
    });
  }
  if (erreur) {
    tracerServeur_(x.com ? x.com.nom : 'SYSTEME', 'FACTURE EN ECHEC', x.client + ' · ' + erreur.slice(0, 200),
                   x.num, x.appareil || '');
    return { ok: false, erreur: erreur };
  }
  if (res.deja) {
    return { ok: false, deja: true, erreur: 'Un brouillon existe déjà dans Pennylane sous la référence de ' +
             x.num + (x.periode ? ' pour ' + moisLisible_(x.periode) : '') + '.', idPennylane: f.id };
  }
  tracerServeur_(x.com ? x.com.nom : 'SYSTEME', 'BROUILLON PENNYLANE',
                 x.client + (x.periode ? ' · ' + moisLisible_(x.periode) : '') + ' · ' + nb_(tot.ht || x.attendu) +
                 ' € HT · facture ' + f.id + (ecart ? ' · ÉCART : ' + ecart : '') +
                 (res.client && res.client.neuf ? ' · client créé' : ''), x.num, x.appareil || '');
  return { ok: true, numero: x.num, idPennylane: f.id, idHenrri: f.id, lien: '',
           periode: x.periode, ht: tot.ht || x.attendu, tva: tot.tva, ttc: tot.ttc, ecart: ecart,
           clientNeuf: !!(res.client && res.client.neuf), idClient: res.client ? res.client.id : '' };
}

/* ---------------- les contrats ---------------- */

/**
 * Le rythme d'une ligne de contrat, et la phrase qui explique le forfait au
 * client. « 2/semaine », « 1/semaine », « quinzaine », « mensuel ».
 */
function phraseLissage_(rythme) {
  var r = String(rythme || '').toLowerCase().trim();
  var m = r.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*semaine/);
  if (m) {
    var k = Number(m[1].replace(',', '.'));
    return 'Forfait mensuel lissé sur l\'année : ' + nbFr_(k) + ' passage' + (k > 1 ? 's' : '') +
      ' par semaine × 52 semaines ÷ 12 mois = ' + nbFr_(k * 52 / 12) +
      ' passages par mois en moyenne. Le montant est le même chaque mois, que le mois compte 4 ou 5 semaines.';
  }
  if (/quinz|2 semaines/.test(r)) {
    return 'Forfait mensuel lissé sur l\'année : 1 passage toutes les 2 semaines, soit 26 passages par an ÷ 12 mois = ' +
      nbFr_(26 / 12) + ' passages par mois en moyenne. Le montant est le même chaque mois.';
  }
  if (/mens|mois/.test(r)) return 'Forfait mensuel : 1 passage par mois.';
  return 'Forfait mensuel, identique chaque mois.';
}

/** Les lignes de l'onglet CONTRATS, en objets, avec leur rang. */
function lireContrats_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH_CONTRATS_);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = { _rang: i + 1 };
    en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
    if (String(o.CONTRAT || '').trim()) out.push(o);
  }
  return out;
}
/* v108u — le montant d'une ligne de contrat pour un mois donné. Colonne
   MONTANTS_MOIS : « 2026-11=150;2027-01=0 » (mois partiel, mois sans
   passage…). Sinon MENSUEL_HT. Un 0 veut dire : rien à facturer ce mois-là. */
function montantLigneMois_(l, mois) {
  var txt = String(l && l.MONTANTS_MOIS || '');
  var m = txt.match(new RegExp('(?:^|[;\\s,])' + String(mois).replace('-', '\\-') + '\\s*=\\s*([0-9]+(?:[.,][0-9]+)?)'));
  if (m) return Number(m[1].replace(',', '.'));
  return Number(l && l.MENSUEL_HT) || 0;
}

/** Ce que la note d'une série dit du contrat : nom, prestation, montant. */
function contratDeNote_(note, client) {
  var s = String(note || '');
  /* Le montant : « 1 400 » (espace des milliers suivie de trois chiffres)
     ou « 57,6 » — jamais « 12 57,6 », où 12 appartient au nom (« Berval 12 »). */
  var m = s.match(/Contrat\s+([^:]+?)\s*:\s*(.*?)\s*(\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*€\s*HT\s*\/\s*mois/i);
  if (m) {
    return { contrat: m[1].trim().replace(/\s*\/.*$/, ''), ligne: m[2].replace(/[—–-]\s*$/, '').trim(),
             montant: Number(m[3].replace(/[\s  ]/g, '').replace(',', '.')) };
  }
  var d = s.match(/Devis\s+(\S+)\s*[—–-]\s*(\d[\d\s ]*(?:[.,]\d+)?)\s*€\s*HT\s*par\s*mois/i);
  if (d) return { contrat: String(client || '').trim(), ligne: '', montant: Number(d[2].replace(/[\s ]/g, '').replace(',', '.')),
                  devis: d[1] };
  return null;
}

/**
 * Remplit l'onglet CONTRATS à partir de RECURRENTS. Une ligne par
 * (contrat, prestation) ; une ligne déjà là n'est jamais réécrite — seules les
 * nouvelles s'ajoutent, et les séries d'une ligne existante se complètent.
 */
function construireContrats_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH_CONTRATS_);
  if (!sh) {
    sh = ss.insertSheet(SH_CONTRATS_);
    sh.getRange(1, 1, 1, ENTETES_CONTRATS_.length).setValues([ENTETES_CONTRATS_])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  var existants = {};
  lireContrats_().forEach(function (o) {
    existants[sansAccent_(o.CONTRAT) + '|' + sansAccent_(o.LIGNE)] = o;
  });

  var groupes = {}, ordre = [], sansPrix = [];
  objetsDe_(SH.RECURRENTS).forEach(function (r) {
    var id = String(r.ID || '').trim();
    if (!id || !estActif_(r.ACTIF)) return;
    var fin = r.FIN ? new Date(r.FIN) : null;
    if (fin && !isNaN(fin.getTime()) && fin < new Date()) return;
    var c = contratDeNote_(r.NOTE, r.CLIENT);
    if (!c || !c.montant) { sansPrix.push(id + ' ' + String(r.CLIENT || '')); return; }
    c.ligne = c.ligne || 'Entretien des locaux';
    var k = sansAccent_(c.contrat) + '|' + sansAccent_(c.ligne);
    if (!groupes[k]) {
      groupes[k] = { c: c, series: [], freq: {}, adresse: String(r.ADRESSE || ''), cp: String(r.CP || ''),
                     ville: String(r.VILLE || '') };
      ordre.push(k);
    }
    var g = groupes[k];
    g.series.push(id);
    var f = String(r.FREQUENCE || '').toUpperCase().trim();
    g.freq[f] = (g.freq[f] || 0) + 1;
  });

  var ajoutes = 0, completes = 0;
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
  ordre.forEach(function (k) {
    var g = groupes[k];
    var rythme = g.freq.HEBDO ? g.freq.HEBDO + '/semaine'
               : (g.freq.QUINZAINE ? 'quinzaine' : (g.freq.MENSUEL ? 'mensuel' : ''));
    var ex = existants[k];
    if (ex) {
      var connues = String(ex.SERIES || '').split(/[,\s]+/).filter(String);
      var manquent = g.series.filter(function (s) { return connues.indexOf(s) < 0; });
      if (manquent.length && en.indexOf('SERIES') >= 0) {
        sh.getRange(ex._rang, en.indexOf('SERIES') + 1).setValue(connues.concat(manquent).join(', '));
        completes++;
      }
      return;
    }
    var v = { CONTRAT: g.c.contrat, LIGNE: g.c.ligne || 'Entretien des locaux', MENSUEL_HT: g.c.montant, TVA: 20,
              RYTHME: rythme, SERIES: g.series.join(', '), ACTIF: 'OUI', CLIENT_FACTURE: g.c.contrat,
              ADRESSE: g.adresse, CP: g.cp, VILLE: g.ville, PARTICULIER: 'NON',
              NOTE: 'Repris des notes de RECURRENTS — à vérifier' };
    sh.appendRow(en.map(function (h) { return v.hasOwnProperty(h) ? v[h] : ''; }));
    ajoutes++;
  });
  return { ajoutes: ajoutes, completes: completes, sansPrix: sansPrix };
}

/** Le mois écoulé, « 2026-10 » le 7 novembre. */
function moisEcoule_() {
  var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return moisDe_(d);
}

/**
 * Les brouillons des contrats pour un mois. Une facture par CONTRAT, une ligne
 * par prestation. Les lignes inactives ou sans montant sont sautées et
 * nommées.
 */
function facturesContrats_(periode, com, seul) {
  var mois = String(periode || '').match(/^\d{4}-\d{2}$/) ? periode : moisEcoule_();
  var parContrat = {}, ordre = [], sautes = [], faits = [], echecs = [];
  lireContrats_().forEach(function (o) {
    if (!estActif_(o.ACTIF)) return;
    var nom = String(o.CONTRAT).trim();
    if (seul && sansAccent_(nom) !== sansAccent_(seul)) return;
    if (!(Number(o.MENSUEL_HT) > 0)) { sautes.push({ client: nom, motif: 'pas de montant' }); return; }
    o._montant = montantLigneMois_(o, mois);
    if (!(o._montant > 0)) return;                       // v108u : rien ce mois-là (début plus tard, mois sauté)
    if (!parContrat[nom]) { parContrat[nom] = []; ordre.push(nom); }
    parContrat[nom].push(o);
  });
  var faites = facturesFaites_();
  ordre.forEach(function (nom) {
    var cle = 'CONTRAT ' + nom;
    if ((faites[cle] || {})[mois]) { sautes.push({ client: nom, motif: 'déjà préparée' }); return; }
    var ls = parContrat[nom];
    var t = function (k) { for (var i = 0; i < ls.length; i++) if (String(ls[i][k] || '').trim()) return ls[i][k]; return ''; };
    var attendu = 0;
    ls.forEach(function (l) { attendu += l._montant; });
    /* v108g — le détail de ses factures Henrri, quand un modèle a ce montant. */
    var modC = null;
    try { modC = modelePour_(String(t('CLIENT_FACTURE') || nom), Math.round(attendu * 100) / 100) || modelePour_(nom, Math.round(attendu * 100) / 100); } catch (eMc) { modC = null; }
    var lignesC = null;
    if (modC) {
      lignesC = lignesDuModele_(modC, modC.tva, mois);
      if (lignesC.length) lignesC[0].detail = phraseLissage_(ls[0].RYTHME);
    }
    var res = null, erreur = '';
    try {
      res = pennylaneBrouillon_({
        ref: 'BB-CT-' + slugRef_(nom) + '-' + mois,
        client: { nom: String(t('CLIENT_FACTURE') || nom), siren: t('SIREN'), email: t('EMAIL'),
                  adresse: t('ADRESSE'), cp: t('CP'), ville: t('VILLE'),
                  particulier: estParticulier_(t('CLIENT_FACTURE') || nom, t('PARTICULIER')), idConnu: t('ID_PENNYLANE') },
        sujet: 'Facture ' + moisLisible_(mois) + ' — contrat d\'entretien ' + nom,
        description: 'Contrat d\'entretien — ' + moisLisible_(mois) + '.',
        lignes: lignesC || ls.map(function (l) {
          var part = estParticulier_(t('CLIENT_FACTURE') || nom, t('PARTICULIER'));
          return { libelle: String(l.LIGNE || 'Entretien des locaux') + ' — ' + moisLisible_(mois),
                   prix: l._montant, tva: part ? 10 : (String(l.TVA) === '' ? 20 : Number(l.TVA)), qte: 1,
                   detail: phraseLissage_(l.RYTHME) };
        })
      });
    } catch (e) { erreur = String(e && e.message || e); }
    /* L'identifiant du client se garde sur la ligne : le mois prochain, plus
       de recherche, plus de risque d'en créer un second. */
    if (res && res.client && res.client.id) {
      var sh = SpreadsheetApp.getActive().getSheetByName(SH_CONTRATS_);
      var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
      var cI = en.indexOf('ID_PENNYLANE');
      if (cI >= 0) ls.forEach(function (l) { if (!String(l.ID_PENNYLANE || '').trim()) sh.getRange(l._rang, cI + 1).setValue(res.client.id); });
    }
    var r = finirFacturePennylane_(res, erreur, { num: cle, client: nom, type: 'CONTRAT', periode: mois,
                                                    passages: '', attendu: Math.round(attendu * 100) / 100, com: com });
    if (r.ok) {
      faits.push({ client: nom, ht: r.ht, idPennylane: r.idPennylane, ecart: r.ecart });
      if (!com) {
        try { envoiAutoFacture_(r, devisDuContrat_(ls), { email: t('EMAIL'), mois: mois, contrat: nom }); } catch (eA) {
          tracerServeur_('SYSTEME', 'FACTURE LAISSEE EN BROUILLON', nom + ' · ' + String(eA && eA.message || eA).slice(0, 160), cle, '');
        }
      }
    }
    else if (r.deja) sautes.push({ client: nom, motif: 'brouillon déjà dans Pennylane' });
    else echecs.push({ client: nom, erreur: r.erreur });
  });
  tracerServeur_(com ? com.nom : 'SYSTEME', 'BROUILLONS CONTRATS',
                 moisLisible_(mois) + ' · ' + faits.length + ' préparé(s), ' + sautes.length + ' sauté(s), ' +
                 echecs.length + ' en échec', '', '');
  return { ok: true, periode: mois, periodeNom: moisLisible_(mois), faits: faits, sautes: sautes, echecs: echecs };
}

/**
 * Les ponctuels prêts : tous les passages FAIT, le dernier départ pointé il
 * y a au moins deux heures, pas encore facturés. C'est ce que fera la
 * préparation automatique ; le menu 30 le fait à la demande.
 */
function ponctuelsAPreparer_(maintenant) {
  var t = (maintenant || new Date()).getTime();
  return etatFacturation_('').ponctuels.filter(function (p) {
    if (p.facturee || !p.pret) return false;
    var fin = p.faitLe ? new Date(p.faitLe) : null;
    return !fin || isNaN(fin.getTime()) || t - fin.getTime() >= 2 * 3600 * 1000;
  });
}

function facturesPonctuels_(com) {
  var faits = [], echecs = [], sautes = [];
  /* v99 — les interventions SANS devis, pointées FAIT depuis deux heures,
     dont le prix est écrit dans la note (« 690 € HT »). Celles sans prix
     attendent dans l'onglet Factures de l'appli : on n'invente pas un montant. */
  var faites0 = facturesFaites_(), t0 = Date.now();
  objetsDe_(SH.CHANTIERS).forEach(function (o) {
    var id = String(o.ID || '').trim();
    if (!id || String(o.NUMERO || '').trim() || String(o.RECURRENT || '').trim()) return;
    if (String(o.STATUT || '').toUpperCase().trim() !== 'FAIT') return;
    if ((faites0[id] || {})['']) return;
    var dep = o.DEPART ? new Date(o.DEPART) : null;
    if (!dep || isNaN(dep.getTime()) || t0 - dep.getTime() < 2 * 3600 * 1000) return;
    var prix = prixDeNote_(o.NOTE);
    if (!prix) return;
    if (contratProche_(o.CLIENT, nomsDeContrats_())) return;    // peut-être dans un forfait : à la main
    var r = facturerIntervention_({ cle: id, ht: prix.ht }, com);
    if (r.ok) faits.push({ client: String(o.CLIENT || ''), ht: r.ht, idPennylane: r.idPennylane });
    else if (r.deja) sautes.push({ client: String(o.CLIENT || ''), motif: 'déjà préparée' });
    else echecs.push({ client: String(o.CLIENT || ''), erreur: r.erreur });
  });
  ponctuelsAPreparer_().forEach(function (p) {
    var r = preparerFacturePennylane_({ numero: p.numero }, com);
    if (r.ok) {
      faits.push({ client: p.client, ht: r.ht, idPennylane: r.idPennylane });
      try { envoiAutoFacture_(r, p.numero, null); } catch (eA) {
        tracerServeur_('SYSTEME', 'FACTURE LAISSEE EN BROUILLON', p.client + ' · ' + String(eA && eA.message || eA).slice(0, 160), p.numero, '');
      }
    }
    else if (r.deja) sautes.push({ client: p.client, motif: 'déjà préparée' });
    else echecs.push({ client: p.client, erreur: r.erreur });
  });
  return { ok: true, faits: faits, sautes: sautes, echecs: echecs };
}

/* ================================================================
   v98 — L'ONGLET « FACTURES » DE L'APPLI, BRANCHÉ SUR LA RÉALITÉ
   ================================================================
   Simon, le 8 novembre : « fais en sorte que je puisse facturer mes clients,
   là y'a aucune donnée ». L'onglet ne lisait que les devis signés DANS
   l'appli, et ne tenait un chantier pour fini que s'il avait été pointé.
   Or les contrats vivent dans l'onglet CONTRATS, la plupart des
   interventions ponctuelles viennent de FamilyWall sans devis, et l'équipe
   ne pointe pas. Il voyait donc un écran vide.

   Ce que l'onglet lit désormais, pour le mois choisi :
   - les CONTRATS, une facture par contrat (comme le menu 29) ;
   - les interventions ponctuelles passées (date du mois, avant demain), avec
     ou sans devis, hors passages de contrat. Le prix vient du devis, ou de la
     note (« 690 € HT », « 390 € TTC »), et se corrige avant d'envoyer.
   Tout part en BROUILLON dans Pennylane ; rien n'est envoyé au client. */

/** « 690 € HT » → {ht:690}, « 390 € TTC » → {ht:325} (TVA 20 %). */
function prixDeNote_(note) {
  var s = String(note || '');
  var m = s.match(/(\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*€\s*(HT|TTC)?/i);
  if (!m) return null;
  var n = Number(m[1].replace(/[   ]/g, '').replace(',', '.'));
  if (!(n > 0)) return null;
  var ttc = /TTC/i.test(m[2] || '');
  return { ht: ttc ? Math.round(n / 1.2 * 100) / 100 : n, ttc: ttc, lu: m[0] };
}

/* Ce qui ressemble au nom d'un contrat : une intervention « SAUVEGARDE 56 —
   MAISON N°12 » est peut-être déjà payée par le forfait de SAUVEGARDE 56. */
function nomsDeContrats_() {
  var noms = {};
  lireContrats_().forEach(function (o) {
    if (!estActif_(o.ACTIF)) return;
    [o.CONTRAT, o.CLIENT_FACTURE].forEach(function (x) {
      var k = sansAccent_(x).replace(/[^A-Z0-9]+/g, ' ').trim();
      if (k.length >= 4) noms[k] = String(o.CONTRAT).trim();
    });
  });
  return noms;
}
function contratProche_(client, noms) {
  var c = ' ' + sansAccent_(client).replace(/[^A-Z0-9]+/g, ' ').replace(/\b(M|MR|MME|MONSIEUR|MADAME)\b/g, ' ')
    .replace(/\s+/g, ' ').trim() + ' ';
  for (var k in noms) {
    if (!noms.hasOwnProperty(k)) continue;
    var k2 = k.replace(/\b(M|MR|MME|MONSIEUR|MADAME)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (k2.length >= 4 && c.indexOf(' ' + k2 + ' ') >= 0) return noms[k];
  }
  return '';
}

/* v99 — « 10 % pour un particulier, 20 % pour une société », comme dans
   Henrri. Un particulier se reconnaît à son nom (M., MME, MR, MONSIEUR,
   MADAME, M. ET MME) ou à la case PARTICULIER du contrat. */
function estParticulier_(nom, caseParticulier) {
  if (/^O/i.test(String(caseParticulier || '').trim())) return true;
  return /^\s*(M\.|MME\b|MR\b|MLLE\b|MONSIEUR\b|MADAME\b|M\s+ET\s+MME\b|M\s+)/i.test(String(nom || ''));
}

function libelleNature_(n) {
  var x = String(n || '').toUpperCase().trim();
  return x === 'ENTRETIEN' ? 'Entretien des locaux' : x === 'VITRERIE' ? 'Nettoyage des vitrages'
       : x === 'FACADE' ? 'Nettoyage de façade' : x === 'REMISE' ? 'Remise en état'
       : x === 'CHANTIER' ? 'Nettoyage de fin de chantier' : 'Prestation de nettoyage';
}

function facturationAppli_(periode) {
  var mois = String(periode || '').match(/^\d{4}-\d{2}$/) ? periode : moisCourant_();
  var faites = facturesFaites_();

  /* ---- les contrats ---- */
  var modelesC = [];
  try { modelesC = modelesFacture_(); } catch (eMc2) { modelesC = []; }
  var parC = {}, ordre = [];
  lireContrats_().forEach(function (o) {
    if (!estActif_(o.ACTIF)) return;
    var nom = String(o.CONTRAT).trim();
    if (!parC[nom]) { parC[nom] = []; ordre.push(nom); }
    parC[nom].push(o);
  });
  var contrats = ordre.map(function (nom) {
    var ls = parC[nom];
    var t = function (k) { for (var i = 0; i < ls.length; i++) if (String(ls[i][k] || '').trim()) return String(ls[i][k]); return ''; };
    var ht = 0; ls.forEach(function (l) { ht += montantLigneMois_(l, mois); });
    var manque = [];
    if (!t('ID_PENNYLANE') && (!t('ADRESSE') || !t('CP') || !t('VILLE'))) manque.push('adresse de facturation');
    if (!(ht > 0) && !ls.some(function (l) { return Number(l.MENSUEL_HT) > 0; })) manque.push('montant');
    var deja = (faites['CONTRAT ' + nom] || {})[mois];
    var htR = Math.round(ht * 100) / 100;
    var modC = modelePour_(t('CLIENT_FACTURE') || nom, htR, modelesC) || modelePour_(nom, htR, modelesC);
    return {
      modele: modC ? { source: modC.source, ht: modC.ht, tva: modC.tva, n: modC.lignes.length } : null,
      contrat: nom, client: t('CLIENT_FACTURE') || nom, ville: t('VILLE'), email: t('EMAIL'),
      ht: Math.round(ht * 100) / 100,
      lignes: ls.map(function (l) {
        return { ligne: String(l.LIGNE || 'Entretien des locaux'), ht: montantLigneMois_(l, mois),
                 rythme: String(l.RYTHME || '') };
      }),
      manque: manque, facturee: !!deja,
      etat: deja ? String(deja.ETAT || '') : '',
      idPennylane: deja ? String(deja.ID_PENNYLANE || '') : ''
    };
  });
  contrats.sort(function (a, b) {
    if (a.facturee !== b.facturee) return a.facturee ? 1 : -1;
    return a.contrat.localeCompare(b.contrat);
  });

  /* ---- les interventions ponctuelles du mois ---- */
  var devisParNum = {};
  lireDevis_().forEach(function (d) { var n = String(d.NUMERO || '').trim(); if (n) devisParNum[n] = d; });
  var noms = nomsDeContrats_();
  var demain = new Date(); demain.setHours(0, 0, 0, 0); demain.setDate(demain.getDate() + 1);
  var parDevis = {}, interventions = [];
  var modeles = [];
  try { modeles = modelesFacture_(); } catch (eMo) { modeles = []; }
  objetsDe_(SH.CHANTIERS).forEach(function (o) {
    var id = String(o.ID || '').trim();
    if (!id) return;
    var st = String(o.STATUT || '').toUpperCase().trim();
    if (st === 'ANNULE') return;
    if (String(o.RECURRENT || '').trim()) return;          // un passage de contrat
    var d = o.DATE ? new Date(o.DATE) : null;
    if (!d || isNaN(d.getTime()) || moisDe_(d) !== mois || d >= demain) return;
    var num = String(o.NUMERO || '').trim();
    var dv = num ? devisParNum[num] : null;
    if (dv) {
      if (devisEssai_(dv)) return;
      if (recurrentDevis_(dv.NATURE, dv.PASSAGES_MOIS, dv.SANS_CONTRAT)) return;   // facturé par le contrat
      (parDevis[num] = parDevis[num] || []).push(o);
      return;
    }
    var deja = (faites[id] || {})[''];
    var prix = prixDeNote_(o.NOTE);
    /* v108f — un modèle Henrri au montant de la note, ou à défaut le plus
       récent du client pour préremplir le montant. */
    var mod = modelePour_(o.CLIENT, prix ? prix.ht : 0, modeles) || (prix ? null : modelePour_(o.CLIENT, 0, modeles));
    if (mod && !prix) prix = { ht: mod.ht, lu: '' };
    interventions.push({
      cle: id, type: 'chantier', client: String(o.CLIENT || ''), date: isoDe_(d) || '',
      adresse: String(o.ADRESSE || ''), cp: String(o.CP || ''), ville: String(o.VILLE || ''),
      nature: String(o.NATURE || ''), libelle: libelleNature_(o.NATURE),
      note: String(o.NOTE || '').replace(/\s*—?\s*repris de FamilyWall\s*/i, '').trim().slice(0, 200),
      ht: prix ? prix.ht : 0, prixLu: prix ? prix.lu : '', tva: mod ? mod.tva : (estParticulier_(o.CLIENT) ? 10 : 20),
      modele: mod ? { source: mod.source, ht: mod.ht, tva: mod.tva, n: mod.lignes.length, date: mod.date,
                      lignes: mod.lignes.slice(0, 12).map(function (l) { return l.designation + ' — ' + l.montant.toFixed(2).replace('.', ',') + ' €'; }) } : null,
      particulier: estParticulier_(o.CLIENT),
      qui: String(o.PRESTATAIRE || ''), pointe: st === 'FAIT',
      jamaisPlace: st === 'A PLANIFIER' || !String(o.PRESTATAIRE || '').trim(),
      contrat: contratProche_(o.CLIENT, noms),
      facturee: !!deja, etat: deja ? String(deja.ETAT || '') : '',
      idPennylane: deja ? String(deja.ID_PENNYLANE || '') : ''
    });
  });
  Object.keys(parDevis).forEach(function (num) {
    var dv = devisParNum[num], chs = parDevis[num];
    var deja = (faites[num] || {})[''];
    var der = chs.reduce(function (m, c) { var t = new Date(c.DATE).getTime(); return t > m ? t : m; }, 0);
    interventions.push({
      cle: num, type: 'devis', client: String(dv.CLIENT || ''), date: isoDe_(new Date(der)) || '',
      adresse: String(dv.ADRESSE || ''), cp: String(dv.CP || ''), ville: String(dv.VILLE || ''),
      nature: String(dv.NATURE || ''), libelle: 'Selon le devis ' + num,
      note: String(dv.OBJET || ''), ht: Number(dv.TOTAL_HT) || 0, prixLu: 'devis ' + num, tva: 0,
      qui: String(chs[0].PRESTATAIRE || ''),
      pointe: chs.every(function (c) { return String(c.STATUT || '').toUpperCase() === 'FAIT'; }),
      jamaisPlace: false, contrat: '', signe: String(dv.STATUT || '').toUpperCase() === 'SIGNE',
      email: String(dv.EMAIL || ''), facturee: !!deja, etat: deja ? String(deja.ETAT || '') : '',
      idPennylane: deja ? String(deja.ID_PENNYLANE || '') : ''
    });
  });
  interventions.sort(function (a, b) {
    if (a.facturee !== b.facturee) return a.facturee ? 1 : -1;
    if (!!a.contrat !== !!b.contrat) return a.contrat ? 1 : -1;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.client.localeCompare(b.client);
  });
  return { ok: true, v: 98, periode: mois, periodeNom: moisLisible_(mois),
           moisFini: mois < moisCourant_(), pennylane: !!pennylaneJeton_(),
           contrats: contrats, interventions: interventions,
           /* l'ancien format, pour un téléphone pas encore à jour */
           ponctuels: [], henrri: true };
}

/* ================================================================
   v108f — LE DÉTAIL DES FACTURES, REPRIS DE HENRRI
   ================================================================
   Simon, 10 novembre : « dans la vente des produits ce n'est pas précis, y'a
   juste Nettoyage des vitrages — alors que d'habitude je détaille bien toutes
   les opérations ». Ses factures Henrri passées sont rangées dans l'onglet
   MODELES_FACTURE (une ligne par opération). Quand une intervention se facture
   pour un client qui a un modèle AU MÊME MONTANT, la facture Pennylane en
   reprend toutes les lignes. Sinon rien ne change : une ligne unique.

   L'onglet se remplit à partir d'un fichier « MODELES_FACTURE_IMPORT.csv »
   déposé dans le Drive : il est lu à la première facturation, puis mis à la
   corbeille. Les données des clients ne passent donc jamais par ce code,
   publié sur GitHub. Simon peut corriger l'onglet à la main ; ACTIF = NON
   écarte une ligne. */
var SH_MODELES_ = 'MODELES_FACTURE';
var ENTETES_MODELES_ = ['CLIENT', 'CONTACT', 'SOURCE', 'DATE', 'TOTAL_HT', 'TVA', 'ORDRE',
                        'DESIGNATION', 'QTE', 'PU_HT', 'MONTANT_HT', 'ACTIF'];
var FICHIER_MODELES_ = 'MODELES_FACTURE_IMPORT.csv';

function importerModelesFacture_() {
  var it = DriveApp.getFilesByName(FICHIER_MODELES_);
  if (!it.hasNext()) return 0;
  var f = it.next();
  var lignes = Utilities.parseCsv(f.getBlob().getDataAsString('UTF-8'));
  if (!lignes.length) { f.setTrashed(true); return 0; }
  var en = lignes[0].map(function (x) { return String(x).replace(/^\uFEFF/, '').trim().toUpperCase(); });
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH_MODELES_);
  if (!sh) { sh = ss.insertSheet(SH_MODELES_); sh.getRange(1, 1, 1, ENTETES_MODELES_.length).setValues([ENTETES_MODELES_]); }
  var deja = {};
  objetsDe_(SH_MODELES_).forEach(function (o) { deja[String(o.SOURCE) + '|' + String(o.ORDRE)] = 1; });
  var out = [];
  for (var i = 1; i < lignes.length; i++) {
    var o = {};
    en.forEach(function (h, j) { o[h] = lignes[i][j]; });
    if (!String(o.SOURCE || '').trim() || deja[String(o.SOURCE) + '|' + String(o.ORDRE)]) continue;
    o.ACTIF = o.ACTIF || 'OUI';
    out.push(ENTETES_MODELES_.map(function (h) {
      var v = o[h] === undefined ? '' : o[h];
      if (/^(TOTAL_HT|TVA|ORDRE|QTE|PU_HT|MONTANT_HT)$/.test(h) && v !== '') v = Number(String(v).replace(',', '.')) || 0;
      if (h === 'SOURCE' || h === 'DATE') v = String(v);
      return v;
    }));
  }
  if (out.length) {
    sh.getRange(sh.getLastRow() + 1, 1, out.length, ENTETES_MODELES_.length).setNumberFormat('@')
      .setValues(out.map(function (r) { return r.map(function (v) { return typeof v === 'number' ? String(v) : v; }); }));
    // les montants redeviennent des nombres
    sh.getRange(2, 5, sh.getLastRow() - 1, 1).setNumberFormat('0.00');
  }
  f.setTrashed(true);
  tracerServeur_('SYSTEME', 'MODELES FACTURE IMPORTES', out.length + ' ligne(s)', '', '');
  return out.length;
}

var MOTS_COMMUNS_ = { NETTOYAGE: 1, ENTRETIEN: 1, SERVICES: 1, SERVICE: 1, IMMOBILIER: 1, CONSEIL: 1, INVESTISSEMENT: 1,
  INVESTISSEMENTS: 1, BREIZH: 1, BRETAGNE: 1, ARCHITECTE: 1, ARCHITECTES: 1, ARCHITECTURE: 1, CONSTRUCTION: 1,
  MORBIHAN: 1, VANNES: 1, RENOVATION: 1, GROUPE: 1, FRANCE: 1, SOCIETE: 1, COMPAGNIE: 1, AGENCE: 1 };
function cleClient_(s) {
  return ' ' + sansAccent_(s).replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(M|MR|MME|MLLE|MONSIEUR|MADAME|ET|SARL|SAS|SASU|SCI|EURL|STE|SC)\b/g, ' ')
    .replace(/\s+/g, ' ').trim() + ' ';
}

/** Les modèles, regroupés par facture Henrri d'origine. */
function modelesFacture_() {
  try { importerModelesFacture_(); } catch (e) {
    tracerServeur_('SYSTEME', 'MODELES FACTURE NON IMPORTES', String(e && e.message || e).slice(0, 200), '', '');
  }
  var ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(SH_MODELES_)) return [];
  var par = {}, ordre = [];
  objetsDe_(SH_MODELES_).forEach(function (o) {
    if (/^N/i.test(String(o.ACTIF || '').trim())) return;
    var src = String(o.SOURCE || '').trim();
    if (!src) return;
    if (!par[src]) {
      par[src] = { source: src, client: String(o.CLIENT || ''), contact: String(o.CONTACT || ''),
                   date: String(o.DATE || ''), ht: num_(o.TOTAL_HT), tva: num_(o.TVA), lignes: [] };
      ordre.push(src);
    }
    par[src].lignes.push({ ordre: num_(o.ORDRE), designation: String(o.DESIGNATION || ''),
                           qte: num_(o.QTE), pu: num_(o.PU_HT), montant: num_(o.MONTANT_HT) });
  });
  return ordre.map(function (k) {
    var m = par[k];
    m.lignes.sort(function (a, b) { return a.ordre - b.ordre; });
    return m;
  });
}
function num_(v) { return Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')) || 0; }

/* Le modèle d'un client : par son nom de société, le nom complet du contact
   ou son nom de famille (« MME DUPONT » retrouve « Claire DUPONT »).
   Avec un montant, seul un modèle au même montant compte (à 5 centimes) ;
   sans montant, le plus récent sert à préremplir. */
function modelePour_(client, ht, modeles) {
  var c = cleClient_(client);
  if (c.trim().length < 3) return null;
  var bons = (modeles || modelesFacture_()).filter(function (m) {
    var cles = [cleClient_(m.client), cleClient_(m.contact)];
    var mots = cleClient_(m.contact).trim().split(' ');
    if (mots.length > 1 && mots[mots.length - 1].length >= 4) cles.push(' ' + mots[mots.length - 1] + ' ');
    if (cles.some(function (k) {
      return k.trim().length >= 3 && (c.indexOf(k) >= 0 || k.indexOf(c) >= 0);
    })) return true;
    /* Les fautes de frappe d'un logiciel à l'autre : « POKE COLLECTIF » et
       « POKECOLLECTIF SAS », « MORBIHANAISE » et « MORBIHANNAISE ». Sans les
       espaces, ou par un mot distinctif commun (6 lettres et plus, hors mots
       de métier). Le montant, exigé pour facturer, écarte les rapprochements
       de hasard. */
    var cs = c.replace(/ /g, '');
    return cles.some(function (k) {
      var ks = k.replace(/ /g, '');
      if (ks.length >= 6 && cs.length >= 6 && (cs.indexOf(ks) >= 0 || ks.indexOf(cs) >= 0)) return true;
      return k.trim().split(' ').some(function (w) {
        return w.length >= 6 && !MOTS_COMMUNS_[w] && c.indexOf(' ' + w + ' ') >= 0;
      });
    });
  });
  if (ht > 0) bons = bons.filter(function (m) { return Math.abs(m.ht - ht) <= 0.05; });
  if (!bons.length) return null;
  bons.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return bons[0];
}

/* Les lignes Pennylane d'un modèle. Quantité × prix unitaire quand le
   produit retombe juste ; sinon une quantité de 1 au montant de la ligne,
   pour que la facture fasse exactement le total du modèle. */
function lignesDuModele_(m, tva, mois) {
  /* Pour un contrat (mois « 2026-11 »), le mois écrit dans l'ancienne
     facture (« 09/26 », « juillet ») devient celui qu'on facture. */
  var NOMS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var date = function (t) {
    if (!mois) return t;
    var mm = mois.slice(5, 7), aa = mois.slice(2, 4), nom = NOMS[Number(mm) - 1];
    return String(t).replace(/\b(0[1-9]|1[0-2])\/(\d{2})\b/g, mm + '/' + aa)
      .replace(/\b(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\b/gi, nom);
  };
  return m.lignes.filter(function (l) { return l.montant !== 0; }).map(function (l) {
    var q = l.qte || 1, pu = l.pu;
    var juste = Math.abs(Math.round(q * pu * 100) / 100 - l.montant) < 0.005;
    return juste ? { libelle: date(l.designation), qte: q, prix: pu, tva: tva }
                 : { libelle: date(l.designation) + (q !== 1 ? ' (× ' + String(q).replace('.', ',') + ')' : ''),
                     qte: 1, prix: l.montant, tva: tva };
  });
}

/** Le brouillon d'une intervention sans devis : le prix vient de l'appli. */
function facturerIntervention_(d, com) {
  if (!pennylaneJeton_()) return { ok: false, erreur: 'Pennylane n\'est pas connecté (menu 25 du classeur).' };
  var id = String(d.cle || '').trim();
  var ch = null;
  objetsDe_(SH.CHANTIERS).forEach(function (o) { if (String(o.ID || '').trim() === id) ch = o; });
  if (!ch) return { ok: false, erreur: 'Intervention ' + id + ' introuvable.' };
  if ((facturesFaites_()[id] || {})['']) return { ok: false, deja: true, erreur: 'Déjà facturée.' };
  var ht = Math.round((Number(String(d.ht || '').replace(',', '.')) || 0) * 100) / 100;
  if (!(ht > 0)) return { ok: false, erreur: 'Indique le montant HT.' };
  var tva = d.tva === undefined || d.tva === '' ? (estParticulier_(d.client || ch.CLIENT) ? 10 : 20) : Number(d.tva);
  var client = String(d.client || ch.CLIENT || '').trim();
  var libelle = String(d.libelle || libelleNature_(ch.NATURE)).trim();
  var jour = ch.DATE ? Utilities.formatDate(new Date(ch.DATE), 'Europe/Paris', 'dd/MM/yyyy') : '';
  /* v108f — le détail des opérations, quand un modèle Henrri a ce montant. */
  var mod = null;
  try { mod = d.detaille === false ? null : modelePour_(client, ht); } catch (eM) { mod = null; }
  if (mod && (d.tva === undefined || d.tva === '')) tva = mod.tva;
  var lignesF = mod ? lignesDuModele_(mod, tva)
    : [{ libelle: libelle + (jour ? ' — ' + jour : ''), prix: ht, tva: tva, qte: 1, detail: String(d.detail || '').trim() }];
  var res = null, erreur = '';
  try {
    res = pennylaneBrouillon_({
      ref: 'BB-' + id,
      client: { nom: client, adresse: d.adresse !== undefined ? d.adresse : ch.ADRESSE,
                cp: d.cp !== undefined ? d.cp : ch.CP, ville: d.ville !== undefined ? d.ville : ch.VILLE,
                email: d.email || '',
                particulier: d.particulier !== undefined ? !!d.particulier
                  : /^(M\.|MME|MR|MONSIEUR|MADAME|M )/i.test(client) },
      sujet: 'Facture — ' + libelle + (jour ? ' du ' + jour : ''),
      description: (mod ? libelle + ' — p' : 'P') + 'restation réalisée' + (jour ? ' le ' + jour : '') +
        (ch.ADRESSE ? ', ' + String(ch.ADRESSE) + ' ' + String(ch.CP || '') + ' ' + String(ch.VILLE || '') : '') + '.',
      lignes: lignesF
    });
  } catch (e) { erreur = String(e && e.message || e); }
  return finirFacturePennylane_(res, erreur, { num: id, client: client, type: 'PONCTUEL', periode: '',
                                               passages: 1, attendu: ht, com: com, appareil: d.appareil });
}

/* « Déjà facturée ailleurs » : une intervention d'octobre facturée dans
   Henrri ne doit plus revenir dans la liste. Une ligne dans FACTURES, sans
   rien envoyer à Pennylane. Se défait en effaçant la ligne. */
function marquerFacturee_(d, com) {
  var cle = String(d.cle || '').trim();
  if (!cle) return { ok: false, erreur: 'rien à marquer' };
  var periode = String(d.periode || '').match(/^\d{4}-\d{2}$/) ? d.periode : '';
  var num = d.contrat ? 'CONTRAT ' + cle : cle;
  if ((facturesFaites_()[num] || {})[periode]) return { ok: true, deja: true };
  ecrireFacture_({ CREE_LE: new Date(), NUMERO_DEVIS: num, CLIENT: String(d.client || cle),
                   TYPE: d.contrat ? 'CONTRAT' : 'PONCTUEL', PERIODE: periode, ETAT: 'DEJA FACTUREE',
                   CREE_PAR: com ? com.nom : '', NOTE: 'marquée depuis l\'appli : facturée hors Pennylane' });
  tracerServeur_(com ? com.nom : '', 'MARQUEE FACTUREE', String(d.client || cle) + (periode ? ' · ' + periode : ''), num, d.appareil || '');
  return { ok: true };
}

/* v108g — « Refaire » une facture déjà préparée : le brouillon Pennylane est
   supprimé (seulement s'il est encore un brouillon) et la ligne de FACTURES
   effacée, si bien que l'intervention revient dans la liste. Une facture
   finalisée ne se défait pas ici : il faut un avoir dans Pennylane. */
function refaireFacture_(d, com) {
  var cle = String(d.cle || '').trim();
  if (!cle) return { ok: false, erreur: 'rien à refaire' };
  var periode = String(d.periode || '').match(/^\d{4}-\d{2}$/) ? d.periode : '';
  var num = d.contrat ? 'CONTRAT ' + cle : cle;
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.FACTURES);
  if (!sh || sh.getLastRow() < 2) return { ok: false, erreur: 'aucune facture préparée pour ' + cle };
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var iN = en.indexOf('NUMERO_DEVIS'), iP = en.indexOf('PERIODE'), iId = en.indexOf('ID_PENNYLANE');
  var lignes = [];
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][iN] || '').trim() !== num) continue;
    var p = iP >= 0 ? v[i][iP] : '';
    var pTxt = p instanceof Date ? Utilities.formatDate(p, 'Europe/Paris', 'yyyy-MM') : String(p || '').trim();
    if (pTxt !== periode) continue;
    lignes.push({ rang: i + 1, id: iId >= 0 ? String(v[i][iId] || '').trim() : '' });
  }
  if (!lignes.length) return { ok: false, erreur: 'aucune facture préparée pour ' + cle };
  var supprimes = 0;
  for (var k = 0; k < lignes.length; k++) {
    var id = lignes[k].id;
    if (!id || !pennylaneJeton_()) continue;
    var r = pennylaneAppel_('get', '/customer_invoices/' + encodeURIComponent(id));
    if (r.ok && r.data) {
      var brouillon = r.data.draft === true || /draft|brouillon/i.test(String(r.data.status || ''));
      if (!brouillon) return { ok: false, finalisee: true,
        erreur: 'La facture ' + String(r.data.invoice_number || id) + ' est déjà finalisée dans Pennylane : il faut un avoir, pas une suppression.' };
      var del = pennylaneAppel_('delete', '/customer_invoices/' + encodeURIComponent(id));
      if (!del.ok && del.code !== 404) return { ok: false, erreur: 'Pennylane refuse de supprimer le brouillon : ' + del.erreur };
      supprimes++;
    } else if (r.code !== 404) {
      return { ok: false, erreur: 'Pennylane ne répond pas : ' + r.erreur };
    }
  }
  lignes.sort(function (a, b) { return b.rang - a.rang; }).forEach(function (l) { sh.deleteRow(l.rang); });
  tracerServeur_(com ? com.nom : '', 'FACTURE A REFAIRE', String(d.client || cle) + (periode ? ' · ' + periode : '') +
                 (supprimes ? ' — brouillon Pennylane supprimé' : ''), num, d.appareil || '');
  return { ok: true, supprimes: supprimes };
}

/** Le bouton « préparer » de l'appli, pour un devis ponctuel, un contrat ou une intervention. */
function facturerDepuisAppli_(d, com) {
  if (!pennylaneJeton_()) return { ok: false, erreur: 'Pennylane n\'est pas connecté (menu 25 du classeur).' };
  if (d.type === 'contrat') {
    var r = facturesContrats_(d.periode, com, d.cle);
    if (r.faits.length) return { ok: true, ht: r.faits[0].ht, ecart: r.faits[0].ecart || '' };
    if (r.echecs.length) return { ok: false, erreur: r.echecs[0].erreur };
    if (r.sautes.length) return { ok: false, deja: true, erreur: r.sautes[0].client + ' : ' + r.sautes[0].motif };
    return { ok: false, erreur: 'Contrat ' + d.cle + ' introuvable ou inactif dans l\'onglet CONTRATS.' };
  }
  if (d.type === 'devis') return preparerFacturePennylane_({ numero: d.cle, force: true, appareil: d.appareil }, com);
  return facturerIntervention_(d, com);
}

/**
 * La préparation automatique, une fois par heure, quand elle est activée
 * (menu 31) : les ponctuels terminés depuis deux heures, et le 3 du mois
 * les contrats du mois écoulé (rattrapage les 4 et 5). Que des brouillons.
 */
function preparationAutomatique() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return; }
  /* v106 — le rappel de la veille aux clients des chantiers ponctuels. */
  try { rappelsVeille_(new Date()); } catch (e4) {
    tracerServeur_('SYSTEME', 'RAPPEL VEILLE EN ECHEC', String(e4 && e4.message || e4).slice(0, 200), '', '');
  }
  try {
    if (pennylaneJeton_()) facturesPonctuels_(null);
    /* v102 — Simon : « les factures de début de mois des récurrents, le 3,
       comme c'était initialement ». Le 3 ; les 4 et 5 ne rattrapent que ce
       qui aurait échoué (une référence déjà dans Pennylane n'est jamais
       refaite). */
    var jm = new Date().getDate();
    if (pennylaneJeton_() && jm >= 3 && jm <= 5) facturesContrats_(moisEcoule_(), null);
  } catch (e2) {
    tracerServeur_('SYSTEME', 'PREPARATION AUTO EN ECHEC', String(e2 && e2.message || e2).slice(0, 200), '', '');
  }
  try { envoyerPaieAuto_(new Date()); } catch (e5) {
    tracerServeur_('SYSTEME', 'PAIE AUTO EN ECHEC', String(e5 && e5.message || e5).slice(0, 200), '', '');
  }
  try { relancerPointages_(new Date()); } catch (e3) {
    tracerServeur_('SYSTEME', 'RELANCE POINTAGE EN ECHEC', String(e3 && e3.message || e3).slice(0, 200), '', '');
  } finally { donneesChangees_(); lock.releaseLock(); }
}

/* ================================================================
   v99 — RELANCER UN SALARIÉ QUI N'A PAS POINTÉ
   ================================================================
   Une heure après la fin prévue d'une intervention du jour (heure + durée
   prévue), si personne n'a pointé l'arrivée, chacun de ceux qui y sont
   affectés reçoit une notification. Une seule fois par intervention. Entre
   8 h et 21 h seulement. Tourne avec la préparation automatique (menu 31). */
function relancerPointages_(maintenant) {
  var now = maintenant || new Date();
  var h = now.getHours();
  if (h < 8 || h >= 21) return { relances: 0 };
  var c = notifConfig_();
  if (!c.app || !c.cle) return { relances: 0, motif: 'notifications non connectées' };
  var iso = isoJour_(now);
  var props = PropertiesService.getScriptProperties();
  var cle = 'RELANCES_POINTAGE_' + iso;
  var deja = {};
  try { deja = JSON.parse(props.getProperty(cle) || '{}'); } catch (e) { deja = {}; }
  var n = 0;
  objetsDe_(SH.CHANTIERS).forEach(function (o) {
    var id = String(o.ID || '').trim();
    if (!id || deja[id]) return;
    if (!(o.DATE instanceof Date) || isoJour_(o.DATE) !== iso) return;
    var st = String(o.STATUT || '').toUpperCase().trim();
    if (st !== 'PLANIFIE' && st !== '') return;
    if (o.ARRIVEE && String(o.ARRIVEE).trim()) return;
    var qui = String(o.PRESTATAIRE || '').trim();
    if (!qui) return;
    var hh = o.HEURE instanceof Date ? o.HEURE.getHours() * 60 + o.HEURE.getMinutes()
      : (function (x) { var m = String(x || '').match(/(\d{1,2})[:h](\d{2})?/); return m ? Number(m[1]) * 60 + Number(m[2] || 0) : -1; })(o.HEURE);
    if (hh < 0) return;
    var fin = hh + (Math.round(Number(o.DUREE_PREVUE_MIN) || 0) || 120) + 60;
    if (h * 60 + now.getMinutes() < fin) return;
    try {
      notifier_(qui, 'Pense à pointer', String(o.CLIENT || 'Intervention') +
                ' : appuie sur Arrivée puis Départ dans l\'appli, même après coup.', '');
      deja[id] = 1; n++;
    } catch (eN) {}
  });
  if (n) {
    props.setProperty(cle, JSON.stringify(deja));
    tracerServeur_('SYSTEME', 'RELANCE POINTAGE', n + ' intervention(s) non pointée(s)', '', '');
  }
  return { relances: n };
}

/* ================================================================
   v99 — LA SIGNATURE À DISTANCE
   ================================================================
   Simon : « si je fais signer à distance, comment faire pour que le statut
   change bien en signé ? ». Le client reçoit un lien personnel (dans le mail
   du devis, ou envoyé par SMS depuis l'appli). La page signer.html lui
   montre le devis, il signe au doigt ou à la souris, et le devis passe à
   SIGNE ici même : interventions créées (dans le bac « à placer »), preuve
   PDF rangée dans le Drive, mail de confirmation au client et au gérant.
   Le lien est signé (HMAC) : impossible d'en fabriquer un pour un autre devis.
   C'est une signature électronique « simple » au sens du règlement eIDAS,
   avec horodatage, nom, image de la signature et appareil utilisé. */
function secretSignature_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('SIGNATURE_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SIGNATURE_SECRET', s); }
  return s;
}
function jetonSignature_(numero) {
  var b = Utilities.computeHmacSha256Signature(String(numero).trim(), secretSignature_());
  return Utilities.base64EncodeWebSafe(b).replace(/=+$/, '').slice(0, 22);
}
function lienSignature_(numero) {
  var reg = lireReglages_();
  var base = String(reg.url_appli || 'https://breizhbrillance.github.io/devis/').replace(/\/?$/, '/');
  return base + 'signer.html?n=' + encodeURIComponent(String(numero).trim()) + '&t=' + jetonSignature_(numero);
}
/* Le devis visé par un lien : le numéro du lien, ou celui d'avant la signature. */
function devisDuLien_(n, t) {
  var num = String(n || '').trim();
  if (!num || !t || String(t) !== jetonSignature_(num)) return null;
  var cible = null;
  lireDevis_().forEach(function (x) {
    if (String(x.NUMERO || '').trim() === num || String(x.NUMERO_ORIGINE || '').trim() === num) cible = x;
  });
  return cible;
}

function lienSignatureAppli_(d, com) {
  var num = String(d.numero || '').trim();
  var cible = null;
  lireDevis_().forEach(function (x) {
    if (String(x.NUMERO || '').trim() === num || String(x.NUMERO_ORIGINE || '').trim() === num) cible = x;
  });
  if (!cible) return { ok: false, erreur: 'devis introuvable' };
  if (String(com.role || '') !== 'ADMIN' && normNom_(cible.COMMERCIAL) !== normNom_(com.nom)) {
    return { ok: false, erreur: 'ce devis n\'est pas le vôtre' };
  }
  if (String(cible.STATUT || '').toUpperCase() === 'SIGNE') return { ok: false, erreur: 'ce devis est déjà signé' };
  var vrai = String(cible.NUMERO).trim();
  /* v108f — « ça m'ouvre une page mail alors que tu dois l'envoyer
     automatiquement, avec la formule de phrase que je t'ai envoyée ». Avec
     `envoyer`, le bureau envoie lui-même le mail du devis (texte de Simon,
     PDF joint, bouton « Signer le devis en ligne »), copie au commercial. */
  if (d.envoyer) {
    var a = String(d.email || cible.EMAIL || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) {
      return { ok: false, sansEmail: true, erreur: 'Pas d\'adresse e-mail valable pour ce client : indique-la.' };
    }
    var reg = lireReglages_();
    var pj = [];
    var idPdf = idDrive_(cible.LIEN_PDF);
    if (idPdf) { try { pj.push(DriveApp.getFileById(idPdf).getBlob()); } catch (ePj) {} }
    var copie = [];
    if (com && com.email) copie.push(com.email);
    if (reg.email_copie) copie.push(String(reg.email_copie));
    /* v108s — « quand je clique sur envoi par mail ça part direct sans me
       proposer vouvoiement, tutoiement ou personnalisé » : l'appli envoie
       maintenant le texte choisi (mail.texte), le bouton de signature suit. */
    var mpS = mailPerso_({ mail: d.mail }, { email: a });
    envoyerMail_({
      to: a, cc: copie.join(','),
      subject: mpS.sujet || ('Devis ' + vrai + ' — ' + (reg.societe_nom || 'BREIZH BRILLANCE')),
      name: String(reg.societe_nom || 'Devis'),
      replyTo: (com && com.email) || String(reg.societe_email || ''),
      htmlBody: mpS.texte ? corpsMailPerso_({ numero: vrai }, mpS.texte, reg) : corpsMail_({ numero: vrai }, reg, com),
      attachments: pj
    }, reg);
    noterTonDevis_(vrai, mpS.ton);
    if (d.email && String(d.email).trim() !== String(cible.EMAIL || '').trim()) {
      try { majDevis_(vrai, { EMAIL: a }); } catch (eE) {}
    }
    tracerServeur_(com.nom, 'LIEN DE SIGNATURE', 'envoyé par e-mail à ' + a + (pj.length ? '' : ' (sans PDF)'), vrai, d.appareil || '');
    return { ok: true, envoye: true, a: a, pdf: pj.length > 0, numero: vrai, url: lienSignature_(vrai),
             tel: String(cible.TELEPHONE || ''), contact: String(cible.CONTACT || '') };
  }
  tracerServeur_(com.nom, 'LIEN DE SIGNATURE', 'créé', vrai, d.appareil || '');
  return { ok: true, numero: vrai, url: lienSignature_(vrai), client: String(cible.CLIENT || ''),
           contact: String(cible.CONTACT || ''), email: String(cible.EMAIL || ''), tel: String(cible.TELEPHONE || '') };
}

function devisPublic_(d) {
  var x = devisDuLien_(d.n, d.t);
  if (!x) return { ok: false, erreur: 'Ce lien n\'est pas valable. Demandez un nouveau lien à Breizh Brillance.' };
  var reg = lireReglages_();
  var num = String(x.NUMERO).trim();
  var lignes = (lignesParDevis_()[num] || []).slice().sort(function (a, b) {
    return (Number(a.ORDRE) || 0) - (Number(b.ORDRE) || 0);
  }).map(function (l) {
    return { designation: String(l.DESIGNATION || ''), detail: String(l.DETAIL || ''),
             qte: Number(l.QTE) || 0, unite: String(l.UNITE || ''), pu: Number(l.PU_HT) || 0,
             rem: Number(l.REMISE_PCT) || 0, tva: Number(l.TVA) || 0, total: Number(l.TOTAL_HT) || 0 };
  });
  var res = {
    ok: true, numero: num, societe: String(reg.societe_nom || 'BREIZH BRILLANCE'),
    societeTel: String(reg.societe_tel || ''), societeEmail: String(reg.societe_email || ''),
    client: String(x.CLIENT || ''), contact: String(x.CONTACT || ''),
    adresse: [x.ADRESSE, [x.CP, x.VILLE].join(' ').trim()].filter(function (v) { return String(v || '').trim(); }).join(', '),
    objet: String(x.OBJET || ''), date: isoDe_(x.DATE) || '',
    passages: Number(x.PASSAGES_MOIS) || 0, recurrent: recurrentDevis_(x.NATURE, x.PASSAGES_MOIS, x.SANS_CONTRAT),
    lignes: lignes, ht: Number(x.TOTAL_HT) || 0, tva: Number(x.TOTAL_TVA) || 0, ttc: Number(x.TOTAL_TTC) || 0,
    mensuel: Number(x.TOTAL_HT_MENSUEL) || 0,
    signe: String(x.STATUT || '').toUpperCase() === 'SIGNE', signataire: String(x.SIGNATAIRE || ''),
    refuse: String(x.STATUT || '').toUpperCase() === 'REFUSE',
    /* v101 — un particulier qui signe à distance a 14 jours pour se
       rétracter (Code de la consommation, L221-18). La page de signature le
       lui dit, et lui demande s'il veut que l'intervention commence avant
       (L221-25). */
    particulier: String(x.TYPE_CLIENT || '').toUpperCase().indexOf('PART') === 0
  };
  if (!res.signe && !res.refuse) {
    tracerServeur_(String(x.COMMERCIAL || '') || 'CLIENT', 'DEVIS CONSULTE EN LIGNE',
                   String(d.appareil || '').slice(0, 120), num, 'signature en ligne');
  }
  /* Le PDF du devis, pour que le client lise exactement ce qu'il signe. */
  var id = idDrive_(x.LIEN_PDF);
  if (id && d.pdf) {
    try { res.pdf = Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes()); } catch (e) {}
  }
  res.aPdf = !!id;
  return res;
}

function signerDistance_(d) {
  var x = devisDuLien_(d.n, d.t);
  if (!x) return { ok: false, erreur: 'Ce lien n\'est pas valable. Demandez un nouveau lien à Breizh Brillance.' };
  var st = String(x.STATUT || '').toUpperCase().trim();
  if (st === 'SIGNE') return { ok: true, deja: true, numero: String(x.NUMERO) };
  if (st === 'REFUSE') return { ok: false, erreur: 'Ce devis a été clôturé. Contactez Breizh Brillance.' };
  var nom = String(d.nom || '').trim();
  if (nom.length < 2) return { ok: false, erreur: 'Indiquez votre nom et votre qualité.' };
  if (!d.accepte) return { ok: false, erreur: 'Cochez « Bon pour accord » pour signer.' };
  var img = String(d.image || '');
  var m = img.match(/^data:image\/png;base64,([A-Za-z0-9+\/=]+)$/);
  if (!m || m[1].length < 800) return { ok: false, erreur: 'La signature est vide. Signez dans le cadre.' };
  if (m[1].length > 900000) return { ok: false, erreur: 'Signature trop lourde, recommencez.' };

  var particulier = String(x.TYPE_CLIENT || '').toUpperCase().indexOf('PART') === 0;
  var anticipe = !!(particulier && d.anticipe);
  if (anticipe && !d.perteDroit) {
    return { ok: false, erreur: 'Pour commencer avant 14 jours, cochez aussi la case sur la perte du droit de rétractation.' };
  }

  var reg = lireReglages_();
  var quand = new Date();
  var commercial = String(x.COMMERCIAL || '');
  var numAvant = String(x.NUMERO).trim();

  /* v101 — l'empreinte du devis signé : SHA-256 du PDF archivé, celui que la
     page a montré au client. Elle prouve, plus tard, que le document n'a pas
     changé depuis la signature (Code civil, art. 1366 : intégrité). */
  var empreinte = '';
  try {
    var idPdf = idDrive_(x.LIEN_PDF);
    if (idPdf) empreinte = hexDe_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
                                                          DriveApp.getFileById(idPdf).getBlob().getBytes()));
  } catch (eH) {}
  var finRetract = new Date(quand.getTime()); finRetract.setDate(finRetract.getDate() + 14);
  /* Le passage à SIGNE passe par le même chemin que le bouton « Signé » de
     l'appli : nouveau numéro, interventions créées, contrat, journal. */
  var r = enregistrerStatut_({ numero: numAvant, verdict: 'SIGNE', quand: quand.getTime(),
                               appareil: 'signature en ligne' }, { nom: commercial || 'CLIENT', role: 'COMMERCIAL' });
  if (!r || !r.ok) return { ok: false, erreur: 'La signature n\'a pas pu être enregistrée. Réessayez dans un instant.' };
  var num = String(r.numero || numAvant);

  /* La preuve : un PDF qui reprend le devis, la signature, le nom, l'heure. */
  var lien = '', preuve = null;
  try {
    var lp = (lignesParDevis_()[num] || lignesParDevis_()[numAvant] || []).slice().sort(function (a, b) {
      return (Number(a.ORDRE) || 0) - (Number(b.ORDRE) || 0);
    });
    var lignesHtml = lp.map(function (l) {
      return '<tr><td>' + echHtml_(l.DESIGNATION) + (l.DETAIL ? '<br><small>' + echHtml_(l.DETAIL) + '</small>' : '') +
        '</td><td style="text-align:right">' + echHtml_(nbFr_(l.QTE)) + ' ' + echHtml_(l.UNITE) +
        '</td><td style="text-align:right">' + eur_(l.TOTAL_HT) + '</td></tr>';
    }).join('');
    var html = '<html><body style="font-family:Arial,sans-serif;font-size:12px;color:#111">' +
      '<h2 style="margin:0">' + echHtml_(reg.societe_nom || 'BREIZH BRILLANCE') + '</h2>' +
      '<p>Devis <b>' + echHtml_(num) + '</b>' + (num !== numAvant ? ' (anciennement ' + echHtml_(numAvant) + ')' : '') +
      ' — ' + echHtml_(x.CLIENT) + '<br>' + echHtml_([x.ADRESSE, x.CP, x.VILLE].join(' ')) + '</p>' +
      (x.OBJET ? '<p>Objet : ' + echHtml_(x.OBJET) + '</p>' : '') +
      '<table style="width:100%;border-collapse:collapse" border="1" cellpadding="5">' +
      '<tr style="background:#eee"><th style="text-align:left">Prestation</th><th>Quantité</th><th>Total HT</th></tr>' +
      lignesHtml + '</table>' +
      '<p style="text-align:right">Total HT : <b>' + eur_(x.TOTAL_HT) + '</b> · TVA : ' + eur_(x.TOTAL_TVA) +
      ' · Total TTC : <b>' + eur_(x.TOTAL_TTC) + '</b>' +
      (Number(x.TOTAL_HT_MENSUEL) ? '<br>dont ' + eur_(x.TOTAL_HT_MENSUEL) + ' HT par mois (forfait lissé sur 52 semaines)' : '') + '</p>' +
      '<h3>Bon pour accord</h3>' +
      '<p>Signé en ligne par <b>' + echHtml_(nom) + '</b> le ' +
      Utilities.formatDate(quand, 'Europe/Paris', 'dd/MM/yyyy à HH:mm:ss') + ' (heure de Paris).</p>' +
      '<img src="data:image/png;base64,' + m[1] + '" style="height:110px;border:1px solid #ccc">' +
      (particulier ? '<h3>Droit de rétractation</h3><p>' + (anticipe
        ? 'Le client a demandé expressément que l\'intervention commence avant la fin du délai de rétractation de 14 jours, ' +
          'et a reconnu qu\'il perdra ce droit une fois la prestation entièrement exécutée (Code de la consommation, art. L221-25 et L221-28).'
        : 'Le client n\'a pas demandé de commencement avant la fin du délai de rétractation : aucune intervention avant le ' +
          Utilities.formatDate(finRetract, 'Europe/Paris', 'dd/MM/yyyy') + ' inclus.') + '</p>' : '') +
      '<h3>Dossier de preuve</h3>' +
      '<table style="width:100%;border-collapse:collapse;font-size:10.5px" border="1" cellpadding="4">' +
      '<tr><td>Procédé</td><td>Signature électronique simple (règlement eIDAS n° 910/2014, art. 25 ; Code civil, art. 1366-1367) : ' +
        'lien personnel envoyé à l\'adresse du client, consultation du devis, nom et qualité saisis, case « Bon pour accord » cochée, signature tracée.</td></tr>' +
      '<tr><td>Lien envoyé à</td><td>' + echHtml_(String(x.EMAIL || '—')) + '</td></tr>' +
      '<tr><td>Référence du lien</td><td>' + echHtml_(String(d.t).slice(0, 12)) + '…</td></tr>' +
      '<tr><td>Empreinte SHA-256 du devis PDF</td><td style="word-break:break-all">' + echHtml_(empreinte || 'PDF non archivé') + '</td></tr>' +
      '<tr><td>Texte accepté</td><td>« Bon pour accord : j\'accepte ce devis et ses conditions, et je le signe électroniquement. »</td></tr>' +
      '<tr><td>Appareil</td><td>' + echHtml_(String(d.appareil || '').slice(0, 200)) + '</td></tr>' +
      '<tr><td>Horodatage</td><td>' + Utilities.formatDate(quand, 'Europe/Paris', 'dd/MM/yyyy HH:mm:ss') +
        ' (Europe/Paris) — consultation et envoi tracés au journal du classeur</td></tr>' +
      '</table>' +
      '</body></html>';
    preuve = Utilities.newBlob(html, 'text/html', 'preuve.html').getAs('application/pdf')
      .setName('Devis ' + numeroFichier_(num) + ' - signé en ligne.pdf');
    lien = dossierDevis_(reg, x.DATE instanceof Date ? x.DATE : quand, commercial).createFile(preuve).getUrl();
  } catch (eP) {
    tracerServeur_('SYSTEME', 'PREUVE SIGNATURE ECHEC', String(eP && eP.message || eP).slice(0, 200), num, '');
  }
  var maj = { SIGNATAIRE: nom, PREUVE_SIGNATURE: lien || 'signé en ligne le ' +
                   Utilities.formatDate(quand, 'Europe/Paris', 'dd/MM/yyyy HH:mm') };
  /* Pas de demande de commencer plus tôt : les créneaux proposés au gérant
     partent du lendemain du délai de rétractation. */
  if (particulier && !anticipe) {
    var apres = new Date(finRetract.getTime()); apres.setDate(apres.getDate() + 1); apres.setHours(12, 0, 0, 0);
    if (!(x.DATE_SOUHAITEE instanceof Date) || x.DATE_SOUHAITEE < apres) maj.DATE_SOUHAITEE = apres;
  }
  majDevis_(num, maj);
  tracerServeur_(commercial || 'CLIENT', 'DEVIS SIGNE EN LIGNE', nom + ' · SHA-256 ' + (empreinte || '—').slice(0, 16) +
                 (particulier ? (anticipe ? ' · commencement anticipé demandé' : ' · pas avant le ' +
                   Utilities.formatDate(finRetract, 'Europe/Paris', 'dd/MM')) : '') +
                 ' · ' + String(d.appareil || '').slice(0, 80), num, 'signature en ligne');

  /* Le client reçoit sa copie ; le gérant et le commercial sont prévenus. */
  try {
    var pj = preuve ? [preuve] : [];
    /* Le client garde aussi le devis lui-même (avec ses conditions et, pour un
       particulier, le formulaire de rétractation) : c'est son support durable. */
    try { var idP = idDrive_(x.LIEN_PDF); if (idP) pj = pj.concat([DriveApp.getFileById(idP).getBlob()]); } catch (ePj) {}
    if (String(x.EMAIL || '').trim()) {
      envoyerMail_({ to: String(x.EMAIL).trim(), subject: 'Devis ' + num + ' signé — ' + (reg.societe_nom || ''),
                     name: String(reg.societe_nom || 'Devis'), replyTo: String(reg.societe_email || ''),
                     htmlBody: '<p>Bonjour,</p><p>Merci ! Votre signature du devis ' + echHtml_(num) +
                       ' est bien enregistrée. Vous trouverez en pièces jointes le devis et la preuve de signature.</p>' +
                       (particulier ? '<p>' + (anticipe
                         ? 'Vous avez demandé que l\'intervention commence avant la fin de votre délai de rétractation de 14 jours.'
                         : 'Vous disposez de 14 jours, jusqu\'au ' + Utilities.formatDate(finRetract, 'Europe/Paris', 'dd/MM/yyyy') +
                           ', pour vous rétracter avec le formulaire joint au devis. Nous n\'interviendrons pas avant.') + '</p>' : '') +
                       '<p>Nous revenons vers vous très vite pour fixer la date d\'intervention.</p>' +
                       '<p>' + echHtml_(reg.societe_nom || '') + '</p>', attachments: pj }, reg);
    }
    var dest = String(reg.recap_email || '').trim() || Session.getEffectiveUser().getEmail();
    var com = trouverPersonne_(commercial);
    envoyerMail_({ to: dest + (com && com.email && com.email !== dest ? ',' + com.email : ''),
                   subject: '✍️ Devis ' + num + ' signé en ligne — ' + String(x.CLIENT || ''),
                   htmlBody: '<p>' + echHtml_(x.CLIENT) + ' a signé le devis ' + echHtml_(num) + ' en ligne (' +
                     echHtml_(nom) + ', ' + Utilities.formatDate(quand, 'Europe/Paris', 'dd/MM HH:mm') + ').</p>' +
                     '<p>Montant : ' + eur_(x.TOTAL_HT) + ' HT. Les interventions sont dans le bac « à placer » du Planning.</p>' +
                     (particulier && !anticipe ? '<p><b>Particulier : pas d\'intervention avant le ' +
                       Utilities.formatDate(new Date(finRetract.getTime() + 86400000), 'Europe/Paris', 'dd/MM/yyyy') +
                       '</b> (délai de rétractation, il n\'a pas demandé de commencer plus tôt).</p>' : '') +
                     (particulier && anticipe ? '<p>Particulier : il a demandé un commencement avant la fin du délai de rétractation.</p>' : '') +
                     (lien ? '<p><a href="' + lien + '">Preuve de signature (PDF)</a></p>' : ''), attachments: pj }, reg);
  } catch (eM) {
    tracerServeur_('SYSTEME', 'MAIL RATE', 'signature en ligne ' + num + ' — ' + String(eM && eM.message || eM), num, '');
  }
  try {
    lireAdmins_().forEach(function (a) {
      notifier_(a.nom, 'Devis signé en ligne', String(x.CLIENT || '') + ' · ' + eur_(x.TOTAL_HT) + ' HT', '');
    });
    if (commercial) notifier_(commercial, 'Devis signé en ligne', String(x.CLIENT || '') + ' · ' + num, '');
  } catch (eN) {}
  return { ok: true, numero: num };
}

function compteRendu_(titre, r) {
  var l = [titre];
  if (r.faits.length) l.push('', 'Brouillons créés dans Pennylane :');
  r.faits.forEach(function (x) { l.push('  ✓ ' + x.client + ' — ' + nb_(x.ht) + ' € HT' + (x.ecart ? ' (' + x.ecart + ')' : '')); });
  if (r.sautes.length) l.push('', 'Sautés :');
  r.sautes.forEach(function (x) { l.push('  · ' + x.client + ' — ' + x.motif); });
  if (r.echecs.length) l.push('', 'En échec :');
  r.echecs.forEach(function (x) { l.push('  ✗ ' + x.client + ' — ' + x.erreur); });
  if (!r.faits.length && !r.sautes.length && !r.echecs.length) l.push('', 'Rien à préparer.');
  l.push('', 'Rien n\'a été envoyé : relis et valide dans Pennylane (Ventes → Factures, brouillons).');
  return l.join('\n');
}

function menuConstruireContrats() {
  var ui = SpreadsheetApp.getUi();
  var r = construireContrats_();
  ui.alert('Onglet CONTRATS',
    r.ajoutes + ' ligne(s) ajoutée(s), ' + r.completes + ' complétée(s).\n\n' +
    'À vérifier ligne par ligne : le montant mensuel, le nom de facturation (CLIENT_FACTURE), ' +
    'le SIREN, l\'e-mail et l\'adresse. Une ligne passée à ACTIF = NON n\'est pas facturée.' +
    (r.sansPrix.length ? '\n\nSéries sans prix dans leur note (non reprises) :\n' + r.sansPrix.join('\n') : ''),
    ui.ButtonSet.OK);
}

function menuBrouillonsContrats() {
  var ui = SpreadsheetApp.getUi();
  if (!pennylaneJeton_()) return ui.alert('Pennylane n\'est pas connecté : lance d\'abord le menu 25.');
  var def = moisEcoule_();
  var q = ui.prompt('Brouillons des contrats',
    'Quel mois facturer ? Écris-le comme ' + def + ' (par défaut : ' + moisLisible_(def) + ', le mois écoulé).',
    ui.ButtonSet.OK_CANCEL);
  if (q.getSelectedButton() !== ui.Button.OK) return;
  var p = String(q.getResponseText() || '').trim() || def;
  if (!/^\d{4}-\d{2}$/.test(p)) return ui.alert('Mois illisible : ' + p);
  var r = facturesContrats_(p, { nom: 'CLASSEUR' });
  ui.alert('Contrats — ' + moisLisible_(p), compteRendu_('', r), ui.ButtonSet.OK);
}

function menuBrouillonsPonctuels() {
  var ui = SpreadsheetApp.getUi();
  if (!pennylaneJeton_()) return ui.alert('Pennylane n\'est pas connecté : lance d\'abord le menu 25.');
  ui.alert('Chantiers terminés', compteRendu_('', facturesPonctuels_({ nom: 'CLASSEUR' })), ui.ButtonSet.OK);
}

function activerPreparationAuto() {
  var ui = SpreadsheetApp.getUi();
  arreterPreparationAuto_(true);
  ScriptApp.newTrigger('preparationAutomatique').timeBased().everyHours(1).create();
  tracerServeur_('SYSTEME', 'PREPARATION AUTO ACTIVEE', '', '', '');
  ui.alert('Préparation automatique activée.\n\nToutes les heures : les chantiers terminés depuis deux heures, ' +
    'et le 3 du mois les contrats du mois écoulé, deviennent des BROUILLONS dans Pennylane.\n\n' +
    'Rien n\'est envoyé aux clients.');
}
function arreterPreparationAuto_(sansMot) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'preparationAutomatique') ScriptApp.deleteTrigger(t);
  });
  if (!sansMot) SpreadsheetApp.getUi().alert('Préparation automatique arrêtée.');
}
function arreterPreparationAuto() { arreterPreparationAuto_(false); }

/* ====================== LES COURRIELS ======================
   Tout courriel de l'appli passe par ici, et par ici seulement : c'est ce qui
   garantit que la bannière de la maison est en bas de chacun, sans exception.
   Un envoi direct par MailApp ailleurs dans ce fichier est une faute. */

/* Un texte brut rendu lisible en HTML : caractères spéciaux neutralisés, sauts
   de ligne gardés, adresses web cliquables. */
function texteEnHtml_(t) {
  var h = String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">' +
         h.replace(/\r?\n/g, '<br>') + '</div>';
}

/* La bannière, ou rien : une adresse absente ou qui n'est pas en https ne
   produit aucune image, plutôt qu'un cadre cassé en bas du courriel. */
function banniereHtml_(reg) {
  var url = String((reg && reg.banniere_url) || '').trim();
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return '';
  var alt = String((reg && reg.societe_nom) || '').replace(/[&<>"]/g, '');
  return '<br><br><img src="' + url + '" alt="' + alt + '" width="600" ' +
         'style="display:block;width:100%;max-width:600px;height:auto;border:0">';
}

/**
 * Envoie un courriel avec la bannière en bas.
 * m : { to, subject, body (texte) et/ou htmlBody, cc, name, replyTo, attachments }.
 * Le texte brut, quand il existe, part aussi : une messagerie qui n'affiche pas
 * le HTML garde un courriel lisible.
 */
function envoyerMail_(m, reg) {
  reg = reg || lireReglages_();
  var o = {};
  for (var k in m) { if (m.hasOwnProperty(k) && m[k] !== undefined) o[k] = m[k]; }
  var html = (m.htmlBody !== undefined && m.htmlBody !== null)
    ? String(m.htmlBody) : texteEnHtml_(m.body);
  o.htmlBody = html + banniereHtml_(reg);
  if (o.name === undefined) {
    var enseigne = String(reg.societe_nom || '').trim();
    if (enseigne) o.name = enseigne;
  }
  /* L'adresse d'expédition, elle, reste celle du compte Google qui porte le
     script : la changer demanderait à Apps Script un accès large à toute la
     boîte Gmail, et ce n'est pas un prix à payer pour une ligne d'en-tête.
     Deux champs suffisent à ce que le client voie la maison et lui réponde :
     le nom affiché, posé plus haut, et l'adresse de réponse ci-dessous.
     « Répondre » part alors chez BREIZH BRILLANCE, pas dans une boîte
     personnelle — et personne n'a à y penser. */
  /* v108h — « il faut qu'on ne voie nulle part le simon.horras56 ». Les
     réponses vont toujours à l'adresse de la maison (contact@ par défaut),
     jamais à celle d'une personne, et les copies internes passent en copie
     cachée : le client ne voit aucune adresse interne. */
  var maison = String(reg.email_expediteur || 'contact@breizhbrillance.fr').trim();
  o.replyTo = maison;
  if (o.cc) {
    o.bcc = [o.bcc, o.cc].filter(function (x) { return String(x || '').trim(); }).join(',');
    delete o.cc;
  }
  if (o.bcc && String(o.bcc).split(',').every(function (x) { return String(x).trim().toLowerCase() === String(o.to || '').trim().toLowerCase(); })) delete o.bcc;
  /* v108i — l'expéditeur est contact@ (adresse « Envoyer en tant que »
     déclarée dans le Gmail du compte du script, le 10 novembre). GmailApp
     sait choisir l'expéditeur, MailApp non. Si l'adresse n'est pas (ou plus)
     déclarée, on retombe sur MailApp plutôt que de perdre le mail. */
  /* v108r — le 11 novembre, le journal des e-mails de la console Google le
     dit : les mails de l'appli partis par MailApp sont « Message rejected »
     par Gmail (support.google.com/mail/answer/69585), alors que le même mail
     (PDF, bandeau, lien de signature) transféré depuis Gmail arrive. Quand le
     script tourne sous l'adresse de la maison, on envoie donc par GmailApp,
     le chemin des mails écrits à la main. MailApp ne sert plus que de secours. */
  var moi = '';
  try { moi = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (eM) {}
  if (moi && moi === maison.toLowerCase()) {
    try {
      var optM = { htmlBody: o.htmlBody, name: o.name, replyTo: o.replyTo };
      if (o.bcc) optM.bcc = o.bcc;
      if (o.attachments && o.attachments.length) optM.attachments = o.attachments;
      GmailApp.sendEmail(o.to, o.subject, texteDuHtml_(o.htmlBody), optM);
      return;
    } catch (eGm) {
      tracerServeur_('SYSTEME', 'ENVOI GMAIL IMPOSSIBLE', 'repli MailApp — ' + String(eGm && eGm.message || eGm).slice(0, 200), '', '');
    }
  }
  if (expediteurDispo_(maison)) {
    try {
      var opt = { htmlBody: o.htmlBody, from: maison, name: o.name, replyTo: o.replyTo };
      if (o.bcc) opt.bcc = o.bcc;
      if (o.attachments && o.attachments.length) opt.attachments = o.attachments;
      GmailApp.sendEmail(o.to, o.subject, texteDuHtml_(o.htmlBody), opt);
      return;
    } catch (eG) {
      tracerServeur_('SYSTEME', 'ENVOI CONTACT@ IMPOSSIBLE', String(eG && eG.message || eG).slice(0, 200), '', '');
    }
  }
  MailApp.sendEmail(o);
}

/* Menu 35 — v108r. Lancé une fois depuis le classeur par le gérant : Google
   demande l'autorisation d'envoyer par Gmail (GmailApp). Sans elle, les mails
   de l'appli repartent par MailApp, que Gmail rejette pour ce domaine. */
function autoriserEnvoiGmail() {
  var moi = '';
  try { moi = Session.getEffectiveUser().getEmail(); } catch (e) {}
  var n = GmailApp.getInboxUnreadCount();
  tracerServeur_('SYSTEME', 'ENVOI GMAIL AUTORISE', moi + ' (' + n + ' non lus)', '', '');
  try { SpreadsheetApp.getUi().alert('C\'est bon : les mails de l\'appli partiront par Gmail depuis ' + moi + '.'); } catch (e2) {}
  return moi;
}

/* L'adresse est-elle déclarée comme expéditeur dans le Gmail du script ?
   Vérifié une fois par 6 heures (cache), pour ne pas interroger Gmail à
   chaque mail. */
function expediteurDispo_(adresse) {
  var a = String(adresse || '').trim().toLowerCase();
  if (!a) return false;
  /* v108k — après la migration, le script tourne sous contact@ : MailApp
     envoie déjà depuis cette adresse, inutile de passer par Gmail. */
  try { if (String(Session.getEffectiveUser().getEmail() || '').toLowerCase() === a) return false; } catch (eU) {}
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e0) {}
  var cle = 'alias:' + a;
  var v = cache ? cache.get(cle) : null;
  if (v === '1') return true;
  if (v === '0') return false;
  var ok = false;
  try {
    var al = GmailApp.getAliases();
    ok = al.some(function (x) { return String(x).trim().toLowerCase() === a; });
    if (!ok) tracerServeur_('SYSTEME', 'EXPEDITEUR NON DECLARE', a + ' absent des adresses Gmail (' + al.join(', ') + ')', '', '');
  } catch (e) {
    ok = false;
    tracerServeur_('SYSTEME', 'EXPEDITEUR ILLISIBLE', String(e && e.message || e).slice(0, 200), '', '');
  }
  try { if (cache) cache.put(cle, ok ? '1' : '0', 21600); } catch (e2) {}
  return ok;
}
/* ===================== MIGRATION VERS contact@ (v108k) =====================
   « Il faut qu'on ne voie nulle part le simon.horras56 » : le classeur, le
   script et l'application Web passent sous le compte contact@. Déroulé :
   1. ANCIEN projet : migrationPreparer() — partage le classeur et les dossiers
      avec contact@, recopie les propriétés du script dans un onglet caché
      MIGRATION (aucune clé ne passe par l'écran ni par la discussion).
   2. contact@ : Fichier > Créer une copie du classeur (le script suit).
   3. NOUVEAU projet : déployer l'application Web, puis migrationTerminer() —
      reprend les propriétés, repose les déclencheurs, efface l'onglet et écrit
      la nouvelle adresse dans l'onglet MIGRATION de l'ancien classeur.
   4. ANCIEN projet : migrationBasculer() — retire ses déclencheurs et relaie
      désormais chaque appel vers la nouvelle adresse (les téléphones pas
      encore mis à jour continuent de marcher).                              */
var MIGRATION_CIBLE_ = 'contact@breizhbrillance.fr';
var MIGRATION_ONGLET_ = 'MIGRATION';
var MIGRATION_PROP_ = 'MIGRATION_URL';

function relaisMigration_() {
  try {
    var u = String(PropertiesService.getScriptProperties().getProperty(MIGRATION_PROP_) || '').trim();
    if (!u) return '';
    var moi = '';
    try { moi = String(ScriptApp.getService().getUrl() || ''); } catch (e1) {}
    return u === moi ? '' : u;
  } catch (e) { return ''; }
}

function relayer_(url, e, post) {
  var q = e && e.queryString ? '?' + e.queryString : '';
  var opt = { muteHttpExceptions: true, followRedirects: true };
  if (post) {
    opt.method = 'post';
    opt.payload = e && e.postData ? e.postData.contents : '';
    opt.contentType = e && e.postData && e.postData.type ? e.postData.type : 'text/plain';
  }
  try {
    var r = UrlFetchApp.fetch(url + q, opt);
    return ContentService.createTextOutput(r.getContentText()).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return reponse_({ ok: false, erreur: 'Service déplacé, relais impossible : ' + String(err && err.message || err) });
  }
}

function ongletMigration_(ss, creer) {
  var sh = ss.getSheetByName(MIGRATION_ONGLET_);
  if (!sh && creer) { sh = ss.insertSheet(MIGRATION_ONGLET_); sh.hideSheet(); }
  return sh;
}

function partagerAvec_(id, qui) {
  id = String(id || '').trim();
  if (!id) return '';
  try { DriveApp.getFileById(id).addEditor(qui); return 'fichier ' + id; } catch (e1) {}
  try { DriveApp.getFolderById(id).addEditor(qui); return 'dossier ' + id; } catch (e2) {}
  return 'ÉCHEC ' + id;
}

/** ÉTAPE 1 — à lancer dans l'ANCIEN projet (compte actuel). */
function migrationPreparer() {
  var ss = SpreadsheetApp.getActive();
  var reg = lireReglages_();
  var faits = [];
  [ss.getId(), reg.dossier_racine_id, reg.dossier_drive_id, reg.prospection_fichier_id].forEach(function (id) {
    var r = partagerAvec_(id, MIGRATION_CIBLE_); if (r) faits.push(r);
  });
  var props = PropertiesService.getScriptProperties().getProperties();
  delete props[MIGRATION_PROP_];
  var decl = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  var sh = ongletMigration_(ss, true);
  sh.clear();
  sh.getRange(1, 1, 4, 2).setValues([
    ['source', ss.getId()],
    ['proprietes', JSON.stringify(props)],
    ['declencheurs', JSON.stringify(decl)],
    ['prepare_le', new Date().toISOString()]
  ]);
  tracerServeur_('SYSTEME', 'MIGRATION PREPAREE', Object.keys(props).length + ' propriétés, déclencheurs : ' +
    decl.join(', ') + ' ; partages : ' + faits.join(' | '), '', '');
  Logger.log('Propriétés : %s — déclencheurs : %s — partages : %s', Object.keys(props).length, decl.join(', '), faits.join(' | '));
}

/** ÉTAPE 3 — à lancer dans le NOUVEAU projet (contact@), après le déploiement Web. */
function migrationTerminer() {
  var ss = SpreadsheetApp.getActive();
  var sh = ongletMigration_(ss, false);
  if (!sh) throw new Error('Onglet MIGRATION absent : lance d\'abord migrationPreparer dans l\'ancien projet, puis recopie le classeur.');
  var v = {};
  sh.getDataRange().getValues().forEach(function (l) { v[String(l[0])] = l[1]; });
  if (String(v.source) === ss.getId()) throw new Error('Ce classeur est l\'ancien : lance cette fonction dans la COPIE.');
  var props = JSON.parse(String(v.proprietes || '{}'));
  delete props[MIGRATION_PROP_];
  var p = PropertiesService.getScriptProperties();
  p.setProperties(props, false);
  p.deleteProperty(MIGRATION_PROP_);
  var voulus = JSON.parse(String(v.declencheurs || '[]'));
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var poses = [], inconnus = [], vus = {};
  voulus.forEach(function (h) {
    if (vus[h]) return; vus[h] = true;
    if (h === 'preparationAutomatique') {
      ScriptApp.newTrigger(h).timeBased().everyHours(1).create(); poses.push(h);
    } else if (h === AUTOMATE_) {
      ScriptApp.newTrigger(h).timeBased().atHour(7).everyDays(1).inTimezone('Europe/Paris').create(); poses.push(h);
    } else if (h === MAJ_PROSPECTS_) {
      [ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.WEDNESDAY, ScriptApp.WeekDay.FRIDAY].forEach(function (j) {
        ScriptApp.newTrigger(h).timeBased().onWeekDay(j).atHour(6).inTimezone('Europe/Paris').create();
      });
      poses.push(h);
    } else inconnus.push(h);
  });
  var url = '';
  try { url = String(ScriptApp.getService().getUrl() || ''); } catch (e0) {}
  ss.deleteSheet(sh);
  var ecritAncien = false;
  if (url && v.source) {
    try {
      var ancien = SpreadsheetApp.openById(String(v.source));
      var sa = ongletMigration_(ancien, true);
      sa.clear();
      sa.getRange(1, 1, 2, 2).setValues([['nouvelle_url', url], ['terminee_le', new Date().toISOString()]]);
      ecritAncien = true;
    } catch (e1) {}
  }
  tracerServeur_('SYSTEME', 'MIGRATION TERMINEE', Object.keys(props).length + ' propriétés ; déclencheurs posés : ' +
    poses.join(', ') + (inconnus.length ? ' ; À REPOSER À LA MAIN : ' + inconnus.join(', ') : '') +
    ' ; adresse : ' + (url || 'PAS DÉPLOYÉ') + (ecritAncien ? '' : ' ; ancien classeur non prévenu'), '', '');
  Logger.log('Propriétés : %s — déclencheurs : %s — à reposer : %s — adresse : %s — ancien prévenu : %s',
    Object.keys(props).length, poses.join(', '), inconnus.join(', '), url, ecritAncien);
}

/** ÉTAPE 4 — à lancer dans l'ANCIEN projet : il se tait et relaie vers le nouveau. */
function migrationBasculer() {
  var ss = SpreadsheetApp.getActive();
  var sh = ongletMigration_(ss, false);
  var v = {};
  if (sh) sh.getDataRange().getValues().forEach(function (l) { v[String(l[0])] = l[1]; });
  var url = String(v.nouvelle_url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^\/]+\/exec$/.test(url)) {
    throw new Error('Nouvelle adresse introuvable : lance d\'abord migrationTerminer dans le nouveau projet.');
  }
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); n++; });
  PropertiesService.getScriptProperties().setProperty(MIGRATION_PROP_, url);
  tracerServeur_('SYSTEME', 'MIGRATION BASCULEE', n + ' déclencheurs retirés ; relais vers ' + url, '', '');
  Logger.log('Relais vers %s — %s déclencheurs retirés', url, n);
}

function texteDuHtml_(h) {
  return String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** À lancer une fois depuis l'éditeur : accorde l'accès Gmail au script et
    envoie un mail d'essai de contact@ à contact@. */
function autoriserEnvoiContact() {
  /* Avec l'écran d'accord « à cocher » de Google, l'accès Gmail a pu rester
     décoché : cette ligne redemande tout ce qui manque. */
  try { ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL); } catch (eS) {}
  var a = String(lireReglages_().email_expediteur || 'contact@breizhbrillance.fr').trim();
  try { CacheService.getScriptCache().remove('alias:' + a.toLowerCase()); } catch (e) {}
  var dispo = expediteurDispo_(a);
  tracerServeur_('SYSTEME', 'ESSAI EXPEDITEUR', a + (dispo ? ' disponible' : ' NON disponible'), '', '');
  envoyerMail_({ to: a, subject: 'Essai — les mails partent bien de ' + a,
                 htmlBody: '<p>Bonjour,</p><p>Ce mail d\'essai vient de l\'application BREIZH BRILLANCE. ' +
                   'S\'il est arrivé avec l\'expéditeur ' + a + ', tout est en ordre.</p>' });
  Logger.log(dispo ? 'Expéditeur ' + a + ' disponible : mail d\'essai envoyé.' : 'Expéditeur ' + a + ' introuvable dans Gmail : mail envoyé par MailApp.');
}

/* Caractères spéciaux neutralisés : un nom de client avec une esperluette ne
   doit pas casser le courriel. */
function echHtml_(t) {
  return String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* « Monsieur Le Guern », « Madame Le Guern », ou le nom seul quand la civilité
   n'a pas été cochée sur place : jamais un « Monsieur » lancé au hasard. */
function appelClient_(c) {
  var n = String((c || {}).contact || '').trim();
  if (!n) return '';
  var civ = String((c || {}).civ || '').trim().toUpperCase();
  if (civ === 'M') return 'Monsieur ' + n;
  if (civ === 'MME') return 'Madame ' + n;
  return n;
}

/* Le mot qui accompagne le devis. Il est signé par le commercial qui a fait le
   chiffrage, avec SON téléphone (colonne TELEPHONE de l'onglet COMMERCIAUX) :
   c'est lui que le client doit pouvoir rappeler. Pas de numéro renseigné pour
   lui, c'est celui de la maison qui part. */
/* v100 — le message que le commercial a écrit lui-même dans l'appli.
   d.mail = { a, sujet, texte } ; à défaut, l'adresse de la fiche client. */
function mailPerso_(d, c) {
  var m = (d && d.mail && typeof d.mail === 'object') ? d.mail : {};
  var a = String(m.a || (c && c.email) || '').trim();
  if (a && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) a = String((c && c.email) || '').trim();
  return { a: a, sujet: String(m.sujet || '').trim().slice(0, 200), texte: String(m.texte || '').trim().slice(0, 6000),
           ton: /^tu$/i.test(String(m.ton || '')) ? 'TU' : (/^vous$/i.test(String(m.ton || '')) ? 'VOUS' : (m.texte ? 'PERSO' : '')) };
}
/* v108s — le ton choisi au premier envoi du devis (TU / VOUS / PERSO) reste
   sur le devis : les factures automatiques le reprennent. */
function noterTonDevis_(numero, ton) {
  if (!numero || !ton) return;
  try { colonneAssuree_(SH.DEVIS, 'TON_MAIL'); majDevis_(numero, { TON_MAIL: ton }); } catch (e) {}
}
/* Les textes de facture donnés par Simon (7 novembre), au vous ou au tu ;
   les réglages mail_facture_contrat / mail_facture_ponctuel (au vous) les
   remplacent s'ils sont remplis. Signature et bandeau sont ajoutés ensuite. */
function texteFacture_(contrat, tu, reg) {
  reg = reg || lireReglages_();
  var regle = String((contrat ? reg.mail_facture_contrat : reg.mail_facture_ponctuel) || '').trim();
  if (regle && !tu) return regle;
  return 'Bonjour,\n\n' + (tu ? 'J\u2019espère que tu vas bien !' : 'J\u2019espère que vous allez bien !') + '\n\n' +
    (contrat ? 'Suite à nos passages ce mois-ci,' : 'Suite à notre prestation,') + '\n\n' +
    (tu ? 'Je te transmets' : 'Je vous transmets') + ' ci-dessous la facture correspondant à ' +
    (contrat ? 'nos prestations.' : 'cette dernière.') + '\n\nBelle journée,';
}
/* Son texte tel quel (paragraphes et retours à la ligne gardés, rien
   d'interprété comme du HTML), puis le bouton de signature en ligne si le
   devis n'est pas déjà signé. */
function corpsMailPerso_(devis, texte, reg) {
  var paras = sansSignature_(texte).split(/\n{2,}/).map(function (p) {
    return '<p style="margin:0 0 14px">' + echHtml_(p).replace(/\n/g, '<br>') + '</p>';
  }).join('');
  var bouton = (devis && devis.numero && !devis.signature)
    ? '<p style="margin:24px 0 6px"><a href="' + lienSignature_(devis.numero) + '" style="background:#004C92;color:#fff;' +
      'padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Signer le devis en ligne</a></p>' +
      '<p style="font-size:12px;color:#6b7280;margin:0">Un clic, une signature au doigt ou à la souris, et vous recevez ' +
      'aussitôt votre copie signée. Le devis est aussi en pièce jointe.</p>'
    : '';
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937">' +
    paras + bouton + signatureHtml_(reg) + '</div>';
}

function corpsMail_(devis, reg, com, revise) {
  /* v106 — le texte de Simon (9 novembre) pour tout envoi de devis sans
     message personnalisé ; la signature et le bandeau suivent, comme ailleurs. */
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937">' +
    '<p>Bonjour,</p>' +
    '<p>J\u2019espère que vous allez bien !</p>' +
    '<p>Suite à notre contact,</p>' +
    '<p>Je vous transmets ci-dessous le devis ' + (revise ? 'corrigé ' : '') + 'correspondant à votre demande.</p>' +
    (devis && devis.numero && !devis.signature
      ? '<p style="margin:22px 0"><a href="' + lienSignature_(devis.numero) + '" style="background:#004C92;color:#fff;' +
        'padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Signer le devis en ligne</a></p>' +
        '<p style="font-size:12px;color:#6b7280">Un clic, une signature au doigt ou à la souris : c\'est tout. ' +
        'Vous recevrez aussitôt votre copie signée.</p>'
      : '') +
    '<p>Belle journée,</p>' + signatureHtml_(reg) +
    '</div>';
}

/* ====================== TEST DEPUIS L'ÉDITEUR ====================== */

function testerDevis() {
  var com = lireCommerciaux_()[0];
  var res = enregistrer_({
    nom: com.nom, code: com.code, appareil: 'test-editeur', envoyerClient: false,
    devis: {
      numero: 'TEST-' + new Date().getTime(), date: new Date(), validite: new Date(Date.now() + 30 * 864e5),
      commercial: com.nom,
      client: { type: 'PRO', societe: 'TEST SARL', siret: '000 000 000 00000', tva: 'FR00000000000',
                contact: 'Jean Test', tel: '0600000000', email: '', adresse: '2 rue du Test', cp: '56000', ville: 'Vannes' },
      lignes: [{ categorie: 'Bureaux', designation: 'Nettoyage de bureaux', detail: '3 passages/semaine', qte: 120, unite: 'm²/mois', pu: 1.2, tva: 20, type: 'MENSUEL' }],
      remise: 0, notes: 'Devis de test', signature: '', signataire: '',
      totaux: { htPonctuel: 0, htMensuel: 144, ht: 144, tva: 28.8, ttc: 172.8 }
    }
  }, com);
  Logger.log(res);
  SpreadsheetApp.getUi().alert('Test terminé : ' + JSON.stringify(res) +
    '\n\nPense à supprimer la ligne de test dans les onglets DEVIS et LIGNES.');
}

/* ================================================================
   SUIVI : « À FACTURER », TABLEAU DE BORD, RAPPEL QUOTIDIEN

   Le devis est imprimé et signé sur le papier chez le client : c'est le
   commercial qui dit, depuis son téléphone, ce que le rendez-vous a donné.
   À partir de cette seule réponse, le classeur fabrique tout le reste —
   la liste à refacturer dans Henrri, les chiffres, et les rappels.
   Aucun message n'est jamais envoyé au client : seulement aux commerciaux
   et au gérant.
   ================================================================ */

var ENTETES_FACTURER_ = [
  'DATE_SIGNATURE', 'NUMERO', 'COMMERCIAL', 'CLIENT', 'TYPE_CLIENT',
  'SIRET_CLIENT', 'TVA_CLIENT', 'CONTACT', 'EMAIL', 'TELEPHONE',
  'ADRESSE', 'CP', 'VILLE', 'TAUX_TVA', 'TOTAL_HT', 'TOTAL_TVA', 'TOTAL_TTC',
  'PRESTATIONS', 'NOTE_COMMERCIAL', 'LIEN_PDF', 'DEVIS_SIGNE', 'FACTURE'
];

/** Lit l'onglet DEVIS sous forme d'objets, colonnes désignées par leur nom. */
function lireDevis_() {
  var v = valeursOnglet_(SH.DEVIS);
  if (!v || v.length < 2) return [];
  var en = v[0].map(function (x) { return String(x).trim(); });
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (!String(v[i][en.indexOf('NUMERO')] || '').trim()) continue;
    var o = { _ligne: i + 1 };
    en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
    /* v108p — les contrats repris en « devis signés » pour les chiffres
       (ORIGINE = HISTORIQUE) ne sont pas de vrais devis : ni facturation,
       ni rappel de preuve, ni « À facturer ». Seuls les chiffres les lisent. */
    if (devisHistorique_(o)) continue;
    out.push(o);
  }
  return out;
}
function devisHistorique_(o) { return String(o && o.ORIGINE || '').toUpperCase().trim() === 'HISTORIQUE'; }
/* Le devis d'un numéro (ou de son numéro d'avant signature), contrats repris compris. */
function devisParNumero_(num) {
  num = String(num || '').trim();
  if (!num) return null;
  var t = null;
  objetsDe_(SH.DEVIS).forEach(function (x) {
    var n = String(x.NUMERO || '').trim(), o = String(x.NUMERO_ORIGINE || '').trim();
    if (n === num || (o && o === num)) t = x;
  });
  return t;
}

/** Les lignes de prestation, regroupées par numéro de devis. */
function lignesParDevis_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.LIGNES);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var cN = en.indexOf('NUMERO');
  for (var i = 1; i < v.length; i++) {
    var n = String(v[i][cN] || '').trim();
    if (!n) continue;
    var o = {};
    en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
    (out[n] = out[n] || []).push(o);
  }
  return out;
}

/** Une ligne de prestation en une phrase, prête à être resaisie dans Henrri. */
function prestationTexte_(l) {
  var q = Number(l.QTE) || 0, pu = Number(l.PU_HT) || 0;
  var t = (q !== 1 ? nb_(q) + ' ' + (l.UNITE || '') + ' × ' : '') +
          String(l.DESIGNATION || '').trim();
  if (l.DETAIL) t += ' (' + String(l.DETAIL).trim() + ')';
  t += ' — ' + nb_(pu) + ' € HT';
  if (Number(l.REMISE_PCT) > 0) t += ' − ' + nb_(l.REMISE_PCT) + ' %';
  t += ' = ' + nb_(l.TOTAL_HT) + ' € HT';
  if (String(l.TYPE || '') === 'MENSUEL') t += ' / mois';
  return t;
}
function nb_(x) {
  var n = Number(x) || 0;
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
}
function jour0_(d) {
  var x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function estVide_(x) { return x === '' || x === null || x === undefined; }

/**
 * Reconstruit « À FACTURER » : une ligne par devis signé, avec tout ce qu'il
 * faut pour la resaisir dans Henrri. Les cases FACTURE déjà cochées sont
 * conservées — c'est la seule colonne que le gérant remplit à la main.
 */
function majAFacturer_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.FACTURER) || creerOnglet_(ss, SH.FACTURER, ENTETES_FACTURER_);

  // L'onglet est entièrement reconstruit à chaque passage : sa ligne d'en-têtes
  // doit donc suivre le script, sinon une colonne ajoutée décalerait toutes les
  // valeurs écrites après elle. On la réécrit telle qu'elle doit être.
  var enTete = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); })
    : [];
  if (enTete.join('|') !== ENTETES_FACTURER_.join('|')) {
    if (sh.getLastColumn() > ENTETES_FACTURER_.length) {
      sh.getRange(1, ENTETES_FACTURER_.length + 1, 1, sh.getLastColumn() - ENTETES_FACTURER_.length)
        .clearContent().setBackground(null);
    }
    sh.getRange(1, 1, 1, ENTETES_FACTURER_.length).setValues([ENTETES_FACTURER_])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }

  // mémoriser les cases déjà cochées avant de réécrire
  var deja = {};
  if (sh.getLastRow() > 1) {
    var av = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    var enAv = av[0].map(function (x) { return String(x).trim(); });
    var cNum = enAv.indexOf('NUMERO'), cFac = enAv.indexOf('FACTURE');
    if (cNum >= 0 && cFac >= 0) {
      for (var i = 1; i < av.length; i++) {
        var k = String(av[i][cNum] || '').trim();
        if (k) deja[k] = av[i][cFac] === true || String(av[i][cFac]).toUpperCase() === 'OUI';
      }
    }
  }

  var lp = lignesParDevis_();
  var lignes = lireDevis_()
    .filter(function (d) { return String(d.STATUT || '').toUpperCase() === 'SIGNE'; })
    .sort(function (a, b) {
      return new Date(a.DATE_STATUT || a.DATE || 0) - new Date(b.DATE_STATUT || b.DATE || 0);
    })
    .map(function (d) {
      var num = String(d.NUMERO).trim();
      var pres = (lp[num] || []).map(prestationTexte_).join('\n');
      var v = {
        DATE_SIGNATURE: d.DATE_STATUT || d.DATE || '',
        NUMERO: num, COMMERCIAL: d.COMMERCIAL || '', CLIENT: d.CLIENT || '',
        TYPE_CLIENT: d.TYPE_CLIENT || '', SIRET_CLIENT: d.SIRET_CLIENT || '',
        TVA_CLIENT: d.TVA_CLIENT || '', CONTACT: d.CONTACT || '',
        EMAIL: d.EMAIL || '', TELEPHONE: d.TELEPHONE || '',
        ADRESSE: d.ADRESSE || '', CP: d.CP || '', VILLE: d.VILLE || '',
        TAUX_TVA: d.TAUX_TVA || '', TOTAL_HT: Number(d.TOTAL_HT) || 0,
        TOTAL_TVA: Number(d.TOTAL_TVA) || 0, TOTAL_TTC: Number(d.TOTAL_TTC) || 0,
        PRESTATIONS: pres, NOTE_COMMERCIAL: d.NOTE_COMMERCIAL || '',
        LIEN_PDF: d.LIEN_PDF || '',
        DEVIS_SIGNE: d.PREUVE_SIGNATURE || '',
        FACTURE: deja[num] === true
      };
      return ENTETES_FACTURER_.map(function (h) { return v[h]; });
    });

  if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns()).clearContent();
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), ENTETES_FACTURER_.length)
    .clearDataValidations();
  if (lignes.length) {
    sh.getRange(2, 1, lignes.length, ENTETES_FACTURER_.length).setValues(lignes);
    var cF = ENTETES_FACTURER_.indexOf('FACTURE') + 1;
    sh.getRange(2, cF, lignes.length, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    [ 'PRESTATIONS', 'NOTE_COMMERCIAL' ].forEach(function (col) {
      sh.getRange(2, ENTETES_FACTURER_.indexOf(col) + 1, lignes.length, 1)
        .setWrap(true).setVerticalAlignment('top');
    });
  }
  sh.setColumnWidth(ENTETES_FACTURER_.indexOf('PRESTATIONS') + 1, 340);
  sh.setColumnWidth(ENTETES_FACTURER_.indexOf('NOTE_COMMERCIAL') + 1, 240);
  sh.setFrozenRows(1);
  return lignes.length;
}

/**
 * Tableau de bord : ce qui a été devisé, ce qui a été signé, et où ça se perd.
 * Des valeurs, pas des formules : le classeur reste lisible et ne casse pas
 * quand une ligne est déplacée à la main.
 */
function majTableauDeBord_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.BORD) || ss.insertSheet(SH.BORD);
  sh.clear();

  var devis = lireDevis_();
  var parMois = {}, parCom = {}, motifs = {}, etats = {};
  var totHt = 0, totSigne = 0, recurrent = 0;

  devis.forEach(function (d) {
    var dt = d.DATE ? new Date(d.DATE) : null;
    var cle = dt ? dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) : '—';
    var st = String(d.STATUT || 'REMIS').toUpperCase();
    var ht = Number(d.TOTAL_HT) || 0;
    var mens = Number(d.TOTAL_HT_MENSUEL) || 0;
    var signe = (st === 'SIGNE');

    etats[st] = (etats[st] || 0) + 1;
    totHt += ht;
    if (signe) { totSigne += ht; recurrent += mens; }
    if (st === 'REFUSE') {
      var m = String(d.MOTIF_REFUS || 'non précisé').trim() || 'non précisé';
      motifs[m] = (motifs[m] || 0) + 1;
    }
    [[parMois, cle], [parCom, String(d.COMMERCIAL || '—')]].forEach(function (x) {
      var b = x[0][x[1]] = x[0][x[1]] || { n: 0, ht: 0, ns: 0, hts: 0, mens: 0 };
      b.n++; b.ht += ht;
      if (signe) { b.ns++; b.hts += ht; b.mens += mens; }
    });
  });

  var L = [];
  L.push(['TABLEAU DE BORD', '', '', '', '', '']);
  L.push(['Mis à jour le', Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm'), '', '', '', '']);
  L.push(['', '', '', '', '', '']);
  L.push(['Ensemble', '', '', '', '', '']);
  L.push(['Devis établis', devis.length, '', 'Total devisé HT', Math.round(totHt * 100) / 100, '']);
  L.push(['Devis signés', etats['SIGNE'] || 0, '', 'Total signé HT', Math.round(totSigne * 100) / 100, '']);
  L.push(['Taux de transformation',
          devis.length ? Math.round((etats['SIGNE'] || 0) / devis.length * 1000) / 10 + ' %' : '—',
          '', 'Récurrent mensuel HT signé', Math.round(recurrent * 100) / 100, '']);
  L.push(['', '', '', '', '', '']);

  L.push(['Où en sont les devis', '', '', '', '', '']);
  L.push(['État', 'Nombre', '', '', '', '']);
  STATUTS_.forEach(function (st) { if (etats[st]) L.push([st, etats[st], '', '', '', '']); });
  Object.keys(etats).forEach(function (st) {
    if (STATUTS_.indexOf(st) < 0) L.push([st, etats[st], '', '', '', '']);
  });
  L.push(['', '', '', '', '', '']);

  L.push(['Par commercial', '', '', '', '', '']);
  L.push(['Commercial', 'Devis', 'Signés', 'Transformation', 'Devisé HT', 'Signé HT']);
  Object.keys(parCom).sort().forEach(function (k) {
    var b = parCom[k];
    L.push([k, b.n, b.ns, b.n ? Math.round(b.ns / b.n * 1000) / 10 + ' %' : '—',
            Math.round(b.ht * 100) / 100, Math.round(b.hts * 100) / 100]);
  });
  L.push(['', '', '', '', '', '']);

  L.push(['Par mois', '', '', '', '', '']);
  L.push(['Mois', 'Devis', 'Signés', 'Transformation', 'Devisé HT', 'Signé HT']);
  Object.keys(parMois).sort().forEach(function (k) {
    var b = parMois[k], p = k.split('-');
    var nom = p.length === 2 ? (MOIS_[Number(p[1]) - 1] + ' ' + p[0]) : k;
    L.push([nom, b.n, b.ns, b.n ? Math.round(b.ns / b.n * 1000) / 10 + ' %' : '—',
            Math.round(b.ht * 100) / 100, Math.round(b.hts * 100) / 100]);
  });
  L.push(['', '', '', '', '', '']);

  L.push(['Pourquoi on perd', '', '', '', '', '']);
  L.push(['Motif de refus', 'Nombre', '', '', '', '']);
  Object.keys(motifs).sort(function (a, b) { return motifs[b] - motifs[a]; })
    .forEach(function (m) { L.push([m, motifs[m], '', '', '', '']); });
  if (!Object.keys(motifs).length) L.push(['Aucun refus enregistré', '', '', '', '', '']);

  sh.getRange(1, 1, L.length, 6).setValues(L);
  sh.getRange(1, 1, 1, 6).setFontSize(13).setFontWeight('bold');
  ['Ensemble', 'Où en sont les devis', 'Par commercial', 'Par mois', 'Pourquoi on perd']
    .forEach(function (titre) {
      for (var i = 0; i < L.length; i++) {
        if (L[i][0] === titre) {
          sh.getRange(i + 1, 1, 1, 6).setFontWeight('bold').setBackground('#eef1f5');
          break;
        }
      }
    });
  sh.setColumnWidth(1, 230);
  [2, 3, 4, 5, 6].forEach(function (c) { sh.setColumnWidth(c, 120); });
  return L.length;
}

/** Les deux onglets de suivi, à la demande depuis le menu. */
function rafraichirSuivi() {
  majStructure_();
  var n = majAFacturer_();
  majTableauDeBord_();
  SpreadsheetApp.getUi().alert('À jour.\n\n' + n + ' devis signé' + (n > 1 ? 's' : '') +
    ' à facturer dans l\'onglet « ' + SH.FACTURER + ' ».');
}

/**
 * Passe en EXPIRE les devis dont la validité est dépassée sans réponse.
 * Un devis refusé ou signé n'est jamais touché : son sort est connu.
 */
function expirer_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.DEVIS);
  if (!sh || sh.getLastRow() < 2) return 0;
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  var cS = en.indexOf('STATUT') + 1, cD = en.indexOf('DATE_STATUT') + 1;
  if (!cS) return 0;
  var auj = jour0_(new Date()), n = 0;
  lireDevis_().forEach(function (d) {
    var st = String(d.STATUT || '').toUpperCase();
    if (st !== 'REMIS' && st !== 'A RELANCER') return;
    if (!d.VALIDITE) return;
    if (jour0_(new Date(d.VALIDITE)) >= auj) return;
    sh.getRange(d._ligne, cS).setValue('EXPIRE');
    if (cD) sh.getRange(d._ligne, cD).setValue(new Date());
    tracerServeur_(d.COMMERCIAL || '', 'DEVIS EXPIRE',
                   'validité dépassée sans réponse', d.NUMERO, '');
    n++;
  });
  return n;
}

/** Ce que chaque commercial doit faire aujourd'hui, à partir de ses devis. */
function aFaireParCommercial_() {
  var reg = lireReglages_();
  var seuil = Number(reg.rappel_sans_resultat_jours) || 2;
  var auj = jour0_(new Date());
  var limite = new Date(auj.getTime() - seuil * 86400000);
  var out = {};
  function pour(nom) {
    var k = String(nom || '—').trim();
    return out[k] = out[k] || { relances: [], sansResultat: [], sansPreuve: [] };
  }
  lireDevis_().forEach(function (d) {
    var st = String(d.STATUT || '').toUpperCase();
    var b = pour(d.COMMERCIAL);
    var ligne = String(d.NUMERO) + ' · ' + (d.CLIENT || '') +
                ' · ' + nb_(d.TOTAL_TTC) + ' € TTC';
    if (st === 'A RELANCER' && d.RELANCE_LE && jour0_(new Date(d.RELANCE_LE)) <= auj) {
      b.relances.push(ligne + ' · prévu le ' +
        Utilities.formatDate(new Date(d.RELANCE_LE), 'Europe/Paris', 'dd/MM/yyyy') +
        (d.TELEPHONE ? ' · ' + d.TELEPHONE : ''));
    }
    if (st === 'REMIS' && d.DATE && new Date(d.DATE) < limite) {
      b.sansResultat.push(ligne + ' · remis le ' +
        Utilities.formatDate(new Date(d.DATE), 'Europe/Paris', 'dd/MM/yyyy'));
    }
    if (st === 'SIGNE' && estVide_(d.PREUVE_SIGNATURE)) {
      b.sansPreuve.push(ligne);
    }
  });
  return out;
}

/**
 * Rappel quotidien. Un message par commercial, uniquement s'il a quelque chose
 * à faire — un rappel qui arrive tous les jours pour rien finit à la corbeille.
 * Le client, lui, ne reçoit jamais rien : c'est le commercial qui l'appelle.
 */
function automateQuotidien() {
  var reg = lireReglages_();
  majStructure_();
  var expires = expirer_();
  var annules = 0, conflits = 0;
  try { annules = annulerRefuses_(); conflits = signalerConflits_(reg); }
  catch (eP) { tracerServeur_('SYSTEME', 'PLANNING ECHEC', String(eP && eP.message || eP), '', ''); }
  /* Le planning récurrent avance d'un jour chaque nuit : sans cela l'horizon
     se viderait et le salarié finirait par ne plus rien voir. */
  try { genererRecurrents_(); }
  catch (eR) { tracerServeur_('SYSTEME', 'RECURRENTS ECHEC', String(eR && eR.message || eR), '', ''); }
  var aFacturer = majAFacturer_();
  majTableauDeBord_();

  var taches = aFaireParCommercial_();
  var coms = lireCommerciaux_();
  var envoyes = 0;

  coms.forEach(function (c) {
    var t = taches[c.nom];
    if (!t || !c.email) return;
    var n = t.relances.length + t.sansResultat.length + t.sansPreuve.length;
    if (!n) return;
    var corps = 'Bonjour ' + c.nom + ',\n\n';
    if (t.relances.length) {
      corps += 'À RELANCER (' + t.relances.length + ') :\n' +
               t.relances.map(function (x) { return '  · ' + x; }).join('\n') + '\n\n';
    }
    if (t.sansResultat.length) {
      corps += 'DEVIS SANS RÉSULTAT — dis dans l\'application si le client a signé ou non (' +
               t.sansResultat.length + ') :\n' +
               t.sansResultat.map(function (x) { return '  · ' + x; }).join('\n') + '\n\n';
    }
    if (t.sansPreuve.length) {
      corps += 'DEVIS SIGNÉS SANS PHOTO DU PAPIER (' + t.sansPreuve.length + ') :\n' +
               t.sansPreuve.map(function (x) { return '  · ' + x; }).join('\n') + '\n\n';
    }
    corps += 'Tout se règle depuis « Mes devis » dans l\'application.\n\n' +
             (reg.societe_nom || '');
    try {
      envoyerMail_({ to: c.email, subject: 'Tes devis à suivre — ' + n + ' point' + (n > 1 ? 's' : ''), body: corps }, reg);
      envoyes++;
    } catch (e) { /* une adresse invalide ne doit pas arrêter les autres */ }
  });

  // récapitulatif au gérant, une fois par semaine
  var jourRecap = Number(reg.recap_jour) || 1;
  var jourJs = new Date().getDay() || 7;   // 1 lundi … 7 dimanche
  if (jourJs === jourRecap) envoyerRecap_(reg, aFacturer);

  tracerServeur_('', 'AUTOMATE QUOTIDIEN',
    expires + ' expiré(s) · ' + aFacturer + ' à facturer · ' + envoyes + ' rappel(s) envoyé(s)' +
    (annules ? ' · ' + annules + ' chantier(s) annulé(s)' : '') +
    (conflits ? ' · ' + conflits + ' intervention(s) à replacer' : ''),
    '', '');
  return { expires: expires, aFacturer: aFacturer, rappels: envoyes,
           annules: annules, conflits: conflits };
}

function envoyerRecap_(reg, aFacturer) {
  var dest = String(reg.recap_email || '').trim() || Session.getEffectiveUser().getEmail();
  if (!dest) return;
  var devis = lireDevis_();
  var sem = new Date(Date.now() - 7 * 86400000);
  var recents = devis.filter(function (d) { return d.DATE && new Date(d.DATE) >= sem; });
  var signes = recents.filter(function (d) { return String(d.STATUT).toUpperCase() === 'SIGNE'; });
  var ht = signes.reduce(function (a, d) { return a + (Number(d.TOTAL_HT) || 0); }, 0);
  var parCom = {};
  recents.forEach(function (d) {
    var k = String(d.COMMERCIAL || '—');
    var b = parCom[k] = parCom[k] || { n: 0, s: 0, ht: 0 };
    b.n++;
    if (String(d.STATUT).toUpperCase() === 'SIGNE') { b.s++; b.ht += Number(d.TOTAL_HT) || 0; }
  });
  var corps = 'Semaine écoulée\n\n' +
    recents.length + ' devis établis · ' + signes.length + ' signés · ' +
    nb_(ht) + ' € HT signés\n' +
    (recents.length ? 'Transformation : ' +
      Math.round(signes.length / recents.length * 1000) / 10 + ' %\n' : '') + '\n' +
    Object.keys(parCom).sort().map(function (k) {
      var b = parCom[k];
      return '  · ' + k + ' : ' + b.n + ' devis, ' + b.s + ' signés, ' + nb_(b.ht) + ' € HT';
    }).join('\n') +
    '\n\n' + aFacturer + ' devis signé(s) en tout dans l\'onglet « ' + SH.FACTURER +
    ' », à resaisir dans Henrri (coche FACTURE quand c\'est fait).\n\n' +
    'Détail par mois et motifs de refus : onglet « ' + SH.BORD + ' ».\n' +
    SpreadsheetApp.getActive().getUrl();
  try {
    envoyerMail_({ to: dest, subject: 'Devis — récapitulatif de la semaine', body: corps }, reg);
  } catch (e) { /* sans importance : les onglets restent la source */ }
}

/* Le déclencheur quotidien, posé et retiré depuis le menu : personne n'a
   à aller le chercher dans les réglages du projet Apps Script. */
var AUTOMATE_ = 'automateQuotidien';

function activerAutomate() {
  arreterAutomate_(true);
  ScriptApp.newTrigger(AUTOMATE_).timeBased().atHour(7).everyDays(1)
    .inTimezone('Europe/Paris').create();
  ecrireReglage_('recap_email',
    String(lireReglages_().recap_email || '').trim() || Session.getEffectiveUser().getEmail());
  SpreadsheetApp.getUi().alert(
    'Rappel quotidien activé, chaque matin vers 7 h.\n\n' +
    'Chaque commercial reçoit ses relances du jour et ses devis sans résultat — ' +
    'seulement s\'il a quelque chose à faire.\n' +
    'Aucun message n\'est envoyé aux clients.');
}
function arreterAutomate_(silencieux) {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === AUTOMATE_) { ScriptApp.deleteTrigger(t); n++; }
  });
  if (!silencieux) SpreadsheetApp.getUi().alert(n ? 'Rappel quotidien arrêté.' : 'Il n\'y en avait pas.');
  return n;
}
function arreterAutomate() { arreterAutomate_(false); }

/* ====================== PROSPECTION TÉLÉPHONIQUE ======================
   Le commercial appelle en chaîne depuis son téléphone : l'application lui
   montre une fiche, il tape le numéro, il note le résultat, elle passe à la
   suivante. Tout ce qui suit sert cette boucle.

   Trois endroits, trois rôles :
   - le FICHIER DE PROSPECTION (un Sheet à part, un onglet par commune) est la
     source des coordonnées. Personne ne l'écrit depuis l'application ;
   - l'onglet PROSPECTS de ce classeur est la liste à plat que le téléphone
     reçoit, et c'est lui qui porte le suivi ;
   - l'onglet APPELS garde chaque tentative, sans jamais être réécrit.

   Les prospects sont communs à toute l'équipe : un prospect appelé par l'un
   sort de la file de l'autre. */

/** La clé d'un prospect : stable d'un import à l'autre, sinon le suivi se
    détacherait de sa ligne dès que le fichier de prospection bouge. */
function cleProspect_(commune, societe, siren) {
  /* Le SIREN quand il existe : c'est le seul identifiant qui ne bouge pas quand
     l'enseigne change d'orthographe ou de commune de rattachement. À défaut,
     commune + société mis à plat. */
  var n = String(siren == null ? '' : siren).replace(/\D/g, '');
  if (n.length >= 9) return 's' + n.slice(0, 9);
  var s = String(commune || '') + ' ' + String(societe || '');
  s = normNom_(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 120);
}

/**
 * Les numéros d'une cellule TEL, qui peut en porter plusieurs séparés par « / ».
 * Rend pour chacun la forme composable (+33…) et la forme lisible, celle que le
 * commercial lit à voix haute. Un numéro trop court est écarté : mieux vaut pas
 * de bouton qu'un bouton qui appelle dans le vide.
 */
function telsProspect_(brut) {
  return String(brut == null ? '' : brut)
    .split(/[\/;,]|\sou\s/i)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s; })
    .map(function (s) {
      var d = s.replace(/[^\d+]/g, '');
      if (d.indexOf('00') === 0) d = '+' + d.slice(2);
      if (/^0\d{9}$/.test(d)) d = '+33' + d.slice(1);
      else if (/^\d{9}$/.test(d)) d = '+33' + d;
      var lisible = s;
      if (/^\+33\d{9}$/.test(d)) {
        lisible = ('0' + d.slice(3)).replace(/(\d\d)(?=\d)/g, '$1 ').trim();
      }
      return { t: d, l: lisible };
    })
    .filter(function (x) { return x.t.replace(/\D/g, '').length >= 9; });
}

/** L'index des colonnes d'un onglet, par nom d'en-tête. */
function colonnes_(sh) {
  var n = sh.getLastColumn();
  var out = {};
  if (!n) return out;
  sh.getRange(1, 1, 1, n).getValues()[0].forEach(function (h, i) {
    var k = String(h).trim();
    if (k) out[k] = i;
  });
  return out;
}

/* ---------------------- IMPORT DU FICHIER DE PROSPECTION ----------------------
   Le fichier de prospection (« BASE PROSPECTS BB ») porte un onglet BASE de
   quelques milliers d'établissements du Morbihan, avec déjà ses propres
   colonnes de suivi. L'import en tire la table de travail PROSPECTS.

   Deux formes de fichier sont acceptées, parce que Simon a les deux :
   — un onglet unique avec une colonne VILLE : chaque ligne porte sa commune ;
   — un onglet par commune : c'est le nom de l'onglet qui la donne.
   La présence d'une colonne VILLE ou COMMUNE décide, onglet par onglet.

   Seuls les établissements **appelables** entrent : un numéro exploitable, et
   pas de « NE PLUS CONTACTER ». Sur quatorze mille lignes, deux cents sur
   trois sont sans numéro — les envoyer au téléphone remplirait sa mémoire pour
   rien, et personne ne peut les appeler. */

var CURSEUR_PROSPECTS_ = 'prospection_curseur';   // conservé : d'anciens classeurs l'ont

/** Les champs que l'import sait reconnaître, quel que soit l'ordre des colonnes. */
function colonnesProspect_(entete) {
  var en = {};
  entete.forEach(function (h, k) {
    var n = normNom_(h).toUpperCase().replace(/\s+/g, ' ').trim();
    if (n.indexOf('NOM DE LA SOC') === 0 || n === 'SOCIETE' || n === 'ENTREPRISE') en.SOCIETE = k;
    else if (n.indexOf('NOM DIRIGEANT') === 0 || n.indexOf('DIRIGEANT') === 0) en.DIRIGEANT = k;
    else if (n === 'TEL' || n.indexOf('TELEPHONE') === 0) en.TEL = k;
    else if (n === 'MAIL' || n === 'EMAIL' || n === 'E-MAIL') en.MAIL = k;
    else if (n.indexOf('SITE') === 0) en.SITE = k;
    else if (n.indexOf('ADRESSE') === 0) en.ADRESSE = k;
    else if (n === 'EFFECTIF') en.EFFECTIF = k;
    else if (n === 'VILLE' || n === 'COMMUNE') en.COMMUNE = k;
    else if (n === 'ZONE') en.ZONE = k;
    else if (n === 'SECTEUR') en.SECTEUR = k;
    else if (n === 'ACTIVITE') en.ACTIVITE = k;
    else if (n === 'PRIORITE') en.PRIORITE = k;
    else if (n === 'SIREN') en.SIREN = k;
    else if (n.indexOf('NE PLUS CONTACTER') === 0) en.NE_PLUS = k;
    else if (n === 'STATUT') en.STATUT = k;
    else if (n === 'COMMERCIAL') en.COMMERCIAL = k;
    else if (n.indexOf('DERNIER CONTACT') === 0) en.DERNIER = k;
    else if (n.indexOf('NB APPELS') === 0 || n.indexOf('NB D APPELS') === 0) en.NB_APPELS = k;
    else if (n.indexOf('DATE DE RELANCE') === 0 || n === 'RELANCE') en.RELANCE = k;
    else if (n.indexOf('COMMENTAIRE') === 0) en.COMMENTAIRE = k;
    else if (n.indexOf('SOURCE HORAIRE') === 0) en.SOURCE_HORAIRES = k;
    else if (['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'].indexOf(n) >= 0) en[n] = k;
  });
  return en;
}

function importerProspects() {
  var ui = SpreadsheetApp.getUi();
  var r;
  try {
    r = importerProspects_();
  } catch (err) {
    return ui.alert('Import impossible.\n\n' + String(err && err.message || err) +
      '\n\nSi le message parle de droits d\'accès, partage le fichier de prospection ' +
      'avec le compte qui fait tourner ce script, puis relance.');
  }
  ui.alert(
    r.lignes + ' prospect(s) appelable(s) dans l\'onglet PROSPECTS.\n' +
    r.nouveaux + ' nouveau(x), ' + r.gardes + ' déjà connu(s).\n\n' +
    r.lus + ' ligne(s) lue(s) dans le fichier de prospection, dont ' +
    r.sansTel + ' sans numéro' +
    (r.nePlus ? ' et ' + r.nePlus + ' marquée(s) « ne plus contacter »' : '') + ' — écartées.\n\n' +
    (r.disparus ? r.disparus + ' prospect(s) ne sont plus dans le fichier : ils restent dans ' +
                  'PROSPECTS avec leur historique.\n\n' : '') +
    'Le suivi déjà enregistré a été conservé.');
}

function importerProspects_(options) {
  options = options || {};
  var reg = lireReglages_();
  var id = String(options.fichier || reg.prospection_fichier_id || '').trim();
  if (!id) throw new Error('Renseigne prospection_fichier_id dans l\'onglet REGLAGES.');
  var ligneEntete = Number(options.entete || reg.prospection_entete_ligne) || 3;
  var vise = String(options.onglet != null ? options.onglet : (reg.prospection_onglet || '')).trim();
  var telSeul = String(options.avecTel != null ? options.avecTel : (reg.prospection_avec_tel || 'OUI'))
                  .toUpperCase() !== 'NON';

  var src = SpreadsheetApp.openById(id);
  var onglets = src.getSheets().filter(function (o) {
    return !vise || normNom_(o.getName()) === normNom_(vise);
  });
  if (!onglets.length) {
    throw new Error('Aucun onglet « ' + vise + ' » dans le fichier de prospection.');
  }

  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.PROSPECTS) || creerOnglet_(ss, SH.PROSPECTS, ENTETES_PROSPECTS_);
  var col = colonnes_(sh);

  /* Le suivi déjà posé, indexé par clé. On reconstruit la table entière : c'est
     une table de travail, et la réécrire d'un bloc évite des centaines d'appels
     au classeur. Le verrou empêche qu'un résultat d'appel arrive au milieu. */
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { /* on continue : l'import est rejouable */ }

  var ancien = {}, ordreAncien = [];
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function (r) {
      var k = String(r[col.ID] || '').trim();
      if (!k) return;
      ancien[k] = r;
      ordreAncien.push(k);
    });
  }

  var large = ENTETES_PROSPECTS_.length;
  var lignes = [], vus = {}, lus = 0, sansTel = 0, nePlus = 0, nouveaux = 0, gardes = 0;

  onglets.forEach(function (o) {
    if (o.getLastRow() <= ligneEntete || o.getLastColumn() === 0) return;
    var grille = o.getRange(ligneEntete, 1, o.getLastRow() - ligneEntete + 1, o.getLastColumn()).getValues();
    var en = colonnesProspect_(grille[0]);
    if (en.SOCIETE == null) return;
    var communeOnglet = String(o.getName()).trim();

    for (var j = 1; j < grille.length; j++) {
      var r = grille[j];
      var lire = function (k) { return en[k] == null ? '' : String(r[en[k]] == null ? '' : r[en[k]]).trim(); };
      var societe = lire('SOCIETE');
      if (!societe) continue;
      lus++;

      if (en.NE_PLUS != null && lire('NE_PLUS')) { nePlus++; continue; }
      var tels = telsProspect_(lire('TEL'));
      if (!tels.length) { sansTel++; if (telSeul) continue; }

      var commune = en.COMMUNE != null ? (lire('COMMUNE') || communeOnglet) : communeOnglet;
      var siren = lire('SIREN');
      var cle = cleProspect_(commune, societe, siren);
      if (!cle) continue;

      /* Deux lignes pour le même établissement — même SIREN, ou deux fois le
         même nom dans la commune : une seule fiche, et la seconde ne fait que
         combler ce que la première laissait vide. Écraser ferait perdre un mail
         ou une adresse renseignés d'un seul côté. */
      var fusion = vus[cle] != null;
      var l = fusion ? lignes[vus[cle]]
                     : (ancien[cle] ? ancien[cle].slice(0, large) : new Array(large).fill(''));
      while (l.length < large) l.push('');

      var poser = function (nom, v) {
        if (col[nom] == null) return;
        if (fusion && String(l[col[nom]] == null ? '' : l[col[nom]]).trim()) return;
        l[col[nom]] = v;
      };
      var av = ancien[cle];
      poser('ID', cle);
      poser('SIREN', siren);
      poser('COMMUNE', commune);
      poser('ZONE', lire('ZONE'));
      poser('SOCIETE', societe);
      poser('SECTEUR', lire('SECTEUR'));
      poser('ACTIVITE', lire('ACTIVITE'));
      poser('DIRIGEANT', lire('DIRIGEANT'));
      poser('TEL', lire('TEL'));
      poser('MAIL', lire('MAIL'));
      poser('SITE', lire('SITE'));
      poser('ADRESSE', lire('ADRESSE'));
      poser('EFFECTIF', lire('EFFECTIF'));
      poser('PRIORITE', Number(lire('PRIORITE')) || '');
      poser('SOURCE_HORAIRES', lire('SOURCE_HORAIRES'));
      ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'].forEach(function (d) { poser(d, lire(d)); });
      poser('COMMENTAIRE', lire('COMMENTAIRE'));

      /* Un prospect qu'on découvre reprend le suivi déjà noté à la main dans le
         fichier de prospection. Un prospect déjà connu garde le sien : c'est
         PROSPECTS qui fait foi une fois le phoning commencé. */
      if (fusion) {
        // rien de plus : la ligne est déjà dans le tableau, on vient de la compléter
      } else if (!av) {
        nouveaux++;
        var st = codeResultat_(lire('STATUT'));
        if (st) {
          poser('STATUT', st);
          poser('COMMERCIAL', lire('COMMERCIAL'));
          poser('NB_APPELS', Number(lire('NB_APPELS')) || '');
          var dc = en.DERNIER != null ? r[en.DERNIER] : '';
          var rl = en.RELANCE != null ? r[en.RELANCE] : '';
          if (isoDe_(dc)) poser('DERNIER_APPEL', new Date(isoDe_(dc)));
          if (st === 'rappel' && isoDe_(rl)) poser('RAPPEL_LE', new Date(isoDe_(rl)));
        }
      } else {
        gardes++;
      }
      if (col.MAJ_LE != null) l[col.MAJ_LE] = new Date().toISOString();
      if (!fusion) { vus[cle] = lignes.length; lignes.push(l); }
    }
  });

  /* Un prospect retiré du fichier de prospection n'est pas effacé : il a peut-être
     un rendez-vous pris. Il reste en fin de table avec son historique. */
  var disparus = 0;
  ordreAncien.forEach(function (k) {
    if (vus[k] != null) return;
    disparus++;
    lignes.push(ancien[k].slice(0, large));
  });

  if (sh.getMaxRows() > 1) sh.getRange(2, 1, sh.getMaxRows() - 1, Math.max(sh.getLastColumn(), large)).clearContent();
  if (lignes.length) sh.getRange(2, 1, lignes.length, large).setValues(lignes);
  try { lock.releaseLock(); } catch (e2) {}

  tracerServeur_('SERVEUR', 'PROSPECTS IMPORTES',
    lignes.length + ' appelable(s) sur ' + lus + ' ligne(s) lue(s)', '', '');
  return { lus: lus, lignes: lignes.length, sansTel: sansTel, nePlus: nePlus,
           nouveaux: nouveaux, gardes: gardes, disparus: disparus };
}

/* --------------- REPORT DU SUIVI DANS LE FICHIER DE PROSPECTION ---------------
   À la demande, et non à chaque appel (choix de Simon, 8 octobre 2026) : écrire
   dans l'autre fichier à chaque résultat serait lent, et écraserait ce que Simon
   y saisit lui-même. Cinq colonnes sont réécrites, celles que la base porte déjà
   pour le suivi. **COMMENTAIRE / HISTORIQUE n'est jamais touché** : c'est la
   colonne que Simon remplit à la main. */

function reporterStatuts() {
  var ui = SpreadsheetApp.getUi();
  var r;
  try {
    r = reporterStatuts_();
  } catch (err) {
    return ui.alert('Report impossible.\n\n' + String(err && err.message || err));
  }
  ui.alert(r.ecrits + ' prospect(s) reporté(s) dans le fichier de prospection' +
    (r.colonnes.length ? '\n\nColonnes mises à jour : ' + r.colonnes.join(', ') + '.' : '') +
    (r.sansColonne ? '\n\n' + r.sansColonne + ' onglet(s) sans colonne STATUT : rien n\'y a été écrit.' : '') +
    (r.introuvables ? '\n' + r.introuvables + ' prospect(s) n\'ont pas été retrouvés dans le fichier.' : '') +
    '\n\nLa colonne « Commentaire / historique » n\'est pas touchée.');
}

function reporterStatuts_(options) {
  options = options || {};
  var reg = lireReglages_();
  var id = String(options.fichier || reg.prospection_fichier_id || '').trim();
  if (!id) throw new Error('Renseigne prospection_fichier_id dans l\'onglet REGLAGES.');
  var ligneEntete = Number(options.entete || reg.prospection_entete_ligne) || 3;
  var vise = String(options.onglet != null ? options.onglet : (reg.prospection_onglet || '')).trim();

  var suivi = {};
  lireProspects_().forEach(function (p) { if (p.statut) suivi[p.id] = p; });

  var src = SpreadsheetApp.openById(id);
  var ecrits = 0, sansColonne = 0, vus = {}, touchees = {};
  src.getSheets().forEach(function (o) {
    if (vise && normNom_(o.getName()) !== normNom_(vise)) return;
    if (o.getLastRow() <= ligneEntete || o.getLastColumn() === 0) return;
    var en = colonnesProspect_(o.getRange(ligneEntete, 1, 1, o.getLastColumn()).getValues()[0]);
    if (en.SOCIETE == null) return;
    if (en.STATUT == null) { sansColonne++; return; }

    var n = o.getLastRow() - ligneEntete;
    if (n <= 0) return;
    var bloc = o.getRange(ligneEntete + 1, 1, n, o.getLastColumn()).getValues();
    var communeOnglet = String(o.getName()).trim();
    var change = false;

    for (var j = 0; j < n; j++) {
      var r = bloc[j];
      var lire = function (k) { return en[k] == null ? '' : String(r[en[k]] == null ? '' : r[en[k]]).trim(); };
      var societe = lire('SOCIETE');
      if (!societe) continue;
      var commune = en.COMMUNE != null ? (lire('COMMUNE') || communeOnglet) : communeOnglet;
      var cle = cleProspect_(commune, societe, lire('SIREN'));
      var p = suivi[cle];
      if (!p) continue;
      vus[cle] = 1;

      var avant = JSON.stringify(r);
      r[en.STATUT] = libelleResultat_(p.statut);
      touchees.STATUT = 1;
      if (en.COMMERCIAL != null) { r[en.COMMERCIAL] = p.par || ''; touchees.COMMERCIAL = 1; }
      if (en.DERNIER != null) { r[en.DERNIER] = p.dernier ? new Date(p.dernier) : ''; touchees['DERNIER CONTACT'] = 1; }
      if (en.NB_APPELS != null) { r[en.NB_APPELS] = p.appels || ''; touchees['NB APPELS'] = 1; }
      if (en.RELANCE != null) { r[en.RELANCE] = p.rappel ? new Date(p.rappel) : ''; touchees['DATE DE RELANCE'] = 1; }
      if (JSON.stringify(r) !== avant) { change = true; ecrits++; }
    }
    if (change) o.getRange(ligneEntete + 1, 1, n, o.getLastColumn()).setValues(bloc);
  });

  var introuvables = 0;
  Object.keys(suivi).forEach(function (k) { if (!vus[k]) introuvables++; });
  tracerServeur_('SERVEUR', 'STATUTS REPORTES', ecrits + ' prospect(s)', '', '');
  return { ecrits: ecrits, sansColonne: sansColonne, introuvables: introuvables,
           colonnes: Object.keys(touchees) };
}

/** Le chemin inverse de libelleResultat_ : ce qu'un humain a écrit à la main
    dans le fichier de prospection, ramené au code que l'application connaît. */
function codeResultat_(texte) {
  var n = normNom_(texte).toUpperCase().trim();
  if (!n) return '';
  if (n.indexOf('RDV') === 0 || n.indexOf('RENDEZ') === 0) return 'rdv';
  if (n.indexOf('INTERESSE') === 0 && n.indexOf('PAS') !== 0) return 'interesse';
  if (n.indexOf('PAS INTERESSE') === 0 || n.indexOf('REFUS') === 0) return 'refus';
  if (n.indexOf('A RAPPELER') === 0 || n === 'RAPPEL') return 'rappel';
  if (n.indexOf('MESSAGERIE') === 0 || n.indexOf('REPONDEUR') === 0) return 'msg';
  if (n.indexOf('PAS DE REPONSE') === 0 || n === 'NRP') return 'nrp';
  if (n.indexOf('MAUVAIS') === 0 || n.indexOf('FAUX') === 0) return 'faux';
  return '';
}

/** Le mot que lit un humain dans le fichier de prospection, pas le code. */
function libelleResultat_(code) {
  return ({ nrp: 'Pas de réponse', msg: 'Messagerie', rappel: 'À rappeler',
            interesse: 'Intéressé', rdv: 'RDV pris', refus: 'Pas intéressé',
            faux: 'Mauvais numéro' })[String(code || '')] || '';
}

/* ---------------------- CE QUE REÇOIT LE TÉLÉPHONE ---------------------- */

function lireProspects_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.PROSPECTS);
  if (!sh || sh.getLastRow() < 2) return [];
  var col = colonnes_(sh);
  var lire = function (r, k) { return col[k] == null ? '' : String(r[col[k]] == null ? '' : r[col[k]]).trim(); };
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
    .filter(function (r) { return String(r[col.ID] || '').trim(); })
    .map(function (r) {
      var h = {};
      ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'].forEach(function (j) {
        var v = lire(r, j);
        if (v) h[j.toLowerCase()] = v;
      });
      return {
        id: lire(r, 'ID'),
        ville: lire(r, 'COMMUNE'),
        zone: lire(r, 'ZONE'),
        nom: lire(r, 'SOCIETE'),
        secteur: lire(r, 'SECTEUR'),
        activite: lire(r, 'ACTIVITE'),
        /* De 1 à 10 : poids du secteur, effectif, et voisins à la même adresse.
           C'est elle qui décide par quoi commencer une liste jamais appelée. */
        prio: Number(lire(r, 'PRIORITE')) || 0,
        site: lire(r, 'SITE'),
        dirigeant: lire(r, 'DIRIGEANT'),
        /* Les numéros arrivent déjà composables : le téléphone ne refait pas
           la conversion dans son coin, il n'y a qu'une règle, et elle est ici. */
        tels: telsProspect_(lire(r, 'TEL')),
        mail: lire(r, 'MAIL'),
        adresse: lire(r, 'ADRESSE'),
        effectif: lire(r, 'EFFECTIF'),
        info: lire(r, 'COMMENTAIRE'),
        src: lire(r, 'SOURCE_HORAIRES'),
        h: h,
        statut: lire(r, 'STATUT'),
        note: lire(r, 'NOTE'),
        rappel: isoDe_(r[col.RAPPEL_LE]),
        /* La colonne peut manquer sur un classeur d'avant le 14 octobre 2026 :
           « Mettre à jour la structure » l'ajoute, mais le téléphone ne doit
           pas tomber en panne en attendant. */
        rdv: col.RDV_LE != null ? isoDe_(r[col.RDV_LE]) : '',
        dernier: isoDe_(r[col.DERNIER_APPEL]),
        appels: Number(lire(r, 'NB_APPELS')) || 0,
        par: lire(r, 'COMMERCIAL'),
        maj: isoDe_(r[col.MAJ_LE])
      };
    });
}

/** La même date, arrondie à la seconde : ce qui survit à un aller-retour
    dans le classeur. */
function aLaSeconde_(v) {
  var s = isoDe_(v);
  return s ? s.slice(0, 19) : '';
}

/** Une date du classeur, qu'elle soit une vraie date ou du texte, en ISO. */
function isoDe_(v) {
  if (v instanceof Date) return v.toISOString();
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * La liste envoyée au téléphone. « depuis » ne renvoie que ce qui a bougé :
 * la première connexion charge tout, les suivantes quelques lignes.
 */
function listeProspects_(d) {
  var reg = lireReglages_();
  if (String(reg.prospection_active || 'OUI').toUpperCase() === 'NON') {
    return { ok: true, prospects: [], complet: true, actif: false };
  }
  var tous = lireProspects_();
  var depuis = String((d && d.depuis) || '').trim();
  if (!depuis) {
    return { ok: true, prospects: tous, complet: true, actif: true,
             relanceHeures: Number(reg.prospection_relance_heures) || 3,
             maj: new Date().toISOString() };
  }
  var t = new Date(depuis).getTime();
  var partiels = isNaN(t) ? tous : tous.filter(function (p) {
    return p.maj && new Date(p.maj).getTime() > t;
  });
  return { ok: true, prospects: partiels, complet: isNaN(t), actif: true,
           relanceHeures: Number(reg.prospection_relance_heures) || 3,
           maj: new Date().toISOString() };
}

/* ---------------------- SON JOURNAL D'APPELS ----------------------
 *
 * Ce que le commercial a fait, et lui seul. L'onglet APPELS garde une ligne
 * par tentative et ne la réécrit jamais : c'est donc lui qui fait foi, pas la
 * ligne du prospect, qui ne porte que le dernier résultat.
 *
 * On lit à rebours depuis la fin de la feuille et l'on s'arrête dès qu'on a de
 * quoi remplir l'écran : la feuille grossit d'une ligne par appel et sera un
 * jour très longue, alors qu'un commercial ne remonte jamais bien loin.
 *
 * Deux bornes, parce qu'une seule ne suffirait pas : le nombre de lignes
 * (l'écran n'en montre pas davantage) et l'ancienneté (un journal de l'an
 * dernier n'aide personne et pèserait pour rien dans la réponse).
 */
var HISTO_MAX_ = 300;
var HISTO_JOURS_ = 60;
var HISTO_LIGNES_ = 5000;   // jusqu'où l'on remonte dans la feuille, au pire
var HISTO_MARGE_ = 200;     // de quoi absorber le désordre décrit plus bas

function historiqueAppels_(d, com) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.APPELS);
  if (!sh || sh.getLastRow() < 2) return { ok: true, appels: [], complet: true, jours: HISTO_JOURS_ };

  var col = colonnes_(sh);
  if (col.HORODATAGE == null || col.COMMERCIAL == null) {
    return { ok: false, erreur: 'L\'onglet APPELS n\'a pas ses colonnes d\'origine.' };
  }

  var max = Math.max(1, Math.min(Number(d && d.max) || HISTO_MAX_, HISTO_MAX_));
  var limite = Date.now() - HISTO_JOURS_ * 86400000;
  var nCol = sh.getLastColumn();
  var trouves = [], ligne = sh.getLastRow(), lues = 0, ecartes = false;

  /* Par tranches, de la fin vers le début : une seule lecture de toute la
     feuille coûterait cher le jour où elle portera des dizaines de milliers de
     lignes, et l'on n'en veut que la fin.

     On ramasse un peu plus que demandé, puis on trie. La feuille s'écrit par
     ajout, donc sa fin porte bien les dernières lignes **reçues** — mais pas
     forcément les derniers appels **passés** : un téléphone resté hors réseau
     toute la matinée envoie l'après-midi des appels datés du matin, qui
     s'inscrivent après des appels plus récents d'un collègue. Sans tri, le
     journal afficherait ce désordre tel quel. */
  while (ligne >= 2 && trouves.length < max + HISTO_MARGE_ && lues < HISTO_LIGNES_) {
    var depart = Math.max(2, ligne - 499);
    var bloc = sh.getRange(depart, 1, ligne - depart + 1, nCol).getValues();
    for (var i = bloc.length - 1; i >= 0; i--) {
      lues++;
      var r = bloc[i];
      if (String(r[col.COMMERCIAL] || '').trim() !== com.nom) continue;
      var q = r[col.HORODATAGE];
      var t = (q instanceof Date) ? q.getTime() : Date.parse(q);
      if (!t || isNaN(t)) continue;
      /* Trop ancien : on l'écarte mais on continue de descendre. S'arrêter ici
         perdrait tout ce qui le suit, et la feuille n'est pas assez ordonnée
         pour qu'une seule vieille ligne prouve que les autres le sont. */
      if (t < limite) { ecartes = true; continue; }
      trouves.push({
        t: new Date(t).toISOString(),
        id: String(r[col.ID_PROSPECT] || ''),
        societe: String(r[col.SOCIETE] || ''),
        commune: String(r[col.COMMUNE] || ''),
        resultat: String(r[col.RESULTAT] || ''),
        note: String(r[col.NOTE] || ''),
        rappel: col.RAPPEL_LE != null && r[col.RAPPEL_LE] ? isoDe_(r[col.RAPPEL_LE]) : '',
        rdv: col.RDV_LE != null && r[col.RDV_LE] ? isoDe_(r[col.RDV_LE]) : ''
      });
    }
    ligne = depart - 1;
  }

  trouves.sort(function (a, b) { return a.t < b.t ? 1 : a.t > b.t ? -1 : 0; });
  var coupe = trouves.length > max;

  /* « complet » dit au téléphone s'il tient tout ce que le bureau garde, ou
     seulement le haut de la pile : c'est ce qui lui permet d'écrire « les plus
     récents » plutôt que de laisser croire à un journal entier. */
  return { ok: true, appels: coupe ? trouves.slice(0, max) : trouves,
           complet: !coupe && !ecartes && ligne < 2 && lues < HISTO_LIGNES_,
           jours: HISTO_JOURS_ };
}

/* ---------------------- UN RÉSULTAT D'APPEL ---------------------- */

/**
 * Reçoit un lot de résultats et les range. Chaque résultat ajoute une ligne à
 * APPELS — jamais réécrite — et met à jour la ligne du prospect.
 *
 * Le téléphone peut renvoyer deux fois le même lot (réseau coupé au mauvais
 * moment) : la clé « ref » du résultat, qui vient de l'appareil, est relue dans
 * APPELS pour ne pas compter la même tentative deux fois.
 */
function enregistrerAppels_(d, com) {
  var ss = SpreadsheetApp.getActive();
  var shP = ss.getSheetByName(SH.PROSPECTS);
  if (!shP) return { ok: false, erreur: 'Aucun onglet PROSPECTS : lance « 13. Importer les prospects ».' };
  var shA = ss.getSheetByName(SH.APPELS) || creerOnglet_(ss, SH.APPELS, ENTETES_APPELS_);

  var lot = (d && d.appels) || [];
  if (!lot.length) return { ok: true, recus: 0, refuses: [] };
  lot = lot.slice(0, 200);

  var col = colonnes_(shP);
  var n = Math.max(0, shP.getLastRow() - 1);
  var grille = n ? shP.getRange(2, 1, n, shP.getLastColumn()).getValues() : [];
  var parId = {};
  grille.forEach(function (r, i) {
    var k = String(r[col.ID] || '').trim();
    if (k) parId[k] = i;
  });

  /* Les références déjà reçues, pour ne pas compter deux fois un lot renvoyé. */
  var dejaVues = {};
  var colA = colonnes_(shA);
  if (shA.getLastRow() > 1 && colA.ID_PROSPECT != null && colA.HORODATAGE != null) {
    var depuis = Math.max(2, shA.getLastRow() - 400);
    shA.getRange(depuis, 1, shA.getLastRow() - depuis + 1, shA.getLastColumn())
      .getValues().forEach(function (r) {
        dejaVues[String(r[colA.ID_PROSPECT] || '') + '|' + aLaSeconde_(r[colA.HORODATAGE])] = 1;
      });
  }

  /* Les en-têtes réels de la feuille des appels, dans leur ordre réel. */
  var enA = shA.getLastColumn() > 0
    ? shA.getRange(1, 1, 1, shA.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); })
    : ENTETES_APPELS_.slice();
  var lignesA = [], refuses = [], touchees = {}, recus = 0;
  lot.forEach(function (a) {
    var id = String((a && a.id) || '').trim();
    var res = String((a && a.resultat) || '').trim();
    if (!id || RESULTATS_APPEL_.indexOf(res) < 0) { refuses.push(id || '?'); return; }
    var i = parId[id];
    if (i == null) { refuses.push(id); return; }

    /* Le classeur garde les dates en jours fractionnaires : une milliseconde
       ne survit pas à l'aller-retour. La seconde suffit à reconnaître un lot
       renvoyé deux fois, et deux appels n'arrivent jamais dans la même. */
    var quand = isoDe_(a.t) || new Date().toISOString();
    var ref = id + '|' + aLaSeconde_(quand);
    if (dejaVues[ref]) { recus++; return; }
    dejaVues[ref] = 1;

    var r = grille[i];
    var rappel = res === 'rappel' ? (isoDe_(a.rappel) || '') : '';
    /* La date du rendez-vous (14 octobre 2026). Elle a sa propre colonne, et
       non celle du rappel : un rappel est un appel a repasser, un rendez-vous
       est un engagement pris. Les melanger ferait reapparaitre le prospect
       dans la file le jour du rendez-vous.
       Elle est FACULTATIVE, decision de Simon : un commercial qui a decroche
       un rendez-vous sans date arretee doit pouvoir le dire quand meme. Vide
       est donc une reponse, pas un oubli. */
    var rdv = res === 'rdv' ? (isoDe_(a.rdv) || '') : '';
    if (col.STATUT != null) r[col.STATUT] = res;
    if (col.NOTE != null) r[col.NOTE] = String(a.note || '').slice(0, 1000);
    if (col.RAPPEL_LE != null) r[col.RAPPEL_LE] = rappel ? new Date(rappel) : '';
    if (col.RDV_LE != null) r[col.RDV_LE] = rdv ? new Date(rdv) : '';
    if (col.DERNIER_APPEL != null) r[col.DERNIER_APPEL] = new Date(quand);
    if (col.NB_APPELS != null) r[col.NB_APPELS] = (Number(r[col.NB_APPELS]) || 0) + 1;
    if (col.COMMERCIAL != null) r[col.COMMERCIAL] = com.nom;
    if (col.MAJ_LE != null) r[col.MAJ_LE] = new Date().toISOString();
    touchees[i] = 1;
    recus++;

    /* Écrite PAR NOM de colonne, jamais par position. « Mettre à jour la
       structure » ajoute une colonne nouvelle à la FIN de la feuille, où
       qu'elle soit dans ENTETES_APPELS_ : une ligne construite dans l'ordre du
       tableau mettrait alors l'appareil dans la colonne de la date et la date
       dans celle de l'appareil, sans que rien ne le signale. */
    var ligneA = [];
    for (var cA = 0; cA < enA.length; cA++) ligneA.push('');
    var poser = function (nom, v) { if (colA[nom] != null) ligneA[colA[nom]] = v; };
    poser('HORODATAGE', new Date(quand));
    poser('COMMERCIAL', com.nom);
    poser('ID_PROSPECT', id);
    poser('SOCIETE', String(r[col.SOCIETE] || ''));
    poser('COMMUNE', String(r[col.COMMUNE] || ''));
    poser('RESULTAT', res);
    poser('NOTE', String(a.note || '').slice(0, 1000));
    poser('RAPPEL_LE', rappel ? new Date(rappel) : '');
    poser('RDV_LE', rdv ? new Date(rdv) : '');
    poser('APPAREIL', String(d.appareil || ''));
    lignesA.push(ligneA);
  });

  /* Les lignes modifiées sont réécrites une par une : elles sont dispersées
     dans 957 lignes, et réécrire tout l'onglet ferait perdre ce qu'un autre
     commercial vient d'y poser. */
  Object.keys(touchees).forEach(function (i) {
    var k = Number(i);
    shP.getRange(k + 2, 1, 1, grille[k].length).setValues([grille[k]]);
  });
  if (lignesA.length) {
    shA.getRange(shA.getLastRow() + 1, 1, lignesA.length, lignesA[0].length).setValues(lignesA);
  }
  if (recus) {
    tracerServeur_(com.nom, 'APPELS ENREGISTRES', recus + ' résultat(s)', '', d.appareil || '');
  }
  return { ok: true, recus: recus, refuses: refuses, maj: new Date().toISOString() };
}

/* ====================== LA BASE DE PROSPECTS SE TIENT À JOUR ======================
   Demande de Simon, 8 octobre 2026 : « je veux que la base s'update 3 fois par
   semaine, nouveaux numéros de téléphone, nouvelles boîtes ».

   Ce qui est automatisé ici : **les nouvelles entreprises**. Elles viennent de
   l'annuaire officiel (recherche-entreprises.api.gouv.fr), qui est public,
   gratuit, sans clé, et qui donne le nom, l'adresse, le code NAF, l'effectif et
   le SIREN.

   Ce qui ne l'est pas : **les numéros de téléphone**. L'annuaire officiel n'en
   contient aucun, et aucune colonne d'horaires non plus — c'est vérifié, pas
   supposé. Les 1 156 numéros de la base viennent de relevés PagesJaunes faits à
   la main ; Simon a choisi (8 octobre) de continuer ainsi, à la demande, plutôt
   que de payer une source officielle ou d'industrialiser un relevé que les
   conditions d'utilisation de PagesJaunes interdisent et que leurs serveurs
   bloquent. Une entreprise ajoutée ici arrive donc **sans numéro** : elle entre
   dans la base, pas encore dans la file d'appels.

   L'annuaire n'a **ni filtre ni tri par date de création** (vérifié sur son
   schéma OpenAPI) : impossible de demander « seulement les nouvelles ». Il faut
   balayer chaque code NAF et comparer les SIREN à ceux qu'on a déjà. D'où les
   appels groupés et le curseur ci-dessous. */

var MAJ_PROSPECTS_ = 'majBaseProspects';
var CURSEUR_MAJ_ = 'prospection_maj_curseur';
var BUDGET_MAJ_MS_ = 4 * 60 * 1000;
/* L'API Sirene de l'INSEE, et non plus recherche-entreprises.api.gouv.fr : ce
   dernier renvoie 502 à tout ce qui vient des serveurs de Google (vérifié le
   9 octobre 2026 — la même URL répondait 200 depuis un navigateur, et Apps Script
   joignait sans peine d'autres sites). Sirene demande une clé, gratuite, que Simon
   colle lui-même dans le réglage prospection_insee_cle ; en échange elle interroge
   directement les ÉTABLISSEMENTS, ce qui supprime la question du siège social.
   Débit autorisé : 30 requêtes par minute. */
var API_SIRENE_ = 'https://api.insee.fr/api-sirene/3.11/siret';
var PAUSE_SIRENE_MS_ = 2100;   // 30 req/min, avec un peu de marge

/* OpenStreetMap porte le téléphone ET les horaires, gratuitement. Le serveur
   principal d'Overpass est injoignable depuis Apps Script (« Address unavailable »,
   9 octobre) ; les miroirs sont essayés dans l'ordre. */
var MIROIRS_OSM_ = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

/* L'INSEE code les effectifs ; la base de Simon les écrit en clair. Une tranche
   inconnue ou non renseignée vaut « NC », comme dans sa feuille LISTES. */
var TRANCHES_INSEE_ = {
  'NN': 'NC', '00': '0 salarié', '01': '1-2', '02': '3-5', '03': '6-9',
  '11': '10-19', '12': '20-49', '21': '50-99', '22': '100-199', '31': '200-249',
  '32': '250-499', '41': '500-999', '42': '1000-1999', '51': '2000-4999',
  '52': '5000-9999', '53': '10000 et plus'
};
/* Le plus petit effectif de la tranche, pour le seuil des six salariés du BTP. */
var TRANCHE_MINI_ = {
  'NN': 0, '00': 0, '01': 1, '02': 3, '03': 6, '11': 10, '12': 20, '21': 50,
  '22': 100, '31': 200, '32': 250, '41': 500, '42': 1000, '51': 2000,
  '52': 5000, '53': 10000
};

/** Les secteurs, leurs poids et leurs codes NAF, lus dans l'onglet LISTES du
    fichier de prospection : Simon peut en ajouter sans toucher à ce script. */
function secteursProspection_(src) {
  var sh = src.getSheetByName('LISTES');
  if (!sh || sh.getLastRow() < 2) return { secteurs: [], bareme: {} };
  var g = sh.getRange(1, 1, sh.getLastRow(), Math.max(7, sh.getLastColumn())).getValues();
  var secteurs = [], bareme = {};
  for (var i = 1; i < g.length; i++) {
    var nom = String(g[i][0] || '').trim();
    var poids = Number(g[i][1]) || 0;
    var nafs = String(g[i][2] || '').match(/\d{2}\.\d{2}[A-Z]?/g) || [];
    if (nom && nafs.length) secteurs.push({ nom: nom, poids: poids, nafs: nafs });
    // la colonne F porte le libellé d'effectif, la G ses points
    var lib = String(g[i][5] || '').trim();
    if (lib) bareme[lib.toUpperCase()] = Number(g[i][6]) || 0;
  }
  return { secteurs: secteurs, bareme: bareme };
}

/** L'adresse telle que la base de Simon l'écrit : une seule ligne, en capitales. */
/** L'établissement de l'entreprise situé dans le département visé : le siège quand il
    y est, sinon le premier établissement ouvert qu'on y trouve. Rien, s'il n'y en a
    aucun — l'entreprise n'a alors rien à faire dans la base de Simon. */
/** Le nom sous lequel le commercial va reconnaître l'entreprise au téléphone :
    l'enseigne si elle existe, sinon la dénomination, sinon le nom de la personne. */
function nomEtablissement_(e) {
  var p = (e.periodesEtablissement || [])[0] || {};
  var u = e.uniteLegale || {};
  var nom = p.enseigne1Etablissement || p.denominationUsuelleEtablissement ||
            u.denominationUniteLegale || u.denominationUsuelle1UniteLegale ||
            [u.prenom1UniteLegale, u.nomUniteLegale].filter(function (x) { return x; }).join(' ');
  return String(nom || '').trim().toUpperCase();
}

/** La période en cours de l'établissement : Sirene les empile, la première est
    la plus récente. */
function periodeCourante_(e) {
  return (e.periodesEtablissement || [])[0] || {};
}

function adresseSiege_(a) {
  if (!a) return '';
  var p = [a.complementAdresseEtablissement, a.numeroVoieEtablissement,
           a.indiceRepetitionEtablissement, a.typeVoieEtablissement,
           a.libelleVoieEtablissement, a.codePostalEtablissement,
           a.libelleCommuneEtablissement];
  return p.filter(function (x) { return x; }).join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Une page de l'annuaire. Rendue séparément pour que le banc puisse la servir. */
function urlAnnuaire_(naf, dep, curseur) {
  /* Le code commune commence par le numéro du département : c'est plus sûr que le
     code postal, qui déborde parfois sur le département voisin. */
  /* Les variables qui changent dans le temps — l'activité, l'état, l'enseigne —
     s'interrogent **dans periode(...)**, sans quoi Sirene répond « Erreur de syntaxe
     dans le paramètre q » même sur la requête la plus simple. Six écritures ont été
     essayées le 9 octobre avant de trouver celle-ci. Le code commune, lui, ne change
     pas et reste dehors ; son joker est accepté et borne au département. */
  var q = 'periode(activitePrincipaleEtablissement:' + naf +
          ' AND etatAdministratifEtablissement:A)' +
          ' AND codeCommuneEtablissement:' + dep + '*';
  return API_SIRENE_ + '?q=' + encodeURIComponent(q) +
         '&nombre=1000&curseur=' + encodeURIComponent(curseur || '*');
}

/* Appelée par le menu ET par le déclencheur de lundi, mercredi et vendredi. Un
   déclencheur horaire tourne **sans interface** : SpreadsheetApp.getUi() y lève une
   exception, et la mise à jour ne serait jamais faite. Le compte rendu part donc au
   JOURNAL dans ce cas, et dans une fenêtre quand quelqu'un est là pour la lire. */
/* Diagnostic jetable : d'où vient le refus de l'annuaire ? Écrit les codes au JOURNAL.
   À retirer une fois la cause connue. */
/* Diagnostic : d'où vient un refus ? Écrit les codes au JOURNAL, sans jamais
   montrer la clé. Utile le jour où Sirene changera d'adresse ou de règles. */
/* Diagnostic : quelle écriture du paramètre q Sirene accepte-t-il ? Écrit les codes
   au JOURNAL, sans jamais montrer la clé. */
/* Diagnostic : quelle écriture du paramètre q Sirene accepte-t-il ? */
/* Un coup de sonde sur Sirene, écrit au JOURNAL, sans jamais montrer la clé.
   À lancer le jour où la mise à jour ne ramène plus rien : il dit en une ligne si
   la clé est là, si le service répond, et combien d'établissements il annonce. */
/* Un coup de sonde sur les services interrogés, écrit au JOURNAL, sans jamais montrer
   la clé. À lancer le jour où une mise à jour ne ramène plus rien. */
function testerAnnuaire() {
  var reg = lireReglages_();
  var cle = String(reg.prospection_insee_cle || '').trim();
  var dep = String(reg.prospection_maj_departement || '56').trim();
  var dit = ['cle ' + (cle ? 'presente (' + cle.length + ')' : 'ABSENTE')];

  try {
    var r = UrlFetchApp.fetch(urlAnnuaire_('69.20Z', dep, '*'), {
      muteHttpExceptions: true,
      headers: { 'Accept': 'application/json', 'X-INSEE-Api-Key-Integration': cle }
    });
    var h = {};
    try { h = JSON.parse(r.getContentText()).header || {}; } catch (e0) {}
    dit.push('Sirene = ' + r.getResponseCode() +
             (h.total != null ? ', ' + h.total + ' etablissements' : ''));
  } catch (err) {
    dit.push('Sirene = EXCEPTION ' + String(err && err.message || err).slice(0, 60));
  }

  /* OpenStreetMap : la seule source gratuite qui porte téléphone ET horaires.
     Reste à savoir si elle accepte les serveurs de Google — l'annuaire des
     entreprises, lui, les refuse (502 sur tout, le 9 octobre). */
  var q = '[out:json][timeout:60];area["ref:INSEE"="' + dep + '"][admin_level=6]->.a;' +
          'nwr["phone"]["opening_hours"]["name"](area.a);out count;';
  MIROIRS_OSM_.forEach(function (m) {
    try {
      var o = UrlFetchApp.fetch(m, { method: 'post', contentType: 'application/x-www-form-urlencoded', payload: 'data=' + encodeURIComponent(q),
        muteHttpExceptions: true, headers: { 'Accept': 'application/json' } });
      var n = '';
      try { n = ', ' + (((JSON.parse(o.getContentText()).elements || [])[0] || {}).tags || {}).total + ' objets'; }
      catch (e1) { n = ' [' + String(o.getContentText()).slice(0, 50).replace(/\s+/g, ' ') + ']'; }
      dit.push(m.replace(/^https:\/\//, '').split('/')[0] + ' = ' + o.getResponseCode() + n);
    } catch (err2) {
      dit.push(m.replace(/^https:\/\//, '').split('/')[0] + ' = KO ' +
               String(err2 && err2.message || err2).slice(0, 40));
    }
  });

  tracerServeur_('SERVEUR', 'TEST ANNUAIRE', dit.join(' | '), '', '');
  return dit.join('\n');
}

/* OSM écrit « Mo-Fr 09:00-12:00,14:00-18:00; Sa 09:00-12:00; Su off ». La file
   d'appels veut une colonne par jour. On ne garde que ce qui est sûr : une
   règle qui dépend d'une date (saison, jour férié, vacances scolaires) est
   écartée plutôt que devinée — Simon ne veut que des horaires vérifiés. */
var JOURS_OSM_ = { MO: 'LUN', TU: 'MAR', WE: 'MER', TH: 'JEU', FR: 'VEN', SA: 'SAM', SU: 'DIM' };
var ORDRE_OSM_ = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
var JOUR_SEUL_ = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
var SELECTEUR_ = '(?:' + JOUR_SEUL_ + '(?:\\s*-\\s*' + JOUR_SEUL_ + ')?)';
var PLAGE_ = '\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}';

/** Les jours que désigne « Mo-We,Fr », dans l'ordre d'OSM. */
function joursOsm_(selecteur) {
  var out = [];
  String(selecteur).split(',').forEach(function (bout) {
    var b = bout.trim();
    if (!b) return;
    var pair = b.split('-');
    if (pair.length === 2) {
      var a = ORDRE_OSM_.indexOf(pair[0].trim().toUpperCase());
      var z = ORDRE_OSM_.indexOf(pair[1].trim().toUpperCase());
      if (a < 0 || z < 0) return;
      for (var k = a; ; k = (k + 1) % 7) { out.push(ORDRE_OSM_[k]); if (k === z) break; }
    } else {
      var u = ORDRE_OSM_.indexOf(b.toUpperCase());
      if (u >= 0) out.push(ORDRE_OSM_[u]);
    }
  });
  return out;
}

/** « 9:00-12:00, 14:00-18:00 » → « 09:00-12:00 / 14:00-18:00 ». */
function plagesOsm_(texte) {
  var out = [], re = new RegExp('(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})', 'g'), m;
  var deux = function (x) { return x.length === 1 ? '0' + x : x; };
  while ((m = re.exec(String(texte)))) {
    out.push(deux(m[1]) + ':' + m[2] + '-' + deux(m[3]) + ':' + m[4]);
  }
  return out.join(' / ');
}

/** Remet les plages d'un jour dans l'ordre des heures et ôte les doublons. */
function rangerPlages_(v) {
  if (v === 'Fermé') return v;
  var vus = {}, l = [];
  String(v).split('/').forEach(function (p) {
    var t = p.trim();
    if (t && !vus[t]) { vus[t] = 1; l.push(t); }
  });
  l.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  return l.join(' / ');
}

function horairesOsm_(texte) {
  var s = String(texte == null ? '' : texte).trim();
  if (!s) return null;
  var out = {}, pose = false;
  if (/^24\s*\/\s*7$/.test(s)) {
    ORDRE_OSM_.forEach(function (j) { out[JOURS_OSM_[j]] = '00:00-24:00'; });
    return out;
  }
  s.split(';').forEach(function (regle) {
    var r = regle.trim();
    if (!r) return;
    /* Une date, une année, une plage de mois, les congés : on passe. */
    if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|easter|week|sunrise|sunset)\b/i.test(r)) return;
    if (/\d{4}/.test(r) || r.indexOf('[') >= 0) return;
    /* « PH » et « SH » collés au sélecteur : on les retire ; seuls, on passe. */
    r = r.replace(/\b(PH|SH)\s*,\s*/gi, '').replace(/\s*,\s*(PH|SH)\b/gi, '');
    if (/^\s*(PH|SH)\b/i.test(r)) return;

    var groupe = new RegExp('(' + SELECTEUR_ + '(?:\\s*,\\s*(?=' + JOUR_SEUL_ + '\\b)' + SELECTEUR_ + ')*)' +
                            '\\s+((?:' + PLAGE_ + ')(?:\\s*,\\s*' + PLAGE_ + ')*|off|closed)', 'gi');
    /* Dans OSM, le point-virgule remplace la règle précédente, la virgule s'y
       ajoute. Les groupes d'une même règle se cumulent donc sur un jour. */
    var m, trouve = false, cumul = {};
    while ((m = groupe.exec(r))) {
      trouve = true;
      var jours = joursOsm_(m[1]);
      var v = /^(off|closed)$/i.test(m[2].trim()) ? 'Fermé' : plagesOsm_(m[2]);
      jours.forEach(function (j) {
        cumul[JOURS_OSM_[j]] = cumul[JOURS_OSM_[j]] ? cumul[JOURS_OSM_[j]] + ' / ' + v : v;
      });
      pose = true;
    }
    if (trouve) {
      Object.keys(cumul).forEach(function (j) { out[j] = rangerPlages_(cumul[j]); });
      return;
    }
    /* Pas de jour nommé : la règle vaut pour la semaine entière. */
    var seul = plagesOsm_(r);
    if (seul && !new RegExp(JOUR_SEUL_, 'i').test(r.replace(/\d/g, ''))) {
      ORDRE_OSM_.forEach(function (j) { out[JOURS_OSM_[j]] = seul; });
      pose = true;
    }
  });
  return pose ? out : null;
}

/** Un seul passage : les horaires relevés dans OpenStreetMap le 9 octobre 2026,
    découpés jour par jour et posés dans les colonnes LUN à DIM de BASE. */
function poserHorairesOsm() {
  /* Garde-fou : si l analyseur a ete abime en route, on ne pose rien. */
  var essai = horairesOsm_('Mo-We 09:00-12:00,14:00-18:00; Th off');
  if (!essai || essai.LUN !== '09:00-12:00 / 14:00-18:00' || essai.MER !== essai.LUN ||
      essai.JEU !== 'Fermé' || essai.VEN) {
    throw new Error('Analyseur d horaires abime : ' + JSON.stringify(essai));
  }
  var T = '477637342|Mo-We 09:00-16:30; Fr 09:00-16:00~777734039|Mo-Fr 08:45-12:00, 13:00-17:30~878427566|Mo-Fr 09:00-12:00,14:00-18:00~843879818|Mo-Fr 09:00-12:00,13:30-18:00; Sa 09:00-12:00~777903816|Tu 09:00-12:30,14:00-18:00; We 09:00-12:30,13:45-18:00; Th 09:00-12:30,15:00-18:00; Fr 09:00-12:30,13:45-18:00; Sa 08:30-12:45~775709702|Mo 13:00-17:00; Tu-Fr 10:00-12:45, 14:00-17:00~876580325|Mo-Sa 09:00-12:00,14:00-18:30~855801072|Tu-Fr 08:30-12:30,13:45-18:00; Sa 08:30-12:30~378786396|Tu 09:00-12:30,14:00-18:00; We,Fr 09:00-12:30,13:45-18:00; Th 09:00-12:30,15:00-18:00; Sa 08:30-12:45~850951633|Mo-Fr 09:00-18:00~440985224|Mo, Tu, Th, Fr 09:00-12:00, 14:00-17:00~390375756|Mo-Sa 09:00-12:00,14:00-19:00~349974931|Mo-Fr 08:45-12:10,13:50-17:00; Tu 08:45-12:10,14:50-17:00~378830848|Tu-Fr 09:00-12:30,14:00-18:00; Sa 08:30-12:45~398972901|Mo-Fr 09:45-12:45,14:00-17:45~498834845|Mo-Fr 09:00-19:00; Sa 09:00-17:00; Su off~394280697|Mo-Fr 08:00-18:00~444656789|Mo-Fr 09:00-18:00~492420641|Mo-Sa 09:30-19:30~382385276|Apr-Sep~531515716|Mo-Fr 09:00-12:00,14:00-18:00~841335227|Mo-Fr 09:00-12:00,14:00-18:00~441258357|Mo-Sa 09:00-19:00~981305212|Th-Mo 19:00-23:45~788033371|Mo-Fr 09:00-12:00,14:00-18:00~490411477|Tu-Sa~523499846|Mo-Fr 09:00-12:00,13:30-18:00; Sa 09:00-12:00~818337073|Tu-Sa 09:00-12:30, Tu-Fr 14:00-18:00~449674548|Tu-Fr 09:00-12:00,14:00-18:30; Sa 09:00-12:00~393755848|Mo-Fr 09:00-18:30; Sa 09:00-17:00~378829295|Tu 09:00-12:30,14:00-18:00; We 09:00-12:30,13:45-18:00; Th 09:00-12:30,15:00-18:00; Fr 09:00-12:30,13:45-18:00; Sa 08:30-12:45~378831440|Tu-Fr 09:00-12:30; Sa 08:30-12:45~984674705|Mo-Fr 09:00-12:00,14:00-17:30~810335620|Mo-Fr 08:00-12:00,14:00-18:30~444394191|Mo-Fr 09:00-12:00, 14:00-18:00~381144252|Tu-Sa 09:00-12:15,14:00-19:00~944887371|Mo-Fr 09:00-19:00; Sa 09:00-18:00~838474898|Mo-Fr 09:30-12:30,14:00-19:00; Sa 09:30-12:30,14:00-18:00~503999385|Mo 14:00-19:00; Tu-Sa 09:30-19:00~303435010|Mo-Sa 09:30-12:30, 14:00-18:00~990406035|Mo-Fr 09:00-12:00,14:00-18:00~903590305|Mo 09:00-12:00,14:00-18:00; We-Fr 09:00-12:00,14:00-18:00~511803462|Mo,Fr 09:00-12:30,14:00-18:30; Sa 09:00-12:30~403998479|Mo-Fr 09:00-12:00,14:00-19:00; Sa 09:00-12:30,14:00-18:00~440109692|Tu,We,Fr,Sa 09:00-12:30, Mo-Sa 14:00-19:00, Th 10:00-12:30~503921389|Mo-Sa 09:30-19:30~841386279|Mo-Fr 06:00-23:00; Sa-Su 08:00-20:00~722013851|2026 Apr 03-2026 Oct 24~953838612|Mo 09:00-12:30,14:00-18:30; Tu 09:00-13:00; We 09:00-12:30,14:00-19:00; Th 09:00-12:30,13:30-18:00; Fr 09:00-12:30,14:00-19:00; Sa-Su off~820027688|24/7~442286548|Mo 09:00-13:00,14:00-19:00; Tu 09:00-13:30,14:00-19:00; Th 09:00-19:00; Fr 09:00-13:30,14:00-19:00; Sa 09:00-13:30,14:00-16:30~514944883|Tu 09:00-12:00,14:00-19:00; We 08:30-12:30; Th 09:00-19:00; Fr 08:30-19:00~490202157|Tu,Th,Fr 09:00-18:30; We 09:00-12:00; Sa 08:30-17:00~505019679|Mo-Fr 09:00-19:00, Sa 09:00-18:00~534033881|Tu,Th,Fr 08:30-12:00,13:30-19:00; We 08:30-12:00,14:00-19:00; Sa 08:30-15:30~753617042|Mo 09:00-12:00,14:00-16:00; Tu-Fr 09:00-12:00,14:00-19:00; Sa 08:30-12:30,13:30-16:00~500396080|Tu-Fr 09:00-19:00; Sa 09:00-15:00~518302195|Mo 09:00-18:30; Tu-Fr 09:00-19:00; Sa 09:00-17:00~881614333|Mo 14:00-19:00; Tu,We 09:00-19:00; Th 13:00-20:00; Fr 09:00-19:00; Sa 09:00-17:00~524708112|Mo,Tu,Th,Fr 09:00-18:00; Sa 09:00-14:00~445131717|Tu-Fr 08:00-12:00,13:30-19:00; Sa 08:00-12:00,13:30-16:00~948053640|Mo 09:00-19:00; Tu-Fr 09:00-19:00; Sa 09:00-16:00~533652582|Mo-Fr 09:00-19:00; Sa 09:00-17:00~391676244|Tu-Fr 09:00-12:00,14:00-19:00; Sa 09:00-12:00~889085346|Mo-Fr 09:00-19:00~799809017|Mo 10:00-19:00; Tu-Sa 09:00-19:00~992160283|Tu-Sa 09:00-18:00~841399546|Tu 09:00-13:00, 14:00-18:30; We-Fr 09:00-13:00, 14:00-19:00; Sa 09:00-13:00, 14:00-17:00~824160238|Mo-Sa 09:00-19:00~943195982|Mo-Fr 09:00-12:00,14:00-19:00; Sa 09:00-12:00,14:00-18:00~350344198|Mo-Fr 08:30-12:00,14:00-18:00~452985914|Mo-Fr 07:30-19:30; Sa 07:30-17:30~532804226|Mo-We 08:30-12:00,14:00-18:00; Th 08:00-12:00,14:00-18:00; Fr 08:00-12:00,14:00-17:00~810504563|Mo-Sa 08:00-18:00~994490126|Tu-Sa 12:00-14:00,19:15-21:00~501774343|Tu 12:00-14:00,18:30-21:00; We 12:00-14:00; Th 12:00-14:00,18:30-21:00; Fr,Sa 12:00-14:00,18:30-21:30; Su 18:30-21:30; Mo off~934118613|We-Th 12:00-13:30,19:00-21:00~452417876|Mo 10:00-20:00; Tu-Su 10:00-01:00~399000926|Mo-Sa 06:30-21:00; Su 08:30-21:00~982346108|Fr 12:00-14:30, 19:00-21:30; Mo-Th 12:00-14:30, 19:00-21:00~927894287|Th-Sa 18:00-25:00, Su 11:00-19:00~948814769|We-Su 12:00-14:00, We-Sa 19:00-22:00~412320038|Mo-Fr 08:30-14:30, 16:30-18:30~838557221|Tu-Sa 12:00-14:00,19:00-22:00; Su 12:00-14:00~881966097|We-Su 14:30-17:30~834911422|Mo,Tu 12:00-14:00; Th-Sa 12:00-14:00,19:00-21:00; Su 12:00-14:00,19:00-20:45~850383241|Tu-Sa 12:00-13:45, 19:00-21:30~490842507|Mo-Su,PH 12:00-14:00,19:00-22:00~944250612|Mo-Fr 08:00-16:00~910201714|Mo-Fr 09:30-15:00~103268678|Tu-Sa 12:00+, 19:00+~377553060|SH We-Su 12:00-14:00, 19:00-21:00; Fr-Su 12:00-14:00, 19:00-21:00~829473487|Tu-Sa 12:00-14:00, 19:00-22:00~979355567|Tu-We,Su 10:00-17:00; Th-Sa 10:00-23:30~411849342|Mo-Fr 09:00-17:00~999532286|Mo-Su 10:00-22:00~881036578|Mo-We 11:30-16:00; Th 11:30-20:45; Fr-Sa 11:30-22:00~878810795|Tu 19:00-22:00; We-Sa 12:00-14:00,19:00-22:00; Su 12:00-14:00~487860645|We-Fr 12:00-13:30,19:00-22:00;Sa 12:00-13:30,19:00-24:00;Su 19:00-22:00; PH off~947514527|We-Th 12:00-13:30,18:30-21:00; Fr-Sa 12:00-13:30,18:30-22:00; Su 18:30-22:00~835308412|Mo 12:00-13:30; We,Th 12:00-13:30,19:30-20:30; Fr 12:00-13:30,19:30-20:45; Sa 12:15-13:30,19:30-21:00; Su 11:45-13:30~981639354|Tu-Su 11:00-14:30,18:00-22:00~848696969|Mo-Su 09:00-21:00~898498571|We-Su~839198967|Tu-Su 12:00-15:00, 19:00-22:00~403378243|Tu-Sa 12:00-14:00,19:00-22:00~500459029|Mo-Su 10:30-11:30~503611808|Mo-We 12:00-14:00; Th-Su 12:00-14:00,19:00-21:30~987831963|Mo-Fr 12:00-22:00~810585406|Th-Sa 11:30-18:30; Mo 11:30-18:00; Su 11:00-18:00~883341141|Mo-Sa 19:00-22:30~532619392|Mo-Su 09:00-20:00~940624190|Tu-Sa 12:00-15:00, 18:00-22:00~523423184|Tu-Fr 12:00-15:00; Tu-Th 19:00-00:00; Fr, Sa 19:00-01:00~995148673|We-Th 09:00-23:00; Fr-Sa 09:00-23:30; Su 09:00-18:00~490865177|Mo,Tu,Th-Sa 12:00-22:00~821190790|Tu-Sa 11:00-18:00~384893079|Apr 11 - Sep 25~881384192|Mo-Sa 17:00-21:00; Su 18:00-21:00~788607604|May-Sep~753997956|Mo-Th 12:00-13:30,19:00-20:30; Fr,Su 12:00-13:30; Sa 19:00-20:30~453458804|Apr-Sep~450115746|Apr-Sep~388138000|Mo-Fr 08:30-17:30~431896851|Mo-Th 08:30-12:30,14:00-18:00; Fr 08:30-12:30,14:00-17:00~552120222|Tu-Fr 08:45-12:30; Sa 09:00-12:45~813755345|Mo-Sa 10:00-19:00~444927149|Mo 14:00-19:00; Tu-Fr 09:00-12:00,14:00-19:00; Sa 09:00-12:00,14:00-18:00~318906443|Mo-Th 11:30-15:00,18:00-22:00; Fr 11:30-15:00,18:00-22:30; Sa 11:30-22:30; Su 11:30-22:00~450152921|Mo-Su 11:00-23:00~215600032|Jun-Sep~215600057|Apr-Oct~215602632|Jul 01 - Aug 29';
  var reg = lireReglages_();
  var src = SpreadsheetApp.openById(String(reg.prospection_fichier_id || '').trim());
  var vise = String(reg.prospection_onglet || 'BASE').trim();
  var sh = src.getSheetByName(vise);
  if (!sh) throw new Error('Onglet ' + vise + ' introuvable.');
  var li = Number(reg.prospection_entete_ligne) || 3;
  var en = colonnesBase_(sh, li);
  if (en.SIREN == null) throw new Error('Colonne SIREN introuvable.');

  var voulues = ['SOURCE HORAIRES', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
  var entete = sh.getRange(li, 1, 1, sh.getLastColumn()).getValues()[0];
  var ou = {};
  entete.forEach(function (h, k) { ou[normNom_(h).toUpperCase().trim()] = k; });
  var large = sh.getLastColumn();
  voulues.forEach(function (nom) {
    if (ou[nom] == null) { sh.getRange(li, large + 1).setValue(nom); ou[nom] = large; large++; }
  });

  var par = {};
  T.split('~').forEach(function (bout) {
    var k = bout.indexOf('|');
    if (k > 0) par[bout.slice(0, k)] = bout.slice(k + 1);
  });

  var n = sh.getLastRow() - li;
  var grille = sh.getRange(li + 1, 1, n, large).getValues();
  var poses = 0, muets = 0;
  for (var i = 0; i < n; i++) {
    var s = String(grille[i][en.SIREN] || '').replace(/[^0-9]/g, '');
    if (!s || !par[s]) continue;
    var h = horairesOsm_(par[s]);
    if (!h) { muets++; continue; }
    var ecrit = false;
    ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'].forEach(function (j) {
      if (!h[j]) return;
      if (String(grille[i][ou[j]] || '').trim()) return;
      grille[i][ou[j]] = h[j];
      ecrit = true;
    });
    if (ecrit && !String(grille[i][ou['SOURCE HORAIRES']] || '').trim()) {
      grille[i][ou['SOURCE HORAIRES']] = 'OpenStreetMap';
    }
    if (ecrit) poses++;
  }
  sh.getRange(li + 1, 1, n, large).setValues(grille);
  tracerServeur_('SERVEUR', 'OSM HORAIRES',
                 poses + ' fiche(s) avec des horaires, ' + muets + ' ecartee(s) (saison ou heures absentes)', '', '');
  return poses;
}

function majBaseProspects() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (eUi) { ui = null; }
  var r;
  try {
    r = majBaseProspects_();
  } catch (err) {
    var mal = 'Mise à jour impossible : ' + String(err && err.message || err);
    tracerServeur_('SERVEUR', 'BASE PROSPECTS MAJ', mal, '', '');
    if (ui) return ui.alert(mal);
    throw err;
  }
  var dit =
    r.ajoutes + ' nouvelle(s) entreprise(s) ajoutée(s) à la base.\n\n' +
    r.codes + ' code(s) NAF parcouru(s) sur ' + r.codesTotal + ', ' +
    r.lus + ' établissement(s) lus.\n' +
    (r.reste ? 'Il reste ' + r.reste + ' code(s) : la prochaine exécution reprendra là.\n' : 'Tour complet.\n') +
    (r.sansZone ? '\n' + r.sansZone + ' sont dans une commune que la base ne connaissait pas : leur colonne ZONE est vide.\n' : '') +
    (r.incidents ? '\n⚠ L\'annuaire a refusé des demandes : ' + r.incidents +
                   '\nLe compte ci-dessus est donc incomplet. Relance dans quelques minutes.\n' : '') +
    '\nElles arrivent sans numéro : l\'annuaire officiel n\'en fournit pas.';
  if (ui) ui.alert(dit);
}

function majBaseProspects_(options) {
  options = options || {};
  var reg = lireReglages_();
  if (!options.force && String(reg.prospection_maj_active || 'OUI').toUpperCase() === 'NON') {
    return { ajoutes: 0, lus: 0, codes: 0, codesTotal: 0, reste: 0, sansZone: 0, inactif: true };
  }
  var id = String(options.fichier || reg.prospection_fichier_id || '').trim();
  if (!id) throw new Error('Renseigne prospection_fichier_id dans l\'onglet REGLAGES.');
  var dep = String(options.departement || reg.prospection_maj_departement || '56').trim();
  var ligneEntete = Number(options.entete || reg.prospection_entete_ligne) || 3;
  var vise = String(options.onglet != null ? options.onglet : (reg.prospection_onglet || 'BASE')).trim();
  var seuilBtp = Number(options.seuilBtp || reg.prospection_effectif_min_btp) || 6;
  var cle = String(options.cle || reg.prospection_insee_cle || '').trim();
  if (!cle) {
    throw new Error('Il manque la clé de l\'API Sirene. Crée-la sur portail-api.insee.fr ' +
                    '(compte gratuit, application en mode simple, souscription à l\'API Sirene ' +
                    'en accès public) puis colle-la dans REGLAGES, ligne prospection_insee_cle.');
  }

  var src = SpreadsheetApp.openById(id);
  var sh = src.getSheetByName(vise);
  if (!sh) throw new Error('Aucun onglet « ' + vise + ' » dans le fichier de prospection.');

  var liste = secteursProspection_(src);
  if (!liste.secteurs.length) throw new Error('Aucun code NAF lisible dans l\'onglet LISTES.');

  /* Un couple (code NAF, secteur) par passage : un même code ne sert qu'un
     secteur, et l'ordre de LISTES fixe l'ordre du tour. */
  var travaux = [];
  liste.secteurs.forEach(function (s) {
    s.nafs.forEach(function (n) { travaux.push({ naf: n, secteur: s }); });
  });

  var en = colonnesBase_(sh, ligneEntete);
  if (en.SOCIETE == null || en.SIREN == null) {
    throw new Error('L\'onglet « ' + vise + ' » n\'a pas de colonne SIREN : impossible de reconnaître les nouvelles.');
  }

  var nLignes = Math.max(0, sh.getLastRow() - ligneEntete);
  var large = sh.getLastColumn();
  var grille = nLignes ? sh.getRange(ligneEntete + 1, 1, nLignes, large).getValues() : [];
  var connus = {}, zoneDe = {}, voisins = {};
  grille.forEach(function (r) {
    var si = String(r[en.SIREN] == null ? '' : r[en.SIREN]).replace(/\D/g, '');
    if (si) connus[si] = 1;
    if (en.COMMUNE != null && en.ZONE != null) {
      var v = normNom_(r[en.COMMUNE]), z = String(r[en.ZONE] || '').trim();
      if (v && z && !zoneDe[v]) zoneDe[v] = z;
    }
    if (en.ADRESSE != null) {
      var a = normNom_(r[en.ADRESSE]);
      if (a) voisins[a] = (voisins[a] || 0) + 1;
    }
  });

  var props = PropertiesService.getScriptProperties();
  var depart = options.depuis != null ? Number(options.depuis)
                                      : Number(props.getProperty(CURSEUR_MAJ_)) || 0;
  if (depart >= travaux.length) depart = 0;

  incidentsMaj_ = {};
  var debut = Date.now(), lus = 0, codes = 0, ajouts = [], sansZone = 0, i;
  for (i = depart; i < travaux.length; i++) {
    if (Date.now() - debut > BUDGET_MAJ_MS_) break;
    var t = travaux[i];
    codes++;
    var pages = lireAnnuaire_(t.naf, dep, debut, cle);
    pages.forEach(function (e) {
      lus++;
      var si = String(e.siren || '').replace(/\D/g, '');
      /* Sirene rend des ÉTABLISSEMENTS : celui-ci est forcément dans le département,
         plus de siège social parisien à démêler. Une entreprise qui a plusieurs
         établissements ici ne fait qu'une fiche — la clé de PROSPECTS est le SIREN. */
      if (!si || connus[si]) return;
      /* L'INSEE interdit de publier un établissement non diffusible. */
      if (String(e.statutDiffusionEtablissement || 'O').toUpperCase() === 'P') return;
      var periode = periodeCourante_(e);
      if (String(periode.etatAdministratifEtablissement || 'A').toUpperCase() === 'F') return;
      var tr = String(e.trancheEffectifsEtablissement || 'NN');
      /* La règle de Simon : le BTP n'entre qu'à partir de six salariés, sauf la
         peinture (43.34Z), qui est son métier et qu'il veut en entier. */
      if (/BTP/i.test(t.secteur.nom) && t.naf !== '43.34Z' &&
          (TRANCHE_MINI_[tr] || 0) < seuilBtp) return;

      connus[si] = 1;
      var adr = e.adresseEtablissement || {};
      var commune = String(adr.libelleCommuneEtablissement || '').trim().toUpperCase();
      var zone = zoneDe[normNom_(commune)] || '';
      if (!zone) sansZone++;
      var adresse = adresseSiege_(adr);
      var nb = (voisins[normNom_(adresse)] || 0) + 1;
      voisins[normNom_(adresse)] = nb;
      var effectif = TRANCHES_INSEE_[tr] || 'NC';

      var l = new Array(large).fill('');
      var poser = function (nom, v) { if (en[nom] != null) l[en[nom]] = v; };
      poser('SOCIETE', nomEtablissement_(e));
      poser('SECTEUR', t.secteur.nom);
      poser('ACTIVITE', String(periode.activitePrincipaleEtablissement || t.naf));
      poser('COMMUNE', commune);
      poser('ZONE', zone);
      poser('ADRESSE', adresse);
      poser('EFFECTIF', effectif);
      /* Poids du secteur + points d'effectif. **Le bonus de voisinage n'est pas
         appliqué** : la règle exacte de Simon (0 à 2 selon le nombre
         d'établissements à la même adresse) n'a pas pu être relue, et une
         priorité inventée fausserait l'ordre de sa file. À trancher avec lui. */
      poser('PRIORITE', t.secteur.poids + (liste.bareme[effectif.toUpperCase()] || 0));
      poser('TYPE', 'Société');
      poser('SIREN', si);
      poser('SOURCE', 'Sirene INSEE (maj auto)');
      poser('MEME_ADRESSE', nb);
      ajouts.push(l);
    });
  }

  if (ajouts.length) {
    sh.getRange(sh.getLastRow() + 1, 1, ajouts.length, large).setValues(ajouts);
  }
  var fini = i >= travaux.length;
  props.setProperty(CURSEUR_MAJ_, fini ? '0' : String(i));

  var refus = resumeIncidents_();
  tracerServeur_('SERVEUR', 'BASE PROSPECTS MAJ',
    ajouts.length + ' nouvelle(s) sur ' + lus + ' lue(s), ' + codes + ' code(s) NAF' +
    (refus ? ' — REFUS : ' + refus : ''), '', '');
  return { ajoutes: ajouts.length, lus: lus, codes: codes, codesTotal: travaux.length,
           reste: fini ? 0 : travaux.length - i, sansZone: sansZone,
           incidents: resumeIncidents_() };
}

/** Les refus de l'annuaire, en une phrase lisible, ou rien s'il n'y en a pas eu. */
function resumeIncidents_() {
  var p = [];
  for (var k in incidentsMaj_) {
    if (Object.prototype.hasOwnProperty.call(incidentsMaj_, k)) {
      p.push(k + ' × ' + incidentsMaj_[k]);
    }
  }
  return p.join(', ');
}

/** Les colonnes de la base de prospection, par nom d'en-tête. */
function colonnesBase_(sh, ligneEntete) {
  var en = {};
  if (sh.getLastColumn() === 0) return en;
  sh.getRange(ligneEntete, 1, 1, sh.getLastColumn()).getValues()[0].forEach(function (h, k) {
    var n = normNom_(h).toUpperCase().replace(/\s+/g, ' ').trim();
    if (n.indexOf('NOM DE LA SOC') === 0 || n === 'SOCIETE') en.SOCIETE = k;
    else if (n === 'SECTEUR') en.SECTEUR = k;
    else if (n === 'ACTIVITE') en.ACTIVITE = k;
    else if (n === 'VILLE' || n === 'COMMUNE') en.COMMUNE = k;
    else if (n === 'ZONE') en.ZONE = k;
    else if (n.indexOf('ADRESSE') === 0) en.ADRESSE = k;
    else if (n === 'EFFECTIF') en.EFFECTIF = k;
    else if (n === 'PRIORITE') en.PRIORITE = k;
    else if (n === 'SIREN') en.SIREN = k;
    else if (n === 'TYPE') en.TYPE = k;
    else if (n === 'SOURCE') en.SOURCE = k;
    else if (n.indexOf('NB A LA MEME ADRESSE') === 0) en.MEME_ADRESSE = k;
  });
  return en;
}

/**
 * Toutes les entreprises d'un code NAF dans le département. La première page
 * donne le total, les suivantes partent **groupées** : l'annuaire répond en
 * trois secondes, et les demander une par une mettrait un quart d'heure là où
 * `fetchAll` met une minute.
 */
function lireAnnuaire_(naf, dep, debut, cle) {
  var out = [], curseur = '*', tours = 0;
  /* Sirene pagine par curseur et non par numéro de page : chaque réponse dit
     par où continuer, et le curseur cesse de bouger quand on a tout lu. */
  while (tours < 40) {
    if (Date.now() - debut > BUDGET_MAJ_MS_) break;
    var r = recupererJson_(urlAnnuaire_(naf, dep, curseur), cle);
    if (!r) break;
    var lot = r.etablissements || [];
    out = out.concat(lot);
    var h = r.header || {};
    var suivant = String(h.curseurSuivant || '');
    if (!lot.length || !suivant || suivant === curseur) break;
    curseur = suivant;
    tours++;
    Utilities.sleep(PAUSE_SIRENE_MS_);
  }
  return out;
}

/* Ce que l'annuaire a refusé pendant la mise à jour en cours. Sans ce compte,
   un service qui répond « trop de requêtes » donnerait exactement le même
   « 0 nouvelle entreprise » qu'un département déjà complet — c'est arrivé au
   premier essai réel du 9 octobre, et il a fallu le deviner. */
var incidentsMaj_ = {};

function noterIncident_(cle) {
  incidentsMaj_[cle] = (incidentsMaj_[cle] || 0) + 1;
}

/* L'annuaire public limite le débit par adresse IP, et les adresses de Google
   sont partagées entre tous les scripts du monde : un 429 est normal, il faut
   simplement respirer et redemander. */
function recupererJson_(url, cle) {
  var essais = 3, r, code, i;
  for (i = 1; i <= essais; i++) {
    try {
      /* Un agent identifié : l'annuaire renvoyait 502 à l'agent par défaut d'Apps
         Script (la même URL répondait 200 depuis un navigateur, le 9 octobre). */
      var tetes = { 'Accept': 'application/json',
                    'User-Agent': 'BreizhBrillance-prospection/1.0' };
      if (cle) tetes['X-INSEE-Api-Key-Integration'] = cle;
      r = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: tetes
      });
      code = r.getResponseCode();
      if (code === 200) {
        try { return JSON.parse(r.getContentText()); }
        catch (eJson) { noterIncident_('reponse illisible'); return null; }
      }
      /* 404 = aucun résultat chez Sirene, pas une panne : silence. */
      if (code === 404) return null;
      if (code !== 429 && code < 500) { noterIncident_('HTTP ' + code); return null; }
      noterIncident_('HTTP ' + code);
    } catch (e) {
      var quoi = String((e && e.message) || e);
      /* Une autorisation manquante doit **remonter**. Apps Script ne propose son écran
         de consentement que si l'exception sort de la fonction : attrapée ici, elle
         donnait un « 0 établissement lu » silencieux, et la portée n'était jamais
         redemandée. C'est ce qui a coûté deux tours à blanc le 9 octobre. */
      if (/permission|autoris/i.test(quoi)) throw e;
      noterIncident_(quoi.slice(0, 80));
      return null;
    }
    if (i < essais) Utilities.sleep(1200 * i);
  }
  return null;
}

/* ---------------------- le déclencheur ----------------------
   Lundi, mercredi et vendredi à 6 h : la base est fraîche quand les commerciaux
   attaquent la journée. Chaque exécution avance d'autant de codes NAF qu'elle
   peut en quatre minutes et retient où elle s'est arrêtée. */
function activerMajProspects() {
  arreterMajProspects_(true);
  [ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.WEDNESDAY, ScriptApp.WeekDay.FRIDAY]
    .forEach(function (j) {
      ScriptApp.newTrigger(MAJ_PROSPECTS_).timeBased().onWeekDay(j).atHour(6)
        .inTimezone('Europe/Paris').create();
    });
  SpreadsheetApp.getUi().alert(
    'Mise à jour de la base activée : lundi, mercredi et vendredi vers 6 h.\n\n' +
    'Elle ajoute les entreprises nouvellement créées dans les secteurs de ton onglet LISTES.\n' +
    'Elles arrivent sans numéro de téléphone : l\'annuaire officiel n\'en fournit pas.\n\n' +
    'Pour l\'arrêter : « 17. Arrêter la mise à jour automatique ».');
}
function arreterMajProspects_(silencieux) {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === MAJ_PROSPECTS_) { ScriptApp.deleteTrigger(t); n++; }
  });
  if (!silencieux) SpreadsheetApp.getUi().alert(n ? 'Mise à jour arrêtée.' : 'Elle n\'était pas activée.');
  return n;
}
function arreterMajProspects() { arreterMajProspects_(false); }

/* ====================== LA FACTURE PRÉPARÉE DANS HENRRI ======================

   Le devis est signé, le chantier est fait : il reste à facturer. Jusqu'ici le
   gérant recopiait à la main, dans Henrri, ce que l'onglet « A FACTURER » lui
   affichait. Il le recopie encore, mais plus à la main : l'application dépose
   la facture dans son Henrri, client et lignes comprises, en BROUILLON.

   Pourquoi s'arrêter au brouillon, et pourquoi Henrri plutôt que nous ?
   Parce qu'une facture n'est pas un PDF. C'est un numéro pris dans une série
   continue, sans trou et sans retour en arrière ; c'est une pièce qu'on ne
   corrige jamais, qu'on annule par un avoir ; et, depuis la réforme de la
   facturation électronique, c'est un format normalisé transmis par une
   plateforme agréée. Henrri porte tout cela. Nous, nous portons ce qu'Henrri
   ne sait pas : quel devis a été signé, par qui, et si le travail est fait.
   Chacun son métier. L'application prépare, Simon relit, Henrri émet.

   La route passe par le serveur MCP de Henrri (mcp.henrri.io) : c'est la seule
   interface qu'ils documentent, et c'est du JSON-RPC sur HTTP — UrlFetchApp
   sait le parler. La réponse revient en flux d'événements (« event: message /
   data: {...} ») : on la découpe. Les clés dorment dans les propriétés du
   script, jamais dans ce fichier — le dépôt est public — et jamais dans une
   cellule du classeur : c'est Simon qui les pose, par le menu.
   ============================================================================ */

var HENRRI_MCP_ = 'https://mcp.henrri.io/mcp';
var HENRRI_P_ID_ = 'HENRRI_CLIENT_ID';
var HENRRI_P_SECRET_ = 'HENRRI_CLIENT_SECRET';
var HENRRI_P_ENV_ = 'HENRRI_ENV';
/* Le jeton rendu par Henrri vit dix minutes. On le garde huit, pour ne pas
   l'utiliser à la seconde où il meurt. La session MCP, elle, est un simple
   numéro de conversation : neuf minutes suffisent. */
var HENRRI_C_SESSION_ = 'henrri_sessionKey';
var HENRRI_C_SID_ = 'henrri_mcp_sid';

/** Les clés, ou rien. On ne les renvoie jamais à l'appli ni au journal. */
function henrriCles_() {
  var p = PropertiesService.getScriptProperties();
  var id = String(p.getProperty(HENRRI_P_ID_) || '').trim();
  var sec = String(p.getProperty(HENRRI_P_SECRET_) || '').trim();
  if (!id || !sec) return null;
  return { id: id, secret: sec,
           env: String(p.getProperty(HENRRI_P_ENV_) || 'sandbox').trim() };
}

function henrriConfigure_() { return !!henrriCles_(); }

/**
 * Pose les clés d'API Henrri. Simon les colle lui-même dans la boîte de
 * dialogue : elles ne passent ni par ce fichier, ni par le classeur, ni par
 * une conversation. Elles vont dans les propriétés du script, que seul le
 * propriétaire du projet peut lire.
 */
function connecterHenrri() {
  var ui = SpreadsheetApp.getUi();
  var env = ui.alert(
    'Quel environnement Henrri ?',
    'OUI = bac à sable (sandbox), pour essayer sans rien émettre.\n' +
    'NON = production, ton vrai Henrri.\n\n' +
    'Commence par le bac à sable.',
    ui.ButtonSet.YES_NO_CANCEL);
  if (env === ui.Button.CANCEL || env === ui.Button.CLOSE) return;
  var environnement = (env === ui.Button.YES) ? 'sandbox' : 'production';

  var r1 = ui.prompt('Clé API Henrri (1/2)',
    'Colle ton clientId.\n\n' +
    'Il se génère dans Henrri : avatar en haut à droite → « API & Intégrations ».',
    ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var id = String(r1.getResponseText() || '').trim();

  var r2 = ui.prompt('Clé API Henrri (2/2)',
    'Colle ton clientSecret.', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var sec = String(r2.getResponseText() || '').trim();

  if (!id || !sec) { ui.alert('Il manque une des deux clés. Rien n\'a été enregistré.'); return; }

  PropertiesService.getScriptProperties().setProperties({
    HENRRI_CLIENT_ID: id, HENRRI_CLIENT_SECRET: sec, HENRRI_ENV: environnement
  });
  CacheService.getScriptCache().removeAll([HENRRI_C_SESSION_, HENRRI_C_SID_]);

  var t = henrriTest_();
  ui.alert(t.ok
    ? 'Henrri est connecté (' + environnement + ').\n\n' + t.message
    : 'Les clés sont enregistrées, mais l\'essai a échoué :\n\n' + t.message +
      '\n\nVérifie que les clés correspondent bien à l\'environnement choisi.');
}

/** Efface les clés. Utile avant de passer du bac à sable à la production. */
function oublierHenrri() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Oublier les clés Henrri ?',
      'L\'application ne pourra plus préparer de facture tant que tu n\'auras pas ' +
      'reconnecté Henrri. Rien n\'est supprimé chez Henrri.',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties()
    .deleteProperty(HENRRI_P_ID_);
  PropertiesService.getScriptProperties()
    .deleteProperty(HENRRI_P_SECRET_);
  PropertiesService.getScriptProperties()
    .deleteProperty(HENRRI_P_ENV_);
  CacheService.getScriptCache().removeAll([HENRRI_C_SESSION_, HENRRI_C_SID_]);
  ui.alert('Clés oubliées.');
}

/** Essaie la connexion et dit qui l'on est chez Henrri. */
function henrriTest_() {
  var cles = henrriCles_();
  if (!cles) return { ok: false, message: 'Aucune clé enregistrée. Lance « Connecter Henrri ».' };
  try {
    henrriSession_(true);
    var moi = henrriAppel_('henrri_get_me', {});
    var soc = moi && (moi.company || moi.societe || moi.companyName ||
                      (moi.data && moi.data.company)) || null;
    var nom = soc && (soc.name || soc.corporateName) ||
              moi && (moi.name || moi.email) || '';
    return { ok: true,
             message: 'Environnement : ' + cles.env +
                      (nom ? '\nCompte : ' + nom : '') };
  } catch (err) {
    return { ok: false, message: String(err && err.message || err) };
  }
}
function testerHenrri() {
  var t = henrriTest_();
  SpreadsheetApp.getUi().alert(t.ok ? 'Henrri répond.\n\n' + t.message
                                    : 'Henrri ne répond pas.\n\n' + t.message);
}

/* ---------------------------------------------------------------- */
/* Le transport : JSON-RPC sur HTTP, réponse en flux d'événements.  */
/* ---------------------------------------------------------------- */

/**
 * Un appel JSON-RPC au serveur MCP. Rend { json: …, sid: … } ; ne juge pas le
 * contenu, c'est l'appelant qui sait ce qu'il attend.
 */
function henrriRpc_(methode, params, sid, sansReponse) {
  var en = { 'Accept': 'application/json, text/event-stream' };
  if (sid) en['Mcp-Session-Id'] = sid;
  var rep = UrlFetchApp.fetch(HENRRI_MCP_, {
    method: 'post',
    contentType: 'application/json',
    headers: en,
    payload: JSON.stringify(
      sansReponse ? { jsonrpc: '2.0', method: methode, params: params || {} }
                  : { jsonrpc: '2.0', id: 1, method: methode, params: params || {} }),
    muteHttpExceptions: true,
    followRedirects: true
  });
  var code = rep.getResponseCode();
  var corps = rep.getContentText();
  var sidRendu = '';
  try {
    var h = rep.getAllHeaders();
    sidRendu = String(h['Mcp-Session-Id'] || h['mcp-session-id'] || '');
  } catch (e) {}
  if (sansReponse) return { json: null, sid: sidRendu, code: code };
  if (code < 200 || code >= 300) {
    throw new Error('Henrri a répondu ' + code + ' : ' + String(corps).slice(0, 300));
  }
  return { json: henrriCorps_(corps), sid: sidRendu, code: code };
}

/**
 * Le corps peut arriver en JSON nu, ou en flux d'événements — une suite de
 * lignes « data: {…} ». On prend le dernier objet qui porte un « result » ou
 * une « error » : c'est la réponse, les précédents ne sont que du bavardage.
 */
function henrriCorps_(corps) {
  var txt = String(corps || '').trim();
  if (!txt) return null;
  if (txt.charAt(0) === '{') {
    try { return JSON.parse(txt); } catch (e) {}
  }
  var lignes = txt.split('\n'), trouve = null;
  for (var i = 0; i < lignes.length; i++) {
    var l = lignes[i].replace(/^﻿/, '').trim();
    if (l.indexOf('data:') !== 0) continue;
    var brut = l.slice(5).trim();
    if (!brut || brut === '[DONE]') continue;
    try {
      var o = JSON.parse(brut);
      if (o && (o.result !== undefined || o.error !== undefined)) trouve = o;
      else if (!trouve) trouve = o;
    } catch (e2) {}
  }
  return trouve;
}

/** Le numéro de conversation MCP, ouvert à la demande et gardé neuf minutes. */
function henrriSid_(neuf) {
  var cache = CacheService.getScriptCache();
  if (!neuf) {
    var vu = cache.get(HENRRI_C_SID_);
    if (vu) return vu;
  }
  var r = henrriRpc_('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'breizh-brillance-devis', version: '1.0' }
  }, '', false);
  if (r.json && r.json.error) {
    throw new Error('Henrri refuse la connexion : ' +
                    String(r.json.error.message || '').slice(0, 200));
  }
  var sid = r.sid || '';
  if (sid) {
    try { henrriRpc_('notifications/initialized', {}, sid, true); } catch (e) {}
    cache.put(HENRRI_C_SID_, sid, 540);
  }
  return sid;
}

/**
 * Le jeton de session Henrri. C'est lui, et non le numéro de conversation MCP,
 * qui prouve qui nous sommes : le serveur nous demande de le repasser à chaque
 * appel, parce qu'il ne garde rien.
 */
function henrriSession_(neuf) {
  var cache = CacheService.getScriptCache();
  if (!neuf) {
    var vu = cache.get(HENRRI_C_SESSION_);
    if (vu) return vu;
  }
  var cles = henrriCles_();
  if (!cles) throw new Error('Henrri n\'est pas connecté : lance « Connecter Henrri » dans le menu.');
  var res = henrriAppelBrut_('henrri_authenticate', {
    clientId: cles.id, clientSecret: cles.secret, environment: cles.env
  }, henrriSid_(neuf));
  var clef = res && (res.sessionKey || res.session_key ||
                     (res.data && res.data.sessionKey)) || '';
  if (!clef) {
    throw new Error('Henrri n\'a pas rendu de jeton de session. Les clés sont-elles ' +
                    'celles de l\'environnement « ' + cles.env + ' » ?');
  }
  cache.put(HENRRI_C_SESSION_, clef, 480);
  return clef;
}

/** Un appel d'outil sans se soucier du jeton : sert à l'authentification. */
function henrriAppelBrut_(outil, args, sid) {
  var r = henrriRpc_('tools/call', { name: outil, arguments: args || {} }, sid, false);
  var j = r.json;
  if (!j) throw new Error('Henrri n\'a rien répondu (outil ' + outil + ').');
  if (j.error) {
    throw new Error('Henrri : ' + String(j.error.message || j.error.code || '').slice(0, 300));
  }
  return henrriContenu_(j.result, outil);
}

/**
 * Un appel d'outil, jeton compris. Si Henrri dit que la session n'est pas
 * authentifiée — le jeton a expiré, ou le serveur a oublié la conversation —
 * on se réauthentifie une fois et on rejoue. Une seule fois : au-delà, c'est
 * un vrai refus, et s'entêter ne ferait que brûler des appels.
 */
function henrriAppel_(outil, args) {
  var a = {};
  for (var k in args) if (args.hasOwnProperty(k)) a[k] = args[k];
  a.sessionKey = henrriSession_(false);
  try {
    return henrriAppelBrut_(outil, a, henrriSid_(false));
  } catch (err) {
    var m = String(err && err.message || err);
    if (!/non authentifi|not authenticated|session inconnue|expir|401|403/i.test(m)) throw err;
    CacheService.getScriptCache().removeAll([HENRRI_C_SESSION_, HENRRI_C_SID_]);
    a.sessionKey = henrriSession_(true);
    return henrriAppelBrut_(outil, a, henrriSid_(false));
  }
}

/**
 * Ce qu'un outil MCP rend vraiment. Trois formes possibles : un objet
 * structuré, un texte qui est du JSON, un texte qui n'en est pas. On accepte
 * les trois, et une erreur annoncée dans le contenu reste une erreur.
 */
function henrriContenu_(result, outil) {
  if (!result) return null;
  if (result.isError) {
    var msg = '';
    try { msg = String(result.content[0].text || ''); } catch (e) {}
    throw new Error('Henrri refuse « ' + outil + ' » : ' + msg.slice(0, 300));
  }
  if (result.structuredContent) return result.structuredContent;
  var txt = '';
  try {
    (result.content || []).forEach(function (c) {
      if (c && c.type === 'text' && c.text) txt += c.text;
    });
  } catch (e2) {}
  txt = String(txt || '').trim();
  if (!txt) return result;
  if (txt.charAt(0) === '{' || txt.charAt(0) === '[') {
    try { return JSON.parse(txt); } catch (e3) {}
  }
  return { texte: txt };
}

/* ---------------------------------------------------------------- */
/* CE QU'IL Y A À FACTURER, ET CE QU'ON EN FAIT                     */
/* ---------------------------------------------------------------- */

/* Une ligne par facture préparée. ID_HENRRI est la seule colonne qui compte
   vraiment : elle dit qu'un devis est déjà parti chez Henrri, et empêche de le
   facturer deux fois. PERIODE est vide sur un ponctuel, et vaut « 2026-11 »
   sur une mensualité de contrat d'entretien : c'est le couple
   (NUMERO_DEVIS, PERIODE) qui est unique, pas le numéro seul. */
var ENTETES_FACTURES_ = [
  'CREE_LE', 'NUMERO_DEVIS', 'CLIENT', 'TYPE', 'PERIODE', 'PASSAGES',
  'TOTAL_HT', 'TOTAL_TVA', 'TOTAL_TTC',
  'ID_HENRRI', 'ID_CLIENT_HENRRI', 'LIEN_HENRRI',
  'ETAT', 'ECART', 'CREE_PAR', 'NOTE',
  'ID_PENNYLANE', 'ID_CLIENT_PENNYLANE', 'NUMERO_FACTURE'
];

/** Les chantiers rangés par numéro de devis. */
function chantiersParDevis_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var cN = en.indexOf('NUMERO');
  for (var i = 1; i < v.length; i++) {
    var n = String(v[i][cN] || '').trim();
    if (!n) continue;
    var o = {};
    en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
    (out[n] = out[n] || []).push(o);
  }
  return out;
}

/** Les factures déjà préparées, rangées par numéro de devis puis par période. */
function facturesFaites_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.FACTURES);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  for (var i = 1; i < v.length; i++) {
    var o = {};
    en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
    var num = String(o.NUMERO_DEVIS || '').trim();
    if (!num) continue;
    /* Un échec ne barre pas la route : on doit pouvoir réessayer. Seule une
       facture réellement déposée chez Henrri compte comme faite. */
    if (!String(o.ID_HENRRI || '').trim() && !String(o.ID_PENNYLANE || '').trim() &&
        String(o.ETAT || '').toUpperCase().trim() !== 'DEJA FACTUREE') continue;
    var k = String(o.PERIODE || '').trim();
    (out[num] = out[num] || {})[k] = o;
  }
  return out;
}

function moisDe_(v) {
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  var m = d.getMonth() + 1;
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m;
}
function moisCourant_() { return moisDe_(new Date()); }
function moisLisible_(p) {
  var mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
              'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var m = String(p || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(p || '');
  return mois[Number(m[2]) - 1] + ' ' + m[1];
}

/**
 * L'état de facturation de tout ce qui est signé. Rend deux listes : les
 * prestations ponctuelles, et les contrats qui se facturent au mois.
 *
 * La règle que Simon a posée : on ne facture un ponctuel que lorsque le travail
 * est fait — c'est-à-dire quand le salarié a pointé son départ et que le
 * chantier est passé à FAIT. Un chantier annulé ne compte pas ; un chantier
 * en PROBLEME non plus, mais il se dit, parce qu'un problème non réglé se
 * facture rarement sans discussion.
 */
function etatFacturation_(periode) {
  var mois = String(periode || '').match(/^\d{4}-\d{2}$/) ? periode : moisCourant_();
  var parNum = chantiersParDevis_();
  var faites = facturesFaites_();
  var lp = lignesParDevis_();
  var ponctuels = [], contrats = [];

  lireDevis_().forEach(function (d) {
    if (String(d.STATUT || '').toUpperCase() !== 'SIGNE') return;
    var num = String(d.NUMERO || '').trim();
    if (!num) return;
    if (devisEssai_(d)) return;                 // v95 : un essai ne se facture pas
    var ch = (parNum[num] || []).filter(function (c) {
      return String(c.STATUT || '').toUpperCase() !== 'ANNULE';
    });
    var faits = ch.filter(function (c) { return String(c.STATUT || '').toUpperCase() === 'FAIT'; });
    var soucis = ch.filter(function (c) { return String(c.STATUT || '').toUpperCase() === 'PROBLEME'; });
    var base = {
      numero: num, client: String(d.CLIENT || ''), commercial: String(d.COMMERCIAL || ''),
      ville: String(d.VILLE || ''), signeLe: isoDe_(d.DATE_STATUT || d.DATE) || '',
      nature: String(d.NATURE || ''), lignes: (lp[num] || []).length,
      soucis: soucis.length
    };

    if (recurrentDevis_(d.NATURE, d.PASSAGES_MOIS, d.SANS_CONTRAT)) {
      var prevus = Number(d.PASSAGES_MOIS) || 0;
      var duMois = ch.filter(function (c) { return moisDe_(c.DATE) === mois; });
      var faitsMois = duMois.filter(function (c) {
        return String(c.STATUT || '').toUpperCase() === 'FAIT';
      });
      var dejaF = (faites[num] || {})[mois];
      contrats.push({
        numero: base.numero, client: base.client, commercial: base.commercial,
        ville: base.ville, signeLe: base.signeLe, nature: base.nature,
        lignes: base.lignes, soucis: base.soucis,
        periode: mois, periodeNom: moisLisible_(mois),
        htMois: Number(d.TOTAL_HT_MENSUEL) || Number(d.TOTAL_HT) || 0,
        passagesPrevus: prevus, passagesFaits: faitsMois.length,
        passagesPoses: duMois.length,
        facturee: !!dejaF, idHenrri: dejaF ? String(dejaF.ID_HENRRI || '') : '',
        lienHenrri: dejaF ? String(dejaF.LIEN_HENRRI || '') : ''
      });
      return;
    }

    var dejaP = (faites[num] || {})[''];
    ponctuels.push({
      numero: base.numero, client: base.client, commercial: base.commercial,
      ville: base.ville, signeLe: base.signeLe, nature: base.nature,
      lignes: base.lignes, soucis: base.soucis,
      ht: Number(d.TOTAL_HT) || 0, tva: Number(d.TOTAL_TVA) || 0,
      ttc: Number(d.TOTAL_TTC) || 0,
      chantiers: ch.length, faits: faits.length,
      /* Prêt : le travail est fait et rien n'attend. Attente : il reste un
         passage à faire, ou aucun n'a encore été posé au planning. */
      pret: ch.length > 0 && faits.length === ch.length,
      facturee: !!dejaP, idHenrri: dejaP ? String(dejaP.ID_HENRRI || '') : '',
      lienHenrri: dejaP ? String(dejaP.LIEN_HENRRI || '') : '',
      /* v94 : le DERNIER départ pointé, pas celui de la dernière ligne du
         tableau — c'est de lui que partent les deux heures avant facture. */
      faitLe: faits.length ? isoDe_(faits.reduce(function (m, c) {
        var x = c.DEPART || c.DATE, t = x ? new Date(x).getTime() : 0;
        return (!isNaN(t) && t > m.t) ? { t: t, v: x } : m;
      }, { t: 0, v: faits[faits.length - 1].DEPART || faits[faits.length - 1].DATE }).v) : ''
    });
  });

  ponctuels.sort(function (a, b) {
    if (a.facturee !== b.facturee) return a.facturee ? 1 : -1;
    if (a.pret !== b.pret) return a.pret ? -1 : 1;
    return String(a.signeLe) < String(b.signeLe) ? -1 : 1;
  });
  contrats.sort(function (a, b) {
    if (a.facturee !== b.facturee) return a.facturee ? 1 : -1;
    return String(a.client).localeCompare(String(b.client));
  });
  return { ok: true, periode: mois, periodeNom: moisLisible_(mois),
           henrri: henrriConfigure_(), pennylane: !!pennylaneJeton_(),
           ponctuels: ponctuels, contrats: contrats };
}

/* ---------------------------------------------------------------- */
/* LE CLIENT CHEZ HENRRI                                            */
/* ---------------------------------------------------------------- */

/**
 * Retrouve le client chez Henrri, ou le crée. On cherche d'abord dans les
 * factures déjà préparées : un client créé le mois dernier n'a pas à être
 * cherché à nouveau, et surtout pas recréé. Puis chez Henrri, par SIRET quand
 * on l'a — deux sociétés peuvent porter le même nom, jamais le même SIRET.
 */
function henrriClient_(d) {
  var siret = String(d.SIRET_CLIENT || '').replace(/\s+/g, '');
  var nom = String(d.CLIENT || '').trim();
  if (!nom) throw new Error('Ce devis n\'a pas de nom de client.');

  var sh = SpreadsheetApp.getActive().getSheetByName(SH.FACTURES);
  if (sh && sh.getLastRow() > 1) {
    var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    var en = v[0].map(function (x) { return String(x).trim(); });
    var cC = en.indexOf('CLIENT'), cI = en.indexOf('ID_CLIENT_HENRRI');
    if (cC >= 0 && cI >= 0) {
      for (var i = v.length - 1; i >= 1; i--) {
        if (String(v[i][cC] || '').trim().toUpperCase() === nom.toUpperCase() &&
            String(v[i][cI] || '').trim()) {
          return { id: Number(v[i][cI]), neuf: false };
        }
      }
    }
  }

  var trouve = null;
  var res = henrriAppel_('henrri_list_customers', { search: siret || nom, limit: 20 });
  var liste = henrriListe_(res);
  for (var j = 0; j < liste.length; j++) {
    var c = liste[j];
    var cSiret = String(c.siret || c.siretNumber || '').replace(/\s+/g, '');
    var cNom = String(c.name || c.corporateName || c.tradeName || '').trim();
    if (siret && cSiret && cSiret === siret) { trouve = c; break; }
    if (!trouve && cNom.toUpperCase() === nom.toUpperCase()) trouve = c;
  }
  if (trouve && (trouve.id || trouve.customerId)) {
    return { id: Number(trouve.id || trouve.customerId), neuf: false };
  }

  var pro = String(d.TYPE_CLIENT || '').toUpperCase().indexOf('PART') !== 0;
  var args = {
    name: nom,
    type: pro ? 'professional' : 'individual',
    address: {
      address: String(d.ADRESSE || ''), city: String(d.VILLE || ''),
      postCode: String(d.CP || ''), country: 'FR'
    }
  };
  if (siret) args.siret = siret;
  var contact = String(d.CONTACT || '').trim();
  var mail = String(d.EMAIL || '').trim();
  var tel = String(d.TELEPHONE || '').trim();
  if (contact || mail || tel) {
    var ct = {};
    if (contact) {
      var mots = contact.split(/\s+/);
      ct.lastName = mots.length > 1 ? mots.slice(1).join(' ') : contact;
      if (mots.length > 1) ct.firstName = mots[0];
    }
    if (mail) ct.email = mail;
    if (tel) ct.phone = tel;
    args.contacts = [ct];
  }
  var cree = henrriAppel_('henrri_create_customer', args);
  var id = cree && (cree.id || cree.customerId ||
                    (cree.customer && cree.customer.id) ||
                    (cree.data && cree.data.id));
  if (!id) throw new Error('Henrri n\'a pas rendu l\'identifiant du client créé.');
  return { id: Number(id), neuf: true };
}

/** Henrri rend tantôt un tableau, tantôt un objet qui en contient un. */
function henrriListe_(res) {
  if (!res) return [];
  if (Object.prototype.toString.call(res) === '[object Array]') return res;
  var cles = ['customers', 'items', 'documents', 'data', 'results', 'list'];
  for (var i = 0; i < cles.length; i++) {
    var v = res[cles[i]];
    if (Object.prototype.toString.call(v) === '[object Array]') return v;
    if (v && Object.prototype.toString.call(v.items) === '[object Array]') return v.items;
  }
  return [];
}

/* ---------------------------------------------------------------- */
/* LA FACTURE                                                       */
/* ---------------------------------------------------------------- */

/**
 * Prépare une facture chez Henrri à partir d'un devis signé.
 *
 * Sur le montant, un choix qui mérite d'être écrit : chaque ligne part chez
 * Henrri au TOTAL_HT que porte le devis signé, en quantité 1 (ou en nombre de
 * passages pour une mensualité), et le détail du calcul — « 120 m² × 0,15 € » —
 * passe dans le libellé. On pourrait envoyer la quantité et le prix unitaire,
 * et laisser Henrri multiplier ; on ne le fait pas, parce que la remise et les
 * arrondis se feraient deux fois, chez nous puis chez eux, et qu'une facture
 * qui s'écarte d'un centime du devis signé est une facture à discuter. Ce que
 * le client a signé est ce qu'il reçoit.
 */
function preparerFacture_(d, com) {
  var num = String(d.numero || '').trim();
  if (!num) return { ok: false, erreur: 'Numéro de devis manquant.' };
  /* v94 : Pennylane d'abord. Henrri ne sert plus que s'il est seul connecté. */
  if (pennylaneJeton_()) return preparerFacturePennylane_(d, com);
  if (!henrriConfigure_()) {
    return { ok: false, erreur: 'Henrri n\'est pas connecté. Dans le classeur : ' +
                                'menu « Devis » → « Connecter Henrri ».' };
  }

  var devis = null;
  lireDevis_().forEach(function (x) {
    if (String(x.NUMERO || '').trim() === num) devis = x;
  });
  if (!devis) return { ok: false, erreur: 'Devis ' + num + ' introuvable.' };
  if (String(devis.STATUT || '').toUpperCase() !== 'SIGNE') {
    return { ok: false, erreur: 'Le devis ' + num + ' n\'est pas signé.' };
  }

  var recurrent = recurrentDevis_(devis.NATURE, devis.PASSAGES_MOIS, devis.SANS_CONTRAT);
  var periode = recurrent
    ? (String(d.periode || '').match(/^\d{4}-\d{2}$/) ? d.periode : moisCourant_())
    : '';
  var passages = recurrent ? (Number(devis.PASSAGES_MOIS) || 1) : 1;

  var faites = facturesFaites_();
  if ((faites[num] || {})[periode]) {
    var dj = faites[num][periode];
    return { ok: false, deja: true,
             erreur: 'Déjà préparée' + (periode ? ' pour ' + moisLisible_(periode) : '') +
                     ' (facture ' + String(dj.ID_HENRRI) + ' chez Henrri).',
             idHenrri: String(dj.ID_HENRRI || ''), lien: String(dj.LIEN_HENRRI || '') };
  }

  /* Le garde-fou de Simon : on ne facture pas une prestation qui n'est pas
     faite. Il peut passer outre — c'est son entreprise — mais il doit le dire
     explicitement, et le journal en gardera la trace. */
  var etat = etatFacturation_(periode);
  var vu = null;
  (recurrent ? etat.contrats : etat.ponctuels).forEach(function (x) {
    if (x.numero === num) vu = x;
  });
  if (!recurrent && vu && !vu.pret && !d.force) {
    return { ok: false, pasPret: true,
             erreur: vu.chantiers === 0
               ? 'Aucun passage n\'est encore posé au planning pour ce devis.'
               : 'Il reste ' + (vu.chantiers - vu.faits) + ' passage(s) non terminé(s) sur ' +
                 vu.chantiers + '.' };
  }

  var lignes = (lignesParDevis_()[num] || []).slice().sort(function (a, b) {
    return (Number(a.ORDRE) || 0) - (Number(b.ORDRE) || 0);
  });
  if (!lignes.length) return { ok: false, erreur: 'Ce devis n\'a aucune ligne de prestation.' };

  var attenduHt = 0;
  lignes.forEach(function (l) { attenduHt += (Number(l.TOTAL_HT) || 0) * passages; });
  attenduHt = Math.round(attenduHt * 100) / 100;

  var client, doc, idDoc = 0, poseesOk = 0, erreur = '';
  try {
    client = henrriClient_(devis);
    var reg = lireReglages_();
    var jours = Number(reg.delai_paiement_jours) || 30;
    var aujourd = new Date();
    var ech = new Date(aujourd.getTime() + jours * 24 * 3600 * 1000);

    doc = henrriAppel_('henrri_create_document', {
      documentTypeId: 1,
      customerId: client.id,
      documentDate: iso10_(aujourd),
      dueDate: iso10_(ech),
      notes: (recurrent
        ? 'Contrat d\'entretien — ' + moisLisible_(periode) +
          ' (' + nbFr_(passages) + ' passage' + (passages > 1 ? 's' : '') + ' en moyenne, sur 52 semaines)'
        : 'Prestation réalisée') +
        ' · devis ' + num +
        (devis.SIGNATAIRE ? ' signé par ' + String(devis.SIGNATAIRE) : '')
    });
    idDoc = Number(doc && (doc.id || doc.documentId ||
                           (doc.document && doc.document.id) ||
                           (doc.data && doc.data.id)) || 0);
    if (!idDoc) throw new Error('Henrri n\'a pas rendu l\'identifiant de la facture.');

    for (var i = 0; i < lignes.length; i++) {
      var l = lignes[i];
      henrriAppel_('henrri_add_document_line', {
        documentId: idDoc,
        description: libelleFacture_(l, recurrent, periode),
        sellingPriceWithoutTax: Number(l.TOTAL_HT) || 0,
        quantity: passages,
        vatPercent: Number(l.TVA) || 0
      });
      poseesOk++;
    }
  } catch (err) {
    erreur = String(err && err.message || err);
  }

  var ecart = '';
  var totaux = { ht: attenduHt, tva: 0, ttc: 0 };
  if (idDoc && !erreur) {
    try {
      var relu = henrriAppel_('henrri_get_document', { id: idDoc });
      var o = (relu && (relu.document || relu.data)) || relu || {};
      var ht = Number(o.totalWithoutTax || o.totalHT || o.amountWithoutTax || 0);
      if (ht) {
        totaux.ht = ht;
        totaux.tva = Number(o.totalTax || o.totalVat || 0);
        totaux.ttc = Number(o.totalWithTax || o.totalTTC || 0);
        if (Math.abs(ht - attenduHt) >= 0.01) {
          ecart = 'Henrri compte ' + nb_(ht) + ' € HT, le devis ' + nb_(attenduHt) + ' €';
        }
      }
    } catch (e) {}
  }

  var lien = '';
  if (idDoc) {
    try {
      var p = henrriAppel_('henrri_get_document_pdf_url', { id: idDoc });
      lien = String((p && (p.url || p.pdfUrl || p.link)) || '');
    } catch (e2) {}
  }

  ecrireFacture_({
    CREE_LE: new Date(), NUMERO_DEVIS: num, CLIENT: String(devis.CLIENT || ''),
    TYPE: recurrent ? 'MENSUEL' : 'PONCTUEL', PERIODE: periode,
    PASSAGES: passages,
    TOTAL_HT: totaux.ht, TOTAL_TVA: totaux.tva, TOTAL_TTC: totaux.ttc,
    ID_HENRRI: idDoc || '', ID_CLIENT_HENRRI: client ? client.id : '',
    LIEN_HENRRI: lien,
    ETAT: erreur ? 'ECHEC' : 'BROUILLON', ECART: ecart,
    CREE_PAR: com ? com.nom : '',
    NOTE: erreur ? erreur.slice(0, 400)
                 : (poseesOk + ' ligne(s)') +
                   (d.force && !recurrent ? ' · facturé avant la fin du chantier' : '')
  });

  if (erreur) {
    tracerServeur_(com ? com.nom : '', 'FACTURE EN ECHEC',
                   String(devis.CLIENT || '') + ' · ' + erreur.slice(0, 200), num,
                   d.appareil || '');
    return { ok: false, erreur: erreur, idHenrri: idDoc || '' };
  }

  tracerServeur_(com ? com.nom : '', 'FACTURE PREPAREE',
                 String(devis.CLIENT || '') +
                 (periode ? ' · ' + moisLisible_(periode) : '') +
                 ' · ' + nb_(totaux.ht) + ' € HT · Henrri ' + idDoc +
                 (ecart ? ' · ÉCART : ' + ecart : '') +
                 (d.force && !recurrent ? ' · AVANT LA FIN DU CHANTIER' : ''),
                 num, d.appareil || '');

  return { ok: true, numero: num, idHenrri: idDoc, lien: lien,
           periode: periode, passages: passages,
           ht: totaux.ht, tva: totaux.tva, ttc: totaux.ttc,
           ecart: ecart, lignes: poseesOk,
           clientNeuf: client ? !!client.neuf : false };
}

/** Le libellé d'une ligne de facture : la prestation, et d'où vient son prix. */
function libelleFacture_(l, recurrent, periode) {
  var t = String(l.DESIGNATION || '').trim();
  if (l.DETAIL) t += ' (' + String(l.DETAIL).trim() + ')';
  var q = Number(l.QTE) || 0, pu = Number(l.PU_HT) || 0;
  var det = [];
  if (q && q !== 1) det.push(nb_(q) + ' ' + String(l.UNITE || '').trim() + ' × ' + nb_(pu) + ' €');
  if (Number(l.REMISE_PCT) > 0) det.push('remise ' + nb_(l.REMISE_PCT) + ' %');
  if (det.length) t += ' — ' + det.join(', ');
  if (recurrent) t += ' — ' + moisLisible_(periode) + ', le passage';
  return t.slice(0, 500);
}

function iso10_(d) {
  return Utilities.formatDate(d, 'Europe/Paris', 'yyyy-MM-dd');
}

function ecrireFacture_(v) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SH.FACTURES) || creerOnglet_(ss, SH.FACTURES, ENTETES_FACTURES_);
  var en = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); })
    : [];
  if (!en.length) {
    sh.getRange(1, 1, 1, ENTETES_FACTURES_.length).setValues([ENTETES_FACTURES_])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    en = ENTETES_FACTURES_.slice();
  }
  /* Écriture par nom de colonne, jamais par position : une colonne ajoutée
     plus tard arrive à la fin de la feuille, et une ligne posée par position
     irait alors porter ses valeurs dans la mauvaise case. */
  /* v94 : une colonne nouvelle (ID_PENNYLANE…) s'ajoute à la fin plutôt que
     de laisser tomber sa valeur. */
  for (var kk in v) {
    if (v.hasOwnProperty(kk) && en.indexOf(kk) < 0 && ENTETES_FACTURES_.indexOf(kk) >= 0) {
      sh.getRange(1, en.length + 1).setValue(kk).setFontWeight('bold');
      en.push(kk);
    }
  }
  var ligne = [];
  for (var i = 0; i < en.length; i++) ligne.push('');
  for (var k in v) {
    if (!v.hasOwnProperty(k)) continue;
    var c = en.indexOf(k);
    if (c >= 0) ligne[c] = v[k];
  }
  sh.appendRow(ligne);
  return sh.getLastRow();
}

/**
 * Les mensualités d'un mois, préparées d'un coup. Simon clique une fois, et
 * chaque contrat en cours reçoit sa facture. Un contrat déjà facturé pour ce
 * mois est sauté sans bruit : relancer le bouton ne crée pas de doublon.
 */
function facturesDuMois_(d, com) {
  var periode = String(d.periode || '').match(/^\d{4}-\d{2}$/) ? d.periode : moisCourant_();
  var etat = etatFacturation_(periode);
  var faits = [], sautes = [], echecs = [];
  etat.contrats.forEach(function (c) {
    if (c.facturee) { sautes.push({ numero: c.numero, client: c.client, motif: 'déjà préparée' }); return; }
    var r = preparerFacture_({ numero: c.numero, periode: periode,
                               appareil: d.appareil || '' }, com);
    if (r.ok) faits.push({ numero: c.numero, client: c.client, ht: r.ht,
                           idHenrri: r.idHenrri, lien: r.lien, ecart: r.ecart });
    else if (r.deja) sautes.push({ numero: c.numero, client: c.client, motif: 'déjà préparée' });
    else echecs.push({ numero: c.numero, client: c.client, erreur: r.erreur });
  });
  tracerServeur_(com ? com.nom : '', 'FACTURES DU MOIS',
                 moisLisible_(periode) + ' · ' + faits.length + ' préparée(s), ' +
                 sautes.length + ' sautée(s), ' + echecs.length + ' en échec',
                 '', d.appareil || '');
  return { ok: true, periode: periode, periodeNom: moisLisible_(periode),
           faits: faits, sautes: sautes, echecs: echecs };
}

/* ====================== LA FICHE CHANTIER JOINTE (v101) ======================
   Demande de Simon, 8 novembre 2026 : « quand je crée ou modifie une
   intervention, je dois pouvoir rajouter une fiche chantier en pièce jointe,
   pour que quand les prestataires cliquent sur l'intervention sur le planning
   ou là où ils pointent, ils voient aussi la fiche avec les instructions ».

   Le fichier (PDF ou photo, 10 Mo au plus) est rangé dans le Drive du gérant,
   DEVIS NETTOYAGE / FICHES CHANTIER. Il n'est jamais partagé par lien : le
   salarié le reçoit par l'appli (ficheLire), et seulement pour une
   intervention à son nom. Joint à un contrat (R-…), il vaut pour tous ses
   passages à venir, et la génération de la nuit le recopie sur les suivants.
   Un fichier remplacé n'est pas supprimé : les passages déjà faits gardent
   celle qu'ils avaient. */
var FICHE_MAX_ = 10 * 1024 * 1024;
var FICHE_TYPES_ = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];

/** Ajoute une colonne qui manque, sans relancer toute la mise à jour. */
function colonneAssuree_(nomOnglet, h) {
  var sh = SpreadsheetApp.getActive().getSheetByName(nomOnglet);
  if (!sh) return null;
  var en = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  if (en.indexOf(h) < 0) {
    sh.getRange(1, sh.getLastColumn() + 1).setValue(h)
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  }
  return sh;
}

function dossierFiches_() {
  return sousDossier_(racineDevis_(lireReglages_()), 'FICHES CHANTIER');
}

/** Les passages d'un contrat qui prennent la fiche : à venir, ou sans date, pas encore faits. */
function passagesAVenir_(id) {
  var auj = minuit_(new Date()), out = [];
  objetsDe_(SH.CHANTIERS).forEach(function (o) {
    if (String(o.RECURRENT || '').split('|')[0] !== id) return;
    var st = String(o.STATUT || '').toUpperCase().trim();
    if (st === 'FAIT' || st === 'ANNULE') return;
    if (o.DATE) { var d = minuit_(o.DATE); if (!isNaN(d.getTime()) && d < auj) return; }
    out.push(String(o.ID).trim());
  });
  return out;
}

function chantierParId_(id) {
  var t = null;
  objetsDe_(SH.CHANTIERS).forEach(function (o) { if (String(o.ID || '').trim() === id) t = o; });
  return t;
}

function joindreFiche_(d, com) {
  var cible = String(d.id || '').trim();
  if (!cible) return { ok: false, erreur: 'intervention ou contrat manquant' };
  var type = String(d.type || '').toLowerCase().trim();
  if (FICHE_TYPES_.indexOf(type) < 0) return { ok: false, erreur: 'la fiche doit être un PDF ou une photo' };
  var data = String(d.data || '');
  if (!data) return { ok: false, erreur: 'fichier vide' };
  var octets;
  try { octets = Utilities.base64Decode(data); } catch (e) { return { ok: false, erreur: 'fichier illisible' }; }
  if (!octets || !octets.length) return { ok: false, erreur: 'fichier vide' };
  if (octets.length > FICHE_MAX_) return { ok: false, erreur: 'fichier trop lourd (10 Mo au plus)' };

  var serie = /^R-/i.test(cible), L = null, ch = null;
  if (serie) { L = ligneSerie_(cible); if (!L) return { ok: false, erreur: 'contrat introuvable' }; }
  else { ch = chantierParId_(cible); if (!ch) return { ok: false, erreur: 'intervention introuvable' }; }

  colonneAssuree_(SH.CHANTIERS, 'FICHE'); colonneAssuree_(SH.CHANTIERS, 'FICHE_NOM');
  if (serie) { colonneAssuree_(SH.RECURRENTS, 'FICHE'); colonneAssuree_(SH.RECURRENTS, 'FICHE_NOM'); L = ligneSerie_(cible); }

  /* « nom » est celui de la personne connectée : le nom du fichier arrive à part. */
  var nomOrig = String(d.fichierNom || '').replace(/[\\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) ||
    (type === 'application/pdf' ? 'fiche.pdf' : 'fiche.jpg');
  var client = serie ? String(L.o.CLIENT || '') : String(ch.CLIENT || '');
  var nomDrive = 'Fiche-' + cible + '-' + sansAccent_(client).replace(/[^A-Z0-9]+/gi, '-').slice(0, 40) + '-' + nomOrig;
  var f = dossierFiches_().createFile(Utilities.newBlob(octets, type, nomDrive));
  var url = f.getUrl();

  var ids = serie ? passagesAVenir_(cible) : [cible];
  if (serie) { ecrireCase_(L, 'FICHE', url); ecrireCase_(L, 'FICHE_NOM', nomOrig); }
  ids.forEach(function (id) { majChantier_(id, { FICHE: url, FICHE_NOM: nomOrig }); });
  tracerServeur_(com ? com.nom : '', 'FICHE CHANTIER JOINTE',
                 cible + ' · ' + nomOrig + ' · ' + ids.length + ' intervention(s)', '', d.appareil || '');
  return { ok: true, nom: nomOrig, interventions: ids.length };
}

function retirerFiche_(d, com) {
  var cible = String(d.id || '').trim();
  var serie = /^R-/i.test(cible), ids;
  if (serie) {
    var L = ligneSerie_(cible);
    if (!L) return { ok: false, erreur: 'contrat introuvable' };
    ecrireCase_(L, 'FICHE', ''); ecrireCase_(L, 'FICHE_NOM', '');
    ids = passagesAVenir_(cible);
  } else {
    if (!chantierParId_(cible)) return { ok: false, erreur: 'intervention introuvable' };
    ids = [cible];
  }
  ids.forEach(function (id) { majChantier_(id, { FICHE: '', FICHE_NOM: '' }); });
  tracerServeur_(com ? com.nom : '', 'FICHE CHANTIER RETIREE', cible, '', d.appareil || '');
  return { ok: true, interventions: ids.length };
}

/** Le salarié lit la fiche d'une intervention à son nom ; le gérant, toutes. */
function lireFiche_(d, com) {
  var cible = String(d.id || '').trim();
  var o = /^R-/i.test(cible) ? (ligneSerie_(cible) || {}).o : chantierParId_(cible);
  if (!o) return { ok: false, erreur: 'intervention introuvable' };
  if (com.role !== 'ADMIN' && !quiContient_(o.PRESTATAIRE, com.nom)) {
    tracerServeur_(com.nom, 'ACTION REFUSEE', 'ficheLire ' + cible, '', d.appareil || '');
    return { ok: false, erreur: 'cette intervention n\'est pas à ton nom' };
  }
  var id = idDrive_(o.FICHE);
  if (!id) return { ok: false, erreur: 'pas de fiche jointe' };
  try {
    var f = DriveApp.getFileById(id);
    return { ok: true, data: Utilities.base64Encode(f.getBlob().getBytes()), type: f.getMimeType(),
             nom: String(o.FICHE_NOM || '') || f.getName() };
  } catch (e) {
    return { ok: false, erreur: 'la fiche n\'a pas pu être lue sur le Drive' };
  }
}

/** Octets signés d'Apps Script → hexadécimal (empreintes). */
function hexDe_(octets) {
  return (octets || []).map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length < 2 ? '0' + v : v; }).join('');
}

/* ====================== L'ÉQUIPE PAR JOUR (v102) ======================
   Simon, 8 novembre 2026 : « pour le moment, mets toutes les prestations en
   binôme Victor + Maxime, sauf le lundi uniquement Victor et uniquement
   Maxime le samedi ». La règle vit dans REGLAGES (equipe_par_jour), pour se
   changer sans toucher au code :
     LUNDI=VICTOR;SAMEDI=MAXIME;AUTRES=MAXIME, VICTOR
   Elle s'applique aux passages que la nuit pose, et une fois pour toutes
   (equipeParJour_) aux interventions à venir déjà posées. Une intervention
   confiée à quelqu'un d'autre (SIMON LG…) n'est jamais touchée : la règle ne
   remplace que ses propres noms. Vide : plus de règle, la série décide. */
function regleEquipe_(reg) {
  var s = String((reg && reg.equipe_par_jour) || '').trim();
  if (!s) return null;
  var r = { jours: {}, autres: '', noms: {} };
  s.split(/\s*;\s*/).forEach(function (p) {
    var m = p.match(/^([^=]+)=(.*)$/);
    if (!m) return;
    var qui = nomsQui_(m[2]).join(', ');
    nomsQui_(m[2]).forEach(function (n) { r.noms[normNom_(n)] = true; });
    var k = normNom_(m[1]);
    if (/^autre/.test(k) || k === '*') r.autres = qui;
    else { var j = jourSemaineNum_(m[1]); if (j >= 0) r.jours[j] = qui; }
  });
  return r;
}
/** L'équipe que la règle donne à cette date, ou '' si la règle ne dit rien. */
function equipeDuJour_(r, d) {
  if (!r || !d) return '';
  var j = new Date(d).getDay();
  return r.jours.hasOwnProperty(j) ? r.jours[j] : r.autres;
}
/** La règle peut-elle remplacer ces noms-là ? Vide, ou seulement les siens. */
function equipeRemplacable_(r, qui) {
  var l = nomsQui_(qui);
  return !l.length || l.every(function (n) { return r.noms[normNom_(n)]; });
}

/** Applique la règle aux séries et aux interventions à venir déjà posées. */
function equipeParJour_(reg) {
  var r = regleEquipe_(reg || lireReglages_());
  var b = { series: 0, interventions: 0 };
  if (!r) return b;
  var ss = SpreadsheetApp.getActive(), auj = minuit_(new Date());
  var shR = ss.getSheetByName(SH.RECURRENTS);
  if (shR && shR.getLastRow() > 1) {
    var vR = shR.getRange(1, 1, shR.getLastRow(), shR.getLastColumn()).getValues();
    var eR = vR[0].map(function (x) { return String(x).trim(); });
    var cJ = eR.indexOf('JOUR'), cP = eR.indexOf('PRESTATAIRE'), cF = eR.indexOf('FREQUENCE');
    for (var i = 1; i < vR.length; i++) {
      if (!String(vR[i][0] || '').trim() || !equipeRemplacable_(r, vR[i][cP])) continue;
      var j = jourSemaineNum_(vR[i][cJ]);
      var mensuelSansJour = String(vR[i][cF] || '').toUpperCase().trim() === 'MENSUEL' && j < 0;
      var qui = mensuelSansJour || j < 0 ? r.autres : (r.jours.hasOwnProperty(j) ? r.jours[j] : r.autres);
      if (qui && qui !== String(vR[i][cP] || '').trim()) { shR.getRange(i + 1, cP + 1).setValue(qui); b.series++; }
    }
  }
  var sh = ss.getSheetByName(SH.CHANTIERS);
  if (sh && sh.getLastRow() > 1) {
    var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    var e = v[0].map(function (x) { return String(x).trim(); });
    var cD = e.indexOf('DATE'), cQ = e.indexOf('PRESTATAIRE'), cS = e.indexOf('STATUT'),
        cA = e.indexOf('ARRIVEE'), cRc = e.indexOf('RECURRENT');
    for (var k = 1; k < v.length; k++) {
      var st = String(v[k][cS] || '').toUpperCase().trim();
      if (st === 'FAIT' || st === 'EN COURS' || st === 'ANNULE') continue;
      if (cA >= 0 && String(v[k][cA] || '').trim()) continue;
      var d = v[k][cD] ? new Date(v[k][cD]) : null;
      if (d && isNaN(d.getTime())) d = null;
      if (!d) {
        /* Sans date : seulement un passage de contrat (un férié à replacer),
           dont la clé dit le jour d'origine. */
        var cle = cRc >= 0 ? String(v[k][cRc] || '') : '';
        d = cle.indexOf('|') > 0 ? dateIso_(cle.split('|')[1]) : null;
        if (!d) continue;
      } else if (minuit_(d) < auj) continue;
      if (!equipeRemplacable_(r, v[k][cQ])) continue;
      var q = equipeDuJour_(r, d);
      if (!q || q === String(v[k][cQ] || '').trim()) continue;
      sh.getRange(k + 1, cQ + 1).setValue(q);
      if (v[k][cD] && st === 'A PLANIFIER') sh.getRange(k + 1, cS + 1).setValue('PLANIFIE');
      b.interventions++;
    }
  }
  tracerServeur_('SYSTEME', 'EQUIPE PAR JOUR', b.series + ' contrat(s), ' + b.interventions + ' intervention(s)', '', '');
  return b;
}

/* ====================== « À FAIRE » : REPARTIR DE ZÉRO (v102) ======================
   Simon, 8 novembre 2026 : « clear toutes les choses à faire, on part de 0 à
   partir de maintenant ». Rien n'est effacé du classeur : on note ce qui est
   en attente à cet instant (tous les devis, les interventions passées ou sans
   date), et « À faire » ne le montre plus. Ce qui arrive ensuite s'affiche
   normalement. Les passages tombés un férié, eux, restent : ils sont à
   replacer. Les interventions à venir sans personne restent aussi : il faut
   bien que quelqu'un y aille. */
function remiseAFaire_(com, d) {
  /* v106 — l'appli envoie la clé de chaque élément affiché dans « À faire »
     (« ferie:CH-0251|2026-11-11 », « contrat:DEV-… »…) : on les garde
     toutes de côté, et seuls les éléments apparus ensuite s'affichent. (La
     v102 ne mettait de côté que des devis et des interventions passées : les
     contrats, fériés, congés et échéances restaient.) */
  var cles = [];
  ((d && d.cles) || []).forEach(function (k) {
    k = String(k || '').slice(0, 90);
    if (k && cles.indexOf(k) < 0) cles.push(k);
  });
  /* Une appli restée sur une version d'avant la v106 (onglet ou téléphone pas
     encore rechargé) n'envoie pas de clés : on met alors de côté tous les
     devis et toutes les interventions existants, que ces versions savent
     filtrer. Sans cela, sa remise à zéro ne retirait rien. */
  var tousD = [], tousC = [];
  if (!d || !Array.isArray(d.cles)) {
    tousD = lireDevis_().map(function (x) { return String(x.NUMERO || '').trim(); }).filter(String);
    objetsDe_(SH.CHANTIERS).forEach(function (o) { var id = String(o.ID || '').trim(); if (id) tousC.push(id); });
  }
  var s = { quand: new Date().getTime(), devis: tousD, chantiers: tousC, cles: cles };
  ecrireGrandeProp_('AFAIRE_IGNORES', JSON.stringify(s));
  tracerServeur_(com ? com.nom : 'SYSTEME', 'A FAIRE REMIS A ZERO', cles.length + ' élément(s) mis de côté', '', '');
  return { ok: true, cles: cles, quand: s.quand };
}
function ignoresAFaire_() {
  try { return JSON.parse(lireGrandeProp_('AFAIRE_IGNORES') || 'null'); }
  catch (e) { return null; }
}
/* Une propriété du script ne tient que 9 ko : au-delà, on découpe. */
function ecrireGrandeProp_(nom, texte) {
  var p = PropertiesService.getScriptProperties();
  var n = Number(p.getProperty(nom + '_N') || 0);
  for (var i = 0; i < n; i++) p.deleteProperty(nom + '_' + i);
  p.deleteProperty(nom + '_N');
  if (texte.length <= 8000) { p.setProperty(nom, texte); return; }
  var parts = Math.ceil(texte.length / 8000);
  for (var j = 0; j < parts; j++) p.setProperty(nom + '_' + j, texte.slice(j * 8000, (j + 1) * 8000));
  p.setProperty(nom + '_N', String(parts));
  p.deleteProperty(nom);
}
function lireGrandeProp_(nom) {
  var p = PropertiesService.getScriptProperties();
  var n = Number(p.getProperty(nom + '_N') || 0);
  if (!n) return p.getProperty(nom);
  var t = '';
  for (var i = 0; i < n; i++) t += p.getProperty(nom + '_' + i) || '';
  return t;
}

/* La mise en place du 8 novembre au soir, lancée une fois depuis l'éditeur :
   la règle d'équipe, les fériés retirés du calendrier, puis « À faire » à zéro. */
function miseEnPlaceV102() {
  var reg = lireReglages_();
  if (!String(reg.equipe_par_jour || '').trim()) {
    ecrireReglage_('equipe_par_jour', 'LUNDI=VICTOR;SAMEDI=MAXIME;AUTRES=MAXIME, VICTOR');
    reg = lireReglages_();
  }
  var e = equipeParJour_(reg);
  var g = genererRecurrents_();
  var z = remiseAFaire_(null);
  Logger.log('Équipe : ' + e.series + ' contrat(s), ' + e.interventions + ' intervention(s). ' +
             'Planning : ' + g.poses + ' posé(s), ' + (g.ferieRetires || 0) + ' férié(s) retiré(s). ' +
             'À faire : ' + z.cles.length + ' élément(s) mis de côté.');
  return { equipe: e, planning: g, remise: z };
}

/** La durée d'engagement d'un devis reçu de l'appli, en mois ('' = sans). */
function engagementMois_(devis) {
  var e = devis && devis.engagement;
  var n = Math.round(Number(e && e.mois) || 0);
  return n > 0 && n <= 60 ? n : '';
}
function reconductionDevis_(devis) {
  var e = devis && devis.engagement;
  if (!e || !(Number(e.mois) > 0)) return '';
  return e.tacite === false ? 'NON' : 'TACITE';
}
/** La fin d'un contrat signé : signature + durée − 1 jour, ou '' sans engagement. */
function finEngagement_(devis) {
  var m = Math.round(Number(devis && devis.ENGAGEMENT_MOIS) || 0);
  if (m < 1) return '';
  var s = devis.DATE_STATUT instanceof Date ? new Date(devis.DATE_STATUT) : new Date();
  s.setMonth(s.getMonth() + m); s.setDate(s.getDate() - 1); s.setHours(12, 0, 0, 0);
  return s;
}


/* ====================== v103 ====================== */

/* La signature des mails aux clients. Simon, 8 novembre 2026 : « sur Gmail il
   y a ça de pré-écrit (CORDIALEMENT, Simon - BREIZH BRILLANCE et le bandeau),
   donc ne pas écrire deux fois, arrête-toi à Belle journée ». Un mail parti
   du script ne reçoit pas la signature de Gmail : c'est donc le script qui la
   pose, une seule fois, et retire celle qu'un texte ancien porterait encore. */
function signatureMail_(reg) {
  var s = String((reg && reg.signature_mail) || '').trim() || 'CORDIALEMENT,\n\nSimon - BREIZH BRILLANCE';
  return s;
}
function sansSignature_(texte) {
  var t = String(texte || '').replace(/\r/g, '').replace(/\s+$/, '');
  /* « Cordialement, <prénom> - BREIZH BRILLANCE » (ou seul) en fin de texte. */
  t = t.replace(/\n*\s*cordialement\s*,?\s*(\n+\s*[^\n]{0,60}breizh\s*brillance\s*)?$/i, '');
  t = t.replace(/\n*\s*[^\n]{0,40}-\s*breizh\s*brillance\s*$/i, '');
  return t.replace(/\s+$/, '');
}
function signatureHtml_(reg) {
  return '<p style="margin:18px 0 0">' + echHtml_(signatureMail_(reg)).replace(/\n\n/g, '</p><p style="margin:14px 0 0">')
    .replace(/\n/g, '<br>') + '</p>';
}

/* Le nom imprimé sur les devis et les factures. Simon : « au nom de Simon, pas
   Titema ». REGLAGES noms_documents : « TITEMA=Simon ; AUTRE=Nom ». Le compte
   garde son nom (numérotation, commissions) ; seul l'affichage change. */
function nomDocument_(nom, reg) {
  var n = String(nom || '').trim();
  var s = String((reg && reg.noms_documents) || '').trim();
  if (!n || !s) return n;
  var r = n;
  s.split(/\s*;\s*/).forEach(function (p) {
    var m = p.match(/^([^=]+)=(.+)$/);
    if (m && normNom_(m[1]) === normNom_(n)) r = m[2].trim();
  });
  return r;
}

/* ====================== LES CONTRATS À ÉCHÉANCE ======================
   Simon : « les contrats ayant une échéance, il faut les placer sur la durée à
   partir de la signature, et après tu me suggères quoi pour valider le
   renouvellement ». Le devis porte la durée d'engagement (ENGAGEMENT_MOIS) et
   la reconduction (TACITE / NON). À la signature, la série reçoit sa FIN
   (signature + durée) : la nuit pose les passages, deux mois devant, jusqu'à
   l'échéance, et pas au-delà.
   Le renouvellement :
   — 45 jours avant, « À faire » l'annonce ; un bouton « Renouveler » prolonge
     d'une durée (recurrentRenouveler) ;
   — reconduction TACITE : sans geste du gérant, 30 jours avant l'échéance la
     série est prolongée d'elle-même de la même durée, le journal et une
     notification le disent. Rien ne s'arrête par oubli. */
function reconduireContrats_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.RECURRENTS);
  if (!sh || sh.getLastRow() < 2) return 0;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var cF = en.indexOf('FIN'), cR = en.indexOf('RECONDUCTION'), cM = en.indexOf('ENGAGEMENT_MOIS'),
      cA = en.indexOf('ACTIF'), cC = en.indexOf('CLIENT');
  if (cF < 0 || cR < 0 || cM < 0) return 0;
  var auj = minuit_(new Date()), n = 0;
  for (var i = 1; i < v.length; i++) {
    if (!String(v[i][0] || '').trim() || !estActif_(v[i][cA])) continue;
    if (String(v[i][cR] || '').toUpperCase().trim() !== 'TACITE') continue;
    var mois = Math.round(Number(v[i][cM]) || 0);
    if (mois < 1 || !v[i][cF]) continue;
    var fin = minuit_(v[i][cF]);
    if (isNaN(fin.getTime())) continue;
    /* v108m — « je veux arrêter le contrat et il revient » : une FIN posée
       avant la fin de la première période d'engagement est un arrêt ou une
       modification, pas une échéance. On ne la reconduit pas. */
    var cD = en.indexOf('DEBUT');
    if (cD >= 0 && v[i][cD]) {
      var deb = minuit_(v[i][cD]);
      if (!isNaN(deb.getTime())) {
        var ech1 = new Date(deb); ech1.setMonth(ech1.getMonth() + mois); ech1.setDate(ech1.getDate() - 4);
        if (fin < ech1) continue;
      }
    }
    var jours = Math.round((fin - auj) / 86400000);
    if (jours > 30 || jours < -60) continue;
    var nf = new Date(fin); nf.setMonth(nf.getMonth() + mois); nf.setHours(12, 0, 0, 0);
    sh.getRange(i + 1, cF + 1).setValue(nf);
    n++;
    tracerServeur_('SYSTEME', 'CONTRAT RECONDUIT', String(v[i][0]) + ' · ' + String(v[i][cC] || '') +
                   ' · jusqu\'au ' + isoJour_(nf), '', '');
    try {
      lireAdmins_().forEach(function (a) {
        notifier_(a.nom, 'Contrat reconduit', String(v[i][cC] || '') + ' · jusqu\'au ' +
                  Utilities.formatDate(nf, 'Europe/Paris', 'dd/MM/yyyy'), '');
      });
    } catch (eN) {}
  }
  return n;
}

function recurrentRenouveler_(d, com) {
  var id = String(d.id || '').trim();
  var L = ligneSerie_(id);
  if (!L) return { ok: false, erreur: 'contrat introuvable' };
  var mois = Math.round(Number(d.mois) || Number(L.o.ENGAGEMENT_MOIS) || 12);
  if (mois < 1 || mois > 60) return { ok: false, erreur: 'durée illisible' };
  var auj = minuit_(new Date());
  var fin = L.o.FIN ? minuit_(L.o.FIN) : null;
  var base = (fin && !isNaN(fin.getTime()) && fin > auj) ? fin : auj;
  var nf = new Date(base); nf.setMonth(nf.getMonth() + mois); nf.setHours(12, 0, 0, 0);
  ecrireCase_(L, 'FIN', nf);
  ecrireCase_(L, 'ACTIF', 'OUI');
  if (!Number(L.o.ENGAGEMENT_MOIS)) ecrireCase_(L, 'ENGAGEMENT_MOIS', mois);
  var b = genererRecurrents_();
  tracerServeur_(com ? com.nom : '', 'CONTRAT RENOUVELE', id + ' · ' + String(L.o.CLIENT || '') + ' · ' + mois +
                 ' mois · jusqu\'au ' + isoJour_(nf), '', d.appareil || '');
  return { ok: true, fin: isoJour_(nf), poses: b.poses || 0 };
}

/* ====================== LES CLIENTS DES CONTRATS DANS PENNYLANE ======================
   « Les clients récurrents sont-ils déjà prêts sur Pennylane ? » La même
   recherche que pour un brouillon (identifiant, SIREN, nom exact, nom sans
   accents), sans rien créer. Avec creer=true, crée ceux qui manquent et note
   leur identifiant dans CONTRATS. */
function clientsContratsPennylane_(creer) {
  if (!pennylaneJeton_()) return { ok: false, erreur: 'Pennylane n\'est pas connecté' };
  var sh = SpreadsheetApp.getActive().getSheetByName('CONTRATS');
  if (!sh || sh.getLastRow() < 2) return { ok: false, erreur: 'onglet CONTRATS vide' };
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var c = function (h) { return en.indexOf(h); };
  var vus = {}, out = { ok: true, trouves: [], crees: [], manquants: [], erreurs: [] };
  for (var i = 1; i < v.length; i++) {
    var contrat = String(v[i][c('CONTRAT')] || '').trim();
    if (!contrat || vus[contrat]) continue;
    if (c('ACTIF') >= 0 && /^N/i.test(String(v[i][c('ACTIF')] || ''))) continue;
    vus[contrat] = true;
    var nom = String(v[i][c('CLIENT_FACTURE')] || '').trim() || contrat;
    var cli = { nom: nom, siren: v[i][c('SIREN')], email: v[i][c('EMAIL')], adresse: v[i][c('ADRESSE')],
                cp: v[i][c('CP')], ville: v[i][c('VILLE')], particulier: /^O/i.test(String(v[i][c('PARTICULIER')] || '')),
                idConnu: c('ID_PENNYLANE') >= 0 ? v[i][c('ID_PENNYLANE')] : '' };
    try {
      if (cli.idConnu) { out.trouves.push(nom); continue; }
      if (!creer) {
        /* Recherche seule : pennylaneClient_ créerait ; on l'appelle sans adresse
           pour qu'il s'arrête avant la création. */
        var essai = {}; for (var k in cli) essai[k] = cli[k];
        essai.adresse = ''; essai.cp = ''; essai.ville = '';
        try { pennylaneClient_(essai); out.trouves.push(nom); }
        catch (eR) {
          if (/adresse de facturation/.test(String(eR.message))) out.manquants.push(nom + (cli.adresse && cli.cp && cli.ville ? '' : ' (adresse incomplète dans CONTRATS)'));
          else throw eR;
        }
        continue;
      }
      var r = pennylaneClient_(cli);
      (r.neuf ? out.crees : out.trouves).push(nom);
      if (c('ID_PENNYLANE') >= 0) {
        for (var j = 1; j < v.length; j++) {
          if (String(v[j][c('CONTRAT')] || '').trim() === contrat) sh.getRange(j + 1, c('ID_PENNYLANE') + 1).setValue(r.id);
        }
      }
    } catch (e) { out.erreurs.push(nom + ' : ' + String(e && e.message || e).slice(0, 120)); }
  }
  return out;
}
function verifierClientsPennylane() {
  var r = clientsContratsPennylane_(false);
  Logger.log(JSON.stringify(r));
  return r;
}

/* La mise en place du 8 novembre au soir (v103), lancée une fois depuis l'éditeur. */
function miseEnPlaceV103() {
  var reg = lireReglages_();
  if (!String(reg.signature_mail || '').trim()) ecrireReglage_('signature_mail', 'CORDIALEMENT,\n\nSimon - BREIZH BRILLANCE');
  if (!String(reg.noms_documents || '').trim()) ecrireReglage_('noms_documents', 'TITEMA=Simon');
  if (!String(reg.commissions || '').trim()) ecrireReglage_('commissions', COMMISSIONS_DEFAUT_);
  ['ENGAGEMENT_MOIS', 'RECONDUCTION'].forEach(function (h) {
    colonneAssuree_(SH.DEVIS, h); colonneAssuree_(SH.RECURRENTS, h);
  });
  var p = clientsContratsPennylane_(false);
  Logger.log('Pennylane : ' + JSON.stringify(p));
  return p;
}

/* Les taux de commission, provisoires (Simon enverra le détail). Lus par l'appli
   des commerciaux. Contrat : % de la première année (mensuel × 12), puis un
   taux de renouvellement sur les 3 premières reconductions. Ponctuel : % du HT. */
var COMMISSIONS_DEFAUT_ = 'CONTRAT_PART=5;CONTRAT_PRO=6;RENOUV_PART=2;RENOUV_PRO=3;RENOUV_MAX=3;' +
  'VITRERIE_PART=6;VITRERIE_PRO=7;CHANTIER=8;REMISE=8;FACADE=8;BASE_CONTRAT_MOIS=12';

/* ====================== LES COMMISSIONS (v107) ======================
   Simon, 9 novembre 2026 : « il faut que les commerciaux voient leur propre
   chiffre et le chiffre généré au total […] il faudra aussi qu'ils puissent
   voir leur commission brute mensuelle selon les contrats qu'ils ont
   rapportés ; commissions calculées automatiquement selon tes taux ».
   Le calcul se fait ici, seul endroit qui voit tous les devis (le total de la
   société) et les contrats (les reconductions) :
   — un devis signé compte le mois de sa signature (DATE_STATUT, à défaut la
     date du devis). Contrat : % de la 1re année (mensuel × 12) ; ponctuel :
     % du HT. Les essais au nom de la société ne comptent pas ;
   — une reconduction compte le mois de l'anniversaire du contrat (DÉBUT +
     k × durée d'engagement), si le contrat court au-delà (FIN), pour les
     RENOUV_MAX premières seulement, au taux de renouvellement ;
   — le commercial reçoit ses lignes et le total de la société (jamais le
     détail des autres) ; le gérant reçoit aussi le relevé par commercial.
   Prévu pour deux sociétés : la réponse porte le nom de la société, l'appli
   additionnera celle de Breizh Brillance Services quand elle existera. */
function tauxCommissions_() {
  var s = String(lireReglages_().commissions || COMMISSIONS_DEFAUT_);
  var t = {};
  s.split(/\s*;\s*/).forEach(function (p) {
    var m = p.match(/^([A-Z_]+)\s*=\s*([\d.,]+)$/i);
    if (m) t[m[1].toUpperCase()] = Number(m[2].replace(',', '.'));
  });
  return t;
}
function commissionLigne_(o, t) {
  var nat = natureDevis_(o.NATURE), part = /^PART/i.test(String(o.TYPE_CLIENT || ''));
  var mensuel = Number(o.TOTAL_HT_MENSUEL) || 0;
  if (recurrentDevis_(o.NATURE, o.PASSAGES_MOIS, o.SANS_CONTRAT) && mensuel > 0) {
    var base = Math.round(mensuel * (t.BASE_CONTRAT_MOIS || 12) * 100) / 100;
    var taux = (part ? t.CONTRAT_PART : t.CONTRAT_PRO) || 0;
    return { contrat: true, part: part, nature: nat, base: base, taux: taux,
             com: Math.round(base * taux) / 100, tauxR: (part ? t.RENOUV_PART : t.RENOUV_PRO) || 0, mensuel: mensuel };
  }
  var tx = nat === 'VITRERIE' ? ((part ? t.VITRERIE_PART : t.VITRERIE_PRO) || 0) : (t[nat] || t.REMISE || 0);
  var b = Number(o.TOTAL_HT) || 0;
  return { contrat: false, part: part, nature: nat, base: b, taux: tx, com: Math.round(b * tx) / 100 };
}
function commissions_(d, com) {
  var t = tauxCommissions_();
  var admin = String(com.role || '') === 'ADMIN';
  var moi = normNom_(com.nom);
  var auj = new Date();
  var nbMois = Math.min(Math.max(Number(d.mois) || 12, 1), 36);
  var cles = [];
  for (var k = 0; k < nbMois; k++) {
    var x = new Date(auj.getFullYear(), auj.getMonth() - k, 1, 12);
    cles.push(Utilities.formatDate(x, 'Europe/Paris', 'yyyy-MM'));
  }
  var an = Utilities.formatDate(auj, 'Europe/Paris', 'yyyy');
  var debut = cles[cles.length - 1] < an + '-01' ? cles[cles.length - 1] : an + '-01';
  var moisDe = function (v) {
    var dt = v instanceof Date ? v : (v ? new Date(v) : null);
    return dt && !isNaN(dt.getTime()) ? Utilities.formatDate(dt, 'Europe/Paris', 'yyyy-MM') : '';
  };
  var admins = {};
  try { lireAdmins_().forEach(function (a) { admins[normNom_(a.nom)] = true; }); } catch (eA) {}

  var societe = {}, lignes = [], parDevis = {};
  var ajouter = function (o, l) {
    var c = String(o.COMMERCIAL || '').trim();
    l.commercial = c;
    if (admin || normNom_(c) === moi) lignes.push(l);
  };
  objetsDe_(SH.DEVIS).forEach(function (o) {
    var num = String(o.NUMERO || '').trim();
    if (!num || String(o.STATUT || '').toUpperCase().trim() !== 'SIGNE' || devisEssai_(o)) return;
    parDevis[num] = o;
    var m = moisDe(o.DATE_STATUT) || moisDe(o.DATE);
    if (!m || m < debut) return;
    var c = commissionLigne_(o, t);
    var s = societe[m] || (societe[m] = { ca: 0, n: 0 });
    s.ca = Math.round((s.ca + c.base) * 100) / 100; s.n++;
    if (devisHistorique_(o)) { delete parDevis[num]; return; }   // v108p : aucun commercial n'est commissionné sur un contrat repris
    ajouter(o, { mois: m, type: 'signature', numero: num, client: String(o.CLIENT || ''), nature: c.nature,
                 part: c.part, contrat: c.contrat, mensuel: c.mensuel || 0, base: c.base, taux: c.taux, com: c.com });
  });

  /* Les reconductions des contrats issus d'un devis. */
  var max = Math.round(t.RENOUV_MAX || 0);
  if (max > 0) objetsDe_(SH.RECURRENTS).forEach(function (r) {
    var o = parDevis[String(r.DEVIS || '').trim()];
    if (!o || !r.DEBUT) return;
    var c = commissionLigne_(o, t);
    if (!c.contrat || !c.tauxR) return;
    var deb = new Date(r.DEBUT), fin = r.FIN ? new Date(r.FIN) : null;
    if (isNaN(deb.getTime())) return;
    var duree = Math.round(Number(r.ENGAGEMENT_MOIS) || Number(o.ENGAGEMENT_MOIS) || 12);
    for (var k = 1; k <= max; k++) {
      var anniv = new Date(deb.getFullYear(), deb.getMonth() + k * duree, deb.getDate(), 12);
      if (anniv > auj) break;
      if (!fin || isNaN(fin.getTime()) || fin < minuit_(anniv)) break;
      var m = moisDe(anniv);
      if (m < debut) continue;
      ajouter(o, { mois: m, type: 'reconduction', rang: k, numero: String(o.NUMERO || '').trim(),
                   client: String(r.CLIENT || o.CLIENT || ''), nature: c.nature, part: c.part, contrat: true,
                   mensuel: c.mensuel, base: c.base, taux: c.tauxR, com: Math.round(c.base * c.tauxR) / 100 });
    }
  });

  lignes.sort(function (a, b) { return a.mois < b.mois ? 1 : (a.mois > b.mois ? -1 : 0); });
  var resume = function (liste) {
    var r = {};
    liste.forEach(function (l) {
      var x = r[l.mois] || (r[l.mois] = { ca: 0, com: 0, n: 0 });
      if (l.type === 'signature') { x.ca = Math.round((x.ca + l.base) * 100) / 100; x.n++; }
      x.com = Math.round((x.com + l.com) * 100) / 100;
    });
    return r;
  };
  var miennes = lignes.filter(function (l) { return normNom_(l.commercial) === moi; });
  var out = { ok: true, societe: String(lireReglages_().societe_nom || 'BREIZH BRILLANCE'), mois: cles, an: an,
              moi: resume(miennes), total: societe, lignes: miennes, taux: t, maj: Date.now() };
  if (admin) {
    var par = {};
    lignes.forEach(function (l) {
      var n = l.commercial || '(sans commercial)';
      if (admins[normNom_(n)]) return;           // le gérant ne se commissionne pas
      (par[n] || (par[n] = [])).push(l);
    });
    out.commerciaux = Object.keys(par).sort().map(function (n) { return { nom: n, mois: resume(par[n]), lignes: par[n] }; });
  }
  return out;
}


/* ====================== LES CHIFFRES DE LA SOCIÉTÉ (v108p) ======================
   Simon, 11 novembre 2026 : « dans chiffres de la société, quand on clique
   dessus, affiche un menu où on voit les statistiques importantes : le
   rendement de tous les contrats récurrents, une courbe avec le CA évolutif,
   un max de données liées aux chiffres de la société — là c'est trop peu,
   surtout qu'il en manque plein depuis janvier car l'application est récente ».

   Trois sources, de la plus sûre à la plus partielle :
   — CONTRATS + RECURRENTS : ce que chaque contrat rapporte par mois (facturé
     lissé sur 52 semaines), depuis quand, jusqu'à quand, et le temps passé
     sur place (passages × durée × nombre d'intervenants) ;
   — les factures : l'onglet HISTO_FACTURES (export complet de Henrri, quand il
     est rempli), les factures Pennylane de l'appli (FACTURES) et, à défaut, les
     factures Henrri connues par MODELES_FACTURE (la dernière de chaque modèle) ;
   — les devis de l'appli (taux de signature, panier, commerciaux, origine).
   Un mois dont l'export complet des factures est connu est « facturé » ; les
   autres sont « estimés » : contrats actifs ce mois-là + ponctuels facturés
   connus. La fiche le dit, mois par mois. */
var SH_HISTO_FACT_ = 'HISTO_FACTURES';
var ENTETES_HISTO_FACT_ = ['DATE', 'NUMERO', 'CLIENT', 'TOTAL_HT', 'TOTAL_TTC', 'TYPE', 'SOURCE'];

function moisPlus_(m, k) {
  var a = Number(m.slice(0, 4)), b = Number(m.slice(5, 7)) - 1 + k;
  a += Math.floor(b / 12); b = ((b % 12) + 12) % 12;
  return a + '-' + ('0' + (b + 1)).slice(-2);
}
function arr2_(x) { return Math.round((Number(x) || 0) * 100) / 100; }

/* Passages par mois d'une série. */
function passagesMoisSerie_(r) {
  var f = String(r.FREQUENCE || '').toUpperCase().trim();
  var iv = Math.max(1, Math.round(Number(r.INTERVALLE) || 1));
  if (f === 'HEBDO') return 52 / 12 / iv;
  if (f === 'QUINZAINE') return 26 / 12;
  if (f === 'MENSUEL') return 1 / iv;
  if (f === 'JOURS') return 52 / 12 * 5;
  return 0;
}

/* Les contrats tels que la société les vit : une entrée par nom de CONTRAT,
   avec ses séries (référencées dans SERIES, ou du même client). */
function contratsVivants_() {
  var auj = isoJour_(new Date());
  var series = {}, toutes = [];
  objetsDe_(SH.RECURRENTS).forEach(function (r) {
    var id = String(r.ID || '').trim();
    if (!id) return;
    var s = { id: id, client: String(r.CLIENT || ''), debut: jourDe_(r.DEBUT), fin: jourDe_(r.FIN),
              actifCol: estActif_(r.ACTIF), freq: String(r.FREQUENCE || '').toUpperCase().trim(),
              duree: Math.round(Number(r.DUREE_MIN) || 60), qui: nomsQui_(r.PRESTATAIRE),
              pm: passagesMoisSerie_(r), nature: natureDevis_(r.NATURE),
              tacite: /^TACITE/i.test(String(r.RECONDUCTION || '').trim()),
              engagement: Math.round(Number(r.ENGAGEMENT_MOIS) || 0) };
    s.vivante = s.actifCol && (!s.fin || s.fin >= auj);
    series[id] = s; toutes.push(s);
  });
  var par = {}, ordre = [];
  lireContrats_().forEach(function (o) {
    if (!estActif_(o.ACTIF)) return;
    var nom = String(o.CONTRAT || '').trim();
    var c = par[nom];
    if (!c) {
      c = par[nom] = { nom: nom, client: '', mensuel: 0, lignes: [], ids: {}, part: false, tva: 20,
                       siren: '', email: '', adresse: '', cp: '', ville: '', brut: [] };
      ordre.push(nom);
    }
    c.mensuel += num_(o.MENSUEL_HT);
    c.lignes.push(String(o.LIGNE || '').trim());
    c.brut.push({ MENSUEL_HT: num_(o.MENSUEL_HT), MONTANTS_MOIS: String(o.MONTANTS_MOIS || '') });
    if (!c.client && String(o.CLIENT_FACTURE || '').trim()) c.client = String(o.CLIENT_FACTURE).trim();
    if (/^O/i.test(String(o.PARTICULIER || '').trim())) c.part = true;
    if (num_(o.TVA)) c.tva = num_(o.TVA);
    ['SIREN', 'EMAIL', 'ADRESSE', 'CP', 'VILLE'].forEach(function (k) {
      var kk = k.toLowerCase();
      if (!c[kk] && String(o[k] || '').trim()) c[kk] = String(o[k]).trim();
    });
    String(o.SERIES || '').split(/[\s,;]+/).forEach(function (id) { if (id && series[id]) c.ids[id] = true; });
  });
  return ordre.map(function (nom) {
    var c = par[nom], cle = normNom_(nom);
    /* Les séries du même client que SERIES ne cite pas (une série refaite
       garde le nom du client, pas toujours sa place dans CONTRATS). */
    toutes.forEach(function (s) {
      if (c.ids[s.id] || !s.vivante) return;
      var n = normNom_(s.client);
      if (n === cle || n.indexOf(cle + ' ') === 0 || n.indexOf(cle + ' —') === 0) c.ids[s.id] = true;
    });
    var ss = Object.keys(c.ids).map(function (id) { return series[id]; });
    var vivantes = ss.filter(function (s) { return s.vivante; });
    var debut = '', fin = '', ouvert = false, tacite = false, eng = 0, vitre = ss.length > 0;
    ss.forEach(function (s) {
      if (s.debut && (!debut || s.debut < debut)) debut = s.debut;
      if (s.tacite) tacite = true;
      if (s.engagement) eng = Math.max(eng, s.engagement);
      if (s.nature !== 'VITRERIE') vitre = false;
    });
    (vivantes.length ? vivantes : ss).forEach(function (s) {
      if (!s.fin) ouvert = true; else if (!fin || s.fin > fin) fin = s.fin;
    });
    if (ouvert) fin = '';
    var pm = 0, heures = 0, maxQui = 1;
    /* Une série qui n'a pas commencé ne compte pas encore dans le temps passé
       (sauf si tout le contrat démarre plus tard). */
    var lancees = vivantes.filter(function (s) { return !s.debut || s.debut <= auj; });
    (lancees.length ? lancees : vivantes).forEach(function (s) {
      var n = Math.max(1, s.qui.length);
      maxQui = Math.max(maxQui, n);
      pm += s.pm;
      heures += s.pm * s.duree / 60 * n;
    });
    var mensuel = arr2_(c.mensuel);
    return {
      nom: nom, client: c.client || nom, mensuel: mensuel, lignes: c.lignes, part: c.part, tva: c.tva,
      siren: c.siren, email: c.email, adresse: c.adresse, cp: c.cp, ville: c.ville,
      series: ss.map(function (s) { return s.id; }), debut: debut, fin: fin, tacite: tacite, engagement: eng || 12,
      actif: vivantes.length > 0 || (!ss.length && mensuel > 0),
      demarre: !!(debut && debut > auj),
      passagesMois: Math.round(pm * 10) / 10, heuresMois: Math.round(heures * 10) / 10,
      binome: maxQui > 1, nature: vitre ? 'VITRERIE' : 'ENTRETIEN',
      parHeure: heures > 0 ? arr2_(mensuel / heures) : 0,
      parPassage: pm > 0 ? arr2_(mensuel / pm) : 0,
      brut: c.brut
    };
  });
}

/* Premier mois facturé d'un contrat : celui du début s'il commence avant le
   16, sinon le suivant. */
function moisDebutContrat_(debut) {
  if (!debut) return '';
  var m = debut.slice(0, 7);
  return Number(debut.slice(8, 10)) > 15 ? moisPlus_(m, 1) : m;
}
/* Ce que rapporte un contrat un mois donné (mois partiel compris). */
function montantContratMois_(c, m) {
  if (!c.brut || !c.brut.length) return c.mensuel;
  return arr2_(c.brut.reduce(function (s, l) { return s + montantLigneMois_(l, m); }, 0));
}
function contratCourtEn_(c, m) {
  var d = moisDebutContrat_(c.debut);
  if (!d || m < d) return false;
  if (c.fin && m > c.fin.slice(0, 7)) return false;
  return true;
}

/* Toutes les factures connues, sans doublon (le numéro fait foi). */
function facturesConnues_() {
  var vus = {}, out = [], complets = {};
  /* Les mois d'avant le passage à Pennylane sont entiers dans l'export Henrri ;
     à partir de là, les factures de contrat partent le 3 du mois suivant : le
     mois se lit en « estimé » (contrats du mois + ponctuels facturés). */
  var avant = String(lireReglages_().histo_factures_complet_avant || '2026-11').trim().slice(0, 7);
  var pousser = function (f, complet) {
    var num = String(f.numero || '').trim().replace(/^[^0-9]+/, '');
    var k = num ? 'N' + num : 'X' + f.date + '|' + cleClient_(f.client) + '|' + f.ht;
    if (!f.date || vus[k]) return;
    vus[k] = true; out.push(f);
    if (complet && f.date.slice(0, 7) < avant) complets[f.date.slice(0, 7)] = true;
  };
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(SH_HISTO_FACT_)) objetsDe_(SH_HISTO_FACT_).forEach(function (o) {
    var ht = num_(o.TOTAL_HT);
    if (!ht) return;
    pousser({ date: jourDe_(o.DATE), numero: String(o.NUMERO || ''), client: String(o.CLIENT || ''), ht: ht,
              type: String(o.TYPE || ''), source: String(o.SOURCE || 'HENRRI') }, true);
  });
  objetsDe_(SH.FACTURES).forEach(function (o) {
    var etat = String(o.ETAT || '').toUpperCase();
    if (!/ENVOYEE|FINALISEE|DEFINITIVE/.test(etat)) return;      // un brouillon n'est pas une facture
    pousser({ date: jourDe_(o.CREE_LE), numero: String(o.NUMERO_FACTURE || ''), client: String(o.CLIENT || ''),
              ht: num_(o.TOTAL_HT), type: String(o.TYPE || ''), source: 'PENNYLANE' }, false);
  });
  if (ss.getSheetByName(SH_MODELES_)) {
    var parSrc = {};
    objetsDe_(SH_MODELES_).forEach(function (o) {
      var src = String(o.SOURCE || '').trim();
      if (!src || parSrc[src]) return;
      parSrc[src] = true;
      pousser({ date: jourDe_(o.DATE), numero: src, client: String(o.CLIENT || ''), ht: num_(o.TOTAL_HT),
                type: '', source: 'HENRRI' }, false);
    });
  }
  return { liste: out, complets: complets };
}

function statsSociete_(d) {
  var auj = new Date(), aujIso = isoJour_(auj), moisAuj = aujIso.slice(0, 7), an = aujIso.slice(0, 4);
  var contrats = contratsVivants_();
  var actifs = contrats.filter(function (c) { return c.actif; });

  /* ---- les factures, rangées contrat / ponctuel ---- */
  var cles = [];
  contrats.forEach(function (c) { cles.push(cleClient_(c.nom)); if (c.client) cles.push(cleClient_(c.client)); });
  /* Réglage `stats_alias_clients` : « NOM FACTURÉ=CONTRAT;… » — pour un
     contrat facturé sous d'autres noms (QUAI OUEST → SCI LE TROMBONE…). Ne
     touche pas CLIENT_FACTURE, qui sert à la facturation Pennylane. */
  var alias = {};
  String(lireReglages_().stats_alias_clients || '').split(/[;\n]+/).forEach(function (p) {
    var i = p.indexOf('=');
    if (i > 0) alias[cleClient_(p.slice(0, i))] = normNom_(p.slice(i + 1));
  });
  var contratDe = function (client) {
    var k = cleClient_(client);
    if (k.trim().length < 3) return null;
    if (alias[k]) {
      for (var a = 0; a < contrats.length; a++) if (normNom_(contrats[a].nom) === alias[k]) return contrats[a];
    }
    for (var i = 0; i < contrats.length; i++) {
      var cs = [cleClient_(contrats[i].nom), cleClient_(contrats[i].client)];
      for (var j = 0; j < cs.length; j++) {
        var x = cs[j];
        if (x.trim().length >= 3 && (k.indexOf(x) >= 0 || x.indexOf(k) >= 0)) return contrats[i];
      }
    }
    return null;
  };
  var estContrat = function (client) { return !!contratDe(client); };
  var F = facturesConnues_();
  var fact = {};
  F.liste.forEach(function (f) {
    var m = f.date.slice(0, 7);
    var x = fact[m] || (fact[m] = { total: 0, contrats: 0, ponctuels: 0, n: 0 });
    var ctr = /CONTRAT/i.test(f.type) || (!/PONCT/i.test(f.type) && estContrat(f.client));
    f.contrat = ctr;
    x.total = arr2_(x.total + f.ht); x.n++;
    if (ctr) x.contrats = arr2_(x.contrats + f.ht); else x.ponctuels = arr2_(x.ponctuels + f.ht);
  });

  /* ---- 12 mois glissants + l'année en cours ---- */
  var debutSerie = moisPlus_(moisAuj, -11);
  if (an + '-01' < debutSerie) debutSerie = an + '-01';
  var mois = [];
  for (var m = debutSerie; m <= moisAuj; m = moisPlus_(m, 1)) mois.push(m);
  var courbe = mois.map(function (m) {
    var rec = 0, n = 0;
    contrats.forEach(function (c) {
      /* Un montant écrit pour ce mois-là (MONTANTS_MOIS) compte même si le
         contrat a démarré après le 15 (BBG : 1 passage en novembre). */
      var explicite = (c.brut || []).some(function (l) { return String(l.MONTANTS_MOIS || '').indexOf(m + '=') >= 0; });
      if (contratCourtEn_(c, m) || explicite) { var mm = montantContratMois_(c, m); if (mm > 0) { rec += mm; n++; } }
    });
    rec = arr2_(rec);
    var f = fact[m] || { total: 0, contrats: 0, ponctuels: 0, n: 0 };
    var complet = !!F.complets[m];
    var ca = complet ? f.total : arr2_(rec + f.ponctuels);
    return { mois: m, ca: ca, recurrent: rec, ponctuels: f.ponctuels, facture: f.total, nFactures: f.n,
             contrats: n, mode: complet ? 'facture' : 'estime', enCours: m === moisAuj };
  });
  var somme = function (l) { return arr2_(l.reduce(function (s, x) { return s + x.ca; }, 0)); };
  var annee = courbe.filter(function (x) { return x.mois.slice(0, 4) === an; });
  var clos = annee.filter(function (x) { return !x.enCours; });
  var meilleur = clos.reduce(function (b, x) { return !b || x.ca > b.ca ? x : b; }, null);
  var ceMois = courbe[courbe.length - 1], moisPrec = courbe[courbe.length - 2] || null;

  /* ---- les contrats : rendement ---- */
  var mrr = arr2_(actifs.reduce(function (s, c) { return s + c.mensuel; }, 0));
  var heures = Math.round(actifs.reduce(function (s, c) { return s + c.heuresMois; }, 0) * 10) / 10;
  var passages = Math.round(actifs.reduce(function (s, c) { return s + c.passagesMois; }, 0) * 10) / 10;
  var dans90 = new Date(auj.getTime() + 90 * 86400000), lim90 = isoJour_(dans90);
  var listeC = actifs.map(function (c) {
    var dm = moisDebutContrat_(c.debut), moisFaits = 0;
    if (dm && dm <= moisAuj) {
      for (var mm = dm; mm < moisAuj; mm = moisPlus_(mm, 1)) moisFaits++;
    }
    var restant = 0;
    if (c.fin) for (var mr = moisAuj; mr <= c.fin.slice(0, 7); mr = moisPlus_(mr, 1)) restant++;
    return {
      nom: c.nom, client: c.client, mensuel: c.mensuel, annuel: arr2_(c.mensuel * 12), part: c.part,
      nature: c.nature, lignes: c.lignes, series: c.series, debut: c.debut, fin: c.fin, tacite: c.tacite,
      demarre: c.demarre, passagesMois: c.passagesMois, heuresMois: c.heuresMois, binome: c.binome,
      parHeure: c.parHeure, parPassage: c.parPassage, moisFaits: moisFaits,
      genere: arr2_(c.mensuel * moisFaits), resteEngage: arr2_(c.mensuel * restant), moisRestants: restant,
      echeance: !!(c.fin && c.fin <= lim90),
      partCA: mrr > 0 ? Math.round(c.mensuel / mrr * 1000) / 10 : 0
    };
  }).sort(function (a, b) { return b.mensuel - a.mensuel; });
  var avecH = listeC.filter(function (c) { return c.heuresMois > 0; });
  var prevision = [];
  for (var k = 1; k <= 12; k++) {
    var mp = moisPlus_(moisAuj, k), sur = 0, tac = 0;
    actifs.forEach(function (c) {
      var dd = moisDebutContrat_(c.debut);
      if (dd && mp < dd) return;
      if (!c.fin || mp <= c.fin.slice(0, 7)) sur += c.mensuel;
      else if (c.tacite) tac += c.mensuel;
    });
    prevision.push({ mois: mp, engage: arr2_(sur), reconduit: arr2_(tac) });
  }

  /* ---- les devis de l'appli ---- */
  var t = tauxCommissions_();
  var dv = { nb: 0, signes: 0, refuses: 0, attente: 0, htPonctuelSigne: 0, nbPonctuelSigne: 0, mensuelSigne: 0,
             nbContratsSignes: 0, pipeHt: 0, pipeMensuel: 0, nbMois: 0, htMois: 0, signesMois: 0 };
  var parCom = {}, parOrig = {}, parNat = {}, parMoisSigne = {};
  objetsDe_(SH.DEVIS).forEach(function (o) {
    if (!String(o.NUMERO || '').trim() || devisEssai_(o)) return;
    var hist = devisHistorique_(o);
    var dt = jourDe_(o.DATE), st = String(o.STATUT || '').toUpperCase().trim();
    var ds = jourDe_(o.DATE_STATUT) || dt;
    var c = commissionLigne_(o, t);
    if (st === 'SIGNE' && ds) {
      var ms = ds.slice(0, 7);
      var y = parMoisSigne[ms] || (parMoisSigne[ms] = { ponctuel: 0, contrats: 0, mensuel: 0, n: 0, repris: 0 });
      if (c.contrat) { y.mensuel = arr2_(y.mensuel + (c.mensuel || 0)); y.contrats++; } else y.ponctuel = arr2_(y.ponctuel + c.base);
      y.n++; if (hist) y.repris++;
    }
    if (hist || !dt || dt.slice(0, 4) !== an) return;
    dv.nb++;
    var com = String(o.COMMERCIAL || '').trim() || '—';
    var pc = parCom[com] || (parCom[com] = { nom: com, nb: 0, signes: 0, ca: 0 });
    var orig = String(o.ORIGINE || '').trim().toUpperCase() || 'NON PRÉCISÉE';
    var po = parOrig[orig] || (parOrig[orig] = { nom: orig, nb: 0, signes: 0 });
    var nat = c.contrat ? 'CONTRAT ' + (c.nature || '') : (c.nature || 'AUTRE');
    var pn = parNat[nat] || (parNat[nat] = { nom: nat, nb: 0, signes: 0, ca: 0 });
    pc.nb++; po.nb++; pn.nb++;
    if (dt.slice(0, 7) === moisAuj) { dv.nbMois++; dv.htMois = arr2_(dv.htMois + c.base); }
    if (st === 'SIGNE') {
      dv.signes++; pc.signes++; po.signes++; pn.signes++;
      pc.ca = arr2_(pc.ca + c.base); pn.ca = arr2_(pn.ca + c.base);
      if (ds.slice(0, 7) === moisAuj) dv.signesMois++;
      if (c.contrat) { dv.mensuelSigne = arr2_(dv.mensuelSigne + (c.mensuel || 0)); dv.nbContratsSignes++; }
      else { dv.htPonctuelSigne = arr2_(dv.htPonctuelSigne + c.base); dv.nbPonctuelSigne++; }
    } else if (st === 'REFUSE' || st === 'EXPIRE') dv.refuses++;
    else {
      dv.attente++;
      if (c.contrat) dv.pipeMensuel = arr2_(dv.pipeMensuel + (c.mensuel || 0)); else dv.pipeHt = arr2_(dv.pipeHt + c.base);
    }
  });
  dv.taux = dv.nb ? Math.round(dv.signes / dv.nb * 1000) / 10 : 0;
  dv.tauxTranche = (dv.signes + dv.refuses) ? Math.round(dv.signes / (dv.signes + dv.refuses) * 1000) / 10 : 0;
  dv.panier = dv.nbPonctuelSigne ? arr2_(dv.htPonctuelSigne / dv.nbPonctuelSigne) : 0;
  var tri = function (o, k) { return Object.keys(o).map(function (x) { return o[x]; }).sort(function (a, b) { return (b[k] || 0) - (a[k] || 0); }); };

  /* ---- les clients qui pèsent (depuis janvier) ---- */
  var parCli = {};
  contrats.forEach(function (c) {
    var tot = 0;
    annee.forEach(function (x) { if (contratCourtEn_(c, x.mois) && !F.complets[x.mois]) tot += montantContratMois_(c, x.mois); });
    if (tot > 0) parCli[cleClient_(c.nom)] = { nom: c.nom, ca: arr2_(tot), contrat: true };
  });
  F.liste.forEach(function (f) {
    if (f.date.slice(0, 4) !== an) return;
    if (f.contrat && !F.complets[f.date.slice(0, 7)]) return;      // déjà compté par le contrat
    var cc = contratDe(f.client);                                   // la facture d'un client sous contrat va sur son contrat
    var k = cc ? cleClient_(cc.nom) : cleClient_(f.client);
    var x = parCli[k] || (parCli[k] = { nom: cc ? cc.nom : f.client, ca: 0, contrat: !!cc });
    x.ca = arr2_(x.ca + f.ht);
  });
  var clients = tri(parCli, 'ca').slice(0, 10);

  return {
    ok: true, maj: Date.now(), an: an, mois: moisAuj,
    societe: String(lireReglages_().societe_nom || 'BREIZH BRILLANCE'),
    ca: { ceMois: ceMois, moisPrec: moisPrec, depuisJanvier: somme(annee), clos: somme(clos),
          moyenne: clos.length ? arr2_(somme(clos) / clos.length) : 0, meilleur: meilleur,
          douzeMois: somme(courbe.slice(-12)) },
    courbe: courbe,
    recurrent: { mensuel: mrr, annuel: arr2_(mrr * 12), nb: actifs.length, heuresMois: heures, passagesMois: passages,
                 parHeure: heures > 0 ? arr2_(mrr / heures) : 0,
                 parHeureMin: avecH.length ? avecH.reduce(function (m, c) { return Math.min(m, c.parHeure); }, 1e9) : 0,
                 parHeureMax: avecH.reduce(function (m, c) { return Math.max(m, c.parHeure); }, 0),
                 resteEngage: arr2_(listeC.reduce(function (s, c) { return s + c.resteEngage; }, 0)),
                 echeances: listeC.filter(function (c) { return c.echeance; }).length,
                 pros: listeC.filter(function (c) { return !c.part; }).length },
    contrats: listeC, prevision: prevision,
    devis: dv, parCommercial: tri(parCom, 'ca'), parOrigine: tri(parOrig, 'nb'), parNature: tri(parNat, 'ca'),
    signesParMois: mois.map(function (m) { return { mois: m, v: parMoisSigne[m] || { ponctuel: 0, contrats: 0, mensuel: 0, n: 0, repris: 0 } }; }),
    clients: clients,
    sources: { factures: F.liste.length, moisComplets: Object.keys(F.complets).sort(),
               histo: !!SpreadsheetApp.getActive().getSheetByName(SH_HISTO_FACT_) }
  };
}

/* v108q — Simon, 11 novembre : « il faut que tu puisses lier chaque
   contrat/devis à une ou plusieurs interventions du planning ; à l'avenir je
   ne pourrai mettre une intervention que si je la relie à un devis ».
   Réglage `intervention_sans_devis` = OUI pour rouvrir la porte. */
function devisObligatoireOk_(d) {
  if (String(d.devis || '').trim()) return true;
  return /^O/i.test(String(lireReglages_().intervention_sans_devis || '').trim());
}
/* Relie un devis à des séries (RECURRENTS.DEVIS) et/ou à des interventions
   (CHANTIERS.NUMERO). numero vide = délier. Une série déjà reliée à un autre
   devis n'est changée qu'avec forcer. */
function lierDevis_(d, com) {
  var num = String(d.numero || '').trim(), dv = null;
  if (num) {
    dv = devisParNumero_(num);
    if (!dv) return { ok: false, erreur: 'le devis ' + num + ' est introuvable' };
    num = String(dv.NUMERO).trim();
  }
  var ss = SpreadsheetApp.getActive(), out = { ok: true, numero: num, series: 0, chantiers: 0, refus: [] };
  var lier = function (nomOnglet, colId, colNum, ids) {
    if (!ids || !ids.length) return 0;
    if (nomOnglet === SH.RECURRENTS) colonneAssuree_(SH.RECURRENTS, 'DEVIS');
    var sh = ss.getSheetByName(nomOnglet);
    var v = sh.getDataRange().getValues(), en = v[0].map(function (x) { return String(x).trim(); });
    var ci = en.indexOf(colId), cn = en.indexOf(colNum), n = 0;
    if (ci < 0 || cn < 0) return 0;
    var voulu = {}; ids.forEach(function (x) { voulu[String(x).trim()] = true; });
    for (var i = 1; i < v.length; i++) {
      var id = String(v[i][ci] || '').trim();
      if (!voulu[id]) continue;
      var avant = String(v[i][cn] || '').trim();
      if (avant === num) { n++; continue; }
      if (avant && num && !d.forcer) { out.refus.push(id + ' (déjà relié à ' + avant + ')'); continue; }
      sh.getRange(i + 1, cn + 1).setValue(num);
      n++;
    }
    return n;
  };
  out.series = lier(SH.RECURRENTS, 'ID', 'DEVIS', d.series || []);
  /* Les passages d'une série restent sans NUMERO (comme ceux que pose
     genererRecurrents_) : le lien vit sur la série, RECURRENTS.DEVIS. */
  out.chantiers = lier(SH.CHANTIERS, 'ID', 'NUMERO', d.chantiers || []);
  tracerServeur_(com ? com.nom : '', num ? 'DEVIS RELIE' : 'DEVIS DELIE',
                 (num || '—') + ' · séries ' + (d.series || []).join(', ') + ' · interventions ' + (d.chantiers || []).join(', ') +
                 (out.refus.length ? ' · refusé : ' + out.refus.join(', ') : ''), num, d.appareil || '');
  return out;
}

/* v108u — mettre à jour CONTRATS depuis l'appli (gérant) : une ligne par
   CONTRAT + LIGNE, créée si elle n'existe pas. Champs : mensuel, series, tva,
   client (CLIENT_FACTURE), email, particulier, actif, montantsMois, rythme. */
function contratsMaj_(d, com) {
  var lignes = d.lignes || [];
  if (!lignes.length) return { ok: false, erreur: 'rien à mettre à jour' };
  colonneAssuree_(SH_CONTRATS_, 'MONTANTS_MOIS');
  var sh = SpreadsheetApp.getActive().getSheetByName(SH_CONTRATS_);
  var v = sh.getDataRange().getValues(), en = v[0].map(function (x) { return String(x).trim(); });
  var col = function (h) { return en.indexOf(h); };
  var cle = function (a, b) { return normNom_(a) + '|' + normNom_(b); };
  var rang = {};
  for (var i = 1; i < v.length; i++) if (String(v[i][col('CONTRAT')] || '').trim()) rang[cle(v[i][col('CONTRAT')], v[i][col('LIGNE')])] = i + 1;
  var map = { mensuel: 'MENSUEL_HT', series: 'SERIES', tva: 'TVA', client: 'CLIENT_FACTURE', email: 'EMAIL', particulier: 'PARTICULIER',
              actif: 'ACTIF', montantsMois: 'MONTANTS_MOIS', rythme: 'RYTHME', note: 'NOTE', siren: 'SIREN', adresse: 'ADRESSE', cp: 'CP', ville: 'VILLE' };
  var crees = 0, modifies = 0, faits = [];
  lignes.forEach(function (l) {
    var c = String(l.contrat || '').trim(), li = String(l.ligne || 'Entretien des locaux').trim();
    if (!c) return;
    var r = rang[cle(c, li)];
    if (!r) {
      var neuve = en.map(function (h) { return h === 'CONTRAT' ? c : h === 'LIGNE' ? li : h === 'ACTIF' ? 'OUI' : h === 'TVA' ? 20 : h === 'PARTICULIER' ? 'NON' : ''; });
      sh.appendRow(neuve); r = sh.getLastRow(); rang[cle(c, li)] = r; crees++;
    } else modifies++;
    Object.keys(map).forEach(function (k) {
      if (l[k] === undefined) return;
      var ci = col(map[k]);
      if (ci >= 0) sh.getRange(r, ci + 1).setValue(l[k]);
    });
    faits.push(c + ' / ' + li);
  });
  tracerServeur_(com ? com.nom : '', 'CONTRATS MIS A JOUR', crees + ' créée(s), ' + modifies + ' modifiée(s) : ' + faits.join(' ; ').slice(0, 400), '', d.appareil || '');
  return { ok: true, crees: crees, modifies: modifies };
}

/* Menu 34 — « rajoute en tant que devis signés les contrats récurrents déjà
   en place ». Une ligne DEVIS par contrat de CONTRATS qui n'a pas de devis
   signé dans l'appli : numéro CTR-…, ORIGINE = HISTORIQUE, date = début du
   contrat. Ces lignes comptent dans les chiffres, et nulle part ailleurs
   (lireDevis_ les ignore : pas de facture, pas de rappel, pas de commission).
   Relancer ne crée pas de doublon. */
function reprendreContratsEnDevis() {
  var r = reprendreContratsEnDevis_();
  try {
    SpreadsheetApp.getUi().alert(r.crees + ' contrat(s) ajouté(s) comme devis signés, ' + r.deja + ' déjà présent(s), ' +
      r.relies + ' série(s) du planning reliée(s) à leur devis.' +
      (r.noms.length ? '\n\n' + r.noms.join('\n') : ''));
  } catch (e) {}
  return r;
}
function reprendreContratsEnDevis_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.DEVIS);
  ['ORIGINE', 'DATE_STATUT', 'PASSAGES_MOIS', 'NATURE', 'ENGAGEMENT_MOIS', 'RECONDUCTION'].forEach(function (h) { colonneAssuree_(SH.DEVIS, h); });
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
  var pris = numerosPris_();
  var devisDeSerie = {};
  objetsDe_(SH.RECURRENTS).forEach(function (s) {
    if (String(s.DEVIS || '').trim()) devisDeSerie[String(s.ID || '').trim()] = true;
  });
  var lignes = [], noms = [], deja = 0, auj = new Date(), aRelier = [];
  contratsVivants_().forEach(function (c) {
    if (!(c.mensuel > 0)) return;
    var num = 'CTR-' + sansAccent_(c.nom).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    var libres = c.series.filter(function (id) { return !devisDeSerie[id]; });
    if (pris[num] || c.series.some(function (id) { return devisDeSerie[id]; })) {
      deja++;
      if (pris[num] && libres.length) aRelier.push({ num: num, ids: libres });   // v108q : la série de ce contrat le porte
      return;
    }
    if (libres.length) aRelier.push({ num: num, ids: libres });
    var debut = c.debut ? new Date(c.debut + 'T12:00:00') : auj;
    var tva = arr2_(c.mensuel * c.tva / 100);
    var v = {
      NUMERO: num, DATE: debut, COMMERCIAL: '', CLIENT: c.client || c.nom,
      TYPE_CLIENT: c.part ? 'PARTICULIER' : 'PROFESSIONNEL', SIRET_CLIENT: c.siren, EMAIL: c.email,
      ADRESSE: c.adresse, CP: c.cp, VILLE: c.ville,
      TOTAL_HT_PONCTUEL: 0, TOTAL_HT_MENSUEL: c.mensuel, TOTAL_HT: c.mensuel, TOTAL_TVA: tva,
      TOTAL_TTC: arr2_(c.mensuel + tva), REMISE_PCT: 0, STATUT: 'SIGNE', SIGNE: 'OUI',
      NOTES: 'Contrat en place avant l\'application, repris pour les chiffres le ' +
             Utilities.formatDate(auj, 'Europe/Paris', 'dd/MM/yyyy') + ' (contrat « ' + c.nom + ' », séries ' +
             (c.series.join(', ') || '—') + '). Pas de devis papier dans l\'appli.',
      OBJET: c.lignes.join(' + '), DATE_STATUT: debut, PASSAGES_MOIS: Math.round(c.passagesMois) || '',
      NATURE: c.nature, ORIGINE: 'HISTORIQUE', ENGAGEMENT_MOIS: c.engagement || 12,
      RECONDUCTION: c.tacite ? 'TACITE' : 'NON'
    };
    lignes.push(en.map(function (h) { return v.hasOwnProperty(h) ? v[h] : ''; }));
    noms.push(num + ' — ' + c.nom + ' — ' + c.mensuel + ' € HT/mois');
    pris[num] = true;
  });
  if (lignes.length) {
    sh.getRange(sh.getLastRow() + 1, 1, lignes.length, en.length).setValues(lignes);
    tracerServeur_('SYSTEME', 'CONTRATS REPRIS EN DEVIS', lignes.length + ' contrat(s) : ' + noms.join(' ; ').slice(0, 400), '', '');
  }
  /* Chaque série du contrat porte le numéro CTR : le contrat n'est plus
     « à mettre au calendrier », et ses passages savent à quel devis ils
     appartiennent. */
  var relies = 0;
  aRelier.forEach(function (a) { relies += lierDevis_({ numero: a.num, series: a.ids }, null).series; });
  return { ok: true, crees: lignes.length, deja: deja, noms: noms, relies: relies };
}

/* L'historique complet des factures (export Henrri), collé ou importé dans
   HISTO_FACTURES. Rend l'onglet, créé au besoin avec ses en-têtes. */
function ongletHistoFactures_() {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SH_HISTO_FACT_) || creerOnglet_(ss, SH_HISTO_FACT_, ENTETES_HISTO_FACT_);
}



/* ====================== LES CONGÉS (v104) ======================
   Simon, 8 novembre 2026 : « congés des salariés saisis dans l'appli, pour
   que les créneaux proposés en tiennent compte ». L'onglet ABSENCES existait
   (PRESTATAIRE, DU, AU — sans motif, volontairement) et le serveur s'en
   servait déjà pour poser les chantiers d'un devis. Il manquait :
   — de quoi les saisir depuis le téléphone du gérant ;
   — que les passages des contrats les respectent : un binôme dont l'un est en
     congé part avec l'autre seul ; seul et absent, le passage va dans
     « À placer », comme un férié ;
   — que le planning les montre, et que les dates proposées les évitent.
   Les interventions déjà posées ne sont jamais déplacées en silence : à la
   saisie d'un congé, l'absent est retiré des binômes de la période (l'autre
   reste), et ce qui reste à une seule personne absente est signalé dans
   « À faire » pour être replacé ou confié à quelqu'un d'autre. */
function motifAbsence_(cal, iso, qui) {
  if (!cal || !iso) return '';
  if (estAbsent_(cal, '', iso, true)) return 'fermeture';
  var l = nomsQui_(qui).filter(function (n) { return estAbsent_(cal, normNom_(n), iso); });
  return l.length ? 'congé de ' + l.map(function (n) { return n.charAt(0) + n.slice(1).toLowerCase(); }).join(' et ') : '';
}

function absencesPourAdmin_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.ABSENCES);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim().toUpperCase(); });
  var iQui = en.indexOf('PRESTATAIRE'), iDu = en.indexOf('DU'), iAu = en.indexOf('AU');
  if (iDu < 0) return [];
  var depuis = new Date(); depuis.setDate(depuis.getDate() - 1);
  var lim = isoJour_(depuis), out = [];
  for (var i = 1; i < v.length; i++) {
    var du = jourDe_(v[i][iDu]);
    if (!du) continue;
    var au = (iAu >= 0 ? jourDe_(v[i][iAu]) : '') || du;
    if (au < du) { var x = du; du = au; au = x; }
    if (au < lim) continue;
    var qui = iQui >= 0 ? String(v[i][iQui] || '').trim() : '';
    var cle = normNom_(qui);
    var tous = !cle || cle === 'tous' || cle === 'tout le monde' || cle === 'fermeture';
    out.push({ rang: i + 1, qui: tous ? '' : qui, du: du, au: au });
  }
  out.sort(function (a, b) { return a.du < b.du ? -1 : (a.du > b.du ? 1 : 0); });
  return out;
}

function absenceAjouter_(d, com) {
  var du = jourDe_(d.du), au = jourDe_(d.au) || du;
  if (!du) return { ok: false, erreur: 'date de début illisible' };
  if (au < du) { var x = du; du = au; au = x; }
  if ((dateIso_(au) - dateIso_(du)) / 86400000 > 366) return { ok: false, erreur: 'période de plus d\'un an' };
  var qui = String(d.qui || '').trim(), cle = '';
  if (qui && !/^(tous|tout le monde|fermeture)$/i.test(qui)) {
    var qc = quiConnus_(qui);
    if (!qc.ok) return { ok: false, erreur: qc.erreur };
    if (nomsQui_(qc.valeur).length !== 1) return { ok: false, erreur: 'une personne à la fois' };
    qui = qc.valeur; cle = normNom_(qui);
  } else qui = 'TOUS';
  var sh = creerOnglet_(SpreadsheetApp.getActive(), SH.ABSENCES, ENTETES_ABSENCES_);
  sh.appendRow([qui, dateIso_(du), dateIso_(au)]);
  var b = ajusterPourAbsence_({ cle: cle, du: du, au: au });
  tracerServeur_(com ? com.nom : '', 'CONGE AJOUTE', (cle ? qui : 'fermeture') + ' · du ' + du + ' au ' + au +
                 (b.retires ? ' · retiré de ' + b.retires + ' binôme(s)' : '') +
                 (b.conflits ? ' · ' + b.conflits + ' intervention(s) à replacer' : ''), '', d.appareil || '');
  return { ok: true, retires: b.retires, conflits: b.conflits };
}

function absenceRetirer_(d, com) {
  var rang = Math.round(Number(d.rang) || 0);
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.ABSENCES);
  if (!sh || rang < 2 || rang > sh.getLastRow()) return { ok: false, erreur: 'congé introuvable' };
  var en = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim().toUpperCase(); });
  var l = sh.getRange(rang, 1, 1, sh.getLastColumn()).getValues()[0];
  var iDu = en.indexOf('DU'), iQui = en.indexOf('PRESTATAIRE');
  /* La ligne a pu bouger depuis que l'écran l'a lue : on vérifie qu'elle dit
     bien ce que le gérant a sous les yeux avant de l'effacer. */
  if (jourDe_(l[iDu]) !== jourDe_(d.du) ||
      (iQui >= 0 && normNom_(l[iQui]).replace(/^(tous|tout le monde|fermeture)$/, '') !== normNom_(d.qui || ''))) {
    return { ok: false, erreur: 'la liste des congés a changé : actualise et recommence' };
  }
  sh.deleteRow(rang);
  tracerServeur_(com ? com.nom : '', 'CONGE RETIRE', (d.qui || 'fermeture') + ' · du ' + jourDe_(d.du), '', d.appareil || '');
  return { ok: true };
}

/* Les interventions à venir déjà posées pendant le congé : l'absent quitte les
   binômes, le reste est compté pour « À faire ». */
function ajusterPourAbsence_(a) {
  var b = { retires: 0, conflits: 0 };
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  if (!sh || sh.getLastRow() < 2) return b;
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var e = v[0].map(function (x) { return String(x).trim(); });
  var cD = e.indexOf('DATE'), cQ = e.indexOf('PRESTATAIRE'), cS = e.indexOf('STATUT');
  if (cD < 0 || cQ < 0) return b;
  var auj = isoJour_(new Date());
  for (var i = 1; i < v.length; i++) {
    var d = v[i][cD];
    if (!(d instanceof Date) || isNaN(d.getTime())) continue;
    var iso = isoJour_(d);
    if (iso < auj || iso < a.du || iso > a.au) continue;
    var st = cS >= 0 ? String(v[i][cS] || '').toUpperCase().trim() : '';
    if (st !== 'PLANIFIE' && st !== 'A PLANIFIER' && st !== '') continue;
    var noms = nomsQui_(v[i][cQ]);
    if (!a.cle) { b.conflits++; continue; }
    if (!noms.some(function (n) { return normNom_(n) === a.cle; })) continue;
    var reste = noms.filter(function (n) { return normNom_(n) !== a.cle; });
    if (reste.length) { sh.getRange(i + 1, cQ + 1).setValue(reste.join(', ')); b.retires++; }
    else b.conflits++;
  }
  return b;
}

/* v105 — lancée une fois depuis l'éditeur : remet à leur date les passages
   fériés que les v101 à v104 avaient mis de côté dans « À placer ». (La nuit
   le ferait aussi ; ceci évite d'attendre.) */
function miseEnPlaceV105() {
  var g = genererRecurrents_();
  Logger.log('Planning : ' + (g.feriesRemis || 0) + ' férié(s) remis à leur date, ' + g.poses + ' posé(s), ' +
             (g.absences || 0) + ' à placer pour congé.');
  return g;
}


/* ====================== v106 — PRÉVENIR À LA SIGNATURE ======================
   « Rajoute le fait que j'ai une notification quand le client signera le
   devis. » La signature en ligne prévenait déjà le gérant ; la signature sur
   place (à l'écran du commercial) et un devis déclaré signé ne prévenaient
   personne. Le gérant (et le commercial du devis) reçoivent un mot, sauf celui
   qui vient lui-même de faire signer. */
function notifierSignature_(numero, client, ht, commercial, acteur, comment) {
  try {
    var dest = [], vus = {};
    var ajoute = function (n) {
      var k = normNom_(n);
      if (!k || vus[k] || k === normNom_(acteur)) return;
      vus[k] = 1; dest.push(n);
    };
    lireAdmins_().forEach(function (a) { ajoute(a.nom); });
    ajoute(commercial);
    if (!dest.length) return 0;
    var montant = Number(ht) ? ' · ' + eur_(Number(ht)) + ' HT' : '';
    var res = notifierLot_(dest.map(function (n) {
      return { nom: n, titre: 'Devis signé', texte: String(client || 'Client') + montant + ' — ' + comment +
               (commercial && normNom_(commercial) !== normNom_(n) ? ' (' + commercial + ')' : '') };
    }));
    return res.filter(function (r) { return r.ok; }).length;
  } catch (e) { return 0; }
}


/* ====================== v106 — RAPPEL LA VEILLE (PONCTUELS) ======================
   « Il faut aussi inclure un rappel automatique 24 h avant la prestation,
   uniquement pour les chantiers ponctuels, pas sur le récurrent. »
   Toutes les heures (avec la préparation automatique), entre 8 h et 21 h :
   chaque intervention ponctuelle (sans clé RECURRENT) planifiée dans les
   24 heures qui viennent reçoit un mail au client — une seule fois. L'adresse
   est celle du devis lié ; sans devis ou sans e-mail, rien ne part (journal).
   Réglage rappel_veille = NON pour couper. */
function rappelsVeille_(maintenant) {
  var now = maintenant || new Date();
  var h = now.getHours();
  if (h < 8 || h >= 21) return { envoyes: 0 };
  var reg = lireReglages_();
  if (/^(non|no|0|off)$/i.test(String(reg.rappel_veille || '').trim())) return { envoyes: 0, motif: 'coupé' };
  var props = PropertiesService.getScriptProperties();
  var deja = {};
  try { deja = JSON.parse(props.getProperty('RAPPELS_VEILLE') || '{}'); } catch (e) { deja = {}; }
  var emails = {};
  lireDevis_().forEach(function (d) {
    var n = String(d.NUMERO || '').trim(), m = String(d.EMAIL || '').trim();
    if (n && /@/.test(m)) { emails[n] = { email: m, d: d }; }
    var o = String(d.NUMERO_ORIGINE || '').trim();
    if (o && /@/.test(m) && !emails[o]) emails[o] = { email: m, d: d };
  });
  var b = { envoyes: 0, sansMail: 0 };
  objetsDe_(SH.CHANTIERS).forEach(function (o) {
    var id = String(o.ID || '').trim();
    if (!id || deja[id]) return;
    if (String(o.RECURRENT || '').trim()) return;                  // pas les contrats
    var st = String(o.STATUT || '').toUpperCase().trim();
    if (st !== 'PLANIFIE') return;
    var d = o.DATE instanceof Date ? o.DATE : (o.DATE ? new Date(o.DATE) : null);
    if (!d || isNaN(d.getTime())) return;
    var hm = String(heureTexte_(o.HEURE) || '08:00').split(':');
    var debut = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(hm[0]) || 8, Number(hm[1]) || 0);
    var ecart = (debut - now) / 3600000;
    if (ecart <= 0 || ecart > 24) return;
    var lien = emails[String(o.NUMERO || '').trim()];
    deja[id] = isoJour_(debut);
    if (!lien) {
      b.sansMail++;
      tracerServeur_('SYSTEME', 'RAPPEL VEILLE SANS E-MAIL', String(o.CLIENT || '') + ' · ' + isoJour_(debut), String(o.NUMERO || ''), '');
      return;
    }
    var heure = heureTexte_(o.HEURE);
    var lieu = [String(o.ADRESSE || ''), [String(o.CP || ''), String(o.VILLE || '')].join(' ').trim()].filter(String).join(', ');
    var quand = (isoJour_(debut) === isoJour_(new Date(now.getTime() + 86400000)) ? 'demain, ' : '') + jourFr_(debut) + (heure ? ' à ' + heure : '');
    var texte = 'Bonjour,\n\nJ\'espère que vous allez bien !\n\nPetit rappel : notre équipe intervient ' + quand +
      (lieu ? ', au ' + lieu : '') + '.\n\nSi l\'accès demande quelque chose de particulier (code, clés, stationnement), ' +
      'il suffit de répondre à ce mail.\n\nBelle journée,';
    try {
      envoyerMail_({
        to: lien.email,
        subject: 'Rappel : notre intervention ' + (quand.indexOf('demain') === 0 ? 'demain' : 'le ' + jourFr_(debut)),
        name: String(reg.societe_nom || 'BREIZH BRILLANCE'),
        replyTo: String(reg.societe_email || ''),
        htmlBody: corpsMailPerso_(null, texte, reg)
      }, reg);
      b.envoyes++;
      tracerServeur_('SYSTEME', 'RAPPEL VEILLE ENVOYE', String(o.CLIENT || '') + ' · ' + lien.email + ' · ' + quand, String(o.NUMERO || ''), '');
    } catch (eM) {
      delete deja[id];
      tracerServeur_('SYSTEME', 'MAIL RATE', 'rappel veille ' + id + ' — ' + String(eM && eM.message || eM), String(o.NUMERO || ''), '');
    }
  });
  /* On n'oublie que ce qui est passé depuis plus de deux jours. */
  var lim = isoJour_(new Date(now.getTime() - 2 * 86400000));
  Object.keys(deja).forEach(function (k) { if (deja[k] < lim) delete deja[k]; });
  props.setProperty('RAPPELS_VEILLE', JSON.stringify(deja));
  return b;
}

/* ====================== LES ÉLÉMENTS DE PAIE (v108d) ======================
   Simon, 9 novembre 2026 : « les éléments de paie prêts chaque fin de mois —
   commission pour commercial + jours de congés, pas le détail de chaque
   heure ». Le 10 novembre : le calendrier des obligations, le registre du
   personnel et la check-list d'embauche vivent seulement dans le dossier
   ADMIN de son Drive (contact@breizhbrillance.fr), pas dans l'appli — tout ce
   qui les créait ou les lisait a été retiré d'ici. Restent les éléments de
   paie d'un mois : jours d'absence de chaque salarié (jours ouvrables, du
   lundi au samedi hors fériés) et commission brute de chaque commercial. */
/* ---- les éléments de paie ---- */
function joursOuvrablesEntre_(du, au) {
  var n = 0, d = new Date(du + 'T12:00:00'), fin = new Date(au + 'T12:00:00'), fer = {};
  while (d <= fin) {
    var an = d.getFullYear();
    if (!fer[an]) fer[an] = joursFeries_(an);
    if (d.getDay() !== 0 && !fer[an][isoJour_(d)]) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}
function elementsPaie_(d) {
  var auj = new Date();
  var mois = /^\d{4}-\d{2}$/.test(String(d && d.mois || '')) ? String(d.mois) : Utilities.formatDate(auj, 'Europe/Paris', 'yyyy-MM');
  var a = Number(mois.slice(0, 4)), m = Number(mois.slice(5, 7));
  var debut = mois + '-01', fin = isoJour_(new Date(a, m, 0, 12));
  var abs = lireAbsences_(), fermetures = [];
  abs.forEach(function (x) {
    if (x.cle || x.au < debut || x.du > fin) return;
    var du = x.du < debut ? debut : x.du, au = x.au > fin ? fin : x.au;
    fermetures.push({ du: du, au: au, jours: joursOuvrablesEntre_(du, au) });
  });
  var salaries = lirePrestataires_().map(function (p) {
    var cle = normNom_(p.nom), per = [];
    abs.forEach(function (x) {
      if (x.cle !== cle || x.au < debut || x.du > fin) return;
      var du = x.du < debut ? debut : x.du, au = x.au > fin ? fin : x.au;
      per.push({ du: du, au: au, jours: joursOuvrablesEntre_(du, au) });
    });
    per.sort(function (u, v) { return u.du < v.du ? -1 : 1; });
    var tot = per.reduce(function (s, x) { return s + x.jours; }, 0) + fermetures.reduce(function (s, x) { return s + x.jours; }, 0);
    return { nom: p.nom, jours: tot, periodes: per };
  });
  var cm = commissions_({ mois: 24 }, { nom: '', role: 'ADMIN' });
  var commerciaux = (cm.commerciaux || []).map(function (c) {
    var r = (c.mois || {})[mois] || { ca: 0, com: 0, n: 0 };
    return { nom: c.nom, signe: r.ca, commission: r.com, n: r.n, lignes: (c.lignes || []).filter(function (l) { return l.mois === mois; }) };
  }).filter(function (c) { return c.commission || c.signe; });
  return { ok: true, mois: mois, du: debut, au: fin, salaries: salaries, fermetures: fermetures, commerciaux: commerciaux,
           maj: Date.now() };
}

