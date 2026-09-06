/** CityStatus -- "<Town> Right Now", the front-page condensed status strip.
 *  See lib/cityStatus.ts's own module contract (handoff: CityStatus).
 *
 *  Every module is a pure function of already-existing data -- no new
 *  scraper, no new table.
 *
 *  KNOWN OPEN DIVERGENCE, not silently accepted: this file replaced
 *  TodayBlock's mount on the FRONT PAGE (index.astro), which sat in the
 *  exact same position and covered nearly the same ground -- but
 *  `/today` (pages/today.astro) still mounts TodayBlock with its own,
 *  separate resolvers, unchanged. The two therefore do NOT share one data
 *  layer yet, which is precisely the divergence the handoff's own
 *  "same data function so they can never disagree" line exists to
 *  prevent. Not closed here because it isn't a small port: TodayBlock
 *  renders real surface CityStatusModule's flat {value, tone} contract
 *  has no equivalent for at all -- a TOMORROW bucket (no `tomorrow`
 *  module exists in this file), full StoryCard event listings for both
 *  buckets (events_today here is one summarized line), the complete
 *  clickable alert list and TrafficWidget incident list (alerts/traffic
 *  here are each one summarized line), and cityHallFacility open/closed
 *  status (deliberately out of CityStatus entirely, backlogged behind
 *  the structured-hours migration). Closing this for real means either
 *  designing an expanded, array-carrying resolver shape today.astro can
 *  consume alongside this compact one, or accepting a reduced /today --
 *  a genuine design task, not something to force through as a side
 *  effect of this handoff. Until then, CityStatus's own resolvers
 *  independently call the same lib/db.ts functions today.astro already
 *  trusts, so at least the underlying FACTS can't drift even though the
 *  two pages don't yet share one code path.
 *
 *  Config-driven, not town-hardcoded: which modules render for a town
 *  lives ENTIRELY in site-config.ts's `statusModules` array. A hand-
 *  maintained prose availability matrix was wrong about Broomfield's
 *  traffic source twice in this project's history -- the fix is deriving
 *  availability from the same config every other feature flag already
 *  lives in (trafficSource, hasClosureWatch, hasEventsSource), never a
 *  third copy of the same claim.
 */
import {
  getWeather, getActiveAlerts, getClosureWatchStatus, getActiveTrafficIncidents,
  getUpcomingStories, getUpcomingArtsEvents, getNextMeeting, getNextSdsuMarqueeEvent,
} from './db';
import { buildEventFeed, todayUtcMidnight, isTonight, selectTodayBucket } from './events';
import { computeHeatTier } from './heat-advisory';
import { siteConfig, type SiteConfig } from './site-config';

export type StatusTone = 'quiet' | 'notice' | 'alert';

export interface CityStatusModule {
  id: string;
  icon: string;
  label: string;
  value: string;
  tone: StatusTone;
  href?: string;
  asOf: Date;
}

type ModuleResolver = () => Promise<CityStatusModule | null>;

// Resolved from a central map, not passed by callers -- see the module
// contract's own `icon` field comment. Deliberately not one-emoji-per-row
// (see handoff's "Presentation notes"): CityStatus.astro renders `icon` as
// a CSS class hook for a small inline SVG set / accent treatment, not as
// literal emoji text.
const ICONS: Record<string, string> = {
  weather: 'weather',
  alerts: 'alert',
  closures: 'school',
  traffic: 'traffic',
  events_today: 'calendar',
  next_meeting: 'gavel',
  worker_pulse: 'heat',
  university: 'athletics',
};

const CLOSURE_LABEL: Record<'confirmed' | 'watch' | 'clear', string> = {
  confirmed: 'Schools closed',
  watch: 'Watch — no closure announced yet',
  clear: 'Schools open, no closures reported',
};

