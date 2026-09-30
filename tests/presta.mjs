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

export async function cocher(p, rang) {
  await ouvrirBloc(p, rang);
  await p.click('#pr' + rang + ' .coche');
  await p.waitForTimeout(350);
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
