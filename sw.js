const CACHE_NAME = 'milan-trip-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
     .then(cache => {
        console.log('Opened cache - Starting resilient caching');
        
        // **התיקון:** שימוש ב-Promise.all עם לולאת map, כך שכל קובץ יטופל בנפרד.
        return Promise.all(
          urlsToCache.map(url => {
            // עבור כל URL, נסה להוסיף אותו למטמון (cache.add)
            return cache.add(url).catch(error => {
              // אם קובץ נכשל בטעינה (למשל, 404), נרשום אזהרה...
              console.warn(`Failed to cache ${url}: ${error.message}`);
              //...אך נחזיר Promise.resolve() כדי שה-Promise.all לא ייכשל כולו.
              return Promise.resolve();
            });
          })
        );
      })
     .then(() => {
        // ודא שההתקנה מסתיימת בהצלחה לאחר ניסיונות ה-caching
        console.log('Service Worker installed successfully, ignoring failed assets.');
      })
     .catch(error => {
         // זה יתפוס כשלים חמורים יותר, אם קיימים
         console.error('Service Worker installation failed catastrophically:', error);
         throw error;
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
     .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});
