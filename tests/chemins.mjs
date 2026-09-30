/* Où sont l'application et le navigateur d'essai.

   Le banc tournait avec des chemins écrits en dur, valables dans un seul
   environnement. Ici tout se déduit : l'application est le dossier parent
   (le banc vit dans tests/ à la racine du dépôt), et le navigateur se cherche
   là où Playwright range les siens. Deux variables d'environnement permettent
   de forcer l'un ou l'autre : DEVIS_APPLI et DEVIS_CHROME. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));

export const APPLI = process.env.DEVIS_APPLI || path.resolve(ici, '..');

export const CODE_GS = path.join(APPLI, 'Code.gs');

/* Le dossier de Chromium porte un numéro de build qui change à chaque mise à
   jour de Playwright : on ne l'écrit pas, on le retrouve. Rien de trouvé
   renvoie undefined, et Playwright prend alors son navigateur par défaut. */
export const CHROME = process.env.DEVIS_CHROME || (() => {
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  for (const base of bases) {
    let dossiers;
    try { dossiers = fs.readdirSync(base).filter(n => n.startsWith('chromium')).sort(); }
    catch (e) { continue; }
    for (const d of dossiers.reverse()) {
      for (const c of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome']) {
        const p = path.join(base, d, c);
        try { if (fs.existsSync(p)) return p; } catch (e) {}
      }
    }
  }
  return undefined;
})();
