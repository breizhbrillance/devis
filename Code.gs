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
  BORD: 'TABLEAU DE BORD',
  PRESTATAIRES: 'PRESTATAIRES',
  CHANTIERS: 'CHANTIERS',
  ADMINS: 'ADMINS',
  ABSENCES: 'ABSENCES'
};

/* Les agents qui exécutent le travail. Feuille séparée des COMMERCIAUX : ce ne
   sont pas les mêmes gens, pas les mêmes droits, et surtout pas les mêmes
   données envoyées à leur téléphone. */
/* JOURS, PLAGES et HEURES_SEMAINE décrivent la disponibilité du salarié ; sans
   elles, le planning ne saurait pas quel jour poser quoi. Vides, on retombe sur
   du lundi au vendredi, 8h-12h / 14h-17h, 35 heures. */
var ENTETES_PRESTATAIRES_ = ['NOM', 'EMAIL', 'CODE', 'ACTIF', 'TELEPHONE',
                             'JOURS', 'PLAGES', 'HEURES_SEMAINE'];
/* Les comptes qui voient tout : les plannings de chacun, les devis de chacun,
   et les chiffres. Mêmes colonnes que les deux autres populations, pour que
   la façon d'ajouter ou de retirer quelqu'un ne change jamais. */
var ENTETES_ADMINS_ = ['NOM', 'EMAIL', 'CODE', 'ACTIF'];

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
  'DUREE_PREVUE_MIN', 'LOT'
];

/* A PLANIFIER : le devis est signé, personne ni date encore posés.
   PLANIFIE : date et agent en place, l'agent le voit dans son planning.
   EN COURS : l'agent a pointé son arrivée.
   FAIT : il a pointé son départ.
   PROBLEME : il a signalé quelque chose — le chantier reste à regarder.
   ANNULE : le devis n'est plus signé, ou le gérant a retiré le passage. La
   fiche reste dans la feuille pour mémoire, mais ne compte plus nulle part. */
var STATUTS_CHANTIER_ = ['A PLANIFIER', 'PLANIFIE', 'EN COURS', 'FAIT', 'PROBLEME', 'ANNULE'];

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
    .addItem('8. Purger le journal des actions', 'purgerJournal')
    .addSeparator()
    .addItem('9. Rafraîchir « À facturer » et le tableau de bord', 'rafraichirSuivi')
    .addItem('10. Activer le rappel quotidien aux commerciaux', 'activerAutomate')
    .addItem('11. Arrêter le rappel quotidien', 'arreterAutomate')
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
  creerOnglet_(ss, SH.CATALOGUE, ['CATEGORIE', 'DESIGNATION', 'DETAIL', 'UNITE', 'PU_HT', 'TVA', 'TYPE', 'ACTIF', 'REFERENCE', 'NATURES']);
  creerOnglet_(ss, SH.COMMERCIAUX, ['NOM', 'EMAIL', 'CODE', 'ACTIF']);
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
    cat.getRange(2, 1, CATALOGUE_DEFAUT_.length, 8).setValues(CATALOGUE_DEFAUT_);
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

var ENTETES_DEVIS_ = [
  'NUMERO', 'DATE', 'COMMERCIAL', 'CLIENT', 'TYPE_CLIENT', 'SIRET_CLIENT', 'TVA_CLIENT',
  'CONTACT', 'TELEPHONE', 'EMAIL', 'ADRESSE', 'CP', 'VILLE',
  'TOTAL_HT_PONCTUEL', 'TOTAL_HT_MENSUEL', 'TOTAL_HT', 'TOTAL_TVA', 'TOTAL_TTC',
  'REMISE_PCT', 'STATUT', 'SIGNE', 'SIGNATAIRE', 'VALIDITE', 'LIEN_PDF', 'PHOTOS', 'NOTES',
  'RECU_LE', 'ID_APPAREIL', 'ID_DEVIS', 'OBJET', 'LOGEMENT_PLUS_2_ANS', 'TAUX_TVA', 'DELAI',
  'DATE_SOUHAITEE',
  'MOTIF_REFUS', 'RELANCE_LE', 'DATE_STATUT', 'PREUVE_SIGNATURE', 'NOTE_COMMERCIAL',
  'CONTROLE_TARIF', 'PASSAGES_MOIS', 'NATURE'
];

/* Les états qu'un devis peut prendre, dans l'ordre de la vie réelle.
   REMIS : imprimé et laissé au client, résultat encore inconnu.
   SIGNE : accepté — la preuve est la photo du papier signé.
   A RELANCER : le client réfléchit, une date de relance est posée.
   REFUSE : perdu, avec son motif. EXPIRE : validité dépassée sans réponse. */
