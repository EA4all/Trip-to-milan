const CACHE_NAME = 'milan-trip-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  // להוסיף כאן נתיבים לקבצי CSS או JS נוספים אם יהיו בעתיד
];

// התקנה - שמירת קבצים בסיסיים בזיכרון המטמון
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// בקשות רשת - הגשה מהמטמון קודם, ואז מהרשת
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // אם נמצא במטמון, החזר אותו
        if (response) {
          return response;
        }
        // אחרת, פנה לרשת
        return fetch(event.request);
      }
    )
  );
});
