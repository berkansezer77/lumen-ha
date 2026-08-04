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
let saved=null;
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u,d)=>{if(u==='lumen_ha/config'&&m==='POST'){saved=d;return Promise.resolve({ok:true});}
  return String(u).startsWith('history/period')?Promise.resolve(DATA.history):Promise.resolve(u==='lumen_ha/config'?DATA.config_res:u==='lumen_ha/state'?DATA.state:u==='lumen_ha/backups'?{backups:[]}:{ok:true});}};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const sr=()=>panel.shadowRoot,wait=ms=>new Promise(r=>setTimeout(r,ms));
const txt=el=>(el.textContent||'').trim();
(async()=>{
 await wait(900);
 panel._openRoomSettings('ofis'); await wait(200);
 const box=sr().getElementById('roomdlg');
 const rows=[...box.querySelectorAll('.row .rl b')].map(txt);
 console.log('--- ODA PENCERESI ---');
 console.log(' basliktaki oda tipi :', box.querySelector('.ed-t .roomtype')?box.querySelector('.ed-t .roomtype').value:'YOK');
 console.log(' "Oda Ayarlari" bolumu:', [...box.querySelectorAll('.sec-name')].map(txt).join(' | '));
 if(!box.querySelector('.ed-t .roomtype'))problems.push('oda tipi basliga gelmedi');
 if([...box.querySelectorAll('.sec-name')].some(n=>/Oda Ayarları/i.test(txt(n))))problems.push('Oda Ayarlari bolumu duruyor');
 const card=box.querySelector('.slotcard');
 const cardRows=[...card.querySelectorAll('.row .rl b')].map(txt);
 console.log(' dilim kartindaki satirlar:');
 cardRows.forEach(r=>console.log('    - '+r));
 for(const need of ['Tetik gecikmesi','Kapanma uyarısı']){
   if(!cardRows.includes(need))problems.push(need+' dilim kartinda yok');
 }
 if(rows.filter(r=>r==='Tetik gecikmesi').length!==1)problems.push('Tetik gecikmesi tekrar ediyor/yok');
 // copy
 console.log('--- KOPYALAMA ---');
 const copyPill=[...card.querySelectorAll('.sc-tools .pick')].find(p=>/Kopyala/.test(txt(p)));
 console.log(' Kopyala dugmesi :', copyPill?'var':'YOK');
 if(!copyPill){problems.push('kopyala dugmesi yok');}
 else{
  const room=panel._room('ofis');
  // Karttaki dilim, yapilandirmadaki ilk dilim olmak zorunda degil (panel
  // kendi sirasini kuruyor). Kaynagi karttan oku — ev degisince test
  // kirilmasin.
  const kaynakAd=txt(card.querySelector('.sc-t'));
  // Dilim adi dile gore bir nesne ({tr,en}); duz karsilastirma tutmuyordu.
  const adiniAl=sl=>typeof sl.name==='string'?sl.name:(sl.name&&(sl.name.tr||sl.name.en))||sl.key;
  const kaynak=(panel._cfg.slots||[]).filter(x=>room.slots[x.key])
    .map(x=>({k:x.key,ad:adiniAl(x)})).find(x=>x.ad===kaynakAd);
  const kaynakKey=(kaynak&&kaynak.k)||Object.keys(room.slots)[0];
  console.log(' kopyalanan dilim :', kaynakAd, '('+kaynakKey+')');
  room.slots[kaynakKey].bri=42; room.slots[kaynakKey].kelvin=2100;
  const eveBefore=JSON.stringify(room.slots.evening);
  copyPill.onclick(); await wait(150);
  const ov=[...sr().querySelectorAll('.ov')].pop();
  const targets=[...ov.querySelectorAll('.gpills .pick')].map(txt);
  console.log(' hedef dilimler  :', targets.join(', '));
  const okBtn=[...ov.querySelectorAll('.ed-foot .btn')].pop();
  console.log(' secim yokken buton:', JSON.stringify(txt(okBtn)), 'kapali =', okBtn.disabled);
  if(!okBtn.disabled)problems.push('hedef secilmeden kopyalanabiliyor');
  const eve=[...ov.querySelectorAll('.gpills .pick')].find(p=>/Akşam/.test(txt(p)));
  eve.onclick(); await wait(20);
  console.log(' Aksam secilince   :', JSON.stringify(txt(okBtn)));
  okBtn.onclick(); await wait(200);
  const after=panel._room('ofis').slots.evening;
  console.log(' Aksam bri/kelvin  :', after.bri, after.kelvin, '(42 / 2100 olmali)');
  if(after.bri!==42||after.kelvin!==2100)problems.push('kopyalanmadi');
  if(eveBefore===JSON.stringify(after)&&eveBefore.includes('"bri":42'))problems.push('zaten aynıydi, test anlamsiz');
  // undo
  const box2=sr().getElementById('roomdlg');
  const undo=[...box2.querySelectorAll('.sc-tools .pick')].find(p=>/Geri al/.test(txt(p)));
  console.log(' Geri al dugmesi  :', undo?'var':'YOK');
  if(!undo)problems.push('geri al dugmesi cikmadi');
  else{
    undo.onclick(); await wait(200);
    const back=JSON.stringify(panel._room('ofis').slots.evening);
    console.log(' geri alindi mi   :', back===eveBefore);
    if(back!==eveBefore)problems.push('geri alma calismadi');
  }
 }
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('-> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
