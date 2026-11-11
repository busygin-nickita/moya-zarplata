const CACHE = 'salary-pwa-v49-journal-order-types';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install', event => {
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
 const req=event.request, url=new URL(req.url);
 if(url.origin!==location.origin||req.method!=='GET')return;
 const shell=['/','/index.html','/styles.css','/app.js','/config.js'].some(p=>url.pathname.endsWith(p));
 if(shell){
  event.respondWith(fetch(req,{cache:'no-store'}).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));return res;}).catch(()=>caches.match(req).then(c=>c||caches.match('./index.html'))));
 }else{
  event.respondWith(caches.match(req).then(c=>c||fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));return res;})));
 }
});
