// DATA STATUS: sizes for data centers that have started but not published one.
// Used only for the contracts the game starts with.

export interface AssumedMw { mw: number; why: string }

export const ASSUMED_MW: ReadonlyArray<{ name: string } & AssumedMw> = [
  { name: 'Google Douglas County campus', mw: 326, why: 'Google has not published it. 326 MW is what the tracker Cleanview lists.' },
  { name: 'Microsoft Douglasville campus', mw: 216, why: 'Microsoft has not published it. 216 MW is a tracker figure that could not be confirmed.' },
  { name: 'Project Eisenhower', mw: 200, why: 'QTS has not published it. 200 MW was the earlier T5 plan for the site.' },
  { name: 'AWS Butts County campus', mw: 69, why: 'Amazon has not published it. 69 MW is one tracker\'s figure for the first building.' },
  { name: 'Microsoft Palmetto', mw: 100, why: 'Microsoft has not published it. 100 MW is invented.' },
  { name: 'Microsoft East Point', mw: 100, why: 'Microsoft has not published it. 100 MW is invented.' },
  { name: 'AWS Covington', mw: 100, why: 'Amazon has not published it. 100 MW is invented.' },
  { name: 'Core Scientific Dalton 4', mw: 100, why: 'Core Scientific has not published it. 100 MW is invented.' },
]

export const assumedMw = (name: string): AssumedMw | null => ASSUMED_MW.find((a) => name.startsWith(a.name)) ?? null
