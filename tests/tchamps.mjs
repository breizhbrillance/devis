/* Les champs de connexion sont-ils vraiment atteignables au doigt ?
   On clique et on tape pour de vrai — pas de fill(), qui traverse les voiles. */
import {chromium} from 'playwright';
import {lancer} from './srvco.mjs';
import { CHROME } from './chemins.mjs';
const PORT=8247; await lancer(PORT);
const b=await chromium.launch({executablePath:CHROME});
const ok=[],ko=[];
const T=(n,c,det)=>{ (c?ok:ko).push(n+(c?'':'   → '+det)); };

const TAILLES=[
  ['iPhone SE',        320, 568, 2],
  ['iPhone 12/13',     390, 844, 3],
  ['iPhone Plus',      428, 926, 3],
  ['Android courant',  360, 740, 3],
  ['tablette',         768,1024, 2],
  ['ordinateur',      1280, 800, 1],
];

for(const [nom,w,h,dpr] of TAILLES){
  const c=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:dpr,
                              hasTouch:true,isMobile:w<700});
  const p=await c.newPage();
  const err=[]; p.on('pageerror',e=>err.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/index.html`,{waitUntil:'networkidle'});
  await p.waitForTimeout(600);

  // Qui est réellement sous le doigt, au centre de chaque champ ?
  const dessus=await p.evaluate(()=>{
    function qui(id){
      const e=document.getElementById(id);
      if(!e) return {id, absent:true};
      const r=e.getBoundingClientRect();
      const x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
      const t=document.elementFromPoint(x,y);
      const cs=getComputedStyle(e);
      return { id,
        visible: r.width>0 && r.height>0,
        rect: [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],
        dansLaVue: r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth,
        dessus: t ? (t.id||t.tagName+'.'+(t.className||'')) : 'rien',
        cestLui: t===e,
        desactive: e.disabled||e.readOnly,
        pointerEvents: cs.pointerEvents,
        opacite: cs.opacity,
        tailleTexte: cs.fontSize
      };
    }
    // tout ce qui flotte au-dessus de la page
    const flottants=[...document.querySelectorAll('body *')].filter(e=>{
      const cs=getComputedStyle(e);
      return (cs.position==='fixed'||cs.position==='absolute')
        && cs.display!=='none' && cs.visibility!=='hidden'
        && e.getBoundingClientRect().width>50;
    }).map(e=>(e.id||e.tagName)+' ['+getComputedStyle(e).position+' z:'+getComputedStyle(e).zIndex+']');
    return { nom:qui('fCommercial'), code:qui('fCode'), bouton:qui('bCo'), flottants,
             hauteurPage: document.documentElement.scrollHeight, vue: innerHeight };
  });

  T(nom+' — le champ nom est dans l\'écran', dessus.nom.dansLaVue, JSON.stringify(dessus.nom.rect)+' vue '+h);
  T(nom+' — rien ne recouvre le champ nom', dessus.nom.cestLui, 'dessus: '+dessus.nom.dessus);
  T(nom+' — rien ne recouvre le champ code', dessus.code.cestLui, 'dessus: '+dessus.code.dessus);
  T(nom+' — le bouton est atteignable',      dessus.bouton.cestLui, 'dessus: '+dessus.bouton.dessus);
  T(nom+' — champs actifs (pas disabled/readonly)', !dessus.nom.desactive && !dessus.code.desactive, '');

  // le vrai test : on clique, on tape
  await p.click('#fCommercial');
  await p.keyboard.type('Simon LG');
  await p.click('#fCode');
  await p.keyboard.type('ab1!');
  const saisi=await p.evaluate(()=>({n:document.getElementById('fCommercial').value,
                                     c:document.getElementById('fCode').value}));
  T(nom+' — on peut écrire le nom au clavier', saisi.n==='Simon LG', 'obtenu: "'+saisi.n+'"');
  T(nom+' — on peut écrire le code au clavier', saisi.c==='ab1!', 'obtenu: "'+saisi.c+'"');

  // zoom iOS : un champ sous 16px fait zoomer la page à la mise au point
  const px=parseFloat(dessus.nom.tailleTexte);
  T(nom+' — texte du champ ≥ 16 px (pas de zoom iOS)', px>=16, dessus.nom.tailleTexte);

  T(nom+' — aucune erreur JS', err.length===0, err.join(' | '));
  if(ko.length && nom==='iPhone SE') console.log('flottants:',dessus.flottants.join(', '));
  await c.close();
}
await b.close();
console.log('\n=== CHAMPS DE CONNEXION : '+ok.length+' au vert, '+ko.length+' au rouge ===');
ok.forEach(x=>console.log('  ✓ '+x));
ko.forEach(x=>console.log('  ✗ '+x));
process.exit(ko.length?1:0);
