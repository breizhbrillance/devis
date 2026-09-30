/* Faux bureau qui sait reconnaître deux métiers. */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { APPLI } from './chemins.mjs';
const DIR=APPLI;
export const recu=[];
export const mode={ planning:'ok' };   // ok | erreur
const MIME={'.html':'text/html','.js':'application/javascript','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png'};

const GENS = {
  'simon lg': {nom:'SIMON LG', code:'ab1!', role:'COMMERCIAL'},
  'marie k':  {nom:'MARIE K',  code:'kw7!', role:'PRESTATAIRE'}
};

const CFG_COM={ maj:Date.now(), role:'COMMERCIAL',
  reglages:{societe_nom:'BREIZH BRILLANCE',societe_siret:'991 595 711 00011',
    prefixe_devis:'DEV',validite_jours:'30',tva_defaut:'20',remise_max:'10',
    texte_information:'Journal des actions active.',version_information:'1'},
  catalogue:[{categorie:'Vitrerie',reference:'REF-0001',designation:'Nettoyage de vitres',
              unite:'m2',pu:2.5,tva:20,type:'PONCTUEL'}] };

const CFG_AG={ maj:Date.now(), role:'PRESTATAIRE',
  reglages:{societe_nom:'BREIZH BRILLANCE',
    texte_information:'Ce qui est enregistre : connexions, arrivee, depart. Conserve 36 mois.',
    version_information:'1-agent'} };

/* Date locale, pas UTC : entre minuit et 2 h du matin, toISOString() renvoie
   encore la veille et « demain » devenait « aujourd'hui » au banc d'essai. */
const iso = (d)=> d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
const demain = ()=>{ const d=new Date(); d.setDate(d.getDate()+1); return iso(d); };
const hier  = ()=>{ const d=new Date(); d.setDate(d.getDate()-1); return iso(d); };

export const chantiers = [
  { id:'CH-0001', numero:'DEV-2026-SL-0001', client:'MAIRIE DE PLOEREN',
    adresse:'1 place de la Mairie', cp:'56880', ville:'Ploeren',
    acces:'Code portail 1975, gardien le matin',
    date:demain(), heure:'09:00', statut:'PLANIFIE',
    arrivee:0, depart:0, minutes:0, faites:[], signalement:'', note:'',
    taches:[{ref:'REF-0006',designation:'Nettoyage des menuiseries',detail:'12 ouvrants',qte:24,unite:'m2'},
            {ref:'REF-0003',designation:'Decapage des sols',detail:'Preau',qte:180,unite:'m2'}] },
  { id:'CH-0002', numero:'DEV-2026-SL-0002', client:'EHPAD LES PINS',
    adresse:'4 rue des Pins', cp:'56000', ville:'Vannes', acces:'',
    date:hier(), heure:'', statut:'FAIT',
    arrivee:Date.now()-90000000, depart:Date.now()-86400000, minutes:60,
    faites:[], signalement:'', note:'', taches:[] }
];

export function lancer(port){
 const s=http.createServer((q,r)=>{
  if(q.method==='POST'&&q.url.startsWith('/api')){
    let b=''; q.on('data',d=>b+=d); q.on('end',()=>{
      let d={}; try{d=JSON.parse(b)}catch(e){}
      recu.push(d);
      const rep=(o)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify(o));};
      const g = GENS[String(d.nom||'').trim().toLowerCase()];
      if(!g || g.code !== d.code) return rep({ok:false,refus:true,erreur:'Nom ou code incorrect'});
      const agent = g.role === 'PRESTATAIRE';

      const permis = agent
        ? ['connexion','config','photo','journal','planning','chantier']
        : ['connexion','config','sync','photo','journal','statut'];
      if(permis.indexOf(d.action) < 0) return rep({ok:false,erreur:'action non autorisée pour ce compte'});

      if(d.action==='connexion')
        return rep({ok:true, nom:g.nom, role:g.role, config: agent?CFG_AG:CFG_COM});
      if(d.action==='config') return rep({ok:true, config: agent?CFG_AG:CFG_COM});
      if(d.action==='planning'){
        if(mode.planning==='erreur'){ r.writeHead(500); return r.end('boom'); }
        return rep({ok:true, chantiers: JSON.parse(JSON.stringify(chantiers))});
      }
      if(d.action==='chantier'){
        const c = chantiers.find(x=>x.id===d.id);
        if(!c) return rep({ok:false,erreur:'chantier introuvable'});
        if(d.arrivee){ c.arrivee=Number(d.arrivee); c.statut='EN COURS'; }
        if(d.depart){ c.depart=Number(d.depart); c.statut='FAIT';
          if(c.arrivee) c.minutes=Math.round((c.depart-c.arrivee)/60000); }
        if(d.faites!==undefined) c.faites=d.faites;
        if(d.note!==undefined) c.note=d.note;
        if(d.signalement){ c.signalement=d.signalement; if(c.statut!=='FAIT') c.statut='PROBLEME'; }
        return rep({ok:true,id:c.id,statut:c.statut});
      }
      if(d.action==='journal') return rep({ok:true,recus:(d.evenements||[]).length});
      return rep({ok:true});
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