async function resolveWeather(): Promise<CityStatusModule | null> {
  const periods = await getWeather();
  const current = periods.find((p) => p.is_daytime) ?? periods[0] ?? null;
  if (!current || current.temp === null) return null;
  return {
    id: 'weather', icon: ICONS.weather, label: 'Weather',
    value: `${Math.round(current.temp)}°${current.unit}, ${current.short}`,
    tone: 'quiet', href: '/weather/', asOf: new Date(current.start),
  };
}

async function resolveAlerts(): Promise<CityStatusModule | null> {
  const alerts = await getActiveAlerts();
  if (alerts.length === 0) {
    return {
      id: 'alerts', icon: ICONS.alerts, label: 'Alerts',
      value: 'No active alerts', tone: 'quiet', href: '/weather/', asOf: new Date(),
    };
  }
  const value = alerts.length === 1 ? alerts[0].title : `${alerts.length} active alerts`;
  return {
    id: 'alerts', icon: ICONS.alerts, label: 'Alerts', value, tone: 'alert',
    href: `/s/${alerts[0].slug}/`, asOf: new Date(alerts[0].published_at),
  };
}

async function resolveClosures(): Promise<CityStatusModule | null> {
  const status = await getClosureWatchStatus();
  const tone: StatusTone = status.state === 'confirmed' ? 'alert' : status.state === 'watch' ? 'notice' : 'quiet';
  return {
    id: 'closures', icon: ICONS.closures, label: 'Schools',
    value: CLOSURE_LABEL[status.state], tone, href: '/closures/', asOf: new Date(),
  };
}

async function resolveTraffic(): Promise<CityStatusModule | null> {
  const incidents = await getActiveTrafficIncidents();
  if (incidents.length === 0) {
    return {
      id: 'traffic', icon: ICONS.traffic, label: 'Traffic',
      value: 'No active incidents', tone: 'quiet', href: '/traffic/', asOf: new Date(),
    };
  }
  // Specificity where the data allows (handoff's own "2 incidents on SR-60"
  // example) -- only when every active incident shares one road, otherwise
  // naming one road would misrepresent the others.
  const roads = new Set(incidents.map((i) => i.road).filter(Boolean));
  const value = roads.size === 1
    ? `${incidents.length} incident${incidents.length === 1 ? '' : 's'} on ${[...roads][0]}`
    : `${incidents.length} active incident${incidents.length === 1 ? '' : 's'}`;
  const asOf = incidents.reduce((latest, i) =>
    new Date(i.last_seen_at) > latest ? new Date(i.last_seen_at) : latest, new Date(0));
  return { id: 'traffic', icon: ICONS.traffic, label: 'Traffic', value, tone: 'notice', href: '/traffic/', asOf };
}

async function resolveEventsToday(): Promise<CityStatusModule | null> {
  const [upcomingStories, artsEvents] = await Promise.all([
    getUpcomingStories(['event'], 200),
    getUpcomingArtsEvents(60),
  ]);
  const { items } = buildEventFeed(upcomingStories, artsEvents, siteConfig.timezone);
  const today = todayUtcMidnight(siteConfig.timezone);
  const tonight = selectTodayBucket(items, today, siteConfig.timezone, isTonight, 1);
  const value = tonight.total === 0
    ? 'Nothing scheduled tonight'
    : `${tonight.total} event${tonight.total === 1 ? '' : 's'} tonight`;
  return {
    id: 'events_today', icon: ICONS.events_today, label: 'Tonight',
    value, tone: 'quiet', href: '/today/', asOf: new Date(),
  };
}

async function resolveNextMeeting(): Promise<CityStatusModule | null> {
  const meeting = await getNextMeeting();
  if (!meeting) return null;
  return {
    id: 'next_meeting', icon: ICONS.next_meeting, label: 'Next meeting',
    value: `${meeting.body}, ${meeting.local_label}`, tone: 'quiet',
    href: meeting.agenda_url ?? '/city-hall/', asOf: new Date(),
  };
}

