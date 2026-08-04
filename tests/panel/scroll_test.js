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
Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){
  if(this.tagName==='LUMEN-PANEL')return 2320;
  if(this.classList&&this.classList.contains('iso-wrap')){
    const sec=this.closest('.sec');
    return (sec&&sec.style.width?parseFloat(sec.style.width):1104)-24;}
  return 1104;},configurable:true});
// jsdom has no layout: give #stage a height that follows whether it has content
Object.defineProperty(window.HTMLElement.prototype,'offsetHeight',{get(){
  if(this.id==='stage')return this.children.length?2100:0;
  return 0;},configurable:true});
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
 const stage=sr().getElementById('stage');
 console.log('ilk cizim sonrasi minHeight :', JSON.stringify(stage.style.minHeight));
 // the live refresh: does the page ever lose its height?
 let collapsed=0;
 const realClear=window.HTMLElement.prototype.__proto__;
 for(let i=0;i<5;i++){
   panel._renderStage();
   // right after the wipe+rebuild, what would the browser see?
   const mh=parseFloat(stage.style.minHeight)||0;
   console.log('  tazeleme '+i+': minHeight='+(stage.style.minHeight||'(yok)'));
   if(!mh)collapsed++;
   await wait(30);
 }
 if(collapsed)problems.push('tazelemede yukseklik korunmadi ('+collapsed+' kez)');
 console.log('450ms sonra birakiliyor mu ...');
 await wait(600);
 console.log('  minHeight :', JSON.stringify(stage.style.minHeight), '(bos olmali)');
 if(stage.style.minHeight)problems.push('minHeight birakilmadi');
 // page navigation must not be blocked by a stale hold
 panel._go('log'); await wait(50);
 console.log('sayfa degisince minHeight   :', JSON.stringify(stage.style.minHeight));
 await wait(600);
 if(stage.style.minHeight)problems.push('sayfa degisiminde takildi');
 if(problems.length){console.log('SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log('-> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
