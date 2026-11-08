const CACHE='salary-pwa-v3-connected-dark-orange';
const ASSETS=['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin===location.origin && e.request.method==='GET'){
    e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{
      const copy=r.clone(); caches.open(CACHE).then(cache=>cache.put(e.request,copy)); return r;
    }).catch(()=>caches.match('./index.html'))));
  }
});
