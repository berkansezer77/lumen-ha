const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
const fs=require('fs'),{JSDOM}=require('jsdom');
const DATA=JSON.parse(fs.readFileSync(FIXTURE,'utf8'));
const W=Number(process.argv[2]||2000), H=Number(process.argv[3]||1080);
const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const {window}=dom;global.window=window;global.document=window.document;
Object.defineProperty(window,'innerWidth',{value:W,configurable:true});
Object.defineProperty(window,'innerHeight',{value:H,configurable:true});
const HOST=W-240;   // HA sidebar
Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get(){
  if(this.tagName==='LUMEN-PANEL')return HOST;
  if(this.classList&&this.classList.contains('iso-wrap')){
    const sec=this.closest('.sec');
    const w=sec&&sec.style.width?parseFloat(sec.style.width):Math.min(1160,HOST);
    return w-24;   // .sec padding-left
  }
  return Math.min(1160,HOST)-56;
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
(async()=>{
 await wait(900);
 console.log('=== pencere '+W+'x'+H+'  (panel alani '+HOST+'px) ===');
 const wrap=sr().querySelector('.wrap');
 const hero=sr().getElementById('heroH');
 console.log(' baslik gizli    :', wrap.classList.contains('bare'),
   '| metin hala DOM"da:', !!hero.textContent);
 if(!wrap.classList.contains('bare'))problems.push('bare sinifi yok');
 const sec=sr().querySelector('.stage3d').closest('.sec');
 const secW=parseFloat(sec.style.width);
 const ml=sec.style.marginLeft;
 console.log(' ev bolumu eni   :', secW+'px  ('+ml+')');
 const colW=Math.min(1160,HOST)-56;
 console.log(' sayfa sutunu    :', colW+'px  -> kazanc: +'+Math.round(secW-colW)+'px');
 if(secW>1760)problems.push('ust sinir asildi: '+secW);
 // does it overflow the panel?
 const half=-parseFloat(ml.match(/-\s*([\d.]+)px/)[1]);   // calc(50% - Xpx)
 const left=(colW/2)+half;
 const colLeft=(HOST-Math.min(1160,HOST))/2+28;
 console.log(' sol kenar       :', Math.round(colLeft+left)+'px  sag kenar:', Math.round(colLeft+left+secW)+'px  (panel '+HOST+'px)');
 if(colLeft+left<0)problems.push('sol tasma');
 if(colLeft+left+secW>HOST+1)problems.push('sag tasma: '+(colLeft+left+secW));
 console.log(' olcek           :', panel._fitScale.toFixed(3));
 if(panel._fitScale>1.601)problems.push('olcek tavani asildi');
 const st=sr().querySelector('.stage3d');
 const hpx=parseFloat(st.style.height);
 // The box is sized for the steepest angle, so it may run past the fold; what
 // must stay on screen is the view the house is actually left at.
 console.log(' kutu yuksekligi :', hpx+'px  (ekranin %'+Math.round(hpx/H*100)+"'i)");
 const rad=d=>d*Math.PI/180;
 const iso=sr().querySelector('.iso');
 const pw=parseFloat(iso.style.width), ph=parseFloat(iso.style.height);
 const atDefault=(pw*Math.sin(rad(42))+ph*Math.cos(rad(42)))*Math.cos(rad(56))*panel._fitScale;
 console.log(' acilis goruntusu:', Math.round(atDefault)+'px  (ekranin %'+Math.round(atDefault/H*100)+"'i)");
 if(hpx>H*1.15+30)problems.push('kutu tavani asildi: '+hpx);   // +24 dolgu payi
 if(atDefault>H*0.92)problems.push('acilis goruntusu ekrana sigmiyor: '+Math.round(atDefault));
 // other pages keep their hero
 panel._page='modes'; panel._render(); await wait(200);
 console.log(' Modlar sayfasi  : hero yine gizli =', sr().querySelector('.wrap').classList.contains('bare'));
 if(!sr().querySelector('.wrap').classList.contains('bare'))problems.push('modlar sayfasinda hero geri geldi');
 const heroH=sr().getElementById('heroH');
 console.log(' heroH bos       :', !(heroH.textContent||'').trim());
 if((heroH.textContent||'').trim())problems.push('hero metni hala yaziliyor: '+heroH.textContent);
 if(problems.length){console.log(' SORUN:');problems.forEach(x=>console.log('   x '+x));process.exit(1)}
 console.log(' -> GECTI');process.exit(0);
})().catch(e=>{console.log('threw:',e);process.exit(2)});
