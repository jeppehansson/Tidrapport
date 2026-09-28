# Tidrapport

Mobilanpassad webbapp (PWA) för att logga konsulttimmar dagligen och rapportera dem i
[my.kleer.se](https://my.kleer.se) varje fredag – samt sista arbetsdagen i månaden när
månadsbrytet infaller mitt i veckan. Ersätter Excel-arket `Timereport.xlsx`.

Ingen byggkedja, ingen databas: ren HTML, CSS och JavaScript. Öppna `index.html` och
redigera direkt. All data ligger i webbläsaren (localStorage); synk mellan enheter är
valfri och görs med Netlify Blobs.

## Funktioner

- **Registrera** – välj kund, projekt och dag, tryck 8 h (eller stega med ±0,5), spara.
  Veckovy med totalsumma och belopp.
- **Rapportera** – orapporterade dagar grupperade per vecka (och per månad vid månadsbryt),
  knapp till my.kleer.se, "Markera veckan som rapporterad".
- **Översikt** – timmar och belopp per månad och år, per kund och projekt, bock för
  *Faktura betald*, export till CSV och JSON-säkerhetskopia.
- **Inställningar** – kunder med timpris (★ = standardkund), projekt per kund med valfritt
  eget timpris, säkerhetskopia/import, valfri synk.
- **Påminnelsebanner** på fredagar och sista arbetsdagen i månaden när något är orapporterat.
- Installerbar på hemskärmen (iOS: Dela → *Lägg till på hemskärmen*; Android: *Installera app*)
  och fungerar offline.

## Filer

| Fil | Innehåll |
|---|---|
| `index.html` | Skal och flikar |
| `style.css` | All stil i Melago-stil (melago.se): mörk header/footer, Noto Sans, 4 px hörn. Tokens under `:root` |
| `app.js` | All logik: hjälpfunktioner → lagring → state → vyer → uppstart |
| `netlify/functions/sync.mjs` | Valfri synk-endpoint (`/api/sync`) ovanpå Netlify Blobs |
| `import-september-2026.json` | September 2026 från Excel-arket (87 h), redo att importera |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA-delarna + Melago-logotypen |
| `netlify.toml`, `package.json` | Deploy-konfiguration |

## 1. Kör lokalt

```bash
cd tidrapport
python3 -m http.server 8080     # eller npx serve .
```

Öppna <http://localhost:8080>. (Service workern kräver http/https, inte `file://`.)

## 2. Lägg i GitHub och deploya automatiskt

Engångsuppsättning – därefter deployar varje `git push` automatiskt.

```bash
cd tidrapport
git init -b main
git add .
git commit -m "Tidrapport: första versionen"
```

Skapa ett **privat** repo på <https://github.com/new> (t.ex. `tidrapport`, utan README),
kopiera dess URL och kör:

```bash
git remote add origin https://github.com/<ditt-användarnamn>/tidrapport.git
git push -u origin main
```

Koppla sedan repot i Netlify: **Add new site → Import an existing project → GitHub** → välj
repot. Netlify läser `netlify.toml`, så inget byggkommando behövs (`publish = "."`).
Klicka **Deploy**. Sätt gärna ett eget namn under *Site configuration → Change site name*,
t.ex. `melago-tid.netlify.app`.

Framåt:

```bash
git add -A && git commit -m "Beskrivning av ändringen" && git push
```

Netlify bygger om på någon minut. Varje deploy sparas, så du kan rulla tillbaka i
*Deploys*-fliken om något blir fel. Ändrar du filer direkt i GitHubs webbeditor (går bra
från mobilen) deployar det också automatiskt.

> Höj `CACHE`-versionen i `sw.js` när du ändrat något – annars kan installerade
> hemskärms-appar ligga kvar på den gamla versionen.

## 3. Importera september från Excel

Öppna appen → **Inställningar → Säkerhetskopia & import → Importera JSON** → välj
`import-september-2026.json`.

Innehåller 16–30 september 2026, 87 h totalt (= samma summa som Excel-arket, 109 620 kr
à 1 260 kr/h). Dagarna t.o.m. fredag 25 september är förbockade som rapporterade i Kleer;
28–30 september ligger kvar som orapporterade. Justera med ↶ under *Rapportera* om det
inte stämmer.

Import matchar kunder och projekt på **namn**, så du kan importera samma fil flera gånger
utan att få dubbletter.

## 4. Synk mellan mobil och dator (valfritt)

Utan detta steg lever datan bara i den webbläsare du använder. Slår du på synk speglas hela
datamängden som en JSON-klump via din egen Netlify-sajt – ingen databas behövs.

1. I Netlify: **Site configuration → Environment variables → Add a variable**
   - Key: `SYNC_TOKEN`
   - Value: en lång slumpsträng, t.ex. från `openssl rand -hex 24`
2. Deploya om (Netlify gör det automatiskt vid nästa push, eller *Trigger deploy*).
3. I appen: **Inställningar → Synk mellan enheter** → klistra in samma sträng → *Slå på synk*.
   Gör samma sak på telefonen.

Nyast vinner: appen hämtar molnversionen vid start om den är nyare, och skickar upp dina
ändringar strax efter att du sparat. Tänkt för en användare på ett par enheter, inte för
samtidig redigering på två enheter på en gång.

Vill du hoppa över synken helt: ta bort mappen `netlify/` och `package.json` – appen
fungerar likadant, och du tar säkerhetskopia via *Inställningar → Ladda ner säkerhetskopia*.

## 5. Anpassa

- **Standardkund/timpris** vid första start: `DEFAULT_CLIENT` högst upp i `app.js`.
- **Kleer-länk**: `KLEER_URL` i `app.js`.
- **Snabbval för timmar**: `QUICK_HOURS` i `app.js`.
- **Påminnelselogik**: funktionen `reminder()` – fredag eller sista arbetsdagen i månaden.
- **Färger och typsnitt**: `:root` i `style.css` (och dark mode-blocket strax under).
- **Ny vy**: lägg till en knapp i `#tabbar` i `index.html` och en `renderXxx(v)`-funktion som
  registreras i objektet i `render()`.

## Datamodell

```
clients   id, name, hourly_rate, active
projects  id, client_id, name, hourly_rate (null = kundens), active
entries   id, date (YYYY-MM-DD), client_id, project_id (null ok), hours, note, reported_at
          -- unik per dag + kund + projekt
invoices  id, client_id, month (YYYY-MM), paid, paid_at
updated_at  ISO-tid för senaste ändringen (används av synken)
```

Belopp = timmar × projektets timpris om satt, annars kundens.
`reported_at` sätts när du markerar en vecka som rapporterad i Kleer och styr både bannern
och listan under *Rapportera*.
