# Tidrapport

Mobilanpassad webbapp (PWA) för att logga konsulttimmar dagligen och rapportera dem i
[my.kleer.se](https://my.kleer.se) varje fredag – samt sista arbetsdagen i månaden när
månadsbrytet infaller mitt i veckan. Ersätter Excel-arket `Timereport.xlsx`.

Ingen byggkedja: ren HTML, CSS och JavaScript. Data ligger i en Supabase-databas så att
mobil och dator visar samma timmar, med en lokal kopia i webbläsaren så att appen fungerar
även utan täckning.

## Funktioner

- **Registrera** – välj kund, projekt och dag, tryck 8 h (eller stega med ±0,5), spara.
  Veckovy med totalsumma och belopp.
- **Rapportera** – orapporterade dagar grupperade per vecka (och per månad vid månadsbryt),
  knapp till my.kleer.se, "Markera veckan som rapporterad".
- **Översikt** – timmar och belopp per månad och år, per kund och projekt, bock för
  *Faktura betald*, export till CSV och JSON-säkerhetskopia.
- **Inställningar** – kunder med timpris (★ = standardkund), projekt per kund med valfritt
  eget timpris, Supabase-inloggning, säkerhetskopia och import.
- **Påminnelsebanner** på fredagar och sista arbetsdagen i månaden när något är orapporterat.
- Installerbar på hemskärmen (iOS: Dela → *Lägg till på hemskärmen*; Android: *Installera app*).

## Så fungerar lagringen

Appen skriver **alltid lokalt först** och lägger ändringen i en kö. Kön skickas till Supabase
så fort du har nät och är inloggad. Statusen syns uppe till höger:

| Text | Betyder |
|---|---|
| `Lokalt` | Ingen Supabase konfigurerad – allt ligger bara i den här webbläsaren |
| `Ej inloggad` | Databasen är konfigurerad men du måste logga in |
| `Synkad` | Allt är uppe i databasen |
| `Väntar (n)` | n ändringar väntar på att skickas |
| `Offline` | Ingen nätverksanslutning – ändringarna skickas när nätet kommer tillbaka |

Vid start hämtas allt från databasen och ersätter den lokala kopian, efter att eventuella
köade ändringar skickats först.

## Filer

| Fil | Innehåll |
|---|---|
| `index.html` | Skal och flikar |
| `style.css` | All stil i Melago-stil (melago.se). Tokens under `:root` |
| `app.js` | All logik: hjälpfunktioner → lagring/synk → state → vyer → uppstart |
| `supabase-schema.sql` | Tabeller, index, Row Level Security och en vy – körs en gång |
| `import-september-2026.json` | September 2026 från Excel-arket (87 h), redo att importera |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA-delarna + Melago-logotypen |
| `netlify.toml` | Deploy-konfiguration |

## 1. Sätt upp Supabase

1. Skapa ett projekt på [supabase.com](https://supabase.com) – välj regionen **EU (Frankfurt)**
   eller **EU (Stockholm)** så att datan stannar inom EU.
2. **SQL Editor → New query** → klistra in hela `supabase-schema.sql` → **Run**.
   Det skapar `clients`, `projects`, `entries`, `invoices` med Row Level Security påslaget,
   så att bara din inloggade användare når dina rader.
3. **Authentication → Sign In / Providers → Email**: låt e-post vara påslaget.
   Stäng gärna av *Confirm email* medan du sätter upp, så slipper du bekräftelsemejlet.
4. Klicka **Connect** högst upp i dashboarden (eller gå till **Project Settings → API Keys**)
   och kopiera *Project URL* och *publishable key* (`sb_publishable_…`). Har projektet en
   äldre `anon`-nyckel (`eyJ…`) fungerar den också, men den fasas ut av Supabase vid
   utgången av 2026.
5. I appen: **Inställningar → Supabase** → klistra in URL och nyckel → *Spara och anslut*
   (alternativt: fyll i `SUPABASE_URL` och `SUPABASE_KEY` högst upp i `app.js` och pusha –
   då är alla enheter förkonfigurerade och du behöver bara logga in)
   → fyll i e-post och lösenord → **Skapa konto** (första gången) eller **Logga in**.
6. Har du redan timmar lokalt frågar appen om de ska laddas upp. Svara ja.
7. På telefonen: samma sak, men **Logga in** med samma konto. Nu ser båda enheterna samma data.

> **Stäng av registrering när du skapat ditt konto:** Authentication → Sign In / Providers →
> Email → slå av *Allow new users to sign up*. Då kan ingen annan skapa konto i ditt projekt.

Publishable-nyckeln är gjord för att ligga i frontend – det är RLS-policyerna som skyddar
datan, inte nyckeln. Utan inloggning returnerar den noll rader. Blanda aldrig in
`sb_secret_…` eller `service_role` i appen; de går förbi RLS.

## 2. Importera september från Excel

**Inställningar → Säkerhetskopia & import → Importera JSON** → välj `import-september-2026.json`.

Innehåller 16–30 september 2026, 87 h totalt (= samma summa som Excel-arket, 109 620 kr
à 1 260 kr/h). Dagarna t.o.m. fredag 25 september är förbockade som rapporterade i Kleer;
28–30 september ligger kvar som orapporterade. Justera med ↶ under *Rapportera* om det inte
stämmer. Importen matchar kunder och projekt på **namn**, så du kan köra den flera gånger
utan att få dubbletter.

## 3. Kör lokalt

```bash
cd tidrapport
python3 -m http.server 8080     # eller npx serve .
```

Öppna <http://localhost:8080>. Lägg till `http://localhost:8080` under
**Authentication → URL Configuration → Redirect URLs** i Supabase om du vill logga in lokalt.

## 4. Publicera (GitHub Desktop + Netlify)

1. GitHub Desktop: **File → Add local repository…** → välj mappen → klicka *create a repository*
   → **Commit to main** → **Publish repository** (kryssa i *Keep this code private*).
2. Netlify: **Add new site → Import an existing project → GitHub** → välj repot → **Deploy**.
   `netlify.toml` anger `publish = "."`, inget byggkommando behövs.
3. Framåt: ändra filer → Commit to main → Push origin. Netlify deployar automatiskt.

Lägg till din Netlify-adress under **Authentication → URL Configuration** i Supabase
(*Site URL* och *Redirect URLs*).

> Höj `CACHE`-versionen i `sw.js` (t.ex. `tidrapport-v5`) när du ändrat `app.js` eller
> `style.css`, annars kan hemskärms-appen ligga kvar på den gamla versionen.

Stör "Powered by Netlify"-badgen längst ned till höger? Stäng av den under
**Project configuration → General → Powered by Netlify badge**.

## Felsökning: timmarna syns inte på andra enheten

Kolla statusrutan uppe till höger på **den enhet där timmarna finns**:

| Står det | Gör så här |
|---|---|
| `Lokalt` | Supabase är inte konfigurerad här – fyll i URL och nyckel under Inställningar |
| `Ej inloggad` | Logga in med ditt konto |
| `Väntar (n)` | Ändringar ligger i kö – tryck **Synka nu** under Inställningar. Står felet kvar visas orsaken i rutan *Senaste synkfel* |
| `Synkad` | Allt är uppe. Ser du dem ändå inte på den andra enheten: kontrollera att båda är inloggade med **samma** e-post |

Verifiera i Supabase: **Table Editor → entries**. Finns raderna där är problemet på den
hämtande enheten – tryck **Hämta från databasen** under Inställningar där.

Ordningen spelar roll första gången: ladda upp från enheten som har timmarna **först**,
hämta sedan på den andra. Svarar du nej på frågan "Databasen är tom men du har N tidposter"
ligger de kvar lokalt och du kan ladda upp dem när som helst med **Ladda upp allt lokalt**.

## 5. Anpassa

- **Förkonfigurerad Supabase**: `SUPABASE_URL` och `SUPABASE_KEY` högst upp i `app.js`.
  Nycklarna hör inte hemma i Netlifys miljövariabler – appen byggs inte, så de når aldrig
  webbläsaren. Publishable-nyckeln är gjord för att ligga i frontend.
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
invoices  id, client_id, month (YYYY-MM), paid, paid_at
```

En tidpost per dag, kund och projekt (två partiella unik-index i databasen håller det rent
även om två enheter skapar samma dag var för sig). Belopp = timmar × projektets timpris om
satt, annars kundens. `reported_at` sätts när du markerar en vecka som rapporterad i Kleer
och styr både bannern och listan under *Rapportera*.

Vyn `weekly_summary` finns i databasen om du vill göra egna SQL-frågor:

```sql
select * from weekly_summary where iso_year = 2026 order by iso_week;
```
