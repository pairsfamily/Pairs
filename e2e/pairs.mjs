/** The three real mainnet pairs the e2e clones: one per kind pump.fun allows. */
export const PAIRS = {
  curve: process.env.E2E_CURVE_Q || '3BXio3YTY7MBaCjLHLR3rL491817x142bnBqQxN3pump', // a pump coin still on its curve
  pool: process.env.E2E_POOL_Q || 'Goh59QCfoX53RgJa615vzXx4swR3mv51VgvAN6ZCpump', // a pump coin graduated to PumpSwap
  listed: process.env.E2E_LISTED_Q || 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn', // PUMP, on pump.fun's custom pair list
};
