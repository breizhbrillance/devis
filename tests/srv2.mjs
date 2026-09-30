import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { APPLI } from './chemins.mjs';
const DIR=APPLI;
export const recu=[];
export const mode={ sync:'ok' };   // ok | erreur | html | refus | lent
const MIME={'.html':'text/html','.js':'application/javascript','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png'};
export function lancer(port){
 const s=http.createServer((q,r)=>{
  if(q.method==='POST'&&q.url.startsWith('/api')){
    let b=''; q.on('data',d=>b+=d); q.on('end',async ()=>{
      let d={}; try{d=JSON.parse(b)}catch(e){}
      recu.push(d);
      const rep=(o)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify(o));};
      if(d.action==='connexion') return rep({ok:true,nom:'Simon LG',config:{
        maj:Date.now(),
        reglages:{societe_nom:'BREIZH BRILLANCE',societe_forme:'SARL au capital de 1 818 €',
          societe_adresse:'3 Le Norvais',societe_cp_ville:'56250 Monterblanc',societe_tel:'+33 6 73 35 76 05',
          societe_email:'breizhbrillance@gmail.com',societe_siret:'991 595 711 00011',societe_tva:'FR69991595711',
          societe_rcs:'RCS Vannes 991 595 711',prefixe_devis:'DEV',validite_jours:'30',tva_defaut:'20',remise_max:'10',
          texte_information:'Journal des actions activé.',version_information:'1'},
        catalogue:[{categorie:'Vitrerie',reference:'V01',designation:'Nettoyage de vitres',unite:'m²',pu:2.5,tva:20,type:'PONCTUEL'},
                   {categorie:'Bureaux',reference:'B01',designation:'Entretien de bureaux',unite:'m²/mois',pu:1.2,tva:20,type:'MENSUEL'},
                   {categorie:'Finitions',reference:'F01',designation:'Contrôle qualité',unite:'forfait',pu:40,tva:20,type:'PONCTUEL'}]}});
      if(d.action==='sync'){
        if(mode.sync==='erreur'){ r.writeHead(500); return r.end('boom'); }
        if(mode.sync==='html'){ r.writeHead(200,{'Content-Type':'text/html'});
          return r.end('<!doctype html><title>Erreur</title><h1>Google : page introuvable</h1>'); }
        if(mode.sync==='refus') return rep({ok:false,refus:true,erreur:'Nom ou code incorrect'});
        if(mode.sync==='lent'){ await new Promise(x=>setTimeout(x,2500)); }
        return rep({ok:true,numero:d.devis.numero,pdfUrl:'https://drive/x'});
      }
      if(d.action==='statut') return rep({ok:true,statut:d.verdict});
      if(d.action==='photo')  return rep({ok:true,url:'https://drive/p'});
      if(d.action==='journal')return rep({ok:true,recus:(d.evenements||[]).length});
      return rep({ok:true});
    }); return;
  }
  if(q.url.startsWith('/config.js')){
    r.writeHead(200,{'Content-Type':'application/javascript'});
    return r.end('var API_URL="http://127.0.0.1:'+port+'/api";');
  }
  let u=q.url.split('?')[0]; if(u==='/')u='/index.html';
  const f=path.join(DIR,u);
  if(!fs.existsSync(f)){r.writeHead(404);return r.end('');}
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});
  r.end(fs.readFileSync(f));
 });
 return new Promise(res=>s.listen(port,()=>res(s)));
}
