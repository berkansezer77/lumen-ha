const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
const fs=require('fs'),{JSDOM}=require('jsdom');
const DATA=JSON.parse(fs.readFileSync(FIXTURE,'utf8'));
const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const {window}=dom;global.window=window;global.document=window.document;
Object.defineProperty(window,'innerWidth',{value:1600,configurable:true});
Object.defineProperty(window,'innerHeight',{value:1000,configurable:true});
const problems=[];window.addEventListener('error',e=>problems.push('error: '+e.message));
console.error=(...a)=>problems.push('console.error: '+a.join(' '));
window.customElements.define('ha-icon',class extends window.HTMLElement{});
window.HTMLElement.prototype.scrollIntoView=function(){};
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0],'utf8'));
let posted=null;
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u,d)=>{if(u==='lumen_ha/config'&&m==='POST'){posted=d;return Promise.resolve({ok:true});}
  return String(u).startsWith('history/period')?Promise.resolve(DATA.history):Promise.resolve(u==='lumen_ha/config'?DATA.config_res:u==='lumen_ha/state'?DATA.state:u==='lumen_ha/backups'?{backups:[]}:{ok:true});}};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const sr=()=>panel.shadowRoot,wait=ms=>new Promise(r=>setTimeout(r,ms));
const txt=e=>(e.textContent||'').trim();
(async()=>{
 await wait(900);
 const note=()=>sr().querySelector('.freshnote');
 console.log('--- YENI CIHAZ UYARISI ---');
 const before=panel._newCandidates();
 console.log(' onerilen cihazlar:', before.join(', ')||'(yok)');
 if(!before.length){console.log('  (harness verisinde aday yok, uyari testi atlaniyor)');}
 else{
  console.log(' uyari kutusu     :', note()?'var':'YOK');
  const no=[...note().querySelectorAll('.btn')].find(b=>/İstemiyorum/.test(txt(b)));
  console.log(' "İstemiyorum"    :', no?'var':'YOK');
  if(!no)problems.push('istemiyorum dugmesi yok');
  else{
   no.onclick(); await wait(700);   // _save is debounced 400ms
   console.log(' sonra aday sayisi:', panel._newCandidates().length, '(0 olmali)');
   console.log(' uyari kutusu     :', note()?'HALA VAR':'gitti');
   if(panel._newCandidates().length)problems.push('aday listesi temizlenmedi');
   if(note())problems.push('uyari hala duruyor');
   console.log(' kaydedilen ignored:', JSON.stringify((posted&&posted.config?posted.config.ignored:posted&&posted.ignored)||[]));
   const savedList=(posted&&posted.config?posted.config.ignored:posted&&posted.ignored)||[];
   if(!savedList.length)problems.push('ignored kaydedilmedi');
  }
 }
 console.log('--- ODADAN CIKARMA ---');
 const room=panel._room('ofis');
 const victim=(room.trigger||[])[0];
 panel._ignore(victim); panel._save(); await wait(50);
 console.log(' cikarilan       :', victim);
 console.log(' aday olur mu    :', panel._newCandidates().includes(victim)?'EVET (yanlis)':'hayir');
 if(panel._newCandidates().includes(victim))problems.push('cikarilan cihaz yine oneriliyor');
 console.log('--- AYARLARDA GERI ALMA ---');
 await panel._openSettings(); await wait(200);
 const ovs=[...sr().querySelectorAll('.ov')];
 const dlg=ovs[ovs.length-1];
 const labels=[...dlg.querySelectorAll('.ed-l')].map(txt);
 console.log(' ayar basliklari :', labels.join(' | '));
 if(!labels.some(l=>/Dışarıda bıraktıkların/.test(l)))problems.push('yoksayilanlar bolumu yok');
 // the ignored devices sit in their own row, after the language pills
 const rows=[...dlg.querySelectorAll('.gpills')];
 const shelf=rows[rows.length-1];
 const chips=[...shelf.querySelectorAll('.dev.inzone')];
 console.log(' listedeki cihazlar:', chips.map(c=>txt(c)).join(' , ')||'YOK');
 if(!chips.length)problems.push('yoksayilan cihaz listelenmedi');
 else{
   const n=panel._ignored().length;
   chips[0].querySelector('.dev-x').onclick({stopPropagation(){}});
   await wait(200);
   console.log(' geri alindi mi   :', panel._ignored().length===n-1?'evet':'hayir ('+n+' -> '+panel._ignored().length+')');
   if(panel._ignored().length!==n-1)problems.push('geri alma calismadi');
 }
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('-> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