var STATUTS_ = ['REMIS', 'SIGNE', 'A RELANCER', 'REFUSE', 'EXPIRE'];

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
  [[SH.PRESTATAIRES, ENTETES_PRESTATAIRES_], [SH.CHANTIERS, ENTETES_CHANTIERS_],
   [SH.ADMINS, ENTETES_ADMINS_]]
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
       (ENTRETIEN, CHANTIER, REMISE, séparées par des virgules). Vide, elle se
       vend dans les trois : c'est le cas de presque tout le catalogue, et c'est
       pourquoi la colonne peut rester vide sans rien casser. */
    if (enC.indexOf('NATURES') < 0) {
      var iNat = shC.getLastColumn();
      shC.getRange(1, iNat + 1).setValue('NATURES')
        .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
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
                    'mention_manuscrite', 'bordereau_retractation',
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
  ['remise_max', '10', 'Remise maximale que le commercial peut accorder, en % — 0 pour l\'interdire'],
  ['passages_mois_defaut', '4', 'Contrat mensuel : nombre de passages créés par mois si le devis ne le précise pas'],
  ['pointage_retention_mois', '36', 'Durée de conservation des pointages arrivée/départ, en mois'],
  ['texte_information_agent', 'L\'application enregistre, à chaque utilisation : les connexions, l\'heure d\'arrivée et l\'heure de départ de chaque chantier, les prestations cochées, les photos prises et les signalements.\n\nCes informations servent au suivi des interventions, à la preuve du travail effectué auprès des clients, et au décompte du temps de travail. Elles sont conservées {mois} mois, puis effacées.\n\nConformément au règlement général sur la protection des données, tu peux demander à consulter les informations qui te concernent et faire rectifier une erreur, en écrivant à breizhbrillance@gmail.com.', 'Texte affiché à chaque connexion d\'un agent — {mois} est remplacé par pointage_retention_mois'],
  ['validite_jours', '30', 'Durée de validité du devis en jours'],
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
  ['travail_jours_feries', 'NON',
   'OUI : l\'appli pose aussi des chantiers les jours fériés'],
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
  ['sel_codes', '', 'Généré automatiquement — ne pas modifier']
];

var CATALOGUE_DEFAUT_ = [
  ['Remise en état des sols', 'Nettoyage approfondi des plinthes et angles', '', 'm2', 0.20, 10, 'PONCTUEL', 'OUI', 'REF-0001', ''],
  ['Remise en état des sols', 'Aspiration complète des sols', '', 'm2', 0.40, 10, 'PONCTUEL', 'OUI', 'REF-0002', ''],
  ['Remise en état des sols', 'Décapage des sols au décapant laitance', '', 'm2', 0.50, 10, 'PONCTUEL', 'OUI', 'REF-0003', 'CHANTIER'],
  ['Remise en état des sols', 'Lavage humide et désinfection des sols', '', 'm2', 0.45, 10, 'PONCTUEL', 'OUI', 'REF-0004', ''],
  ['Nettoyage des vitrages et menuiseries', 'Nettoyage des vitrages intérieurs/extérieurs', '', 'm2', 8, 10, 'PONCTUEL', 'OUI', 'REF-0005', ''],
  ['Nettoyage des vitrages et menuiseries', 'Nettoyage complet des menuiseries, cadres et rails', '', 'm2', 4, 10, 'PONCTUEL', 'OUI', 'REF-0006', ''],
  ['Nettoyage des vitrages et menuiseries', 'Nettoyage des volets roulants', '', 'm2', 2, 10, 'PONCTUEL', 'OUI', 'REF-0007', ''],
  ['Remise en état de la cuisine', 'Nettoyage intérieur de la cuisine', '', 'forfait', 30, 10, 'PONCTUEL', 'OUI', 'REF-0008', ''],
  ['Remise en état de la cuisine', 'Nettoyage extérieur de la cuisine', '', 'forfait', 20, 10, 'PONCTUEL', 'OUI', 'REF-0009', ''],
  ['Chambres et pièces diverses', 'Nettoyage intérieur/extérieur des étagères, meubles, moulures et surfaces en relief', '', 'pièce(s)', 10, 10, 'PONCTUEL', 'OUI', 'REF-0010', ''],
  ['Nettoyage des sanitaires et pièces d\'eau', 'Nettoyage et désinfection WC et lavabos', '', 'pièce(s)', 40, 10, 'PONCTUEL', 'OUI', 'REF-0011', ''],
  ['Nettoyage des sanitaires et pièces d\'eau', 'Nettoyage robinetteries et faïences', '', 'pièce(s)', 15, 10, 'PONCTUEL', 'OUI', 'REF-0012', ''],
  ['Nettoyage des sanitaires et pièces d\'eau', 'Nettoyage parois vitrées', '', 'pièce(s)', 30, 10, 'PONCTUEL', 'OUI', 'REF-0013', ''],
  ['Finitions générales et livraison', 'Contrôle qualité et reprises générales', '', 'forfait', 10, 10, 'PONCTUEL', 'OUI', 'REF-0014', ''],
  ['Remise en état des sols', 'Nettoyage vapeur des sols', '', 'm2', 0.50, 10, 'PONCTUEL', 'OUI', 'REF-0015', 'REMISE']
];

