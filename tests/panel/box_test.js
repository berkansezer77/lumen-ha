const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
const fs=require('fs'),{JSDOM}=require('jsdom');
const DATA=JSON.parse(fs.readFileSync(FIXTURE,'utf8'));
const W=Number(process.argv[2]||2560), H=Number(process.argv[3]||1440);
const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const {window}=dom;global.window=window;global.document=window.document;
Object.defineProperty(window,'innerWidth',{value:W,configurable:true});
Object.defineProperty(window,'innerHeight',{value:H,configurable:true});
Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){
  if(this.tagName==='LUMEN-PANEL')return W-240;
  if(this.classList&&this.classList.contains('iso-wrap'))return this.isConnected?1736:0;
  return 1104;},configurable:true});
const problems=[];window.addEventListener('error',e=>problems.push('error: '+e.message));
console.error=(...a)=>problems.push('console.error: '+a.join(' '));
window.customElements.define('ha-icon',class extends window.HTMLElement{});
window.HTMLElement.prototype.scrollIntoView=function(){};
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0],'utf8'));
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u)=>String(u).startsWith('history/period')?Promise.resolve(DATA.history):Promise.resolve(u==='lumen_ha/config'&&m==='GET'?DATA.config_res:u==='lumen_ha/state'?DATA.state:u==='lumen_ha/backups'?{backups:[]}:{ok:true})};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const sr=()=>panel.shadowRoot,wait=ms=>new Promise(r=>setTimeout(r,ms));
const P=(id,x,y,t)=>({pointerId:id,clientX:x,clientY:y,target:t,preventDefault(){}});
// what the browser would actually draw: the plan's corners, turned and tilted
const projected=(w,h,rx,rz,s)=>{
  const r=d=>d*Math.PI/180, cz=Math.cos(r(rz)), sz=Math.sin(r(rz)), cx=Math.cos(r(rx));
  let mx=0,my=0;
  for(const [x,y] of [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]]){
    const px=x*cz-y*sz, py=(x*sz+y*cz)*cx;
    mx=Math.max(mx,Math.abs(px)); my=Math.max(my,Math.abs(py));
  }
  return {w:2*mx*s, h:2*my*s};
};
(async()=>{
 await wait(900);
 const stage=sr().querySelector('.stage3d'), iso=sr().querySelector('.iso');
 const boxH=parseFloat(stage.style.height);
 console.log('=== '+W+'x'+H+' ===');
 console.log(' kutu yuksekligi :', boxH+'px  | olcek:', panel._fitScale.toFixed(3));
 console.log(' sahne transformu:', stage.style.transform||'(yok - dogru)');
 if(stage.style.transform)problems.push('sahne hala donusturuluyor');
 // 1) nothing may move under the hand: neither the size of the house nor the
 //    height of the box, for as long as a finger is down. The box may settle
 //    once the finger lifts — that is one reflow the person asked for.
 const during=new Set(), scales=new Set([panel._fitScale.toFixed(4)]);
 for(let i=0;i<12;i++){
   stage.onpointerdown(P(1,400,400,stage));
   const before=parseFloat(stage.style.height);
   stage.onpointermove(P(1,400+i*40,400+(i%2?-140:140),stage));
   during.add(parseFloat(stage.style.height)-before);
   stage.onpointerup(P(1,0,0,stage));
   scales.add(panel._fitScale.toFixed(4));
   await wait(5);
 }
 console.log(' 12 hareket: surukleme sirasinda kutu oynamasi', [...during].join(','),
   '| olcekler', [...scales].join(','));
 if(during.size!==1||!during.has(0))problems.push('surukleme sirasinda kutu oynadi');
 if(scales.size!==1)problems.push('olcek oynadi');
 // 2) the frame is fixed, and the everyday view sits inside it
 const w=parseFloat(iso.style.width), h=parseFloat(iso.style.height);
 console.log(' plan olculeri   :', w+'x'+h);
 let worstW=0;
 for(let rx=45;rx<=80;rx+=1){
   for(let rz=-180;rz<180;rz+=3){
     worstW=Math.max(worstW, projected(w,h,rx,rz,panel._fitScale).w);
   }
 }
 console.log('   gereken genislik ', Math.round(worstW)+'px  <= alan', (W-240-52)+'px');
 if(worstW>W-240-52)problems.push('bir acida yatay tasiyor: '+Math.round(worstW));
 const frame=parseFloat(stage.style.height);
 const resting=projected(w,h,56,-45,panel._fitScale).h;
 console.log(' cerceve', frame, '| dinlenme acisinda ev', Math.round(resting));
 if(resting>frame)problems.push('varsayilan gorunum cerceveye sigmiyor');
 if(frame!==boxH)problems.push('cerceve degisti: '+boxH+' -> '+frame);
 // 3) tilt cannot go below the angle the fit was made for
 // Yukari = diklesir, asagi = yatar (yon 1.18.0'da cevrildi). Parmak
 // kalkinca esneme geri alinir, yani deger tam sinirda kalmali.
 stage.onpointerdown(P(1,0,0,stage)); stage.onpointermove(P(1,0,-3000,stage)); stage.onpointerup(P(1,0,0,stage));
 console.log(' asiri yukari cekince rx =', panel._cam.rx, '(80 sinir)');
 if(panel._cam.rx!==80)problems.push('egim ust siniri tutmadi: '+panel._cam.rx);
 stage.onpointerdown(P(1,0,0,stage)); stage.onpointermove(P(1,0,3000,stage)); stage.onpointerup(P(1,0,0,stage));
 console.log(' asiri asagi cekince rx =', panel._cam.rx, '(sinir '+panel._tiltMin+')');
 if(panel._cam.rx!==panel._tiltMin)problems.push('egim alt siniri tutmadi: '+panel._cam.rx);
 // 4) a tilt saved by an older version is brought inside the range
 // a tilt saved on a roomier screen is held inside what this one can draw
 window.localStorage.setItem('lumen_cam', JSON.stringify({rx:5,rz:-42,zoom:1,tx:0,ty:0}));
 panel._cam=null;
 panel._applyCamera(iso, stage);
 const applied=parseFloat((iso.style.transform.match(/rotateX\(([\d.]+)deg\)/)||[0,'0'])[1]);
 console.log(' eski kayitli 5 derece -> uygulanan', applied+'°', '(sinir '+panel._tiltMin+')');
 if(applied<panel._tiltMin)problems.push('sinirin altinda cizildi: '+applied);
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log(' -> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
