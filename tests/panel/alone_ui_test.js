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
const cfg=JSON.parse(JSON.stringify(DATA.config_res));
const conf=cfg.config||cfg;
conf.modes=[
 {key:'normal',name:{tr:'Normal'},icon:'mdi:home-outline',auto_on:true,auto_off:true,only_rooms:[],rooms_off:[],bri:null,kelvin:null,expire_h:0},
 {key:'alone',name:{tr:'Tek Oda'},icon:'mdi:map-marker-radius-outline',auto_on:true,auto_off:true,only_rooms:[],rooms_off:[],bri:null,kelvin:null,expire_h:0,enter:{},keep:[]},
 {key:'guest',name:{tr:'Misafir'},icon:'mdi:glass-cocktail',auto_on:true,auto_off:false,only_rooms:[],rooms_off:[],bri:100,kelvin:null,expire_h:6}];
const state=JSON.parse(JSON.stringify(DATA.state));
state.mode='alone'; state.mode_name='Tek Oda';
let acted=null;
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u,d)=>{if(u==='lumen/action'){acted=d;return Promise.resolve({ok:true});}
  if(u==='lumen_ha/config'&&m==='POST')return Promise.resolve({ok:true});
  return Promise.resolve(String(u).startsWith('history/period')?DATA.history:u==='lumen_ha/config'?cfg:u==='lumen_ha/state'?state:u==='lumen_ha/insight'?{health:[],learn:{},usage:{rooms:{},series:{}},notify_services:[]}:u==='lumen_ha/backups'?{backups:[]}:{ok:true});}};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const sr=()=>panel.shadowRoot,wait=ms=>new Promise(r=>setTimeout(r,ms));
const txt=e=>(e.textContent||'').trim();
(async()=>{
 await wait(900);
 console.log('--- GECE EVI MOD SERIDI ---');
 // Guest is gone and the row of chips is one line with a dropdown
 const msel=sr().querySelector('.modestrip .modesel');
 const names=msel?[...msel.options].map(o=>o.textContent):[];
 console.log(' secenekler    :', names.join(' | '));
 if(names.length!==2)problems.push('mod sayisi '+names.length);
 if(names.some(n=>/Misafir|Guest/.test(n)))problems.push('misafir modu hala duruyor');
 console.log(' secili olan   :', msel&&msel.value);
 if(!msel||msel.value!=='alone')problems.push('secili mod gosterilmiyor');
 console.log(' basliktaki mod:', txt(sr().querySelector('.stage-h .room-meta')));
 console.log('--- MODLAR SAYFASI ---');
 panel._go('modes'); await wait(400);
 const cards=[...sr().querySelectorAll('.mode-card')];
 console.log(' kart sayisi   :', cards.length, '('+cards.map(c=>txt(c.querySelector('.mc-t'))).join(', ')+')');
 if(cards.length!==3)problems.push('kart sayisi '+cards.length);
 const aloneCard=cards.find(c=>/Tek Oda/.test(txt(c.querySelector('.mc-t'))));
 const rows=[...aloneCard.querySelectorAll('.row .rl b')].map(txt);
 console.log(' Tek Oda satirlari:', rows.join(' | '));
 for(const gone of ['Otomatik aç','Otomatik söndür','Parlaklık','Renk sıcaklığı','Sadece bu odalar','Bu odalara dokunma'])
   if(rows.includes(gone))problems.push('eski ayar duruyor: '+gone);
 if(rows.length)problems.push('Tek Oda kartinda ayar satiri kaldi: '+rows.join(','));
 if(!aloneCard.querySelector('.alone-lead'))problems.push('aciklama yok');
 const arows=[...aloneCard.querySelectorAll('.al-row')];
 console.log(' oda satiri    :', arows.length);
 const odaSayisi=Object.keys(panel._cfg.rooms||{}).length;
 if(arows.length!==odaSayisi)problems.push('oda satiri '+arows.length+' / '+odaSayisi);
 const first=arows.find(r=>/Ofis/.test(txt(r.querySelector('.al-n'))));
 console.log(' Ofis satiri   :', txt(first.querySelector('.al-n')), '/', txt(first.querySelector('.al-s')));
 if(!first.querySelector('.al-s .pick'))problems.push('sensor secici yok');
 if(!first.querySelector('.al-k .tgl'))problems.push('dokunma anahtari yok');
 // keep toggle
 const salon=arows.find(r=>/Salon/.test(txt(r.querySelector('.al-n'))));
 salon.querySelector('.al-k .tgl').onclick(); await wait(500);
 const mode=panel._cfg.modes.find(m=>m.key==='alone');
 console.log(' keep listesi  :', JSON.stringify(mode.keep));
 if(!mode.keep.includes('salon'))problems.push('keep kaydedilmedi');
 const marked=[...sr().querySelectorAll('.al-row.kept')].map(r=>txt(r.querySelector('.al-n')));
 console.log(' isaretli oda  :', marked.join(','));
 if(!marked.some(m=>/Salon/.test(m)))problems.push('kept sinifi verilmedi');
 // other cards keep the generic editor
 const guest=cards.find(c=>/Misafir/.test(txt(c.querySelector('.mc-t'))));
 const grows=[...guest.querySelectorAll('.row .rl b')].map(txt);
 // a mode only bends the light now: brightness, tone, self-expiry
 console.log(' Misafir satirlari:', grows.join(' | '));
 if(JSON.stringify(grows)!==JSON.stringify(['Parlaklığı sabitle','Tonu sabitle','Kendi kendine bitsin']))
   problems.push('misafir kartinin ayarlari beklenenden farkli: '+grows.join(','));
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('-> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
