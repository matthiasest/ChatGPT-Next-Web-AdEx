import { Analytics } from "@vercel/analytics/react";

import { Home } from "./components/home";

import { getServerSideConfig } from "./config/server";

console.log("[page.tsx] ");


const serverConfig = getServerSideConfig();

export default async function App() {
  return (
    <>
      <Home />
      {serverConfig?.isVercel && <Analytics />}
    </>
  );
}
