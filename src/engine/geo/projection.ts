const R = 6371.0088 // IUGG mean Earth radius, km

const DEG = Math.PI / 180

const PHI1 = 31.5 * DEG
const PHI2 = 34.5 * DEG
const PHI0 = 32.5 * DEG
const LAM0 = -83.5 * DEG

const N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2
const C = Math.cos(PHI1) ** 2 + 2 * N * Math.sin(PHI1)
const RHO0 = (R * Math.sqrt(C - 2 * N * Math.sin(PHI0))) / N

/** Longitude/latitude in degrees to projected kilometres. */
export function project(lon: number, lat: number): [number, number] {
  const theta = N * (lon * DEG - LAM0)
  const rho = (R * Math.sqrt(C - 2 * N * Math.sin(lat * DEG))) / N
  return [rho * Math.sin(theta), RHO0 - rho * Math.cos(theta)]
}

/** Projected kilometres back to longitude/latitude in degrees. */
export function unproject(x: number, y: number): [number, number] {
  const dy = RHO0 - y
  const rho = Math.hypot(x, dy)
  const theta = Math.atan2(x, dy)
  const lat = Math.asin((C - ((rho * N) / R) ** 2) / (2 * N)) / DEG
  const lon = (LAM0 + theta / N) / DEG
  return [lon, lat]
}
