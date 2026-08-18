# Moje Centrum — Piłkarz (wersja instalowalna na iPhone, za darmo)

To jest ta sama aplikacja co w Claude, przygotowana jako **PWA (Progressive Web App)** —
dzięki temu możesz dodać ją do ekranu głównego iPhone'a jak prawdziwą appkę:
własna ikona, pełny ekran (bez paska Safari), działa offline. Bez Apple Developer
Account (99$/rok), bez App Store, całkowicie za darmo.

## Co jest w tej wersji

Wszystko z podstawowej appki, plus:

- **Kopia zapasowa** — eksport/import danych jako plik JSON (menu ☰)
- **Onboarding** przy pierwszym uruchomieniu (imię, pozycja, cele, sprzęt)
- **Powiadomienia** o przypomnieniach z terminarza (menu ☰ → „Włącz powiadomienia")
- **Licznik wody** na pulpicie „Dzisiaj"
- **Tryb „Tydzień meczowy"** — plan intensywności treningu w dniach przed najbliższym meczem
- **Odtwarzacz treningu** z timerem serii/przerw i logowaniem obciążenia (przycisk „▶ Rozpocznij" przy treningu siłowym)
- **Historia ćwiczenia** z wykresem postępu ciężaru — stuknij dowolne ćwiczenie w bibliotece
- **Skaner kodów kreskowych** produktów spożywczych (darmowa baza OpenFoodFacts)
- **Dwóch dostawców AI** do wyboru w Profilu: darmowy Google Gemini albo płatny Anthropic

## Co działa całkowicie bez konfiguracji, za darmo, offline
Terminarz, treningi piłkarskie (kreator boiska 2D), treningi siłowe z odtwarzaczem
i historią postępów, dieta (dziennik, ~900 produktów, skaner kodów, własne posiłki),
szkoła, nawyki, woda, statystyki, profil, kopia zapasowa.

## Co wymaga (darmowego) klucza API
Zakładka **AI** (czat) i **rozpoznawanie posiłków ze zdjęcia** korzystają z modelu
językowego. W samej appce Claude działa to od razu. W tej samodzielnej wersji:

1. **Zalecane: Google Gemini (darmowe)** — załóż konto na https://aistudio.google.com/apikey,
   wygeneruj klucz (nie trzeba karty płatniczej, jest hojny darmowy limit zapytań
   dziennie), wklej w zakładce **Profil**.
2. Alternatywnie: własny klucz Anthropic z console.anthropic.com (płatny po
   wykorzystaniu startowego kredytu).

Jeśli nie dodasz żadnego klucza, reszta appki nadal działa normalnie — tylko czat
i zdjęcia posiłków pokażą komunikat z prośbą o klucz.

## Ważne ograniczenia (uczciwie, żebyś wiedział)

- **Powiadomienia** działają, gdy appka jest otwarta albo w tle w przeglądarce.
  Prawdziwe powiadomienia push, gdy appka jest całkowicie zamknięta, wymagałyby
  własnego serwera push — to już wykracza poza "za darmo bez backendu".
- **Skaner kodów kreskowych** wymaga zgody na kamerę i dobrego oświetlenia; jeśli
  nie zadziała na Twoim telefonie, zawsze możesz wpisać kod ręcznie (jest pole tekstowe).
- **Widget na ekranie głównym iOS nie jest możliwy** przez PWA/stronę internetową —
  to wymaga natywnej aplikacji pisanej w Swift/Xcode (WidgetKit), co nie jest
  darmowe ani proste do zrobienia bez Maca. Najbliższy odpowiednik to szybki dostęp
  przez ikonę na ekranie głównym (1 stuknięcie = ekran „Dzisiaj").
- Dane są zapisywane **lokalnie na tym telefonie/przeglądarce** (localStorage).
  Jeśli wyczyścisz dane Safari albo odinstalujesz appkę, dane znikną — rób regularnie
  kopię zapasową (menu ☰ → „Pobierz kopię zapasową").

---

## Krok po kroku: publikacja za darmo (Netlify)

1. **Załóż darmowe konto** na https://app.netlify.com (można przez GitHub/Google/e-mail).
2. Spakuj cały ten folder (`pilkarz-pwa`) w ZIP — albo wrzuć go do nowego,
   pustego repozytorium na GitHubie.
3. W Netlify wybierz **"Add new site" → "Deploy manually"** i przeciągnij tam
   folder (Netlify sam wykryje Vite i zbuduje appkę) — albo połącz repo z GitHuba
   i ustaw:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Po chwili dostaniesz darmowy adres typu `https://twoja-nazwa.netlify.app`.

*(Alternatywy, też darmowe: Vercel — vercel.com, albo GitHub Pages. Uwaga: skaner
kodów kreskowych i notyfikacje wymagają połączenia po HTTPS — darmowe hostingi
jak Netlify/Vercel dają to automatycznie.)*

## Instalacja na iPhonie

1. Otwórz wygenerowany link **w Safari** na iPhonie (musi być Safari, nie Chrome).
2. Stuknij ikonę **Udostępnij** (kwadrat ze strzałką w górę, na dolnym pasku).
3. Wybierz **„Dodaj do ekranu głównego"**.
4. Nadaj nazwę (np. „Moje Centrum") i zatwierdź.

Na ekranie głównym pojawi się ikona ⚽ — po kliknięciu appka otwiera się
w pełnym ekranie, bez paska adresu, jak natywna aplikacja.

---

## Uruchomienie i test lokalnie (opcjonalne, wymaga Node.js)

```bash
npm install
npm run dev
```

Otwórz adres z terminala (zwykle `http://localhost:5173`) w przeglądarce.

Żeby zbudować produkcyjną wersję samodzielnie:

```bash
npm run build
```

Gotowe pliki wylądują w folderze `dist/` — ich zawartość wrzuca się na dowolny
darmowy hosting statyczny (Netlify, Vercel, GitHub Pages, Cloudflare Pages).


## 🚀 NETLIFY — gotowe do wdrożenia

Ten pakiet ma już plik `netlify.toml` z ustawieniami:
- Build command: `npm run build`
- Publish directory: `dist`
- Node.js 22
- SPA redirect dla React Router/odświeżania stron

**Najprościej:** w Netlify wybierz **Add new site → Import an existing project**, podłącz repozytorium i nie zmieniaj ustawień — Netlify odczyta `netlify.toml` automatycznie.

Jeśli korzystasz z ręcznego **Deploy manually / drag & drop**, Netlify oczekuje gotowego folderu `dist`, więc najpierw trzeba wykonać `npm install` oraz `npm run build`.

## Powiadomienia push na iPhonie

Projekt zawiera obsługę Web Push przez Netlify Function. iPhone wymaga dodania PWA do ekranu początkowego i zgody na powiadomienia.

### Zmienne środowiskowe w Netlify
Ustaw w Netlify → Project configuration → Environment variables:

- `VAPID_PUBLIC_KEY` = `tZC-V-LjpgRshbTcKpLqaCMlipfGTezKpRpFIdjLrvs`
- `VAPID_PRIVATE_KEY` = wartość wygenerowanego prywatnego klucza VAPID (nie umieszczaj jej w repozytorium)
- `VAPID_SUBJECT` = własny adres kontaktowy w formacie `mailto:twoj-email@example.com`

Po dodaniu zmiennych zrób nowy deploy. Netlify udostępnia zmienne środowiskowe funkcjom podczas ich działania.

### Test na iPhonie
1. Otwórz stronę FootballOS w Safari.
2. Dodaj ją do ekranu początkowego.
3. Uruchom FootballOS z ikony na ekranie początkowym.
4. Wejdź w Profil → Powiadomienia.
5. Kliknij „Włącz powiadomienia” i wybierz „Pozwól”.
6. Powinno przyjść testowe powiadomienie „Działa! Powiadomienia push są już włączone 🎉”.

To jest wersja testowa: zapisuje subskrypcję w przeglądarce i od razu wysyła testowy push. Automatyczne przypomnienia o wydarzeniach można dołożyć w kolejnym kroku.
