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
 callApi:(m,u)=>Promise.resolve(String(u).startsWith('history/period')?DATA.history:u==='lumen_ha/config'?DATA.config_res:u==='lumen_ha/state'?DATA.state:u==='lumen_ha/backups'?{backups:[]}:{ok:true})};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const P=(id,x,y,t)=>({pointerId:id,clientX:x,clientY:y,target:t,preventDefault(){}});
const projected=(w,h,rx,rz,s)=>{const r=d=>d*Math.PI/180,cz=Math.cos(r(rz)),sz=Math.sin(r(rz)),cx=Math.cos(r(rx));
 let mx=0,my=0;for(const [x,y] of [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]]){
  const px=x*cz-y*sz, py=(x*sz+y*cz)*cx; mx=Math.max(mx,Math.abs(px)); my=Math.max(my,Math.abs(py));}
 return {w:2*mx*s,h:2*my*s};};
(async()=>{
 await wait(900);
 const stage=panel.shadowRoot.querySelector('.stage3d'), iso=panel.shadowRoot.querySelector('.iso');
 const w=parseFloat(iso.style.width), h=parseFloat(iso.style.height);
 const boxH=parseFloat(stage.style.height);
 console.log('=== '+W+'x'+H+' ===');
 console.log(' olcek           :', panel._fitScale.toFixed(3), '| kutu', boxH+'px', '| duzlesme siniri', panel._tiltMin+'°');
 // Parmak yukari: ev DIKLESIR (yon 1.18.0'da cevrildi). Asagi: yatar.
 // Iki uc da uzun bir suruklemeyle taminen gorulmeli.
 stage.onpointerdown(P(1,500,500,stage)); stage.onpointermove(P(1,500,-4000,stage)); stage.onpointerup(P(1,0,0,stage));
 console.log(' sonuna kadar yukari ->', panel._cam.rx+'° (tavan 80)');
 if(panel._cam.rx!==80)problems.push('tavana ulasilamadi: '+panel._cam.rx);
 stage.onpointerdown(P(1,500,-500,stage)); stage.onpointermove(P(1,500,4000,stage)); stage.onpointerup(P(1,0,0,stage));
 console.log(' sonuna kadar asagi ->', panel._cam.rx+'° (taban '+panel._tiltMin+')');
 if(panel._cam.rx!==panel._tiltMin)problems.push('tabana ulasilamadi: '+panel._cam.rx);
 // the sides are fitted for the worst angle, so turning never runs off them
 let worstH=0,worstW=0,at='';
 for(let rx=panel._tiltMin;rx<=80;rx+=1)for(let rz=-180;rz<180;rz+=3){
   const p=projected(w,h,rx,rz,panel._fitScale);
   if(p.h>worstH){worstH=p.h;at='rx='+rx+' rz='+rz;}
   if(p.w>worstW)worstW=p.w;
 }
 console.log(' en kotu aci     :', at);
 console.log('   en yuksek hali', Math.round(worstH), '| kutu simdi', parseFloat(stage.style.height));
 // the stage takes the whole panel now, less a hand's breadth
 const across=panel._stageWidth()-40;
 console.log('   genislik ', Math.round(worstW), '<= alan', across);
 if(worstW>across+2)problems.push('yatay tasma: '+Math.round(worstW));
 // and once flat, the box grew to hold the flat house rather than clipping it
 // Flatter than the frame is allowed and cropped: the frame is a window and
 // the house can be panned behind it. What must never happen is the frame
 // itself moving.
 const flatH=projected(w,h,panel._cam.rx,panel._cam.rz,panel._fitScale).h;
 const box2=parseFloat(stage.style.height);
 console.log('   duzlesince ev', Math.round(flatH), '| cerceve', box2, '(sabit kalmali)');
 if(box2!==boxH)problems.push('cerceve oynadi: '+boxH+' -> '+box2);
 panel._camera().ty=99999;
 panel._applyCamera(iso, stage);
 console.log('   asiri kaydirma sonrasi ty:', Math.round(panel._camera().ty));
 if(!Number.isFinite(panel._camera().ty)||Math.abs(panel._camera().ty)>4000)
   problems.push('kaydirma sinirlanmadi');
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log(' -> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
