/* Le travailleur d'OneSignal, celui qui réveille le téléphone quand une
   notification arrive. Il vit dans son propre dossier pour ne pas prendre la
   place de sw.js, qui fait marcher l'application hors connexion : deux
   travailleurs ne peuvent pas régner sur le même chemin.

   Une seule ligne, et c'est voulu : OneSignal garde son code chez lui et le
   met à jour sans qu'on y touche. Ce fichier doit être servi depuis notre
   propre adresse — un renvoi vers le CDN ne marcherait pas. */
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
