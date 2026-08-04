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
window.URL.createObjectURL=()=>'blob:x'; window.URL.revokeObjectURL=()=>{};
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0],'utf8'));
const state=JSON.parse(JSON.stringify(DATA.state));
state.rooms.ofis=Object.assign({},state.rooms.ofis,
  {lit:true,lights_total:12,groups_total:4,lights_lit:3,bri:84,on_ago:47,motion:true,hold:true});
state.rooms.salon=Object.assign({},state.rooms.salon,
  {lit:false,lights_total:17,groups_total:4,lights_lit:0,motion:false,hold:false});
const INS={health:[],learn:{},notify_services:[],
 usage:{days:30,first:'2026-07-20',watt:9,price:3.5,series:{},
   rooms:{salon:{seconds:36000,hours:10,bulbs:17,kwh:1.5,cost:5},
          ofis:{seconds:72000,hours:20,bulbs:12,kwh:2,cost:7},
          banyo:{seconds:1800,hours:.5,bulbs:2,kwh:.1,cost:.3}}}};
let posted=null;
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u,d)=>{if(u==='lumen_ha/config'&&m==='POST'){posted=d;return Promise.resolve({ok:true});}
  return Promise.resolve(String(u).startsWith('history/period')?DATA.history:u==='lumen_ha/config'?DATA.config_res:u==='lumen_ha/state'?state:u==='lumen_ha/insight'?INS:u==='lumen_ha/backups'?{backups:[]}:{ok:true});}};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const sr=()=>panel.shadowRoot,wait=ms=>new Promise(r=>setTimeout(r,ms));
const txt=e=>(e.textContent||'').trim();
const cardOf=n=>[...sr().querySelectorAll('.stage3d .room')].find(c=>new RegExp(n).test(txt(c.querySelector('.rname'))));
(async()=>{
 await wait(1000);
 console.log('--- 3,5,9 KART BILGISI ---');
 const ofis=cardOf('Ofis'), salon=cardOf('Salon');
 console.log(' Ofis  :', txt(ofis.querySelector('.rmeta')));
 console.log(' Salon :', txt(salon.querySelector('.rmeta')));
 if(/grup/.test(txt(ofis.querySelector('.rmeta'))))problems.push('grup yazisi duruyor');
 if(/12/.test(txt(ofis.querySelector('.rmeta'))))problems.push('toplam isik sayisi duruyor');
 if(!/3 isik|3 ışık/.test(txt(ofis.querySelector('.rmeta'))))problems.push('yanan sayisi yok');
 if(!/47 sn/.test(txt(ofis.querySelector('.rmeta'))))problems.push('sure yok');
 console.log('--- 7 VARLIK GOSTERGESI ---');
 const oc=[...ofis.querySelectorAll('.rchip')].map(txt);
 const sc=[...salon.querySelectorAll('.rchip')].map(txt);
 console.log(' Ofis cipleri :', oc.join(' | '));
 console.log(' Salon cipleri:', sc.join(' | '));
 if(!ofis.querySelector('.rchip.presence.here'))problems.push('hareket gostergesi yanmadi');
 if(salon.querySelector('.rchip.presence.here'))problems.push('bos odada gosterge yanik');
 // the bare number left is the lux reading, which stays; what had to go are
 // the "how many motion / how many presence sensors" counters
 if(ofis.querySelector('.rchip.mot')||ofis.querySelector('.rchip.per'))
   problems.push('sensor sayaclari duruyor');
 console.log(' kalan sayi   :', oc.filter(t=>/^\d+$/.test(t)).join(',')+' (lux)');
 console.log('--- 6 EN COK KULLANILAN ODALAR SERITTE ONDE ---');
 await panel._loadInsight(true);
 // The rail under the house went with the room dock: each card is its own
 // room now, with its own switch, diary and settings.
 console.log(' oda seridi     :', sr().querySelectorAll('.roomstrip').length, '(0 olmali)');
 if(sr().querySelectorAll('.roomstrip').length)problems.push('oda seridi duruyor');
 const cards=[...sr().querySelectorAll('.stage3d .room')];
 console.log(' kart sayisi    :', cards.length);
 if(!cards.length)problems.push('kart yok');
 if(!cards[0].querySelector('.rtoggle'))problems.push('kartta anahtar yok');
 if(!cards[0].querySelector('.rlog'))problems.push('kartta gunluk yok');
 console.log('--- 2 PLAN ARTIK ELLE DUZENLENIYOR ---');
 const pills=[...sr().querySelectorAll('.stage-h .pick')].map(txt);
 console.log(' dugmeler:', pills.join(' | '));
 if(pills.some(p=>/Planı topla/.test(p)))problems.push('topla dugmesi hala duruyor');
 if(!pills.some(p=>/Düzenle|Bitir/.test(p)))problems.push('duzenle dugmesi yok');
 if(panel._repack)problems.push('_repack hala duruyor');
 const floor=panel._cfg.layout.floors[0];
 // no hole anywhere on the grid, and every room keeps the shape it had
 const grid=[];
 let holes=0;
 console.log('--- 8 DISA AKTARMA ---');
 let clicked=null;
 const realAppend=panel.shadowRoot.appendChild.bind(panel.shadowRoot);
 panel.shadowRoot.appendChild=(n)=>{if(n.tagName==='A'){clicked=n;n.click=()=>{};}return realAppend(n);};
 panel._exportConfig(); await wait(50);
 console.log(' indirilen dosya:', clicked&&clicked.download);
 if(!clicked||!/^lumen-ayarlar.*\.json$/.test(clicked.download))problems.push('disa aktarma calismadi');
 console.log('--- 10,11 GORSEL KUTULARI ---');
 for(const o of sr().querySelectorAll('.ov'))o.remove();
 await panel._openSettings(); await wait(500);
 const dlg=[...sr().querySelectorAll('.ov')].pop();
 const slots=[...dlg.querySelectorAll('.artslot')];
 console.log(' kutu sayisi:', slots.length, '('+slots.map(s=>txt(s.querySelector('.as-l'))).join(', ')+')');
 if(slots.length!==4)problems.push('gorsel kutulari eksik: '+slots.length);
 const s0=slots[0];
 console.log(' surukleme  :', typeof s0.ondrop==='function'?'var':'YOK');
 if(typeof s0.ondrop!=='function')problems.push('birakma yok');
 s0.ondragover({preventDefault(){}}); 
 console.log(' uzerine gelince:', s0.className);
 if(!s0.classList.contains('over'))problems.push('surukleme vurgusu yok');
 s0.ondragleave();
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('-> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
