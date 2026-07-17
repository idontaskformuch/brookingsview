"""Brookings County akutvarningar via CivicPlus "Alert Center"-modulen.

Modulen (AlertCenter.aspx) är en annan CivicPlus-komponent än AgendaCenter, så
civic-scraper-biblioteket (som är specialbyggt mot AgendaCenter) täcker den inte.
Ingen dedikerad öppen källkodsparser hittad för just denna modul, så vi bygger en
egen -- ankrad mot verifierade CSS-klasser/DOM-struktur, inte textrad-heuristik.

STAGE 2-FYND (2026-07-17): en tidigare version av denna parser byggdes bara mot
sidans RENDERADE TEXT (BeautifulSoup.get_text) eftersom bara den var verifierad.
Den gav två reella buggar: (1) get_text delar upp text vid VARJE inline-tagg
(t.ex. <strong>), inte bara blocknivå, så en mening kunde splittras mitt i och
ge en trunkerad titel ("Due to an" istället för hela första meningen); (2) en
"Latest Update"-etikett som råkade hamna i samma textrad som föregående länk
("Read On... Latest Update:") missades av radmatchningen, så uppdateringen
skapade en egen dubblettpost istället för att slås ihop med sin ursprungsvarning.
Efter att ha hämtat och inspekterat den rå HTML:n visade sig strukturen vara
riktig, stabil DOM (se nedan) — så parsern skrevs om till CSS-selektorer.

Bekräftad DOM-struktur (2026-07-17, live på brookingscountysd.gov/AlertCenter.aspx):
    <h2>Kategorinamn</h2>
    ...
    <ol class="alerts-list">
      <li class="alerts-list">
        <div class="alert ...">
          <span class="date">Månad Dag, År Tid</span>
          <h3><a>Rubrik</a></h3>
          <p>Brödtext (kan innehålla <br>-separerade rader)</p>
        </div>
        <div class="update ...">        <!-- valfri, 0 eller 1 -->
          <h4>Latest <span>Update:</span></h4>
          <span class="date">Månad Dag, År Tid</span>
          <p>Uppdaterad brödtext</p>
        </div>
      </li>
      ...
    </ol>

robots.txt på denna domän (brookingscountysd.gov) tillåter denna sökväg -- till
skillnad från cityofbrookings-sd.gov/calendar.aspx som uttryckligen nekar
automatiserad åtkomst (se events.py). Skrapa ALDRIG den stadens kalendersida.

Designval: en "update"-div hör till samma händelse som föregående <li>, inte en
egen post -- annars skulle en uppdaterad varning dubbelräknas.
"""
from __future__ import annotations

from datetime import datetime

import requests
from bs4 import BeautifulSoup

from db.db import content_hash
from scrapers.base_parser import BaseParser, FetchResult


class CountyAlertsParser(BaseParser):
    table = "events"
    platform = "civicplus_alerts"

    def _headers(self) -> dict:
        return {"User-Agent": "brookingsview.com (contact: hello@brookingsview.com)"}

    def fetch(self) -> FetchResult:
        url = self.source_cfg.get("url", "https://www.brookingscountysd.gov") \
            .rstrip("/") + "/AlertCenter.aspx"
        r = requests.get(url, headers=self._headers(), timeout=20)
        r.raise_for_status()
        return FetchResult(raw=r.content, content_type="text/html",
                           url=url, http_code=r.status_code)

    def parse(self, fetched: FetchResult) -> list[dict]:
        soup = BeautifulSoup(fetched.raw, "html.parser")
        records: list[dict] = []

        for ol in soup.select("ol.alerts-list"):
            heading = ol.find_previous("h2")
            category = heading.get_text(strip=True) if heading else None

            for li in ol.select("li.alerts-list"):
                alert_div = li.find("div", class_="alert")
                if not alert_div:
                    continue
                date_span = alert_div.find("span", class_="date")
                title_el = alert_div.find("h3")
                body_el = alert_div.find("p")
                timestamp = date_span.get_text(strip=True) if date_span else None
                title = title_el.get_text(" ", strip=True) if title_el else None
                body = body_el.get_text(" ", strip=True) if body_el else None
                if not title or not timestamp:
                    continue

                updates = []
                for update_div in li.find_all("div", class_="update"):
                    u_date = update_div.find("span", class_="date")
                    u_body = update_div.find("p")
                    updates.append({
                        "timestamp": u_date.get_text(strip=True) if u_date else None,
                        "text": u_body.get_text(" ", strip=True) if u_body else None,
                    })

                records.append({
                    "title": title,
                    "starts_at": _parse_dt(timestamp),
                    "ends_at": None,
                    "venue": category,
                    "source": "county_alert",
                    "url": fetched.url,
                    "raw_data": {
                        "category": category,
                        "body": body,
                        "updates": updates,
                    },
                    "content_hash": content_hash(
                        "county_alert", category, timestamp, title
                    ),
                })

        return records


def _parse_dt(s: str) -> str | None:
    try:
        return datetime.strptime(s, "%B %d, %Y %I:%M %p").isoformat()
    except ValueError:
        return None
