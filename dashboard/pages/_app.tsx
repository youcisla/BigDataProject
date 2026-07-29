import type { AppProps } from "next/app";
import { Toaster } from "@/components/ui/toaster";
import { PipelineSyncProvider } from "@/components/pipeline-sync-provider";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <PipelineSyncProvider>
      <Component {...pageProps} />
      <Toaster />
    </PipelineSyncProvider>
  );
}
