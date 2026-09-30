// Banc d'essai du script serveur : un faux Google Sheets, juste assez pour
// exercer « À facturer », le tableau de bord, l'expiration et les rappels.
import fs from 'node:fs'; import vm from 'node:vm';
const feuilles = {};
const mails = [];
/* Un faux Drive : ce qui compte pour les essais, c'est quel fichier est créé,
   lequel part à la corbeille, et que les liens restent distincts. */
const fichiers = {};
let nFic = 0;
export function drive(){ return fichiers; }
export function videDrive(){ for(const k in fichiers) delete fichiers[k]; nFic = 0; }
class Range {
  constructor(sh,r,c,nr,nc){ Object.assign(this,{sh,r,c,nr:nr||1,nc:nc||1}); }
  getValues(){ const o=[]; for(let i=0;i<this.nr;i++){ const l=[];
    for(let j=0;j<this.nc;j++) l.push(this.sh._c(this.r-1+i,this.c-1+j)); o.push(l);} return o; }
  getValue(){ return this.getValues()[0][0]; }
  setValues(v){ v.forEach((l,i)=>l.forEach((x,j)=>this.sh._s(this.r-1+i,this.c-1+j,x))); return this; }
  setValue(x){ for(let i=0;i<this.nr;i++) for(let j=0;j<this.nc;j++) this.sh._s(this.r-1+i,this.c-1+j,x); return this; }
  clearContent(){ return this.setValue(''); }
  clearDataValidations(){ return this; }
  setDataValidation(){ return this; }
  setNumberFormat(){ return this; } setWrap(){ return this; } setVerticalAlignment(){ return this; }
  setFontSize(){ return this; } setFontWeight(){ return this; } setBackground(){ return this; }
  setFontColor(){ return this; } setHorizontalAlignment(){ return this; } setBorder(){ return this; }
  setFontStyle(){ return this; } merge(){ return this; } setWrapStrategy(){ return this; }
}
class Sheet {
  constructor(n,d){ this.n=n; this.d=d||[]; }
  _c(i,j){ return (this.d[i]&&this.d[i][j]!==undefined)?this.d[i][j]:''; }
  _s(i,j,x){ while(this.d.length<=i) this.d.push([]); const l=this.d[i];
             while(l.length<=j) l.push(''); l[j]=x; }
  getName(){ return this.n; }
  getLastRow(){ let n=0; this.d.forEach((l,i)=>{ if(l.some(x=>x!=='' && x!=null)) n=i+1; }); return n; }
  getLastColumn(){ let n=0; this.d.forEach(l=>{ for(let j=0;j<l.length;j++) if(l[j]!=='' && l[j]!=null) n=Math.max(n,j+1); }); return n; }
  getMaxRows(){ return Math.max(this.d.length, this.getLastRow(), 2); }
  getMaxColumns(){ return Math.max(this.getLastColumn(), 1); }
  getRange(a,b,c,d){ if(typeof a==='string') throw new Error('plage A1 non gérée'); return new Range(this,a,b,c,d); }
  appendRow(v){ this.d.push(v.slice()); return this; }
  clear(){ this.d=[]; return this; }
  setColumnWidth(){ return this; } setFrozenRows(){ return this; }
  insertColumnsAfter(a,n){ this.d.forEach(l=>{ for(let k=0;k<n;k++) l.splice(a,0,''); }); return this; }
  getDataRange(){ return new Range(this,1,1,Math.max(this.getLastRow(),1),Math.max(this.getLastColumn(),1)); }
  deleteRows(){ return this; } deleteRow(){ return this; } getParent(){ return ss; }
  setTabColor(){ return this; } hideColumns(){ return this; } autoResizeColumn(){ return this; }
}
const ss = {
  getSheetByName:(n)=>feuilles[n]||null,
  insertSheet:(n)=>feuilles[n]=new Sheet(n),
  getUrl:()=>'https://docs.google.com/x',
  getSheets:()=>Object.values(feuilles),
  getSpreadsheetTimeZone:()=>'Europe/Paris'
};
export function creer(nom, lignes){ return feuilles[nom]=new Sheet(nom,lignes.map(l=>l.slice())); }
export function lire(nom){ return feuilles[nom]?feuilles[nom].d:null; }
export function courriers(){ return mails; }
export function charger(chemin){
  const src = fs.readFileSync(chemin,'utf8');
  const ctx = {
    SpreadsheetApp:{ getActive:()=>ss, getUi:()=>({alert:(m)=>{ctx.__alert=m;},prompt:()=>({getSelectedButton:()=>'x'}),createMenu:()=>({addItem(){return this;},addSeparator(){return this;},addToUi(){}})}),
      newDataValidation:()=>({requireCheckbox(){return this;},requireValueInList(){return this;},setAllowInvalid(){return this;},build(){return {};}}),
      Charts:{}, newConditionalFormatRule:()=>({whenTextEqualTo(){return this;},setBackground(){return this;},setRanges(){return this;},build(){return {};}}) },
    Utilities:{ formatDate:(d,tz,f)=>{ const p=n=>('0'+n).slice(-2); const x=new Date(d);
        return f.replace('dd',p(x.getDate())).replace('MM',p(x.getMonth()+1)).replace('yyyy',x.getFullYear())
                .replace('HH',p(x.getHours())).replace('mm',p(x.getMinutes())); },
      newBlob:(b,t,n)=>({b,t,n,getName:()=>n}), base64Decode:(s)=>[1,2,3], base64Encode:()=>'x',
      computeDigest:()=>[1], DigestAlgorithm:{SHA_256:'s'}, Charset:{UTF_8:'u'} },
    MailApp:{ sendEmail:(a,b,c)=>{ mails.push(typeof a==='object'?a:{to:a,subject:b,body:c}); } },
    ScriptApp:{ getProjectTriggers:()=>[], newTrigger:()=>({timeBased:()=>({atHour(){return this;},everyDays(){return this;},inTimezone(){return this;},create(){}})}), deleteTrigger(){}, getService:()=>({getUrl:()=>'https://exec'}) },
    Session:{ getEffectiveUser:()=>({getEmail:()=>'gerant@test.fr'}), getScriptTimeZone:()=>'Europe/Paris' },
    CacheService:{ getScriptCache:()=>({get:()=>null,put(){}}) },
    LockService:{ getScriptLock:()=>({waitLock(){},releaseLock(){}}) },
    DriveApp:{ getRootFolder:()=>dossier(), getFoldersByName:()=>({hasNext:()=>false}), createFolder:()=>dossier(),
      getFileById:(id)=>{ if(!fichiers[id]) throw new Error('fichier introuvable : '+id); return fic(id); } },
    ContentService:{ createTextOutput:(t)=>({setMimeType:()=>t}), MimeType:{JSON:'j'} },
    Logger:{ log(){} }, console, Date, Math, JSON, String, Number, Array, Object, isNaN, parseFloat, parseInt, RegExp, Error
  };
  function fic(id){ return { getUrl:()=>'https://drive.google.com/file/d/'+id+'/view',
    getId:()=>id, getName:()=>fichiers[id].nom, setTrashed:(v)=>{ fichiers[id].corbeille = !!v; return fic(id); } }; }
  function dossier(){ return {
    getFilesByName:()=>({hasNext:()=>false}),
    createFile:(blob)=>{ const id='ID'+(++nFic);
      fichiers[id]={nom:(blob&&blob.getName?blob.getName():'f'), corbeille:false}; return fic(id); },
    getFiles:()=>({hasNext:()=>false}), getFoldersByName:()=>({hasNext:()=>false}),
    createFolder:()=>dossier(), getUrl:()=>'https://drive/d', getId:()=>'DOSSIER' }; }
  vm.createContext(ctx);
  new vm.Script(src).runInContext(ctx);
  return ctx;
}
