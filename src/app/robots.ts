import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** The marketing page and the sign-up entry points are public; the dashboard
 *  and the API are private to each tenant — nothing there to index. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/verify-email", "/reset-password"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
