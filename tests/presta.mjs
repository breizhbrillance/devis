/* Choisir une prestation dans la liste fixe (v39).

   Jusqu'à la v38, le banc d'essai ouvrait la fenêtre du catalogue et cliquait
   une entrée. Cette fenêtre n'existe plus : les prestations sont toutes là,
   rangées par catégorie, et le commercial pose un chiffre ou coche un forfait.
   Ces fonctions font exactement ce que ferait un doigt — elles ouvrent la
   catégorie en cliquant son titre, puis remplissent le champ. */

export async function ouvrirBloc(p, rang = 0) {
  const id = await p.evaluate((i) => {
    const r = document.getElementById('pr' + i);
    const g = r && r.closest('.grp');
    if (!g) return null;
    if (!g.classList.contains('on')) g.querySelector('.grpT').click();
    return g.id;
  }, rang);
  await p.waitForTimeout(250);
  return id;
}

export async function poserQte(p, rang, qte) {
  await ouvrirBloc(p, rang);
  await p.fill('#pr' + rang + ' input.q', String(qte));
  await p.waitForTimeout(350);
}

/* Mettre un forfait au devis, ou l'en retirer (v54).

   Depuis que les forfaits se comptent, la ligne n'offre « Ajouter » que tant
   qu'elle est à zéro ; dès qu'elle y est, c'est un pas « − n + ». Cette
   fonction fait donc l'un ou l'autre selon l'état où elle trouve la ligne,
   pour que les suites écrites avant la v54 continuent de dire ce qu'elles
   disaient. */
export async function cocher(p, rang) {
  await ouvrirBloc(p, rang);
  const sel = '#pr' + rang;
  const neuf = await p.evaluate((s) => !!document.querySelector(s + ' .coche'), sel);
  if (neuf) {
    await p.click(sel + ' .coche');
  } else {
    for (let k = 0; k < 120; k++) {
      const encore = await p.evaluate((s) => {
        const b = document.querySelector(s + ' .pm');
        if (!b) return false;
        b.click();
        return true;
      }, sel);
      if (!encore) break;
      await p.waitForTimeout(60);
    }
  }
  await p.waitForTimeout(350);
}

/* Poser une quantité sur un forfait, en tapotant le pas comme le ferait un
   doigt. Repart de zéro pour que le compte soit sûr. */
export async function poserForfait(p, rang, n) {
  await cocher(p, rang);                       // au devis, à 1 — ou retiré
  const sel = '#pr' + rang;
  if (!(await p.evaluate((s) => !!document.querySelector(s + ' .pas'), sel))) {
    await cocher(p, rang);                     // il était déjà là : on le remet
  }
  for (let k = 1; k < n; k++) {
    await p.click(sel + ' .pm:last-child');
    await p.waitForTimeout(90);
  }
  await p.waitForTimeout(250);
}

/* L'équivalent de l'ancien « ajouter une prestation » : une ligne, quantité 1. */
export async function ajouterUne(p, rang = 0) {
  await poserQte(p, rang, 1);
}

/* La remise vit désormais sur l'étape 4, à côté du total. */
export async function allerRemise(p) {
  await p.click('#bSuiv');
  await p.waitForTimeout(600);
}