/** Remplace le contenu du CATALOGUE par la grille de prix de référence. */
function chargerGrillePrix() {
  var ui = SpreadsheetApp.getUi();
  var rep = ui.alert('Remplacer le catalogue ?',
    'Les ' + CATALOGUE_DEFAUT_.length + ' prestations de la grille de prix vont remplacer le contenu ' +
    'actuel de l\'onglet CATALOGUE.\n\nLes anciennes lignes seront effacées (annulable par Ctrl+Z ' +
    'ou par l\'historique des versions du classeur).\n\nContinuer ?', ui.ButtonSet.YES_NO);
  if (rep !== ui.Button.YES) return;

  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CATALOGUE);
  if (!sh) return ui.alert('Onglet CATALOGUE introuvable. Lance d\'abord « 1. Initialiser le fichier ».');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 10).clearContent();
  sh.getRange(2, 1, CATALOGUE_DEFAUT_.length, 10).setValues(CATALOGUE_DEFAUT_);
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
  return reponse_({ ok: true, service: 'devis', message: 'Service en ligne. Identification requise.' });
}

/** Nom comparé sans tenir compte de la casse, des accents ni des espaces en trop. */
function normNom_(s) {
  s = String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  return s.replace(/[àáâäã]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
          .replace(/[òóôöõ]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/[ç]/g, 'c');
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
function config_() {
  var reg = lireReglages_();
  delete reg.sel_codes;
  delete reg.dossier_racine_id;
  delete reg.dossier_drive_id;
  delete reg.email_copie;
  return {
    maj: new Date().toISOString(),
    role: 'COMMERCIAL',
    compteurs: compteurs_(),    // dernier numéro par commercial : évite qu'un
    reglages: reg,              // téléphone réinstallé reparte à 0001
    catalogue: lireCatalogue_()
  };
}

/** POST {action:'sync', nom, code, devis, pdf(base64)} */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var d = JSON.parse(e.postData.contents);
    var actions = ['connexion', 'config', 'sync', 'photo', 'journal', 'statut',
                   'planning', 'chantier', 'tableau', 'planifier'];
    if (actions.indexOf(d.action) < 0) return reponse_({ ok: false, erreur: 'action inconnue' });

    // Un seul et même refus, que le nom soit inconnu ou le code faux.
    if (tropDEssais_(d.nom)) {
      return reponse_({ ok: false, refus: true, erreur: 'Trop d\'essais. Réessaie dans un quart d\'heure.' });
    }
    var com = trouverPersonne_(d.nom);
    if (!com || (com.code && String(d.code || '') !== com.code)) {
      noterEchec_(d.nom);
      // On ne journalise que les noms qui existent : sinon, n'importe qui
      // pourrait remplir le journal en essayant des noms au hasard.
      if (com) tracerServeur_(com.nom, 'CODE REFUSE', '', '', d.appareil || '');
      return reponse_({ ok: false, refus: true, erreur: 'Nom ou code incorrect' });
    }

    // La cloison entre les deux métiers. Un agent ne peut pas appeler les
    // actions du commercial, et réciproquement : ce n'est pas l'écran qui
    // protège, c'est cette liste.
    var agent = com.role === 'PRESTATAIRE';
    var admin = com.role === 'ADMIN';
    var permis = admin
      ? ['connexion', 'config', 'journal', 'tableau', 'planifier', 'statut']
      : agent
        ? ['connexion', 'config', 'photo', 'journal', 'planning', 'chantier']
        : ['connexion', 'config', 'sync', 'photo', 'journal', 'statut'];
    if (permis.indexOf(d.action) < 0) {
      tracerServeur_(com.nom, 'ACTION REFUSEE', d.action, '', d.appareil || '');
      return reponse_({ ok: false, erreur: 'action non autorisée pour ce compte' });
    }

    if (d.action === 'connexion') {
      tracerServeur_(com.nom, 'CONNEXION VALIDEE', com.role, '', d.appareil || '');
      return reponse_({ ok: true, nom: com.nom, role: com.role,
                        config: configPour_(com.role) });
    }
    if (d.action === 'planning') {
      return reponse_({ ok: true, chantiers: planningDe_(com.nom) });
    }
    if (d.action === 'chantier') return reponse_(enregistrerChantier_(d, com));
    if (d.action === 'journal') {
      var evs = (d.evenements || []).slice(0, 300).map(function (e) {
        return { t: e.t, nom: e.nom || com.nom, action: e.action, detail: e.detail,
                 numero: e.numero, appareil: d.appareil || '', source: 'APPAREIL' };
      });
      tracer_(evs);
      return reponse_({ ok: true, recus: evs.length });
    }
    if (d.action === 'config') {
      return reponse_({ ok: true, config: configPour_(com.role) });
    }
    if (d.action === 'tableau') return reponse_(tableauAdmin_());
    if (d.action === 'planifier') return reponse_(planifierChantier_(d, com));
    if (d.action === 'photo') return reponse_(enregistrerPhoto_(d));
    if (d.action === 'statut') return reponse_(enregistrerStatut_(d, com));

    lock.waitLock(30000);
    var res = enregistrer_(d, com);
    return reponse_(res);
  } catch (err) {
    return reponse_({ ok: false, erreur: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/** Plus grand numéro déjà utilisé, par série (préfixe + année + initiales). */
function compteurs_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.DEVIS);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var m = String(r[0]).match(/^(.+)-(\d+)$/);          // tout sauf les 4 derniers chiffres
    if (!m) return;
    var serie = m[1], n = Number(m[2]);
    if (!out[serie] || n > out[serie]) out[serie] = n;
  });
  return out;
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
function signerDevisRecu_(ligne, col, d, devis, reg, com) {
  var numero = String(ligne[col.NUMERO]);
  var ancien = String(col.LIEN_PDF != null ? (ligne[col.LIEN_PDF] || '') : '');
  var lien = ancien;

  if (d.pdf) {
    var blob = Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf',
      d.nomFichier || ('Devis ' + numero + '.pdf'));
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

  var quand = devis.signeLe ? new Date(Number(devis.signeLe)) : new Date();
  majDevis_(numero, {
    LIEN_PDF: lien,
    PREUVE_SIGNATURE: lien,          // le devis signé est sa propre preuve
    SIGNE: 'OUI',
    SIGNATAIRE: devis.signataire || '',
    STATUT: 'SIGNE',
    DATE_STATUT: quand
  });

  tracerServeur_(devis.commercial || com.nom, 'DEVIS SIGNE RECU',
                 'signé à l\'écran' + (devis.signataire ? ' par ' + devis.signataire : ''),
                 numero, d.appareil || '');

  // Un devis signé fait naître ses interventions ; la fonction ne double pas
  // celles qui existent déjà.
  try {
    var nes = genererChantiers_(numero);
    if (nes) {
      tracerServeur_(devis.commercial || com.nom, 'CHANTIERS CREES',
                     nes + ' à planifier', numero, d.appareil || '');
    }
    poserPlanning_(numero, devis.commercial || com.nom, d.appareil || '');
  } catch (eC) {
    tracerServeur_('SYSTEME', 'CHANTIERS ECHEC', String(eC && eC.message || eC), numero, '');
  }

  return { ok: true, signe: true, numero: numero, pdfUrl: lien };
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
        return { ok: true, doublon: true, numero: String(lignes[i][col.NUMERO]),
                 pdfUrl: String(lignes[i][col.LIEN_PDF] || '') };
      }
    }

    // 2. numéro déjà pris par un AUTRE devis -> on en attribue un libre
    var pris = {};
    lignes.forEach(function (r) { pris[String(r[0])] = true; });
    if (pris[String(devis.numero)]) {
      var m = String(devis.numero).match(/^(.+)-(\d+)$/);
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

  // PDF reçu du téléphone -> Drive
  var lienPdf = '', blob = null;
  if (d.pdf) {
    blob = Utilities.newBlob(Utilities.base64Decode(d.pdf), 'application/pdf',
      d.nomFichier || ('Devis ' + devis.numero + '.pdf'));
    lienPdf = dossierDevis_(reg, new Date(devis.date), devis.commercial).createFile(blob).getUrl();
  }

  var c = devis.client || {}, t = devis.totaux || {};
  var controleTarif = controlerTarifs_(devis, reg);
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
    PASSAGES_MOIS: Number(devis.passages) || ''
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

  // e-mails
  try {
    var pj = blob ? [blob] : [];
    var copie = [];
    if (com.email) copie.push(com.email);
    if (reg.email_copie) copie.push(String(reg.email_copie));
    if (d.envoyerClient && c.email) {
      MailApp.sendEmail({
        to: c.email, cc: copie.join(','),
        subject: 'Devis ' + devis.numero + ' — ' + (reg.societe_nom || ''),
        name: String(reg.societe_nom || 'Devis'),
        replyTo: com.email || String(reg.societe_email || ''),
        htmlBody: corpsMail_(devis, reg), attachments: pj
      });
    } else if (copie.length) {
      MailApp.sendEmail({
        to: copie.join(','),
        subject: 'Devis ' + devis.numero + ' — ' + (c.societe || c.contact || ''),
        name: String(reg.societe_nom || 'Devis'),
        htmlBody: 'Devis enregistré par ' + devis.commercial + '.<br>Montant : ' +
                  eur_(t.ttc) + ' TTC.<br>' + (lienPdf ? '<a href="' + lienPdf + '">Ouvrir le PDF</a>' : ''),
        attachments: pj
      });
    }
  } catch (eMail) { /* un mail raté ne doit pas faire échouer la synchro */ }

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
  var nom = 'Devis-' + String(d.numero || 'sans-numero') +
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
  var nums = sh.getRange(2, cNum + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < nums.length; i++) {
    if (String(nums[i][0]).trim() !== String(numero).trim()) continue;
    for (var k in valeurs) {
      if (!valeurs.hasOwnProperty(k)) continue;
      var c = en.indexOf(k);
      if (c >= 0) sh.getRange(i + 2, c + 1).setValue(valeurs[k]);
    }
    return true;
  }
  return false;
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
  /* L'état d'avant : c'est lui qui dit si une « relance » défait une signature. */
  var statutAvant = '';
  if (statut) {
    lireDevis_().forEach(function (x) {
      if (String(x.NUMERO).trim() === num) statutAvant = String(x.STATUT || '').toUpperCase().trim();
    });
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
  if (statut === 'SIGNE') {
    try {
      nes = genererChantiers_(num);
      if (nes) {
        tracerServeur_(com ? com.nom : (d.nom || ''), 'CHANTIERS CREES',
                       nes + ' à planifier', num, d.appareil || '');
      }
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
      annules = annulerChantiers_(num, statut, com ? com.nom : (d.nom || ''), d.appareil || '').length;
    } catch (eA) {
      tracerServeur_('SYSTEME', 'ANNULATION ECHEC', String(eA && eA.message || eA), num, '');
    }
  }
  return { ok: true, statut: statut || '(note seule)', chantiers: nes, annules: annules };
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
function objetsDe_(nom) {
  var sh = SpreadsheetApp.getActive().getSheetByName(nom);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
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
    if (!d || isNaN(d.getTime()) || d < depuis) return;
    var st = String(o.STATUT || '').toUpperCase();
    var ht = Number(o.TOTAL_HT) || 0;
    var mens = Number(o.TOTAL_HT_MENSUEL) || 0;
    var qui = String(o.COMMERCIAL || '').trim() || '(sans nom)';
    if (!par[qui]) par[qui] = { nom: qui, nb: 0, signes: 0, ht: 0, htSigne: 0, mensuelSigne: 0 };
    chiffres.nb++; par[qui].nb++;
    chiffres.ht += ht; par[qui].ht += ht;
    if (st === 'SIGNE') {
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
      note: String(o.NOTE_COMMERCIAL || '')
    });
  });
  devis.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  if (devis.length > 300) devis = devis.slice(0, 300);

  var hier = new Date(); hier.setDate(hier.getDate() - 30); hier.setHours(0, 0, 0, 0);
  var loin = new Date(); loin.setDate(loin.getDate() + 90);
  var chantiers = [];
  objetsDe_(SH.CHANTIERS).forEach(function (o) {
    if (!String(o.ID || '').trim()) return;
    /* Une fiche annulée n'est plus à planifier : elle ne doit pas remonter en
       tête de l'écran comme un chantier sans date. */
    if (String(o.STATUT || '').toUpperCase().trim() === 'ANNULE') return;
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
      heure: o.HEURE ? String(o.HEURE) : '',
      prestataire: String(o.PRESTATAIRE || ''),
      statut: String(o.STATUT || 'A PLANIFIER'),
      arrivee: Number(o.ARRIVEE) || 0, depart: Number(o.DEPART) || 0,
      minutes: Number(o.MINUTES) || 0,
      signalement: String(o.SIGNALEMENT || ''), note: String(o.NOTE || '')
    });
  });
  chantiers.sort(function (a, b) {
    if (!a.date && b.date) return -1;               // à planifier d'abord
    if (a.date && !b.date) return 1;
    return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
  });
  if (chantiers.length > 300) chantiers = chantiers.slice(0, 300);

  var liste = [];
  for (var k in par) if (par.hasOwnProperty(k)) liste.push(par[k]);
  liste.sort(function (a, b) { return b.htSigne - a.htSigne; });

  return {
    ok: true, maj: new Date().getTime(), fenetre: jours,
    chiffres: chiffres, parCommercial: liste,
    devis: devis, chantiers: chantiers,
    prestataires: lirePrestataires_().map(function (p) { return p.nom; }),
    commerciaux: lireCommerciaux_().map(function (c) { return c.nom; })
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

  // Le nom doit exister, sinon le chantier n'apparaîtrait sur aucun téléphone.
  if (v.PRESTATAIRE) {
    var connu = false, n = normNom_(v.PRESTATAIRE);
    lirePrestataires_().forEach(function (p) { if (normNom_(p.nom) === n) { connu = true; v.PRESTATAIRE = p.nom; } });
    if (!connu) return { ok: false, erreur: 'ce prestataire n\'est pas dans la liste' };
  }

  var avant = null;
  objetsDe_(SH.CHANTIERS).forEach(function (o) { if (String(o.ID).trim() === id) avant = o; });
  if (!avant) return { ok: false, erreur: 'chantier introuvable' };

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

  tracerServeur_(com ? com.nom : '', 'CHANTIER PLANIFIE',
                 (v.PRESTATAIRE || quiFinal || '?') + ' \u00b7 ' +
                 (dateFinale ? Utilities.formatDate(new Date(dateFinale), 'Europe/Paris', 'dd/MM/yyyy') : 'sans date') +
                 (v.HEURE ? ' ' + v.HEURE : ''),
                 String(avant.NUMERO || ''), d.appareil || '');

  return { ok: true, id: id, statut: v.STATUT || avant.STATUT };
}

