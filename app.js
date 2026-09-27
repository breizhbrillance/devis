/* Application de devis — fonctionne entièrement hors connexion.
   Les devis sont créés et mis en PDF dans l'appareil, puis envoyés
   au Google Sheet dès qu'il y a du réseau. */

/* ====================== ÉTAT ====================== */
var CFG = null;            // {reglages, catalogue, commerciaux, sel, maj}
var LIGNES = [];
var ETAPE = 1;
var TYPE = null;           // 'PRO' ou 'PART' — choisi au début de chaque devis
var PLUS2ANS = null;       // particulier : logement de plus de deux ans (true/false)
var TAUX = null;           // taux de TVA du devis, déduit des deux réponses ci-dessus
var CLIENTS = [];          // répertoire local, reconstruit depuis les devis déjà faits
var SUGG = [];             // suggestions actuellement affichées
var SURF = {ligne:null, pieces:[]};
var ECRAN_AVANT = 1;       // d'où l'on vient quand on ouvre « Mes devis »
var PHOTO_RETOUR = 6;      // d'où l'on vient quand on ouvre les photos d'un devis
var TERMINE_RETOUR = 0;    // 6 = l'écran Terminé a été ouvert depuis « Mes devis »
var ANNUAIRE = 'https://recherche-entreprises.api.gouv.fr/search';
var DERNIER = null;        // dernier devis enregistré (pour le partage)
var EN_COURS = false;
var APPAREIL = null;

/* ====================== OUTILS ====================== */
function $(id){ return document.getElementById(id); }
function val(id){ var e=$(id); return e ? e.value.trim() : ''; }
function ech(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
/* Espaces insécables : sans elles, « 1 200,00 € TTC » se coupe en fin de ligne
   et le commercial lit « 1 200,00 » d'un côté, « € TTC » de l'autre. */
function eur(n){ var v=(Math.round((Number(n)||0)*100)/100).toFixed(2).split('.');
  return v[0].replace(/\B(?=(\d{3})+(?!\d))/g,'\u202f')+','+v[1]+'\u00a0€'; }
function erreur(m){ var e=$('erreur'); if(!m){e.classList.add('hide');return;}
  e.textContent=m; e.classList.remove('hide'); window.scrollTo(0,0); }

/* ---- retour immédiat quand on appuie sur un bouton ---- */

/* iOS n'applique :active que si la page écoute le toucher */
document.addEventListener('touchstart', function(){}, {passive:true});

/* Petite vibration là où c'est disponible (Android) ; ignorée ailleurs. */
function vibrer(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms||8); }catch(e){} }

/* Met un bouton en « travail en cours » : rond qui tourne + libellé, et on
   empêche le double appui. libere() remet le bouton dans son état d'origine. */
function occuper(btn, texte){
  if(!btn || btn.dataset.busy) return false;
  btn.dataset.busy = '1';
  btn.dataset.avant = btn.innerHTML;
  btn.innerHTML = '<span class="spin"></span>' + (texte || 'Un instant…');
  btn.disabled = true;
  vibrer(8);
  return true;
}
function libere(btn){
  if(!btn || !btn.dataset.busy) return;
  btn.innerHTML = btn.dataset.avant || btn.innerHTML;
  btn.disabled = false;
  delete btn.dataset.busy; delete btn.dataset.avant;
}

/* Laisse le navigateur AFFICHER l'état « en cours » avant de lancer un
   traitement lourd (la fabrication du PDF fige l'écran pendant ~1 s). */
function peindre(){
  return new Promise(function(res){
    var fait = false;
    function suite(){ if(!fait){ fait = true; res(); } }
    // cas normal : on attend deux images, l'état « en cours » est alors affiché
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ setTimeout(suite, 0); }); });
    // secours : écran en arrière-plan, plus aucune image n'est dessinée et
    // l'enregistrement resterait suspendu — le minuteur, lui, continue de tourner
    setTimeout(suite, 150);
  });
}
function ls(k,v){ try{ if(v===undefined) return localStorage.getItem(k);
  if(v===null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){} return null; }
function lsj(k,v){ if(v===undefined){ try{ return JSON.parse(ls(k)||'null'); }catch(e){ return null; } }
  ls(k, JSON.stringify(v)); }

/* ---- session du commercial ----
   Volontairement dans sessionStorage, pas dans localStorage : elle survit à une
   mise en veille, à un passage en arrière-plan et à un rechargement de page,
   mais disparaît dès que l'application est fermée. Le commercial ressaisit alors
   son nom et son code. */
function session(v){
  try{
    if(v === undefined) return JSON.parse(sessionStorage.getItem('moi') || 'null');
    if(v === null) sessionStorage.removeItem('moi');
    else sessionStorage.setItem('moi', JSON.stringify(v));
  }catch(e){ return null; }
  return null;
}

/* Comparaison des noms tolérante : casse, accents et espaces en trop. */
function normNom(s){
  s = String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  try{ s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }catch(e){}
  return s;
}

/* ====================== BASE LOCALE (IndexedDB) ======================
   Deux réserves : les devis, et le journal des actions en attente d'envoi. */
var DB = (function(){
  var db=null;
  function ouvrir(){
    return new Promise(function(res,rej){
      if(db) return res(db);
      var r = indexedDB.open('devis', 3);
      r.onupgradeneeded = function(){
        var d = r.result;
        if(!d.objectStoreNames.contains('devis')) d.createObjectStore('devis',{keyPath:'id'});
        if(!d.objectStoreNames.contains('journal')) d.createObjectStore('journal',{keyPath:'id'});
        // Les chantiers de l'agent, gardés sur l'appareil pour que le planning
        // s'affiche et que le pointage fonctionne sans réseau.
        if(!d.objectStoreNames.contains('chantiers')) d.createObjectStore('chantiers',{keyPath:'id'});
      };
      r.onsuccess = function(){ db=r.result; res(db); };
      r.onerror = function(){ rej(r.error); };
      r.onblocked = function(){ /* un autre onglet retient l'ancienne version */ };
    });
  }
  function tx(reserve,mode,fn){
    return ouvrir().then(function(d){
      return new Promise(function(res,rej){
        var t = d.transaction(reserve, mode), st = t.objectStore(reserve), out;
        out = fn(st);
        t.oncomplete = function(){ res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function(){ rej(t.error); };
      });
    });
  }
  return {
    put:   function(o){  return tx('devis','readwrite', function(st){ return st.put(o); }); },
    tous:  function(){   return tx('devis','readonly',  function(st){ return st.getAll(); }); },
    get:   function(id){ return tx('devis','readonly',  function(st){ return st.get(id); }); },
    suppr: function(id){ return tx('devis','readwrite', function(st){ return st.delete(id); }); },
    jPut:   function(o){  return tx('journal','readwrite', function(st){ return st.put(o); }); },
    jTous:  function(){   return tx('journal','readonly',  function(st){ return st.getAll(); }); },
    jSuppr: function(id){ return tx('journal','readwrite', function(st){ return st.delete(id); }); },
    cPut:  function(o){  return tx('chantiers','readwrite', function(st){ return st.put(o); }); },
    cTous: function(){   return tx('chantiers','readonly',  function(st){ return st.getAll(); }); },
    cGet:  function(id){ return tx('chantiers','readonly',  function(st){ return st.get(id); }); }
  };
})();

/* ====================== JOURNAL DES ACTIONS ======================
   Chaque geste est horodaté sur l'appareil, conservé même hors connexion,
   puis versé dans l'onglet JOURNAL du classeur à la synchronisation suivante.
   Le serveur inscrit de son côté ce qu'il constate lui-même : ces lignes-là
   ne dépendent pas du téléphone. */
function tracer(action, detail, numero){
  try{
    var moi = session();
    return DB.jPut({
      id: 'j-' + Date.now() + '-' + Math.random().toString(36).slice(2,8),
      t: Date.now(),
      action: String(action || ''),
      detail: String(detail == null ? '' : detail).slice(0, 300),
      numero: String(numero || ''),
      nom: (moi && moi.nom) || ''
    });
  }catch(e){ return Promise.resolve(); }
}

function envoyerJournal(){
  var moi = session();
  if(!moi || !navigator.onLine) return Promise.resolve();
  return DB.jTous().then(function(l){
    if(!l.length) return;
    l.sort(function(a,b){ return a.t - b.t; });
    var lot = l.slice(0, 200);            // par paquets, pour ne pas saturer l'envoi
    return poster({
      action:'journal', nom:moi.nom, code:moi.code, appareil:APPAREIL,
      evenements: lot.map(function(e){
        return {t:e.t, action:e.action, detail:e.detail, numero:e.numero, nom:e.nom};
      })
    }).then(function(d){
      if(!d || !d.ok) return;
      return lot.reduce(function(p, e){
        return p.then(function(){ return DB.jSuppr(e.id); });
      }, Promise.resolve());
    });
  }, function(){}).catch(function(){});
}

/* ====================== DÉMARRAGE ====================== */
window.addEventListener('load', function(){
  APPAREIL = ls('appareil');
  if(!APPAREIL){ APPAREIL = 'app-'+Math.random().toString(36).slice(2,10); ls('appareil',APPAREIL); }

  if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(function(){}); }

  // Demande au téléphone de ne PAS effacer nos données pour faire de la place :
  // un devis signé hors connexion doit survivre à une semaine sans réseau.
  try{
    if(navigator.storage && navigator.storage.persist){
      navigator.storage.persisted().then(function(ok){
        if(!ok) return navigator.storage.persist();
      }).catch(function(){});
    }
  }catch(e){}

  initSignature();
  brancherSignature();

  if(typeof LOGO_BLANC !== 'undefined' && LOGO_BLANC){
    var lg = $('hLogo'); lg.src = LOGO_BLANC; lg.classList.remove('hide');
  }

  chargerRepertoire();
  ls('moi', null);   // anciennes versions : la session ne doit plus survivre à la fermeture

  CFG = lsj('cfg');
  // Une version antérieure de l'application interrogeait le serveur en GET et
  // rangeait sa réponse comme configuration. Depuis que cette adresse ne répond
  // plus qu'un accusé de service, ce reste doit être écarté.
  // Un agent reçoit une configuration SANS catalogue : c'est voulu, et il ne
  // faut surtout pas la jeter ici, sinon il repart sans savoir qui il est.
  if(CFG && !(CFG.reglages && (CFG.catalogue || CFG.role === 'PRESTATAIRE'))){
    CFG = null; lsj('cfg', null);
  }
  if(CFG) alignerCompteurs();
  demarrer();
  purger();

  window.addEventListener('online', function(){ etatReseau(); synchroniser(false); rafraichirConfig(); });
  window.addEventListener('offline', etatReseau);
  setInterval(function(){ if(navigator.onLine) synchroniser(false); }, 120000);

  /* Filet de sécurité pour l'écran d'accueil d'un téléphone : l'application est
     mise en veille puis reprise sans être rechargée. Si elle revient sur l'écran
     de connexion avec une fenêtre restée ouverte, la page est inerte et, faute de
     touche Échap, il n'y a aucun moyen de s'en sortir. On referme, et seulement
     là : jamais pendant la saisie d'un devis, où la question est légitime. */
  function debloquerSiConnexion(){
    if(ETAPE !== 0) return;
    if($('eCo').classList.contains('hide')) return;
    if(document.querySelector('dialog[open]')) fermerDialogues();
  }
  window.addEventListener('pageshow', debloquerSiConnexion);
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden) debloquerSiConnexion();
  });
});

function demarrer(){
  fermerDialogues();   // une page restaurée par le navigateur peut rouvrir sur un dialogue
  $('hSub').textContent = (CFG && CFG.reglages && CFG.reglages.societe_nom) || 'Devis sur place';
  $('premiere').classList.toggle('hide', !!CFG);

  var moi = session();
  if(!moi){
    ecranConnexion('');
  } else {
    $('quiSuisJe').textContent = moi.nom;
    var b = lsj('brouillon');
    if(b && b.lignes && b.lignes.length){
      var cl = (b.client||{}).societe || (b.client||{}).contact || '';
      apresConnexion();
      demander('Reprendre le devis en cours ?',
               'Un devis non terminé a été retrouvé' + (cl ? ' : ' + cl : '') + '.',
               'Le reprendre').then(function(oui){
        if(oui){ restaurer(b); etape(2); }
        else { lsj('brouillon', null); }
      });
    } else {
      apresConnexion();
    }
  }
  etatReseau();
  synchroniser(false);
  rafraichirConfig();
}

/* ====================== CONNEXION ======================
   Écran séparé : une fois le commercial reconnu, il sort du parcours.
   Il revient à chaque ouverture de l'application. */
/* Le numéro de version, affiché sur l'écran de connexion. Sur un iPhone, une
   application posée sur l'écran d'accueil garde sa propre copie du site : elle
   peut rester sur une ancienne version alors que Safari a la nouvelle. Sans ce
   repère, impossible de savoir laquelle tourne. */
var VERSION_APP = 'v35';

function ecranConnexion(msg){
  ETAPE = 0;
  fermerDialogues();      // sinon un dialogue resté ouvert gèle l'écran de connexion
  montrer('eCo');
  var vv = $('versionApp');
  if(vv) vv.textContent = 'Version ' + VERSION_APP;
  $('steps').classList.add('hide');
  $('bar').classList.add('hide');
  $('bHist').classList.add('hide');
  $('hTitre').textContent = 'Connexion';
  $('fCommercial').value = '';
  $('fCode').value = '';
  if($('fCode').type === 'text') basculerCode();   // on ne laisse jamais un code affiché
  erreur(msg || '');
  window.scrollTo(0,0);
}

/* L'œil : vérifier ce qu'on tape sur un petit clavier, sans laisser le code en clair. */
function basculerCode(){
  var i = $('fCode'), b = $('bOeil');
  var montre = (i.type === 'password');
  i.type = montre ? 'text' : 'password';
  $('oeilBarre').classList.toggle('hide', !montre);
  b.setAttribute('aria-label', montre ? 'Masquer le code' : 'Afficher le code');
  vibrer(6);
}

function deconnexion(){
  demander('Se déconnecter ?',
           'Les devis déjà enregistrés restent sur l\'appareil et partiront normalement.',
           'Se déconnecter').then(function(oui){
    if(!oui) return;
    tracer('DECONNEXION', '');
    session(null);
    ecranConnexion('');
  });
}

function reidentifier(raison){
  // On ne coupe que pendant la saisie d'un devis (prestations et validation) :
  // partout ailleurs, y compris « Mes devis », le commercial doit être prévenu.
  if(ETAPE === 3 || ETAPE === 4) return;
  session(null);
  ecranConnexion(raison + ' Saisis de nouveau ton nom et ton code.');
}

/* ====================== ÉCHANGES AVEC LE BUREAU ======================
   Tout passe désormais par POST avec le nom et le code : l'adresse, qui est
   publique puisqu'elle figure dans l'application, ne laisse plus rien filtrer. */
