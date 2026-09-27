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
  BORD: 'TABLEAU DE BORD'
};

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
  creerOnglet_(ss, SH.CATALOGUE, ['CATEGORIE', 'DESIGNATION', 'DETAIL', 'UNITE', 'PU_HT', 'TVA', 'TYPE', 'ACTIF']);
  creerOnglet_(ss, SH.COMMERCIAUX, ['NOM', 'EMAIL', 'CODE', 'ACTIF']);
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
  'MOTIF_REFUS', 'RELANCE_LE', 'DATE_STATUT', 'PREUVE_SIGNATURE', 'NOTE_COMMERCIAL'
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
  ['validite_jours', '30', 'Durée de validité du devis en jours'],
  ['conditions_reglement', 'Paiement à 30 jours à réception de facture. Pénalités de retard : 3 fois le taux d\'intérêt légal. Indemnité forfaitaire de recouvrement : 40 €.', 'Bas de devis'],
  ['mentions_bas', 'Devis gratuit. Il doit être retourné daté et signé avec la mention « Bon pour accord ».', 'Bas de devis'],
  ['mentions_particulier', 'Contrat conclu hors établissement : le client particulier dispose d\'un délai de rétractation de 14 jours à compter de la signature (art. L221-18 du Code de la consommation), sans motif ni pénalité. À faire valider par votre conseil.', 'Imprimé uniquement sur les devis aux particuliers'],
  ['prefixe_devis', 'DEV', 'Numéro : DEV-2026-KL-0001 (KL = initiales du commercial)'],
  ['dossier_racine_id', '', 'Dossier Drive racine — rempli automatiquement'],
  ['email_copie', '', 'Adresse qui reçoit une copie de chaque devis'],
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
  ['Remise en état des sols', 'Nettoyage approfondi des plinthes et angles', '', 'm2', 0.20, 10, 'PONCTUEL', 'OUI'],
  ['Remise en état des sols', 'Aspiration complète des sols', '', 'm2', 0.40, 10, 'PONCTUEL', 'OUI'],
  ['Remise en état des sols', 'Décapage des sols au décapant laitance', '', 'm2', 0.50, 10, 'PONCTUEL', 'OUI'],
  ['Remise en état des sols', 'Lavage humide et désinfection des sols', '', 'm2', 0.45, 10, 'PONCTUEL', 'OUI'],
  ['Nettoyage des vitrages et menuiseries', 'Nettoyage des vitrages intérieurs/extérieurs', '', 'm2', 8, 10, 'PONCTUEL', 'OUI'],
  ['Nettoyage des vitrages et menuiseries', 'Nettoyage complet des menuiseries, cadres et rails', '', 'm2', 4, 10, 'PONCTUEL', 'OUI'],
  ['Nettoyage des vitrages et menuiseries', 'Nettoyage des volets roulants', '', 'm2', 2, 10, 'PONCTUEL', 'OUI'],
  ['Remise en état de la cuisine', 'Nettoyage intérieur de la cuisine', '', 'forfait', 30, 10, 'PONCTUEL', 'OUI'],
  ['Remise en état de la cuisine', 'Nettoyage extérieur de la cuisine', '', 'forfait', 20, 10, 'PONCTUEL', 'OUI'],
  ['Chambres et pièces diverses', 'Nettoyage intérieur/extérieur des étagères, meubles, moulures et surfaces en relief', '', 'pièce(s)', 10, 10, 'PONCTUEL', 'OUI'],
  ['Nettoyage des sanitaires et pièces d\'eau', 'Nettoyage et désinfection WC et lavabos', '', 'pièce(s)', 40, 10, 'PONCTUEL', 'OUI'],
  ['Nettoyage des sanitaires et pièces d\'eau', 'Nettoyage robinetteries et faïences', '', 'pièce(s)', 15, 10, 'PONCTUEL', 'OUI'],
  ['Nettoyage des sanitaires et pièces d\'eau', 'Nettoyage parois vitrées', '', 'pièce(s)', 30, 10, 'PONCTUEL', 'OUI'],
  ['Finitions générales et livraison', 'Contrôle qualité et reprises générales', '', 'forfait', 10, 10, 'PONCTUEL', 'OUI']
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
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 8).clearContent();
  sh.getRange(2, 1, CATALOGUE_DEFAUT_.length, 8).setValues(CATALOGUE_DEFAUT_);
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
    var actions = ['connexion', 'config', 'sync', 'photo', 'journal', 'statut'];
    if (actions.indexOf(d.action) < 0) return reponse_({ ok: false, erreur: 'action inconnue' });

    // Un seul et même refus, que le nom soit inconnu ou le code faux.
    if (tropDEssais_(d.nom)) {
      return reponse_({ ok: false, refus: true, erreur: 'Trop d\'essais. Réessaie dans un quart d\'heure.' });
    }
    var com = trouverCommercial_(d.nom);
    if (!com || (com.code && String(d.code || '') !== com.code)) {
      noterEchec_(d.nom);
      // On ne journalise que les noms qui existent : sinon, n'importe qui
      // pourrait remplir le journal en essayant des noms au hasard.
      if (com) tracerServeur_(com.nom, 'CODE REFUSE', '', '', d.appareil || '');
      return reponse_({ ok: false, refus: true, erreur: 'Nom ou code incorrect' });
    }

    if (d.action === 'connexion') {
      tracerServeur_(com.nom, 'CONNEXION VALIDEE', '', '', d.appareil || '');
      return reponse_({ ok: true, nom: com.nom, config: config_() });
    }
    if (d.action === 'journal') {
      var evs = (d.evenements || []).slice(0, 300).map(function (e) {
        return { t: e.t, nom: e.nom || com.nom, action: e.action, detail: e.detail,
                 numero: e.numero, appareil: d.appareil || '', source: 'APPAREIL' };
      });
      tracer_(evs);
      return reponse_({ ok: true, recus: evs.length });
    }
    if (d.action === 'config') return reponse_({ ok: true, config: config_() });
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
    DELAI: devis.delai || ''
  };
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
    SIGNE: statut === 'SIGNE' ? 'OUI' : 'NON',
    NOTE_COMMERCIAL: note
  } : { NOTE_COMMERCIAL: note };
  var trouve = majDevis_(num, v);

  tracerServeur_(com ? com.nom : (d.nom || ''),
                 statut ? ('RESULTAT ' + statut) : 'NOTE DU COMMERCIAL',
                 statut ? (v.MOTIF_REFUS || (d.relance ? 'relance le ' + d.relance : '')) : note.slice(0, 120),
                 num, d.appareil || '');

  // Le devis n'est pas encore arrivé : l'appareil réessaiera au prochain envoi.
  if (!trouve) return { ok: false, erreur: 'devis introuvable dans le classeur' };
  return { ok: true, statut: statut || '(note seule)' };
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
  return sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues()
    .filter(function (r) { return String(r[1]).trim() && String(r[7]).toUpperCase() !== 'NON'; })
    .map(function (r) {
      return {
        categorie: String(r[0] || 'Divers'), designation: String(r[1]),
        detail: String(r[2] || ''), unite: String(r[3] || ''),
        pu: Number(r[4]) || 0, tva: Number(r[5]) || 20,
        type: String(r[6] || '').toUpperCase() === 'MENSUEL' ? 'MENSUEL' : 'PONCTUEL'
      };
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

/** Montant HT d'une ligne, remise de ligne déduite. */
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
    expires + ' expiré(s) · ' + aFacturer + ' à facturer · ' + envoyes + ' rappel(s) envoyé(s)',
    '', '');
  return { expires: expires, aFacturer: aFacturer, rappels: envoyes };
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
