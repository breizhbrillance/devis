/* L'espace prestataire côté classeur : la cloison des rôles, la naissance des
   chantiers depuis un devis signé, le planning, le pointage. */
import {creer, lire, charger} from './gs.mjs';
import { CODE_GS } from './chemins.mjs';
const ok=[],ko=[];
const T=(n,c,d)=>{ (c?ok:ko).push(n+(c?'':'  → '+JSON.stringify(d))); };
const j=(n)=>{ const d=new Date(); d.setDate(d.getDate()+n); d.setHours(0,0,0,0); return d; };

const EN_D=['NUMERO','DATE','COMMERCIAL','CLIENT','TYPE_CLIENT','ADRESSE','CP','VILLE',
 'TOTAL_HT','STATUT','SIGNE','NOTE_COMMERCIAL','CONTROLE_TARIF','PASSAGES_MOIS'];
const L=(o)=>EN_D.map(h=>o[h]!==undefined?o[h]:'');
creer('DEVIS',[EN_D,
 L({NUMERO:'DEV-2026-SL-0001',DATE:j(-3),COMMERCIAL:'SIMON LG',CLIENT:'MAIRIE DE PLOEREN',
    TYPE_CLIENT:'PROFESSIONNEL',ADRESSE:'1 place de la Mairie',CP:'56880',VILLE:'Ploeren',
    TOTAL_HT:800,STATUT:'REMIS',NOTE_COMMERCIAL:'Code portail 1975, gardien le matin'}),
 L({NUMERO:'DEV-2026-SL-0002',DATE:j(-2),COMMERCIAL:'SIMON LG',CLIENT:'EHPAD LES PINS',
    TYPE_CLIENT:'PROFESSIONNEL',ADRESSE:'4 rue des Pins',CP:'56000',VILLE:'Vannes',
    TOTAL_HT:2000,STATUT:'REMIS',PASSAGES_MOIS:6})]);

const EN_L=['NUMERO','ORDRE','CATEGORIE','REFERENCE','DESIGNATION','DETAIL','QTE','UNITE',
 'PU_HT','REMISE_PCT','TYPE','TVA','TOTAL_HT'];
creer('LIGNES',[EN_L,
 ['DEV-2026-SL-0001',1,'Vitrerie','REF-0006','Nettoyage des menuiseries','12 ouvrants',24,'m2',4,0,'PONCTUEL',10,96],
 ['DEV-2026-SL-0001',2,'Sols','REF-0003','Decapage des sols','Preau',180,'m2',0.5,0,'PONCTUEL',10,90],
 ['DEV-2026-SL-0002',1,'Sante','REF-0010','Entretien complet','7j/7',1,'forfait',2000,0,'MENSUEL',20,2000]]);

creer('COMMERCIAUX',[['NOM','EMAIL','CODE','ACTIF'],
 ['SIMON LG','simon@bb.fr','ab1!','OUI']]);
creer('PRESTATAIRES',[['NOM','EMAIL','CODE','ACTIF','TELEPHONE'],
 ['MARIE K','marie@bb.fr','kw7!','OUI','0600000001'],
 ['YANN P','yann@bb.fr','zp3#','OUI','0600000002'],
 ['ANCIEN AGENT','x@bb.fr','qq9!','NON','']]);
creer('CHANTIERS',[['ID','NUMERO','CLIENT','ADRESSE','CP','VILLE','ACCES','DATE','HEURE',
 'PRESTATAIRE','STATUT','ARRIVEE','DEPART','MINUTES','PRESTATIONS_FAITES','SIGNALEMENT',
 'PHOTOS','NOTE','CREE_LE']]);
creer('REGLAGES',[['CLE','VALEUR','NOTE'],
 ['societe_nom','BREIZH BRILLANCE',''],
 /* cette suite éprouve la création des fiches, pas leur mise au planning */
 ['planification_auto','NON',''],['remise_max','10',''],
 ['passages_mois_defaut','4',''],['pointage_retention_mois','36',''],
 ['societe_siret','991 595 711 00011',''],['sel_codes','secret-a-ne-pas-diffuser',''],
 ['banque_iban','FR76 1234 5678 9012',''],
 ['texte_information_agent','Ce qui est enregistre. Conserve {mois} mois.','']]);
creer('CATALOGUE',[['CATEGORIE','DESIGNATION','DETAIL','UNITE','PU_HT','TVA','TYPE','ACTIF','REFERENCE'],
 ['Vitrerie','Nettoyage des menuiseries','','m2',4,10,'PONCTUEL','OUI','REF-0006']]);
