// Version 1.0 - Logic with extensive logging
// PART 1 OF 3: Imports, Utils, Global State, and Data definitions.
console.log('app.js script started');

// --- Firebase SDK ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove, getDoc, enableIndexedDbPersistence, collection, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- UTILS ---
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));

function toRad(x) {
    // This function is called frequently, so logging is commented out to avoid clutter.
    // console.log(`Log: toRad called with: ${x}`);
    return x * Math.PI / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
    console.log(`Log: haversineKm called for coordinates: (${lat1},${lon1}) to (${lat2},${lon2})`);
    if ([lat1, lon1, lat2, lon2].some(c => c === undefined || c === null)) {
        console.warn('Log: haversineKm returned NaN due to invalid coordinates.');
        return NaN;
    }
    const R = 6371; // Radius of earth in kilometers
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    console.log(`Log: haversineKm calculated distance: ${distance.toFixed(2)} km`);
    return distance;
}


function formatKm(km) { return isNaN(km) ? '' : `(${km.toFixed(1)} ק״מ)`; }

function minsForMode(km, mode) {
    // console.log(`Log: minsForMode called with km=${km}, mode=${mode}`);
    if (isNaN(km)) return 15;
    if (mode === 'walk') { const speed = 4.5; return Math.max(8, (km / speed) * 60); }
    if (mode === 'drive') { const speed = 25; return Math.max(10, (km / speed) * 60); }
    if (mode === 'transit') { const speed = 18; return Math.max(12, (km / speed) * 60 + 5); }
    return 15;
}

function formatMin(min) {
    min = Math.round(min);
    if (min < 60) return `${min} דק׳`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h} ש׳ ${m} ד׳`;
}

const fmtBold = (t) => (t || '').replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-brand-700 dark:text-brand-300">$1</strong>');
const placeholderLogoUrl = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=80&rounded=true&background=e0e7ff&color=1e40af`;

// --- Global State ---
let db, auth, tripDocRef, locationsColRef;
let localTripData = {};
let budgetChartInstance = null;
let cameraStream = null;
let eurToIlsRate = 4.0; // Default rate
let userCoords = null;
let isFirebaseConnected = false;
let translationHistory = [];
let lastWeatherAPIData = null;
let liveMap;
let userMarkers = {};
let watchingLocation = false;
let watchId = null;
let currentUserId = null;

console.log('Log: Global state variables initialized.');