/* Un seul endroit décide de ce que chaque métier reçoit à la connexion. */
function configPour_(role) {
  if (role === 'PRESTATAIRE') return configPrestataire_();
  if (role === 'ADMIN') return configAdmin_();
  return config_();
}

/**
 * Ce que reçoit un compte d'administration : de quoi remplir les listes
 * déroulantes, et rien de plus. Les chiffres et les listes viennent de
 * l'action « tableau », qui se rafraîchit à la demande.
 */
function configAdmin_() {
  var reg = lireReglages_();
  return {
    maj: new Date().toISOString(),
    role: 'ADMIN',
    reglages: {
      societe_nom: String(reg.societe_nom || ''),
      texte_information: String(reg.texte_information || ''),
      version_information: String(reg.version_information || '1')
    },
    commerciaux: lireCommerciaux_().map(function (c) { return c.nom; }),
    prestataires: lirePrestataires_().map(function (p) { return p.nom; })
  };
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
function poserPlanning_(numero, qui, appareil) {
  var bilan;
  try {
    reactiverChantiers_(numero);
    bilan = planifierDevis_(numero);
  } catch (e) {
    tracerServeur_('SYSTEME', 'PLANIFICATION ECHEC',
                   String(e && e.message || e), numero, appareil || '');
    return { poses: [], refuses: [], motif: 'erreur' };
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
  var corps = 'Devis ' + numero + ' signé.\n\n' +
    (bilan.poses.length
      ? bilan.poses.length + ' intervention(s) posée(s) :\n' + dates + '\n'
      : 'Aucune intervention n\'a pu être posée.\n') +
    (bilan.motif ? '\nRien n\'a été planifié : ' + bilan.motif + '.\n' : '') +
    (bilan.refuses.length
      ? '\n' + bilan.refuses.length + ' intervention(s) sans créneau dans les quatre mois ' +
        'qui viennent : elles restent « A PLANIFIER » dans l\'onglet ' + SH.CHANTIERS + '.\n'
      : '') +
    '\nTu peux tout corriger à la main dans le classeur : l\'appli ne réécrit ' +
    'jamais une date ou un nom que tu as posés.\n' +
    SpreadsheetApp.getActive().getUrl();
  try {
    MailApp.sendEmail(dest, 'Planning — devis ' + numero, corps);
  } catch (e) { /* sans importance : le classeur reste la source */ }
  return bilan;
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
  return String((reg && reg.planification_auto) || 'OUI').toUpperCase().trim() !== 'NON';
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
  if (iNom < 0) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues()
    .filter(function (r) {
      return String(r[iNom]).trim() &&
             (iActif < 0 || String(r[iActif]).toUpperCase() !== 'NON');
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
function chargeActuelle_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CHANTIERS);
  var reg = lireReglages_();
  /* Le trajet et le calendrier voyagent avec la charge : tout ce qui cherche
     un créneau les trouve au même endroit, sans relire le classeur.
     « lieu » retient, par salarié et par jour, l'adresse du dernier chantier
     posé : c'est de là qu'il partira pour le suivant. */
  var charge = { jour: {}, semaine: {}, lieu: {},
                 trajet: trajetMinutes_(reg), calcule: trajetCalcule_(reg), routes: {},
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
    var qui = normNom_(v[i][iQui]);
    var d = v[i][iDate];
    if (!qui || !d || !(d instanceof Date)) continue;
    if (iStatut >= 0 && String(v[i][iStatut]).toUpperCase() === 'ANNULE') continue;
    var min = iDur >= 0 ? Number(v[i][iDur]) : 0;
    if (!isFinite(min) || min <= 0) min = 210;
    var h = iHeure >= 0 ? v[i][iHeure] : '';
    if (h instanceof Date) h = ('0' + h.getHours()).slice(-2) + ':' + ('0' + h.getMinutes()).slice(-2);
    poses.push({ qui: qui, date: d, iso: isoJour_(d), heure: String(h || ''), min: min,
                 adresse: adresseComplete_(iAdr >= 0 ? v[i][iAdr] : '', iCp >= 0 ? v[i][iCp] : '',
                                           iVille >= 0 ? v[i][iVille] : ''),
                 rang: i });
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
  var recurrent = String(devis.NATURE || '').toUpperCase().trim() === 'ENTRETIEN';
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
  if (iNum < 0 || iStatut < 0) return [];
  var annules = [];
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][iNum]).trim() !== String(numero).trim()) continue;
    var st = String(v[i][iStatut]).toUpperCase().trim();
    if (st !== 'A PLANIFIER' && st !== 'PLANIFIE' && st !== '') continue;
    if (iArr >= 0 && v[i][iArr]) continue;           // il y est allé
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
    try { MailApp.sendEmail(dest, 'Planning — devis ' + numero + ' annulé', corps); }
    catch (e) { /* le classeur reste la source */ }
  }
  return annules;
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
    if (!pourquoi && nom && estAbsent_(cal, normNom_(nom), isoJour_(d))) pourquoi = nom + ' absent';
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
  try { MailApp.sendEmail(dest, 'Planning — ' + c.length + ' intervention(s) à replacer', corps); }
  catch (e) {}
  return c.length;
}

