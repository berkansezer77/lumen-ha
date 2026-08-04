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
Object.defineProperty(window,'innerWidth',{value:2560,configurable:true});
Object.defineProperty(window,'innerHeight',{value:1440,configurable:true});
// The panel is 2320px wide, but a scrollbar comes and goes exactly the way it
// does in a browser: gone while the page is being rebuilt, back a tick later.
let SCROLLBAR=true;
Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){
  if(this.tagName==='LUMEN-PANEL')return 2320-(SCROLLBAR?15:0);
  if(this.classList&&this.classList.contains('iso-wrap')){
    const sec=this.closest('.sec');
    const w=sec&&sec.style.width?parseFloat(sec.style.width):1104;
    return w-24;
  }
  return 1104;
},configurable:true});
const problems=[];window.addEventListener('error',e=>problems.push('error: '+e.message));
console.error=(...a)=>problems.push('console.error: '+a.join(' '));
window.customElements.define('ha-icon',class extends window.HTMLElement{});
window.HTMLElement.prototype.scrollIntoView=function(){};
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0],'utf8'));
const hass={states:DATA.states,entities:DATA.entities,areas:DATA.areas,devices:DATA.devices,auth:{data:{access_token:'t'}},
 callApi:(m,u)=>String(u).startsWith('history/period')?Promise.resolve(DATA.history):Promise.resolve(u==='lumen_ha/config'&&m==='GET'?DATA.config_res:u==='lumen_ha/state'?DATA.state:u==='lumen_ha/backups'?{backups:[]}:{ok:true})};
const panel=document.createElement('lumen-panel');document.body.appendChild(panel);panel.hass=hass;
const sr=()=>panel.shadowRoot,wait=ms=>new Promise(r=>setTimeout(r,ms));
const geo=()=>{const sec=sr().querySelector('.stage3d').closest('.sec');
  return {w:parseFloat(sec.style.width), ml:sec.style.marginLeft};};
(async()=>{
 await wait(900);
 const seen=new Set(), mls=new Set();
 for(let i=0;i<12;i++){
   SCROLLBAR = (i%2===0);        // flickers on every refresh, as it really does
   panel._render();              // exactly what the live refresh does
   await wait(60);
   const g=geo(); seen.add(g.w); mls.add(g.ml);
   console.log('   tur '+i+': w='+g.w+' ml="'+g.ml+'" scrollbar='+SCROLLBAR);
 }
 console.log('12 canli tazelemede goruldugu genislikler:', [...seen].join(', '));
 console.log('sol kenar degerleri                     :', [...mls].join(' , '));
 if(seen.size!==1)problems.push('genislik oynadi: '+[...seen].join('/'));
 if(mls.size!==1)problems.push('sol kenar oynadi');
 // a real resize must still be picked up
 panel._stageW=0;
 Object.defineProperty(window,'innerWidth',{value:1400,configurable:true});
 Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){
   if(this.tagName==='LUMEN-PANEL')return 1160;
   if(this.classList&&this.classList.contains('iso-wrap')){
     const sec=this.closest('.sec');
     return (sec&&sec.style.width?parseFloat(sec.style.width):1104)-24;}
   return 1104;},configurable:true});
 panel._render(); await wait(300);
 console.log('pencere kucultulunce                    :', geo().w+'px (dar pencerede panelin tamami)');
 // 1160px of panel, less a hand's breadth, quantised to 40 -> 1120
 if(geo().w!==1120)problems.push('gercek yeniden boyutlama yakalanmadi: '+geo().w);
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('-> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
