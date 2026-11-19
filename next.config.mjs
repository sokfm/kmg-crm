/** @type {import('next').NextConfig} */
const nextConfig = {
  // Προσωρινά, μόνο για το αρχικό φόρτωμα της βάσης: κρυπτογραφημένα αρχεία
  // που τα διαβάζει ο SQL Editor του Supabase. Σβήνονται μόλις τελειώσει.
  async headers() {
    return [{ source: "/setup/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "https://supabase.com" }] }];
  },
};
export default nextConfig;