/* ENTRETIEN (contrat régulier, mensualisé), CHANTIER (fin de chantier) ou
   REMISE (remise en état). Les deux dernières sont des interventions uniques :
   elles ne diffèrent que par ce qu'on y fait, et par le nom sur le devis. */
function natureDevis_(v) {
  var n = String(v || '').toUpperCase().trim();
  if (n === 'ENTRETIEN') return 'ENTRETIEN';
  if (n === 'REMISE' || n === 'REMISE EN ETAT' || n === 'REMISE_EN_ETAT') return 'REMISE';
  return 'CHANTIER';
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

  var reg = lireReglages_();
  var lignes = lignesParDevis_()[String(numero).trim()] || [];

  /* C'est la nature du devis qui commande. Les devis établis avant qu'elle
     existe n'en portent pas : on retombe alors sur l'ancienne règle, le type
     des lignes, pour qu'un contrat signé hier produise les mêmes chantiers
     qu'aujourd'hui. */
  var nature = String(devis.NATURE || '').toUpperCase().trim();
  var recurrent = nature === 'ENTRETIEN';   // une remise en état n'en est pas un
  if (!nature) {
    recurrent = lignes.some(function (l) {
      return String(l.TYPE || '').toUpperCase() === 'MENSUEL';
    });
  }

  var combien = 1;
  if (recurrent) {
    combien = Number(devis.PASSAGES_MOIS) ||
              Number(String(reg.passages_mois_defaut || '4').replace(',', '.')) || 4;
    if (combien < 1) combien = 1;
    if (combien > 31) combien = 31;
  }

  /* Combien de temps ? Le montant divisé par le taux horaire de vente. Pour un
     contrat, le total du devis est celui du mois : un passage en vaut la part.
     Et un chantier plus long qu'une journée se découpe en journées, parce
     qu'une fiche qui déborde ne tient sur aucun planning. */
  var taux = tauxHorairePlanning_(reg);
  var htTotal = Number(devis.TOTAL_HT) || 0;
  var minutesPassage = minutesPour_(recurrent && combien > 0 ? htTotal / combien : htTotal, taux);
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
        DUREE_PREVUE_MIN: lots[p].minutes, LOT: lots[p].lot
      };
      rows.push(en.map(function (h) { return v.hasOwnProperty(h) ? v[h] : ''; }));
      rang++;
    }
  }
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, en.length).setValues(rows);
  return rows.length;
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
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = {};
    en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
    if (!String(o.ID || '').trim()) continue;
    if (normNom_(o.PRESTATAIRE || '') !== moi) continue;
    if (String(o.STATUT || '').toUpperCase().trim() === 'ANNULE') continue;
    if (!o.DATE) continue;                       // pas encore planifié
    var d = new Date(o.DATE);
    if (isNaN(d.getTime()) || d < hier || d > loin) continue;

    // La fiche de travail : ce qui a été vendu, SANS UN SEUL MONTANT.
    var taches = (parDevis[String(o.NUMERO).trim()] || []).map(function (l) {
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
      heure: o.HEURE instanceof Date
        ? Utilities.formatDate(o.HEURE, Session.getScriptTimeZone(), 'HH:mm')
        : String(o.HEURE || ''),
      statut: String(o.STATUT || 'PLANIFIE'),
      arrivee: o.ARRIVEE ? new Date(o.ARRIVEE).getTime() : 0,
      depart: o.DEPART ? new Date(o.DEPART).getTime() : 0,
      minutes: Number(o.MINUTES) || 0,
      faites: String(o.PRESTATIONS_FAITES || '').split('|').filter(function (x) { return x; }),
      signalement: String(o.SIGNALEMENT || ''),
      note: String(o.NOTE || ''),
      taches: taches
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
    for (var k in valeurs) {
      if (!valeurs.hasOwnProperty(k)) continue;
      var c = en.indexOf(k);
      if (c >= 0) sh.getRange(i + 2, c + 1).setValue(valeurs[k]);
    }
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
  if (normNom_(actuel.PRESTATAIRE || '') !== normNom_(personne.nom)) {
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
     [SH.FACTURER, ['DATE_SIGNATURE'],      'dd/mm/yyyy',          105]
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
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.REGLAGES);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (String(r[0]).trim()) out[String(r[0]).trim()] = r[1];
  });
  return out;
}

