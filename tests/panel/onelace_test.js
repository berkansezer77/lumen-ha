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
let posted=null;
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u,d)=>{if(u==='lumen_ha/config'&&m==='POST'){posted=d;return Promise.resolve({ok:true});}
  return Promise.resolve(String(u).startsWith('history/period')?DATA.history:u==='lumen_ha/config'?DATA.config_res:u==='lumen_ha/state'?DATA.state:u==='lumen_ha/backups'?{backups:[]}:{ok:true});}};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const txt=e=>(e.textContent||'').trim();
const card=()=>panel.shadowRoot.querySelector('#roomdlg .slotcard');
const roleRow=(label)=>[...card().querySelectorAll('.row')]
  .find(r=>txt(r.querySelector('.rl b'))===label);
(async()=>{
 await wait(900);
 panel._openRoomSettings('salon'); await wait(300);
 const key=panel._slotSel['salon']||panel._st.slot;
 const others=Object.keys(panel._room('salon').slots).filter(k=>k!==key);
 const secNames=[...panel.shadowRoot.querySelectorAll('#roomdlg .sec-name')].map(txt);
 console.log('pencere bolumleri :', secNames.join(' | '));
 for(const gone of ['Uyandıran','Uyanık Tutan']){
   if(secNames.includes(gone))problems.push(gone+' bolumu hala var');
 }
 for(const need of ['Bu dilimde uyandıran','Bu dilimde uyanık tutan']){
   if(!roleRow(need))problems.push(need+' satiri yok');
 }
 console.log('dilim satirlari   :', ['Bu dilimde uyandıran','Bu dilimde uyanık tutan']
   .map(l=>l+'='+(roleRow(l)?'var':'YOK')).join(' , '));

 // 1) mode switch must be per slot
 const before=JSON.parse(JSON.stringify(panel._room('salon').slots));
 const modePills=[...roleRow('Bu dilimde uyanık tutan').querySelectorAll('.rolebox .gpills .pick')];
 console.log('tutucu modu secenekleri:', modePills.map(txt).join(' | '));
 const all=modePills.find(p=>/Hepsi/.test(txt(p)));
 all.onclick(); await wait(700);
 console.log('bu dilim hold_mode:', panel._room('salon').slots[key].hold_mode);
 const spread=others.filter(k=>panel._room('salon').slots[k].hold_mode==='all');
 console.log('diger dilimler    :', spread.length?spread.join(',')+' (YANLIS)':'degismedi (dogru)');
 if(panel._room('salon').slots[key].hold_mode!=='all')problems.push('mod kaydedilmedi');
 if(spread.length)problems.push('mod diger dilimlere yayildi');

 // 2) removing a hold sensor must touch this slot only
 const holdRow=roleRow('Bu dilimde uyanık tutan');
 const n0=[...holdRow.querySelectorAll('.dev.inzone')].length;
 holdRow.querySelector('.dev.inzone .dev-x').onclick({stopPropagation(){}});
 await wait(700);
 const mine=(panel._room('salon').slots[key].hold_pick||[]).length;
 console.log('tutucu:', n0, '->', mine);
 if(mine!==n0-1)problems.push('cikarma calismadi');
 const changed=others.filter(k=>JSON.stringify(panel._room('salon').slots[k].hold_pick||[])
   !==JSON.stringify(before[k].hold_pick||[]));
 console.log('diger dilimlerin tutucusu:', changed.length?changed.join(',')+' (YANLIS)':'degismedi (dogru)');
 if(changed.length)problems.push('cikarma diger dilimlere yayildi');

 // 3) adding via the picker must land in this slot only
 const addBtn=roleRow('Bu dilimde uyanık tutan').querySelector('.addsec');
 addBtn.onclick(); await wait(250);
 const ov=[...panel.shadowRoot.querySelectorAll('.ov')].pop();
 const pills=[...ov.querySelectorAll('.gpills .pick')];
 console.log('secilebilir       :', pills.length);
 pills[0].onclick();
 [...ov.querySelectorAll('.ed-foot .btn')].pop().onclick(); await wait(700);
 const after=(panel._room('salon').slots[key].hold_pick||[]).length;
 console.log('ekledikten sonra  :', mine, '->', after);
 if(after!==mine+1)problems.push('ekleme calismadi');
 const spread2=others.filter(k=>(panel._room('salon').slots[k].hold_pick||[]).length
   !==(before[k].hold_pick||[]).length);
 console.log('diger dilimlere eklendi mi:', spread2.length?spread2.join(',')+' (YANLIS)':'hayir (dogru)');
 if(spread2.length)problems.push('ekleme diger dilimlere yayildi');
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('-> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
