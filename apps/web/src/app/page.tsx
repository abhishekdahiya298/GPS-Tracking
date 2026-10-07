import { redirect } from "next/navigation";

/** The app has no public home page: the marketing site is a separate project (rio-website). */
export default function HomePage() {
  redirect("/dashboard");
}