// --- DATA (Attractions, Kosher, etc.) ---
const attractions = {
  duomo: { name: "קתדרלת הדואומו", type: 'attraction', address: "Piazza del Duomo, 20122 Milano MI, Italy", img: ["https://www.metailimbaolam.com/wp-content/uploads/2020/08/italy-4695974_1280.jpg"], tickets: "https://www.duomomilano.it/en/buy-tickets/", description: "הלב הפועם של מילאנו. חובה לעלות לגג לתצפית פנורמית מרהיבה על העיר.", coords: { lat: 45.4642, lon: 9.1916 }, cost: 20, hours: "כל יום, 09:00-19:00" },
  sanSiro: { name: "אצטדיון סן סירו", type: 'attraction', address: "Piazzale Angelo Moratti, 20151 Milano MI, Italy", img: ["https://www.xn--4dbkkmip.co.il/wp-content/uploads/2023/05/san-siro-1940307_640.jpg"], tickets: "https://www.sansirostadium.com/en/stadium-tour-museum/", description: "מקדש הכדורגל של מילאנו, ביתן של מילאן ואינטר. מומלץ לסיור או למשחק.", coords: { lat: 45.4780, lon: 9.1238 }, cost: 30, hours: "כל יום, 09:30-19:00 (משתנה בימי משחק)" },
  primark: { name: "פריימארק (ויה טורינו)", type: 'attraction', address: "Via Torino, 45, 20123 Milano MI, Italy", img: ["https://www.shutterstock.com/image-photo/bordeaux-france-07-17-2024-260nw-2490117199.jpg"], info: "https://www.primark.com/it/it/negozi/milano/via-torino-45", description: "סניף הדגל הענק של רשת האופנה הזולה, גן עדן לחובבי קניות.", coords: { lat: 45.4623, lon: 9.1861 }, cost: 0, hours: "כל יום, 09:00-22:00" },
  como: { name: "אגם קומו", type: 'attraction', address: "Varenna, Italy", img: ["https://www.travelonatimebudget.co.uk/wp-content/uploads/2022/01/varenna-dp.jpg"], description: "יום טיול לאחד האגמים היפים באיטליה. מומלץ לבקר בעיירות וארנה ובלאג'יו.", coords: { lat: 45.9863, lon: 9.2816 }, cost: 15 },
  berninaExpress: { name: "רכבת ברנינה לאלפים", type: 'attraction', address: "Tirano, Italy", img: ["https://www.civitatis.com/f/italia/milan/excursion-alpes-suizos-589x392.jpg"], tickets: "https://www.rhb.ch/en/panoramic-trains/bernina-express", description: "נסיעת רכבת פנורמית מדהימה דרך הרי האלפים לשוויץ.", coords: { lat: 46.4914, lon: 9.8683 }, cost: 70 },
  laScala: { name: "תיאטרון לה סקאלה", type: 'attraction', address: "Via Filodrammatici, 2, 20121 Milano MI, Italy", img: ["https://www.hakolal.co.il/wp-content/uploads/2018/10/La-Scala.jpg"], tickets: "https://www.teatroallascala.org/en/visit-the-theatre/visits-to-the-theatre-museum.html", description: "אחד מבתי האופרה המפורסמים והיוקרתיים בעולם.", coords: { lat: 45.4675, lon: 9.1895 }, cost: 12, hours: "מוזיאון: כל יום, 09:30-17:30" },
  navigli: { name: "רובע נבילי", type: 'attraction', address: "Ripa di Porta Ticinese, 20143 Milano MI, Italy", description: "רובע התעלות המקסים של מילאנו, מושלם לשעות הערב ולאפרטיבו.", coords: { lat: 45.4516, lon: 9.1758 }, cost: 0 },
  ilCentro: { name: "קניון Il Centro", type: 'attraction', address: "Via Giuseppe Eugenio Luraghi, 11, 20044 Arese MI, Italy", img: ["https://architizer-prod.imgix.net/media/1461230538313IL_CENTRO_WEB_RESOLUTION_231.JPG"], info: "https://centroilcentro.it/en/", description: "אחד הקניונים הגדולים באירופה, נמצא מחוץ למילאנו.", coords: { lat: 45.5654, lon: 9.0681 }, cost: 5, hours: "כל יום, 09:00-22:00" },
  sforza: { name: "טירת ספורצה", type: 'attraction', address: "Piazza Castello, 20121 Milano MI, Italy", description: "מצודה היסטורית מרשימה עם מספר מוזיאונים וגלריות אמנות.", info: "https://www.milanocastello.it/en", coords: { lat: 45.4705, lon: 9.1794 }, cost: 5, hours: "חצרות: 07:00-19:30. מוזיאונים: ג'-א', 10:00-17:30 (סגור בב')" },
  brera: { name: "רובע בררה", type: 'attraction', address: "Via Brera, Milan", description: "רובע האמנים הציורי, 'המונמרטר של מילאנו', מלא בסמטאות, גלריות ובוטיקים.", coords: { lat: 45.4719, lon: 9.1879 }, cost: 0 },
  lastSupper: { name: "הסעודה האחרונה", type: 'attraction', address: "Piazza di Santa Maria delle Grazie, 2, 20123 Milano MI", description: "ציור הקיר המפורסם של דה וינצ'י. חובה להזמין כרטיסים חודשים מראש!", tickets: "https://cenacolovinciano.org/en/", coords: { lat: 45.4659, lon: 9.1711 }, cost: 15, hours: "ג'-א', 08:15-19:00 (סגור בב')" },
  galleriaVittorio: { name: "גלריית ויטוריו אמנואלה", type: 'attraction', address: "Piazza del Duomo, 20123 Milano MI", description: "מרכז קניות היסטורי ומפואר, עם חנויות יוקרה, בתי קפה ומסעדות.", coords: { lat: 45.4656, lon: 9.1905 }, cost: 0, hours: "פתוח 24/7 (חנויות בשעות משתנות)" },
  pinacotecaBrera: { name: "פינקוטקה די בררה", type: 'attraction', address: "Via Brera, 28, 20121 Milano MI", description: "אחד מגלריות האמנות החשובות באיטליה, מתמקד בציור איטלקי.", tickets: "https://pinacotecabrera.org/en/visit/", coords: { lat: 45.4719, lon: 9.1879 }, cost: 15, hours: "ג'-א', 08:30-19:15 (סגור בב')" },
  parcoSempione: { name: "פארק סמפיונה", type: 'attraction', address: "Piazza Sempione, 20154 Milano MI", description: "הריאה הירוקה הגדולה של מילאנו, מאחורי טירת ספורצה. מושלם להירגעות.", coords: { lat: 45.4723, lon: 9.1725 }, cost: 0, hours: "כל יום, 06:30-21:00" },
  quadrilateroDellaModa: { name: "מרובע האופנה", type: 'attraction', address: "Via Monte Napoleone, 20121 Milano MI, Italy", description: "רובע הקניות היוקרתי של מילאנו, בית למותגי האופנה הגדולים בעולם.", coords: { lat: 45.4688, lon: 9.1950 }, cost: 0 },
  daVinciMuseum: { name: "מוזיאון המדע דה וינצ'י", type: 'attraction', address: "Via San Vittore, 21, 20123 Milano MI, Italy", description: "מוזיאון המדע והטכנולוגיה הגדול באיטליה, מוקדש לדה וינצ'י כממציא.", tickets: "https://www.museoscienza.org/en/visit/tickets", coords: { lat: 45.4627, lon: 9.1715 }, cost: 10, hours: "ג'-ו' 09:30-17:00, ש'-א' 09:30-18:30 (סגור בב')" },
  boscoVerticale: { name: "בוסקו ורטיקלה", type: 'attraction', address: "Via Gaetano de Castillia, 11, 20124 Milano MI", description: "צמד מגדלי מגורים חדשניים המכוסים באלפי עצים וצמחים. פלא ארכיטקטוני.", coords: { lat: 45.4855, lon: 9.1901 }, cost: 0 },
  cimiteroMonumentale: { name: "בית הקברות המונומנטלי", type: 'attraction', address: "Piazzale Cimitero Monumentale, 20154 Milano MI", description: "בית קברות שהוא גם מוזיאון פתוח, עם פסלים ומבנים ארכיטקטוניים מרשימים.", coords: { lat: 45.485, lon: 9.178 }, cost: 0, hours: "ג'-א' 08:00-18:00 (סגור בב')" },
  museoNovecento: { name: "מוזיאון נובצ'נטו", type: 'attraction', address: "Piazza del Duomo, 8, 20123 Milano MI", description: "מוזיאון לאמנות המאה ה-20 הממוקם בכיכר הדואומו, עם תצפית יפה על הקתדרלה.", tickets: "https://www.museodelnovecento.org/en/ biglietti-e-ingressi", coords: { lat: 45.463, lon: 9.190 }, cost: 10, hours: "ג'-א' 10:00-19:30 (סגור בב')" },
  santAmbrogio: { name: "בזיליקת סנט'אמברוג'ו", type: 'attraction', address: "Piazza Sant'Ambrogio, 15, 20123 Milano MI", description: "אחת הכנסיות העתיקות והחשובות במילאנו, דוגמה מרהיבה לאדריכלות רומנסקית.", coords: { lat: 45.462, lon: 9.173 }, cost: 0 },
  sanMaurizio: { name: "כנסיית סן מאוריציו", type: 'attraction', address: "Corso Magenta, 15, 20123 Milano MI", description: "מכונה 'הקפלה הסיסטינית של מילאנו' בזכות ציורי הקיר המדהימים שמכסים אותה לחלוטין.", tickets: "https://www.museoarcheologicomilano.it/en/collezioni/san-maurizio-al-monastero-maggiore", coords: { lat: 45.465, lon: 9.176 }, cost: 0, hours: "ג'-א' 10:00-17:30 (סגור בב')" },
  piazzaMercanti: { name: "פיאצה דיי מרקנטי", type: 'attraction', address: "Piazza dei Mercanti, 20123 Milano MI", description: "כיכר ימי-ביניימית קסומה ונסתרת, דקות הליכה מהדואומו.", coords: { lat: 45.465, lon: 9.188 }, cost: 0 },
  leonardoVineyard: { name: "הכרם של לאונרדו", type: 'attraction', address: "Corso Magenta, 65, 20123 Milano MI", description: "שחזור של הכרם שהיה שייך ללאונרדו דה וינצ'י, מול 'הסעודה האחרונה'.", tickets: "https://www.vignadileonardo.com/en/", coords: { lat: 45.466, lon: 9.170 }, cost: 10, hours: "ג'-א' 09:00-18:00 (סגור בב')" },
  piazzaGaeAulenti: { name: "פיאצה גאה אאולנטי", type: 'attraction', address: "Piazza Gae Aulenti, 20124 Milano MI", description: "הלב הפועם של מילאנו המודרנית. כיכר עתידנית מוקפת גורדי שחקים.", coords: { lat: 45.483, lon: 9.191 }, cost: 0 },
  corsoComo: { name: "10 קורסו קומו", type: 'attraction', address: "Corso Como, 10, 20154 Milano MI", description: "מתחם קונספט המשלב אופנה, עיצוב ואמנות. חווית קניות ובילוי ייחודית.", coords: { lat: 45.482, lon: 9.189 }, cost: 0 },
  triennale: { name: "מוזיאון העיצוב טריאנלה", type: 'attraction', address: "Viale Emilio Alemagna, 6, 20121 Milano MI", description: "מוזיאון בינלאומי המוקדש לעיצוב, אדריכלות ואמנות חזותית בפארק סמפיונה.", tickets: "https://triennale.org/en/tickets", coords: { lat: 45.470, lon: 9.168 }, cost: 15, hours: "ג'-א' 11:00-20:00 (סגור בב')" },
  colonneSanLorenzo: { name: "עמודי סן לורנצו", type: 'attraction', address: "Corso di Porta Ticinese, 39, 20123 Milano MI", description: "שרידים רומיים עתיקים שהפכו למקום מפגש פופולרי ותוסס בערב.", coords: { lat: 45.458, lon: 9.181 }, cost: 0 },
  qcTermemilano: { name: "QC Termemilano", type: 'attraction', address: "Piazzale Medaglie D'Oro, 2, 20135 Milano MI", tickets: "https://www.qcterme.com/en/milano/qc-termemilano", description: "ספא ומרחצאות יוקרתיים בלב העיר, חוויה מושלמת של פינוק ורגיעה.", coords: { lat: 45.4523, lon: 9.2004 }, cost: 60, hours: "כל יום, 09:00-23:00" },
  interStore: { name: "חנות הדגל של אינטר", type: 'attraction', address: "Galleria Passarella, 2, 20122 Milano MI", info: "https://store.inter.it/", description: "חנות הדגל הרשמית של קבוצת הכדורגל אינטר מילאנו, בלב אזור הקניות.", coords: { lat: 45.465, lon: 9.194 }, cost: 0, hours: "כל יום 10:00-19:30" },
  casaMilan: { name: "קאזה מילאן (מוזיאון וחנות)", type: 'attraction', address: "Via Aldo Rossi, 8, 20149 Milano MI", tickets: "https://www.acmilan.com/en/club/casa-milan", description: "המטה הראשי של קבוצת מילאן, כולל מוזיאון מונדו מילאן, חנות רשמית ומסעדה.", coords: { lat: 45.489, lon: 9.155 }, cost: 15, hours: "כל יום 10:00-19:00" },
  torreBranca: { name: "מגדל בראנקה", type: 'attraction', address: "Viale Luigi Camoens, 2, 20121 Milano MI", info: "http://www.museobranca.it/torre-branca-parco-sempione-milano/", description: "מגדל תצפית בפארק סמפיונה המציע נוף פנורמי מרהיב של מילאנו.", coords: { lat: 45.472, lon: 9.171 }, cost: 6, hours: "משתנה לפי עונה, בדקו באתר" },
  pinacotecaAmbrosiana: { name: "פינקוטקה אמברוזיאנה", type: 'attraction', address: "Piazza Pio XI, 2, 20123 Milano MI", tickets: "https://www.ambrosiana.it/", description: "גלריית אמנות וספרייה היסטורית המכילה יצירות מופת של קאראווג'ו ודה וינצ'י.", coords: { lat: 45.464, lon: 9.186 }, cost: 15, hours: "ג'-א' 10:00-18:00 (סגור בב')" }
};
const kosherData = {
  restaurants: [
    { name: "Denzel", type: 'dining', style: "בשרי", logo: "https://static.wixstatic.com/media/c6595a_0d9d7bb6473548d69681f09d18ff4247.png", address: "Via Giorgio Washington, 9, 20146 Milano MI", phone: "+390248519326", website: "https://www.denzel.it/", hours: "א'-ה' 12:00-15:00, 19:00-23:00; ו' 12:00-15:00", coords: { lat: 45.4654, lon: 9.1555 } },
    { name: "Ba'Ghetto", type: 'dining', style: "בשרי", address: "Via Sardegna, 45, 20146 Milano MI", phone: "+39024694643", website: "https://www.baghetto.com/en/", hours: "א'-ה' 12:00-15:00, 19:00-23:00; ו' 12:00-15:00", coords: { lat: 45.4665, lon: 9.1461 } },
    { name: "Re Salomone", type: 'dining', style: "בשרי", address: "Via Sardegna, 42, 20146 Milano MI", phone: "+39024694643", website: "https://www.resalomone.it/", hours: "א'-ה' 12:00-14:30, 19:00-23:00; ו' 12:00-14:30", coords: { lat: 45.4665, lon: 9.1458 } },
    { name: "La's Kebab", type: 'dining', style: "בשרי", address: "Viale Misurata, 19, 20146 Milano MI", phone: "+393288865576", website: "https://laskebab.eatbu.com/", hours: "א'-ה' 12:00-15:00, 18:00-23:00", coords: { lat: 45.4586, lon: 9.1517 } },
    { name: "Carmel", type: 'dining', style: "חלבי", address: "Viale S. Gimignano, 10, 20146 Milano MI", phone: "+3902416368", website: "https://carmelkosher.it/", hours: "א'-ה' 12:00-15:00, 19:00-22:30", coords: { lat: 45.4593, lon: 9.1328 } },
    { name: "MyKafe", type: 'dining', style: "חלבי", logo: "https://dynamic-media-cdn.tripadvisor.com/media/photo-o/11/a2/1f/a2/my-kafe.jpg", address: "Via Luigi Soderini, 44, 20146 Milano MI", phone: "+390238232748", website: "https://www.instagram.com/mykafe2020/", hours: "א'-ה' 07:30-19:30; ו' 07:30-16:00", coords: { lat: 45.4578, lon: 9.1337 } },
    { name: "Bet-El", type: 'dining', style: "חלבי", address: "Viale S. Gimignano, 2, 20146 Milano MI", phone: "+39024151336", website: "http://www.betelkosher.com/", hours: "א'-ה' 12:00-14:30, 19:00-22:30", coords: { lat: 45.4607, lon: 9.1352 } },
    { name: "Snubar", type: 'dining', style: "פלאפל/שווארמה", logo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQmYC-lcBrFV75_D371aWkrfk7yd1Qu3kEIcw&s", address: "Via Leone Tolstoi, 2, 20146 Milano MI", phone: "+39024236963", website: "https://www.snubar.it/it/", hours: "א'-ה' 12:00-22:00", coords: { lat: 45.4568, lon: 9.1565 } },
    { name: "Presto", type: 'dining', style: "טייק-אווי", address: "Via delle Forze Armate, 13, 20147 Milano MI", phone: "+39024045598", website: "https://www.presto-kosher.com/", hours: "א'-ה' 10:00-20:00; ו' 09:00-15:00", coords: { lat: 45.4667, lon: 9.1292 } },
  ],
  markets: [
    { name: "Kosher Paradise", type: 'dining', style: "מרכול", address: "Viale S. Gimignano, 13, 20146 Milano MI", phone: "+39024122855", website: "https://www.kosherparadise.it/", hours: "א'-ה' 09:00-19:30; ו' 09:00-15:00", coords: { lat: 45.4589, lon: 9.1325 } },
    { name: "Denzel's Sweet Bakery", type: 'dining', style: "מאפייה", logo: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSVt6hxH7niOmeBunCjNdpow7Y_PfseIBonPQ&s", address: "Via Soderini, 55, 20146 Milano MI", phone: "+39024125166", website: "https://www.denzel.it/bakery", hours: "א'-ה' 07:30-19:30; ו' 07:30-15:00", coords: { lat: 45.4570, lon: 9.1329 } },
    { name: "Kosher King", type: 'dining', style: "מרכול", address: "Piazza Napoli, 15, 20146 Milano MI", phone: "+390242296773", website: "https://www.facebook.com/kosherkingmilan/", hours: "א'-ה' 08:30-19:30; ו' 08:30-16:00", coords: { lat: 45.4563, lon: 9.1492 } },
  ]
};
const dailyTips = [
  "זכרו לתקף את כרטיס התחבורה הציבורית שלכם במכונות הצהובות לפני כל נסיעה במטרו, אוטובוס או טראם כדי למנוע קנסות.",
  "אפרטיבו (Aperitivo) הוא מנהג איטלקי פופולרי. בין 18:00 ל-21:00, שלמו על משקה וקבלו גישה חופשית למזנון אכול כפי יכולתך. רובע נבילי הוא מקום מעולה לחוות זאת.",
  "'Coperto' הוא חיוב שירות קבוע שרוב המסעדות מוסיפות לחשבון. זה לא טיפ, אלא תשלום על השירות והלחם. טיפ נוסף אינו חובה אך מוערך.",
  "הרבה מוזיאונים וכנסיות דורשים לבוש צנוע (כתפיים וברכיים מכוסות). כדאי להחזיק צעיף קל בתיק למקרה הצורך.",
  "מים מהברז במילאנו בטוחים וטובים לשתייה. חפשו ברזיות ציבוריות (fontanelle) כדי למלא את בקבוק המים שלכם ולחסוך כסף.",
  "אם אתם מתכננים לראות את 'הסעודה האחרונה' של דה וינצ'י, חובה להזמין כרטיסים באינטרנט מספר חודשים מראש. הכניסה מוגבלת מאוד."
];
const tripMeta = {
    flights: {
        inbound: { date: '2025-11-23', flight: 'LY381', departureTime: '07:30', arrivalTime: '11:15', terminal: '3', baggage: 'טרולי עד 8 ק"ג' },
        outbound: { date: '2025-11-26', flight: 'LY382', departureTime: '18:00', arrivalTime: '22:15', terminal: '1 (MXP)', baggage: 'מזוודה 23 ק"ג + טרולי 8 ק"ג' }
    },
    hotel: {
        name: 'Hotel Glam Milano', phone: '+39 02 839 840', tel: 'tel:+3902839840', address: 'Piazza Duca d\'Aosta, 4/6, 20124 Milano MI'
    },
    contacts: {
        emergency: { name: 'חירום (כללי)', phone: '112', tel: 'tel:112' },
        embassy: { name: 'שגרירות ישראל', phone: '+39 06 3619 8500', tel: 'tel:+390636198500' }
    }
};
let currentLang = 'he-it';

console.log('Log: Constant data (attractions, kosher, etc.) loaded.');

function getInitialTripData() {
    console.log('Log: getInitialTripData called to generate default trip structure.');
    const initialPlanKeys = ['duomo', 'primark', 'sanSiro', 'como', 'berninaExpress', 'laScala', 'navigli', 'ilCentro'];
    return {
        plan: {
            day1: { name: "יום 1: דואומו ודרבי", transport: 'walk', activities: [
                { id: 'duomo_1', time: "בוקר", ...attractions.duomo },
                { id: 'primark_1', time: "צהריים", ...attractions.primark },
                { id: 'sanSiro_1', time: "ערב", ...attractions.sanSiro }
            ]},
            day2: { name: "יום 2: אגמים ונבילי", transport: 'transit', activities: [
                { id: 'como_1', time: "יום שלם", ...attractions.como },
                { id: 'navigli_1', time: "ערב", ...attractions.navigli },
            ]},
            day3: { name: "יום 3: האלפים השוויצריים", transport: 'drive', activities: [
                { id: 'berninaExpress_1', time: "יום שלם", ...attractions.berninaExpress },
            ]},
            day4: { name: "יום 4: תרבות וקניות", transport: 'transit', activities: [
                { id: 'laScala_1', time: "בוקר", ...attractions.laScala },
                { id: 'ilCentro_1', time: "צהריים", ...attractions.ilCentro }
            ]}
        },
        suggestions: Object.entries(attractions)
            .filter(([key]) => !initialPlanKeys.includes(key))
            .map(([key, value]) => ({...value, id: key})),
        checklist: [
            { id: 'cat1', category: 'מסמכים', items: [{ id: 'c1', text: 'דרכון', done: true }, { id: 'c2', text: 'כרטיסי טיסה', done: false }] },
            { id: 'cat2', category: 'ביגוד', items: [{ id: 'c3', text: 'מעיל גשם', done: false }] },
            { id: 'cat3', category: 'אלקטרוניקה', items: [{ id: 'c4', text: 'מטען נייד', done: true }, { id: 'c5', text: 'מתאם לחשמל', done: false }] }
        ],
        totalBudget: 1500, expenses: [], documents: [], gallery: [], journal: {},
        theme: 'dark',
        settings: { includeEstimatedCostsInBalance: true }
    };
}
// END OF PART 1
// Version 1.0 - Logic with extensive logging
// PART 2 OF 3: Modal logic and all Rendering functions.

// --- MODAL & ALERT LOGIC ---
let activityToModify = null;
const modal = $('#add-to-day-modal');

async function openAddToDayModal(activityId, type = 'suggestion') {
    console.log(`Log: openAddToDayModal called for activityId=${activityId}, type=${type}`);
    if (type === 'suggestion') {
        activityToModify = localTripData.suggestions.find(s => s.id === activityId);
    } else {
        const allKosher = [...kosherData.restaurants, ...kosherData.markets];
        activityToModify = allKosher.find(k => k.name === activityId);
        if(activityToModify) activityToModify.id = activityId; // Ensure it has an id
    }
    
    if (!activityToModify) {
        console.error(`Log: Activity to modify not found for id: ${activityId}`);
        return;
    }

    const opts = $('#modal-day-options');
    opts.innerHTML = Object.entries(localTripData.plan).sort((a,b) => a[0].localeCompare(b[0])).map(([dayId, dayData]) => 
        `<button class="btn btn-primary" data-day-id="${dayId}" data-activity-type="${type}">${dayData.name}</button>`
    ).join('');
    modal.classList.add('flex');
    console.log('Log: Add-to-day modal is now open.');
};

window.closeModal = () => {
    console.log('Log: closeModal called.');
    $$('.modal-backdrop').forEach(m => m.classList.remove('flex'));
};

async function addActivityToDay(dayId, type) {
    console.log(`Log: addActivityToDay called for dayId=${dayId}, type=${type}`);
    const day = localTripData.plan[dayId];
    if (day && activityToModify) {
        const newActivity = { ...activityToModify, time: "זמן גמיש", id: (activityToModify.id || activityToModify.name) + '_' + Date.now() };
        
        // Using a temporary state for UI responsiveness before Firestore update
        day.activities.push(newActivity);
        if (type === 'suggestion') {
            localTripData.suggestions = localTripData.suggestions.filter(s => s.id !== activityToModify.id);
        }
        renderAllPlans(localTripData.plan);
        renderSuggestions(localTripData.suggestions);
        
        console.log('Log: Updating Firestore with new activity and suggestions.');
        try {
            await updateDoc(tripDocRef, {
                plan: localTripData.plan,
                suggestions: localTripData.suggestions
            });
            console.log('Log: Firestore updated successfully for addActivityToDay.');
        } catch (error) {
            console.error('Log: Firestore update failed for addActivityToDay:', error);
            showAlert('שגיאת סנכרון', 'לא ניתן היה לשמור את הפעילות. אנא נסה שוב.');
            // Here you might want to revert the local state change
        }
    }
    closeModal();
};

window.openAddToDayModal = openAddToDayModal;

function showAlert(title, message, isCopyable = false) {
    console.log(`Log: showAlert called with title: "${title}" and message: "${message.substring(0, 50)}..."`);
    $('#alert-modal-title').textContent = title;
    $('#alert-modal-body').textContent = message;
    
    const copyBtn = $('#alert-modal-copy-btn');
    copyBtn.classList.toggle('hidden', !isCopyable);

    $('#alert-modal').classList.add('flex');
}
    
function openTipModal() {
    console.log('Log: openTipModal called.');
    const tip = dailyTips[Math.floor(Math.random() * dailyTips.length)];
    $('#daily-tip-body').textContent = tip;
    $('#daily-tip-modal').classList.add('flex');
}

function showDailyTip() {
    console.log('Log: showDailyTip called.');
    const lastTipDate = localStorage.getItem('lastTipDate');
    const today = new Date().toISOString().slice(0, 10);

    if (lastTipDate !== today) {
        console.log('Log: Showing daily tip for the first time today.');
        openTipModal();
        localStorage.setItem('lastTipDate', today);
    } else {
        console.log('Log: Daily tip already shown today.');
    }
}

// --- RENDER FUNCTIONS ---
function renderOverview() {
    console.log('Log: renderOverview started.');
    const { hotel, flights, contacts } = tripMeta;
    const countdownHtml = `<div class="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg text-center">
        <h3 class="font-bold text-lg mb-2">הזמן שנותר לטיול</h3>
        <div id="countdown" class="flex flex-row-reverse justify-around font-mono"></div>
    </div>`;
    const flightsHtml = `<div class="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg space-y-2 col-span-1 sm:col-span-2">
        <h3 class="font-bold text-lg"><i class="fa-solid fa-plane-departure mr-2"></i>פרטי טיסות</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><b class="font-semibold">הלוך:</b> ${flights.inbound.date} | ${flights.inbound.flight}</div>
            <div><b>המראה:</b> ${flights.inbound.departureTime} | <b>נחיתה:</b> ${flights.inbound.arrivalTime}</div>
            <div><b>טרמינל (נתב"ג):</b> ${flights.inbound.terminal}</div>
            <div><b>כבודה:</b> ${flights.inbound.baggage}</div>
            <hr class="md:col-span-2 my-1">
            <div><b class="font-semibold">חזור:</b> ${flights.outbound.date} | ${flights.outbound.flight}</div>
            <div><b>המראה:</b> ${flights.outbound.departureTime} | <b>נחיתה:</b> ${flights.outbound.arrivalTime}</div>
            <div><b>טרמינל (מילאנו):</b> ${flights.outbound.terminal}</div>
            <div><b>כבודה:</b> ${flights.outbound.baggage}</div>
        </div>
    </div>`;
    const hotelHtml = `<div class="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg space-y-2">
        <h3 class="font-bold text-lg"><i class="fa-solid fa-hotel mr-2"></i>מלון</h3>
        <p><b>${hotel.name}</b></p>
        <div class="flex gap-2"><a href="${hotel.tel}" class="btn btn-ghost"><i class="fa fa-phone"></i> חיוג</a><a href="https://maps.google.com/?q=${encodeURIComponent(hotel.address)}" target="_blank" class="btn btn-ghost"><i class="fa fa-map-location-dot"></i> ניווט</a></div>
    </div>`;
    const contactsHtml = `<div class="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg space-y-2">
        <h3 class="font-bold text-lg"><i class="fa-solid fa-address-book mr-2"></i>טלפונים חשובים</h3>
        <div class="flex gap-2"><a href="${contacts.emergency.tel}" class="btn btn-ghost">${contacts.emergency.name}</a><a href="${contacts.embassy.tel}" class="btn btn-ghost">${contacts.embassy.name}</a></div>
    </div>`;
    $('#overview-cards').innerHTML = countdownHtml + flightsHtml + hotelHtml + contactsHtml;
    startCountdown();
    console.log('Log: renderOverview finished.');
}

function startCountdown() {
    console.log('Log: startCountdown called.');
    const targetDate = new Date(`${tripMeta.flights.inbound.date}T00:00:00`).getTime();
    const countdownEl = $('#countdown');
    if (!countdownEl) {
        console.error('Log: Countdown element not found.');
        return;
    }
    
    const interval = setInterval(() => {
        const now = new Date().getTime();
        const distance = targetDate - now;

        if (distance < 0) {
            clearInterval(interval);
            countdownEl.innerHTML = "<div class='text-lg font-bold w-full'>הטיול התחיל! תהנו!</div>";
            // console.log('Log: Countdown finished.'); // Avoid logging every second
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        countdownEl.innerHTML = `
            <div><div class="countdown-number">${days}</div><div class="countdown-label">ימים</div></div>
            <div><div class="countdown-number">${hours}</div><div class="countdown-label">שעות</div></div>
            <div><div class="countdown-number">${minutes}</div><div class="countdown-label">דקות</div></div>
            <div><div class="countdown-number">${seconds}</div><div class="countdown-label">שניות</div></div>
        `;
    }, 1000);
}

function renderAllPlans(planData) {
    console.log('Log: renderAllPlans called.');
    if (!planData) {
        console.warn('Log: renderAllPlans called with no plan data.');
        return;
    }
    const nav = $('#day-tabs-nav'), content = $('#plan-content-container');
    const submenu = $('#plan-submenu-links');
    nav.innerHTML = ''; 
    content.innerHTML = ''; 
    submenu.innerHTML = '';
  
    Object.entries(planData).sort((a, b) => a[0].localeCompare(b[0])).forEach(([dayId, dayData], i) => {
        const active = i === 0;
        nav.innerHTML += `<button class="tab-button ${active ? 'tab-active' : ''}" data-content="${dayId}">${dayData.name}</button>`;
        content.innerHTML += `<div id="${dayId}" class="content-section ${active ? 'active' : ''}"></div>`;
        submenu.innerHTML += `<a href="#plan" data-day-id="${dayId}" class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700">${dayData.name.split(':')[0]}</a>`;
        renderPlanForDay(dayId, dayData);
    });
    submenu.innerHTML += `<a href="#suggestions" class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 col-span-3">הצעות</a>`;
}

function renderPlanForDay(dayId, dayData) {
    console.log(`Log: renderPlanForDay called for ${dayId}`);
    const container = $(`#${dayId}`);
    if (!container) {
        console.error(`Log: Container for dayId ${dayId} not found.`);
        return;
    }
    let content = `<div class="p-4"><div class="flex flex-wrap items-center gap-4 mb-4">
        <div class="flex items-center gap-2">
            <label class="font-semibold">מצב נסיעה:</label>
            <select class="day-transport-select p-2 rounded-lg border bg-white dark:bg-gray-800" data-day="${dayId}">
                <option value="walk" ${dayData.transport === 'walk' ? 'selected' : ''}>הליכה</option>
                <option value="drive" ${dayData.transport === 'drive' ? 'selected' : ''}>רכב/מונית</option>
                <option value="transit" ${dayData.transport === 'transit' ? 'selected' : ''}>תחב"צ</option>
            </select>
        </div>
        <button class="open-day-map-btn btn btn-primary" data-day-id="${dayId}"><i class="fa-solid fa-map-route mr-2"></i>מפת יום</button>
        <button class="optimize-day-route-btn btn btn-ghost" data-day-id="${dayId}"><i class="fa-solid fa-wand-magic-sparkles mr-2"></i>סדר לי את היום</button>
        <button class="generate-ics-btn btn btn-ghost" data-day-id="${dayId}"><i class="fa-solid fa-calendar-plus mr-2"></i>הוסף ליומן</button>
    </div><div class="space-y-4">`;

    let previousActivity = null; 
    dayData.activities.forEach((act, i) => {
        const dist = haversineKm(previousActivity?.coords?.lat, previousActivity?.coords?.lon, act.coords?.lat, act.coords?.lon);
        const time = minsForMode(dist, dayData.transport);
        if (i > 0 && previousActivity) {
            content += `<div class="flex items-center gap-2 text-sm text-gray-500 justify-center">
                <i class="fa-solid fa-arrow-down"></i> <span>${formatKm(dist)} / ${formatMin(time)}</span>
            </div>`;
        }
        content += renderActivityCard(dayId, act, i, dayData.activities.length, previousActivity);
        previousActivity = act;
    });
    
    content += `</div>${renderJournal(dayId, localTripData.journal ? localTripData.journal[dayId] : [])}</div>`;
    container.innerHTML = content;
}
    
function renderActivityCard(dayId, activity, index, total, previousActivity) {
    // console.log(`Log: renderActivityCard called for activity: ${activity.name}`);
    const isDining = activity.type === 'dining';
    const links = [];
    if (activity.tickets) links.push(`<a href="${activity.tickets}" target="_blank" class="btn btn-primary"><i class="fa-solid fa-ticket"></i> כרטיסים</a>`);
    if (activity.info) links.push(`<a href="${activity.info}" target="_blank" class="btn btn-ghost"><i class="fa-solid fa-circle-info"></i> מידע</a>`);
    if (activity.address) {
        links.push(`<a href="https://waze.com/ul?q=${encodeURIComponent(activity.address)}" target="_blank" class="btn btn-ghost" title="Waze"><i class="fa-brands fa-waze"></i></a>`);
        links.push(`<a href="https://maps.google.com/?q=${encodeURIComponent(activity.address)}" target="_blank" class="btn btn-ghost" title="Google Maps"><i class="fa-brands fa-google"></i></a>`);
    }
    if (previousActivity && previousActivity.address && activity.address) {
        const transitUrl = `https://maps.google.com/?saddr=${encodeURIComponent(previousActivity.address)}&daddr=${encodeURIComponent(activity.address)}&travelmode=transit`;
        links.push(`<a href="${transitUrl}" target="_blank" class="btn btn-ghost" title="ניווט בתחב״צ"><i class="fa-solid fa-route"></i></a>`);
    }
    if(!isDining && activity.coords) {
         links.push(`<button class="find-nearby-kosher-btn btn btn-ghost" data-lat="${activity.coords.lat}" data-lon="${activity.coords.lon}" data-name="${activity.name}"><i class="fa-solid fa-utensils"></i> מסעדות</button>`);
    }

    const imgHTML = activity.img ? `<div class="image-carousel" data-images='${JSON.stringify(activity.img)}' data-index="0">
        <img loading="lazy" src="${activity.img[0]}" alt="${activity.name}" class="thumb" onerror="this.style.display='none'">
        ${(activity.img.length || 0) > 1 ? `<button class="carousel-prev"><</button><button class="carousel-next">></button>` : ''}
    </div>` : '';
    
    const moveButtons = `
        <button class="move-activity-btn p-1 ${index === 0 ? 'opacity-25' : ''}" ${index === 0 ? 'disabled' : ''} data-day-id="${dayId}" data-activity-id="${activity.id}" data-direction="-1"><i class="fa-solid fa-arrow-up"></i></button>
        <button class="move-activity-btn p-1 ${index === total - 1 ? 'opacity-25' : ''}" ${index === total - 1 ? 'disabled' : ''} data-day-id="${dayId}" data-activity-id="${activity.id}" data-direction="1"><i class="fa-solid fa-arrow-down"></i></button>
    `;

    return `<details class="bg-gray-50 dark:bg-gray-900 rounded-xl shadow-md overflow-hidden relative" open>
      <summary class="cursor-pointer list-none flex items-center justify-between p-4">
        <h4 class="font-bold text-lg">${isDining ? '<i class="fa-solid fa-utensils mr-2"></i>' : ''}${activity.time ? activity.time + ' - ' : ''}${activity.name}</h4>
        <div class="text-gray-400 flex items-center gap-2">
            ${moveButtons}
            <i class="fa-solid fa-chevron-down transition-transform"></i>
        </div>
      </summary>
      <button class="remove-activity-btn absolute top-3 left-3 text-red-500 hover:text-red-700 p-1 z-10" data-day-id="${dayId}" data-activity-id="${activity.id}"><i class="fa-solid fa-trash"></i></button>
      <div class="flex flex-col md:flex-row border-t border-gray-100 dark:border-gray-800">
        ${imgHTML}
        <div class="p-4 md:p-5 flex-grow">
          <p class="text-gray-700 dark:text-gray-300">${fmtBold(activity.description)}</p>
          ${activity.hours ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-2"><i class="fa-solid fa-clock w-4 mr-1"></i> ${activity.hours}</p>` : ''}
          <div class="mt-4 flex flex-wrap items-center gap-2">${links.join('')}</div>
        </div>
      </div>
    </details>`;
}
    
function renderSuggestions(suggestions) {
    console.log(`Log: renderSuggestions called. Found ${suggestions ? suggestions.length : 0} suggestions.`);
    const container = $('#suggestions-table-container');
    if (!suggestions || suggestions.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500">כל הכבוד! כל הפעילויות שובצו בתוכנית.</div>`;
        return;
    }

    const tableRows = suggestions.map(s => `
        <tr class="border-b dark:border-gray-800">
            <td data-label="שם" class="p-3 font-medium">${s.name}</td>
            <td data-label="תיאור" class="p-3 text-sm text-gray-600 dark:text-gray-400">${s.description}</td>
            <td data-label="פעולות" class="p-3">
                <div class="flex flex-wrap gap-2 justify-end">
                    <button class="add-suggestion-btn btn btn-primary btn-sm" data-activity-id="${s.id}"><i class="fa-solid fa-plus"></i> הוסף</button>
                    <a href="https://maps.google.com/?q=${s.coords.lat},${s.coords.lon}" target="_blank" class="btn btn-ghost btn-sm"><i class="fa-solid fa-map-location-dot"></i> מפה</a>
                </div>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <table class="w-full text-sm responsive-table">
            <thead class="text-right bg-gray-50 dark:bg-gray-800">
                <tr>
                    <th class="p-3 font-semibold">שם</th>
                    <th class="p-3 font-semibold">תיאור</th>
                    <th class="p-3 font-semibold"></th>
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
    `;
}

function isCurrentlyOpen(hoursString) {
    if (!hoursString) return false;
    
    try {
        const now = new Date();
        const milanTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
        const currentDay = milanTime.getDay(); // Sunday = 0, Monday = 1...
        const currentTimeInMinutes = milanTime.getHours() * 60 + milanTime.getMinutes();
        
        const dayMapHe = {'א': 0, 'ב': 1, 'ג': 2, 'ד': 3, 'ה': 4, 'ו': 5, 'ש': 6};

        const dayEntries = hoursString.split(';').map(s => s.trim());
        for (const entry of dayEntries) {
            const firstSpaceIndex = entry.indexOf(' ');
            if (firstSpaceIndex === -1) continue;
            const daySpec = entry.substring(0, firstSpaceIndex).replace(/'/g, '');
            const timeSpec = entry.substring(firstSpaceIndex + 1);
            
            let applicableDays = [];
            if (daySpec.includes('-')) {
                const [startChar, endChar] = daySpec.split('-');
                const startDay = dayMapHe[startChar], endDay = dayMapHe[endChar];
                if (startDay !== undefined && endDay !== undefined) {
                    for (let i = startDay; i <= endDay; i++) applicableDays.push(i);
                }
            } else {
                applicableDays = daySpec.split(',').map(d => dayMapHe[d]).filter(d => d !== undefined);
            }
            
            if (!applicableDays.includes(currentDay)) continue;

            const timeRanges = timeSpec.split(',').map(r => r.trim());
            for (const range of timeRanges) {
                const [startStr, endStr] = range.split('-');
                if (!startStr || !endStr) continue;
                const [startH, startM] = startStr.split(':').map(Number);
                const [endH, endM] = endStr.split(':').map(Number);
                const startTotalMinutes = startH * 60 + (startM || 0);
                const endTotalMinutes = endH * 60 + (endM || 0);
                
                if (currentTimeInMinutes >= startTotalMinutes && currentTimeInMinutes < endTotalMinutes) {
                    return true;
                }
            }
        }
    } catch (e) {
        console.error("Error parsing hours string:", hoursString, e);
        return false;
    }
    return false;
}

function renderKosher(filter = 'all') {
    console.log(`Log: renderKosher called with filter: ${filter}`);
    let allKosher = [...kosherData.restaurants, ...kosherData.markets];
    
    if (userCoords) {
        allKosher.forEach(k => k.distance = haversineKm(userCoords.lat, userCoords.lon, k.coords.lat, k.coords.lon));
        allKosher.sort((a,b) => a.distance - b.distance);
    } else {
        allKosher.forEach(k => delete k.distance);
    }

    const filtered = allKosher.filter(r => {
        if (filter === 'open') return isCurrentlyOpen(r.hours);
        if (filter === 'all') return true;
        const style = r.style.toLowerCase();
        return style.includes(filter.toLowerCase());
    });

    const content = filtered.map(item => (item.style.includes('בשרי') || item.style.includes('חלבי') || item.style.includes('פלאפל') || item.style.includes('טייק-אווי') ? rowRestaurant(item) : rowMarket(item))).join('');
    $('#kosher-results').innerHTML = `<table class="min-w-full text-sm responsive-table"><tbody>${content || `<tr><td class="p-4 text-center">לא נמצאו תוצאות.</td></tr>`}</tbody></table>`;
}

function renderKosherFilters() {
    console.log('Log: renderKosherFilters called.');
    const filters = ['all', 'open', 'בשרי', 'חלבי', 'מאפייה', 'מרכול'];
    const filterLabels = {'all': 'הכל', 'open': 'פתוח עכשיו', 'בשרי': 'בשרי', 'חלבי': 'חלבי', 'מאפייה': 'מאפייה', 'מרכול': 'מרכול'};
    $('#kosher-filters').innerHTML = filters.map(f => `<button class="kosher-filter-btn btn btn-ghost" data-filter="${f}">${filterLabels[f]}</button>`).join('');
    $('.kosher-filter-btn[data-filter="all"]').classList.add('tab-active');
}

const rowRestaurant = r => {
    const logoSrc = r.logo || placeholderLogoUrl(r.name);
    return `
    <tr class="align-top border-b dark:border-gray-800">
        <td data-label="לוגו" class="p-3 logo-cell"><img class="logo" src="${logoSrc}" alt="${r.name}" onerror="this.onerror=null;this.src='${placeholderLogoUrl(r.name)}';"></td>
        <td data-label="שם" class="p-3 font-medium">${r.name} <span class="text-xs font-normal text-gray-500">${r.distance ? formatKm(r.distance) : ''}</span></td>
        <td data-label="סגנון" class="p-3">${r.style}</td>
        <td data-label="שעות" class="p-3 text-xs">${r.hours || ''}</td>
        <td data-label="פעולות" class="p-3">
            <div class="flex flex-wrap gap-2">
                <button class="add-kosher-btn btn btn-primary btn-sm" title="הוסף ליום" data-activity-name="${r.name}"><i class="fa-solid fa-plus"></i></button>
                ${r.phone ? `<a title="התקשר" href="tel:${r.phone}" class="btn btn-ghost btn-sm"><i class="fa-solid fa-phone"></i></a>`:''}
                <a title="Waze" href="https://waze.com/ul?q=${encodeURIComponent(r.address)}" target="_blank" class="btn btn-ghost btn-sm"><i class="fa-brands fa-waze"></i></a>
                <a title="Google Maps" href="https://maps.google.com/?q=${encodeURIComponent(r.address)}" target="_blank" class="btn btn-ghost btn-sm"><i class="fa-brands fa-google"></i></a>
                ${r.website ? `<a href="${r.website}" target="_blank" class="btn btn-ghost btn-sm" title="אתר"><i class="fa-solid fa-globe"></i></a>`:''}
            </div>
        </td>
    </tr>`;
};
const rowMarket = m => {
    const logoSrc = m.logo || placeholderLogoUrl(m.name);
    return `
    <tr class="align-top border-b dark:border-gray-800">
        <td data-label="לוגו" class="p-3 logo-cell"><img class="logo" src="${logoSrc}" alt="${m.name}" onerror="this.onerror=null;this.src='${placeholderLogoUrl(m.name)}';"></td>
        <td data-label="שם" class="p-3 font-medium">${m.name} <span class="text-xs font-normal text-gray-500">${m.distance ? formatKm(m.distance) : ''}</span></td>
        <td data-label="סוג" class="p-3">${m.style}</td>
        <td data-label="שעות" class="p-3 text-xs">${m.hours || ''}</td>
        <td data-label="פעולות" class="p-3">
            <div class="flex flex-wrap gap-2">
                <button class="add-kosher-btn btn btn-primary btn-sm" title="הוסף ליום" data-activity-name="${m.name}"><i class="fa-solid fa-plus"></i></button>
                ${m.phone ? `<a title="התקשר" href="tel:${m.phone}" class="btn btn-ghost btn-sm"><i class="fa-solid fa-phone"></i></a>`:''}
                <a title="Waze" href="https://waze.com/ul?q=${encodeURIComponent(m.address)}" target="_blank" class="btn btn-ghost btn-sm"><i class="fa-brands fa-waze"></i></a>
                <a title="Google Maps" href="https://maps.google.com/?q=${encodeURIComponent(m.address)}" target="_blank" class="btn btn-ghost btn-sm"><i class="fa-brands fa-google"></i></a>
                ${m.website ? `<a href="${m.website}" target="_blank" class="btn btn-ghost btn-sm" title="אתר"><i class="fa-solid fa-globe"></i></a>`:''}
            </div>
        </td>
    </tr>`;
};

// ... More render functions will be in the next part
// END OF PART 2

// Version 1.0 - Logic with extensive logging
// PART 3 OF 3: Remaining Render Functions, API calls, State Modifiers, and Initialization.

function renderChecklist(checklistData) {
    console.log(`Log: renderChecklist called with ${checklistData ? checklistData.length : 0} categories.`);
    const container = $('#checklist-container');
    const categorySelect = $('#category-select');
    container.innerHTML = '';
    categorySelect.innerHTML = '<option value="">בחר קטגוריה...</option>';
    (checklistData || []).forEach(cat => {
        categorySelect.innerHTML += `<option value="${cat.category}">${cat.category}</option>`;
        let catHtml = `<div class="space-y-2"><h4 class="font-bold">${cat.category}</h4>`;
        (cat.items || []).forEach(item => {
            catHtml += `<label class="flex items-center gap-2">
                <input type="checkbox" class="checklist-item-toggle" data-item-id="${item.id}" ${item.done ? 'checked' : ''}>
                <span class="${item.done ? 'line-through text-gray-500' : ''}">${item.text}</span>
                <button class="remove-checklist-item-btn text-red-500 mr-auto hover:text-red-700 text-xs" data-category-id="${cat.id}" data-item-id="${item.id}"><i class="fa-solid fa-trash"></i></button>
            </label>`;
        });
        container.innerHTML += catHtml + '</div>';
    });
}

function renderBudget(data) {
    // console.log('Log: renderBudget called.'); // Called frequently, logging might be too noisy.
    const { totalBudget = 0, expenses = [], plan, settings = { includeEstimatedCostsInBalance: true } } = data;
    
    const totalBudgetInput = $('#total-budget');
    if (document.activeElement !== totalBudgetInput) {
         totalBudgetInput.value = totalBudget || '';
    }

    const includeEstimated = $('#include-estimated-costs');
    includeEstimated.checked = settings.includeEstimatedCostsInBalance;

    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const estimatedCosts = calculateEstimatedCosts(plan);
    const balance = totalBudget - totalExpenses - (includeEstimated.checked ? estimatedCosts : 0);

    $('#total-expenses').textContent = totalExpenses.toFixed(2) + '€';
    $('#estimated-costs').textContent = estimatedCosts.toFixed(2) + '€';
    $('#budget-balance').textContent = balance.toFixed(2) + '€';

    $('#expense-list').innerHTML = expenses.map(exp => 
        `<div class="flex justify-between items-center py-1 group">
            <span>${exp.desc} <span class="text-xs text-gray-400">${exp.category}</span></span>
            <span class="flex items-center gap-2">
                ${exp.amount.toFixed(2)}€
                <button class="remove-expense-btn text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" data-expense-id="${exp.id}">
                    <i class="fa-solid fa-trash-alt fa-xs"></i>
                </button>
            </span>
        </div>`
    ).join('');
    
    renderBudgetChart(expenses);
}

function renderBudgetChart(expenses) {
    // console.log('Log: renderBudgetChart called.'); // Frequent call
    const ctx = $('#budget-chart').getContext('2d');
    const placeholder = $('#budget-chart-placeholder');
    const legendContainer = $('#budget-chart-legend');
    if (!ctx) return;

    const categoryTotals = (expenses || []).reduce((acc, exp) => {
        acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
        return acc;
    }, {});

    const totalExpenses = (expenses || []).reduce((sum, exp) => sum + exp.amount, 0);
    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);
    const backgroundColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

    if (budgetChartInstance) {
        budgetChartInstance.destroy();
    }
    
    legendContainer.innerHTML = '';
    if (labels.length === 0) {
        placeholder.classList.remove('hidden');
        return;
    }
    placeholder.classList.add('hidden');

    budgetChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors.slice(0, labels.length),
                borderColor: 'var(--card)',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                title: { display: false },
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(ctx.parsed)}` } }
            }
        }
    });

    legendContainer.innerHTML = `<h4 class="text-center font-bold mb-2">פירוט הוצאות</h4>`;
    labels.forEach((label, index) => {
        const amount = categoryTotals[label];
        const percentage = totalExpenses > 0 ? ((amount / totalExpenses) * 100).toFixed(0) : 0;
        const color = backgroundColors[index % backgroundColors.length];
        legendContainer.innerHTML += `
            <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-sm" style="background-color: ${color};"></span>
                    <span>${label}</span>
                </div>
                <span class="font-semibold">${amount.toFixed(2)}€ (${percentage}%)</span>
            </div>`;
    });
}

function renderDocuments(documents = []) {
    console.log(`Log: renderDocuments called with ${documents ? documents.length : 0} documents.`);
    const grid = $('#documents-grid');
    grid.innerHTML = (documents || []).map(doc => `
        <div class="relative bg-gray-100 dark:bg-gray-800 rounded-lg flex flex-col items-center justify-center p-2 text-center">
             <a href="${doc.dataUrl}" download="${doc.name}" class="flex flex-col items-center justify-center w-full h-full">
                <i class="fa-solid fa-file-pdf fa-3x text-red-500"></i>
                <span class="text-xs mt-2 break-all">${doc.name}</span>
            </a>
            <button class="remove-document-btn delete-btn" data-doc-id="${doc.id}">×</button>
        </div>`).join('');
}

function renderGallery(gallery = []) {
    console.log(`Log: renderGallery called with ${gallery ? gallery.length : 0} images.`);
    const grid = $('#gallery-grid');
    grid.innerHTML = (gallery || []).map(img => `<div class="relative aspect-square">
        <img src="${img.dataUrl}" class="w-full h-full object-cover rounded-lg">
        <button class="remove-image-btn delete-btn" data-img-id="${img.id}">×</button>
    </div>`).join('');
}

function renderTranslationHistory() {
    console.log(`Log: renderTranslationHistory called. History length: ${translationHistory.length}`);
    const container = $('#translation-history');
    if (translationHistory.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400">היסטוריית תרגומים</div>`;
        return;
    }
    container.innerHTML = translationHistory.map((item, index) => `
        <div class="p-1.5 bg-gray-100 dark:bg-gray-800 rounded-md flex justify-between items-center group">
            <div class="reuse-translation-btn cursor-pointer flex-grow" data-index="${index}">
                <div class="font-medium">${item.sourceText}</div>
                <div class="text-gray-500">${item.translatedText}</div>
            </div>
            <button class="remove-translation-btn text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 ml-2 p-1" data-index="${index}">
                <i class="fa-solid fa-trash-alt fa-xs"></i>
            </button>
        </div>
    `).join('');
}

