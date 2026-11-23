const RAD = Math.PI / 180;

// Great-circle distance in kilometres (haversine, mean Earth diameter 12742 km).
export function distanceKm(lat1, lng1, lat2, lng2) {
  const sinLat = Math.sin(((lat2 - lat1) * RAD) / 2);
  const sinLng = Math.sin(((lng2 - lng1) * RAD) / 2);
  const h = sinLat * sinLat + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * sinLng * sinLng;
  return 12742 * Math.asin(Math.sqrt(h));
}