function poster(corps, delai){
  var ac = window.AbortController ? new AbortController() : null;
  var stop = ac ? setTimeout(function(){ ac.abort(); }, delai || 25000) : null;
  var opts = {
    method: 'POST',
    headers: {'Content-Type':'text/plain;charset=utf-8'},   // évite la requête preflight
    body: JSON.stringify(corps)
  };
  if(ac) opts.signal = ac.signal;
  return fetch(API_URL, opts)
    .then(function(r){ if(stop) clearTimeout(stop); return r.json(); })
    .catch(function(e){ if(stop) clearTimeout(stop); throw e; });
}

function rangerConfig(cfg){
  if(!cfg || !cfg.reglages) return;
  // La configuration d'un agent n'a pas de catalogue, et c'est voulu : elle
  // doit quand même être rangée, sinon il n'a ni nom de société ni texte
  // d'information.
  if(cfg.role === 'PRESTATAIRE'){
    CFG = cfg;
    lsj('cfg', cfg);
    $('hSub').textContent = cfg.reglages.societe_nom || 'Chantiers';
    $('premiere').classList.add('hide');
    return;
  }
  if(!cfg.catalogue) return;
  CFG = cfg;
  lsj('cfg', cfg);
  alignerCompteurs();
  $('hSub').textContent = (cfg.reglages && cfg.reglages.societe_nom) || 'Devis sur place';
  $('premiere').classList.add('hide');
  var m = $('majCat');
  if(m && cfg.maj) m.textContent = new Date(cfg.maj).toLocaleDateString('fr-FR');
}

/* Rafraîchit catalogue et tarifs, sans rien bloquer si le réseau manque. */
function rafraichirConfig(btn){
  var moi = session();
  if(!moi || !navigator.onLine){ if(btn) libere(btn); return; }
  if(btn) occuper(btn, 'Mise à jour…');
  poster({action:'config', nom:moi.nom, code:moi.code}).then(function(d){
    if(btn) libere(btn);
    if(!d || !d.ok){
      if(d && d.refus) reidentifier('Ton accès a changé côté bureau.');
      return;
    }
    rangerConfig(d.config);
  }, function(){ if(btn) libere(btn); });
}

/* Une confirmation dans l'application, jamais celle du navigateur : dans une
   application installée sur l'écran d'accueil, confirm() peut ne rien afficher
   et répondre « non » tout seul — le bouton paraît alors cassé. */
var CONF = null;

/* Une question laissée sans réponse bloque tout le reste : on répond « non »
   dès que le dialogue se referme autrement que par un de ses boutons — Échap,
   retour arrière d'Android, ou un changement d'écran. */
function repondreParDefaut(){
  if(CONF){ var r = CONF; CONF = null; r(false); }
}

/* Referme tout ce qui peut recouvrir la page. Un <dialog> ouvert en showModal()
   rend la page entière inerte : elle reste parfaitement visible, mais plus rien
   n'y répond — ni les champs, ni les boutons. Appelé au démarrage et à chaque
   retour à la connexion, pour qu'un écran ne puisse jamais rester gelé. */
function fermerDialogues(){
  ['dlg', 'dlgConf', 'dlgSurf'].forEach(function(id){
    var d = $(id);
    if(!d) return;
    try{
      if(d.open){ if(d.close) d.close(); else d.removeAttribute('open'); }
    }catch(e){ d.removeAttribute('open'); }
  });
  var s = $('sigOverlay');
  if(s) s.classList.add('hide');
  repondreParDefaut();
}

function demander(titre, texte, libelleOui){
  repondreParDefaut();                   // jamais deux questions en attente
  $('confTitre').textContent = titre;
  $('confTexte').textContent = texte;
  $('confOui').textContent = libelleOui || 'Oui';
  var d = $('dlgConf');
  try{
    if(d.open){ if(d.close) d.close(); else d.removeAttribute('open'); }
  }catch(e){}
  // même référence de fonction : le navigateur ne l'ajoute qu'une fois
  d.addEventListener('close', repondreParDefaut);
  if(d.showModal) d.showModal(); else d.setAttribute('open','');
  return new Promise(function(res){ CONF = res; });
}
function repondreConf(oui){
  var d = $('dlgConf');
  var r = CONF; CONF = null;             // avant la fermeture, qui déclenche « close »
  if(d.close) d.close(); else d.removeAttribute('open');
  if(r) r(oui);
}

/* ====================== NAVIGATION ====================== */
var ECRANS = ['eCo','eAccord','e1','e2','e3','e4','e5','e6','e7','eAg1','eAg2'];
function montrer(id){
  ECRANS.forEach(function(k){ $(k).classList.toggle('hide', k!==id); });
}
/* La barre du bas ne garde que le bouton Retour sur les écrans hors parcours :
   « Mes devis » et les photos ne doivent jamais être une impasse. */
function barreRetour(){
  $('bar').classList.remove('hide');
  $('bPrec').classList.remove('hide');
  $('bTT').classList.add('hide');
  $('bSuiv').classList.add('hide');
}
function barreComplete(){
  $('bTT').classList.remove('hide');
  $('bSuiv').classList.remove('hide');
}

/* Un seul bouton Retour, qui sait d'où l'on vient. */
function revenir(){
  if(ETAPE === 5) return ouvrirHistorique();
  if(ETAPE === 7){
    return (PHOTO_RETOUR === 5) ? montrerTermine() : ouvrirHistorique();
  }
  if(ETAPE === 6){
    if(ECRAN_AVANT === 5) return montrerTermine();
    return etape(ECRAN_AVANT >= 1 && ECRAN_AVANT <= 4 ? ECRAN_AVANT : 1);
  }
  etape(ETAPE - 1);
}

function montrerTermine(){
  ETAPE = 5;
  montrer('e5');
  $('steps').classList.add('hide');
  if(TERMINE_RETOUR === 6) barreRetour(); else $('bar').classList.add('hide');
  $('hTitre').textContent = TERMINE_RETOUR === 6 ? 'Devis' : 'Terminé';
  peindreVerdict();
  window.scrollTo(0,0);
}

/* ====================== RÉSULTAT DU RENDEZ-VOUS ======================
   Le devis est imprimé et signé sur le papier : l'application ne peut pas
   deviner ce qui s'est passé, c'est le commercial qui le dit en un appui.
   Sans cette réponse, le bureau ne sait rien du devis qu'il a reçu. */
var V_TYPE = '', V_MOTIF = '';

function verdict(t){
  V_TYPE = t; V_MOTIF = '';
  $('verdictChoix').classList.add('hide');
  $('verdictRelance').classList.toggle('hide', t !== 'RELANCE');
  $('verdictMotif').classList.toggle('hide', t !== 'REFUSE');
  if(t === 'RELANCE'){
    var d = new Date(Date.now() + 7*86400000);
    $('fRelance').value = d.toISOString().slice(0,10);
  }
  if(t === 'REFUSE'){
    $('fMotif').value = '';
    Array.prototype.forEach.call($('verdictMotif').querySelectorAll('.choix'),
      function(b){ b.classList.remove('on'); });
  }
  if(t === 'SIGNE') enregistrerVerdict(null);
}
function setMotif(btn, m){
  V_MOTIF = m;
  Array.prototype.forEach.call($('verdictMotif').querySelectorAll('.choix'),
    function(b){ b.classList.toggle('on', b === btn); });
  if(m) $('fMotif').value = '';
  else $('fMotif').focus();
}
function annulerVerdict(){
  V_TYPE = ''; V_MOTIF = '';
  $('verdictRelance').classList.add('hide');
  $('verdictMotif').classList.add('hide');
  $('verdictChoix').classList.remove('hide');
  erreur('');
}
function libelleVerdict(v){
  return v === 'SIGNE' ? 'Signé' : v === 'RELANCE' ? 'À relancer' : v === 'REFUSE' ? 'Refusé' : '';
}
function enregistrerVerdict(btn){
  if(!DERNIER || !V_TYPE) return;
  var t = V_TYPE;
  var motif = '', relance = '';
  if(t === 'REFUSE'){
    motif = V_MOTIF || val('fMotif').trim();
    if(!motif) return erreur('Choisis une raison, ou précise-la.');
  }
  if(t === 'RELANCE'){
    relance = val('fRelance');
    if(!relance) return erreur('Choisis une date de relance.');
  }
  erreur('');
  if(btn) occuper(btn, 'Enregistrement…');
  DB.get(DERNIER.id).then(function(e){
    if(!e){ if(btn) libere(btn); return; }
    e.verdict = t; e.motif = motif; e.relance = relance;
    e.note = val('verdictNote');
    e.verdictLe = Date.now(); e.verdictEnvoye = false;
    return DB.put(e).then(function(){
      DERNIER = e;
      if(btn) libere(btn);
      tracer('RESULTAT ' + libelleVerdict(t).toUpperCase(),
             motif || (relance ? 'relance le ' + jjmmaa(relance) : ''), e.numero);
      annulerVerdict();
      peindreVerdict();
      var f = $('verdictFait');
      if(f && f.scrollIntoView) f.scrollIntoView({block:'center'});
      synchroniser(false);
      if(t === 'SIGNE' && !estSigne(e)) ouvrirPhotos(e.id, 'SIGNE');
    });
  }, function(){ if(btn) libere(btn); });
}
/* La note du commercial vit à côté du résultat : il peut l'écrire avant d'avoir
   répondu, la compléter après, sans jamais rouvrir les trois choix. */
function noteModifiee(){
  var b = $('bNote');
  if(!b) return;
  var enregistree = (DERNIER && DERNIER.note) || '';
  b.classList.toggle('hide', val('verdictNote') === enregistree.trim());
}
function enregistrerNote(btn){
  if(!DERNIER) return;
  var texte = val('verdictNote');
  if(btn) occuper(btn, 'Enregistrement…');
  DB.get(DERNIER.id).then(function(e){
    if(!e){ if(btn) libere(btn); return; }
    e.note = texte;
    if(e.verdict) e.verdictEnvoye = false;      // la note repart avec le résultat
    return DB.put(e).then(function(){
      DERNIER = e;
      if(btn) libere(btn);
      tracer(texte ? 'NOTE ENREGISTREE' : 'NOTE EFFACEE', texte.slice(0,120), e.numero);
      noteModifiee();
      peindreVerdict();
      synchroniser(false);
    });
  }, function(){ if(btn) libere(btn); });
}

function jjmmaa(iso){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));
  return m ? m[3]+'/'+m[2]+'/'+m[1] : String(iso||'');
}

/* Ce qui est déjà répondu s'affiche, et reste modifiable. */
function peindreVerdict(){
  var f = $('verdictFait'), c = $('verdictChoix');
  if(!f || !c) return;
  peindreBlocSignature();
  var champ = $('verdictNote');
  if(champ && document.activeElement !== champ) champ.value = (DERNIER && DERNIER.note) || '';
  noteModifiee();
  var v = DERNIER && DERNIER.verdict;
  if(!v){
    f.classList.add('hide');
    var a = $('verdictAide'); if(a) a.classList.remove('hide');
    if(V_TYPE === '') c.classList.remove('hide');
    return;
  }
  var c2 = $('verdictAide'); if(c2) c2.classList.add('hide');
  var t = 'Résultat : ' + libelleVerdict(v);
  if(v === 'REFUSE' && DERNIER.motif) t += ' — ' + DERNIER.motif;
  if(v === 'RELANCE' && DERNIER.relance) t += ' le ' + jjmmaa(DERNIER.relance);
  f.innerHTML = ech(t) + '<div class="mini" style="color:inherit;opacity:.85;margin-top:6px">' +
    (DERNIER.verdictEnvoye ? 'Transmis au bureau.' : 'Sera transmis au bureau au prochain envoi.') +
    '</div><button class="btn sec" style="margin-top:10px" onclick="modifierVerdict()">Corriger</button>';
  f.classList.remove('hide');
  c.classList.add('hide');
  $('verdictRelance').classList.add('hide');
  $('verdictMotif').classList.add('hide');
}
/* Le bloc « Faire signer le client » de l'écran de fin : un bouton tant que
   le devis n'est pas signé, l'horodatage une fois qu'il l'est. */
function peindreBlocSignature(){
  var z = $('blocSignature');
  if(!z) return;
  if(!DERNIER){ z.classList.add('hide'); return; }
  z.classList.remove('hide');
  if(estSigne(DERNIER)){
    z.innerHTML = '<div class="ok" style="text-align:left">' +
      '<b>Devis signé par le client</b><div class="mini" style="color:inherit;opacity:.85">' +
      ech(signeLisible(DERNIER)) + ' La signature est dans le PDF' +
      (DERNIER.statut === 'envoye' ? ', déjà remonté au bureau.'
                                   : ' ; il repart au bureau au prochain envoi.') +
      '</div><button class="btn sec sm" style="margin-top:10px" onclick="partagerDernier(this)">' +
      'Envoyer le devis signé</button></div>';
    return;
  }
  z.innerHTML = '<button class="btn" onclick="ouvrirSignatureDevis(\'' + ech(DERNIER.id) +
    '\', this)">Faire signer le client</button>' +
    '<div class="mini">Le client signe sur le téléphone. Le PDF est refait avec sa ' +
    'signature et remplace le précédent — pas de photo du papier à prendre.</div>';
}

function modifierVerdict(){
  $('verdictFait').classList.add('hide');
  var a = $('verdictAide'); if(a) a.classList.remove('hide');
  V_TYPE = '';
  $('verdictChoix').classList.remove('hide');
}

/* Depuis « Mes devis » : on réouvre l'écran de fin du devis choisi. */
function ouvrirVerdict(id){
  DB.get(id).then(function(e){
    if(!e) return;
    DERNIER = e;
    V_TYPE = ''; V_MOTIF = '';
    $('verdictRelance').classList.add('hide');
    $('verdictMotif').classList.add('hide');
    $('okNum').textContent = e.numero;
    $('okTot').textContent = eur(((e.devis||{}).totaux||{}).ttc || 0) + ' TTC';
    $('okEtat').textContent = e.statut === 'envoye'
      ? 'Reçu par le bureau.'
      : 'Pas encore parti au bureau.';
    TERMINE_RETOUR = 6;
    montrerTermine();
  });
}

