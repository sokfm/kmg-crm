import { redirect } from "next/navigation";

// Η «Βάση» είναι πλέον φίλτρο μέσα στους Πελάτες.
export default async function Base({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  redirect(`/customers?${new URLSearchParams({ status: "base", ...sp }).toString()}`);
}