async function resolveWorkerPulse(): Promise<CityStatusModule | null> {
  const [periods, alerts] = await Promise.all([getWeather(), getActiveAlerts()]);
  const current = periods.find((p) => p.is_daytime) ?? periods[0] ?? null;
  const { tier, label } = computeHeatTier(current?.temp ?? null, alerts.map((a) => a.title));
  const tone: StatusTone = tier === 'high-risk' ? 'alert' : tier === 'caution' ? 'notice' : 'quiet';
  return {
    id: 'worker_pulse', icon: ICONS.worker_pulse, label: 'Worker Pulse',
    value: label, tone, href: '/workplace-watch/', asOf: new Date(),
  };
}

async function resolveUniversity(): Promise<CityStatusModule | null> {
  const event = await getNextSdsuMarqueeEvent();
  if (!event) {
    return {
      id: 'university', icon: ICONS.university, label: 'SDSU',
      value: 'No marquee events this week', tone: 'quiet', href: '/university/', asOf: new Date(),
    };
  }
  return {
    id: 'university', icon: ICONS.university, label: 'SDSU',
    value: event.title, tone: 'quiet', href: '/university/',
    asOf: event.starts_at ? new Date(event.starts_at) : new Date(),
  };
}

// Always rendered: their quiet state is still informative (handoff's own
// "Visibility rules"). `university`/`next_meeting` weren't explicitly
// classified in the handoff's Always/Conditional split -- both follow the
// SAME "a real 'nothing scheduled' is still worth a line" reasoning
// events_today/weather were given, so they're grouped here too, disclosed
// rather than silently assumed.
const ALWAYS_RENDERED = new Set(['weather', 'events_today', 'next_meeting', 'university']);

interface ModuleDef {
  resolve: ModuleResolver;
  /** Real capability check derived from siteConfig -- NOT a hand-written
   *  matrix (see this file's own module docstring for why). Only checked
   *  for ALWAYS_RENDERED modules: a conditional module with no real source
   *  configured for a town simply isn't listed in that town's
   *  `statusModules` in the first place, so there's nothing to validate --
   *  but an always-rendered module's quiet state must be a REAL "nothing
   *  right now", never a stand-in for "we never actually checked", so its
   *  presence in the array is a claim this function enforces. */
  hasSource: (cfg: SiteConfig) => boolean;
}

const MODULES: Record<string, ModuleDef> = {
  weather: { resolve: resolveWeather, hasSource: () => true },
  alerts: { resolve: resolveAlerts, hasSource: () => true },
  closures: { resolve: resolveClosures, hasSource: (cfg) => !!cfg.hasClosureWatch },
  traffic: { resolve: resolveTraffic, hasSource: (cfg) => !!cfg.trafficSource },
  events_today: { resolve: resolveEventsToday, hasSource: (cfg) => !!cfg.hasEventsSource },
  next_meeting: { resolve: resolveNextMeeting, hasSource: () => true },
  worker_pulse: { resolve: resolveWorkerPulse, hasSource: (cfg) => cfg.townId === 'moreno_valley_ca' },
  university: { resolve: resolveUniversity, hasSource: (cfg) => cfg.townId === 'brookings_sd' },
};

/** Validates a town's `statusModules` config against real capability --
 *  throws (fails the build loudly) rather than silently degrading, per the
 *  handoff's own two explicit rules: an unknown id is always an error, and
 *  an ALWAYS_RENDERED module configured for a town with no real source
 *  behind it is also an error (this is the "regression made impossible"
 *  check the corrected Broomfield lineup asked for). Exported separately
 *  from getCityStatus() so a unit test can call it without a live DB. */
export function validateStatusModules(cfg: SiteConfig): void {
  for (const id of cfg.statusModules ?? []) {
    const def = MODULES[id];
    if (!def) {
      throw new Error(`CityStatus: unknown module id "${id}" in ${cfg.townId}'s statusModules`);
    }
    if (ALWAYS_RENDERED.has(id) && !def.hasSource(cfg)) {
      throw new Error(
        `CityStatus: "${id}" is an always-rendered module (its quiet state must be a real ` +
        `signal, not a stand-in for "no source") but ${cfg.townId} has no real source for it. ` +
        `Remove it from statusModules, or add the capability flag it depends on.`);
    }
  }
}