function etape(n){
  if(n<1) n=1;
  ETAPE=n; erreur('');
  montrer('e'+n);
  barreComplete();
  [1,2,3,4].forEach(function(i){ $('s'+i).classList.toggle('on', i<=n); });
  $('steps').classList.toggle('hide', n>=5);
  $('bar').classList.toggle('hide', n>=5 || n===1);   // au choix du type, les deux cartes suffisent
  $('bHist').classList.remove('hide');
  $('bPrec').classList.toggle('hide', n<=1);          // plus de retour vers la connexion
  $('bSuiv').textContent = n===4 ? 'Enregistrer le devis' : 'Continuer';
  $('hTitre').textContent = ['','Type de client','Client','Prestations','Validation','Terminé','Mes devis'][n];
  if(n!==2) cacherSugg();
  if(n===1) majType();
  if(n<=2) majBarre();          // le total du bas suit le devis en cours, pas le précédent
  if(n===3) rendreLignes();
  if(n===4){ calculer(); majApercuSignature(); }
  window.scrollTo(0,0);
}
function suivant(){
  if(ETAPE===1){
    if(!TYPE) return erreur('Choisis le type de client.');
    return etape(2);
  }
  if(ETAPE===2){
    if(TYPE==='PRO'){
      if(!val('cSociete')) return erreur('Indique la raison sociale du client.');
      var s = val('cSiret').replace(/\D/g,'');
      if(s && s.length !== 14) return erreur('Un SIRET compte 14 chiffres — laisse le champ vide si tu ne l\'as pas.');
    } else {
      if(!val('cContact')) return erreur('Indique le nom du client.');
      if(PLUS2ANS === null) return erreur('Indique si le logement a plus de deux ans : c\'est ce qui fixe le taux de TVA.');
    }
    var mauvais = champsDouteux();
    if(mauvais) return erreur(mauvais);
    sauverBrouillon(); return etape(3);
  }
  if(ETAPE===3){
    if(!LIGNES.length) return erreur('Ajoute au moins une prestation.');
    sauverBrouillon(); return etape(4);
  }
  if(ETAPE===4) return enregistrer();
}

/* Une adresse e-mail fautive, c'est la copie du devis qui n'arrive jamais ;
   un code postal à rallonge, c'est une erreur de frappe. On le dit une fois :
   le message s'efface, un deuxième appui sur Continuer passe quand même. */
var DOUTE_VU = '';
function champsDouteux(){
  var e = val('cEmail'), cp = val('cCp').replace(/\s/g,''), m = '';
  if(e && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e))
    m = 'Cette adresse e-mail a l\'air incomplète : ' + e + '. Corrige-la, ou laisse le champ vide.';
  else if(cp && !/^\d{5}$/.test(cp))
    m = 'Un code postal compte 5 chiffres — celui-ci en a ' + cp.length + '.';
  if(!m){ DOUTE_VU = ''; return ''; }
  if(DOUTE_VU === m){ DOUTE_VU = ''; return ''; }   // déjà signalé : on laisse passer
  DOUTE_VU = m;
  return m;
}

/* ====================== IDENTIFICATION ====================== */
function sha256(s){
  if(!(window.crypto && crypto.subtle)) return Promise.resolve(null);
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function(b){
    return Array.prototype.map.call(new Uint8Array(b), function(x){
      return ('0'+x.toString(16)).slice(-2); }).join('');
  }).catch(function(){ return null; });
}
/* Règle des codes : 4 caractères minimum, au moins un chiffre et un caractère spécial. */
function codeConforme(c){
  return String(c).length >= 4 && /[0-9]/.test(c) && /[^A-Za-z0-9]/.test(c);
}

/* ====================== IDENTIFICATION HORS LIGNE ======================
   Le serveur valide nom et code à la première connexion d'un appareil ; celui-ci
   garde ensuite de quoi vérifier tout seul, avec un grain de sel qui lui est
   propre et qui n'a jamais circulé. Rien de testable n'est publié. */
function selAppareil(){
  var s = ls('selAppareil');
  if(!s){
    try{
      s = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(16)), function(x){
        return ('0'+x.toString(16)).slice(-2); }).join('');
    }catch(e){
      s = String(Math.random()).slice(2) + String(Math.random()).slice(2);
    }
    ls('selAppareil', s);
  }
  return s;
}
function verifLocal(nom){
  var v = lsj('verif') || {};
  return v[normNom(nom)] || null;
}
function poserVerif(nom, code, role){
  return sha256(normNom(nom)+'|'+code+'|'+selAppareil()).then(function(h){
    if(!h) return;
    var v = lsj('verif') || {};
    v[normNom(nom)] = {nom:nom, h:h, role:role || 'COMMERCIAL'};
    var cles = Object.keys(v);
    while(cles.length > 3) delete v[cles.shift()];   // trois commerciaux au plus par appareil
    lsj('verif', v);
  });
}
function oublierVerif(nom){
  var v = lsj('verif') || {};
  delete v[normNom(nom)];
  lsj('verif', v);
}

/* Un seul et même message quelle que soit la cause de l'échec : un téléphone
   trouvé ne doit pas permettre de découvrir quels noms existent chez BB. */
var ECHECS = 0;
function attenteEchec(){
  if(ECHECS < 3) return 0;
  return ECHECS < 6 ? 10000 : 60000;      // 10 s, puis 1 min entre deux essais
}
function refuser(){
  ECHECS++;
  tracer('CONNEXION REFUSEE', 'nom saisi : ' + val('fCommercial'));
  var att = attenteEchec();
  if(att){ try{ sessionStorage.setItem('bloqueJusqua', String(Date.now() + att)); }catch(e){} }
  $('fCode').value = '';
  erreur('Nom ou code incorrect.' +
    (att ? ' Prochain essai dans ' + (att/1000) + ' secondes.' : ''));
}

function verifierCommercial(btn){
  var nom = val('fCommercial'), code = val('fCode');
  if(!nom) return erreur('Saisis ton nom.');
  if(!code) return erreur('Saisis ton code.');

  var reste = 0;
  try{ reste = Number(sessionStorage.getItem('bloqueJusqua') || 0) - Date.now(); }catch(e){}
  if(reste > 0) return erreur('Trop d\'essais. Réessaie dans ' + Math.ceil(reste/1000) + ' secondes.');
  // Le format du code n'est pas un secret : la règle est écrite sous le champ.
  // Dire « Nom ou code incorrect » ici ferait chercher une faute qui n'existe
  // pas — et, au troisième essai, bloquerait pour rien.
  if(!codeConforme(code)) return erreur(
    'Ce code ne respecte pas la règle : au moins 4 caractères, dont un chiffre ' +
    'et un caractère spécial (! ? * # & - _ …). Si ton code n\'en a pas, ' +
    'demande au bureau de le corriger.');

  if(btn) occuper(btn, 'Vérification…');
  var suite = navigator.onLine ? connexionEnLigne(nom, code) : connexionHorsLigne(nom, code);
  suite.then(function(r){
    if(btn) libere(btn);
    if(!r.ok){
      if(r.premiere) return erreur('Première connexion sur cet appareil : il faut du réseau.');
      if(r.attente) return erreur(r.erreur || 'Trop d\'essais. Réessaie plus tard.');
      return refuser();
    }
    ECHECS = 0;
    try{ sessionStorage.removeItem('bloqueJusqua'); }catch(e){}
    // On retient l'orthographe du bureau, pas celle tapée — et le rôle, qui
    // décide de tout l'outil qui s'ouvre derrière.
    session({nom:r.nom, code:code, role:r.role || 'COMMERCIAL'});
    tracer('CONNEXION', navigator.onLine ? 'en ligne' : 'hors connexion');
    $('quiSuisJe').textContent = r.nom;
    $('fCode').value = '';               // le code ne traîne pas à l'écran
    if($('fCode').type === 'text') basculerCode();
    apresConnexion();
    synchroniser(false);
  }, function(){
    if(btn) libere(btn);
    erreur('La connexion au bureau a échoué. Réessaie.');
  });
}

function connexionEnLigne(nom, code){
  return poster({action:'connexion', nom:nom, code:code}).then(function(d){
    if(!d || !d.ok){
      if(d && d.refus && /essais/i.test(String(d.erreur||''))) return {ok:false, attente:true, erreur:d.erreur};
      return {ok:false};
    }
    var role = d.role || (d.config && d.config.role) || 'COMMERCIAL';
    rangerConfig(d.config);
    return poserVerif(d.nom, code, role).then(function(){
      return {ok:true, nom:d.nom, role:role};
    });
  }, function(){
    return connexionHorsLigne(nom, code);     // réseau capricieux : on retombe sur le local
  });
}

function connexionHorsLigne(nom, code){
  var v = verifLocal(nom);
  if(!v) return Promise.resolve({ok:false, premiere:true});
  return sha256(normNom(nom)+'|'+code+'|'+selAppareil()).then(function(h){
    return (h && h === v.h) ? {ok:true, nom:v.nom, role:v.role || 'COMMERCIAL'} : {ok:false};
  });
}

/* ====================== RÉPERTOIRE CLIENTS ======================
   Reconstruit depuis les devis déjà enregistrés sur l'appareil : aucune
   requête, donc l'autocomplétion fonctionne aussi bien hors connexion. */
function chargerRepertoire(){
  return DB.tous().then(function(l){
    var vus = {}, out = [];
    l.sort(function(a,b){ return b.cree - a.cree; }).forEach(function(e){
      var c = ((e.devis||{}).client)||{};
      var cle = ((c.societe||'') + '|' + (c.contact||'')).toLowerCase().trim();
      if(cle === '|' || vus[cle]) return;
      vus[cle] = 1; out.push(c);
    });
    CLIENTS = out.slice(0, 300);
  }, function(){});
}

/* ====================== SUGGESTIONS ====================== */
var TIMER_ANNU = null;
function boiteSugg(quoi){ return $(quoi === 'soc' ? 'suggSoc' : 'suggCon'); }
function cacherSugg(){
  SUGG = [];
  ['suggSoc','suggCon'].forEach(function(id){
    var b = $(id); if(b){ b.classList.add('hide'); b.innerHTML = ''; }
  });
}

function suggerer(quoi){
  var champ = (quoi === 'soc') ? 'cSociete' : 'cContact';
  var q = val(champ);
  if(q.length < 2){ cacherSugg(); return; }

  // 1. clients déjà connus : immédiat, hors connexion compris
  var bas = q.toLowerCase();
  SUGG = CLIENTS.filter(function(c){
    return ((c.societe||'') + ' ' + (c.contact||'') + ' ' + (c.ville||''))
      .toLowerCase().indexOf(bas) >= 0;
  }).slice(0, 4).map(function(c){ return {src:'client', c:c}; });
  rendreSugg(quoi, false);

  // 2. annuaire des entreprises, seulement pour une raison sociale et avec du réseau
  clearTimeout(TIMER_ANNU);
  if(quoi !== 'soc' || TYPE !== 'PRO' || !navigator.onLine || q.length < 3) return;
  rendreSugg(quoi, true);
  TIMER_ANNU = setTimeout(function(){ interrogerAnnuaire(q, quoi); }, 400);
}

function interrogerAnnuaire(q, quoi){
  var ac = window.AbortController ? new AbortController() : null;
  var stop = ac ? setTimeout(function(){ ac.abort(); }, 7000) : null;
  fetch(ANNUAIRE + '?per_page=5&q=' + encodeURIComponent(q), ac ? {signal:ac.signal} : {})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(stop) clearTimeout(stop);
      if(val('cSociete') !== q) return;            // la saisie a continué entre-temps
      (d && d.results ? d.results : []).forEach(function(r){
        var e = normaliserEntreprise(r);
        if(e && SUGG.length < 8) SUGG.push({src:'annuaire', c:e});
      });
      rendreSugg(quoi, false);
    })
    .catch(function(){
      if(stop) clearTimeout(stop);
      rendreSugg(quoi, false);                     // pas d'annuaire : on garde les clients connus
    });
}

/* L'annuaire renvoie des champs qui varient d'une fiche à l'autre : on ne garde
   que ce dont on est sûr, et on ne casse jamais la saisie si le format change. */
function normaliserEntreprise(r){
  try{
    var s = r.siege || {};
    if(String(r.etat_administratif || 'A').toUpperCase() === 'C') return null;   // entreprise fermée
    var cp = String(s.code_postal || '').trim();
    var ville = String(s.libelle_commune || '').trim();
    var voie = [s.numero_voie, s.type_voie, s.libelle_voie]
      .filter(function(x){ return String(x||'').trim(); }).join(' ').trim();
    if(!voie && s.adresse){
      voie = String(s.adresse).replace(cp, '').replace(ville, '').replace(/\s{2,}/g, ' ').trim();
    }
    var nom = String(r.nom_complet || r.nom_raison_sociale || '').trim();
    if(!nom) return null;
    var si = String(s.siret || '').replace(/\D/g, '');
    return {
      societe: nom.toUpperCase() === nom ? nom : nom,
      siret: si.length === 14 ? si.slice(0,3)+' '+si.slice(3,6)+' '+si.slice(6,9)+' '+si.slice(9) : '',
      tva: si.length === 14 ? tvaDepuisSiren(si.slice(0,9)) : '',
      adresse: voie, cp: cp, ville: ville, type: 'PRO'
    };
  }catch(e){ return null; }
}

function rendreSugg(quoi, attente){
  var b = boiteSugg(quoi);
  if(!b) return;
  var h = SUGG.map(function(s, i){
    var c = s.c;
    var titre = c.societe || c.contact || '';
    var det = [c.contact && c.societe ? c.contact : '', [c.cp, c.ville].filter(Boolean).join(' ')]
      .filter(Boolean).join(' · ');
    return '<button type="button" onclick="appliquerSugg(' + i + ')">' +
      '<b>' + ech(titre) + '</b>' +
      (det ? '<em>' + ech(det) + '</em>' : '') +
      '<span class="src">' + (s.src === 'client' ? 'déjà client' : 'annuaire') + '</span></button>';
  }).join('');
  if(attente) h += '<div class="att">Recherche dans l\'annuaire des entreprises…</div>';
  b.innerHTML = h;
  b.classList.toggle('hide', !h);
}

function appliquerSugg(i){
  var c = SUGG[i] && SUGG[i].c;
  if(!c) return;
  vibrer(8);
  if(c.type === 'PART' || c.type === 'PRO'){ TYPE = c.type; majType(); }
  ['Societe','Siret','Tva','Contact','Tel','Email','Adresse','Cp','Ville'].forEach(function(k){
    var v = c[k.toLowerCase()];
    if(v) $('c' + k).value = v;
  });
  if(val('cSiret')) $('mSiret').textContent = 'SIRET repris de la fiche.';
  cacherSugg();
  sauverBrouillon();
}

/* ====================== INFORMATION DU COMMERCIAL ======================
   Le journal enregistre l'activité : chacun doit en être informé, et cette
   information doit être prouvable. L'écran s'affiche à chaque ouverture de
   session, et l'acceptation part dans le journal avec la version du texte lu.
   Ce n'est pas un consentement — un salarié ne peut pas refuser un dispositif
   légitime — mais la preuve horodatée qu'il en a bien été informé. */
function texteInformation(){
  var r = (CFG && CFG.reglages) || {};
  var t = String(r.texte_information || '').trim();
  if(!t) return '';
  return t.replace(/\{mois\}/g, String(r.journal_retention_mois || 6));
}
function versionInformation(){
  return String(((CFG && CFG.reglages) || {}).version_information || '1').trim();
}

function ecranAccord(){
  var t = texteInformation();
  // Rien à afficher : on ne bloque personne, mais chacun repart chez soi.
  if(!t){ if(estAgent()) ecranPlanning(); else etape(1); return; }
  ETAPE = 0;
  montrer('eAccord');
  $('steps').classList.add('hide');
  $('bar').classList.add('hide');
  $('bHist').classList.add('hide');
  $('hTitre').textContent = 'Information';
  $('accTexte').textContent = t;
  $('accPied').textContent = 'Version ' + versionInformation() +
    ' — ton acceptation est enregistrée avec la date et l\'heure.';
  window.scrollTo(0,0);
}

