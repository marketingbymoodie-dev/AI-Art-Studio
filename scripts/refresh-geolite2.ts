/**
 * Download / refresh GeoLite2-Country.mmdb.
 * Requires MAXMIND_LICENSE_KEY. Used by the in-process weekly refresh and
 * as a one-off ops command: npx tsx scripts/refresh-geolite2.ts
 */
import "../server/load-env";
import { getGeoLite2Status, refreshGeoLite2 } from "../server/geoip";

await refreshGeoLite2({ force: true });
console.log(JSON.stringify(getGeoLite2Status(), null, 2));
process.exit(getGeoLite2Status().readerOpen || getGeoLite2Status().exists ? 0 : 1);
