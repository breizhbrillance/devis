/* Application de devis — fonctionne entièrement hors connexion.
   Les devis sont créés et mis en PDF dans l'appareil, puis envoyés
   au Google Sheet dès qu'il y a du réseau. */

/* ====================== ÉTAT ====================== */
var CFG = null;            // {reglages, catalogue, commerciaux, sel, maj}
var LIGNES = [];
/* Une seule remise, sur le devis entier : le commercial negocie un prix, pas
   quatorze. Elle est reportee sur chaque ligne au moment ou elle change. */
var REMISE = {valeur:0, muet:false};
/* La nature du devis, et pour un entretien le nombre de passages par mois.
   C'est le devis qui est ponctuel ou récurrent, pas la prestation : le même
   lavage de sols se vend une fois en fin de chantier et quatre fois par mois
   en entretien. */
var NATURE = null;      // 'ENTRETIEN' | 'VITRERIE' | 'FACADE' | 'CHANTIER' | 'REMISE'
var ETAT = 'NORMAL';    // état du site constaté : 'NORMAL' | 'TRES_SALE'
var PASSAGES = 0;       // par mois, seulement pour un entretien
var ENGAGEMENT = { mois: 0, tacite: true };
var SANS_CONTRAT = false;   // v106 — « Entretien des locaux (sans contrat) »   // v103 — durée d'engagement d'un contrat
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

/* ---- session ----
   Elle vivait dans sessionStorage : fermer l'application déconnectait, et il
   fallait retaper nom et code à la rouvrir. Un salarié qui regarde son planning
   trois fois dans la journée n'a pas à faire cela.

   Elle vit donc dans localStorage, avec une échéance de trente jours qui
   glisse : chaque jour d'usage la repousse d'autant, si bien qu'un téléphone
   qui sert ne redemande jamais rien, tandis qu'un appareil oublié dans un
   tiroir se referme tout seul. L'écriture n'a lieu qu'une fois par jour —
   session() est appelée des centaines de fois, il n'y a pas lieu de réécrire
   la même chose à chaque appel.

   La coupure immédiate ne vient pas d'ici : elle vient du bureau. ACTIF = NON
   dans le classeur, et le premier échange venu répond « refus », ce qui efface
   la session (voir reidentifier). C'est la seule chose qui agisse sur un
   téléphone perdu — l'échéance, elle, attend son terme. */
var SESSION_JOURS = 30;
function sessionDuree(){ return SESSION_JOURS * 24 * 60 * 60 * 1000; }

function session(v){
  try{
    if(v === undefined){
      var s = null;
      try{ s = JSON.parse(localStorage.getItem('moi') || 'null'); }catch(e){ s = null; }
      /* Une session ouverte avant la v85 dort encore dans sessionStorage : on
         la reprend, plutôt que de déconnecter tout le monde le jour même de la
         mise à jour. */
      if(!s){
        var vieille = null;
        try{ vieille = JSON.parse(sessionStorage.getItem('moi') || 'null'); }catch(e){ vieille = null; }
        if(!vieille || !vieille.nom || !vieille.code) return null;
        try{ sessionStorage.removeItem('moi'); }catch(e){}
        session(vieille);
        try{ return JSON.parse(localStorage.getItem('moi') || 'null'); }catch(e){ return null; }
      }
      // Une session sans nom ou sans code ne sert à rien : tout passe par eux.
      if(!s.nom || !s.code){ session(null); return null; }
      if(!(Number(s.jusqu) > Date.now())){ session(null); return null; }
      if(Number(s.jusqu) - Date.now() < sessionDuree() - 86400000){
        s.jusqu = Date.now() + sessionDuree();
        try{ localStorage.setItem('moi', JSON.stringify(s)); }catch(e){}
      }
      return s;
    }
    if(v === null){
      try{ localStorage.removeItem('moi'); }catch(e){}
      try{ sessionStorage.removeItem('moi'); }catch(e){}
      return null;
    }
    localStorage.setItem('moi', JSON.stringify({
      nom: v.nom, code: v.code, role: v.role,
      jusqu: Date.now() + sessionDuree()
    }));
  }catch(e){ return null; }
  return null;
}

/* Le nom affiché en pied d'écran, et le lien pour sortir. Trois endroits,
   parce que les trois métiers ne partagent aucun écran — et il en faut un
   partout depuis la v85 : quelqu'un qui reste connecté trente jours doit
   pouvoir se déconnecter de là où il travaille. */
function direQuiJeSuis(nom){
  ['quiSuisJe','quiSuisJeAg','quiSuisJeAd'].forEach(function(id){
    var e = $(id); if(e) e.textContent = nom || '—';
  });
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
    cGet:  function(id){ return tx('chantiers','readonly',  function(st){ return st.get(id); }); },
    cSuppr:function(id){ return tx('chantiers','readwrite', function(st){ return st.delete(id); }); }
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
  brancherGlisser();
  peindreLiensTheme();
  /* Ici se trouvait « ls('moi', null) », qui effaçait la session à chaque
     démarrage : c'était la règle d'hier, celle d'une connexion qui ne survivait
     pas à la fermeture. Depuis la v85 elle tient trente jours, et c'est session()
     elle-même qui juge si elle est encore valable. Effacer ici rendrait tout le
     reste sans effet — y compris la reprise d'une session d'avant la v85. */

  CFG = lsj('cfg');
  // Une version antérieure de l'application interrogeait le serveur en GET et
  // rangeait sa réponse comme configuration. Depuis que cette adresse ne répond
  // plus qu'un accusé de service, ce reste doit être écarté.
  // Un agent reçoit une configuration SANS catalogue : c'est voulu, et il ne
  // faut surtout pas la jeter ici, sinon il repart sans savoir qui il est.
  if(CFG && !(CFG.reglages && (CFG.catalogue || CFG.role === 'PRESTATAIRE' || CFG.role === 'ADMIN'))){
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
  /* La prospection se relit tout de suite, même si son écran n'est pas ouvert :
     c'est ce qui permet à la synchronisation de renvoyer les résultats d'appel
     restés en attente d'un jour sur l'autre. */
  prCharger();
  $('hSub').textContent = (CFG && CFG.reglages && CFG.reglages.societe_nom) || 'Devis sur place';
  $('premiere').classList.toggle('hide', !!CFG);

  var moi = session();
  if(!moi){
    ecranConnexion('');
  } else {
    direQuiJeSuis(moi.nom);
    var b = lsj('brouillon');
    if(b && b.lignes && b.lignes.length){
      var cl = (b.client||{}).societe || (b.client||{}).contact || '';
      apresConnexion();
      /* Une modification interrompue n'est pas un devis en cours : le dire,
         sinon le commercial répondrait « non » en croyant jeter un brouillon,
         et perdrait les corrections qu'il avait déjà faites. */
      var enMod = !!(b.modif && b.modif.id);
      demander(enMod ? 'Reprendre la modification en cours ?' : 'Reprendre le devis en cours ?',
               enMod
                 ? 'La modification du devis ' + (b.modif.numero || '') +
                   (cl ? ' (' + cl + ')' : '') + ' n\'a pas été terminée.'
                 : 'Un devis non terminé a été retrouvé' + (cl ? ' : ' + cl : '') + '.',
               enMod ? 'La reprendre' : 'Le reprendre').then(function(oui){
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
var VERSION_APP = 'v108n';

/* v93 — le mode sombre. La classe est posée dans le <head> avant le premier
   dessin ; ici on ne fait que basculer, garder le choix, et dire sur chaque
   lien ce qu'un appui ferait. */
function themeSombre(){ return document.documentElement.classList.contains('sombre'); }
function peindreLiensTheme(){
  var mot = themeSombre() ? 'mode clair' : 'mode sombre';
  Array.prototype.forEach.call(document.querySelectorAll('.lienTheme'), function(a){ a.textContent = mot; });
  var m = document.querySelector('meta[name="theme-color"]');
  if(m) m.setAttribute('content', themeSombre() ? '#0a0c10' : (document.body.classList.contains('admin') ? '#B3131B' : '#004C92'));
}
function basculerTheme(){
  var sombre = !themeSombre();
  document.documentElement.classList.toggle('sombre', sombre);
  try{ localStorage.setItem('theme', sombre ? 'sombre' : 'clair'); }catch(e){}
  peindreLiensTheme();
}

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
  /* Un salarié n'a pas de devis sur son téléphone : lui parler des siens
     l'inquiéterait pour rien. Ce qu'il doit savoir, c'est qu'il devra retaper
     son code — ce qui, depuis la v85, n'arrive plus qu'ici. */
  demander('Se déconnecter ?',
           estAgent()
             ? 'Il faudra retaper ton nom et ton code pour revenir.'
             : 'Les devis déjà enregistrés restent sur l\'appareil et partiront normalement.',
           'Se déconnecter').then(function(oui){
    if(!oui) return;
    tracer('DECONNEXION', '');
    debrancherNotifs();
    oublierArchive();
    session(null);
    ecranConnexion('');
  });
}

function reidentifier(raison){
  // On ne coupe que pendant la saisie d'un devis (prestations et validation) :
  // partout ailleurs, y compris « Mes devis », le commercial doit être prévenu.
  if(ETAPE === 3 || ETAPE === 4) return;
  oublierArchive();
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
  /* Le rôle est gardé dans la session, et la session dure trente jours. Un
     commercial passé à l'administration ouvrirait donc l'outil d'hier pendant
     un mois si on ne reprenait pas ici ce que le bureau vient de dire. */
  var qui = session();
  if(qui && cfg.role && cfg.role !== qui.role){
    session({nom: qui.nom, code: qui.code, role: cfg.role});
  }
  // La configuration d'un agent n'a pas de catalogue, et c'est voulu : elle
  // doit quand même être rangée, sinon il n'a ni nom de société ni texte
  // d'information.
  /* L'agent n'a pas de catalogue, et c'est voulu : sa configuration se range
     telle quelle. Le gerant, lui, en a un depuis la v82 — il etablit ses
     propres devis — alors il suit le meme chemin qu'un commercial. */
  if(cfg.role === 'PRESTATAIRE' || (cfg.role === 'ADMIN' && !cfg.catalogue)){
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
  ['dlg', 'dlgConf', 'dlgSurf', 'dlgRem'].forEach(function(id){
    var d = $(id);
    if(!d) return;
    try{
      if(d.open){ if(d.close) d.close(); else d.removeAttribute('open'); }
    }catch(e){ d.removeAttribute('open'); }
  });
  var s = $('sigOverlay');
  if(s) s.classList.add('hide');
  if($('pdfOverlay') && !$('pdfOverlay').classList.contains('hide')) fermerPdf();
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
var ECRANS = ['eCo','eAccord','e1','e2','e3','e4','e5','e6','e7','ePro','eAg1','eAg2','eAg3','eAd1','eAd2'];
var ECRAN_VU = '';
/* Les trois lieux de la barre du bas, et l'onglet qui s'allume sur chacun. */
var ONGLET_ECRAN = { e1:'devis', e6:'liste', ePro:'phoning', eAg1:'planning',
                     /* Le tableau du gérant : depuis la v82 il établit des devis,
                        il lui faut donc un chemin de retour qui ne soit pas une
                        impasse au milieu d'une saisie. */
                     eAd1:'tableau' };
/* Où en était le devis en cours quand on l'a quitté pour les devis faits ou
   pour le phoning : l'onglet « Devis » y ramène au lieu de tout reprendre. */
var ETAPE_DEVIS = 1;
function montrer(id){
  ECRAN_VU = id;
  ECRANS.forEach(function(k){ $(k).classList.toggle('hide', k!==id); });
  // La couleur suit le métier, pas l'écran : on la pose ici, seul endroit par
  // lequel passent tous les changements d'écran.
  try{ document.body.classList.toggle('admin', estAdmin()); peindreLiensTheme(); }catch(e){}
  majOnglets();
  try{ majRetourHaut(); }catch(e){}
  try{ majBoutonDeco(); }catch(e){}
}
/* v108k — la déconnexion en haut, sur tous les écrans d'une personne connectée. */
function majBoutonDeco(){
  var b = $('bDeco'); if(!b) return;
  var cache = ECRAN_VU === 'eCo' || ECRAN_VU === 'eAccord' || !session();
  b.classList.toggle('hide', !!cache);
}

/* La barre n'a de sens que pour le commercial qui prospecte : sans la
   prospection il ne reste que deux lieux, déjà atteignables par l'en-tête.
   Pendant la modification d'un devis elle disparaît aussi — on ne quitte pas
   une correction en cours d'un appui distrait. */
function ongletsIci(){
  /* La barre n'a de sens que s'il y a un troisième lieu : la prospection, le
     planning de celui qui fait aussi des chantiers, ou les deux. Sans cela,
     deux onglets ne valent pas une barre. */
  /* Le gérant a toujours au moins deux lieux : son tableau et la saisie d'un
     devis. La barre a donc toujours un sens pour lui. */
  if(!estAdmin() && !(CFG && (CFG.prospection || CFG.planning))) return false;
  if(enModification()) return false;
  return !!ONGLET_ECRAN[ECRAN_VU];
}
function majOnglets(){
  var b = $('ongl'); if(!b) return;
  var ici = ongletsIci();
  var ou = ici ? ONGLET_ECRAN[ECRAN_VU] : '';
  b.classList.toggle('hide', !ici);
  document.body.classList.toggle('avecOnglets', ici);
  /* Sa hauteur dépend du dégagement du bas, qui varie d'un téléphone à
     l'autre : on la mesure une fois posée plutôt que de l'écrire en dur. */
  if(ici) document.documentElement.style.setProperty('--hOngl', b.offsetHeight + 'px');
  /* Chaque lieu n'apparaît que pour qui y a droit : le classeur commande,
     pas l'écran. */
  $('ongP').classList.toggle('hide', !(CFG && CFG.prospection));
  $('ongPl').classList.toggle('hide', !(CFG && CFG.planning));
  /* L'onglet du tableau n'existe pas dans une page servie avant la v82 : on ne
     tombe pas pour autant. */
  var oT = $('ongT'), adm = estAdmin();
  if(oT){ oT.classList.toggle('hide', !adm); oT.classList.toggle('on', ou === 'tableau' && (AD_ONGLET === 'aujourdhui' || AD_ONGLET === 'clients')); }
  /* v106 — le gérant : Tableau · Planning · Devis · Factures · Phoning. */
  ['ongAPl','ongADv','ongAF','ongAS'].forEach(function(k){ if($(k)) $(k).classList.toggle('hide', !adm); });
  if(adm){
    /* v106 — « enlève complètement l'onglet Phoning » (barre du gérant). */
    $('ongD').classList.add('hide'); $('ongL').classList.add('hide'); $('ongPl').classList.add('hide'); $('ongP').classList.add('hide');
    var surT = ou === 'tableau' || ou === 'devis' || ou === 'liste';
    if($('ongAPl')) $('ongAPl').classList.toggle('on', surT && AD_ONGLET === 'chantiers');
    if($('ongADv')) $('ongADv').classList.toggle('on', (ou === 'tableau' && AD_ONGLET === 'devis') || ou === 'devis' || ou === 'liste');
    if($('ongAF')) $('ongAF').classList.toggle('on', ou === 'tableau' && AD_ONGLET === 'factures');
    if($('ongAS')) $('ongAS').classList.toggle('on', ou === 'tableau' && AD_ONGLET === 'salaries');
  } else {
    $('ongD').classList.remove('hide'); $('ongL').classList.remove('hide');
  }
  $('ongD').classList.toggle('on', ou === 'devis');
  $('ongL').classList.toggle('on', ou === 'liste');
  $('ongP').classList.toggle('on', ou === 'phoning');
  $('ongPl').classList.toggle('on', ou === 'planning');
}
/* Un bouton de la barre du gérant : le tableau, sur le bon onglet. */
function barreAdmin(quoi){
  if(quoi === 'devis') compterDevisAEnvoyer();
  if(ECRAN_VU !== 'eAd1') ecranAdmin();
  ongletAdmin(quoi);
  try{ majOnglets(); }catch(e){}
  window.scrollTo(0,0);
}
/* L'onglet « Devis » reprend le devis en cours là où il en était ; il n'en
   commence pas un neuf, qui effacerait la saisie entamée. */
function ongletDevis(){
  etape(ETAPE_DEVIS >= 1 && ETAPE_DEVIS <= 4 ? ETAPE_DEVIS : 1);
}
/* Le planning du commercial qui pose lui-même des chantiers : le même écran
   que celui du salarié, avec les seuls chantiers à son nom. */
function ongletPlanning(){ ecranPlanning(); }
/* La barre du bas ne garde que le bouton Retour sur les écrans hors parcours :
   « Mes devis » et les photos ne doivent jamais être une impasse. */
function barreRetour(){
  /* Là où la barre d'onglets est posée, « Retour » ne dit plus rien : les
     trois lieux sont côte à côte, on ne revient pas, on change d'onglet. */
  if(ongletsIci()){ $('bar').classList.add('hide'); return; }
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
  /* Le phoning n'est pas une étape du devis : on en sort vers « Mes devis »,
     jamais vers l'écran précédent de la chaîne. */
  if(ETAPE === 8) return ouvrirHistorique();
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
  ETAPE_DEVIS = 1;              // le devis est fait : l'onglet n'y ramène plus
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
    $('fRelance').value = isoJour(Date.now() + 7*86400000);
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
    'signature et remplace le précédent — pas de photo du papier à prendre.</div>' +
    /* v108f — pour tous les devis, particulier comme professionnel. */
    (DERNIER.envoyerClient && ((DERNIER.mail || {}).a)
      ? '<div class="mini" style="margin-top:10px">Envoyé pour signature à distance à ' + ech(DERNIER.mail.a) + '.</div>'
      : '<button class="btn sec" style="margin-top:10px" onclick="signatureDistanceFin(this)">Envoyer le lien de signature par e-mail</button>') +
    '<div id="lienSigFin" class="mini" style="word-break:break-all"></div>';
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

/* Au choix du type, les deux cartes suffisent et la barre du bas n'a rien à
   faire là — sauf sur un entretien ou une vitrerie, où il reste une fréquence
   à saisir et donc un « Continuer » à offrir. */
function barreVisible(){
  if(ETAPE >= 5) return false;
  if(ETAPE === 1) return (estEntretien() && !SANS_CONTRAT) || estVitrerie();
  return true;
}

function etape(n){
  if(n<1) n=1;
  ETAPE=n; erreur('');
  if(n>=1 && n<=4) ETAPE_DEVIS = n;
  montrer('e'+n);
  barreComplete();
  [1,2,3,4].forEach(function(i){ $('s'+i).classList.toggle('on', i<=n); });
  $('steps').classList.toggle('hide', n>=5);
  $('bar').classList.toggle('hide', !barreVisible());
  $('bHist').classList.remove('hide');
  $('bPrec').classList.toggle('hide', n<=1);          // plus de retour vers la connexion
  $('bSuiv').textContent = n===4 ? 'Enregistrer le devis' : 'Continuer';
  $('hTitre').textContent = ['','Type de client','Client','Prestations','Validation','Terminé','Mes devis'][n];
  if(n!==2) cacherSugg();
  majBandeauModif();            // le rappel ne suit que le parcours du devis
  if(n===1) majType();
  if(n<=2) majBarre();          // le total du bas suit le devis en cours, pas le précédent
  /* L'objet se pose aussi en arrivant sur les prestations : un brouillon
     commencé avant cette version, ou repris sans titre, n'a pas à sortir sous
     un « DEVIS » nu. */
  if(n===3){ poserObjet(); rendreLignes(); }
  if(n===4){
    ecranEtat(); ecranRemise(); majOrigine(); calculer(); majApercuSignature();
    // le calendrier ne propose pas de date déjà passée
    var cd = $('fDate'); if(cd) cd.min = isoJour();
  }
  window.scrollTo(0,0);
}
function suivant(){
  if(ETAPE===1){
    if(!TYPE) return erreur('Choisis le type de client.');
    if(!NATURE)
      return erreur(TYPE === 'PRO'
        ? 'Précise s\'il s\'agit d\'un entretien, d\'une fin de chantier ou d\'une remise en état.'
        : 'Précise s\'il s\'agit d\'une fin de chantier ou d\'une remise en état.');
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
    var vide = libreIncomplete();
    if(vide) return erreur(vide + ' Complète-la ou retire-la.');
    sauverBrouillon(); return etape(4);
  }
  if(ETAPE===4){
    // La question revient ici si elle est restée sans réponse sur le premier
    // écran : sans elle, pas de montant mensuel ni de chantiers à créer.
    if(estEntretien() && !SANS_CONTRAT && !PASSAGES){
      $('cFreq').classList.remove('hide');
      var ch = $('fPassages4'); if(ch){ ch.focus(); }
      return erreur('Quel rythme de passages ? Le devis doit être mensualisé (moyenne sur 52 semaines).');
    }
    /* La date d'intervention n'est plus exigée (25 octobre 2026). Tous les
       clients ne savent pas, au moment du devis, quand ils veulent qu'on
       vienne — et un devis ne doit pas attendre cette réponse pour exister.
       Sans elle, le bureau pose le chantier à partir d'aujourd'hui, et le
       devis imprimé n'annonce simplement aucune date.
       Une date PASSÉE reste refusée : ce n'est pas une absence de réponse,
       c'est une faute de frappe. */
    var dOk = val('fDate');
    if(dOk && dOk < isoJour()){
      var cd2 = $('fDate'); if(cd2) cd2.focus();
      return erreur('La date d\'intervention est déjà passée.');
    }
    var pOk = val('fPlaceDate');
    if(pOk && pOk < isoJour()){
      var cp2 = $('fPlaceDate'); if(cp2) cp2.focus();
      return erreur('Le placement suggéré est déjà passé.');
    }
    if(val('fPlaceHeure') && !pOk){
      var cp3 = $('fPlaceDate'); if(cp3) cp3.focus();
      return erreur('Placement suggéré : il manque le jour.');
    }
    return enregistrer();
  }
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
    direQuiJeSuis(r.nom);
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
  if(c.type === 'PART' || c.type === 'PRO'){
    TYPE = c.type;
    if(TYPE === 'PART' && NATURE === 'ENTRETIEN'){ NATURE = null; PASSAGES = 0; }
    majType(); majNature();
  }
  ['Societe','Siret','Tva','Civ','Contact','Tel','Email','Adresse','Cp','Ville'].forEach(function(k){
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

/* L'accord se gardait dans sessionStorage, donc le temps d'une ouverture. Tant
   que la session mourait avec l'application, cela se confondait avec « une fois
   par connexion » ; depuis la v85 la session dure trente jours, et redemander
   le même accord chaque matin ne serait plus une information, mais une
   corvée — et une ligne de journal par jour et par personne. Il est donc gardé
   durablement, par personne et par version du texte : changer le texte le
   redemande à tout le monde, et c'est bien ce qu'on veut. */
function cleAccord(){
  var m = session();
  return versionInformation() + '|' + normNom((m && m.nom) || '');
}

function ecranAccord(){
  var t = texteInformation();
  // Rien à afficher : on ne bloque personne, mais chacun repart chez soi.
  if(!t){ brancherNotifs(); if(estAdmin()) ecranAdmin(); else if(estAgent()) ecranPlanning(); else etape(1); return; }
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
  ls('accord', cleAccord());
  tracer('INFORMATION ACCEPTEE', 'version ' + versionInformation()).then(function(){
    if(btn) libere(btn);
    if(estAdmin()){ ecranAdmin(); return chargerTableau(); }
    if(estAgent()){ ecranPlanning(); return synchroniser(false); }
    TYPE = null; PLUS2ANS = null; TAUX = null;
  ORIGINE = 'PROSPECTION'; LIEU = 'CLIENT'; majOrigine(); majType();
    etape(1);
    synchroniser(false);
  }, function(){
    if(btn) libere(btn);
    if(estAdmin()) return ecranAdmin();
    if(estAgent()) return ecranPlanning();
    etape(1);
  });
}

/* Passe par l'information si elle n'a pas encore été acceptée dans cette session. */
function apresConnexion(){
  if(ls('accord') === cleAccord()){
    if(estAdmin()) return ecranAdmin();
    if(estAgent()) return ecranPlanning();
    TYPE = null; PLUS2ANS = null; TAUX = null;
  ORIGINE = 'PROSPECTION'; LIEU = 'CLIENT'; majOrigine(); majType();
    return etape(1);
  }
  ecranAccord();
}

/* ====================== TYPE DE CLIENT ====================== */
function choisirType(t){
  TYPE = t;
  // Un particulier n'a pas de locaux à entretenir : si l'entretien avait été
  // choisi, il n'a plus cours. Les deux interventions, elles, lui vont.
  if(t === 'PART' && NATURE === 'ENTRETIEN'){ NATURE = null; PASSAGES = 0; }
  purgerSelonNature();
  majType();
  majNature();
  majKm();
  sauverBrouillon();
}

function choisirNature(n){
  /* v106 — l'entretien sans contrat garde le catalogue de l'entretien (la
     nature reste ENTRETIEN) mais ne se mensualise jamais et ne fait pas de
     contrat : il se vend comme une intervention. */
  SANS_CONTRAT = (n === 'ENTRETIEN_SC');
  if(SANS_CONTRAT){ n = 'ENTRETIEN'; PASSAGES = 0; }
  NATURE = n;
  if(n !== 'ENTRETIEN' && n !== 'VITRERIE') PASSAGES = 0;
  var retirees = purgerSelonNature();
  majNature();
  poserObjet();
  majKm();
  if(ETAPE === 3) rendreLignes();
  if(retirees) majBarre();
  sauverBrouillon();
  // Sur un entretien on reste : le commercial a un champ à remplir sous les
  // yeux. Sur une intervention il n'y a plus rien à dire ici.
  if((n !== 'ENTRETIEN' && n !== 'VITRERIE') || SANS_CONTRAT) etape(2);
}

/* v97 — demande de Simon : « quand on fait un devis, bien mettre sur 52
   semaines ». Le commercial ne compte plus des passages par mois (« 4 »,
   qui oubliait les mois à cinq semaines) : il choisit un rythme, et le devis
   en tire la moyenne mensuelle sur l'année. 1 fois par semaine = 52 passages
   par an ÷ 12 mois = 4,33 passages par mois. PASSAGES garde cette moyenne,
   à deux décimales ; le classeur et le PDF la lisent comme avant. */
var RYTHMES = [
  { v: 4.33,  mot: '1 fois par semaine',      calc: '1 passage par semaine × 52 semaines ÷ 12 mois' },
  { v: 8.67,  mot: '2 fois par semaine',      calc: '2 passages par semaine × 52 semaines ÷ 12 mois' },
  { v: 13,    mot: '3 fois par semaine',      calc: '3 passages par semaine × 52 semaines ÷ 12 mois' },
  { v: 17.33, mot: '4 fois par semaine',      calc: '4 passages par semaine × 52 semaines ÷ 12 mois' },
  { v: 21.67, mot: '5 fois par semaine',      calc: '5 passages par semaine × 52 semaines ÷ 12 mois' },
  { v: 26,    mot: '6 fois par semaine',      calc: '6 passages par semaine × 52 semaines ÷ 12 mois' },
  { v: 30.33, mot: '7 fois par semaine',      calc: '7 passages par semaine × 52 semaines ÷ 12 mois' },
  { v: 2.17,  mot: 'toutes les 2 semaines',   calc: '26 passages par an ÷ 12 mois' },
  { v: 1,     mot: '1 fois par mois',         calc: '' },
  { v: 0.5,   mot: 'tous les 2 mois',         calc: '6 passages par an ÷ 12 mois' },
  { v: 0.33,  mot: 'tous les 3 mois',         calc: '4 passages par an ÷ 12 mois' }
];
function rythmeDe(n){
  n = Math.round((Number(n) || 0) * 100) / 100;
  for(var i = 0; i < RYTHMES.length; i++) if(RYTHMES[i].v === n) return RYTHMES[i];
  return n > 0 ? { v: n, mot: nb(n) + ' passage' + (n > 1 ? 's' : '') + ' par mois', calc: '' } : null;
}
/* Les options du choix, avec la valeur d'un devis plus ancien (« 4 par mois »)
   quand elle n'est pas dans la liste : on ne change pas un prix déjà signé. */
function optionsRythme(sel){
  var autre = (PASSAGES && !RYTHMES.some(function(r){ return r.v === PASSAGES; }))
    ? '<option value="' + PASSAGES + '"' + (sel ? ' selected' : '') + '>' + ech(rythmeDe(PASSAGES).mot) + '</option>' : '';
  return '<option value="">' + (estVitrerie() ? 'Une seule fois' : 'Choisir le rythme…') + '</option>' + autre +
    RYTHMES.map(function(r){
      return '<option value="' + r.v + '"' + (PASSAGES === r.v ? ' selected' : '') + '>' + ech(r.mot) +
        (r.v !== 1 ? ' (' + nb(r.v) + ' par mois)' : '') + '</option>';
    }).join('');
}
function peindreRythme(){
  ['fPassages', 'fPassages4'].forEach(function(id){
    var e = $(id); if(!e) return;
    e.innerHTML = optionsRythme(true);
    e.value = PASSAGES ? String(PASSAGES) : '';
  });
  var r = rythmeDe(PASSAGES), m = $('mRythme'), m4 = $('mRythme4');
  var txt = r && r.calc ? r.calc + ' = ' + nb(r.v) + ' passages par mois en moyenne. Le prix mensuel est le même chaque mois.' : '';
  if(m) m.textContent = txt; if(m4) m4.textContent = txt;
  try{ peindreEngagement(); }catch(e){}
}

function setPassages(v, surValidation){
  var n = Math.round((Number(String(v).replace(',', '.')) || 0) * 100) / 100;
  if(!isFinite(n) || n < 0) n = 0;
  if(n > 31) n = 31;
  PASSAGES = n;
  // les deux champs disent la même chose, où qu'on l'ait saisi
  peindreRythme();
  if(ETAPE === 4) calculer();
  majBarre();
  sauverBrouillon();
}

function majNature(){
  var pro = (TYPE === 'PRO');
  $('blocNature').classList.toggle('hide', !TYPE);
  // L'entretien des locaux ne se propose qu'au professionnel.
  $('chENT').classList.toggle('hide', !pro);
  $('chENT').classList.toggle('on', NATURE === 'ENTRETIEN' && !SANS_CONTRAT);
  if($('chENS')){ $('chENS').classList.toggle('hide', !pro); $('chENS').classList.toggle('on', NATURE === 'ENTRETIEN' && SANS_CONTRAT); }
  $('chVIT').classList.toggle('on', NATURE === 'VITRERIE');
  $('chFAC').classList.toggle('on', NATURE === 'FACADE');
  $('chCHA').classList.toggle('on', NATURE === 'CHANTIER');
  $('chREM').classList.toggle('on', NATURE === 'REMISE');
  /* Un entretien est toujours au contrat ; une vitrerie se vend au contrat ou
     en une fois, et c'est le champ laissé vide qui dit « une fois ». */
  $('blocFreq').classList.toggle('hide', (NATURE !== 'ENTRETIEN' && NATURE !== 'VITRERIE') || SANS_CONTRAT);
  var lf = $('lFreq'), mf = $('mFreq');
  if(lf) lf.textContent = 'Rythme des passages';
  if(mf) mf.textContent = estVitrerie()
    ? '« Une seule fois » pour un nettoyage sans contrat.'
    : 'Tu peux le choisir plus tard : la question revient avant d\'enregistrer le devis.';
  peindreRythme();
  $('bar').classList.toggle('hide', !barreVisible());
}

/* D'où vient le client, et où il signe.

   L'origine ne sert qu'au suivi : elle part au classeur et n'entre dans aucun
   calcul. Le lieu de signature, lui, commande le formulaire de rétractation du
   devis imprimé — c'est le lieu, et non l'origine de l'appel, qui fait le
   contrat hors établissement. « Chez lui » par défaut : c'est le cas courant,
   et c'est le côté qui protège. */
var ORIGINE = 'PROSPECTION';
var LIEU = 'CLIENT';

function setOrigine(v){
  ORIGINE = (v === 'ENTRANT') ? 'ENTRANT' : 'PROSPECTION';
  majOrigine(); sauverBrouillon();
}
function setLieu(v){
  LIEU = (v === 'AGENCE') ? 'AGENCE' : 'CLIENT';
  majOrigine(); sauverBrouillon();
}
/* Le formulaire de rétractation n'accompagne que le devis d'un particulier qui
   signe hors de l'agence. Une seule fonction le dit, pour que l'écran et le
   PDF ne puissent pas diverger. */
function avecRetractation(){
  return TYPE === 'PART' && LIEU !== 'AGENCE';
}
function majOrigine(){
  var b = function(id, on){
    var e = $(id); if(!e) return;
    e.classList.toggle('on', on);
    e.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  b('orPROS', ORIGINE === 'PROSPECTION');
  b('orENTR', ORIGINE === 'ENTRANT');
  // Un professionnel n'a pas de droit de rétractation : la question ne se pose pas.
  var bl = $('blocLieu');
  if(bl) bl.classList.toggle('hide', TYPE !== 'PART');
  b('liCLI', LIEU !== 'AGENCE');
  b('liAGE', LIEU === 'AGENCE');
  var n = $('noteLieu');
  if(n){
    n.textContent = avecRetractation()
      ? 'Le devis portera le formulaire de rétractation : le client a 14 jours pour se raviser.'
      : (TYPE === 'PART'
         ? 'Pas de formulaire de rétractation. À ne choisir que si le client signe vraiment à l\'agence.'
         : '');
  }
}

function estEntretien(){ return NATURE === 'ENTRETIEN'; }
function estVitrerie(){ return NATURE === 'VITRERIE'; }
function estFacade(){ return NATURE === 'FACADE'; }
/* Les natures qui se vendent sur un secteur : l'équipe part de l'agence, et le
   trajet se paie. Une vitrerie compte, au contrat comme en une seule fois ; une
   façade ne se vend qu'en une fois, mais le camion roule quand même. */
function estMajorableKm(){ return estEntretien() || estVitrerie() || estFacade(); }
/* Le devis se répète-t-il dans le mois ? Un entretien, toujours. Une vitrerie,
   seulement si elle est vendue au contrat. C'est cette question, et non la
   nature seule, qui commande la mensualisation du total et la planification. */
function estRecurrent(){
  return (estEntretien() && !SANS_CONTRAT) || (estVitrerie() && PASSAGES > 0);
}

/* v100 — LE MAIL AU CLIENT, À SA MANIÈRE.
   Texte proposé d'après les mails que Simon envoie déjà depuis
   contact@breizhbrillance : « Bonjour Guillaume, J'espère que tu vas bien.
   Je te transmets ci-dessous le devis correspondant à… Belle journée !
   Cordialement, Simon - BREIZH BRILLANCE ». Il choisit tu ou vous, et
   réécrit ce qu'il veut : une fois le texte touché, l'appli n'y revient plus
   d'elle-même. */
var MAIL_TON = 'vous', MAIL_TOUCHE = false;
function prenomCommercial(){
  var n = String(nomDocument((session() || {}).nom) || '').trim().split(/\s+/)[0] || '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
}
function appelMail(tu){
  var c = String(val('cContact') || '').trim();
  if(tu) return c ? c.split(/\s+/)[0] : '';
  var civ = String(val('cCiv') || '').trim().toUpperCase();
  var mots = c.split(/\s+/);
  if(civ && c) return (civ === 'MME' ? 'Madame ' : 'Monsieur ') + mots[mots.length - 1];
  if(c) return c;
  return TYPE === 'PRO' ? 'Madame, Monsieur' : '';
}
function sujetMailPropose(){
  var n = String(NATURE || '').toUpperCase();
  var quoi = n === 'ENTRETIEN' ? 'entretien des locaux' : n === 'VITRERIE' ? 'nettoyage des vitrages'
           : n === 'FACADE' ? 'nettoyage de façade' : n === 'REMISE' ? 'remise en état'
           : n === 'CHANTIER' ? 'nettoyage de fin de chantier' : 'prestation de nettoyage';
  return 'Devis ' + quoi + ' — BREIZH BRILLANCE';
}
function texteMailPropose(forcer){
  if(MAIL_TOUCHE && !forcer) return;
  var tu = MAIL_TON === 'tu';
  /* v106 — le texte de Simon (9 novembre), mot pour mot : il s'arrête à
     « Belle journée, » ; « Cordialement, Simon - BREIZH BRILLANCE » et le
     bandeau sont ajoutés par le bureau. */
  var t = 'Bonjour,\n\n' +
    (tu ? 'J\u2019espère que tu vas bien !' : 'J\u2019espère que vous allez bien !') + '\n\n' +
    'Suite à notre contact,\n\n' +
    (tu ? 'Je te transmets ci-dessous le devis correspondant à ta demande.'
        : 'Je vous transmets ci-dessous le devis correspondant à votre demande.') + '\n\n' +
    'Belle journée,';
  /* v103 — la signature (« CORDIALEMENT, Simon - BREIZH BRILLANCE ») et le
     bandeau sont ajoutés par le bureau, comme dans Gmail : ne pas l'écrire ici,
     sinon le client la lirait deux fois. */
  if($('fMailTexte')) $('fMailTexte').value = t;
  if($('fMailObjet') && (forcer || !$('fMailObjet').value)) $('fMailObjet').value = sujetMailPropose();
  MAIL_TOUCHE = false;
}
function tonMail(t){
  MAIL_TON = t;
  if($('tonVous')) $('tonVous').classList.toggle('on', t === 'vous');
  if($('tonTu')) $('tonTu').classList.toggle('on', t === 'tu');
  texteMailPropose(true);
}
function majMailClient(){
  var on = $('fEnvoi') && $('fEnvoi').checked;
  if($('blocMail')) $('blocMail').classList.toggle('hide', !on);
  if(!on) return;
  if($('fMailA') && !$('fMailA').value) $('fMailA').value = val('cEmail') || '';
  if($('tonVous')) $('tonVous').classList.toggle('on', MAIL_TON === 'vous');
  if($('tonTu')) $('tonTu').classList.toggle('on', MAIL_TON === 'tu');
  if(!$('fMailTexte').value) texteMailPropose(true);
  var signe = !!(typeof SIG !== 'undefined' && SIG && SIG.image);
  if($('mMailSig')) $('mMailSig').textContent = (signe
    ? 'Le devis signé à l\'écran est joint en PDF.'
    : 'Le PDF est joint, et un bouton « Signer le devis en ligne » est ajouté sous ton message. ' +
      'Quand le client signe, le devis passe à « signé » tout seul et l\'intervention arrive dans le Planning, à placer.') +
    ' Ta signature (' + signatureCourte() + ') et le bandeau sont ajoutés automatiquement en bas : ne les écris pas.';
}
function mailClient(){
  if(!$('fEnvoi') || !$('fEnvoi').checked) return null;
  return { a: String(val('fMailA') || val('cEmail') || '').trim(),
           sujet: String(val('fMailObjet') || '').trim(),
           texte: String(($('fMailTexte') || {}).value || '').trim() };
}

/* Le nom que le devis et le classeur donnent à la nature. */
function libelleNature(n){
  n = String(n || NATURE || '').toUpperCase();
  if(n === 'ENTRETIEN') return 'Entretien des locaux';
  if(n === 'VITRERIE')  return 'Vitrages et menuiseries';
  if(n === 'FACADE')    return 'Nettoyage de façade';
  if(n === 'REMISE')    return 'Remise en état';
  return 'Nettoyage de fin de chantier';
}
/* ====================== L'OBJET DU DEVIS ======================

   L'objet s'imprime en titre, tout en haut : « DEVIS — ENTRETIEN DES LOCAUX ».
   Le commercial le tapait à la main, devant le client ; il l'oubliait parfois,
   et le devis sortait alors sous un titre nu. Depuis le 26 octobre 2026 il se
   remplit tout seul, à partir de la nature choisie — c'est la même phrase que
   celle du classeur et du planning, donc le devis, le tableau du gérant et la
   fiche du salarié disent tous la même chose.

   Il reste modifiable : un commercial qui veut préciser « Nettoyage maison fin
   de chantier » le fait. La règle est alors simple et tient en une ligne : on
   ne remplace QUE le texte que l'application a posé elle-même. Dès qu'il a
   écrit quelque chose, changer la nature ne l'efface plus. */
function objetAuto(){ return NATURE ? libelleNature(NATURE) : ''; }
function estObjetAuto(t){
  t = String(t || '').trim().toLowerCase();
  if(!t) return true;                       // vide : à nous
  return ['ENTRETIEN','VITRERIE','FACADE','REMISE','CHANTIER']
    .some(function(n){ return libelleNature(n).toLowerCase() === t; });
}
function poserObjet(){
  var e = $('fObjet');
  if(!e) return;
  if(!estObjetAuto(e.value)) return;        // le commercial a écrit : on se tait
  var neuf = objetAuto();
  if(String(e.value || '') === neuf) return;
  e.value = neuf;
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
  // Les deux questions du premier écran se tiennent : tant qu'aucun type n'est
  // choisi, la nature n'a pas lieu d'être affichée. Un nouveau devis repasse
  // par ici, et c'est ce qui remet le bloc à zéro.
  majNature();
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

/* ====================== PRESTATIONS ======================
   Le catalogue n'est plus une fenêtre où l'on va chercher : c'est la page
   elle-même. Une catégorie par bloc, fermée par défaut. Le commercial ouvre
   celle qui le concerne, pose une surface, un nombre de pièces ou coche un
   forfait, et referme. Ce qui reste à zéro n'existe pas sur le devis : il n'a
   donc rien à ajouter, et rien à supprimer.

   Les lignes restent le seul modèle : cet écran les lit et les écrit, mais
   c'est LIGNES que le brouillon, le PDF et le classeur reçoivent. */

var GRP = {};        // catégories ouvertes, retenues par nom
var CATS = [];       // noms des catégories, dans l'ordre du catalogue
var CATP = {};       // prestations par catégorie

function normTexte(s){
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}
/* La clé d'une prestation : sa référence si le classeur en donne une, sinon sa
   désignation. C'est elle qui relie une ligne déjà saisie à sa place dans la
   liste, y compris quand le catalogue a bougé entre deux ouvertures. */
/* ====================== LE CATALOGUE SELON LA NATURE ======================
   Une prestation peut n'appartenir qu'à certaines natures de devis : le
   décapage de la laitance ne se vend qu'en fin de chantier, le nettoyage
   vapeur des sols qu'en remise en état. C'est la colonne NATURES du CATALOGUE
   qui le dit ; vide, la prestation se vend dans toutes. */
var CATV = [];                 // le catalogue tel que le commercial le voit

function naturesDe(p){
  var v = (p && p.natures) || [];
  if(typeof v === 'string') v = v.split(/[^A-Za-z]+/);
  return v.map(function(x){ return String(x).toUpperCase().trim(); }).filter(Boolean);
}
function prestaVisible(p){
  var n = naturesDe(p);
  if(!n.length) return true;   // sans mention, elle se vend partout
  if(!NATURE) return true;     // nature pas encore choisie : on ne cache rien
  return n.indexOf(NATURE) >= 0;
}
function catalogueVisible(){
  return ((CFG && CFG.catalogue) || []).filter(prestaVisible);
}
/* Les écrans désignent une prestation par son rang dans la liste affichée.
   C'est donc cette liste-là, et pas le catalogue entier, qu'il faut consulter. */
function presta(i){ return CATV[i] || null; }
/* La prestation du catalogue qui porte cette référence, ou null. */
function prestationRef(ref){
  ref = String(ref || '').trim();
  if(!ref) return null;
  var c = (CFG && CFG.catalogue) || [];
  for(var i = 0; i < c.length; i++){
    if(String(c[i].reference || '').trim() === ref) return c[i];
  }
  return null;
}

/* Changer de nature en cours de devis peut retirer du catalogue une prestation
   déjà chiffrée. On ne la laisse pas dans l'ombre, comptée au total sans être
   affichée nulle part : elle quitte le devis. */
function purgerSelonNature(){
  var exclues = {};
  ((CFG && CFG.catalogue) || []).forEach(function(p){
    if(!prestaVisible(p)) exclues[clePresta(p)] = 1; });
  var avant = LIGNES.length;
  LIGNES = LIGNES.filter(function(l){ return !exclues[clePresta(l)]; });
  return avant - LIGNES.length;
}

/* ====================== LA LIGNE LIBRE ======================
   Une prestation que le catalogue ne porte pas encore, écrite et chiffrée par
   le commercial devant le client plutôt que de perdre l'affaire. Elle ne perce
   pas le verrouillage des tarifs, elle s'y soumet autrement : elle porte une
   référence réservée, et le bureau la voit arriver nommée et chiffrée dans la
   colonne CONTROLE_TARIF du classeur. L'éloignement ne la touche pas — son
   prix a été décidé sur place, il n'y a rien à relever. C'est le chemin déjà
   ouvert par la majoration d'état des lieux : une référence que les deux côtés
   connaissent. */
var REF_LIBRE = 'LIBRE-';
var LIBRE_SEQ = 0;
function estLigneLibre(l){
  return String((l && l.reference) || '').indexOf(REF_LIBRE) === 0;
}
/* Le compteur repart au-dessus du plus haut numéro déjà posé : un brouillon
   repris ou un devis dupliqué ne doit pas recréer une référence déjà prise,
   sinon deux lignes libres n'en feraient plus qu'une. */
function recalerLibreSeq(){
  var max = 0;
  LIGNES.forEach(function(l){
    if(!estLigneLibre(l)) return;
    var n = Number(String(l.reference).slice(REF_LIBRE.length)) || 0;
    if(n > max) max = n;
  });
  LIBRE_SEQ = max;
}
/* Une ligne libre naît vide : le commercial écrit dedans. Elle prend la TVA et
   la remise du devis comme n'importe quelle autre, et se range en fin de liste
   parce que ordonnerLignes() ne lui connaît pas de rang au catalogue. */
function ajouterLigneLibre(){
  LIBRE_SEQ++;
  var l = {categorie:'Prestations complémentaires', designation:'', detail:'',
    qte:1, unite:'forfait', pu:0, rem:REMISE.valeur, remMuet:REMISE.muet,
    tva:(TAUX === null || TAUX === undefined ? nbReglage('tva_defaut') : TAUX),
    type:(estRecurrent() ? 'MENSUEL' : 'PONCTUEL'),
    reference:REF_LIBRE + LIBRE_SEQ};
  LIGNES.push(l);
  return l;
}
function ligneLibreDe(ref){
  for(var i = 0; i < LIGNES.length; i++){
    if(String(LIGNES[i].reference || '') === String(ref)) return LIGNES[i];
  }
  return null;
}
function lignesLibres(){
  return LIGNES.filter(estLigneLibre);
}

function clePresta(p){
  var r = String((p && p.reference) || '').trim();
  return r ? 'R:' + r : 'D:' + normTexte(p && p.designation);
}

/* ====================== LE TARIF DE COMPLÉMENT ======================

   Une prestation peut porter deux prix : celui qu'elle vaut seule, et celui
   qu'elle vaut quand on est déjà chez le client pour autre chose. Le canapé en
   est le premier cas : 150 € HT quand on se déplace pour lui seul, 70 € dès
   qu'il s'ajoute à une autre mission. Ce n'est pas une remise — elle, le
   commercial la décide — c'est un déplacement qu'on ne facture pas deux fois,
   et c'est pourquoi l'application le fait toute seule.

   La règle, et c'est mot pour mot celle du classeur : le prix de complément
   s'applique dès que le devis porte au moins UNE AUTRE prestation payante —
   une autre référence, une désignation renseignée, un montant supérieur à
   zéro. Une ligne libre compte : c'est une vraie mission, décidée sur place.
   La majoration pour état des lieux ne compte pas : elle n'est pas une
   mission, c'est un pourcentage du reste.
   ==================================================================== */
function autrePrestationPayante(ref){
  for(var i = 0; i < LIGNES.length; i++){
    var l = LIGNES[i];
    var r = String(l.reference || '').trim();
    if(r && r === String(ref || '').trim()) continue;
    if(r === REF_MAJ) continue;
    if(!String(l.designation || '').trim()) continue;
    if(brutL(l) <= 0) continue;
    return true;
  }
  return false;
}
/* Le prix que cette prestation du catalogue porte sur le devis en cours. */
function prixCatalogue(p){
  var base = Number(p && p.pu) || 0;
  var comp = Number(p && p.puComplement) || 0;
  if(!comp) return base;
  return autrePrestationPayante(p && p.reference) ? comp : base;
}
/* Vrai si cette prestation est en ce moment au tarif de complément. */
function auTarifComplement(p){
  var comp = Number(p && p.puComplement) || 0;
  return !!comp && autrePrestationPayante(p && p.reference);
}
/* Repose le bon prix sur les lignes à deux tarifs, et rend la liste des
   références qui viennent de changer : ajouter une prestation peut faire
   tomber le prix d'une AUTRE ligne, déjà au devis, qu'il faut alors repeindre. */
function majPrixComplement(){
  var changees = [];
  LIGNES.forEach(function(l){
    if(estLigneLibre(l)) return;
    var p = prestationRef(l.reference);
    if(!p || !(Number(p.puComplement) > 0)) return;
    var pu = prixCatalogue(p);
    if(Math.abs((Number(l.pu) || 0) - pu) < 0.0001) return;
    l.pu = pu;
    changees.push(String(l.reference || ''));
  });
  return changees;
}
/* Le rang d'affichage d'une prestation, pour la repeindre après coup. */
function rangDeReference(ref){
  for(var i = 0; i < CATV.length; i++){
    if(String(CATV[i].reference || '').trim() === String(ref || '').trim()) return i;
  }
  return -1;
}
/* Met les prix à jour et repeint ce qui a bougé ailleurs que sous le doigt. */
function repeindrePrixComplement(saufRang){
  majPrixComplement().forEach(function(ref){
    var i = rangDeReference(ref);
    if(i < 0 || i === saufRang) return;
    redessinerPresta(i);
    rafraichirLigne(i);
  });
}
/* Un forfait se prend ou ne se prend pas : il n'a pas de quantité à saisir.
   Une prestation sans unité est dans le même cas. */
function estForfait(p){
  var u = normTexte(p && p.unite);
  return u === '' || u.indexOf('forfait') === 0;
}
function estSurface(p){
  var u = normTexte(p && p.unite);
  return u.indexOf('m2') === 0 || u.indexOf('m²') === 0;
}
function prestaDe(cle){
  var c = (CFG && CFG.catalogue) || [];
  for(var i = 0; i < c.length; i++){ if(clePresta(c[i]) === cle) return c[i]; }
  return null;
}
function ligneDe(cle){
  for(var i = 0; i < LIGNES.length; i++){ if(clePresta(LIGNES[i]) === cle) return LIGNES[i]; }
  return null;
}
function qteDe(cle){ var l = ligneDe(cle); return l ? (Number(l.qte) || 0) : 0; }

/* L'ordre des lignes suit le catalogue, pas l'ordre de saisie : le devis
   imprimé se lit alors comme la liste que le client vient de voir remplir. */
function ordonnerLignes(){
  var rang = {};
  ((CFG && CFG.catalogue) || []).forEach(function(p, i){ rang[clePresta(p)] = i; });
  LIGNES.sort(function(a, b){
    var x = rang[clePresta(a)], y = rang[clePresta(b)];
    if(x === undefined) x = 99999;        // hors catalogue : rejeté à la fin
    if(y === undefined) y = 99999;
    return x - y;
  });
}

/* Pose une quantité sur une prestation. Zéro retire la ligne : c'est la même
   chose que ne l'avoir jamais saisie. */
function poser(cle, qte){
  qte = Number(qte) || 0;
  if(qte < 0) qte = 0;
  var l = ligneDe(cle);
  if(!qte){ if(l) LIGNES.splice(LIGNES.indexOf(l), 1); return; }
  if(l){ l.qte = qte; return; }
  var p = prestaDe(cle);
  if(!p) return;
  LIGNES.push({categorie:p.categorie, designation:p.designation, detail:p.detail || '',
    qte:qte, unite:p.unite, pu:prixCatalogue(p), rem:REMISE.valeur, remMuet:REMISE.muet,
    tva:(TAUX || p.tva), type:p.type, reference:p.reference || ''});
  ordonnerLignes();
}

function rendreLignes(){
  majPrixComplement();          // un brouillon repris peut porter un prix périmé
  CATV = catalogueVisible();
  var c = $('lignes'), cat = CATV;
  CATS = []; CATP = {};
  cat.forEach(function(p){
    var k = String(p.categorie || '').trim() || 'Prestations';
    if(!CATP[k]){ CATP[k] = []; CATS.push(k); }
    CATP[k].push(p);
  });
  if(!cat.length){
    c.innerHTML = '<div class="card"><div class="empty">' +
      (((CFG && CFG.catalogue) || []).length
        ? 'Aucune prestation ne correspond à cette nature de devis.'
        : 'Le catalogue est vide.<br>Synchronise l\'application pour le recevoir.') +
      '</div></div>';
    majBarre(); return;
  }
  var h = '', rang = 0;
  CATS.forEach(function(nom, k){
    h += blocCategorie(nom, k, rang);
    rang += CATP[nom].length;
  });
  h += blocHorsCatalogue();
  h += blocLibre();
  c.innerHTML = h;
  majBadges();
  majBarre();
}

function blocCategorie(nom, k, rang){
  var h = '<div class="grp' + (GRP[nom] ? ' on' : '') + '" id="grp' + k + '">' +
    '<button class="grpT" onclick="basculerGrp(' + k + ')">' +
      '<span class="fl">\u203a</span>' +
      '<span class="n">' + ech(nom) + '</span>' +
      '<span class="cpt hide" id="cpt' + k + '"></span></button>' +
    '<div class="grpC">';
  CATP[nom].forEach(function(p, m){ h += lignePresta(p, rang + m); });
  return h + '</div></div>';
}

function lignePresta(p, i){
  var cle = clePresta(p), l = ligneDe(cle), q = l ? (Number(l.qte) || 0) : 0, actif = q > 0;
  var pu = prixCatalogue(p);
  var sous = eur(pu) + (estForfait(p) ? ' · forfait' : ' / ' + ech(p.unite)) +
             (String(p.type).toUpperCase() === 'MENSUEL' ? ' · mensuel' : '');
  /* Deux tarifs : le commercial doit voir lequel s'applique, et savoir que
     l'autre existe — c'est un argument de vente autant qu'une explication. */
  if(Number(p.puComplement) > 0){
    sous += auTarifComplement(p)
      ? '<br><span class="pxC">tarif avec une autre prestation · seul : ' + eur(p.pu) + '</span>'
      : '<br><span class="pxC">' + eur(p.puComplement) +
        ' s\'il y a une autre prestation au devis</span>';
  }
  if(estSurface(p)){
    sous += ' · <button class="lienM2" onclick="ouvrirSurface(' + i + ')">calculer</button>';
  }
  /* Un forfait n'est pas toujours unique : quatre cuisines, c'est quatre fois
     le prix. Tant qu'il n'est pas au devis, une seule cible — « Ajouter », et
     le tapotement vaut 1, comme avant. Dès qu'il y est, la cible devient un pas
     « − n + », pour que l'entretien reste aussi rapide qu'avant et qu'une
     remise en état puisse compter ses pièces. */
  var saisie = estForfait(p)
    ? (actif
        ? '<div class="pas">' +
            '<button class="pm" onclick="pasForfait(' + i + ',-1)" ' +
              'aria-label="Une de moins">\u2212</button>' +
            '<span class="nb">' + nb(q) + '</span>' +
            '<button class="pm" onclick="pasForfait(' + i + ',1)" ' +
              'aria-label="Une de plus">+</button>' +
          '</div>'
        : '<button class="coche" onclick="basculerForfait(' + i + ')">Ajouter</button>')
    : '<input class="q" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" ' +
        'value="' + (actif ? q : '') + '" oninput="setQte(' + i + ',this.value,this)">';
  return '<div class="pres' + (actif ? ' on' : '') + '" id="pr' + i + '">' +
    '<div class="d"><b>' + ech(p.designation) + '</b><span>' + sous + '</span></div>' +
    saisie +
    '<div class="tt" id="tt' + i + '">' + (actif ? eur(montantL(l)) : '—') + '</div></div>';
}

function basculerGrp(k){
  var nom = CATS[k];
  if(nom === undefined) return;
  GRP[nom] = !GRP[nom];
  var e = $('grp' + k);
  if(e) e.classList.toggle('on', !!GRP[nom]);
}

/* On repeint la ligne touchée, jamais la liste entière : un rendu complet
   referme le clavier du téléphone au milieu d'un nombre. */
function rafraichirLigne(i){
  var p = presta(i);
  if(!p) return;
  var l = ligneDe(clePresta(p)), q = l ? (Number(l.qte) || 0) : 0;
  var r = $('pr' + i), tt = $('tt' + i);
  if(r) r.classList.toggle('on', q > 0);
  if(tt) tt.textContent = q > 0 ? eur(montantL(l)) : '—';
  majBadges();
}

/* Le compteur d'une catégorie fermée est tout ce que le commercial voit d'elle :
   il doit dire à la fois combien de lignes et combien d'argent. */
function majBadges(){
  CATS.forEach(function(nom, k){
    var e = $('cpt' + k);
    if(!e) return;
    var n = 0, ht = 0;
    (CATP[nom] || []).forEach(function(p){
      var l = ligneDe(clePresta(p));
      if(l && (Number(l.qte) || 0) > 0){ n++; ht += montantL(l); }
    });
    e.textContent = n ? (n + ' · ' + eur(Math.round(ht * 100) / 100)) : '';
    e.classList.toggle('hide', !n);
  });
}

function setQte(i, v, el){
  var p = presta(i);
  if(!p) return;
  var n = (String(v).trim() === '' ? 0 : Number(String(v).replace(',', '.')));
  if(!isFinite(n) || n < 0){ n = 0; if(el) el.value = ''; }
  poser(clePresta(p), n);
  rafraichirLigne(i);
  repeindrePrixComplement(i);   // ajouter ceci a pu faire tomber le prix d'autre chose
  majBarre(); sauverBrouillon();
}

/* La ligne change de commande en passant de zéro à un — la coche cède la place
   au pas. On la redessine donc entière, ce qu'on s'interdit pour une surface :
   un forfait n'ouvre aucun clavier, il n'y a rien à faire refermer. */
function redessinerPresta(i){
  var p = presta(i), r = $('pr' + i);
  if(!p || !r) return;
  r.outerHTML = lignePresta(p, i);
}

function basculerForfait(i){
  var p = presta(i);
  if(!p) return;
  var cle = clePresta(p);
  poser(cle, qteDe(cle) > 0 ? 0 : 1);
  redessinerPresta(i);
  rafraichirLigne(i);
  repeindrePrixComplement(i);
  majBarre(); sauverBrouillon();
}

/* Une de plus, une de moins. À zéro le forfait quitte le devis et « Ajouter »
   revient : on retire en un tapotement, comme on ajoutait. */
function pasForfait(i, d){
  var p = presta(i);
  if(!p) return;
  var cle = clePresta(p);
  /* Le plancher est tenu par poser(), qui ramène tout négatif à zéro et retire
     la ligne : inutile de le refaire ici. Le plafond, lui, n'appartient qu'au
     pas — un doigt qui reste appuyé ne doit pas vendre mille cuisines. */
  var n = Math.round(qteDe(cle)) + d;
  if(n > 99) n = 99;
  poser(cle, n);
  redessinerPresta(i);
  rafraichirLigne(i);
  repeindrePrixComplement(i);
  majBarre(); sauverBrouillon();
}

/* Un brouillon enregistré avant une refonte du catalogue peut porter des lignes
   que le classeur ne propose plus. On ne les efface pas en silence : c'est le
   devis d'un client. On les montre à part, avec de quoi les retirer. */
function lignesHorsCatalogue(){
  var connues = {};
  ((CFG && CFG.catalogue) || []).forEach(function(p){ connues[clePresta(p)] = 1; });
  return LIGNES.filter(function(l){
    return !estLigneLibre(l) && !connues[clePresta(l)];
  });
}
function blocHorsCatalogue(){
  var hs = lignesHorsCatalogue();
  if(!hs.length) return '';
  var h = '<div class="grp hcat on" id="grpHors"><div class="grpT">' +
    '<span class="n">Hors catalogue</span>' +
    '<span class="cpt">' + hs.length + '</span></div><div class="grpC">';
  hs.forEach(function(l){
    h += '<div class="pres on"><div class="d"><b>' + ech(l.designation) + '</b>' +
      '<span>' + nb(l.qte) + ' ' + ech(l.unite || '') + ' · ' + eur(l.pu) +
      ' · ne figure plus au catalogue</span></div>' +
      '<button class="coche on" onclick="retirerHors(' + LIGNES.indexOf(l) + ')">Retirer</button>' +
      '<div class="tt">' + eur(montantL(l)) + '</div></div>';
  });
  return h + '</div></div>';
}
function retirerHors(i){
  LIGNES.splice(i, 1);
  rendreLignes(); sauverBrouillon();
}

/* Le bloc des lignes libres, toujours là, en bas de la liste : le commercial
   descend jusqu'au bout du catalogue avant d'y recourir, et c'est voulu — on
   cherche d'abord la prestation qui existe. Deux rangées par ligne plutôt
   qu'une colonne de plus : la largeur d'un téléphone est déjà prise. */
function blocLibre(){
  var ls = lignesLibres();
  var h = '<div class="grp lib on" id="grpLibre"><div class="grpT">' +
    '<span class="n">Ligne libre</span>' +
    (ls.length ? '<span class="cpt">' + ls.length + '</span>' : '') +
    '</div><div class="grpC">';
  ls.forEach(function(l){
    var r = ech(l.reference);
    h += '<div class="libL" id="lb' + r + '">' +
      '<input class="libD" placeholder="Ce que tu vends" value="' + ech(l.designation) + '" ' +
        'oninput="setLibre(\'' + r + '\',\'designation\',this.value)">' +
      '<div class="libR">' +
        '<input class="libQ" type="number" inputmode="decimal" step="0.01" min="0" ' +
          'aria-label="Quantité" value="' + nb(l.qte) + '" ' +
          'oninput="setLibre(\'' + r + '\',\'qte\',this.value)">' +
        '<input class="libU" aria-label="Unité" placeholder="unité" value="' + ech(l.unite) + '" ' +
          'oninput="setLibre(\'' + r + '\',\'unite\',this.value)">' +
        '<input class="libP" type="number" inputmode="decimal" step="0.01" min="0" ' +
          'aria-label="Prix unitaire HT" placeholder="prix HT" ' +
          'value="' + (Number(l.pu) ? nb(l.pu) : '') + '" ' +
          'oninput="setLibre(\'' + r + '\',\'pu\',this.value)">' +
        '<span class="libT" id="ltt' + r + '">' + eur(montantL(l)) + '</span>' +
        '<button class="libX" onclick="retirerLibre(\'' + r + '\')" ' +
          'aria-label="Retirer cette ligne">\u2715</button>' +
      '</div></div>';
  });
  h += '<div class="libAdd">' +
    '<button class="btnLib" onclick="ajouterLibre()">+ Ajouter une ligne libre</button>' +
    '<div class="mini">Pour ce que le catalogue ne porte pas encore. Le prix est celui que tu ' +
    'décides devant le client ; le bureau le voit passer et le rappellera si besoin.</div>' +
    '</div>';
  return h + '</div></div>';
}
function ajouterLibre(){
  var l = ajouterLigneLibre();
  rendreLignes(); sauverBrouillon();
  var e = $('lb' + l.reference);
  var d = e ? e.querySelector('.libD') : null;
  if(d) d.focus();
}
/* On ne repeint que le total de la ligne touchée : un rendu complet referme le
   clavier du téléphone au milieu d'un mot. */
function setLibre(ref, champ, valeur){
  var l = ligneLibreDe(ref);
  if(!l) return;
  if(champ === 'qte' || champ === 'pu'){
    var n = Number(String(valeur).replace(',', '.'));
    if(!isFinite(n) || n < 0) n = 0;
    l[champ] = n;
  } else {
    l[champ] = String(valeur || '');
  }
  var t = $('ltt' + ref);
  if(t) t.textContent = eur(montantL(l));
  /* Une ligne libre chiffrée est une mission de plus : le canapé peut passer au
     tarif de complément pendant qu'on tape son prix. On repeint la prestation
     concernée, jamais le champ sous le doigt. */
  repeindrePrixComplement(-1);
  majBarre(); sauverBrouillon();
}
function retirerLibre(ref){
  var l = ligneLibreDe(ref);
  if(!l) return;
  LIGNES.splice(LIGNES.indexOf(l), 1);
  rendreLignes(); sauverBrouillon();   // rendreLignes remet les prix à jour
}
/* Une ligne libre sans intitulé ou sans prix n'est pas une prestation : elle
   partirait au client comme une ligne vide à 0 €. On la signale avant de
   quitter l'écran plutôt que de la jeter en silence. */
function libreIncomplete(){
  var mauvaise = null;
  lignesLibres().forEach(function(l){
    if(mauvaise) return;
    if(!String(l.designation || '').trim()) mauvaise = 'Une ligne libre n\'a pas d\'intitulé.';
    else if(!(Number(l.pu) > 0)) mauvaise = '« ' + l.designation + ' » n\'a pas de prix.';
    else if(!(Number(l.qte) > 0)) mauvaise = '« ' + l.designation + ' » n\'a pas de quantité.';
  });
  return mauvaise;
}

/* ====================== CALCULETTE DE SURFACE ======================
   On mesure pièce par pièce, l'appli additionne : c'est là que les erreurs
   de multiplication faites debout dans un hall coûtent le plus cher. */
function ouvrirSurface(i){
  var p = presta(i);
  if(!p) return;
  // On retient la prestation, pas son rang : le catalogue peut être rafraîchi
  // en arrière-plan pendant que la calculette est ouverte.
  SURF = {cle:clePresta(p), rang:i, pieces:[{nom:'',l:'',w:''},{nom:'',l:'',w:''}]};
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
  if(SURF.cle){
    poser(SURF.cle, t);
    // Le détail pièce par pièce est la seule chose que le commercial n'aurait
    // pas pu écrire lui-même : il s'imprime sous la désignation.
    var l = ligneDe(SURF.cle);
    if(l){
      var det = SURF.pieces.filter(function(p){ return surfacePiece(p) > 0; })
        .map(function(p){ return (p.nom ? p.nom+' ' : '') + nb(surfacePiece(p)) + ' m²'; }).join(', ');
      if(det) l.detail = det;
    }
    rafraichirLigne(SURF.rang);
    majBarre(); sauverBrouillon();
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

/* La remise est reportée sur chaque ligne : le classeur, le PDF et la facture
   calculent tous à partir des lignes, et ils doivent tomber sur le même chiffre
   que l'écran du commercial. */
function appliquerRemise(){
  LIGNES.forEach(function(l){ l.rem = REMISE.valeur; l.remMuet = REMISE.muet; });
}
function setRemiseGlobale(txt, el){
  var r = lireRemise(txt), m = remiseMax();
  var borne = r.valeur > m ? m : r.valeur;
  REMISE.valeur = borne;
  REMISE.muet = r.muet;
  // On ne réécrit le champ que si la valeur a vraiment été ramenée au plafond :
  // sinon on empêcherait de taper « 0,5 » ou « 5 » avant son signe.
  if(el && borne !== r.valeur) el.value = borne + (r.muet ? ' %' : '');
  appliquerRemise();
  // C'est calculer() qui repeint le récapitulatif, le rappel du plafond et la
  // barre du bas : sans lui, le client lirait un total d'avant la remise.
  calculer();
}
/* Le maximum dépend du chantier, pas du classeur : 10 % est le plafond absolu
   de l'entreprise, mais sur un chantier serré le maximum réel est plus bas, et
   c'est le commercial qui le sait. Le message est donc son affirmation à lui,
   déclenchée par l'absence du signe %. */
function montrerPlafond(){
  return REMISE.valeur > 0 && !REMISE.muet;
}
function peindreRemise(){
  var e = $('remHT');
  if(e) e.textContent = eur(totaux().ht);
  var p = $('plafG');
  if(p) p.classList.toggle('hide', !montrerPlafond());
  majBarre();
}
/* Le bloc disparaît quand le bureau interdit toute remise : un champ grisé
   invite à la demander, un bloc absent ne se remarque pas. */
function ecranRemise(){
  var c = $('cRem');
  if(!c) return;
  c.classList.toggle('hide', remiseMax() <= 0);
  var e = $('remG');
  if(e) e.value = REMISE.valeur + (REMISE.muet ? ' %' : '');
  peindreRemise();
}

/* ====================== ÉTAT DU SITE ======================
   Un site très sale demande plus de temps que le même site propre, et le
   catalogue ne le sait pas. Plutôt que de laisser retoucher les prix — c'est ce
   que la grille verrouillée interdit — le commercial coche « site très sale »,
   et le devis porte une ligne à part, « Majoration pour état des lieux ».
   Une seule option, décidée par Simon : pas de palier intermédiaire, et rien
   n'est majoré tant qu'elle n'est pas cochée. Le taux vient du classeur. */
var REF_MAJ = 'MAJ-ETAT';
function pctReglage(cle){
  var v = (CFG && CFG.reglages) ? CFG.reglages[cle] : null;
  if(v === undefined || v === null || String(v).trim() === '') return 0;
  var n = Number(String(v).replace(',', '.'));
  if(!isFinite(n) || n < 0) return 0;
  return n > 100 ? 100 : n;
}
/* Le taux en vigueur sur CE devis. Un entretien n'en a jamais : son prix est
   celui d'un passage répété, pas d'une remise à niveau. */
function majorationPct(){
  if(estEntretien()) return 0;
  return ETAT === 'TRES_SALE' ? pctReglage('majoration_tres_sale') : 0;
}
/* La ligne de majoration, recalculée à chaque fois à partir des prestations :
   elle n'est jamais rangée dans LIGNES, qui ne contient que du catalogue. */
function ligneMajoration(){
  var pct = majorationPct();
  if(!pct || !LIGNES.length) return null;
  var base = 0;
  /* Une ligne libre ne majore pas : son prix a été décidé sur place, il porte
     déjà l'état du site. Le classeur calcule la même assiette. */
  LIGNES.forEach(function(l){ if(!estLigneLibre(l)) base += brutL(l); });
  var m = Math.round(base * pct) / 100;
  if(m <= 0) return null;
  return {categorie:'État des lieux',
          designation:'Majoration pour état des lieux (+' + nb(pct) + ' %)',
          detail:'', qte:1, unite:'forfait', pu:m,
          rem:REMISE.valeur, remMuet:REMISE.muet,
          tva:LIGNES[0].tva, type:'PONCTUEL', reference:REF_MAJ};
}
/* Ce que le devis contient vraiment : les prestations, puis la majoration. C'est
   cette liste que reçoivent le total, le PDF et le classeur. */
/* ====================== L'ÉLOIGNEMENT DU CLIENT ======================
   Sur un contrat d'entretien, et sur lui seul, chaque kilomètre au-delà de la
   franchise ajoute quelques euros au prix d'un passage : un entretien, ce sont
   des passages répétés, et chaque passage est un trajet depuis l'agence.

   La majoration ne s'écrit pas sur le devis. Elle est fondue dans les prix
   unitaires, relevés tous du même pourcentage, de sorte que le passage monte
   d'exactement le supplément. Le classeur refait ce calcul pour vérifier les
   prix reçus : c'est pourquoi les deux côtés arrondissent au dix-millième.

   La distance vient de la table des communes que le bureau envoie à la
   connexion — le devis se chiffre chez le client, souvent sans réseau. Le
   commercial peut la corriger ; le bureau compare et signale un écart. */
var KM = '';            // ce qui est écrit dans le champ, '' si rien
var KM_AUTO = false;    // vrai tant que le chiffre vient de la table

function nbReglage(cle){
  var v = (CFG && CFG.reglages) ? CFG.reglages[cle] : null;
  if(v === undefined || v === null || String(v).trim() === '') return 0;
  var n = Number(String(v).replace(',', '.'));
  return isFinite(n) && n >= 0 ? n : 0;
}
function cleCommune(cp, ville){
  var c = String(cp||'').replace(/\D/g,'').slice(0,5);
  var v = String(ville||'');
  if(v.normalize) v = v.normalize('NFD').replace(/[̀-ͯ]/g,'');
  v = v.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  return (c || v) ? c + ' ' + v : '';
}
/* Ce que le bureau sait de cette commune, ou -1. */
function kmTable(cp, ville){
  var t = (CFG && CFG.communes) || {};
  var cle = cleCommune(cp, ville);
  if(cle && t.hasOwnProperty(cle)) return Number(t[cle]);
  var cp5 = String(cp||'').replace(/\D/g,'').slice(0,5);
  if(cp5){
    for(var k in t){ if(t.hasOwnProperty(k) && k.indexOf(cp5+' ') === 0) return Number(t[k]); }
  }
  return -1;
}
function kmDevis(){
  var n = Number(String(KM).replace(',', '.'));
  return (String(KM).trim() !== '' && isFinite(n) && n >= 0) ? n : 0;
}
/* Le barème au kilomètre, lu dans un seul réglage :
       10:0 ; 20:0,70 ; 50:0,80 ; *:0,90
   « jusqu'à 10 km : rien ; de 10 à 20 : 0,70 € du km ; de 20 à 50 : 0,80 ;
   au-delà : 0,90 ». Les tranches se cumulent comme un barème d'impôt : à 30 km,
   10 km à 0,70 € puis 10 km à 0,80 €, soit 15 €. Aucun saut aux frontières. */
function baremeKm(){
  var txt = String(((CFG||{}).reglages||{}).majoration_km_bareme || '').trim();
  if(!txt) return [];
  var out = [];
  txt.split(/[;\n]+/).forEach(function(m){
    var p = String(m).split(':');
    if(p.length < 2) return;
    var borne = String(p[0]).trim();
    var taux = Number(String(p[1]).replace(',', '.').trim());
    if(!isFinite(taux) || taux < 0) return;
    var jusqua = /^[*+]|illimit/i.test(borne) ? Infinity : Number(borne.replace(',', '.'));
    if(jusqua !== Infinity && (!isFinite(jusqua) || jusqua < 0)) return;
    out.push({jusqua:jusqua, taux:taux});
  });
  out.sort(function(a,b){ return a.jusqua - b.jusqua; });
  return out;
}
/* Les euros ajoutés à UN passage. Zéro sur un chantier ou une remise en état,
   zéro dans la tranche gratuite, zéro si le barème est vide. */
function supplementKm(){
  if(!estMajorableKm()) return 0;
  var bareme = baremeKm();
  if(!bareme.length) return 0;
  var km = kmDevis(), bas = 0, total = 0;
  for(var i = 0; i < bareme.length && bas < km; i++){
    var haut = Math.min(bareme[i].jusqua, km);
    if(haut > bas) total += (haut - bas) * bareme[i].taux;
    bas = bareme[i].jusqua;
  }
  return Math.round(total * 100) / 100;
}
/* Le taux dont les prix unitaires sont relevés : rien ne s'écrit sur le devis,
   ce sont les prix eux-mêmes qui portent l'éloignement. */
function tauxSupKm(){
  var sup = supplementKm();
  if(!(sup > 0)) return 0;
  var base = 0;
  LIGNES.forEach(function(l){
    /* Ni la majoration ni une ligne libre n'entrent dans l'assiette : la
       première se calcule sur le reste, la seconde porte un prix décidé sur
       place que le supplément n'a pas à diluer. */
    if(String(l.reference||'') === REF_MAJ || estLigneLibre(l)) return;
    base += (Number(l.qte)||0) * (Number(l.pu)||0);
  });
  return base > 0 ? sup / base : 0;
}
/* Le pas d'arrondi d'un prix relevé : au dixième d'euro à partir d'un euro,
   au centime en dessous. Un prix au m² vaut quelques centimes — l'arrondir au
   dixième le ferait bondir d'un tiers, et le supplément n'aurait plus aucun
   rapport avec la distance. */
function pasArrondi(pu){
  var p = nbReglage('majoration_km_arrondi');
  if(!(p > 0)) return 0.01;
  return Math.abs(Number(pu)||0) >= 1 ? p : 0.01;
}
function prixAvecKm(pu, taux){
  var pas = pasArrondi(pu);
  var v = (Number(pu)||0) * (1 + (taux||0));
  return Math.round(Math.round(v / pas) * pas * 100) / 100;
}
/* Le champ : rempli d'après la commune, et modifiable. */
function majKm(){
  var b = $('blocKm');
  if(!b) return;
  var visible = estMajorableKm() && baremeKm().length > 0;
  b.classList.toggle('hide', !visible);
  if(!visible){ KM = ''; KM_AUTO = false; if($('cKm')) $('cKm').value = ''; return; }
  var t = kmTable(val('cCp'), val('cVille'));
  if(t >= 0 && (KM_AUTO || String(KM).trim() === '')){
    KM = String(t); KM_AUTO = true;
  }
  if($('cKm')) $('cKm').value = KM;
  noteKm();
  if(ETAPE === 4) calculer();
}
function saisirKm(){
  KM = val('cKm');
  KM_AUTO = false;
  noteKm();
  if(ETAPE === 4) calculer();
}
function noteKm(){
  var n = $('kmNote');
  if(!n) return;
  var sup = supplementKm();
  if(String(KM).trim() === ''){
    n.textContent = 'km depuis l\'agence — commune inconnue du bureau, à saisir';
    return;
  }
  var b = baremeKm();
  var gratuit = b.length && b[0].taux === 0 ? b[0].jusqua : 0;
  n.textContent = 'km' + (sup > 0
    ? ' · environ ' + eur(sup) + ' de plus par passage'
    : (gratuit ? ' · dans les ' + nb(gratuit) + ' km compris' : ' · sans majoration')) +
    (KM_AUTO ? '' : ' (saisi)');
}

/* Ce que le devis contient vraiment : les prestations, prix relevés de
   l'éloignement du client sur un entretien, puis la majoration d'état des
   lieux sur une intervention. Jamais les deux : un entretien n'est pas majoré,
   et une intervention ne paie pas la distance. */
function lignesDevis(){
  /* Le filet. Les écrans tiennent déjà les prix à jour, mais c'est par ici que
     passent le total, le PDF et l'envoi au bureau : un chemin qui aurait
     oublié de le faire ne doit pas envoyer un prix périmé. */
  majPrixComplement();
  var taux = tauxSupKm();
  var ls = LIGNES.map(function(l){
    if(!taux || estLigneLibre(l)) return l;
    var c = {}; for(var k in l){ if(l.hasOwnProperty(k)) c[k] = l[k]; }
    c.pu = prixAvecKm(l.pu, taux);
    return c;
  });
  var m = ligneMajoration();
  return m ? ls.concat([m]) : ls;
}
/* Les prestations seules : la majoration, elle, se recalcule. */
function sansMajoration(ls){
  return (ls || []).filter(function(l){
    return String((l && l.reference) || '') !== REF_MAJ;
  });
}
function setEtat(e){
  ETAT = (e === 'TRES_SALE') ? 'TRES_SALE' : 'NORMAL';
  ecranEtat();
  calculer();
}
/* Le bouton est une coche : un appui majore, un second retire la majoration. */
function basculerEtat(){
  setEtat(ETAT === 'TRES_SALE' ? 'NORMAL' : 'TRES_SALE');
}
/* Le bloc n'apparaît que s'il y a quelque chose à cocher : un entretien, ou un
   taux à zéro dans le classeur, et il disparaît. */
function ecranEtat(){
  var c = $('cEtat');
  if(!c) return;
  var t = pctReglage('majoration_tres_sale');
  var visible = !estEntretien() && t > 0;
  c.classList.toggle('hide', !visible);
  // Un taux retiré du classeur ne doit pas rester coché dans un brouillon.
  if(ETAT !== 'TRES_SALE' || t <= 0) ETAT = 'NORMAL';
  if(!visible) return;
  $('etTp').textContent = '+' + nb(t) + ' %';
  $('etT').classList.toggle('on', ETAT === 'TRES_SALE');
  $('etT').setAttribute('aria-pressed', ETAT === 'TRES_SALE' ? 'true' : 'false');
}

/* ====================== MONTANTS ====================== */
/* Montant brut d'une ligne, remise non déduite : c'est lui qu'on additionne
   par poste, la remise se lisant ensuite en une seule ligne. */
function brutL(l){
  return Math.round((Number(l.qte) || 0) * (Number(l.pu) || 0) * 100) / 100;
}
function montantL(l){
  return Math.round((Number(l.qte) || 0) * (Number(l.pu) || 0) *
                    (1 - (Number(l.rem) || 0) / 100) * 100) / 100;
}

/* Les totaux du devis en cours. Toute l'arithmétique vit dans totauxDe() :
   une remise posée après coup, sur un devis déjà enregistré, repart des lignes
   de ce devis-là et retombe donc forcément sur le même euro. */
function totaux(){
  return totauxDe(lignesDevis(), estRecurrent(), PASSAGES);
}

function totauxDe(lignes, recurrent, passages){
  var t = {htPonctuel:0,htMensuel:0,ht:0,brut:0,remise:0,tva:0,ttc:0,parTaux:{}};
  (lignes || []).forEach(function(l){
    var b = montantL(l), taux = Number(l.tva)||0;
    t.brut += brutL(l);
    if(String(l.type).toUpperCase()==='MENSUEL') t.htMensuel+=b; else t.htPonctuel+=b;
    t.tva += b*taux/100;
    t.parTaux[taux] = (t.parTaux[taux]||0) + b*taux/100;
  });
  t.ht=t.htPonctuel+t.htMensuel; t.ttc=t.ht+t.tva;
  // La remise affichée est la différence réelle entre le brut et le net, jamais
  // un pourcentage appliqué au total : sinon l'arrondi du PDF et celui du
  // classeur, qui calculent ligne à ligne, ne tomberaient pas sur le même euro.
  t.remise = t.brut - t.ht;
  ['htPonctuel','htMensuel','ht','brut','remise','tva','ttc']
    .forEach(function(k){ t[k]=Math.round(t[k]*100)/100; });

  /* Un contrat d'entretien se chiffre au passage, mais se vend au mois. On
     garde le prix d'un passage pour l'afficher, et tout le reste du devis —
     total, TVA, remise, et ce que recevra le classeur — passe au mois. Ainsi
     le PDF, le tableau de bord et « À facturer » raisonnent tous en euros par
     mois sans avoir à connaître cette subtilité. */
  t.parPassage = t.ht;
  t.passages = recurrent ? (Number(passages) || 0) : 1;
  if(recurrent && t.passages > 1){
    ['ht','brut','remise','tva','ttc'].forEach(function(k){
      t[k] = Math.round(t[k] * t.passages * 100) / 100;
    });
    Object.keys(t.parTaux).forEach(function(k){
      t.parTaux[k] = Math.round(t.parTaux[k] * t.passages * 100) / 100;
    });
  }
  if(recurrent){ t.htMensuel = t.ht; t.htPonctuel = 0; }
  Object.keys(t.parTaux).forEach(function(k){ t.parTaux[k]=Math.round(t.parTaux[k]*100)/100; });
  return t;
}
/* Récapitulatif par poste, comme sur le devis imprimé. */
function calculer(){
  var t = totaux(), h='', postes = {}, ordre = [];
  lignesDevis().forEach(function(l){
    var k = String(l.categorie||'').trim() || 'Prestations';
    if(!postes[k]){ postes[k]=0; ordre.push(k); }
    postes[k] += brutL(l);
  });
  ordre.forEach(function(k){
    h += '<div class="tot"><span>'+ech(k)+'</span><b>'+eur(Math.round(postes[k]*100)/100)+'</b></div>';
  });
  if(ordre.length) h += '<div style="height:6px"></div>';
  if(t.htMensuel && t.htPonctuel){
    h+='<div class="tot"><span>dont abonnement mensuel HT</span><b>'+eur(t.htMensuel)+'</b></div>';
  }
  // Sur un entretien, le client doit voir d'où vient son prix mensuel.
  if(estRecurrent() && t.passages > 0){
    h+='<div class="tot"><span>Prix d\'un passage HT</span><b>'+eur(t.parPassage)+'</b></div>';
    var ry = rythmeDe(t.passages);
    h+='<div class="tot"><span>Rythme</span><b>'+ech(ry ? ry.mot : '')+'</b></div>';
    h+='<div class="tot"><span>Passages par mois (moyenne sur 52 semaines)</span><b>'+nb(t.passages)+'</b></div>';
  }
  // Les sous-totaux par poste sont bruts : la remise se lit ensuite, en une
  // seule ligne, comme un client s'attend à la voir sur un devis.
  if(t.remise > 0){
    h+='<div class="tot"><span>Sous-total HT</span><b>'+eur(t.brut)+'</b></div>';
    h+='<div class="tot"><span>Remise '+nb(REMISE.valeur)+' %</span><b>\u2212 '+eur(t.remise)+'</b></div>';
  }
  h+='<div class="tot"><span>'+(estRecurrent()?'Total mensuel HT':'Total HT')+'</span><b>'+eur(t.ht)+'</b></div>';
  Object.keys(t.parTaux).sort(function(a,b){return a-b;}).forEach(function(taux){
    h+='<div class="tot"><span>TVA '+taux+' %</span><b>'+eur(t.parTaux[taux])+'</b></div>';
  });
  h+='<div class="tot big"><span style="color:inherit">'+(estRecurrent()?'Total TTC par mois':'Total TTC')+
     '</span><span>'+eur(t.ttc)+'</span></div>';
  $('recap').innerHTML = h;
  // Le bloc de fréquence n'a de sens que sur un entretien.
  var cf = $('cFreq');
  if(cf) cf.classList.toggle('hide', !estRecurrent());
  peindreRemise();
  majBarre(); sauverBrouillon();
}
function majBarre(){
  var t = totaux(), pro = (TYPE === 'PRO');
  // Un professionnel raisonne en HT, un particulier en TTC : on met en avant
  // le chiffre dont le client va parler.
  $('bTot').textContent = eur(pro ? t.ht : t.ttc);
  $('bTotL').textContent = LIGNES.length+' ligne'+(LIGNES.length>1?'s':'') +
    (pro ? ' · HT' : ' · TTC') + (estRecurrent() && PASSAGES ? ' · par mois' : '');
}

/* ====================== SIGNATURE ====================== */
var SIG = {cv:null, ctx:null, dessine:false, vide:true, image:'', quand:0};
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
    // L'heure compte autant que le trait : c'est elle qui date l'accord.
    SIG.quand = SIG.image ? Date.now() : 0;
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
    /* Un devis qui devient signé change de numéro : mois de la signature et
       suffixe / S. L'ancien reste noté — c'est celui qui figure sur
       l'exemplaire que le client avait déjà, et celui que le bureau garde
       dans NUMERO_ORIGINE. */
    if(estNumeroCourant(e.numero) && !estNumeroSigne(e.numero)){
      e.numeroOrigine = e.numero;
      e.numero = prochainNumero(e.devis.commercial, nomClient(e.devis.client),
                                true, e.devis.signeLe, initialesDuNumero(e.numeroOrigine));
      e.devis.numero = e.numero;
    }
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

/* Le devis modifié reprend la place de l'ancien : même fiche, même numéro,
   mêmes photos, même date de création. Ce qui change, c'est son contenu, son
   PDF, et le fait qu'il doit repartir au bureau — en révision, pour remplacer
   la ligne du classeur au lieu d'en ajouter une.

   On relit la fiche juste avant d'écrire : entre l'ouverture et maintenant, le
   client a pu signer depuis un autre écran, et un devis signé ne se modifie
   plus. Mieux vaut un refus clair qu'un montant changé dans son dos. */
function enregistrerModification(b, envoi, moi, secours, devis, pdf64){
  var cible = MODIF.id, venu = MODIF.enr || null;
  return DB.get(cible).then(function(enr){
    /* DB.get rend l'objet de requête quand la clé est absente : on regarde
       donc s'il y a bien un devis dedans. */
    if(!(enr && enr.devis)) enr = venu || null;   // v108e — venu du bureau : écrit maintenant
    if(!enr){
      debloquer(b, secours);
      return erreur('Ce devis n\'est plus sur l\'appareil. Rien n\'a été enregistré.');
    }
    if(estSigne(enr) && !devis.signature){
      debloquer(b, secours);
      return erreur('Ce devis a été signé entre-temps : il ne se modifie plus. ' +
                    'Rien n\'a été enregistré.');
    }
    var avant = enr.numero;
    /* Le numéro ne change que si le devis vient d'être signé ; l'ancien reste
       inscrit, c'est celui que porte l'exemplaire déjà remis au client. */
    if(devis.numero !== enr.numero && !enr.numeroOrigine) enr.numeroOrigine = enr.numero;
    enr.numero = devis.numero;
    enr.devis = devis;
    enr.pdf = pdf64;
    enr.nomFichier = PDF.nomFichier(devis);
    enr.envoyerClient = envoi;
    enr.mail = mailClient();
    enr.statut = 'attente';
    enr.revision = true;              // le bureau remplace, il n'ajoute pas
    enr.nom = moi.nom; enr.code = moi.code; enr.appareil = APPAREIL;
    enr.modifieLe = Date.now();
    if(devis.signature && enr.verdict !== 'SIGNE'){
      enr.verdict = 'SIGNE'; enr.motif = ''; enr.relance = '';
      enr.verdictLe = Date.now(); enr.verdictEnvoye = false;
    }
    DERNIER = enr;
    return DB.put(enr).then(function(){
      var cl = devis.client.societe || devis.client.contact || '';
      tracer('DEVIS MODIFIE', cl + ' — ' + eur(devis.totaux.ttc) + ' TTC' +
             (devis.numero !== avant ? ' — était ' + avant : ''), devis.numero);
      if(devis.signature){
        tracer('SIGNATURE CLIENT', devis.signataire || cl, devis.numero);
        tracer('RESULTAT SIGNE', 'signé à l\'écran', devis.numero);
      }
      MODIF = null; majBandeauModif();
      lsj('brouillon', null);
      chargerRepertoire();
      $('okNum').textContent = devis.numero;
      $('okTot').textContent = eur(devis.totaux.ttc)+' TTC';
      $('okEtat').textContent = navigator.onLine
        ? 'Devis modifié. Envoi au bureau en cours…'
        : 'Devis modifié. Hors connexion : il repart dès que le réseau revient.';
      debloquer(b, secours);
      TERMINE_RETOUR = 0;
      V_TYPE = ''; V_MOTIF = '';
      montrerTermine();
      synchroniser(false);
    });
  }, function(e){
    debloquer(b, secours);
    tracer('ERREUR MODIFICATION', String(e && e.message || e));
    erreur('Le devis modifié n\'a pas pu être enregistré sur l\'appareil.');
  });
}

/* ---------- REMISE SUR UN DEVIS DÉJÀ ÉTABLI ----------

   Le commercial a remis son devis, le client négocie une semaine plus tard.
   Plutôt que de tout ressaisir — et de risquer un chiffre qui diffère —, il
   pose la remise depuis « Mes devis » : le devis garde son numéro, ses lignes
   et ses prix, seule la remise change. Le PDF est refait et le bureau reçoit
   le nouveau montant.

   Un devis signé n'y a pas droit : le client a accepté un montant, on ne le
   change pas dans son dos. S'il faut vraiment reprendre un devis signé, on en
   fait un neuf — c'est à quoi sert « Dupliquer ». */
var REM_DEVIS = null;

function ouvrirRemiseDevis(id, btn){
  if(btn) occuper(btn, '…');
  DB.get(id).then(function(e){
    if(btn) libere(btn);
    if(!e || !e.devis) return;
    if(estSigne(e))
      return erreur('Ce devis est signé : sa remise ne se change plus. Duplique-le pour en refaire un.');
    erreur('');
    REM_DEVIS = e;
    var c = e.devis.client || {};
    $('remDqui').textContent = c.societe || c.contact || '—';
    $('remDnum').textContent = e.numero + ' · ' + eur(e.devis.totaux.ttc) + ' TTC aujourd\'hui';
    $('remDpct').value = String(Number(e.devis.remise) || 0);
    majApercuRemise();
    var d = $('dlgRem');
    if(d.showModal) d.showModal();
    else { d.setAttribute('open',''); d.style.position='fixed'; d.style.bottom='0'; d.style.zIndex='50'; }
  }, function(){ if(btn) libere(btn); });
}

function fermerRemiseDevis(){
  var d = $('dlgRem');
  if(d.close) d.close(); else d.removeAttribute('open');
  REM_DEVIS = null;
}

/* Ce que donnerait la remise saisie, sans rien enregistrer encore. */
function apercuRemise(e, pct){
  var d = e.devis || {};
  var lignes = (d.lignes || []).map(function(l){
    var n = {}; for(var k in l) if(l.hasOwnProperty(k)) n[k] = l[k];
    n.rem = pct;
    return n;
  });
  /* Ce qui a été envoyé au bureau dit déjà tout : un devis récurrent porte un
     nombre de passages, un devis ponctuel porte zéro. Inutile de redéduire la
     récurrence de la nature — on la lirait peut-être autrement qu'au moment où
     le devis a été établi. */
  var passages = Number(d.passages) || 0;
  return { lignes: lignes, totaux: totauxDe(lignes, passages > 0, passages) };
}

function majApercuRemise(el){
  var e = REM_DEVIS;
  if(!e) return;
  var r = lireRemise($('remDpct').value), m = remiseMax();
  var pct = r.valeur > m ? m : r.valeur;
  if(el && pct !== r.valeur) el.value = pct + (r.muet ? ' %' : '');
  var p = apercuRemise(e, pct);
  $('remDavant').textContent = eur(e.devis.totaux.ttc);
  $('remDgain').textContent = '- ' + eur(Math.round((e.devis.totaux.ttc - p.totaux.ttc) * 100) / 100);
  $('remDapres').textContent = eur(p.totaux.ttc);
  var pl = $('remDplaf');
  if(pl) pl.classList.toggle('hide', !(pct > 0 && !r.muet));
}

function appliquerRemiseDevis(btn){
  var e = REM_DEVIS;
  if(!e) return;
  var r = lireRemise($('remDpct').value), m = remiseMax();
  var pct = r.valeur > m ? m : r.valeur;
  var avant = Number(e.devis.remise) || 0;
  if(pct === avant){
    fermerRemiseDevis();
    return erreur('La remise est déjà à ' + nb(pct) + ' % : rien n\'a changé.');
  }
  if(btn) occuper(btn, 'Refabrication du PDF…');
  var id = e.id;
  fermerRemiseDevis();
  DB.get(id).then(function(x){
    if(!x) { if(btn) libere(btn); return; }
    if(estSigne(x)){      // signé entre-temps, sur un autre appareil
      if(btn) libere(btn);
      return erreur('Ce devis vient d\'être signé : sa remise ne se change plus.');
    }
    var p = apercuRemise(x, pct);
    x.devis.lignes = p.lignes;
    x.devis.totaux = p.totaux;
    x.devis.remise = pct;
    try{
      x.pdf = PDF.base64(x.devis, CFG.reglages);
      x.nomFichier = PDF.nomFichier(x.devis);
    }catch(err){
      if(btn) libere(btn);
      tracer('ERREUR PDF', String(err && err.message || err), x.numero);
      return erreur('Le devis n\'a pas pu être refabriqué. La remise n\'a pas été posée.');
    }
    x.revision = true;          // le bureau doit mettre à jour, pas ignorer un doublon
    x.statut = 'attente';
    delete x.derniereErreur;
    return DB.put(x).then(function(){
      if(btn) libere(btn);
      tracer('REMISE POSEE', nb(avant) + ' % → ' + nb(pct) + ' % · ' +
             eur(p.totaux.ttc) + ' TTC', x.numero);
      erreur('');
      if(ETAPE === 6) rendreHistorique();
      synchroniser(true);
    });
  }, function(){ if(btn) libere(btn); });
}

/* L'état de la signature, sur l'écran de fin comme dans « Mes devis ». */
function estSigne(e){ return !!(e && (e.devis||{}).signature); }
function signeLisible(e){
  var t = (e.devis||{}).signeLe;
  if(!t) return 'Signé par le client.';
  var d = new Date(t);
  return 'Signé le ' + jjmmaa(isoJour(d)) +
         ' à ' + ('0'+d.getHours()).slice(-2) + 'h' + ('0'+d.getMinutes()).slice(-2) + '.';
}
function majApercuSignature(){
  var f = !!SIG.image;
  $('sigFaite').classList.toggle('hide', !f);
  $('sigVide').classList.toggle('hide', f);
  if(f) $('sigApercu').src = SIG.image;
  /* v106 — signé à l'écran : le devis signé part au client par e-mail, coché
     d'office (on peut décocher). Signature effacée : on revient au choix. */
  var c = $('fEnvoi');
  if(c){
    if(f && MAIL_MODE !== 'ecran'){ MAIL_MODE = 'ecran'; c.checked = true; majMailClient(); }
    else if(!f && MAIL_MODE === 'ecran'){ MAIL_MODE = ''; c.checked = false; majMailClient(); }
  }
  majCadreMail();
}
var MAIL_MODE = '';      // '' (pas encore choisi) | 'ecran' (signé sur place) | 'distance'
function majCadreMail(){
  var z = $('cMail');
  if(!z) return;
  z.classList.toggle('hide', !MAIL_MODE);
  if($('lEnvoi')) $('lEnvoi').textContent = MAIL_MODE === 'ecran'
    ? 'Envoyer le devis signé au client par e-mail' : 'Envoyer le devis au client pour signature à distance';
  if($('mEnvoi')) $('mEnvoi').textContent = (MAIL_MODE === 'ecran'
    ? 'Il reçoit sa copie signée en PDF. ' : 'Il le lit et le signe en ligne, depuis son téléphone ou son ordinateur. ') +
    'Part au retour du réseau si tu es hors connexion.';
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
  SIG.vide = true; SIG.image = ''; SIG.quand = 0;
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
          civ:val('cCiv'),contact:val('cContact'),tel:val('cTel'),email:val('cEmail'),
          adresse:val('cAdresse'),cp:val('cCp'),ville:val('cVille')};
}
function sauverBrouillon(){
  lsj('brouillon', {client:lireClient(), lignes:LIGNES, objet:val('fObjet'),
                    plus2ans:PLUS2ANS, taux:TAUX, dateSouhaitee:val('fDate'),
                    placement:{date:val('fPlaceDate'), heure:val('fPlaceHeure')},
                    delai:val('fDelai'), notes:val('fNotes'),
                    remise:{valeur:REMISE.valeur, muet:REMISE.muet},
                    nature:NATURE, sansContrat:SANS_CONTRAT, passages:PASSAGES, etat:ETAT, engagement:ENGAGEMENT,
                    km:KM, kmAuto:KM_AUTO, origine:ORIGINE, lieu:LIEU,
                    modif:MODIF});
}
function restaurer(b){
  /* Une modification interrompue (batterie, appli fermée) reprend où elle en
     était : sans cela, le commercial croirait continuer et créerait un second
     devis à l'enregistrement. */
  MODIF = (b.modif && b.modif.id) ? {id:b.modif.id, numero:b.modif.numero || '',
                                     commercial:b.modif.commercial || ''} : null;
  if(MODIF && b.modif.enr) MODIF.enr = b.modif.enr;
  majBandeauModif();
  LIGNES = sansMajoration(b.lignes);
  recalerLibreSeq();
  ETAT = (b.etat === 'TRES_SALE') ? 'TRES_SALE' : 'NORMAL';   // l'ancien palier « sale » n'existe plus
  NATURE = b.nature || null;
  SANS_CONTRAT = !!b.sansContrat;
  PASSAGES = Number(b.passages) || 0;
  KM = (b.km === undefined || b.km === null) ? '' : String(b.km);
  KM_AUTO = b.kmAuto !== false;
  REMISE = {valeur:0, muet:false};
  if(b.remise && typeof b.remise === 'object'){
    REMISE = {valeur:Number(b.remise.valeur)||0, muet:!!b.remise.muet};
  } else {
    // Un brouillon d'avant la remise unique portait un taux par ligne : on
    // retient le plus fort, c'est celui que le client a en tête.
    LIGNES.forEach(function(l){
      var r = Number(l.rem)||0;
      if(r > REMISE.valeur){ REMISE.valeur = r; REMISE.muet = !!l.remMuet; }
    });
  }
  var mx = remiseMax();
  if(REMISE.valeur > mx) REMISE.valeur = mx;
  appliquerRemise();
  ordonnerLignes();
  var c = b.client||{};
  TYPE = (c.type === 'PART') ? 'PART' : 'PRO';
  // Un brouillon d'avant la nature : une fin de chantier, comme avant.
  if(!NATURE) NATURE = 'CHANTIER';
  majType();
  majNature();
  ['Societe','Siret','Tva','Civ','Contact','Tel','Email','Adresse','Cp','Ville'].forEach(function(k){
    $('c'+k).value = c[k.toLowerCase()]||''; });
  majKm();
  $('fObjet').value = b.objet||'';
  ENGAGEMENT = b.engagement && typeof b.engagement === 'object'
    ? { mois: Number(b.engagement.mois) || 0, tacite: b.engagement.tacite !== false } : { mois: 0, tacite: true };
  peindreEngagement();
  $('fDate').value = b.dateSouhaitee||'';
  if($('fPlaceDate')) $('fPlaceDate').value = (b.placement && b.placement.date) || '';
  if($('fPlaceHeure')) $('fPlaceHeure').value = (b.placement && b.placement.heure) || '';
  $('fDelai').value = b.delai||'';
  PLUS2ANS = (b.plus2ans === true || b.plus2ans === false) ? b.plus2ans : null;
  TAUX = b.taux || null;
  majTva();
  ORIGINE = (b.origine === 'ENTRANT') ? 'ENTRANT' : 'PROSPECTION';
  LIEU = (b.lieu === 'AGENCE') ? 'AGENCE' : 'CLIENT';
  majOrigine();
  $('fNotes').value = b.notes||'';
}

/* ====================== NUMÉROTATION LOCALE ======================
   La forme décidée par Simon le 3 octobre 2026 :

       devis remis     DEV-26-11/ POSK/ SLG-03
       devis signé     DEV-26-12/ POSK/ SLG-01/ S

   Année et mois sont ceux de l'établissement du devis, ou ceux de la SIGNATURE
   dès que le client signe : un devis signé change donc de numéro. POSK, ce sont
   les deux premières et les deux dernières lettres du client ; SLG les
   initiales du commercial ; 03 son rang dans le mois.

   Le rang est ce qui rend le numéro unique : deux devis du même mois, du même
   commercial, portent deux rangs différents quel que soit le client. Les
   lettres du client ne comptent donc pas dans la série qui porte le compteur,
   sans quoi tout le monde serait au rang 01. */
function initiales(nom){
  var p = String(nom).trim().split(/\s+/).map(function(m){ return m.charAt(0); }).join('');
  return (p.toUpperCase().replace(/[^A-Z]/g,'') || 'XX').slice(0,3);
}
/* Deux premières et deux dernières lettres du client. Moins de quatre lettres :
   complété par des X, pour que le numéro garde toujours la même longueur. */
function lettresClient(nom){
  var s = String(nom||'');
  if(s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g,'');
  s = s.toUpperCase().replace(/[^A-Z]/g,'');
  if(!s) return 'XXXX';
  if(s.length < 4) return (s+'XXXX').slice(0,4);
  return s.slice(0,2) + s.slice(-2);
}
function nomClient(c){
  c = c || {};
  return String(c.type||'').toUpperCase() === 'PART'
    ? (c.contact || c.societe || '')
    : (c.societe || c.contact || '');
}
/* Les initiales qui iront sur le numéro : celles que le bureau impose dans la
   colonne INITIALES de l'onglet COMMERCIAUX, sinon celles du nom. « SIMON LG »
   donnerait SL, alors que le devis doit lire SLG : personne ne devine cela. */
function initialesMoi(nom){
  var f = String((CFG||{}).initiales||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);
  return f || initiales(nom);
}
/* Celles que porte déjà un numéro : un devis garde les siennes en signant. */
function initialesDuNumero(numero){
  var m = String(numero||'').match(/^.+-\d{2}-\d{2}\/ [A-Z]+\/ ([A-Z]+)-\d+(\/ S)?$/);
  return m ? m[1] : '';
}
function serieDe(nom, signe, quand, ini){
  var d = quand ? new Date(quand) : new Date();
  return String((CFG.reglages||{}).prefixe_devis||'DEV') + '-' +
         String(d.getFullYear()).slice(-2) + '-' +
         ('0'+(d.getMonth()+1)).slice(-2) + '/ ' + (ini || initialesMoi(nom)) +
         (signe ? '/ S' : '');
}
function rangLisible(n){ return n < 10 ? '0'+n : String(n); }
/* Un numéro de devis signé se reconnaît à son suffixe. */
function estNumeroSigne(numero){ return /\/ S$/.test(String(numero||'')); }
/* La forme en service. Les numéros d'avant (DEV-2026-SL-0009) ne la suivent
   pas : on ne les renumérote pas en signant, ils sont antérieurs à la règle. */
function estNumeroCourant(numero){
  return /^.+-\d{2}-\d{2}\/ [A-Z]+\/ [A-Z]+-\d+(\/ S)?$/.test(String(numero||''));
}
/* Le numéro suivant de la série, et le compteur avance d'autant. */
function prochainNumero(nomCommercial, client, signe, quand, ini){
  var serie = serieDe(nomCommercial, signe, quand, ini), cle = 'seq_'+serie;
  var n = Number(ls(cle)||0)+1;
  ls(cle, String(n));
  var p = serie.split('/ ');                       // [ DEV-26-11, SLG (, S) ]
  return p[0] + '/ ' + lettresClient(client) + '/ ' + p[1] + '-' + rangLisible(n) +
         (signe ? '/ S' : '');
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
  var mailPerso = mailClient();
  if(envoi && !(mailPerso && mailPerso.a)) return erreur('Pas d\'e-mail client : décoche l\'envoi ou renseigne l\'adresse.');
  if(envoi && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mailPerso.a)) return erreur('L\'adresse e-mail du client a l\'air fausse.');
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
    var client = lireClient();
    /* Le client qui a signé à l'écran repart avec un devis signé : son numéro
       porte le mois de la signature et le suffixe / S dès maintenant. */
    var quandSig = SIG.image ? (SIG.quand || Date.now()) : 0;
    /* En modification, le devis garde son numéro — sauf s'il se fait signer
       à l'instant : un devis signé porte le mois de sa signature et le suffixe
       / S, et l'ancien numéro reste noté, exactement comme une signature posée
       depuis « Mes devis ». */
    var numModif = '';
    if(enModification()){
      numModif = (SIG.image && !estNumeroSigne(MODIF.numero))
        ? prochainNumero(moi.nom, nomClient(client), true, quandSig || Date.now(),
                         initialesDuNumero(MODIF.numero))
        : MODIF.numero;
    }
    var devis = {
      numero: numModif ||
              prochainNumero(moi.nom, nomClient(client), !!SIG.image, quandSig || Date.now()),
      /* La distance retenue : c'est elle qui a relevé les prix unitaires, et
         c'est sur elle que le bureau refera le calcul. */
      km: estMajorableKm() && String(KM).trim() !== '' ? kmDevis() : '',
      date: new Date().toISOString(),
      validite: new Date(Date.now()+jours*86400000).toISOString(),
      /* En modification, le devis reste à celui qui l'a établi : le gérant qui
         corrige le devis d'un commercial ne le lui prend pas. */
      commercial: (enModification() && MODIF.commercial) || moi.nom,
      client: client,
      lignes: lignesDevis(),
      etatSite: majorationPct() ? ETAT : 'NORMAL',   // ce que le commercial a constaté
      objet: val('fObjet'),
      dateSouhaitee: val('fDate'),   // c'est elle qui sert à planifier
      /* v108e — interne : jamais imprimé, jamais dans le mail au client. */
      placement: (val('fPlaceDate') || val('fPlaceHeure')) ? {date: val('fPlaceDate'), heure: val('fPlaceHeure')} : null,
      delai: val('fDelai'),          // la phrase pour le client, rien de plus
      remise: REMISE.valeur,   // et reportée sur chaque ligne, pour que tout concorde
      nature: NATURE || 'CHANTIER',   // ENTRETIEN | VITRERIE | FACADE | CHANTIER | REMISE
      origine: ORIGINE,                       // 'PROSPECTION' | 'ENTRANT', pour le suivi
      lieuSignature: TYPE === 'PART' ? LIEU : '',   // commande le formulaire de rétractation
      passages: estRecurrent() ? PASSAGES : 0,
      sansContrat: NATURE === 'ENTRETIEN' && SANS_CONTRAT,
      engagement: estRecurrent() ? { mois: ENGAGEMENT.mois, tacite: ENGAGEMENT.tacite } : null,
      notes: val('fNotes'),
      signataire: val('fSignataire'),
      signature: SIG.image || '',
      signeLe: quandSig,
      totaux: totaux()
    };
    var pdf64 = PDF.base64(devis, CFG.reglages);
    if(enModification()) return enregistrerModification(b, envoi, moi, secours, devis, pdf64);
    var enr = {
      id: 'd-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
      numero: devis.numero, devis: devis, pdf: pdf64,
      nomFichier: PDF.nomFichier(devis),
      envoyerClient: envoi, mail: mailClient(), statut: 'attente', cree: Date.now(),
      nom: moi.nom, code: moi.code, appareil: APPAREIL, pdfUrl: '',
      photos: [],           // prises plus tard, depuis « Mes devis »
      // Un devis que le client a signé n'a pas de résultat à demander : il est
      // signé, et l'application doit le dire comme le classeur l'enregistre.
      verdict: devis.signature ? 'SIGNE' : '',
      verdictLe: devis.signature ? Date.now() : 0,
      motif: '', relance: '', note: '', verdictEnvoye: false
    };
    DERNIER = enr;
    DB.put(enr).then(function(){
      var cl = devis.client.societe || devis.client.contact || '';
      tracer('DEVIS CREE', cl + ' — ' + eur(devis.totaux.ttc) + ' TTC — TVA ' +
             (TAUX || '?') + ' %', devis.numero);
      if(devis.signature){
        tracer('SIGNATURE CLIENT', devis.signataire || cl, devis.numero);
        tracer('RESULTAT SIGNE', 'signé à l\'écran', devis.numero);
      }
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
/* Télécharger : le fichier descend sur l'appareil, là où il range ses
   téléchargements. C'est le geste que réclame un ordinateur, où la feuille de
   partage du système n'existe pas ou n'enregistre rien.

   Sur iPhone et iPad, un lien de téléchargement ouvre le PDF dans une
   visionneuse au lieu de l'enregistrer : Safari ne sait pas faire autrement.
   On y passe donc par la feuille de partage, qui offre « Enregistrer dans
   Fichiers » — c'est le même geste pour celui qui tient le téléphone, et
   c'est le seul qui aboutisse à un fichier gardé. */
function estApple(){
  try{
    var ua = navigator.userAgent || '';
    if(/iPad|iPhone|iPod/.test(ua)) return true;
    /* Un iPad récent se présente comme un Mac : seul le tactile le trahit. Un
       vrai Mac, lui, télécharge très bien. */
    return /Mac/.test(ua) && Number(navigator.maxTouchPoints) > 1;
  }catch(e){ return false; }
}
function telecharger(enr){
  if(!enr || !enr.pdf) return;
  tracer('PDF TELECHARGE', enr.nomFichier || '', enr.numero);
  var blob = b64versBlob(enr.pdf);
  var nom = enr.nomFichier || ('Devis ' + (enr.numero || '') + '.pdf');
  if(estApple()){
    var f = null;
    try{ f = new File([blob], nom, {type:'application/pdf'}); }catch(e){}
    if(f && navigator.canShare && navigator.canShare({files:[f]})){
      navigator.share({files:[f], title:'Devis ' + (enr.numero || '')})
        .catch(function(){});
      return;
    }
  }
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} a.remove(); }, 4000);
}

/* ====================== VOIR LE DEVIS ======================
   Le PDF s'ouvre dans l'application, en plein écran : le commercial le montre
   au client sans rien télécharger ni quitter l'outil. C'est de là qu'on
   imprime ou qu'on envoie — sur iPhone, l'impression passe obligatoirement par
   la feuille de partage du système, aucune application web ne peut l'ouvrir
   elle-même. */
var PDF_VU = null, PDF_URL = null;

/* Le moteur de rendu (pdf.js, Mozilla) pèse lourd : on ne le charge que la
   première fois qu'on ouvre un devis, pas au démarrage. Il est en cache, donc
   ce chargement marche aussi sans réseau. */
var LECTEUR = null;
function chargerLecteur(){
  if(LECTEUR) return LECTEUR;
  LECTEUR = new Promise(function(res, rej){
    if(window.pdfjsLib) return res(window.pdfjsLib);
    var sc = document.createElement('script');
    sc.src = 'visionneuse.js?v=55';
    sc.onload = function(){
      if(!window.pdfjsLib) return rej(new Error('moteur absent'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'visionneuse.worker.js?v=55';
      res(window.pdfjsLib);
    };
    sc.onerror = function(){ LECTEUR = null; rej(new Error('moteur illisible')); };
    document.head.appendChild(sc);
  });
  return LECTEUR;
}

/* Chaque page du devis est dessinée dans la page elle-même. C'est ce qui
   permet au bouton « Imprimer » d'ouvrir la fenêtre d'impression du téléphone :
   on imprime un écran, pas un fichier — un PDF dans un cadre n'est pas une
   page imprimable, la commande resterait sans effet. */
function ouvrirPdf(enr){
  if(!enr || !enr.pdf) return erreur('Le PDF de ce devis n\'est pas disponible sur cet appareil.');
  erreur('');
  PDF_VU = enr;
  $('poNum').textContent = enr.numero + (estSigne(enr) ? ' · signé' : '');
  $('poPages').innerHTML = '<div class="empty">Ouverture du devis…</div>';
  $('pdfOverlay').classList.remove('hide');
  var partageOk = partageFichierPossible();
  $('poImpr').classList.toggle('hide', partageOk);
  $('poAide').textContent = partageOk
    ? 'Enregistre le devis dans Fichiers, l\'imprime ou l\'envoie.'
    : 'Partager enregistre ou envoie le fichier.';
  tracer('PDF AFFICHE', enr.nomFichier || '', enr.numero);
  dessinerPdf(enr).catch(function(e){
    $('poPages').innerHTML = '<div class="empty">Le devis n\'a pas pu être affiché ici.<br>' +
      'Utilise « Imprimer ou envoyer » pour l\'ouvrir.</div>';
    tracer('ERREUR VISIONNEUSE', String(e && e.message || e), enr.numero);
  });
}

function dessinerPdf(enr){
  return chargerLecteur().then(function(lib){
    var bin = atob(enr.pdf), n = bin.length, u = new Uint8Array(n);
    for(var i=0;i<n;i++) u[i] = bin.charCodeAt(i);
    return lib.getDocument({data:u}).promise;
  }).then(function(doc){
    var z = $('poPages');
    z.innerHTML = '';
    // 180 points par pouce : assez fin pour être imprimé sans que la page
    // pèse trop en mémoire sur un téléphone.
    var echelle = 2.5;
    var suite = Promise.resolve();
    for(var n = 1; n <= doc.numPages; n++){
      (function(num){
        suite = suite.then(function(){
          return doc.getPage(num).then(function(page){
            var vue = page.getViewport({scale: echelle});
            var cv = document.createElement('canvas');
            cv.width = Math.round(vue.width); cv.height = Math.round(vue.height);
            cv.className = 'poPage';
            z.appendChild(cv);
            return page.render({canvasContext: cv.getContext('2d'), viewport: vue}).promise;
          });
        });
      })(n);
    }
    return suite;
  });
}

function fermerPdf(){
  $('pdfOverlay').classList.add('hide');
  $('poPages').innerHTML = '';
  if(PDF_URL){ try{ URL.revokeObjectURL(PDF_URL); }catch(e){} PDF_URL = null; }
  PDF_VU = null;
}

/* La feuille de partage du système sait-elle recevoir un fichier ?
   Sur iPhone et sur Android, oui : elle offre alors « Enregistrer dans
   Fichiers », « Imprimer », le mail et AirDrop, et l'application n'a pas à
   refaire ce travail. Sur un ordinateur, souvent non : il faut alors un vrai
   bouton d'impression. On pose la question au navigateur plutôt que de
   deviner le matériel. */
function partageFichierPossible(){
  try{
    // Un ordinateur sait parfois « partager » un fichier — Chrome passe par la
    // feuille du système — mais cette feuille-là n'imprime pas : elle envoie.
    // Masquer notre bouton d'impression y laisserait l'utilisateur sans rien.
    // Seul un appareil tactile offre vraiment l'ensemble enregistrer, imprimer,
    // envoyer. Ailleurs, on garde notre propre bouton.
    if(!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return false;
    var f = new File([new Blob(['x'], {type:'application/pdf'})], 'x.pdf',
                     {type:'application/pdf'});
    return !!(navigator.canShare && navigator.canShare({files:[f]}));
  }catch(e){ return false; }
}

/* Imprimer : la fenêtre d'impression du système s'ouvre sur les pages
   dessinées ci-dessus, et sur elles seules (voir la règle @media print). */
function imprimerVu(){
  if(!PDF_VU) return;
  tracer('PDF IMPRIME', PDF_VU.nomFichier || '', PDF_VU.numero);
  window.print();
}
function voirDernier(btn){
  if(btn) occuper(btn, 'Préparation…');
  peindre().then(function(){ ouvrirPdf(DERNIER); if(btn) setTimeout(function(){ libere(btn); }, 400); });
}
function voirPdfId(id, btn){
  if(btn) occuper(btn, '…');
  DB.get(id).then(function(e){ ouvrirPdf(e); if(btn) setTimeout(function(){ libere(btn); }, 400); },
                  function(){ if(btn) libere(btn); });
}
/* Enregistrer sur l'appareil le devis ouvert à l'écran. */
function telechargerVu(btn){
  if(!PDF_VU) return;
  if(btn) occuper(btn, '…');
  telecharger(PDF_VU);
  if(btn) setTimeout(function(){ libere(btn); }, 600);
}

/* Envoyer : la feuille de partage du système — mail, messagerie, AirDrop. */
function partagerVu(btn){
  if(!PDF_VU) return;
  if(btn) occuper(btn, '…');
  partager(PDF_VU);
  if(btn) setTimeout(function(){ libere(btn); }, 600);
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
  /* Le gérant établit lui aussi des devis depuis la v82 : les siens partent
     par le même chemin que ceux des commerciaux. On rafraîchit son tableau en
     plus, puis on laisse l'envoi suivre son cours. */
  if(estAdmin() && navigator.onLine) chargerTableau();
  if(estAgent()){
    if(btn) libere(btn);
    return pousserChantiers().then(function(){
      if(navigator.onLine) chargerPlanning();
    });
  }
  if(SYNC){ if(btn) libere(btn); return; }
  /* Les résultats d'appel voyagent avec le reste : le commercial ne doit pas
     avoir à se souvenir qu'il y a deux choses à envoyer. */
  prPousser();
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
    /* Un devis marqué signé prend un numéro neuf côté bureau : on le reprend,
       sinon le prochain envoi parlerait d'un devis que le classeur ne connaît
       plus sous ce nom. */
    if(d.numero && d.numero !== enr.numero){
      if(d.numeroOrigine && !enr.numeroOrigine) enr.numeroOrigine = d.numeroOrigine;
      enr.numero = d.numero;
      if(enr.devis) enr.devis.numero = d.numero;
    }
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
      envoyerClient:enr.envoyerClient, mail:enr.mail || null, devis:enr.devis, pdf:enr.pdf, nomFichier:enr.nomFichier,
      revision: !!enr.revision
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
    delete enr.revision;        // la révision est passée : un renvoi ordinaire ensuite
    /* Le bureau a donné un autre numéro : soit le nôtre était déjà pris, soit
       le devis vient d'être signé et change de numéro. Dans les deux cas c'est
       le sien qui fait foi — le PDF déjà remis au client, lui, garde l'ancien. */
    if(d.numero && d.numero !== enr.numero){
      if(!enr.numeroOrigine || !estNumeroSigne(d.numero)) enr.numeroPdf = enr.numero;
      enr.numero = d.numero; enr.devis.numero = d.numero;
    }
    if(d.numeroOrigine && !enr.numeroOrigine) enr.numeroOrigine = d.numeroOrigine;
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

/* ====================== HISTORIQUE ======================
   Le mois regardé. Un commercial qui cherche « le devis de septembre » ne doit
   pas avoir à dérouler toute l'année : le choix vit le temps de la session,
   et retombe sur « tous les mois » à la connexion suivante. */
var MOIS_VU = '';                 // '' = tous, sinon 'AAAA-MM'
var MOIS_LOCAUX = {};             // les mois des devis portés par l'appareil

function moisDe(t){
  var d = new Date(t);
  if(isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + ('0' + (d.getMonth()+1)).slice(-2);
}
var MOIS_NOM = ['janvier','février','mars','avril','mai','juin',
                'juillet','août','septembre','octobre','novembre','décembre'];
function libelleMois(m){
  var p = /^(\d{4})-(\d{2})$/.exec(String(m||''));
  if(!p) return '';
  return MOIS_NOM[Number(p[2]) - 1] + ' ' + p[1];
}
function choisirMois(v){
  MOIS_VU = String(v || '');
  rendreHistorique();
}
/* Les mois où il s'est passé quelque chose, du plus récent au plus ancien :
   proposer un mois vide n'aurait aucun sens. */
function peindreMois(){
  var s = $('hMois');
  if(!s) return;
  var vus = {};
  Object.keys(MOIS_LOCAUX).forEach(function(m){ vus[m] = 1; });
  ARCH.forEach(function(d){ var m = moisDe(d.date); if(m) vus[m] = 1; });
  var l = Object.keys(vus).sort().reverse();
  /* Le mois choisi reste proposé même s'il n'a plus rien : sinon le menu
     changerait de valeur tout seul sous le doigt. */
  if(MOIS_VU && l.indexOf(MOIS_VU) < 0) l.unshift(MOIS_VU);
  s.innerHTML = '<option value="">Tous les mois</option>' +
    l.map(function(m){
      return '<option value="' + m + '"' + (m === MOIS_VU ? ' selected' : '') + '>' +
             ech(libelleMois(m)) + '</option>';
    }).join('');
  /* Pas de « s.value = MOIS_VU » ici : l'attribut « selected » posé ci-dessus
     fait déjà le travail, et le mois choisi figure toujours dans la liste. */
  s.classList.toggle('hide', !l.length);
}
function ouvrirHistorique(){
  /* v106 — pour le gérant, « Mes devis » est l'onglet Devis du tableau (même
     liste, « Mon chiffre » au-dessus, « Nouveau devis »). */
  if(estAdmin()){ if(ETAPE >= 1 && ETAPE <= 5) ECRAN_AVANT = ETAPE; return barreAdmin('devis'); }
  if(ETAPE >= 1 && ETAPE <= 5) ECRAN_AVANT = ETAPE;
  ETAPE=6; montrer('e6');
  majBandeauModif();            // on quitte le parcours : le rappel n'a plus lieu d'être
  $('steps').classList.add('hide');
  barreRetour();
  $('bHist').classList.add('hide');      // on y est déjà
  $('hTitre').textContent='Mes devis';
  var moi = session();
  $('quiSuisJe').textContent = (moi && moi.nom) || '—';
  /* Les devis du bureau : ce qui est déjà en cache s'affiche tout de suite, et
     un appel les rafraîchit sans bloquer l'écran. */
  archiveRelue();
  if(navigator.onLine) chargerArchive(0, $('bArch'));
  var m=$('majCat'); if(m && CFG && CFG.maj) m.textContent = new Date(CFG.maj).toLocaleDateString('fr-FR');
  rendreHistorique(); window.scrollTo(0,0);
}
function rendreHistorique(){
  DB.tous().then(function(l){
    l.sort(function(a,b){ return b.cree-a.cree; });
    peindreRappels(l);
    /* Ce que l'appareil porte déjà : la liste du bureau s'en sert pour ne pas
       afficher deux fois le même devis. */
    NUM_LOCAUX = {};
    l.forEach(function(e){
      [e.numero, e.numeroOrigine, e.numeroPdf].forEach(function(n){
        if(n) NUM_LOCAUX[String(n)] = 1;
      });
    });
    MOIS_LOCAUX = {};
    l.forEach(function(e){ var m = moisDe(e.cree); if(m) MOIS_LOCAUX[m] = 1; });

    peindreMois();
    rendreArchive();
    var tout = l.length;
    if(MOIS_VU) l = l.filter(function(e){ return moisDe(e.cree) === MOIS_VU; });
    if(!l.length){
      $('liste').innerHTML = '<div class="empty">' + (tout && MOIS_VU
        ? 'Aucun devis sur cet appareil en ' + ech(libelleMois(MOIS_VU)) + '.'
        : 'Aucun devis pour le moment.') + '</div>';
      return;
    }
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
        (e.numeroOrigine?' · avant signature : '+ech(e.numeroOrigine):'')+
        detailVerdict(e)+'</span></div>'+
        '<div class="acts">'+
        '<button class="btn sec sm" onclick="voirPdfId(\''+e.id+'\', this)">Voir le PDF</button>'+
        '<button class="btn sec sm" onclick="ouvrirVerdict(\''+e.id+'\')">Résultat</button>'+
        '<button class="btn sec sm" onclick="ouvrirPhotos(\''+e.id+'\', \''+
          (e.verdict==='SIGNE' && !sig ? 'SIGNE' : 'SITE')+'\')">Photos'+(ph?' ('+ph+')':'')+'</button>'+
        (estSigne(e) ? '' :
          '<button class="btn sec sm" onclick="ouvrirSignatureDevis(\''+e.id+'\', this)">Signer</button>'+
          '<button class="btn sec sm" onclick="ouvrirModification(\''+e.id+'\', this)">Modifier</button>'+
          '<button class="btn sec sm" onclick="ouvrirRemiseDevis(\''+e.id+'\', this)">Remise</button>')+
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
    var dû = (e.relance <= isoJour());
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
  var auj = isoJour();
  var hier = new Date(Date.now() - 86400000).getTime();
  var rel = l.filter(function(e){ return e.verdict === 'RELANCE' && e.relance && e.relance <= auj; });
  var sans = l.filter(function(e){ return !e.verdict && !e.depuisBureau && Number(e.cree||0) < hier; });
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
/* ---------- MODIFIER UN DEVIS DÉJÀ ÉTABLI ----------

   Le commercial s'est trompé d'une quantité, le client ajoute une pièce, une
   adresse était fausse. Plutôt que de tout ressaisir — et de risquer un chiffre
   qui diffère — il rouvre le devis depuis « Mes devis », refait le chemin
   normal, et réenregistre.

   Trois décisions de Simon (10 octobre 2026), et ce qu'elles impliquent :

   — **le devis garde son numéro**. Le bureau reçoit une révision, pas un second
     devis : c'est le même chemin que la remise de la v55, `revision: true`,
     qui fait remplacer la ligne au lieu de l'ajouter ;
   — **tout est modifiable**, parce qu'on repasse par les écrans ordinaires ;
   — **les prix ne bougent pas**. C'est là que « Modifier » se sépare de
     « Dupliquer » : dupliquer ouvre une affaire neuve et repart du catalogue du
     jour, modifier reprend un devis déjà annoncé au client, dont les prix —
     éloignement compris — ont déjà été dits. Un prix qui changerait tout seul
     entre deux versions serait invisible et indéfendable.

   Un devis signé n'y a pas droit, pour la même raison que la remise : le client
   a accepté un montant. Et comme il peut se faire signer **pendant** la
   modification, le cas est traité plus bas, à l'enregistrement. */
var MODIF = null;      // {id, numero} du devis en cours de modification

function enModification(){ return !!(MODIF && MODIF.id); }

function ouvrirModification(id, btn){
  if(btn) occuper(btn, '…');
  DB.get(id).then(function(e){
    if(btn) libere(btn);
    ouvrirModificationEnr(e, null);
  });
}

/* v108e — `horsAppareil` : le devis vient du bureau (fiche du tableau) et n'est
   pas sur ce téléphone. Il n'y est écrit qu'à l'enregistrement de la
   modification ; d'ici là il voyage avec MODIF, brouillon compris. */
function ouvrirModificationEnr(e, horsAppareil){
  (function(){
    if(!e || !e.devis) return;
    if(estSigne(e)){
      return erreur('Ce devis est signé : il ne se modifie plus. Utilise « Dupliquer » ' +
                    'pour en établir un nouveau.');
    }
    var d = e.devis, c = d.client || {};
    nouveauDevis();                 // remet tout à zéro, MODIF compris
    MODIF = {id: e.id, numero: e.numero, commercial: d.commercial || ''};
    if(horsAppareil) MODIF.enr = horsAppareil;
    TYPE = (c.type === 'PART') ? 'PART' : 'PRO';
    PLUS2ANS = (c.plus2ans === true || c.plus2ans === false) ? c.plus2ans : null;
    majType();
    if(PLUS2ANS !== null) appliquerTaux(PLUS2ANS ? 10 : 20);
    ['Societe','Siret','Tva','Civ','Contact','Tel','Email','Adresse','Cp','Ville'].forEach(function(k){
      $('c'+k).value = c[k.toLowerCase()] || '';
    });
    /* Les lignes telles qu'elles ont été chiffrées, prix compris. On retire la
       seule ligne que l'application refabrique elle-même — la majoration d'état
       des lieux — pour qu'elle ne se compte pas deux fois. */
    LIGNES = sansMajoration(d.lignes).map(function(l){
      var o = {}; for(var k in l){ if(l.hasOwnProperty(k)) o[k] = l[k]; } return o;
    });
    recalerLibreSeq();
    REMISE = {valeur: Number(d.remise) || 0, muet: false};
    LIGNES.forEach(function(l){ if(l.remMuet) REMISE.muet = true; });
    NATURE = d.nature || NATURE;
    SANS_CONTRAT = !!d.sansContrat;
    PASSAGES = Number(d.passages) || 0;
    KM = (d.km === undefined || d.km === null) ? '' : String(d.km);
    KM_AUTO = false;                // la distance du devis, pas celle d'aujourd'hui
    majNature();
    majKm();
    retirerKmDesPrix();
    ETAT = (d.etatSite === 'TRES_SALE') ? 'TRES_SALE' : 'NORMAL';
    ORIGINE = (d.origine === 'ENTRANT') ? 'ENTRANT' : 'PROSPECTION';
    LIEU = (d.lieuSignature === 'AGENCE') ? 'AGENCE' : 'CLIENT';
    majOrigine();
    $('fObjet').value = d.objet || '';
    ENGAGEMENT = d.engagement && typeof d.engagement === 'object'
      ? { mois: Number(d.engagement.mois) || 0, tacite: d.engagement.tacite !== false } : { mois: 0, tacite: true };
    peindreEngagement();
    $('fDate').value = d.dateSouhaitee || '';
    $('fPlaceDate').value = (d.placement && d.placement.date) || '';
    $('fPlaceHeure').value = (d.placement && d.placement.heure) || '';
    $('fDelai').value = d.delai || '';
    $('fNotes').value = d.notes || '';
    tracer('DEVIS MODIFIE', 'ouvert pour modification', e.numero);
    majBandeauModif();
    sauverBrouillon();
    etape(2);
    window.scrollTo(0,0);
  })();
}

/* v108e — les prix enregistrés d'un devis d'entretien portent déjà
   l'éloignement du client (lignesDevis les relève au moment de l'envoi). Les
   reprendre tels quels pour une modification les relevait une seconde fois.
   On repart donc des prix d'avant relèvement : à l'enregistrement, le même
   calcul les relève de nouveau, et une ligne ajoutée prend sa part du trajet
   comme sur un devis neuf. */
function retirerKmDesPrix(){
  var sup = supplementKm();
  if(!(sup > 0)) return;
  var dans = function(l){ return String(l.reference||'') !== REF_MAJ && !estLigneLibre(l); };
  var tot = 0;
  LIGNES.forEach(function(l){ if(dans(l)) tot += (Number(l.qte)||0) * (Number(l.pu)||0); });
  var base = tot - sup;
  if(!(base > 0)) return;
  var taux = sup / base;
  LIGNES.forEach(function(l){
    if(dans(l)) l.pu = Math.round((Number(l.pu)||0) / (1 + taux) * 10000) / 10000;
  });
}

/* v108e — « Modifier ce devis » depuis la fiche du tableau. Le gérant n'a pas
   forcément établi le devis sur ce téléphone : s'il y est, on le reprend tel
   quel ; sinon on le fait venir du bureau, lignes et prix compris. Il repart
   en révision sous le même identifiant, si bien que le classeur remplace sa
   ligne au lieu d'en ajouter une. */
function modifierDepuisFiche(btn){
  var f = AD_FICHE;
  if(!f || f.type !== 'devis') return;
  var num = String(f.cle || '');
  var moi = session();
  if(!moi) return;
  erreur('');
  if(btn) occuper(btn, 'Chargement…');
  DB.tous().then(function(l){
    var ici = (l || []).filter(function(e){
      return e && e.devis && (e.numero === num || e.numeroOrigine === num || e.numeroPdf === num);
    })[0];
    if(ici){ if(btn) libere(btn); return ouvrirModificationEnr(ici, null); }
    if(!(CFG && CFG.catalogue)){ if(btn) libere(btn); return erreur('Le catalogue n\'est pas encore arrivé.'); }
    if(!navigator.onLine){ if(btn) libere(btn); return erreur('Hors connexion : les lignes de ce devis sont au bureau.'); }
    return poster({action:'devisArchive', nom:moi.nom, code:moi.code, appareil:APPAREIL, numero:num}, 40000)
      .then(function(r){
        if(btn) libere(btn);
        if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : 'Le bureau n\'a pas répondu.');
        if(r.signe) return erreur('Ce devis est signé : il ne se modifie plus. Utilise « Refaire un devis ' +
                                  'pour ce client » pour en établir un nouveau.');
        if(!r.idDevis) return erreur('Ce devis est trop ancien pour être modifié d\'ici (il n\'a pas ' +
                                     'd\'identifiant au classeur). Refais un devis pour ce client.');
        var e = enrDepuisArchive(r);
        ouvrirModificationEnr(e, e);
      }, function(){
        if(btn) libere(btn);
        erreur('Le bureau n\'a pas répondu. Réessaie dans un instant.');
      });
  });
}

/* La fiche d'appareil d'un devis venu du bureau : la même forme que celles
   que l'application écrit à l'enregistrement, pour que « Mes devis » et la
   révision la traitent sans cas particulier. */
function enrDepuisArchive(r){
  var st = String(r.statut || '').toUpperCase();
  var cree = Date.parse(r.date || '');
  return {
    id: String(r.idDevis), numero: String(r.numero || ''),
    cree: isNaN(cree) ? Date.now() : cree,
    statut: 'envoye', photos: [], depuisBureau: true,
    verdict: st === 'REFUSE' ? 'REFUSE' : (st === 'RELANCE' ? 'RELANCE' : ''),
    verdictEnvoye: true, motif: '', relance: '', note: '',
    devis: {
      numero: String(r.numero || ''), date: r.date || new Date().toISOString(),
      commercial: r.commercial || '', client: r.client || {}, lignes: r.lignes || [],
      nature: r.nature || 'CHANTIER', passages: Number(r.passages) || 0,
      sansContrat: !!r.sansContrat, km: (r.km === '' || r.km === undefined || r.km === null) ? '' : r.km,
      etatSite: r.etatSite || 'NORMAL', origine: r.origine || 'PROSPECTION',
      lieuSignature: r.lieuSignature || '', objet: r.objet || '', delai: r.delai || '',
      dateSouhaitee: r.dateSouhaitee || '', notes: r.notes || '', placement: r.placement || null,
      remise: Number(r.remise) || 0, engagement: r.engagement || null,
      totaux: r.totaux || {ht:0, ttc:0}, signature: ''
    }
  };
}

/* Le bandeau qui rappelle, à chaque écran, qu'on reprend un devis et qu'on n'en
   crée pas un neuf. Sans lui, rien ne distinguerait les deux parcours — et le
   commercial croirait avoir fait un second devis. */
function majBandeauModif(){
  var b = $('bandModif');
  if(!b) return;
  /* Seulement sur les quatre écrans du devis : ailleurs — « Mes devis », le
     phoning, l'écran de fin — il n'aurait rien à dire et occuperait la place. */
  var ici = enModification() && ETAPE >= 1 && ETAPE <= 4;
  b.classList.toggle('hide', !ici);
  if(ici) $('bandModifNum').textContent = MODIF.numero;
}
function abandonnerModification(){
  if(!enModification()) return;
  tracer('MODIFICATION ABANDONNEE', '', MODIF.numero);
  nouveauDevis();
  ouvrirHistorique();
}

function dupliquer(id, btn){
  if(btn) occuper(btn, '');
  DB.get(id).then(function(e){
    if(btn) libere(btn);
    dupliquerEnr(e);
  });
}

/* Le même geste, que le devis vienne de l'appareil ou du bureau. */
function dupliquerEnr(e){
  (function(){
    if(!e || !e.devis) return;
    var d = e.devis, c = d.client || {};
    nouveauDevis();
    TYPE = (c.type === 'PART') ? 'PART' : 'PRO';
    PLUS2ANS = (c.plus2ans === true || c.plus2ans === false) ? c.plus2ans : null;
    majType();
    if(PLUS2ANS !== null) appliquerTaux(PLUS2ANS ? 10 : 20);
    ['Societe','Siret','Tva','Civ','Contact','Tel','Email','Adresse','Cp','Ville'].forEach(function(k){
      $('c'+k).value = c[k.toLowerCase()] || '';
    });
    tracer('DEVIS DUPLIQUE', 'repris de ' + e.numero, e.numero);
    /* La majoration d'un ancien devis ne se recopie pas : elle se recalcule,
       à partir de l'état noté et des taux d'aujourd'hui. */
    /* Les prix d'un devis d'entretien portent déjà l'éloignement du client :
       les recopier tels quels le compterait deux fois. On repart donc du
       catalogue d'aujourd'hui, seul prix que le bureau accepte de toute façon. */
    LIGNES = sansMajoration(d.lignes).map(function(l){
      var o = {}; for(var k in l){ if(l.hasOwnProperty(k)) o[k] = l[k]; } return o;
    });
    LIGNES.forEach(function(l){
      /* Une ligne libre garde son prix : il n'y a pas de catalogue où aller le
         rechercher, et c'est bien pour ça qu'elle existe. */
      if(estLigneLibre(l)) return;
      var pr = prestationRef(l.reference);
      if(pr) l.pu = Number(pr.pu) || 0;
    });
    recalerLibreSeq();
    NATURE = d.nature || NATURE;
    SANS_CONTRAT = !!d.sansContrat;
    PASSAGES = Number(d.passages) || 0;
    KM = (d.km === undefined || d.km === null) ? '' : String(d.km);
    KM_AUTO = true;
    majNature();
    majKm();
    ETAT = (d.etatSite === 'TRES_SALE') ? 'TRES_SALE' : 'NORMAL';
    $('fObjet').value = d.objet || '';
    // La date d'un ancien devis n'a plus cours : on la laisse à choisir.
    $('fDate').value = '';
    $('fDelai').value = d.delai || '';
    $('fNotes').value = d.notes || '';
    sauverBrouillon();
    etape(2);
    erreur('');
  })();
}

/* ====================== LES DEVIS GARDÉS PAR LE BUREAU ======================
   « Mes devis » ne lisait que la mémoire du téléphone. Un appareil neuf, un
   cache vidé, ou simplement la purge des trente jours, et le commercial se
   retrouvait devant une liste vide alors que le classeur, lui, avait tout
   gardé. Cette liste-ci vient du bureau : ses devis des douze derniers mois,
   les siens seulement, qu'ils aient été faits sur ce téléphone ou sur un
   autre. Il les consulte, lit le PDF, pose le résultat et les duplique ;
   modifier et signer restent à l'appareil qui porte le devis, sinon deux
   téléphones se marcheraient dessus. */
var ARCH = [];                // les devis relus dans le classeur
var ARCH_MOIS = 12;           // la profondeur du dernier chargement
var ARCH_MAJ = 0;             // quand il date
var ARCH_NUM = '';            // le devis ouvert dans la fiche
var NUM_LOCAUX = {};          // ce que l'appareil porte déjà, par numéro

function archiveRelue(){
  var a = lsj('archive');
  if(!a || !a.devis) return;
  ARCH = a.devis;
  ARCH_MOIS = Number(a.mois) || 12;
  ARCH_MAJ = Number(a.maj) || 0;
}
function archiveRangee(){
  try{ lsj('archive', {devis:ARCH, mois:ARCH_MOIS, maj:ARCH_MAJ}); }catch(e){}
}
/* La liste du bureau est celle d'un commercial : elle quitte l'appareil avec
   lui, sinon le suivant la trouverait en ouvrant « Mes devis ». Les devis
   enregistrés sur l'appareil, eux, restent : ils doivent encore partir. */
function oublierArchive(){
  ARCH = []; ARCH_MOIS = 12; ARCH_MAJ = 0; ARCH_NUM = ''; MOIS_VU = ''; MOIS_LOCAUX = {};
  try{ lsj('archive', null); }catch(e){}
  var z = $('arListe'); if(z) z.innerHTML = '';
}
function archiveDe(num){
  for(var i = 0; i < ARCH.length; i++){ if(ARCH[i].numero === num) return ARCH[i]; }
  return null;
}

function chargerArchive(mois, btn){
  var moi = session();
  if(!moi) return;
  if(!navigator.onLine){
    if(btn) libere(btn);
    return erreur('Hors connexion : tes devis du bureau s\'afficheront au retour du réseau.');
  }
  var m = Number(mois) || ARCH_MOIS || 12;
  if(btn) occuper(btn, 'Chargement…');
  poster({action:'mesDevis', nom:moi.nom, code:moi.code, appareil:APPAREIL, mois:m}, 40000)
    .then(function(r){
      if(btn) libere(btn);
      if(!r || !r.ok){
        if(r && r.refus) return reidentifier('Ton accès a changé côté bureau.');
        return erreur((r && r.erreur) ? String(r.erreur) : 'Le bureau n\'a pas répondu.');
      }
      ARCH = r.devis || [];
      ARCH_MOIS = Number(r.mois) || m;
      ARCH_MAJ = Number(r.maj) || Date.now();
      archiveRangee();
      erreur('');
      rendreArchive();
    }, function(){
      if(btn) libere(btn);
      erreur('Le bureau n\'a pas répondu. Réessaie dans un instant.');
    });
}

function badgeArchive(d){
  var s = String(d.statut || '').toUpperCase();
  if(s === 'SIGNE')      return '<span class="vb vb-s">SIGNÉ</span>';
  if(s === 'REFUSE')     return '<span class="vb vb-x">REFUSÉ</span>';
  if(s === 'A RELANCER') return '<span class="vb vb-r">À RELANCER</span>';
  return '<span class="vb vb-a">À RENSEIGNER</span>';
}

function rendreArchive(){
  try{ peindreChiffresCommercial(); }catch(e){}
  var z = $('arListe');
  if(!z) return;
  /* Le menu des mois se refait ici aussi : la liste du bureau arrive après
     celle de l'appareil, et elle apporte des mois que l'appareil n'a plus. */
  peindreMois();
  var a = $('arAide');
  if(a){
    a.textContent = ARCH_MAJ
      ? 'Relu dans le classeur le ' + jjmmaa(isoJour(new Date(ARCH_MAJ))) +
        ' · ' + ARCH_MOIS + ' derniers mois'
      : 'Tes devis tels que le bureau les a gardés, même ceux faits sur un autre téléphone.';
  }
  var p = $('bArchPlus');
  if(p) p.classList.toggle('hide', ARCH_MOIS >= 120);
  /* Un devis déjà sur l'appareil ne se montre pas deux fois : c'est la version
     locale qui compte, c'est elle qui porte le PDF et qui se modifie. */
  var l = ARCH.filter(function(d){
    if(NUM_LOCAUX[d.numero]) return false;
    if(d.numeroOrigine && NUM_LOCAUX[d.numeroOrigine]) return false;
    /* Le mois choisi vaut pour les deux listes : sans cela, filtrer n'en
       cacherait que la moitié. */
    if(MOIS_VU && moisDe(d.date) !== MOIS_VU) return false;
    return true;
  });
  if(!l.length){
    z.innerHTML = '<div class="empty">' + (MOIS_VU
      ? 'Rien d\'autre au bureau en ' + ech(libelleMois(MOIS_VU)) + '.'
      : (ARCH.length
        ? 'Tous tes devis du bureau sont déjà sur cet appareil.'
        : 'Rien reçu du bureau pour l\'instant.')) + '</div>';
    return;
  }
  z.innerHTML = l.slice(0, 200).map(function(d){
    var qui = d.client || d.contact || '—';
    return '<div class="hist"><div class="i">' +
      '<b>' + badgeArchive(d) + ech(qui) + '</b>' +
      '<span>' + ech(d.numero) + ' · ' + jjmmaa(d.date) + ' · ' + eur(d.ttc) + ' TTC' +
      (d.ville ? ' · ' + ech(d.ville) : '') +
      (d.relance ? ' · relance le ' + jjmmaa(d.relance) : '') +
      (d.motif ? ' · ' + ech(d.motif) : '') + '</span></div>' +
      '<div class="acts">' +
      '<button class="btn sec sm" onclick="ficheArchive(\'' +
        encodeURIComponent(d.numero) + '\')">Ouvrir</button>' +
      '</div></div>';
  }).join('');
}

/* ---- la fiche d'un devis du bureau ---- */
function erreurArchive(t){
  var e = $('arErr');
  if(!e) return;
  e.textContent = String(t || '');
  e.classList.toggle('hide', !t);
}

function ficheArchive(num){
  var d = archiveDe(decodeURIComponent(num));
  if(!d) return;
  ARCH_NUM = d.numero;
  erreurArchive('');
  peindreFicheArchive(d);
  $('arOverlay').classList.remove('hide');
  window.scrollTo(0,0);
}
function fermerArchive(){
  $('arOverlay').classList.add('hide');
  ARCH_NUM = '';
  erreurArchive('');
}

function peindreFicheArchive(d){
  $('arNum').textContent = d.numero;
  $('arCorps').innerHTML =
    '<div class="card">' +
      '<div style="display:flex;gap:10px;align-items:baseline">' +
        '<b style="flex:1;font-size:17px">' + ech(d.client || d.contact || '—') + '</b>' +
        badgeArchive(d) +
      '</div>' +
      '<div class="mini" style="margin-top:6px">' + jjmmaa(d.date) +
        (d.ville ? ' · ' + ech([d.cp, d.ville].filter(Boolean).join(' ')) : '') +
        (d.validite ? ' · valable jusqu\'au ' + jjmmaa(d.validite) : '') + '</div>' +
      (d.objet ? '<div class="mini">' + ech(d.objet) + '</div>' : '') +
      (d.numeroOrigine ? '<div class="mini">Avant signature : ' + ech(d.numeroOrigine) + '</div>' : '') +
      '<div class="ch" style="margin-top:10px"><span style="color:var(--mut)">Total HT</span><b>' +
        eur(d.ht) + '</b></div>' +
      (d.mensuel ? '<div class="ch"><span style="color:var(--mut)">dont mensuel HT</span><b>' +
        eur(d.mensuel) + '</b></div>' : '') +
      '<div class="ch gros"><span>Total TTC</span><span>' + eur(d.ttc) + '</span></div>' +
      (d.note ? '<div class="mini" style="margin-top:8px">Ta note : ' + ech(d.note) + '</div>' : '') +
    '</div>' +

    '<div class="card">' +
      '<h2>Le devis</h2>' +
      '<div class="mini" style="margin-top:0">' + (d.pdf
        ? 'Le PDF est archivé au bureau. Le charger permet de le lire, de l\'enregistrer ' +
          'sur cet appareil ou de le renvoyer au client.'
        : 'Aucun PDF archivé pour ce devis.') + '</div>' +
      (d.pdf ? '<button class="btn sec" style="margin-top:10px" onclick="pdfArchive(this)">' +
        'Charger le PDF</button>' : '') +
      '<button class="btn sec" style="margin-top:8px" onclick="dupliquerArchive(this)">' +
        'Dupliquer ce devis</button>' +
    '</div>' +

    blocSignatureDistance(d, 'archive') +
    '<div class="card">' +
      '<h2>Résultat du rendez-vous</h2>' +
      '<div class="mini" style="margin-top:0">Ce que tu poses ici part directement au ' +
        'bureau et remplace ce qui y était inscrit.</div>' +
      '<button class="choix" onclick="verdictArchive(\'SIGNE\')"><b>Signé</b></button>' +
      '<button class="choix" onclick="verdictArchive(\'RELANCE\')"><b>À relancer</b>' +
        '<span>Choisis la date ci-dessous.</span></button>' +
      '<button class="choix" onclick="verdictArchive(\'REFUSE\')"><b>Refusé</b>' +
        '<span>Précise la raison ci-dessous.</span></button>' +
      '<label>Date de relance</label>' +
      '<input id="arRelance" type="date" value="' + ech(d.relance || '') + '">' +
      '<label>Raison du refus</label>' +
      '<input id="arMotif" placeholder="Trop cher, concurrent…" value="' + ech(d.motif || '') + '">' +
    '</div>';
}

/* v99 — LA SIGNATURE À DISTANCE. Le client reçoit un lien personnel (par
   SMS, WhatsApp ou mail) vers une page où il lit le devis et signe au doigt.
   Le devis passe alors à SIGNE tout seul, sans que personne ne coche rien.
   Le même lien est déjà dans le mail du devis quand on l'envoie au client. */
function blocSignatureDistance(d, ou){
  var st = String(d.statut || '').toUpperCase();
  if(st === 'SIGNE' || st === 'REFUSE') return '';
  var n = ech(d.numero).replace(/'/g,'&#39;');
  return '<div class="card"><h2>Faire signer à distance</h2>' +
    '<div class="mini" style="margin-top:0">Le client reçoit le devis par e-mail avec le bouton « Signer le devis en ligne ». ' +
    'Il signe au doigt ou à la souris, le devis passe à « signé » tout seul et tu es prévenu.</div>' +
    '<button class="btn" style="margin-top:10px" onclick="envoyerLienSignature(\'' + n + '\', this)">' +
      'Envoyer le lien de signature par e-mail</button>' +
    '<div id="lienSig" class="mini" style="word-break:break-all"></div></div>';
}

/* v108f — le bureau envoie lui-même le mail (texte de Simon, PDF joint,
   bouton de signature) : plus de page mail à ouvrir. S'il manque l'adresse,
   on la demande ici et on renvoie. Le SMS et la copie restent en secours. */
function envoyerLienSignature(numero, btn, email, zid){
  zid = zid || ((btn && btn.closest && btn.closest('#blocSignature')) ? 'lienSigFin' : 'lienSig');
  var moi = session();
  if(!moi) return;
  if(!navigator.onLine) return erreur('Hors connexion : le lien part du bureau, réessaie avec du réseau.');
  occuper(btn, 'Envoi…');
  var env = {action:'lienSignature', numero:numero, envoyer:1, nom:moi.nom, code:moi.code, appareil:APPAREIL};
  if(email) env.email = email;
  poster(env).then(function(r){
    libere(btn);
    var zone = $(zid);
    if(r && r.sansEmail){
      erreur('');
      if(zone) zone.innerHTML = '<label style="margin-top:10px">E-mail du client</label>' +
        '<input id="sigMail" type="email" inputmode="email" autocomplete="off" placeholder="client@exemple.fr">' +
        '<button class="btn sm" style="margin-top:8px" onclick="envoyerLienSignature(\'' +
          ech(numero).replace(/'/g,'&#39;') + '\', this, (document.getElementById(\'sigMail\')||{}).value, \'' + zid + '\')">Envoyer</button>';
      var i = $('sigMail'); if(i) i.focus();
      return;
    }
    if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
    erreur('');
    var texte = 'Bonjour' + (r.contact ? ' ' + r.contact : '') + ', voici le devis ' + r.numero +
      ' de BREIZH BRILLANCE. Vous pouvez le lire et le signer en ligne ici : ' + r.url;
    var sms = r.tel ? 'sms:' + String(r.tel).replace(/\s+/g, '') + '?&body=' + encodeURIComponent(texte) : '';
    if(zone) zone.innerHTML = '<div class="ok" style="text-align:left;margin-top:10px"><b>E-mail envoyé à ' + ech(r.a) + '</b>' +
      '<div class="mini" style="color:inherit;opacity:.85">Devis' + (r.pdf ? ' en pièce jointe' : '') +
      ' et bouton « Signer le devis en ligne ». Tu es prévenu dès qu\'il signe.</div></div>' +
      '<div class="row" style="gap:8px;margin-top:8px">' +
        (sms ? '<a class="btn sec sm" style="flex:1;text-align:center;text-decoration:none" href="' + ech(sms) + '">Aussi par SMS</a>' : '') +
        '<button class="btn sec sm" style="flex:1" onclick="copierTexte(this, ' + ech(JSON.stringify(r.url)).replace(/"/g,'&quot;') + ')">Copier le lien</button>' +
      '</div>';
  }, function(){ libere(btn); erreur(attenteLisible()); });
}

/* L'écran de fin du devis : le même envoi, quel que soit le devis
   (particulier ou professionnel). Si le devis n'est pas encore au bureau, il
   part avec le mail de signature à son envoi. */
function signatureDistanceFin(btn){
  var e = DERNIER;
  if(!e) return;
  if(e.statut === 'envoye') return envoyerLienSignature(e.numero, btn, '', 'lienSigFin');
  var a = String(((e.mail || {}).a) || ((e.devis || {}).client || {}).email || '').trim();
  if(!a){
    var z = $('lienSigFin');
    if(z) z.innerHTML = '<label style="margin-top:10px">E-mail du client</label>' +
      '<input id="sigMail" type="email" inputmode="email" autocomplete="off" placeholder="client@exemple.fr">' +
      '<button class="btn sm" style="margin-top:8px" onclick="signatureDistanceFinMail(this)">Envoyer</button>';
    return;
  }
  signatureDistanceFinMail(btn, a);
}
function signatureDistanceFinMail(btn, a){
  var e = DERNIER;
  a = String(a || val('sigMail') || '').trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) return erreur('Adresse e-mail invalide.');
  if(e.statut === 'envoye') return envoyerLienSignature(e.numero, btn, a, 'lienSigFin');
  e.envoyerClient = true;
  e.mail = e.mail && typeof e.mail === 'object' ? e.mail : {};
  e.mail.a = a;
  DB.put(e).then(function(){
    var z = $('lienSigFin');
    if(z) z.innerHTML = '<div class="ok" style="text-align:left;margin-top:10px"><b>Le devis part à ' + ech(a) +
      '</b><div class="mini" style="color:inherit;opacity:.85">Avec le bouton « Signer le devis en ligne », dès qu\'il arrive au bureau.</div></div>';
    synchroniser(false);
  });
}
function copierTexte(btn, t){
  try{
    navigator.clipboard.writeText(t).then(function(){ btn.textContent = 'Copié'; });
  }catch(e){ prompt('Copie le lien :', t); }
}

function pdfArchive(btn){
  var d = archiveDe(ARCH_NUM);
  if(!d) return;
  if(!navigator.onLine) return erreurArchive('Hors connexion : le PDF est chez le bureau.');
  var moi = session();
  if(!moi) return;
  erreurArchive('');
  if(btn) occuper(btn, 'Chargement…');
  poster({action:'devisArchive', nom:moi.nom, code:moi.code, appareil:APPAREIL,
          numero:d.numero, pdf:1}, 60000)
    .then(function(r){
      if(btn) libere(btn);
      if(!r || !r.ok) return erreurArchive((r && r.erreur) ? String(r.erreur) : 'Le bureau n\'a pas répondu.');
      if(!r.pdf) return erreurArchive(r.erreurPdf || 'Aucun PDF archivé pour ce devis.');
      tracer('PDF DU BUREAU CHARGE', d.numero, d.numero);
      ouvrirPdf({numero: d.numero, pdf: r.pdf,
                 nomFichier: r.nomFichier || ('Devis ' + d.numero + '.pdf'),
                 devis: {numero: d.numero, signature: d.signe ? 1 : null}});
    }, function(){
      if(btn) libere(btn);
      erreurArchive('Le bureau n\'a pas répondu. Réessaie dans un instant.');
    });
}

function dupliquerArchive(btn){
  var d = archiveDe(ARCH_NUM);
  if(!d) return;
  if(!navigator.onLine) return erreurArchive('Hors connexion : les lignes sont chez le bureau.');
  var moi = session();
  if(!moi) return;
  erreurArchive('');
  if(btn) occuper(btn, 'Chargement…');
  poster({action:'devisArchive', nom:moi.nom, code:moi.code, appareil:APPAREIL,
          numero:d.numero}, 40000)
    .then(function(r){
      if(btn) libere(btn);
      if(!r || !r.ok) return erreurArchive((r && r.erreur) ? String(r.erreur) : 'Le bureau n\'a pas répondu.');
      fermerArchive();
      dupliquerEnr({
        numero: r.numero,
        devis: {client: r.client || {}, lignes: r.lignes || [], nature: r.nature,
                passages: r.passages, etatSite: r.etatSite, objet: r.objet,
                delai: r.delai, notes: r.notes}
      });
    }, function(){
      if(btn) libere(btn);
      erreurArchive('Le bureau n\'a pas répondu. Réessaie dans un instant.');
    });
}

function verdictArchive(type){
  var d = archiveDe(ARCH_NUM);
  if(!d) return;
  var moi = session();
  if(!moi) return;
  var corps = {action:'statut', nom:moi.nom, code:moi.code, appareil:APPAREIL,
               numero:d.numero, verdict:type, quand:Date.now()};
  if(type === 'RELANCE'){
    corps.relance = val('arRelance');
    if(!corps.relance) return erreurArchive('Choisis une date de relance.');
  }
  if(type === 'REFUSE'){
    corps.motif = val('arMotif');
    if(!corps.motif) return erreurArchive('Précise la raison du refus.');
  }
  if(!navigator.onLine)
    return erreurArchive('Hors connexion : un résultat ne peut pas partir maintenant.');
  erreurArchive('');
  poster(corps, 40000).then(function(r){
    if(!r || !r.ok) return erreurArchive((r && r.erreur) ? String(r.erreur) : 'Le bureau n\'a pas répondu.');
    tracer('RESULTAT ' + type, d.numero + ' — devis du bureau', d.numero);
    d.statut = type === 'SIGNE' ? 'SIGNE' : (type === 'RELANCE' ? 'A RELANCER' : 'REFUSE');
    d.signe  = (type === 'SIGNE');
    d.motif  = corps.motif || '';
    d.relance = corps.relance || '';
    /* Signer change le numéro côté bureau : on reprend le neuf, sinon la fiche
       parlerait d'un devis que le classeur ne connaît plus sous ce nom. */
    if(r.numero && r.numero !== d.numero){
      d.numeroOrigine = d.numeroOrigine || d.numero;
      d.numero = r.numero;
      ARCH_NUM = r.numero;
    }
    archiveRangee();
    peindreFicheArchive(d);
    rendreArchive();
  }, function(){
    erreurArchive('Le bureau n\'a pas répondu. Réessaie dans un instant.');
  });
}

/* ====================== LES NOTIFICATIONS ======================
   Le téléphone du salarié sonne quand le bureau lui pose un chantier. C'est
   OneSignal qui porte le message : une page web ne sait pas réveiller un
   téléphone toute seule.

   Trois choses à savoir, qui expliquent la forme de ce code :
   • Apple n'autorise les notifications web que si l'application a été ajoutée
     à l'écran d'accueil. D'où le message qui le dit, plutôt qu'un bouton qui
     ne ferait rien.
   • l'autorisation ne se demande que sur un geste : un bouton, jamais à
     l'ouverture. Un navigateur refuse sèchement une demande spontanée, et la
     refuse alors pour toujours.
   • chaque personne s'annonce sous son nom normalisé — « agent 1 ». Le
     classeur vise le même. Un seul calcul des deux côtés, sinon le message
     part dans le vide. */
var NOTIF_ETAT = '';          // '', 'absent', 'ecran', 'refus', 'eteint', 'actif'

function notifSdk(fn){
  if(!window.OneSignalDeferred) return false;
  window.OneSignalDeferred.push(fn);
  return true;
}
/* Une application ouverte depuis l'écran d'accueil, et non dans l'onglet d'un
   navigateur. Sur iPhone, c'est la condition d'Apple. */
function surEcranAccueil(){
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}
function estApplePhone(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/* L'état, en un mot, pour l'écran. */
function notifCalculer(){
  /* L'ORDRE DE CES TESTS COMPTE, et il a coûté un essai en vrai.

     Sur un iPhone ouvert dans Safari — c'est-à-dire pas depuis l'icône de
     l'écran d'accueil — `Notification` n'existe tout simplement pas. Le
     premier test attrapait donc ce cas et répondait « absent », ce qui CACHE
     la carte : le salarié ne voyait rien du tout, pas même la phrase qui lui
     dit quoi faire. Maxime s'est connecté le 29 octobre, OneSignal a bien
     enregistré sa session sous « maxime », mais sans jeton de notification —
     et aucun message n'a pu lui parvenir.

     L'iPhone passe donc en premier : sur un iPhone, « il faut l'ajouter à
     l'écran d'accueil » est toujours la bonne réponse, et elle doit se lire.

     « absent » dit que ce navigateur ne sait pas recevoir de notifications,
     pas que le SDK n'est pas encore arrivé : window.OneSignalDeferred existe
     dès le premier octet de la page, et les appels poussés dedans attendent
     sagement que le service soit là. */
  if(estApplePhone() && !surEcranAccueil()){
    NOTIF_ETAT = 'ecran';
  } else if(!('Notification' in window) || !('serviceWorker' in navigator) || !window.isSecureContext){
    NOTIF_ETAT = 'absent';
  } else if(Notification.permission === 'denied'){
    NOTIF_ETAT = 'refus';
  } else if(Notification.permission === 'granted'){
    NOTIF_ETAT = 'actif';
  } else {
    NOTIF_ETAT = 'eteint';
  }
  return NOTIF_ETAT;
}

function notifTexte(){
  switch(notifCalculer()){
    case 'absent': return 'Ce navigateur ne sait pas recevoir de notifications.';
    case 'ecran':  return 'Sur iPhone, les notifications ne marchent que depuis l\'écran ' +
                          'd\'accueil. Appuie sur le bouton Partager, puis « Sur l\'écran ' +
                          'd\'accueil » — et rouvre l\'application par son icône : le bouton ' +
                          'pour les activer apparaîtra ici.';
    case 'refus':  return 'Les notifications sont bloquées pour cette application. ' +
                          'Rouvre-les dans les réglages de ton téléphone.';
    case 'actif':  return 'Tu es prévenu dès qu\'un chantier t\'est posé.';
    default:       return 'Active les notifications pour être prévenu dès qu\'un ' +
                          'chantier t\'est posé.';
  }
}

/* Le nom sous lequel le classeur visera ce téléphone.
   Volontairement PAS normNom() : celle-ci retire tous les signes
   diacritiques par normalize('NFD'), là où normNom_ du classeur ne remplace
   qu'une liste de lettres. « PEÑA » deviendrait « pena » ici et resterait
   « peña » là-bas, et le message partirait dans le vide. On recopie donc la
   liste du classeur, lettre pour lettre : les deux côtés doivent tomber sur
   la même chaîne, toujours. */
function idNotif(nom){
  var s = String(nom == null ? '' : nom).trim().toLowerCase().replace(/\s+/g, ' ');
  return s.replace(/[àáâäã]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
          .replace(/[òóôöõ]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/[ç]/g, 'c');
}

/* À l'ouverture d'une session : on annonce qui est là, sans rien demander.
   Tant que la personne n'a pas accepté, cela ne fait rien de visible. */
/* v108g — « aucun téléphone inscrit pour la plupart des gens alors qu'ils ont
   accepté ». Le téléphone peut avoir dit oui aux notifications sans que son
   abonnement chez OneSignal soit actif (accepté avant le branchement, jeton
   perdu, application réinstallée…). À chaque ouverture, si la permission est
   donnée, on rattache l'abonnement à la personne et on le rallume ; s'il ne
   s'allume pas, la carte le dit et propose de réinscrire le téléphone. */
var NOTIF_ABO = null;        // true / false une fois vérifié, null tant qu'on ne sait pas
function brancherNotifs(){
  var moi = session();
  if(!moi || !moi.nom) return;
  notifSdk(async function(OneSignal){
    try{ await OneSignal.login(idNotif(moi.nom)); }catch(e){}
    try{
      if(window.Notification && Notification.permission === 'granted'){
        var ps = OneSignal.User && OneSignal.User.PushSubscription;
        if(ps && ps.optedIn !== true && ps.optIn) await ps.optIn();
        setTimeout(function(){
          var ok = !!(ps && ps.optedIn && ps.id);
          NOTIF_ABO = ok;
          try{ peindreNotifs(); }catch(e){}
          var cle = 'notifTrace' + isoJour();
          try{
            if(!ok || !localStorage.getItem(cle)){
              localStorage.setItem(cle, '1');
              tracer('NOTIFICATIONS ETAT', (ok ? 'abonné' : 'PAS abonné') + ' · ' + idNotif(moi.nom) +
                     (ps && ps.id ? ' · ' + String(ps.id).slice(0, 8) : '') + (ps && ps.token ? ' · jeton' : ' · sans jeton'));
            }
          }catch(e){}
        }, 4000);
      }
    }catch(e){ tracer('ERREUR NOTIFICATIONS', String(e && e.message || e)); }
  });
}
/* À la déconnexion : ce téléphone ne parle plus pour cette personne. */
function debrancherNotifs(){
  notifSdk(async function(OneSignal){
    try{ await OneSignal.logout(); }catch(e){}
  });
}

/* Le bouton. C'est le geste qui autorise la demande. */
function activerNotifs(btn, force){
  var e = notifCalculer();
  if((e === 'actif' && NOTIF_ABO !== false && !force) || e === 'absent' || e === 'ecran' || e === 'refus'){
    return peindreNotifs();
  }
  var moi = session();
  if(btn) occuper(btn, 'Demande…');
  /* Le SDK vit chez OneSignal : sans réseau il n'arrive jamais, et ce qu'on
     pousse dans le tampon n'est jamais exécuté. Sans ce filet, le bouton
     resterait à « Demande… » pour toujours. */
  var repondu = false;
  var secours = setTimeout(function(){
    if(repondu) return;
    repondu = true;
    if(btn) libere(btn);
    erreur('Le service de notifications n\'a pas répondu. Réessaie avec du réseau.');
  }, 10000);
  notifSdk(async function(OneSignal){
    try{
      await OneSignal.Notifications.requestPermission();
      if(moi && moi.nom) await OneSignal.login(idNotif(moi.nom));
      try{
        var ps2 = OneSignal.User && OneSignal.User.PushSubscription;
        if(ps2 && ps2.optedIn !== true && ps2.optIn) await ps2.optIn();
        NOTIF_ABO = ps2 ? !!ps2.optedIn : NOTIF_ABO;
      }catch(e2){}
      tracer('NOTIFICATIONS', Notification.permission);
    }catch(err){
      tracer('ERREUR NOTIFICATIONS', String(err && err.message || err));
    }
    if(repondu) return;
    repondu = true;
    clearTimeout(secours);
    if(btn) libere(btn);
    erreur('');
    peindreNotifs();
    try{ if(AD_FICHE && AD_FICHE.type === 'notifs') peindreEtatNotifs(); }catch(e3){}
  });
}

/* v108l — « fais une vérif de notification, que je puisse ajouter les notifs
   sur mon téléphone » : l'état de CE téléphone, de quoi le (ré)inscrire, et
   une notification d'essai envoyée à soi-même. */
function carteCeTelephone(){
  var e = notifCalculer();
  var etat = e === 'actif' ? (NOTIF_ABO === false ? 'ACCEPTÉES MAIS NON INSCRIT' : 'ACTIVES')
           : e === 'refus' ? 'BLOQUÉES' : e === 'absent' ? 'IMPOSSIBLES ICI' : e === 'ecran' ? 'À INSTALLER' : 'ÉTEINTES';
  var bon = e === 'actif' && NOTIF_ABO !== false;
  var b = '';
  if(e === 'eteint' || e === 'actif'){
    b += '<button class="btn sec sm" style="margin-top:10px" onclick="activerNotifs(this, true)">' +
         (e === 'eteint' ? 'Activer les notifications' : 'Réinscrire ce téléphone') + '</button>';
  }
  if(e === 'actif'){
    b += '<button class="btn sec sm" style="margin-top:8px" onclick="essaiNotif(this)">M\'envoyer une notification d\'essai</button>';
  }
  return '<div class="card" style="border-color:' + (bon ? 'var(--ok)' : 'var(--warn)') + ';margin-bottom:10px">' +
    '<div style="display:flex;gap:10px;align-items:baseline"><b style="flex:1">Ce téléphone</b>' +
    '<span class="mini">' + etat + '</span></div>' +
    '<div class="mini" style="margin-top:4px">' + ech(e === 'actif' && !bon
      ? 'Les notifications sont acceptées, mais le téléphone n\'est pas inscrit au service : appuie sur « Réinscrire ce téléphone ».'
      : e === 'absent'
      ? 'Ce navigateur ne sait pas recevoir de notifications. Ouvre l\'application dans Chrome (Android) ou depuis son icône sur l\'écran d\'accueil (iPhone).'
      : notifTexte()) + '</div>' +
    '<div class="mini" id="essaiNotifRep" style="margin-top:6px"></div>' + b + '</div>';
}
function essaiNotif(btn){
  var moi = session(); if(!moi) return;
  occuper(btn, 'Envoi…');
  poster({action:'essaiNotif', nom:moi.nom, code:moi.code, appareil:APPAREIL}, 30000).then(function(r){
    libere(btn);
    var z = $('essaiNotifRep'); if(!z) return;
    z.innerHTML = r && r.envoye
      ? '<span style="color:var(--ok)">Notification envoyée : elle doit arriver d\'ici quelques secondes.</span>'
      : '<span style="color:var(--warn)">' + ech(r && r.aucun
          ? 'Le service ne connaît aucun téléphone inscrit à ton nom : appuie sur « Réinscrire ce téléphone », puis réessaie.'
          : 'Pas partie : ' + ((r && (r.erreur || '')) || 'réponse vide')) + '</span>';
  }, function(){
    libere(btn);
    var z = $('essaiNotifRep'); if(z) z.textContent = attenteLisible();
  });
}

/* La carte, posée sur le planning du salarié et sur le tableau du gérant. */
function peindreNotifs(){
  /* v99 — le gérant a aussi sa zone (devis signé en ligne, etc.), en haut du
     tableau, qui disparaît une fois les notifications actives. */
  var za = $('notifZoneAd');
  var perdu = NOTIF_ABO === false;   // permission donnée, mais pas d'abonnement chez OneSignal
  if(za){
    var ea = notifCalculer();
    za.classList.toggle('hide', (ea === 'actif' && !perdu) || ea === 'absent');
    if(ea === 'actif' && perdu){
      za.innerHTML = '<b>Notifications</b><div class="mini" style="margin-top:4px">Ce téléphone a accepté les notifications, ' +
        'mais il n\'est pas inscrit au service : rien ne lui arrive.</div>' +
        '<button class="btn sec sm" style="margin-top:10px" onclick="activerNotifs(this)">Réinscrire ce téléphone</button>';
    } else if(ea !== 'actif' && ea !== 'absent'){
      za.innerHTML = '<b>Notifications</b><div class="mini" style="margin-top:4px">' + ech(notifTexte()) + '</div>' +
        (ea === 'eteint' ? '<button class="btn sec sm" style="margin-top:10px" onclick="activerNotifs(this)">' +
                           'Activer les notifications</button>' : '');
    }
  }
  var z = $('notifZone');
  if(!z) return;
  var e = notifCalculer();
  var bouton = (e === 'eteint')
    ? '<button class="btn sec sm" style="margin-top:10px" onclick="activerNotifs(this)">' +
      'Activer les notifications</button>'
    : (e === 'actif' && perdu)
    ? '<div class="mini" style="margin-top:6px;color:var(--warn)">Ce téléphone n\'est pas inscrit au service : rien ne lui arrive.</div>' +
      '<button class="btn sec sm" style="margin-top:8px" onclick="activerNotifs(this)">Réinscrire ce téléphone</button>'
    : '';
  z.innerHTML =
    '<div style="display:flex;gap:10px;align-items:baseline">' +
      '<b style="flex:1">Notifications</b>' +
      '<span class="vb ' + (e === 'actif' ? 'vb-s' : e === 'refus' ? 'vb-x' : 'vb-a') + '">' +
        (e === 'actif' ? 'ACTIVES' : e === 'refus' ? 'BLOQUÉES' : 'ÉTEINTES') + '</span>' +
    '</div>' +
    '<div class="mini" style="margin-top:4px">' + ech(notifTexte()) + '</div>' + bouton +
    (e === 'actif' && !perdu ? '<div class="mini" id="essaiNotifRep" style="margin-top:6px"></div>' +
      '<button class="btn sec sm" style="margin-top:8px" onclick="essaiNotif(this)">M\'envoyer une notification d\'essai</button>' : '');
  z.classList.toggle('hide', e === 'absent');
}

/* ====================== LA SEMAINE ======================
   Le planning s'est toujours lu en liste : ce qui vient, du plus proche au
   plus lointain. C'est le bon outil pour savoir où l'on va demain matin, mais
   pas pour voir si la semaine tient debout — une journée vide, une autre à
   quatre chantiers, un agent chargé et l'autre non. D'où cette vue : sept
   colonnes, une par jour, les chantiers empilés dedans, colorés par nature.
   Sur un téléphone les sept colonnes ne tiennent pas de front : on les fait
   glisser, et chacune se cale sous le doigt. */
var SEM_LUNDI = '';           // le lundi regardé ; vide = la semaine en cours
var SEM_VUE = false;          // le gérant regarde-t-il la semaine ?
var AG_SEM = false;           // et le salarié ?
var SEM_JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

/* Le lundi de la semaine qui contient ce jour. Dimanche appartient à la
   semaine qui s'achève, pas à celle qui commence. */
function lundiDe(iso){
  var d = iso ? new Date(iso + 'T12:00:00') : new Date();
  if(isNaN(d.getTime())) d = new Date();
  d.setHours(12,0,0,0);
  var j = d.getDay();                       // 0 = dimanche
  d.setDate(d.getDate() - ((j + 6) % 7));
  return isoJour(d);
}
function semaineVue(){ return SEM_LUNDI || lundiDe(); }
function joursDe(lundi){
  var out = [], d = new Date(lundi + 'T12:00:00');
  for(var i = 0; i < 7; i++){
    out.push(isoJour(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
/* « 13 — 19 octobre 2026 », ou « 29 septembre — 5 octobre 2026 » à cheval. */
function libelleSemaine(lundi){
  var j = joursDe(lundi);
  var a = new Date(j[0] + 'T12:00:00'), b = new Date(j[6] + 'T12:00:00');
  var mA = a.toLocaleDateString('fr-FR', {month:'long'});
  var mB = b.toLocaleDateString('fr-FR', {month:'long'});
  var an = b.getFullYear();
  if(mA === mB && a.getFullYear() === an) return a.getDate() + ' — ' + b.getDate() + ' ' + mB + ' ' + an;
  if(a.getFullYear() === an) return a.getDate() + ' ' + mA + ' — ' + b.getDate() + ' ' + mB + ' ' + an;
  return a.getDate() + ' ' + mA + ' ' + a.getFullYear() + ' — ' + b.getDate() + ' ' + mB + ' ' + an;
}

/* Le rendu, commun au gérant et au salarié : ce sont les mêmes chantiers, vus
   d'un côté ou de l'autre. « surClic » est le nom de la fonction à appeler
   avec l'identifiant — chacun ouvre sa propre fiche. */
function semaineHtml(chantiers, surClic, glisser){
  var lundi = semaineVue(), jours = joursDe(lundi), auj = isoJour();
  var par = {};
  jours.forEach(function(j){ par[j] = []; });
  (chantiers || []).forEach(function(c){
    var d = String(c.date || '').slice(0,10);
    if(par[d]) par[d].push(c);
  });
  jours.forEach(function(j){
    par[j].sort(function(a,b){
      var ha = String(a.heure || '99:99'), hb = String(b.heure || '99:99');
      return ha < hb ? -1 : (ha > hb ? 1 : 0);
    });
  });

  var total = jours.reduce(function(n, j){ return n + par[j].length; }, 0);

  var h = '<div class="semBarre">' +
    '<button class="btn sec sm" onclick="semaineBouger(-1)">◀</button>' +
    '<button class="btn sec sm semTitre" onclick="semaineBouger(0)">' +
      ech(libelleSemaine(lundi)) + '</button>' +
    '<button class="btn sec sm" onclick="semaineBouger(1)">▶</button>' +
    '</div>';

  h += '<div class="mini semCompte">' + (total
    ? total + ' chantier' + (total > 1 ? 's' : '') + ' cette semaine'
    : 'Aucun chantier cette semaine') + '</div>';

  h += '<div class="sem">';
  jours.forEach(function(j, i){
    var d = new Date(j + 'T12:00:00');
    var liste = par[j];
    h += '<div class="semJ' + (j === auj ? ' semAuj' : '') +
         (liste.length ? '' : ' semVide') + '"' +
         (glisser ? ' data-jour="' + ech(j) + '"' : '') + '>' +
         '<div class="semTete"><b>' + SEM_JOURS[i].slice(0,3) + '</b>' +
         '<span>' + d.getDate() + '</span>' +
         (nomFerie(j) ? '<em class="semFer">Férié · ' + ech(nomFerie(j)) + '</em>' : '') + etiquetteConge(j, 'semAbs', true) + '</div>';
    if(!liste.length){
      h += '<div class="semRien">—</div>';
    } else {
      liste.forEach(function(c){
        var n = natureVue(c.nature);
        h += '<button class="semEv" ' +
             (glisser ? 'data-ch="' + ech(String(c.id)) + '" ' : '') +
             (n ? 'style="--nT:' + n.t + ';--nF:' + n.f + ';--nI:' + n.i + '"' : '') +
             ' onclick="' + surClic + '(\'' + ech(String(c.id)).replace(/'/g,'&#39;') + '\')">' +
             (c.heure ? '<b>' + ech(c.heure) + '</b>' : '') +
             '<span>' + ech(c.client || 'Chantier') + '</span>' +
             (c.ville ? '<em>' + ech(c.ville) + '</em>' : '') +
             (c.prestataire ? '<em>' + ech(quiLisible(c.prestataire)) + '</em>' : '') +
             '</button>';
      });
    }
    h += '</div>';
  });
  h += '</div>';
  return h;
}

/* -1 semaine, +1 semaine, ou 0 pour revenir à celle d'aujourd'hui. */
function semaineBouger(n){
  if(!n){ SEM_LUNDI = ''; }
  else {
    var d = new Date(semaineVue() + 'T12:00:00');
    d.setDate(d.getDate() + 7 * n);
    SEM_LUNDI = isoJour(d);
  }
  if(ECRAN_VU === 'eAg1') peindrePlanning(); else peindreTableau();
}

/* La bascule liste ↔ semaine. Le choix ne voyage pas d'un écran à l'autre :
   le gérant et le salarié ne regardent pas la même chose. */
function basculerSemaine(qui){
  if(qui === 'agent'){ AG_SEM = !AG_SEM; SEM_LUNDI = ''; peindrePlanning(); }
  else vueChantiers(SEM_VUE ? 'liste' : 'semaine');
}

/* ====================== AUJOURD'HUI ======================
   Demande de Simon, 8 novembre 2026 : « je ne trouve pas l'appli très simple
   de compréhension ». Le tableau s'ouvre désormais sur une seule question :
   qu'est-ce qui se passe aujourd'hui, et qu'est-ce qui m'attend ?

   En haut, la liste « À traiter » : chaque ligne est un nombre, une phrase
   en mots de tous les jours, et un appui qui mène à l'endroit où l'on règle
   la chose. Rien à traiter : on le dit, et on passe à la journée.
   Puis la journée, personne par personne, dans l'ordre des heures ; puis
   demain, pour préparer. */
function dateLongue(iso){
  var s = jourDe(iso).toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function allerPlanning(vue, qui){
  AD_ONGLET = 'chantiers';
  try{ ls('adOnglet3', 'chantiers'); }catch(e){}
  AD_VUE = vue || 'mois'; SEM_VUE = (AD_VUE === 'semaine');
  try{ ls('adVue', AD_VUE); }catch(e){}
  AD_QUI = qui || '';
  peindreTableau(); window.scrollTo(0,0);
}
function allerDevis(){ ongletAdmin('devis'); window.scrollTo(0,0); }

function taches(t){
  t = sansIgnores(t);
  /* v106 — « Tout effacer et repartir de zéro » vide vraiment la liste :
     chaque élément a sa clé (« ferie:CH-0251 », « contrat:DEV-… »…), la
     remise à zéro les met toutes de côté, et seuls les éléments apparus
     ensuite s'affichent. */
  var ign = {};
  ((t.aFaireIgnores && t.aFaireIgnores.cles) || []).forEach(function(k){ ign[k] = 1; });
  var auj = isoJour(), hier = isoJour(new Date(Date.now() - 86400000));
  var ch = (t.chantiers||[]).filter(function(c){ return !estAnnule(c); });
  var st = function(c){ return String(c.statut||'').toUpperCase(); };
  var l = [];
  var ajout = function(type, liste, cle, texte, go, ton){
    var restes = liste.filter(function(x){ return !ign[type + ':' + cle(x)]; });
    if(!restes.length) return;
    var n = restes.length;
    l.push({ n:n, mot: typeof texte === 'function' ? texte(n, restes) : texte, go:go, ton:ton,
             cles: restes.map(function(x){ return type + ':' + cle(x); }) });
  };
  var id = function(c){ return c.id; };
  var pl = function(n, un, plu){ return n > 1 ? plu : un; };
  ajout('placer', ch.filter(function(c){ return !c.date; }), id,
    function(n){ return pl(n,'intervention','interventions') + ' à placer dans le planning'; }, "allerAPlacer()", 'warn');
  ajout('sansqui', ch.filter(function(c){ return c.date && c.date >= auj && !c.prestataire; }), id,
    function(n){ return pl(n,'intervention','interventions') + ' sans personne pour la faire'; }, "allerAPlacer()", 'warn');
  ajout('oubli', ch.filter(function(c){ return c.date && c.date.slice(0,10) === hier && st(c) !== 'FAIT'; }), id,
    function(n){ return pl(n,'intervention d\'hier pas pointée','interventions d\'hier pas pointées') + ' (faite ou pas ?)'; }, "allerPlanning('liste')", 'danger');
  ajout('souci', ch.filter(function(c){ return st(c) === 'PROBLEME' || String(c.signalement||'').trim(); })
    .filter(function(c){ return !c.date || c.date >= isoJour(new Date(Date.now() - 7*86400000)); }), id,
    function(n){ return pl(n,'problème signalé','problèmes signalés') + ' par l\'équipe cette semaine'; }, "allerPlanning('liste')", 'danger');
  var ech45 = isoJour(new Date(Date.now() + 45*86400000));
  ajout('echeance', (t.recurrents || []).filter(function(s){
    return s.actif && s.fin && s.fin >= auj && s.fin <= ech45 && s.reconduction !== 'TACITE';
  }), function(s){ return s.id + '|' + s.fin; },
    function(n){ return pl(n,'contrat arrive','contrats arrivent') + ' à échéance dans moins de 45 jours (renouveler ?)'; }, 'listeContrats()', 'warn');
  /* v105 — les fériés restent au planning : Simon appelle lui-même les clients. */
  ajout('ferie', ch.filter(function(c){
    return c.date && c.date.slice(0,10) >= auj && st(c) !== 'FAIT' && nomFerie(c.date.slice(0,10));
  }), function(c){ return c.id + '|' + c.date.slice(0,10); },
    function(n){ return pl(n,'intervention','interventions') + ' un jour férié (appeler le client pour décaler)'; }, 'listeFeries()', 'warn');
  /* v104 — une intervention posée pendant un congé de celui qui la fait. */
  ajout('conge', ch.filter(function(c){
    return c.date && c.date.slice(0,10) >= auj && st(c) !== 'FAIT' && absentsDe(c.date.slice(0,10), c.prestataire, t).length;
  }), function(c){ return c.id + '|' + c.date.slice(0,10) + '|' + c.prestataire; },
    function(n){ return pl(n,'intervention','interventions') + ' pendant un congé (à replacer ou à confier)'; }, 'listeConges()', 'danger');
  /* v104 — préavis de 3 mois avant l'échéance des contrats tacites. */
  var d90 = isoJour(new Date(Date.now() + 90*86400000)), d120 = isoJour(new Date(Date.now() + 120*86400000));
  var preavis = {}, lp = [];
  (t.recurrents || []).forEach(function(s){
    var k = String(s.client).split(' — ')[0] + '|' + s.fin;
    if(s.actif && s.fin && s.reconduction === 'TACITE' && s.fin > d90 && s.fin <= d120 && !preavis[k]){ preavis[k] = 1; lp.push(k); }
  });
  ajout('preavis', lp, function(k){ return k; },
    function(n){ return pl(n,'contrat','contrats') + ' à moins de 4 mois de l\'échéance annuelle (préavis de 3 mois : révision de prix ?)'; }, 'listeContrats()', '');
  var dv = t.devis || [];
  /* v106 — un contrat signé = UNE ligne « à mettre au calendrier » : un appui
     ouvre le devis, « Mettre au calendrier comme contrat » propose le rythme
     du devis, Simon confirme. */
  /* Un devis au nom de la maison (« BREIZH BRILLANCE ») est un essai : il ne
     se met jamais au calendrier, il n'a rien à faire ici. */
  dv.filter(function(d){ return d.recurrent && d.statut === 'SIGNE' && !d.contrat &&
                                !/^BREIZH\s*BRILLANCE$/i.test(String(d.client||'').trim()); }).forEach(function(d){
    ajout('contrat', [d], function(x){ return x.numero; }, 'contrat signé à mettre au calendrier : ' + (d.client || d.numero),
      'ficheDevis(\'' + String(d.numero).replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\')', 'warn');
  });
  ajout('aposer', dv.filter(function(d){ return d.statut === 'SIGNE' && !d.recurrent && Number(d.aPoser||0) > 0; }),
    function(d){ return d.numero; },
    function(n){ return pl(n,'devis signé','devis signés') + ' dont le travail n\'est pas planifié'; }, 'allerDevis()', 'warn');
  /* Un devis à relancer : envoyé il y a 10 à 30 jours, sans réponse. */
  var de = isoJour(new Date(Date.now() - 30*86400000)), a = isoJour(new Date(Date.now() - 10*86400000));
  ajout('relance', dv.filter(function(d){
    var s = String(d.statut||'').toUpperCase(), j = String(d.date||'').slice(0,10);
    return s !== 'SIGNE' && s !== 'REFUSE' && j && j >= de && j <= a &&
           !/^BREIZH\s*BRILLANCE$/i.test(String(d.client||'').trim());
  }), function(d){ return d.numero; },
    function(n){ return 'devis à relancer (envoyé' + (n>1?'s':'') + ' il y a 10 à 30 jours, sans réponse)'; }, 'allerDevis()', '');
  /* v108 — les éléments de paie, du 26 au 3 du mois suivant. */
  var jm = new Date().getDate();
  if(estAdmin() && (jm >= 26 || jm <= 3)){
    var mp = jm >= 26 ? isoJour().slice(0, 7) : isoJour(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)).slice(0, 7);
    ajout('paie', [mp], function(x){ return x; }, 'éléments de paie de ' + nomMois(mp) + ' à envoyer au comptable', 'ficheAdministratif(\'' + mp + '\')', '');
  }
  return l;
}
function jjmm(iso){ var p = String(iso||'').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : iso; }

function ligneJournee(c){
  var s = String(c.statut||'').toUpperCase(), n = natureVue(c.nature);
  var etat = s === 'FAIT' ? '<span class="acEt acOk">fait</span>'
           : s === 'EN COURS' ? '<span class="acEt acEnc">en cours</span>'
           : s === 'PROBLEME' ? '<span class="acEt acPb">problème</span>' : '';
  return '<button class="acLigne" onclick="ficheChantier(\'' + ech(String(c.id)).replace(/'/g,'&#39;') + '\')"' +
    (n ? ' style="--nT:' + n.t + '"' : '') + '>' +
    '<span class="acH">' + ech(c.heure ? String(c.heure).replace(':','h') : '—') + '</span>' +
    '<span class="acC"><b>' + ech(c.client || 'Intervention') + '</b>' +
    '<i>' + ech([c.ville, n ? n.nom : ''].filter(String).join(' · ')) + '</i></span>' + etat + '</button>';
}

function journeeParPersonne(liste, compact){
  if(!liste.length) return '<div class="mini acVide">Rien de prévu.</div>';
  var par = {}, ordre = [];
  liste.forEach(function(c){
    var k = c.prestataire ? quiLisible(c.prestataire) : 'Personne n\'est affecté';
    if(!par[k]){ par[k] = []; ordre.push(k); }
    par[k].push(c);
  });
  ordre.sort(function(a, b){ return a.localeCompare(b); });
  return ordre.map(function(k){
    var l = par[k].sort(function(a, b){ return String(a.heure||'99') < String(b.heure||'99') ? -1 : 1; });
    return '<div class="card acPers">' +
      '<div class="acNom"><b>' + ech(k) + '</b><span class="mini">' + l.length + ' intervention' +
      (l.length>1?'s':'') + '</span></div>' +
      (compact ? '<div class="mini">' + l.map(function(c){
          return ech((c.heure ? String(c.heure).replace(':','h') + ' ' : '') + (c.client||''));
        }).join(' · ') + '</div>'
        : l.map(ligneJournee).join('')) + '</div>';
  }).join('');
}

function accueilHtml(t){
  var auj = isoJour(), dem = isoJour(new Date(Date.now() + 86400000));
  var ch = (t.chantiers||[]).filter(function(c){ return !estAnnule(c); });
  var duJour = ch.filter(function(c){ return String(c.date||'').slice(0,10) === auj; });
  var deDemain = ch.filter(function(c){ return String(c.date||'').slice(0,10) === dem; });
  var faits = duJour.filter(function(c){ return String(c.statut||'').toUpperCase() === 'FAIT'; }).length;
  var l = taches(t);
  /* v100 — « juste ce qu'il y a à faire » : la liste, rien d'autre. La
     journée se lit dans le Planning. */
  var h = '<h3 class="acTitre">À faire</h3>';
  h += l.length ? '<div class="card acTaches">' + l.map(function(x){
      return '<button class="acTache' + (x.ton ? ' ac-' + x.ton : '') + '" onclick="' + x.go + '">' +
        '<b>' + x.n + '</b><span>' + ech(x.mot) + '</span><i aria-hidden="true">›</i></button>';
    }).join('') + '</div>'
    : '<div class="card acRien">Rien en attente. Tout est à jour.</div>';
  h += aPlacerHtml(t);
  var ig = t && t.aFaireIgnores;
  h += '<div class="mini" style="text-align:center;margin:14px 0 4px">' +
    (ig && ig.quand ? 'Liste repartie de zéro le ' + ech(quandLisible(ig.quand)) + '. ' : '') +
    '<button class="lienTexte" onclick="remiseAFaire(this)">Tout effacer et repartir de zéro</button></div>';
  /* v106 — les onglets du haut sont devenus la barre du bas ; le répertoire
     des clients reste à un appui d'ici. */
  if(estAdmin()) h += chiffresTableauHtml();
  if(estAdmin()) h += '<button class="btn sec" style="margin-top:8px" onclick="barreAdmin(\'clients\')">Répertoire des clients</button>' +
    '<button class="btn sec" style="margin-top:8px" onclick="ficheAdministratif()">Éléments de paie du mois</button>' +
    '<button class="btn sec" style="margin-top:8px" onclick="ficheNotifs()">Notifications : ce téléphone et l\'équipe</button>';
  return h;
}

/* v100 — « ne mets pas les trucs à planifier sur le Planning, laisse-les dans
   À faire ». Les interventions sans date, ou datées mais sans personne, sont
   ici ; un appui ouvre la fiche avec les créneaux proposés. */
function aPlacerListe(t){
  t = sansIgnores(t);
  var auj = isoJour();
  return ((t && t.chantiers) || []).filter(function(c){
    if(estAnnule(c)) return false;
    if(!c.date) return true;
    return !c.prestataire && String(c.date).slice(0,10) >= auj;
  }).sort(function(a, b){
    if(!a.date !== !b.date) return a.date ? 1 : -1;
    return String(a.date || '') < String(b.date || '') ? -1 : 1;
  });
}
function aPlacerHtml(t){
  /* v106 — la liste « À placer » de l'accueil suit aussi « Tout effacer » (elle
     restait affichée en entier, d'où l'impression que rien n'était effacé).
     Le bac du Planning, lui, garde tout. */
  var ign = {};
  ((t && t.aFaireIgnores && t.aFaireIgnores.cles) || []).forEach(function(k){ ign[k] = 1; });
  var l = aPlacerListe(t).filter(function(c){ return !ign['placer:' + c.id] && !ign['sansqui:' + c.id]; });
  if(!l.length) return '<div id="acPlacer"></div>';
  return '<h3 class="acTitre" id="acPlacer">À placer <span class="mini">· touche pour voir les créneaux proposés</span></h3>' +
    '<div class="card">' + l.slice(0, 80).map(function(c){
      var n = natureVue(c.nature);
      return '<button class="calEv calBacEv" style="display:block;width:100%;text-align:left;margin:0 0 6px;' +
        (n ? '--nT:' + n.t + ';--nF:' + n.f + ';--nI:' + n.i : '') + '" ' +
        'onclick="ficheChantier(\'' + ech(String(c.id)).replace(/'/g,'&#39;') + '\')">' +
        '<b>' + ech(c.client || 'Intervention') + '</b>' + (c.ville ? ' · ' + ech(c.ville) : '') +
        '<span class="mini" style="display:block">' +
        (c.date ? jourLisible(String(c.date).slice(0,10)) + ' · personne'
                : (c.ferie && c.ferie.nom ? 'férié (' + ech(c.ferie.nom) + ', ' + ech(jourLisible(c.ferie.date)) + ') · à replacer'
                                          : 'sans date')) +
        (c.numero ? ' · devis ' + ech(c.numero) : '') + '</span></button>';
    }).join('') + '</div>';
}
function allerAPlacer(){
  ongletAdmin('aujourdhui');
  setTimeout(function(){ var e = $('acPlacer'); if(e) e.scrollIntoView({behavior:'smooth', block:'start'}); }, 60);
}

/* ====================== LE MOIS ======================
   Demande de Simon, 7 novembre 2026 : « dans Chantiers je veux une vue
   mensuelle du calendrier en plus », et sur le tableau « une vue du
   calendrier où je peux directement y avoir accès et en placer si besoin ».

   La grille d'un agenda de poche, lundi en tête : six semaines au plus, et
   dans chaque case les chantiers du jour en petites barres de la couleur de
   leur nature. Une case est trop petite pour qu'on y vise une barre du doigt :
   un appui sur la case ouvre la journée sous la grille, en cartes entières,
   avec de quoi y poser un chantier neuf. Un appui long sur une barre la
   décolle, comme dans la semaine, et on la lâche sur un autre jour.

   Au-dessus, le bac « à placer » : les chantiers qui n'ont pas encore de
   date. On les fait glisser sur leur jour — c'est tout le geste. */
var CAL_MOIS = '';            // « 2026-11 » ; vide = le mois en cours
var CAL_JOUR = '';            // la journée ouverte sous la grille
var AD_VUE = (function(){       // l'onglet Chantiers : liste, semaine ou mois
  var v = ls('adVue');
  return (v === 'semaine' || v === 'liste') ? v : 'mois';     // v95 : le mois d'abord
})();
SEM_VUE = (AD_VUE === 'semaine');
var CAL_PAR_CASE = 3;         // barres montrées dans une case avant « +n »

function moisVu(){ return CAL_MOIS || isoJour().slice(0,7); }
function libelleMoisCal(p){
  var a = Number(p.slice(0,4)), m = Number(p.slice(5,7));
  var s = new Date(a, m-1, 1, 12).toLocaleDateString('fr-FR', {month:'long', year:'numeric'});
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function moisBouger(n){
  if(!n){ CAL_MOIS = ''; CAL_JOUR = isoJour(); }
  else {
    var p = moisVu(), d = new Date(Number(p.slice(0,4)), Number(p.slice(5,7)) - 1 + n, 1, 12);
    CAL_MOIS = isoJour(d).slice(0,7);
    CAL_JOUR = '';
  }
  peindreTableau();
}
function calChoisir(iso){
  CAL_JOUR = (CAL_JOUR === iso) ? '' : iso;
  peindreTableau();
  if(CAL_JOUR){
    var z = $('calJourne');
    if(z && z.scrollIntoView) setTimeout(function(){ z.scrollIntoView({behavior:'smooth', block:'nearest'}); }, 30);
  }
}

/* Les chantiers du tableau qu'on montre dans le calendrier : vivants, et
   filtrés par la pastille du prestataire choisi. */
function chantiersDuCalendrier(t){
  return (t.chantiers||[]).filter(function(c){
    if(estAnnule(c)) return false;
    if(!AD_QUI) return true;
    if(AD_QUI === '(non affectés)') return !c.prestataire || !c.date;
    if(AD_QUI === '(annulés)') return false;
    return aQui(c.prestataire, AD_QUI);
  });
}

/* v101 — les jours fériés de métropole, calculés ici comme au classeur
   (Pâques par Meeus) : le planning les montre, et « À placer » dit quand un
   passage y a été mis parce qu'il tombait un férié. */
var FERIES_CACHE = {};
function feriesAn(an){
  if(FERIES_CACHE[an]) return FERIES_CACHE[an];
  var a = an % 19, b = Math.floor(an / 100), c = an % 100;
  var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  var t = {};
  var fixe = function(mm, jj, nom){ t[isoJour(new Date(an, mm - 1, jj, 12))] = nom; };
  var mobile = function(dec, nom){ var x = new Date(an, mois - 1, jour, 12); x.setDate(x.getDate() + dec); t[isoJour(x)] = nom; };
  fixe(1, 1, 'Jour de l\'an'); mobile(1, 'Lundi de Pâques'); fixe(5, 1, 'Fête du travail');
  fixe(5, 8, 'Victoire 1945'); mobile(39, 'Ascension'); mobile(50, 'Lundi de Pentecôte');
  fixe(7, 14, 'Fête nationale'); fixe(8, 15, 'Assomption'); fixe(11, 1, 'Toussaint');
  fixe(11, 11, 'Armistice 1918'); fixe(12, 25, 'Noël');
  return (FERIES_CACHE[an] = t);
}
function nomFerie(iso){
  iso = String(iso || '').slice(0, 10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  return feriesAn(Number(iso.slice(0, 4)))[iso] || '';
}

function moisHtml(chantiers, avecBac){
  var p = moisVu(), auj = isoJour();
  var premier = p + '-01';
  var lundi = lundiDe(premier);
  var a = Number(p.slice(0,4)), m = Number(p.slice(5,7));
  var dernier = isoJour(new Date(a, m, 0, 12));
  var par = {}, nbMois = 0;
  (chantiers || []).forEach(function(c){
    var d = String(c.date || '').slice(0,10);
    if(!d) return;
    (par[d] = par[d] || []).push(c);
    if(d.slice(0,7) === p) nbMois++;
  });
  for(var k in par) if(par.hasOwnProperty(k)) par[k].sort(function(x, y){
    var hx = String(x.heure || '99:99'), hy = String(y.heure || '99:99');
    return hx < hy ? -1 : (hx > hy ? 1 : 0);
  });

  var h = '';
  if(avecBac) h += bacAPlacer(chantiers);

  h += '<div class="semBarre">' +
    '<button class="btn sec sm" onclick="moisBouger(-1)" aria-label="Mois précédent">◀</button>' +
    '<button class="btn sec sm semTitre" onclick="moisBouger(0)">' + ech(libelleMoisCal(p)) + '</button>' +
    '<button class="btn sec sm" onclick="moisBouger(1)" aria-label="Mois suivant">▶</button>' +
    '</div>';
  h += '<div class="mini semCompte">' + (nbMois
    ? nbMois + ' chantier' + (nbMois > 1 ? 's' : '') + ' ce mois-ci · appuie sur un jour pour l\'ouvrir'
    : 'Aucun chantier ce mois-ci · appuie sur un jour pour y en poser un') + '</div>';

  h += '<div class="cal"><div class="calTete">' +
    ['lun','mar','mer','jeu','ven','sam','dim'].map(function(j){ return '<span>' + j + '</span>'; }).join('') +
    '</div><div class="calGrille">';
  var d = new Date(lundi + 'T12:00:00');
  for(var i = 0; i < 42; i++){
    var iso = isoJour(d);
    if(i % 7 === 0 && i >= 28 && iso > dernier) break;   // la sixième semaine n'existe pas toujours
    var dehors = iso.slice(0,7) !== p;
    var l = par[iso] || [];
    var fer = nomFerie(iso);
    h += '<div class="calJ' + (dehors ? ' calHors' : '') + (iso === auj ? ' calAuj' : '') +
         (fer ? ' calFer' : '') +
         (iso === CAL_JOUR ? ' calOn' : '') + '" data-jour="' + iso + '" role="button" tabindex="0" ' +
         'aria-label="' + ech(jourLisible(iso)) + (fer ? ', férié' : '') + ', ' + l.length + ' chantier' + (l.length > 1 ? 's' : '') + '" ' +
         'onclick="calChoisir(\'' + iso + '\')"><b class="calN">' + d.getDate() + '</b>' +
         (fer ? '<span class="calFerL" title="' + ech(fer) + '">Férié</span>' : '') + etiquetteConge(iso, 'calAbsL');
    l.slice(0, CAL_PAR_CASE).forEach(function(c){
      var n = natureVue(c.nature);
      h += '<span class="calEv" data-ch="' + ech(String(c.id)) + '"' +
           (n ? ' style="--nT:' + n.t + ';--nF:' + n.f + ';--nI:' + n.i + '"' : '') + '>' +
           (c.heure ? '<i>' + ech(String(c.heure).replace(':00','h').replace(':','h')) + '</i> ' : '') +
           ech(c.client || 'Chantier') + '</span>';
    });
    if(l.length > CAL_PAR_CASE) h += '<span class="calPlus">+' + (l.length - CAL_PAR_CASE) + '</span>';
    h += '</div>';
    d.setDate(d.getDate() + 1);
  }
  h += '</div></div>';

  if(CAL_JOUR) h += journeeHtml(CAL_JOUR, par[CAL_JOUR] || []);
  return h;
}

/* Le bac : ce qui n'a pas de date. Les barres se décollent d'un appui long
   et se lâchent sur une case ; un appui court ouvre la fiche, pour qui
   préfère choisir la date au clavier. */
function bacAPlacer(chantiers){
  var l = (chantiers || []).filter(function(c){ return !c.date; });
  if(!l.length) return '';
  var h = '<div class="card calBac"><div style="display:flex;align-items:baseline;gap:8px">' +
    '<b style="flex:1">' + l.length + ' à placer</b>' +
    '<span class="mini">appui long, puis lâcher sur un jour</span></div><div class="calBacL">';
  l.slice(0, 40).forEach(function(c){
    var n = natureVue(c.nature);
    h += '<button class="calEv calBacEv" data-ch="' + ech(String(c.id)) + '"' +
         (n ? ' style="--nT:' + n.t + ';--nF:' + n.f + ';--nI:' + n.i + '"' : '') +
         ' onclick="ficheChantier(\'' + ech(String(c.id)).replace(/'/g,'&#39;') + '\')">' +
         ech(c.client || 'Chantier') + (c.ville ? ' · ' + ech(c.ville) : '') + '</button>';
  });
  if(l.length > 40) h += '<span class="mini">… et ' + (l.length - 40) + ' autres dans la liste</span>';
  return h + '</div></div>';
}

/* La journée ouverte : ses chantiers en cartes entières, et de quoi en poser
   un ce jour-là. */
function journeeHtml(iso, l){
  var h = '<div class="card calJourne" id="calJourne" data-jour="' + iso + '">' +
    '<div style="display:flex;align-items:baseline;gap:8px">' +
    '<b style="flex:1;font-size:16px">' + ech(jourLisible(iso)) +
      (nomFerie(iso) ? ' <span class="calFerL">Férié · ' + ech(nomFerie(iso)) + '</span>' : '') + etiquetteConge(iso, 'calAbsL', true) + '</b>' +
    '<span class="mini">' + (l.length ? l.length + ' chantier' + (l.length > 1 ? 's' : '') : 'rien de prévu') +
    '</span></div>' +
    '<div class="row" style="gap:8px;margin-top:10px">' +
    '<button class="btn sm" style="flex:1" onclick="nouveauChantier(\'' + iso + '\')">+ Nouveau ce jour</button>' +
    '<button class="btn sec sm" style="flex:1" onclick="semaineDuJour(\'' + iso + '\')">Voir la semaine</button>' +
    '</div></div>';
  l.forEach(function(c){ h += carteChantierAdmin(c); });
  return h;
}

/* De la case d'un jour à la semaine qui le contient. */
function semaineDuJour(iso){
  AD_ONGLET = 'chantiers';
  AD_VUE = 'semaine'; SEM_VUE = true;
  SEM_LUNDI = lundiDe(iso);
  try{ ls('adOnglet', 'chantiers'); ls('adVue', 'semaine'); }catch(e){}
  peindreTableau();
  window.scrollTo(0,0);
}

/* Liste, semaine ou mois, dans l'onglet Chantiers. Le choix se garde. */
function vueChantiers(v){
  AD_VUE = v;
  SEM_VUE = (v === 'semaine');
  SEM_LUNDI = '';
  if(v === 'mois' && !CAL_MOIS) CAL_JOUR = CAL_JOUR || '';
  try{ ls('adVue', v); }catch(e){}
  peindreTableau();
}

/* ====================== ESPACE D'ADMINISTRATION ======================
   Ce que font les autres, vu d'en haut : les devis de chaque commercial, les
   chantiers de chaque prestataire, les chiffres. Tout arrive en un seul appel
   et se garde sur l'appareil : sans réseau, l'écran reste lisible et dit
   clairement de quand il date — un chiffre périmé qui s'annonce vaut mieux
   qu'un écran vide. */
var TABLEAU = null;           // le dernier tableau reçu du bureau
/* v93 : le tableau s'ouvre sur le calendrier, ou sur l'onglet quitté la
   dernière fois. La facturation ne se rouvre pas d'elle-même : elle a sa
   propre lecture, lancée en arrivant sur l'onglet. */
var AD_ONGLET = (function(){
  /* v95 : « Aujourd'hui » d'abord. Une clé neuve, pour que chacun la voie
     une première fois, quel que soit l'onglet gardé avant. */
  /* v100 — Simon : « je ne veux pas de l'onglet Aujourd'hui, mets direct sur
     le planning ». Le tableau s'ouvre sur le Planning ; « À faire » ne garde
     que la liste de ce qu'il y a à faire. Clé neuve pour que chacun arrive
     sur le Planning une première fois. */
  var o = ls('adOnglet3');
  return (o === 'devis' || o === 'chantiers' || o === 'aujourdhui' || o === 'clients') ? o : 'chantiers';
})();
var AD_QUI = '';              // filtre : un nom, ou vide pour tout le monde
var AD_FICHE = null;          // la fiche ouverte
var AD_PRESTA = '';           // le ou les prestataires choisis (« MAXIME, VICTOR »)

/* v98 — plusieurs intervenants sur une intervention : Victor et Maxime
   travaillent en binôme pour presque tout. Le champ garde les noms séparés
   par une virgule, comme la colonne PRESTATAIRE du classeur. Chaque pastille
   d'un salarié s'allume et s'éteint seule ; « Personne » les éteint toutes. */
function nomsQui(s){
  var vus = {};
  return String(s == null ? '' : s).split(/\s*[,;\/+]\s*/).map(function(x){ return x.trim(); })
    .filter(function(x){ var k = x.toLowerCase(); if(!x || vus[k]) return false; vus[k] = true; return true; });
}
function aQui(s, nom){
  var n = String(nom || '').trim().toLowerCase();
  return !!n && nomsQui(s).some(function(x){ return x.toLowerCase() === n; });
}
/* Ajoute le nom s'il manque, l'enlève s'il y est. '' = personne. */
function basculerQui(s, nom){
  if(!nom) return '';
  var l = nomsQui(s);
  var i = -1; l.forEach(function(x, k){ if(x.toLowerCase() === String(nom).toLowerCase()) i = k; });
  if(i >= 0) l.splice(i, 1); else l.push(nom);
  return l.join(', ');
}
/* « MAXIME, VICTOR » → « MAXIME + VICTOR », pour l'œil. */
function quiLisible(s){ return nomsQui(s).join(' + '); }
var AD_SEL = false;           // mode « choisir plusieurs chantiers »
var AD_CHOIX = {};            // les ids cochés, en mode sélection
var AD_PASSE = false;         // le gérant a-t-il demandé à voir les chantiers passés
var AD_LOT_PRESTA = null;     // le prestataire du déplacement en lot (null = ne pas y toucher)
var AD_NATURE = '';           // la nature choisie sur la fiche ouverte

function estAdmin(){ var m = session(); return !!(m && m.role === 'ADMIN'); }

function ecranAdmin(){
  ETAPE = 0;
  fermerDialogues();
  montrer('eAd1');
  $('steps').classList.add('hide');
  $('bar').classList.add('hide');
  $('bHist').classList.add('hide');
  $('hTitre').textContent = 'Le tableau';
  erreur('');
  window.scrollTo(0,0);
  try{ peindreNotifs(); }catch(e){}
  if(!TABLEAU) TABLEAU = lsj('tableau');
  peindreTableau();
  if(navigator.onLine) chargerTableau();
}

/* ---- le devis établi au bureau ----
   Le gérant reçoit depuis la v82 le même catalogue qu'un commercial : le
   parcours est le même, le devis est à son nom, et il part au classeur comme
   n'importe quel autre. */
function devisAdmin(btn){
  if(CFG && CFG.catalogue){ erreur(''); return nouveauDevis(); }
  /* Un gérant connecté avant la v82 porte une configuration sans catalogue :
     on va le chercher plutôt que de le renvoyer se débrouiller. */
  if(!navigator.onLine){
    return erreur('Hors connexion : le catalogue n\'est pas encore sur cet appareil.');
  }
  var moi = session();
  if(!moi) return;
  if(btn) occuper(btn, 'Chargement du catalogue…');
  poster({action:'config', nom:moi.nom, code:moi.code, appareil:APPAREIL}).then(function(d){
    if(btn) libere(btn);
    if(!d || !d.ok || !d.config || !d.config.catalogue){
      return erreur('Le catalogue n\'est pas arrivé. Réessaie dans un instant.');
    }
    rangerConfig(d.config);
    erreur('');
    nouveauDevis();
  }, function(){
    if(btn) libere(btn);
    erreur('Le bureau n\'a pas répondu. Réessaie dans un instant.');
  });
}

/* Repartir d'un devis du tableau : même client, mêmes prestations, un devis
   neuf. Les lignes sont au bureau et non sur cet appareil : on va les y
   chercher. */
function devisDepuisFiche(btn){
  var f = AD_FICHE;
  if(!f || f.type !== 'devis') return;
  if(!(CFG && CFG.catalogue)) return erreur('Le catalogue n\'est pas encore arrivé.');
  if(!navigator.onLine) return erreur('Hors connexion : les lignes de ce devis sont au bureau.');
  var moi = session();
  if(!moi) return;
  if(btn) occuper(btn, 'Chargement…');
  erreur('');
  poster({action:'devisArchive', nom:moi.nom, code:moi.code, appareil:APPAREIL,
          numero:f.cle}, 40000)
    .then(function(r){
      if(btn) libere(btn);
      if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : 'Le bureau n\'a pas répondu.');
      dupliquerEnr({
        numero: r.numero,
        devis: {client: r.client || {}, lignes: r.lignes || [], nature: r.nature,
                passages: r.passages, etatSite: r.etatSite, objet: r.objet,
                delai: r.delai, notes: r.notes}
      });
    }, function(){
      if(btn) libere(btn);
      erreur('Le bureau n\'a pas répondu. Réessaie dans un instant.');
    });
}

function chargerTableau(btn){
  var moi = session();
  if(!moi) return Promise.resolve();
  if(!navigator.onLine){
    if(btn) libere(btn);
    erreur('Hors connexion : ce tableau est celui du dernier rafraîchissement.');
    return Promise.resolve();
  }
  if(btn) occuper(btn, 'Mise à jour…');
  return poster({action:'tableau', nom:moi.nom, code:moi.code, appareil:APPAREIL}).then(function(d){
    if(btn) libere(btn);
    if(!d || !d.ok){
      if(d && d.refus) return reidentifier('Ton accès a changé côté bureau.');
      return erreur(attenteLisible());
    }
    TABLEAU = d;
    // Si l'appareil manque de place, tant pis pour le cache : l'écran, lui,
    // s'affiche quand même.
    try{ lsj('tableau', d); }catch(e){}
    appliquerEnVol(TABLEAU);
    erreur('');
    peindreTableau();
    if(AD_FICHE) rouvrirFiche();
  }, function(){
    if(btn) libere(btn);
    erreur(attenteLisible());
  });
}

function quandLisible(ms){
  var d = new Date(Number(ms));
  if(isNaN(d.getTime())) return '—';
  return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+d.getFullYear()+
         ' à '+('0'+d.getHours()).slice(-2)+'h'+('0'+d.getMinutes()).slice(-2);
}
function ligneCh(libelle, valeur, gros){
  return '<div class="ch'+(gros?' gros':'')+'"><span'+(gros?'':' style="color:var(--mut)"')+'>'+
         ech(libelle)+'</span><b>'+valeur+'</b></div>';
}
function badgeDevis(st){
  st = String(st||'').toUpperCase();
  if(st === 'SIGNE')      return '<span class="vb vb-s">SIGNÉ</span>';
  if(st === 'REFUSE')     return '<span class="vb vb-x">REFUSÉ</span>';
  if(st === 'A RELANCER') return '<span class="vb vb-r">À RELANCER</span>';
  if(st === 'EXPIRE')     return '<span class="vb vb-a">EXPIRÉ</span>';
  return '<span class="vb vb-a">REMIS</span>';
}

function ongletAdmin(quoi){
  if(quoi === 'calendrier'){ quoi = 'chantiers'; AD_VUE = 'mois'; SEM_VUE = false; }
  AD_ONGLET = quoi;
  if(quoi !== 'factures') ls('adOnglet3', quoi);
  try{ majOnglets(); }catch(e){}
  AD_QUI = '';
  AD_PASSE = false;             // chaque retour sur l'onglet repart du travail à venir
  if(quoi === 'factures'){
    FACT_NOTE = '';
    if(!FACT_MOIS) FACT_MOIS = moisAujourdhui();
  }
  peindreTableau();
  /* La facturation ne vit pas dans le tableau : elle a sa propre lecture
     (contrats, interventions du mois, Pennylane). On ne la charge donc qu'en
     arrivant sur l'onglet. */
  if(quoi === 'factures' && !FACT) chargerFacturation($('bFactAct'));
  if(quoi === 'salaries') chargerDispos();
}
function filtreAdmin(nom){ AD_QUI = nom; peindreTableau(); }

/* Les chiffres repliés, et le souvenir de ce choix. On ouvre le tableau pour
   savoir qui va où : le chiffre d'affaires a sa place, mais pas la première. */
var AD_PLIE = ls('adPlie') !== 'non';
function plierChiffres(){
  AD_PLIE = !AD_PLIE;
  ls('adPlie', AD_PLIE ? 'oui' : 'non');
  peindreTableau();
}

/* Ce que dit la ligne repliée : de quoi savoir s'il faut la déplier. */
function resumeChiffres(t){
  var c = (t && t.chiffres) || null;
  if(!c || !c.nb) return 'Le tableau';
  /* Court exprès : la ligne repliée doit tenir sur une seule, même sur un
     petit téléphone. Le détail est à un appui. */
  return c.nb + ' devis · ' + (c.signes||0) + ' signé' + ((c.signes||0)>1?'s':'') +
         ' · ' + Math.round(c.htSigne||0).toLocaleString('fr-FR') + ' €';
}

function peindreTableau(){
  var t = TABLEAU;
  $('adMaj').textContent = (t && t.maj)
    ? 'Mis à jour le ' + quandLisible(t.maj)
    : 'Jamais rafraîchi sur cet appareil.';
  $('bOngJour').classList.toggle('on', AD_ONGLET === 'aujourdhui');
  /* le nombre de choses à faire, sur l'onglet même */
  try{
    var nbAF = t ? taches(t).reduce(function(s, x){ return s + (Number(x.n) || 0); }, 0) : 0;
    $('bOngJour').textContent = 'À faire' + (nbAF ? ' ' + nbAF : '');
  }catch(e){}
  $('bOngDevis').classList.toggle('on', AD_ONGLET === 'devis');
  $('bOngChantiers').classList.toggle('on', AD_ONGLET === 'chantiers');
  $('bOngFactures').classList.toggle('on', AD_ONGLET === 'factures');
  if($('bOngClients')) $('bOngClients').classList.toggle('on', AD_ONGLET === 'clients');
  $('adResume').textContent = AD_PLIE ? resumeChiffres(t) : 'Le tableau';
  $('adDetail').classList.toggle('hide', AD_PLIE);
  $('bAdPli').setAttribute('aria-expanded', AD_PLIE ? 'false' : 'true');
  /* Un devis neuf se commence depuis l'onglet des devis. Au-dessus du planning
     il ne servait qu'à repousser le travail plus bas. */
  $('bAdDevisNeuf').classList.toggle('hide', AD_ONGLET !== 'devis');
  /* v108f — l'onglet Devis ne montre que la création et la liste ; les
     chiffres sont au Tableau. */
  /* v108g — et pas davantage au-dessus du planning ni des factures : la
     bulle des chiffres ne reste qu'au Tableau. */
  try{ $('bAdPli').closest('.card').classList.toggle('hide', AD_ONGLET !== 'aujourdhui'); }catch(e){}
  var planning = AD_ONGLET === 'chantiers';
  $('adActions').classList.toggle('hide', !planning);
  $('adVues').classList.toggle('hide', AD_ONGLET !== 'chantiers');
  ['liste','semaine','mois'].forEach(function(v){
    var b = $('bVue_' + v);
    if(b){ b.classList.toggle('on', AD_VUE === v); b.setAttribute('aria-pressed', AD_VUE === v ? 'true' : 'false'); }
  });
  /* Choisir plusieurs cartes ne se fait que dans la liste : dans une grille,
     l'appui ouvre la journée. */
  $('bAdSel').classList.toggle('hide', !(AD_ONGLET === 'chantiers' && AD_VUE === 'liste'));
  if(AD_SEL && !(AD_ONGLET === 'chantiers' && AD_VUE === 'liste')){ AD_SEL = false; AD_CHOIX = {}; }
  $('adFact').classList.toggle('hide', AD_ONGLET !== 'factures');
  $('bAdSel').textContent = AD_SEL ? 'Terminer' : 'Sélectionner';
  var bs = $('bAdSem');
  if(bs) bs.classList.add('hide');            // v93 : remplacé par Liste · Semaine · Mois
  peindreLot();

  /* La facturation se peint à part : elle ne lit pas le tableau, et elle doit
     s'afficher même si le tableau n'a jamais été rafraîchi sur cet appareil. */
  if(AD_ONGLET === 'salaries'){
    $('adFiltres').innerHTML = '';
    $('adListe').innerHTML = bandeauMot() + salariesHtml();
    return;
  }
  if(AD_ONGLET === 'factures'){
    if(!FACT_MOIS) FACT_MOIS = moisAujourdhui();
    $('bFactMois').textContent = moisNom(FACT_MOIS);
    $('adFiltres').innerHTML = '';
    $('adListe').innerHTML = listeFacturesAdmin();
    if(!t) $('adChiffres').innerHTML = '<div class="empty">Les chiffres arrivent ' +
      'avec « Actualiser ».</div>';
    return;
  }

  if(!t){
    $('adChiffres').innerHTML = '<div class="empty">Appuie sur « Actualiser » pour aller chercher ' +
      'les devis et les chantiers.</div>';
    $('adFiltres').innerHTML = ''; $('adListe').innerHTML = '';
    return;
  }

  var c = t.chiffres || {};
  var taux = c.nb ? Math.round(c.signes * 100 / c.nb) : 0;
  $('adChiffres').innerHTML =
    ligneCh('Devis établis', (c.nb||0) + '') +
    ligneCh('Signés', (c.signes||0) + ' · ' + taux + ' %') +
    ligneCh('Devisé', eur(c.ht||0) + ' HT') +
    ligneCh('Signé', eur(c.htSigne||0) + ' HT', true) +
    (c.mensuelSigne ? '<div class="mini">dont ' + eur(c.mensuelSigne) +
      ' HT par mois en récurrent</div>' : '') +
    '<div class="mini" style="margin-top:6px">Sur les ' + (t.fenetre||90) + ' derniers jours.</div>';

  var noms = (AD_ONGLET === 'devis' ? (t.commerciaux||[]) : (t.prestataires||[])).slice();
  if(AD_ONGLET === 'chantiers') { noms.push('(annulés)'); }   // v100 : « à placer » vit dans À faire
  if(AD_ONGLET === 'clients'){
    $('adFiltres').innerHTML = '';
    $('adListe').innerHTML = bandeauMot() + clientsHtml(t);
    return;
  }
  /* v95 : l'accueil n'a pas de filtre — il parle de tout le monde. */
  if(AD_ONGLET === 'aujourdhui'){
    $('adFiltres').innerHTML = '';
    $('adListe').innerHTML = bandeauMot() + bandeauAnnuler() + accueilHtml(t);
    return;
  }
  $('adFiltres').innerHTML = ['<span class="puce' + (AD_QUI===''?' on':'') +
      '" onclick="filtreAdmin(\'\')">Tout le monde</span>']
    .concat(noms.map(function(n){
      return '<span class="puce' + (AD_QUI===n?' on':'') + '" onclick="filtreAdmin(\'' +
             ech(n).replace(/'/g,'&#39;') + '\')">' + ech(n) + '</span>';
    })).join('');

  /* Le calendrier : le mois, avec le bac de ce qui reste à placer. */
  if(AD_ONGLET === 'chantiers' && AD_VUE === 'mois'){
    /* v95 : un seul planning. Le mois porte le bac de ce qui reste à placer. */
    $('adListe').innerHTML = bandeauMot() + bandeauAnnuler() + moisHtml(chantiersDuCalendrier(t), false);
    return;
  }

  if(AD_ONGLET === 'chantiers' && SEM_VUE){
    /* Les chantiers sans date n'ont pas de colonne où se poser : ils restent
       annoncés au-dessus de la semaine, sinon ils disparaîtraient de la vue. */
    var vivants = (t.chantiers||[]).filter(function(c){
      if(estAnnule(c)) return false;
      if(!AD_QUI) return true;
      if(AD_QUI === '(non affectés)') return !c.prestataire || !c.date;
      if(AD_QUI === '(annulés)') return false;
      return aQui(c.prestataire, AD_QUI);
    });
    $('adListe').innerHTML =
      /* Le gérant déplace ; le salarié regarde. C'est le même tableau de
         semaine, mais on ne lui donne pas de prise. */
      semaineHtml(vivants, 'ficheChantier', true);
    $('adListe').innerHTML = bandeauMot() + $('adListe').innerHTML;
    return;
  }
  /* La recherche garde le doigt dans le champ quand le tableau se rafraîchit
     tout seul pendant qu'on tape. */
  var tapait = document.activeElement && document.activeElement.id === 'adCherche';
  var pos = tapait ? document.activeElement.selectionStart : 0;
  $('adListe').innerHTML = AD_ONGLET === 'devis'
    ? bandeauMot() + champRechercheDevis() + enteteDevisAdmin() + listeDevisAdmin(t)
    : bandeauMot() + listeChantiersAdmin(t);
  if(tapait && $('adCherche')){
    $('adCherche').focus();
    try{ $('adCherche').setSelectionRange(pos, pos); }catch(e){}
  }
}

/* v108e — retrouver un devis en tapant le nom du client. Le filtre s'applique
   à chaque lettre, sans accents ni majuscules, sur le client, le numéro, la
   ville et le commercial ; seule la liste se repeint, pas le champ, pour que
   le clavier reste ouvert. */
var AD_CHERCHE = '';
function champRechercheDevis(){
  return '<div style="position:relative;margin-bottom:10px">' +
    '<input id="adCherche" type="search" autocomplete="off" enterkeyhint="search" ' +
      'placeholder="Chercher un client, un numéro, une ville…" value="' + ech(AD_CHERCHE) + '" ' +
      'oninput="chercherDevis(this.value)" style="margin:0">' +
  '</div>';
}
function cleRecherche(s){ return sansAccents(String(s == null ? '' : s)).toLowerCase().replace(/\s+/g, ' ').trim(); }
function devisCorrespond(d, q){
  if(!q) return true;
  var h = cleRecherche([d.client, d.numero, d.ville, d.commercial].join(' '));
  return q.split(' ').every(function(m){ return !m || h.indexOf(m) >= 0; });
}
function chercherDevis(v){
  AD_CHERCHE = String(v || '');
  var z = $('adDevisCartes');
  if(z && TABLEAU) z.innerHTML = cartesDevisAdmin(TABLEAU);
}

/* ---- OÙ EN EST LE TRAVAIL D'UN DEVIS ----

   Trois états, et trois couleurs, demandés par Simon : vert quand tout est
   posé au planning, orange quand il reste du travail à placer, blanc quand le
   devis n'est pas encore signé et qu'il n'y a donc rien à placer.

   Quand un devis est dans deux cas à la fois — pas encore signé, mais des
   chantiers déjà posés et incomplets — c'est l'orange qui l'emporte : ce qui
   demande un geste passe devant ce qui attend une signature.

   La couleur ne porte jamais l'information toute seule : chaque carte écrit
   son état en toutes lettres, et une légende l'explique en tête de liste. */
function etatDevis(d){
  var poses = Number(d.poses || 0), reste = Number(d.aPoser || 0);
  var st = String(d.statut || '').toUpperCase();
  if(reste > 0) return 'aPoser';
  if(poses > 0) return 'pose';
  if(st === 'SIGNE') return 'aPoser';     // signé, et pas un seul chantier posé
  return 'attente';
}

var ETATS_DEVIS = {
  pose:    {classe:'dvV', mot:'Travail posé'},
  aPoser:  {classe:'dvO', mot:'À poser au planning'},
  attente: {classe:'dvB', mot:'Pas encore signé'}
};

function motEtatDevis(d){
  var e = ETATS_DEVIS[etatDevis(d)];
  var n = Number(d.aPoser || 0), p = Number(d.poses || 0);
  if(etatDevis(d) === 'aPoser' && n > 0){
    return n + ' intervention' + (n>1?'s':'') + ' à poser';
  }
  if(etatDevis(d) === 'pose' && p > 0){
    return p + ' intervention' + (p>1?'s':'') + ' posée' + (p>1?'s':'');
  }
  return e.mot;
}

function legendeDevis(){
  return '<div class="dvLeg">' +
    '<span><i class="dvP dvV"></i>posé</span>' +
    '<span><i class="dvP dvO"></i>à poser</span>' +
    '<span><i class="dvP dvB"></i>pas signé</span>' +
  '</div>';
}

function listeDevisAdmin(t){
  var l = (t.devis||[]).filter(function(d){ return !AD_QUI || d.commercial === AD_QUI; });
  if(!l.length) return '<div class="card"><div class="empty">Aucun devis sur la période.</div></div>';
  var parCom = (t.parCommercial||[]).filter(function(x){ return !AD_QUI || x.nom === AD_QUI; });
  var tete = AD_QUI && parCom.length
    ? '<div class="card"><b>' + ech(AD_QUI) + '</b><div class="mini">' +
      parCom[0].nb + ' devis · ' + parCom[0].signes + ' signés · ' +
      eur(parCom[0].htSigne) + ' HT signés</div></div>'
    : '';
  return tete + legendeDevis() + '<div id="adDevisCartes">' + cartesDevisAdmin(t) + '</div>';
}
function cartesDevisAdmin(t){
  var q = cleRecherche(AD_CHERCHE);
  var l = (t.devis||[]).filter(function(d){
    return (!AD_QUI || d.commercial === AD_QUI) && devisCorrespond(d, q);
  });
  if(!l.length) return '<div class="card"><div class="empty">Aucun devis ne correspond à « ' +
    ech(AD_CHERCHE.trim()) + ' ».</div></div>';
  return l.map(function(d){
    return '<div class="card ' + ETATS_DEVIS[etatDevis(d)].classe +
      '" style="cursor:pointer;margin-bottom:10px" onclick="ficheDevis(\'' +
      ech(d.numero) + '\')">' +
      '<div style="display:flex;gap:10px;align-items:baseline">' +
        '<b style="flex:1;font-size:15.5px">' + ech(d.client||'—') + '</b>' + badgeDevis(d.statut) +
      '</div>' +
      '<div class="mini" style="margin-top:4px">' + ech(d.numero) + ' · ' + jjmmaa(d.date) +
        ' · ' + eur(d.ttc) + ' TTC</div>' +
      '<div class="mini">' + ech(d.commercial) + (d.ville ? ' · ' + ech(d.ville) : '') + '</div>' +
      /* La couleur ne dit rien toute seule : un écran en plein soleil, un œil
         qui distingue mal le vert de l'orange, et il ne resterait rien. */
      '<div class="mini dvMot">' + ech(motEtatDevis(d)) + '</div>' +
      (d.recurrent && d.statut === 'SIGNE' && !d.contrat
        ? '<div class="mini" style="color:var(--warn);font-weight:600">Contrat à mettre au calendrier</div>' : '') +
      (d.recurrent && d.contrat ? '<div class="mini">Contrat ' + ech(d.contrat) + '</div>' : '') +
      (d.statut === 'REFUSE' && d.motif ? '<div class="mini">Refus : ' + ech(d.motif) + '</div>' : '') +
      (d.statut === 'A RELANCER' && d.relance ? '<div class="mini">Relance le ' + jjmmaa(d.relance) + '</div>' : '') +
    '</div>';
  }).join('');
}

function estAnnule(c){ return String(c.statut||'').toUpperCase() === 'ANNULE'; }

/* ---- DÉPLACER UN CHANTIER SANS QUITTER LA LISTE ----

   Reporter un chantier au lendemain demandait d'ouvrir sa fiche, de trouver le
   champ de date, de taper la date, d'enregistrer, puis de revenir. Cinq gestes
   pour l'opération la plus courante de la journée.

   Un appui sur « Déplacer » ouvre un panneau sous la carte : une pastille, et
   c'est fait. Le filet est l'annulation — un geste aussi rapide se trompe de
   carte de temps en temps, et il faut pouvoir le défaire sans réfléchir. */

var AD_VITE = null;      // l'identifiant du chantier dont le panneau est ouvert
var AD_DEFAIRE = null;   // { id, avant: {date, heure, prestataire}, mot }
var AD_MINUTEUR = null;

function deplierVite(id, ev){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  AD_VITE = (AD_VITE === id) ? null : id;
  peindreTableau();
}

/* Les reports proposés. Le point de départ est la date du chantier, ou
   aujourd'hui s'il n'en a pas : reporter « au lendemain » un chantier sans
   date n'aurait aucun sens. */
function reportsVite(c){
  var base = c.date || isoJour();
  return [
    {lib:'Demain', iso:dansNJours(isoJour(), 1)},
    {lib:'Dans 2 jours', iso:dansNJours(isoJour(), 2)},
    {lib:'+ 1 semaine', iso:dansNJours(base, 7)}
  ];
}

function dansNJours(iso, n){
  var p = String(iso||'').split('-');
  var d = new Date(Number(p[0]), Number(p[1])-1, Number(p[2]));
  if(isNaN(d.getTime())) d = new Date();
  d.setDate(d.getDate() + n);
  return isoJour(d);
}

function blocDeplacerVite(c){
  // En mode sélection, l'appui coche : deux gestes rapides se marcheraient dessus.
  if(AD_SEL || estAnnule(c)) return '';
  if(AD_VITE !== c.id){
    return '<button class="adRap" onclick="deplierVite(\'' + ech(c.id) +
           '\', event)">Déplacer</button>';
  }
  var gens = ((TABLEAU||{}).prestataires||[]);
  return '<div class="adVite" onclick="event.stopPropagation()">' +
    '<div class="lab">Reporter</div>' +
    '<div class="row">' +
      reportsVite(c).map(function(r){
        return '<span class="puce" onclick="reporterVite(\'' + ech(c.id) + '\',\'' +
               r.iso + '\')">' + ech(r.lib) + '</span>';
      }).join('') +
      '<span class="puce" onclick="ficheChantier(\'' + ech(c.id) + '\')">Autre date…</span>' +
    '</div>' +
    '<div class="lab">Confier à</div>' +
    '<div class="row">' +
      gens.map(function(g){
        return '<span class="puce' + (aQui(c.prestataire, g) ? ' on' : '') +
               '" onclick="confierVite(\'' + ech(c.id) + '\',\'' +
               ech(g).replace(/'/g,'&#39;') + '\')">' + ech(g) + '</span>';
      }).join('') +
      '<span class="puce' + (!c.prestataire ? ' on' : '') +
        '" onclick="confierVite(\'' + ech(c.id) + '\',\'\')">Personne</span>' +
    '</div>' +
  '</div>';
}

/* ---- FAIRE GLISSER UN CHANTIER D'UN JOUR À L'AUTRE ----

   Le doigt reste posé sur la carte, elle se décolle, on la promène, on la
   lâche sur une journée. C'est le geste d'un agenda de papier, et c'est le
   seul qui se passe de lire quoi que ce soit.

   Trois difficultés, et ce qui les règle :

   · Un appui posé est AUSSI le début d'un défilement. On attend donc d'être
     resté immobile un bon moment (GL_TENU) avant de décoller quoi que ce soit ;
     un doigt qui bouge avant la fin de ce délai défile, comme d'habitude.

   · Une fois la carte décollée, il faut au contraire EMPÊCHER le défilement,
     sinon la page part sous le doigt. D'où l'écouteur « touchmove » non
     passif : lui seul peut appeler preventDefault, et il ne le fait que
     pendant un glissement.

   · Après un glissement, le navigateur envoie quand même un « click » sur la
     carte, qui ouvrirait sa fiche. On avale ce clic-là.

   Tout passe par les événements « pointer » : la souris et le doigt tiennent
   le même discours, et l'essai peut donc jouer le geste sans téléphone. */

var GL = null;             // { id, el, fantome, cible, dx, dy }
var GL_MINUTEUR = null;
var GL_DEPART = null;      // { x, y, el } tant que rien n'est décollé
var GL_FINI = 0;           // l'instant du dernier lâcher, pour avaler le clic
var GL_TENU = 420;         // ms de doigt immobile avant de décoller
var GL_BOUGE = 10;         // px au-delà desquels c'est un défilement, pas un appui

function glisserPossible(el){
  // Le gérant déplace. En mode sélection, l'appui coche : les deux gestes se
  // marcheraient dessus.
  return !!el && !AD_SEL && estAdmin();
}

function surPointeurBas(e){
  if(e.button !== undefined && e.button !== 0) return;
  var el = e.target && e.target.closest ? e.target.closest('[data-ch]') : null;
  if(!glisserPossible(el)) return;
  glAnnulerAttente();
  GL_DEPART = {x:e.clientX, y:e.clientY, el:el};
  GL_MINUTEUR = setTimeout(function(){ glDecoller(e.clientX, e.clientY); }, GL_TENU);
}

function glAnnulerAttente(){
  if(GL_MINUTEUR){ clearTimeout(GL_MINUTEUR); GL_MINUTEUR = null; }
  GL_DEPART = null;
}

function glDecoller(x, y){
  GL_MINUTEUR = null;
  var d = GL_DEPART;
  GL_DEPART = null;
  if(!d || !d.el || !d.el.isConnected) return;
  var r = d.el.getBoundingClientRect();
  var f = d.el.cloneNode(true);
  f.className = (d.el.className || '') + ' glFantome';
  f.style.width = r.width + 'px';
  f.style.left = r.left + 'px';
  f.style.top = r.top + 'px';
  f.removeAttribute('onclick');
  document.body.appendChild(f);
  d.el.classList.add('glParti');
  document.body.classList.add('glEnCours');
  GL = {id:d.el.getAttribute('data-ch'), el:d.el, fantome:f, cible:null,
        dx:x - r.left, dy:y - r.top};
  vibrer(18);
  glDeplacer(x, y);
}

function glDeplacer(x, y){
  if(!GL) return;
  GL.fantome.style.left = (x - GL.dx) + 'px';
  GL.fantome.style.top = (y - GL.dy) + 'px';

  // Le fantôme ne doit pas se désigner lui-même : il est en pointer-events:none.
  var sous = document.elementFromPoint(x, y);
  var cible = sous && sous.closest ? sous.closest('[data-jour]') : null;
  if(cible !== GL.cible){
    if(GL.cible) GL.cible.classList.remove('glCible');
    GL.cible = cible;
    if(cible) cible.classList.add('glCible');
  }
  glBordure(x, y);
}

/* Près d'un bord, on avance tout seul : sans cela, un chantier ne pourrait
   jamais rejoindre une journée qui n'est pas déjà à l'écran. */
function glBordure(x, y){
  var h = window.innerHeight;
  if(y < 90) window.scrollBy(0, -12);
  else if(y > h - 90) window.scrollBy(0, 12);
  var sem = document.querySelector('.sem');
  if(sem){
    var r = sem.getBoundingClientRect();
    if(y > r.top && y < r.bottom){
      if(x < r.left + 46) sem.scrollLeft -= 14;
      else if(x > r.right - 46) sem.scrollLeft += 14;
    }
  }
}

function surPointeurHaut(e){
  if(GL_DEPART) glAnnulerAttente();
  if(!GL) return;
  var id = GL.id, cible = GL.cible;
  glRanger();
  GL_FINI = Date.now();
  if(!cible) return;
  var iso = cible.getAttribute('data-jour') || '';
  var c = chantierDuTableau(id);
  if(!c) return;
  if((c.date || '') === iso) return;      // lâché là où il était déjà
  if(iso) reporterVite(id, iso);
  else gesteVite(id, {date:'', heure:''}, 'Retiré du planning');
}

function glRanger(){
  if(GL){
    if(GL.cible) GL.cible.classList.remove('glCible');
    if(GL.fantome && GL.fantome.parentNode) GL.fantome.parentNode.removeChild(GL.fantome);
    if(GL.el) GL.el.classList.remove('glParti');
  }
  GL = null;
  document.body.classList.remove('glEnCours');
}

/* Branché une seule fois, au démarrage. Les écouteurs vivent sur le document :
   les cartes sont redessinées à chaque peinture, pas lui. */
function brancherGlisser(){
  document.addEventListener('pointerdown', surPointeurBas, true);
  document.addEventListener('pointermove', function(e){
    if(GL){ glDeplacer(e.clientX, e.clientY); return; }
    if(!GL_DEPART) return;
    if(Math.abs(e.clientX - GL_DEPART.x) > GL_BOUGE ||
       Math.abs(e.clientY - GL_DEPART.y) > GL_BOUGE) glAnnulerAttente();
  }, true);
  document.addEventListener('pointerup', surPointeurHaut, true);
  document.addEventListener('pointercancel', function(){ glAnnulerAttente(); glRanger(); }, true);
  /* Non passif, et c'est tout l'intérêt : pendant un glissement, lui seul
     peut empêcher la page de défiler sous le doigt. */
  document.addEventListener('touchmove', function(e){
    if(GL && e.cancelable) e.preventDefault();
  }, {passive:false});
  // Le clic qui suit un glissement ouvrirait la fiche du chantier déplacé.
  document.addEventListener('click', function(e){
    if(Date.now() - GL_FINI < 400){ e.stopPropagation(); e.preventDefault(); }
  }, true);
}

function chantierDuTableau(id){
  return ((TABLEAU||{}).chantiers||[]).filter(function(x){ return x.id === id; })[0] || null;
}

/* Le seul endroit qui envoie un geste rapide. « avant » est relevé sur place :
   c'est lui qui permettra de défaire, et il doit être pris avant d'écrire. */
function gesteVite(id, champs, mot){
  var c = chantierDuTableau(id);
  if(!c) return;
  if(!navigator.onLine) return erreur('Hors connexion : impossible de déplacer un chantier maintenant.');
  var avant = {date:c.date||'', heure:c.heure||'', prestataire:c.prestataire||''};
  var moi = session();
  var env = {action:'planifier', nom:moi.nom, code:moi.code, appareil:APPAREIL, id:id};
  for(var k in champs) if(champs.hasOwnProperty(k)) env[k] = champs[k];
  // L'écran dit tout de suite ce qui vient d'être demandé : sur un téléphone,
  // attendre le bureau donnerait l'impression que l'appui n'a pas pris.
  for(var k2 in champs) if(champs.hasOwnProperty(k2)) c[k2] = champs[k2];
  AD_VITE = null;
  armerDefaire(id, avant, mot);
  peindreTableau();
  erreur('');
  poster(env).then(function(r){
    if(!r || !r.ok){
      // On remet ce qu'on avait montré : l'écran ne doit jamais raconter une
      // modification que le bureau a refusée.
      var c2 = chantierDuTableau(id);
      if(c2){ c2.date = avant.date; c2.heure = avant.heure; c2.prestataire = avant.prestataire; }
      AD_DEFAIRE = null;
      peindreTableau();
      return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
    }
    tracer('CHANTIER DEPLACE', mot, id);
    direNotifs(r);
    chargerTableau();
  }, function(){
    var c3 = chantierDuTableau(id);
    if(c3){ c3.date = avant.date; c3.heure = avant.heure; c3.prestataire = avant.prestataire; }
    AD_DEFAIRE = null;
    peindreTableau();
    erreur(attenteLisible());
  });
}

function reporterVite(id, iso){
  gesteVite(id, {date:iso}, 'Reporté au ' + jourLisible(iso));
}

function confierVite(id, nom){
  var c = ((TABLEAU||{}).chantiers||[]).filter(function(x){ return x.id === id; })[0];
  var qui = nom ? basculerQui(c ? c.prestataire : '', nom) : '';
  gesteVite(id, {prestataire:qui}, qui ? 'Confié à ' + quiLisible(qui) : 'Retiré à son prestataire');
}

/* Le bandeau d'annulation vit dix secondes : le temps de voir qu'on s'est
   trompé de carte, pas assez pour qu'il traîne au-dessus du planning. */
function armerDefaire(id, avant, mot){
  AD_DEFAIRE = {id:id, avant:avant, mot:mot};
  if(AD_MINUTEUR) clearTimeout(AD_MINUTEUR);
  AD_MINUTEUR = setTimeout(function(){
    AD_DEFAIRE = null; AD_MINUTEUR = null;
    var e = $('eAd1');
    if(e && !e.classList.contains('hide')) peindreTableau();
  }, 10000);
}

function bandeauAnnuler(){
  if(!AD_DEFAIRE) return '';
  return '<div class="adAnn"><span>' + ech(AD_DEFAIRE.mot) + '</span>' +
         '<button onclick="defaireVite()">Annuler</button></div>';
}

function defaireVite(){
  var d = AD_DEFAIRE;
  if(!d) return;
  AD_DEFAIRE = null;
  if(AD_MINUTEUR){ clearTimeout(AD_MINUTEUR); AD_MINUTEUR = null; }
  gesteVite(d.id, {date:d.avant.date, heure:d.avant.heure, prestataire:d.avant.prestataire},
            'Remis comme avant');
  // Le retour en arrière ne s'annule pas lui-même : sinon on tourne en rond.
  AD_DEFAIRE = null;
  peindreTableau();
}

/* Un chantier sans date n'est pas du passé : c'est justement celui qu'il faut
   planifier. Et la journée en cours reste entière, même ce qui y est déjà
   fait — on la relit encore à 17 h pour savoir ce qui a été fait le matin. */
function estPasse(c){ return !!c.date && c.date < isoJour(); }

function voirPasse(v){ AD_PASSE = !!v; peindreTableau(); }

function listeChantiersAdmin(t){
  /* Les annulés ne se mêlent pas aux autres : ils ne sont plus du travail à
     faire. On les retrouve derrière leur propre pastille, pour les rétablir. */
  var tous = (t.chantiers||[]).filter(function(c){
    if(AD_QUI === '(annulés)') return estAnnule(c);
    if(estAnnule(c)) return false;
    if(!c.date) return false;                  // v100 : sans date = dans « À faire »
    if(!AD_QUI) return true;
    if(AD_QUI === '(non affectés)') return !c.prestataire || !c.date;
    return aQui(c.prestataire, AD_QUI);
  });
  /* Par défaut on ne montre que ce qui vient : un planning est un outil de
     travail, pas une archive. Le passé reste à un appui. */
  var nPasses = tous.filter(estPasse).length;
  var l = AD_PASSE ? tous : tous.filter(function(c){ return !estPasse(c); });
  var pied = nPasses
    ? '<button class="btn sec" style="margin-top:4px" onclick="voirPasse(' + (AD_PASSE?'false':'true') + ')">' +
      (AD_PASSE ? 'Masquer les chantiers passés'
                : 'Voir le passé (' + nPasses + ' chantier' + (nPasses>1?'s':'') + ')') +
      '</button>'
    : '';
  if(!l.length) return bandeauAnnuler() +
    '<div class="card"><div class="empty">Aucun chantier à venir.</div></div>' + pied;
  var aFaire = 0;                             // v100 : le rappel vit dans « À faire »
  var tete = aFaire
    ? '<div class="card" style="border-color:var(--warn)"><b>' + aFaire + ' chantier' +
      (aFaire>1?'s':'') + ' à planifier</b><div class="mini">Sans date ou sans personne, ' +
      'ils n\'apparaissent sur aucun téléphone.</div></div>'
    : '';

  /* Les journées se voient. Une liste plate oblige à lire la date de chaque
     carte pour savoir où finit lundi : le salarié a ses journées séparées
     depuis la v67, le gérant les avait perdues.

     Le tri est refait ici plutôt que supposé : un en-tête de journée ne vaut
     que si toutes les cartes d'un même jour se suivent, et une liste reçue
     dans le désordre afficherait deux fois « Mardi 3 novembre ». */
  l = l.slice().sort(function(x, y){
    if(!x.date && y.date) return -1;
    if(x.date && !y.date) return 1;
    if(x.date !== y.date) return x.date < y.date ? -1 : 1;
    return String(x.heure||'') < String(y.heure||'') ? -1
         : (String(x.heure||'') > String(y.heure||'') ? 1 : 0);
  });
  /* null et non '' : un chantier sans date a justement la chaîne vide pour
     date, et son en-tête « Sans date » ne serait jamais écrit. */
  var jour = null, html = '', ouvert = false, dedans = 0;
  function combien(iso){
    return l.filter(function(x){ return (x.date || '') === iso; }).length;
  }
  l.forEach(function(c){
    var j = c.date || '';
    if(j !== jour){
      jour = j;
      if(ouvert) html += '</div></div>';
      dedans = combien(j);
      /* Le bloc entier porte la date : c'est lui qu'on vise en faisant glisser
         une carte, et viser une journée est plus facile que viser sa bande. */
      html += '<div class="jBloc" data-jour="' + ech(j) + '">' +
              bandeJour(j, dedans) + '<div class="jCorps">';
      ouvert = true;
    }
    html += carteChantierAdmin(c);
  });
  if(ouvert) html += '</div></div>';
  return bandeauAnnuler() + tete + html + pied;
}

/* La bande d'une journée : le quantième en gros, le jour de la semaine, le
   mois, et le nombre de chantiers. C'est elle qui fait qu'une suite de cartes
   devient un planning. */
function bandeJour(iso, nb){
  var compte = '<span class="jNb">' + nb + ' chantier' + (nb>1?'s':'') + '</span>';
  if(!iso){
    return '<div class="jBand jSans"><span class="jNum">—</span>' +
           '<span class="jJour"><b>Sans date</b>' +
           '<span>à poser au planning</span></span>' + compte + '</div>';
  }
  var d = new Date(iso + 'T12:00:00');
  if(isNaN(d.getTime())){
    return '<div class="jBand"><span class="jNum">—</span>' +
           '<span class="jJour"><b>' + ech(iso) + '</b></span>' + compte + '</div>';
  }
  var auj = isoJour() === iso;
  var demain = dansNJours(isoJour(), 1) === iso;
  var sem = d.toLocaleDateString('fr-FR', {weekday:'long'});
  sem = sem.charAt(0).toUpperCase() + sem.slice(1);
  var mois = d.toLocaleDateString('fr-FR', {month:'long', year:'numeric'});
  return '<div class="jBand' + (auj ? ' jAuj' : '') + '">' +
    '<span class="jNum">' + d.getDate() + '</span>' +
    '<span class="jJour"><b>' + ech(sem) + (auj ? ' · aujourd\'hui' : (demain ? ' · demain' : '')) +
      '</b><span>' + ech(mois) + '</span></span>' + compte + '</div>';
}

/* La carte d'un chantier sur l'écran du gérant. Elle porte les couleurs de sa
   nature, comme sur le téléphone du salarié : c'est le même travail, il n'y a
   pas de raison qu'il change d'aspect en changeant de lecteur. */
/* ====================== SALARIÉS (v108n) ======================
   « Les heures des salariés au mois et ce qu'il me reste de temps pour placer
   une intervention — seulement les prestataires, vu par les admins ; dans un
   onglet Salariés avec les congés et les éléments variables. » Le bureau
   calcule (disposSalaries) : contrat du mois, prévu (passages + trajets),
   libre, semaine par semaine et jour par jour. */
var DISPOS = null, DISPOS_MOIS = '', DISPOS_OUVERT = {}, DISPOS_EN_COURS = '';
function chargerDispos(){
  var moi = session();
  if(!DISPOS_MOIS) DISPOS_MOIS = moisAujourdhui();
  if(!moi || !navigator.onLine){ return; }
  var m = DISPOS_MOIS;
  DISPOS = null; DISPOS_EN_COURS = m;
  poster({action:'disposSalaries', nom:moi.nom, code:moi.code, appareil:APPAREIL, mois:m}, 60000).then(function(r){
    if(DISPOS_EN_COURS === m) DISPOS_EN_COURS = '';
    if(m !== DISPOS_MOIS) return;
    DISPOS = r && r.ok ? r : { erreur: (r && r.erreur) || 'Le bureau n\'a pas répondu.' };
    if(ECRAN_VU === 'eAd1' && AD_ONGLET === 'salaries' && !AD_FICHE) peindreTableau();
  }, function(){ DISPOS_EN_COURS = ''; DISPOS = { erreur: attenteLisible() }; if(ECRAN_VU === 'eAd1' && AD_ONGLET === 'salaries') peindreTableau(); });
}
function moisDispos(dec){
  var p = (DISPOS_MOIS || moisAujourdhui()).split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1 + dec, 15);
  DISPOS_MOIS = isoJour(d).slice(0, 7);
  chargerDispos(); peindreTableau();
}
function hLisible(mn){
  mn = Math.round(Number(mn) || 0);
  var neg = mn < 0; mn = Math.abs(mn);
  var h = Math.floor(mn / 60), r = mn % 60;
  return (neg ? '−' : '') + h + ' h' + (r ? (r < 10 ? '0' : '') + r : '');
}
function basculerJoursLibres(i){ DISPOS_OUVERT[i] = !DISPOS_OUVERT[i]; peindreTableau(); }
function poserChezSalarie(iso, nom){
  nouveauChantier(iso);
  try{ CT.prestataire = nom; peindreContrat(); }catch(e){}
}
function salariesHtml(){
  if(!DISPOS_MOIS) DISPOS_MOIS = moisAujourdhui();
  var h = '<div class="card" style="display:flex;align-items:center;gap:8px">' +
    '<button class="btn sec sm" style="width:auto" onclick="moisDispos(-1)" aria-label="Mois précédent">‹</button>' +
    '<b style="flex:1;text-align:center">' + ech(moisNom(DISPOS_MOIS)) + '</b>' +
    '<button class="btn sec sm" style="width:auto" onclick="moisDispos(1)" aria-label="Mois suivant">›</button></div>';
  var r = DISPOS;
  if(!r && DISPOS_EN_COURS !== DISPOS_MOIS) setTimeout(chargerDispos, 0);
  if(!r) h += '<div class="card"><div class="empty">Calcul des heures… (les trajets prennent quelques secondes la première fois)</div></div>';
  else if(r.erreur) h += '<div class="card" style="border-color:var(--warn)"><b>Le bureau n\'a pas pu répondre</b><div class="mini">' + ech(r.erreur) + '</div>' +
    '<button class="btn sec sm" style="margin-top:8px" onclick="chargerDispos();peindreTableau()">Réessayer</button></div>';
  else {
    h += (r.salaries || []).map(function(sx, i){
      var pc = sx.contrat ? Math.min(100, Math.round(sx.prevu * 100 / sx.contrat)) : 0;
      var trop = sx.libre < 0;
      var libres = (sx.jours || []).filter(function(j){ return !j.passe && j.cap - j.prevu >= 60; });
      return '<div class="card" style="margin-bottom:10px">' +
        '<div style="display:flex;gap:10px;align-items:baseline"><b style="flex:1;font-size:17px">' + ech(sx.nom) + '</b>' +
          '<span class="mini">' + sx.heuresSemaine + ' h / semaine</span></div>' +
        '<div style="display:flex;gap:14px;flex-wrap:wrap;margin:8px 0 6px;font-size:14px">' +
          '<span>Contrat <b>' + hLisible(sx.contrat) + '</b></span>' +
          '<span>Prévu <b>' + hLisible(sx.prevu) + '</b></span>' +
          '<span style="color:' + (trop ? 'var(--danger)' : 'var(--ok)') + '">' + (trop ? 'Dépassement ' : 'Libre ') + '<b>' + hLisible(Math.abs(sx.libre)) + '</b></span></div>' +
        '<div style="height:9px;border-radius:5px;background:var(--sub);overflow:hidden"><div style="width:' + pc + '%;height:100%;background:' + (trop ? 'var(--danger)' : 'var(--acc)') + '"></div></div>' +
        '<div class="mini" style="margin-top:6px">' + sx.n + ' passage' + (sx.n > 1 ? 's' : '') + ' · travail ' + hLisible(sx.travail) + ' + trajets ' + hLisible(sx.trajet) + '</div>' +
        '<div style="display:flex;gap:6px;margin-top:10px">' + (sx.semaines || []).map(function(w){
          var l = w.contrat - w.prevu;
          return '<div style="flex:1;text-align:center;background:var(--sub);border-radius:8px;padding:5px 0">' +
            '<div class="mini" style="margin:0">' + ech(jjmm(w.lundi)) + '</div>' +
            '<b style="font-size:13px;color:' + (l < 0 ? 'var(--danger)' : 'var(--txt)') + '">' + hLisible(l) + '</b></div>';
        }).join('') + '</div>' +
        '<div class="mini" style="margin-top:2px">Libre par semaine (semaine du lundi indiqué).</div>' +
        '<button class="btn sec sm" style="margin-top:10px" onclick="basculerJoursLibres(' + i + ')">' +
          (DISPOS_OUVERT[i] ? 'Masquer les jours libres' : 'Voir les jours libres (' + libres.length + ')') + '</button>' +
        (DISPOS_OUVERT[i] ? (libres.length ? libres.map(function(j){
          return '<div style="display:flex;gap:10px;align-items:center;border-top:1px solid var(--line);padding:8px 0">' +
            '<div style="flex:1"><b>' + ech(jourLisible(j.iso)) + '</b><div class="mini" style="margin:0">' + hLisible(j.cap - j.prevu) + ' libres · ' +
              j.n + ' intervention' + (j.n > 1 ? 's' : '') + ' déjà</div></div>' +
            '<button class="btn sec sm" style="width:auto" onclick="poserChezSalarie(\'' + j.iso + '\', \'' + ech(sx.nom).replace(/'/g,'&#39;') + '\')">Poser ici</button></div>';
        }).join('') : '<div class="mini" style="margin-top:8px">Aucun jour avec au moins une heure de libre ce mois-ci.</div>') : '') +
      '</div>';
    }).join('');
    h += '<div class="mini" style="margin:-2px 0 12px">Contrat = heures par semaine réparties sur ses jours de travail, moins les fériés et les congés. ' +
      'Prévu = durée des passages (un binôme compte pour chacun) + route entre deux chantiers du même jour' +
      (r.trajetsEstimes ? ' (certains trajets au forfait de ' + r.trajetForfait + ' min, affinés au prochain calcul)' : '') + '.</div>';
  }
  h += '<button class="btn sec" style="margin-top:4px" onclick="listeConges()">Congés et absences</button>' +
       '<button class="btn sec" style="margin-top:8px" onclick="ficheAdministratif()">Éléments variables de paie</button>' +
       '<button class="btn sec" style="margin-top:8px" onclick="ficheNotifs()">Notifications : ce téléphone et l\'équipe</button>';
  return h;
}
/* v108n — le numéro du client sur chaque intervention. Un appui appelle ;
   sur la carte, l'appui ne doit pas ouvrir la fiche en même temps. */
function lienTel(tel, contact){
  var t = String(tel || '').trim();
  if(!t) return '';
  return '<a class="chTel" href="tel:' + ech(t.replace(/[^\d+]/g, '')) + '" onclick="event.stopPropagation()">' +
    '<span aria-hidden="true">&#9742;</span> ' + ech(t) + (contact ? ' · ' + ech(contact) : '') + '</a>';
}
function blocTelFiche(c){
  return '<div class="card" style="margin-bottom:10px"><b>Téléphone du client</b>' +
    (c.tel ? '<div style="margin-top:8px;font-size:17px">' + lienTel(c.tel, c.contactTel) + '</div>'
           : '<div class="mini" style="margin-top:6px">Aucun numéro connu pour ce client.</div>') +
    '<div class="row" style="gap:8px;margin-top:10px;align-items:flex-end">' +
      '<div style="flex:1"><label>' + (c.tel ? 'Corriger le numéro' : 'Ajouter le numéro') + '</label>' +
      '<input id="adTelCli" type="tel" inputmode="tel" value="' + ech(c.tel || '') + '" placeholder="06 12 34 56 78"></div>' +
      '<button class="btn sec sm" style="width:auto" onclick="enregistrerTelClient(\'' + ech(String(c.id)).replace(/'/g,'&#39;') + '\', this)">Valider le numéro</button>' +
    '</div><div class="mini">Le numéro vaut pour toutes les interventions de ce client.</div></div>';
}
function enregistrerTelClient(id, btn){
  var moi = session(); if(!moi) return;
  var c = ((TABLEAU||{}).chantiers||[]).filter(function(x){ return String(x.id) === String(id); })[0];
  if(!c) return;
  var tel = ($('adTelCli')||{}).value || '';
  occuper(btn, 'Envoi…');
  poster({action:'telClient', nom:moi.nom, code:moi.code, appareil:APPAREIL, client:c.client, tel:tel}, 30000).then(function(r){
    libere(btn);
    if(!r || !r.ok){ erreur((r && r.erreur) || 'Le bureau n\'a pas pu enregistrer le numéro.'); return; }
    var cle = String(c.client||'').replace(/\s+[—–-]\s+.*$/, '').toUpperCase();
    ((TABLEAU||{}).chantiers||[]).forEach(function(x){
      if(String(x.client||'').replace(/\s+[—–-]\s+.*$/, '').toUpperCase() === cle) x.tel = r.tel;
    });
    peindreFicheChantier(c, false);
  }, function(){ libere(btn); erreur(attenteLisible()); });
}
function carteChantierAdmin(c){
  var manque = !c.date || !c.prestataire;
  var pris = !!AD_CHOIX[c.id];
  var n = natureVue(c.nature);
  return '<div class="card chC' + (pris ? ' adPris' : '') + '" ' +
    'data-ch="' + ech(c.id) + '" ' +
    (n ? 'style="--nT:' + n.t + ';--nF:' + n.f + ';--nI:' + n.i + '" ' : '') +
    'onclick="' +
    (AD_SEL ? 'choisirChantier(\'' + ech(c.id) + '\')' : 'ficheChantier(\'' + ech(c.id) + '\')') + '">' +
    '<div class="chTete">' +
      (AD_SEL ? '<span class="adCoche">' + (pris ? '\u2713' : '') + '</span>' : '') +
      '<b style="flex:1">' + ech(c.client||'Chantier') + '</b>' +
      badgeChantier(c) +
    '</div>' +
    '<div class="chSous">' +
      (c.heure ? '<b class="chH">' + ech(c.heure) + '</b>' : '') +
      (c.prestataire ? ech(quiLisible(c.prestataire)) : 'personne') +
      (c.ville ? ' · ' + ech(c.ville) : '') +
    '</div>' +
    (c.tel ? '<div class="mini" style="margin-top:4px">' + lienTel(c.tel) + '</div>' : '') +
    (n ? '<span class="chNat">' + ech(n.nom) + '</span>' : '') +
    (manque ? '<div class="mini" style="color:var(--warn)">À planifier</div>' : '') +
    /* Posé avant que le devis soit déclaré signé. Le salarié ne le voit pas :
       c'est du travail à faire, et l'état du papier n'est pas son affaire. */
    (c.avantSignature ? '<div class="mini" style="color:var(--warn)">Devis pas encore signé</div>' : '') +
    (c.signalement ? '<div class="mini" style="color:var(--danger)">Problème signalé</div>' : '') +
    blocDeplacerVite(c) +
  '</div>';
}

/* ---- agir sur plusieurs chantiers d'un coup ----
   Reporter une journée entière au lendemain, ou la passer à quelqu'un
   d'autre, se faisait chantier par chantier. En mode sélection, l'appui sur
   une carte la coche au lieu de l'ouvrir : c'est le seul geste qui change. */

function basculerSelection(){
  AD_SEL = !AD_SEL;
  AD_CHOIX = {};
  AD_LOT_PRESTA = null;
  peindreTableau();
}

function choisirChantier(id){
  if(AD_CHOIX[id]) delete AD_CHOIX[id]; else AD_CHOIX[id] = true;
  peindreTableau();
}

function nbChoisis(){
  var n = 0; for(var k in AD_CHOIX) if(AD_CHOIX.hasOwnProperty(k)) n++;
  return n;
}

function choisirPrestaLot(nom){
  AD_LOT_PRESTA = nom === '' ? '' : basculerQui(AD_LOT_PRESTA || '', nom);
  var gens = ((TABLEAU||{}).prestataires||[]);
  Array.prototype.forEach.call($('adLot').querySelectorAll('.puce'), function(e){
    var lib = e.textContent.trim();
    if(lib === 'Personne') e.classList.toggle('on', AD_LOT_PRESTA === '');
    else if(gens.indexOf(lib) >= 0) e.classList.toggle('on', aQui(AD_LOT_PRESTA, lib));
  });
}

function peindreLot(){
  var boite = $('adLot');
  var n = AD_SEL ? nbChoisis() : 0;
  boite.classList.toggle('hide', !AD_SEL);
  if(!AD_SEL) { boite.innerHTML = ''; return; }
  if(!n){
    boite.innerHTML = '<div class="mini" style="margin-top:0">Appuie sur les chantiers à déplacer. ' +
      'Un deuxième appui les retire.</div>';
    return;
  }
  var gens = ((TABLEAU||{}).prestataires||[]);
  boite.innerHTML =
    '<b>' + n + ' chantier' + (n>1?'s':'') + ' choisi' + (n>1?'s':'') + '</b>' +
    '<div class="mini">Ce qui reste vide n\'est pas touché.</div>' +
    '<label>Nouvelle date</label>' +
    '<input id="adLotDate" type="date">' +
    '<label>Nouvelle heure</label>' +
    '<input id="adLotHeure" type="time">' +
    '<label>Prestataire</label>' +
    '<div class="row" style="flex-wrap:wrap;gap:6px">' +
      gens.map(function(x){
        return '<span class="puce' + (AD_LOT_PRESTA!==null && aQui(AD_LOT_PRESTA, x)?' on':'') + '" onclick="choisirPrestaLot(\'' +
               ech(x).replace(/'/g,'&#39;') + '\')">' + ech(x) + '</span>';
      }).join('') +
      '<span class="puce' + (AD_LOT_PRESTA===''?' on':'') + '" onclick="choisirPrestaLot(\'\')">Personne</span>' +
    '</div>' +
    '<button class="btn" style="margin-top:12px" onclick="appliquerLot(false, this)">Appliquer</button>' +
    '<button class="btn sec" style="margin-top:8px;border-color:var(--rouge,#991b1b);' +
      'color:var(--rouge,#991b1b)" onclick="appliquerLot(true, this)">Annuler ces chantiers</button>';
}

function appliquerLot(annuler, btn){
  var ids = []; for(var k in AD_CHOIX) if(AD_CHOIX.hasOwnProperty(k)) ids.push(k);
  if(!ids.length) return;
  if(!navigator.onLine) return erreur('Hors connexion : cette action a besoin du réseau.');
  var date = val('adLotDate'), heure = val('adLotHeure');
  if(!annuler && !date && !heure && AD_LOT_PRESTA === null){
    return erreur('Choisis au moins une date, une heure ou un prestataire.');
  }
  if(annuler){
    return demander('Annuler ' + ids.length + ' chantier' + (ids.length>1?'s':'') + ' ?',
                    'Ils disparaîtront des téléphones. Les lignes restent au classeur.',
                    'Les annuler').then(function(oui){
      if(oui) poserLot(true, btn, ids, date, heure);
    });
  }
  poserLot(false, btn, ids, date, heure);
}

function poserLot(annuler, btn, ids, date, heure){
  var moi = session();
  erreur('');
  if(btn) occuper(btn, 'En cours…');
  var env = {action:'lotChantiers', nom:moi.nom, code:moi.code, appareil:APPAREIL, ids:ids};
  if(annuler) env.annuler = true;
  else {
    if(date) env.date = date;
    if(heure) env.heure = heure;
    if(AD_LOT_PRESTA !== null) env.prestataire = AD_LOT_PRESTA;
  }
  poster(env).then(function(r){
    if(btn) libere(btn);
    if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
    /* Sur un lot, l'échec d'une seule ligne passerait inaperçu : on le dit. */
    if(r.refus && r.refus.length){
      erreur(r.faits + ' modifié' + (r.faits>1?'s':'') + ', ' + r.refus.length +
             ' refusé' + (r.refus.length>1?'s':'') + ' — ' + r.refus[0]);
    }
    tracer(annuler ? 'CHANTIERS ANNULES' : 'CHANTIERS DEPLACES', ids.length + ' chantier(s)', '');
    AD_SEL = false; AD_CHOIX = {}; AD_LOT_PRESTA = null;
    chargerTableau();
  }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
}

/* ---- la fiche d'un devis ---- */

function ficheDevis(numero){
  var d = ((TABLEAU||{}).devis||[]).filter(function(x){ return x.numero === numero; })[0];
  if(!d) return;
  AD_FICHE = {type:'devis', cle:numero};
  montrer('eAd2');
  $('hTitre').textContent = 'Devis';
  erreur(''); window.scrollTo(0,0);
  peindreFicheDevis(d);
}

function peindreFicheDevis(d){
  $('adFiche').innerHTML =
    '<div class="card ' + ETATS_DEVIS[etatDevis(d)].classe + '">' +
      '<div style="display:flex;gap:10px;align-items:baseline">' +
        '<b style="flex:1;font-size:17px">' + ech(d.client||'—') + '</b>' + badgeDevis(d.statut) +
      '</div>' +
      '<div class="mini" style="margin-top:6px">' + ech(d.numero) + ' · ' + jjmmaa(d.date) + '</div>' +
      '<div class="mini">Établi par ' + ech(d.commercial) + (d.ville ? ' · ' + ech(d.ville) : '') + '</div>' +
      '<div class="mini dvMot">' + ech(motEtatDevis(d)) + '</div>' +
      '<div class="ch" style="margin-top:10px"><span style="color:var(--mut)">Total HT</span><b>' +
        eur(d.ht) + '</b></div>' +
      '<div class="ch gros"><span>Total TTC</span><span>' + eur(d.ttc) + '</span></div>' +
      (d.note ? '<div class="mini" style="margin-top:8px">Note du commercial : ' + ech(d.note) + '</div>' : '') +
      (d.placement && d.placement.date ? '<div class="mini" style="margin-top:8px">Placement suggéré (interne) : <b>' +
        ech(jjmmaa(d.placement.date)) + (d.placement.heure ? ' à ' + ech(d.placement.heure) : '') + '</b></div>' : '') +
      (d.pdf ? '<a class="btn sec" style="display:block;text-align:center;margin-top:12px;' +
        'text-decoration:none" href="' + ech(d.pdf) + '" target="_blank" rel="noopener">' +
        'Voir le devis (PDF)</a>' : '<div class="mini" style="margin-top:10px">Aucun PDF archivé.</div>') +
    '</div>' +

    '<div class="card">' +
      '<h2>Corriger le résultat</h2>' +
      '<div class="mini" style="margin-top:0">Ce que tu poses ici remplace ce qu\'a répondu le ' +
        'commercial, et part au journal à ton nom.</div>' +
      '<button class="choix" onclick="verdictAdmin(\'SIGNE\')"><b>Signé</b></button>' +
      '<button class="choix" onclick="verdictAdmin(\'RELANCE\')"><b>À relancer</b>' +
        '<span>Choisis la date ci-dessous.</span></button>' +
      '<button class="choix" onclick="verdictAdmin(\'REFUSE\')"><b>Refusé</b>' +
        '<span>Précise la raison ci-dessous.</span></button>' +
      '<label>Date de relance</label>' +
      '<input id="adRelance" type="date" value="' + ech(d.relance||'') + '">' +
      '<label>Raison du refus</label>' +
      '<input id="adMotif" placeholder="Trop cher, concurrent…" value="' + ech(d.motif||'') + '">' +
    '</div>' +

    blocModifierDevis(d) +
    blocSignatureDistance(d, 'admin') +
    blocPoserTravail(d) +

    /* Repartir de ce devis : même client, mêmes prestations, un devis neuf à
       son nom. Le client rappelle souvent pour une autre adresse ou une autre
       date — le retaper serait du temps perdu. */
    '<button class="btn sec" style="margin-bottom:10px" onclick="devisDepuisFiche(this)">' +
      'Refaire un devis pour ce client</button>' +
    '<button class="btn sec" onclick="retourTableau()">Retour au tableau</button>';
}

/* v108e — corriger un devis déjà établi : ajouter ou retirer des prestations,
   changer une quantité, l'adresse, la date. Même numéro, et le client reçoit
   le devis corrigé si la case d'envoi est cochée. Un devis signé n'y a pas
   droit : le client a accepté un montant. */
function blocModifierDevis(d){
  if(String(d.statut || '').toUpperCase() === 'SIGNE') return '';
  return '<div class="card"><h2>Modifier ce devis</h2>' +
    '<div class="mini" style="margin-top:0">Ajoute ou retire des prestations, change une quantité, ' +
    'l\'adresse ou la date. Le devis garde son numéro et ses prix ; s\'il part par e-mail, ' +
    'le client reçoit la version corrigée.</div>' +
    '<button class="btn" style="margin-top:12px" onclick="modifierDepuisFiche(this)">Modifier ce devis</button>' +
  '</div>';
}

/* ---- POSER LE TRAVAIL SANS ATTENDRE LA SIGNATURE ----

   Un chantier naît normalement d'un devis signé. Mais le commercial ne déclare
   pas toujours la signature en temps et en heure, et pendant ce temps le client
   attend sa date et le salarié n'a rien à faire. Le gérant peut donc poser le
   planning lui-même — ce qui n'est pas la même chose que déclarer le devis
   signé : le devis garde son statut et son absence de preuve.

   Réservé au gérant, et c'est le classeur qui le tient, pas cet écran. */
function blocPoserTravail(d){
  var st = String(d.statut || '').toUpperCase();
  /* v93 — un devis d'entretien devient un contrat au calendrier, d'un appui :
     le formulaire s'ouvre rempli avec le client, l'adresse, la nature et le
     rythme du devis. */
  if(d.recurrent && st !== 'REFUSE'){
    if(d.contrat){
      return '<div class="card"><h2>Le contrat</h2>' +
        '<div class="mini" style="margin-top:0">Ce devis est au calendrier : contrat <b>' + ech(d.contrat) +
        '</b>. Ses passages se posent tout seuls, semaine après semaine.</div>' +
        '<button class="btn sec" style="margin-top:12px" onclick="listeContrats()">Voir les contrats</button></div>';
    }
    return '<div class="card" style="border-color:var(--warn)"><h2>Mettre au calendrier</h2>' +
      '<div class="mini" style="margin-top:0">Devis d\'entretien' +
      (d.passagesMois ? ' · ' + d.passagesMois + ' passage' + (d.passagesMois > 1 ? 's' : '') + ' par mois' : '') +
      (d.mensuel ? ' · ' + eur(d.mensuel) + ' HT par mois' : '') +
      '. Pas encore de contrat : ses passages ne se répètent pas tout seuls.</div>' +
      (st === 'SIGNE' ? '' : '<div class="mini">Il n\'est pas encore déclaré signé : le contrat peut ' +
        'quand même être posé, le devis garde son statut.</div>') +
      '<button class="btn" style="margin-top:12px" onclick="contratDepuisFiche()">Mettre au calendrier comme contrat</button>' +
    '</div>';
  }
  if(st === 'SIGNE'){
    return '<div class="card"><h2>Le travail</h2>' +
      '<div class="mini" style="margin-top:0">Ce devis est signé : ses interventions sont dans le Planning. ' +
      'Celles sans date attendent dans le bac « à placer » ; ouvre-les pour voir les créneaux proposés.</div></div>';
  }
  if(st === 'REFUSE'){
    return '<div class="card"><h2>Le travail</h2>' +
      '<div class="mini" style="margin-top:0">Ce devis est refusé. Si le client revient, ' +
      'corrige d\'abord son résultat ci-dessus.</div></div>';
  }
  var deja = Number(d.poses || 0);
  return '<div class="card">' +
    '<h2>Poser le travail sans attendre</h2>' +
    '<div class="mini" style="margin-top:0">' +
      (deja
        ? deja + ' intervention' + (deja>1?'s':'') + ' déjà posée' + (deja>1?'s':'') +
          ' pour ce devis. Tu peux relancer pour compléter ce qui n\'a pas encore de date.'
        : 'Le client a dit oui mais le devis n\'est pas encore déclaré signé. ' +
          'Tu peux poser ses interventions tout de suite : le salarié les verra ' +
          'comme n\'importe quel chantier.') +
    '</div>' +
    '<div class="mini">Le devis, lui, ne bouge pas : il garde son statut et son numéro.</div>' +
    '<button class="btn sec" style="margin-top:12px" onclick="poserTravail(this)">' +
      (deja ? 'Compléter le planning' : 'Poser le travail maintenant') + '</button>' +
  '</div>';
}

function poserTravail(btn){
  var f = AD_FICHE;
  if(!f || f.type !== 'devis') return;
  if(!navigator.onLine) return erreur('Hors connexion : impossible de poser un planning maintenant.');
  var d = ((TABLEAU||{}).devis||[]).filter(function(x){ return x.numero === f.cle; })[0] || {};
  erreur('');
  demander('Poser le travail de ce devis ?',
           'Il n\'est pas déclaré signé. Les interventions seront posées et attribuées ' +
           'comme pour un devis signé, et le devis gardera son statut actuel.',
           'Poser le travail').then(function(oui){
    if(!oui) return;
    var moi = session();
    if(btn) occuper(btn, 'Pose en cours…');
    poster({action:'poserDevis', nom:moi.nom, code:moi.code, appareil:APPAREIL,
            numero:f.cle}, 60000).then(function(r){
      if(btn) libere(btn);
      if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
      tracer('TRAVAIL POSE AVANT SIGNATURE', f.cle, f.cle);
      var mot = r.poses
        ? r.poses + ' intervention' + (r.poses>1?'s':'') + ' posée' + (r.poses>1?'s':'') + '.'
        : 'Aucune intervention n\'a pu être posée' + (r.motif ? ' : ' + r.motif : '') + '.';
      if(r.refuses) mot += ' ' + r.refuses + ' sans créneau, à poser à la main.';
      erreur(mot);
      chargerTableau();
    }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
  });
}

function verdictAdmin(type){
  var f = AD_FICHE;
  if(!f || f.type !== 'devis') return;
  var moi = session();
  var corps = {action:'statut', nom:moi.nom, code:moi.code, appareil:APPAREIL,
               numero:f.cle, verdict:type, quand:Date.now()};
  if(type === 'RELANCE'){
    corps.relance = val('adRelance');
    if(!corps.relance) return erreur('Choisis une date de relance.');
  }
  if(type === 'REFUSE'){
    corps.motif = val('adMotif');
    if(!corps.motif) return erreur('Précise la raison du refus.');
  }
  if(!navigator.onLine) return erreur('Hors connexion : impossible de corriger un résultat maintenant.');
  erreur('');
  poster(corps).then(function(r){
    if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
    tracer('RESULTAT ' + type, f.cle, f.cle);
    // On met à jour la copie locale tout de suite : l'écran doit dire la
    // vérité sans attendre le prochain rafraîchissement.
    ((TABLEAU||{}).devis||[]).forEach(function(x){
      if(x.numero !== f.cle) return;
      x.statut = type === 'SIGNE' ? 'SIGNE' : (type === 'RELANCE' ? 'A RELANCER' : 'REFUSE');
      x.motif = corps.motif || '';
      x.relance = corps.relance || '';
    });
    try{ lsj('tableau', TABLEAU); }catch(e){}
    rouvrirFiche();
    chargerTableau();
  }, function(){ erreur(attenteLisible()); });
}

/* ---- la fiche d'un chantier, et sa planification ---- */

function ficheChantier(id){
  var c = ((TABLEAU||{}).chantiers||[]).filter(function(x){ return x.id === id; })[0];
  if(!c) return;
  if(c.enVol) return erreur('« ' + (c.client || 'Intervention') + ' » part au bureau, une seconde…');
  AD_FICHE = {type:'chantier', cle:id};
  AD_PRESTA = c.prestataire || '';
  AD_NATURE = String(c.nature || '').toUpperCase();
  montrer('eAd2');
  $('hTitre').textContent = 'Chantier';
  erreur(''); window.scrollTo(0,0);
  peindreFicheChantier(c, false);
  /* v106 — « trop de latence quand je choisis ». La fiche demandait aussi des
     créneaux au bureau (3 à 10 s, « Recherche de créneaux libres… ») alors
     que l'appli calcule les siens sur place depuis la v103, instantanément,
     en tenant compte des fériés et des congés : on ne garde que ceux-là. */
  try{ peindreChoixDate(c, !c.date || !c.prestataire); }catch(e){}
}

/* v99 — le placement automatique est coupé : Simon choisit. L'appli propose
   trois créneaux (salarié le moins chargé, jours travaillés, route) ; un
   appui remplit la date, l'heure et la personne, rien n'est enregistré tant
   qu'il n'a pas appuyé sur « Enregistrer ». */
var AD_SUGG = [];
function chargerSuggestions(id){
  var moi = session();
  var zone = $('adSugg');
  if(!moi || !zone || !navigator.onLine) return;
  zone.innerHTML = '<div class="mini">Recherche de créneaux libres…</div>';
  poster({action:'suggestions', id:id, nom:moi.nom, code:moi.code, appareil:APPAREIL}, 45000).then(function(r){
    var z = $('adSugg');
    if(!z) return;
    if(!r || !r.ok){ z.innerHTML = ''; return; }
    AD_SUGG = r.suggestions || [];
    if(!AD_SUGG.length){
      z.innerHTML = '<div class="mini">' + ech(r.motif || 'Aucun créneau libre trouvé dans les 60 jours.') + '</div>';
      return;
    }
    z.innerHTML = '<label>Créneaux proposés</label><div class="row" style="flex-wrap:wrap;gap:6px">' +
      AD_SUGG.map(function(sg, i){
        return '<span class="puce" onclick="prendreSuggestion(' + i + ')">' +
          (sg.devis ? '★ ' : '') + ech(sg.jour) + (sg.heure ? ' · ' + ech(sg.heure) : '') +
          (sg.nom ? ' · ' + ech(sg.nom) : '') + (sg.devis ? ' (suggéré au devis)' : '') + '</span>';
      }).join('') + '</div><div class="mini">Un appui remplit la date, l\'heure et la personne. ' +
      'Ajoute le second du binôme si besoin, puis Enregistrer.</div>';
  }, function(){ var z = $('adSugg'); if(z) z.innerHTML = ''; });
}
function prendreSuggestion(i){
  var sg = AD_SUGG[i];
  if(!sg) return;
  if($('adDate')) $('adDate').value = sg.date;
  if($('adHeure') && sg.heure) $('adHeure').value = sg.heure;
  if(sg.nom){ AD_PRESTA = ''; choisirPresta(sg.nom); }
  Array.prototype.forEach.call(document.querySelectorAll('#adSugg .puce'), function(e, k){
    e.classList.toggle('on', k === i);
  });
}

/* Le nouveau chantier passe désormais par le formulaire « Nouvel événement »
   (plus bas), qui pose un ponctuel quand la récurrence vaut « Jamais ». */

function choisirNatureAd(v){
  AD_NATURE = v;
  var noms = {}; NATURES_CHOIX.forEach(function(x){ noms[x.n] = x.v; });
  Array.prototype.forEach.call($('adFiche').querySelectorAll('.puce'), function(e){
    var lib = e.textContent.trim();
    if(!(lib in noms) && lib !== 'Aucune') return;     // les pastilles des prestataires
    e.classList.toggle('on', (noms[lib] || '') === v);
  });
}

/* Ce que la fiche envoie : les champs d'identité, toujours tous, pour qu'un
   champ vidé exprès le reste. */
function champsFicheChantier(){
  return { client: val('adClient'), adresse: val('adAdresse'), cp: val('adCp'),
           ville: val('adVille'), acces: val('adAcces'), note: val('adNote'),
           nature: AD_NATURE, date: val('adDate'), heure: val('adHeure'),
           prestataire: AD_PRESTA };
}

function creerLeChantier(btn){
  if(!navigator.onLine) return erreur('Hors connexion : créer un chantier a besoin du réseau.');
  var c = champsFicheChantier();
  if(!String(c.client || '').trim()) return erreur('Il faut au moins un nom de client.');
  posterChantierNeuf(c, btn);
}

/* Annuler, ou rétablir. Une annulation se confirme : c'est un rendez-vous
   chez un client, et l'appui est à portée de pouce. */
function annulerChantierAd(annuler, btn){
  var f = AD_FICHE;
  if(!f || f.type !== 'chantier') return;
  if(!navigator.onLine) return erreur('Hors connexion : cette action a besoin du réseau.');
  /* La confirmation de l'application, jamais celle du navigateur : installée
     sur l'écran d'accueil, confirm() peut répondre « non » tout seul. */
  if(!annuler) return poserAnnulation(false, btn);
  /* Un chantier pointé mérite un avertissement différent : on ne lui retire
     pas ses heures, et il faut le dire avant plutôt que de le faire découvrir. */
  var ch = ((TABLEAU||{}).chantiers||[]).filter(function(x){ return x.id === f.cle; })[0] || {};
  var pointe = !!ch.arrivee;
  demander('Annuler ce chantier ?',
           pointe
             ? 'Il a été pointé. Il disparaîtra des téléphones et du planning, mais ses heures ' +
               'restent au classeur pour la paie et la facturation. Tu pourras le rétablir.'
             : 'Il disparaîtra des téléphones. La ligne reste au classeur, et tu pourras ' +
               'le rétablir.', 'Annuler le chantier').then(function(oui){
    if(oui) poserAnnulation(true, btn);
  });
}

function poserAnnulation(annuler, btn){
  var f = AD_FICHE;
  if(!f || f.type !== 'chantier') return;
  var moi = session();
  erreur('');
  if(btn) occuper(btn, annuler ? 'Annulation…' : 'Rétablissement…');
  var env = {action:'planifier', nom:moi.nom, code:moi.code, appareil:APPAREIL, id:f.cle};
  if(annuler) env.annuler = true; else env.retablir = true;
  poster(env).then(function(r){
    if(btn) libere(btn);
    if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
    tracer(annuler ? 'CHANTIER ANNULE' : 'CHANTIER RETABLI', '', f.cle);
    direNotifs(r);
    retourTableau();
    chargerTableau();
  }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
}

/* Les cinq natures, proposées à l'écran du gérant comme au devis. */
var NATURES_CHOIX = [
  {v:'ENTRETIEN', n:'Entretien'}, {v:'VITRERIE', n:'Vitrages'},
  {v:'CHANTIER', n:'Fin de chantier'}, {v:'REMISE', n:'Remise en état'},
  {v:'FACADE', n:'Façade'}
];

/* La fiche d'un chantier, qu'il existe déjà ou qu'on soit en train de le
   créer. Le même formulaire sert aux deux : un chantier posé à la main n'est
   pas d'une autre espèce, il n'a simplement pas de devis derrière lui. */
function peindreFicheChantier(c, neuf){
  var gens = ((TABLEAU||{}).prestataires||[]);
  var annule = String(c.statut||'').toUpperCase() === 'ANNULE';
  var pointe = !!c.arrivee;
  var champ = function(id, lib, val, type){
    return '<label>' + lib + '</label><input id="' + id + '" type="' + (type||'text') +
           '" value="' + ech(val||'') + '">';
  };

  $('adFiche').innerHTML =
    (neuf ? '' :
      '<div class="card">' +
        '<div style="display:flex;gap:10px;align-items:baseline">' +
          '<b style="flex:1;font-size:17px">' + ech(c.client||'Chantier') + '</b>' + badgeChantier(c) +
        '</div>' +
        (c.numero ? '<div class="mini" style="margin-top:6px">' + ech(c.numero) + '</div>' : '') +
        (c.arrivee ? '<div class="mini" style="margin-top:8px">Arrivé à ' + heureLisible(c.arrivee) +
          (c.depart ? ', parti à ' + heureLisible(c.depart) + ' · ' + dureeLisible(c.minutes) : '') +
          '</div>' : '') +
        (c.signalement ? '<div class="err" style="margin-top:10px">Problème signalé : ' +
          ech(c.signalement) + '</div>' : '') +
        (annule ? '<div class="err" style="margin-top:10px">Ce chantier est annulé. ' +
          'Il n\'apparaît sur aucun téléphone.</div>' : '') +
        (c.avantSignature ? '<div class="mini" style="margin-top:10px;color:var(--warn)">' +
          'Posé avant que le devis soit déclaré signé. Le salarié le voit comme un ' +
          'chantier ordinaire ; un refus ne l\'enlèvera pas tout seul.</div>' : '') +
      '</div>') +
    (neuf ? '' : blocTelFiche(c)) +
    (neuf ? '' : blocContratFiche(c)) +
    (neuf ? '' : blocFicheChantier(c)) +

    '<div class="card">' +
      '<h2>' + (neuf ? 'Le nouveau chantier' : 'Le chantier') + '</h2>' +
      champ('adClient', 'Client', c.client) +
      champ('adAdresse', 'Adresse', c.adresse) +
      '<div class="row" style="gap:8px">' +
        '<div style="width:110px">' + champ('adCp', 'Code postal', c.cp) + '</div>' +
        '<div style="flex:1">' + champ('adVille', 'Ville', c.ville) + '</div>' +
      '</div>' +
      '<label>Accès au site</label>' +
      '<input id="adAcces" type="text" value="' + ech(c.acces||'') + '" ' +
        'placeholder="Code portail, où est la clé…">' +
      '<label>Ce qu\'il y a à faire</label>' +
      '<textarea id="adNote" rows="3" placeholder="Ce que le salarié verra en arrivant">' +
        ech(c.note||'') + '</textarea>' +
      '<label>Nature</label>' +
      '<div class="row" style="flex-wrap:wrap;gap:6px">' +
        NATURES_CHOIX.map(function(x){
          return '<span class="puce' + (AD_NATURE===x.v?' on':'') + '" onclick="choisirNatureAd(\'' +
                 x.v + '\')">' + ech(x.n) + '</span>';
        }).join('') +
        '<span class="puce' + (AD_NATURE===''?' on':'') + '" onclick="choisirNatureAd(\'\')">Aucune</span>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<h2>Planifier</h2>' +
      '<div class="mini" style="margin-top:0">Tant que la date et la personne ne sont pas posées, ' +
        'le chantier n\'apparaît sur aucun téléphone.</div>' +
      '<label>Date</label>' +
      '<input id="adDate" type="date" value="' + ech(c.date||'') + '">' +
      '<label>Heure</label>' +
      '<input id="adHeure" type="time" value="' + ech(c.heure||'') + '">' +
      '<div id="adSugg"></div>' +
      (neuf ? '' : '<div id="adSuggLoc"></div><div id="adMiniCal"></div>') +
      '<label>Intervenants <span class="mini">(un ou plusieurs)</span></label>' +
      '<div class="row" style="flex-wrap:wrap;gap:6px">' +
        gens.map(function(n){
          return '<span class="puce' + (aQui(AD_PRESTA, n)?' on':'') + '" onclick="choisirPresta(\'' +
                 ech(n).replace(/'/g,'&#39;') + '\')">' + ech(n) + '</span>';
        }).join('') +
        '<span class="puce' + (AD_PRESTA===''?' on':'') + '" onclick="choisirPresta(\'\')">Personne</span>' +
      '</div>' +
      '<button class="btn" style="margin-top:14px" id="bAdEnr" ' +
        'onclick="' + (neuf ? 'creerLeChantier(this)' : 'enregistrerPlanif(this)') + '">' +
        (neuf ? 'Créer le chantier' : 'Enregistrer') + '</button>' +
    '</div>' +

    /* Annuler plutôt que supprimer : la ligne reste au classeur, et un passage
       de contrat récurrent annulé ne revient pas à la génération suivante. */
    (neuf ? '' :
      '<div class="card">' +
        (annule
          ? '<div class="mini" style="margin-top:0">Rétabli, il reprendra sa place dans le planning.</div>' +
            '<button class="btn sec" style="margin-top:10px" onclick="annulerChantierAd(false, this)">' +
            'Rétablir ce chantier</button>'
          : '<div class="mini" style="margin-top:0">' +
            (pointe
              ? 'Annulé, il disparaît des téléphones et de ce tableau. <b>Les heures pointées ' +
                'restent au classeur</b> : la paie et la facturation ne bougent pas.'
              : 'Annulé, il disparaît des téléphones et de ce tableau. La ligne reste au classeur, ' +
                'et un passage de contrat ne reviendra pas.') + '</div>' +
            '<button class="btn sec" style="margin-top:10px;border-color:var(--rouge,#991b1b);' +
            'color:var(--rouge,#991b1b)" onclick="annulerChantierAd(true, this)">' +
            'Annuler ce chantier</button>') +
      '</div>') +

    '<button class="btn sec" onclick="retourTableau()">Retour au tableau</button>';
}

/* On ne redessine pas la fiche : la date et l'heure déjà tapées seraient
   effacées par les valeurs d'origine. Seules les pastilles changent d'état. */
function choisirPresta(nom){
  AD_PRESTA = basculerQui(AD_PRESTA, nom);
  var gens = ((TABLEAU||{}).prestataires||[]);
  Array.prototype.forEach.call($('adFiche').querySelectorAll('.puce'), function(e){
    var lib = e.textContent.trim();
    if(lib === 'Personne') e.classList.toggle('on', !AD_PRESTA);
    else if(gens.indexOf(lib) >= 0) e.classList.toggle('on', aQui(AD_PRESTA, lib));
  });
}

function enregistrerPlanif(btn, portee){
  var f = AD_FICHE;
  if(!f || f.type !== 'chantier') return;
  if(!navigator.onLine) return erreur('Hors connexion : la planification a besoin du réseau.');
  var moi = session();
  erreur('');
  var c = champsFicheChantier();
  /* v108j — « pour le récurrent, quand je modifie une intervention, je veux
     choisir si je décale toutes les prochaines au même jour de la semaine ou
     juste exceptionnellement ». Un passage de contrat dont le jour, l'heure ou
     la personne change : on demande. */
  var x0 = chantierDuTableau(f.cle);
  if(!portee && x0 && x0.recurrent && (c.date !== x0.date || c.heure !== x0.heure || c.prestataire !== x0.prestataire)){
    var idS = String(x0.recurrent).split('|')[0];
    if(contratDe(x0.recurrent)){
      return demanderPortee().then(function(p){
        if(p === 'ce') return enregistrerPlanif(btn, 'ce');
        if(p === 'suivants') return decalerSuivants(idS, x0, c);
      });
    }
  }
  if(btn) occuper(btn, 'Enregistrement…');
  if(!String(c.client || '').trim()) { if(btn) libere(btn); return erreur('Il faut au moins un nom de client.'); }
  var env = {action:'planifier', nom:moi.nom, code:moi.code, appareil:APPAREIL, id:f.cle};
  for(var k in c) if(c.hasOwnProperty(k)) env[k] = c[k];
  /* v105 — « trop de latence quand j'ajoute ou modifie une intervention ».
     L'écran n'attend plus le bureau : la fiche se ferme tout de suite sur le
     planning déjà corrigé, l'envoi part derrière. Si le bureau refuse, on
     remet ce qui était affiché et on le dit. */
  var id = f.cle, x = chantierDuTableau(id);
  if(btn) libere(btn);
  if(!x) return;
  var champs = { date:c.date, heure:c.heure, prestataire:c.prestataire, client:c.client, adresse:c.adresse,
                 cp:c.cp, ville:c.ville, acces:c.acces, note:c.note, nature:c.nature };
  var stA = String(x.statut||'').toUpperCase();
  if(stA === 'A PLANIFIER' || stA === 'PLANIFIE' || !stA) champs.statut = (c.date && c.prestataire) ? 'PLANIFIE' : 'A PLANIFIER';
  var avant = {};
  for(var k1 in champs) avant[k1] = x[k1];
  for(var k2 in champs) x[k2] = champs[k2];
  EN_VOL.maj[id] = champs;
  try{ lsj('tableau', TABLEAU); }catch(e){}
  AD_MOT_T = 0; AD_MOT = 'Enregistré : ' + (c.client || 'intervention');
  retourTableau();
  poster(env).then(function(r){
    if(EN_VOL.maj[id] === champs) delete EN_VOL.maj[id];
    if(!r || !r.ok) return defaireEnVol(id, avant, (r && r.erreur) ? String(r.erreur) : attenteLisible());
    tracer('CHANTIER PLANIFIE', c.prestataire + ' ' + c.date, id);
    direNotifs(r);
    var x2 = chantierDuTableau(id);
    if(x2 && r.statut) x2.statut = r.statut;
    chargerTableauBientot();
  }, function(){
    if(EN_VOL.maj[id] === champs) delete EN_VOL.maj[id];
    defaireEnVol(id, avant, attenteLisible());
  });
}

/* Ce qui est parti au bureau sans réponse encore : réappliqué à chaque
   rafraîchissement du tableau, pour qu'une lecture partie avant l'écriture
   ne fasse pas « revenir » l'ancienne version à l'écran. */
var EN_VOL = { neufs: [], maj: {} };
/* v106 — plusieurs enregistrements coup sur coup ne relancent qu'une relecture
   du tableau (la plus lourde des demandes au bureau), deux secondes après le
   dernier. */
var RELIRE_T = null;
function chargerTableauBientot(){
  if(RELIRE_T) clearTimeout(RELIRE_T);
  RELIRE_T = setTimeout(function(){ RELIRE_T = null; chargerTableau(); }, 2000);
}
function appliquerEnVol(t){
  if(!t || !t.chantiers) return;
  t.chantiers.forEach(function(x){
    var m = EN_VOL.maj[x.id];
    if(m) for(var k in m) if(m.hasOwnProperty(k)) x[k] = m[k];
  });
  EN_VOL.neufs.forEach(function(n){
    if(!t.chantiers.some(function(x){ return x.id === n.id; })) t.chantiers.push(n);
  });
}
function defaireEnVol(id, avant, motif){
  var x = chantierDuTableau(id);
  if(x) for(var k in avant) if(avant.hasOwnProperty(k)) x[k] = avant[k];
  try{ lsj('tableau', TABLEAU); }catch(e){}
  if(!AD_FICHE) peindreTableau();
  erreur('Pas enregistré pour « ' + ((x && x.client) || 'l\'intervention') + ' » : ' + motif + ' — recommence.');
}

function rouvrirFiche(){
  var f = AD_FICHE;
  if(!f) return;
  if(f.type === 'conges'){ peindreConges(); return; }
  if(f.type === 'admin'){ peindreAdministratif(); return; }
  if(f.type === 'feries'){ peindreFeries(); return; }
  if(f.type === 'notifs'){ peindreEtatNotifs(); return; }
  if(f.type === 'contrats') return;
  if(f.type === 'devis'){
    var d = ((TABLEAU||{}).devis||[]).filter(function(x){ return x.numero === f.cle; })[0];
    if(d) peindreFicheDevis(d);
  } else {
    var c = ((TABLEAU||{}).chantiers||[]).filter(function(x){ return x.id === f.cle; })[0];
    if(c) peindreFicheChantier(c);
  }
}

function retourTableau(){
  AD_FICHE = null;
  ecranAdmin();
}


/* ====================== NOUVEL ÉVÉNEMENT, À LA FAMILYWALL ======================
   Demande de Simon, 7 novembre 2026 : « je veux juste pouvoir ajouter un
   contrat récurrent comme sur FamilyWall, sur notre app ». Le formulaire
   reprend celui de FamilyWall, dans son ordre : titre, de / à, toute la
   journée, couleur, participant, récurrence, jusqu'au, où, description.

   Un seul bouton « + Nouveau » : « Récurrence : Jamais » pose un chantier
   ponctuel, comme avant ; tout autre choix crée un contrat (onglet RECURRENTS)
   et ses passages des semaines qui viennent. C'est le geste de FamilyWall —
   on ne choisit pas entre deux formulaires, on règle la répétition.

   Le même formulaire sert à modifier un contrat « à partir de » un passage :
   le passé reste tel qu'il a été pointé, la suite est reposée. */

var CT = null;          // l'état du formulaire ouvert
var JOURS_COURTS = [{n:1,l:'L'},{n:2,l:'M'},{n:3,l:'M'},{n:4,l:'J'},{n:5,l:'V'},{n:6,l:'S'},{n:0,l:'D'}];
var JOURS_LONGS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
var JOURS_SERIE = ['DIMANCHE','LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI'];

var RECURRENCES = [
  {v:'JAMAIS',   l:'Jamais'},
  {v:'SEMAINE',  l:'Toutes les semaines'},
  {v:'OUVRES',   l:'Tous les jours de la semaine (lun. – ven.)'},
  {v:'SIX',      l:'6 fois par semaine (lun. – sam.)'},
  {v:'SEPT',     l:'7 fois par semaine (tous les jours)'},
  {v:'QUINZAINE',l:'Toutes les 2 semaines'},
  {v:'MOIS',     l:'Tous les mois'},
  {v:'MOIS2',    l:'Tous les 2 mois'},
  {v:'PERSO',    l:'Personnalisée (choisir les jours)'}
];

function jourDe(iso){
  var p = String(iso||'').split('-');
  var d = new Date(Number(p[0]), Number(p[1])-1, Number(p[2]), 12);
  return isNaN(d.getTime()) ? new Date() : d;
}
function rangDuJour(iso){
  var d = jourDe(iso), r = Math.floor((d.getDate()-1)/7) + 1;
  return r > 4 ? 5 : r;
}
function libelleRang(r){ return r === 5 ? 'dernier' : (r === 1 ? '1er' : r + 'e'); }
function minutesDe(h){
  var m = String(h||'').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1])*60 + Number(m[2]) : null;
}
function heureDe(mn){
  mn = ((mn % 1440) + 1440) % 1440;
  return ('0' + Math.floor(mn/60)).slice(-2) + ':' + ('0' + (mn%60)).slice(-2);
}

/* Le rythme d'un contrat, en toutes lettres : « Toutes les 2 semaines, le
   jeudi à 10:30 ». C'est ce que la fiche et la liste des contrats affichent. */
function libelleRythme(s){
  if(!s) return '';
  var f = String(s.frequence||'').toUpperCase(), j = String(s.jour||'').toLowerCase();
  var txt;
  if(f === 'HEBDO') txt = 'Toutes les semaines' + (j ? ', le ' + j : '');
  else if(f === 'QUINZAINE') txt = 'Toutes les 2 semaines' + (j ? ', le ' + j : '');
  else if(f === 'MENSUEL'){
    var pas = Number(s.intervalle||1);
    txt = (pas > 1 ? 'Tous les ' + pas + ' mois' : 'Tous les mois') +
      (j ? ', le ' + libelleRang(Number(s.jourMois)) + ' ' + j
         : (s.jourMois ? ', le ' + s.jourMois : ''));
  } else txt = f || 'Rythme inconnu';
  if(s.heure) txt += ' à ' + s.heure;
  return txt;
}

function contratDe(cle){
  var id = String(cle||'').split('|')[0];
  return ((TABLEAU||{}).recurrents||[]).filter(function(s){ return s.id === id; })[0] || null;
}

/* ---- ouvrir le formulaire ---- */

/* Nouveau : la date du jour, l'heure ronde qui vient, une heure de durée —
   comme FamilyWall, qui propose toujours un créneau plutôt qu'un vide. */
function nouveauChantier(iso){
  var h = new Date(); h.setMinutes(0,0,0); h.setHours(h.getHours()+1);
  var debut = (typeof iso === 'string' && iso) ? iso : isoJour();
  CT = { mode:'neuf', client:'', adresse:'', cp:'', ville:'', acces:'', note:'',
         nature:'', prestataire:'', date:debut, heure:heureDe(h.getHours()*60),
         fin:heureDe(h.getHours()*60 + 60), journee:false,
         rec:'JAMAIS', jours:[jourDe(debut).getDay()], mensuel:'JOUR', jusquA:'' };
  ouvrirContrat('Nouvel événement');
}

/* Modifier un contrat à partir d'un passage (ou d'aujourd'hui depuis la liste
   des contrats). La fiche part de ce que dit la série. */
function modifierContrat(id, aPartirDe){
  var s = ((TABLEAU||{}).recurrents||[]).filter(function(x){ return x.id === id; })[0];
  if(!s) return erreur('Ce contrat n\'est pas dans le tableau. Appuie sur « Actualiser ».');
  var depuis = aPartirDe && aPartirDe > isoJour() ? aPartirDe : isoJour();
  var f = String(s.frequence||'').toUpperCase();
  var rec = f === 'HEBDO' ? 'SEMAINE' : (f === 'QUINZAINE' ? 'QUINZAINE'
          : (Number(s.intervalle||1) === 2 ? 'MOIS2' : 'MOIS'));
  var jw = JOURS_SERIE.indexOf(String(s.jour||'').toUpperCase());
  var debut = s.debut && s.debut > depuis ? s.debut : depuis;
  var hDeb = minutesDe(s.heure);
  CT = { mode:'modif', id:id, depuis:depuis,
         client:s.client||'', adresse:s.adresse||'', cp:s.cp||'', ville:s.ville||'',
         acces:s.acces||'', note:s.prestations||'', nature:s.nature||'',
         prestataire:s.prestataire||'', date:debut,
         heure:s.heure||'', fin: (hDeb !== null && s.duree) ? heureDe(hDeb + Number(s.duree)) : '',
         journee: !s.heure, rec:rec, jours: jw >= 0 ? [jw] : [jourDe(debut).getDay()],
         mensuel: (f === 'MENSUEL' && jw >= 0) ? 'RANG' : 'JOUR',
         jourMois: s.jourMois || '', jusquA: s.fin || '' };
  ouvrirContrat('Modifier le contrat');
}

/* v93 — le contrat d'un devis d'entretien. Le rythme se déduit des passages
   par mois du devis, comme au classeur : 1 → tous les mois, 2 ou 3 → toutes
   les 2 semaines, au-delà → chaque semaine, sur autant de jours que de
   passages par semaine (4,33 semaines par mois). Si des interventions sont
   déjà posées, la première donne le jour, l'heure et la personne. */
function contratDepuisFiche(){
  var f = AD_FICHE;
  if(!f || f.type !== 'devis') return;
  var d = ((TABLEAU||{}).devis||[]).filter(function(x){ return x.numero === f.cle; })[0];
  if(!d) return;
  var n = Number(d.passagesMois || 0) || 4;
  var rec = 'SEMAINE', nbJours = 1;
  if(n <= 1) rec = 'MOIS';
  else if(n <= 3) rec = 'QUINZAINE';
  else {
    nbJours = Math.max(1, Math.min(7, Math.round(n / 4.33)));
    rec = nbJours === 5 ? 'OUVRES' : (nbJours === 6 ? 'SIX' : (nbJours === 7 ? 'SEPT' : (nbJours > 1 ? 'PERSO' : 'SEMAINE')));
  }
  var poses = ((TABLEAU||{}).chantiers||[]).filter(function(c){
    return c.numero === d.numero && c.date && !estAnnule(c);
  }).sort(function(a, b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  var p0 = poses[0] || null;
  var ordre = [1, 4, 2, 5, 3, 6, 0];             // lundi, jeudi, mardi, vendredi, mercredi, samedi, dimanche
  var jours = p0 ? [jourDe(p0.date).getDay()] : [ordre[0]];
  ordre.forEach(function(j){ if(jours.length < nbJours && jours.indexOf(j) < 0) jours.push(j); });
  /* Le premier passage : celui déjà posé s'il vient, sinon le prochain jour
     choisi à partir de demain. */
  var debut;
  if(p0 && p0.date >= isoJour()) debut = p0.date;
  else {
    var x = new Date(); x.setHours(12,0,0,0); x.setDate(x.getDate() + 1);
    for(var i = 0; i < 14 && jours.indexOf(x.getDay()) < 0; i++) x.setDate(x.getDate() + 1);
    debut = isoJour(x);
  }
  var hDeb = p0 && p0.heure ? p0.heure : '08:00';
  var duree = p0 && p0.duree ? Number(p0.duree) : 60;
  var ch = ((TABLEAU||{}).chantiers||[]).filter(function(c){ return c.numero === d.numero; })[0] || {};
  CT = { mode:'neuf', devis:d.numero, mensuelDevis:d.mensuel || 0, passagesDevis:d.passagesMois || 0,
         client:d.client || '', adresse:d.adresse || ch.adresse || '', cp:d.cp || ch.cp || '',
         ville:d.ville || ch.ville || '', acces:ch.acces || d.note || '', note:'',
         nature:d.nature || 'ENTRETIEN', prestataire:p0 ? (p0.prestataire || '') : '',
         date:debut, heure:hDeb, fin:heureDe((minutesDe(hDeb) || 480) + duree), journee:false,
         rec:rec, jours:jours, mensuel:'JOUR', jusquA:'' };
  ouvrirContrat('Mettre au calendrier');
}

function ouvrirContrat(titre){
  AD_FICHE = {type:'contrat', cle: CT.id || ''};
  montrer('eAd2');
  $('hTitre').textContent = titre;
  erreur(''); window.scrollTo(0,0);
  peindreContrat();
}

/* ---- relire ce qui est tapé avant de repeindre ----
   Un appui sur une pastille repeint le formulaire : sans cette relecture, le
   nom du client déjà tapé disparaîtrait. */
function lireContrat(){
  if(!CT) return;
  var v = function(id){ var e = $(id); return e ? e.value : undefined; };
  ['client','adresse','cp','ville','acces','note'].forEach(function(k){
    var x = v('ct_' + k); if(x !== undefined) CT[k] = x;
  });
  var d = v('ct_date'); if(d !== undefined && d) CT.date = d;
  var h = v('ct_heure'); if(h !== undefined) CT.heure = h;
  var f = v('ct_fin'); if(f !== undefined) CT.fin = f;
  var j = v('ct_jusqua'); if(j !== undefined) CT.jusquA = j;
}

/* v99 — « toutes les interventions doivent être reliées à un devis, et par
   la suite à une facture ». Le formulaire propose les devis du tableau, ceux
   du client tapé d'abord. « Sans devis » reste possible (dépannage), mais
   l'écran dit ce que cela coûte : pas de prix pour la facture. */
function optionsDevisLie(c){
  var cl = String(c.client || '').trim().toLowerCase();
  var l = ((TABLEAU||{}).devis||[]).filter(function(d){
    return String(d.statut || '').toUpperCase() !== 'REFUSE';
  }).map(function(d){
    var nom = String(d.client || '').toLowerCase();
    var proche = cl.length >= 3 && (nom.indexOf(cl) >= 0 || cl.indexOf(nom) >= 0) ? 1 : 0;
    return {d: d, proche: proche};
  });
  l.sort(function(a, b){
    if(a.proche !== b.proche) return b.proche - a.proche;
    return String(b.d.date || '') < String(a.d.date || '') ? -1 : 1;
  });
  return '<option value="">Sans devis (dépannage, prix à indiquer dans la description)</option>' +
    l.slice(0, 80).map(function(x){
      var d = x.d;
      return '<option value="' + ech(d.numero) + '"' + (c.devisLie === d.numero ? ' selected' : '') + '>' +
        ech((x.proche ? '★ ' : '') + (d.client || '') + ' · ' + d.numero + ' · ' + eur(d.ht) + ' HT' +
            (String(d.statut||'').toUpperCase() === 'SIGNE' ? ' · signé' : '')) + '</option>';
    }).join('');
}

/* v101 — « quand je cherche un devis lié je ne sélectionne pas, juste en
   tapant les premières lettres je trouve ». Un champ de recherche : chaque
   lettre tapée filtre les devis (client, numéro, ville), sans repeindre le
   formulaire — le clavier reste ouvert. Un appui sur un résultat le choisit ;
   si le client n'est pas encore écrit, la fiche reprend celui du devis et son
   adresse. */
function devisCherches(q, c){
  var mots = sansAccents(String(q || '')).toLowerCase().split(/\s+/).filter(Boolean);
  var cl = sansAccents(String((c && c.client) || '')).toLowerCase().trim();
  var l = ((TABLEAU||{}).devis||[]).filter(function(d){
    if(String(d.statut || '').toUpperCase() === 'REFUSE') return false;
    if(!mots.length) return cl.length >= 3 && sansAccents(String(d.client||'')).toLowerCase().indexOf(cl) >= 0;
    var h = sansAccents([d.client, d.numero, d.ville, d.adresse].join(' ')).toLowerCase();
    var mh = h.split(/[\s,·\-—'’]+/);
    return mots.every(function(m){
      return mh.some(function(x){ return x.indexOf(m) === 0; }) || h.indexOf(m) >= 0;
    });
  });
  l.sort(function(a, b){
    var sa = String(a.statut||'').toUpperCase() === 'SIGNE' ? 1 : 0;
    var sb = String(b.statut||'').toUpperCase() === 'SIGNE' ? 1 : 0;
    if(sa !== sb) return sb - sa;
    return String(b.date || '') < String(a.date || '') ? -1 : 1;
  });
  return l.slice(0, 8);
}
function sansAccents(s){
  return String(s || '').normalize ? String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '') : String(s || '');
}
function ligneDevisLie(d){
  return ech((d.client || '') + ' · ' + d.numero + ' · ' + eur(d.ht) + ' HT' +
    (d.ville ? ' · ' + d.ville : '') +
    (String(d.statut||'').toUpperCase() === 'SIGNE' ? ' · signé' : ''));
}
function blocDevisLie(c){
  if(c.devisLie){
    var d = ((TABLEAU||{}).devis||[]).filter(function(x){ return x.numero === c.devisLie; })[0];
    return '<div class="ctDevisChoisi"><b>' + (d ? ligneDevisLie(d) : ech(c.devisLie)) + '</b>' +
      '<button type="button" class="btn sec sm" style="width:auto" onclick="choisirDevisLie(\'\')">Changer</button></div>';
  }
  return '<input id="ct_devisQ" type="search" autocomplete="off" placeholder="Tape les premières lettres du client ou le n° du devis"' +
    ' value="' + ech(c.devisQ || '') + '" oninput="chercherDevisLie(this.value)">' +
    '<div id="ct_devisRes" class="ctDevisRes">' + resultatsDevisLie(c.devisQ || '', c) + '</div>';
}
function resultatsDevisLie(q, c){
  var l = devisCherches(q, c);
  if(!l.length) return String(q || '').trim()
    ? '<div class="mini">Aucun devis ne correspond.</div>' : '';
  return l.map(function(d){
    return '<button type="button" class="ctDevisLigne" onclick="choisirDevisLie(\'' + ech(d.numero) + '\')">' +
      ligneDevisLie(d) + '</button>';
  }).join('');
}
function chercherDevisLie(q){
  if(!CT) return;
  CT.devisQ = q;
  var r = $('ct_devisRes'); if(r) r.innerHTML = resultatsDevisLie(q, CT);
}
function choisirDevisLie(num){
  lireContrat();
  CT.devisLie = num || '';
  CT.devisQ = '';
  if(num){
    var d = ((TABLEAU||{}).devis||[]).filter(function(x){ return x.numero === num; })[0];
    if(d){
      if(!String(CT.client||'').trim()) CT.client = d.client || '';
      if(!String(CT.adresse||'').trim()) CT.adresse = d.adresse || '';
      if(!String(CT.cp||'').trim()) CT.cp = d.cp || '';
      if(!String(CT.ville||'').trim()) CT.ville = d.ville || '';
    }
  }
  peindreContrat();
}

function ctPoser(k, val){ lireContrat(); CT[k] = val; peindreContrat(); }
function ctQui(nom){ lireContrat(); CT.prestataire = basculerQui(CT.prestataire, nom); peindreContrat(); }
function ctRec(v){
  lireContrat();
  CT.rec = v;
  /* « Tous les jours de la semaine » est un raccourci : il coche du lundi au
     vendredi. Les autres repartent du jour de la date choisie. */
  if(v === 'OUVRES') CT.jours = [1,2,3,4,5];
  else if(v === 'SIX') CT.jours = [1,2,3,4,5,6];
  else if(v === 'SEPT') CT.jours = [0,1,2,3,4,5,6];
  else if(v !== 'PERSO' || !CT.jours.length) CT.jours = [jourDe(CT.date).getDay()];
  peindreContrat();
}
function ctJour(n){
  lireContrat();
  var i = CT.jours.indexOf(n);
  if(i >= 0){ if(CT.jours.length > 1) CT.jours.splice(i,1); }
  else CT.jours.push(n);
  /* Toucher un jour, c'est personnaliser : « Toutes les semaines » avec deux
     jours cochés n'est plus « toutes les semaines » au sens de FamilyWall. */
  if(CT.rec === 'SEMAINE' || CT.rec === 'OUVRES' || CT.rec === 'SIX' || CT.rec === 'SEPT') CT.rec = CT.jours.length > 1 ? 'PERSO' : 'SEMAINE';
  peindreContrat();
}
function ctDate(){
  var avant = CT.date;
  lireContrat();
  /* Changer la date d'un contrat d'un seul jour déplace aussi ce jour : c'est
     ce qu'on attend en choisissant « le jeudi 12 ». */
  if(CT.date !== avant && CT.jours.length <= 1 && ['OUVRES','SIX','SEPT'].indexOf(CT.rec) < 0) CT.jours = [jourDe(CT.date).getDay()];
  peindreContrat();
}
function ctHeure(){
  var avant = minutesDe(CT.heure), fin = minutesDe(CT.fin);
  lireContrat();
  /* Déplacer le début déplace la fin d'autant, comme dans un agenda. */
  var apres = minutesDe(CT.heure);
  if(avant !== null && fin !== null && apres !== null && fin > avant) CT.fin = heureDe(apres + (fin - avant));
  peindreContrat();
}

/* ---- le formulaire ---- */
function peindreContrat(){
  var c = CT, gens = ((TABLEAU||{}).prestataires||[]);
  var recur = c.rec !== 'JAMAIS';
  var hebdo = ['SEMAINE','OUVRES','SIX','SEPT','QUINZAINE','PERSO'].indexOf(c.rec) >= 0;
  var mois = c.rec === 'MOIS' || c.rec === 'MOIS2';
  var dj = jourDe(c.date);
  var ch = function(id, lib, val, attr){
    return '<label for="ct_' + id + '">' + lib + '</label><input id="ct_' + id + '" ' + (attr||'type="text"') +
           ' value="' + ech(val||'') + '">';
  };
  var dureeMn = (minutesDe(c.fin) !== null && minutesDe(c.heure) !== null)
    ? minutesDe(c.fin) - minutesDe(c.heure) : null;

  var h = '';
  if(c.devis){
    h += '<div class="card" style="border-color:var(--acc-b)"><b>Contrat du devis ' + ech(c.devis) + '</b>' +
      '<div class="mini">' + (c.mensuelDevis ? eur(c.mensuelDevis) + ' HT par mois · ' : '') +
      (c.passagesDevis ? c.passagesDevis + ' passage' + (c.passagesDevis > 1 ? 's' : '') + ' par mois au devis · ' : '') +
      'choisis le jour, l\'heure et la personne, puis enregistre : c\'est un contrat (un an, ou la durée du devis, ' +
      'reconduit tacitement), ses passages se posent sur toute la période. Les interventions de ce devis restées ' +
      'sans date sont remplacées par la série ; celles déjà posées restent.</div></div>';
  }
  if(c.mode === 'modif'){
    h += '<div class="card" style="border-color:var(--acc-b)"><b>Modifier ' + ech(c.id) + '</b>' +
      '<div class="mini">Les changements valent pour les passages à partir du <b>' +
      ech(jourLisible(c.depuis)) + '</b>. Ce qui est passé, ou déjà commencé, ne bouge pas.</div></div>';
  }

  h += '<div class="card ctCarte">' +
    '<input id="ct_client" class="ctTitre" type="text" placeholder="Titre : le client" value="' + ech(c.client) + '">' +

    '<div class="ctLigne">' +
      '<div><label for="ct_date">De</label>' +
        '<input id="ct_date" type="date" value="' + ech(c.date) + '" onblur="ctDate()"></div>' +
      (c.journee ? '' :
      '<div style="width:110px"><label for="ct_heure">&nbsp;</label>' +
        '<input id="ct_heure" type="time" value="' + ech(c.heure) + '" onblur="ctHeure()"></div>' +
      '<div style="width:110px"><label for="ct_fin">À</label>' +
        '<input id="ct_fin" type="time" value="' + ech(c.fin) + '" onblur="lireContrat();peindreContrat()"></div>') +
    '</div>' +
    (dureeMn !== null && !c.journee
      ? '<div class="mini">' + (dureeMn > 0 ? dureeLisible(dureeMn) : '<span style="color:var(--danger)">La fin tombe avant le début.</span>') + '</div>' : '') +

    '<label class="ctBascule"><input type="checkbox" ' + (c.journee ? 'checked ' : '') +
      'onchange="ctPoser(\'journee\', this.checked)"> <span>Toute la journée</span></label>' +

    '<label>Couleur</label>' +
    '<div class="ctCouleurs">' +
      NATURES_CHOIX.map(function(x){
        var n = natureVue(x.v);
        return '<button type="button" class="ctCoul' + (c.nature === x.v ? ' on' : '') + '" ' +
          'style="--nT:' + n.t + ';--nF:' + n.f + ';--nI:' + n.i + '" ' +
          'onclick="ctPoser(\'nature\',\'' + x.v + '\')"><i></i>' + ech(x.n) + '</button>';
      }).join('') +
    '</div>' +

    '<label>Participants <span class="mini">(un ou plusieurs)</span></label>' +
    '<div class="ctGens">' +
      gens.map(function(g){
        return '<button type="button" class="ctAva' + (aQui(c.prestataire, g) ? ' on' : '') + '" ' +
          'onclick="ctQui(\'' + ech(g).replace(/'/g,'&#39;') + '\')">' +
          '<span>' + ech(String(g).slice(0,2)) + '</span>' + ech(g) + '</button>';
      }).join('') +
      '<button type="button" class="ctAva' + (!c.prestataire ? ' on' : '') + '" ' +
        'onclick="ctPoser(\'prestataire\',\'\')"><span>?</span>Personne</button>' +
    '</div>' +

    '<label for="ct_rec">Récurrence</label>' +
    '<select id="ct_rec" onchange="ctRec(this.value)">' +
      RECURRENCES.filter(function(r){ return (c.mode === 'neuf' && !c.devis) || r.v !== 'JAMAIS'; }).map(function(r){
        return '<option value="' + r.v + '"' + (c.rec === r.v ? ' selected' : '') + '>' + ech(r.l) + '</option>';
      }).join('') +
    '</select>' +

    (hebdo
      ? '<div class="ctJours">' + JOURS_COURTS.map(function(j){
          return '<button type="button" class="ctJ' + (c.jours.indexOf(j.n) >= 0 ? ' on' : '') + '" ' +
                 'aria-label="' + JOURS_LONGS[j.n] + '" onclick="ctJour(' + j.n + ')">' + j.l + '</button>';
        }).join('') + '</div>'
      : '') +
    (mois
      ? '<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">' +
          '<span class="puce' + (c.mensuel !== 'RANG' ? ' on' : '') + '" onclick="ctPoser(\'mensuel\',\'JOUR\')">' +
            'le ' + dj.getDate() + ' du mois</span>' +
          '<span class="puce' + (c.mensuel === 'RANG' ? ' on' : '') + '" onclick="ctPoser(\'mensuel\',\'RANG\')">' +
            'le ' + libelleRang(rangDuJour(c.date)) + ' ' + JOURS_LONGS[dj.getDay()] + ' du mois</span>' +
        '</div>'
      : '') +

    (recur
      ? '<label for="ct_jusqua">Jusqu\'au</label>' +
        '<div class="ctLigne"><div><input id="ct_jusqua" type="date" value="' + ech(c.jusquA) + '"></div>' +
        (c.jusquA ? '<button type="button" class="btn sec sm" style="width:auto" ' +
          'onclick="ctPoser(\'jusquA\',\'\')">Pas d\'échéance</button>' : '') + '</div>' +
        '<div class="mini">' + (c.jusquA ? 'Dernier passage au plus tard le ' + ech(jourLisible(c.jusquA)) + '.'
                                          : 'Pas d\'échéance : le contrat continue jusqu\'à ce que tu l\'arrêtes.') + '</div>'
      : '') +
  '</div>' +

  (c.mode === 'neuf' && !c.devis
    ? '<div class="card"><label for="ct_devisQ">Devis lié</label>' + blocDevisLie(c) +
      '<div class="mini">' + (c.devisLie
        ? 'L\'intervention sera facturée au prix de ce devis.'
        : '<span style="color:var(--warn)">Sans devis, la facture reprendra le prix écrit dans la description ' +
          '(par exemple « 235 € HT »).</span>') + '</div></div>'
    : '') +
  '<div class="card">' +
    ch('adresse', 'Où ?', c.adresse, 'type="text" placeholder="Adresse"') +
    '<div class="row" style="gap:8px">' +
      '<div style="width:110px">' + ch('cp', 'Code postal', c.cp) + '</div>' +
      '<div style="flex:1">' + ch('ville', 'Ville', c.ville) + '</div>' +
    '</div>' +
    ch('acces', 'Accès au site', c.acces, 'type="text" placeholder="Code portail, où est la clé…"') +
    '<label for="ct_note">Description</label>' +
    '<textarea id="ct_note" rows="3" placeholder="Ce que le salarié verra en arrivant">' + ech(c.note) + '</textarea>' +
  '</div>' +
  blocFicheForm(c) +
  (c.mode === 'modif' ? blocEcheance(c.id) : '') +

  '<button class="btn" id="bCtEnr" onclick="enregistrerContrat(this)">Enregistrer</button>' +
  (c.mode === 'modif'
    ? '<button class="btn sec" style="margin-top:10px;border-color:var(--danger);color:var(--danger)" ' +
      'onclick="arreterContrat(\'' + ech(c.id) + '\',\'' + ech(c.depuis) + '\', this)">Arrêter le contrat</button>'
    : '') +
  '<button class="btn sec" style="margin-top:10px" onclick="retourTableau()">Annuler</button>';

  $('adFiche').innerHTML = h;
}

/* ---- ce qui part au bureau ---- */
function envoiContrat(){
  var c = CT;
  var hebdo = ['SEMAINE','OUVRES','SIX','SEPT','QUINZAINE','PERSO'].indexOf(c.rec) >= 0;
  var duree = (!c.journee && minutesDe(c.fin) !== null && minutesDe(c.heure) !== null)
    ? minutesDe(c.fin) - minutesDe(c.heure) : '';
  return {
    client:c.client.trim(), adresse:c.adresse, cp:c.cp, ville:c.ville, acces:c.acces,
    prestations:c.note, note:c.note, nature:c.nature, prestataire:c.prestataire,
    frequence: c.rec === 'QUINZAINE' ? 'QUINZAINE' : (hebdo ? 'HEBDO' : 'MENSUEL'),
    jours: hebdo ? c.jours.slice().sort() : [],
    mensuel: c.mensuel === 'RANG' ? 'RANG' : 'JOUR',
    jourMois: jourDe(c.date).getDate(),
    intervalle: c.rec === 'MOIS2' ? 2 : 1,
    debut:c.date, fin:c.jusquA || '',
    heure: c.journee ? '' : c.heure, duree: duree > 0 ? duree : '',
    devis: c.devis || c.devisLie || ''
  };
}

function enregistrerContrat(btn){
  lireContrat();
  var c = CT;
  if(!c) return;
  if(!navigator.onLine) return erreur('Hors connexion : créer ou modifier un contrat a besoin du réseau.');
  if(!String(c.client||'').trim()) return erreur('Il faut un titre : le nom du client.');
  if(!c.journee && minutesDe(c.fin) !== null && minutesDe(c.heure) !== null &&
     minutesDe(c.fin) <= minutesDe(c.heure)) return erreur('La fin tombe avant le début.');
  if(c.jusquA && c.jusquA < c.date) return erreur('« Jusqu\'au » tombe avant le premier passage.');

  /* Jamais : c'est un chantier ponctuel, le chemin de toujours. */
  if(c.mode === 'neuf' && c.rec === 'JAMAIS'){
    var d0 = (!c.journee && minutesDe(c.fin) !== null && minutesDe(c.heure) !== null)
      ? minutesDe(c.fin) - minutesDe(c.heure) : '';
    return posterChantierNeuf({ client:c.client.trim(), adresse:c.adresse, cp:c.cp, ville:c.ville,
      acces:c.acces, note:c.note, nature:c.nature, date:c.date,
      heure:c.journee ? '' : c.heure, duree: d0 > 0 ? d0 : '', prestataire:c.prestataire,
      devis: c.devisLie || '' }, btn, c.fichier);
  }

  var moi = session();
  var env = envoiContrat();
  env.action = c.mode === 'modif' ? 'recurrentModif' : 'recurrentNeuf';
  env.nom = moi.nom; env.code = moi.code; env.appareil = APPAREIL;
  if(c.mode === 'modif'){ env.id = c.id; env.aPartirDe = c.depuis; }
  erreur('');
  if(btn) occuper(btn, 'Enregistrement…');
  poster(env, 40000).then(function(r){
    if(btn) libere(btn);
    if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
    tracer(c.mode === 'modif' ? 'CONTRAT MODIFIE' : 'CONTRAT CREE', env.client, (r.ids||[]).join(','));
    if(c.fichier && (r.ids||[]).length) envoyerFicheApres(r.ids, c.fichier);
    AD_MOT_T = 0;
    AD_MOT = (c.mode === 'modif' ? 'Contrat modifié' : 'Contrat créé') +
      ((r.ids||[]).length ? ' (' + r.ids.join(', ') + ')' : '') +
      ' · ' + (r.poses||0) + ' passage' + ((r.poses||0) > 1 ? 's' : '') + ' posé' + ((r.poses||0) > 1 ? 's' : '') +
      (r.retires ? ' · ' + r.retires + ' intervention' + (r.retires > 1 ? 's' : '') + ' sans date remplacée' +
        (r.retires > 1 ? 's' : '') : '');
    CT = null;
    retourTableau();
    chargerTableau();
  }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
}

function posterChantierNeuf(c, btn, fichier){
  var moi = session();
  erreur('');
  var env = {action:'chantierNeuf', nom:moi.nom, code:moi.code, appareil:APPAREIL};
  for(var k in c) if(c.hasOwnProperty(k)) env[k] = c[k];
  /* v105 — même chose à la création : l'intervention apparaît tout de suite
     au planning (marquée « envoi… » le temps que le bureau lui donne son
     numéro), et l'écran revient sans attendre. */
  var tmp = 'TMP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  var loc = { id: tmp, numero: c.devis || '', client: c.client, adresse: c.adresse || '', cp: c.cp || '',
    ville: c.ville || '', acces: c.acces || '', date: c.date || '', heure: c.heure || '',
    prestataire: c.prestataire || '', statut: (c.date && c.prestataire) ? 'PLANIFIE' : 'A PLANIFIER',
    arrivee: 0, depart: 0, minutes: 0, signalement: '', note: c.note || '', nature: c.nature || '',
    recurrent: '', duree: c.duree || '', enVol: true };
  if(TABLEAU){ TABLEAU.chantiers = TABLEAU.chantiers || []; TABLEAU.chantiers.push(loc); }
  EN_VOL.neufs.push(loc);
  if(btn) libere(btn);
  AD_MOT_T = 0; AD_MOT = 'Intervention ajoutée : ' + c.client;
  CT = null;
  retourTableau();
  var oter = function(){ EN_VOL.neufs = EN_VOL.neufs.filter(function(n){ return n !== loc; }); };
  poster(env).then(function(r){
    oter();
    if(!r || !r.ok){
      if(TABLEAU) TABLEAU.chantiers = (TABLEAU.chantiers||[]).filter(function(x){ return x !== loc; });
      if(!AD_FICHE) peindreTableau();
      return erreur('« ' + c.client + ' » n\'a pas été créée : ' + ((r && r.erreur) ? String(r.erreur) : attenteLisible()) + ' — recommence.');
    }
    tracer('CHANTIER CREE', c.client + ' ' + (c.date||'sans date'), r.id || '');
    direNotifs(r);
    loc.id = r.id; loc.statut = r.statut || loc.statut; delete loc.enVol;
    if(fichier && r.id) envoyerFicheApres([r.id], fichier);
    chargerTableauBientot();
  }, function(){
    oter();
    if(TABLEAU) TABLEAU.chantiers = (TABLEAU.chantiers||[]).filter(function(x){ return x !== loc; });
    if(!AD_FICHE) peindreTableau();
    erreur('« ' + c.client + ' » n\'a pas été créée : ' + attenteLisible() + ' — recommence.');
  });
}

/* v105 — les interventions posées un jour férié, pour appeler les clients. */
function listeFeries(){
  AD_FICHE = {type:'feries', cle:''};
  montrer('eAd2');
  $('hTitre').textContent = 'Jours fériés';
  erreur(''); window.scrollTo(0,0);
  peindreFeries();
}
function peindreFeries(){
  var auj = isoJour();
  var l = ((TABLEAU||{}).chantiers||[]).filter(function(c){
    return !estAnnule(c) && c.date && c.date.slice(0,10) >= auj && String(c.statut||'').toUpperCase() !== 'FAIT' && nomFerie(c.date.slice(0,10));
  }).sort(function(a, b){ return (a.date + (a.heure||'')) < (b.date + (b.heure||'')) ? -1 : 1; });
  var h = '<div class="mini" style="margin:0 0 10px">Les passages restent à leur date. Appelle le client, puis ouvre l\'intervention pour la déplacer (les dates proposées évitent fériés et congés).</div>';
  var jour = '';
  l.forEach(function(c){
    var j = c.date.slice(0,10);
    if(j !== jour){ jour = j; h += '<h2 style="margin:14px 0 8px">' + ech(jourLisible(j)) + ' · ' + ech(nomFerie(j)) + '</h2>'; }
    h += '<div class="card chC" style="cursor:pointer;margin-bottom:8px" onclick="ficheChantier(\'' + ech(String(c.id)) + '\')">' +
      '<div class="chTete"><b style="flex:1">' + ech(c.client || 'Intervention') + '</b><span class="mini">' + ech(c.heure || '') + '</span></div>' +
      '<div class="mini">' + ech(quiLisible(c.prestataire)) + (c.ville ? ' · ' + ech(c.ville) : '') + '</div></div>';
  });
  if(!l.length) h += '<div class="card"><div class="empty">Aucune intervention un jour férié.</div></div>';
  h += '<button class="btn sec" style="margin-top:12px" onclick="retourTableau()">Retour au tableau</button>';
  $('adFiche').innerHTML = h;
}

function arreterContrat(id, depuis, btn){
  if(!navigator.onLine) return erreur('Hors connexion : arrêter un contrat a besoin du réseau.');
  var d = depuis && depuis > isoJour() ? depuis : isoJour();
  demander('Arrêter ce contrat ?',
    'Plus aucun passage à partir du ' + jourLisible(d) + '. Ceux d\'avant restent, ' +
    'et ce qui a été pointé n\'est jamais touché.', 'Arrêter le contrat').then(function(oui){
    if(!oui) return;
    var moi = session();
    if(btn) occuper(btn, 'Arrêt…');
    poster({action:'recurrentStop', nom:moi.nom, code:moi.code, appareil:APPAREIL, id:id, aPartirDe:d}, 40000)
      .then(function(r){
        if(btn) libere(btn);
        if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
        tracer('CONTRAT ARRETE', id, id);
        AD_MOT_T = 0;
        AD_MOT = 'Contrat ' + id + ' arrêté · dernier jour le ' + jourLisible(r.fin);
        CT = null;
        retourTableau();
        chargerTableau();
      }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
  });
}

/* ---- la carte « contrat » sur la fiche d'un passage ----
   Comme FamilyWall quand on touche une occurrence : on corrige ce passage-ci
   avec la fiche habituelle, ou on agit sur le contrat entier à partir d'ici. */
/* La question, en deux boutons. Résout 'ce', 'suivants' ou '' (annulé). */
function demanderPortee(){
  return new Promise(function(res){
    var o = document.createElement('div');
    o.id = 'porteeBox';
    o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    o.innerHTML = '<div class="card" style="max-width:420px;width:100%;margin:0">' +
      '<h2 style="margin-top:0">Ce passage fait partie d\'un contrat</h2>' +
      '<div class="mini">Le changement vaut pour :</div>' +
      '<button class="btn" style="margin-top:12px" data-p="ce">Seulement ce passage (exceptionnel)</button>' +
      '<button class="btn sec" style="margin-top:8px" data-p="suivants">Ce passage et tous les suivants</button>' +
      '<button class="btn sec" style="margin-top:8px" data-p="">Annuler</button></div>';
    o.addEventListener('click', function(e){
      var b = e.target.closest('[data-p]');
      if(!b && e.target !== o) return;
      var p = b ? b.getAttribute('data-p') : '';
      o.remove(); res(p);
    });
    document.body.appendChild(o);
  });
}
/* « Tous les suivants » : le contrat repart de la nouvelle date, au jour de
   la semaine de cette date, avec l'heure et la personne de la fiche. Même
   chemin que « Modifier les suivants », déjà rempli : on enregistre d'un
   appui sur l'écran du contrat. */
function decalerSuivants(idS, x0, c){
  modifierContrat(idS, x0.date);
  if(!CT || CT.mode !== 'modif') return;
  var d = c.date || x0.date;
  CT.date = d;
  if(['SEMAINE','QUINZAINE','PERSO'].indexOf(CT.rec) >= 0 || CT.jours.length <= 1) CT.jours = [jourDe(d).getDay()];
  if(c.heure){
    var dur = (minutesDe(CT.fin) !== null && minutesDe(CT.heure) !== null) ? minutesDe(CT.fin) - minutesDe(CT.heure) : 60;
    CT.heure = c.heure; CT.fin = heureDe(minutesDe(c.heure) + (dur > 0 ? dur : 60)); CT.journee = false;
  }
  if(c.prestataire !== undefined) CT.prestataire = c.prestataire;
  peindreContrat();
  erreur('Vérifie le contrat ci-dessous puis appuie sur « Enregistrer » : tous les passages à partir du ' + jjmmaa(d) + ' suivront.');
}

function blocContratFiche(c){
  if(!c || !c.recurrent) return '';
  var s = contratDe(c.recurrent);
  var id = String(c.recurrent).split('|')[0];
  return '<div class="card ctFiche">' +
    '<div class="row" style="align-items:center;gap:8px"><span class="ctRond">↻</span>' +
      '<b style="flex:1">Contrat ' + ech(id) + '</b></div>' +
    '<div class="mini">' + (s ? ech(libelleRythme(s)) : 'Rythme inconnu — actualise le tableau.') +
      (s && s.debut ? ' · depuis le ' + ech(jjmmaa(s.debut)) : '') +
      (s && s.fin ? ' · jusqu\'au ' + ech(jjmmaa(s.fin)) : '') + '</div>' +
    '<div class="mini">En changeant le jour, l\'heure ou la personne ci-dessous, tu choisiras : ce passage seulement, ou tous les suivants.</div>' +
    (s ? '<div class="row" style="gap:8px;margin-top:10px">' +
      '<button class="btn sec sm" style="flex:1" onclick="modifierContrat(\'' + ech(id) + '\',\'' +
        ech(c.date||'') + '\')">Modifier les suivants</button>' +
      '<button class="btn sec sm" style="flex:1;color:var(--danger)" onclick="arreterContrat(\'' + ech(id) +
        '\',\'' + ech(c.date||'') + '\', this)">Arrêter ici</button>' +
    '</div>' : '') +
  '</div>';
}

/* ---- la liste des contrats ---- */
/* ====================== LES CLIENTS (v100) ======================
   Simon : « mets une rubrique clients/contrats à un autre endroit pour
   répertorier les coordonnées, mais pas sur le planning ». Le classeur envoie
   la liste des clients (devis, contrats, coordonnées de facturation) ; un
   appui ouvre la fiche : appeler, écrire, l'itinéraire, ses devis, ses
   contrats. */
var CLI_CHERCHE = '';
function clientsHtml(t){
  var l = ((t && t.clients) || []).slice();
  if(!l.length) return '<div class="card"><div class="empty">La liste des clients arrive avec « Actualiser ».</div></div>';
  var q = CLI_CHERCHE.trim().toLowerCase();
  var vus = l.filter(function(c){
    return !q || [c.nom, c.contact, c.ville, c.email, c.tel].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  var h = '<div class="card"><input id="cliCherche" type="search" placeholder="Chercher un client, une ville…" value="' +
    ech(CLI_CHERCHE) + '" oninput="CLI_CHERCHE=this.value;peindreClientsListe()">' +
    '<div class="row" style="gap:8px;margin-top:10px">' +
    '<button class="btn sec sm" style="flex:1" onclick="listeContrats()">Tous les contrats</button></div></div>' +
    '<div id="cliListe">' + cartesClients(vus) + '</div>';
  return h;
}
function cartesClients(l){
  if(!l.length) return '<div class="card"><div class="empty">Aucun client ne correspond.</div></div>';
  return l.slice(0, 200).map(function(c, i){
    return '<div class="card" style="cursor:pointer;margin-bottom:8px" onclick="ficheClient(' + JSON.stringify(c.cle).replace(/"/g,'&quot;') + ')">' +
      '<div style="display:flex;gap:8px;align-items:baseline"><b style="flex:1">' + ech(c.nom) + '</b>' +
      (c.contrats.length ? '<span class="vb vb-s">CONTRAT</span>' : '') + '</div>' +
      '<div class="mini">' + ech([c.contact, c.ville, c.tel].filter(Boolean).join(' · ')) + '</div></div>';
  }).join('');
}
function peindreClientsListe(){
  var t = TABLEAU || {};
  var q = CLI_CHERCHE.trim().toLowerCase();
  var vus = (t.clients || []).filter(function(c){
    return !q || [c.nom, c.contact, c.ville, c.email, c.tel].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  var z = $('cliListe'); if(z) z.innerHTML = cartesClients(vus);
}
function ficheClient(cle){
  var c = (((TABLEAU||{}).clients) || []).filter(function(x){ return x.cle === cle; })[0];
  if(!c) return;
  AD_FICHE = {type:'client', cle:cle};
  montrer('eAd2');
  $('hTitre').textContent = 'Client';
  erreur(''); window.scrollTo(0,0);
  var adr = [c.adresse, [c.cp, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  var lien = function(href, mot){ return '<a class="btn sec sm" style="flex:1;text-align:center;text-decoration:none" href="' +
    ech(href) + '" target="_blank" rel="noopener">' + mot + '</a>'; };
  var tel = String(c.tel || '').replace(/[^\d+]/g, '');
  var h = '<div class="card"><b style="font-size:17px">' + ech(c.nom) + '</b>' +
    (c.facture && c.facture !== c.nom ? '<div class="mini">Facturé à ' + ech(c.facture) + '</div>' : '') +
    '<div class="mini" style="margin-top:6px">' + ech(c.type === 'PART' ? 'Particulier' : 'Professionnel') +
      (c.siret ? ' · SIRET ' + ech(c.siret) : '') + '</div>' +
    (c.contact ? ligneCh('Contact', ech(c.contact)) : '') +
    (c.tel ? ligneCh('Téléphone', ech(c.tel)) : '') +
    (c.email ? ligneCh('E-mail', ech(c.email)) : '') +
    (adr ? ligneCh('Adresse', ech(adr)) : '') +
    '<div class="row" style="gap:8px;margin-top:10px">' +
      (tel ? lien('tel:' + tel, 'Appeler') : '') +
      (c.email ? lien('mailto:' + c.email, 'E-mail') : '') +
      (adr ? lien('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(adr), 'Itinéraire') : '') +
    '</div></div>';
  if(c.contrats.length){
    h += '<div class="card"><h2>Contrats</h2>' + c.contrats.map(function(s){
      return '<div style="padding:6px 0;border-top:1px solid var(--line);cursor:pointer" onclick="modifierContrat(\'' + ech(s.id) + '\',\'\')">' +
        '<b>' + ech(s.libelle) + '</b>' + (s.mensuel ? ' · ' + eur(s.mensuel) + ' HT/mois' : '') +
        '<div class="mini">' + ech([s.rythme, quiLisible(s.prestataire), s.id].filter(Boolean).join(' · ')) + '</div></div>';
    }).join('') + '</div>';
  }
  if(c.devis.length){
    h += '<div class="card"><h2>Devis</h2>' + c.devis.map(function(d){
      var dansTableau = ((TABLEAU||{}).devis||[]).some(function(x){ return x.numero === d.numero; });
      return '<div style="padding:6px 0;border-top:1px solid var(--line);' + (dansTableau ? 'cursor:pointer' : '') + '"' +
        (dansTableau ? ' onclick="ficheDevis(\'' + ech(d.numero).replace(/'/g,'&#39;') + '\')"' : '') + '>' +
        '<b>' + ech(d.numero) + '</b> · ' + eur(d.ht) + ' HT ' + badgeDevis(d.statut) +
        '<div class="mini">' + ech(jjmmaa(d.date)) + '</div></div>';
    }).join('') + '</div>';
  }
  h += '<button class="btn sec" onclick="retourTableau()">Retour</button>';
  $('adFiche').innerHTML = h;
}

function listeContrats(){
  AD_FICHE = {type:'contrats', cle:''};
  montrer('eAd2');
  $('hTitre').textContent = 'Les contrats';
  erreur(''); window.scrollTo(0,0);
  var l = ((TABLEAU||{}).recurrents||[]).slice();
  var auj = isoJour();
  var vivant = function(s){ return s.actif && (!s.fin || s.fin >= auj); };
  l.sort(function(a,b){
    if(vivant(a) !== vivant(b)) return vivant(a) ? -1 : 1;
    return String(a.client).localeCompare(String(b.client), 'fr');
  });
  var vivants = l.filter(vivant), finis = l.filter(function(s){ return !vivant(s); });
  var carte = function(s){
    var n = natureVue(s.nature);
    return '<div class="card chC" style="cursor:pointer;margin-bottom:8px;' +
      (n ? '--nT:' + n.t + ';--nF:' + n.f + ';--nI:' + n.i : '') + '" ' +
      (vivant(s) ? 'onclick="modifierContrat(\'' + ech(s.id) + '\',\'\')"' : '') + '>' +
      '<div class="chTete"><b style="flex:1">' + ech(s.client) + '</b><span class="mini">' + ech(s.id) + '</span></div>' +
      '<div class="chSous">' + ech(libelleRythme(s)) + '</div>' +
      '<div class="mini">' + ech(quiLisible(s.prestataire) || 'personne') + (s.ville ? ' · ' + ech(s.ville) : '') +
        (s.fin ? ' · jusqu\'au ' + ech(jjmmaa(s.fin)) : '') +
        (s.engagement ? ' · engagement ' + s.engagement + ' mois' + (s.reconduction === 'TACITE' ? ', reconduction tacite' : '') : '') + '</div>' +
      (vivant(s) && s.fin && s.fin <= isoJour(new Date(Date.now() + 45*86400000))
        ? '<div class="mini" style="color:var(--warn);font-weight:600">Échéance le ' + ech(jjmmaa(s.fin)) +
          (s.reconduction === 'TACITE' ? ' · sera reconduit tout seul 30 jours avant' : ' · à renouveler') + '</div>' : '') +
    '</div>';
  };
  $('adFiche').innerHTML =
    '<button class="btn" onclick="nouveauChantier()">+ Nouvel événement</button>' +
    '<h2 style="margin:16px 0 8px">En cours (' + vivants.length + ')</h2>' +
    (vivants.length ? vivants.map(carte).join('') : '<div class="card"><div class="empty">Aucun contrat.</div></div>') +
    (finis.length ? '<details style="margin-top:12px"><summary class="mini">Terminés (' + finis.length + ')</summary>' +
      finis.map(carte).join('') + '</details>' : '') +
    '<button class="btn sec" style="margin-top:12px" onclick="retourTableau()">Retour au tableau</button>';
}

/* Le mot qui suit une création : il reste en haut du tableau quelques
   secondes — le tableau se repeint deux fois de suite (tout de suite, puis
   quand le bureau a répondu), et le mot ne doit pas disparaître à la première. */
var AD_MOT = '', AD_MOT_T = 0;
/* v108e — « j'ai créé une intervention puis je l'ai déplacée : 0 notification,
   et mes prestataires non plus ». Le bureau répondait « personne n'est inscrit
   sous ce nom » et l'écran n'en disait rien. Maintenant chaque envoi raté
   revient ici, avec le nom, jusqu'à ce que le gérant le ferme. */
var AD_ALERTE = '';
function direNotifs(r){
  var l = (r && r.notifs) || [];
  var rates = l.filter(function(n){ return n && !n.ok; });
  if(!rates.length) return;
  var noms = function(a){ return a.map(function(n){ return n.nom; }).filter(function(n, i, t){ return t.indexOf(n) === i; }).join(', '); };
  var sans = rates.filter(function(n){ return n.aucun; });
  var err = rates.filter(function(n){ return !n.aucun; });
  var t = [];
  if(sans.length) t.push('Pas de notification pour ' + noms(sans) + ' : aucun téléphone inscrit sous ce nom.');
  if(err.length) t.push('Notification ratée pour ' + noms(err) + ' (' + String(err[0].erreur || 'erreur') + ').');
  AD_ALERTE = t.join(' ');
  if(!AD_FICHE && ECRAN_VU === 'eAd1') peindreTableau();
}
function fermerAlerte(){ AD_ALERTE = ''; peindreTableau(); }
function bandeauAlerte(){
  if(!AD_ALERTE) return '';
  return '<div class="card" style="border-color:var(--warn);margin-bottom:10px"><b>' + ech(AD_ALERTE) + '</b>' +
    '<div class="mini">Sur le téléphone concerné : ouvrir l\'application, se connecter, et accepter les ' +
    'notifications (sur iPhone, l\'application doit être ajoutée à l\'écran d\'accueil).</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button class="btn sec sm" onclick="ficheNotifs()">Voir les téléphones inscrits</button>' +
      '<button class="btn sec sm" onclick="fermerAlerte()">OK</button></div></div>';
}

/* v108e — qui recevra vraiment une notification : la réponse de OneSignal pour
   chaque personne de l'équipe. */
var NOTIFS_ETAT = null;
function ficheNotifs(){
  AD_FICHE = {type:'notifs'};
  montrer('eAd2');
  $('hTitre').textContent = 'Notifications';
  erreur(''); window.scrollTo(0,0);
  NOTIFS_ETAT = null;
  peindreEtatNotifs();
  var moi = session();
  if(!moi) return;
  poster({action:'etatNotifs', nom:moi.nom, code:moi.code, appareil:APPAREIL}, 40000).then(function(r){
    NOTIFS_ETAT = r || {ok:false};
    if(AD_FICHE && AD_FICHE.type === 'notifs') peindreEtatNotifs();
  }, function(){
    NOTIFS_ETAT = {ok:false, erreur:attenteLisible()};
    if(AD_FICHE && AD_FICHE.type === 'notifs') peindreEtatNotifs();
  });
}
function peindreEtatNotifs(){
  var r = NOTIFS_ETAT, h = '<div class="card"><h2>Notifications de l\'équipe</h2>' +
    '<div class="mini" style="margin-top:0">Un téléphone reçoit les notifications s\'il s\'est connecté à ' +
    'l\'application sous son nom et a accepté les notifications.</div></div>';
  h += carteCeTelephone();
  if(!r) h += '<div class="card"><div class="empty">Interrogation du service de notifications…</div></div>';
  else if(!r.ok) h += '<div class="card" style="border-color:var(--warn)"><b>Le bureau n\'a pas pu répondre</b>' +
    '<div class="mini">' + ech(r.erreur || '') + '</div></div>';
  else h += (r.gens || []).map(function(g){
    var bon = g.actifs > 0;
    return '<div class="card" style="border-color:' + (bon ? 'var(--ok)' : 'var(--warn)') + ';margin-bottom:10px">' +
      '<div style="display:flex;gap:10px;align-items:baseline"><b style="flex:1">' + ech(g.nom) + '</b>' +
      '<span class="mini">' + ech(g.role || '') + '</span></div>' +
      '<div class="mini" style="margin-top:4px">' +
      (g.erreur ? 'Réponse illisible du service (' + ech(g.erreur) + ').'
        : bon ? 'Reçoit les notifications · ' + g.actifs + ' appareil' + (g.actifs > 1 ? 's' : '') +
                (g.types ? ' (' + ech(g.types) + ')' : '')
        : g.appareils ? 'Inscrit, mais notifications coupées sur ' + (g.appareils > 1 ? 'ses appareils' : 'son appareil') + '.'
        : 'Aucun téléphone inscrit : il ne reçoit rien.') +
      (g.vu ? '<br>Dernière ouverture : ' + ech(quandLisible(Date.parse(g.vu))) : '') +
      '</div></div>';
  }).join('');
  h += '<button class="btn sec" style="margin-top:4px" onclick="ficheNotifs()">Actualiser</button>' +
       '<button class="btn sec" style="margin-top:8px" onclick="retourTableau()">Retour au tableau</button>';
  $('adFiche').innerHTML = h;
}

function bandeauMot(){
  if(!AD_MOT) return bandeauAlerte();
  if(!AD_MOT_T) AD_MOT_T = Date.now();
  if(Date.now() - AD_MOT_T > 12000){ AD_MOT = ''; AD_MOT_T = 0; return bandeauAlerte(); }
  return bandeauAlerte() + '<div class="card" style="border-color:var(--ok);margin-bottom:10px"><b>' + ech(AD_MOT) + '</b></div>';
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
  AG_PASSE = false;             // on revient toujours sur ce qui vient
  /* Le bouton n'existe que pour le commercial qui a aussi un planning :
     CFG.planning ne vient que de config_(), jamais de configPrestataire_().
     C'est le classeur qui décide, pas cet écran — et le serveur refuse
     l'action à qui n'y a pas droit, même si le bouton était forcé. */
  var br = $('bAgRdv');
  if(br) br.classList.toggle('hide', !(CFG && CFG.planning));
  fermerDialogues();
  montrer('eAg1');
  $('steps').classList.add('hide');
  $('bar').classList.add('hide');
  $('bHist').classList.add('hide');
  $('hTitre').textContent = 'Mon planning';
  erreur('');
  window.scrollTo(0,0);
  peindreNotifs();
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
      }, Promise.resolve()).then(function(){
        /* Ce que le bureau ne renvoie plus a quitté ce planning : annulé,
           réaffecté à quelqu'un d'autre, ou retiré par le commercial. Sans
           cette purge il restait sur l'appareil pour toujours, et le salarié
           partait sur un chantier décommandé.
           On garde ce qui n'est pas encore remonté : un pointage fait en zone
           blanche ne doit pas disparaître parce que le bureau l'ignore
           encore. */
        var servis = {};
        (d.chantiers || []).forEach(function(c){ servis[c.id] = true; });
        return (locaux || []).reduce(function(p, c){
          if(servis[c.id] || (c.aEnvoyer && Object.keys(c.aEnvoyer).length)) return p;
          return p.then(function(){ return DB.cSuppr(c.id); });
        }, Promise.resolve());
      });
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

/* La date du jour, à l'heure de la France et non à celle de Greenwich.
   toISOString() renvoie la date UTC : entre minuit et deux heures du matin,
   elle est encore celle de la veille. Un devis signé à 00h30 portait alors la
   date du jour précédent, et le chantier d'hier remontait en tête du planning. */
function isoJour(d){
  d = d ? new Date(d) : new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
         '-' + ('0' + d.getDate()).slice(-2);
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

/* Les cinq natures et leurs couleurs. La palette a été vérifiée : écart
   suffisant entre deux natures voisines, y compris pour un œil daltonien, et
   chaque encre tient le contraste sur son fond. Surtout, la couleur ne dit
   jamais rien toute seule — la pastille écrit la nature en toutes lettres,
   parce qu'un planning se lit aussi en plein soleil sur un écran sale.
   t : la bande et le liseré ; f : le fond de la carte ; i : l'encre.
   Les cinq fonds sont assez clairs pour que le texte noir y tienne plus de
   14 fois le contraste minimal, et l'encre de l'heure plus de 4,5. */
var NATURES_VUE = {
  ENTRETIEN: { nom: 'Entretien',       t: '#2a78d6', f: '#dfeafa', i: '#1b5aa8' },
  VITRERIE:  { nom: 'Vitrages',        t: '#1baf7a', f: '#d8f2e8', i: '#0a6d4a' },
  CHANTIER:  { nom: 'Fin de chantier', t: '#eb6834', f: '#fce3d9', i: '#a44418' },
  REMISE:    { nom: 'Remise en état',  t: '#6250d6', f: '#e6e2fb', i: '#4a3ab0' },
  FACADE:    { nom: 'Façade',          t: '#eda100', f: '#fbecd1', i: '#8a5e00' },
  /* Le rendez-vous du commercial n'est pas une prestation : il se distingue
     des cinq natures vendues par un gris franc, qui ne concurrence aucune
     couleur de métier. Le validateur de palette le signale comme « lit
     gris » — c'est exactement l'intention, et la pastille écrit « Rendez-vous »
     à côté, de sorte que la couleur ne porte jamais l'information seule.
     Contrastes mesurés : encre 8,6 et trait 5,2 sur son fond. */
  RDV:       { nom: 'Rendez-vous',     t: '#5b6472', f: '#eceef1', i: '#3c434d' }
};
var NATURE_RDV = 'RDV';
function estRdv(c){ return String((c||{}).nature || '').toUpperCase().trim() === NATURE_RDV; }
/* Une nature inconnue ne reçoit pas de couleur au hasard : la carte reste
   grise, et l'absence se voit. */
function natureVue(v){
  return NATURES_VUE[String(v == null ? '' : v).toUpperCase().trim()] || null;
}

/* Le salarié ouvre son planning pour savoir où il va, pas pour relire le mois
   dernier. Le passé reste à un appui, et le choix ne survit pas à la sortie de
   l'écran : on repart toujours sur ce qui vient. */
var AG_PASSE = false;
function agVoirPasse(v){ AG_PASSE = !!v; peindrePlanning(); }

function peindrePlanning(){
  DB.cTous().then(function(l){
    l = l || [];
    var c = $('agListe');
    var bs = $('bAgSem');
    if(bs) bs.textContent = AG_SEM ? 'Voir la liste' : 'Voir la semaine';
    if(!l.length){
      c.innerHTML = '<div class="card"><div class="empty">Aucun chantier pour le moment.<br>' +
                    'Il apparaîtra ici dès que le bureau te l\'aura affecté.</div></div>';
      $('agQuand').textContent = '—';
      return;
    }
    var aujourdhui = isoJour();
    var reste = l.filter(function(x){ return x.date >= aujourdhui && x.statut !== 'FAIT'; }).length;
    $('agQuand').textContent = reste
      ? reste + ' chantier' + (reste>1?'s':'') + ' à venir'
      : 'Rien à venir pour l\'instant';

    if(AG_SEM){ c.innerHTML = semaineHtml(l, 'ouvrirChantier'); return; }

    /* À venir d'abord, du plus proche au plus lointain : c'est ce qu'on ouvre
       son téléphone pour savoir. Le passé ensuite, du plus récent au plus
       ancien, pour retrouver le chantier d'hier sans faire défiler un mois. */
    var futurs = l.filter(function(x){ return x.date >= aujourdhui; })
                  .sort(function(a,b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    var passes = l.filter(function(x){ return x.date < aujourdhui; })
                  .sort(function(a,b){ return a.date > b.date ? -1 : (a.date < b.date ? 1 : 0); });

    function carte(x){
      var n = natureVue(x.nature);
      return '<div class="card chC" ' +
               (n ? 'style="--nT:' + n.t + ';--nF:' + n.f + ';--nI:' + n.i + '"' : '') +
               ' onclick="ouvrirChantier(\'' + ech(x.id) + '\')">' +
               '<div class="chTete">' +
                 '<b>' + ech(x.client || 'Chantier') + '</b>' +
                 badgeChantier(x) +
               '</div>' +
               '<div class="chSous">' +
                 (x.heure ? '<b class="chH">' + ech(x.heure) + '</b>' : '') +
                 ech(x.ville || '') +
               '</div>' +
               (x.tel ? '<div class="mini" style="margin-top:4px">' + lienTel(x.tel) + '</div>' : '') +
               (n ? '<span class="chNat">' + ech(n.nom) + '</span>' : '') +
               (x.aEnvoyer && Object.keys(x.aEnvoyer).length
                 ? '<div class="mini" style="color:var(--warn);margin-top:6px">' +
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

    var h = futurs.length ? bloc(futurs)
      : '<div class="card"><div class="empty">Rien à venir pour le moment.</div></div>';
    if(passes.length){
      h += AG_PASSE
        ? '<button class="btn sec" style="margin-top:18px" onclick="agVoirPasse(false)">' +
          'Masquer les chantiers passés</button>' +
          '<div class="cat" style="margin-top:18px;opacity:.7">Déjà passés</div>' + bloc(passes)
        : '<button class="btn sec" style="margin-top:18px" onclick="agVoirPasse(true)">' +
          'Voir le passé (' + passes.length + ' chantier' + (passes.length>1?'s':'') + ')</button>';
    }
    c.innerHTML = h;
  });
}

/* ---- un rendez-vous sur son propre planning (13 octobre 2026) ----
   Demande de Simon : « j'aimerais que les commerciaux puissent ajouter et
   supprimer des tâches sur leur emploi du temps ». Ce qu'il ajoute n'est pas
   un chantier de nettoyage mais un rendez-vous : une visite, un relevé, un
   déplacement. Le serveur impose son nom et la nature RDV, quoi que le
   téléphone envoie. */

function nouveauRdv(){
  if(!(CFG && CFG.planning)) return;
  montrer('eAg3');
  $('hTitre').textContent = 'Un rendez-vous';
  erreur('');
  ['rdvQuoi','rdvAdresse','rdvCp','rdvVille','rdvNote'].forEach(function(k){ $(k).value = ''; });
  /* Aujourd'hui par défaut : c'est le jour qu'on pose le plus souvent, et une
     date vide ferait refuser l'envoi par le classeur. */
  $('rdvDate').value = isoJour();
  $('rdvHeure').value = '';
  $('rdvDuree').value = 60;
  window.scrollTo(0,0);
}

function creerLeRdv(btn){
  if(!navigator.onLine) return erreur('Hors connexion : ajouter un rendez-vous demande le réseau.');
  var quoi = ($('rdvQuoi').value || '').trim();
  var date = $('rdvDate').value || '';
  /* On retient le commercial sur l'écran plutôt que d'envoyer un rendez-vous
     que personne ne saurait lire sur le planning. */
  if(!quoi) return erreur('Dis au moins de quoi il s\'agit.');
  if(!date) return erreur('Un rendez-vous sans date n\'apparaît nulle part.');
  var moi = session();
  erreur('');
  if(btn) occuper(btn, 'Ajout…');
  poster({action:'rdvNeuf', nom:moi.nom, code:moi.code, appareil:APPAREIL,
          client:quoi, date:date, heure:$('rdvHeure').value || '',
          duree:Number($('rdvDuree').value) || 0,
          adresse:($('rdvAdresse').value||'').trim(), cp:($('rdvCp').value||'').trim(),
          ville:($('rdvVille').value||'').trim(), note:($('rdvNote').value||'').trim()
  }).then(function(r){
    if(btn) libere(btn);
    if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
    tracer('RDV POSE', quoi + ' · ' + date, r.id || '');
    ecranPlanning();
    chargerPlanning();
  }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
}

function retirerDeMonPlanning(btn){
  var c = CHANTIER;
  if(!c) return;
  if(!navigator.onLine) return erreur('Hors connexion : cette action demande le réseau.');
  /* La confirmation de l'application, jamais celle du navigateur : installée
     sur l'écran d'accueil, confirm() peut répondre « non » tout seul. */
  demander(estRdv(c) ? 'Retirer ce rendez-vous ?' : 'Retirer ce chantier de ton planning ?',
           estRdv(c)
             ? 'Il disparaîtra de ton planning. Tu peux le reposer ensuite.'
             : 'Il quittera ton planning et le bureau sera prévenu que tu l\'as décommandé.',
           'Retirer').then(function(oui){
    if(!oui) return;
    var moi = session();
    if(btn) occuper(btn, 'Retrait…');
    poster({action:'monChantier', nom:moi.nom, code:moi.code, appareil:APPAREIL,
            id:c.id, annuler:true}).then(function(r){
      if(btn) libere(btn);
      if(!r || !r.ok) return erreur((r && r.erreur) ? String(r.erreur) : attenteLisible());
      tracer('CHANTIER RETIRE DU PLANNING', c.client || '', c.id);
      /* La copie gardée sur l'appareil doit partir aussi : sans cela la carte
         resterait sur le planning jusqu'à la prochaine synchronisation. */
      DB.cSuppr(c.id).then(function(){ ecranPlanning(); chargerPlanning(); },
                          function(){ ecranPlanning(); chargerPlanning(); });
    }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
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

  var fz = $('agFiche');
  if(fz){
    fz.classList.toggle('hide', !c.fiche);
    fz.innerHTML = c.fiche ? '<button class="btn" onclick="voirFicheJointe(\'' + ech(String(c.id)).replace(/'/g,'&#39;') +
      '\', this)">📎 Voir la fiche d\'intervention</button>' +
      '<div class="mini" style="margin-top:4px">' + ech(c.fiche) + ' · les instructions du bureau pour ce chantier</div>' : '';
  }
  var tz = $('agTel');
  if(tz){
    tz.classList.toggle('hide', !c.tel);
    tz.innerHTML = c.tel ? '<b>Téléphone du client</b><br><span style="font-size:17px">' + lienTel(c.tel, c.contactTel) + '</span>' : '';
  }
  var acc = $('agAcces');
  if(String(c.acces || '').trim()){
    acc.classList.remove('hide');
    acc.innerHTML = '<b>Accès au site</b><br>' + ech(c.acces);
  } else acc.classList.add('hide');

  // pointage
  var arr = Number(c.arrivee) || 0, dep = Number(c.depart) || 0;
  $('bAgArrive').classList.toggle('hide', !!arr);
  $('bAgFini').classList.toggle('hide', !arr || !!dep);

  /* Le salarié ne voit ni ses heures de pointage ni sa durée sur place
     (décision de Simon, 11 octobre 2026) : elles partent au classeur et
     s'affichent sur l'écran du gérant, pas sur le sien.
     Il voit en revanche que son appui a été pris : sans retour, on rappuie,
     et un deuxième appui pose une deuxième heure. */
  var info = $('agPointInfo');
  info.classList.toggle('ok', !!arr);
  info.classList.toggle('mini', !arr);
  if(!arr) info.textContent = 'Appuie en arrivant, puis en partant.';
  else if(!dep) info.textContent = 'Arrivée enregistrée. Appuie en partant.';
  else info.textContent = 'Pointage enregistré.';

  var d = $('agDuree');
  d.classList.add('hide');
  d.textContent = '';

  // tâches
  var faites = c.faites || [];
  var t = $('agTaches');
  if(!(c.taches || []).length){
    /* Un rendez-vous n'a pas de prestations vendues : sa note EST son contenu.
       « Aucun détail transmis » laisserait croire à un oubli du bureau. */
    t.innerHTML = '<div class="empty">' +
      (estRdv(c) ? 'Un rendez-vous, pas un chantier : ce que tu as noté plus bas en tient lieu.'
                 : 'Aucun détail transmis pour ce chantier.') + '</div>';
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

  /* Retirer de son planning (13 octobre 2026). Deux textes, parce que ce ne
     sont pas deux fois la même chose : son propre rendez-vous ne regarde que
     lui, un chantier affecté par le bureau est une nouvelle pour le bureau. */
  var ret = $('agRetrait');
  if(ret){
    var droit = !!(CFG && CFG.planning);
    ret.classList.toggle('hide', !droit);
    if(droit){
      $('agRetraitMot').textContent = estRdv(c)
        ? 'Tu peux retirer ce rendez-vous : c\'est le tien.'
        : 'Ce chantier vient du bureau. Si tu le retires, il quittera ton planning ' +
          'et le bureau en sera informé.';
      $('bAgRetirer').textContent = estRdv(c) ? 'Retirer ce rendez-vous'
                                              : 'Retirer de mon planning';
    }
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
  REMISE = {valeur:0, muet:false};
  NATURE = null; PASSAGES = 0; SANS_CONTRAT = false; ENGAGEMENT = { mois: 0, tacite: true }; try{ peindreEngagement(); }catch(e){}
  ETAT = 'NORMAL';
  KM = ''; KM_AUTO = true;
  GRP = {};
  PHOTO_ID = null;
  cacherSugg();
  ['cSociete','cSiret','cTva','cCiv','cContact','cTel','cEmail','cAdresse','cCp','cVille','cKm','fSignataire','fNotes','fObjet','fDelai','fDate','fPlaceDate','fPlaceHeure']
    .forEach(function(id){ if($(id)) $(id).value=''; });
  $('fEnvoi').checked = false;
  MAIL_MODE = ''; try{ majCadreMail(); }catch(e){}
  ['fMailA','fMailObjet','fMailTexte'].forEach(function(id){ if($(id)) $(id).value = ''; });
  MAIL_TOUCHE = false; MAIL_TON = 'vous';
  if($('blocMail')) $('blocMail').classList.add('hide');
  $('mSiret').textContent = 'Le n° de TVA se complète tout seul à partir du SIRET.';
  effacerSignature();
  lsj('brouillon', null);
  DERNIER = null;
  TYPE = null; PLUS2ANS = null; TAUX = null;
  ORIGINE = 'PROSPECTION'; LIEU = 'CLIENT'; majOrigine();
  TERMINE_RETOUR = 0; V_TYPE = ''; V_MOTIF = '';
  ETAPE_DEVIS = 1;
  MODIF = null; majBandeauModif();
  $('steps').classList.remove('hide');
  etape(1);
}

/* ====================== PHONING ======================
   La prospection téléphonique en chaîne : une fiche, un appui pour appeler, un
   appui pour noter, et la fiche suivante.

   Ce qui tient tout : le numéro affiché est un vrai <a href="tel:+33…">.
   L'application est servie directement par le navigateur, sans cadre ni bac à
   sable, ce qui permet à iOS d'ouvrir le téléphone. Un composeur rendu dans un
   cadre — un aperçu, une page intégrée — ne le peut pas, et c'est ce qui a
   motivé de mettre ce module ici plutôt qu'à côté.

   Le suivi est commun à toute l'équipe (choix de Simon, 8 octobre 2026) : ce
   que le bureau renvoie fait foi, et les résultats pas encore partis sont
   posés par-dessus. Un prospect appelé par un autre sort donc de la file dès
   la synchronisation suivante. */

var PR = {
  liste: [],          // les prospects tels que le bureau les connaît
  file: [],           // les résultats pas encore partis
  hist: {},           // les tentatives faites sur CET appareil, pour la fiche
  journal: [],        // ce que le bureau a gardé de mes appels, tous appareils
  journalMaj: '',     // quand le bureau a servi ce journal
  journalComplet: true,
  maj: '',            // horodatage du dernier chargement, pour ne demander que les changements
  relance: 3,         // heures avant de retenter un prospect qui n'a pas répondu
  courant: null,      // fiche ouverte depuis la liste, hors file
  passes: {},         // « Passer » ne vaut que pour la session en cours
  brouillons: {},
  onglet: 'appels',
  ville: '', secteur: '', ouverts: false, statut: '',
  rappelOuvert: false, rappelLe: null,
  rdvOuvert: false, rdvLe: null,
  annuler: null,
  auto: true,
  charge: false,
  appelLe: 0          // quand on a quitté l'application pour appeler
};

var PR_RES = {
  nrp:      {l:'Pas de réponse', c:''},
  msg:      {l:'Messagerie',     c:''},
  rappel:   {l:'À rappeler',     c:'att'},
  interesse:{l:'Intéressé',      c:'ok'},
  rdv:      {l:'RDV pris',       c:'ok'},
  refus:    {l:'Pas intéressé',  c:'no'},
  faux:     {l:'Mauvais numéro', c:'no'}
};
/* Les quatre résultats qui ferment le dossier : le prospect ne revient pas
   dans la file, même après le délai de relance. */
var PR_FINIS = ['interesse', 'rdv', 'refus', 'faux'];
var PR_JOURS = ['dim','lun','mar','mer','jeu','ven','sam'];
var PR_SEM = ['lun','mar','mer','jeu','ven','sam','dim'];
var PR_TEL_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>';

/* ---------------------- mémoire locale ---------------------- */

function prCharger(){
  PR.liste = lsj('pr.liste') || [];
  PR.file = lsj('pr.file') || [];
  PR.hist = lsj('pr.hist') || {};
  PR.journal = lsj('pr.journal') || [];
  PR.journalMaj = ls('pr.journalmaj') || '';
  PR.maj = ls('pr.maj') || '';
  PR.relance = Number(ls('pr.relance')) || 3;
  PR.ville = ls('pr.ville') || '';
  PR.secteur = ls('pr.secteur') || '';
  PR.auto = ls('pr.auto') !== '0';
  PR.charge = !!PR.liste.length;
}
function prRanger(){
  lsj('pr.liste', PR.liste);
  lsj('pr.file', PR.file);
  lsj('pr.hist', PR.hist);
  lsj('pr.journal', PR.journal);
  ls('pr.journalmaj', PR.journalMaj);
  ls('pr.maj', PR.maj);
}

/* ---------------------- état d'un prospect ----------------------
   Le bureau donne le dernier état connu ; la file locale le corrige. Un seul
   endroit décide, pour que la file d'appels, la liste et les compteurs ne
   puissent pas se contredire. */
function prEtat(p){
  var e = {statut:p.statut||'', note:p.note||'', rappel:p.rappel||'', rdv:p.rdv||'',
           dernier:p.dernier||'', appels:p.appels||0, par:p.par||'', attente:false};
  PR.file.forEach(function(a){
    if(a.id !== p.id) return;
    e.statut = a.resultat;
    e.note = a.note || '';
    e.rappel = a.resultat === 'rappel' ? (a.rappel || '') : '';
    e.rdv = a.resultat === 'rdv' ? (a.rdv || '') : '';
    e.dernier = a.t;
    e.appels = e.appels + 1;
    e.attente = true;
  });
  return e;
}
function prParId(id){
  for(var i=0;i<PR.liste.length;i++) if(PR.liste[i].id === id) return PR.liste[i];
  return null;
}
function prTels(p){ return (p && p.tels) || []; }

/* Un devis qui part de la fiche du prospect : ses coordonnées sont déjà là,
   les retaper serait du temps perdu et une occasion de faute. Le SIRET reste
   vide — l'annuaire le complète dès que le nom est confirmé. */
function prFaireDevis(){
  var p = prCourant();
  if(!p) return;
  if(!(CFG && CFG.catalogue)){
    return erreur('Le catalogue n\'est pas encore arrivé. Actualise, puis réessaie.');
  }
  var t = prTels(p)[0];
  nouveauDevis();
  TYPE = 'PRO';
  majType();
  $('cSociete').value = p.nom || '';
  $('cContact').value = p.dirigeant || '';
  $('cTel').value = (t && t.t) || '';
  $('cEmail').value = p.mail || '';
  $('cAdresse').value = p.adresse || '';
  $('cVille').value = p.ville || '';
  majKm();
  tracer('DEVIS DEPUIS PROSPECT', p.nom || '', '');
  sauverBrouillon();
  etape(2);
  window.scrollTo(0,0);
}

/* ---------------------- horaires ---------------------- */
function prHm(n){ return (n/60|0) + ' h' + (n%60 ? ' ' + String(n%60).padStart(2,'0') : ''); }
function prOuvert(p, quand){
  var s = (p.h || {})[PR_JOURS[quand.getDay()]];
  if(!s) return {k:'?', t:'Horaires inconnus'};
  if(/ferm/i.test(s)) return {k:'no', t:'Fermé aujourd\'hui'};
  var re = /(\d{1,2})[:h](\d{2})\s*[-–]\s*(\d{1,2})[:h](\d{2})/g, m, plages = [];
  while((m = re.exec(s))) plages.push([+m[1]*60 + +m[2], +m[3]*60 + +m[4]]);
  if(!plages.length) return {k:'?', t:'Horaires inconnus'};
  var h = quand.getHours()*60 + quand.getMinutes(), i;
  for(i=0;i<plages.length;i++)
    if(h >= plages[i][0] && h < plages[i][1]) return {k:'ok', t:'Ouvert, ferme à ' + prHm(plages[i][1])};
  for(i=0;i<plages.length;i++)
    if(plages[i][0] > h) return {k:'no', t:'Fermé, rouvre à ' + prHm(plages[i][0])};
  return {k:'no', t:'Fermé pour aujourd\'hui'};
}

/* ---------------------- la file d'appels ----------------------
   Dans l'ordre : les rappels arrivés à échéance, puis ceux qu'on n'a jamais
   appelés, puis les sans-réponse dont le délai de relance est passé. Les
   prospects sans numéro n'y entrent jamais : il n'y a rien à composer. */
/* Ouvert d'abord, horaires inconnus ensuite, fermés en dernier. Un commercial
   qui téléphone à 16 h ne doit pas tomber sur des rideaux baissés ; mais un
   établissement dont on ignore les horaires vaut mieux qu'un dont on sait
   qu'il est fermé, puisqu'il a une chance de décrocher. */
function prRangOuverture(p, quand){
  var k = prOuvert(p, quand).k;
  return k === 'ok' ? 0 : k === '?' ? 1 : 2;
}

/* La file. L'ouverture commande, et à l'intérieur de chaque tranche viennent
   d'abord les rappels arrivés à échéance, puis les jamais appelés par priorité
   décroissante, puis les sans-réponse dont le délai est passé, du plus ancien
   au plus récent.

   L'ouverture passe **avant le rappel dû** : un rendez-vous téléphonique chez
   un établissement fermé ne se tient pas, autant le reprendre à la réouverture.
   Il ne sort pas de la file pour autant, il descend. */
function prFile(){
  var maintenant = Date.now(), quand = new Date();
  var retenus = [], plusTard = 0;
  PR.liste.forEach(function(p){
    if(!prTels(p).length) return;
    if(PR.ville && p.ville !== PR.ville) return;
    if(PR.secteur && p.secteur !== PR.secteur) return;
    if(PR.passes[p.id]) return;
    var e = prEtat(p), rang, cle;
    if(e.statut === 'rappel'){
      if(!e.rappel || new Date(e.rappel).getTime() > maintenant) return;
      rang = 0; cle = new Date(e.rappel).getTime();
    } else if(PR_FINIS.indexOf(e.statut) >= 0){
      return;
    } else if(!e.statut){
      rang = 1; cle = -(p.prio || 0);
    } else {
      // nrp ou msg : on retente passé le délai
      var t = e.dernier ? new Date(e.dernier).getTime() : 0;
      if(maintenant - t < PR.relance*3600000){ plusTard++; return; }
      rang = 2; cle = t;
    }
    // « Ouverts maintenant » : écarte les fermés, garde ceux qu'on ne connaît pas
    var ouv = prRangOuverture(p, quand);
    if(PR.ouverts && ouv === 2) return;
    retenus.push({p: p, ouv: ouv, rang: rang, cle: cle});
  });
  retenus.sort(function(a, b){
    return (a.ouv - b.ouv) || (a.rang - b.rang) || (a.cle - b.cle);
  });
  return {liste: retenus.map(function(x){ return x.p; }), plusTard: plusTard};
}
function prCourant(){
  if(PR.courant) return prParId(PR.courant);
  return prFile().liste[0] || null;
}

/* ---------------------- écran ---------------------- */

function ouvrirPhoning(){
  ETAPE = 8;
  prCharger();
  montrer('ePro');
  $('steps').classList.add('hide');
  barreRetour();
  $('bHist').classList.remove('hide');
  $('hTitre').textContent = 'Phoning';
  $('prAuto').checked = PR.auto;
  $('prOuverts').checked = PR.ouverts;
  prOnglet(PR.onglet);
  prRendre(true);
  window.scrollTo(0,0);
  // La liste se rafraîchit en arrivant, jamais de façon bloquante : hors
  // connexion, celle du dernier chargement reste parfaitement utilisable.
  prRecharger(null);
}

function prOnglet(n){
  PR.onglet = n;
  $('prVueAppels').classList.toggle('hide', n !== 'appels');
  $('prVueListe').classList.toggle('hide', n !== 'liste');
  $('prVueJournal').classList.toggle('hide', n !== 'journal');
  $('prVueReglages').classList.toggle('hide', n !== 'reglages');
  $('prOngA').classList.toggle('on', n === 'appels');
  $('prOngL').classList.toggle('on', n === 'liste');
  $('prOngJ').classList.toggle('on', n === 'journal');
  $('prOngR').classList.toggle('on', n === 'reglages');
  if(n === 'liste') prRendreListe();
  if(n === 'journal'){ prRendreJournal(); prChargerJournal(); }
  if(n === 'reglages') prRendreSource();
}
function prSetVille(v){ PR.ville = v; ls('pr.ville', v); PR.courant = null; prRendre(true); }
function prSetSecteur(v){ PR.secteur = v; ls('pr.secteur', v); PR.courant = null; prRendre(true); }
function prSetOuverts(v){ PR.ouverts = v; PR.courant = null; prRendre(true); }
function prSetAuto(v){ PR.auto = v; ls('pr.auto', v ? '1' : '0'); }

function prRendre(force){
  if(ETAPE !== 8) return;
  var f = prFile();
  prRendreStats(f);
  prRendreVilles();
  prRendreFiche(f);
  if(PR.onglet === 'liste') prRendreListe();
  if(PR.onglet === 'journal') prRendreJournal();
  if(force) prRanger();
}

function prRendreStats(f){
  var auj = new Date().toDateString(), appels = 0, chauds = 0, rdv = 0, rap = 0;
  PR.liste.forEach(function(p){
    var e = prEtat(p);
    if(e.dernier && new Date(e.dernier).toDateString() === auj) appels++;
    if(e.statut === 'interesse') chauds++;
    if(e.statut === 'rdv') rdv++;
    if(e.statut === 'rappel') rap++;
  });
  /* Combien, dans la file, sont ouverts à cette heure-ci. Affiché seulement si
     on connaît au moins un horaire : sans horaires, « 0 ouvert » ferait croire
     à une liste vide alors qu'on ne sait simplement pas. */
  var quand = new Date(), connus = 0, ouverts = 0;
  f.liste.forEach(function(p){
    var r = prRangOuverture(p, quand);
    if(r !== 1) connus++;
    if(r === 0) ouverts++;
  });
  $('prStats').innerHTML =
    '<span><b>' + appels + '</b> appel' + (appels>1?'s':'') + ' aujourd\'hui</span>' +
    (connus ? '<span><b>' + ouverts + '</b> ouvert' + (ouverts>1?'s':'') + ' maintenant</span>' : '') +
    '<span><b>' + chauds + '</b> intéressé' + (chauds>1?'s':'') + '</span>' +
    '<span><b>' + rdv + '</b> RDV</span>' +
    '<span><b>' + rap + '</b> à rappeler</span>';
  $('prNb').textContent = PR.liste.length ? '· ' + f.liste.length : '';
}

/* Les deux menus se calculent l'un en fonction de l'autre : choisir une commune
   ne doit pas laisser dans les secteurs des choix qui n'y donneraient rien. */
function prRendreVilles(){
  remplirMenu('prVille', 'ville', PR.ville, 'Toutes les communes', PR.secteur, 'secteur');
  remplirMenu('prSecteur', 'secteur', PR.secteur, 'Tous les secteurs', PR.ville, 'ville');
}
function remplirMenu(id, champ, choisi, tout, autreValeur, autreChamp){
  var sel = $(id);
  if(!sel) return;
  var vues = {}, total = 0;
  PR.liste.forEach(function(p){
    if(autreValeur && p[autreChamp] !== autreValeur) return;
    var v = p[champ] || '';
    if(!v) return;
    vues[v] = (vues[v]||0) + 1;
    total++;
  });
  var opts = ['<option value="">' + tout + ' (' + total + ')</option>'];
  Object.keys(vues).sort().forEach(function(v){
    opts.push('<option value="' + ech(v) + '"' + (v === choisi ? ' selected' : '') + '>' +
              ech(v) + ' (' + vues[v] + ')</option>');
  });
  sel.innerHTML = opts.join('');
}

function prRendreFiche(f){
  var b = $('prFiche');
  if(!PR.liste.length){
    b.innerHTML = '<div class="card"><div class="empty">Aucun prospect chargé.<br>' +
      'Le bureau doit lancer « Importer les prospects » dans le classeur,<br>' +
      'puis tu recharges la liste depuis les réglages.</div></div>';
    return;
  }
  var p = PR.courant ? prParId(PR.courant) : null;
  if(!p){ PR.courant = null; p = f.liste[0]; }
  if(!p){
    var np = Object.keys(PR.passes).length;
    b.innerHTML = '<div class="card"><div class="empty">File terminée.<br>' +
      'Plus personne à appeler avec ces filtres' +
      (f.plusTard ? ', et ' + f.plusTard + ' sans réponse à retenter dans quelques heures' : '') + '.</div>' +
      (np ? '<button class="btn sec" onclick="prReprendrePasses()">Reprendre les ' + np + ' passés</button>' : '') +
      '</div>';
    return;
  }

  var e = prEtat(p), tels = prTels(p), quand = new Date(), ouv = prOuvert(p, quand);
  var rang = f.liste.indexOf(p);
  var h = '<div class="card">';
  /* Deux étiquettes au plus : l'ouverture et, s'il y en a un, le résultat du
     dernier appel. L'ouverture reste visible même quand un statut occupe la
     place : c'est elle qui dit si cet appel-ci a une chance d'aboutir. */
  var etiq = '';
  if(e.statut){
    etiq += '<span class="prEtiq ' + (ouv.k === 'ok' ? 'ok' : ouv.k === 'no' ? 'no' : '') + '">' +
            (ouv.k === 'ok' ? 'Ouvert' : ouv.k === 'no' ? 'Fermé' : 'Horaires inconnus') + '</span>';
    etiq += '<span class="prEtiq ' + PR_RES[e.statut].c + '">' + PR_RES[e.statut].l +
            (e.attente ? ' · à envoyer' : '') + '</span>';
  } else {
    etiq = '<span class="prEtiq ' + (ouv.k === 'ok' ? 'ok' : ouv.k === 'no' ? 'no' : '') + '">' +
           ech(ouv.t) + '</span>';
  }
  h += '<div class="prEnt"><span>' + ech(p.ville) +
       (p.prio ? ' · priorité ' + p.prio : '') +
       (rang >= 0 ? ' · ' + (rang+1) + ' / ' + f.liste.length : '') + '</span>' +
       '<span class="prEtiqs">' + etiq + '</span></div>';
  h += '<div class="prNom">' + ech(p.nom) + '</div>';
  var sous = [];
  if(p.activite || p.secteur) sous.push(ech(p.activite || p.secteur));
  if(p.dirigeant) sous.push(ech(p.dirigeant));
  if(sous.length) h += '<div class="prDir">' + sous.join(' · ') + '</div>';

  tels.forEach(function(x, i){
    h += '<a class="prAppel' + (i ? ' sec' : '') + '"' + (i ? '' : ' id="prBoutonAppel"') +
         ' href="tel:' + ech(x.t) + '" onclick="prAppelLance()">' +
         PR_TEL_SVG + '<span>' + ech(x.l) + '</span></a>';
  });

  if(p.h && Object.keys(p.h).length){
    var auj = PR_JOURS[quand.getDay()];
    h += '<div class="prSem">';
    PR_SEM.forEach(function(j){
      var v = p.h[j] || '—', ferme = v === '—' || /ferm/i.test(v);
      h += '<div class="prJour' + (j === auj ? ' auj' : '') + (ferme ? ' off' : '') + '"><b>' +
           j.toUpperCase() + '</b>' +
           ech(ferme ? (v === '—' ? '—' : 'Fermé') : v).replace(/\s*\/\s*/g, '<br>').replace(/-/g, '–<wbr>') +
           '</div>';
    });
    h += '</div>';
    if(e.statut) h += '<div class="mini">' + ech(ouv.t) + '</div>';
    if(/estim/i.test(p.src || '')) h += '<div class="mini">Horaires estimés, à confirmer.</div>';
  }

  var site = p.site ? [p.site] : (p.info || '').match(/https?:\/\/[^\s·]+/);
  h += '<dl class="prMeta">';
  if(p.adresse) h += '<dt>Adresse</dt><dd>' + ech(p.adresse) +
                     (p.zone && p.zone !== p.ville ? ' <span class="mini">(' + ech(p.zone) + ')</span>' : '') + '</dd>';
  if(p.mail) h += '<dt>Mail</dt><dd>' + ech(p.mail) + '</dd>';
  if(p.effectif && p.effectif !== 'NC') h += '<dt>Effectif</dt><dd>' + ech(p.effectif) + '</dd>';
  if(site){
    var u = String(site[0]);
    var href = /^https?:/.test(u) ? u : 'https://' + u;
    h += '<dt>Site</dt><dd><a href="' + ech(href) + '" target="_blank" rel="noopener">' +
         ech(u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a></dd>';
  }
  var info = (p.info || '').replace(/\s*·?\s*Site\s*:\s*https?:\/\/[^\s·]+/, '');
  if(info) h += '<dt>Infos</dt><dd>' + ech(info) + '</dd>';
  h += '</dl>';

  var lignes = (PR.hist[p.id] || []).slice(-4).map(function(t){
    return '<li>' + ech(prQuandTexte(t.t)) + ' — ' + ech((PR_RES[t.r] || {l:t.r}).l) + '</li>';
  });
  if(e.appels && !lignes.length){
    lignes.push('<li>' + e.appels + ' appel' + (e.appels>1?'s':'') +
                (e.dernier ? ', dernier ' + ech(prQuandTexte(e.dernier)) : '') +
                (e.par ? ' par ' + ech(e.par) : '') + '</li>');
  }
  if(e.statut === 'rappel' && e.rappel) lignes.push('<li>Rappel prévu ' + ech(prQuandTexte(e.rappel)) + '</li>');
  if(e.statut === 'rdv') lignes.push('<li>' + (e.rdv
    ? 'Rendez-vous le ' + ech(prQuandTexte(e.rdv))
    : 'Rendez-vous pris, date à caler') + '</li>');
  if(lignes.length) h += '<ul class="prHist">' + lignes.join('') + '</ul>';

  /* Le gérant chiffre au bureau, souvent pendant l'appel : il part de la fiche
     plutôt que de retaper le client. Les commerciaux, eux, chiffrent sur place
     et n'ont pas besoin de ce raccourci au milieu de leur boucle d'appels. */
  if(estAdmin()){
    h += '<button class="btn sec sm" style="margin-top:12px;width:100%" ' +
         'onclick="prFaireDevis()">Faire un devis pour ce prospect</button>';
  }

  var note = PR.brouillons[p.id] != null ? PR.brouillons[p.id] : (e.note || '');
  h += '<label style="margin-top:14px">Note</label>' +
       '<textarea id="prNote" rows="2" placeholder="Ce qui s\'est dit, la personne à redemander…" ' +
       'oninput="prNoter(this.value)">' + ech(note) + '</textarea>';
  h += '</div>';

  h += '<div class="prRes">';
  ['nrp','msg','rappel','interesse','rdv','refus','faux'].forEach(function(k){
    var ouvert = (k === 'rappel' && PR.rappelOuvert) || (k === 'rdv' && PR.rdvOuvert);
    h += '<button class="' + PR_RES[k].c + (ouvert ? ' on' : '') +
         '" onclick="prResultat(\'' + k + '\')">' + PR_RES[k].l + '</button>';
  });
  h += '<button onclick="prPasser()">Passer</button>';
  /* Le rendez-vous (14 octobre 2026). Même patron que le rappel, à une
     différence qui est tout l'objet de la demande : **le bouton n'est jamais
     désactivé**. Un commercial qui a décroché un rendez-vous sans date
     arrêtée doit pouvoir l'enregistrer tout de suite — sinon il s'arrête au
     milieu de sa session d'appels, ou il invente une date fausse. */
  if(PR.rdvOuvert){
    h += '<div class="prRappel"><b>Le rendez-vous est quand ?</b>' +
         '<div class="mini" style="margin-top:4px">Facultatif : tu peux enregistrer ' +
         'sans date et la caler plus tard.</div><div class="prQuand">' +
         prRdvChoix().map(function(c){
           return '<button class="' + (PR.rdvLe === c.at ? 'on' : '') +
                  '" onclick="prRdvPoser(\'' + c.at + '\')">' + c.l + '</button>';
         }).join('') + '</div>' +
         '<input type="datetime-local" id="prRdvLe" oninput="prRdvSaisi(this.value)" value="' +
         (PR.rdvLe ? prLocalInput(PR.rdvLe) : '') + '">' +
         '<button class="btn" style="margin-top:8px" onclick="prResultatFinal(\'rdv\')">' +
         (PR.rdvLe ? 'Enregistrer le RDV' : 'Enregistrer sans date') + '</button></div>';
  }
  if(PR.rappelOuvert){
    h += '<div class="prRappel"><b>Rappeler quand ?</b><div class="prQuand">' +
         prQuandChoix().map(function(c){
           return '<button class="' + (PR.rappelLe === c.at ? 'on' : '') +
                  '" onclick="prQuandPoser(\'' + c.at + '\')">' + c.l + '</button>';
         }).join('') + '</div>' +
         '<input type="datetime-local" id="prQuandLe" oninput="prQuandSaisi(this.value)" value="' +
         (PR.rappelLe ? prLocalInput(PR.rappelLe) : '') + '">' +
         '<button class="btn" style="margin-top:8px"' + (PR.rappelLe ? '' : ' disabled') +
         ' onclick="prResultatFinal(\'rappel\')">Enregistrer le rappel</button></div>';
  }
  h += '</div>';

  var sous = [];
  if(PR.annuler) sous.push('<a href="#" onclick="prAnnuler();return false;">Annuler le dernier résultat</a>');
  if(PR.courant) sous.push('<a href="#" onclick="prRevenirFile();return false;">Revenir à la file</a>');
  if(PR.file.length) sous.push(PR.file.length + ' résultat' + (PR.file.length>1?'s':'') + ' à envoyer');
  if(sous.length) h += '<div class="mini" style="text-align:center;margin-top:12px">' + sous.join(' · ') + '</div>';

  b.innerHTML = h;
}

function prQuandTexte(iso){
  var d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  var h = d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  return d.toDateString() === new Date().toDateString()
    ? 'aujourd\'hui ' + h
    : d.toLocaleDateString('fr-FR', {weekday:'short', day:'numeric', month:'short'}) + ' ' + h;
}
function prLocalInput(iso){
  var d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function prQuandChoix(){
  var n = new Date(), out = [];
  function a(j, h){ var d = new Date(n); d.setDate(d.getDate()+j); d.setHours(h,0,0,0); return d.toISOString(); }
  out.push({l:'Dans 1 h', at:new Date(Math.ceil((n.getTime()+3600000)/300000)*300000).toISOString()});
  if(n.getHours() < 13) out.push({l:'Cet après-midi 14 h', at:a(0,14)});
  // Appeler une entreprise un dimanche ne sert à rien : le samedi renvoie au
  // lundi, et le vendredi aussi.
  var j = n.getDay() === 5 ? 3 : n.getDay() === 6 ? 2 : 1;
  out.push({l:(j === 1 ? 'Demain' : 'Lundi') + ' 9 h', at:a(j,9)});
  out.push({l:(j === 1 ? 'Demain' : 'Lundi') + ' 14 h', at:a(j,14)});
  out.push({l:'Dans 1 semaine', at:a(7,9)});
  return out;
}
function prQuandPoser(at){ PR.rappelLe = at; prRendre(); }
function prQuandSaisi(v){
  var d = new Date(v);
  PR.rappelLe = isNaN(d.getTime()) ? null : d.toISOString();
  var b = $('prQuandLe'); if(b) b.parentNode.querySelector('.btn').disabled = !PR.rappelLe;
}
function prNoter(v){ var p = prCourant(); if(p) PR.brouillons[p.id] = v; }

function prResultat(code){
  if(code === 'rappel'){
    PR.rappelOuvert = !PR.rappelOuvert;
    PR.rdvOuvert = false;
    PR.rappelLe = null;
    return prRendre();
  }
  /* Un rendez-vous ouvre son panneau au lieu de partir tout de suite : la date
     se saisit là. Mais contrairement au rappel, rien n'empêche de l'enregistrer
     sans. Un second appui sur « RDV pris » referme le panneau. */
  if(code === 'rdv'){
    PR.rdvOuvert = !PR.rdvOuvert;
    PR.rappelOuvert = false;
    PR.rdvLe = null;
    return prRendre();
  }
  prResultatFinal(code);
}

/* Les choix rapides du rendez-vous ne sont pas ceux du rappel : on ne cale pas
   une visite « dans une heure ». Ce sont des demi-journées, à partir de demain,
   et c'est le créneau qu'on propose au téléphone. */
function prRdvChoix(){
  var n = new Date(), out = [];
  function a(j, h){ var d = new Date(n); d.setDate(d.getDate()+j); d.setHours(h,0,0,0); return d.toISOString(); }
  /* Un rendez-vous le dimanche n'existe pas : le samedi et le vendredi
     renvoient au lundi, comme pour la file d'appels. */
  var j = n.getDay() === 5 ? 3 : n.getDay() === 6 ? 2 : 1;
  var nom = j === 1 ? 'Demain' : 'Lundi';
  out.push({l:nom + ' 9 h', at:a(j,9)});
  out.push({l:nom + ' 14 h', at:a(j,14)});
  out.push({l:'Dans 3 jours, 9 h', at:a(3,9)});
  out.push({l:'La semaine prochaine', at:a(7,9)});
  return out;
}
function prRdvPoser(at){ PR.rdvLe = at; prRendre(); }
function prRdvSaisi(v){
  var d = new Date(v);
  PR.rdvLe = isNaN(d.getTime()) ? null : d.toISOString();
  /* On repeint seulement le libellé du bouton : un rendu complet refermerait
     le sélecteur de date au milieu de la saisie. */
  var b = $('prRdvLe');
  if(b){
    var bt = b.parentNode.querySelector('.btn');
    if(bt) bt.textContent = PR.rdvLe ? 'Enregistrer le RDV' : 'Enregistrer sans date';
  }
}

/* Le cœur de la boucle. Tout ce qui suit l'appui doit tenir dans la même
   impulsion : iOS n'ouvre le téléphone que si le geste de l'utilisateur est
   encore vivant, et il ne l'est que quelques instants. On repeint, puis on
   appuie sur le lien du suivant — sans attendre ni réseau ni enregistrement. */
function prResultatFinal(code){
  var p = prCourant();
  if(!p) return;
  if(code === 'rappel' && !PR.rappelLe) return;
  var note = $('prNote') ? $('prNote').value.trim() : (prEtat(p).note || '');
  var a = {id:p.id, resultat:code, note:note, t:new Date().toISOString(),
           rappel: code === 'rappel' ? PR.rappelLe : '',
           rdv: code === 'rdv' ? (PR.rdvLe || '') : ''};
  PR.annuler = {id:p.id, file:PR.file.slice(0), hist:(PR.hist[p.id]||[]).slice(0)};
  PR.file.push(a);
  PR.hist[p.id] = (PR.hist[p.id] || []).concat([{t:a.t, r:code, n:note}]).slice(-20);
  delete PR.brouillons[p.id];
  PR.courant = null;
  PR.rappelOuvert = false;
  PR.rappelLe = null;
  PR.rdvOuvert = false;
  PR.rdvLe = null;
  prRendre(true);
  window.scrollTo(0,0);
  if(PR.auto){
    var lien = $('prBoutonAppel');
    if(lien){ try{ lien.click(); }catch(e){} }
  }
  prPousser();
}

/* iOS quitte l'application pour passer l'appel et y revient en haut de la
   fiche, alors que les résultats sont en bas : le commercial défilerait à
   chaque appel. On note l'instant du départ, et au retour on amène les
   boutons sous son pouce. Deux heures de validité : il arrive qu'un appel
   dure, jamais qu'il dure une demi-journée. */
function prAppelLance(){ PR.appelLe = Date.now(); }
document.addEventListener('visibilitychange', function(){
  if(document.hidden || ETAPE !== 8 || !PR.appelLe) return;
  var vieux = Date.now() - PR.appelLe > 2*3600000;
  PR.appelLe = 0;
  if(vieux) return;
  var r = document.querySelector('#prFiche .prRes');
  if(r) try{ r.scrollIntoView({block:'end', behavior:'smooth'}); }catch(e){ r.scrollIntoView(false); }
});

function prPasser(){
  var p = prCourant();
  if(!p) return;
  if(PR.courant) PR.courant = null; else PR.passes[p.id] = 1;
  PR.rappelOuvert = false;
  prRendre();
  window.scrollTo(0,0);
}
function prReprendrePasses(){ PR.passes = {}; prRendre(); }
function prRevenirFile(){ PR.courant = null; PR.rappelOuvert = false; prRendre(); }
function prAnnuler(){
  if(!PR.annuler) return;
  PR.file = PR.annuler.file;
  if(PR.annuler.hist.length) PR.hist[PR.annuler.id] = PR.annuler.hist;
  else delete PR.hist[PR.annuler.id];
  PR.courant = PR.annuler.id;
  PR.annuler = null;
  prRendre(true);
}

/* ---------------------- l'onglet Liste ---------------------- */
function prRendreListe(){
  var q = normNom($('prQ') ? $('prQ').value : '');
  var choix = [['', 'Tous'], ['none', 'Jamais appelés']];
  Object.keys(PR_RES).forEach(function(k){ choix.push([k, PR_RES[k].l]); });
  $('prFiltreStatut').innerHTML = choix.map(function(c){
    return '<button class="' + (PR.statut === c[0] ? 'on' : '') +
           '" onclick="prSetStatut(\'' + c[0] + '\')">' + c[1] + '</button>';
  }).join('');

  if(!PR.liste.length){
    $('prListe').innerHTML = '<div class="empty">Aucun prospect chargé.</div>';
    return;
  }
  var out = PR.liste.filter(function(p){
    var e = prEtat(p), code = e.statut || 'none';
    if(PR.statut && code !== PR.statut) return false;
    return !q || normNom(p.nom + ' ' + (p.dirigeant||'') + ' ' + p.ville + ' ' +
                        (p.secteur||'') + ' ' + (p.activite||'')).indexOf(q) >= 0;
  });
  if(!out.length){ $('prListe').innerHTML = '<div class="empty">Aucun prospect ne correspond.</div>'; return; }
  $('prListe').innerHTML = out.slice(0,300).map(function(p){
    var e = prEtat(p);
    return '<button class="prLigne" onclick="prOuvrirFiche(\'' + ech(p.id) + '\')">' +
      '<span><b>' + ech(p.nom) + '</b><span>' + ech(p.ville) +
      (prTels(p).length ? '' : ' · sans numéro') +
      (e.note ? ' · ' + ech(e.note.slice(0,50)) : '') + '</span></span>' +
      (e.statut ? '<span class="prEtiq ' + PR_RES[e.statut].c + '">' + PR_RES[e.statut].l + '</span>' : '') +
      '</button>';
  }).join('') + (out.length > 300
    ? '<div class="mini">300 premiers sur ' + out.length + '. Affine la recherche.</div>' : '');
}
function prSetStatut(s){ PR.statut = s; prRendreListe(); }
function prOuvrirFiche(id){
  PR.courant = id;
  PR.rappelOuvert = false;
  prOnglet('appels');
  prRendre();
  window.scrollTo(0,0);
}

function prRendreSource(){
  var sans = PR.liste.filter(function(p){ return !prTels(p).length; }).length;
  $('prSource').textContent = PR.liste.length
    ? PR.liste.length + ' prospects, dont ' + sans + ' sans numéro.' +
      (PR.maj ? ' Liste reçue ' + prQuandTexte(PR.maj) + '.' : '') +
      (PR.file.length ? ' ' + PR.file.length + ' résultat(s) à envoyer.' : '')
    : 'Aucune liste chargée.';
}

/* ---------------------- l'onglet Journal ----------------------
   Ce que le commercial a fait, groupé par jour. Trois sources se superposent,
   de la moins sûre à la plus sûre :

   — ce qui attend d'être envoyé (PR.file), pour que l'appel qu'on vient de
     noter apparaisse même sans réseau ;
   — ce que cet appareil a gardé (PR.hist), qui survit à l'envoi ;
   — ce que le bureau renvoie (PR.journal), qui porte aussi ce qui a été fait
     depuis un autre téléphone, et qui l'emporte quand les deux se croisent.

   La clé de fusion est celle que le classeur emploie lui-même pour refuser un
   lot renvoyé deux fois : l'identifiant du prospect et l'horodatage à la
   seconde. Le classeur arrondit à la seconde en écrivant, on arrondit pareil
   en relisant, sinon le même appel compterait deux fois. */

function prCleAppel(id, t){
  var d = new Date(t);
  return id + '|' + (isNaN(d.getTime()) ? String(t) : Math.floor(d.getTime()/1000));
}

/* Le journal, du plus récent au plus ancien. Chaque entrée porte de quoi
   s'afficher seule : le bureau donne la société, l'appareil ne connaît que
   l'identifiant et va la chercher dans la liste — et ne la trouve pas toujours,
   si le prospect a quitté la liste depuis. */
function prJournal(){
  var vus = {}, out = [];
  var poser = function(e){
    var c = prCleAppel(e.id, e.t);
    if(vus[c] != null){
      // déjà là : on ne garde que ce qui manquait à l'autre source
      var d = out[vus[c]];
      if(!d.societe && e.societe) d.societe = e.societe;
      if(!d.commune && e.commune) d.commune = e.commune;
      if(!d.note && e.note) d.note = e.note;
      if(!d.rappel && e.rappel) d.rappel = e.rappel;
      if(e.envoye === false) d.envoye = false;
      return;
    }
    vus[c] = out.length;
    out.push(e);
  };

  PR.journal.forEach(function(a){
    poser({t:a.t, id:a.id, resultat:a.resultat, note:a.note || '',
           rappel:a.rappel || '', societe:a.societe || '', commune:a.commune || '',
           envoye:true});
  });
  Object.keys(PR.hist).forEach(function(id){
    (PR.hist[id] || []).forEach(function(h){
      var p = prParId(id);
      poser({t:h.t, id:id, resultat:h.r, note:h.n || '', rappel:'',
             societe:p ? p.nom : '', commune:p ? p.ville : '', envoye:true});
    });
  });
  PR.file.forEach(function(a){
    var p = prParId(a.id);
    poser({t:a.t, id:a.id, resultat:a.resultat, note:a.note || '',
           rappel:a.rappel || '', societe:p ? p.nom : '', commune:p ? p.ville : '',
           envoye:false});
  });

  out.sort(function(a, b){ return (new Date(b.t)) - (new Date(a.t)); });
  /* Un téléphone ne peint pas des milliers de lignes, et personne ne remonte
     si loin : au-delà, l'écran le dit plutôt que de ramer. */
  out.tronque = out.length > PR_JOURNAL_MAX;
  return out.tronque ? out.slice(0, PR_JOURNAL_MAX) : out;
}
var PR_JOURNAL_MAX = 400;

/* Le titre d'un groupe : le jour tel qu'on le dit, pas tel qu'on l'écrit. */
function prJourTitre(d){
  var auj = new Date(); auj.setHours(0,0,0,0);
  var j = new Date(d); j.setHours(0,0,0,0);
  var ecart = Math.round((auj - j) / 86400000);
  if(ecart === 0) return 'Aujourd\'hui';
  if(ecart === 1) return 'Hier';
  var t = j.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long'});
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function prRendreJournal(){
  var b = $('prJournal');
  if(!b) return;
  var tout = prJournal();
  var tronque = !!tout.tronque;
  if(!tout.length){
    b.innerHTML = '<div class="empty">Aucun appel pour l\'instant.<br>' +
      'Ce que tu notes dans l\'onglet Appels apparaîtra ici, jour par jour.</div>';
    $('prJEtat').textContent = '';
    return;
  }

  /* Un groupe par jour, dans l'ordre où les appels arrivent — ils sont déjà
     triés, il suffit de couper quand le jour change. */
  var h = '', jour = '', ouvert = false;
  tout.forEach(function(e){
    var d = new Date(e.t);
    var titre = prJourTitre(d);
    if(titre !== jour){
      if(ouvert) h += '</div>';
      jour = titre;
      var n = tout.filter(function(x){ return prJourTitre(new Date(x.t)) === titre; }).length;
      h += '<div class="prJJour"><span>' + ech(titre) + '</span>' +
           '<span>' + n + ' appel' + (n > 1 ? 's' : '') + '</span></div><div>';
      ouvert = true;
    }
    var r = PR_RES[e.resultat] || {l:e.resultat, c:''};
    var p = prParId(e.id);
    var nom = e.societe || (p ? p.nom : '') || 'Prospect retiré de la liste';
    var heure = new Date(e.t).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
    var sous = [heure, e.commune || (p ? p.ville : '')].filter(function(x){ return x; }).join(' · ');
    if(e.note) sous += ' · ' + e.note.slice(0, 60);
    if(!e.envoye) sous += ' · à envoyer';
    /* Sans fiche à rouvrir, la ligne n'est pas un bouton : rien ne doit
       suggérer un appui qui ne mènerait nulle part. */
    h += p
      ? '<button class="prLigne" onclick="prOuvrirFiche(\'' + ech(e.id) + '\')">' +
        '<span><b>' + ech(nom) + '</b><span>' + ech(sous) + '</span></span>' +
        '<span class="prEtiq ' + r.c + '">' + ech(r.l) + '</span></button>'
      : '<div class="prLigne prLigneMorte">' +
        '<span><b>' + ech(nom) + '</b><span>' + ech(sous) + '</span></span>' +
        '<span class="prEtiq ' + r.c + '">' + ech(r.l) + '</span></div>';
  });
  if(ouvert) h += '</div>';
  b.innerHTML = h;

  var e = $('prJEtat');
  if(e){
    e.textContent = tout.length + ' appel' + (tout.length > 1 ? 's' : '') +
      (tronque || !PR.journalComplet ? ' (les plus récents)' : '') +
      (PR.journalMaj ? ' · bureau relu ' + prQuandTexte(PR.journalMaj) : '') +
      (PR.journalMaj ? '' : ' · depuis ce téléphone seulement');
  }
}

/* Le bureau est interrogé à l'ouverture de l'onglet, jamais de façon
   bloquante : hors connexion, ce que l'appareil a gardé s'affiche déjà, et la
   demande échouera sans rien effacer. */
var PR_JOURNAL_EN_COURS = false;
function prChargerJournal(btn){
  var moi = session();
  if(!moi || !navigator.onLine){
    if(btn){ libere(btn); etatReseau(null, 'Hors connexion : le journal de ce téléphone reste affiché.', 'off'); }
    return Promise.resolve();
  }
  if(PR_JOURNAL_EN_COURS) return Promise.resolve();
  PR_JOURNAL_EN_COURS = true;
  if(btn) occuper(btn, 'Chargement…');
  return poster({action:'historique', nom:moi.nom, code:moi.code}, 30000)
    .then(function(r){
      if(!r || !r.ok) throw new Error((r && r.erreur) || 'refus');
      PR.journal = r.appels || [];
      PR.journalComplet = r.complet !== false;
      PR.journalMaj = new Date().toISOString();
      prRanger();
      if(PR.onglet === 'journal') prRendreJournal();
    })
    /* Un .catch() après, et non le second argument du .then() : celui-ci ne
       rattrape pas ce que le premier a levé, et le refus du bureau finirait
       en promesse rejetée dans la console du commercial. */
    .catch(function(){
      if(btn) etatReseau(null, 'Le journal n\'a pas pu être relu. Réessaie.', 'err');
    })
    .then(function(){
      PR_JOURNAL_EN_COURS = false;
      if(btn) libere(btn);
    });
}

/* ---------------------- échanges avec le bureau ---------------------- */

function prRecharger(btn){
  var moi = session();
  if(!moi || !navigator.onLine){
    if(btn){ libere(btn); etatReseau(null, 'Hors connexion : la liste du dernier chargement reste utilisable.', 'off'); }
    return Promise.resolve();
  }
  if(btn) occuper(btn, 'Chargement…');
  // Les résultats partent d'abord : sans quoi la liste rechargée écraserait
  // l'état local de prospects qu'on vient d'appeler.
  return prPousser().then(function(){
    return poster({action:'prospects', nom:moi.nom, code:moi.code, depuis:PR.maj}, 40000);
  }).then(function(r){
    if(!r || !r.ok) throw new Error((r && r.erreur) || 'refus');
    if(r.relanceHeures) { PR.relance = r.relanceHeures; ls('pr.relance', String(PR.relance)); }
    prFusionner(r.prospects || [], !!r.complet);
    PR.maj = r.maj || new Date().toISOString();
    PR.charge = true;
    prRanger();
    prRendre();
    prRendreSource();
  }).catch(function(){
    if(btn) etatReseau(null, 'La liste n\'a pas pu être chargée. Réessaie.', 'err');
  }).then(function(){
    if(btn) libere(btn);
  });
}

function prFusionner(recus, complet){
  if(complet){ PR.liste = recus; return; }
  var par = {};
  PR.liste.forEach(function(p, i){ par[p.id] = i; });
  recus.forEach(function(p){
    if(par[p.id] == null){ par[p.id] = PR.liste.length; PR.liste.push(p); }
    else PR.liste[par[p.id]] = p;
  });
}

/* Les résultats partent par lots. Ce qui est parti quitte la file, et rien
   d'autre : un résultat noté pendant l'envoi reste en attente du prochain. */
var PR_ENVOI = false;
function prPousser(){
  if(PR_ENVOI || !PR.file.length) return Promise.resolve();
  var moi = session();
  if(!moi || !navigator.onLine) return Promise.resolve();
  var lot = PR.file.slice(0, 100);
  PR_ENVOI = true;
  return poster({action:'appel', nom:moi.nom, code:moi.code,
                 appareil:APPAREIL, appels:lot}, 30000)
    .then(function(r){
      PR_ENVOI = false;
      if(!r || !r.ok) return;
      var partis = {};
      lot.forEach(function(a){ partis[a.id + '|' + a.t] = 1; });
      PR.file = PR.file.filter(function(a){ return !partis[a.id + '|' + a.t]; });
      // Ce que le bureau a retenu redevient la référence : le prospect porte
      // désormais son statut, et la correction locale n'a plus lieu d'être.
      lot.forEach(function(a){
        var p = prParId(a.id);
        if(!p) return;
        p.statut = a.resultat;
        p.note = a.note;
        p.rappel = a.resultat === 'rappel' ? a.rappel : '';
        p.dernier = a.t;
        p.appels = (p.appels || 0) + 1;
        p.par = moi.nom;
      });
      prRanger();
      if(ETAPE === 8) prRendre();
    }, function(){ PR_ENVOI = false; });
}

/* ====================== LA FACTURATION (v98) ======================

   Simon, le 8 novembre : « fais en sorte que je puisse facturer mes clients,
   là y'a aucune donnée ». L'onglet ne lisait que les devis signés dans
   l'appli, et attendait un pointage que l'équipe ne fait pas.

   Il lit maintenant, pour le mois choisi :
   - les CONTRATS d'entretien (onglet CONTRATS du classeur), une facture par
     contrat, au forfait lissé sur 52 semaines ;
   - les interventions ponctuelles passées du mois, avec ou sans devis. Le
     prix vient du devis ou de la note (« 690 € HT »), et se corrige ici.
   Chaque bouton crée un BROUILLON dans Pennylane : rien ne part au client
   tant que Simon ne l'a pas relu et envoyé depuis Pennylane.
   ================================================================== */

var FACT = null;                      // le dernier état reçu du bureau
var FACT_MOIS = '';                   // le mois regardé, « 2026-11 »

function moisAujourdhui(){
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}
function moisNom(p){
  var m = String(p || '').match(/^(\d{4})-(\d{2})$/);
  if(!m) return String(p || '');
  var noms = ['janvier','février','mars','avril','mai','juin','juillet','août',
              'septembre','octobre','novembre','décembre'];
  return noms[Number(m[2]) - 1] + ' ' + m[1];
}
function moisDecale(p, n){
  var m = String(p || '').match(/^(\d{4})-(\d{2})$/);
  if(!m) return moisAujourdhui();
  var d = new Date(Number(m[1]), Number(m[2]) - 1 + n, 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}
/* On ne va pas chercher les mensualités d'un mois qui n'a pas commencé : le
   bouton existe, mais il prévient. */
function moisAVenir(p){ return String(p || '') > moisAujourdhui(); }

function moisFact(n){
  FACT_MOIS = moisDecale(FACT_MOIS || moisAujourdhui(), n);
  peindreTableau();
  chargerFacturation();
}

function chargerFacturation(btn){
  var moi = session();
  if(!moi) return Promise.resolve();
  if(!FACT_MOIS) FACT_MOIS = moisAujourdhui();
  if(!navigator.onLine){
    if(btn) libere(btn);
    erreur('Hors connexion : la facturation a besoin du bureau et de Pennylane.');
    return Promise.resolve();
  }
  if(btn) occuper(btn, 'Lecture…');
  return poster({action:'facturation', v:98, periode:FACT_MOIS,
                 nom:moi.nom, code:moi.code, appareil:APPAREIL}).then(function(d){
    if(btn) libere(btn);
    if(!d || !d.ok){
      if(d && d.refus) return reidentifier('Ton accès a changé côté bureau.');
      return erreur((d && d.erreur) ? d.erreur : attenteLisible());
    }
    FACT = d;
    FACT_MOIS = d.periode || FACT_MOIS;
    erreur('');
    peindreTableau();
  }, function(){
    if(btn) libere(btn);
    erreur(attenteLisible());
  });
}

var FACT_NOTE = '';                   // ce que la dernière action a donné

function factCle(x){ return String(x.cle || x.contrat || ''); }
function factId(x){ return 'f_' + factCle(x).replace(/[^A-Za-z0-9]/g, '_'); }

/* Ce que la carte d'une intervention envoie : le prix et le libellé
   corrigés à la main, s'ils l'ont été. */
function champsInter(x){
  var k = factId(x);
  var g = function(suffixe){ var e = $(k + suffixe); return e ? e.value : undefined; };
  return { ht: g('_ht'), tva: g('_tva'), libelle: g('_lib') };
}

function facturerAppli(type, cle, btn){
  var moi = session();
  if(!moi) return Promise.resolve(false);
  var x = null;
  ((FACT && (type === 'contrat' ? FACT.contrats : FACT.interventions)) || []).forEach(function(y){
    if(factCle(y) === cle) x = y;
  });
  var env = {action:'facturerAppli', type:type, cle:cle, periode:FACT_MOIS,
             nom:moi.nom, code:moi.code, appareil:APPAREIL};
  if(type === 'chantier' && x){
    var c = champsInter(x);
    env.ht = c.ht; env.tva = c.tva; env.libelle = c.libelle;
    if(!(Number(String(c.ht || '').replace(',', '.')) > 0)){
      erreur('Indique le montant HT de ' + (x.client || 'cette intervention') + ' avant de préparer la facture.');
      return Promise.resolve(false);
    }
  }
  if(btn) occuper(btn, 'Pennylane…');
  return poster(env).then(function(d){
    if(btn) libere(btn);
    if(!d) { erreur(attenteLisible()); return false; }
    if(d.ok){
      erreur('');
      FACT_NOTE = 'Brouillon créé dans Pennylane pour ' + (x ? (x.client || x.contrat) : cle) +
        (d.ht ? ' (' + eur(d.ht) + ' HT)' : '') + (d.ecart ? ' — ' + d.ecart + ', à vérifier.' : '.') +
        ' Relis-le et envoie-le depuis Pennylane.';
      if(x){ x.facturee = true; x.etat = 'BROUILLON PENNYLANE'; }
      peindreTableau();
      return true;
    }
    erreur((x ? (x.client || x.contrat) + ' : ' : '') + (d.erreur || 'la facture n\'a pas pu être préparée.'));
    if(d.deja && x){ x.facturee = true; peindreTableau(); }
    return false;
  }, function(){
    if(btn) libere(btn);
    erreur(attenteLisible());
    return false;
  });
}

/* Tous les contrats du mois, l'un après l'autre (une facture chacun). */
function facturerContratsDuMois(btn){
  var reste = ((FACT && FACT.contrats) || []).filter(function(c){ return !c.facturee && !c.manque.length; });
  if(!reste.length){ erreur('Rien à préparer : tous les contrats prêts le sont déjà.'); return; }
  demander('Préparer ' + reste.length + ' facture(s) de contrat ?',
    'Un brouillon par contrat, pour ' + moisNom(FACT_MOIS) + ', dans Pennylane. Rien n\'est envoyé aux clients.' +
    (FACT && !FACT.moisFini ? '\n\nAttention : ' + moisNom(FACT_MOIS) + ' n\'est pas fini. Les contrats se facturent ' +
                               'd\'habitude au début du mois suivant.' : ''),
    'Préparer').then(function(oui){
      if(!oui) return;
      occuper(btn, '0 / ' + reste.length);
      var faits = 0, rates = 0, i = 0;
      (function suivant(){
        if(i >= reste.length){
          libere(btn);
          FACT_NOTE = faits + ' brouillon(s) créé(s) dans Pennylane pour ' + moisNom(FACT_MOIS) +
                      (rates ? ' · ' + rates + ' en échec (voir le message rouge)' : '') + '.';
          peindreTableau();
          return;
        }
        var c = reste[i++];
        facturerAppli('contrat', c.contrat, null).then(function(ok){
          if(ok) faits++; else rates++;
          btn.textContent = i + ' / ' + reste.length;
          suivant();
        });
      })();
    });
}

function marquerFacturee(type, cle, btn){
  var moi = session();
  if(!moi) return;
  var x = null;
  ((FACT && (type === 'contrat' ? FACT.contrats : FACT.interventions)) || []).forEach(function(y){
    if(factCle(y) === cle) x = y;
  });
  demander('Déjà facturée ?',
    (x ? (x.client || x.contrat) : cle) + ' sortira de la liste' + (type === 'contrat' ? ' pour ' + moisNom(FACT_MOIS) : '') +
    ', sans rien créer dans Pennylane. À utiliser pour ce qui a été facturé ailleurs (Henrri, à la main…).',
    'Oui, déjà facturée').then(function(oui){
      if(!oui) return;
      occuper(btn, '…');
      poster({action:'marquerFacturee', cle:cle, contrat: type === 'contrat',
              periode: type === 'contrat' ? FACT_MOIS : '', client: x ? (x.client || x.contrat) : '',
              nom:moi.nom, code:moi.code, appareil:APPAREIL}).then(function(d){
        libere(btn);
        if(!d || !d.ok) return erreur((d && d.erreur) || attenteLisible());
        if(x){ x.facturee = true; x.etat = 'DEJA FACTUREE'; }
        peindreTableau();
      }, function(){ libere(btn); erreur(attenteLisible()); });
    });
}

/* v108g — remettre une facture dans la liste : le brouillon Pennylane est
   supprimé par le bureau (s'il n'est pas finalisé), et on peut la repréparer. */
function refaireFacture(type, cle, btn){
  var moi = session();
  if(!moi) return;
  demander('Refaire cette facture ?',
    'Le brouillon Pennylane est supprimé (s\'il est encore en brouillon) et l\'intervention revient dans la liste, ' +
    'prête à être préparée de nouveau.', 'Oui, refaire').then(function(oui){
      if(!oui) return;
      occuper(btn, '…');
      poster({action:'refaireFacture', cle:cle, contrat: type === 'contrat', periode: type === 'contrat' ? FACT_MOIS : '',
              nom:moi.nom, code:moi.code, appareil:APPAREIL}, 45000).then(function(d){
        libere(btn);
        if(!d || !d.ok) return erreur((d && d.erreur) || attenteLisible());
        erreur('');
        chargerFacturation();
      }, function(){ libere(btn); erreur(attenteLisible()); });
    });
}

function listeFacturesAdmin(){
  var h = '';
  if(FACT_NOTE){
    h += '<div class="card" style="border-color:var(--ok,#15803d)"><b>' + ech(FACT_NOTE) + '</b></div>';
  }
  if(!FACT){
    return h + '<div class="card"><div class="empty">Appuie sur « Actualiser la facturation » ' +
           'pour aller voir ce qu\'il y a à facturer.</div></div>';
  }
  if(!FACT.contrats || !FACT.interventions){
    return h + '<div class="card"><b>Le classeur n\'est pas encore à jour.</b><div class="mini">' +
           'Il faut publier la nouvelle version du script (Déployer → Gérer les déploiements).</div></div>';
  }
  if(!FACT.pennylane){
    h += '<div class="card" style="border-color:var(--att,#b45309)"><b>Pennylane n\'est pas connecté.</b>' +
         '<div class="mini">Dans le classeur : menu « Devis » → « 25. Connecter Pennylane ». ' +
         'La liste se lit, mais rien ne peut être préparé.</div></div>';
  }

  h += modeEmploiFactures();
  h += '<div class="row adOngs factOngs" style="margin:6px 0 10px">' +
    '<button class="btn sec sm' + (FACT_VUE === 'ponctuels' ? ' on' : '') + '" onclick="vueFact(\'ponctuels\')">Ponctuels</button>' +
    '<button class="btn sec sm' + (FACT_VUE === 'contrats' ? ' on' : '') + '" onclick="vueFact(\'contrats\')">Contrats (récurrents)</button></div>';
  var c = FACT.contrats, it = FACT.interventions;
  var cAFaire = c.filter(function(x){ return !x.facturee; });
  var cPrets = cAFaire.filter(function(x){ return !x.manque.length; });
  var totC = cAFaire.reduce(function(s, x){ return s + (x.ht || 0); }, 0);
  var iAFaire = it.filter(function(x){ return !x.facturee && !x.contrat; });
  var iContrat = it.filter(function(x){ return !x.facturee && x.contrat; });
  var iFaites = it.filter(function(x){ return x.facturee; });
  var totI = iAFaire.reduce(function(s, x){ return s + (Number(x.ht) || 0); }, 0);

  if(FACT_VUE === 'ponctuels'){
  h += '<div class="card"><b>Ponctuels · ' + ech(moisNom(FACT_MOIS)) + '</b><div class="mini">' +
       iAFaire.length + ' intervention(s) à facturer · ' + eur(totI) + ' HT' +
       (iAFaire.some(function(x){ return !(x.ht > 0); }) ? ' (prix à compléter)' : '') +
       '<br>Une intervention apparaît ici une fois sa date passée. Avec devis : le prix et le client du devis. ' +
       'Sans devis : le prix écrit dans la note, à vérifier.</div></div>';

  /* ---- les interventions ponctuelles ---- */
  if(!iAFaire.length) h += '<div class="card"><div class="mini">Aucune intervention ponctuelle à facturer en ' +
                           ech(moisNom(FACT_MOIS)) + '.</div></div>';
  iAFaire.forEach(function(x){ h += carteInter(x); });
  if(iContrat.length){
    h += '<h3 class="factTitre">Peut-être déjà dans un contrat</h3>' +
         '<div class="card"><div class="mini">Ces interventions portent le nom d\'un client sous contrat. ' +
         'Si elles sont comprises dans son forfait, marque-les « déjà facturée ». Sinon, facture-les ici.</div></div>';
    iContrat.forEach(function(x){ h += carteInter(x); });
  }
  if(iFaites.length) h += dejaFaitesHtml(iFaites);
  return h;
  }

  /* ---- les contrats ---- */
  h += '<div class="card"><b>Contrats · ' + ech(moisNom(FACT_MOIS)) + '</b><div class="mini">' +
       cAFaire.length + ' contrat(s) à facturer · ' + eur(totC) + ' HT</div></div>' +
       '<div class="card"><div class="mini">' +
       (c.length ? cAFaire.length + ' sur ' + c.length + ' à facturer pour ' + ech(moisNom(FACT_MOIS)) +
                   ' · forfait mensuel lissé sur 52 semaines.' : 'Aucun contrat actif dans l\'onglet CONTRATS.') +
       (!FACT.moisFini && c.length ? '<br>Le mois n\'est pas fini : d\'habitude, on facture les contrats au début du mois suivant.' : '') +
       '</div>' +
       (cPrets.length ? '<button class="btn sm" style="margin-top:10px;width:100%" ' +
                         'onclick="facturerContratsDuMois(this)">Préparer ' +
                         (cPrets.length > 1 ? 'les ' + cPrets.length + ' factures' : 'la facture') + ' de ' +
                         ech(moisNom(FACT_MOIS)) + '</button>' : '') +
       (cAFaire.length > cPrets.length ? '<div class="mini">' + (cAFaire.length - cPrets.length) +
                         ' contrat(s) à compléter d\'abord dans l\'onglet CONTRATS.</div>' : '') + '</div>';
  c.forEach(function(x){ if(!x.facturee) h += carteContratCt(x); });

  var faitesC = c.filter(function(x){ return x.facturee; });
  if(faitesC.length) h += dejaFaitesHtml(faitesC);
  return h;
}
function dejaFaitesHtml(l){
  var h = '';
  if(l.length){
    h += '<h3 class="factTitre">Déjà faites</h3><div class="card">' +
      l.map(function(x){
        var t = x.contrat ? 'contrat' : x.type, c = ech(x.contrat || factCle(x)).replace(/'/g,'&#39;');
        return '<div class="row" style="justify-content:space-between;align-items:center;gap:8px;padding:4px 0">' +
          '<span style="flex:1">' + ech(x.contrat || x.client) + '</span><span class="mini">' +
          (x.etat === 'DEJA FACTUREE' ? 'facturée ailleurs' : 'brouillon Pennylane') + '</span>' +
          '<button class="btn sec sm" style="flex:0 0 auto" onclick="refaireFacture(\'' + t + '\',\'' + c + '\', this)">Refaire</button></div>';
      }).join('') + '</div>';
  }
  return h;
}

function carteInter(x){
  var k = factId(x), cle = ech(factCle(x)).replace(/'/g,'&#39;');
  var tvaOpt = [20, 10, 5.5, 0].map(function(t){
    return '<option value="' + t + '"' + (Number(x.tva || 20) === t ? ' selected' : '') + '>' +
           String(t).replace('.', ',') + ' %</option>';
  }).join('');
  var h = '<div class="card"><div class="row" style="justify-content:space-between">' +
          '<b>' + ech(x.client) + '</b><span class="mini">' + ech(dateCourte(x.date)) + '</span></div>' +
          '<div class="mini">' + ech([x.ville, quiLisible(x.qui)].filter(Boolean).join(' · ')) +
          (x.note ? '<br>' + ech(x.note) : '') + '</div>';
  if(x.jamaisPlace) h += '<div class="mini" style="color:var(--att,#b45309)">Jamais placée au planning : vérifie qu\'elle a bien eu lieu.</div>';
  if(x.contrat) h += '<div class="mini" style="color:var(--att,#b45309)">Client sous contrat (' + ech(x.contrat) + ').</div>';
  if(x.type === 'devis'){
    h += ligneCh('Devis ' + x.cle, eur(x.ht) + ' HT', true);
    if(!x.signe) h += '<div class="mini" style="color:var(--att,#b45309)">Le devis n\'est pas marqué signé.</div>';
  } else {
    h += '<label for="' + k + '_lib">Libellé sur la facture</label>' +
         '<input id="' + k + '_lib" value="' + ech(x.libelle) + '">' +
         '<div class="row" style="gap:8px"><div style="flex:2"><label for="' + k + '_ht">Montant HT (€)</label>' +
         '<input id="' + k + '_ht" type="number" inputmode="decimal" step="0.01" min="0" value="' + (x.ht > 0 ? x.ht : '') + '" placeholder="à compléter"></div>' +
         '<div style="flex:1"><label for="' + k + '_tva">TVA</label><select id="' + k + '_tva">' + tvaOpt + '</select></div></div>' +
         (x.prixLu ? '<div class="mini">Prix lu dans la note : « ' + ech(x.prixLu) + ' »' +
                     (/TTC/i.test(x.prixLu) ? ', ramené en HT.' : '.') + '</div>'
                   : (x.modele ? '' : '<div class="mini">Pas de prix dans la note : indique-le.</div>')) +
         /* v108f — le détail repris de la dernière facture Henrri du client. */
         (x.modele ? '<details class="mini" style="margin-top:6px"><summary>Détail repris de la facture Henrri <b>' +
             ech(x.modele.source) + '</b> (' + x.modele.n + ' ligne' + (x.modele.n > 1 ? 's' : '') + ', ' + eur(x.modele.ht) + ' HT, TVA ' +
             String(x.modele.tva).replace('.', ',') + ' %)</summary>' +
             (x.modele.lignes || []).map(function(l){ return '<div>· ' + ech(l) + '</div>'; }).join('') +
             '<div style="margin-top:4px">La facture reprend ces lignes si le montant reste ' + eur(x.modele.ht) +
             ' HT ; un autre montant donne une ligne unique.</div></details>' : '');
  }
  if(!x.adresse || !x.cp || !x.ville){
    h += '<div class="mini" style="color:var(--att,#b45309)">Adresse incomplète : si le client n\'existe pas encore ' +
         'dans Pennylane, la facture sera refusée. Complète l\'adresse sur la fiche de l\'intervention.</div>';
  }
  h += '<div class="row" style="gap:8px;margin-top:8px">' +
       '<button class="btn sm" style="flex:2" onclick="facturerAppli(\'' + x.type + '\',\'' + cle + '\', this)">' +
       'Préparer la facture</button>' +
       '<button class="btn sec sm" style="flex:1" onclick="marquerFacturee(\'' + x.type + '\',\'' + cle + '\', this)">' +
       'Déjà facturée</button></div>';
  return h + '</div>';
}

function carteContratCt(x){
  var cle = ech(x.contrat).replace(/'/g,'&#39;');
  var h = '<div class="card"><div class="row" style="justify-content:space-between">' +
          '<b>' + ech(x.contrat) + '</b><b>' + eur(x.ht) + ' HT</b></div>' +
          '<div class="mini">' + (x.client !== x.contrat ? 'Facturé à ' + ech(x.client) + ' · ' : '') + ech(x.ville || '') + '</div>' +
          '<div class="mini">' + x.lignes.map(function(l){
            return ech(l.ligne) + ' · ' + eur(l.ht) + (l.rythme ? ' · ' + ech(l.rythme) : '');
          }).join('<br>') + '</div>';
  /* v108g — le détail repris de la facture Henrri du même montant. */
  h += x.modele ? '<div class="mini" style="margin-top:4px">Détail repris de la facture Henrri <b>' + ech(x.modele.source) + '</b> (' +
         x.modele.n + ' ligne' + (x.modele.n > 1 ? 's' : '') + ', TVA ' + String(x.modele.tva).replace('.', ',') + ' %), mois mis à jour.</div>'
       : '<div class="mini" style="margin-top:4px">Pas de facture Henrri au même montant : lignes de l\'onglet CONTRATS.</div>';
  if(x.manque.length){
    h += '<div class="mini" style="color:var(--att,#b45309)">Manque : ' + ech(x.manque.join(', ')) +
         ' — à compléter dans l\'onglet CONTRATS du classeur.</div>';
  }
  h += '<div class="row" style="gap:8px;margin-top:8px">' +
       '<button class="btn sm" style="flex:2"' + (x.manque.length ? ' disabled' : '') +
       ' onclick="facturerAppli(\'contrat\',\'' + cle + '\', this)">Préparer ' + ech(moisNom(FACT_MOIS)) + '</button>' +
       '<button class="btn sec sm" style="flex:1" onclick="marquerFacturee(\'contrat\',\'' + cle + '\', this)">' +
       'Déjà facturée</button></div>';
  return h + '</div>';
}

function dateCourte(iso){
  var d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  return ('0'+d.getDate()).slice(-2)+'/'+('0'+(d.getMonth()+1)).slice(-2)+'/'+d.getFullYear();
}

/* ====================== LA FICHE CHANTIER JOINTE (v101) ======================
   « Quand je crée ou modifie une intervention, je dois pouvoir rajouter une
   fiche chantier en pièce jointe, pour que les prestataires la voient quand
   ils cliquent sur l'intervention sur le planning ou là où ils pointent. »
   PDF ou photo. La photo est réduite avant l'envoi (2000 px, JPEG) : celle
   d'un téléphone pèse souvent 5 Mo, ce qui ferait attendre sur le réseau
   d'un chantier. Le salarié la lit par l'appli, jamais par un lien. */
var FICHE_MAX = 10 * 1024 * 1024;
function lireFichierFiche(f){
  return new Promise(function(res, rej){
    if(!f) return rej(new Error('aucun fichier'));
    var pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    var image = /^image\//.test(f.type);
    if(!pdf && !image) return rej(new Error('Choisis un PDF ou une photo.'));
    var fin = function(data, type){
      if(data.length * 0.75 > FICHE_MAX) return rej(new Error('Fichier trop lourd (10 Mo au plus).'));
      res({ nom: f.name || (pdf ? 'fiche.pdf' : 'fiche.jpg'), type: type, data: data });
    };
    var r = new FileReader();
    r.onerror = function(){ rej(new Error('Le fichier n\'a pas pu être lu.')); };
    r.onload = function(){
      var url = String(r.result || ''), brut = url.split(',')[1] || '';
      if(pdf) return fin(brut, 'application/pdf');
      var img = new Image();
      img.onload = function(){
        try{
          var k = Math.min(1, 2000 / Math.max(img.width, img.height));
          var cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          fin(cv.toDataURL('image/jpeg', 0.82).split(',')[1], 'image/jpeg');
        }catch(e){ fin(brut, f.type || 'image/jpeg'); }
      };
      img.onerror = function(){ fin(brut, f.type || 'image/jpeg'); };
      img.src = url;
    };
    r.readAsDataURL(f);
  });
}

/* Dans le formulaire « + Intervention » : le fichier est gardé en mémoire et
   part juste après la création (il faut le numéro de l'intervention). */
function blocFicheForm(c){
  var deja = c.mode === 'modif' ? ((contratDe(c.id + '|') || {}).fiche || '') : '';
  return '<div class="card zoneDepot" ' + attrsDepot('ctFicheChoisie({files: f})') + '><label>Fiche chantier <span class="mini">(PDF ou photo, facultatif — tu peux la glisser ici)</span></label>' +
    (c.fichier
      ? '<div class="ctDevisChoisi"><b>📎 ' + ech(c.fichier.nom) + '</b>' +
        '<button type="button" class="btn sec sm" style="width:auto" onclick="ctFicheOter()">Retirer</button></div>'
      : (deja ? '<div class="mini">Fiche actuelle : ' + ech(deja) + '. Choisis un fichier pour la remplacer.</div>' : '') +
        '<input id="ct_fiche" type="file" accept="application/pdf,image/*" onchange="ctFicheChoisie(this)">') +
    '<div class="mini">Le salarié la verra en ouvrant l\'intervention, avec les instructions.</div></div>';
}
/* Les attributs d'un cadre qui accepte un fichier glissé-déposé : « f » est la
   liste des fichiers déposés dans l'appel donné. */
function attrsDepot(appel){
  return 'ondragover="event.preventDefault();this.classList.add(\'depotOn\')" ' +
    'ondragleave="this.classList.remove(\'depotOn\')" ' +
    'ondrop="event.preventDefault();this.classList.remove(\'depotOn\');' +
    'var f=event.dataTransfer&&event.dataTransfer.files;if(f&&f.length){' + appel.replace(/"/g, '&quot;') + '}"';
}
function ctFicheChoisie(inp){
  var f = inp && inp.files && inp.files[0];
  if(!f || !CT) return;
  lireContrat();
  lireFichierFiche(f).then(function(x){ CT.fichier = x; peindreContrat(); },
                           function(e){ erreur(String(e && e.message || e)); inp.value = ''; });
}
function ctFicheOter(){ lireContrat(); if(CT) CT.fichier = null; peindreContrat(); }

function envoyerFicheApres(ids, fichier){
  var moi = session();
  (ids || []).reduce(function(p, id){
    return p.then(function(){
      return poster({action:'ficheJointe', nom:moi.nom, code:moi.code, appareil:APPAREIL, id:id,
                     fichierNom:fichier.nom, type:fichier.type, data:fichier.data}, 90000)
        .then(function(r){
          if(!r || !r.ok){ AD_MOT_T = 0; AD_MOT = 'Fiche non jointe : ' + ((r && r.erreur) || attenteLisible()); }
        });
    });
  }, Promise.resolve()).then(function(){ chargerTableau(); }, function(){ chargerTableau(); });
}

/* Sur la fiche d'un passage, dans le tableau du gérant : joindre, voir,
   remplacer, retirer — tout de suite, sans attendre « Enregistrer ». */
function blocFicheChantier(c){
  var id = ech(String(c.id)).replace(/'/g,'&#39;');
  /* v106 — on peut aussi glisser-déposer le fichier sur ce cadre. */
  return '<div class="card zoneDepot" id="adFicheJ" ' + attrsDepot('joindreFicheAd(\'' + id + '\', {files: f})') + '><b>Fiche chantier</b>' +
    (c.fiche
      ? '<div class="mini" style="margin:4px 0 8px">📎 ' + ech(c.fiche) + (c.recurrent ? ' · celle du contrat' : '') + '</div>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap">' +
        '<button class="btn sec sm" style="flex:1" onclick="voirFicheJointe(\'' + id + '\', this)">Voir</button>' +
        '<label class="btn sec sm" style="flex:1;text-align:center">Remplacer' +
          '<input type="file" accept="application/pdf,image/*" class="hide" onchange="joindreFicheAd(\'' + id + '\', this)"></label>' +
        '<button class="btn sec sm" style="flex:1" onclick="retirerFicheAd(\'' + id + '\', this)">Retirer</button></div>'
      : '<div class="mini" style="margin:4px 0 8px">Aucune. Le salarié la verrait en ouvrant l\'intervention.</div>' +
        '<label class="btn sec sm" style="display:block;text-align:center">📎 Joindre une fiche (PDF ou photo) — ou glisse-la ici' +
          '<input type="file" accept="application/pdf,image/*" class="hide" onchange="joindreFicheAd(\'' + id + '\', this)"></label>') +
    (c.recurrent ? '<div class="mini" style="margin-top:6px">Pour tous les passages du contrat, joins-la depuis « Modifier le contrat ».</div>' : '') +
    '<div class="mini" id="adFicheEtat"></div></div>';
}
function joindreFicheAd(id, inp){
  var f = inp && inp.files && inp.files[0];
  if(!f) return;
  var z = $('adFicheEtat');
  if(z) z.textContent = 'Envoi de la fiche…';
  lireFichierFiche(f).then(function(x){
    var moi = session();
    return poster({action:'ficheJointe', nom:moi.nom, code:moi.code, appareil:APPAREIL, id:id,
                   fichierNom:x.nom, type:x.type, data:x.data}, 90000);
  }).then(function(r){
    if(!r || !r.ok){ if(z) z.textContent = (r && r.erreur) ? String(r.erreur) : attenteLisible(); return; }
    var c = ((TABLEAU||{}).chantiers||[]).filter(function(x){ return x.id === id; })[0];
    if(c){ c.fiche = r.nom; var b = $('adFicheJ'); if(b) b.outerHTML = blocFicheChantier(c); }
    chargerTableau();
  }, function(e){ if(z) z.textContent = String(e && e.message || e); });
}
function retirerFicheAd(id, btn){
  var moi = session();
  if(btn) occuper(btn, '…');
  poster({action:'ficheRetirer', nom:moi.nom, code:moi.code, appareil:APPAREIL, id:id}).then(function(r){
    if(btn) libere(btn);
    if(!r || !r.ok) return erreur((r && r.erreur) || attenteLisible());
    var c = ((TABLEAU||{}).chantiers||[]).filter(function(x){ return x.id === id; })[0];
    if(c){ c.fiche = ''; var b = $('adFicheJ'); if(b) b.outerHTML = blocFicheChantier(c); }
  }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
}

/* Voir la fiche : un PDF s'ouvre dans la visionneuse des devis, une photo
   s'affiche en grand dans le même cadre. */
function voirFicheJointe(id, btn){
  var moi = session();
  if(!moi) return;
  if(!navigator.onLine) return erreur('Hors connexion : la fiche a besoin du réseau pour s\'ouvrir.');
  if(btn) occuper(btn, 'Ouverture…');
  poster({action:'ficheLire', nom:moi.nom, code:moi.code, appareil:APPAREIL, id:id}, 60000).then(function(r){
    if(btn) libere(btn);
    if(!r || !r.ok) return erreur((r && r.erreur) || attenteLisible());
    ouvrirFiche(r);
  }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
}
function ouvrirFiche(r){
  var titre = document.querySelector('#pdfOverlay .so-h b');
  if(String(r.type || '') === 'application/pdf'){
    ouvrirPdf({ pdf: r.data, numero: r.nom || 'Fiche chantier', nomFichier: r.nom || 'fiche.pdf' });
    if(titre) titre.textContent = 'Fiche chantier';
    return;
  }
  PDF_VU = null;
  if(titre) titre.textContent = 'Fiche chantier';
  $('poNum').textContent = r.nom || '';
  $('poPages').innerHTML = '<img class="poPage" alt="Fiche chantier" style="width:100%;height:auto" src="data:' +
    ech(r.type || 'image/jpeg') + ';base64,' + r.data + '">';
  $('pdfOverlay').classList.remove('hide');
}

/* v101 — « pour la signature par mail, assure-toi que je peux l'envoyer lors
   de la création du devis ». Le choix est à côté de « Signature à l'écran » :
   il coche l'envoi, ouvre le mail proposé et descend jusqu'à lui. À
   l'enregistrement, le devis part avec le bouton « Signer le devis en ligne ». */
function choisirSignatureDistance(){
  var c = $('fEnvoi');
  if(!c) return;
  MAIL_MODE = 'distance';
  if(!c.checked) c.checked = true;
  majCadreMail();
  majMailClient();
  var b = $('blocMail') || c;
  setTimeout(function(){ b.scrollIntoView({behavior:'smooth', block:'start'}); var a = $('fMailA'); if(a && !a.value) a.focus(); }, 60);
}

/* ====================== v102 ====================== */

/* « Il faut une flèche en haut de l'écran pour revenir en arrière, plutôt que
   de descendre tout en bas de la page. » La flèche de l'en-tête (toujours
   visible, l'en-tête reste collé en haut) fait ce que fait le bouton « Retour »
   du bas de chaque écran. */
var RETOUR_HAUT = {
  eAd2: function(){ retourTableau(); },
  eAg2: function(){ ecranPlanning(); },
  eAg3: function(){ ecranPlanning(); },
  e2: function(){ revenir(); }, e3: function(){ revenir(); }, e4: function(){ revenir(); },
  e6: function(){ revenir(); }, e7: function(){ revenir(); }
};
function majRetourHaut(){
  var b = $('bHaut'); if(!b) return;
  b.classList.toggle('hide', !RETOUR_HAUT[ECRAN_VU]);
}
function retourHaut(){
  var f = RETOUR_HAUT[ECRAN_VU];
  if(f){ f(); window.scrollTo(0, 0); }
}

/* « Clear toutes les choses à faire, on part de 0 à partir de maintenant. »
   Le classeur note ce qui était en attente à cet instant ; la liste ne le
   montre plus. Rien n'est supprimé. */
function sansIgnores(t){
  var ig = t && t.aFaireIgnores;
  if(!ig || t.__filtre) return t;
  var dv = {}, ch = {};
  (ig.devis || []).forEach(function(n){ dv[n] = 1; });
  (ig.chantiers || []).forEach(function(n){ ch[n] = 1; });
  var o = {};
  for(var k in t) if(t.hasOwnProperty(k)) o[k] = t[k];
  o.devis = (t.devis || []).filter(function(d){ return !dv[d.numero]; });
  o.chantiers = (t.chantiers || []).filter(function(c){ return !ch[c.id]; });
  o.__filtre = true;
  return o;
}
function remiseAFaire(btn){
  demander('Repartir de zéro ?', 'Tout ce qui est en attente maintenant disparaît de « À faire » ' +
    '(rien n\'est supprimé du classeur). Ce qui arrivera ensuite s\'affichera normalement.', 'Tout effacer').then(function(oui){
    if(!oui) return;
    var moi = session();
    if(btn) occuper(btn, '…');
    /* v106 — toutes les clés de ce qui est affiché maintenant, et celles déjà
       mises de côté (pour qu'une remise n'en ressuscite pas d'anciennes). */
    var cles = [];
    taches(TABLEAU || {}).forEach(function(x){ (x.cles || []).forEach(function(k){ cles.push(k); }); });
    var vieilles = ((TABLEAU && TABLEAU.aFaireIgnores && TABLEAU.aFaireIgnores.cles) || []);
    vieilles.forEach(function(k){ if(cles.indexOf(k) < 0) cles.push(k); });
    poster({action:'aFaireRemise', nom:moi.nom, code:moi.code, appareil:APPAREIL, cles:cles}).then(function(r){
      if(btn) libere(btn);
      if(!r || !r.ok) return erreur((r && r.erreur) || attenteLisible());
      if(TABLEAU){ TABLEAU.aFaireIgnores = TABLEAU.aFaireIgnores || {}; TABLEAU.aFaireIgnores.cles = r.cles || cles; }
      AD_MOT_T = 0; AD_MOT = '« À faire » repart de zéro';
      try{ peindreTableau(); }catch(e){}
      chargerTableau();
    }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
  });
}

/* « Dans l'onglet Factures, j'aimerais comprendre concrètement comment
   utiliser le module, et sépare le récurrent du ponctuel. » */
var FACT_VUE = (function(){ var v = ls('factVue'); return v === 'contrats' ? 'contrats' : 'ponctuels'; })();
function vueFact(v){ FACT_VUE = v === 'contrats' ? 'contrats' : 'ponctuels'; ls('factVue', FACT_VUE); peindreTableau(); }
function modeEmploiFactures(){
  var ouvert = ls('factAide') !== 'ferme';
  return '<details class="card factAide"' + (ouvert ? ' open' : '') +
    ' ontoggle="ls(\'factAide\', this.open ? \'ouvert\' : \'ferme\')"><summary><b>Comment ça marche</b></summary>' +
    '<ol class="mini" style="padding-left:18px;margin:8px 0 0">' +
    '<li><b>Choisis le mois</b> avec ◀ ▶ en haut, puis « Actualiser la facturation ».</li>' +
    '<li><b>Ponctuels</b> : chaque intervention passée du mois a sa carte. Vérifie le libellé, le prix HT et la TVA ' +
    '(10 % particulier, 20 % société), puis « Préparer la facture ». Déjà facturée ailleurs ou comprise dans un forfait : ' +
    '« Déjà facturée ».</li>' +
    '<li><b>Contrats</b> : un forfait mensuel par client (onglet CONTRATS du classeur). Au début du mois, « Préparer les factures » ' +
    'fait tous les contrats du mois écoulé d\'un coup. Si la préparation automatique est activée, c\'est fait tout seul le 3.</li>' +
    '<li>Chaque facture préparée est un <b>brouillon dans Pennylane</b>. Ouvre Pennylane → Ventes → Factures, relis, ' +
    'puis valide et envoie. Rien ne part au client tant que tu ne l\'as pas fait.</li>' +
    '<li>Une carte grisée dit ce qui manque (adresse, prix…) : complète le devis, la note de l\'intervention ou l\'onglet CONTRATS.</li>' +
    '</ol></details>';
}

/* ====================== v103 ====================== */

/* Le nom imprimé pour un compte (REGLAGES noms_documents : « TITEMA=Simon »). */
function nomDocument(nom){
  var n = String(nom || '').trim();
  var s = String(((CFG||{}).reglages||{}).noms_documents || '').trim();
  if(!n || !s) return n;
  var r = n, k = n.toLowerCase();
  s.split(/\s*;\s*/).forEach(function(p){
    var m = p.match(/^([^=]+)=(.+)$/);
    if(m && m[1].trim().toLowerCase() === k) r = m[2].trim();
  });
  return r;
}
function signatureCourte(){
  var s = String(((CFG||{}).reglages||{}).signature_mail || '').trim() || 'CORDIALEMENT, Simon - BREIZH BRILLANCE';
  return s.replace(/\s*\n+\s*/g, ' ');
}

/* ---- la durée d'engagement d'un contrat, sur le devis ----
   « Les contrats ayant une échéance, il faut les placer sur la durée à partir
   de la signature. » Le commercial choisit la durée (ou sans engagement) et la
   reconduction ; le devis l'imprime ; à la signature, le contrat reçoit sa fin. */
var ENGAGEMENTS = [0, 3, 6, 12, 24];
function peindreEngagement(){
  var z = $('blocEngag');
  if(!z) return;
  var on = estRecurrent();
  z.classList.toggle('hide', !on);
  if(!on) return;
  z.innerHTML = '<label>Durée d\'engagement</label>' +
    '<div class="row" style="flex-wrap:wrap;gap:6px">' + ENGAGEMENTS.map(function(m){
      return '<span class="puce' + (ENGAGEMENT.mois === m ? ' on' : '') + '" onclick="choisirEngagement(' + m + ')">' +
        (m ? m + ' mois' : 'Sans engagement') + '</span>';
    }).join('') + '</div>' +
    (ENGAGEMENT.mois
      ? '<label style="display:flex;gap:10px;align-items:center;margin-top:10px">' +
        '<input type="checkbox" style="width:20px;height:20px;flex:none"' + (ENGAGEMENT.tacite ? ' checked' : '') +
        ' onchange="ENGAGEMENT.tacite = this.checked; sauverBrouillon(); peindreEngagement()">' +
        '<span>Renouvelable par tacite reconduction</span></label>' +
        '<div class="mini">' + (ENGAGEMENT.tacite
          ? 'Le contrat court ' + ENGAGEMENT.mois + ' mois à partir de la signature, puis se renouvelle de lui-même par périodes de ' +
            ENGAGEMENT.mois + ' mois. Le planning continue sans rien faire.'
          : 'Le contrat s\'arrête au bout de ' + ENGAGEMENT.mois + ' mois. Le bureau sera prévenu 45 jours avant pour le renouveler.') + '</div>'
      : '<div class="mini">Le client peut arrêter quand il veut. Le planning continue tant que le contrat n\'est pas arrêté.</div>');
}
function choisirEngagement(m){
  ENGAGEMENT.mois = Number(m) || 0;
  sauverBrouillon();
  peindreEngagement();
}

/* ---- l'échéance d'un contrat, dans sa fiche ---- */
function blocEcheance(id){
  var s = contratDe(id + '|');
  if(!s) return '';
  var auj = isoJour();
  var mois = s.engagement || 12;
  return '<div class="card"><b>Échéance</b><div class="mini" style="margin:4px 0 8px">' +
    (s.fin ? 'Le contrat court jusqu\'au <b>' + ech(jjmmaa(s.fin)) + '</b>' +
      (s.engagement ? ' (engagement de ' + s.engagement + ' mois)' : '') + '. ' +
      (s.reconduction === 'TACITE' ? 'Reconduction tacite : il sera prolongé de ' + mois + ' mois tout seul, 30 jours avant.'
                                   : 'Sans reconduction : il s\'arrête à cette date si tu ne le renouvelles pas.')
           : 'Pas d\'échéance : le contrat continue jusqu\'à ce que tu l\'arrêtes.') + '</div>' +
    (s.fin ? '<div class="row" style="gap:8px;flex-wrap:wrap">' +
      [6, 12, 24].map(function(m){
        return '<button class="btn sec sm" style="flex:1" onclick="renouvelerContrat(\'' + ech(id) + '\',' + m + ', this)">Renouveler ' + m + ' mois</button>';
      }).join('') + '</div>' : '') + '</div>';
}
function renouvelerContrat(id, mois, btn){
  var moi = session();
  if(btn) occuper(btn, '…');
  poster({action:'recurrentRenouveler', nom:moi.nom, code:moi.code, appareil:APPAREIL, id:id, mois:mois}, 40000).then(function(r){
    if(btn) libere(btn);
    if(!r || !r.ok) return erreur((r && r.erreur) || attenteLisible());
    AD_MOT_T = 0; AD_MOT = 'Contrat ' + id + ' renouvelé jusqu\'au ' + jjmmaa(r.fin);
    CT = null; retourTableau(); chargerTableau();
  }, function(){ if(btn) libere(btn); erreur(attenteLisible()); });
}

/* ---- choisir une date sans quitter la fiche ----
   « Pour les prestations à replacer à cause des fériés, il faut me suggérer
   une date, ou me permettre de choisir sur le calendrier sur la même page. »
   Calculé ici, avec le planning déjà chargé : trois jours proches de la date
   d'origine (même heure, même équipe, sans dimanche ni férié, en préférant les
   jours où l'équipe est libre à cette heure-là), et un petit calendrier du
   mois où chaque jour dit combien d'interventions l'équipe a déjà. */
var MINI_MOIS = '', MINI_C = null;
function dateOrigine(c){
  var k = String(c.recurrent || '');
  if(k.indexOf('|') > 0) return k.split('|')[1];
  return String(c.date || '').slice(0, 10) || isoJour(new Date(Date.now() + 86400000));
}
function chargeEquipe(iso, qui, sauf){
  var noms = nomsQui(qui);
  return ((TABLEAU||{}).chantiers||[]).filter(function(x){
    if(x.id === sauf || estAnnule(x) || String(x.date||'').slice(0,10) !== iso) return false;
    if(!noms.length) return true;
    return nomsQui(x.prestataire).some(function(n){ return noms.indexOf(n) >= 0; });
  });
}
function minutesDeH(h){ var m = String(h||'').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function libreA(iso, c){
  var h = minutesDeH(c.heure), d = Number(c.duree) || 60;
  if(h === null) return true;
  return !chargeEquipe(iso, c.prestataire, c.id).some(function(x){
    var hx = minutesDeH(x.heure), dx = Number(x.duree) || 60;
    return hx !== null && hx < h + d && h < hx + dx;
  });
}
function suggestionsLocales(c){
  var o = dateOrigine(c), auj = isoJour(), out = [];
  var base = new Date(o + 'T12:00:00');
  var ecarts = [-1, 1, -2, 2, 3, -3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  ecarts.forEach(function(k){
    var d = new Date(base); d.setDate(d.getDate() + k);
    var iso = isoJour(d);
    if(iso <= auj || d.getDay() === 0 || nomFerie(iso)) return;
    /* v104 — un jour où toute l'équipe est en congé (ou la maison fermée)
       n'est pas proposé ; un jour où l'un des deux manque passe après. */
    if(equipeAbsente(iso, c.prestataire)) return;
    var abs = absentsDe(iso, c.prestataire);
    out.push({ iso: iso, libre: libreA(iso, c), n: chargeEquipe(iso, c.prestataire, c.id).length, k: Math.abs(k), abs: abs });
  });
  out.sort(function(a, b){ return (a.abs.length - b.abs.length) || (a.libre === b.libre ? 0 : (a.libre ? -1 : 1)) || a.k - b.k || a.n - b.n; });
  return out.slice(0, 3);
}
function peindreChoixDate(c, ouvert){
  MINI_C = c;
  var z = $('adSuggLoc');
  if(z && ouvert){
    var l = suggestionsLocales(c);
    var fer = c.ferie && c.ferie.nom ? 'Passage du ' + jourLisible(c.ferie.date) + ' (' + c.ferie.nom + ') à replacer. ' : '';
    z.innerHTML = l.length ? '<label>Dates proches proposées</label><div class="mini" style="margin-top:0">' + ech(fer) +
      'Même heure, même équipe' + (c.heure ? ' (' + ech(c.heure) + ')' : '') + '.</div>' +
      '<div class="row" style="flex-wrap:wrap;gap:6px">' + l.map(function(s){
        return '<span class="puce" onclick="prendreDateLocale(\'' + s.iso + '\', this)">' + ech(jourLisible(s.iso)) +
          (s.libre ? ' · libre' : ' · déjà ' + s.n + ' interv.') + (s.abs.length ? ' · sans ' + ech(s.abs.join(', ')) : '') + '</span>';
      }).join('') + '</div>' : '';
  }
  var o = String(($('adDate') && $('adDate').value) || dateOrigine(c)).slice(0, 7);
  MINI_MOIS = o;
  var m = $('adMiniCal');
  if(m) m.innerHTML = ouvert ? miniCalHtml() :
    '<button class="lienTexte" onclick="MINI_MOIS=\'' + o + '\';$(\'adMiniCal\').innerHTML=miniCalHtml()">Choisir sur le calendrier</button>';
}
function prendreDateLocale(iso, el){
  if($('adDate')) $('adDate').value = iso;
  if(MINI_C && $('adHeure') && !$('adHeure').value && MINI_C.heure) $('adHeure').value = MINI_C.heure;
  Array.prototype.forEach.call(document.querySelectorAll('#adSuggLoc .puce'), function(e){ e.classList.toggle('on', e === el); });
  var m = $('adMiniCal'); if(m && m.querySelector('.miniCal')){ MINI_MOIS = iso.slice(0, 7); m.innerHTML = miniCalHtml(); }
}
function miniCalBouger(n){
  var a = Number(MINI_MOIS.slice(0, 4)), mo = Number(MINI_MOIS.slice(5, 7)) - 1 + n;
  var d = new Date(a, mo, 1, 12);
  MINI_MOIS = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  $('adMiniCal').innerHTML = miniCalHtml();
}
function miniCalHtml(){
  var c = MINI_C || {}, p = MINI_MOIS, auj = isoJour();
  var choisi = String(($('adDate') && $('adDate').value) || '');
  var lundi = lundiDe(p + '-01'), d = new Date(lundi + 'T12:00:00');
  var a = Number(p.slice(0, 4)), mo = Number(p.slice(5, 7));
  var dernier = isoJour(new Date(a, mo, 0, 12));
  var h = '<div class="miniCal"><div class="row" style="align-items:center;gap:6px;margin:10px 0 6px">' +
    '<button type="button" class="btn sec sm" style="width:auto" onclick="miniCalBouger(-1)">◀</button>' +
    '<b style="flex:1;text-align:center">' + ech(libelleMoisCal(p)) + '</b>' +
    '<button type="button" class="btn sec sm" style="width:auto" onclick="miniCalBouger(1)">▶</button></div>' +
    '<div class="miniGrille">' + ['L','M','M','J','V','S','D'].map(function(j){ return '<span class="miniT">' + j + '</span>'; }).join('');
  for(var i = 0; i < 42; i++){
    var iso = isoJour(d);
    if(i % 7 === 0 && i >= 28 && iso > dernier) break;
    var n = chargeEquipe(iso, c.prestataire, c.id).length, fer = nomFerie(iso);
    var passe = iso < auj, dehors = iso.slice(0, 7) !== p;
    var absM = absentsDe(iso, c.prestataire), toutAbs = equipeAbsente(iso, c.prestataire);
    if(!fer && absM.length) fer = toutAbs ? (absencesDuJour(iso).ferme ? 'fermé' : 'congé') : '';
    h += '<button type="button" class="miniJ' + (dehors ? ' miniHors' : '') + (passe || fer || d.getDay() === 0 ? ' miniOff' : '') +
      (absM.length && !toutAbs ? ' miniDemi' : '') +
      (iso === choisi ? ' miniOn' : '') + (iso === auj ? ' miniAuj' : '') + '"' +
      (passe ? ' disabled' : '') + ' onclick="choisirMiniJour(\'' + iso + '\')" title="' +
      ech(fer || ((absM.length ? absM.join(', ') + ' en congé · ' : '') + n + ' intervention(s)')) + '">' +
      '<b>' + d.getDate() + '</b><i>' + (fer ? (fer === 'congé' || fer === 'fermé' ? fer : 'férié') : (n ? n : '')) + '</i></button>';
    d.setDate(d.getDate() + 1);
  }
  h += '</div>';
  if(choisi){
    var l = chargeEquipe(choisi, c.prestataire, c.id).sort(function(x, y){ return String(x.heure||'99') < String(y.heure||'99') ? -1 : 1; });
    var absC = absentsDe(choisi, c.prestataire);
    if(absC.length) h += '<div class="mini" style="margin-top:6px;color:var(--danger);font-weight:600">' +
      (absencesDuJour(choisi).ferme ? 'Fermeture ce jour-là.' : ech(absC.join(' et ')) + ' en congé ce jour-là.') + '</div>';
    h += '<div class="mini" style="margin-top:6px"><b>' + ech(jourLisible(choisi)) + '</b> · ' +
      (l.length ? l.map(function(x){ return ech((x.heure ? x.heure + ' ' : '') + (x.client || '')); }).join(' · ')
                : 'rien de prévu pour cette équipe') + '</div>';
  }
  return h + '<div class="mini">Le chiffre de chaque jour : interventions déjà prévues pour ' +
    ech(quiLisible(c.prestataire) || 'toute l\'équipe') + '.</div></div>';
}
function choisirMiniJour(iso){
  if($('adDate')) $('adDate').value = iso;
  if(MINI_C && $('adHeure') && !$('adHeure').value && MINI_C.heure) $('adHeure').value = MINI_C.heure;
  $('adMiniCal').innerHTML = miniCalHtml();
}

/* ---- le chiffre et la commission du commercial ----
   « Sur leur interface, outre les devis, ils doivent voir leur CA de devis
   signés et leur commission prévue pour chaque prestation vendue. » Les taux
   sont dans REGLAGES (commissions), provisoires en attendant les définitifs. */
function tauxCommission(){
  var s = String(((CFG||{}).reglages||{}).commissions || '');
  var t = {};
  s.split(/\s*;\s*/).forEach(function(p){ var m = p.match(/^([A-Z_]+)=([\d.,]+)$/i); if(m) t[m[1].toUpperCase()] = Number(m[2].replace(',', '.')); });
  return t;
}
function commissionDevis(d, t){
  var nat = String(d.nature || '').toUpperCase(), part = d.typeClient === 'PART';
  var contrat = (nat === 'ENTRETIEN' || nat === 'VITRERIE') && Number(d.passages) > 0 && Number(d.mensuel) > 0;
  if(contrat){
    var mois = t.BASE_CONTRAT_MOIS || 12;
    var base = Number(d.mensuel) * mois;
    var taux = part ? t.CONTRAT_PART : t.CONTRAT_PRO;
    var tr = part ? t.RENOUV_PART : t.RENOUV_PRO;
    return { contrat: true, base: base, taux: taux || 0, com: base * (taux || 0) / 100,
             renouv: tr ? base * tr / 100 : 0, tauxR: tr || 0, max: t.RENOUV_MAX || 0 };
  }
  var tx = nat === 'VITRERIE' ? (part ? t.VITRERIE_PART : t.VITRERIE_PRO) : (t[nat] || t.REMISE || 0);
  var b = Number(d.ht) || 0;
  return { contrat: false, base: b, taux: tx || 0, com: b * (tx || 0) / 100 };
}
/* v106 — en tête de l'onglet Devis du gérant : « Mon chiffre », et les devis
   restés sur ce téléphone sans être partis au bureau. */
var CHIFFRES_DEMANDE = 0;
function enteteDevisAdmin(){
  if(!ARCH.length) archiveRelue();
  if(!ARCH.length && navigator.onLine && Date.now() - CHIFFRES_DEMANDE > 60000){
    CHIFFRES_DEMANDE = Date.now();
    var moi = session();
    if(moi) poster({action:'mesDevis', nom:moi.nom, code:moi.code, appareil:APPAREIL, mois:12}, 40000).then(function(r){
      if(!r || !r.ok) return;
      ARCH = r.devis || []; ARCH_MOIS = Number(r.mois) || 12; ARCH_MAJ = Date.now(); archiveRangee();
      if(ECRAN_VU === 'eAd1' && AD_ONGLET === 'devis') peindreTableau();
    }, function(){});
  }
  /* v108f — « dans Devis laisse juste de quoi créer un devis et ceux
     enregistrés pour les modifier / envoyer » : le chiffre et les commissions
     sont passés au Tableau (chiffresTableauHtml). */
  var att = DEVIS_A_ENVOYER;
  return (att ? '<div class="card" style="border-color:var(--warn)"><b>' + att + ' devis sur ce téléphone pas encore parti' + (att > 1 ? 's' : '') +
      ' au bureau</b><button class="btn sec sm" style="margin-top:8px" onclick="synchroniser(true, this)">Envoyer maintenant</button></div>' : '');
}
/* v108f — le chiffre de la société, les commissions des commerciaux et les
   devis signés, au Tableau, sous « À faire » : là où il restait du vide. */
function chiffresTableauHtml(){
  chargerCommissions(false);
  var h = chiffresHtml();
  var t = TABLEAU || {}, ch = t.chiffres || {};
  var signes = (t.devis || []).filter(function(d){ return String(d.statut || '').toUpperCase() === 'SIGNE'; })
    .slice(0, 8);
  var sig = '<div class="card"><div style="display:flex;gap:10px;align-items:baseline"><h2 style="flex:1;margin:0">Devis signés</h2>' +
      '<button class="btn sec sm" onclick="ongletAdmin(\'devis\')">Tous les devis</button></div>' +
    '<div class="mini" style="margin-top:4px">' + (ch.nb || 0) + ' devis sur la période · ' + (ch.signes || 0) + ' signés · ' +
      eur(ch.htSigne || 0) + ' HT signés</div>' +
    (signes.length ? signes.map(function(d){
      return '<div class="ch" style="cursor:pointer" onclick="ficheDevis(\'' + ech(d.numero).replace(/'/g,'&#39;') + '\')">' +
        '<span>' + ech(d.client || '—') + ' <span class="mini">' + ech(jjmmaa(d.date)) + ' · ' + ech(d.commercial || '') + '</span></span>' +
        '<b>' + eur(d.ht) + '</b></div>';
    }).join('') : '<div class="mini">Aucun devis signé sur la période.</div>') + '</div>';
  return '<div style="margin-top:18px">' + (h ? '<div class="card">' + h + '</div>' : '') + commissionsAdminHtml() + sig + '</div>';
}
var DEVIS_A_ENVOYER = 0;
function compterDevisAEnvoyer(){
  try{
    DB.tous().then(function(l){
      var n = l.filter(function(e){ return e.statut !== 'envoye'; }).length;
      if(n !== DEVIS_A_ENVOYER){ DEVIS_A_ENVOYER = n; if(ECRAN_VU === 'eAd1' && AD_ONGLET === 'devis') peindreTableau(); }
    });
  }catch(e){}
}
function peindreChiffresCommercial(){
  var z = $('mesChiffres');
  if(!z) return;
  if(ECRAN_VU === 'e6') chargerCommissions(false);
  var h = chiffresHtml();
  z.innerHTML = h; z.classList.toggle('hide', !h);
}
/* ---- v107 — le chiffre et les commissions, calculés au bureau ----
   « Les commerciaux voient leur propre chiffre et le chiffre généré au total,
   et leur commission brute mensuelle selon les contrats qu'ils ont rapportés. »
   Le bureau rend : ses lignes (signatures et reconductions, mois par mois), le
   total de la société, et pour le gérant le relevé de chaque commercial. Gardé
   sur le téléphone pour s'afficher hors connexion. */
var COMM = null, COMM_DEMANDE = 0, COMM_MOIS_ADMIN = '';
try{ COMM = JSON.parse(localStorage.getItem('bb_commissions') || 'null'); }catch(e){ COMM = null; }
function chargerCommissions(force){
  var moi = session();
  if(!moi || !navigator.onLine) return;
  if(!force && Date.now() - COMM_DEMANDE < 120000) return;
  COMM_DEMANDE = Date.now();
  poster({action:'commissions', nom:moi.nom, code:moi.code, appareil:APPAREIL, mois:12}, 40000).then(function(r){
    if(!r || !r.ok) return;
    r.pour = moi.nom;
    COMM = r;
    try{ localStorage.setItem('bb_commissions', JSON.stringify(r)); }catch(e){}
    if(ECRAN_VU === 'eAd1' && (AD_ONGLET === 'devis' || AD_ONGLET === 'aujourdhui')) peindreTableau();
    try{ peindreChiffresCommercial(); }catch(e){}
  }, function(){});
}
function commValide(){
  var moi = session();
  return COMM && moi && Array.isArray(COMM.mois) && normNom(COMM.pour || '') === normNom(moi.nom) ? COMM : null;
}
function nomMois(m){
  var p = String(m || '').split('-');
  return p.length === 2 ? MOIS_NOM[Number(p[1]) - 1] + ' ' + p[0] : m;
}
function sommeAn(par, an){
  var r = { ca: 0, com: 0, n: 0 };
  Object.keys(par || {}).forEach(function(m){
    if(m.slice(0, 4) !== String(an)) return;
    r.ca += Number(par[m].ca) || 0; r.com += Number(par[m].com) || 0; r.n += Number(par[m].n) || 0;
  });
  return r;
}
function ligneCommHtml(l){
  var nat = natureVue(l.nature) ? natureVue(l.nature).nom : (l.nature || '');
  var calc = l.type === 'reconduction'
    ? 'Reconduction n° ' + l.rang + ' · ' + eur(l.base) + '/an × ' + nb(l.taux) + ' %'
    : (l.contrat ? 'Contrat ' + eur(l.mensuel) + '/mois → ' + eur(l.base) + ' la 1re année × ' + nb(l.taux) + ' %'
                 : eur(l.base) + ' HT × ' + nb(l.taux) + ' %');
  return '<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>' + ech(l.client) + '</b> <span class="mini">' +
    ech(nat) + (l.part ? ' · particulier' : ' · pro') + '</span>' +
    '<div class="mini">' + calc + ' = <b>' + eur(l.com) + '</b></div></div>';
}
function chiffresHtml(){
  var c = commValide();
  if(!c) return chiffresHtmlAncien();
  var mois = (c.mois || [])[0] || isoJour().slice(0, 7), an = c.an || isoJour().slice(0, 4);
  var mm = (c.moi || {})[mois] || { ca: 0, com: 0, n: 0 }, ma = sommeAn(c.moi, an);
  var sm = (c.total || {})[mois] || { ca: 0, n: 0 }, sa = sommeAn(c.total, an);
  var tuile = function(titre, ca, com, n){
    return '<div class="card" style="flex:1;margin:0"><div class="mini">' + titre + '</div><b style="font-size:18px">' + eur(ca) + '</b>' +
      '<div class="mini">signé HT' + (n != null ? ' · ' + n + ' devis' : '') + '</div>' +
      (com != null ? '<div class="mini">commission brute <b>' + eur(com) + '</b></div>' : '') + '</div>';
  };
  var parMois = (c.mois || []).filter(function(m){ return (c.moi || {})[m]; }).map(function(m){
    var x = c.moi[m];
    var ls = (c.lignes || []).filter(function(l){ return l.mois === m; });
    return '<details style="margin-top:6px"><summary><b>' + ech(nomMois(m)) + '</b> · commission brute <b>' + eur(x.com) + '</b>' +
      ' <span class="mini">(signé ' + eur(x.ca) + ')</span></summary>' + ls.map(ligneCommHtml).join('') + '</details>';
  }).join('');
  /* Le gérant ne se commissionne pas : chez lui, le chiffre de la société. */
  if(c.commerciaux) return '<div style="display:flex;gap:10px;align-items:baseline"><h2 style="flex:1;margin:0">Chiffre de la société</h2>' +
      '<button class="btn sec sm" onclick="chargerCommissions(true)">Actualiser</button></div>' +
    '<div class="mini" style="margin-top:4px">' + ech(c.societe || '') + ' · devis signés, contrats comptés sur leur 1re année</div>' +
    '<div class="row" style="gap:8px;margin-top:8px">' + tuile('Ce mois-ci', sm.ca, null, sm.n) + tuile('Depuis janvier', sa.ca, null, sa.n) + '</div>';
  return '<div style="display:flex;gap:10px;align-items:baseline"><h2 style="flex:1;margin:0">Mon chiffre</h2>' +
      '<button class="btn sec sm" onclick="chargerCommissions(true)">Actualiser</button></div>' +
    '<div class="row" style="gap:8px;margin-top:8px">' + tuile('Ce mois-ci', mm.ca, mm.com, mm.n) + tuile('Depuis janvier', ma.ca, ma.com, ma.n) + '</div>' +
    '<div class="mini" style="margin:12px 0 4px"><b>Toute la société</b> — ' + ech(c.societe || '') + '</div>' +
    '<div class="row" style="gap:8px">' + tuile('Ce mois-ci', sm.ca, null, sm.n) + tuile('Depuis janvier', sa.ca, null, sa.n) + '</div>' +
    '<div style="margin-top:12px"><b>Mes commissions mois par mois</b>' +
      (parMois || '<div class="mini">Pas encore de devis signé sur les 12 derniers mois.</div>') + '</div>' +
    '<div class="mini" style="margin-top:8px">Brut, calculé par le bureau aux taux fixés par la direction : un devis compte le mois de sa signature ' +
      '(contrat : % de la 1re année), une reconduction le mois de l\'anniversaire du contrat.' +
      (c.maj ? ' Mis à jour le ' + ech(jjmmaa(isoJour(new Date(c.maj)))) + '.' : '') + '</div>';
}
/* Le relevé du gérant : par commercial, pour le mois choisi. */
function commissionsAdminHtml(){
  var c = commValide();
  if(!c || !c.commerciaux) return '';
  var mois = COMM_MOIS_ADMIN && (c.mois || []).indexOf(COMM_MOIS_ADMIN) >= 0 ? COMM_MOIS_ADMIN : (c.mois || [])[0];
  var tot = 0;
  var lignes = c.commerciaux.map(function(x){
    var r = (x.mois || {})[mois];
    if(!r) return '';
    tot += Number(r.com) || 0;
    var ls = (x.lignes || []).filter(function(l){ return l.mois === mois; });
    return '<details style="margin-top:6px"><summary><b>' + ech(x.nom) + '</b> · <b>' + eur(r.com) + '</b> <span class="mini">(signé ' + eur(r.ca) +
      ', ' + r.n + ' devis)</span></summary>' + ls.map(ligneCommHtml).join('') + '</details>';
  }).join('');
  return '<div class="card"><div style="display:flex;gap:10px;align-items:center"><h2 style="flex:1;margin:0">Commissions des commerciaux</h2>' +
      '<select id="commMois" onchange="COMM_MOIS_ADMIN=this.value;peindreTableau()" style="width:auto">' +
      (c.mois || []).map(function(m){ return '<option value="' + m + '"' + (m === mois ? ' selected' : '') + '>' + ech(nomMois(m)) + '</option>'; }).join('') +
      '</select></div>' +
    (lignes ? lignes + '<div style="margin-top:8px">Total brut du mois : <b>' + eur(tot) + '</b></div>'
            : '<div class="mini" style="margin-top:8px">Aucune commission sur ce mois.</div>') +
    '<div class="mini" style="margin-top:6px">Le gérant ne se commissionne pas : ses propres devis comptent dans le total de la société seulement.</div></div>';
}
function chiffresHtmlAncien(){
  var t = tauxCommission();
  var signes = (typeof ARCH !== 'undefined' && ARCH ? ARCH : []).filter(function(d){ return String(d.statut).toUpperCase() === 'SIGNE'; });
  if(!signes.length) return '';
  var z = { innerHTML: '' };
  var mois = isoJour().slice(0, 7), an = isoJour().slice(0, 4);
  var somme = function(l){ return l.reduce(function(s, d){ var c = commissionDevis(d, t); s.ca += c.base; s.com += c.com; return s; }, {ca: 0, com: 0}); };
  var quand = function(d){ return String(d.signeLe || d.date || ''); };
  var sm = somme(signes.filter(function(d){ return quand(d).slice(0, 7) === mois; }));
  var sa = somme(signes.filter(function(d){ return quand(d).slice(0, 4) === an; }));
  z.innerHTML = '<div style="display:flex;gap:10px;align-items:baseline"><h2 style="flex:1;margin:0">Mon chiffre</h2>' +
    '</div>' +
    '<div class="row" style="gap:8px;margin-top:8px">' +
      '<div class="card" style="flex:1;margin:0"><div class="mini">Ce mois-ci</div><b style="font-size:18px">' + eur(sm.ca) + '</b>' +
        '<div class="mini">signé HT · commission ' + eur(sm.com) + '</div></div>' +
      '<div class="card" style="flex:1;margin:0"><div class="mini">Depuis janvier</div><b style="font-size:18px">' + eur(sa.ca) + '</b>' +
        '<div class="mini">signé HT · commission ' + eur(sa.com) + '</div></div></div>' +
    '<details style="margin-top:10px"><summary class="mini">Détail par devis signé (' + signes.length + ')</summary>' +
    signes.slice(0, 60).map(function(d){
      var c = commissionDevis(d, t);
      return '<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>' + ech(d.client) + '</b>' +
        '<div class="mini">' + ech(jjmmaa(quand(d))) + ' · ' + ech(natureVue(d.nature) ? natureVue(d.nature).nom : (d.nature || '')) +
        (d.typeClient === 'PART' ? ' · particulier' : ' · pro') + '</div>' +
        '<div class="mini">' + (c.contrat
          ? 'Contrat ' + eur(d.mensuel) + '/mois → ' + eur(c.base) + ' sur la 1re année × ' + nb(c.taux) + ' % = <b>' + eur(c.com) + '</b>' +
            (c.renouv ? ', puis ' + eur(c.renouv) + ' par reconduction (' + nb(c.tauxR) + ' %' + (c.max ? ', ' + c.max + ' fois au plus' : '') + ')' : '')
          : eur(c.base) + ' HT × ' + nb(c.taux) + ' % = <b>' + eur(c.com) + '</b>') + '</div></div>';
    }).join('') + '</details>' +
    '<div class="mini" style="margin-top:6px">Calculé sur les devis signés du bureau, aux taux fixés par la direction.</div>';
  return z.innerHTML;
}


/* ====================== LES CONGÉS (v104) ======================
   « Congés des salariés saisis dans l'appli, pour que les créneaux proposés
   en tiennent compte. » Le gérant les saisit ici ; le bureau les range dans
   l'onglet ABSENCES (qui, du, au — jamais le motif). Le planning les montre,
   les dates proposées les évitent, et la nuit ne pose plus un passage de
   contrat sur quelqu'un qui est en congé. */
function absencesDuJour(iso, t){
  var r = { ferme: false, noms: [] };
  (((t || TABLEAU) || {}).absences || []).forEach(function(a){
    if(iso < a.du || iso > a.au) return;
    if(!a.qui) r.ferme = true;
    else if(!r.noms.some(function(n){ return normNom(n) === normNom(a.qui); })) r.noms.push(a.qui);
  });
  return r;
}
/* Ceux de l'équipe « qui » qui sont absents ce jour-là (tous si c'est fermé). */
function absentsDe(iso, qui, t){
  var a = absencesDuJour(String(iso || '').slice(0, 10), t), noms = nomsQui(qui);
  if(a.ferme) return noms.length ? noms : ['tout le monde'];
  return noms.filter(function(n){ return a.noms.some(function(x){ return normNom(x) === normNom(n); }); });
}
function equipeAbsente(iso, qui){
  if(absencesDuJour(iso).ferme) return true;
  var n = nomsQui(qui);
  return n.length > 0 && absentsDe(iso, qui).length === n.length;
}
function etiquetteConge(iso, classe, long){
  var a = absencesDuJour(iso);
  if(!a.ferme && !a.noms.length) return '';
  var txt = a.ferme ? 'Fermé' : (long ? 'Congé · ' + a.noms.join(', ') : 'Congé ' + a.noms.map(function(n){ return n.charAt(0).toUpperCase() + '.'; }).join(' '));
  return '<span class="' + classe + '" title="' + ech(a.ferme ? 'Fermeture' : a.noms.join(', ') + ' en congé') + '">' + ech(txt) + '</span>';
}

/* ====================== L'ADMINISTRATIF (v108) ======================
   v108d — Simon : le calendrier, le registre et la check-list vivent dans le
   dossier ADMIN de son Drive, pas dans l'appli. Reste ici les éléments de paie
   d'un mois : absences des salariés, commissions des commerciaux. */
var PAIE = null, PAIE_MOIS = '';
function ficheAdministratif(mois){
  AD_FICHE = {type:'admin', cle:''};
  montrer('eAd2');
  $('hTitre').textContent = 'Éléments de paie';
  erreur(''); window.scrollTo(0,0);
  var m = mois || PAIE_MOIS || (new Date().getDate() <= 3
    ? isoJour(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)).slice(0, 7) : isoJour().slice(0, 7));
  if(m !== PAIE_MOIS || !PAIE){ PAIE_MOIS = m; PAIE = null; chargerPaie(); }
  peindreAdministratif();
}
function chargerPaie(){
  var moi = session();
  if(!moi || !navigator.onLine) return;
  var m = PAIE_MOIS;
  poster({action:'elementsPaie', nom:moi.nom, code:moi.code, appareil:APPAREIL, mois:m}, 40000).then(function(r){
    if(m !== PAIE_MOIS) return;
    PAIE = r && r.ok ? r : { erreur: (r && r.erreur) || 'Le bureau n\'a pas répondu.' };
    if(AD_FICHE && AD_FICHE.type === 'admin') peindreAdministratif();
  }, function(){ PAIE = { erreur: 'Le bureau n\'a pas répondu.' }; if(AD_FICHE && AD_FICHE.type === 'admin') peindreAdministratif(); });
}
function choisirMoisPaie(m){ PAIE_MOIS = m; PAIE = null; chargerPaie(); peindreAdministratif(); }
function periodeLisible(p){ return p.du === p.au ? 'le ' + jjmm(p.du) : 'du ' + jjmm(p.du) + ' au ' + jjmm(p.au); }
function textePaie(){
  var p = PAIE;
  if(!p || !p.salaries) return '';
  var t = 'Éléments de paie — ' + nomMois(p.mois) + '\n\nSalariés (jours d\'absence, en jours ouvrables) :\n';
  p.salaries.forEach(function(s){
    t += '- ' + s.nom + ' : ' + s.jours + ' jour' + (s.jours > 1 ? 's' : '') +
      (s.periodes.length ? ' (' + s.periodes.map(periodeLisible).join(', ') + ')' : '') + '\n';
  });
  if(p.fermetures.length) t += '- Fermeture de l\'entreprise : ' + p.fermetures.map(periodeLisible).join(', ') + ' (comptée pour chacun)\n';
  t += '\nCommerciaux (commission brute du mois) :\n';
  t += p.commerciaux.length ? p.commerciaux.map(function(c){ return '- ' + c.nom + ' : ' + eur(c.commission); }).join('\n') : '- aucune commission';
  return t + '\n';
}
function peindreAdministratif(){
  var h = bandeauMot();
  /* 2. paie */
  var mois = [];
  for(var k = 0; k < 6; k++){ mois.push(isoJour(new Date(new Date().getFullYear(), new Date().getMonth() - k, 15)).slice(0, 7)); }
  h += '<div class="card"><div style="display:flex;gap:10px;align-items:center"><h2 style="flex:1;margin:0">Éléments de paie</h2>' +
    '<select id="paieMois" style="width:auto" onchange="choisirMoisPaie(this.value)">' +
    mois.map(function(m){ return '<option value="' + m + '"' + (m === PAIE_MOIS ? ' selected' : '') + '>' + ech(nomMois(m)) + '</option>'; }).join('') + '</select></div>';
  var p = PAIE;
  if(!p) h += '<div class="mini" style="margin-top:8px">' + (navigator.onLine ? 'Chargement…' : 'Hors connexion : les éléments de paie se calculent au bureau.') + '</div>';
  else if(p.erreur) h += '<div class="mini" style="margin-top:8px;color:var(--danger)">' + ech(p.erreur) + '</div>';
  else {
    h += '<div style="margin-top:10px"><b>Salariés</b> <span class="mini">jours d\'absence (lun.–sam., fériés exclus)</span>' +
      p.salaries.map(function(s){
        return '<div style="padding:6px 0;border-bottom:1px solid var(--line);display:flex;gap:8px"><span style="flex:1">' + ech(s.nom) +
          (s.periodes.length ? '<div class="mini">' + ech(s.periodes.map(periodeLisible).join(', ')) + '</div>' : '') + '</span><b>' + s.jours + ' j</b></div>';
      }).join('') +
      (p.fermetures.length ? '<div class="mini" style="margin-top:4px">Fermeture : ' + ech(p.fermetures.map(periodeLisible).join(', ')) + ' (comptée pour chacun)</div>' : '') +
      '</div><div style="margin-top:12px"><b>Commerciaux</b> <span class="mini">commission brute du mois</span>' +
      (p.commerciaux.length ? p.commerciaux.map(function(c){
        return '<div style="padding:6px 0;border-bottom:1px solid var(--line);display:flex;gap:8px"><span style="flex:1">' + ech(c.nom) +
          '<div class="mini">signé ' + eur(c.signe) + '</div></span><b>' + eur(c.commission) + '</b></div>';
      }).join('') : '<div class="mini">Aucune commission ce mois-ci.</div>') + '</div>' +
      '<button class="btn sec sm" style="margin-top:12px" onclick="copierTexte(this, textePaie())">Copier pour le comptable</button>';
  }
  h += '</div>';
  h += '<button class="btn sec" style="margin-top:8px" onclick="listeConges()">Les congés</button>' +
    '<button class="btn sec" style="margin-top:8px" onclick="retourTableau()">Retour au tableau</button>';
  $('adFiche').innerHTML = h;
}
function listeConges(){
  AD_FICHE = {type:'conges', cle:''};
  montrer('eAd2');
  $('hTitre').textContent = 'Les congés';
  erreur(''); window.scrollTo(0,0);
  peindreConges();
}
function peindreConges(){
  var t = TABLEAU || {}, auj = isoJour();
  var l = (t.absences || []).slice();
  var gens = (t.prestataires || []);
  var conflits = (t.chantiers || []).filter(function(c){
    return !estAnnule(c) && c.date && c.date.slice(0,10) >= auj && String(c.statut||'').toUpperCase() !== 'FAIT' &&
           absentsDe(c.date.slice(0,10), c.prestataire).length;
  }).sort(function(a, b){ return a.date < b.date ? -1 : 1; });
  var h = bandeauMot() + '<div class="card"><h2>Poser un congé</h2>' +
    '<label for="cgQui">Qui</label><select id="cgQui">' +
      gens.map(function(n){ return '<option value="' + ech(n) + '">' + ech(n) + '</option>'; }).join('') +
      '<option value="TOUS">Tout le monde (fermeture)</option></select>' +
    '<div class="row" style="gap:8px"><div style="flex:1"><label for="cgDu">Du</label><input id="cgDu" type="date" min="' + auj + '"></div>' +
    '<div style="flex:1"><label for="cgAu">Au (inclus)</label><input id="cgAu" type="date" min="' + auj + '"></div></div>' +
    '<button class="btn" style="margin-top:12px" onclick="ajouterConge(this)">Enregistrer le congé</button>' +
    '<div class="mini">Pendant un congé, la nuit ne pose plus de passage de contrat sur la personne : un binôme part avec l\'autre seul, ' +
    'un passage où il n\'y a qu\'elle va dans « À placer ». Les dates proposées pour replacer une intervention évitent ces jours-là. ' +
    'À l\'enregistrement, la personne est retirée des binômes déjà posés sur la période.</div></div>';
  h += '<h2 style="margin:16px 0 8px">En cours et à venir (' + l.length + ')</h2>' +
    (l.length ? l.map(function(a){
      return '<div class="card" style="margin-bottom:8px;display:flex;gap:10px;align-items:center">' +
        '<div style="flex:1"><b>' + ech(a.qui || 'Fermeture (tout le monde)') + '</b>' +
        '<div class="mini">' + (a.du === a.au ? 'le ' + ech(jourLisible(a.du)) : 'du ' + ech(jourLisible(a.du)) + ' au ' + ech(jourLisible(a.au))) + '</div></div>' +
        '<button class="btn sec sm" style="width:auto" onclick="retirerConge(' + a.rang + ',\'' + ech(a.du) + '\',\'' + ech(a.qui).replace(/'/g, '&#39;') + '\', this)">Retirer</button></div>';
    }).join('') : '<div class="card"><div class="empty">Aucun congé prévu.</div></div>');
  if(conflits.length){
    h += '<h2 style="margin:16px 0 8px;color:var(--danger)">Interventions pendant un congé (' + conflits.length + ')</h2>' +
      '<div class="mini" style="margin:-4px 0 8px">Ouvre-la pour changer la date (les dates proposées tiennent compte des congés) ou la personne.</div>' +
      conflits.map(function(c){
        return '<div class="card chC" style="cursor:pointer;margin-bottom:8px" onclick="ficheChantier(\'' + ech(String(c.id)) + '\')">' +
          '<div class="chTete"><b style="flex:1">' + ech(c.client || 'Intervention') + '</b><span class="mini">' + ech(jourLisible(c.date)) + '</span></div>' +
          '<div class="mini">' + ech(quiLisible(c.prestataire)) + ' · ' + ech(absentsDe(c.date.slice(0,10), c.prestataire).join(' et ')) + ' en congé</div></div>';
      }).join('');
  }
  h += '<button class="btn sec" style="margin-top:12px" onclick="retourTableau()">Retour au tableau</button>';
  $('adFiche').innerHTML = h;
}
function ajouterConge(btn){
  var qui = $('cgQui').value, du = $('cgDu').value, au = $('cgAu').value || du;
  if(!du) return erreur('Choisis la date de début.');
  if(au < du) return erreur('La fin est avant le début.');
  var moi = session();
  occuper(btn, '…');
  poster({action:'absenceAjouter', nom:moi.nom, code:moi.code, appareil:APPAREIL, qui:qui, du:du, au:au}, 40000).then(function(r){
    libere(btn);
    if(!r || !r.ok) return erreur((r && r.erreur) || attenteLisible());
    AD_MOT_T = 0;
    AD_MOT = 'Congé enregistré' + (r.retires ? ' · retiré de ' + r.retires + ' binôme' + (r.retires > 1 ? 's' : '') : '') +
      (r.conflits ? ' · ' + r.conflits + ' intervention' + (r.conflits > 1 ? 's' : '') + ' à replacer' : '');
    $('cgDu').value = ''; $('cgAu').value = '';
    chargerTableau();
  }, function(){ libere(btn); erreur(attenteLisible()); });
}
function retirerConge(rang, du, qui, btn){
  var moi = session();
  occuper(btn, '…');
  poster({action:'absenceRetirer', nom:moi.nom, code:moi.code, appareil:APPAREIL, rang:rang, du:du, qui:qui}, 40000).then(function(r){
    libere(btn);
    if(!r || !r.ok) return erreur((r && r.erreur) || attenteLisible());
    TABLEAU.absences = (TABLEAU.absences || []).filter(function(a){ return a.rang !== rang; })
      .map(function(a){ if(a.rang > rang) a.rang--; return a; });
    peindreConges();
    chargerTableau();
  }, function(){ libere(btn); erreur(attenteLisible()); });
}