function accepterInformation(btn){
  if(btn) occuper(btn, 'Enregistrement…');
  try{ sessionStorage.setItem('accord', versionInformation()); }catch(e){}
  tracer('INFORMATION ACCEPTEE', 'version ' + versionInformation()).then(function(){
    if(btn) libere(btn);
    if(estAgent()){ ecranPlanning(); return synchroniser(false); }
    TYPE = null; PLUS2ANS = null; TAUX = null; majType();
    etape(1);
    synchroniser(false);
  }, function(){
    if(btn) libere(btn);
    if(estAgent()) return ecranPlanning();
    etape(1);
  });
}

/* Passe par l'information si elle n'a pas encore été acceptée dans cette session. */
function apresConnexion(){
  var v = null;
  try{ v = sessionStorage.getItem('accord'); }catch(e){}
  if(v === versionInformation()){
    if(estAgent()) return ecranPlanning();
    TYPE = null; PLUS2ANS = null; TAUX = null; majType();
    return etape(1);
  }
  ecranAccord();
}

/* ====================== TYPE DE CLIENT ====================== */
function choisirType(t){
  TYPE = t;
  majType();
  sauverBrouillon();
  etape(2);
}
function majType(){
  var pro = (TYPE === 'PRO');
  $('chPRO').classList.toggle('on', pro);
  $('chPART').classList.toggle('on', TYPE === 'PART');
  $('blocPro').classList.toggle('hide', !pro);
  $('lContact').textContent = pro ? 'Interlocuteur' : 'Nom et prénom du client';
  $('lAdresse').textContent = pro ? 'Adresse du site à nettoyer' : 'Adresse du logement';
  $('tClient').textContent = pro ? 'Client professionnel' : (TYPE ? 'Client particulier' : 'Client');
  if(TYPE === 'PART'){ $('cSociete').value=''; $('cSiret').value=''; $('cTva').value=''; }
  $('blocAge').classList.toggle('hide', TYPE !== 'PART');
  if(pro){ PLUS2ANS = null; appliquerTaux(20); }
  else if(PLUS2ANS !== null){ appliquerTaux(PLUS2ANS ? 10 : 20); }
  else { TAUX = null; majTva(); }
  cacherSugg();
  majBarre();
}

/* ====================== TAUX DE TVA ======================
   Un professionnel est toujours à 20 %. Un particulier est à 10 % pour
   l'entretien et la fin de chantier d'un logement achevé depuis plus de
   deux ans, et à 20 % sinon. Le taux reste modifiable ligne par ligne. */
function setLogement(plus2ans){
  PLUS2ANS = !!plus2ans;
  appliquerTaux(PLUS2ANS ? 10 : 20);
  sauverBrouillon();
}
function appliquerTaux(t){
  TAUX = t;
  LIGNES.forEach(function(l){ l.tva = t; });   // le taux appartient au devis, pas au catalogue
  majTva();
  if(ETAPE === 3) rendreLignes();
  if(ETAPE === 4) calculer();
  majBarre();
}
function majTva(){
  $('ageOui').classList.toggle('on', PLUS2ANS === true);
  $('ageNon').classList.toggle('on', PLUS2ANS === false);
  var b = $('tvaInfo');
  if(TYPE === 'PRO'){
    b.classList.remove('hide');
    b.innerHTML = '<b>TVA 20 %</b> — taux normal, client professionnel.';
  } else if(TAUX === 10){
    b.classList.remove('hide');
    b.innerHTML = '<b>TVA 10 %</b> — entretien et fin de chantier sur un logement de plus de deux ans. ' +
      'Le client remplira une attestation de TVA réduite.';
  } else if(TAUX === 20){
    b.classList.remove('hide');
    b.innerHTML = '<b>TVA 20 %</b> — logement de moins de deux ans.';
  } else {
    b.classList.add('hide'); b.textContent = '';
  }
}

/* N° de TVA intracommunautaire français : FR + clé sur 2 chiffres + les 9 chiffres du SIREN.
   Clé = (12 + 3 × (SIREN modulo 97)) modulo 97. */
function tvaDepuisSiren(siren){
  if(!/^\d{9}$/.test(siren)) return '';
  var k = (12 + 3 * (Number(siren) % 97)) % 97;
  return 'FR' + ('0'+k).slice(-2) + siren;
}
function deduireTva(){
  var brut = val('cSiret').replace(/\D/g,''), m = $('mSiret');
  if(!brut){ m.textContent = 'Le n° de TVA se complète tout seul à partir du SIRET.'; return; }
  if(brut.length !== 14){
    m.textContent = 'Un SIRET compte 14 chiffres — celui-ci en a ' + brut.length + '.';
    return;
  }
  $('cSiret').value = brut.slice(0,3)+' '+brut.slice(3,6)+' '+brut.slice(6,9)+' '+brut.slice(9);
  m.textContent = 'SIRET complet.';
  if(!val('cTva')) $('cTva').value = tvaDepuisSiren(brut.slice(0,9));
  sauverBrouillon();
}

/* ====================== CATALOGUE ====================== */
function ouvrirCatalogue(){
  var d=$('dlg'); $('rech').value=''; rendreCatalogue();
  if(d.showModal) d.showModal(); else { d.setAttribute('open',''); d.style.position='fixed'; d.style.bottom='0'; d.style.zIndex='50'; }
}
function fermerCatalogue(){ var d=$('dlg'); if(d.close) d.close(); else d.removeAttribute('open'); }
function ligneCatalogue(p, i){
  return '<div class="item" onclick="ajouterCatalogue('+i+')">'+
    '<span class="px">'+eur(p.pu)+'</span><b>'+ech(p.designation)+'</b><span>'+
    ech(p.detail||'')+(p.unite?' · '+ech(p.unite):'')+
    (p.type==='MENSUEL'?' · mensuel':'')+'</span></div>';
}
function rendreCatalogue(){
  var q = $('rech').value.toLowerCase(), cats = {}, h='';

  // Les prestations les plus récemment utilisées d'abord : sur le terrain,
  // c'est presque toujours l'une d'elles.
  if(!q){
    var f = lsj('favs') || {}, recents = [];
    CFG.catalogue.forEach(function(p,i){ if(f[p.designation]) recents.push({p:p,i:i,t:f[p.designation]}); });
    recents.sort(function(a,b){ return b.t - a.t; });
    if(recents.length){
      h += '<div class="cat">Récemment utilisées</div>';
      recents.slice(0,5).forEach(function(o){ h += ligneCatalogue(o.p, o.i); });
    }
  }

  CFG.catalogue.forEach(function(p,i){
    if(q && (p.designation+' '+p.detail+' '+p.categorie).toLowerCase().indexOf(q)<0) return;
    (cats[p.categorie]=cats[p.categorie]||[]).push({p:p,i:i});
  });
  Object.keys(cats).forEach(function(c){
    h += '<div class="cat">'+ech(c)+'</div>';
    cats[c].forEach(function(o){ h += ligneCatalogue(o.p, o.i); });
  });
  $('dlgB').innerHTML = h || '<div class="empty">Aucune prestation trouvée.</div>';
}
function ajouterCatalogue(i){
  var p = CFG.catalogue[i];
  LIGNES.push({categorie:p.categorie,designation:p.designation,detail:p.detail,
    qte:1,unite:p.unite,pu:p.pu,rem:0,tva:(TAUX||p.tva),type:p.type,reference:p.reference||''});
  noterPresta(p);
  fermerCatalogue(); rendreLignes(); sauverBrouillon();
}
/* Mémorise l'usage d'une prestation, en ne gardant que les 12 dernières. */
function noterPresta(p){
  var f = lsj('favs') || {};
  f[p.designation] = Date.now();
  var g = {};
  Object.keys(f).sort(function(a,b){ return f[b]-f[a]; }).slice(0,12)
    .forEach(function(k){ g[k] = f[k]; });
  lsj('favs', g);
}

/* ====================== CALCULETTE DE SURFACE ======================
   On mesure pièce par pièce, l'appli additionne : c'est là que les erreurs
   de multiplication faites debout dans un hall coûtent le plus cher. */
function ouvrirSurface(i){
  SURF = {ligne:i, pieces:[{nom:'',l:'',w:''},{nom:'',l:'',w:''}]};
  rendreSurface();
  var d = $('dlgSurf');
  if(d.showModal) d.showModal();
  else { d.setAttribute('open',''); d.style.position='fixed'; d.style.bottom='0'; d.style.zIndex='50'; }
}
function fermerSurface(){ var d=$('dlgSurf'); if(d.close) d.close(); else d.removeAttribute('open'); }
function ajouterPiece(){ SURF.pieces.push({nom:'',l:'',w:''}); rendreSurface(); }
function supprPiece(i){ SURF.pieces.splice(i,1); if(!SURF.pieces.length) ajouterPiece(); else rendreSurface(); }
function setPiece(i,k,v){ SURF.pieces[i][k] = v; majSurface(); }
function surfacePiece(p){
  var l = Number(String(p.l).replace(',','.')) || 0;
  var w = String(p.w).trim() === '' ? 1 : (Number(String(p.w).replace(',','.')) || 0);
  return Math.round(l * w * 100) / 100;
}
function totalSurface(){
  return Math.round(SURF.pieces.reduce(function(s,p){ return s + surfacePiece(p); }, 0) * 100) / 100;
}
function rendreSurface(){
  $('surfL').innerHTML = SURF.pieces.map(function(p,i){
    return '<div class="piece">'+
      '<div style="flex:1.3"><label>Pièce</label><input value="'+ech(p.nom)+'" placeholder="Hall, bureau 1…" oninput="SURF.pieces['+i+'].nom=this.value"></div>'+
      '<div><label>Long.</label><input inputmode="decimal" value="'+ech(p.l)+'" oninput="setPiece('+i+',\'l\',this.value)"></div>'+
      '<div><label>Larg.</label><input inputmode="decimal" value="'+ech(p.w)+'" oninput="setPiece('+i+',\'w\',this.value)"></div>'+
      '<div class="eq" id="sp'+i+'">'+nb(surfacePiece(p))+' m²</div>'+
      '<button class="x" onclick="supprPiece('+i+')">✕</button></div>';
  }).join('');
  majSurface();
}
function majSurface(){
  SURF.pieces.forEach(function(p,i){ var e=$('sp'+i); if(e) e.textContent = nb(surfacePiece(p))+' m²'; });
  $('surfTot').textContent = nb(totalSurface())+' m²';
}
function nb(n){
  return (Math.round((Number(n)||0)*100)/100).toString().replace('.', ',');
}
function appliquerSurface(){
  var t = totalSurface();
  if(SURF.ligne !== null && LIGNES[SURF.ligne]){
    LIGNES[SURF.ligne].qte = t;
    var det = SURF.pieces.filter(function(p){ return surfacePiece(p) > 0; })
      .map(function(p){ return (p.nom ? p.nom+' ' : '') + nb(surfacePiece(p)) + ' m²'; }).join(', ');
    if(det && !LIGNES[SURF.ligne].detail) LIGNES[SURF.ligne].detail = det;
    rendreLignes(); sauverBrouillon();
  }
  fermerSurface();
}
/* La ligne libre a été retirée : elle créait une prestation ET son prix hors
   catalogue, ce qui vidait de son sens le verrouillage des tarifs. Une
   prestation manquante s'ajoute au catalogue, au bureau. */

/* Plafond de remise, fixé au bureau dans REGLAGES (remise_max). Zéro veut dire
   « aucune remise ». Le classeur applique le même plafond à l'arrivée : l'écran
   guide, le bureau tranche. */
function remiseMax(){
  var v = (CFG && CFG.reglages) ? CFG.reglages.remise_max : null;
  if(v === undefined || v === null || String(v).trim() === '') return 0;
  var n = Number(String(v).replace(',', '.'));
  if(!isFinite(n) || n < 0) return 0;
  return n > 100 ? 100 : n;
}

/* La remise s'écrit « 5 » ou « 5 % », au choix, et ce choix a un sens.
   Le signe % est un interrupteur discret pour le commercial : avec le signe,
   le rappel du plafond reste invisible ; sans le signe, il s'affiche sous le
   champ et peut être montré au client pour appuyer la négociation.
   Le client ne voit qu'un écran ou rien ; il ne peut pas deviner la manœuvre. */
function lireRemise(txt){
  var s = String(txt == null ? '' : txt).trim();
  var muet = s.indexOf('%') >= 0;
  var n = Number(s.replace(/%/g, '').replace(',', '.').trim());
  if(!isFinite(n) || n < 0) n = 0;
  return { valeur: n, muet: muet };
}

/* Le maximum dépend du chantier, pas du classeur : 10 % est le plafond absolu
   de l'entreprise, mais sur un chantier serré le maximum réel est plus bas, et
   c'est le commercial qui le sait. Le message est donc son affirmation à lui,
   déclenchée par l'absence du signe %. Il s'affiche dès qu'une remise est
   accordée ; à zéro il n'aurait aucun sens. */
function montrerPlafond(l){
  return (Number(l.rem) || 0) > 0 && !l.remMuet;
}

function peindrePlafond(i){
  var e = $('plaf' + i);
  if(e) e.classList.toggle('hide', !montrerPlafond(LIGNES[i]));
}

function setRemise(i, txt, el){
  var r = lireRemise(txt), m = remiseMax();
  var borne = r.valeur > m ? m : r.valeur;
  LIGNES[i].rem = borne;
  LIGNES[i].remMuet = r.muet;
  // On ne réécrit le champ que si la valeur a vraiment été ramenée au plafond :
  // sinon on empêcherait de taper « 0,5 » ou « 5 » avant son signe.
  if(el && borne !== r.valeur) el.value = borne + (r.muet ? ' %' : '');
  var t = $('tl' + i);
  if(t) t.textContent = eur(montantL(LIGNES[i]));
  peindrePlafond(i);
  majBarre();
  sauverBrouillon();
}

