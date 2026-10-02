/* Faux bureau, réglé sur la seule question de la connexion. */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { APPLI } from './chemins.mjs';
const DIR=APPLI;
export const recu=[];
// ok | refus | trop | erreur500 | html | panne | lent
export const mode={ co:'ok' };

/* Prestations ajoutées au catalogue pour une suite précise. Le banc partage ce
   faux bureau : on ne touche donc pas au catalogue commun, qui sert de repère
   de comptage à plusieurs suites. Une suite pousse ici ce dont elle a besoin
   avant d'appeler lancer(). */
export const catalogueSup=[];
const MIME={'.html':'text/html','.js':'application/javascript','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png'};
const CFG={ maj:Date.now(),
  reglages:{societe_nom:'BREIZH BRILLANCE',societe_forme:'SARL au capital de 1 818 €',
    societe_adresse:'3 Le Norvais',societe_cp_ville:'56250 Monterblanc',
    societe_tel:'+33 6 73 35 76 05',societe_email:'breizhbrillance@gmail.com',
    societe_siret:'991 595 711 00011',societe_tva:'FR69991595711',
    prefixe_devis:'DEV',validite_jours:'30',tva_defaut:'20',remise_max:'10',
    texte_information:'Journal des actions activé.',version_information:'1'},
  catalogue:[{categorie:'Vitrerie',reference:'REF-0001',designation:'Nettoyage de vitres',
              unite:'m²',pu:2.5,tva:20,type:'PONCTUEL'},
             {categorie:'Bureaux',reference:'REF-0002',designation:'Entretien de bureaux',
              unite:'m²/mois',pu:1.2,tva:20,type:'MENSUEL'},
             {categorie:'Finitions',reference:'REF-0003',designation:'Contrôle qualité',
              unite:'forfait',pu:40,tva:20,type:'PONCTUEL'}] };

export function lancer(port){
 const s=http.createServer((q,r)=>{
  if(q.method==='POST'&&q.url.startsWith('/api')){
    let b=''; q.on('data',d=>b+=d); q.on('end',async ()=>{
      let d={}; try{d=JSON.parse(b)}catch(e){}
      recu.push(d);
      const rep=(o)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify(o));};
      if(d.action!=='connexion') return rep({ok:true});
      if(mode.co==='panne'){ r.destroy(); return; }
      if(mode.co==='erreur500'){ r.writeHead(500); return r.end('boom'); }
      if(mode.co==='html'){ r.writeHead(200,{'Content-Type':'text/html'});
        return r.end('<!doctype html><title>Erreur</title><h1>Google : page introuvable</h1>'); }
      if(mode.co==='refus') return rep({ok:false,refus:true,erreur:'Nom ou code incorrect'});
      if(mode.co==='trop')  return rep({ok:false,refus:true,erreur:"Trop d'essais. Réessaie dans un quart d'heure."});
      if(mode.co==='lent')  await new Promise(x=>setTimeout(x,3000));
      return rep({ok:true,nom:'Simon LG',
                   config:{...CFG, catalogue:[...CFG.catalogue, ...catalogueSup]}});
    }); return;
  }
  if(q.url.startsWith('/config.js')){
    r.writeHead(200,{'Content-Type':'application/javascript'});
    return r.end('var API_URL="http://127.0.0.1:'+port+'/api";');
  }
  const f=path.join(DIR,(q.url.split('?')[0]||'/').replace(/^\//,'')||'index.html');
  if(!fs.existsSync(f)){ r.writeHead(404); return r.end('non'); }
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});
  r.end(fs.readFileSync(f));
 });
 return new Promise(res=>s.listen(port,()=>res(s)));
}