function lireCatalogue_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.CATALOGUE);
  if (!sh || sh.getLastRow() < 2) return [];
  var large = Math.max(10, sh.getLastColumn());
  return sh.getRange(2, 1, sh.getLastRow() - 1, large).getValues()
    .filter(function (r) { return String(r[1]).trim() && String(r[7]).toUpperCase() !== 'NON'; })
    .map(function (r) {
      return {
        categorie: String(r[0] || 'Divers'), designation: String(r[1]),
        detail: String(r[2] || ''), unite: String(r[3] || ''),
        pu: Number(r[4]) || 0, tva: Number(r[5]) || 20,
        type: String(r[6] || '').toUpperCase() === 'MENSUEL' ? 'MENSUEL' : 'PONCTUEL',
        reference: String(r[8] || '').trim(),
        natures: naturesCatalogue_(r[9])
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
    if (m !== 'ENTRETIEN' && m !== 'CHANTIER' && m !== 'REMISE') return;
    if (vus[m]) return;
    vus[m] = true; sortie.push(m);
  });
  return sortie;
}

/* Les agents actifs. Même forme que lireCommerciaux_, autre population. */
function lirePrestataires_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.PRESTATAIRES);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return String(r[0]).trim() && String(r[3]).toUpperCase() !== 'NON'; })
    .map(function (r) {
      return { nom: String(r[0]).trim(), email: String(r[1] || '').trim(),
               code: String(r[2] || '').trim(), role: 'PRESTATAIRE' };
    });
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
function lireAdmins_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.ADMINS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return String(r[0]).trim() && String(r[3]).toUpperCase() !== 'NON'; })
    .map(function (r) {
      return { nom: String(r[0]).trim(), email: String(r[1] || '').trim(),
               code: String(r[2] || '').trim(), role: 'ADMIN' };
    });
}