/* ====================== LIGNES ====================== */
function rendreLignes(){
  var c = $('lignes');
  if(!LIGNES.length){
    c.innerHTML='<div class="card"><div class="empty">Aucune prestation.<br>Ajoute une ligne depuis le catalogue.</div></div>';
    majBarre(); return;
  }
  /* Ce que le catalogue possède — désignation, unité, prix, TVA, type — s'affiche
     mais ne se saisit pas. Le commercial garde la main sur ce qui relève du
     chantier : la quantité, le détail, le poste, et la remise dans la limite
     fixée au bureau. */
  var rMax = remiseMax();
  c.innerHTML = LIGNES.map(function(l,i){
    return '<div class="ligne">'+
      '<div class="t"><div style="flex:1">'+
        '<div style="font-weight:600;font-size:15px">'+ech(l.designation)+'</div>'+
        '<input value="'+ech(l.detail)+'" placeholder="Détail (facultatif)" oninput="setL('+i+',\'detail\',this.value)" style="border:0;padding:2px 0 0;font-size:12.5px;color:#6b7280">'+
        '<span class="chip'+(l.type==='MENSUEL'?'':' p')+'">'+(l.type==='MENSUEL'?'Mensuel récurrent':'Ponctuel')+'</span>'+
      '</div><button class="x" onclick="supprL('+i+')">Suppr.</button></div>'+
      '<div class="g">'+
        '<div><label>Quantité</label><div style="display:flex;gap:5px">'+
          '<input type="number" inputmode="decimal" step="0.01" min="0" value="'+l.qte+'" style="flex:1;min-width:0" oninput="setL('+i+',\'qte\',this.value,this)">'+
          '<button class="btn sec" style="flex:0 0 44px;padding:9px 0;font-size:13px" title="Calculer une surface" onclick="ouvrirSurface('+i+')">m²</button>'+
        '</div></div>'+
        '<div><label>Unité</label><div class="fige">'+ech(l.unite||'—')+'</div></div>'+
        '<div><label>P.U. HT</label><div class="fige" id="pu'+i+'">'+eur(l.pu)+'</div></div>'+
      '</div>'+
      '<div class="g">'+
        (rMax > 0
          // Pas d'inputmode : « decimal » ouvre le pavé numérique du téléphone,
          // où le signe % n'existe pas — le commercial ne pourrait pas le taper.
          // Et pas de plafond dans l'étiquette : cet écran peut être montré au
          // client, il n'a pas à y lire jusqu'où l'entreprise peut descendre.
          ? '<div><label>Remise %</label>'+
              '<input type="text" id="rem'+i+'" autocomplete="off" autocapitalize="off" '+
                'autocorrect="off" spellcheck="false" value="'+
                (l.rem||0)+(l.remMuet?' %':'')+'" oninput="setRemise('+i+',this.value,this)"></div>'
          : '<div><label>Remise</label><div class="fige">non autorisée</div></div>')+
        '<div><label>TVA %</label><div class="fige">'+nb(l.tva)+' %</div></div>'+
        '<div><label>Poste</label><input value="'+ech(l.categorie)+'" placeholder="Poste" oninput="setL('+i+',\'categorie\',this.value)"></div>'+
      '</div>'+
      // Sur toute la largeur, jamais coincé dans une colonne : ce message peut
      // être montré à un client, il doit se lire d'un coup d'œil.
      (rMax > 0
        ? '<div id="plaf'+i+'" class="plafond'+(montrerPlafond(l)?'':' hide')+
            '">Remise maximale accordée</div>'
        : '')+
      '<div class="ft"><span style="color:#6b7280">Total HT ligne</span><b id="tl'+i+'">'+
        eur(montantL(l))+'</b></div></div>';
  }).join('');
  majBarre();
}
function montantL(l){
  return Math.round((Number(l.qte)||0)*(Number(l.pu)||0)*(1-(Number(l.rem)||0)/100)*100)/100;
}
/* Un devis ne peut pas porter une quantité ou un prix négatif, ni une remise
   de plus de 100 % : une faute de frappe donnerait un total négatif au client. */
function setL(i,k,v,el){
  // Le prix, la TVA, l'unité, la désignation et le type appartiennent au
  // catalogue : aucun écran ne les modifie, et une tentative est ignorée.
  if(k==='pu' || k==='tva' || k==='unite' || k==='designation' || k==='type') return;
  if(k==='qte'||k==='rem'){
    var n = (v === '' ? 0 : Number(v)), borne = n;
    if(!isFinite(borne) || borne < 0) borne = 0;
    if(k === 'rem'){
      var m = remiseMax();
      if(borne > m) borne = m;
    }
    // On ne réécrit le champ que si la valeur a vraiment été ramenée dans les
    // clous : sinon on empêcherait de taper « 0,5 », qui vaut 0 un instant.
    if(el && borne !== n) el.value = borne;
    LIGNES[i][k] = borne;
  } else {
    LIGNES[i][k] = v;
  }
  if(k==='type'){ rendreLignes(); }
  else{
    var l=LIGNES[i], t=$('tl'+i);
    if(t) t.textContent = eur(montantL(l));
    majBarre();
  }
  sauverBrouillon();
}
function supprL(i){ LIGNES.splice(i,1); rendreLignes(); sauverBrouillon(); }

/* ====================== TOTAUX ====================== */
function totaux(){
  var t = {htPonctuel:0,htMensuel:0,ht:0,tva:0,ttc:0,parTaux:{}};
  LIGNES.forEach(function(l){
    var b = montantL(l), taux = Number(l.tva)||0;
    if(String(l.type).toUpperCase()==='MENSUEL') t.htMensuel+=b; else t.htPonctuel+=b;
    t.tva += b*taux/100;
    t.parTaux[taux] = (t.parTaux[taux]||0) + b*taux/100;
  });
  t.ht=t.htPonctuel+t.htMensuel; t.ttc=t.ht+t.tva;
  ['htPonctuel','htMensuel','ht','tva','ttc'].forEach(function(k){ t[k]=Math.round(t[k]*100)/100; });
  Object.keys(t.parTaux).forEach(function(k){ t.parTaux[k]=Math.round(t.parTaux[k]*100)/100; });
  return t;
}
/* Récapitulatif par poste, comme sur le devis imprimé. */
function calculer(){
  var t = totaux(), h='', postes = {}, ordre = [];
  LIGNES.forEach(function(l){
    var k = String(l.categorie||'').trim() || 'Prestations';
    if(!postes[k]){ postes[k]=0; ordre.push(k); }
    postes[k] += montantL(l);
  });
  ordre.forEach(function(k){
    h += '<div class="tot"><span>'+ech(k)+'</span><b>'+eur(Math.round(postes[k]*100)/100)+'</b></div>';
  });
  if(ordre.length) h += '<div style="height:6px"></div>';
  if(t.htMensuel && t.htPonctuel){
    h+='<div class="tot"><span>dont abonnement mensuel HT</span><b>'+eur(t.htMensuel)+'</b></div>';
  }
  h+='<div class="tot"><span>Total HT</span><b>'+eur(t.ht)+'</b></div>';
  Object.keys(t.parTaux).sort(function(a,b){return a-b;}).forEach(function(taux){
    h+='<div class="tot"><span>TVA '+taux+' %</span><b>'+eur(t.parTaux[taux])+'</b></div>';
  });
  h+='<div class="tot big"><span style="color:inherit">Total TTC</span><span>'+eur(t.ttc)+'</span></div>';
  $('recap').innerHTML = h;
  majBarre(); sauverBrouillon();
}
function majBarre(){
  var t = totaux(), pro = (TYPE === 'PRO');
  // Un professionnel raisonne en HT, un particulier en TTC : on met en avant
  // le chiffre dont le client va parler.
  $('bTot').textContent = eur(pro ? t.ht : t.ttc);
  $('bTotL').textContent = LIGNES.length+' ligne'+(LIGNES.length>1?'s':'')+(pro ? ' · HT' : ' · TTC');
}

/* ====================== SIGNATURE ====================== */
var SIG = {cv:null, ctx:null, dessine:false, vide:true, image:''};
function initSignature(){
  SIG.cv = $('sig');
  var r = SIG.cv.getBoundingClientRect(), d = window.devicePixelRatio||1;
  SIG.cv.width = Math.max(200, Math.round(r.width*d));
  SIG.cv.height = Math.max(120, Math.round(r.height*d));
  SIG.ctx = SIG.cv.getContext('2d');
  SIG.ctx.scale(d,d);
  SIG.ctx.lineWidth=2.2; SIG.ctx.lineCap='round'; SIG.ctx.lineJoin='round'; SIG.ctx.strokeStyle='#111827';
  SIG.vide = true;
}
function signatureValide(){ return !!SIG.image; }

/* Signature en plein écran : le téléphone est tendu au client. */
function ouvrirSignature(){
  SIG_APRES = null;
  $('soNom').textContent = val('fSignataire') || (lireClient().contact || lireClient().societe || '');
  $('soNomChamp').classList.add('hide');
  $('sigOverlay').classList.remove('hide');
  setTimeout(function(){ initSignature(); if(SIG.image) redessiner(SIG.image); }, 30);
}
function fermerSignature(valider){
  if(SIG_APRES) return fermerSignatureApres(valider);
  if(valider){
    SIG.image = SIG.vide ? '' : SIG.cv.toDataURL('image/png');
  }
  $('sigOverlay').classList.add('hide');
  majApercuSignature();
}

/* ====================== FAIRE SIGNER APRÈS COUP ======================
   Le devis est sorti, imprimé, lu par le client — et c'est là qu'il signe.
   L'application refabrique alors le PDF avec la signature dedans, remplace
   celui qu'elle gardait, et le renvoie au bureau : le devis signé est
   dématérialisé, sans photo de papier.

   Le PDF est reconstruit à partir du devis enregistré, jamais retouché :
   mêmes lignes, mêmes totaux, même numéro. Seuls s'ajoutent la signature,
   le nom du signataire et l'heure. */
var SIG_APRES = null;        // le devis en cours de signature, hors saisie

function ouvrirSignatureDevis(id, btn){
  if(btn) occuper(btn, '…');
  DB.get(id).then(function(e){
    if(btn) libere(btn);
    if(!e) return;
    if((e.devis||{}).signature)
      return erreur('Ce devis est déjà signé. Pour recommencer, refais un devis.');
    erreur('');
    SIG_APRES = e;
    var c = (e.devis||{}).client || {};
    $('soNom').textContent = 'Devis ' + e.numero;
    var champ = $('soNomChamp');
    champ.classList.remove('hide');
    $('soSignataire').value = (e.devis||{}).signataire || c.contact || c.societe || '';
    SIG.image = '';
    $('sigOverlay').classList.remove('hide');
    setTimeout(function(){ initSignature(); }, 30);
  }, function(){ if(btn) libere(btn); });
}

function fermerSignatureApres(valider){
  var e = SIG_APRES;
  var image = (valider && !SIG.vide) ? SIG.cv.toDataURL('image/png') : '';
  $('sigOverlay').classList.add('hide');
  $('soNomChamp').classList.add('hide');
  SIG_APRES = null;
  SIG.image = '';
  if(!valider || !e) return;
  if(!image) return erreur('Rien n\'a été tracé : le devis n\'a pas été signé.');
  var nom = val('soSignataire');
  if(!nom){
    var c = (e.devis||{}).client || {};
    nom = c.contact || c.societe || '';
  }
  appliquerSignature(e.id, image, nom);
}

function appliquerSignature(id, image, nom){
  return DB.get(id).then(function(e){
    if(!e) return;
    e.devis.signature = image;
    e.devis.signataire = nom;
    e.devis.signeLe = Date.now();
    try{
      e.pdf = PDF.base64(e.devis, CFG.reglages);       // le PDF signé remplace l'autre
      e.nomFichier = PDF.nomFichier(e.devis);
    }catch(err){
      tracer('ERREUR PDF', String(err && err.message || err), e.numero);
      return erreur('Le devis signé n\'a pas pu être refabriqué. La signature n\'a pas été enregistrée.');
    }
    // Un client qui signe a accepté : le résultat n'a plus à être demandé.
    e.verdict = 'SIGNE'; e.motif = ''; e.relance = '';
    e.verdictLe = Date.now(); e.verdictEnvoye = false;
    e.statut = 'attente';                              // le PDF signé repart au bureau
    return DB.put(e).then(function(){
      DERNIER = e;
      var c = (e.devis||{}).client || {};
      tracer('SIGNATURE CLIENT', nom || c.contact || c.societe || '', e.numero);
      tracer('RESULTAT SIGNE', 'signé à l\'écran', e.numero);
      erreur('');
      if(ETAPE === 5){
        // Le devis signé n'est plus celui que le bureau a reçu : l'écran doit
        // le dire tout de suite, sans attendre la fin de l'envoi.
        $('okEtat').textContent = attenteLisible(e);
        peindreVerdict();
      }
      if(ETAPE === 6) rendreHistorique();
      synchroniser(false);
    });
  });
}

/* L'état de la signature, sur l'écran de fin comme dans « Mes devis ». */
function estSigne(e){ return !!(e && (e.devis||{}).signature); }
function signeLisible(e){
  var t = (e.devis||{}).signeLe;
  if(!t) return 'Signé par le client.';
  var d = new Date(t);
  return 'Signé le ' + jjmmaa(d.toISOString().slice(0,10)) +
         ' à ' + ('0'+d.getHours()).slice(-2) + 'h' + ('0'+d.getMinutes()).slice(-2) + '.';
}
function majApercuSignature(){
  var f = !!SIG.image;
  $('sigFaite').classList.toggle('hide', !f);
  $('sigVide').classList.toggle('hide', f);
  if(f) $('sigApercu').src = SIG.image;
}
function redessiner(dataUrl){
  var img = new Image();
  img.onload = function(){
    var d = window.devicePixelRatio||1;
    SIG.ctx.drawImage(img, 0, 0, SIG.cv.width/d, SIG.cv.height/d);
    SIG.vide = false;
  };
  img.src = dataUrl;
}
function effacerTrait(){ SIG.ctx.clearRect(0,0,SIG.cv.width,SIG.cv.height); SIG.vide = true; }
function brancherSignature(){
  var cv = $('sig');
  function pos(e){ var r=cv.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }
  cv.addEventListener('pointerdown', function(e){ e.preventDefault(); SIG.dessine=true; SIG.vide=false;
    try{ cv.setPointerCapture(e.pointerId); }catch(err){}
    var p=pos(e); SIG.ctx.beginPath(); SIG.ctx.moveTo(p.x,p.y); });
  cv.addEventListener('pointermove', function(e){ if(!SIG.dessine) return; e.preventDefault();
    var p=pos(e); SIG.ctx.lineTo(p.x,p.y); SIG.ctx.stroke(); });
  ['pointerup','pointercancel','pointerleave'].forEach(function(ev){
    cv.addEventListener(ev, function(){ SIG.dessine=false; }); });
}
function effacerSignature(){
  if(SIG.ctx) SIG.ctx.clearRect(0,0,SIG.cv.width,SIG.cv.height);
  SIG.vide = true; SIG.image = '';
  majApercuSignature();
}

/* ====================== PHOTOS DU SITE ======================
   Réduites dans l'appareil avant stockage : une photo de téléphone pèse
   plusieurs mégaoctets, ce qui ne passerait pas sur un réseau de chantier. */
var MAX_PHOTOS = 12;
var PHOTO_ID = null;          // devis en cours de prise de vue
var PHOTO_TYPE = 'SITE';      // SITE = les locaux · SIGNE = le devis signé sur papier

/* Les photos se prennent APRÈS coup, sur un devis déjà signé et enregistré :
   on ne fait pas patienter le client pendant qu'on photographie ses locaux. */
