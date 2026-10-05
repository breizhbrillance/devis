# Le banc d'essai

Ce dossier contient les contrôles automatiques de l'application de devis.
Ils ne servent pas à faire joli : plusieurs défauts réels ont été trouvés par
eux avant d'atteindre un téléphone de commercial, dont un devis signé qui
portait la date de la veille et un tableau de bord dont toutes les dates
avaient un jour d'avance.

## Lancer

```sh
cd tests && npm install       # une seule fois : installe Playwright
npm test                      # tout
npm run test:classeur         # seulement le serveur, rapide
npm run test:appli            # seulement l'application, plus long
node tous.mjs tliste          # une suite précise
```

Les suites de l'application ouvrent un vrai Chromium et prennent une à deux
minutes chacune. Celles du classeur sont instantanées.

Si le navigateur n'est pas trouvé automatiquement, donne son chemin :

```sh
DEVIS_CHROME=/chemin/vers/chrome npm test
```

Et si le banc ne vit pas à côté de l'application :

```sh
DEVIS_APPLI=/chemin/vers/le/depot npm test
```

## Comment c'est bâti

Il n'y a **aucune connexion au vrai classeur ni au vrai Google Drive**, jamais.
Tout est simulé.

| fichier | rôle |
|---|---|
| `gs.mjs` | un faux Google Apps Script : feuilles en mémoire, faux Drive, faux envoi de courriel. `Code.gs` y est chargé tel quel et s'exécute pour de bon. `horloge()` fige le jour vu par le script, pour qu'une épreuve datée ne tombe pas au rouge en vieillissant ; `itineraires()` branche un faux Google Maps, muet par défaut |
| `srv*.mjs` | de faux bureaux HTTP qui servent l'application et répondent à ses appels. `srvco` pour un commercial, `srvag` pour un salarié, `srvad` pour les trois métiers |
| `chemins.mjs` | où sont l'application et le navigateur |
| `presta.mjs` | choisir une prestation dans la liste fixe, comme le ferait un doigt |
| `tous.mjs` | lance tout et compte les points |

Les identifiants qui apparaissent dans les fichiers (`ab1!`, `kw7!`, `qx4$`…)
sont **inventés pour le banc d'essai**. Aucun code réel ne figure ici, et il ne
faut jamais en mettre.

## Les suites

**Le classeur** — `Code.gs` exécuté dans le faux bureau.

| suite | ce qu'elle éprouve |
|---|---|
| `tgs` | le socle : structure des onglets, écriture d'un devis, journal |
| `tsigne` | la signature reçue, le PDF signé qui remplace le vierge |
| `ttarif` | le contrôle des prix à l'arrivée : écarts signalés, jamais réécrits |
| `tpresta` | les salariés : planning, pointage, ce qui leur est interdit |
| `tadmin` | l'espace d'administration : qui est qui, ce qu'il voit, ce qu'il peut poser |
| `tdate` | les dates à l'heure du classeur, pas à celle de Greenwich |
| `tcontrat` | la nature du devis commande le nombre de chantiers, et la colonne NATURES |
| `tplan` | la planification : durée déduite du montant, découpage, jours travaillés, salarié le moins chargé |
| `tplan47` | la planification corrigée après l'audit : journée de 7 h sous 8 h, vraie fréquence des contrats, jours fériés, absences, itinéraire calculé entre deux chantiers (et forfait quand Google Maps ne répond pas), devis refusé qui rend ses créneaux |
| `tmaj` | la majoration pour état des lieux recalculée par le classeur, et la grille par défaut alignée sur le classeur (35 prestations) |
| `tnum` | la forme du numéro de devis, les séries, le numéro neuf à la signature et tout ce qui le suit |
| `tkm` | l'éloignement du client : barème par tranches, distances relevées sur les prix, contrôle des tarifs toujours armé |
| `tvit` | la vitrerie : la nature, le choix entre contrat et une seule fois, le refus de mélanger les natures, les chantiers créés |
| `tmail` | la bannière en bas de chaque courriel, et l'absence de tout autre chemin d'envoi dans le script |

**L'application** — un vrai navigateur, taille d'un téléphone.

| suite | ce qu'elle éprouve |
|---|---|
| `tco` | le parcours complet d'un commercial |
| `tchamps` | la saisie : validation, suggestions, TVA |
| `tv` | le hors-ligne et la file d'attente |
| `tnote` | la note personnelle sur un devis |
| `verif24` | les bornes, les cibles au pouce, les messages lisibles |
| `tplafond` | le rappel du plafond de remise et l'interrupteur du signe % |
| `tprix` | les tarifs verrouillés, y compris par la porte de derrière |
| `tclavier` | le signe % frappé touche par touche |
| `tagent` | l'écran d'un salarié |
| `tsign`, `tsign2` | la signature du client à l'écran |
| `tvue` | la visionneuse de PDF et l'impression |
| `tetat` | l'état du site : normal, sale, très sale, et la ligne de majoration qui en découle |
| `tadmapp` | l'espace d'administration côté écran, couleur comprise |
| `tliste` | la liste fixe des prestations et la remise unique |
| `tnature` | les natures de devis, la mensualisation, l'objet imprimé |
| `tcatnat` | le catalogue filtré par la nature du devis |
| `tnumapp` | le numéro de devis fabriqué sur le téléphone, sans réseau |
| `tkmapp` | l'éloignement côté téléphone : table des communes, prix relevés, rien d'écrit au client |
| `tvitapp` | la vitrerie côté téléphone : la carte, la fréquence facultative, les totaux, ce qui part au bureau, le devis imprimé |
| `tpdf39` | le devis imprimé, lu en extrayant le texte du PDF produit |

## La règle

Un contrôle qui ne tombe jamais au rouge ne sert à rien. Quand on en écrit un
pour un défaut, on remet le défaut une fois pour vérifier qu'il le voit —
et seulement ensuite on remet le correctif.

Et un essai qui **plante** au lieu de rougir ne dit rien non plus : on apprend
seulement qu'il s'est arrêté, pas ce qui a cassé. D'où deux habitudes. Côté
classeur, on indexe prudemment (`(x||[])[i]`) plutôt que de supposer qu'un
tableau est rempli. Côté navigateur, les clics et les saisies passent par des
fonctions qui notent l'échec et continuent, pour que ce soit l'essai porteur de
la règle qui rougisse — et un dernier contrôle vérifie que rien n'a manqué à
l'écran.
