# Glasgow /about/ -- text för lansering (FÖRBEREDD, EJ TILLÄMPAD)

Ändra först när ägaren säger ja till noindex. Fil: site/src/components/legal/gb/AboutBody.astro, första stycket (rad 14-17).

## Nu (live)
{siteConfig.siteName} is a local information service for {siteConfig.cityName}, {siteConfig.region}. It is
being built to bring council and committee papers, events, alerts, travel and weather into one place, updated
automatically through the day. Every item will link to its original source. The site is at an early stage and
is not yet open to search engines.

## Vid lansering
{siteConfig.siteName} is a local information service for {siteConfig.cityName}, {siteConfig.region}. It brings
council and committee papers, events, alerts, travel and weather into one place, updated automatically through
the day. Every item links to its original source.

## Samtidigt (kontrollera, ändra inte i förväg)
- Resten av /about/ ("How it is made", "no human review" m.fl.): läs igenom att tempus och påståenden stämmer med vad som är live (t.ex. källor som "läggs till en och en").
- /contact/: raden "The site is still being set up and its sources are being added one by one" bör bytas mot en neutral rad när källorna är på plats.
- noindexSite: true -> ta bort i site-config.ts (Glasgow), sitemap/robots/IndexNow, Search Console (se lanseringschecklistan i state.md).