function ouvrirPhotos(id, type){
  if(!id) return;
  PHOTO_ID = id;
  PHOTO_TYPE = (type === 'SIGNE') ? 'SIGNE' : 'SITE';
  DB.get(id).then(function(e){
    if(!e){ PHOTO_ID = null; return; }
    PHOTO_RETOUR = (ETAPE === 5) ? 5 : 6;
    ETAPE = 7; montrer('e7');
    $('steps').classList.add('hide');
    barreRetour();
    $('bHist').classList.remove('hide');
    var sig = (PHOTO_TYPE === 'SIGNE');
    $('hTitre').textContent = sig ? 'Devis signé' : 'Photos du site';
    $('phTitre').textContent = sig ? 'Devis signé' : 'Photos du site';
    $('phBtn').textContent   = sig ? 'Photographier le devis signé' : 'Prendre des photos';
    $('phAide').textContent  = sig
      ? 'Photographie les pages signées, bien à plat et lisibles : c\'est cette photo qui '
        + 'fait preuve de l\'accord du client. Elle est rangée dans le dossier Drive du devis.'
      : 'Pour l\'équipe qui interviendra et pour justifier le chiffrage. Elles partent dans le '
        + 'dossier Drive du devis, jamais sur le PDF remis au client.';
    var c = (e.devis||{}).client || {};
    $('phDevis').textContent = e.numero + ' · ' + (c.societe || c.contact || '');
    rendrePhotos(e);
    window.scrollTo(0,0);
  });
}
function photosDernier(){ if(DERNIER) ouvrirPhotos(DERNIER.id, 'SITE'); }

/* Rafraîchit l'écran photos quand un envoi vient d'aboutir en arrière-plan. */
function majEcranPhotos(){
  if(ETAPE !== 7 || !PHOTO_ID) return;
  DB.get(PHOTO_ID).then(function(e){ if(e) rendrePhotos(e); });
}

function ajouterPhotos(input){
  var fichiers = Array.prototype.slice.call(input.files || []);
  input.value = '';
  if(!fichiers.length || !PHOTO_ID) return;
  DB.get(PHOTO_ID).then(function(e){
    if(!e) return;
    e.photos = e.photos || [];
    var reste = MAX_PHOTOS - e.photos.length;
    if(reste <= 0) return erreur(MAX_PHOTOS + ' photos au maximum par devis.');
    if(fichiers.length > reste) erreur('Seules les ' + reste + ' premières photos ont été ajoutées.');
    return fichiers.slice(0, reste).reduce(function(p, f){
      var pleine = '';
      return p.then(function(){ return reduirePhoto(f, 1400, 0.72); })
              .then(function(d){ pleine = d; return d ? reduirePhoto(f, 260, 0.6) : ''; })
              .then(function(v){ if(pleine) e.photos.push({d:pleine, v:v, t:PHOTO_TYPE, envoye:false}); });
    }, Promise.resolve()).then(function(){
      return DB.put(e);
    }).then(function(){
      tracer(PHOTO_TYPE === 'SIGNE' ? 'PREUVE SIGNATURE AJOUTEE' : 'PHOTOS AJOUTEES',
             fichiers.length + ' photo' + (fichiers.length>1?'s':''), e.numero);
      rendrePhotos(e);
      synchroniser(false);
    });
  });
}
function reduirePhoto(f, max, qualite){
  return new Promise(function(res){
    if(!f || !/^image\//.test(f.type || '')) return res('');
    var url = URL.createObjectURL(f), img = new Image();
    img.onload = function(){
      try{
        var e = Math.min(1, (max || 1400) / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * e));
        cv.height = Math.max(1, Math.round(img.height * e));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL('image/jpeg', qualite || 0.72));
      }catch(err){ res(''); }
      URL.revokeObjectURL(url);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); res(''); };
    img.src = url;
  });
}
/* On ne retire qu'une photo pas encore partie : une fois dans Drive,
   elle n'appartient plus à l'appareil. */
function supprPhoto(i){
  if(!PHOTO_ID) return;
  DB.get(PHOTO_ID).then(function(e){
    if(!e || !e.photos || !e.photos[i] || e.photos[i].envoye) return;
    e.photos.splice(i,1);
    tracer('PHOTO RETIREE', 'avant envoi', e.numero);
    return DB.put(e).then(function(){ rendrePhotos(e); });
  });
}

function rendrePhotos(e){
  var c = $('photosL');
  if(!c) return;
  var ph = (e && e.photos) || [];
  c.innerHTML = ph.map(function(p,i){
    var sig = (p.t === 'SIGNE');
    return '<figure><img src="'+p.d+'" alt="'+(sig?'Devis signé':'Photo du site')+' '+(i+1)+'">'+
      (sig ? '<figcaption class="vb vb-s">SIGNÉ</figcaption>' : '')+
      (p.envoye ? '' : '<button onclick="supprPhoto('+i+')" aria-label="Supprimer la photo">✕</button>')+
      '</figure>';
  }).join('');
  var att = ph.filter(function(p){ return !p.envoye; }).length;
  var etat = $('phEtat');
  if(!etat) return;
  var sig = (PHOTO_TYPE === 'SIGNE');
  var nom = function(n){ return sig ? ('page' + (n>1?'s':'') + ' du devis signé')
                                    : ('photo' + (n>1?'s':'') + ' du site'); };
  if(!ph.length) etat.textContent = sig
    ? 'Pas encore de photo du devis signé.'
    : 'Aucune photo pour ce devis.';
  else if(!att) etat.textContent = ph.length + ' ' + nom(ph.length) + ' rangée' +
    (ph.length>1?'s':'') + ' dans le dossier Drive du devis.';
  else etat.textContent = att + ' photo' + (att>1?'s':'') + ' en attente d\'envoi' +
    (navigator.onLine ? ' — envoi en cours.' : ' — elles partiront au retour du réseau.');
}

/* ====================== BROUILLON ====================== */
function lireClient(){
  var pro = (TYPE === 'PRO');
  return {type: TYPE || 'PRO',
          plus2ans: pro ? null : PLUS2ANS,
          societe: pro ? val('cSociete') : '',
          siret:   pro ? val('cSiret')   : '',
          tva:     pro ? val('cTva')     : '',
          contact:val('cContact'),tel:val('cTel'),email:val('cEmail'),
          adresse:val('cAdresse'),cp:val('cCp'),ville:val('cVille')};
}
function sauverBrouillon(){
  lsj('brouillon', {client:lireClient(), lignes:LIGNES, objet:val('fObjet'),
                    plus2ans:PLUS2ANS, taux:TAUX, delai:val('fDelai'), notes:val('fNotes')});
}
function restaurer(b){
  LIGNES = b.lignes||[];
  var c = b.client||{};
  TYPE = (c.type === 'PART') ? 'PART' : 'PRO';
  majType();
  ['Societe','Siret','Tva','Contact','Tel','Email','Adresse','Cp','Ville'].forEach(function(k){
    $('c'+k).value = c[k.toLowerCase()]||''; });
  $('fObjet').value = b.objet||'';
  $('fDelai').value = b.delai||'';
  PLUS2ANS = (b.plus2ans === true || b.plus2ans === false) ? b.plus2ans : null;
  TAUX = b.taux || null;
  majTva();
  $('fNotes').value = b.notes||'';
}

/* ====================== NUMÉROTATION LOCALE ====================== */
function initiales(nom){
  var p = String(nom).trim().split(/\s+/).map(function(m){ return m.charAt(0); }).join('');
  return (p.toUpperCase().replace(/[^A-Z]/g,'') || 'XX').slice(0,3);
}
function serieDe(nom){
  var an = new Date().getFullYear();
  return String((CFG.reglages||{}).prefixe_devis||'DEV')+'-'+an+'-'+initiales(nom);
}
function prochainNumero(nom){
  var serie = serieDe(nom), cle = 'seq_'+serie;
  var n = Number(ls(cle)||0)+1;
  ls(cle, String(n));
  return serie+'-'+('000'+n).slice(-4);
}
/* Le bureau nous dit où en est chaque série : un téléphone réinstallé
   (compteur reparti à zéro) ne réutilise pas un numéro déjà pris. */
function alignerCompteurs(){
  var c = CFG && CFG.compteurs;
  if(!c) return;
  Object.keys(c).forEach(function(serie){
    var cle = 'seq_'+serie, local = Number(ls(cle)||0), distant = Number(c[serie])||0;
    if(distant > local) ls(cle, String(distant));
  });
}

/* ====================== ENREGISTREMENT ====================== */
function enregistrer(){
  if(EN_COURS) return;
  if(ETAPE !== 4) return;                       // on n'enregistre que depuis l'écran de validation
  if(!LIGNES.length) return erreur('Ajoute au moins une prestation.');
  if(TYPE === 'PRO' && !val('cSociete')) return erreur('Indique la raison sociale du client.');
  if(TYPE !== 'PRO' && !val('cContact')) return erreur('Indique le nom du client.');
  var envoi = $('fEnvoi').checked;
  if(envoi && !val('cEmail')) return erreur('Pas d\'e-mail client : décoche l\'envoi ou renseigne l\'adresse.');
  var moi = session();
  if(!moi) return erreur('Identifie-toi d\'abord.');

  EN_COURS = true;
  var b = $('bSuiv');
  occuper(b, 'Création du PDF…');
  // filet de sécurité : un bouton ne doit jamais rester bloqué
  var secours = setTimeout(function(){ debloquer(b); }, 30000);
  peindre().then(function(){
    try{ enregistrerSuite(b, envoi, moi, secours); }
    catch(e){ debloquer(b, secours);
      tracer('ERREUR', String(e && e.message || e));
      erreur('Le devis n\'a pas pu être enregistré. Réessaie ; si ça recommence, préviens le bureau.'); }
  }, function(){ debloquer(b, secours); });
}

/* Remet l'application en état, quoi qu'il arrive. */
function debloquer(b, secours){
  if(secours) clearTimeout(secours);
  EN_COURS = false;
  libere(b || $('bSuiv'));
}

function enregistrerSuite(b, envoi, moi, secours){
  try{
    var jours = Number((CFG.reglages||{}).validite_jours||30);
    var devis = {
      numero: prochainNumero(moi.nom),
      date: new Date().toISOString(),
      validite: new Date(Date.now()+jours*86400000).toISOString(),
      commercial: moi.nom,
      client: lireClient(),
      lignes: LIGNES.slice(),
      objet: val('fObjet'),
      delai: val('fDelai'),
      remise: 0,        // la remise est portée par chaque ligne
      notes: val('fNotes'),
      signataire: val('fSignataire'),
      signature: SIG.image || '',
      totaux: totaux()
    };
    var pdf64 = PDF.base64(devis, CFG.reglages);
    var enr = {
      id: 'd-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
      numero: devis.numero, devis: devis, pdf: pdf64,
      nomFichier: PDF.nomFichier(devis),
      envoyerClient: envoi, statut: 'attente', cree: Date.now(),
      nom: moi.nom, code: moi.code, appareil: APPAREIL, pdfUrl: '',
      photos: [],           // prises plus tard, depuis « Mes devis »
      verdict: '', motif: '', relance: '', note: '', verdictEnvoye: false
    };
    DERNIER = enr;
    DB.put(enr).then(function(){
      var cl = devis.client.societe || devis.client.contact || '';
      tracer('DEVIS CREE', cl + ' — ' + eur(devis.totaux.ttc) + ' TTC — TVA ' +
             (TAUX || '?') + ' %', devis.numero);
      if(devis.signature) tracer('SIGNATURE CLIENT', devis.signataire || cl, devis.numero);
      lsj('brouillon', null);
      chargerRepertoire();
      $('okNum').textContent = devis.numero;
      $('okTot').textContent = eur(devis.totaux.ttc)+' TTC';
      $('okEtat').textContent = navigator.onLine
        ? 'Envoi au bureau en cours…'
        : 'Hors connexion : le devis part automatiquement dès que le réseau revient.';
      debloquer(b, secours);
      TERMINE_RETOUR = 0;
      V_TYPE = ''; V_MOTIF = '';
      montrerTermine();
      synchroniser(false);
    }, function(e){
      debloquer(b, secours);
      tracer('ERREUR ENREGISTREMENT', String(e && e.message || e));
      erreur('Le devis n\'a pas pu être enregistré sur l\'appareil. '+
             'Vérifie qu\'il reste de la place, puis réessaie.');
    });
  }catch(e){
    debloquer(b, secours);
    tracer('ERREUR PDF', String(e && e.message || e));
    erreur('Le PDF n\'a pas pu être créé. Réessaie ; si ça recommence, préviens le bureau.');
  }
}

/* ====================== PARTAGE DU PDF ====================== */
function b64versBlob(b64){
  var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
  for(var i=0;i<n;i++) u[i]=bin.charCodeAt(i);
  return new Blob([u], {type:'application/pdf'});
}
function partager(enr){
  if(!enr || !enr.pdf) return;
  tracer('PDF PARTAGE', enr.nomFichier || '', enr.numero);
  var blob = b64versBlob(enr.pdf);
  var f;
  try{ f = new File([blob], enr.nomFichier, {type:'application/pdf'}); }catch(e){ f=null; }
  if(f && navigator.canShare && navigator.canShare({files:[f]})){
    navigator.share({files:[f], title:'Devis '+enr.numero}).catch(function(){});
    return;
  }
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href=url; a.download=enr.nomFichier; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 4000);
}
function partagerDernier(btn){
  if(btn) occuper(btn, 'Préparation…');
  peindre().then(function(){ partager(DERNIER); if(btn) setTimeout(function(){ libere(btn); }, 600); });
}
function partagerId(id, btn){
  if(btn) occuper(btn, '…');
  DB.get(id).then(function(e){ partager(e); if(btn) setTimeout(function(){ libere(btn); }, 600); });
}

/* ====================== SYNCHRONISATION ====================== */
function etatReseau(nb, msg, classe){
  var d = $('reseau');
  if(msg){ d.className = classe||'att'; d.textContent = msg; return; }
  DB.tous().then(function(l){
    var att = l.filter(function(x){ return x.statut==='attente'; }).length;
    if(!navigator.onLine){
      d.className='off';
      d.textContent = 'Hors connexion — tout fonctionne' + (att? ' · '+att+' devis à envoyer' : '');
    } else if(att){
      d.className='att'; d.textContent = att+' devis en attente d\'envoi';
    } else { d.className=''; d.textContent=''; }
  });
}

