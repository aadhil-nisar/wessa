# Wessa (වැස්ස)

A rain, river and landslide watch for Sri Lanka's 25 districts. It pulls free, open weather data, scores each district from Normal to Severe, and shows the result on a map that works on a phone, a tablet or a wide desktop screen. An optional Telegram bot messages people when their district's level goes up.

It is not an official warning service. For warnings, follow the Disaster Management Centre (117), the Department of Meteorology and NBRO.

## What it does

- Fetches daily rainfall (3 past days, today, 6 forecast days) for a point near the centre of every district from Open-Meteo, in a single request.
- Fetches river flow forecasts from the Open-Meteo Flood API (GloFAS model).
- Scores each district with `public/js/risk.js`. The website and the backend load that same file, so they never disagree.
- Lists magnitude 4+ earthquakes in the region (USGS) and disaster alerts for Sri Lanka (GDACS).
- Shows district names in English, Sinhala and Tamil.
- Includes a **Ditwah replay**: real rainfall and river flow from 24 Nov to 3 Dec 2025, read as if it were the forecast on 27 Nov. It shows what the dashboard looks like during a real disaster, which is handy for demos.

## The scoring rules

| Wettest day in the next 3 days | Level |
|---|---|
| Under 50 mm | Normal |
| 50 to 75 mm | Watch |
| 75 to 100 mm | Watch, or Warning in a landslide-prone district |
| 100 to 150 mm | Warning |
| 150 mm or more | Severe |

Then:
- If more than 150 mm fell in the past 3 days and at least 50 mm more is coming, the level goes up by one.
- If river flow is forecast to reach 1.5x today's level within 3 days, the district goes to at least Watch. At 2.5x it goes to at least Warning. Streams under 10 m³/s are ignored.

Landslide-prone districts follow NBRO's list of 14: Badulla, Colombo, Galle, Gampaha, Hambantota, Kalutara, Kandy, Kegalle, Kurunegala, Matale, Matara, Monaragala, Nuwara Eliya and Ratnapura.

Run `node functions/test.js` to check the rules.

## Project layout

```
public/                 the website (plain HTML, CSS and JS, no build step)
  index.html
  styles.css
  js/app.js             map, panels, charts, data loading
  js/risk.js            the scoring rules (shared with the backend)
  js/config.js          set your Telegram bot username here
  data/districts.js     25 district outlines (simplified SVG paths) and names
  data/snapshot.js      saved data, used when the live APIs can't be reached
functions/              Firebase Cloud Functions
  index.js              hourly check plus the Telegram bot webhook
  districts.json        district centres and names for the backend
  test.js               rule checks
firebase.json
firestore.rules
```

## Run it locally

No install is needed for the site:

```
npx serve public
```

Then open the address it prints. The page asks the APIs directly from the browser, so you see live data straight away. If the APIs can't be reached, it falls back to `data/snapshot.js` and says so at the top.

## Deploy the website

Any static host works (Firebase Hosting, GitHub Pages, Netlify, Vercel). With Firebase:

```
npm install -g firebase-tools
firebase login
firebase init hosting      # pick your project, keep "public" as the folder, say no to overwriting index.html
firebase deploy --only hosting
```

## Add the hourly check and Telegram alerts (optional)

Scheduled functions need the Firebase Blaze plan. At this size the usage stays within the free allowance, but a billing account must be linked.

1. Create a bot: message **@BotFather** on Telegram, send `/newbot` and copy the token.
2. Store the secrets:
   ```
   firebase functions:secrets:set TELEGRAM_TOKEN      # paste the BotFather token
   firebase functions:secrets:set TELEGRAM_SECRET     # any long random string you make up
   ```
3. Install and deploy:
   ```
   cd functions && npm install && cd ..
   firebase deploy --only functions,firestore:rules
   ```
4. Point Telegram at the webhook (use the URL that the deploy prints for `telegramWebhook`):
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=<telegramWebhook URL>" \
     -d "secret_token=<the TELEGRAM_SECRET you chose>"
   ```
5. Put the bot's username in `public/js/config.js` and redeploy hosting. The "Alerts on Telegram" section then appears on the site.
6. Optional: set `SITE_URL` in `functions/.env` (for example `SITE_URL=https://wessa.web.app`) so alerts include a link to the district.

Bot commands: `/subscribe Kandy`, `/unsubscribe Kandy`, `/list`, `/status Kandy`, `/stop`. District names work in English, Sinhala or Tamil.

## Known limits

- One forecast point per district. Heavy rain in one corner of a large district can be missed.
- GloFAS river flow at a district's centre may describe a small stream rather than the main river.
- The Ditwah replay uses archive (observed) data, not the forecasts issued at the time.

## Credits

- Weather, archive and flood data: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), flood data from GloFAS / Copernicus
- Earthquakes: [USGS](https://earthquake.usgs.gov/)
- Disaster alerts: [GDACS](https://www.gdacs.org/)
- District outlines: GADM, via [thejeshgn/srilanka](https://github.com/thejeshgn/srilanka)
- Sinhala and Tamil names: [SKIDDOW/SriLankaCitiesDatabase](https://github.com/SKIDDOW/SriLankaCitiesDatabase)
- Landslide-prone district list: National Building Research Organisation (NBRO)

Licensed under MIT.
