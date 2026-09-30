/* Faux bureau à trois métiers : commercial, prestataire, admin. */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { APPLI } from './chemins.mjs';
const DIR=APPLI;
export const recu=[];
export const mode={ tableau:'ok' };            // ok | erreur
const MIME={'.html':'text/html','.js':'application/javascript','.json':'application/json',
            '.webmanifest':'application/manifest+json','.png':'image/png'};

const GENS = {
  'simon lg':        {nom:'SIMON LG',        code:'ab1!', role:'COMMERCIAL'},
  'marie k':         {nom:'MARIE K',         code:'kw7!', role:'PRESTATAIRE'},
  'simon direction': {nom:'SIMON DIRECTION', code:'qx4$', role:'ADMIN'}
};

const CFG_COM={ maj:Date.now(), role:'COMMERCIAL',
  reglages:{societe_nom:'BREIZH BRILLANCE',prefixe_devis:'DEV',validite_jours:'30',
    tva_defaut:'20',remise_max:'10',texte_information:'',version_information:'1'},
  catalogue:[{categorie:'Vitrerie',reference:'REF-0001',designation:'Nettoyage de vitres',
              unite:'m2',pu:2.5,tva:20,type:'PONCTUEL'}] };

const CFG_AD={ maj:Date.now(), role:'ADMIN',
  reglages:{societe_nom:'BREIZH BRILLANCE',texte_information:'',version_information:'1'},
  commerciaux:['SIMON LG','LEA M'],
  prestataires:['MARIE K','YANN P'] };

/* Date locale, pas UTC : entre minuit et 2 h du matin, toISOString() renvoie
   encore la veille et « demain » devenait « aujourd'hui » au banc d'essai. */
const iso = (d)=> d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
const jour=(n)=>{ const d=new Date(); d.setDate(d.getDate()+n); return iso(d); };

export const tableau = {
  ok:true, maj:Date.now(), fenetre:90,
  chiffres:{nb:4, signes:2, ht:3600, htSigne:2800, mensuelSigne:2000},
  parCommercial:[
    {nom:'SIMON LG', nb:2, signes:2, ht:2800, htSigne:2800, mensuelSigne:2000},
    {nom:'LEA M', nb:2, signes:0, ht:800, htSigne:0, mensuelSigne:0}
  ],
  devis:[
    {numero:'DEV-2026-SL-0001', date:jour(-3), commercial:'SIMON LG', client:'MAIRIE DE PLOEREN',
     ville:'Ploeren', ttc:960, ht:800, statut:'SIGNE', motif:'', relance:'',
     pdf:'https://drive.google.com/file/d/ID1/view', signe:true, preuve:true, note:''},
    {numero:'DEV-2026-SL-0002', date:jour(-2), commercial:'SIMON LG', client:'EHPAD LES PINS',
     ville:'Vannes', ttc:2400, ht:2000, statut:'SIGNE', motif:'', relance:'',
     pdf:'https://drive.google.com/file/d/ID2/view', signe:true, preuve:false, note:'Contrat annuel'},
    {numero:'DEV-2026-LM-0001', date:jour(-1), commercial:'LEA M', client:'GARAGE DU PORT',
     ville:'Vannes', ttc:600, ht:500, statut:'REFUSE', motif:'Trop cher', relance:'',
     pdf:'', signe:false, preuve:false, note:''},
    {numero:'DEV-2026-LM-0002', date:jour(-1), commercial:'LEA M', client:'BOULANGERIE',
     ville:'Auray', ttc:360, ht:300, statut:'A RELANCER', motif:'', relance:jour(2),
     pdf:'', signe:false, preuve:false, note:''}
  ],
  chantiers:[
    {id:'CH-0001', numero:'DEV-2026-SL-0001', client:'MAIRIE DE PLOEREN',
     adresse:'1 place de la Mairie', cp:'56880', ville:'Ploeren', acces:'Code portail 1975',
     date:'', heure:'', prestataire:'', statut:'A PLANIFIER',
     arrivee:0, depart:0, minutes:0, signalement:'', note:''},
    {id:'CH-0002', numero:'DEV-2026-SL-0002', client:'EHPAD LES PINS', adresse:'4 rue des Pins',
     cp:'56000', ville:'Vannes', acces:'', date:jour(1), heure:'09:00', prestataire:'MARIE K',
     statut:'PLANIFIE', arrivee:0, depart:0, minutes:0, signalement:'', note:''},
    {id:'CH-0003', numero:'DEV-2026-SL-0002', client:'EHPAD LES PINS', adresse:'4 rue des Pins',
     cp:'56000', ville:'Vannes', acces:'', date:jour(-2), heure:'14:00', prestataire:'YANN P',
     statut:'FAIT', arrivee:Date.now()-90000000, depart:Date.now()-86400000, minutes:75,
     signalement:'Local ferme a l arrivee', note:'Prevoir la cle'}
  ],
  prestataires:['MARIE K','YANN P'],
  commerciaux:['SIMON LG','LEA M']
};

export function lancer(port){
 const s=http.createServer((q,r)=>{
  if(q.method==='POST'&&q.url.startsWith('/api')){
    let b=''; q.on('data',d=>b+=d); q.on('end',()=>{
      let d={}; try{d=JSON.parse(b)}catch(e){}
      recu.push(d);
      const rep=(o)=>{r.writeHead(200,{'Content-Type':'application/json'});r.end(JSON.stringify(o));};
      const g = GENS[String(d.nom||'').trim().toLowerCase()];
      if(!g || g.code !== d.code) return rep({ok:false,refus:true,erreur:'Nom ou code incorrect'});

      const permis = g.role === 'ADMIN'
        ? ['connexion','config','journal','tableau','planifier','statut']
        : g.role === 'PRESTATAIRE'
          ? ['connexion','config','photo','journal','planning','chantier']
          : ['connexion','config','sync','photo','journal','statut'];
      if(permis.indexOf(d.action) < 0) return rep({ok:false,erreur:'action non autorisée pour ce compte'});

      const cfg = g.role==='ADMIN' ? CFG_AD : CFG_COM;
      if(d.action==='connexion') return rep({ok:true, nom:g.nom, role:g.role, config:cfg});
      if(d.action==='config')    return rep({ok:true, config:cfg});
      if(d.action==='tableau'){
        if(mode.tableau==='erreur'){ r.writeHead(500); return r.end('boom'); }
        return rep(JSON.parse(JSON.stringify(Object.assign({}, tableau, {maj:Date.now()}))));
      }
      if(d.action==='planifier'){
        const c = tableau.chantiers.find(x=>x.id===d.id);
        if(!c) return rep({ok:false,erreur:'chantier introuvable'});
        if(d.prestataire && tableau.prestataires.indexOf(d.prestataire)<0)
          return rep({ok:false,erreur:"ce prestataire n'est pas dans la liste"});
        if(d.date!==undefined) c.date=d.date;
        if(d.heure!==undefined) c.heure=d.heure;
        if(d.prestataire!==undefined) c.prestataire=d.prestataire;
        c.statut = (c.date && c.prestataire) ? 'PLANIFIE' : 'A PLANIFIER';
        return rep({ok:true, id:c.id, statut:c.statut});
      }
      if(d.action==='statut'){
        const dv = tableau.devis.find(x=>x.numero===d.numero);
        if(!dv) return rep({ok:false,erreur:'devis introuvable dans le classeur'});
        dv.statut = {SIGNE:'SIGNE', RELANCE:'A RELANCER', REFUSE:'REFUSE'}[d.verdict] || dv.statut;
        dv.motif = d.motif||''; dv.relance = d.relance||'';
        return rep({ok:true});
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