function lireCommerciaux_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.COMMERCIAUX);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return String(r[0]).trim() && String(r[3]).toUpperCase() !== 'NON'; })
    .map(function (r) {
      return { nom: String(r[0]).trim(), email: String(r[1] || '').trim(), code: String(r[2] || '').trim() };
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
function controlerTarifs_(devis, reg) {
  var lignes = (devis && devis.lignes) || [];
  if (!lignes.length) return '';

  var cat = {}, parNom = {};
  lireCatalogue_().forEach(function (p) {
    if (p.reference) cat[p.reference] = p;
    parNom[normNom_(p.designation)] = p;
  });

  var max = Number(String(reg.remise_max === undefined ? 0 : reg.remise_max).replace(',', '.'));
  if (!isFinite(max) || max < 0) max = 0;
  if (max > 100) max = 100;

  var ecarts = [];
  lignes.forEach(function (l, i) {
    var rang = 'ligne ' + (i + 1) + ' (' + (l.designation || 'sans nom') + ')';
    var ref = String(l.reference || '').trim();
    var p = ref ? cat[ref] : parNom[normNom_(l.designation || '')];

    if (!p) {
      ecarts.push(rang + ' : hors catalogue');
    } else {
      var attendu = Number(p.pu) || 0, recu = Number(l.pu) || 0;
      if (Math.abs(attendu - recu) > 0.005) {
        ecarts.push(rang + ' : prix ' + recu + ' au lieu de ' + attendu);
      }
    }

    var rem = Number(l.rem) || 0;
    if (rem > max + 0.001) {
      ecarts.push(rang + ' : remise ' + rem + ' % au lieu de ' + max + ' % maximum');
    }
  });

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

function corpsMail_(devis, reg) {
  var d = new Date(devis.validite);
  var fr = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
  return '<p>Bonjour ' + String((devis.client || {}).contact || '') + ',</p>' +
    '<p>Veuillez trouver ci-joint le devis <strong>' + devis.numero + '</strong> d\'un montant de <strong>' +
    eur_((devis.totaux || {}).ttc) + ' TTC</strong>, valable jusqu\'au ' + fr + '.</p>' +
    '<p>Je reste à votre disposition.</p><p>' + devis.commercial + '<br>' +
    String(reg.societe_nom || '') + '<br>' + String(reg.societe_tel || '') + '</p>';
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
  var sh = SpreadsheetApp.getActive().getSheetByName(SH.DEVIS);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var en = v[0].map(function (x) { return String(x).trim(); });
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (!String(v[i][en.indexOf('NUMERO')] || '').trim()) continue;
    var o = { _ligne: i + 1 };
    en.forEach(function (h, c) { if (h) o[h] = v[i][c]; });
    out.push(o);
  }
  return out;
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
      MailApp.sendEmail(c.email, 'Tes devis à suivre — ' + n + ' point' + (n > 1 ? 's' : ''), corps);
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
    MailApp.sendEmail(dest, 'Devis — récapitulatif de la semaine', corps);
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
