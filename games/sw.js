// Hammerfall Games: offline support for the games site and Chess Coach.
// Network first (so updates show up right away), falling back to the saved copy when offline.
const CACHE='hammerfall-v13';
const PRECACHE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./auth.js','./firebase-config.js',
  './chess/','./chess/index.html','./chess/puzzles.js','./lib/qrcode.js','./lib/jsQR.js','./chess/manifest.webmanifest','./chess/icon-192.png','./chess/icon-512.png','./chess/preview.jpg'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(async keys=>{
      const old=keys.filter(k=>k!==CACHE);
      await Promise.all(old.map(k=>caches.delete(k)));
      await self.clients.claim();
      const cs=await self.clients.matchAll({type:'window'});
      // an update replaced an older version: reload open pages once so they run the new game
      if(old.length)cs.forEach(c=>{try{c.navigate(c.url);}catch(err){}});
      else cs.forEach(c=>c.postMessage('cached'));
    }));
});
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin)return;
  // only handle the games site itself; leave the rest of the domain (Forge, Ironclad) alone
  if(!url.pathname.startsWith(new URL('./',self.registration.scope).pathname))return;
  e.respondWith(
    fetch(req,{cache:'no-cache'}).then(res=>{
      if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));}
      return res;
    }).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||(req.mode==='navigate'?caches.match('./index.html'):Response.error())))
  );
});