creer('JOURNAL',[['HORODATAGE','MOMENT','COMMERCIAL','ACTION','DETAIL','NUMERO','APPAREIL','SOURCE']]);

const g = charger(CODE_GS);

/* ---------- 1. qui est qui ---------- */
T('un commercial est reconnu comme tel',
  (g.trouverPersonne_('Simon LG')||{}).role === 'COMMERCIAL');
T('un agent est reconnu comme prestataire',
  (g.trouverPersonne_('marie k')||{}).role === 'PRESTATAIRE');
T('un agent désactivé ne se connecte plus',
  g.trouverPersonne_('ANCIEN AGENT') === null);
T('un inconnu reste inconnu', g.trouverPersonne_('PERSONNE') === null);

/* ---------- 2. la cloison des données ---------- */
const cc = g.config_(), cp = g.configPrestataire_();
T('le commercial reçoit le catalogue', Array.isArray(cc.catalogue) && cc.catalogue.length>0);
T('l\'agent ne reçoit AUCUN catalogue', cp.catalogue === undefined, Object.keys(cp));
T('l\'agent ne reçoit aucun compteur', cp.compteurs === undefined);
const brut = JSON.stringify(cp);
T('aucun prix ne part chez l\'agent', !/\b4\b/.test(JSON.stringify(cp.reglages||{})) && !/PU_HT/.test(brut), brut.slice(0,200));
T('ni le SIRET, ni l\'IBAN, ni le sel des codes',
  !/991 595 711|FR76|secret-a-ne-pas/.test(brut), brut.slice(0,300));
T('l\'agent reçoit le nom de la société', cp.reglages.societe_nom === 'BREIZH BRILLANCE');
T('et son texte d\'information, durée remplie',
  /Conserve 36 mois/.test(cp.reglages.texte_information), cp.reglages.texte_information);
T('les deux configurations annoncent leur rôle',
  cc.role === 'COMMERCIAL' && cp.role === 'PRESTATAIRE');

/* ---------- 3. un devis ponctuel signé ---------- */
let r = g.enregistrerStatut_({numero:'DEV-2026-SL-0001', verdict:'SIGNE', quand:Date.now()},
                             {nom:'SIMON LG'});
T('le devis passe à SIGNE', r.ok && r.statut === 'SIGNE', r);
T('un devis ponctuel donne UN chantier', r.chantiers === 1, r.chantiers);
let ch = lire('CHANTIERS');
T('le chantier porte un identifiant lisible', /^CH-\d{4}$/.test(ch[1][0]), ch[1][0]);
T('il reprend le client et l\'adresse',
  ch[1][2]==='MAIRIE DE PLOEREN' && ch[1][3]==='1 place de la Mairie', ch[1].slice(0,6));
T('il reprend les informations d\'accès',
  /1975/.test(String(ch[1][6])), ch[1][6]);
T('il naît sans date et sans agent : c\'est le bureau qui planifie',
  ch[1][7]==='' && ch[1][9]==='', ch[1].slice(7,11));
T('il naît « A PLANIFIER »', ch[1][10]==='A PLANIFIER', ch[1][10]);

/* ---------- 4. un même devis ne double pas ses chantiers ---------- */
r = g.enregistrerStatut_({numero:'DEV-2026-SL-0001', verdict:'SIGNE', quand:Date.now()},
                         {nom:'SIMON LG'});
T('renvoyer le même résultat ne recrée rien', r.chantiers === 0, r.chantiers);
T('toujours un seul chantier', lire('CHANTIERS').length === 2, lire('CHANTIERS').length);

/* ---------- 5. un contrat mensuel ---------- */
r = g.enregistrerStatut_({numero:'DEV-2026-SL-0002', verdict:'SIGNE', quand:Date.now()},
                         {nom:'SIMON LG'});
T('un contrat mensuel donne autant de chantiers que de passages', r.chantiers === 6, r.chantiers);
ch = lire('CHANTIERS');
T('les identifiants restent uniques',
  new Set(ch.slice(1).map(l=>l[0])).size === ch.length-1,
  ch.slice(1).map(l=>l[0]));

/* ---------- 6. le planning d'un agent ---------- */
// le bureau pose une date et un nom
ch = lire('CHANTIERS');
ch[1][7]=j(1); ch[1][8]='09:00'; ch[1][9]='MARIE K'; ch[1][10]='PLANIFIE';
ch[2][7]=j(2); ch[2][9]='YANN P'; ch[2][10]='PLANIFIE';

let pl = g.planningDe_('MARIE K');
T('l\'agent voit son chantier', pl.length === 1, pl.length);
T('il ne voit pas celui d\'un collègue', pl.every(c=>c.client==='MAIRIE DE PLOEREN'), pl.map(c=>c.client));
T('le chantier non planifié n\'apparaît pas', g.planningDe_('MARIE K').every(c=>c.date), pl);

