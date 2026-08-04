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
// The house is only in the document some of the time during a redraw — that was
// the whole problem, so the harness reproduces it: clientWidth is 0 until it is.
Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){
  if(this.tagName==='LUMEN-PANEL')return 2320;
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
(async()=>{
 await wait(900);
 // 1) the scale must be the same at every point of a redraw
 const seen=new Set();
 for(let i=0;i<8;i++){
   panel._renderStage();
   seen.add(panel._fitScale.toFixed(4));      // right after the wipe, detached
   await wait(40);
   seen.add(panel._fitScale.toFixed(4));      // after the frame, attached
 }
 console.log('8 tazelemede goruldugu olcekler:', [...seen].join(' , '));
 if(seen.size!==1)problems.push('olcek tazeleme icinde degisiyor: '+[...seen].join('/'));
 // 2) the box is settled: what the house measures must not move it any more
 const stage=sr().querySelector('.stage3d'), iso=sr().querySelector('.iso');
 const box=stage.style.height;
 let fake=1200;
 iso.getBoundingClientRect=()=>({width:1500,height:fake,top:0,left:0,right:0,bottom:0});
 panel._applyCamera(iso,stage);
 fake=1900; panel._applyCamera(iso,stage);
 fake=0;    panel._applyCamera(iso,stage);
 console.log('kutu yuksekligi olcumden etkilenmiyor:', stage.style.height, '(', box, ')');
 if(stage.style.height!==box)problems.push('kutu olcume gore oynadi');
 if(stage.style.transform)problems.push('sahne yine donusturuluyor');
 console.log('ev donusumu :', iso.style.transform.slice(0,60)+'...');
 console.log('ev zoom     :', iso.style.zoom);
 // the scale is applied as zoom now (re-rasterised, not resampled)
 if(!(parseFloat(iso.style.zoom)>0))problems.push('zoom eve uygulanmadi');
 if(/scale\(/.test(iso.style.transform))problems.push('transform icinde hala scale var');
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('-> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
