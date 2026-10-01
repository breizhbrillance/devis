/* Service worker : met l'application en cache pour qu'elle démarre sans réseau.
   Après toute modification des fichiers, incrémenter VERSION pour forcer la mise à jour. */

var VERSION = 'devis-v41';

var FICHIERS = [
  './',
  'index.html',
  'config.js?v=41',
  'jspdf.umd.min.js?v=41',
  'police.js?v=41',
  'logo.js?v=41',
  'pdf.js?v=41',
  'visionneuse.js?v=41',
  'visionneuse.worker.js?v=41',
  'app.js?v=41',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (e) {
  // cache:'reload' : on va chercher les fichiers sur le serveur, jamais dans le
  // cache du navigateur — sinon une mise à jour peut être stockée déjà périmée.
  var frais = FICHIERS.map(function (f) { return new Request(f, { cache: 'reload' }); });
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(frais); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.map(function (k) { return k === VERSION ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  // Google Sheet et annuaire des entreprises : jamais de cache.
  if (url.indexOf('script.google.com') > -1 || url.indexOf('googleusercontent.com') > -1) return;
  if (url.indexOf('api.gouv.fr') > -1) return;
  if (e.request.method !== 'GET') return;

  // Fichiers de l'application : cache d'abord (démarrage instantané et hors ligne),
  // rafraîchis en arrière-plan quand le réseau est là.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then(function (rep) {
      // même précaution pour le rafraîchissement en arrière-plan
      var demande = new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' });
      var reseau = fetch(demande).then(function (r) {
        if (r && r.status === 200 && r.type === 'basic') {
          var copie = r.clone();
          caches.open(VERSION).then(function (c) { c.put(e.request, copie); });
        }
        return r;
      }).catch(function () { return rep; });
      return rep || reseau;
    })
  );
});