// --- API & ASYNC FUNCTIONS ---
async function fetchWeather() {
    console.log('Log: fetchWeather called.');
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=45.46&longitude=9.19&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Europe/Berlin&forecast_days=7`);
        const data = await res.json();
        if (data.error) throw new Error(data.reason);
        lastWeatherAPIData = data;
        console.log('Log: Weather data fetched successfully.');
        // ... (rest of the function remains the same)
    } catch (e) {
        console.error('Log: Error fetching weather data:', e);
        $('#weather-forecast').innerHTML = `<p class="text-xs text-red-500">שגיאה בטעינת תחזית. ${e.message}</p>`;
    }
}

async function fetchExchangeRate() {
    console.log('Log: fetchExchangeRate called.');
    try {
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
        const data = await response.json();
        if(data && data.rates && data.rates.ILS) {
            eurToIlsRate = data.rates.ILS;
            $('#exchange-rate-display').textContent = `שער נוכחי: 1€ = ${eurToIlsRate.toFixed(3)}₪`;
            console.log(`Log: Exchange rate updated: ${eurToIlsRate}`);
        }
    } catch (error) {
        console.error("Log: Could not fetch exchange rate:", error);
         $('#exchange-rate-display').textContent = 'שגיאה בטעינת שער חליפין.';
    }
}

// ... All other functions from here on are Part 3
// END OF PART 3



