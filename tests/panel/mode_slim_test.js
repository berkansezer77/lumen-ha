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
const problems=[];window.addEventListener('error',e=>problems.push('error: '+e.message));
console.error=(...a)=>problems.push('console.error: '+a.join(' '));
window.customElements.define('ha-icon',class extends window.HTMLElement{});
window.HTMLElement.prototype.scrollIntoView=function(){};
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0],'utf8'));
const cfg=JSON.parse(JSON.stringify(DATA.config_res));const conf=cfg.config||cfg;
conf.modes=[
 {key:'normal',name:{tr:'Normal'},icon:'mdi:home-outline',bri:null,kelvin:null,expire_h:0},
 {key:'alone',name:{tr:'Tek Oda'},icon:'mdi:map-marker-radius-outline',bri:null,kelvin:null,expire_h:0,enter:{},keep:[]},
 {key:'guest',name:{tr:'Misafir'},icon:'mdi:glass-cocktail',bri:100,kelvin:null,expire_h:6}];
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u,d)=>Promise.resolve(String(u).startsWith('history/period')?DATA.history:u==='lumen_ha/config'?cfg:u==='lumen_ha/state'?DATA.state:u==='lumen_ha/insight'?{health:[],learn:{},usage:{rooms:{},series:{}},notify_services:[]}:u==='lumen_ha/backups'?{backups:[]}:{ok:true})};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const sr=()=>panel.shadowRoot,wait=ms=>new Promise(r=>setTimeout(r,ms));
const txt=e=>(e.textContent||'').trim();
(async()=>{
 await wait(900);
 panel._go('modes'); await wait(400);
 const cards=[...sr().querySelectorAll('.mode-card')];
 const byName=n=>cards.find(c=>new RegExp(n).test(txt(c.querySelector('.mc-t'))));
 const rowsOf=c=>[...c.querySelectorAll('.row .rl b')].map(txt);
 for(const [name,want] of [['Normal',[]],['Tek Oda',[]],
   ['Misafir',['Parlaklığı sabitle','Tonu sabitle','Kendi kendine bitsin']]]){
   const rows=rowsOf(byName(name));
   console.log(name.padEnd(9), ':', rows.join(' | ')||'(ayar yok)');
   if(JSON.stringify(rows)!==JSON.stringify(want))problems.push(name+' satirlari: '+rows.join(','));
 }
 console.log('Normal aciklamasi:', txt(byName('Normal').querySelector('.alone-lead')).slice(0,50)+'...');
 if(!byName('Normal').querySelector('.alone-lead'))problems.push('Normal aciklamasi yok');
 const gone=['Işıkları açsın','Işıkları söndürsün','Yalnızca bu odalar','Bu odalara karışma','Diğer odaları söndür'];
 const all=cards.map(c=>rowsOf(c)).flat();
 for(const g of gone) if(all.includes(g))problems.push('hala duruyor: '+g);
 console.log('kaldirilanlar :', gone.filter(g=>!all.includes(g)).length+'/'+gone.length, 'gitti');
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('-> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
