/** Where residents go for official evacuation information, per town with a public-safety block (owner 2026-10-29). We never state evacuation
 *  facts ourselves: only these links and a note that maps can lag. Shared by the Worker (server/safety.ts) and the pages. broomfield.org is
 *  linked only, never fetched (it blocks AI robots). */
export interface SafetyLink { label: string; url: string }
export interface SafetyTownInfo { evacuation: SafetyLink[]; evacuationNote: string; radiusMiles: number; agencyName: string }

export const SAFETY_TOWNS: Record<string, SafetyTownInfo> = {
  moreno_valley_ca: {
    evacuation: [{ label: 'Riverside County evacuation map (Genasys Protect)', url: 'https://protect.genasys.com/search?z=12&latlon=33.9425,-117.2297' }],
    evacuationNote: 'Evacuation maps can lag behind a fast-moving fire. If you are told to leave, leave.',
    radiusMiles: 25,
    agencyName: 'Riverside County',
  },
  broomfield_co: {
    evacuation: [
      { label: 'City and County of Broomfield: emergency status', url: 'https://www.broomfield.org/EmergencyStatus' },
      { label: 'LookoutAlert, Broomfield’s warning system', url: 'https://www.broomfield.org/LookoutAlert' },
    ],
    evacuationNote: 'Maps and notices can lag behind a fast-moving fire. If you are told to leave, leave.',
    radiusMiles: 25,
    agencyName: 'Broomfield',
  },
};
