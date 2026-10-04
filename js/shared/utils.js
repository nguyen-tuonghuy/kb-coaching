/* Shared pure utilities. Keep legacy parsing semantics; no DOM or network effects. */
(() => {
  const kc=window.KinballCoach ||= {};
  function escapeHtml(v){
    return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function matchYoutubeId(raw){
    const value=(raw||'').trim();
    if(/^[\w-]{11}$/.test(value))return value;
    try{
      const u=new URL(value);
      if(u.hostname==='youtu.be')return u.pathname.split('/').filter(Boolean)[0]||'';
      if(u.searchParams.get('v'))return u.searchParams.get('v');
      const parts=u.pathname.split('/').filter(Boolean);
      const i=parts.findIndex(x=>['embed','shorts','live'].includes(x));
      return i>=0?parts[i+1]||'':'';
    }catch{return ''}
  }
  function parseMatchVideoTime(value){
    const raw=String(value||'').trim();
    if(!raw)return 0;
    const parts=raw.split(':').map(x=>Number(x));
    if(parts.some(x=>!Number.isFinite(x)||x<0))return 0;
    if(parts.length===3)return parts[0]*3600+parts[1]*60+parts[2];
    if(parts.length===2)return parts[0]*60+parts[1];
    if(parts.length===1)return parts[0];
    return 0;
  }
  function formatMatchVideoTime(seconds){
    const n=Math.max(0,Number(seconds)||0),s=Math.floor(n),m=Math.floor(s/60),h=Math.floor(m/60);
    const mm=h?String(m%60).padStart(2,'0'):String(m),ss=String(s%60).padStart(2,'0');
    return h?`${h}:${mm}:${ss}`:`${mm}:${ss}`;
  }
  kc.utils=Object.freeze({escapeHtml,escapeAttr:escapeHtml,matchYoutubeId,parseMatchVideoTime,formatMatchVideoTime});
})();