var SYNC = false;
function synchroniser(manuel, btn){
  // Un agent n'a pas de devis à envoyer : pour lui, se synchroniser veut dire
  // remonter ses pointages et rafraîchir son planning.
  if(estAgent()){
    if(btn) libere(btn);
    return pousserChantiers().then(function(){
      if(navigator.onLine) chargerPlanning();
    });
  }
  if(SYNC){ if(btn) libere(btn); return; }
  if(btn) occuper(btn, 'Envoi…');
  if(!navigator.onLine){
    if(btn) libere(btn);
    if(manuel) etatReseau(null, 'Hors connexion : impossible de synchroniser maintenant.', 'off');
    else etatReseau();
    return;
  }
  SYNC = true;                     // verrou posé tout de suite : deux appels rapprochés
  DB.tous().then(function(l){      // (retour du réseau + minuterie) n'enverraient pas deux fois
    var att = l.filter(function(x){
      return x.statut==='attente' || ((x.verdict || x.note) && !x.verdictEnvoye) ||
             (x.photos||[]).some(function(p){ return !p.envoye; });
    });
    if(!att.length){ SYNC = false; if(btn) libere(btn); etatReseau();
      if(ETAPE===6) rendreHistorique(); envoyerJournal(); return; }
    etatReseau(null, 'Envoi de '+att.length+' devis…', 'att');
    var suite = Promise.resolve();
    att.forEach(function(enr){ suite = suite.then(function(){ return envoyer(enr); }); });
    suite.then(function(){
      SYNC = false; if(btn) libere(btn);
      etatReseau(); if(ETAPE===6) rendreHistorique(); majEtatDernier(); majEcranPhotos(); purger();
      envoyerJournal();
    }, function(){ SYNC = false; if(btn) libere(btn); etatReseau(); majEcranPhotos(); envoyerJournal(); });
  }, function(){ SYNC = false; if(btn) libere(btn); });
}

function envoyer(enr){
  if(enr.statut !== 'attente'){
    return envoyerVerdict(enr).then(function(){ return envoyerPhotos(enr); });
  }
  return envoyerDevis(enr)
    .then(function(){ return envoyerVerdict(enr); })
    .then(function(){ return envoyerPhotos(enr); });
}

/* Le résultat du rendez-vous part à part du devis : il est souvent saisi
   plus tard, parfois corrigé, et il ne doit jamais renvoyer tout le PDF. */
function envoyerVerdict(enr){
  // une note seule vaut le voyage : c'est souvent elle qui dit pourquoi
  if((!enr.verdict && !enr.note) || enr.verdictEnvoye || enr.statut !== 'envoye')
    return Promise.resolve();
  return fetch(API_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({
      action:'statut', id:enr.id, nom:enr.nom, code:enr.code, appareil:enr.appareil,
      numero:enr.numero, verdict:enr.verdict, motif:enr.motif||'', relance:enr.relance||'',
      note: enr.note||'', quand: enr.verdictLe || Date.now()
    })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if(!d || !d.ok) throw new Error((d && d.erreur) || 'refusé');
    enr.verdictEnvoye = true;
    return DB.put(enr);
  })
  .catch(function(){});
}

/* Les photos partent APRÈS le devis, une par une : un envoi lourd qui échoue
   ne doit jamais empêcher le devis lui-même d'arriver au bureau. */
function envoyerPhotos(enr){
  var reste = (enr.photos||[]).filter(function(p){ return !p.envoye; });
  if(!reste.length || enr.statut !== 'envoye') return Promise.resolve();
  var suite = Promise.resolve();
  (enr.photos||[]).forEach(function(p, i){
    if(p.envoye) return;
    suite = suite.then(function(){
      return fetch(API_URL, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify({
          action:'photo', id:enr.id, nom:enr.nom, code:enr.code,
          numero:enr.numero, date:enr.devis.date, commercial:enr.devis.commercial,
          index:i+1, total:enr.photos.length, type:(p.t === 'SIGNE' ? 'SIGNE' : 'SITE'),
          image: p.d.substring(p.d.indexOf(',')+1)
        })
      })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d || !d.ok) return;
        p.envoye = true;
        p.url = d.url || '';
        // La photo est dans Drive : on ne garde qu'une vignette sur le téléphone,
        // vingt fois plus légère. C'est ce qui empêche l'appli de gonfler.
        if(p.v) p.d = p.v;
        return DB.put(enr);
      });
    });
  });
  return suite.catch(function(){});
}

function envoyerDevis(enr){
  return fetch(API_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},  // évite la requête preflight
    body: JSON.stringify({
      action:'sync', id:enr.id, nom:enr.nom, code:enr.code, appareil:enr.appareil,
      envoyerClient:enr.envoyerClient, devis:enr.devis, pdf:enr.pdf, nomFichier:enr.nomFichier
    })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if(!d.ok){
      // le bureau ne reconnaît plus ce commercial : on redemande une connexion
      if(d.refus){ oublierVerif(enr.nom); reidentifier('Ton accès a changé côté bureau.'); }
      throw new Error(d.erreur||'refusé');
    }
    enr.statut='envoye'; enr.pdfUrl=d.pdfUrl||''; enr.envoye=Date.now();
    if(d.numero && d.numero !== enr.numero){   // le bureau a dû renuméroter
      enr.numeroPdf = enr.numero; enr.numero = d.numero;
    }
    return DB.put(enr);
  })
  .catch(function(e){
    var m = String(e && e.message || e);
    if(enr.derniereErreur !== m) tracer('ENVOI ECHOUE', m, enr.numero);
    enr.derniereErreur = m;     // gardé pour le journal, jamais montré tel quel
    return DB.put(enr);
  });
}

function majEtatDernier(){
  if(!DERNIER) return;
  DB.get(DERNIER.id).then(function(e){
    if(!e) return;
    DERNIER = e;
    if($('e5').classList.contains('hide')) return;
    $('okEtat').textContent = e.statut==='envoye'
      ? 'Envoyé au bureau' + (e.envoyerClient ? ' et transmis au client.' : '.')
      : attenteLisible(e);
    peindreBlocSignature();       // « signé, pas encore remonté » ne doit pas rester affiché
  });
}

/* Le détail technique d'une panne (« Unexpected token < ... ») n'apprend rien
   à un commercial et l'inquiète pour rien : il part au journal, et l'écran ne
   dit que ce qui le concerne — c'est parti, ou ça partira tout seul. */
function attenteLisible(e){
  if(!navigator.onLine)
    return 'Hors connexion : le devis part automatiquement dès que le réseau revient.';
  if(e && e.derniereErreur)
    return 'Le bureau n\'a pas répondu. Nouvelle tentative automatique, rien n\'est perdu.';
  return 'Envoi au bureau en cours…';
}

/* ====================== PURGE ======================
   Un devis parti au bureau n'a plus besoin de rester sur le téléphone : il est
   dans le classeur et son PDF dans le Drive. On allège donc les appareils, et
   on limite ce qui se perd avec un téléphone égaré.
   Règle absolue : on ne touche jamais à un devis, ni à une photo, qui n'est pas
   encore arrivé au bureau, quel que soit son âge. */
var RETENTION_JOURS = 30;
function purger(){
  var limite = Date.now() - RETENTION_JOURS * 86400000;
  return DB.tous().then(function(l){
    var vieux = l.filter(function(e){
      if(e.statut !== 'envoye') return false;
      if((e.photos||[]).some(function(p){ return !p.envoye; })) return false;
      if((e.verdict || e.note) && !e.verdictEnvoye) return false;
      return Number(e.envoye || e.cree || 0) < limite;
    });
    if(!vieux.length) return;
    return vieux.reduce(function(p, e){
      return p.then(function(){ return DB.suppr(e.id); });
    }, Promise.resolve()).then(function(){
      chargerRepertoire();
      if(ETAPE === 6) rendreHistorique();
    });
  }, function(){});
}

/* ====================== HISTORIQUE ====================== */
function ouvrirHistorique(){
  if(ETAPE >= 1 && ETAPE <= 5) ECRAN_AVANT = ETAPE;
  ETAPE=6; montrer('e6');
  $('steps').classList.add('hide');
  barreRetour();
  $('bHist').classList.add('hide');      // on y est déjà
  $('hTitre').textContent='Mes devis';
  var moi = session();
  $('quiSuisJe').textContent = (moi && moi.nom) || '—';
  var m=$('majCat'); if(m && CFG && CFG.maj) m.textContent = new Date(CFG.maj).toLocaleDateString('fr-FR');
  rendreHistorique(); window.scrollTo(0,0);
}
function rendreHistorique(){
  DB.tous().then(function(l){
    l.sort(function(a,b){ return b.cree-a.cree; });
    peindreRappels(l);
    if(!l.length){ $('liste').innerHTML='<div class="empty">Aucun devis pour le moment.</div>'; return; }
    $('liste').innerHTML = l.slice(0,100).map(function(e){
      var d = new Date(e.cree);
      var cl = String((e.devis.client||{}).societe || (e.devis.client||{}).contact || '—');
      var ph = (e.photos||[]).length;
      var phAtt = (e.photos||[]).filter(function(p){ return !p.envoye; }).length;
      var sig = (e.photos||[]).some(function(p){ return p.t === 'SIGNE'; });
      return '<div class="hist"><div class="i">'+
        '<b>'+badgeVerdict(e)+ech(cl)+'</b>'+
        '<span><span class="pt '+(e.statut==='envoye'?'pt-ok':'pt-att')+'"></span>'+
        ech(e.numero)+' · '+d.toLocaleDateString('fr-FR')+' · '+eur(e.devis.totaux.ttc)+' TTC'+
        (e.statut==='envoye'?'':' \u00b7\u00a0à envoyer')+
        (phAtt?' \u00b7\u00a0'+phAtt+'\u00a0photo'+(phAtt>1?'s':'')+' à envoyer':'')+
        (e.numeroPdf?' · renuméroté (PDF client : '+ech(e.numeroPdf)+')':'')+
        detailVerdict(e)+'</span></div>'+
        '<div class="acts">'+
        '<button class="btn sec sm" onclick="partagerId(\''+e.id+'\', this)">PDF</button>'+
        '<button class="btn sec sm" onclick="ouvrirVerdict(\''+e.id+'\')">Résultat</button>'+
        '<button class="btn sec sm" onclick="ouvrirPhotos(\''+e.id+'\', \''+
          (e.verdict==='SIGNE' && !sig ? 'SIGNE' : 'SITE')+'\')">Photos'+(ph?' ('+ph+')':'')+'</button>'+
        (estSigne(e) ? '' :
          '<button class="btn sec sm" onclick="ouvrirSignatureDevis(\''+e.id+'\', this)">Signer</button>')+
        '<button class="btn sec sm" onclick="dupliquer(\''+e.id+'\', this)">Dupliquer</button>'+
        (e.statut==='envoye' ? '' :
          '<button class="btn sec sm" onclick="renvoyer(\''+e.id+'\', this)">Renvoyer</button>')+
        '</div></div>';
    }).join('');
  });
}

/* La pastille de résultat : le commercial voit d'un coup d'œil ce qui traîne. */
function badgeVerdict(e){
  var v = e.verdict;
  if(!v) return '<span class="vb vb-a">À RENSEIGNER</span>';
  if(v === 'SIGNE')  return '<span class="vb vb-s">SIGNÉ</span>';
  if(v === 'REFUSE') return '<span class="vb vb-x">REFUSÉ</span>';
  return '<span class="vb vb-r">À RELANCER</span>';
}
function detailVerdict(e){
  var n = e.note ? '<br><i>« ' + ech(e.note) + ' »</i>' : '';
  return detailEtat(e) + n;
}
function detailEtat(e){
  if(e.verdict === 'REFUSE' && e.motif) return '<br>Refusé : ' + ech(e.motif);
  if(e.verdict === 'RELANCE' && e.relance){
    var dû = (e.relance <= new Date().toISOString().slice(0,10));
    return '<br>' + (dû ? 'À relancer maintenant (prévu le ' : 'Relance prévue le ') +
           jjmmaa(e.relance) + (dû ? ')' : '');
  }
  if(e.verdict === 'SIGNE' && estSigne(e)) return '<br>' + ech(signeLisible(e));
  // La photo du papier n'a de sens que pour un devis signé sur papier : celui
  // qui a été signé à l'écran porte déjà sa preuve dans son PDF.
  if(e.verdict === 'SIGNE' && !(e.photos||[]).some(function(p){ return p.t === 'SIGNE'; }))
    return '<br>Photo du devis signé manquante';
  return '';
}

/* Un seul rappel, en haut de la liste : les relances du jour et les devis
   remis dont on ne sait toujours pas ce qu'ils sont devenus. */
function peindreRappels(l){
  var z = $('rappels');
  if(!z) return;
  var auj = new Date().toISOString().slice(0,10);
  var hier = new Date(Date.now() - 86400000).getTime();
  var rel = l.filter(function(e){ return e.verdict === 'RELANCE' && e.relance && e.relance <= auj; });
  var sans = l.filter(function(e){ return !e.verdict && Number(e.cree||0) < hier; });
  var sig = l.filter(function(e){
    return e.verdict === 'SIGNE' && !estSigne(e) &&
           !(e.photos||[]).some(function(p){ return p.t === 'SIGNE'; });
  });
  var t = [];
  if(rel.length)  t.push(rel.length + ' client' + (rel.length>1?'s à relancer':' à relancer') + ' aujourd\'hui.');
  if(sans.length) t.push(sans.length + ' devis sans résultat renseigné.');
  if(sig.length)  t.push(sig.length + ' devis signé' + (sig.length>1?'s':'') + ' sans photo du papier.');
  if(!t.length){ z.classList.add('hide'); z.innerHTML = ''; return; }
  z.innerHTML = '<b>À faire</b>' + t.map(ech).join('<br>');
  z.classList.remove('hide');
}

/* Repasser un devis en file d'attente : utile si le bureau ne l'a jamais reçu.
   Aucun risque de doublon, le bureau reconnaît un devis déjà enregistré. */
function renvoyer(id, btn){
  if(btn) occuper(btn, '');
  DB.get(id).then(function(e){
    if(!e){ if(btn) libere(btn); return; }
    e.statut = 'attente'; delete e.derniereErreur;
    tracer('RENVOI DEMANDE', '', e.numero);
    return DB.put(e).then(function(){ rendreHistorique(); synchroniser(true); });  // le rendu recrée le bouton
  });
}

/* Repartir d'un devis existant : un devis de copropriété ressemble beaucoup
   au précédent, et une renégociation ne change souvent qu'une ligne. */
function dupliquer(id, btn){
  if(btn) occuper(btn, '');
  DB.get(id).then(function(e){
    if(btn) libere(btn);
    if(!e || !e.devis) return;
    var d = e.devis, c = d.client || {};
    nouveauDevis();
    TYPE = (c.type === 'PART') ? 'PART' : 'PRO';
    PLUS2ANS = (c.plus2ans === true || c.plus2ans === false) ? c.plus2ans : null;
    majType();
    if(PLUS2ANS !== null) appliquerTaux(PLUS2ANS ? 10 : 20);
    ['Societe','Siret','Tva','Contact','Tel','Email','Adresse','Cp','Ville'].forEach(function(k){
      $('c'+k).value = c[k.toLowerCase()] || '';
    });
    tracer('DEVIS DUPLIQUE', 'repris de ' + e.numero, e.numero);
    LIGNES = (d.lignes||[]).map(function(l){
      var o = {}; for(var k in l){ if(l.hasOwnProperty(k)) o[k] = l[k]; } return o;
    });
    $('fObjet').value = d.objet || '';
    $('fDelai').value = d.delai || '';
    $('fNotes').value = d.notes || '';
    sauverBrouillon();
    etape(2);
    erreur('');
  });
}