const c0 = pl[0];
T('il a l\'adresse complète',
  c0.adresse==='1 place de la Mairie' && c0.cp==='56880' && c0.ville==='Ploeren', c0);
T('il a le code d\'accès', /1975/.test(c0.acces), c0.acces);
T('il a l\'heure', c0.heure === '09:00', c0.heure);

/* ---------- 7. la fiche de travail, sans un prix ---------- */
T('la fiche liste les prestations vendues', c0.taches.length === 2, c0.taches);
T('avec la quantité et l\'unité',
  c0.taches[0].qte === 24 && c0.taches[0].unite === 'm2', c0.taches[0]);
T('et le détail du chantier', /12 ouvrants/.test(c0.taches[0].detail), c0.taches[0].detail);
const fiche = JSON.stringify(c0.taches);
T('AUCUN montant dans la fiche de travail',
  !/pu|prix|total|tva|remise|PU_HT|TOTAL/i.test(fiche), fiche);
T('rien non plus dans le reste du chantier',
  !/PU_HT|TOTAL_HT|prix/i.test(JSON.stringify(c0)), JSON.stringify(c0).slice(0,200));

/* ---------- 8. le pointage ---------- */
const t0 = Date.now() - 3*3600*1000;
r = g.enregistrerChantier_({id:c0.id, arrivee:t0}, {nom:'MARIE K', role:'PRESTATAIRE'});
T('arrivée enregistrée', r.ok && r.statut==='EN COURS', r);

r = g.enregistrerChantier_({id:c0.id, depart:t0 + 2*3600*1000 + 48*60*1000,
                            faites:['REF-0006'], note:'Vitres du hall a refaire'},
                           {nom:'MARIE K', role:'PRESTATAIRE'});
T('départ enregistré, chantier fait', r.ok && r.statut==='FAIT', r);

pl = g.planningDe_('MARIE K');
T('la durée est calculée', pl[0].minutes === 168, pl[0].minutes);
T('les prestations cochées sont mémorisées',
  pl[0].faites.join(',') === 'REF-0006', pl[0].faites);
T('la note de l\'agent est là', /hall a refaire/.test(pl[0].note), pl[0].note);

/* ---------- 9. un agent ne touche pas au chantier d'un autre ---------- */
const autre = g.planningDe_('YANN P')[0];
r = g.enregistrerChantier_({id:autre.id, arrivee:Date.now()},
                           {nom:'MARIE K', role:'PRESTATAIRE'});
T('le chantier d\'un collègue est refusé', !r.ok && /affect/.test(r.erreur), r);

/* ---------- 10. le signalement ---------- */
r = g.enregistrerChantier_({id:autre.id, signalement:'Local ferme, personne sur place'},
                           {nom:'YANN P', role:'PRESTATAIRE'});
T('le signalement passe le chantier en PROBLEME', r.ok && r.statut==='PROBLEME', r);
T('et il est lisible dans le planning',
  /Local ferme/.test(g.planningDe_('YANN P')[0].signalement),
  g.planningDe_('YANN P')[0].signalement);

/* un signalement sur un chantier déjà fait ne le dégrade pas */
r = g.enregistrerChantier_({id:c0.id, signalement:'Produit manquant pour la prochaine fois'},
                           {nom:'MARIE K', role:'PRESTATAIRE'});
T('un chantier déjà fait reste FAIT', r.ok && r.statut==='FAIT', r);

/* ---------- 11. le journal ---------- */
const jr = lire('JOURNAL').slice(1).map(l=>String(l[3]));
T('les pointages sont tracés', jr.some(a=>/CHANTIER ARRIVEE/.test(a)), jr);
T('la création des chantiers est tracée', jr.some(a=>/CHANTIERS CREES/.test(a)), jr);

/* ---------- 12. cas limites ---------- */
T('chantier sans identifiant : refusé',
  !g.enregistrerChantier_({}, {nom:'MARIE K'}).ok);
T('chantier inconnu : refusé',
  !g.enregistrerChantier_({id:'CH-9999', arrivee:Date.now()}, {nom:'MARIE K'}).ok);
T('envoi sans rien à écrire : refusé',
  !g.enregistrerChantier_({id:c0.id}, {nom:'MARIE K'}).ok);
T('planning d\'un agent sans chantier : liste vide',
  g.planningDe_('PERSONNE').length === 0);

console.log('\n=== ESPACE PRESTATAIRE (classeur) : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
process.exit(ko.length?1:0);
