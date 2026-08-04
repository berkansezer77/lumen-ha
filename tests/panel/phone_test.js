const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
const fs=require('fs'),{JSDOM}=require('jsdom');
const DATA=JSON.parse(fs.readFileSync(FIXTURE,'utf8'));
const WIDTH=Number(process.argv[2]||390);
const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const {window}=dom;global.window=window;global.document=window.document;
Object.defineProperty(window,'innerWidth',{value:WIDTH,configurable:true});
Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){return WIDTH-60;},configurable:true});
const problems=[];window.addEventListener('error',e=>problems.push('error: '+e.message));
console.error=(...a)=>problems.push('console.error: '+a.join(' '));
window.customElements.define('ha-icon',class extends window.HTMLElement{});
window.HTMLElement.prototype.scrollIntoView=function(){};
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0],'utf8'));
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u)=>String(u).startsWith('history/period')?Promise.resolve(DATA.history):Promise.resolve(u==='lumen_ha/config'&&m==='GET'?DATA.config_res:u==='lumen_ha/state'?DATA.state:u==='lumen_ha/backups'?{backups:[]}:{ok:true})};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const sr=()=>panel.shadowRoot,wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await wait(900);
 const narrow=WIDTH<760;
 console.log('=== ekran '+WIDTH+'px  ('+(narrow?'TELEFON':'MASAUSTU')+') ===');
 const stages=sr().querySelectorAll('.stage3d');
 const grid=sr().querySelector('.roomgrid');
 const cards=sr().querySelectorAll('.roomgrid .room');
 console.log(' izometrik sahne :', stages.length);
 console.log(' kart izgarasi   :', grid?cards.length+' kart':'yok');
 if(narrow){
   if(stages.length)problems.push('telefonda hala izometrik sahne var');
   const odaSayisi=Object.keys(panel._cfg.rooms||{}).length;
   if(!grid||cards.length!==odaSayisi)
     problems.push('kart izgarasi eksik: '+(cards.length||0)+' / '+odaSayisi);
   for(const c of cards){
     if(c.style.transform)problems.push('kartta transform kaldi: '+c.style.transform);
     if(c.querySelector('.face.side')||c.querySelector('.face.front'))problems.push('3d yuzler duruyor');
     if(c.querySelector('.beam'))problems.push('isik huzmesi duruyor');
   }
   const one=cards[0];
   console.log(' ilk kart icerigi:',
     (one.querySelector('.rname span')||{}).textContent,
     '| meta:', !!one.querySelector('.rmeta'),
     '| cipler:', one.querySelectorAll('.rchip').length,
     '| nabiz:', !!one.querySelector('.iso-lux'),
     '| serit:', !!one.querySelector('.rtl'),
     '| dis:', !!one.querySelector('.rgear'));
   if(!one.querySelector('.rtl'))problems.push('dilim seridi yok');
   if(!one.querySelector('.rgear'))problems.push('ayar dislisi yok');
   // .iso-lux her kartta var (bos kap); asil olcu cizilen cizgi.
   const luxCards=[...cards].filter(c=>c.querySelector('.lx-line')).length;
   const luxOda=Object.values(panel._cfg.rooms||{}).filter(r=>r.lux).length;
   console.log(' nabiz cizgisi   :', luxCards+' kartta / lux tanimli '+luxOda);
   if(luxCards!==luxOda)problems.push('nabiz sayisi '+luxCards+' / '+luxOda);
 } else {
   if(!stages.length)problems.push('masaustunde izometrik kayboldu');
   if(grid)problems.push('masaustunde kart izgarasi cikti');
 }
 const pills=[...sr().querySelectorAll('.pick,.gpill,.btn')].map(p=>p.textContent.trim());
 const cam=pills.filter(t=>/Yakınlaş|Uzaklaş|sıfırla|görünüm|İzometrik/i.test(t));
 console.log(' kamera dugmeleri:', cam.length?cam.join(' | '):'(yok)');
 if(narrow&&cam.length)problems.push('telefonda kamera dugmeleri duruyor');
 if(!narrow&&cam.length<4)problems.push('masaustunde kamera dugmeleri eksik');
 const msel=sr().querySelector('.modestrip .modesel');
 console.log(' mod secici      :', msel?[...msel.options].map(o=>o.textContent).join(' | '):'YOK');
 if(!msel)problems.push('mod secici kayboldu');
 // tapping a card still opens the room
 let opened=0; panel._openInline=()=>opened++;
 const target=(narrow?cards[0]:sr().querySelector('.stage3d .room'));
 target.onclick({currentTarget:target});
 console.log(' karta dokunma   :', opened===1?'oda acildi':'ACILMADI');
 if(opened!==1)problems.push('kart tiklamasi bozuk');
 if(problems.length){console.log(' SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log(' -> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