/* ====================== ESPACE PRESTATAIRE ======================
   Un agent voit son planning, ouvre une fiche, pointe son arrivée et son
   départ, coche ce qu'il a fait. Tout fonctionne sans réseau : l'heure est
   celle de l'appareil, prise au moment du geste, et l'envoi part dès que le
   réseau revient. C'est le choix assumé — sur un chantier en sous-sol, un
   pointage impossible serait pire qu'un pointage horodaté par le téléphone. */

var CHANTIER = null;          // le chantier ouvert à l'écran

function estAgent(){
  var m = session();
  return !!(m && m.role === 'PRESTATAIRE');
}

/* ---- le planning ---- */

function ecranPlanning(){
  ETAPE = 0;
  fermerDialogues();
  montrer('eAg1');
  $('steps').classList.add('hide');
  $('bar').classList.add('hide');
  $('bHist').classList.add('hide');
  $('hTitre').textContent = 'Mon planning';
  erreur('');
  window.scrollTo(0,0);
  peindrePlanning();
  if(navigator.onLine) chargerPlanning();
}

function chargerPlanning(btn){
  var moi = session();
  if(!moi) return;
  if(!navigator.onLine){
    if(btn) libere(btn);
    return erreur('Hors connexion : voici le planning tel qu\'il était au dernier passage.');
  }
  if(btn) occuper(btn, 'Mise à jour…');
  poster({action:'planning', nom:moi.nom, code:moi.code, appareil:APPAREIL}).then(function(d){
    if(btn) libere(btn);
    if(!d || !d.ok){
      if(d && d.refus) return reidentifier('Ton accès a changé côté bureau.');
      return erreur(attenteLisible());
    }
    // On garde ce qui n'est pas encore parti : le réseau ne doit jamais
    // écraser un pointage fait sur le terrain et pas encore remonté.
    return DB.cTous().then(function(locaux){
      var attente = {};
      (locaux || []).forEach(function(c){
        if(c.aEnvoyer && Object.keys(c.aEnvoyer).length) attente[c.id] = c;
      });
      return (d.chantiers || []).reduce(function(p, c){
        var garde = attente[c.id];
        if(garde){
          // Ce que le terrain a saisi et qui n'est pas encore remonté prime sur
          // ce que le bureau renvoie : sinon un pointage fait en zone blanche
          // serait effacé par le premier rafraîchissement.
          c.aEnvoyer = garde.aEnvoyer;
          ['arrivee','depart','minutes','faites','note','signalement','statut']
            .forEach(function(k){
              if(garde[k] !== undefined && garde[k] !== '' && garde[k] !== 0) c[k] = garde[k];
            });
        }
        return p.then(function(){ return DB.cPut(c); });
      }, Promise.resolve());
    }).then(function(){
      erreur('');
      peindrePlanning();
      pousserChantiers();
    });
  }, function(){
    if(btn) libere(btn);
    erreur(attenteLisible());
  });
}

function jourLisible(iso){
  var d = new Date(iso + 'T12:00:00');
  if(isNaN(d.getTime())) return iso;
  var a = new Date(); a.setHours(12,0,0,0);
  var diff = Math.round((d - a) / 86400000);
  var txt = d.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
  if(diff === 0) return 'Aujourd\'hui — ' + txt;
  if(diff === 1) return 'Demain — ' + txt;
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function peindrePlanning(){
  DB.cTous().then(function(l){
    l = l || [];
    var c = $('agListe');
    if(!l.length){
      c.innerHTML = '<div class="card"><div class="empty">Aucun chantier pour le moment.<br>' +
                    'Il apparaîtra ici dès que le bureau te l\'aura affecté.</div></div>';
      $('agQuand').textContent = '—';
      return;
    }
    var aujourdhui = new Date().toISOString().slice(0,10);
    var reste = l.filter(function(x){ return x.date >= aujourdhui && x.statut !== 'FAIT'; }).length;
    $('agQuand').textContent = reste
      ? reste + ' chantier' + (reste>1?'s':'') + ' à venir'
      : 'Rien à venir pour l\'instant';

    /* À venir d'abord, du plus proche au plus lointain : c'est ce qu'on ouvre
       son téléphone pour savoir. Le passé ensuite, du plus récent au plus
       ancien, pour retrouver le chantier d'hier sans faire défiler un mois. */
    var futurs = l.filter(function(x){ return x.date >= aujourdhui; })
                  .sort(function(a,b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    var passes = l.filter(function(x){ return x.date < aujourdhui; })
                  .sort(function(a,b){ return a.date > b.date ? -1 : (a.date < b.date ? 1 : 0); });

    function carte(x){
      return '<div class="card" style="cursor:pointer;margin-bottom:10px" onclick="ouvrirChantier(\'' +
               ech(x.id) + '\')">' +
               '<div style="display:flex;gap:10px;align-items:baseline">' +
                 '<b style="flex:1;font-size:16px">' + ech(x.client || 'Chantier') + '</b>' +
                 badgeChantier(x) +
               '</div>' +
               '<div class="mini" style="margin-top:4px">' +
                 (x.heure ? ech(x.heure) + ' · ' : '') + ech(x.ville || '') +
               '</div>' +
               (x.aEnvoyer && Object.keys(x.aEnvoyer).length
                 ? '<div class="mini" style="color:var(--warn);margin-top:4px">' +
                   'Pointage en attente d\'envoi</div>' : '') +
             '</div>';
    }
    function bloc(liste){
      var jour = '', h = '';
      liste.forEach(function(x){
        if(x.date !== jour){
          jour = x.date;
          h += '<div class="cat">' + ech(jourLisible(jour)) + '</div>';
        }
        h += carte(x);
      });
      return h;
    }

    var h = bloc(futurs);
    if(passes.length){
      h += '<div class="cat" style="margin-top:18px;opacity:.7">Déjà passés</div>' + bloc(passes);
    }
    c.innerHTML = h;
  });
}

/* Mêmes pastilles que côté commercial : un seul vocabulaire visuel dans l'outil. */
function badgeChantier(x){
  var s = String(x.statut || 'PLANIFIE');
  if(s === 'FAIT')     return '<span class="vb vb-s">FAIT</span>';
  if(s === 'PROBLEME') return '<span class="vb vb-x">PROBLÈME</span>';
  if(s === 'EN COURS') return '<span class="vb vb-r">EN COURS</span>';
  return '<span class="vb vb-a">À FAIRE</span>';
}

/* ---- la fiche d'un chantier ---- */

function ouvrirChantier(id){
  DB.cGet(id).then(function(c){
    if(!c) return;
    CHANTIER = c;
    ETAPE = 0;
    montrer('eAg2');
    $('hTitre').textContent = 'Chantier';
    erreur('');
    window.scrollTo(0,0);
    peindreChantier();
  });
}

function peindreChantier(){
  var c = CHANTIER;
  if(!c) return;
  $('agClient').textContent = c.client || 'Chantier';
  $('agQuandCh').textContent = jourLisible(c.date) + (c.heure ? ' · ' + c.heure : '');
  $('agAdresse').innerHTML = ech(c.adresse || '') +
    ((c.cp || c.ville) ? '<br>' + ech((c.cp||'') + ' ' + (c.ville||'')) : '');

  var acc = $('agAcces');
  if(String(c.acces || '').trim()){
    acc.classList.remove('hide');
    acc.innerHTML = '<b>Accès au site</b><br>' + ech(c.acces);
  } else acc.classList.add('hide');

  // pointage
  var arr = Number(c.arrivee) || 0, dep = Number(c.depart) || 0;
  $('bAgArrive').classList.toggle('hide', !!arr);
  $('bAgFini').classList.toggle('hide', !arr || !!dep);
  var info = $('agPointInfo');
  if(!arr) info.textContent = 'Appuie en arrivant, puis en partant.';
  else if(!dep) info.textContent = 'Arrivé à ' + heureLisible(arr) + '.';
  else info.textContent = 'Arrivé à ' + heureLisible(arr) + ', parti à ' + heureLisible(dep) + '.';

  // La durée s'affiche dès que le départ est pointé, même si elle est courte :
  // un écran vide après « J'ai terminé » ferait croire que rien n'a marché.
  var d = $('agDuree');
  d.classList.toggle('hide', !(arr && dep));
  if(arr && dep){
    var mn = Number(c.minutes);
    if(!isFinite(mn) || mn < 0) mn = Math.round((dep - arr)/60000);
    d.textContent = 'Durée sur place : ' + dureeLisible(mn);
  }

  // tâches
  var faites = c.faites || [];
  var t = $('agTaches');
  if(!(c.taches || []).length){
    t.innerHTML = '<div class="empty">Aucun détail transmis pour ce chantier.</div>';
  } else {
    t.innerHTML = c.taches.map(function(x, i){
      var cle = x.ref || ('i' + i);
      var coche = faites.indexOf(cle) >= 0;
      return '<label class="piece" style="display:flex;gap:12px;align-items:flex-start;' +
               'padding:12px 0;border-bottom:1px solid var(--line)">' +
               '<input type="checkbox" style="width:26px;height:26px;flex:none;margin-top:2px"' +
                 (coche ? ' checked' : '') +
                 ' onchange="cocherTache(\'' + ech(cle) + '\', this.checked)">' +
               '<span style="flex:1">' +
                 '<b style="display:block;font-size:15.5px">' + ech(x.designation) + '</b>' +
                 (x.detail ? '<span class="mini" style="display:block">' +
                             ech(x.detail) + '</span>' : '') +
                 '<span class="mini" style="display:block;margin-top:2px">' +
                   nb(x.qte) + ' ' + ech(x.unite || '') + '</span>' +
               '</span></label>';
    }).join('');
  }

  $('agNote').value = c.note || '';
  $('bAgNote').classList.add('hide');

  var sg = $('agSignal');
  if(String(c.signalement || '').trim()){
    sg.classList.remove('hide');
    sg.textContent = 'Problème signalé : ' + c.signalement;
  } else sg.classList.add('hide');
}

function heureLisible(t){
  var d = new Date(Number(t));
  return isNaN(d.getTime()) ? '—'
       : ('0'+d.getHours()).slice(-2) + 'h' + ('0'+d.getMinutes()).slice(-2);
}
function dureeLisible(mn){
  var h = Math.floor(mn/60), m = mn%60;
  return (h ? h + ' h ' : '') + ('0'+m).slice(-2) + ' min';
}

/* ---- ce que l'agent renvoie ---- */

function enAttente(c, champs){
  c.aEnvoyer = c.aEnvoyer || {};
  for(var k in champs){ if(champs.hasOwnProperty(k)) c.aEnvoyer[k] = champs[k]; }
  return DB.cPut(c).then(function(){ pousserChantiers(); });
}

function pointer(quoi, btn){
  var c = CHANTIER;
  if(!c) return;
  var t = Date.now();
  if(quoi === 'arrivee'){
    if(c.arrivee) return;
    c.arrivee = t; c.statut = 'EN COURS';
  } else {
    if(!c.arrivee || c.depart) return;
    c.depart = t; c.statut = 'FAIT';
    c.minutes = Math.max(0, Math.round((t - c.arrivee)/60000));
  }
  vibrer(18);
  var v = {}; v[quoi] = t;
  enAttente(c, v).then(function(){
    tracer(quoi === 'arrivee' ? 'CHANTIER ARRIVEE' : 'CHANTIER DEPART',
           c.id + ' · ' + (c.client || ''), c.numero || '');
    peindreChantier();
  });
}

function cocherTache(cle, on){
  var c = CHANTIER;
  if(!c) return;
  c.faites = c.faites || [];
  var i = c.faites.indexOf(cle);
  if(on && i < 0) c.faites.push(cle);
  if(!on && i >= 0) c.faites.splice(i, 1);
  enAttente(c, {faites: c.faites});
}

function noteChantierModifiee(){
  var c = CHANTIER;
  if(!c) return;
  $('bAgNote').classList.toggle('hide', $('agNote').value === (c.note || ''));
}

function enregistrerNoteChantier(btn){
  var c = CHANTIER;
  if(!c) return;
  c.note = $('agNote').value;
  if(btn) occuper(btn, 'Enregistrement…');
  enAttente(c, {note: c.note}).then(function(){
    if(btn) libere(btn);
    $('bAgNote').classList.add('hide');
  });
}

function ouvrirSignalement(){
  var c = CHANTIER;
  if(!c) return;
  demander('Signaler un problème ?',
           'Le bureau sera prévenu et le chantier sera marqué à regarder. ' +
           'Écris ce qui s\'est passé dans « Un mot sur le chantier » avant de valider.',
           'Signaler').then(function(oui){
    if(!oui) return;
    var txt = ($('agNote').value || '').trim() || 'Problème signalé sans détail';
    c.signalement = txt;
    c.note = $('agNote').value;
    if(c.statut !== 'FAIT') c.statut = 'PROBLEME';
    enAttente(c, {signalement: txt, note: c.note}).then(function(){
      tracer('CHANTIER SIGNALEMENT', txt.slice(0,120), c.numero || '');
      peindreChantier();
    });
  });
}

/* ---- l'envoi différé ---- */

function pousserChantiers(){
  var moi = session();
  if(!moi || !navigator.onLine) return Promise.resolve();
  return DB.cTous().then(function(l){
    var att = (l || []).filter(function(c){
      return c.aEnvoyer && Object.keys(c.aEnvoyer).length;
    });
    if(!att.length) return;
    return att.reduce(function(p, c){
      return p.then(function(){
        var corps = {action:'chantier', nom:moi.nom, code:moi.code,
                     id:c.id, appareil:APPAREIL};
        for(var k in c.aEnvoyer){ if(c.aEnvoyer.hasOwnProperty(k)) corps[k] = c.aEnvoyer[k]; }
        return poster(corps).then(function(d){
          if(!d || !d.ok) return;          // on réessaiera : rien n'est perdu
          c.aEnvoyer = {};
          return DB.cPut(c);
        }, function(){ /* réseau : on garde pour plus tard */ });
      });
    }, Promise.resolve()).then(function(){ peindrePlanning(); });
  });
}

/* ====================== NOUVEAU DEVIS ====================== */
function nouveauDevis(){
  debloquer($('bSuiv'));
  LIGNES = [];
  PHOTO_ID = null;
  cacherSugg();
  ['cSociete','cSiret','cTva','cContact','cTel','cEmail','cAdresse','cCp','cVille','fSignataire','fNotes','fObjet','fDelai']
    .forEach(function(id){ $(id).value=''; });
  $('fObjet').value = '';
  $('fEnvoi').checked = false;
  $('mSiret').textContent = 'Le n° de TVA se complète tout seul à partir du SIRET.';
  effacerSignature();
  lsj('brouillon', null);
  DERNIER = null;
  TYPE = null; PLUS2ANS = null; TAUX = null;
  TERMINE_RETOUR = 0; V_TYPE = ''; V_MOTIF = '';
  $('steps').classList.remove('hide');
  etape(1);
}