// Conditional (handoff's own "Visibility rules"): rendered only when
// non-quiet. The resolver ALWAYS returns a real module even when quiet
// (see resolveAlerts/resolveClosures/resolveTraffic/resolveWorkerPulse
// above) -- hiding is a RENDERING decision applied here, not baked into
// the resolver, so applyVisibilityRules() has real quiet modules to
// consolidate rather than nothing at all.
const CONDITIONAL = new Set(['alerts', 'closures', 'traffic', 'worker_pulse']);

// What to call each conditional module's absence in the consolidated line
// -- not just its `label` lowercased ("Schools" -> "closures", not
// "schools"; "Traffic" -> "traffic incidents", matching the handoff's own
// "No alerts, closures or traffic incidents" example verbatim).
const QUIET_NOUN: Record<string, string> = {
  alerts: 'alerts',
  closures: 'closures',
  traffic: 'traffic incidents',
  worker_pulse: 'heat/dust advisories',
};

function joinWithOr(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** Applies the handoff's "Visibility rules": always-rendered modules pass
 *  through untouched; conditional modules are dropped when quiet UNLESS
 *  every conditional module present is quiet, in which case they're
 *  replaced by one consolidated reassurance line (e.g. "No alerts,
 *  closures or traffic incidents") rather than disappearing entirely --
 *  "six lines of nothing reads deader than no component at all," but so
 *  does a blank space where the conditional modules used to be. A town
 *  configured with zero conditional modules (e.g. Broomfield's v1 lineup:
 *  weather, alerts, traffic, next_meeting -- alerts/traffic ARE
 *  conditional, so this only applies when NEITHER is configured at all)
 *  never triggers consolidation, since there's nothing to consolidate.
 *  Exported and pure (no I/O) so it's unit-testable without a live DB. */
export function applyVisibilityRules(modules: CityStatusModule[]): CityStatusModule[] {
  const always = modules.filter((m) => !CONDITIONAL.has(m.id));
  const conditional = modules.filter((m) => CONDITIONAL.has(m.id));
  if (conditional.length === 0) return always;

  const nonQuiet = conditional.filter((m) => m.tone !== 'quiet');
  if (nonQuiet.length > 0) return [...always, ...nonQuiet];

  const oldest = conditional.reduce((min, m) => (m.asOf < min ? m.asOf : min), conditional[0].asOf);
  const consolidated: CityStatusModule = {
    id: 'consolidated', icon: 'check', label: 'All clear',
    value: `No ${joinWithOr(conditional.map((m) => QUIET_NOUN[m.id] ?? m.label.toLowerCase()))}`,
    tone: 'quiet', asOf: oldest,
  };
  return [...always, consolidated];
}

/** The strip's "Updated 14:05" line -- the OLDEST asOf among the modules
 *  actually rendered (post-applyVisibilityRules, so a hidden quiet module
 *  doesn't drag the timestamp down), never build start time (handoff's
 *  own "Be honest about it" instruction). null when there's nothing
 *  rendered to date at all. */
export function oldestAsOf(modules: CityStatusModule[]): Date | null {
  if (modules.length === 0) return null;
  return modules.reduce((min, m) => (m.asOf < min ? m.asOf : min), modules[0].asOf);
}

/** Resolves every configured module for the current town (siteConfig).
 *  A resolver that throws is caught here and treated as null -- one dead
 *  feed must never break the front page or fail the build (handoff's own
 *  rule; contrast with validateStatusModules() above, which fails the
 *  build for a CONFIG mistake, not a runtime data failure). */
export async function getCityStatus(): Promise<CityStatusModule[]> {
  validateStatusModules(siteConfig);
  const ids = siteConfig.statusModules ?? [];

  const settled = await Promise.all(
    ids.map(async (id) => {
      try {
        return await MODULES[id].resolve();
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((m): m is CityStatusModule => m !== null);
}
