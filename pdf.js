/* Génération du devis en PDF, directement dans l'appareil (fonctionne sans réseau).
   Mise en page calquée sur le devis type de BREIZH BRILLANCE :
   postes regroupés avec sous-totaux, remise par ligne, bloc de totaux,
   conditions de paiement, coordonnées bancaires et mentions légales.
   Dépend de jspdf.umd.min.js et police.js — aucun appel réseau. */

var PDF = (function () {

  var M = 10;            // marge gauche (mm)
  var W = 210, H = 297;  // A4
  var R = 200;           // bord droit du contenu
  var F = 'LibSans';     // police intégrée au PDF

  var NOIR = [17, 24, 39], GRIS = [107, 114, 128], TRAIT = [214, 219, 226];
  var MARQUE = [0, 76, 146];          // bleu du logo
  var ZEBRE = [246, 248, 250];        // fond d'une ligne sur deux
  var FOND_ST = [232, 238, 245];      // fond des sous-totaux

  /* Colonnes du tableau, en millimètres.
     g = bord gauche pour le texte aligné à gauche, d = bord droit pour les nombres. */
  /* La remise n'a plus de colonne : elle est la même sur toutes les lignes, et
     la répéter quatorze fois ne dit rien de plus qu'une ligne en bas de page.
     Les 20 mm libérés vont à la désignation, qui en manquait. */
  var COL = {
    ref: { g: M + 2, l: 20 },
    des: { g: 32, l: 63 },
    qte: { d: 114 },
    uni: { g: 117, l: 15 },
    pu:  { d: 155 },
    tva: { d: 173 },
    ht:  { d: R - 2 }
  };

  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
              'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function nombre(n, dec) {
    var v = (Number(n) || 0).toFixed(dec === undefined ? 2 : dec).split('.');
    return v[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (v[1] ? ',' + v[1] : '');
  }
  function eur(n, dec) { return nombre(n, dec) + ' €'; }
  function dateFr(d) {
    d = new Date(d);
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
  }
  function dateLongue(d) {
    d = new Date(d);
    return 'Le ' + JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + ' ' + d.getFullYear();
  }
  /* Une signature recueillie sur l'écran vaut par le moment où elle est
     donnée : la date seule ne suffit pas, l'heure fait partie de la preuve. */
  function horodate(d) {
    d = new Date(d);
    if (isNaN(d.getTime())) return '';
    return dateFr(d) + ' à ' + ('0' + d.getHours()).slice(-2) + 'h' + ('0' + d.getMinutes()).slice(-2);
  }
  function txt(s) { return String(s == null ? '' : s).replace(/ /g, ' '); }

  /* Brut : quantité fois prix, remise non déduite. */
  function brutLigne(l) {
    return Math.round((Number(l.qte) || 0) * (Number(l.pu) || 0) * 100) / 100;
  }
  function montantLigne(l) {
    return Math.round((Number(l.qte) || 0) * (Number(l.pu) || 0) *
                      (1 - (Number(l.rem) || 0) / 100) * 100) / 100;
  }

  /* Regroupe les lignes par poste, dans leur ordre d'apparition.
     Quand toutes les lignes d'un poste portent la même quantité, on l'annonce
     dans le titre du poste — « NETTOYAGE DES VITRAGES ( 35 m2 ) ». */
  function grouper(lignes) {
    var ordre = [], par = {};
    (lignes || []).forEach(function (l) {
      var k = txt(l.categorie).trim() || 'Prestations';
      if (!par[k]) { par[k] = []; ordre.push(k); }
      par[k].push(l);
    });
    return ordre.map(function (k) {
      var ls = par[k], q = null, u = null, meme = true;
      ls.forEach(function (l, i) {
        if (i === 0) { q = Number(l.qte) || 0; u = txt(l.unite); }
        else if ((Number(l.qte) || 0) !== q || txt(l.unite) !== u) meme = false;
      });
      return {
        // le poste passe en capitales, pas l'unité : « VITRERIE ( 24 m² ) »
        titre: k.toUpperCase() + (meme && q && q !== 1 ? ' ( ' + nombre(q, 0) + ' ' + u + ' )' : ''),
        lignes: ls,
        sousTotal: Math.round(ls.reduce(function (s, l) { return s + brutLigne(l); }, 0) * 100) / 100
      };
    });
  }

  function construire(devis, reg) {
    var doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });

    doc.addFileToVFS('LibSans.ttf', POLICE.regular);
    doc.addFont('LibSans.ttf', F, 'normal');
    doc.addFileToVFS('LibSans-Bold.ttf', POLICE.bold);
    doc.addFont('LibSans-Bold.ttf', F, 'bold');

    function police(style, taille, couleur) {
      doc.setFont(F, style).setFontSize(taille);
      var c = couleur || NOIR;
      doc.setTextColor(c[0], c[1], c[2]);
    }
    function couper(s, largeur) { return doc.splitTextToSize(txt(s), largeur); }
    function fond(c) { doc.setFillColor(c[0], c[1], c[2]); }
    function ligneH(y, couleur) {
      var c = couleur || TRAIT;
      doc.setDrawColor(c[0], c[1], c[2]).setLineWidth(0.15).line(M, y, R, y);
    }

    var c = devis.client || {};
    var particulier = String(c.type || '').toUpperCase() === 'PART';
    var groupes = grouper(devis.lignes);
    var y, page = 1;

    /* ---------------- en-tête ---------------- */
    var basLogo = 12;
    if (typeof LOGO !== 'undefined' && LOGO) {
      try {
        var p = doc.getImageProperties(LOGO);
        var hL = 20, wL = hL * p.width / p.height;
        if (wL > 34) { wL = 34; hL = wL * p.height / p.width; }
        doc.addImage(LOGO, 'PNG', M + 4, 10, wL, hL);
        basLogo = 10 + hL;
      } catch (e) {}
    }

    // titre du devis, à droite
    police('bold', 13.5, [31, 45, 66]);
    var titre = txt(devis.objet).trim()
      ? 'DEVIS - ' + txt(devis.objet).toUpperCase()
      : 'DEVIS';
    var lt = couper(titre, 92);
    y = 15;
    lt.slice(0, 3).forEach(function (l) { doc.text(l, R, y, { align: 'right' }); y += 6.4; });

    /* ---------------- émetteur / client ---------------- */
    var yB = Math.max(basLogo + 6, y + 4);

    // Forme juridique, capital et immatriculation RCS : obligatoires sur un
    // document commercial émis par une société. Le capital n'est répété que si
    // la forme juridique ne le mentionne pas déjà.
    var forme = txt(reg.societe_forme).trim();
    var capitalDitDansForme = /capital/i.test(forme);
    var gauche = [{ t: txt(reg.societe_nom).toUpperCase(), b: true }];
    [forme,
     reg.societe_adresse, reg.societe_cp_ville, 'FRANCE',
     txt(reg.societe_tel).trim() ? 'Port. : ' + txt(reg.societe_tel) : '',
     reg.societe_email, reg.societe_site,
     txt(reg.societe_tva).trim() ? 'N° TVA Intracommunautaire : ' + txt(reg.societe_tva) : '',
     txt(reg.societe_siret).trim() ? 'N° SIRET : ' + txt(reg.societe_siret) : '',
     txt(reg.societe_rcs).trim() ? txt(reg.societe_rcs) : '',
     (!capitalDitDansForme && txt(reg.societe_capital).trim()) ? 'Capital : ' + txt(reg.societe_capital) : ''
    ].forEach(function (l) { if (txt(l).trim()) gauche.push({ t: txt(l) }); });

    var droite = [];
    var nomClient = txt(c.societe).trim() || txt(c.contact).trim();
    if (nomClient) droite.push({ t: nomClient, b: true });
    if (txt(c.societe).trim() && txt(c.contact).trim()) droite.push({ t: txt(c.contact) });
    if (txt(c.adresse).trim()) droite.push({ t: txt(c.adresse) });
    if ((txt(c.cp) + txt(c.ville)).trim()) droite.push({ t: (txt(c.cp) + ' ' + txt(c.ville)).trim() });
    if (txt(c.tel).trim()) droite.push({ t: 'Port. : ' + txt(c.tel) });
    if (txt(c.email).trim()) droite.push({ t: 'Email : ' + txt(c.email) });
    if (txt(c.siret).trim()) droite.push({ t: 'N° SIRET : ' + txt(c.siret) });
    if (txt(c.tva).trim()) droite.push({ t: 'N° TVA : ' + txt(c.tva) });

    function bloc(lignes, x, largeur) {
      var yy = yB;
      lignes.forEach(function (l) {
        police(l.b ? 'bold' : 'normal', 9, l.b ? NOIR : [55, 65, 81]);
        couper(l.t, largeur).forEach(function (t) { doc.text(t, x, yy); yy += 4.3; });
      });
      return yy;
    }
    var basG = bloc(gauche, M + 4, 85);
    var basD = bloc(droite, 118, R - 118);

    /* ---------------- numéro et date ---------------- */
    y = Math.max(basG, basD) + 5;
    police('bold', 10);
    doc.text('DEVIS N° ' + txt(devis.numero), M + 4, y);
    police('normal', 8.5, [55, 65, 81]);
    doc.text(dateLongue(devis.date), R, y, { align: 'right' });
    y += 4;

    /* ---------------- tableau ---------------- */
    var BAS_UTILE = 246;          // au-delà, on passe à la page suivante

    function enTete(yy) {
      police('bold', 7.2, [55, 65, 81]);
      doc.text('Référence', COL.ref.g, yy + 4.4);
      doc.text('Désignation', COL.des.g, yy + 4.4);
      doc.text('Quantité', COL.qte.d, yy + 4.4, { align: 'right' });
      doc.text('Unité', COL.uni.g, yy + 4.4);
      doc.text('PU Vente', COL.pu.d, yy + 4.4, { align: 'right' });
      doc.text('TVA', COL.tva.d, yy + 4.4, { align: 'right' });
      doc.text('Montant HT', COL.ht.d, yy + 4.4, { align: 'right' });
      ligneH(yy + 6.4);
      return yy + 6.8;
    }

    function nouvellePage() {
      doc.addPage(); page++;
      var yy = 14;
      police('bold', 9);
      doc.text('DEVIS N° ' + txt(devis.numero), M + 4, yy);
      police('normal', 8, [55, 65, 81]);
      doc.text(dateLongue(devis.date), R, yy, { align: 'right' });
      return enTete(yy + 3);
    }

    y = enTete(y);
    var zebre = 0;

    groupes.forEach(function (g) {
      // titre du poste
      police('bold', 8.6, MARQUE);
      var tg = couper(g.titre, COL.des.l);
      var hG = 2.6 + tg.length * 4;
      // un titre de poste ne reste jamais seul en bas de page :
      // on exige la place d'au moins une prestation en dessous
      if (y + hG + 12 > BAS_UTILE) { y = nouvellePage(); zebre = 0; }
      var yg = y + 4.4;
      tg.forEach(function (t) {
        doc.text(t, COL.des.g, yg);
        doc.setDrawColor(MARQUE[0], MARQUE[1], MARQUE[2]).setLineWidth(0.25)
           .line(COL.des.g, yg + 0.9, COL.des.g + doc.getTextWidth(t), yg + 0.9);
        yg += 4;
      });
      y += hG;
      ligneH(y);

      // lignes du poste
      g.lignes.forEach(function (l) {
        police('normal', 8.2);
        var des = couper(l.designation || '(sans désignation)', COL.des.l);
        var det = txt(l.detail).trim() ? couper(l.detail, COL.des.l) : [];
        var hL = 2.6 + des.length * 3.9 + (det.length ? det.length * 3.2 + 0.6 : 0);
        if (hL < 8) hL = 8;
        if (y + hL > BAS_UTILE) { y = nouvellePage(); zebre = 0; }

        if (zebre % 2 === 1) { fond(ZEBRE); doc.rect(M, y, R - M, hL, 'F'); }
        zebre++;

        var yl = y + 4.6;
        police('normal', 8.2, [55, 65, 81]);
        if (txt(l.reference).trim()) doc.text(couper(l.reference, COL.ref.l)[0], COL.ref.g, yl);

        police('normal', 8.2);
        doc.text(des, COL.des.g, yl);
        var yd = yl + (des.length - 1) * 3.9;
        if (det.length) {
          police('normal', 7, GRIS);
          doc.text(det, COL.des.g, yd + 3.4);
        }

        police('normal', 8.2);
        doc.text(nombre(l.qte, 2), COL.qte.d, yl, { align: 'right' });
        doc.text(couper(l.unite, COL.uni.l)[0] || '', COL.uni.g, yl);
        doc.text(eur(l.pu, 4), COL.pu.d, yl, { align: 'right' });
        doc.text(nombre(l.tva || 0, 2), COL.tva.d, yl, { align: 'right' });
        police('bold', 8.2);
        // Le montant de la ligne reste brut : la remise se déduit une fois, en
        // bas, sous les yeux du client, et non quatorze fois en silence.
        doc.text(eur(brutLigne(l)), COL.ht.d, yl, { align: 'right' });

        y += hL;
        ligneH(y);
      });

      // sous-total du poste
      if (y + 8 > BAS_UTILE) { y = nouvellePage(); zebre = 0; }
      fond(FOND_ST); doc.rect(M, y, R - M, 8, 'F');
      police('bold', 8.4);
      doc.text('Sous Total', COL.des.g, y + 5.3);
      doc.text(eur(g.sousTotal), COL.ht.d, y + 5.3, { align: 'right' });
      y += 8;
      ligneH(y);
      zebre = 0;
    });

    /* ---------------- totaux ---------------- */
    var t = devis.totaux || {};
    // une ligne de TVA par taux réellement utilisé
    var parTaux = {}, ordreTaux = [];
    (devis.lignes || []).forEach(function (l) {
      var taux = Number(l.tva) || 0;
      if (!parTaux[taux]) { parTaux[taux] = 0; ordreTaux.push(taux); }
      parTaux[taux] += montantLigne(l) * taux / 100;
    });
    ordreTaux.sort(function (a, b) { return a - b; });

    /* Le brut se recalcule à partir des lignes plutôt que de se lire dans les
       totaux : un devis établi avant la remise unique n'a pas ce champ, et son
       PDF doit continuer à sortir juste. */
    var brutTotal = Math.round((devis.lignes || []).reduce(
      function (s, l) { return s + brutLigne(l); }, 0) * 100) / 100;
    var remiseEur = Math.round((brutTotal - (Number(t.ht) || 0)) * 100) / 100;
    var remisePct = Number(devis.remise) || 0;
    var avecRemise = remiseEur > 0.005;

    var hBoite = 18 + ordreTaux.length * 5.4 + (avecRemise ? 10.8 : 0);
    if (y + hBoite + 10 > BAS_UTILE) { y = nouvellePage(); }
    y += 6;

    var xB = 118, wB = R - xB;
    fond(MARQUE); doc.rect(xB, y, wB, hBoite, 'F');
    var yt = y + 6.2;
    if (avecRemise) {
      police('normal', 9, [255, 255, 255]);
      doc.text('Sous-total HT', xB + wB - 52, yt, { align: 'right' });
      doc.text(eur(brutTotal), R - 4, yt, { align: 'right' });
      yt += 5.4;
      doc.text('Remise' + (remisePct ? ' ( ' + nombre(remisePct, 2) + ' % )' : ''),
               xB + wB - 52, yt, { align: 'right' });
      doc.text('- ' + eur(remiseEur), R - 4, yt, { align: 'right' });
      yt += 5.4;
    }
    police('normal', 9, [255, 255, 255]);
    doc.text('Total HT', xB + wB - 52, yt, { align: 'right' });
    doc.text(eur(t.ht), R - 4, yt, { align: 'right' });
    yt += 5.4;
    ordreTaux.forEach(function (taux) {
      police('normal', 9, [255, 255, 255]);
      doc.text('TVA ( ' + nombre(taux, 0) + ' % )', xB + wB - 52, yt, { align: 'right' });
      doc.text(eur(Math.round(parTaux[taux] * 100) / 100), R - 4, yt, { align: 'right' });
      yt += 5.4;
    });
    police('bold', 12, [255, 255, 255]);
    doc.text('Total TTC', xB + wB - 52, yt + 1.4, { align: 'right' });
    doc.text(eur(t.ttc), R - 4, yt + 1.4, { align: 'right' });

    /* ---------------- conditions de paiement, à gauche ---------------- */
    var yC = y;
    police('bold', 8);
    doc.text('Conditions de paiement :', M + 4, yC + 4);
    police('normal', 8, [55, 65, 81]);
    var pct = Number(reg.paiement_pct);
    if (!pct && pct !== 0) pct = 100;
    var ligneP = '• ' + nombre(pct, 2) + ' % soit ' + eur((Number(t.ttc) || 0) * pct / 100) +
                 ' : ' + (txt(reg.conditions_paiement).trim() || 'Paiement comptant.');
    var lp = couper(ligneP, 100);
    doc.text(lp, M + 4, yC + 9);
    var basC = yC + 9 + lp.length * 3.6;

    /* ---------------- coordonnées bancaires ---------------- */
    y = Math.max(y + hBoite, basC) + 7;
    var banque = [
      txt(reg.banque_nom).trim() ? 'Coordonnées bancaires : ' + txt(reg.banque_nom) : '',
      txt(reg.banque_iban).trim() ? 'IBAN : ' + txt(reg.banque_iban) : '',
      txt(reg.banque_bic).trim() ? 'BIC/SWIFT : ' + txt(reg.banque_bic) : ''
    ].filter(function (x) { return x; });
    if (banque.length) {
      if (y + banque.length * 4 > BAS_UTILE) { y = nouvellePage(); }
      police('normal', 8, [55, 65, 81]);
      banque.forEach(function (l) { doc.text(l, M + 4, y); y += 4; });
      y += 2;
    }

    /* ---------------- précisions ---------------- */
    if (txt(devis.notes).trim()) {
      police('normal', 8.2);
      var nn = couper(devis.notes, R - M - 10);
      var hN = 11 + nn.length * 3.8;
      if (y + hN > BAS_UTILE) { y = nouvellePage(); }
      fond([246, 247, 249]); doc.roundedRect(M, y, R - M, hN, 1.5, 1.5, 'F');
      police('bold', 8);
      doc.text('Précisions :', M + 4, y + 5.5);
      police('normal', 8.2);
      doc.text(nn, M + 4, y + 10);
      y += hN + 4;
    }

    /* ---------------- signature ---------------- */
    var hS = 30, xS = 118, wS = R - xS;
    if (y + hS > BAS_UTILE) { y = nouvellePage(); }
    doc.setDrawColor(TRAIT[0], TRAIT[1], TRAIT[2]).setLineWidth(0.2)
       .roundedRect(xS, y, wS, hS, 1.5, 1.5);
    police('normal', 7, GRIS);
    var mentionSig = txt(reg.mention_manuscrite).trim() || 'Bon pour accord';
    if (devis.signature) {
      // La mention est portée par le document : le client ne la recopie pas,
      // il l'accepte en signant. Ce qui doit apparaître en revanche, c'est le
      // moment exact de la signature — c'est lui qui date l'accord, et il peut
      // être postérieur à l'établissement du devis.
      doc.text('« ' + mentionSig + ' » — ' + txt(devis.signataire || c.contact || ''), xS + 3, y + 4.8);
      doc.text('Signé le ' + horodate(devis.signeLe || devis.date), xS + 3, y + 8.2);
      try { doc.addImage(devis.signature, 'PNG', xS + 3, y + 9.6, wS - 6, hS - 12.6, undefined, 'FAST'); } catch (e) {}
    } else {
      doc.text('Date, signature du client précédée de la mention', xS + 3, y + 4.8);
      var mm = couper('« ' + mentionSig + ' »', wS - 6);
      doc.text(mm, xS + 3, y + 8.2);
    }
    police('normal', 7, GRIS);
    var infos = ['Devis valable jusqu\'au ' + dateFr(devis.validite),
                 'Établi par ' + txt(devis.commercial)];
    if (txt(devis.delai).trim()) infos.push('Intervention : ' + txt(devis.delai));
    var yi = y + 4.8;
    infos.forEach(function (l) { doc.text(l, M + 4, yi); yi += 3.4; });

    /* ---------------- formulaire de rétractation ----------------
       Un contrat signé au domicile d'un particulier est conclu hors
       établissement : le formulaire détachable doit accompagner le document.
       Se désactive par le réglage bordereau_retractation = NON. */
    if (particulier && String(txt(reg.bordereau_retractation) || 'OUI').toUpperCase() !== 'NON') {
      doc.addPage();
      var yr = 22;
      police('bold', 12, MARQUE);
      doc.text('FORMULAIRE DE RÉTRACTATION', M + 4, yr);
      yr += 6;
      police('normal', 8, GRIS);
      doc.text('À compléter et à renvoyer uniquement si vous souhaitez vous rétracter du contrat.', M + 4, yr);
      yr += 9;

      police('normal', 9.5);
      var dest = ['À l\'attention de ' + txt(reg.societe_nom) + ' :',
                  [txt(reg.societe_adresse), txt(reg.societe_cp_ville)].filter(function(x){return x;}).join(' — '),
                  txt(reg.societe_email)].filter(function (x) { return txt(x).trim(); });
      dest.forEach(function (l) { doc.text(txt(l), M + 4, yr); yr += 5; });
      yr += 4;

      var corps = couper('Je vous notifie par la présente ma rétractation du contrat portant sur la ' +
        'prestation de services ci-dessous :', R - M - 8);
      doc.text(corps, M + 4, yr);
      yr += corps.length * 5 + 4;

      [['Devis n°', txt(devis.numero)],
       ['Commandé le', dateFr(devis.date)],
       ['Nom du consommateur', txt(devis.signataire || c.contact || '')],
       ['Adresse du consommateur', [txt(c.adresse), txt(c.cp), txt(c.ville)]
          .filter(function (x) { return x.trim(); }).join(' ')],
       ['Date', ''],
       ['Signature du consommateur', '(uniquement en cas de notification sur papier)']
      ].forEach(function (l) {
        police('normal', 9.5);
        doc.text(l[0] + ' :', M + 4, yr);
        if (l[1]) {
          police('normal', 9.5, [55, 65, 81]);
          doc.text(couper(l[1], R - M - 62)[0] || '', M + 60, yr);
        }
        doc.setDrawColor(TRAIT[0], TRAIT[1], TRAIT[2]).setLineWidth(0.2)
           .line(M + 58, yr + 1.6, R - 4, yr + 1.6);
        yr += l[0] === 'Signature du consommateur' ? 22 : 11;
      });

      yr += 4;
      police('normal', 7.6, GRIS);
      var rappel = couper('Ce droit s\'exerce dans un délai de quatorze jours à compter de la signature, ' +
        'sans avoir à motiver votre décision ni à supporter de pénalité. Si vous demandez expressément ' +
        'que l\'exécution commence avant la fin de ce délai, vous restez redevable des prestations ' +
        'déjà réalisées à la date de votre rétractation.', R - M - 8);
      doc.text(rappel, M + 4, yr);
    }

    /* ---------------- pied de page sur toutes les pages ---------------- */
    var pied = [
      txt(reg.assurance_rc),
      particulier ? txt(reg.mediateur) : '',
      txt(reg.clause_reserve),
      txt(reg.mentions_penalites),
      particulier ? txt(reg.mentions_credit_impot) : '',
      particulier ? txt(reg.mentions_particulier) : '',
      txt(reg.mentions_bas)
    ].filter(function (x) { return x.trim(); });

    var n = doc.getNumberOfPages();
    for (var pg = 1; pg <= n; pg++) {
      doc.setPage(pg);
      police('normal', 5.6, [90, 98, 110]);
      var yp = 262;
      pied.forEach(function (b) {
        var ll = couper(b, R - M - 4);
        doc.text(ll, M + 4, yp);
        yp += ll.length * 2.4 + 1;
      });
      doc.setDrawColor(TRAIT[0], TRAIT[1], TRAIT[2]).setLineWidth(0.15).line(M, 288, R, 288);
      police('normal', 6.2, GRIS);
      doc.text(txt(reg.societe_nom), M + 4, 292);
      doc.text('Page ' + pg + ' / ' + n, R - 4, 292, { align: 'right' });
    }

    return doc;
  }

  function nomFichier(devis) {
    var src = String((devis.client || {}).societe || (devis.client || {}).contact || 'client');
    var cl = src.normalize ? src.normalize('NFD').replace(/[̀-ͯ]/g, '') : src;
    cl = cl.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
    return 'Devis-' + devis.numero + (cl ? '-' + cl : '') + '.pdf';
  }

  return {
    doc: construire,
    blob: function (devis, reg) { return construire(devis, reg).output('blob'); },
    base64: function (devis, reg) {
      var s = construire(devis, reg).output('datauristring');
      return s.substring(s.indexOf(',') + 1);
    },
    nomFichier: nomFichier,
    montantLigne: montantLigne,
    brutLigne: brutLigne,
    eur: eur,
    dateFr: dateFr
  };
})();
