const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
const fs=require('fs'),{JSDOM}=require('jsdom');
const DATA=JSON.parse(fs.readFileSync(FIXTURE,'utf8'));
const WIDTH=Number(process.argv[2]||1400);
const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const {window}=dom;global.window=window;global.document=window.document;
Object.defineProperty(window,'innerWidth',{value:WIDTH,configurable:true});
const problems=[];window.addEventListener('error',e=>problems.push('error: '+e.message));
console.error=(...a)=>problems.push('console.error: '+a.join(' '));
window.customElements.define('ha-icon',class extends window.HTMLElement{});
window.HTMLElement.prototype.scrollIntoView=function(){};
// jsdom reports 0 for clientWidth; give the stage's parent a real one
Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){return WIDTH-60;},configurable:true});
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0],'utf8'));
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u)=>String(u).startsWith('history/period')?Promise.resolve(DATA.history):Promise.resolve(u==='lumen_ha/config'&&m==='GET'?DATA.config_res:u==='lumen_ha/state'?DATA.state:u==='lumen_ha/backups'?{backups:[]}:{ok:true})};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const sr=()=>panel.shadowRoot,wait=ms=>new Promise(r=>setTimeout(r,ms));
const P=(id,x,y,t)=>({pointerId:id,clientX:x,clientY:y,target:t,preventDefault(){}});
const sc=el=>parseFloat((el.style.transform.match(/scale\(([\d.]+)\)/)||[0,'1'])[1]);
(async()=>{
 await wait(900);
 const stage=sr().querySelector('.stage3d'), iso=sr().querySelector('.iso');
 console.log('ekran '+WIDTH+'px  baslangic aci: '+iso.style.transform);
 console.log('  fit='+panel._fitScale.toFixed(3)+'  olcek='+sc(stage)+'  yukseklik='+stage.style.height);
 const first=sc(stage);
 // A: ten drags in a row must not shrink anything
 for(let i=0;i<10;i++){
   stage.onpointerdown(P(1,300,300,stage));
   stage.onpointermove(P(1,300+((i%2)?-160:160),300+40,stage));
   stage.onpointerup(P(1,300,300,stage));
   await wait(5);
 }
 console.log('  10 hareket sonrasi olcek='+sc(stage)+'  (fit='+panel._fitScale.toFixed(3)+')');
 if(Math.abs(sc(stage)-first)>0.001)problems.push('sürükleme ölçegi degistirdi: '+first+' -> '+sc(stage));
 // B: two fingers zoom + pan
 panel._resetCamera(); await wait(400);
 const st2=sr().querySelector('.stage3d'), iso2=sr().querySelector('.iso');
 const before=sc(st2);
 st2.onpointerdown(P(1,200,300,st2)); st2.onpointerdown(P(2,300,300,st2));
 st2.onpointermove(P(1,150,300,st2)); st2.onpointermove(P(2,350,300,st2));  // 100 -> 200
 console.log('  pinch: '+before+' -> '+sc(st2)+'  zoom='+panel._cam.zoom.toFixed(2));
 if(!(panel._cam.zoom>1.9&&panel._cam.zoom<2.1))problems.push('pinch zoom yanlis: '+panel._cam.zoom);
 st2.onpointermove(P(1,200,360,st2)); st2.onpointermove(P(2,400,360,st2));   // slide down 60
 console.log('  kaydirma: tx='+Math.round(panel._cam.tx)+' ty='+Math.round(panel._cam.ty));
 if(Math.round(panel._cam.ty)!==60)problems.push('pan ty '+panel._cam.ty);
 if(!/translate\(/.test(iso2.style.transform))problems.push('translate uygulanmadi');
 // lifting one finger keeps the gesture alive, does not jump
 const z=panel._cam.zoom;
 st2.onpointerup(P(2,400,360,st2));
 st2.onpointermove(P(1,210,360,st2));
 if(Math.abs(panel._cam.zoom-z)>0.001)problems.push('parmak kalkinca zoom sicradi');
 st2.onpointerup(P(1,210,360,st2));
 console.log('  parmak kalkinca zoom sabit: '+panel._cam.zoom.toFixed(2));
 // buttons
 const pills=[...sr().querySelectorAll('.pick,.gpill,.btn')].map(p=>p.textContent.trim());
 console.log('  dugmeler: '+pills.filter(t=>/Yakınlaş|Uzaklaş|sıfırla|görünüm/i.test(t)).join(' | '));
 const zi=[...sr().querySelectorAll('.pick,.gpill,.btn')].find(p=>/Yakınlaş/.test(p.textContent));
 if(!zi)problems.push('yakinlas dugmesi yok'); else{
   const z0=panel._cam.zoom; zi.onclick(); 
   if(!(panel._cam.zoom>z0))problems.push('yakinlas dugmesi calismadi');
 }
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('  -> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
